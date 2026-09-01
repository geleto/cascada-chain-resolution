# Core Runtime Contracts

[`docs/data-limitations.md`](docs/data-limitations.md) is the authoritative developer-facing contract for data and host code crossing the runtime boundary. Architecture sections below explain the mechanisms that enforce or rely on it.

## Core Contracts

- **Sequential equivalence.** Operations on an asynchronously available graph produce the same observable results and effects as if every value were ready and the operations ran sequentially. Every transition includes all earlier effects and no later ones.
- **Owner isolation.** Mutation through one owner never changes another owner's logical value. Explicit external mutation changes only host identities covered by its external authority and ordering.
- **Immutable Chain outputs.** Every value exposed by a Chain as output is immutable: later Chain work cannot change that logical value, and native code receives no mutable access to its source.
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
- Keep facts at their natural scope: admitted identity facts on the execution and identity, host declarations on host identities, property-version facts on mirrors, parent-key facts on placements, path facts on paths, and operation facts within the operation.
- Derive a fact where it is used. Persist it only when it cannot be recovered correctly or repeated derivation has a demonstrated material cost, and then at the narrowest correct scope.
- Validate application and host inputs, and validate language values when their semantics require it. Compiler-generated and runtime-internal control facts are trusted: copy them when retained, but do not add defensive shape checks or tests for malformed internal calls. An invalid internal fact is a runtime bug and remains fatal if ordinary processing encounters it.

## Execution Scope

Every Chain has an explicit execution, and related Chains share one. Admission, ownership, leases, mirrors, refcounts, and Promise-continuation state belong to that execution; an independent execution importing the same host identity creates independent graph state. Values cross between executions only through export followed by import. There is no ambient current execution, implicit private execution, or direct transfer of internal managed identities.

Identity declarations and managed-class registration are runtime-wide host configuration applied independently by each execution. Fatal reporting and the host-code re-entry guard are runtime-wide contracts. Immutable definitions and operation-local work do not belong to an execution.

## Immutable Chain Outputs

All data that leaves a Chain as a value is immutable. This is logical immutability, not `Object.freeze`: Cascada may share storage or copy later, but neither Cascada nor host code may change the value already exposed. An exact external receiver selected for an ordered mutation is operation state, not an output.

- A managed value retained as a Cascada result gains another owner. Mark it shared and use COW for later mutation. A value sent to native JavaScript follows export instead.
- A mutation-capable external identity is a path-bound capability, not a value. It may be called or accessed only through its fixed context Chain and path; direct extraction, host-input export, callback exposure, external assignment, and script return fail.
- Reading a property inside mutable external state returns a detached managed copy. Use export's synchronous graph-copy semantics: preserve Arrays, aliases, cycles, prototypes, and Functions while copying every traversable identity. The copy walk does not process Promises; a Promise selected directly as the property result resolves through ordinary boundary completion before copying, while a Promise reached inside the copied graph is invalid. The copies have managed admission and no external location or mutation authority, so their prototypes and methods must satisfy the managed-state contracts.
- An observation-only external identity may remain exact because Cascada never mutates it. Host code must treat it as read-only.
- Data sent to native JavaScript is exported: managed data is copied, Functions and observation-only external identities remain exact and read-only, and mutation-capable external identities are rejected.
- A runtime-controlled operation need not export values it merely stores, moves, or compares without inspecting their contents. It exports every value exposed to native or application code that can inspect it; for example, a host `sort` comparator receives one exported snapshot, while structural Array operations retain logical payload directly.

Apply this rule to:

- lookup and operation results retained outside their source Chain;
- explicit native-method arguments and controlled-callback inputs;
- values assigned to external properties;
- external-property observations; and
- script results.

## Language Graph

- **Inside the graph:** Roots and values reachable through placements. A placement is a logical `(container, key)` location holding one property version; a JavaScript property is only its physical representation. Ordinary placements are own enumerable string-keyed data properties. ArrayView placements may project shared backing storage.
- **Array structure:** Present canonical indexes are placements. Logical length and holes affect Array behavior but are not placements; other properties are outside the graph.
- **Outside the graph:** Symbols, non-enumerables, inherited properties, and prototypes are not placements and are not traversed as graph data.
- Creating a missing placement defines an own enumerable, writable, configurable data property and never follows the prototype chain.
- An own accessor or non-enumerable property is logically absent. Ordinary graph access neither invokes nor redefines it.
- A final read of an absent placement returns `undefined`. Traversing through an absent or `undefined` placement produces an Error. Reaching an Error propagates that same Error.
- Final assignment creates an absent placement; final deletion of one is a no-op. A mutation requiring an absent receiver or intermediate placement poisons the first failed placement.
- Assignment replaces, and deletion removes, an Error at the final placement without consuming it. An Error at the receiver or an intermediate placement still propagates.
- Path segments are String or Number operation inputs. Normalize and consume each only when traversal reaches it; any other ready value produces a validation Error without invoking coercion hooks. A failed known prefix does not wait for unused segments.
- The graph may be cyclic. Bookkeeping must neither alter nor hide its topology.

