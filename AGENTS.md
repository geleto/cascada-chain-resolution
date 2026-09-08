# Core Runtime Contracts

[`docs/data-limitations.md`](docs/data-limitations.md) is the authoritative developer-facing contract for data and external code crossing the runtime boundary. Architecture sections below explain the mechanisms that enforce or rely on it.

## Core Contracts

- **Sequential equivalence.** Operations on an asynchronously available graph produce the same observable results and effects as if every value were ready and the operations ran sequentially. Every transition includes all earlier effects and no later ones. The narrowly enumerated Error-output and invalid-input detection exceptions in `docs/data-limitations.md` do not relax successful data or effect ordering.
- **Owner isolation.** Mutation through one owner never changes another owner's logical value. Explicit external mutation changes only host identities covered by its external authority and ordering.
- **Immutable Chain outputs.** Every value exposed by a Chain as output is immutable: later Chain work cannot change that logical value, and native code receives no mutable access to its source.
- **Imported-data protection.** Imported data is never modified, except when an explicitly requested mutation operates on that exact external identity.
- **Non-blocking issuance.** An operation processes available work and returns a value or Promise. It need not settle before the next operation is issued.

## Design Method

The mechanisms below preserve these contracts. Reuse them before adding state or another execution path:

- synchronous transitions make all available progress immediately;
- FIFO continuations preserve program order across Promise settlement;
- property versions and placement overlays preserve captured logical values;
- ownership and copy-on-write preserve values held elsewhere;
- leases protect managed values without blocking later mutation;
- transition gates order unfinished managed mutation;
- readers-writer phases order observations and mutations;
- boundary processing controls identities crossing between Cascada and external code.

Core contracts, type capabilities, execution boundaries, and Error/fatal classification are semantic architecture. Change them only through an explicit architecture revision. Metadata layout, helper boundaries, refcount projections, and counter totals are implementation choices.

