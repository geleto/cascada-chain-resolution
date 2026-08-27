# Core Runtime Contracts

[`docs/data-limitations.md`](docs/data-limitations.md) is the authoritative developer-facing contract for data and host code crossing the runtime boundary. Architecture sections below explain the mechanisms that enforce or rely on it.

## Core Contracts

- **Sequential equivalence.** Operations on an asynchronously available graph produce the same observable results and effects as if every value were ready and the operations ran sequentially. Every transition includes all earlier effects and no later ones.
- **Owner isolation.** Mutation through one owner never changes another owner's logical value. Explicit external mutation changes only host identities covered by its external authority and ordering.
- **Imported-data protection.** Imported data is never modified, except when an explicitly requested mutation operates on that exact external identity.
- **Non-blocking issuance.** An operation processes available work and returns a value or Promise. It need not settle before the next operation is issued.

## Design Method

The mechanisms below preserve these contracts. Reuse them before adding state or another execution path:

- synchronous transitions make all available progress immediately;
- FIFO continuations preserve program order across Promise settlement;
- property versions and mirrors preserve captured logical values;
- ownership and copy-on-write preserve values held elsewhere;
- leases protect managed values without blocking later mutation;
- transition gates order unfinished managed mutation;
- readers-writer phases order observations and mutations;
- boundary processing controls identities crossing between Cascada and host code.

Core contracts, type capabilities, execution boundaries, and Error/fatal classification are semantic architecture: implementation work must not change them silently, while an explicit architecture revision may correct them. Metadata layout, helper boundaries, refcount projections, and counter totals are implementation choices.

- Prefer one general transition over parallel paths, flags, adapters, or deferred cleanup when cases share the same state change. Split only when behavior or invariants differ, and remove the superseded path in the same change.
- Keep facts at their natural scope: identity facts on identities, property-version facts on mirrors, parent-key facts on placements, path facts on paths, and operation facts within the operation.
- Derive a fact where it is used. Persist it only when it cannot be recovered correctly or repeated derivation has a demonstrated material cost, and then at the narrowest correct scope.

## Language Graph

- **Inside the graph:** Roots and values reachable through placements. A placement is a logical `(container, key)` location holding one property version; a JavaScript property is only its physical representation. Ordinary placements are own enumerable string-keyed data properties. ArrayView placements may project shared backing storage.
- **Array structure:** Present canonical indexes are placements. Logical length and holes affect Array behavior but are not placements; other properties are outside the graph.
- **Outside the graph:** Symbols, non-enumerables, inherited properties, and prototypes are not placements and are not traversed as graph data.
- Creating a missing placement defines an own enumerable, writable, configurable data property and never follows the prototype chain.
- An own accessor or non-enumerable property is logically absent. Ordinary graph access neither invokes nor redefines it.
- A final read of an absent placement returns `undefined`. Traversing through an absent or `undefined` placement produces an Error. Reaching an Error propagates that same Error.
- Final assignment creates an absent placement; final deletion of one is a no-op. A mutation requiring an absent receiver or intermediate placement poisons the first failed placement.
- Path segments are String or Number operation inputs. Normalize and consume each only when traversal reaches it; any other ready value produces a validation Error without invoking coercion hooks. A failed known prefix does not wait for unused segments.
- The graph may be cyclic. Bookkeeping must neither alter nor hide its topology.

## Data Categories

Any graph root or placement may contain a Promise. Pending and ready values use the same logical path: an operation uses an available value or registers at its captured version and continues with the resolved value. Promise means asynchronous availability, not a separate admitted category.

Admission is the first classification of an available identity. Resolve callable thenables through their captured versions before admission. Acquisition or invocation failure is that captured Promise's rejection unless already fatal. Classification preserves Error and Function semantics first. An identity obtained as live state of an external property remains external, including a record or Array. An explicit external identity declaration may likewise make a record, Array, or class instance external. Otherwise logical Arrays retain Array semantics, records default to managed, and a class instance follows its explicit managed declaration, the managed-class registry, or the external default. Promise subclasses keep Promise semantics. An uninspectable object is admitted unchanged as external.

Declarations do not modify or admit an identity and are relevant only until its first admission. Sampling a declaration input captures its thenability once; this availability fact is not category admission. A matching declaration request for admitted state returns it without another walk; a conflicting one fails. An external identity declaration overrides the managed record or Array default and any class rule; a managed identity declaration overrides the external class default. Records and Arrays passed to `managedState` are traversal roots and receive no redundant declaration. Nested admitted managed identities, declared or admitted external identities, and uninspectable identities stop its walk; requesting managed state for an external or uninspectable identity as the root fails. An identity declaration does not bind a prototype; admission records the prototype then present and fixes it with the category. Passing an Error to an identity-declaration API preserves and returns that exact Error without declaring it; an Error reached during a managed declaration walk ends only that branch. A managed copy inherits the admitted category and prototype without inheriting a declaration.

