# Core Runtime Contracts

## Core Contracts

- **Sequential equivalence.** Operations on an asynchronously available graph produce the same observable results and effects as if every value were already available and the operations ran sequentially. Every transition includes all earlier effects and no later ones.
- **Owner isolation.** Mutation through one owner never changes another owner's logical value. Explicit external mutation changes one context-exclusive host identity; other occurrences have no Cascada access authority.
- **Imported-data protection.** Imported data is never modified, except when an explicitly requested mutation operates on that exact external identity.
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
- **Array structure:** Present canonical indexes are placements. Logical length and holes affect Array behavior but are not placements; other properties are outside the language graph.
- **Outside the graph:** Symbols, non-enumerable and inherited properties, and prototypes do not form property placements and are not traversed as graph data.
- Creating a missing graph placement defines an own enumerable, writable, configurable data property; it never follows the prototype chain.
- An own non-placement, such as a non-enumerable property or accessor, is logically absent. Ordinary graph access neither invokes nor redefines it.
- A final read of an absent placement returns `undefined`. Traversing through an absent or `undefined` placement produces an Error, while reaching an Error propagates that same Error without replacing it.
- Final assignment creates an absent placement, and final deletion of one is a no-op. A mutation that requires an absent receiver or intermediate placement poisons that first failed placement.
- A path segment is a String or Number input; normalize it only after it is ready. Before waiting for a pending segment, an observation leases the longest resolved prefix and a mutation gates it, then consumes later segments only as traversal reaches them. Ready paths add neither protection. A mutation cannot gate a prefix containing a fixed external binding. Context-exclusive external state is exempt: its mutations use compiler-static paths, and ordered access never waits for an unknown segment.
- The graph may be cyclic. Auxiliary bookkeeping must neither alter nor hide its topology.
- Refcounting maintains an acyclic projection by cutting parent-key placements. Cuts affect bookkeeping only, not the graph or observable behavior. Their placement and resulting counter totals may depend on construction history and need not be canonical. Indexing is downward-closed: every traversable identity reached from an indexed identity is indexed, including through cuts, and a new traversable child is indexed before its edge is published. Direct host mutation must therefore never change an indexed identity in place; maintained index changes enter through ordinary property transitions or replacement with a fresh identity.

## Data Types and Capabilities

Any Cascada value—and therefore any graph root or property—may be a Promise. Pending and resolved values use the same logical value path: an operation uses an available value immediately or registers at the captured version and continues with the resolved value. A Promise represents asynchronous availability, not a separate data category or a mechanism limited to transition gates.

Admission is the first classification of an available identity. Resolve callable thenables through their captured versions before admitting their values. A synchronous failure while acquiring or invoking `then` is that captured Promise's rejection unless it is already fatal. Preserve Error, logical Array, and Function semantics first. An explicit identity declaration then controls a record or class instance; otherwise records are managed, and class instances follow the managed-class registry or the external default. Primitives use their primitive category. Array and Promise subclasses retain their intrinsic semantics.
An object that cannot be inspected for classification is admitted unchanged as external.

A controlled method is runtime code that consumes logical Cascada values. A host call invokes native or user JavaScript across the preparation and result-admission boundary. An external identity is kept exact and not traversed.

| Type | Supported execution | Boundary | Property writes |
| --- | --- | --- | --- |
| Managed record | Own function-valued properties as observational or mutating methods; no inherited methods | Managed call on a completely prepared receiver | Ordinary language writes; host mutation publishes through the receiver placement |
| Logical Array | Supported standard methods reproduce native observable behavior in matching mode; overrides are observation-only | Standard methods are controlled; overrides receive an exported native Array | Ordinary language writes |
| String | Native observations only | Host call on the primitive | Unsupported |
| Managed class instance | Side-effect-free observations and receiver mutations through methods | Managed call on a completely prepared receiver; mutation isolates state at the invocation boundary | Ordinary language writes; host mutation publishes through the receiver placement |
| External identity | Observations; explicit mutation only at a context-exclusive path or through its function borrow | Host call on the exact receiver | Host-ready write only under that authority |
| Function | May be stored in a record; executable only in an explicitly supported function, method, or callback position | Defined by that executable position | Not a property container |
| Number, Boolean, BigInt, Symbol, `null`, or `undefined` | None | Not applicable | Unsupported |
| Promise | No direct execution; resolve its captured version, then use the result's capabilities | Determined by the resolved value | Determined by the resolved value |
| Error | None; see Errors | Not applicable | Not a property container |

