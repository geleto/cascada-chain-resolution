# Repair own-path poison without rollback

Implementation contract for the [three Chain modes](poison-policy-plan.md), before open-entry streaming. Genuine own-path status is repairable under ordinary selection and mutation authority; ordinary Error data is not. This includes sequential-stream positional flags on retained occurrences, but excludes complete-mode Array Errors, permanent structural poison, and missing-output markers. Production behavior changes with implementation and authoritative contract updates.

## 1. Contract

Repair removes the exact selected path's own failure status, regardless of which operation introduced it. It leaves current data unchanged. It does not undo an operation, restore a predecessor, reconstruct missing data, or clear local property/element poison.

The distinction is status versus data poison. A sequential-stream positional flag retains a known survivor at a deterministic fallback position; repair exposes it there without reconstructing its intended position. A potentially deleted/overwritten value becomes permanent structural poison, even when the command used !. A missing-output marker is ordinary Error data and needs ordinary removal/replacement. Genuine computed-key, scope, or canonical external path failures remain repairable without an explicit-! origin restriction.

| Selected state | Repair effect |
| --- | --- |
| Managed own-path status, including a sequential positional flag | Clear that status and preserve the retained payload, fallback position, presence, pending versions, and local poison. |
| Complete-mode root Error, structural Error element, or missing-output marker | No hidden value to restore. Leave the Error unchanged. Ordinary replacement/removal remains available. |
| Canonical external own-path status | Clear only that status; preserve host state and descendant metadata. |
| Healthy or absent placement | No data change; clear selected canonical own status there if one exists. |
| Ordinary Error value, with no own status | Leave the Error unchanged; successful selection returns undefined without inspecting or repairing its payload. |
| Container with only descendant or regional poison | Do not recurse or clear it. Repair has no effect on those failures. |
| Invalid or inaccessible selection | Return the selection Error without changing state. |
| Off-path alias of a registered external identity | Apply ordinary managed-placement rules; do not clear canonical resource metadata or grant authority. |

A genuine poisoned strict ancestor blocks selection in every mode. Repair that ancestor before accessing a flagged descendant. Regional Array failure does not automatically flag the Array root, so a positional flag on a retained element can normally be repaired directly at its fallback index. Clearing a descendant never clears an ancestor or local value poison. Repair does not search for another scope or widen an absent index to its Array.

Successful repair returns undefined after status publication, including when no own status exists. Selection, authority, or publication failures return poison. Error-query snapshots taken before repair retain their earlier status.

### Pending payloads and local poison

Clearing selected own status does not consume the selected payload. A pending payload may remain pending; an ordinary Error remains Error data. When own status and data poison coexist, clear only own status and return undefined. This avoids a result-only payload wait.

Traversing an intermediate Error or an unavailable parent is still a selection dependency. Repair cannot skip it merely because the eventual operation would clear metadata. Final selection and traversal through the selected value are different operations.

## 2. No repair-only predecessor

Keep current logical data and own failure status in the same versioning system. A flagged path blocks access to its retained data until repair or permitted replacement. Unaffected siblings remain accessible. Unordered mode avoids creating positional flags; it does not bypass an existing one. No mode needs a hidden earlier value solely for repair.

Every committed independent write survives. Other accessible regions can accept later mutations; repair clears only the selected status on current state. It must not reveal a saved pre-failure Array and discard those later writes.

After a streaming mutation of [A,B,C,D] by splice(2,failedCount,"X"), the fallback [A,B,X,Error,Error] does not retain C/D for repair: their survival was uncertain. In contrast, failed-position pure insertion retains A/B/X, and sequential mode can repair their individual positional flags. Repair creates a successor; it does not restart an earlier captured iterator. Explicit assignment of a saved COW snapshot remains the way to request restoration.

Ordinary replacement/deletion clears the own status at the selected location. A child replacement does not clear an ancestor's status. Creating or deleting a local Error at an Array index retains ordinary committed length behavior; status clearing itself neither grows nor shrinks the Array.

## 3. Keep necessary protection