A controlled method consumes logical Cascada values. A host call crosses argument-export and result-admission boundaries. An external identity remains exact and is not graph-traversed.

| Type | Supported execution | Boundary | Property writes |
| --- | --- | --- | --- |
| Managed record | Own function-valued properties as observational or mutating methods; no inherited methods | Managed call on a completely prepared receiver | Ordinary language writes; host mutation publishes through the receiver placement |
| Logical Array | Supported standard methods reproduce native behavior in matching mode; custom methods are unsupported | Controlled method | Ordinary language writes |
| String | Native observations only | Host call on the primitive | Unsupported |
| Managed class instance | Side-effect-free observations and receiver mutations through methods | Managed call on a completely prepared receiver; mutation isolates at invocation | Ordinary language writes; host mutation publishes through the receiver placement |
| External identity | Observations; explicit mutation only after exclusive use through one compiler-static context path | Host call on the exact receiver | Host-ready write only under that authority |
| Function | Stored as data; executable only in a supported function, method, or callback position | Defined by that position | Not a property container |
| Number, Boolean, BigInt, Symbol, `null`, or `undefined` | None | Not applicable | Unsupported |
| Promise | No direct execution; use the resolved value's capabilities | Determined by the resolved value | Determined by the resolved value |
| Error | None; see Errors | Not applicable | Not a property container |

## Identity Traversal

- An identity walk may inspect each reached identity once while preserving aliases and cycles.
- Identity deduplication must not erase occurrence facts. Work defined by placements or paths reports every relevant occurrence even when the identity was already inspected. Cycle handling bounds the walk without hiding finite paths.

Identity traversal is used by:

- import, copying, and graph validation, which need identity inspection.

## Refcount Indexing

- Refcounting maintains an acyclic projection by cutting parent-key placements. Cuts affect bookkeeping only, not graph behavior. Their positions and counter totals may depend on construction history and need not be canonical.
- Indexing is downward-closed: every traversable identity reached from an indexed identity is indexed, including through cuts, and a new traversable child is indexed before its edge is published.
- Direct host mutation must never change an indexed identity in place. Incremental index changes enter through ordinary placement transitions or replacement with a fresh identity.
- When counters cannot answer across a cycle cut, one operation may traverse the counter-selected cut region with one shared visited set. A separate pass may build a missing index.

## Ownership and Copy-on-Write

An owner is a placement or retained result that can independently preserve a logical value. A managed value is protected while it is permanently shared or temporarily leased; otherwise it may be mutated in place. External mutation is an ordered effect on an exact identity, not COW.

- Reading without retaining or exposing an identity adds no owner. Retaining a managed identity for another owner marks it shared; this includes import, lookup, COW reuse, and retained results. Ownership transfer ends the previous ownership instead.
- Import adds no other COW condition.
- Multiple paths from one owner to the same identity, including cycles, do not create another owner.
- Protection belongs to an identity; permission to replace a placement belongs to its container. A path mutation considers both.
- Ordinary COW shallow-copies each level from the first protected container to the changed placement and reuses off-path values. Reused children keep their identity facts and become shared when both owners retain them.
- Each copied path node starts runtime-owned, unshared, and unleased. Populate it from logical values, not physical slots, and copy no source metadata except the admitted category and prototype.
- Assignment captures its right-hand value before mutating the left. In `x.self = x`, lookup retains the old `x`, so assignment copies `x` and stores the old value: `newX.self === oldX`, not `newX.self === newX`. Ordinary assignment links captured versions rather than creating graph cycles; cycles may enter through imported or managed host mutation.
- A copied Promise placement gets a fresh mirror at the copier's program position.

## Representation and Materialization

A logical value is what Cascada observes; its representation is the storage used to realize it. Representation may change whenever every protected logical value remains unchanged.

- Writability, configurability, and extensibility constrain storage, not the graph. If a valid transition cannot use its current representation, materialize normal runtime-owned storage and retry. Omit non-placements and never invoke or redefine a blocker.
- Copy outward along a path as needed to publish materialized storage.
- Shallow COW preserves a record's or managed class's admitted prototype. Managed mutation copies preserve aliases and cycles inside each copied subgraph. Publication may sever an alias to another placement, which keeps its original identity and value.
- Array backing may grow physically while fixed ArrayView bounds preserve existing values. Copy or materialize only when reuse would change a protected value.
- Imported storage never serves as mutable ArrayView backing.

## Read Leases

