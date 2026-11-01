# Repair only explicit-! own-path poison

Implementation specification selected alongside [partial Array publication](iterate-plan.md), with an independent implementation and rollout. Array regional failures need no recovery baseline; the iterator does not otherwise depend on this entire repair revision. Production behavior changes only when the code and authoritative contracts are updated together.

## 1. Contract

Repair removes the exact selected path's own blocking poison only if the blocker originated from an explicit ! operation. It exposes retained placement state; it neither repairs local data nor reconstructs a failed operation.

Two conditions are necessary: eligible origin and an owning-path blocker. A local Error caused by a!.splice(...) does not become repairable just because the command used !.

This is an explicit language restriction: repair unblocks a failed explicit mutation sequence at its selected path. It is not a general Error eraser. Ordinary failed data writes use ordinary replacement/deletion where permitted; they do not gain implicit recoverability merely because the runtime retained an old value. Explicit-! provenance is therefore distinct from mutation authority and from the Error's causal source.

| Selected state | Repair result and effect |
| --- | --- |
| Eligible managed own-path blocker | Expose its retained placement, preserving presence, value/version, and all contained local poison; return undefined after publication. |
| Eligible canonical external own-path blocker | Clear only that own blocker; retain host state and descendant metadata; return undefined after publication. |
| Healthy value or absent placement | No change; return undefined. A canonical location can still have an eligible external own blocker to clear. |
| Ordinary Error or ineligible own-path blocker | Return the existing Error; clear nothing and invent no retained value. |
| Container with only descendant or regional poison | Do not recurse or clear local data. A repair with no selected own blocker is a no-op. |
| Strict-ancestor blocker or invalid selection | Return the selection/blocking Error without modifying state. |
| Off-path alias of a registered external identity | Apply ordinary managed-placement rules only; never clear its canonical resource metadata or grant native authority. |

An owning-path blocker prevents all usage through that path until a permitted repair or replacement removes it. Local data poison instead propagates to consumers that depend on those data facts. Repair never searches for a nearby eligible blocker or widens an absent Array index to its Array.

## 2. What retained state means

For an opaque managed ! call, ordinary mutation isolation protects the pre-call logical value. Failure discards the private working graph; an eligible path blocker can retain the protected prior placement. Repair exposes that placement, not the failed working receiver.

Retained state includes absence and a captured pending version where applicable. Restoring absence leaves an already committed Array length unchanged. Restoring a pending version preserves its exact producer; it does not wait for or guess its payload. This is deterministic restoration of a specified placement, not reconstruction from incomplete data.

Local Errors already inside the retained value survive. For example, unpoisoning a path that hid a partially failed Array still exposes that same partial Array. Successful repair need not make hasError false.

For the partial splice:

```text
[A, B, C, D].splice(2, failedCount, "X")
```

repair is not authorized to construct [A,B,X,C,D] or restore the old [A,B,C,D]. Restoring a captured predecessor as a new successor is technically possible; it is excluded from repair because it can discard independent effects committed by the failed command and intervening commands. There is no implicit regional baseline merge. An explicit assignment of an available saved value is ordinary replacement with its ordinary ordering. Overwrite, deletion, truncation, or whole-value replacement establish new facts and discard exactly the dependencies they supersede, as specified in the Array plan.

A broader ! scope grants authority but does not convert local failure into an ancestor blocker. Opaque operations retain whole-scope isolation where required; controlled Array operations use their known dependency footprint.

An unused poisoned argument creates nothing to repair. A proved no-write operation with a determined result, such as fill on an empty Array, succeeds without installing any blocker or local poison. Determined effects/results likewise ignore irrelevant argument poison. Preserve existing local Errors in retained data. There is no separate Array failure marker to clear; a failure of a required effect retains its ordinary call/dependent-data outcome.

## 3. Provenance and ownership

Repair eligibility belongs to owning placement or external own-state metadata, never to an Error object, Error kind, message, or source context. Propagating or storing the same Error elsewhere transfers neither retained state nor repair authority.

A mutating run already has an explicit-! fact in its trusted mutation mode. Assignment/deletion also need an explicit origin fact because their implicit mutation authority does not prove that the source used !. Carry that Boolean from compiler issuance to the introducing failure boundary; do not infer it from a nondefault scope depth, omitted JavaScript arguments, or diagnostic text. Scope selection and origin are separate facts.

A failure while traversing an explicit-! command can own poison at the first failed placement under the existing selection rules. That blocker retains the command's origin; an existing blocker propagated through a later ! command never gains new eligibility. Stored payload rejection remains local data, not an own-path blocker.

COW and representation copies preserve eligible owning-placement state and ordinary retention. Two owners must not share a baseline that mutation through one can change for the other. Extracting an Error as data does not copy that state. Canonical namespace references continue following ordinary ordered publication, not arbitrary copies.

Drop repair-only retained values for ineligible failures. Preserve protection needed for native mutation isolation, immutable outputs, imported data, captures, or required publication. Do not remove all recovery/baseline machinery merely because regional reconstruction is excluded.

The origin restriction also applies to external setters and deletion: a non-! failure is ineligible. Fixed resource identities cannot be replaced by forbidden namespace mutation. Such a blocker can therefore remain effective for that execution; repair grants no extra authority. This loss of recovery is a deliberate consequence of the selected restriction, not a storage limitation to work around by dropping the failure or relabeling its origin.

## 4. Ordered and atomic clearing

Repair is an ordinary ordered mutation of selected blocker state. It has no host effect and needs no native reservation merely to clear metadata. Existing host-effect reservations remain active for actual conflicting operations.

