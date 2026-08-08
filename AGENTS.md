# Core Runtime Contracts

## Contract

Cascada operations on an asynchronously available graph produce the same results as if every value were already available and the operations ran sequentially. Every transition includes all earlier effects and no later ones. Mutation through one owner never changes another owner's logical value, and imported data is never modified.

Calling an operation never blocks. Its result may wait only for captured logical versions, the Promise frontier they expose, and a Promise produced by the operation itself—never for unrelated graph data.

## Design Method

Build behavior from four core mechanisms: synchronous progress, FIFO Promise continuations, versioned mirrors, and copy-on-write ownership. Derive new behavior from them before adding state or another path.

Public results and effect order, ownership and import isolation, host boundaries, and the boundary between language Errors and fatal failures are contracts. Metadata layout, helper boundaries, and the choice among valid refcount projections and their resulting counter totals are mechanisms. A mechanism may change only when every contract and invariant it enforces remains true.

- Prefer one general transition over parallel paths, flags, adapters, or deferred cleanup. Split only when the cases differ in observable behavior or a required invariant, and remove a superseded path in the same change.
- Keep facts at their natural scope: identity facts on identities, property-version facts on mirrors, parent-key placement facts on placements, and operation facts within the operation.
- Derive a fact where it is used. Persist it only when it cannot be recovered correctly or repeated derivation has a demonstrated material cost, and then at the narrowest scope that can keep it correct.
- Cascada does not expect unusually large or deep graphs. Keep recursive walks and Number arithmetic; do not introduce explicit stacks or BigInt.

## Work Bounds

These constrain implementation cost, not observable semantics. Exceeding them is a defect; a mechanism that inherently exceeds them should be replaced.

- Bound graph-dependent work and allocation to data selected by an operation's explicit input or path, its produced output, captured Promise frontier, and dependencies it must maintain. Do not process unrelated graph data.
- Build an index when a component first needs one, then maintain it incrementally. Never rescan indexed data to rediscover a maintained fact.
- Rescan admitted data only to reconcile changes made outside runtime transitions, and only where the operation reaches it. Each import visits every reached identity at most once, retains its first import boundary, and reconciles changed placements through the same dependency transitions as runtime writes.

Cycle cuts are a bounded exception because they stop counter propagation. When counters cannot answer a query, an operation may traverse the counter-selected cut region; all such walks within that operation share one visited set and visit each identity at most once. A separate pass may build a missing index.

## Ordering

- Process all available work synchronously and in program order.
- Register on a pending property only when, and exactly where, the operation depends on it. Structural discovery alone does not make the operation a consumer.
- Route every registration through the Promise helpers; raw `.then` belongs only inside them. The helpers canonicalize each callable thenable once, and every continuation registers directly on that native Promise.
- Registrations made before settlement form one FIFO batch. Each continuation completes its transition synchronously; never split one with `await`, another `.then`, `queueMicrotask`, or lazy registration.

If three operations reach one pending property, the first resolver publishes `V`, the second observes `V` and may leave `V'`, and the third observes `V'`. Each sees every earlier effect and no later one.

## Promise Versions

- A mirror represents one logical property version. Every Promise placement creates a new mirror, even for the same Promise; distinct properties and versions never share one, even when they share physical storage.
- A live mirror determines logical presence and value. Physical writeback may keep a live runtime-owned property current, but correctness never depends on it. Imported and detached versions remain mirror-only; an imported property retains its external Promise while its resolved logical value lives in the mirror.
- Replacing or deleting a property detaches its mirror. The mirror then keeps that version's latest value for operations that already captured it.
- Settlement alone changes no language state. The first resolver advances the version within its transition; later resolvers ignore the settlement payload and continue from the state earlier resolvers left.

## Language Graph

- Language data consists only of own enumerable string-keyed properties. Symbols, non-enumerables, and prototypes are outside the graph.
- Define a missing key as an own data property so inherited setters, notably `__proto__`, never participate in a write.
- The graph may be cyclic. Auxiliary bookkeeping must neither alter nor hide its topology.
- Refcounting maintains an acyclic projection by cutting parent-key placements. Cuts affect bookkeeping only, not the graph or observable behavior. Their placement and resulting counter totals may depend on construction history and need not be canonical.

## Data Types

Admission classifies an available identity when it first enters runtime bookkeeping. Resolve callable thenables through their captured versions before admitting their values. Classification precedence is Error, logical Array, Function, record, registered instance, then opaque instance; primitives use their primitive category. Array and Promise subclasses retain Array and Promise semantics even if registered.