A lease temporarily protects an exact managed identity that pending work may still read or whose captured graph value is not yet owned by its result. It never delays later mutation; mutation uses COW instead. Release every lease after the operation's last access on success or failure, including identities revealed by required Promise resolution. Cleanup closes the operation's lease lifetime: already-scheduled work must not leave a lease acquired after closure, and must refuse or immediately balance such an acquisition.

Leases are used for:

- ready managed argument roots while a pending receiver prevents boundary-specific capture or protection; release them at the synchronous selection handoff;
- managed receiver preparation;
- a managed observation's complete prepared receiver through its direct Promise;
- a managed mutation's receiver until isolation;
- a controlled observation that resumes reading its receiver;
- delayed controlled Array observation results whose captured origins are not yet published;
- a logical Array `concat` item from capture through publication;
- read-only `enter` for its captured value;
- a path observation waiting for its first pending segment, at the longest resolved prefix; later segments reuse that lease.

External identities use operation phases and, when needed, argument observation guards instead of leases.

## Transition Gates

A transition gate orders a managed mutation that cannot publish its final value synchronously. It publishes an ordinary Promise version at the protected placement, keeps the working value private, and makes later access wait through the normal mirror and FIFO continuation rules. It does not preserve the old value; COW and leases do that.

Gates are used for:

- ordinary pending mutation at its final target while required values resolve;
- a managed mutation whose direct Promise keeps its receiver private;
- mutating `enter` until its callback and private commands finish;
- a path mutation waiting for its first pending segment, at the longest resolved prefix; later segments reuse that gate.

A ready mutation needs no gate. Path availability adds neither a lease nor gate when every segment is ready. A mutation waiting below a context prefix registers every indexed candidate external phase before installing the managed prefix gate; the gate orders the unknown managed target and the phases order exact external effects. A Promise representing only an independent result is not a gate: publish completed state immediately and protect retained inputs only while the result may access them.

## External Operation Phases

A readers-writer phase orders access to an exact external identity, whose state cannot be protected by managed COW or transition gates. Consecutive observations share a read phase after the preceding exclusive operation; the next mutation or repair waits for the whole read phase and then runs exclusively.

- Append or join every phase synchronously when the operation is issued. Publish all of one operation's successor dependencies before waiting on any predecessor. Scopes created by one operation never wait on one another.
- Complete the operation's phase set before its first wait and never expand it afterward. A later-revealed identity from a context source must be covered by an already selected external boundary or the operation fails before accessing its host state.
- Existing waiters keep their captured predecessor when a successor becomes current. A completed read phase is not reused.
- A direct operation Promise keeps its phase active through its final boundary processing. A nested result Promise does not.

External phases are selected from an exact context identity or through a context path. Async conditions, loops, and `enter` reserve selected phases before suspension and release them after the child drains; child-local phases prevent self-wait, while empty and unrelated children do not block other work. Ordinary Chain scheduling belongs to the containing Cascada runtime. Managed values use leases and gates in this repository rather than external phases.

Phases, leases, and gates solve different problems: phases order operations, leases preserve values without waiting, and gates publish unfinished managed transitions.

## Promise Continuations

An operation is one issued command. A transition is one synchronous unit within an operation or continuation. A program position locates a capture or registration in sequential order; an operation's Promise frontier contains the pending versions required by its selected work.

- Process every available part synchronously and in program order.
- Register on a pending placement only where the operation depends on it. Structural discovery alone does not make the operation a consumer.
- Registrations made before settlement form one FIFO batch. Each continuation completes its transition synchronously; never split it with `await`, another `.then`, `queueMicrotask`, or lazy registration.

Use the common FIFO thenable mechanism only to:

- advance or consume a captured version;
- resume or complete a transition;
- complete settlement bookkeeping before later Cascada use.

All ordering-sensitive registration goes through this mechanism; raw `.then` must not create a parallel continuation path. Returning a Promise or thenable alone neither canonicalizes nor replaces it.

If three operations reach one pending placement, the first resolver publishes `V`, the second observes `V` and may leave `V'`, and the third observes `V'`.

## Operation Work Lifetimes

Shared settlement advances Promise mirrors, property versions, and required bookkeeping. Operation work exists only to finish one issued operation. The synchronous transition that determines the final outcome closes operation work before exposing that outcome, without cancelling shared settlement. An unfinished component is abandoned when another component closes their operation; abandonment is not a separate event or cancellation mechanism.

