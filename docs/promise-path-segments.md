# Promise-Valued Path Segments Architecture

Developer-facing path restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document defines their runtime architecture.

## Model

A path segment is a String or Number operation input. Normalize it only after it is ready. Any other resolved value produces a validation Error, and a Promise-valued segment must never be stringified as a Promise object.

The path carries each actual input value plus one trusted compiler fact: the first dynamic-segment position. A ready computed key is still dynamic. Preserve this fact through path capture, composition, and entered contexts; do not infer staticness from a String/Number value or thenable readiness.

The operation protects the longest resolved path prefix before a continuation remains pending. This is the narrowest scope that can preserve sequential behavior while the next key is unknown.

## Preparation

Observation and mutation keep their existing walkers because mutation additionally owns COW, writeback, gating, and failure publication. Centralize their identical direct-or-Promise segment consumption and String/Number validation. Both walkers follow the same one-time prefix-protection and resumption protocol through their existing lease or gate transitions.

Walk ready leading segments synchronously. Consume a possible custom thenable through the common helper and continue traversal in its callback. A synchronous delivery extends the same resolved prefix. Once traversal selects the target, readiness belongs to the target operation: its independent pending result adds no prefix protection. Only a returned pending chain for unfinished path selection acquires one prefix scope before the issuing stack returns:

- An observation leases the reached prefix value. Later managed mutations use COW, so the observation can continue through its captured value without delaying them.
- A mutation installs the ordinary transition gate at the reached managed prefix placement and continues against its private working value. Later operations through that prefix wait; unrelated paths continue. A managed gate also orders later contextual access to mutable external descendants before they reserve phases. No uncertain external candidates are reserved.

Consume each later segment through the common Promise and Error preparation only when traversal reaches it. A direct returned result continues the current transition; unfinished path work resumes from the existing protected prefix without acquiring another scope. Each path selection has one local `pathSelectionComplete` fact, initially false and set immediately before invoking the selected target operation. Reuse an already-retained selected target if its presence has exactly that meaning; otherwise retain the Boolean across this path's continuations. Do not wait for the target operation to return or settle before setting it. This semantic handoff is distinct from callback execution and result readiness: `!pathSelectionComplete` plus a pending result requires prefix protection, while a pending result after handoff belongs to the target operation. For example, a ready custom key selecting an Array whose `pop()` removes a pending element completes traversal and receiver publication immediately; only the removed element's independent result waits, and no prefix gate or lease is added.

Initialize callback-visible staging, captured versions, and enclosing writeback required regardless of readiness before subscribing: a callback may run inside `then`. Pending-only gates, Promise versions, leases, and registrations are installed only after the returned transition proves that their dependency remains pending. JavaScript run-to-completion prevents asynchronous delivery from interleaving before that installation and the issuing stack returns. Completion releases the observation lease or publishes the mutation gate, so several pending segments still use one prefix scope without waiting for unused segments. An existing scope follows its ordinary capture or publication handoff; an independent result cannot extend protection after that work is complete.

If the known prefix already fails, return or publish the ordinary path Error without waiting for unused segments. If segment preparation fails, an observation returns that Error and a mutation applies the ordinary failure rule at its gated prefix.

An unused segment Promise remains host-owned. Cascada does not wait for it or attach a rejection observer merely to suppress host-level unhandled-rejection reporting.

Initial mutation-tree discovery filters the compiler's finite tree of static access prefixes, with `{}` endpoints. It follows only named original placements, records the first external owner, and removes non-external endpoints and empty branches. An endpoint at a managed `!` scope does not request descendant discovery; poison scopes remain separate operation facts. Computed keys never contribute child locations. A recorded owner may precede a dynamic native suffix. Independently, every original value on a mutable-resource route must be directly accessible: any Promise or thenable stops discovery, including synchronous delivery. Registration never substitutes its imported outcome or resumes after delivery. See [compiler construction](integration.md#compiler-construction-of-the-mutation-access-tree).

Prefix-wide mutation ordering is unavoidable. For `value[pendingKey]`, no descendant is known until the key resolves, so a later operation anywhere beneath `value` may conflict.

## Operation lifetime

