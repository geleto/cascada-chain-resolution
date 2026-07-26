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
- Invoke a continuation in the source Promise's single reaction; an intermediate proxy would fragment its FIFO batch.
- Never defer part of a transition with `await`, another `.then`, `queueMicrotask`, or lazy registration.

## Promise Mirrors

- A mirror stands for one version of one property. Assigning again, even the same Promise, makes a new mirror.
- A mirror is live only while the parent's mirror map holds that exact instance.
- While it is live, the value lives in the property itself, including a writable imported Promise property whose settlement import hands to the runtime. Once detached, the value lives in `detachedValue`.
- Replacing or deleting the property detaches the old mirror. Operations that already captured it keep working against its private state.
- Each operation that reaches a pending property registers a resolver at its own program position. A settling Promise changes nothing on its own; state changes only when the first resolver completes its transition.
- Later resolvers ignore the settled payload and work from the latest state earlier resolvers left.

## Ownership

- A non-shared language value has one owner and may be mutated in place.
- Import marks an external boundary on the value; it does not create a second language owner.
- Reusing a value in another variable/property must go through lookup, which marks it shared by default.
- Pass `sharedOwnership: false` only for a pure read, or when ownership is ceded to the caller.
- Shared or imported data is protected by copy-on-write; mutation must not affect another owner or external data.

## Copy-on-Write

- Language mutation never changes a shared or imported node in place. It shallow-copies each level along the path down to the changed spot, puts the new value there, and reuses everything else untouched.
- Copying starts at the first shared level, not always the root. Once that level is copied, the old one still points at its children, so they must be copied too, down to the target.
- Reused children are marked shared, because two worlds now point at them. Whichever side writes first copies again.
- It copies a path, not a graph. If `root.self === root`, changing `root.a` gives a new root whose `self` still points at the original.
- A copy carries only own enumerable keys, so no metadata comes across. Its mirrors, import boundaries, and counters are rebuilt for its own world, and the new path is owned again.
- A copied Promise key gets a fresh mirror at the copier's program position, so the two worlds diverge exactly there. Creating it later would seed from the raw settled value and drop writes issued before the copy.

## Language Data

- Language data is own enumerable string keys only; symbols, non-enumerables, and prototypes are outside the graph.
- Define a missing key as an own data property so inherited setters, notably `__proto__`, never participate in a write.

## Errors

- Language Errors are data. A rejected data Promise becomes an Error value in the graph; each observation then exposes it by its own contract, while mutations return nothing.
- Kernel failures are not data. Invariant violations, contract violations, and unexpected throws go through `reportFatalError`, which reports and rethrows.
- Never convert a kernel failure into a language Error, or a rejected data Promise into a fatal.