- An outcome is final only after its required Error handling, boundary processing, and publication. A reached data Error does not itself close work: `hasError` may turn it into a final `true`, while `getErrors` and export must finish their required Error collection. A graph-Promise rejection first becomes data Error; an internal rejection remains fatal. A direct Promise closes only after boundary completion, while an independent nested result Promise is not operation work.
- A registered continuation completes shared settlement first, including index maintenance required to publish into an already indexed graph. Index construction or traversal requested only by the operation is operation work. If the operation is closed, none of that work continues.
- Failure of query-only managed-graph traversal or indexing is fatal. It is not language Error data and is never collected by an Error query. A supported failure during shared property publication follows that publication boundary instead.
- Components prepared concurrently by one operation share its lifetime. Closing abandons unfinished siblings, while resources with earlier or later last-access points retain their own release rules. Release operation-only strong state that no unfinished result can use, including values already collected by an unfinished aggregate.
- Use one operation-level lifetime mechanism around each operation's open/closed fact and idempotent `close()`. Components of one issued operation share that lifetime: component success does not close it, component fatal failure does, and the coordinator closes after required final processing and publication. A nested component with independently stored operation-only resources registers one synchronous, idempotent, non-throwing release with the owner and unregisters it on normal completion. Release registration never tracks or cancels work.
- The lifetime mechanism receives already classified boundary results and never decides whether a failure is language Error data or fatal. Leases, export output, Error collection, gates, phases, and publication keep their own lifetimes and storage.
- Every owner has an explicit Boolean open fact and idempotent `close()`. Existing operation state should implement that contract directly instead of allocating a wrapper. All operation-specific pending registration uses the guarded continuation helpers. Ready work continues synchronously without allocating release-registry state. Pending nested resources reuse the containing operation and register their release before control returns. No caller manually registers unguarded operation work.
- Do not build a task-cancellation system.
- Export output has a separate resource lifetime. Handing completed copies to a caller or discarding them ends output work without closing a shared operation. Discarding output because of a language Error does not close operation work; the required Error scan continues. Fatal closure by export or another component abandons unfinished export traversal after shared settlement.

Operation work lifetimes are used by:

- outbound export;
- Error queries;
- controlled Array operation work;
- Promise-aware scalar conversion outside invocation, including Array-length assignment;
- managed receiver and argument preparation;
- external boundary preparation; and
- Promise-valued path operations.

## Property Versions and Mirrors

A property version is the exact logical state captured at one placement. A mirror tracks a Promise-backed version as it changes or resolves.

- Every Promise placement creates a new mirror. Different placements and versions never share one, even when they contain the same Promise.
- A live mirror determines logical presence and value. Physical writeback may keep runtime-owned storage current, but correctness never depends on it.
- Imported storage retains its physical Promise while the mirror holds the resolved logical value.
- Replacing or deleting a placement detaches its mirror. The mirror continues serving operations that captured that version.
- Settlement alone changes no language state. The first resolver advances the captured version; later resolvers ignore the payload and continue from the value earlier resolvers left.

## External Boundary

Host data entering Cascada's language graph passes through import. Data leaving the graph for host JavaScript passes through export. This boundary is the only place that translates ownership and representation between the two domains. A synchronous scalar callback result consumed only as controlled-operation control data does not enter the graph; validate it under that callback's result contract. A managed method's prepared receiver is its invocation-owned working state rather than an exported input; every explicit argument is exported.

### Import and origin

Import admits host-originated data and records its origin without becoming the owner of type classification. It never rescans managed data for later host changes.

Import is used for:

- a host root explicitly passed to public import, including each context root as a whole;
- managed, native, and external host-call results;
- controlled host-callback results that enter the graph;
- values read from external properties;
- values revealed when any of those Promises fulfill.

Promise fulfillment continues its original import boundary; it is not another boundary case.

Chain construction from an existing Cascada value, assignment, lookup, and internal transfer do not cross the boundary and therefore do not import; they preserve admission and origin.

- Validate each reached synchronous import segment before committing origin, sharing, or Promise mirrors. A boundary failure commits none of that segment.
- Traverse managed state once while preserving aliases and cycles; stop at Errors, Functions, and external identities. Containment neither grants nor removes origin.
- Existing identity metadata identifies an already admitted value. Import retains such a managed result without traversing it again and marks it shared when the result adds an owner. This includes unexported data returned by another Cascada execution. A new host-produced managed identity becomes imported and shared.
- A new identity read from an external property remains external, even when it is a record or Array. External state may contain only external state. If property traversal encounters an already admitted managed identity, poison that external container without replacing either value. Do not scan external state to search for this violation. A host call may instead return admitted managed data because its result crosses a separate import boundary rather than remaining external property state.
- Application and host code must not mutate managed data after passing it to Cascada. Imported storage is borrowed and never modified; metadata and logical Promise settlement remain outside it.
- Mutable live host state must be external and accessed through ordered external operations.
- Cascada never creates non-extensible managed data. Such data must enter through import; do not infer import from non-extensibility or add frozen-specific behavior.

