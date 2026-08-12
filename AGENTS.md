# Core Runtime Contracts

## Core Contracts

- **Sequential equivalence.** Operations on an asynchronously available graph produce the same observable results and effects as if every value were already available and the operations ran sequentially. Every transition includes all earlier effects and no later ones.
- **Owner isolation.** Mutation through one owner never changes another owner's logical value; aliases of an explicitly mutated opaque object deliberately share that exact external state.
- **Imported-data protection.** Imported data is never modified, except when an explicitly requested mutation on an opaque object operates on that exact external object.
- **Non-blocking issuance.** An operation processes available work and returns a value or Promise. A returned Promise need not settle before the next operation is issued.

## Design Method

### Core mechanisms

Four mechanisms preserve these contracts:

- **Synchronous progress** runs every available part of an operation immediately.
- **FIFO Promise continuations** preserve program order when pending work resumes.
- **Versioned mirrors** preserve the exact property version an operation captured.
- **Copy-on-write ownership** preserves logical values held by other owners or active leases.

Derive new graph behavior from these mechanisms before adding state or another path.

### Implementation discipline

The Core Contracts and the data-type capabilities, execution boundaries, and Error/fatal classification below are contracts. Metadata layout, helper boundaries, and valid refcount projections and counter totals are implementation choices. They may vary as long as every affected contract and invariant remains true.

- Prefer one general transition over parallel paths, flags, adapters, or deferred cleanup when the cases share the same state change. Split only when their observable behavior or required invariants differ, and remove a superseded path in the same change.
- Keep facts at their natural scope: identity facts on identities, property-version facts on mirrors, parent-key placement facts on placements, and operation facts within the operation.
- Derive a fact where it is used. Persist it only when it cannot be recovered correctly or repeated derivation has a demonstrated material cost, and then at the narrowest scope that can keep it correct.

## Language Graph

- **Inside the graph:** Root values and values reachable through property placements. A placement is a logical `(container, key)` location holding one property version; a JavaScript property is only its ordinary physical representation. Ordinary placements use own enumerable string-keyed data properties, while ArrayView placements may share projected backing storage.
- **Array structure:** Present elements and enumerable named properties are placements; logical length and holes affect Array behavior but are not placements.
- **Outside the graph:** Symbols, non-enumerable and inherited properties, and prototypes do not form property placements and are not traversed as graph data.
- Creating a missing graph placement defines an own enumerable, writable, configurable data property; it never follows the prototype chain.
- An own non-placement, such as a non-enumerable property or unsupported accessor, is logically absent. Ordinary graph access neither invokes nor redefines it; class-defined accessors run only through their registered-class boundary.
- A final read of an absent placement returns `undefined`. Traversing through an absent or `undefined` placement produces an Error, while reaching an Error propagates that same Error without replacing it.
- Final assignment creates an absent placement, and final deletion of one is a no-op. A mutation that requires an absent receiver or intermediate placement poisons that first failed placement.
- The graph may be cyclic. Auxiliary bookkeeping must neither alter nor hide its topology.
- Refcounting maintains an acyclic projection by cutting parent-key placements. Cuts affect bookkeeping only, not the graph or observable behavior. Their placement and resulting counter totals may depend on construction history and need not be canonical.

## Data Types and Capabilities

Any Cascada value—and therefore any graph root or property—may be a Promise. Pending and resolved values use the same logical value path: an operation uses an available value immediately or registers at the captured version and continues with the resolved value. A Promise represents asynchronous availability, not a separate data category or a mechanism limited to transition gates.

Admission is the first classification of an available identity. Resolve callable thenables through their captured versions before admitting their values. A synchronous failure while acquiring or invoking `then` is that captured Promise's rejection unless it is already fatal. Classification precedence is Error, logical Array, Function, record, instance of a registered class, then opaque instance; primitives use their primitive category. Array and Promise subclasses retain Array and Promise semantics even if registered.
An object that cannot be inspected for classification is admitted unchanged as opaque.