## Data Categories

Any graph root or placement may contain a Promise. Pending and ready values use the same logical path: an operation uses an available value or registers at its captured version and continues with the resolved value. Promise means asynchronous availability, not a separate admitted category.

Admission is the first classification of an available identity within one execution. The same host identity imported by another execution is admitted independently. Resolve callable thenables through their captured versions before admission. Acquisition or invocation failure is that captured Promise's rejection unless already fatal. Classification preserves Error and Function semantics first. An identity imported from observation-only external property state remains external, including a record or Array. A detached copy read from mutable external state is new managed data instead. An explicit external identity declaration may likewise make a record, Array, or class instance external. Otherwise logical Arrays retain Array semantics, records default to managed, and a class instance follows its explicit managed declaration, the managed-class registry, or the external default. Promise subclasses keep Promise semantics. An uninspectable object is admitted unchanged as external.

Declarations do not modify or admit an identity. They are persistent runtime-wide configuration for future admission in every execution and never reclassify an identity already admitted in an execution. Sampling a declaration input captures its thenability once; this availability fact is not category admission. Repeating a declaration is idempotent, while a conflicting declaration fails. Declaration APIs are used before their data enters Cascada. An external identity declaration overrides the managed record or Array default and any class rule; a managed identity declaration overrides the external class default. Records and Arrays passed to `managedState` are traversal roots and receive no redundant declaration. Declared external and uninspectable identities stop its walk; requesting managed state for one as the root fails. A declaration does not bind a prototype; each execution's admission records the prototype then present and fixes it with the category. Passing an Error to a declaration API preserves that exact Error without declaring it; an Error reached during a managed declaration walk ends only that branch. A managed copy inherits the source category and prototype within its execution without adding a declaration.

A controlled method consumes logical Cascada values. A host call crosses argument-export and result-admission boundaries. Observation-only external identities remain exact and are not graph-traversed; mutation-capable external identities remain receiver-only capabilities.

| Type | Supported execution | Boundary | Property writes |
| --- | --- | --- | --- |
| Managed record | Own function-valued properties as observational or mutating methods; no inherited methods | Managed call on a completely prepared receiver | Ordinary language writes; host mutation publishes through the receiver placement |
| Logical Array | Supported standard methods reproduce native behavior in matching mode; custom methods are unsupported | Controlled method | Ordinary language writes |
| String | Native observations only | Host call on the primitive | Unsupported |
| Managed class instance | Side-effect-free observations and receiver mutations through methods | Managed call on a completely prepared receiver; mutation isolates at invocation | Ordinary language writes; host mutation publishes through the receiver placement |
| External identity | Observations; explicit mutation only after exclusive use through one recorded context path | Host call on the exact receiver | Host-ready write only under that authority |
| Function | Stored as data; executable only in a supported function, method, or callback position | Defined by that position | Not a property container |
| Number, Boolean, BigInt, Symbol, `null`, or `undefined` | None | Not applicable | Unsupported |
| Promise | No direct execution; use the resolved value's capabilities | Determined by the resolved value | Determined by the resolved value |
| Error | None; see Errors | Not applicable | Not a property container |

## Identity Traversal

- An identity walk may inspect each reached identity once while preserving aliases and cycles.
- Identity deduplication must not erase occurrence facts. Work defined by placements or paths reports every relevant occurrence even when the identity was already inspected. Cycle handling bounds the walk without hiding finite paths.

Identity traversal is used by:

- import, copying, and graph validation, which need identity inspection; and
- initial context-tree construction, which searches only compiler-provided scope and property mutation paths without retaining managed alias or cycle topology.

## Refcount Indexing