Remove rollback and hidden storage retained solely to implement repair. Preserve captures and copies required by other owners, immutable outputs, imported-data protection, pending publication, and native isolation.

A write that never committed cannot be treated as a completed logical mutation. Conversely, failure cannot erase writes already committed by a controlled partial operation. Repair changes neither fact.

Opaque native mutation adopts its private working graph only after successful validation. If failure prevents adoption, keep current logical data and record path poison; the inadmissible private graph never becomes the data exposed by repair. This requires no repair-only predecessor and does not undo any committed logical write. Verify this boundary before removing old recovery storage.

## 4. Provenance and ownership

Own-path status belongs to the owning logical placement/version, not the Error object, kind, message, or source context. Remove explicit-! repair-origin flags and eligibility tests. Keep causal provenance for reporting and ordinary mutation authority for writes; neither is a second repair policy.

Ordinary Error values and stored payload rejection remain data poison. Ordinary access cannot bypass selected or ancestor path flags. Extraction of accessible data does not attach unrelated failures; status and marker roles contained in a captured substructure remain intact. Canonical external paths retain their existing authority rules.

Historical captures and COW preserve the selected data/status versions. Clearing one owner's status cannot change another owner or earlier snapshot. Record status on owned logical path/placement state, separately from shared payload identity; apply the policy's extraction rule at ordinary handoff.

An external setter/deletion failure can be cleared at its canonical own scope, including without a source `!`. This clears metadata only; it does not reverse host changes, replace fixed identities, re-register a resource, or grant native authority. Off-path aliases cannot clear canonical status.

## 5. Ordered and atomic clearing

Repair is an ordinary ordered mutation of selected status. It has no host effect and needs no native reservation merely to clear metadata; actual conflicting host effects retain their reservations.

1. Capture the selected current data/status at repair's program position.
2. Establish selection and authority without consuming unrelated descendant poison or hidden payloads.
3. Complete required COW and fallible publication preflight before clearing anything.
4. Publish the cleared managed own status and any selected canonical external own status in one protected transition. Preserve data and descendant status.
5. Expose completion only after commit. A supported failure preserves the previous state and returns its causal Error.

External clearing updates only the own field, not the subtree. Once selection and authority permit repair, clear captured pending own status without awaiting its eventual cause or origin. Install a clean successor while earlier captures retain the original future. This does not bypass a required path-selection or result dependency, clear local data poison, or suppress the failed operation's own result.

Late settlement may finish an earlier capture, but cannot reinstate cleared status or replace later data in the current version.

## 6. Repair-and-call

Preserve one combined ordered transition. Capture call inputs and reserve its position before suspension. Preflight the structural route, scope, and readonly capability; failure preserves the previous state and suppresses invocation.

After successful repair, use ordinary receiver, dispatch, authority, argument, and invocation processing under the original ordering. Local poison remains an input dependency. A new call failure publishes against current state and cannot resurrect the cleared status.

Do not implement this as an awaited public repair followed by newly issued public call. Parent repair does not reset descendant external status; a subsequent whole-resource call can remain blocked by it.

## 7. Implementation and verification

- Replace repair-only recovery storage with current data plus own status, using common placement versions, COW, and publication.
- Implement exact-own external clearing, including pending status; remove unconditional subtree reset and obsolete origin-based eligibility machinery.
- Integrate all three modes and ordinary path blocking. Preserve positional status separately from permanent structural poison, missing-output markers, and payload poison.
- Verify repair after several continued writes, earlier captures, local/regional poison, absence, Array length, repeated failures, and replacement. Ready/pending own status with healthy, Error, or never-settling payloads returns undefined after successful status publication; ordinary local poison remains unchanged.
- Preserve failed-repair atomicity, combined-call ordering, fixed external identities, aliases/cycles, retirement/re-entry, and source release.
- Audit opaque native failure publication before removing any isolation path. Do not replace an invalid working graph with fabricated healthy data.

Validate the [policy and query integration](poison-policy-plan.md) alongside this revision. The initial determined-layout cursor can precede the mode cutover; structural streaming and open-entry failure behavior use the selected modes.