## Ownership and Copy-on-Write

An owner is a placement or retained result that can independently preserve a logical value. A value is **protected** when mutation must leave its current logical state available unchanged.

### Protection

- An ordinary COW-managed value is protected exactly while it is shared permanently or leased temporarily; otherwise it may be mutated in place. Explicit external mutations are ordered effects on an exact identity, not COW.
- Reading without retaining or exposing an identity adds no owner. Any transition that retains a COW-managed identity for another owner marks that identity shared; this includes import, lookup, COW reuse, and retained operation results. An ownership transfer instead ends the previous ownership.
- Import adds no other COW condition.
- Managed records, class instances, and their state use ordinary identity ownership. Direct managed mutation adds invocation-boundary isolation; ordinary graph operations do not.

### Copying and representation

A logical value is what Cascada operations observe; its physical representation is the storage used to realize it. COW leaves a protected logical value unchanged and gives the mutating owner a new version.

- For ordinary language data, protection belongs to the stored identity while permission to replace a placement belongs to its container. A path mutation considers both independently.
- Ordinary COW builds the mutating owner's new value by shallow-copying each level from the first protected container down to the changed spot, applying the change there, and reusing every off-path value unchanged. It copies a path, not a graph.
- Each new path node starts runtime-owned, unshared, and unleased. It is populated by reading each property's logical value, never its physical slot, and carries no source metadata. Reused children retain their identity facts and become shared when both owners retain them.
- Writability, configurability, and extensibility constrain physical storage, not the logical graph. When an otherwise valid transition cannot use its current representation—including because an own non-placement occupies the key—materialize normal runtime-owned storage that omits non-placements and retry. Copy outward along the path as needed to publish it; never invoke or redefine the blocker.
- Ordinary COW preserves the admitted prototype when it shallow-copies a managed class instance. Before host code directly mutates a managed receiver, Cascada isolates every reachable logical value whose existing state must remain observable. After invocation, it validates and admits the completed state and gives retained argument identities ordinary shared ownership before publication.
- Managed mutation copies preserve aliases and cycles within each copied subgraph. Publication may sever an alias between receiver state and another graph placement: that placement retains its old identity and logical value while the receiver publishes its isolated value.
- Runtime-owned representation may be reused or changed whenever every protected logical value remains unchanged. Array backing may therefore grow visibly through a raw host reference while fixed ArrayView bounds preserve every Cascada value. Copy or materialize only when reuse would change a protected value.
- Multiple paths from one owner to the same identity, including cycles, do not by themselves add an owner or require copying.
- Assignments capture the right-hand value before mutating the left-hand path. In `x.self = x`, the lookup retains the original `x` for the new placement and marks it shared; the assignment therefore copies `x` and stores the original in the copy: `newX.self === oldX`, not `newX.self === newX`. Ordinary Cascada assignments link to captured versions rather than create new graph cycles; new cycles may enter through imported host data or managed host mutation.
- A copied Promise placement gets a fresh mirror at the copier's program position, so both property versions diverge there.

## Import and Export Boundaries