- Refcounting maintains an acyclic projection by cutting parent-key placements. Cuts affect bookkeeping only, not graph behavior. Their positions and counter totals may depend on construction history and need not be canonical.
- Indexing is downward-closed: every traversable identity reached from an indexed identity is indexed, including through cuts, and a new traversable child is indexed before its edge is published.
- Direct host mutation must never change an indexed identity in place. Incremental index changes enter through ordinary placement transitions or replacement with a fresh identity.
- When counters cannot answer across a cycle cut, one operation may traverse the counter-selected cut region with one shared visited set. A separate pass may build a missing index.

## Ownership and Copy-on-Write

An owner is a placement or retained result that can independently preserve a logical value. A managed value is protected while it is permanently shared or temporarily leased; otherwise it may be mutated in place. External mutation is an ordered effect on an exact identity, not COW.

Managed data has copy semantics. Creating another logical occurrence of a managed value produces an independent value: later mutation through either occurrence cannot change the other. This rule is independent of runtime representation and when physical copying occurs. Reason about managed values as values, never as shared JavaScript references.

External data is the exception. Every occurrence denotes the same exact host identity, so mutation is an ordered effect on that identity rather than a change to an independent logical copy.

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

- managed argument roots, including traversable Promise fulfillments, while a pending receiver prevents boundary-specific capture; release them at the synchronous selection handoff;
- managed receiver preparation;
- a managed observation's complete prepared receiver through its direct Promise;
- a managed mutation's receiver until isolation;
- a controlled observation that resumes reading its receiver;
- delayed controlled Array observation results whose captured origins are not yet published;
- a logical Array `concat` item from capture through publication;
- read-only `enter` for its captured value;
- a path observation waiting for its first pending segment, at the longest resolved prefix; later segments reuse that lease.

External receivers use operation phases instead of leases. Mutation-capable external identities never leave their fixed path as operation inputs.

## Transition Gates

A transition gate orders a managed mutation that cannot publish its final value synchronously. It publishes an ordinary Promise version at the protected placement, keeps the working value private, and makes later access wait through the normal mirror and FIFO continuation rules. It does not preserve the old value; COW and leases do that.

Gates are used for:

- ordinary pending mutation at its final target while required values resolve;
- a managed mutation whose direct Promise keeps its receiver private;
- mutating `enter` until its callback and private commands finish;
- a path mutation waiting for its first pending segment, at the longest resolved prefix; later segments reuse that gate.

A ready mutation needs no gate. Path availability adds neither a lease nor gate when every segment is ready. A managed `!` prefix re-roots the ordinary mutation path there; it does not introduce whole-subtree copying. Before a mutation waits below a context prefix, register every live external phase selected from the static tree; the gate orders managed publication and the phases order exact external effects. If later resolution rejects external mutation authority, resolve that gate with its unchanged logical value rather than poisoning managed state. A Promise representing only an independent result is not a gate and extends no receiver or input protection; publish completed state immediately.

## External Operation Phases

A readers-writer phase orders access to an exact external identity, whose state cannot be protected by managed COW or transition gates. Consecutive observations share a read phase after the preceding exclusive operation; the next mutation or repair waits for the whole read phase and then runs exclusively.

- Append or join every phase synchronously when the operation is issued. Publish all of one operation's successor dependencies before waiting on any predecessor. Scopes created by one operation never wait on one another.
- Complete the operation's phase set before its first wait and never expand it afterward. A later-revealed mutation-capable receiver must match an already selected boundary or fail before host access.
- After publishing the complete phase set, synchronously advance hook-free ordinary preparation to its first pending point. Capture current managed property versions and a ready external boundary exactly, and start required input export before waiting. Later work resumes from these captures rather than rereading source state or retraversing a managed prefix.
- After predecessors and captured graph readiness, validate each selected live leaf against its exact identity. A changed live binding is fatal.
- Existing waiters keep their captured predecessor when a successor becomes current. A completed read phase is not reused.
- An observation captures already-published poison when it joins and poison from its exclusive predecessor before it runs. Poison produced by one observation does not retroactively affect peers already issued in the same read phase; later observations and the next exclusive successor see it.
- A direct operation Promise keeps its phase active through its final boundary processing. A nested result Promise does not.

External phases are selected from an exact external identity or through a context path in the static external mutation tree. An entered contextual Chain inherits the source execution and the mutation tree rooted at its selected branch, so it uses the same contextual operations as its source. A mutating entry's branch gate excludes outside access until publication; read-only entry relies on the containing Cascada runtime's command ordering. Managed values use leases and gates rather than external phases.

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

When importing a context root, its Chain may supply the compiler's complete mutation-path set for all code that may use that Chain to the same boundary internally. The paths are String/Number prefixes selected by `!` and String/Number assignment and deletion targets. An absent or empty set performs ordinary import and builds no external mutation tree.