A controlled method is runtime code that consumes logical Cascada values. A host call invokes native or user JavaScript across the export/import boundary. An opaque instance is an instance of an unregistered class or another intrinsic identity kept exact and not traversed.

| Type | Supported execution | Boundary | Property writes |
| --- | --- | --- | --- |
| Plain or null-prototype record | Own function-valued properties, observation only; no inherited methods | Host call with exported arguments and no record receiver | Ordinary language writes |
| Logical Array | Supported standard methods reproduce native observable behavior in matching mode; overrides are observation-only | Standard methods are controlled; overrides receive an exported native Array | Ordinary language writes |
| String | Native observations only | Host call on the primitive | Unsupported |
| Instance of a registered class | Side-effect-free observations and synchronous whole-unit mutations through methods or class-defined accessors | Host call on a host-ready, prototype-preserving receiver | Atomic whole-unit transition |
| Opaque instance | Observations and explicit mutations on the exact identity; behavior may use its ordinary and hidden host state | Host call on the exact receiver; observations may overlap, while mutations form ordering barriers | Host-ready write on the exact object, ordered with its method calls |
| Function | May be stored in a record; executable only in an explicitly supported function, method, or callback position | Defined by that executable position | Not a property container |
| Number, Boolean, BigInt, Symbol, `null`, or `undefined` | None | Not applicable | Unsupported |
| Promise | No direct execution; resolve its captured version, then use the result's capabilities | Determined by the resolved value | Determined by the resolved value |
| Error | None; see Errors | Not applicable | Not a property container |

## Ownership and Copy-on-Write

An owner is a placement or retained result that can independently preserve a logical value. A value is **protected** when mutation must leave its current logical state available unchanged.

### Protection

- A COW-managed value is protected exactly while it is shared permanently or leased temporarily; otherwise it may be mutated in place. Explicit opaque mutations are ordered effects on an external identity, not COW.
- Reading without retaining or exposing an identity adds no owner. Any transition that retains the same identity for another owner marks its ownership unit shared; this includes import, lookup, COW reuse, and retained operation results. An ownership transfer instead ends the previous ownership.
- Import adds no other COW condition.
- An instance of a registered class and its complete semantic state graph form one atomic ownership and COW unit. Its internal placements are not separate owners; sharing and leasing protect the whole unit.

### Copying and representation

A logical value is what Cascada operations observe; its physical representation is the storage used to realize it. COW leaves a protected logical value unchanged and gives the mutating owner a new version.

- For ordinary language data, protection belongs to the stored identity while permission to replace a placement belongs to its container. A path mutation considers both independently.
- Ordinary COW builds the mutating owner's new value by shallow-copying each level from the first protected container down to the changed spot, applying the change there, and reusing every off-path value unchanged. It copies a path, not a graph.
- Each new path node starts runtime-owned, unshared, and unleased. It is populated by reading each property's logical value, never its physical slot, and carries no source metadata. Reused children retain their identity facts and become shared when both owners retain them.
- Writability, configurability, and extensibility constrain physical storage, not the logical graph. When an otherwise valid transition cannot use its current representation—including because an own non-placement occupies the key—materialize normal runtime-owned storage that omits non-placements and retry. Copy outward along the path as needed to publish it; never invoke or redefine the blocker.
- A protected registered-class unit is copied as a complete prototype-preserving state graph rather than as a property path; the new unit starts exclusively owned.
- Runtime-owned representation may be reused or changed whenever every protected logical value remains unchanged. Array backing may therefore grow visibly through a raw host reference while fixed ArrayView bounds preserve every Cascada value. Copy or materialize only when reuse would change a protected value.
- Aliasing, multiplicity, and cycles within one ownership unit do not create more owners or by themselves require copying.
- Assignments capture the right-hand value before mutating the left-hand path. In `x.self = x`, the lookup retains the original `x` for the new placement and marks it shared; the assignment therefore copies `x` and stores the original in the copy: `newX.self === oldX`, not `newX.self === newX`. Ordinary Cascada assignments link to captured versions rather than create new graph cycles; new cycles may enter through imported host data or supported host execution inside a registered-class whole-unit mutation.
- A copied Promise placement gets a fresh mirror at the copier's program position, so both property versions diverge there.