### Export

Export produces host-ready data independent from managed storage. It resolves required availability, removes runtime representations, copies managed records, Arrays, and class instances while preserving aliases, cycles, and admitted prototypes, and keeps Functions and external identities exact. One boundary operation exports its ordered roots as one graph with one identity map, preserving aliases across input positions while keeping Error collection separate per root. A controlled operation that invokes one host callback repeatedly prepares one shared exported snapshot for those invocations.

Export is used for:

- explicit arguments passed to any native JavaScript method, including managed, external, and native methods;
- declared inputs passed to a host callback by a runtime-controlled method;
- values assigned to external properties;
- script results.

Export never sends an Error to host JavaScript. Each root is one Error-collection domain. After reaching an Error at any depth, export still completes that root's captured frontier and collects every distinct Error identity beneath it. One Error becomes the root outcome unchanged; several become one compound Error containing them all. A batch export combines every failed root outcome in root order without flattening or losing its component Errors. Any failed root prevents host invocation or assignment and replaces a script result.

Export uses no managed source lease. Each transition copies every ready placement synchronously; a pending placement is captured through its exact mirror, and its FIFO continuation traverses each newly revealed branch synchronously once. Later work never rereads already captured source state. Host code may retain exported copies, exact Functions, and external identities, but not their managed sources. Export never transfers external mutation authority, and independently retained host mutation remains outside Cascada's ordering guarantees.

Export follows the common operation lifecycle. Closing releases partial output state. A reached Error discards output copies but does not close the operation until its required Error scan finishes.

## Boundary Completion

An operation crossing a boundary is complete only after required admission, validation, copying, and publication. Ready and Promise-backed results follow the same completion rule.

- A ready result completes its import, validation, copying, and publication synchronously.
- A direct Promise is adopted by the operation's one result Promise. Its fulfillment first completes the same processing and becomes the logical value or boundary Error; rejection remains rejection. Never detach or discard that processing.
- A Promise nested inside a synchronous inbound result is independent result data. It does not extend the producing invocation, leases, or phases, though its placement continues its import and mirror rules. A later boundary that consumes that placement, including export, follows its captured version and may wait for it.

Boundary completion applies to:

- imported Promise roots;
- host-call results;
- external-property reads;
- managed direct-Promise results;
- host-input exports; and
- script-result exports.

Managed receiver finalization and external phases remain active until completion.

## External Authority

External identities are observation-only by default. Import and storage do not restrict them. Actual Cascada use records one of four identity states: unused, one exact compiler-static `(context Chain, normalized path)`, outside context, or mutation-ineligible use. Mutation-ineligible use means a different context Chain or path, a dynamic path, or mixed context and non-context use.

- A context Chain records that category on the Chain itself. Several context Chains may exist in one execution.
- Every operation carries a compiler-static-path fact before graph work begins. A path is static only when every segment to the identity is a compiler-known String or Number; a computed or Promise-valued segment is dynamic even when already resolved.
- Lookup, receiver and property access, and argument use record the actual location and static-path fact before host access. Repeating one static context Chain and path changes nothing; any incompatible or dynamic use makes the identity permanently mutation-ineligible.
- Mutation records its use first. It is valid only through the one recorded compiler-static context Chain and path, which the first valid mutation fixes as the identity's access location. Every later use requires that same static location; an incompatible use returns a validation Error without host access. Outside-context and mutation-ineligible mutation invoke no host code and poison any external phase already selected for the operation.
- Import, assignment, return, export, and storage alone never count as use or transfer authority.
- External traversal may mutate deeply reached host state. Cascada records identities only when an operation reaches them and never scans external graphs for aliases or shared descendants.
- Host code must not expose the same mutable resource through independently scheduled external roots. Cascada cannot detect hidden sharing between different identities or retroactively order an identity first discovered during host traversal.

Phase 9 context construction marks a Chain as context, indexes every synchronously reached external occurrence, and thereafter maintains that index through context graph transitions. The index supports exact, longest-prefix, and descendant queries before COW, gating, or waiting. It is placement bookkeeping only; identity use and phase state remain shared identity facts.

## Argument Observation Guards

An argument observation guard gives one native JavaScript call ordered read access to mutation-eligible external identities selected from context Chain sources. It is neither ownership nor a lease. Exported managed argument data is an independent host copy and may be mutated or retained without changing its Cascada source. Functions and external identities remain exact and are read-only as arguments.