Chain construction from an existing Cascada value, assignment, lookup, and internal transfer within one execution do not cross the boundary and therefore do not import; they preserve admission and origin. Values move between independent executions only through export followed by import.

- Validate each reached synchronous import segment before committing origin, sharing, or Promise mirrors. A boundary failure commits none of that segment.
- Traverse managed state once while preserving aliases and cycles; stop at Errors, Functions, and external identities. Containment neither grants nor removes origin.
- Metadata in the current execution identifies an already admitted value. Ordinary import retains such a managed result without traversing it again and marks its root shared when the result adds an owner. Metadata from another execution is invisible. A managed mutation result is different: arbitrary receiver mutation may detach an admitted container while retaining its descendants, so its import traverses the retained managed graph and marks every reached managed identity shared. A new host-produced managed identity becomes imported and shared.
- A property read through observation-only external state uses ordinary import, so a newly reached identity remains external even when it is a record or Array. A read inside mutable external state instead copies the ready reached graph under its observation phase using export's synchronous graph-copy semantics and admits the copies as managed data. A direct property-result Promise completes before that copy; a nested Promise is invalid. Traversable source identities and external authority never escape; prototypes and Functions are preserved. External state may contain only external state. If property traversal encounters an already admitted managed identity, poison that external container without replacing either value. Do not scan external state to search for this violation. A host call may instead return admitted managed data because its result crosses a separate import boundary rather than remaining external property state.
- Host-call result import rejects any mutation-capable external identity. An external call also rejects its exact native receiver when it appears in traversable result data. Other opaque external objects must not hide aliases into mutable receiver state.
- Application and host code must not mutate managed data after passing it to Cascada. Imported storage is borrowed and never modified; metadata and logical Promise settlement remain outside it.
- Mutable live host state must be external and accessed through ordered external operations.
- Cascada never creates non-extensible managed data. Such data must enter through import; do not infer import from non-extensibility or add frozen-specific behavior.

### Export

Export produces host-ready data independent from managed storage. It resolves required availability, removes runtime representations, copies managed records, Arrays, and class instances while preserving aliases, cycles, and admitted prototypes, and keeps Functions and observation-only external identities exact. It rejects mutation-capable external identities. One boundary operation exports its ordered roots as one graph with one identity map, preserving aliases across input positions while keeping Error collection separate per root. A controlled operation that invokes one host callback repeatedly prepares one shared exported snapshot for those invocations.

Export is used for:

- explicit arguments passed to any native JavaScript method, including managed, external, and native methods;
- declared inputs passed to a host callback by a runtime-controlled method;
- values assigned to external properties;
- script results.

Export never sends an Error to host JavaScript. Each root is one Error-collection domain. After reaching an Error at any depth, export still completes that root's captured frontier and collects every distinct Error identity beneath it. One Error becomes the root outcome unchanged; several become one compound Error containing them all. A batch export combines every failed root outcome in root order without flattening or losing its component Errors. Any failed root prevents host invocation or assignment and replaces a script result.

Export uses no managed source lease. Each transition copies every ready placement synchronously; a pending placement is captured through its exact mirror, and its FIFO continuation traverses each newly revealed branch synchronously once. Later work never rereads already captured source state. Host code may retain exported copies, exact Functions, and observation-only external identities, but not their managed sources. Exact identities remain read-only. Export never transfers external mutation authority.

Export follows the common operation lifecycle. Closing releases partial output state. A reached Error discards output copies but does not close the operation until its required Error scan finishes.

## Boundary Completion

An operation crossing a boundary is complete only after required admission, validation, copying, and publication. Ready and Promise-backed results follow the same completion rule.

- A ready result completes its import, validation, copying, and publication synchronously.
- A direct Promise is adopted by the operation's one result Promise. Its fulfillment first completes the same processing and becomes the logical value or boundary Error; rejection remains rejection. Never detach or discard that processing.
- A Promise nested inside a synchronous inbound result is independent result data. It does not extend the producing invocation, leases, or phases, though its placement continues its import and mirror rules. A later boundary that consumes that placement, including export, follows its captured version and may wait for it. A detached property copy from mutable external state is the exception: its synchronous copy walk rejects a nested Promise.

Boundary completion applies to:

- imported Promise roots;
- host-call results;
- external-property reads;
- managed direct-Promise results;
- host-input exports; and
- script-result exports.

Managed receiver finalization and external phases remain active until completion.