## Import and External Data

- Import admits host-owned data, records its external origin, and reconciles the reached graph even when an identity was already admitted. Creating a Chain preserves existing admission, import, and ownership state; it does not imply import.
- Host changes to traversable imported storage enter the language graph at reimport. Reimport changed data before another Cascada operation accesses it.
- Import belongs to each admitted ownership unit—an ordinary identity or a registered-class unit root. Containment alone neither grants nor removes it.
- Imported physical storage is borrowed and never modified. Metadata and logical Promise settlement remain outside it. An explicitly requested opaque mutation is the sole exception: it intentionally changes ordinary properties or hidden or intrinsic state on that exact external object.
- Cascada never creates non-extensible language data. Such data must enter through import. The imported no-write rule is sufficient; do not infer import from non-extensibility or add frozen-specific behavior.
- Imported storage never serves as mutable ArrayView backing. Before runtime-owned backing becomes imported, detach dependent representations onto runtime-owned storage.

## Pending Work: Leases and Transition Gates

Pending work either needs to keep observing a stable value while later mutation continues, or leaves a mutation unfinished so later access must wait. These require different mechanisms:

- A **lease** is temporary COW protection for an exact logical value still in use. It never delays later operations; a later mutation copies, and the lease ends when its operation completes or fails. Read-only entry and pending host use of an exact runtime-managed value require leases.
- A **transition gate** preserves ordering when a mutation cannot publish its final value synchronously. It does not preserve the old published value; it makes the placement's next version pending and keeps the captured or working value private. Install an ordinary Promise version there before leaving the transition. Later operations wait at that placement and resume through its normal mirror and FIFO continuations. A ready mutation needs no gate.
- Ordinary pending mutation preparation gates only its final target while required values such as its receiver or arguments resolve. A mutating `enter` deliberately keeps the entered transition open, so its gate remains until the callback and its private commands finish.
- A Promise that represents only an independent operation result is not a transition gate. Publish completed state immediately; lease it only if the pending result may still retain or observe it.
- Replacing one placement with a Promise cannot serialize an opaque identity because another alias would bypass it. Per-identity ordering provides the corresponding barrier for external effects.

## Synchronous and Promise Ordering

An operation is one issued command. A transition is one synchronous unit of work within an operation or Promise continuation. A program position locates a capture or registration in sequential operation order; an operation's Promise frontier contains the pending versions required by its selected work.

- Process all available work synchronously and in program order.
- Register on a pending property only when, and exactly where, the operation depends on it. Structural discovery alone does not make the operation a consumer.
- Canonicalize a thenable only when Cascada needs FIFO ordering among continuations on that source: to advance or consume a captured version, resume or finish a transition, or run settlement bookkeeping before later Cascada use. Route every such registration through the Promise helpers; raw `.then` belongs only inside them. Returning a Promise or thenable alone never canonicalizes or replaces it.
- Registrations made before settlement form one FIFO batch. Each continuation completes its transition synchronously; never split one with `await`, another `.then`, `queueMicrotask`, or lazy registration.

If three operations reach one pending property, the first resolver publishes `V`, the second observes `V` and may leave `V'`, and the third observes `V'`. Each sees every earlier effect and no later one.

## Promise Mirrors and Versions

A property version is the exact logical state captured at one placement. A mirror tracks a Promise-backed version as it changes or resolves.

- Every Promise placement creates a new mirror, even for the same Promise; distinct properties and versions never share one, even when they share physical storage.
- A live mirror determines logical presence and value. Physical writeback may keep a live runtime-owned property current, but correctness never depends on it. Imported and detached versions remain mirror-only; an imported property retains its external Promise while its resolved logical value lives in the mirror.
- Replacing or deleting a property detaches its mirror. The mirror then keeps that version's latest value for operations that already captured it.
- Settlement alone changes no language state. The first resolver advances the version within its transition; later resolvers ignore the settlement payload and continue from the state earlier resolvers left.

## Errors