A controlled method is runtime code that consumes logical Cascada values. A host call invokes native or user JavaScript across the export/import boundary. An opaque instance is an unregistered class or intrinsic identity whose hidden state Cascada does not traverse.

| Type | Supported execution | Boundary | Property writes |
| --- | --- | --- | --- |
| Plain or null-prototype record | Own function-valued properties, observation only; no inherited methods | Host call with exported arguments and no record receiver | Ordinary language writes |
| Logical Array | Supported standard methods reproduce native observable behavior in matching mode; overrides are observation-only | Standard methods are controlled; overrides receive an exported native Array | Ordinary language writes |
| String | Native observations only | Host call on the primitive | Unsupported |
| Registered instance | Side-effect-free observations and synchronous whole-unit mutations | Host call on a host-ready, prototype-preserving receiver | Atomic whole-unit transition |
| Opaque instance | Observations only on the exact identity; may read intrinsic state, as `Date.prototype.getTime` does, but not depend on or mutate ordinary properties | Host call on the exact receiver | Host-ready write only while exclusively runtime-owned |
| Function | May be stored in a record; executable only in an explicitly supported function, method, or callback position | Defined by that executable position | Not a property container |
| Number, Boolean, BigInt, Symbol, `null`, or `undefined` | None | Not applicable | Unsupported |
| Promise | None; resolve its captured version, then classify the result | Not applicable | Not a property container |
| Error | None; see Errors | Not applicable | Not a property container |

## Ownership and Copy-on-Write

An owner is a Cascada placement or retained result that can independently preserve a logical identity. Placements inside a registered unit belong to that unit rather than becoming separate owners. Sharing and leasing protect logical values, not raw physical storage.

- For ordinary data, classify the property container and stored value independently: the container determines whether Cascada may write the property; a stored identity carries its own import, sharing, and lease state. A registered instance instead owns its complete semantic state as one unit.
- External identities enter through import. Creating a Chain preserves existing admission, import, and ownership state; it does not imply import.
- Imported data is borrowed, always shared, and never modified. Metadata and logical Promise settlement remain outside it.
- Import status belongs to each admitted ownership unit—an ordinary identity or a registered unit root. Containment alone neither grants nor removes it.
- Cascada never creates non-extensible language data. Non-extensibility therefore has no special semantics: when encountered through import, the ordinary no-write rule already covers it.
- An ordinary admitted identity or registered unit that is neither imported, shared, nor leased has one owner and may be mutated in place.
- Giving an ordinary identity another owner marks it shared. Registered units share as a whole, while descendants follow the copy-out rule below. A pure read adds no owner; an ownership transfer ends the previous ownership instead.
- A pending observation or open read-only entry leases the logical value it captured. Sharing is permanent; a lease ends with the operation.

### Representation and copying

- An observation or mutation may change runtime-owned representation, including Array backing, when its logical result is correct and every protected value remains logically unchanged. A raw host reference may therefore observe backing length change while fixed ArrayView bounds preserve every Cascada value.
- Reuse representation whenever those conditions hold; copy or materialize only when reuse would change a protected value or the storage is imported.
- Imported storage never serves as mutable ArrayView backing. Before runtime-owned backing becomes imported, detach dependent representations onto runtime-owned storage.
- Aliasing, multiplicity, and cycles within one ownership unit do not themselves require copying or create more owners.
- Ordinary copy-on-write shallow-copies from the first path node that must be preserved down to the target, because the old path still references every reused child. It copies a path, not a graph: off-path children are reused, so a copied `root` whose `root.back === root` still points `back` to the previous root.
- A copy reads each property's logical value, never its physical slot, and creates a runtime-owned path with no source metadata. Reused imported children stay imported; other reused identities become shared when both owners retain them.
- A copied Promise placement gets a fresh mirror at the copier's program position, so both property versions diverge there. Registered instances use the whole-unit rule below instead of path copying.

## Execution Boundaries