## External Authority

External identities are observation-only by default. An identity may be mutated only when initial synchronous context import found it under one of that Chain's compiler-provided scope or property mutation paths and recorded it in the static external mutation tree. The tree is a positive mutation-authority index, not a live copy of the managed graph.

- A `!` candidate searches its selected managed scope for first external boundaries. An assignment or deletion candidate follows only the containing path and never scans the old target. Reaching external state while following either path records its first boundary and stops its opaque suffix.
- Build the tree atomically with the initial import segment. Stop discovery at Promises, Errors, Functions, and external identities.
- Cut cycle backedges. Preserve distinct finite occurrences reached through acyclic aliases; later use through an omitted cyclic alias is rejected by the identity-use rule.
- Promise fulfillment and later graph changes add no leaf. Do not maintain alias, cycle, COW, Array-remap, assignment, deletion, or `enter` topology in the tree.
- Each live leaf is one location. It is unique to its root ContextChain and normalized path, and entered contextual Chains retain that same leaf. Mutation requires the live leaf. Promise-valued operation paths use it after resolving their segments under protection registered from the ready prefix.
- Managed assignment adds an owner. Later managed mutation through either placement uses ordinary COW, preserving the other placement and its live leaves without tree maintenance.
- A controlled graph replacement, deletion, or Array remap that would remove, replace, hide, or relocate a live leaf produces an Error before publication. Managed host methods must preserve every live leaf at its recorded path and identity; a detected host-contract violation is fatal.
- External identities remain exact through managed copies. Another stored reference gains no authority; actual external use through it follows the identity-use rule below.

One execution-scoped `WeakMap` records every external identity present in a static tree and recognizes that identity through later aliases across all Chains. Tree construction creates or reuses its entry without selecting a use location; actual use changes its `use` field from:

- unset before first use;
- one selected live leaf; or
- permanent conflict with the first stable incompatibility reason.

Import, storage, assignment, return, and copying are not uses. A direct lookup that would expose a mutation-capable external identity fails and records no use. A call or property operation through an external boundary is actual use. The first use must occur at one live location and selects it. Any first use elsewhere, or later use through another path or Chain or through an alias at another location, creates permanent conflict, performs no host access, and returns an Error explaining the first incompatible use. Repair cannot clear conflict.

Evaluate all use proposals of one operation from one pre-operation state. If any conflict exists, commit every discovered permanent conflict but no compatible new location. Otherwise commit every new location together immediately before host access. Report conflicts in deterministic receiver and path order; iteration order never grants partial authority.

The common tree query checks identity state before returning a leaf. If it is already conflicted, remove only that queried leaf and return no mutation candidate. Other leaves prune themselves when queried; keep no reverse leaf index or tree scan. Already-issued operations retain their captured state. An external identity absent from every tree is observation-only and may cross locations exactly under the immutable-output contract.

One host resource that Cascada may mutate must have one external identity and one Cascada access location. Hidden sharing between external roots and independent host mutation remain host-contract violations.

## External Guards

External guards apply common readers-writer phases to exact host identities. They order state that managed COW, leases, and gates cannot protect.

- Every context-path call or property operation queries its complete receiver or target path for an exact external boundary or first boundary prefix. Unmarked access observes. `!` and repair select exclusive access. Consecutive observations share a read phase after the preceding exclusive operation; exclusive work waits for that group.
- Register all synchronously known receiver, live mutation-scope, and repair phases at issuance. Merge by identity, let exclusive access win, publish every successor before waiting, and never add a phase later.
- Enter the selected phase before reading a proxy, descriptor, getter, property, or method. Finish required graph and export preparation before any such host work.
- A marker inside opaque external state clamps to the first external boundary. A managed prefix keeps ordinary managed isolation and selects live external descendants only for the declared external host effect. Managed methods receive no implicit authority over opaque descendants.
- Broad external mutation scopes include only live tree leaves. Pruning one sibling deliberately leaves the remaining scope usable. Host mutation of a conflicted, pruned, or otherwise unselected identity is a host-contract violation.
- A direct operation Promise retains phases through boundary completion. A nested result Promise does not.
- Operations on an entered contextual Chain use the original static tree rooted at its selected branch without copying or updating it.

External guards are used by:

- external receiver calls and property operations;
- external leaves selected by a broader declared mutation scope;
- repair.

## Guard Poison and Repair

Guard poison belongs to a selected external identity's execution-scoped phase state, not application data, graph metadata, or the external object. Poisoning never replaces a placement with an Error. Each phase completion carries the repairable poison visible after that phase, so successors observe their captured predecessor rather than later state.