Cascada distinguishes two kinds of failure:

- **Error poisoning.** An Error is language data. Invalid logical inputs or transitions and synchronous failures from supported user code produce it. An Error assigned to a placement or returned as a logical result becomes that value; a rejected Promise stored in the graph publishes an Error at its captured version. Dependent work propagates it, while unrelated work continues.
- **Fatal failure.** An unexpected failure in a runtime mechanism is normally a runtime bug; a violated internal or host contract is also fatal. It goes through `reportFatalError`, which reports and rethrows.

- Classify failure at its exact boundary by what failed, not whether code threw or returned. Catch supported user code only there; entering it through `run` does not make adjacent runtime code user-controlled. A physical representation limitation is not itself a failure: materialize and retry, and treat failure of that required handling as fatal. Never convert between poisoning and fatal failure.
- A poisoned observation affects only the operation outcome. A poisoned mutation replaces the nearest replaceable logical value whose transition failed and is also the operation outcome.
- For a mutating call, that value is the receiver placement or root; poisoned preparation or a synchronous mutator throw poisons it. Poison confined to an independent result does not affect a successfully mutated receiver.
- Return the produced result unchanged: a value or Error directly, and a Promise or thenable with its original fulfillment or rejection. If producing the result was already pending, the existing operation Promise adopts it. An operation whose contract consumes Errors instead produces its normal result; result rejection does not poison the graph.
- No consumed Error is lost: one propagates unchanged; several produce an Error whose `errors` array contains every distinct original. Call errors follow receiver-then-argument order, independent of settlement; errors within one composite input are unordered.
- Poisoning an opaque mutation replaces its targeted Cascada placement or root but cannot undo effects already made to the exact external identity; other aliases still observe them.

## Execution Boundaries

- Prepare each call input only to the extent its selected boundary consumes it. Continue required preparation after an Error to collect the rest, but do not invoke the selected function, accessor, callback, or method. Nested Errors participate only when required preparation or behavior reaches them.
- Host calls export and therefore consume every explicit argument. A controlled method resolves only the data it consumes; a payload it merely retains stays unchanged, including an Error or Promise. A rejected retained Promise poisons its eventual placement, not the call that retained it. Controlled methods may return internal representations such as ArrayViews.
- A controlled callback receives only the logical values its method declares and must be synchronous, read-only, and non-retaining.
- Invoke a record function without the record as its receiver. It may use explicit arguments and read-only host state, but must not read or mutate its containing record or other Cascada graph state.
- Controlled methods avoid copying and materialization where possible. A special path must provide a material benefit and preserve every logical value.
- Host arguments are exported. Host code receives no internal representation or unresolved language Promise introduced by Cascada; traversable values become snapshots, while opaque identities and Functions remain exact. A snapshot captures logical values at the operation's program position, and later mutation cannot change it.
- Admit results by origin: import new host and snapshot identities; keep controlled results runtime-owned. An exact unsnapshotted identity retains its origin wherever the result contains it, and normal sharing applies if the result adds an owner. Import records an opaque identity without traversing its state.
- A host observation must not mutate an exact receiver or opaque argument. A host mutation may mutate only its designated receiver; ordinary arguments remain read-only.
- Every host use of an opaque identity is ordered per identity. The ordering state belongs to the identity, not a Chain or placement, so every alias shares it. Observations, including use as an argument, wait for the preceding mutation but not for one another; a mutation waits for every preceding operation. A write resolves and exports its value before touching the object.
- Host code may retain an exact receiver, opaque argument, or Function only through its result or until its returned Promise settles. Mutation after that interval is a host contract violation. Independently retained external references to an imported opaque object remain outside Cascada's ordering guarantees.
- Host calls, controlled callbacks, and reflection hooks must not issue Cascada operations before returning; synchronous reentry is a host contract violation. Trusted runtime control-flow callbacks such as `enter` follow their own transition contracts instead.

If mutation `M1` is pending, following observations `O1` and `O2` wait for `M1` and may then overlap; following mutation `M2` waits for both observations. The same order holds through every alias.

