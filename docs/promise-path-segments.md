# Promise-Valued Path Segments Architecture

## Model

A path segment is a String or Number operation input. Normalize it only after it is ready. Any other resolved value produces a validation Error, and a Promise-valued segment must never be stringified as a Promise object.

The operation protects the longest resolved path prefix before waiting. This is the narrowest scope that can preserve sequential behavior while the next key is unknown.

## Preparation

Walk ready leading segments synchronously. If the path is complete, continue through the existing operation with no added protection. If a segment is pending, acquire one prefix scope before waiting:

- An observation leases the reached prefix value. Later managed mutations use COW, so the observation can continue through its captured value without delaying them.
- A mutation installs the ordinary transition gate at the reached prefix placement and continues against its private working value. Later operations through that prefix wait; unrelated paths continue. If that prefix contains a fixed external binding, reject before installing the gate.

Resolve each later segment through the common Promise and Error preparation only when traversal reaches it. Continue from the protected prefix without acquiring another scope. Completion releases the observation lease or publishes the mutation gate, so several pending segments still use one prefix scope without waiting for unused segments.

If the known prefix already fails, return or publish the ordinary path Error without waiting for unused segments. If segment preparation fails, an observation returns that Error and a mutation applies the ordinary failure rule at its gated prefix.

Prefix-wide mutation ordering is unavoidable. For `value[pendingKey]`, no descendant is known until the key resolves, so a later operation anywhere beneath `value` may conflict.

## External state

External mutation paths and their `!` scopes remain compiler-static and contain no Promise-valued segment. This phase does not reserve an external guard for an unknown path.

A Promise-valued path that resolves to context-exclusive external state fails before host access; otherwise a later static mutation could have overtaken it. A mutation whose unresolved prefix contains a fixed external binding fails before installing its ordinary gate, even if its eventual target could have been a managed sibling. Observation-only external state may be accessed because it cannot be mutated while Cascada can observe it. Other managed receivers retain ordinary managed behavior.

## Scope

Extend the common observation and mutation path preparation rather than individual operations. Reuse the existing read-lease counter, COW predicate, transition-gate placement, Promise mirrors, and publication transitions. Share lower-level transitions with `enter` where they are identical, but do not route ordinary path operations through `enter`, create temporary Chains, or add another queue or path scheduler. Ready paths retain their current allocation and synchronous behavior.