1. Capture the requested path and selected own state at repair's program position. Strict-ancestor blockers still prevent selection; descendant summaries do not prevent selecting their parent.
2. Establish origin eligibility and required authority without inspecting the hidden managed graph or external host contents.
3. Complete fallible managed selection, COW, placement restoration, and publication preflight before committing any clear.
4. Publish the restored managed placement and any eligible selected canonical external own state in the same protected transition. Preserve child metadata and ineligible state.
5. Expose completion only after commit. On supported failure, preserve the prior blocker, retained placement, and external metadata, returning the new causal Error.

Current metadata clearing replaces a subtree. The replacement must update only its own field while forwarding the captured child branches. Earlier queries keep earlier versions. Late publication from an overwritten external operation can update its old capture, never reinstate a cleared blocker in the current version.

Pending own state needs particular care: explicit-! eligibility cannot be inferred from a pending operation alone if its eventual outcome may simply propagate an older ineligible blocker. Apply the conditional clear to the captured own-state outcome. Repair may complete without waiting only when existing facts prove that every possible selected own outcome is empty or eligible; otherwise the eligibility decision is a real dependency. Do not unconditionally erase a pending ineligible outcome to preserve an old fast path.

For example, a pending ordinary external setter precedes an explicit ! call. That call might introduce its own eligible blocker, or merely propagate the setter's ineligible blocker. A subsequent repair cannot distinguish those cases from the last command's ! flag. Waiting for the necessary provenance reverses the old unconditional pending-reset behavior intentionally; fixing eligibility at issuance would clear failures this contract expressly excludes.

Repair never waits for unrelated descendant poison merely to leave it unchanged. An earlier pending value hidden beneath an eligible managed blocker also remains ordinary data after restoration. Future writes and captures retain their own version authority; repair cannot replay over them.

## 5. Repair-and-call

Preserve the existing combined operation's ordering and structural preflight:

- Capture explicit call inputs and reserve the combined operation's position before suspension.
- Preflight the structural route, selected mutation scope, and readonly capability before clearing. Failure preserves the old state and skips invocation.
- Perform the exact-own-state repair above. A repair failure or ineligible blocker suppresses the call.
- After committed repair, use ordinary receiver availability, dispatch, authority, argument preparation, member selection, and invocation. Do not add a second early dispatch path.
- Local data poison remains an input to the selected call's normal dependency rules. A bounded controlled call can use healthy facts; a native call requiring the full graph can fail on local poison.
- A new failed call owns its new failure against the repaired state. It must not resurrect deliberately cleared poison.

Do not implement this as an awaited public repair followed by newly issued public run: intervening work could acquire precedence. Reuse the existing combined transition and one operation/result lifetime.

Parent repair does not reset a resource subtree. If api.db carries a blocker and api!!.reset() requires the whole api subtree, repairing api alone leaves the call blocked by api.db. Repair each eligible descendant explicitly before the parent call, using ordinary ordering; an ineligible descendant remains blocking. Do not preserve the previous subtree-reset idiom by recursively clearing eligible children.

## 6. Implementation work

| Area | Required change |
| --- | --- |
| path-operation.js, mutations.js | Test exact-own eligibility and preserve failed-repair atomicity. Retain first-failed-placement and strict-ancestor rules; no ancestor search. |
| mutate-property.js, run.js, invocation.js | Forward explicit-! origin to the failure introduction. Do not upgrade an existing blocker or ordinary payload Error. |
| property-versions.js and ownership | Retain placement state only for eligible repair or another named protection; preserve absence, pending versions, COW, and source release. |
| external-metadata.js | Replace unconditional subtree clearing with conditional own-field clearing. Preserve child branches, historical captures, and pending-outcome provenance. |
| Public API/compiler integration | Carry the minimal missing assignment/deletion origin fact in one coordinated cutover. Trust internal controls without malformed-control tests or compatibility adapters. |

Regional reconstruction was a design proposal, not a reason to invent more runtime recovery machinery. The concrete removals are ineligible repair baselines and subtree-wide clearing; opaque native isolation and eligible own-path restoration remain. Land origin transport, eligibility, clearing, and their public contracts together; do not couple the cutover to completing every Array method family.

Update docs/error-handling.md, docs/data-limitations.md, docs/mutation-and-observation.md, docs/integration.md, docs/run.md, external-ordering documentation, and the corresponding AGENTS.md scope/repair guarantees with the implementation.

## 7. Verification

- Eligible own-path repair restores exact retained presence/value/version, including a hole and a never-settling payload.
- Empty/otherwise determined controlled operations with unused poisoned arguments create no repair state; existing local poison remains unchanged.
- Local element, mapping, shape, and any other local Array failure survive path unpoisoning; partial splice never chooses a missing layout.
- Non-! failures, copied/imported Errors, and an existing ineligible blocker encountered by a later ! operation gain no eligibility.
- Parent repair preserves child external poison, including pending child outcomes; own/ancestor/descendant selection is distinct. Parent repair-and-call can remain blocked until each eligible descendant is explicitly repaired.
- Pending own metadata that can propagate an ineligible predecessor is not blindly cleared. Earlier queries and later commands keep their respective versions.
- Failed selection or publication preserves both managed and external prior state. Healthy repair creates no placement or mutation identity.
- Repair-and-call preserves input capture, structural preflight, original ordering, remaining local failures, and repaired-state failure ownership.
- Off-path aliases cannot clear canonical metadata; broader scopes grant no additional external authority.
- COW, aliases/cycles, retained old Errors, and source release work with both ready and pending restoration. GC probes retain unformatted diagnostics and healthy controls.
- Replace fixtures that create repairable state through ordinary assignment with explicit-! origins or non-repairability expectations. Retain native isolation and immutable-output checks.
