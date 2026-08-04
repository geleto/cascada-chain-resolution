# Core Runtime Contracts

## Goal

Cascada's core contract is that operations on an asynchronously available graph produce the same results as if every value were already available and the operations ran sequentially.

It achieves this with ordered local continuations, mirrors, and copy-on-write:

1. An operation synchronously processes everything currently available.
2. On reaching a Promise it registers at that position and moves on, continuing any other work already available.
3. When a Promise settles, its existing registrations run as one FIFO batch, and each completes its transition synchronously.
4. Mirrors preserve the exact property version an operation captured.
5. Copy-on-write preserves owner isolation.

Issuing a command never blocks. A result may stay pending for the Promise frontier that command captured, never for the whole graph, and every transition includes all earlier effects and no later ones.

## Ordering

- Do all available work synchronously, in program order.
- On reaching a Promise, register at that exact position through the runtime's promise helpers. Raw `.then` belongs only inside those helpers.
- The helpers canonicalize each callable thenable once; every continuation for that source registers on the same native Promise.
- Invoke each continuation in one reaction on that canonical Promise; a per-consumer proxy would fragment its FIFO batch.
- Never defer part of a transition with `await`, another `.then`, `queueMicrotask`, or lazy registration.

## Promise Mirrors

- A mirror stands for one property version. Assigning again, even the same Promise, makes a new mirror.
- Distinct logical properties have distinct mirrors even when an ArrayView makes them share physical storage. A retained Promise property forks its mirror at view derivation.
- A mirror is live only while the parent's mirror map holds that exact instance.
- A mirror defines the logical state of its property version. Physical writeback is only a storage optimization; graph operations must not assume it occurred.
- A live imported property preserves its external Promise and keeps its settled logical value in `resolvedValue`. Once detached, every mirror keeps its value in `detachedValue`.
- Replacing or deleting the property detaches the old mirror. Operations that already captured it keep working against its private state.
- Each operation that reaches a pending property registers a resolver at its own program position. A settling Promise changes nothing on its own; state changes only when the first resolver completes its transition.
- Later resolvers ignore the settled payload and work from the latest state earlier resolvers left.

## Ownership

- Classify a property container and its stored value independently: the container determines whether Cascada may write the property; the value's identity and provenance determine whether that value is imported or shared.
- A non-shared language value has one owner and may be mutated in place.
- Imported data is borrowed storage. Cascada may attach metadata and maintain logical state, but it never changes the data's language-visible contents because outside code retains ownership.
- Storing an externally sourced value in a runtime-owned container does not make that container imported.
- Sharing records reuse of the same tracked identity, not the fact that a value was observed. Reuse in another variable/property goes through lookup, which marks it shared by default.
- Pass `sharedOwnership: false` only for a pure read, or when ownership is ceded to the caller.
- Shared or imported data is protected by copy-on-write; mutation must not affect another owner or external data.
- Cascada does not create non-extensible language data. Such data is external; non-extensibility only forces copy-on-write and may move metadata to the WeakMap. It does not change logical semantics.

## Copy-on-Write

- Language mutation never changes a shared or imported node in place. It shallow-copies each level along the path down to the changed spot, puts the new value there, and reuses everything else untouched.
- Copying starts at the first shared level, not always the root. Once that level is copied, the old one still points at its children, so they must be copied too, down to the target.
- A shallow copy is a new runtime-owned container and carries no metadata from its source. Its mirrors and counters are created for its own world as needed.
- Reused imported children remain imported; other reused tracked children are marked shared. Whichever side writes first copies again.
- It copies a path, not a graph. If `root.self === root`, changing `root.a` gives a new root whose `self` still points at the original.
- A copied Promise key gets a fresh mirror at the copier's program position, so the two worlds diverge exactly there. Creating it later would seed from the raw settled value and drop writes issued before the copy.

## Language Data

- Language data is own enumerable string keys only; symbols, non-enumerables, and prototypes are outside the graph.
- Define a missing key as an own data property so inherited setters, notably `__proto__`, never participate in a write.

## Errors

- Language Errors are data. A rejected data Promise becomes an Error value in the graph; each observation then exposes it by its own contract, while mutations return nothing.
- Kernel failures are not data. Invariant violations, contract violations, and unexpected throws go through `reportFatalError`, which reports and rethrows.
- Never convert a kernel failure into a language Error, or a rejected data Promise into a fatal.