- Existing poison contributes an Error at the selecting receiver. Required preparation continues, host code is skipped, and the operation preserves that poison.
- Ordinary observation failure releases its phase without poisoning. Reaching admitted managed data inside external property state poisons the selected boundary.
- Mutation failure or rejection publishes its combined Error through every selected mutation-phase completion. Completed host effects remain visible.
- Repair-only bypasses and clears repairable predecessor poison at an existing selected location, performs no host access, and returns `undefined`. Repair-and-call bypasses old poison, then clears it on call success or publishes the new mutation Error.
- Only repair-only and repair-and-call clear external phase poison. Assignment and deletion naturally remove an Error at their final managed placement, but they do not implicitly repair poison belonging to an external phase.
- Repair never creates authority, changes the chosen location, or clears permanent conflict.

- Select the operation boundary first from runtime-controlled facts such as admitted category, method name, and mode. This internal dispatch invokes no host code. Prepare each input only to the extent that boundary consumes it. Continue required preparation after an Error to collect the rest, but do not invoke the selected function, accessor, callback, or method. Nested Errors matter only when required preparation reaches them.
- An operation input that the selected boundary never consumes, including an unused path segment, remains host-owned. Do not wait for it or attach a rejection observer merely to suppress host reporting. While receiver selection is pending, explicit call arguments are provisionally consumed only at root availability so a later selected boundary can preserve their captured values; this performs no traversal or export. If the receiver is ready and internal dispatch rejects the call, no argument is consumed.
- If internal dispatch rejects a constructor, controlled name, or mode before selecting an executable boundary, perform no boundary-specific receiver or argument preparation and return only that validation Error.
- A value selected for invocation is prepared and validated as an executable, not imported as graph data. Import applies to a property-read result or invocation result that enters the graph.
- External phase predecessors and the selected boundary's explicit input preparation may settle concurrently after all phase successors are published. Both must finish before proxy reflection, descriptor access on application-controlled objects, a getter, or other host method-selection code. If preparation prevents invocation, execute none of that host code; order collected failures by their logical receiver and argument positions. Do not confuse this host reflection with the earlier hook-free internal dispatch and input capture.
- Controlled Array table lookup and trusted native String lookup are internal dispatch and remain early because neither invokes an application hook in the supported runtime. String selects only Function-valued data properties from stable `String.prototype` and `Object.prototype`; it never invokes an accessor during selection. Dynamic record, managed-class, and external member resolution happens after preparation.
- Native JavaScript calls export every explicit argument. Runtime-controlled methods resolve only declared logical inputs; when one invokes a host callback, it exports the complete callback argument list as one graph. Mutation-capable external identities fail export. Retained payload remains unchanged, including an Error or Promise. A rejected retained Promise poisons its eventual placement, not the retaining call. Controlled methods may return internal representations such as ArrayViews.
- A controlled callback receives only its declared exported inputs. It may mutate or retain exported managed copies, but Functions and observation-only external identities remain exact and read-only. It must not access an unexported managed source or reenter Cascada.
- A controlled callback position that must remain synchronous rejects a direct Promise result. Its declared result contract determines validation and conversion. Import the result only when it enters the graph as host data; a result consumed entirely by the controlled algorithm does not cross that boundary.
- A logical Array supports only names in the controlled method table, which always select the controlled operation. Every other name is unsupported. Never inspect a custom Array method surface.
- Controlled Array methods do not consult application method or protocol surfaces. They assume standard Array primordials and prototype behavior remain unmodified. Trusted native String dispatch likewise assumes stable `String.prototype` and `Object.prototype`.
- Controlled methods avoid copying and materialization where possible. A special path must provide a material benefit while preserving every logical value.
- Host code may mutate or retain exported managed argument copies without changing Cascada source data. Exact Functions and observation-only external identities remain read-only. Mutation-capable external identities never reach an argument position. A host observation must not mutate its exact receiver, while host mutation may change only external identities selected by its scope.
- External writes complete export before native assignment or setter execution; any reached Error prevents the write. A native setter must finish synchronously.
- Host code may retain exported copies, Functions, and observation-only external identities. It receives no mutation authority beyond active external receiver phases, and later independent mutation is a host-contract violation while Cascada may use the resource.
- Host calls, controlled callbacks, and reflection hooks must not issue Cascada operations while active, including work represented by a direct Promise. A nested result Promise must not later access or expose an invocation-owned receiver. The managed structure of an exported copy may outlive the call. Trusted runtime control-flow callbacks such as `enter` follow their own contracts.

