# Promise-Valued Path Segments Architecture

Developer-facing path restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document defines their runtime architecture.

## Model

A path segment is a String or Number operation input. Normalize it only after it is ready. Any other resolved value produces a validation Error, and a Promise-valued segment must never be stringified as a Promise object.

The path Array carries the Promise itself. No sideband prefix length or segment-origin metadata accompanies it.

The operation protects the longest resolved path prefix before waiting. This is the narrowest scope that can preserve sequential behavior while the next key is unknown.

## Preparation

Walk ready leading segments synchronously. If the path is complete, continue through the existing operation with no added protection. If a segment is pending, acquire one prefix scope before waiting:

- An observation leases the reached prefix value. Later managed mutations use COW, so the observation can continue through its captured value without delaying them.
- A mutation installs the ordinary transition gate at the reached managed prefix placement and continues against its private working value. Later operations through that prefix wait; unrelated paths continue. On a context Chain, query the static external mutation tree and register every possible live external phase before installing the gate.

Resolve each later segment through the common Promise and Error preparation only when traversal reaches it. Continue from the protected prefix without acquiring another scope. Completion releases the observation lease or publishes the mutation gate, so several pending segments still use one prefix scope without waiting for unused segments.

If the known prefix already fails, return or publish the ordinary path Error without waiting for unused segments. If segment preparation fails, an observation returns that Error and a mutation applies the ordinary failure rule at its gated prefix.

An unused segment Promise remains host-owned. Cascada does not wait for it or attach a rejection observer merely to suppress host-level unhandled-rejection reporting.

Prefix-wide mutation ordering is unavoidable. For `value[pendingKey]`, no descendant is known until the key resolves, so a later operation anywhere beneath `value` may conflict.

## Operation lifetime

Promise-valued path work uses the owning operation's common lifetime. A path component receives its containing operation's owner; a standalone walker makes its existing path context an explicit owner. Every pending segment continuation, external predecessor wait, and other asynchronous registration goes through the common guarded helpers, so pending work is never unowned while a completely ready path allocates no additional owner object or release-registry state. This is generic operation state, not query state, and property-version APIs remain unaware of it. A registered continuation first completes shared mirror, property-version, refcount, and required settlement bookkeeping. If the operation has closed, it performs no later key normalization, traversal, lease or gate acquisition, external-phase work, host access, publication, or result production.

Observe every pending walker continuation at its originating layer even when a non-blocking mutation API does not return that Promise.

Publication required to finish an observation or gated mutation happens before that operation closes. Closing operation work does not cancel an installed gate, release an external phase early, or replace their completion rules. A standalone observation closes when its final result or fatal failure is determined. A pending mutation closes only after its gate publishes success or failure; its immediate non-blocking API return is not completion. When path resolution is one component of invocation, export, or an Error query, only that larger owner determines the final outcome and the path creates no independent lifetime.

`hasError` and `getErrors` reuse their query owner, path export reuses its export owner and separate output lifetime, and `run` and `enter` reuse their containing owner. Standalone lookup and ordinary path operations use their existing path context as the owner. This changes lifetime plumbing only; their completion, Error, cleanup, and ready-path behavior stays unchanged.

## External state

Before waiting for a segment on a context Chain, query the ready prefix in its static external mutation tree. Register observation or mutation phases for every live leaf the unresolved suffix may reach. Tree lookup lazily removes a queried conflict leaf. Selection is protection, not actual use; record use only after the resolved path reaches an identity. Freeze the selected phase set before waiting.

The managed prefix lease or gate and all selected external phases are published before waiting on any predecessor. After resolution, continue with the exact normalized path and acquire no new phase. Actual use follows the ordinary Chain-and-path identity rule. External mutation succeeds only when the resolved boundary is a live tree leaf whose phase was already selected; otherwise it returns an Error before host access. An unindexed external identity remains observation-only.

## Scope

Extend the common observation and mutation path preparation rather than individual operations. Reuse the existing read-lease counter, COW predicate, transition-gate placement, Promise mirrors, and publication transitions. Share lower-level transitions with `enter` where they are identical, but do not route ordinary path operations through `enter`, create temporary Chains, or add another queue or path scheduler. Ready paths retain their current allocation and synchronous behavior.