## Instances of Registered Classes

- Register a class before any of its instances is admitted. Registration is not retroactive, and an identity's classification is fixed at first admission.
- All semantic state must be rooted in own enumerable string-keyed data properties. Private fields, internal slots, Symbols, non-enumerables, closure state, and own accessor descriptors are invalid state. Class-defined accessors may observe or mutate only the enumerable state and follow the same whole-unit boundaries as methods.
- Semantic state may contain primitives, Errors, records, logical Arrays, and nested instances of registered classes. A Promise contributes only its resolved value. Functions and opaque identities are invalid state because whole-unit copying cannot isolate them.
- A runtime-owned instance exclusively owns the complete graph rooted in its semantic properties; nested instances of registered classes belong to the enclosing unit. No state identity may have an owner outside that unit.
- Import, sharing, leasing, and copy-on-write apply to the whole unit. Assigning state copies or transfers it into the unit; extracting a descendant copies it out unless the unit relinquishes it; returning the receiver shares the whole unit.
- A property write or method mutation transitions the instance at its containing placement. Pending preparation installs the ordinary Promise version there, so later unit access resumes in FIFO order; mutation poisoning replaces that whole-unit placement.
- Before host invocation, settle and export the complete state graph into a host-ready, prototype-preserving receiver. An observation receives an isolated snapshot and is side-effect-free; a mutation receives an exclusively owned unit version.
- A mutation completes and reconciles all state changes synchronously through the ordinary property-version transitions before publication. It must return with admissible, fully resolved state and may neither install Promise state nor continue mutating asynchronously. A returned Promise delays only the independent result: publish the unit before waiting, then lease it until settlement because the result may retain the receiver or its state.
- A whole-unit copy preserves prototype, aliases, and cycles, but shares no mutable semantic-state identity with the preserved unit. Error identities remain immutable terminal data.

## Work Bounds

These constrain implementation cost, not observable semantics. Exceeding them is a defect; a mechanism that inherently exceeds them should be replaced.

- Bound graph-dependent work and allocation to data selected by an operation's explicit input or path, its produced output, its captured Promise frontier, and the dependencies it must maintain. Do not process unrelated graph data.
- Build an index when a component first needs one, then maintain it incrementally as the graph changes. Never rescan indexed data to rediscover a maintained fact.
- Rescan admitted data only to reconcile changes made outside runtime transitions, and only where the operation reaches it. Each import visits every reached identity at most once, retains its first import boundary, and reconciles changed placements through the same dependency transitions as runtime writes.
- Cascada does not expect unusually large or deep graphs. Keep recursive walks and Number arithmetic; do not introduce explicit stacks or BigInt.

Cycle cuts are a bounded exception because they stop counter propagation. When counters cannot answer a query, an operation may traverse the counter-selected cut region; all such walks within that operation share one visited set and visit each identity at most once. A separate pass may build a missing index.

## Verification

- Prefer integration tests through public operations, covering observable sequential behavior and owner isolation across meaningful synchronous and Promise interleavings. Cover opaque ordering through aliases, overlapping observations, mutation barriers, and both Promise fulfillment and rejection.
- Derive failure tests from boundary contracts, not existing catches. List every JavaScript action that can invoke user code, group call sites by where failure must return or publish an Error, and cover each distinct preparation and commit path through public operations.
- Use focused unit tests only when integration tests cannot precisely verify a load-bearing invariant. Never pin an interchangeable representation; that turns accidental structure into a contract and obstructs simplification.

## Maintaining This Document

- Keep only cross-cutting contracts, load-bearing invariants, and stable mechanisms needed to understand multiple parts of the source. Put operation-specific mechanics in source comments and tests.
- Use source terminology and the most concrete rule that explains all affected code. Generalize only when that makes both the rule and implementation easier to understand; state a cross-cutting exception directly when clearer.
- Describe the accepted contract and end-state architecture, not migration phases, audit history, or rejected alternatives; plans hold those.
- Compare every revision with the previous version. Remove superseded or contradictory text, verify that no constraint was lost unintentionally, and keep the result concise.