## Managed Methods

- Declare a managed class before ordinary admission of its instances. A detached copy read from mutable external state may instead validate and adopt its source prototype for that copy only; it does not change the class default. Classification is otherwise fixed at first admission within the execution.
- Internal dispatch selects a managed boundary from admitted category, method name, and mode without member reflection. Complete receiver preparation and explicit-argument export before resolving a member; failed preparation performs no post-preparation method-placement read, prototype descriptor traversal, callable test, or invocation.
- A managed record then resolves its own enumerable method placement from the prepared record and tests callability. Accessors, non-enumerables, inherited properties, extracted Functions, and the globally reserved `constructor` name are not record methods. `run` rejects that name before selecting an executable boundary, keeping constructor handling category-independent. A managed class selects from its admitted prototype chain up to, but excluding, `Object.prototype`. Its prototype chain must satisfy the accessor-free managed-class contract when admitted, and application code must not change it afterward.
- Resolve a managed member once from the prepared receiver before mutation isolation. Isolation preserves that member and the admitted prototype and does not repeat resolution.
- Managed classes expose semantic state only through own enumerable string-keyed data properties. Every managed method keeps mutable semantic state in `this` and receives other state through explicit arguments; it must not depend on mutable parent, closure, module, private-field, Symbol, non-enumerable, accessor, or internal-slot state.
- Managed state may contain primitives, records, logical Arrays, managed classes, external identities, Functions, aliases, cycles, Promises, and Errors.
- External identities inside a managed receiver are opaque leaves. A managed method may retain or compare them but may not inspect or mutate their host state. It may return or expose an observation-only identity. A mutation-capable identity cannot leave its fixed path and must not be moved, replaced, or removed from a live context-tree leaf. Select external state as a receiver in a separate Cascada operation to access it.
- Preparation consumes the complete receiver graph, resolves every receiver Promise through captured versions, and provides no Promise or Error in the receiver. It exports every explicit argument, whose output contains no unresolved language Promise or Error. Imported receiver storage keeps its physical Promise.
- A managed method may finish synchronously or remain active through one direct Promise. Later receiver access and any inspection of read-only observation-only external inputs must belong to that Promise and finish before settlement. The managed structure of exported argument copies may be retained independently.
- The caller's observation-or-mutation mode is a trusted assertion about the selected method. An observation method does not mutate its receiver; a mutating method changes only its isolated receiver. Exported managed argument data is independent and may be mutated, retained, stored in the receiver, or returned without changing its Cascada source. Exact Functions and observation-only external identities remain read-only as arguments; mutation-capable external identities fail export.
- Nested method calls are ordinary JavaScript on the prepared receiver, not another Cascada invocation. Methods do not change a traversable identity's prototype, descriptors, or extensibility.
- Cascada may copy managed receiver state for isolation. Argument export always copies managed records, Arrays, and class instances while preserving prototypes, Array structure, aliases, and cycles, and rejects mutation-capable external identities. Code relies on managed identity only while its invocation is active.
- After mutation, validate and admit the receiver and publish through the ordinary transition. A completed receiver contains neither Promise nor Error.
- Preparation poison, receiver validation failure, or method failure poisons a mutation receiver. Observation and independent-result failure affect only their result. A direct-Promise rejection preserves the rejection outcome after applying the corresponding graph effect.
- Import every managed-method result. Returning the mutation receiver returns its published identity. An observation result uses ordinary import. Every other mutation result uses managed mutation-result import, which keeps admitted identities and marks the reached managed graph shared so receiver/result aliases gain shared ownership without result copying or provenance state. Any result that would expose a mutation-capable external identity fails.

## Errors

Cascada distinguishes:

- **Error poisoning:** an Error is language data. Invalid logical input or supported user-code failure produces it. An Error assigned or explicitly returned remains an ordinary value and poisons neither a managed receiver nor an external guard. A rejected Promise stored in the graph publishes an Error at its captured version. Dependent work propagates it while unrelated work continues.
- **Fatal failure:** an unexpected runtime failure or violated internal or host contract is reported and rethrown.