- Data leaving Cascada crosses through export. This includes arguments and assigned values passed to external, native, or override host code and public script results. Export resolves required availability, removes runtime representations, and copies managed traversable data into independent host data. Functions and exact external identities remain exact.
- Managed source leases used by export end when export finishes, before host invocation. A returned host Promise may retain its exported values and keeps required external ordering active, but it does not prolong leases on copied managed sources.
- New host-provided roots enter through `initialize`. Context initialization uses the same importer while fixing synchronously reached unique external paths; it is not another import boundary. No mutation-capable path is added or rebound later. Private import also handles host-code results and property values read from external identities. Promise settlement continues its originating boundary before dependent consumers resume.
- Every new logical root not transferred from an existing Cascada value is initialized. Transfers retain existing admission, origin, and ownership.
- Import is one-way. Application and host code must not mutate a managed identity after passing it to Cascada, and Cascada never rescans it for host changes. Mutable live host state must be external and accessed through ordered external operations.
- Managed invocation operates on prepared and isolated managed state rather than exported inputs. Controlled methods remain inside the runtime. Results produced by host code still follow origin-aware result admission.
- Chain construction from an existing value, assignment, and internal value transfer cross no host boundary and preserve existing admission and origin.
- Import records external origin on each identity it first reaches. It traverses only managed state; containment alone neither grants nor removes origin, and an identity already known to Cascada retains its established origin and classification.
- Imported physical storage is borrowed and never modified. Metadata and logical Promise settlement remain outside it. An explicitly requested external mutation is the sole exception: it intentionally changes that exact object.
- Cascada never creates non-extensible managed data. Such data must enter through import. The imported no-write rule is sufficient; do not infer import from non-extensibility or add frozen-specific behavior.
- Imported storage never serves as mutable ArrayView backing.

## External Context Ordering

- External values are observation-only by default. Context initialization makes a synchronously reached identity context-exclusive and mutation-capable only when exactly one context path reaches it; an alias or cycle providing another path leaves it observation-only. Managed `!` operations use ordinary managed mutation and no external guard.
- A mutation-capable external identity is accessed only through its fixed context path or an active function borrow. The `!` segment selects the operation's guard scope independently of that path and must cover every host state dependency the operation may affect. Cascada cannot infer hidden sharing between sibling scopes.
- A managed mutation whose target or receiver is a fixed external path or an ancestor returns a validation Error without changing or poisoning the context or guard. Sibling mutation and physical COW that preserve the logical binding remain valid.
- Explicit external property writes and methods may mutate state inside their exact receiver under its guard. Native or application code must not mutate the imported managed context, replace a fixed external placement, or independently mutate a context-exclusive identity.
- External mutation paths and their `!` scopes are compiler-static. A ready computed observation registers its resolved guard path before host access; an observation with an unresolved segment cannot access context-exclusive external state.
- One context guard orders active external paths hierarchically in both directions; siblings remain independent. Keep operation state at selected scope nodes rather than writing their descendants.
- An external observation waits for preceding mutations, joins the current observation group, and does not wait for another observation. A mutation waits for preceding mutations and observation groups.
- Register every external scope of one operation together before waiting for predecessors or preparing inputs. Scopes owned by the same operation never wait on one another.
- External context observations use the same runtime path guard. A direct operation Promise retains its entry through settlement.
- External ordering is local to one context execution. A host that exposes the same mutable resource to concurrent executions owns their cross-execution concurrency and ordering.
- A function may borrow a context-exclusive identity by reference while its context path is entered. The borrow may pass through nested calls but cannot escape the direct call lifetime or detached work.
- Host code must expose one exact identity for one mutable resource and must not mutate it independently while Cascada can access it.
- External guard poison is path state, never an application value. Observation failure does not poison; mutation failure does. A successful `!!` repair clears selected and descendant poison but not ancestor poison.

## Pending Work: Leases and Transition Gates

Pending work either needs to keep observing a stable value while later mutation continues, or leaves a mutation unfinished so later access must wait. These require different mechanisms:

- A **lease** is temporary COW protection for an exact logical value still in use when later mutation may reuse its representation. It never delays later operations; a later mutation copies, and the lease ends when its operation completes or fails. Before an invocation leaves pending, it leases every source managed record, Array, or class instance a continuation can access and leases further identities revealed by required Promise resolution. A managed observation applies this rule to its complete receiver graph. Managed mutation preparation does the same until its receiver is ready, then uses isolation and the ordinary transition gate. Context-exclusive external identities use their guard instead.
- A **transition gate** preserves ordering when a mutation cannot publish its final value synchronously. It does not preserve the old published value; it makes the placement's next version pending and keeps the captured or working value private. Install an ordinary Promise version there before leaving the transition. Later operations wait at that placement and resume through its normal mirror and FIFO continuations. A ready mutation needs no gate.
- Ordinary pending mutation preparation gates only its final target while required values such as its receiver or arguments resolve. A mutating `enter` deliberately keeps the entered transition open, so its gate remains until the callback and its private commands finish.
- A Promise that represents only an independent operation result is not a transition gate. Publish completed state immediately; lease it only if the pending result may still retain or observe it.
- A managed transition gate orders one logical placement. External effects use their separate context guard so ordering survives native state changes without exposing guard state to host code.

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
- Poisoning an external mutation poisons its context guard but cannot undo effects already made to the exact external identity.
- Rejecting a managed mutation because it would replace a fixed external context binding changes neither the binding nor its guard; the validation Error is only the operation result.

## Execution Boundaries

- Prepare each call input only to the extent its selected boundary consumes it. Continue required preparation after an Error to collect the rest, but do not invoke the selected function, accessor, callback, or method. Nested Errors participate only when required preparation or behavior reaches them.
- Host calls consume every explicit argument. A controlled method resolves only the data it consumes; a payload it merely retains stays unchanged, including an Error or Promise. A rejected retained Promise poisons its eventual placement, not the call that retained it. Controlled methods may return internal representations such as ArrayViews.
- A controlled callback receives only the logical values its method declares and must be synchronous, read-only, and non-retaining.
- Invoke an own managed-record method with its prepared record as receiver. Inherited record methods are unavailable; an extracted Function remains data.
- Controlled methods avoid copying and materialization where possible. A special path must provide a material benefit and preserve every logical value.
- Inputs and results that cross the host boundary use the import and export rules above. Managed invocation instead uses prepared logical inputs and invocation isolation; controlled results and published managed-mutation receivers remain runtime-owned.
- A host observation must not mutate an exact receiver or external argument. A host mutation may mutate only the state designated by its receiver category; exact source argument identities remain read-only.
- Every use of context-exclusive external state participates in its guard. Passing it by reference requires an active function borrow.
- Host code may retain an exact external identity or Function only through its result or until its returned Promise settles. Mutation after that interval is a host contract violation. Independently retained references must not mutate an external identity while Cascada can use it; such effects cannot participate in Cascada's ordering.
- Host calls, controlled callbacks, and reflection hooks must not issue Cascada operations before returning; synchronous reentry is a host contract violation. Trusted runtime control-flow callbacks such as `enter` follow their own transition contracts instead.

If mutation `M1` is pending, following observations `O1` and `O2` wait for `M1` and may then overlap; following mutation `M2` waits for both observations. The same order holds through every alias.

## Managed Methods

