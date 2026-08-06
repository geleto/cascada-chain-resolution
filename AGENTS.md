# Core Runtime Contracts

## Contract

Cascada operations on an asynchronously available graph produce the same results as if every value were already available and the operations ran sequentially. Every transition includes all earlier effects and no later ones. Mutation through one owner never changes what another owner sees, and imported data is never modified.

Issuing a command never blocks. Its result may wait only for pending dependencies captured at that command's program position, never for the whole graph.

## Method

Keep the runtime built from four core mechanisms: synchronous progress, FIFO Promise continuations, versioned mirror state, and copy-on-write ownership. Derive new behavior from these before adding state or a code path.

The observable contracts are fixed; mechanisms are not. Public results and effect order, ownership and import isolation, exact receivers exposed to opaque host calls, and the boundary between language Errors and fatal failures are observable contracts.

Metadata layout, helper boundaries, and the choice among valid refcount projections and their resulting counter totals are implementation choices. Replace a mechanism only when every guarantee it enforces remains true.

- Prefer one general transition over parallel paths, flags, adapters, or deferred cleanup. When a general mechanism supersedes a specific one, delete the specific one in the same change.
- Use separate paths only when one general transition cannot preserve an observable contract or runtime invariant.
- Keep each fact at the scope it describes: identity facts on identities, property-version facts on mirrors, placement facts on placements, and per-operation facts within the operation.
- Derive a fact where it is needed. Persist it only when it cannot be recovered correctly, or repeated derivation has a demonstrated material cost; store it at the narrowest scope that can keep it correct.
- Cascada does not expect unusually large or deep graphs. Keep recursive walks and Number arithmetic; do not introduce explicit stacks or BigInt.

## Work Bounds

These constrain implementation cost, not observable semantics. Exceeding them is an implementation defect; a mechanism that inherently exceeds them should be replaced.

- Bound graph-dependent work and allocation to data selected by an operation's explicit input or path, its produced output, its captured Promise frontier, and affected dependencies that must be maintained. Do not otherwise process unrelated graph data.
- Build an index when a component first needs one, then maintain it incrementally as the graph changes. Never rescan indexed data to rediscover a maintained fact.
- Rescan previously admitted data to detect untracked changes only when it may have changed outside maintained runtime transitions, and only where the operation reaches it. Import may therefore rescan each previously known identity it reaches at most once per import to discover newly exposed Promise placements.

Cycle cuts are a bounded exception. Because they stop counter propagation, an operation may traverse a counter-selected cut region when maintained counters cannot answer it. It must visit each identity at most once per operation.

## Ordering

- Do all available work synchronously, in program order.
- Register an operation on a pending property only when, and exactly where, it depends on it. Structural discovery alone does not make the operation a consumer.
- Route every registration through the runtime's Promise helpers. Raw `.then` belongs only inside them.
- The helpers canonicalize each callable thenable once; every continuation for one source registers on the same native Promise.
- Invoke every continuation registered before settlement in one reaction on that canonical Promise, forming one FIFO batch.
- Each continuation completes its transition synchronously. Never split one with `await`, another `.then`, `queueMicrotask`, or lazy registration.

If three operations reach one pending property, the first resolver publishes `V`, the second observes `V` and may leave `V'`, and the third observes `V'`. Each sees every earlier effect and no later one.

## Promise Versions

- A Promise mirror represents one logical property version. Every Promise placement creates a new version, even for the same Promise.
- Distinct property versions and distinct logical properties never share a mirror, even when they share physical storage.
- Mirror state is authoritative for graph operations; they never depend on physical writeback.
- Advancing a live runtime-owned version also writes the value physically because an opaque host method can observe that property. Imported and detached versions remain mirror-only.
- An imported Promise property retains its external Promise; its resolved logical value lives in the mirror, not the property.
- Replacing or deleting a property detaches its mirror, which then stores that version's latest value as private state. Operations that already captured the version continue from it.
- Settlement alone changes no language state. The first resolver advances the version as part of its transition; later resolvers ignore the payload and continue from the state earlier resolvers left.

## Ownership

- Classify a property container and its stored value independently. The container determines whether Cascada may write the property; the value's identity determines whether it is imported or shared.
- External values must enter through import; creating a Chain only preserves existing ownership and import status.
- Imported data is borrowed and never modified. All runtime state, including metadata and logical Promise settlement, lives outside it.
- A non-shared tracked identity has one owner and may be mutated in place.
- Extracting an existing tracked identity adds another owner and makes it shared. A temporary read does not; an ownership transfer ends the prior ownership instead.
- Import status belongs to identities, not paths. Containment transfers it in neither direction.

## Copy-on-Write

- Mutation never changes a shared or imported node in place. Copying starts at the first node that must be preserved and continues to the target because the old path still references every reused child.
- A copy-on-write copy reads each property's logical value, never its physical slot.
- A shallow copy is runtime-owned and carries no metadata from its source.
- Reused imported children remain imported; other reused tracked children become shared.
- Copy-on-write copies a path, not a graph. If `root.self === root`, changing `root.a` creates a root whose `self` still points at the original.
- A copied Promise property gets a fresh mirror at the copier's program position, so both property versions diverge there.

## Language Graph

- Only own enumerable string keys belong to language data. Symbols, non-enumerables, and prototypes are outside the graph.
- Define a missing key as an own data property so inherited setters, notably `__proto__`, never participate in a write.
- Cascada never creates non-extensible language data. Such data is imported and has no special runtime semantics.
- The language graph may be cyclic. Auxiliary bookkeeping must neither alter nor hide its topology.
- Refcounting maintains an acyclic projection by cutting property placements. A cut affects bookkeeping only: it neither modifies the graph nor changes what operations observe.
- The projection need not be canonical; valid cut placement and resulting counter totals may depend on construction history.

## Opaque Host Methods

- Controlled intrinsics read logical graph properties. A trusted ordinary method is opaque host code: Cascada resolves its receiver path and exported arguments, then invokes it with the resolved receiver directly as `this`. An internal ArrayView first materializes, and the resulting native Array is `this`.
- Property reads inside the method are synchronous JavaScript reads, not Cascada observations. They do not discover, register on, or wait for nested Promises. Runtime-owned writeback may therefore be visible, while an imported receiver retains its original physical properties.
- The method must be read-only, non-retaining, and side-effect-free. If invocation is pending, later Cascada mutation must preserve the captured receiver.

## Errors

- Language Errors are data. A rejected data Promise becomes an Error value in the graph; each observation exposes it by its own contract, while mutations return nothing.
- Kernel failures are not data. Invariant violations, contract violations, and unexpected throws go through `reportFatalError`, which reports and rethrows.
- Never convert a kernel failure into a language Error, or a rejected data Promise into a fatal.

## Verification

- Prefer integration tests through public operations, covering observable sequential behavior and owner isolation across meaningful synchronous and Promise interleavings.
- Use focused unit tests only when integration tests cannot precisely verify a load-bearing invariant. Never use them to pin an interchangeable representation; doing so turns accidental structure into a contract and obstructs simplification.