- A context source covers indexed external identities beneath it, including inside exported managed containers. Record each reached source location as an observation use before host access and register its observation phase with receiver guards before exporting any input.
- A non-context source records outside-context use before host access. If the identity is already mutation-authorized, reject the incompatible use. Otherwise no phase is needed: outside-context use permanently prevents later Cascada mutation of that identity.
- An external identity revealed from a context source only after the operation starts waiting must already be covered by a selected external boundary. Otherwise preparation returns a validation Error before passing it to host code; it never acquires another phase late.
- An argument never receives external mutation authority.
- Export keeps external identities exact. A method may retain, store, or return one, but may not mutate it as an argument. A later operation may mutate it only when it is selected as that operation's mutation receiver under the ordinary receiver rules.

The same source-use validation applies whenever an external identity reaches:

- an explicit host-call argument;
- a managed-call argument;
- a controlled callback input.

## External Guards

An external guard applies readers-writer phases to exact host state that COW and transition gates cannot protect. Phase state belongs to the external identity so duplicate selections join one phase. This never redirects access through an alias: mutation authority still requires one fixed compiler-static context location. Phase access is either shared observation or exclusive work; repair is an orthogonal flag on exclusive work, not a third access mode.

- Call boundaries receive mutation and repair as separate facts. Cascada lowers unmarked access, `!`, and `!!` into those runtime facts; this project does not interpret Cascada syntax.
- A context operation selects its exact receiver or indexed external identities at or below its path. Managed mutation requests retain ordinary managed behavior.
- An outside-context external operation records outside use before host access and remains observation-only without a phase. It fails if the identity is already mutation-authorized elsewhere; otherwise that use prevents all future Cascada mutation of the identity.
- Enter every selected identity phase when the operation is issued and before inspecting host state. Wait for predecessors before reading a getter, descriptor, proxy, property, or method.
- The first selected external identity on a context path guards the host suffix traversed through it. Deeper identities record their own use but add no phase to the active operation. An uncovered context identity revealed after waiting is not accessed.
- Explicit external mutation may change only its exact guarded receiver. Arguments remain read-only. Native or application code must not mutate the receiver independently.

External guards are used by:

- mutation-eligible context receiver and property operations;
- context-prefix operations over indexed external descendants;
- mutation-eligible external identities passed from context sources;
- async child buffers that may access the scope.

## Guard Poison and Repair

Guard poison is an Error stored in the execution's external phase entry for the exact identity, not in global identity metadata or application data. Poison never replaces the exact external value.

- Existing poison contributes an Error at the selecting receiver or argument position unless that exact scope is explicitly repaired. Required preparation continues and host code is skipped on an unrepaired Error.
- Ordinary observation failure releases its phase without poisoning. Reaching admitted managed data inside external property state is an external-containment violation. It poisons the selected phase for that container, if any; an unphased outside-context access only returns the Error.
- Mutation failure or rejection records its combined Error on every selected mutation phase in phase order, so already-issued successors observe it. Dynamic, outside-context, and multiple-use mutation invoke no host code and poison any selected mutation phases; completed host effects remain visible.
- A repair-only request enters the selected external phases exclusively, bypasses and clears their existing poison, performs no host access, and has logical result `undefined`. It is idempotent.
- A repair-and-mutate request is one exclusive operation. It bypasses old poison and performs the mutation; success leaves the selected scopes clear, while failure stores only the new mutation poison.
- Repair affects only its explicitly selected external scopes. It does not clear application Errors, ancestor or unrelated poison, use history, or mutation eligibility.
- The runtime exposes repair-only and repair-and-mutate requests. It exposes no combined repair-and-observe operation; issue repair-only followed by an ordinary observation.

## Execution Boundaries