- Prefer one general transition over parallel paths, flags, adapters, or deferred cleanup when cases share the same state change. Split only when behavior or invariants differ, and remove the superseded path in the same change.
- Keep facts at their natural scope: admitted identity facts on the execution and identity, host declarations on host identities, property-version facts on placement overlays, parent-key facts on placements, path facts on paths, and operation facts within the operation.
- Derive facts where used. Persist one only if correct derivation is impossible or repeated derivation has a demonstrated material cost; use the narrowest correct scope.
- Validate application and external inputs. Validate language values as their semantics require. Trust compiler-generated and runtime-internal control facts: copy retained facts, but add no defensive shape checks or malformed-call tests. Invalid internal facts encountered within a valid operation remain fatal runtime bugs; malformed root integration calls may throw ordinary JavaScript programming errors under the [support boundary](#support-boundary-and-proportionality).

## Support Boundary and Proportionality

This runtime enforces documented correctness under [`docs/data-limitations.md`](docs/data-limitations.md). It is not a security boundary against deliberate corruption of its programming interfaces.

Unsupported corruption is usually obvious. It includes changing admitted prototypes mid-flight; mutating exported constructors, shared prototypes, or standard primordials required to stay stable; forging or subclassing runtime Errors or control types; fabricating internal control records; calling trusted integration methods directly; omitting required compiler or runtime arguments; corrupting private-looking state; and supplying thenables, Proxies, external identities, or managed classes that violate their ordering, stability, mutation, or storage contracts. Misuse may throw ordinary JavaScript exceptions, fail classification, or leave that execution unusable. Do not defend it with tokens, brand registries, defensive clones, frozen shared prototypes, repeated integrity checks, compatibility adapters, special diagnostics, or dedicated tests; that turns a programming API into a tamper-resistant capability system by accident.

Handle invalid application data, external throws and rejections, fallible Proxy or reflection behavior at supported boundaries, Promise timing, resource lifetime, cross-execution isolation, and runtime defects escaping valid operations. Each defense must protect a named semantic invariant at a cost proportional to the realistic risk.

A courtesy defense for deliberate misuse is acceptable only inside one boundary already on the path, with no retained state, concept other code must maintain, or semantic or public surface. It must be removable without changing a contract. Do not document it as supported or pin it with a test. Otherwise document the misuse as unsupported and delete the defense.

Tests prove supported semantics and load-bearing invariants, not graceful behavior for excluded misuse. Revisit this boundary explicitly if Cascada ever becomes a sandbox or accepts mutually untrusted extensions.

## Work Bounds

Replace mechanisms that inherently exceed these work bounds.

- Bound graph work and allocation to explicit inputs or paths, produced output, captured Promise frontier, and maintained dependencies. Do not process unrelated data.
- Build a live graph index when first needed and maintain it incrementally. Never rescan indexed data to rediscover a maintained fact. The static external mutation tree is instead built once from compiler-provided scope and property mutation paths during context import and derives current authority from shared binding entries without pruning or moving leaves.
- Ordinary import visits a managed identity only when it first crosses inward and at most once during that import. Initial context-tree construction examines only those paths or their selected subtrees; it does not reclassify admitted nodes, inspect unrelated context data, or rescan for host changes.
- Occurrence-sensitive work may report several placements of one inspected identity but must still bound cycles and unrelated traversal.
- A managed call deliberately consumes its complete receiver graph. Bound its preparation, isolation, and finalization walks to that receiver and its explicit inputs.
- Cascada does not expect unusually large or deep graphs. Keep recursive walks and Number arithmetic; do not add explicit stacks or BigInt.

## Execution Scope

Every source operation has an explicit execution; each Chain is initialized and used within one execution shared by related Chains and operations. Admission, ownership, leases, placement versions, refcounts, and Promise-backed property state are execution-local, even when independent executions import the same host identity. Managed values cross executions only through export then import. External code may supply one exact external identity to several executions, but they do not coordinate it: a mutation-capable identity must belong to only one execution. There is no ambient current execution, implicit private execution, or direct transfer of internal managed identities.

Identity declarations and managed-class registration are runtime-wide host configuration applied independently by each execution. An execution owns its first fatal outcome, reports it once, captures its reporter immutably at creation, and exposes fatal state to operation work and result boundaries. It retains reject actions only for currently pending operation results, never settled-result history.

One execution-local Boolean tracks synchronous external-action activity, is restored on return or throw, and never spans a Promise boundary. Reporter routing, report idempotence, and re-entry control use no mutable module-global state. A fatal closes another execution only if its `FatalError` reaches that execution's boundary. Immutable definitions and operation-local work do not belong to an execution.

## Operation Context

Every semantic source operation carries one immutable context containing its execution and source-error context, including Chain initialization and boundaries without a Chain. Nested operations may have different contexts even on one source line. Attribute failures to their exact causal boundary, including after deferred work. Later consumers preserve that source unless they cause a new failure. Wrapping and collection follow [Errors](#errors); JavaScript Error identity alone does not determine attribution. Async diagnostic routes may supplement the causal source but never replace it.

The source-error context is opaque to graph code, regardless of compiler fields such as source path, line, column, or operation. Pass the operation context through operation work; unwrap its execution only to access execution-owned state or validate a Chain's execution binding. Mutable invocation, export, query, and mutation state belongs to operation work, not its context.

Trust the Chain binding, required operation context, and entered-Chain open state as kernel integration facts. The common `runInternalStep` entry reads the required execution and throws its existing fatal before work, without validating malformed or omitted internal arguments. A malformed root call therefore throws an ordinary JavaScript programming error, not a contextless fatal. The same defect escaping a valid operation reaches its enclosing fatal-on-escape guard. Helpers and continuations trust their context without repeating entry checks; continuations skip work when the execution has failed or local ownership has closed. Chain/execution mismatch and new issuance through a closed entered Chain remain fatal at their existing boundaries before graph or external-authority access, protecting isolation and capabilities. Missing source-location fields are harmless; application values still receive ordinary validation.

Operation contexts are used by:

- Chain and context-root initialization;
- import and every path, call, entry, export, and Error-query operation;
- supported-thenable recognition and continuation registration;
- external-boundary result and rejection handling; and
- continuations registered by those operations.

## Operation Work Lifetimes

Shared settlement advances Promise mirrors, property versions, and required bookkeeping. Operation work finishes one issued operation. In a live execution, the synchronous transition determining its final outcome closes work before exposing that outcome, without cancelling settlement needed elsewhere. Unfinished components skip work when they next resume; closing triggers no event or cancellation. A fatal execution's graph is unobservable and needs no further settlement.

- Finality requires the Error handling, boundary processing, and effects promised by the result contract; see [Boundary Completion](#boundary-completion). Reaching data Error alone does not close work: `hasError` may finish with `true`, while `getErrors` and export must finish Error collection. Graph-Promise rejection becomes data Error; internal rejection remains fatal.
- The direct result retains every unfinished transition that can change its specified result or an effect promised complete on delivery, even if that transition produces no returned value. An independent nested result Promise does not extend operation work. A sibling abandoned after a proved short-circuit result is independent once it cannot change that result. An issuance outcome never proves gated publication complete.
- Continuations check execution failure before shared settlement. In a live execution, they complete shared settlement, including index maintenance required for publication into an already indexed graph, before checking the local owner and doing operation work. Operation-only index construction and traversal stop after local closure.
- Internal query traversal, refcounting, or indexing failure is fatal. Supported reflection failure on a user-controlled identity is query failure, not graph Error data: ready `hasError` and `getErrors` return `QueryReflectionFailed` poison; pending queries fulfill with it. `hasError` does not convert it to `true`; `getErrors` neither collects it nor returns an Array. Supported failure during shared property publication follows that publication boundary.
- Each operation has one owner with an explicit Boolean open fact and idempotent `close()`. Existing operation state implements this contract directly, without a wrapper. Concurrent components share the owner; component success does not close it. The coordinator closes after required final processing and publication. Unfinished siblings return at their next local-owner check; resources with different last-access points keep their own release rules.
- Release operation-only strong state no unfinished result can use, including values collected by unfinished aggregates. A nested component with independently stored operation-only resources registers one synchronous, idempotent, non-throwing release with the owner and unregisters it on normal completion. Pending nested resources reuse that owner and register release before control returns. Ready work allocates no release-registry state. Release registration neither tracks nor cancels work.
- All operation-specific pending registration uses guarded continuation helpers; callers never manually register unguarded operation work.
- Operation owners are never registered with the execution and carry no fatal-reject action. Each public kernel operation uses one sync-first outward return boundary, registering one removable fatal reject action only while its result is pending. Core work, guarded composition helpers, internal waits, constructors, and contextless configuration add none. Cascada uses only the documented public package API, including its shared Error factories and guarded higher-runtime composition facilities, never unwrapped graph operations. A higher-runtime operation with additional required work owns its completion; aliases delegating an existing public result do not wrap it again.
- The lifetime mechanism receives already classified results and never classifies poison or fatality. Detecting and observing fatality follow [Errors](#errors). Leases, export output, Error collection, gates, phases, and publication keep their own lifetimes and storage. Do not build a task-cancellation system.
- Export output has a separate lifetime: handing completed copies to a caller or discarding them ends output work without closing a shared operation. Discarding copies because of language Error leaves required Error collection running. Local closure in a live execution stops unfinished export traversal after shared settlement; fatal resumption stops before either.

## Language Graph

- **Inside the graph:** Roots and values reachable through placements. A placement is a logical `(container, key)` location holding one property version; a JavaScript property is only its physical representation. Ordinary placements are own enumerable string-keyed data properties. ArrayView placements may project shared backing storage.
- **Array structure:** Present canonical indexes are placements. Logical length and holes affect Array behavior but are not placements; other properties are outside the graph.
- **Outside the graph:** Symbols, non-enumerables, inherited properties, and prototypes are not placements and are not traversed as graph data.
- Creating a missing placement defines an own enumerable, writable, configurable data property and never follows the prototype chain.
- An own accessor or non-enumerable property is logically absent. Ordinary graph access neither invokes nor redefines it.
- A final read of an absent placement returns `undefined`. Traversing through an absent or `undefined` placement produces an Error. Reaching an Error propagates that same Error.
- Final assignment creates an absent placement; final deletion of one is a no-op. A mutation requiring an absent receiver or intermediate placement poisons the first failed placement.
- Assignment replaces, and deletion removes, an Error at the final placement without consuming it. An Error at the receiver or an intermediate placement still propagates.
- A successful non-Promise language-data result must be safe under native Promise resolution. Ready assignment returns and publishes `PropertyValidation` for a callable own `then` placement; Promise-backed publication applies the same rule on fulfillment. Completed managed mutation validates the native `then` lookup of every traversable receiver identity, including non-enumerable own properties, Array non-index properties, and inherited descriptors; a callable data property or accessor produces `InvalidManagedReceiver` without invoking the accessor. Managed-class declaration and snapshot adoption reject callable or accessor `then` on the retained prototype chain, which application code must not later change. Records and Arrays rely on stable standard prototypes. An exact Function or external identity used as a successful non-Promise value must have a stable native `then` lookup that safely yields a non-callable value from its first use onward; read-only-after-admission alone does not establish this condition. Function and Error classification still precede thenability recognition. Unsafe exact values are outside the host contract, without a recurring reflection probe or separate result transport. Non-callable data `then` remains ordinary. These source invariants keep ready and pending results equivalent without expanding the language graph.
- Path segments are String or Number operation inputs. Normalize and consume each only when traversal reaches it; any other ready value produces a validation Error without invoking coercion hooks. A failed known prefix does not wait for unused segments.
- The graph may be cyclic. Bookkeeping must neither alter nor hide its topology.

## Data Categories

Any graph root or placement may receive a supported thenable. Pending and ready values use the same logical path: consume it at the current program position, continue immediately when delivery is synchronous, and publish a Promise-backed version only when the returned transition remains pending. Thenability means availability, not a separate admitted category.

Admission is the first classification of an available identity within one execution. The same host identity imported by another execution is admitted independently. Consume supported thenables through their ordinary ordered `then` contract before admission. Classification preserves Error and Function semantics first. An identity imported from observation-only external property state remains external, including a record or Array. A detached copy read from mutable external state is new managed data instead. An explicit external identity declaration may likewise make a record, Array, or class instance external. Otherwise logical Arrays retain Array semantics, records default to managed, and a class instance follows its explicit managed declaration, the managed-class registry, or the external default. Native Promise subclasses are supported only while their `then` and species behavior satisfy the standard Promise contract. Structural classification is a conservative probe: if ordinary host reflection cannot establish a supported structure, admit the exact object unchanged as external without creating poison. Because admission is execution-bound, fatal state established during that reflection or an escaping `FatalError` wins over the fallback.

Declarations do not modify or admit an identity. They are persistent runtime-wide host configuration for future admission in every execution and never reclassify an identity already admitted in an execution. A declaration operation performs ordinary supported-thenable recognition as it reaches an identity; a callable `then` is invalid declaration input, while inability to inspect an unsupported identity returns an ordinary declaration-validation Error and records nothing. Preserve an Error before thenability recognition. The declaration creates no poison, kind, execution state, Promise, thenability cache, synthetic thenable, or persistent continuation state. Repeating a declaration is idempotent, while a conflicting declaration fails. Declaration APIs are used before their data enters Cascada. An external identity declaration overrides the managed record or Array default and any class rule; a managed identity declaration overrides the external class default. Records and Arrays passed to `managedState` are traversal roots and receive no redundant declaration. Declared external and uninspectable identities stop its walk; requesting managed state for one as the root fails. A declaration does not bind a prototype; each execution's admission records the prototype then present and fixes it with the category. Passing an Error to a declaration API preserves that exact Error without declaring it; an Error reached during a managed declaration walk ends only that branch. A managed copy inherits the source category and prototype within its execution without adding a declaration.

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

## Errors

Cascada distinguishes recoverable `PoisonError` language data from fatal
`FatalError`. An unexpected failure or violated internal contract is
fatal. Host behavior is fatal only when it makes execution state, ownership,
ordering, publication, or cleanup untrustworthy; safely rejectable host output
is poison instead. A `FatalError` is reported once by each execution it closes and exposed by every still-pending execution-bound operation result; internal and detached paths stop at their next execution check. It is never admitted, queried, combined, or propagated as language data.

- A fatal-on-escape transition submits a candidate `FatalError` for every unexpected escape, including `PoisonError`. Language-outcome transitions recognize expected poison before that lane and apply its graph effect. The execution keeps its first fatal and discards later candidates. The detecting call or Promise reaction propagates that authoritative fatal to unwind; never fulfill a detecting reaction with `undefined`, which would make correctness depend on every downstream consumer noticing fatal state before interpreting a successful payload. A later continuation observing failure returns at its entry check. The first fatal closes new operation work and supported host effects and rejects currently pending operation results, without walking owners or internal waits.
- A failed execution throws its exact fatal synchronously at public execution-bound entry. Elsewhere, centralized common-resumption, host-boundary-exit, subscription-exit, and scheduler-dispatch checks stop work. The external-boundary helper alone checks immediately after its synchronous external action, before interpreting its return or throw; callers add no second post-action check.
- The authoritative fatal outcome is also the live/failed fact: add no second Boolean. Expose it read-only and write it only through the execution's trusted control method; `failExecution` is the supported semantic route. Direct calls to that method or replacement of the trusted control object's prototype are unsupported misuse requiring no defense. [Boundary Completion](#boundary-completion) defines pending-result registration and settlement. Absence of `fatalError` while work remains does not prove eventual success.
- Fatal handling never settles, rejects, or cancels internal source Promises, gates, phases, or aggregates. Resumption checks execution failure before shared settlement, host effects, or publication. Internal waits may remain pending forever; registered fatal reject actions independently reject pending operation results. Keep already-observed native Promises handled. The pending-result set contains only reject actions, never cleanup callbacks. Add no execution-wide owner, task, resource, or cancellation registry, and no fatal-only terminal states.
- Higher-level schedulers check `fatalError` and return at their existing dispatch and resumption boundaries. They neither finish nor abort internal buffers merely for fatality and create no other fatal state, cause, or cancellation model.
- Contextless declaration and host-configuration APIs create no `FatalError`. Invalid input, conflicts, and supported reflection failure produce ordinary host API Errors and no declaration change; they are not poison because no operation context exists. They may be called while an execution is inside external code because they neither enter nor operate on that execution. Recursive configuration triggered by deliberately re-entrant reflection is unsupported programming-interface misuse and receives no runtime guard. An unexpected implementation exception escapes synchronously. An existing `FatalError` supplied to configuration is thrown unchanged. Execution failure commits only through `failExecution`.
- A reporter is a synchronous best-effort notification invoked as an unbound function under a protective catch after fatal state commits. The `Execution` object is never its receiver or argument. Its return is ignored without thenability inspection; asynchronous work it starts remains host-owned. Reporter or diagnostic-formatting failure cannot replace the first fatal outcome, revive the execution, or create a second report.
- `PoisonError` directly extends native `Error`, and `CompoundPoisonError` extends `PoisonError`. Both are ordinary non-thenable language Errors. `FatalError` directly extends native `Error`, remains non-thenable, and is never language data. Factory-produced Errors and compound child arrays are immutable; shared prototypes remain ordinary under the support boundary. Native Error recognition precedes thenability and uses `Error.isError` before ordinary inheritance checks. Preserve exact causal source, kind, and diagnostic cause without copying arbitrary cause fields. A physically received FatalError enters the receiving execution before admission or success handling.
- One authoritative public `ERROR_KIND` vocabulary names the violated semantic contract. Promise availability never changes a kind: ready failure and rejection at one boundary use one transport-neutral, action-based kind. The opaque source identifies the causal source position; it is not a replacement for the stable machine-readable contract kind. Neither message text nor a generic fallback substitutes for a registered kind. `Multiple` is a compound meta-kind.
- Split kinds only when the violated contract, graph/result effect, recovery meaning, or materially useful diagnosis differs. One external property observation therefore uses `ExternalPropertyReadFailed` for a getter or Proxy throw, a ready Error result, and a direct rejection. One selected external invocation and its direct result use `InvocationFailed`. Import, lookup, query, and export reflection keep distinct kinds because failure has distinct operation outcomes; do not collapse them merely because reflection was the physical mechanism. Conversely, do not add a second value kind or a multi-kind host-boundary policy when recovery and graph effect are identical.
- Attribute raw failure by the causal action, whether it throws, rejects, or returns. Every runtime-created Error records an opaque source context; every poison also records its exact nonempty registered kind. Later consumers preserve both unless they cause a new failure.
- Publishing an already failed value must retain that Error when preflight, indexing, or writeback fails too. Combine independently discovered failures without conflating their effects: receiver publication uses its own failure, while the operation result also retains its independent result Error. Waiting for that result does not extend a completed receiver transition.
- A native host Error consumed at a causal boundary becomes an immutable `PoisonError` with that exact Error as `cause`. Existing contextualized Errors propagate by reference. Host storage stays unchanged; fixed logical versions hold the wrappers. Separate introductions, including across import segments, may create distinct but equivalent wrappers. Collection deduplicates by raw cause, source-context identity, and kind, without wrapper interning or an execution-wide Error cache.
- Preserve an existing `PoisonError` or `CompoundPoisonError` unchanged across later language-outcome boundaries. Poison is not evidence that an escape from a fatal-on-escape transition is recoverable; such an escape is a fatal trusted-contract violation. Submit an existing `FatalError` unchanged to the receiving execution; that execution propagates it unless an earlier fatal Error is already authoritative. Promise delay, copying, and whichever consumer advances shared settlement never reattribute either branch.
- Normalized graph results carry ordinary Error data on both ready and fulfilled routes. Input boundaries and explicitly admitted callback-result channels convert recoverable rejection once before their logical transition. Graph publication, complete collection, payload handling, and local completion use that ordinary value; trusted internal escapes still follow the fatal contract. Do not add a recoverable rejection branch to every callback or box Errors solely for Promise transport.
- Error combination requires at least one input. It expands direct compound inputs by one level and deduplicates by raw cause, source-context identity, and kind before allocating an Error: one distinct leaf returns unchanged; several produce a compound with a frozen, leaf-only `.errors` array. Recursion is unnecessary because every input compound already has that leaf-only invariant. `getErrors` uses the same one-level rule. Child order and the representative leaf/source are unspecified. Collectors may accumulate arrivals and use identity visited sets without ordered Error summaries, while completing every required branch. Every retained leaf keeps its context and kind; diagnostics derive kinds without a stored `.kinds` projection.
- Error inspection returns a separate immutable, non-thenable diagnostic view. A healthy value produces `null`; a failed query propagates its query poison. A poison view contains only safe diagnostic data and recursively contains child views, never a `PoisonError`, native Error, or exact hostile cause in a field that language access could consume again. Loop progress and other control facts remain operation-local and are never written onto Error objects.
- One private external-escape protocol separates exact external actions from their causal failure handling; [`docs/error-handling.md`](docs/error-handling.md) defines it. An ordinary external throw is marked at the exact action and consumed by the owning boundary, which supplies its operation context and fixed kind. Contextualization and the causal caller's failure effect run outside recovery. Causal recovery encloses each initial or resumed semantic step inside its fatal guard; an outer issuance catch cannot recover an escape from an inner guard. Unmarked internal failures escape to the fatal envelope. Markers are neither language data nor an integration API. No runtime-wide depth, second recovery mode, mutable policy on operation contexts, or separate post-external-action check exists. A direct host-result Promise rejection is contextualized in its first existing boundary continuation. Its closure carries source and kind until completion; neither belongs on the source Promise, metadata, Chain, or property version.

## Immutable Chain Outputs

All data that leaves a Chain as a value is immutable. This is logical immutability, not `Object.freeze`: Cascada may share storage or copy later, but neither Cascada nor external code may change the value already exposed. An exact external receiver selected for an ordered mutation is operation state, not an output.

- A managed value retained as a Cascada result gains another owner. Mark it shared and use COW for later mutation. A value sent to native JavaScript follows export instead.
- A mutation-capable external identity is a path-bound capability, not a value. It may be called or accessed only through its fixed context Chain and path; direct extraction, host-input export, callback exposure, external assignment, and script return fail.
- Reading a property inside mutable external state returns a detached managed copy. Preserve Arrays, aliases, cycles, prototypes, and Functions as export does, but copy every traversable identity; no traversable source identity escapes. Resolve a direct property-result Promise through boundary completion before copying. The copy walk rejects nested Promises. Admit copies as managed, without external location or mutation authority; their prototypes and methods must satisfy managed-state contracts.
- An observation-only external identity may remain exact because Cascada never mutates it. External code must treat it as read-only.
- Data sent to native JavaScript is exported: managed data is copied, Functions and observation-only external identities remain exact and read-only, and mutation-capable external identities are rejected.
- A runtime-controlled operation need not export values it merely stores, moves, or compares without inspecting their contents. It exports every value exposed to native or application code that can inspect it; for example, a host `sort` comparator receives one exported snapshot, while structural Array operations retain logical payload directly.

Apply this rule to:

- lookup and operation results retained outside their source Chain;
- explicit native-method arguments and controlled-callback inputs;
- values assigned to external properties;
- external-property observations; and
- script results.

## Ownership and Copy-on-Write

An owner is a placement or retained result that independently preserves a logical value. A managed identity is protected while permanently shared or temporarily leased; otherwise it may be mutated in place.

Each new logical occurrence of a managed value is independent: mutation through either occurrence cannot change the other, regardless of representation or when copying occurs. Reason about managed values as values, never shared JavaScript references. Every external occurrence instead denotes the same exact host identity; mutation is an ordered effect on that identity, not COW.

- Reading without retaining or exposing an identity adds no owner. Retaining a managed identity for another owner marks it shared; this includes import, lookup, COW reuse, and retained results. Ownership transfer ends the previous ownership instead.
- Import adds no other COW condition.
- Multiple paths from one owner to the same identity, including cycles, do not create another owner.
- Protection belongs to an identity; permission to replace a placement belongs to its container. A path mutation considers both.
- Ordinary COW shallow-copies each level from the first protected container to the changed placement and reuses off-path values. Reused children keep their identity facts and become shared when both owners retain them.
- Each copied path node starts runtime-owned, unshared, and unleased. Populate it from logical values, not physical slots, and copy no source metadata except the admitted category and prototype.
- Assignment captures its right-hand value before mutating the left. In `x.self = x`, lookup retains the old `x`, so assignment copies `x` and stores the old value: `newX.self === oldX`, not `newX.self === newX`. Ordinary assignment links captured versions rather than creating graph cycles; cycles may enter through imported or managed host mutation.
- A copied actually pending Promise placement gets a fresh mirror at the copier's program position. A synchronously consumed custom thenable is copied as its final logical value instead.

## Representation and Materialization

A logical value is what Cascada observes; its representation is the storage used to realize it. Representation may change whenever every protected logical value remains unchanged.

- Writability, configurability, and extensibility constrain storage, not the graph. If a valid transition cannot use its current representation, materialize normal runtime-owned storage and retry. Omit non-placements and never invoke or redefine a blocker.
- Copy outward along a path as needed to publish materialized storage.
- Shallow COW preserves a record's or managed class's admitted prototype. Managed mutation copies preserve aliases and cycles inside each copied subgraph. Publication may sever an alias to another placement, which keeps its original identity and value.
- Array backing may grow physically while fixed ArrayView bounds preserve existing values. Copy or materialize only when reuse would change a protected value.
- Imported storage never serves as mutable ArrayView backing.
- Host-supplied Proxies used as managed storage obey the [managed-storage contract](docs/data-limitations.md#proxies-in-managed-storage): each primitive write, definition, or deletion implements the requested property/Array operation on success and leaves the represented graph unchanged on failure. Complete fallible storage work before replacing the old placement version and committing refcount facts. Trust this contract without Proxy detection or rollback. Ordinary managed-method failure and opaque external mutation retain their own effect rules; this is not whole-operation atomicity. Internal Array remapping Proxies remain runtime machinery.

## Property Versions

A property version is the exact logical state captured at one placement. When physical storage must stay unchanged, a placement overlay holds that version.

- Every actually pending Promise-backed placement gets a new changing overlay, or Promise mirror. Placements and versions never share mirrors, even for the same source Promise.
- A synchronously consumed custom thenable is never published as pending. Runtime-owned storage receives its final value; imported storage retains the physical thenable under a fixed overlay containing that value, without a mirror.
- Imported storage retains physical pending Promises under changing mirrors and native Errors under fixed overlays containing that occurrence's contextualized Error.
- One live overlay determines logical presence and value. Runtime-owned physical storage may be updated, but correctness never depends on writeback.
- Replacement or deletion detaches the live overlay. Captured versions continue serving operations that retained them.
- Settlement alone changes no language state. The first resolver advances the captured version; later resolvers ignore the payload and continue from the value earlier resolvers left.

## Identity Traversal

- An identity walk may inspect each reached identity once while preserving aliases and cycles.
- Identity deduplication must not erase occurrence facts. Work defined by placements or paths reports every relevant occurrence even when the identity was already inspected. Cycle handling bounds the walk without hiding finite paths.

Import, copying, and graph validation need identity inspection. Initial context-tree construction instead searches only compiler-provided scope and property mutation paths and retains no managed alias or cycle topology.

## Refcount Indexing

- Refcounting maintains an acyclic projection by cutting parent-key placements. Cuts affect bookkeeping only, not graph behavior. Their positions and counter totals may depend on construction history and need not be canonical.
- Indexing is downward-closed: every traversable identity reached from an indexed identity is indexed, including through cuts, and a new traversable child is indexed before its edge is published.
- Index presence means a complete downward-closed region. Prepare new counters, cuts, and reverse-edge additions locally through all fallible reflection and normalization; publish only the complete region in one synchronous hook-free commit. Abandonment leaves existing indexes valid. Capture logical property versions, including mirrors advanced by later synchronous subscriptions, rather than rereading physical slots.
- Direct host mutation must never change an indexed identity in place. Incremental index changes enter through ordinary placement transitions or replacement with a fresh identity.
- When counters cannot answer across a cycle cut, one operation may traverse the counter-selected cut region with one shared visited set. A separate pass may build a missing index.

## Promise Continuations

An operation is one issued command. A transition is one synchronous unit within an operation or continuation. A program position locates a property-version capture or thenable subscription in sequential order; an operation's Promise frontier contains the pending versions required by its selected work.

- Process every available part synchronously and in program order.
- Register on a pending placement only where the operation depends on it. Structural discovery alone does not make the operation a consumer.
- A supported thenable owns its subscriptions and invokes them in registration order, including across settlement: a newly registered ready callback never overtakes an earlier registered callback not yet delivered. It may invoke a callback before `then` returns when already settled. A callback delivered before its own subscription returns lets its throw escape that `then` call; delivery after that subscription returned pending rejects its returned chain on failure, including when a later subscription drains it synchronously. Each continuation completes its transition synchronously; never insert `await`, `queueMicrotask`, canonical settlement Promise, or lazy registration merely to normalize ready work.

Use the common thenable-continuation helper only to:

- advance or consume a captured property version;
- resume or complete a transition;
- complete settlement bookkeeping before later Cascada use.

All ordering-sensitive registration uses this helper. It calls ordinary `then` at the required program position and adds only that continuation's execution/lifetime and semantic transition checks. The thenable owns subscriptions and FIFO delivery. Its `then` is a trusted scheduling protocol: do not mark supplied continuations as external actions, and require the thenable body to re-enter Cascada only through them. Do not cache `then`, create an execution-wide thenability registry, subscribe once for all consumers, add another subscriber queue, or canonicalize through another Promise. Stable `then` and ordered, one-outcome, sufficiently reusable chaining are host contracts in `docs/data-limitations.md`; Cascada neither validates nor repairs them.

Distinguish consuming possible Promise input from determining whether a continuation remained pending. Input recognition is an effectful causal-boundary action: preserve Error, Function, and fixed admitted-category precedence before reading `then`. The common helper subscribes as appropriate and returns the synchronous callback result or source's pending chain. A transition consumes any next possible thenable by the same rule before returning. Thus, after that precedence, a thenable in a trusted returned-result position means required work is pending.

Use only returned pending work for aggregate waits and outward fatal-result delivery. Retain pending-only leases, gates, and releases only while their protected dependency is unfinished. Never infer readiness from callback execution or backwrites; backwrites carry semantic state only. Add no broad context-free `.then` probe or `{ pending, value }` result algebra.

Ordinary property reads normalize newly reached placements; explicit import normalizes transactionally before commit. Later refcount, remap, external-tree, and traversal bookkeeping reads the logical version or pending-version fact, without another resolver or subscription to rediscover readiness. Validation that forbids thenables inspects retained data without the consuming read boundary.

Apply readiness to the dependency whose lifetime is being decided. Once a path has selected its target, an independent pending result cannot install prefix protection; once receiver publication or source capture is complete, that result cannot extend it. One path-local fact identifies this handoff: set it immediately before invoking the selected target operation, never after that operation returns or settles. It describes which work a pending result belongs to, not whether a callback ran or its result is ready. Preserve captured versions and ordinary publication facts as well. Declaration input, synchronous-only callback results, nested mutable-external snapshots, and completed managed receivers retain their explicit thenable prohibitions.

Before subscribing, initialize callback-visible staging, captured versions, and publication needed regardless of readiness. A callback may run inside `then` and must work without changing mirrors or pending-only machinery. If subscription returns pending, install that dependency's gates, mirrors, leases, and registrations before the issuing stack returns; run-to-completion prevents asynchronous delivery in that interval. Readiness-independent protection still precedes its callback: mutating `enter` installs its gate before `onEntered`, and read-only entry protects its captured value first. Never publish stale setup after synchronous continuation work. Rejection observation uses ordinary supported subscription, never native Promise intrinsics on custom thenables or an observer for a synchronously completed observer result.

Every subscription that can return to active operation work checks its execution at exit, on return or throw. Older queued callbacks may fail that execution while rejecting only their own returned chains; propagate its authoritative fatal before using the new result. This includes no-op ownership subscriptions. Ownership handlers still absorb rejection after fatality without semantic work or recursive observation. A native outward Promise executor owns bridge-subscription failures and returns its wrapper even if already rejected.

If three operations reach one pending placement, the first resolver publishes `V`, the second observes `V` and may leave `V'`, and the third observes `V'`.

## Read Leases

A lease temporarily protects an exact managed identity that pending work may still read or whose captured value its result does not yet own. It never delays mutation; mutation uses COW. In a live execution, release each lease after last access on success or failure, including identities revealed by required Promise resolution. Closing the lease lifetime must prevent or immediately balance later acquisitions by scheduled work.

After an unrelated fatal, resumed continuations return and lease counters have no semantic consumer. Never-settling reactions may retain dead lease state for their lifetime. Execution identity `WeakMap`s do not root their keys; an owner sweep could release reaction-held resources but could not remove the reactions. Do not add an execution-wide sweep solely to rebalance dead metadata.

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

Fatality adds no gate transition. A gate keeps its ordinary blocker; resumption after execution failure stops before shared settlement or private publication. A never-settling gate may remain pending because pending operation results receive fatal rejection independently.

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

Each import segment has one lifecycle fact: `staging`, then `committed` or `abandoned`. Reuse segment state or one local field; add no transaction class or independent Booleans. Synchronous delivery during staging uses the active walk and identity map. Commit grants pending subscriptions later import and publication authority. Abandoned callbacks return after execution and segment checks, without admission or publication; those callbacks have no committed shared version to settle. Either terminal transition releases staging collections, retaining only the lifecycle fact and work needed by owned reactions. Keep ordinary rejection ownership without cancelling the host source or registering subscriptions with the execution.

Initial external-tree discovery reads the segment's staged logical placements as well as its admission facts. It follows synchronous custom outcomes and stops at actually pending values; it neither resubscribes to physical thenables nor commits overlays early. Later delivery cannot add tree leaves.

When importing a context root, its Chain may supply the compiler's complete mutation-path set for all code that may use that Chain to the same boundary internally. The paths are String/Number prefixes selected by `!` and String/Number assignment and deletion targets. An absent or empty set performs ordinary import and builds no external mutation tree.

Chain construction from an existing Cascada value, assignment, lookup, and internal transfer within one execution do not cross the boundary and therefore do not import; they preserve admission and origin. Managed values move between independent executions only through export followed by import. Independently supplied external identities remain exact host values and follow the execution-isolation restriction above.

- Validate each reached synchronous import segment before committing origin, sharing, or placement versions. A boundary failure commits none of that segment.
- Traverse managed state once while preserving aliases and cycles; stop at Errors, Functions, and external identities. Containment neither grants nor removes origin.
- Metadata in the current execution identifies an already admitted value. Ordinary import retains such a managed result without traversing it again and marks its root shared when the result adds an owner. Metadata from another execution is invisible. A managed mutation result is different: arbitrary receiver mutation may detach an admitted container while retaining its descendants, so its import traverses the retained managed graph and marks every reached managed identity shared. A new host-produced managed identity becomes imported and shared.
- Observation-only external property reads use ordinary import; newly reached identities remain external, including records and Arrays. Mutable-external property reads copy the ready graph under their observation phase using the [detached snapshot contract](#immutable-chain-outputs). External state may contain only external state: encountering admitted managed data during property traversal poisons the external container without replacing either identity. Do not scan for violations. Host calls may return admitted managed data through their separate result-import boundary.
- Host-call result import rejects any mutation-capable external identity. An external call also rejects its exact native receiver when it appears in traversable result data. Other opaque external objects must not hide aliases into mutable receiver state.
- Application and external code must not mutate managed data after passing it to Cascada. Imported storage is borrowed and never modified; metadata and logical Promise settlement remain outside it.
- Mutable live host state must be external and accessed through ordered external operations.
- Cascada never creates non-extensible managed data. Such data must enter through import; do not infer import from non-extensibility or add frozen-specific behavior.

### Export

Export produces host-ready data independent of managed storage. It resolves required availability, removes runtime representations, and copies managed records, Arrays, and class instances, preserving Array structure, aliases, cycles, and admitted prototypes. Functions and observation-only external identities remain exact; mutation-capable external identities are rejected. Export one boundary operation's ordered roots as one graph with one identity map, preserving cross-input aliases but collecting Errors separately per root. Repeated host-callback invocations by one controlled operation share one prepared exported snapshot.

Export is used for:

- explicit arguments passed to any native JavaScript method, including managed, external, and native methods;
- declared inputs passed to a host callback by a runtime-controlled method;
- values assigned to external properties;
- script results.

Export never sends Error data to host JavaScript. Each root is an Error-collection domain: after reaching an Error, finish its captured frontier and collect every semantically distinct Error at any depth. One Error remains unchanged; several form one compound. A batch combines failed roots, flattens compounds, and deduplicates by raw cause, source-context identity, and kind. Error order is unspecified; successful root positions and graph-copy ordering stay unchanged. Collectors need no ordered branch summaries solely for Errors. Any failed root prevents invocation or assignment and replaces a script result.

Export uses no managed source lease. Each transition copies every ready placement synchronously; a pending placement is captured through its exact mirror, and its FIFO continuation traverses each newly revealed branch synchronously once. Later work never rereads already captured source state. External code may retain exported copies, exact Functions, and observation-only external identities, but not their managed sources. Exact identities remain read-only. Export never transfers external mutation authority.

Export follows the common operation lifecycle. Closing releases partial output state. A reached Error discards output copies but does not close the operation until its required Error scan finishes.

## Boundary Completion

Boundary completion includes all admission, validation, copying, and publication promised by the result contract. Ready and Promise-backed forms follow the same rule. An issuance result or mutating `enter` callback result does not signal publication; its installed gate orders later consumers. Managed receiver finalization and external phases remain active through completion.

- Process available work synchronously, preserving Error and Function precedence before supported-thenable recognition. Core operations consume sync-settling thenables before return; a remaining semantic thenable is the pending direct result. A ready result completes required processing and returns directly, with no result Promise or microtask. An immediate non-blocking return remains direct while internal work continues. Contextless host configuration remains synchronous and has no execution fatal state.
- Adopt a direct Promise through the operation's one result Promise. Fulfillment completes the required boundary processing before producing its logical value or ordinary boundary Error; causal input rejection becomes that Error through the same completion. Never detach or discard required processing.
- Register a pending direct result for fatal rejection until its outward settlement transition begins. Internal-source settlement, a queued outward transition, or return of the Promise object is not completion: a fatal committed first still rejects the result. Remove registration before settling the outward wrapper. Registration performs no task cancellation, resource cleanup, dependency walk, or owner notification.
- After a ready return or outward settlement, later independent work cannot revise the delivered result and reports fatality only through the execution.
- A Promise nested in a synchronous inbound result is independent result data. It does not extend the producing invocation, leases, or phases; its placement still follows import and mirror rules. Later consumers, including export, follow its captured version and may wait. A mutable-external property snapshot is the exception: its synchronous copy walk rejects nested Promises.

Every script result passes through common export before return. Reachable nested Promises, Errors, validation, copying, and publication belong to that completion frontier. A higher runtime must not substitute raw managed lookup or fire-and-register issuance when script completion requires the omitted work.

This contract covers imported Promise roots, host-call results, external-property reads, managed direct-Promise results, host-input exports, and script-result exports.

## External Authority

The binding policy in [`external-context-ordering.md`](docs/external-context-ordering.md#context-and-regular-chain-import-order) is settled: invalid off-path access fails locally; competing independent context registrations invalidate shared authority; no previous placement or completed result is rewritten. Initial context import rejects distinct candidate paths to one exact external identity before any registration commits; repeated discovery of the same normalized location merges.

External identities are observation-only by default. An identity may be mutated only when initial synchronous context import found it under one of that Chain's compiler-provided scope or property mutation paths and recorded it in the static external mutation tree. The tree is a positive mutation-authority index, not a live copy of the managed graph.

- A `!` candidate searches its selected managed scope for first external boundaries. An assignment or deletion candidate follows only the containing path and never scans the old target. Reaching external state while following either path records its first boundary and stops its opaque suffix.
- Build the tree atomically with the initial import segment, reading its staged logical placements. Follow synchronous custom deliveries; stop discovery at actually pending values, Errors, Functions, and external identities.
- Cut cycle backedges. Preserve distinct finite occurrences reached through acyclic aliases so discovery detects duplicate external locations. Two distinct discovered paths to one external identity produce import-attributed `ExternalLocationConflict`, even under conservative scope discovery; abandon the segment without changing existing bindings. Undiscovered inert aliases do not fail import, and later off-path use through an omitted alias is rejected locally by binding validation.
- Later Promise delivery and subsequent graph changes add no leaf. Do not maintain alias, cycle, COW, Array-remap, assignment, deletion, or `enter` topology in the tree.
- Each live leaf is one location. It is unique to its root ContextChain and normalized path, and entered contextual Chains retain that same leaf. Mutation requires the live leaf. Promise-valued operation paths use it after resolving their segments under protection registered from the ready prefix.
- Managed assignment adds an owner. Later managed mutation through either placement uses ordinary COW, preserving the other placement and its live leaves without tree maintenance.
- A controlled graph replacement, deletion, or Array remap that would remove, replace, hide, or relocate a live leaf produces an Error before publication. A managed host method that violates this rule discards its private receiver, preserves the original managed state, and returns `InvalidManagedReceiver`; it is fatal only if external code already made runtime or external state untrustworthy.
- External identities remain exact through managed copies. Another stored reference gains no authority; off-path external access through it fails locally without invalidating the context binding.

One execution-scoped `WeakMap` records every external identity registered in a static tree and recognizes that identity through later aliases. Its entry owns binding state and the phase cursor. A valid binding holds one registered location; there is no candidate set or first-use path choice. Context registration commits atomically with otherwise-valid initial import. A competing registration from an independent root ContextChain invalidates their shared authority; a regular Chain's admission or inert storage creates no competing claim, in either import order. Retain one immutable binding Error, not a use-history log or separate conflict Boolean. The contexts may remain imported with an unusable capability; do not revoke their completed import results.

Every external operation validates its complete exact selection before host access, including when it resumes after a wait. Valid authority uses normal phases. A regular Chain or unregistered path returns a local Error and never poisons the context binding or its phase. Any provisionally reserved unauthorized boundary completes with unchanged predecessor state. A direct lookup or export that would expose a mutation-capable identity fails normally. Validation neither grants partial host authority nor creates an access-time cross-context conflict.

Derive live authority from the shared entry. Invalid leaves remain inert discovery facts; add no tree-pruning mutation, reverse occurrence index, placement poisoning sweep, or exposure history. Broad scopes use their remaining valid leaves only, and external code must not access excluded identities. Explicit access to an identity with invalid authority returns its binding Error rather than reinterpreting it as unregistered observation-only state.

An abandoned import changes no prior binding. An operation already in external code cannot be interrupted by later registration; its normal boundary processing and rejection ownership finish, and later runtime accesses consult current authority. Earlier off-path use of a resource intended for contextual mutation is unsupported even if its future registration was not yet knowable. Already-returned exact references and settled results cannot be recalled. Ordinary repair changes operation poison only, never registration, invalid authority, or the chosen location.

One host resource that Cascada may mutate must have one external identity and one Cascada access location. Hidden sharing between external roots and independent host mutation remain host-contract violations.

## External Operation Phases

A readers-writer phase orders access to an exact external identity, whose state cannot be protected by managed COW or transition gates. Consecutive observations share a read phase after the preceding exclusive operation; the next mutation or repair waits for the whole read phase and then runs exclusively.

- At issuance, synchronously register all known receiver, live mutation-scope, and repair phases. Merge by identity, with exclusive access winning, and append or join the phases. Publish every successor dependency before waiting on any predecessor; scopes created by one operation never wait on one another.
- Complete the operation's phase set before its first wait and never expand it afterward. A later-revealed mutation-capable receiver must match an already selected boundary or fail before host access.
- A phase selected conservatively before an unresolved path is protection, not use or authority. If the resolved operation does not select that boundary, relay its predecessor poison unchanged without contributing it to the operation; the phase still completes in predecessor order.
- An exact external boundary already reached by a ready path prefix uses its ordinary phase. An uncertain provisional external selection is exclusive even for an observation. Until a dynamic segment resolves, this keeps the exact identity-use decision in phase order without another queue. Compiler discovery supplies the longest preceding static path as a conservative scope; the runtime path itself carries the unresolved segment.
- After publishing the complete phase set, synchronously advance hook-free ordinary preparation to its first pending point. Capture current managed property versions and a ready external boundary exactly, and start required input export before waiting. Later work resumes from these captures rather than rereading source state or retraversing a managed prefix.
- After predecessors and captured graph readiness, validate each selected live leaf against its exact identity. A changed live binding is fatal.
- Existing waiters keep their captured predecessor when a successor becomes current. A completed read phase is not reused.
- Every phase Promise fulfills with a hook-free, non-thenable state record containing repairable poison. [Guard Poison and Repair](#guard-poison-and-repair) defines how observations and exclusive successors consume it.
- Fatal failure neither completes a phase specially nor stores fatal Error as phase poison. A successor that resumes stops at its common execution check before host work. A successor whose predecessor never settles may remain pending because operation-result completion does not depend on draining internal phases.
- A direct operation Promise keeps its phase active through its final boundary processing. A nested result Promise does not.

Select external phases from an exact external identity or a context path in the static mutation tree. Entered contextual Chains inherit the source execution and original tree rooted at the selected branch, without copying or updating it, and use the same contextual operations as their source. Mutating entry's branch gate excludes outside access until publication; read-only entry relies on the containing runtime's command ordering.

Use phases to order exact external operations, leases to preserve managed values without waiting, and gates to publish unfinished managed transitions.

## External Guards

External guards apply [readers-writer phases](#external-operation-phases) to exact host identities that managed COW, leases, and gates cannot protect.

- Each context-path call or property operation queries its complete receiver or target path for an exact external boundary or first boundary prefix. Unmarked access observes; `!` and repair select exclusive access.
- Enter the selected phase and finish required graph and export preparation before host reflection, including proxy, descriptor, getter, property, or method access.
- A marker inside opaque external state clamps to the first external boundary. A managed prefix keeps ordinary isolation and selects live external descendants only for the declared host effect. Managed methods receive no implicit authority over opaque descendants.
- Broad mutation scopes include only currently authoritative tree leaves. Invalid leaves remain inert without tree deletion; the remaining scope stays usable. Host mutation of an invalid or unselected identity violates the host contract.

## Guard Poison and Repair

A phase retains one completion Promise, consumed through the common continuation helper in subscription order. Its fulfillment carries the non-thenable completion record; consumers never bypass that protocol by inspecting a separately exposed record or inferring that queued work has run. A native completion Promise schedules its continuation even after settlement. An existing supported sync-first completion primitive may deliver directly only under its own FIFO contract across settlement; add no phase-specific ready shortcut or queued-work tracker. Fulfillment-only completion needs no rejection-only observer, while potentially rejecting derived reactions retain ordinary ownership.

External poison belongs to the selected identity's execution-scoped phase state, never application data, graph metadata, or the external object. Poisoning never replaces a placement with an Error. Each phase's completion record carries its repairable poison. Exclusive successors consume their complete captured predecessor. Every observation consumes only the last exclusive predecessor's poison, regardless of peer readiness or completion. The read group retains all containment failures, in unspecified Error order, for the next exclusive successor, which waits for the complete group and receives their combined poison.

- Existing poison contributes an Error at the selecting receiver. Required preparation continues, external code is skipped, and the operation preserves that poison.
- Ordinary observation failure releases its phase without poisoning. Reaching admitted managed data inside external property state contributes poison to that observation and to the next exclusive successor, but never changes what another observation consumes.
- Mutation failure or rejection publishes its combined Error through every selected mutation-phase completion. Completed host effects remain visible.
- Repair-only bypasses and clears repairable predecessor poison at an existing selected location, performs no host access, and returns `undefined`. Repair-and-call bypasses old poison, then clears it on call success or publishes the new mutation Error.
- Only repair-only and repair-and-call clear external phase poison. Assignment and deletion naturally remove an Error at their final managed placement, but they do not implicitly repair poison belonging to an external phase.
- Repair never creates authority, changes the chosen location, or clears permanent conflict.

## Host Calls and Callbacks

- Select the boundary first from runtime-controlled facts such as admitted category, method name, and mode, without invoking external code. Prepare only the inputs it consumes and only to the required depth. After an Error, finish required preparation to collect the rest but skip the selected function, accessor, callback, or method. Nested Errors matter only when preparation reaches them.
- Unconsumed inputs, including unused path segments, remain host-owned. Do not wait for them or attach rejection observers merely to suppress host reporting. While receiver selection is pending, provisionally consume explicit arguments only at root availability to preserve captured values for the selected boundary; do no traversal or export. Ready receiver dispatch that rejects the call consumes no arguments.
- If internal dispatch rejects a constructor, controlled name, or mode before selecting an executable boundary, perform no boundary-specific receiver or argument preparation and return only that validation Error.
- A value selected for invocation is prepared and validated as an executable, not imported as graph data. Import applies to a property-read result or invocation result that enters the graph.
- After publishing all phase successors, predecessors and explicit input preparation may settle concurrently. Both must finish before Proxy reflection, application-controlled descriptor access, getters, or other host method selection. Failed preparation skips that external code and collects every required failure, with unspecified Error order. Earlier internal dispatch and input capture remain hook-free.
- Controlled Array table lookup and trusted native String lookup are internal dispatch and remain early because neither invokes an application hook in the supported runtime. String selects only Function-valued data properties from stable `String.prototype` and `Object.prototype`; it never invokes an accessor during selection. Dynamic record, managed-class, and external member resolution happens after preparation.
- Native JavaScript calls export every explicit argument. Runtime-controlled methods resolve only declared logical inputs; when one invokes a host callback, it exports the complete callback argument list as one graph. Mutation-capable external identities fail export. Retained payload remains unchanged, including an Error or Promise. A rejected retained Promise poisons its eventual placement, not the retaining call. Controlled methods may return internal representations such as ArrayViews.
- A controlled callback receives only its declared exported inputs and may mutate or retain exported managed copies. It must not access an unexported managed source or synchronously re-enter the same execution.
- A controlled callback position that must remain synchronous rejects a direct Promise result. Its declared result contract determines validation and conversion. Import the result only when it enters the graph as host data; a result consumed entirely by the controlled algorithm does not cross that boundary.
- Logical Arrays support only names in the controlled method table, always selecting the controlled operation. Every other name is unsupported; never inspect custom Array methods.
- Controlled Array methods do not consult application method or protocol surfaces. They assume standard Array primordials and prototype behavior remain unmodified. Trusted native String dispatch likewise assumes stable `String.prototype` and `Object.prototype`.
- Controlled methods avoid copying and materialization where possible. A special path must provide a material benefit while preserving every logical value.
- Host observations must not mutate their exact receiver; host mutation may change only external identities selected by its scope. Exported managed argument copies may be mutated or retained without changing Cascada sources. Exact Functions and observation-only external identities stay read-only; mutation-capable identities never reach argument positions.
- External writes complete export before native assignment or setter execution; any reached Error prevents the write. A native setter must finish synchronously.
- External code may retain exported copies, Functions, and observation-only external identities. It receives no mutation authority beyond active external receiver phases, and later independent mutation is a host-contract violation while Cascada may use the resource.
- External calls, controlled callbacks, and reflection hooks must not synchronously re-enter their execution: an unpublished outer transition provides no safe ordering point for nested work. Making ready host mutations asynchronous to allow re-entry would violate sync-first behavior and add common-path gates. The execution's external-action Boolean covers only the synchronous action; attempted same-execution re-entry is fatal. An external function may synchronously start a script in another execution. Compiler-controlled script calls and recursion are internal and bypass this guard. Trusted control-flow callbacks such as `enter` keep their gate/lease, closure, and command-ordering contracts. After synchronous host return, a direct result Promise may start independent Cascada work under its lifetime and self-wait restrictions.
- A direct host Promise must not depend on a nested Cascada operation ordered behind that host call's active managed gate or external phase. Such a dependency is an invalid self-wait; ordinary ordering cannot complete a cycle.

## Managed Methods

- Declare a managed class before ordinary admission of its instances. A detached copy read from mutable external state may instead validate and adopt its source prototype for that copy only; it does not change the class default. Classification is otherwise fixed at first admission within the execution.
- Internal dispatch selects a managed boundary from admitted category, method name, and mode without member reflection. Complete receiver preparation and explicit-argument export before resolving a member; failed preparation performs no post-preparation method-placement read, prototype descriptor traversal, callable test, or invocation.
- A managed record resolves its own enumerable method placement from the prepared record and tests callability. Accessors, non-enumerables, inherited properties, extracted Functions, and `constructor` are not record methods. The name `constructor` is globally reserved: `run` rejects it before selecting any executable boundary.
- A managed class selects Function-valued data properties from its admitted prototype chain up to, but excluding, `Object.prototype`. Unrelated prototype accessors are allowed but are not methods and are never invoked by selection. The chain must contain no callable or accessor `then` and must remain unchanged after declaration or adoption. If selection reaches an accessor or safely detects unsafe `then` or another invalid prototype change before external invocation or publication, return `InvalidManagedReceiver` and preserve the receiver. The violation alone is not fatal while runtime state remains trustworthy.
- Resolve a managed member once from the prepared receiver before mutation isolation. Isolation preserves that member and the admitted prototype and does not repeat resolution.
- Managed classes expose semantic state only through own enumerable string-keyed data properties. Every managed method keeps mutable semantic state in `this` and receives other state through explicit arguments; it must not depend on mutable parent, closure, module, private-field, Symbol, non-enumerable, accessor, or internal-slot state.
- Managed state may contain primitives, records, logical Arrays, managed classes, external identities, Functions, aliases, cycles, Promises, and Errors.
- External identities inside a managed receiver are opaque leaves. A managed method may retain or compare them but may not inspect or mutate their host state. It may return or expose an observation-only identity. A mutation-capable identity cannot leave its fixed path and must not be moved, replaced, or removed from a live context-tree leaf. Select external state as a receiver in a separate Cascada operation to access it.
- Preparation consumes the complete receiver graph, resolves every receiver Promise through captured versions, and provides no Promise or Error in the receiver. It exports every explicit argument, whose output contains no unresolved language Promise or Error. Imported receiver storage keeps its physical Promise.
- A managed method may finish synchronously or remain active through one direct Promise. Later receiver access and any inspection of read-only observation-only external inputs must belong to that Promise and finish before settlement. The managed structure of exported argument copies may be retained independently.
- The caller's observation-or-mutation mode is a trusted assertion about the selected method. An observation method does not mutate its receiver; a mutating method changes only its isolated receiver. Exported managed argument data is independent and may be mutated, retained, stored in the receiver, or returned without changing its Cascada source. Exact Functions and observation-only external identities remain read-only as arguments; mutation-capable external identities fail export.
- Nested method calls are ordinary JavaScript on the prepared receiver, not another Cascada invocation. Methods do not change a traversable identity's prototype, descriptors, or extensibility.
- Cascada may copy managed receiver state for isolation. Arguments always follow the [export contract](#export), including copying managed data and rejecting mutation-capable external identities. Code relies on managed identity only during its invocation.
- After mutation, validate and admit the complete receiver and publish through the ordinary transition. A completed receiver contains neither Promise nor Error. Recoverable reflection failure ends only the inaccessible branch; retain every discovered validation Error and continue accessible siblings. If independent result import also fails, the operation result combines both failures while the receiver publishes its own validation failure.
- Preparation poison, receiver validation failure, or method failure poisons a mutation receiver. Observation and independent-result failure affect only their result. A direct-Promise rejection preserves the rejection outcome after applying the corresponding graph effect.
- Import every managed-method result. Returning the mutation receiver returns its published identity. An observation result uses ordinary import. Every other mutation result uses managed mutation-result import, which keeps admitted identities and marks the reached managed graph shared so receiver/result aliases gain shared ownership without result copying or provenance state. Any result that would expose a mutation-capable external identity fails.

## Expression Boundary

Operation Chains retain graph values and ordinary non-thenable Errors. Public primitive extraction reuses path observation and admits only null, undefined, String, Number, Boolean, BigInt, and Symbol primitives. Another selected value produces `ExpectedPrimitive` without coercion, deep export, descendant traversal, or mutation of the source. Existing Errors keep their identity and source. Operators own accepted primitive combinations and numeric validity.

At that outward boundary a ready failure returns an immutable non-Error container holding one ordinary Error; a pending failure rejects with that Error. The container carries no duplicate attribution and is never stored or admitted in the graph: input consumption converts it to its contained Error through ordinary rejection delivery. [`docs/integration.md`](docs/integration.md) and [`docs/error-handling.md`](docs/error-handling.md) define its public factories and delivery contract.

A ready container is a completed outward failure, not pending graph work or a fatal-result obligation. All required work and primitive validation precede final expression settlement. Preserve pending fatal delivery until that final boundary without duplicate wrappers. Graph inspection succeeds with ordinary Error data; explicit propagation and final native script delivery choose rejecting transport separately.

## Verification

- Prefer integration tests through public operations across meaningful synchronous and Promise interleavings.
- Cover sequential equivalence and owner isolation; immutable Chain outputs; lease and gate lifetimes; overlapping observations and mutation barriers; external ancestor, descendant, and sibling guards; mutable-external extraction rejection and property snapshots; and Promise fulfillment and rejection.
- Verify that ready and Promise-backed boundary results have identical admission outcomes, including admission Errors.
- Verify that ordinary import skips traversal for results already admitted in the current execution; other executions' metadata is invisible; and export/import is the only supported managed-data crossing. Independently supplied external identities get isolated state without cross-execution mutation safety. Separately verify that managed mutation-result import protects descendants still reachable from the receiver.
- Verify that export collects synchronous and Promise-revealed Errors at every depth, loses no distinct Error identity, combines complete semantic membership once across all required roots, and never invokes external code with an Error.
- Verify every immutable-output route: managed results gain independent ownership; mutation-capable external identities fail direct extraction, host-input export, callback exposure, external assignment, and script return; and mutable-external property copies satisfy [Immutable Chain Outputs](#immutable-chain-outputs), with a nested Promise failing the copy without creating a mirror.
- Verify that controlled operations retain uninspected payload without needless export, while every callback- or host-visible value uses export.
- Verify that external-property traversal poisons the external container when it encounters admitted managed data, leaves both identities intact, and never inspects unrelated external properties.
- Verify that distinct discovered paths to one external identity reject the initial context import atomically, including conservative scopes and synchronous custom deliveries; duplicate discovery of the same normalized location merges. Rejection leaves existing bindings unchanged and abandoned callbacks cannot publish. Verify unused, one-context-path, different-path, different-context-Chain, copied alias, Promise-revealed alias, and mixed external use. Only the valid context location may access a mutation-capable identity. Regular-Chain/off-path access fails locally without invalidating that context; competing independent context registrations invalidate shared authority. Test both import orders, inert storage, pending access, and completed/exposed results.
- Derive failure tests from boundary contracts, not existing catches. Cover each JavaScript action that can invoke user code and every distinct preparation and commit path.
- Use focused unit tests only for invariants that integration tests cannot observe. Never pin an interchangeable representation.

## Maintaining This Document

- Keep only cross-cutting contracts, load-bearing invariants, and stable mechanisms used by multiple source areas. Put operation mechanics in source comments and tests.
- Use source terminology and the most concrete rule that explains all affected code. Generalize only when it simplifies both rule and implementation.
- Describe accepted end-state behavior, not migration phases, audit history, or rejected alternatives; plans hold those.
- Compare every revision with the previous version. Remove superseded or contradictory text, verify that no constraint was lost, and keep the result concise.