- Declare a managed class before admitting its instances. Declaration is not retroactive, and classification is fixed at first admission.
- A managed record selects an own enumerable Function placement. A managed class selects from the prototype captured at admission and its inherited class chain up to, but excluding, `Object.prototype`. Class declaration rejects accessors on that chain, and application code must not later change the chain or its descriptors.
- A managed class exposes all semantic state through own enumerable string-keyed data properties. Its methods must not depend on own accessors, Symbols, non-enumerables, private fields, internal slots, or closure state.
- Managed state may contain primitives, records, logical Arrays, managed class instances, external identities, Functions, aliases, cycles, and Promises between calls.
- After method selection, the call consumes all explicit arguments and the complete receiver graph. Common preparation recursively resolves every Promise revealed in those inputs through captured property versions and provides no Promise or Error to the method. Imported physical storage retains its Promise unchanged.
- Managed identities retain ordinary per-identity ownership. Assignment, extraction, import, indexing, `enter`, and path COW use the normal graph rules; shallow COW preserves an admitted managed-class prototype.
- A method may finish synchronously or keep its invocation active through one direct Promise. All later work and input access must belong to that Promise and finish before it settles; detached work is forbidden.
- An observation must not mutate its receiver. A mutation may change only its isolated receiver and must not mutate an identity reached only from an argument at entry. It may retain an argument in its receiver and mutate it in a later managed call after isolation. If an argument already aliases receiver state, the method may mutate the isolated alias without changing the original Cascada argument.
- Nested method calls are ordinary JavaScript on the already prepared receiver and do not start another Cascada invocation. Methods must not change a traversable identity's prototype, descriptors, or extensibility.
- External identities and Functions remain exact. Managed methods may retain or return them but must not invoke external operations or inspect or mutate context-exclusive state outside an active borrow.
- Cascada may copy any managed record, Array, or class instance reached through an argument or receiver before or after invocation. Copies preserve managed-class prototypes, Array structure, and aliases and cycles within each copied subgraph. Code may rely on identities only while its invocation is active.
- A managed observation leases its prepared receiver and arguments through a direct Promise without a transition gate. A managed mutation isolates its receiver, retains argument leases, and uses the ordinary transition gate while a direct Promise is pending.
- After a mutation, validate and admit the completed state, mark retained source arguments shared, and publish it through the ordinary mutation transition. Preparation poison, receiver validation failure, or method failure poisons the receiver placement; an observation or independent-result failure affects only its result.
- If a mutation returns its receiver, return the published receiver with ordinary result ownership. Independently copy every other traversable result so it shares no managed record, Array, or class instance with the receiver or arguments. Preserve internal aliases, cycles, class prototypes, Arrays, Promise placements, exact external identities, and Functions. An explicitly returned Error remains an ordinary result.

## Work Bounds

These constrain implementation cost, not observable semantics. Exceeding them is a defect; a mechanism that inherently exceeds them should be replaced.

- Bound graph-dependent work and allocation to data selected by an operation's explicit input or path, its produced output, its captured Promise frontier, and the dependencies it must maintain. Do not process unrelated graph data.
- Build an index when a component first needs one, then maintain it incrementally as the graph changes. Never rescan indexed data to rediscover a maintained fact.
- Import traverses an identity only when it first crosses inward and visits it at most once during that import. Never rescan imported managed data for host changes.
- Cascada does not expect unusually large or deep graphs. Keep recursive walks and Number arithmetic; do not introduce explicit stacks or BigInt.

Cycle cuts are a bounded exception because they stop counter propagation. When counters cannot answer a query, an operation may traverse the counter-selected cut region; all such walks within that operation share one visited set and visit each identity at most once. A separate pass may build a missing index.

## Verification

- Prefer integration tests through public operations, covering observable sequential behavior and owner isolation across meaningful synchronous and Promise interleavings. Cover external context ordering across ancestor, descendant, and sibling paths, overlapping observations, function borrows, and both Promise fulfillment and rejection.
- Derive failure tests from boundary contracts, not existing catches. List every JavaScript action that can invoke user code, group call sites by where failure must return or publish an Error, and cover each distinct preparation and commit path through public operations.
- Use focused unit tests only when integration tests cannot precisely verify a load-bearing invariant. Never pin an interchangeable representation; that turns accidental structure into a contract and obstructs simplification.

## Maintaining This Document

- Keep only cross-cutting contracts, load-bearing invariants, and stable mechanisms needed to understand multiple parts of the source. Put operation-specific mechanics in source comments and tests.
- Use source terminology and the most concrete rule that explains all affected code. Generalize only when that makes both the rule and implementation easier to understand; state a cross-cutting exception directly when clearer.
- Describe the accepted contract and end-state architecture, not migration phases, audit history, or rejected alternatives; plans hold those.
- Compare every revision with the previous version. Remove superseded or contradictory text, verify that no constraint was lost unintentionally, and keep the result concise.