- Select the operation boundary first from runtime-controlled facts such as admitted category, method name, and mode. This internal dispatch invokes no host code. Prepare each input only to the extent that boundary consumes it. Continue required preparation after an Error to collect the rest, but do not invoke the selected function, accessor, callback, or method. Nested Errors matter only when required preparation reaches them.
- An operation input that the selected boundary never consumes, including an unused path segment or an argument rejected before boundary selection, remains host-owned. Do not wait for it or attach a rejection observer merely to suppress host reporting.
- If internal dispatch rejects a constructor, controlled name, or mode before selecting an executable boundary, perform no boundary-specific receiver or argument preparation and return only that validation Error.
- A value selected for invocation is prepared and validated as an executable, not imported as graph data. Import applies to a property-read result or invocation result that enters the graph.
- After required operation phases complete, finish the selected boundary's explicit input preparation before proxy reflection, descriptor access on application-controlled objects, a getter, or other host method-selection code. If preparation prevents invocation, execute none of that host code; order collected failures by their logical receiver and argument positions. Do not confuse this host reflection with the earlier internal dispatch.
- Controlled Array table lookup and trusted native String lookup are internal dispatch and remain early because neither invokes an application hook in the supported runtime. String selects only Function-valued data properties from stable `String.prototype` and `Object.prototype`; it never invokes an accessor during selection. Dynamic record, managed-class, and external member resolution happens after preparation.
- Native JavaScript calls export every explicit argument. Runtime-controlled methods resolve only declared logical inputs; when one invokes a host callback, it exports the complete callback argument list as one graph. Retained payload remains unchanged, including an Error or Promise. A rejected retained Promise poisons its eventual placement, not the retaining call. Controlled methods may return internal representations such as ArrayViews.
- A controlled callback receives only its declared exported inputs. It may mutate or retain exported managed copies, but Functions and external identities remain exact and read-only. It must not access an unexported managed source or reenter Cascada.
- A controlled callback position that must remain synchronous rejects a direct Promise result. Its declared result contract determines validation and conversion. Import the result only when it enters the graph as host data; a result consumed entirely by the controlled algorithm does not cross that boundary.
- A logical Array supports only names in the controlled method table, which always select the controlled operation. Every other name is unsupported. Never inspect a custom Array method surface.
- Controlled Array methods do not consult application method or protocol surfaces. They assume standard Array primordials and prototype behavior remain unmodified. Trusted native String dispatch likewise assumes stable `String.prototype` and `Object.prototype`.
- Controlled methods avoid copying and materialization where possible. A special path must provide a material benefit while preserving every logical value.
- Host code may mutate or retain exported managed argument copies without changing Cascada source data. Exact Functions and external identities are read-only as arguments; later external mutation requires a separate operation in which the identity is the authorized mutation receiver. A host observation must not mutate its exact receiver, while host mutation may change only its designated receiver.
- External writes complete export before native assignment or setter execution; any reached Error prevents the write. A native setter must finish synchronously.
- Host code may retain exported copies, Functions, and external identities. It receives no mutation authority beyond active external phases, and later independent mutation is a host-contract violation while Cascada may use the resource.
- Host calls, controlled callbacks, and reflection hooks must not issue Cascada operations while active, including work represented by a direct Promise. Nested result Promises must not later access receivers or inputs. Trusted runtime control-flow callbacks such as `enter` follow their own contracts.

## Managed Methods

- Declare a managed class before admitting its instances. Declaration is not retroactive; classification is fixed at first admission.
- Internal dispatch selects a managed boundary from admitted category, method name, and mode without member reflection. Complete receiver preparation and explicit-argument export before resolving a member; failed preparation performs no post-preparation method-placement read, prototype descriptor traversal, callable test, or invocation.
- A managed record then resolves its own enumerable method placement from the prepared record and tests callability. Accessors, non-enumerables, inherited properties, and extracted Functions are not record methods. A managed class selects from its admitted prototype chain up to, but excluding, `Object.prototype`. Its prototype chain must satisfy the accessor-free managed-class contract when admitted, and application code must not change it afterward.
- Resolve a managed member once from the prepared receiver before mutation isolation. Isolation preserves that member and the admitted prototype and does not repeat resolution.
- Managed classes expose semantic state only through own enumerable string-keyed data properties. Every managed method keeps mutable semantic state in `this` and receives other state through explicit arguments; it must not depend on mutable parent, closure, module, private-field, Symbol, non-enumerable, accessor, or internal-slot state.
- Managed state may contain primitives, records, logical Arrays, managed classes, external identities, Functions, aliases, cycles, Promises, and Errors.
- External identities inside a managed receiver are opaque leaves. A managed method may retain, replace, remove, compare, or return such an identity, but may not inspect or mutate its host state. Select that identity as an external receiver in a separate Cascada operation to access it.
- Preparation consumes the complete receiver graph, resolves every receiver Promise through captured versions, and provides no Promise or Error in the receiver. It exports every explicit argument, whose output contains no unresolved language Promise or Error. Imported receiver storage keeps its physical Promise.
- A method may finish synchronously or remain active through one direct Promise. All later work and input access must belong to that Promise and finish before settlement; detached work is forbidden.
- The caller's observation-or-mutation mode is a trusted assertion about the selected method. An observation method does not mutate its receiver; a mutating method changes only its isolated receiver. Exported managed argument data is independent and may be mutated, retained, stored in the receiver, or returned without changing its Cascada source. Exact Functions and external identities remain read-only as arguments and retain their boundary restrictions.
- Nested method calls are ordinary JavaScript on the prepared receiver, not another Cascada invocation. Methods do not change a traversable identity's prototype, descriptors, or extensibility.
- Cascada may copy managed receiver state for isolation. Argument export always copies managed records, Arrays, and class instances while preserving prototypes, Array structure, aliases, and cycles. Code relies on managed identity only while its invocation is active.
- After mutation, validate and admit the receiver and publish through the ordinary transition. A completed receiver contains neither Promise nor Error.
- Preparation poison, receiver validation failure, or method failure poisons a mutation receiver. Observation and independent-result failure affect only their result. A direct-Promise rejection preserves the rejection outcome after applying the corresponding graph effect.
- Import every managed-method result. Returning the mutation receiver returns its published identity; every other result keeps its admitted identities and gains ordinary shared ownership instead of being copied.

