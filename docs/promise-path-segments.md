# Promise-Valued Path Segments Architecture

Developer-facing path restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document defines their runtime architecture.

## Model

A path segment is a String or Number operation input. Normalize it only after it is ready. Any other resolved value produces a validation Error, and a Promise-valued segment must never be stringified as a Promise object.

Resolving to a String or Number does not make a computed segment compiler-static. Promise-valued paths support managed operations and external observations; external mutation requires compiler-known segments throughout.

The operation protects the longest resolved path prefix before waiting. This is the narrowest scope that can preserve sequential behavior while the next key is unknown.

## Preparation

Walk ready leading segments synchronously. If the path is complete, continue through the existing operation with no added protection. If a segment is pending, acquire one prefix scope before waiting:

- An observation leases the reached prefix value. Later managed mutations use COW, so the observation can continue through its captured value without delaying them.
- A mutation installs the ordinary transition gate at the reached prefix placement and continues against its private working value. Later operations through that prefix wait; unrelated paths continue. On a context Chain, register phases for every indexed candidate external identity before installing the gate.

Resolve each later segment through the common Promise and Error preparation only when traversal reaches it. Continue from the protected prefix without acquiring another scope. Completion releases the observation lease or publishes the mutation gate, so several pending segments still use one prefix scope without waiting for unused segments.

If the known prefix already fails, return or publish the ordinary path Error without waiting for unused segments. If segment preparation fails, an observation returns that Error and a mutation applies the ordinary failure rule at its gated prefix.

An unused segment Promise remains host-owned. Cascada does not wait for it or attach a rejection observer merely to suppress host-level unhandled-rejection reporting.

Prefix-wide mutation ordering is unavoidable. For `value[pendingKey]`, no descendant is known until the key resolves, so a later operation anywhere beneath `value` may conflict.

## External state

Before waiting for a segment on a context Chain, query the ready prefix in its external-occurrence index. Register observation or mutation phases for every indexed external identity the unresolved suffix may reach. This selection is protection, not actual use; record use only after the resolved path reaches an identity. Freeze the selected phase set before waiting.

The managed prefix lease or gate and all selected external phases are published before waiting on any predecessor. After resolution, continue with the exact normalized path, discard no selected phase, and acquire no new one. Record the actual context Chain and path as dynamic before host access. An external observation proceeds only when a selected boundary covers the reached identity; otherwise it returns a validation Error before host access. External mutation never reaches host code because mutation requires one compiler-static path; it poisons a selected covering phase or follows the managed prefix's gated failure when none covers it.

## Scope

Extend the common observation and mutation path preparation rather than individual operations. Reuse the existing read-lease counter, COW predicate, transition-gate placement, Promise mirrors, and publication transitions. Share lower-level transitions with `enter` where they are identical, but do not route ordinary path operations through `enter`, create temporary Chains, or add another queue or path scheduler. Ready paths retain their current allocation and synchronous behavior.