- Every call resolves its receiver and every explicit argument for Error propagation. A controlled method otherwise resolves only the nested data it consumes and may return an internal representation such as an ArrayView.
- A controlled callback receives only the logical values its method declares and must be synchronous, read-only, and non-retaining.
- Invoke a record function without the record as its receiver. It may use explicit arguments and read-only host state, but must not read or mutate its containing record or other Cascada graph state.
- Controlled methods avoid copying and materialization where possible. A special path must provide a material benefit and preserve every logical value.
- Host arguments are exported. Host code receives no internal representation or unresolved language Promise introduced by Cascada; a snapshot captures logical values at the operation's program position, and later mutation cannot change it.
- Admit results by origin: import new host and snapshot identities; keep controlled results runtime-owned. An exact unsnapshotted identity retains its origin wherever the result contains it, and normal sharing applies if the result adds an owner. Import records an opaque identity without traversing hidden state.
- Host code must not mutate an exact unsnapshotted receiver or opaque argument. It may retain an exact receiver, opaque argument, or Function only through its result or until its returned Promise settles. Lease every exact runtime-managed identity for that interval; detached retention is a host contract violation.
- Resolve all explicit arguments even after finding an Error. Collect each distinct original Error consumed during receiver and argument preparation; preserve receiver-then-argument order independently of settlement order. Errors within one composite input have no separate order.
- If preparation finds an Error, do not invoke a getter, callback, method, override, or mutator, and leave a mutation receiver unchanged. An Error nested in composite data remains data until required preparation or behavior reaches it.

## Registered Instances

- Register a class before any instance is admitted. Registration is not retroactive, and an identity's classification is fixed at first admission.
- All semantic state must be rooted in own enumerable string-keyed properties. Private fields, internal slots, accessors, Symbols, non-enumerables, and closure state must not affect behavior.
- Semantic state may contain primitives, Errors, records, logical Arrays, and nested registered instances. A Promise contributes only its resolved value. Functions and opaque identities are invalid state because whole-unit copying cannot isolate them.
- A runtime-owned instance exclusively owns the complete graph rooted in its semantic properties; nested registered instances belong to the enclosing unit. No state identity may have an owner outside that unit.
- Import, sharing, leasing, and copy-on-write apply to the whole unit. Assigning state copies or transfers it into the unit; extracting a descendant copies it out unless the unit relinquishes it; returning the receiver shares the whole unit.
- A property write or method mutation transitions the instance at its containing placement. Pending preparation installs the ordinary Promise version there, so later unit access resumes in FIFO order.
- Before host invocation, settle and export the complete state graph into a host-ready, prototype-preserving receiver. An observation receives an isolated snapshot and is side-effect-free; a mutation receives an exclusively owned unit version. Preparation failure restores the prior unit version.
- A mutation completes and reconciles all state changes synchronously through the ordinary property-version transitions before publication. It must return with admissible, fully resolved state and may neither install Promise state nor continue mutating asynchronously. A returned Promise delays only the independent result: publish the unit before waiting, then lease it until settlement because the result may retain the receiver or its state.
- A whole-unit copy preserves prototype, aliases, and cycles, but shares no mutable semantic-state identity with the preserved unit. Error identities remain immutable terminal data.

## Errors

- Classify a failure by the layer that failed and the valid outcome it can publish, not by whether it was thrown or returned. A failure of the requested language operation follows the language and API rules below; a failed runtime mechanism or declared internal or host contract is fatal.
- When a language transition must publish a logical value but cannot produce it, publish an Error at that value. This includes invalid values or property conditions and synchronous failures from user-controlled accessors, coercions, callbacks, selected methods, and Proxy or reflection hooks.
- Catch user-controlled execution only at its exact boundary. Entering it through `run` does not make adjacent Cascada transition code user-controlled. Never convert a runtime failure into data or a language failure into a fatal one.
- A synchronous host throw after mutation becomes the call's Error result without erasing valid effects already completed.
- A mutation without an independent result channel publishes its Error at the nearest replaceable logical value whose transition failed. An independent result failure does not poison a receiver whose mutation completed validly.
- Public API transport is separate from graph poisoning. A ready language failure returns its Error instead of throwing. An operation that returned a Promise may reject it with its asynchronous failure, final Error, or aggregate; a directly returned host Promise preserves its rejection reason. Do not fulfill an API Promise with an Error merely to normalize synchronous and asynchronous results.
- A rejected Promise stored in the graph still publishes an Error at its captured version, even when an API operation waiting on it rejects its own result Promise.
- No consumed Error is lost. One propagates unchanged; several travel together in an Error's `errors` array. Unrelated work continues.
- Fatal failures go through `reportFatalError`, which reports and rethrows. A representation limitation must first fall back or materialize; a lower-level assertion is fatal only if that required handling failed.

## Verification

- Prefer integration tests through public operations, covering observable sequential behavior and owner isolation across meaningful synchronous and Promise interleavings.
- Use focused unit tests only when integration tests cannot precisely verify a load-bearing invariant. Never pin an interchangeable representation; that turns accidental structure into a contract and obstructs simplification.