## Errors

Cascada distinguishes:

- **Error poisoning:** an Error is language data. Invalid logical input or supported user-code failure produces it. An Error assigned or explicitly returned remains an ordinary value and poisons neither a managed receiver nor an external guard. A rejected Promise stored in the graph publishes an Error at its captured version. Dependent work propagates it while unrelated work continues.
- **Fatal failure:** an unexpected runtime failure or violated internal or host contract is reported and rethrown.

- Classify failure at its exact boundary by what failed, not whether code threw or returned. Catch supported user code only there. Entering it through `run` does not make adjacent runtime code user-controlled.
- Preserve a produced value or Error unless its boundary consumes it. Required boundary processing may transform Promise fulfillment into the operation's logical result; rejection remains rejection. Never convert between poisoning and fatal failure.
- A representation limitation is not a logical failure. Materialize and retry; failure of required internal handling is fatal.
- An ordinary poisoned observation changes only its outcome. An external-containment violation also poisons its external container's selected phase, when one exists, without replacing application data. A poisoned mutation replaces the nearest replaceable logical value whose transition failed and returns the same Error.
- For a mutating call, preparation or method failure poisons the receiver placement or root. Failure confined to an independent result does not affect a successfully mutated receiver.
- One consumed Error propagates unchanged. Several produce one Error whose `errors` array contains every distinct original. Call order is receiver then arguments; order inside one composite input is unspecified.
- Rejecting managed work because it conflicts with indexed external state changes neither the index nor its phase.
- Poisoning external mutation changes guard state but cannot undo completed effects on the exact host identity.

## Work Bounds

These constrain implementation cost. A mechanism that inherently exceeds them should be replaced.

- Bound graph work and allocation to explicit inputs or paths, produced output, captured Promise frontier, and maintained dependencies. Do not process unrelated data.
- Build an index when first needed and maintain it incrementally. Never rescan indexed data to rediscover a maintained fact.
- Import visits a managed identity only when it first crosses inward and at most once during that import. Never rescan imported data for host changes.
- Occurrence-sensitive work may report several placements of one inspected identity but must still bound cycles and unrelated traversal.
- A managed call deliberately consumes its complete receiver graph. Bound its preparation, isolation, and finalization walks to that receiver and its explicit inputs.
- Cascada does not expect unusually large or deep graphs. Keep recursive walks and Number arithmetic; do not add explicit stacks or BigInt.

## Verification

- Prefer integration tests through public operations across meaningful synchronous and Promise interleavings.
- Cover sequential equivalence and owner isolation; lease and gate lifetimes; overlapping observations and mutation barriers; external ancestor, descendant, and sibling guards; nested external argument observations; and Promise fulfillment and rejection.
- Verify that ready and Promise-backed boundary results have identical admission outcomes, including admission Errors.
- Verify that importing an already admitted result skips graph traversal, including unexported data returned by another Cascada execution.
- Verify that export collects synchronous and Promise-revealed Errors at every depth, loses no distinct Error identity, combines within each root and then across failed argument roots, and never invokes host code with an Error.
- Verify that external-property traversal poisons the external container when it encounters admitted managed data, leaves both identities intact, and never inspects unrelated external properties.
- Verify unused, one-static-context-path, dynamic-path, outside-context, different-path, different-context-Chain, and mixed external use. Only the single compiler-static context path may mutate host code.
- Derive failure tests from boundary contracts, not existing catches. Cover each JavaScript action that can invoke user code and every distinct preparation and commit path.
- Use focused unit tests only for invariants that integration tests cannot observe. Never pin an interchangeable representation.

## Maintaining This Document

- Keep only cross-cutting contracts, load-bearing invariants, and stable mechanisms used by multiple source areas. Put operation mechanics in source comments and tests.
- Use source terminology and the most concrete rule that explains all affected code. Generalize only when it simplifies both rule and implementation.
- Describe accepted end-state behavior, not migration phases, audit history, or rejected alternatives; plans hold those.
- Compare every revision with the previous version. Remove superseded or contradictory text, verify that no constraint was lost, and keep the result concise.