Promise-valued path work uses the owning operation's common lifetime. A path component reuses its containing operation's owner. A standalone public path operation obtains one `OperationOwner` through one centralized provision point, either at operation entry or when it first registers asynchronous work. The choice is an allocation optimization, not semantics; it must not spread optional-owner branches through path walkers. Every pending segment continuation, external predecessor wait, and other asynchronous registration goes through the common guarded helpers. Only returned pending work triggers pending owner state, and prefix protection requires unfinished path selection; an independent result after target handoff cannot trigger it. The original input's callable `then` is not a readiness signal. This is generic operation state, not query state, and property-version APIs remain unaware of it. A registered continuation first completes shared placement-version, refcount, and required settlement bookkeeping. If the operation has closed, it performs no later key normalization, traversal, lease or gate acquisition, external-phase work, host access, publication, or result production.

Observe every pending walker continuation at its originating layer even when a non-blocking mutation API does not return that Promise.

During normal or language-Error completion, publication required to finish an observation, gated mutation, or repair happens before that operation closes. Ordinary owner closure inside a live execution does not cancel an installed gate, release an external phase early, or replace their completion rules. Fatal execution failure adds no gate or phase transition: a resumed continuation sees the failed execution first and simply returns before settlement, publication, or host access. A never-resumed gate or phase may remain pending; fatal commit independently rejects every currently pending operation result through its registered outward rejection action. A standalone observation closes when its result or language-Error outcome is determined. A pending mutation normally closes only after its gate publishes success or failure; its immediate non-blocking API return is not completion and therefore needs no outward registration. A pending repair normally closes after its selected managed guard or external phase publishes repair success or failure. When path resolution is one component of invocation, export, or an Error query, only that larger owner determines the outcome and the path creates no independent lifetime.

`hasError` and `getErrors` reuse their query owner, path export reuses its export owner and separate output lifetime, and `run` and `enter` reuse their containing owner. `readPath` inherits the owner and external-selection policy of the operation consuming its temporary result. `repairPath`, standalone lookup, and ordinary mutation use the centralized owner provision above. This changes lifetime plumbing only; their completion, Error, cleanup, and ready-path behavior stays unchanged.

## External state

Only mutable external boundaries require static selection and ordered phases. Observation-only external data supports dynamic paths without fixed-namespace protection or mutable-resource locking.

A computed key before a mutable boundary makes that selection invalid even if the key is ready. Fail before native reflection, capability exposure, or phase reservation. An observation returns an external-location validation Error. A mutation publishes at an explicit managed scope already selected before the dynamic key, or at the longest static managed prefix if its intended scope lies beyond that key. Capture this failure location from path facts, not detection timing. Existing poison always propagates unchanged. Never choose a candidate resource to poison.

Dynamic paths that select ordinary managed or observation-only external data remain supported. Do not reject them just because another child of the same prefix is mutable. Their ordinary managed prefix lease/gate preserves value ordering. No speculative external selection or global candidate wait is needed.

Once a static path selects one mutable external boundary, reserve its ordinary observation or mutation phase before waiting for any dynamic native-suffix input key. Earlier managed and binding-entry gates precede this reservation. Keep that selected phase through required boundary completion. A new mutable resource cannot be selected through the suffix, and no deferred key grants additional authority.

Promise-valued operation-input keys are different from stored native property values. After crossing an external boundary, intermediate stored values, method receivers, and selected callables must be ready; do not await a stored Promise to continue the suffix. A final lookup value or direct call result may be consumed for availability. Final assignment/deletion does not read or consume the old target.

Prefix protection composes with the selected mutation scope. A coarser prefix gate can remain the publication vehicle, but it does not broaden the Error location after scope selection. Independent result readiness extends neither completed path protection nor receiver publication. Read/export/query capture finishes before source protection ends; repair retains its selected transition through publication.

Mutable-external entry requires a static path to the whole first external boundary. Compiler lowering enters that boundary for delayed conditional writes to any native descendant. Its context-binding gate prevents outside access while the callback issues work; contained operations reserve normal external phases, and entry itself holds none. Ordinary managed entry still supports Promise-valued keys. A Promise stored at its selected managed target retains the existing entry behavior.

Repair targets only its selected retained managed guard or statically selected external scope. A marker inside native state clamps to the first external boundary without consuming its unused suffix. It bypasses no poisoned ancestor and clears no descendant poison.

## Scope

Extend the existing observation and mutation walkers through their shared segment transitions rather than adding operation-specific paths. Reuse the existing read-lease counter, COW predicate, transition-gate placement, Promise versions, and publication transitions. Share lower-level transitions with `enter` where they are identical, but do not merge the observation and mutation walkers, route ordinary path operations through `enter`, create temporary Chains, or add another queue or path scheduler. Ready paths retain their current synchronous behavior.