- Classify failure at its exact boundary by what failed, not whether code threw or returned. Catch supported user code only there. Entering it through `run` does not make adjacent runtime code user-controlled.
- Preserve a produced value or Error unless its boundary consumes it. Required boundary processing may transform Promise fulfillment into the operation's logical result; rejection remains rejection. Never convert between poisoning and fatal failure.
- A representation limitation is not a logical failure. Materialize and retry; failure of required internal handling is fatal.
- An ordinary poisoned observation changes only its outcome. An external-containment violation also poisons its external container's selected phase, when one exists, without replacing application data. A poisoned mutation replaces the nearest replaceable logical value whose transition failed and returns the same Error. A transition cannot replace a scope when doing so would remove a live external leaf.
- For a mutating call, preparation or method failure normally poisons the receiver placement or root. Ordinary COW preserves live leaves reached through other managed placements. If failure publication at the authoritative placement would remove a live leaf, preserve the original scope and return the Error instead. Failure confined to an independent result does not affect a successfully mutated receiver.
- One consumed Error propagates unchanged. Several produce one Error whose `errors` array contains every distinct original. Call order is receiver then arguments; order inside one composite input is unspecified.
- Rejecting managed work because it would disturb a live external leaf changes neither the static tree nor the leaf's phase.
- Poisoning external mutation changes guard state but cannot undo completed effects on the exact host identity.

## Work Bounds

These constrain implementation cost. A mechanism that inherently exceeds them should be replaced.

- Bound graph work and allocation to explicit inputs or paths, produced output, captured Promise frontier, and maintained dependencies. Do not process unrelated data.
- Build a live graph index when first needed and maintain it incrementally. Never rescan indexed data to rediscover a maintained fact. The static external mutation tree is instead built once from compiler-provided scope and property mutation paths during context import and may only prune conflicted leaves.
- Ordinary import visits a managed identity only when it first crosses inward and at most once during that import. Initial context-tree construction examines only those paths or their selected subtrees; it does not reclassify admitted nodes, inspect unrelated context data, or rescan for host changes.
- Occurrence-sensitive work may report several placements of one inspected identity but must still bound cycles and unrelated traversal.
- A managed call deliberately consumes its complete receiver graph. Bound its preparation, isolation, and finalization walks to that receiver and its explicit inputs.
- Cascada does not expect unusually large or deep graphs. Keep recursive walks and Number arithmetic; do not add explicit stacks or BigInt.

## Verification

- Prefer integration tests through public operations across meaningful synchronous and Promise interleavings.
- Cover sequential equivalence and owner isolation; immutable Chain outputs; lease and gate lifetimes; overlapping observations and mutation barriers; external ancestor, descendant, and sibling guards; mutable-external extraction rejection and property snapshots; and Promise fulfillment and rejection.
- Verify that ready and Promise-backed boundary results have identical admission outcomes, including admission Errors.
- Verify that ordinary import of a result already admitted in the current execution skips graph traversal. Verify that metadata from another execution is invisible and that export/import is the only supported crossing. Verify separately that managed mutation-result import protects descendants still reachable from the receiver.
- Verify that export collects synchronous and Promise-revealed Errors at every depth, loses no distinct Error identity, combines within each root and then across failed argument roots, and never invokes host code with an Error.
- Verify every immutable-output route: managed results gain independent ownership; mutation-capable external identities fail direct extraction, host-input export, callback exposure, external assignment, and script return; and mutable-external property copies preserve Arrays, aliases, cycles, prototypes, and Functions while admitting every copied traversable identity as managed data. A direct property Promise resolves before copying, while a nested Promise fails the copy without creating a mirror.
- Verify that controlled operations retain uninspected payload without needless export, while every callback- or host-visible value uses export.
- Verify that external-property traversal poisons the external container when it encounters admitted managed data, leaves both identities intact, and never inspects unrelated external properties.
- Verify unused, one-context-path, different-path, different-context-Chain, copied alias, Promise-revealed alias, and mixed external use. Only the selected context location may access a mutation-capable identity; conflicts perform no host work.
- Derive failure tests from boundary contracts, not existing catches. Cover each JavaScript action that can invoke user code and every distinct preparation and commit path.
- Use focused unit tests only for invariants that integration tests cannot observe. Never pin an interchangeable representation.

## Maintaining This Document

- Keep only cross-cutting contracts, load-bearing invariants, and stable mechanisms used by multiple source areas. Put operation mechanics in source comments and tests.
- Use source terminology and the most concrete rule that explains all affected code. Generalize only when it simplifies both rule and implementation.
- Describe accepted end-state behavior, not migration phases, audit history, or rejected alternatives; plans hold those.
- Compare every revision with the previous version. Remove superseded or contradictory text, verify that no constraint was lost, and keep the result concise.
