# First-Principles Conformance Plan

## Purpose

This plan records the final design and the work needed to bring `src` into conformance with [`AGENTS.md`](../AGENTS.md). Phases appear in implementation order, with completion status recording progress separately from design decisions.

`AGENTS.md` is authoritative for settled contracts. Source and tests are authoritative for completed mechanisms.

Phases 9C through 9F-C supply the implemented graph/Error, admission, binding, managed rollback, hierarchical external coordination, shared placement/capture foundations, transparent references, and ordered structural publication. Phase 9F-D defers general redundant-copy elimination and logical-identity work for further design discussion. Phase 10 then adds Promise-valued path segments using those mechanisms. Phase 11 verifies import preservation, and Phase 13 integrates Cascada.

## Current checkpoint and agreed changes

The current kernel has ordinary FIFO subscriptions, atomic import and index publication, successful-output native-then validation, immutable causal Error wrappers, complete semantic Error collection, one local close transition, and the public higher-runtime API. Poison remains ordinary non-thenable Error data. Expression lookup returns a ready PoisonedValue or a directly rejecting pending Promise; getErrors returns null or a combined Error, and query failures fulfill with ordinary Error data. Context import validates unique external locations and commits execution-local bindings. Phase 9F-A implements managed rollback, owning-placement poison, hierarchical external reservations, subtree repair, and mixed entry. Phase 9F-B reduces the caller responsibilities needed to preserve those mechanisms; its evaluations do not presume another semantic redesign or an unresolved correctness defect.

| Agreed requirement | Implementation owner |
| --- | --- |
| Ordinary FIFO thenable subscriptions; no source cache, canonical settlement Promise, species/cycle repair, or duplicate subscriber queue | Phase 9C addendum |
| Synchronous callback staging; pending-only versions, gates, leases and operation-result registration; ordinary custom-thenable rejection observation | Phase 9C addendum |
| Atomic import staging/commit/abandonment; mutable-authority discovery uses directly accessible original context inputs | Phase 9C addendum for import; Phase 9E completion for discovery |
| Subscription exit propagates the subscribing execution's authoritative fatal, including one committed by an older queued reaction during that subscription | Phase 9C completion; preserved by 9D-A/9D-B and 13 |
| A detected missing required Promise version fails immediately at publication; fatal detection never waits for the corrupt source to settle | Phase 9C completion |
| Dependency-scoped readiness and a semantic target handoff; an independent result does not retain a completed path or receiver | Addendum for existing routes; Phase 10 for Promise-valued paths |
| Recoverable failure leaves every retained refcount index valid, including downward closure through cycle cuts | Phase 9D-0, preserved by 9D-A query recovery |
| Successful ready and pending outputs obey the same native `then` surface restriction | Phase 9D-0; 9D-B expression-boundary verification; 9F-A/13 boundary integration |
| Raw failure payloads exposed through `Error.cause` are diagnostic-only host data and cannot expose unexported managed state or mutation-capable external identities; source attribution remains the originating operation's source-error context | Phase 9D-A contract and kernel producer audit; 9F-A/13 integration |
| Immutable Error wrappers propagated by reference; cause/context/kind deduplication in queries and compounds; unspecified Error order; no persistent wrapper interning | Phase 9D-A, preserved by 9D-B and 13 |
| Operation context is trusted compiler/runtime protocol; malformed root integration calls produce ordinary programming errors, while defects escaping a valid operation enter its fatal guard | Phase 9D-A kernel entry audit; Phase 13 compiler/integration verification |
| No required Error is lost: complete collection is part of determinism; Error order and only the enumerated reporting/detection races may vary | Existing 9C fatal semantics; 9D-A collection/query tests; 9D-B graph/expression boundary; 9E/9F-A invalid-binding tests; Phase 13 integration |
| Reject off-path regular-Chain access locally in either import order; do not poison the context, rewrite old placements, or revoke settled results | Phase 9E binding kernel and 9F-A/10 access routing |
| Competing independent context registrations invalidate one shared binding at otherwise-valid import commit; no first-arrival winner or repairable authority transfer | Phase 9E binding baseline, with 9F-A/10 integration |
| Reject distinct selected paths to one identity atomically; retain requested nested external scopes | Phase 9E atomic binding; Phase 9F-A hierarchical discovery |
| One selected subtree reservation; upward completion dependencies and separate poison summaries | Phase 9F-A |
| Compiler-owned mutation access trees with `{}` endpoints; bounded filtering into Symbol-backed location records; no receiver cache or phase payload wrapper | Phase 9E completion; Phase 13 compiler emission |
| Static mutable-resource selection; deterministic dynamic-route failure scope; no speculative candidate reservations | Phase 9F-A path facts and Phase 10 segment handling |
| Native access respects earlier managed gates; reservations use covered entry views and bounded pending membership | Phase 9F-A and Phase 13 lowering |
| Idempotent compound Error union; bounded immediate-child query summaries | Phase 9E-A before Phase 9F-A query integration |
| Mutable-only fixed namespace; upfront structural restrictions; ordered external scope metadata queries | Phase 9F-A |
| Each failed managed mutation rolls back to its ordered baseline; owning-placement poison retains that value for repair; no callback-wide or external rollback | Phase 9F-A, preserved by Phase 10 and integrated by Phase 13 |
| Own external poison stays at its scope; ancestor summaries preserve child Errors; repair clears covered external subtree before a call | Phase 9F-A, preserved by Phase 10 |
| Read-only entry uses observation reservations; contained work reuses one ordering algorithm and one command effect completion | Phase 9F-A, integrated by Phase 13 |
| Managed lookup, import, retention, and mutation use ordinary sharing, leases, versions, and COW regardless of `!`; external methods mutate only their external owner's state | Phase 9F-A ownership and boundary integration; Phase 10 dynamic paths |
| Keep the separate ready-only mutable-external property snapshot contract, including logical reads of reached managed sources | Phase 9F-A snapshot integration |
| One public package API for Chain operations, guarded higher-runtime work, Error factories, and expression extraction | 9D-B public surface; Phase 13 compiler/runtime consumers |
| Final Promise-backed placement terminology and one explicit prepare/install/continue/publish/commit/detach lifecycle | Phase 9D-C atomic terminology migration |
| Shared placement lifecycle and explicit capture ownership; preserve producer progress, complete state, and publication authority without caller-specific retention inference | Phase 9F-B, reused by Phase 10 and verified by Phase 11 |
| Transparent single-path entry, logical placement authority, record-order publication, and captured Array growth | Phase 9F-C |
| No-op protection preserves logical identity; copy optimizations and lease timing do not choose successful mutation semantics | Phase 9F-D design/evaluation; mutation-through-alias rule remains to be selected |
| Separate ordinary graph Errors from expression PoisonedValue; use public factories and preserve complete collection | 9D-B kernel expression boundary; Phase 13 compiler/runtime migration |

Initial mutable-authority discovery follows directly accessible original context inputs and reuses staged admission facts. Every Promise or thenable stops this discovery, regardless of delivery timing; ordinary import retains its existing consumption. Distinct direct paths to one external identity within a root context fail import before registration commits. No first-use selection remains.

### Error-handling implementation ownership

These requirements are implemented or retained in their owning phases; they require no separate review document.

| Requirement | Implementation owner |
| --- | --- |
| Recoverable reflection leaves retained cyclic indexes valid | 9D-0 atomic index publication, preserved by 9D-A query/export recovery |
| Exact causes contain diagnostic data without protected managed or external identities | 9D-A contracts and kernel producer audit; 9F external capabilities and 13 host integration |
| Native assimilation preserves successful ready/pending equivalence | 9D-0 native-then validation and exact-value host restriction; preserved by 9D-B/9F/13 |
| One shared external-action and guarded-continuation composition surface | 9D-A integration exports, documentation, and tests; 13 calls, callbacks, iterators, loading, and standalone-call receivers |
| Exact host failure is distinguishable through shared graph helpers | 9D-A private exact-action marker, fixed causal consumer, and query/index/export tests |
| Fatal observation permits only already-owned local iterator finalization | 13 finalization, its failure/Promise ownership, and scheduler abort removal |
| Collection identifies semantic cause/source/kind classes | 9D-A factories and queries, preserved by 9D-B and 13 compiler source reuse |
| Diagnostic routes and safe inspection retain information with a successful formatting fallback | 13 immutable route capture, diagnostic views, and fallback verification |


Retain the strengths that already solve the problem: Phase 9C's first-fatal commit before reporting, removable pending outward obligations, local operation lifetimes, placement versions, and purpose-specific readiness records. Mutation outcome records keep receiver publication separate from an independently pending result. Ordinary invocation returns its result directly through the common completion continuation. Phase 9F-B owns the bounded placement-lifecycle consolidation; Phase 11 remains a preservation check, not another Promise rewrite. Phase 9D-C gives the existing Promise-backed placement mechanism one coherent vocabulary and lifecycle without changing its semantics. Cascada's compact causal sources and bounded diagnostic presentation remain useful; its broad catches, cause-only collection, and mutable poison control fields are replaced. Its existing single root fatal race is not evidence of a current per-operation retention leak; the bounded-obligation design is needed when generalizing outward completion to every pending public operation.

Recoverable graph **Errors** are ordinary non-thenable PoisonError and CompoundPoisonError instances. Ready and pending normalized kernel results carry them as data after required processing. A separate PoisonedValue supplies rejecting transport at expression extraction and explicit higher-runtime failure propagation. Successful Error inspection remains data; collection membership, source attribution, and publication do not depend on expression transport.

## Method

Bake each settled decision into its owning phase's requirements and verification. Remove superseded instructions, historical alternatives, and resolved contradiction entries wherever they describe that decision. Keep concrete removal tasks for code that still exists, but do not retain obsolete designs as phase history or explain settled requirements through a sequence of corrections.

Distinguish semantic defects from documentation clarifications and implementation improvements. Class-hierarchy wording and the placement of an internal helper do not by themselves establish an architectural contradiction. Choose simpler implementations autonomously while preserving the required observable behavior and resource invariants.

Resolve internal representation and reuse choices autonomously through source inspection, implementation, and integration verification. Use a separate bounded prototype only when concrete competing implementations have a material tradeoff that inspection cannot resolve. Consult the user when a choice would change agreed behavior or guarantees, introduce an input limitation, require a substantial performance-versus-simplicity tradeoff, or remain unexpectedly complicated enough to warrant revisiting a requirement. Present the concrete issue, recommendation, and remaining tradeoff. Do not reopen an already-settled decision or request confirmation merely to choose helper placement, internal storage, or another equivalent mechanism.

Implement each phase independently. After every phase:

- reproduce the affected behavior and add integration coverage;
- run the complete suite;
- exercise the `test/verify-refcounts.js` oracle through its calling test fixtures; loading that helper alone is not a refcount validation run; and
- review the result for structural simplifications, unifications, dead weight, and load-bearing complexity.

Prefer one general transition over special cases. Do not pin helper boundaries, Promise version fields, cycle-cut placement, exact counters, or another interchangeable representation. Delete superseded mechanisms in the same change.

### Standing verification

Keep one small CI test that imports the actual public package surface and classifies each export as an execution-bound semantic operation, non-blocking construction, contextless configuration, recognition/data, a guarded composition helper, or a delegating alias. Every public operation owns its pending result once; helpers do not register merely for composing work, and aliases do not wrap an already exposed result. Phase 9D-B removes the integration-only subpath and adds primitive extraction and the shared Error/expression factories. Higher-runtime operations with additional required work own their own completion; pending kernel calls remain distinct API operations.

Verify Error and Promise semantics through focused behavior tests rather than a custom syntax analyzer. When a phase changes Error construction, audit its trusted factories and assert the resulting source, kind, identity, and graph effect. When a phase changes Promise production or transfer, audit the affected constructors, combinators, registrations, stored callbacks, and derived reactions; run the suite with strict unhandled-rejection behavior and test the relevant settlement routes. Syntax cannot prove ownership or dynamic graph effects, so do not maintain a semantic classification manifest that merely records reviewer assertions. Do not add a production registry, wrapper Promise, generalized result algebra, or runtime validation solely to make verification easier.

Whenever a phase changes operation terminal routing, its focused tests assert local owner closure, an empty release set, and balanced leases for every live-execution success, language-Error, supported-failure, and early-completion branch it touches. Pending work and fatal execution are explicit exceptions with their own assertions; do not infer global JavaScript quiescence or track every owner process-wide.

Carry the placement-version and publication regressions in 9D-A through their later implementation owners: 9D-B preserves their membership with ordinary graph Errors; 9D-C renames the placement mechanism atomically; 9F applies logical-version copying and complete independent result/publication outcomes to external snapshots and managed/external completion; 9F-B consolidates capture, retention, and version transitions while preserving those regressions; Phase 10 verifies resumed path publication through every ancestor, with gate completion captured before later work; Phase 11 preserves these behaviors without another settlement mechanism; Phase 13 checks causal membership and ordering through compiler-issued operations and final script export. New routes use the same version, storage-commit, and outcome rules, including the [managed-storage Proxy contract](data-limitations.md#proxies-in-managed-storage). Do not treat these later routes as tested by the current kernel suite.

---

## Phase 0: Fixed-bound ArrayView prepend behavior

Complete.

### Final design

- An ArrayView has fixed start and end bounds and reads through one effective backing; a logical index translates by the start bound.
- `unshift` mutates a sole-owned native Array directly and otherwise uses the remap path. It does not move storage shared by fixed views.
- Array method dispatch has no prepend-specific view strategy.
- ArrayView attachment still pins the raw Array's current logical bounds, allowing later values to reuse its backing without changing earlier values.

### Verification

- `unshift` matches JavaScript for owned and preserved receivers.
- Earlier values remain unchanged across `slice` and repeated `unshift` operations.
- Append at the physical endpoint still reuses runtime-owned backing while earlier fixed views remain unchanged.

---

## Phase 1: Ref indexing must not create sharing

Complete.

### Final design

- Ref indexing records counters, reverse parent edges, and cycle cuts; it records no ownership.
- A DFS back edge becomes a cycle cut without making its target shared. `setCycleCut` alone keeps the reverse-parent projection acyclic.
- Multiple paths from one owner to the same identity, including aliases and cycles, do not change ordinary COW strategy. Real additional owners, leases, and import retain their existing protection.

### Verification

- An exclusive cyclic or diamond graph behaves identically with and without a preceding Error query.
- Index creation and cycle-cut placement do not create sharing or change ordinary path-mutation strategy.
- Real sharing, leases, and import still preserve their logical values, including through ArrayView reuse.

[`cycles-as-data.md`](cycles-as-data.md) records the ownership-independent projection rule.

---

## Phase 2A: Logical failures and representation limits

Complete.

### Final design

- A live Promise version supplies its logical value before physical inspection. Otherwise a graph placement is exactly an own enumerable string-keyed data property; accessors, non-enumerables, inherited properties, and missing keys are absent and are never invoked.
- Reads, enumeration, import, COW, indexing, and mutation use that one property policy. Exact user-controlled reflection is captured at the primitive that invokes it; the owning operation returns or publishes its Error while adjacent runtime failures remain fatal.
- A physical blocker is a representation condition, not a language Error. Ordinary mutation uses the same path-copy fallback as COW. Final assignment shadows a physical non-placement in the new container, and final deletion treats it as absent.
- Controlled Array mutation derives a view or runs its intrinsic once against an ordinary sparse Array of placement references, then publishes the resulting candidate through the protected receiver scope. Length assignment likewise preserves its baseline and materializes only the final range. Invalid Array length remains poison; restricted source storage does not prevent building a new logical Array.
- A failed mutation preparation, logical transition, or synchronous mutating-function call publishes failure at the selected mutation scope and returns the same Error. Use ordinary prefix failure only before reaching that scope. Observations return an Error without changing their receiver; an independent result failure does not poison an otherwise valid mutation.
- A final missing read is `undefined`, assignment creates the placement, and deletion is a no-op. Traversal through missing, `undefined`, or primitive data publishes one path Error through the common scope transition, using the first failed placement only before reaching the scope and including the owning Array where required by structural effects. Reaching an existing Error preserves and returns that identity.
- Invalid intrinsic targets use their containing receiver placement as the default scope; an explicit ancestor scope still owns failure. Request validation before `run` captures a receiver remains an API-only Error.
- Supported host calls, controlled callbacks, and reflection hooks reject synchronous re-entry into their own execution as a fatal host-contract violation. Another execution remains independent. Trusted `enter` callbacks retain their existing fatal-abort behavior.
- If import fails after marking an identity, a later explicit import revisits that identity and resumes admission instead of treating the partial metadata as completion.
- Normal property helpers keep their ordinary return types; one private boundary-failure signal carries exact thrown user code to the owning transition.

### Verification

- Integration coverage verifies absent accessors and non-enumerables, representation fallback, missing-value semantics, poisoning and refcounts, exact reflection failures, fatal same-execution re-entry, and permitted entry into a separate execution.
- Imported and protected sources remain unchanged; valid mutations on ordinary restricted storage materialize only when the planned transition needs it.
- `enter` callback failure retains fatal abort semantics.

[`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and [`import-processing.md`](import-processing.md) record the completed behavior.

---

## Phase 2B: API Promise transport and Error aggregation

Complete.

### Final design

- Graph-value rejection becomes poison; rejection from a trusted transition with no language Error outcome is fatal. Native Promises and supported custom thenables retain their ordinary FIFO continuation protocol.
- Return a ready value or contextual Error directly. A pending kernel operation fulfills with its completed logical value or ordinary Error after required boundary effects. An independent result Promise does not extend completed receiver protection. Rejecting expression transport is selected only at primitive extraction or an explicit higher-runtime outward boundary.
- The existing semantic completion continuation performs required admission, publication, and lease release before exposing its result; no separate result observer is needed.
- Scope leases to actual pending use. Controlled argument preparation releases its receiver before invocation; a controlled method that continues reading its receiver owns that lease itself. An independent controlled result never prolongs receiver protection. Export captures managed inputs without source leases; a returned host Promise retains only exact external ordering resources that external code may still use.
- Ready `assignPath` and `deletePath` failures return their Error. Successful and suspended calls return `undefined`; later poison is published in the graph without a hidden result rejection.
- Internal bookkeeping observers handle their own failures and leave no unhandled rejection.
- The `combineErrors` factory establishes the leaf-only `.errors` invariant by expanding direct compound inputs one level and deduplicating by raw cause, source-error-context identity, and kind using the rule shared with `getErrors`. It normalizes before allocating an Error: an input representing the complete union returns unchanged, including a compound; otherwise a sole leaf returns unchanged and several leaves require a new compound. The constructor trusts and freezes the finalized leaf array. Recursive flattening is unnecessary because every input compound already satisfies that invariant. A leaf without a cause uses its own identity for that component; an explicit null or undefined cause remains a cause. Child order is unspecified, and each caller supplies the boundary message.

### Verification

- A selected observation executable that throws synchronously returns its Error. A selected mutating executable that throws synchronously also publishes failure at its selected mutation scope.
- A rejected graph Promise poisons its captured property version. An operation that observes that transition produces the Error, while `hasError`, `getErrors`, and other Error consumers produce their declared results.
- A direct host Error applies the same boundary and receiver-failure effect whether returned, fulfilled, thrown, or rejected. An independent nested result failure does not change already-published receiver state.
- Ready `assignPath` and `deletePath` failures return an Error; successful and pending work returns `undefined`, with no hidden derived rejection.
- Direct and delayed synchronous invocation failures produce the same graph and Error result.
- Runtime bookkeeping observers do not replace the operation result or create additional unhandled rejections.
- Pending controlled arguments preserve the captured receiver until invocation. A captured independent result does not force later mutation to copy that receiver, while an ordered search that continues reading after a pending element does.
- Whenever preparation supplies one Error to combination, it propagates unchanged; several preserve complete cause/source/kind membership with unspecified child order. Common call preparation discovers them across mixed ready and pending inputs.
- Export and later consumers use the same Error-combination utility.
- `enter` callback throws and raw callback-Promise rejections remain fatal. An admitted poison return or rejection runs ordinary entry completion and preserves that Error.

Direct host results cross their causal import boundary before exposure. The existing completion continuation performs import, contextualizes a raw rejection, and preserves an existing poison.

Every direct language-result Error means its boundary failed regardless of transport. Existing poison propagates by reference; independently constructed wrappers with equal cause, source-error-context identity, and kind are equivalent for collection.

[`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and [`outbound-export.md`](outbound-export.md) record the completed behavior.

---

## Phase 3: Use one out-of-object metadata store

Complete.

### Final design

All identity metadata lives in one `WeakMap`:

- make `metaOf` a direct `WeakMap.get`, which safely returns `undefined` for values that cannot have metadata and triggers no Proxy reflection;
- insert new records only in that map;
- keep no inline storage mode, metadata Symbol, or import migration; and
- keep imported and runtime-owned values physically unchanged by bookkeeping.

### Verification

- Metadata lookup changes no identity and triggers no Proxy reflection.
- Imported language containers carry metadata without physical modification.
- Ownership, Promise-version, ArrayView, and refcount behavior remains conformant through the single store.

---

## Phase 4: Data-type and identity classification

Complete.

Phase 6 renames this phase's registered classes to managed classes and opaque identities to external identities; this section retains the names used at its implemented phase boundary.

### Final design

Every available value has one admitted category represented by a member of the frozen `TYPE` vocabulary: `TYPE.Error`, `TYPE.Array`, `TYPE.Function`, `TYPE.String`, `TYPE.Primitive`, `TYPE.Record`, `TYPE.ManagedClass`, or `TYPE.External`. The numeric values carry no meaning or ordering. A callable thenable is resolved at its captured property version before its available result is admitted; Promise therefore has no type member.

Admission is the sole ordinary type-classification boundary. `admitValue` samples thenability at the current program position and leaves a pending Promise unclassified. Its first callable `then` and optional native FIFO queue live in separate Promise-capture state, so pending transport never creates typeless value metadata. Continuation registration invokes that exact function, and no layer reads `then` again.

`getOrCreateMeta(value, knownType?)` is the sole metadata-record creator. Existing records win; a known runtime-created type avoids reflection; otherwise creation classifies the available value and stores all resulting facts atomically. `admitReadyValue` delegates to it without replacing the input. If classification reflection cannot identify a supported structure, creation conservatively admits that object unchanged as opaque. A non-fatal failure while sampling or invoking `then` is captured as that Promise's rejection and follows the ordinary property-version resolver. Every created metadata record therefore has a fixed type, and every later operation requires and extends that record.

Class registration records the exact prototype in a dedicated `Set`; it does not admit or attach metadata to the prototype. An admitted instance stores that exact prototype with `TYPE.ManagedClass`. The registry and instance metadata are separate because a subclass prototype may itself be admitted as an instance of its registered base while also defining another registered class. An instance admitted before registration remains opaque. Type and class definition remain fixed across later registration. Admitted prototype changes are unsupported. Records and registered instances use one admitted `prototype` fact for copying; later work never re-reflects on the value to derive it.

Records, Arrays, and registered instances are traversable. Functions, Errors, and opaque identities can carry import, ownership, and lease facts, but graph traversal stops at them. `new Chain(value)` admits its root without changing ownership or import status; normal property reads admit children before any identity fact is recorded.

Semantic category decisions consume admitted type. The class registry is read only during first admission; later decisions never reclassify an instance from its prototype. Other structural checks remain only for representation and property shape. `isTracked`, typeless metadata, and public semantic prototype classification are absent.

### Verification

- Every category in `AGENTS.md` is classified independently of method name, using named numeric constants.
- A Promise is resolved before classification; an Error is classified as available terminal data.
- Thenability is sampled once at a program position; both callable and non-callable samples are covered, and direct admission leaves a Promise identity unclassified.
- A fresh assigned graph is admitted at issuance, so nested Promise discovery protects any COW attachment before later mutation.
- Native Error recognition precedes thenability and does not depend solely on ordinary prototype inheritance.
- Class registration uses a dedicated `Set` of exact prototypes and neither admits nor modifies them.
- Admitting a registered subclass prototype preserves both its base-instance classification and its own class definition.
- Metadata creation classifies the available value or accepts its known runtime-created type; every created record is typed.
- Callable-then capture uses separate Promise state and creates no value metadata.
- A previously unseen child is admitted before extraction, sharing, leasing, indexing, or Promise-version installation records facts on it.
- A class registered before admission is registered data; an instance admitted first remains opaque.
- Array and Promise subclasses retain Array and Promise semantics even if registered.
- Every semantic category decision uses admitted type; remaining structural predicates cannot override it.
- Import, extraction, and leases record identity facts on opaque instances without traversing them.
- Classification lookup after admission adds no Proxy reflection, and later declarations do not reclassify an admitted identity; admitted prototype changes are unsupported.
- A classification reflection trap preserves the exact object and admits it as opaque.
- Non-fatal synchronous `then` acquisition and invocation failures become captured rejections; ordinary Promise resolution publishes their Errors without changing imported storage.
- `new Chain` admits type while preserving ownership status.
- Invalid class registration is reported as a fatal host-contract failure.

---

## Phase 5: Registered-class invocation

Complete.

### Design

[`managed-invocation.md`](managed-invocation.md) records the generalized boundary, including the direct-Promise lifetime added in Phase 8; Phase 5's implemented call itself was synchronous.

#### 1. Establish the common invocation lifecycle

Record, Array, String, registered-class, and unsupported receiver selection use one invocation lifecycle. Replace the internal Array-mutation Boolean with an observation-or-mutation request interpreted after receiver classification. The lifecycle coordinates category-owned method selection, selected input preparation, leases, ordered Error collection, one invocation, mutation publication through `transformProperty`, result admission, and cleanup. Each receiver category defines its selection rules, capabilities, and consumed state. Preserve controlled Array methods' selective input preparation.

Before pending work can retain a source, lease every reached record, Array, and registered instance. Acquire further leases as required Promise resolution reveals identities, and release each lease after the operation's last access. External calls consume every explicit argument, while controlled methods consume only the branches selected by the method. Resolve and inspect every consumed input even after finding an Error. Preserve input positions and successful effect ordering; collect complete cause/source/kind membership with unspecified Error order.

#### 2. Prepare registered-class calls

One registered-class receiver-category module follows the isolation contract in [`managed-invocation.md`](managed-invocation.md). Registration rejects callable or accessor `then` on the retained prototype chain so later output transport cannot assimilate an instance. Unrelated prototype accessors are permitted but unavailable as Cascada methods; selected-method lookup rejects an accessor without invoking it. Method-behavior restrictions are trusted except for the receiver and result validation specified below; the boundary adds no snapshots, comparisons, or scheduling instrumentation to detect violations.

After registered-class method selection succeeds, prepare every explicit argument and the complete receiver graph in one operation-local state through existing property-version continuations. Preserve aliases and cycles across materialized inputs and expose logical values without changing imported storage. Observations use leases without a gate; pending mutations use the ordinary receiver gate.

#### 3. Isolate registered-class mutations

The [pre-call isolation and mutation lifecycle](managed-invocation.md#mutation-isolation) is:

1. During preparation, lease every traversable identity reachable through any argument; keep those leases through finalization and release receiver-only preparation leases.
2. Isolate the prepared receiver once with one fresh copy map. Copy the receiver root when the ordinary mutation context must preserve it because an ancestor path was copied; otherwise use a predicate composed from ordinary identity COW protection, bookkeeping invalidated by direct JavaScript mutation, and Array materialization.
3. Materialize arguments once for host representation, applying copied receiver identities to argument roots and nested paths during that same walk.
4. Invoke once and synchronously.
5. Walk the final receiver once: reject any Promise or Error, admit new identities as runtime-owned, and mark each actively leased traversable identity shared; every other identity remains exact. Allocate no finalization copy or separate source-identity collection.
6. Return the final working receiver as `mutatedValue`; let `transformProperty` decide whether publication is required and release all argument leases after finalization.

Use one metadata-free complete-graph copier for qualifying isolation subgraphs and, with a separate forced-root map, registered-class results. Preserve aliases, cycles, and registered-class prototypes while keeping opaque identities and Functions exact; materialize every logical Array as an unattached native Array with the same logical structure. Reconnect isolation copies through ordinary placement replacement. Preparation failure, final receiver failure, or a synchronous throw poisons the receiver through the common mutation transition.

#### 4. Admit results and classify failures

Return the published receiver when a mutation returns `this`; otherwise copy and admit traversable results as specified by the Phase 5 contract later superseded by Phase 8. Promise-valued result data becomes an independent validation Error and is never awaited. A valid mutated receiver still publishes. Runtime invariant failures and host-contract violations exposed at existing boundaries remain fatal; an explicitly returned Error remains an ordinary result.

#### 5. Keep registered behavior at the invocation boundary

Registered-class invocation adds no persistent state and no registered-class-specific graph behavior outside its boundary. Do not snapshot arguments or support registered-class accessors or asynchronous registered-class methods. Registered instances remain ordinary graph data outside invocation; assignment, deletion, lookup, import, `enter`, refcounting, Promise versions, and path COW gain no registered-class-specific path.

### Verification

#### Common invocation

- Records, Arrays, Strings, registered instances, and unsupported receiver categories share one invocation coordinator; category selection retains each supported mode and rejects unsupported opaque execution without invocation.
- Pending argument preparation leases every exact traversable source retained by a continuation, including identities revealed by Promise resolution, and releases all leases on success or failure. Controlled Array calls reuse this mechanism without resolving retained payloads.

#### Registered preparation and calls

- Ready registered-class calls invoke and return synchronously. Pending receiver and argument preparation preserves captured property versions and FIFO order.
- Nested registered state such as `Line3 { start: Vec3, end: Vec3 }` receives settled prototype-preserving values with aliases, cycles, Array holes, and logical property values intact. Imported Promise storage is not modified.
- Several prepared input Errors are combined once with complete cause/source/kind membership at the top level and unspecified Error order.
- A registered-class observation cannot observe a later mutation while its preparation is pending. Its receiver lease provides COW protection without a snapshot or gate, but does not protect against a method violating the trusted read-only contract.

#### Mutation isolation

- Every mutation uses the same selective isolation walk and preserves prior and imported owners without a first-mutation marker or registered refcounts.
- A receiver reached beneath a copied ancestor is copied before registered-class code runs, so direct class mutation cannot change the ancestor's preserved value.
- A protected receiver root takes the complete-copy path. The pre-call walk allocates no receiver graph copy when no reached identity qualifies; cycles only expand a copy already required. No graph-size heuristic or separate copy-decision pass exists.
- Mutation isolation remains correct for ready and pending argument identities. When the receiver and an argument overlap, an argument root or nested occurrence of a copied receiver identity is remapped to the same copy without copying unrelated argument data. An empty copy map adds no isolation copy; representation materialization remains independent. Promise discovery and cycles back to a receiver ancestor also preserve correct isolation.
- Every argument lease acquisition is balanced after finalization. Any actively leased identity retained in the receiver remains exact and becomes shared before its lease ends; every other identity retains its ordinary admission and ownership state.
- An isolation-created receiver-root replacement is published even when finalization leaves it unchanged. Finalization never makes the publication decision.
- An Error anywhere in the prepared receiver graph poisons an observation result or the mutation's selected scope. A Promise or Error left in the completed receiver, other preparation poison, and a synchronous throw follow the same common failure path without publishing invalid state. A Promise or other language failure confined to an independent result affects only that result and does not poison a valid mutated receiver.

#### Class and result contracts

- A conforming method may store an argument-only identity for mutation in a later registered-class call. A receiver-argument alias uses the isolated receiver copy without changing the original Cascada argument; no runtime mutation detector or argument snapshot enforces the trusted restriction.
- Returning `this` yields the published receiver and marks its additional ownership. Every other traversable result is copied unconditionally into a graph independent from the receiver and arguments, preserving its own aliases, cycles, registered-class prototypes, and logical Arrays as unattached native Arrays.
- Registration permits unrelated prototype accessors but never selects them as Cascada methods; it rejects callable or accessor `then`, and a Promise-valued result is rejected without being awaited. At this phase endpoint, trusted representation, external-state, re-entry, and post-return restrictions add no registered-class-specific enforcement machinery; Phase 9C later supplies the common execution-scoped external-action guard. Ordinary registered state access remains ordinary graph access.
- No ordinary graph operation stores a registered-class ownership unit or gains a registered-class-specific transition.

The current generalized behavior is documented in [`managed-invocation.md`](managed-invocation.md), [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), and [`run.md`](run.md).

---

## Terms used by the remaining phases

- **Declaration:** an explicit managed-or-external choice recorded before admission. Declaring an identity neither admits nor modifies it.
- **Admission:** the first and permanent classification of an available identity.
- **Origin:** whether an identity first entered from host data or was created within Cascada. Origin affects ownership but not admitted category.
- **Import:** the inbound boundary that admits host data entering Cascada.
- **Export:** the outbound boundary that produces host-ready data independent from managed storage.
- **Direct Promise:** the Promise returned directly by a host call. It extends that operation until settlement, so Cascada returns one **operation Promise** representing boundary completion. A Promise nested inside a synchronous result is data and does not extend the operation.

---

## Phase 6: Establish state modes and inbound admission

### Problem

The current state controls are too coarse. Records and Arrays are always managed, while class instances are external unless their entire class is registered. Cascada needs identity-level overrides for both defaults. Import also infers origin from operational metadata and duplicates traversal for imported and runtime data.

### Design

This phase implements the declaration, admission, and common-import foundations of [`managed-and-external-state.md`](managed-and-external-state.md). Later phases implement its export, managed-invocation, and external-operation sections.

### 1. Add declarations

Records and Arrays are managed by default; class instances are external by default. Add these overrides:

- `externalState(value)` declares one exact record, Array, or class instance external. It is shallow and overrides `managedStateClass` for that instance.
- `managedState(value)` declares a class instance, or walks an unadmitted managed record, Array, or class instance once to declare every currently reachable class instance. It preserves aliases and cycles and does not register encountered classes. Nested declared or admitted external identities, uninspectable identities, Errors, Functions, and admitted managed identities stop the walk; an external or uninspectable root fails.
- `managedStateClass(...classes)` declares each supplied exact class prototype managed for instances admitted later.

All declarations follow these rules:

- Successful `externalState` and `managedState` calls return the exact value. An Error value is returned unchanged without being declared.
- `managedStateClass` returns `undefined` on success. It validates every supplied class before changing the registry and returns a validation Error if any class or prototype is invalid.
- Declaration neither modifies nor admits an identity.
- Sampling a declaration input captures its thenability once; this availability fact is not category admission.
- Store identity declarations in one external `WeakMap` and managed class prototypes in one `Set`.
- Repeating a declaration is idempotent; an opposing identity declaration returns a validation Error.
- An identity declaration overrides a class rule; in particular, `externalState(instance)` overrides `managedStateClass(instance.constructor)`.
- A conflicting identity declaration returns a validation Error without changing existing state. Declarations must precede admission: a late declaration never reclassifies an identity already admitted in an execution and is unsupported because it can affect admission in a later execution.
- Validate the complete operation before recording anything, including nested class instances, aliases, cycles, prototypes, and conflicts.
- Class instances added later follow their own identity declaration or exact class rule. Managed containment neither declares them nor registers their class.
- Every managed class prototype satisfies Phase 5's registered-class prototype contract.

Declaration inputs are synchronous:

- `externalState` returns a validation Error for a Function, Promise, callable thenable, or primitive.
- `managedState` returns a validation Error for a Promise or callable thenable anywhere in its declaration walk. An encountered Error is preserved and ends only that branch.
- A declaration returns a validation Error for any other intrinsic category that the requested mode would have to change.
- Neither API waits.
- Arrays remain managed unless explicitly declared external.

#### Renames and removals

- Replace the registered/opaque state terminology with managed/external state.
- Replace `registerDataClass` with `externalState`, `managedState`, and `managedStateClass`; add no compatibility alias.
- Reuse registered-class prototype validation until Phase 8 renames registered-class invocation to managed invocation.

### 2. Make admission authoritative

Resolve callable thenables before admission, then classify in this order:

```text
Error or Function                         -> preserve its intrinsic semantics
explicit external identity declaration   -> external
logical Array                            -> managed Array
explicit managed identity declaration    -> managed
record                                   -> managed
class in exact managed-prototype registry -> managed class
other class instance                     -> external
```

Admission then:

- Stores the final category and prototype in existing identity metadata.
- Uses the prototype present at admission; an earlier identity declaration does not bind it.
- Consumes any identity declaration used for that admission.
- Never changes that classification later.
- Makes runtime behavior consult admitted metadata, not declaration registries.
- Gives a managed copy fresh metadata containing the source category and prototype, but no identity declaration or class-registry entry.
- Preserves an identity's established classification and origin.

Import consumes admitted categories but does not own classification or infer classification or origin from operational metadata.

### 3. Rewrite import as one inbound walk

Keep the existing public `import(value, errorContext)` API and make its implementation the common inbound boundary. In this phase, use it for:

- a host root explicitly passed to public `import`, including each context root as a whole;
- call results already handled by common host invocation.

A Promise fulfilled from either boundary continues that same import; it is not another boundary case. Phase 8 routes managed-method results through this importer. Phase 9F-A does the same for external calls and property reads. Neither phase adds another inbound walk.

Do not import Chain construction from existing Cascada data, assignment, return, or internal transfer. Those operations preserve admission, origin, and ownership. External identities remain observation-only until Phases 9A–9F add mutation authority and ordering.

Implement declarations and authoritative admission before replacing the imported/runtime split with this lifecycle:

1. Pass one complete ready or direct-Promise host result to import.
2. For each synchronous segment, capture and validate its complete reached shape before committing metadata.
3. After validation, record new origins, mark new managed identities imported and shared, and walk each new managed identity once.
4. Preserve aliases and cycles; traverse records, Arrays, and managed class instances; stop at Functions, Errors, and external identities.
5. Register each reached Promise placement through its captured property version. Fulfillment re-enters the same import boundary for newly reached values.

The importer honors any `externalState` or `managedState` declarations carried by host results.

Boundary outcomes are:

- A ready result returns its admitted logical value.
- A direct Promise returns one operation Promise. Its causal completion produces the imported value or an ordinary contextual Error, including for raw rejection; a normalized recoverable outcome fulfills with that Error.
- An identity already admitted in the current metadata store keeps its category and origin. Retain it without another graph walk and mark it shared only when the result adds an owner. Phase 9B later scopes that store to one execution.
- Imported physical storage keeps its Promise. The Promise version publishes logical settlement without imported writeback; runtime-owned storage permits optional writeback, retaining its logical value if that cache synchronization is refused.

Reflection and failure rules are:

- Enumeration and descriptor lookup remain at their existing user-code boundary.
- Do not invoke ordinary accessors or inspect non-enumerable properties.
- An import-walk enumeration or descriptor failure commits no origin, sharing, or Promise version from that synchronous segment.
- Boundary failures become language Errors; internal failures remain fatal.

Delete the superseded imported/runtime split and its supporting machinery: runtime-island detection, `hasOperationalMetadata`, `promoteRoot`, the runtime walk, `runtimeScanned`, `metadataBeforeRuntimeScan`, `discoverRuntimePromise`, the root/result preparation split, host-change reconciliation, and import-specific ArrayView handling.

Phase 7A adds the matching outbound boundary without reopening admission. Phase 9F-A reuses this importer for external operations.

### Verification

#### Declarations and admission

- Records and Arrays default to managed. `externalState` makes the exact record or Array external. An undeclared class instance defaults to external.
- Successful declarations return exact arguments, are atomic across nested classes, aliases, cycles, conflicts, and prototype validation, and never wait for Promises. An Error argument is returned unchanged; a nested Error ends only its `managedState` walk branch.
- Repeating a declaration is idempotent; a conflicting declaration changes nothing.
- `managedStateClass` affects only later instances. Identity declarations override defaults and class rules; conflicts return an Error without reclassification.
- `externalState` stays shallow and exact through every alias.
- Copies preserve admitted managed-class category and prototype without acquiring declaration entries.

#### Import

- Public import accepts arbitrary host roots, honors declarations, and leaves external identities observation-only. Existing Cascada values transferred internally are not imported again.
- One importer handles host roots and supported host results, visits each new managed identity once, preserves aliases and cycles, and stops at external identities, Functions, and Errors.
- Existing identity metadata recognizes an admitted result without another graph walk or origin change.
- Ready and Promise-backed host results have the same admission outcome. Direct fulfillment cannot publish a raw value whose admission failed; rejection remains rejection.
- Imported Promise fulfillment continues the captured import boundary and remains Promise version-only. Runtime-owned Promise settlement permits optional writeback, retaining its logical value if that cache synchronization is refused.
- Import invokes no ordinary accessor. A throwing enumeration or descriptor trap commits nothing from that synchronous segment and produces the boundary's language Error; internal failures remain fatal.
- No runtime-island scan, compatibility registration, or registered/opaque category API remains. Host mutation of imported managed storage remains unsupported.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`data-classes.md`](data-classes.md), [`import-processing.md`](import-processing.md), [`array-view.md`](array-view.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 7A: Centralize outbound export

### Problem

Export is scattered across host-call categories. This duplicates availability resolution, copying, and lease lifetime decisions at each outbound boundary. A failed operation can also release its leases while an already-registered continuation later acquires another one.

### Design

[`managed-and-external-state.md`](managed-and-external-state.md) defines the complete inbound and outbound boundary architecture shared with Phase 6.

### 1. Use one export boundary

Use one exporter and one boundary graph copier for:

- every explicit argument passed through an existing host call; and
- every script result.

Phase 7C reuses the exporter for controlled host-callback inputs. Phase 8 reuses it for managed-method arguments. Phase 9F-A reuses it for external-method arguments and external-property assignments.

Keep `run(chain, path, method, mutation, ...arguments)` through Phase 8. Its rest parameter already supplies one internal argument Array; pass that Array directly to common export. Phase 9A replaces the signature with the argument-Array and operation-facts API; Phase 9F-A adds repair to that facts record when repair becomes usable.

Existing managed-record receiver calls remain on their current path until Phase 8 replaces them with managed invocation. A managed receiver is invocation working state, not an exported input.

The common export walk:

- Resolves every Promise reached while exporting an input or result.
- Copies managed records, Arrays, and class instances into independent host data.
- Accepts ordered top-level roots as one batch and uses one identity map, preserving aliases across arguments.
- Keeps Error collection separate per root, then combines failed roots in root order.
- Preserves cycles and admitted prototypes.
- Creates class-instance copies without invoking constructors.
- Keeps Functions and external identities exact.
- Produces no unresolved language Promise, ArrayView, Promise version, metadata, or other internal representation.

Call categories select single-root or batch export; they do not implement another export, copy, readiness, or Error walk. Put preparation, Promise continuation, copying, and Error collection in the export module. Invocation, Array, observation, and script-result code call that module rather than wrapping or extending its walk.

This boundary copier remains separate from Phase 5's complete-graph copier. Boundary export resolves Promise-backed state and consumes every Error; receiver isolation copies already prepared private state and rejects Promise or Error state. Parameterizing one copier for both jobs would merge different invariants rather than remove duplicate behavior.

Export preserves admitted managed-class prototypes. This makes exported managed-class values usable without invoking constructors. Classes that depend on native internal slots, such as `Date`, do not satisfy the managed-class contract and must remain external.

### 2. Never export Errors

- Every root consumes every distinct Error reached beneath it and becomes that Error or one compound Error.
- Batch export preserves successful root positions and combines failed roots with unspecified Error order, flattening nested compounds and deduplicating leaves by cause/source/kind.
- Any reached Error prevents host invocation or assignment and replaces a script result. No Error crosses the host boundary.

Use this one rule for script results, host arguments, controlled callback inputs, and Phase 9F-A external-property assignment. Add no policy switch or second Error walk.

### 3. Correct lease lifetimes

Keep two lease purposes distinct:

- A **selection lease** protects each ready managed traversable argument root while a pending receiver prevents boundary selection.
- A **call lease** protects a selected managed identity that the call will read later or publish as retained logical data.

Use one small lease-ledger mechanism for both purposes, but keep separate ledgers where last access differs. Selection, receiver, and retained-payload leases cannot share one release point without either releasing protection early or retaining it longer than needed. The export output lifetime is not a lease ledger: it may discard output while the complete Error scan must continue.

When the receiver becomes ready:

1. Select the call boundary.
2. Start selected preparation synchronously. Each input must be captured into export output, protected by any required call lease, or identified as ignored.
3. Release every selection lease immediately after that handoff, whether preparation returned a value, Promise, Error, or threw.

An exported or ignored input keeps no lease after the handoff. A retained controlled-method payload keeps its call lease until publication or local operation closure.

Register pending-operation cleanup even when its lease collections are initially empty. Each collection has its own closed state and release point:

```text
retain(collection, value):
  if collection is closed or already contains value: return value
  if value is ready, managed, and traversable:
    increment value's lease
    add value to collection
  return value

release(collection):
  mark collection closed
  release every value in it
```

Close the selection collection at the synchronous handoff and each call collection after its last access. In a live execution, complete required Error collection before closing operation work on a recoverable aggregate failure; one input's Error or poison rejection cannot discard other required preparation. Already-registered work that outlives a permitted local closure must not leave a lease in a closed collection. Release is idempotent and never depends on the lease count observed when the operation first returns. Execution fatality follows Phase 9C's common early-exit rule and adds no collection sweep or fatal-specific lease cleanup.

Only managed traversable identities use read leases. A read-only `enter` therefore leases a managed traversable target, but not a Function or external identity. External ordering belongs to Phases 9 and 10.

Keep the existing load-bearing leases: managed receiver preparation, an exact managed receiver awaiting selected input preparation or direct-Promise completion, retained controlled payloads, an ordered Array search that resumes reading its receiver, and managed read-only `enter`.

### 4. Export without source leases

- Read and capture every available placement synchronously during each export transition.
- Capture a pending placement through its exact Promise version. Its FIFO continuation traverses every newly revealed branch synchronously before returning.
- After each transition, retain only output copies, identity maps, and captured property versions. Never reread already captured state; read a newly revealed branch once, synchronously, at the FIFO position of its captured Promise version.
- Acquire no managed source lease, and retain no selection lease after the export handoff. Later managed mutation may proceed normally without changing the captured export.
- Phase 9F-A independently keeps required external identity phases through settlement.

Export records no external use and grants no external mutation authority.

This is safe because a ready reachable identity is copied during the synchronous transition and later aliases reuse that copy. A value first revealed through a captured Promise version was not previously reachable through that placement, so its continuation can traverse it once without rereading earlier source state.

Delete only export's source-retention callback and lease-presence tests. Retention callbacks used by controlled methods for later reads remain call leases. Test snapshot stability while later mutation remains in place.

Export has an open output lifetime. Local operation closure releases partial output and copy state. In a live execution, an already-registered continuation still completes shared Promise-version and property-version settlement, then stops before allocating export output, invoking boundary reflection, or publishing an export result. Phase 9C makes an execution-fatal resumption stop before settlement as well. A reached language Error does not close the required Error scan: discard output copies but continue collecting every reached distinct Error. Preserve the captured-frontier, cycle, alias, and distinct-Error behavior documented in [`outbound-export.md`](outbound-export.md).

### 5. Reuse the matching inbound boundary

- Every existing host call uses Phase 6 import for its result, including the operation Promise for a direct Promise.
- Every script result uses common export.
- Phase 8 reuses export and import for managed methods.
- Phase 9F-A rejects mutation-capable external identities during host-input export, reuses export for external-property assignment, and snapshots values read from mutable external state.

### Verification

#### Boundary behavior

- Every explicit argument to an existing host call and every script result uses common export.
- One export batch preserves aliases across ordered roots. Each root consumes every required semantically distinct Error, and failed roots combine complete cause/source/kind membership with unspecified Error order. Successful root positions remain ordered, and no Error is exported.
- Exported managed data is independent and contains no unresolved language Promise, ArrayView, Promise version, or metadata. Managed-class copies preserve their admitted prototypes without invoking constructors. Functions and external identities remain exact; export records no use or authority.
- Export acquires no managed source lease, including while captured Promise properties remain pending. A returned host Promise therefore extends none.
- A reached language Error discards export output while its required Error scan completes. Fatal failure or closure by the owning operation closes the output lifetime, and later registered continuations perform no output allocation, reflection, or publication.
- Results from every existing host call use Phase 6 import.

#### Lease lifetime

- A pending receiver protects ready managed argument roots only until selected preparation synchronously captures, leases, or ignores them.
- Exported and ignored arguments lose their selection leases at that handoff, even while another input remains pending. Their sources can then mutate in place without changing captured export output.
- Retained controlled payloads remain protected until publication or failure.
- Cleanup closes the operation against later lease acquisition and releases every existing lease, including when one preparation branch fails before another resumes. Resolve the remaining branch after failure and verify that it leaves no lease or export output.
- Do not retain a test assertion merely because the old implementation acquired a lease; assert only protection required by the final lifetime.
- Read-only `enter` leases managed traversable targets only. Functions and external identities receive no ineffective read-lease metadata.
- Managed receiver preparation, direct-Promise receiver access, resumed ordered Array search, and managed read-only `enter` retain their required leases and balance them on every completion path.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`data-classes.md`](data-classes.md), [`outbound-export.md`](outbound-export.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 7B: Stop operation work after local completion

### Problem

Promise settlement may outlive the operation that registered it. While the execution remains live, shared placement-version, and refcount settlement must continue, but a locally closed continuation must not perform more operation-specific reflection, allocation, protection, invocation, or publication. Export already enforces this distinction by closing at every asynchronous layer before a fatal rejection reaches an aggregate. Error queries and later preparation rewrites need the same rule. Phase 9C adds the simpler execution-fatal rule: check fatal state first and skip both shared and operation work because the failed execution's graph is no longer observable.

### Design

Use the **Operation Work Lifetimes** contract in [`AGENTS.md`](../AGENTS.md). Unify the lifetime rule, not unrelated resource storage.

### 1. Close operation work once

- Keep one open/closed fact at the natural operation scope.
- Close it synchronously in the transition that determines the final operation outcome, before returning, resolving, or propagating that outcome. An unfinished sibling simply returns when it next observes the closed owner; add no separate signal. A direct Promise becomes final only after boundary completion.
- A reached data Error is not necessarily final. A graph-Promise rejection first becomes data Error: `hasError` may finish with `true`, while `getErrors` and export continue their required Error collection. Failure of operation-specific query traversal or indexing is fatal and never becomes collected Error data; a supported failure during shared property publication follows that publication boundary.
- In a live execution, a continuation first completes shared Promise-version and property-version settlement, including index maintenance required to publish into an already indexed graph. It then stops if the operation is locally closed. Phase 9C puts the execution-fatal check before settlement. Index construction or traversal requested only by the query is operation work and does not continue after either stop.
- Concurrent preparation components share the operation lifetime, while leases, gates, phases, and output state retain their own last-access and publication rules.
- Release operation-only strong state when closing if no unfinished result can use it. Late continuations retain only what they need to observe execution fatality first and, in a live execution, the local closed fact after shared settlement.
- Reuse an operation owner where one already exists. Error queries use local state; Phase 7B adds no shared lifetime module. Add no cancellation framework, task registry, adapter, raw-Promise path, or generic cleanup abstraction.
- Keep Phase 7A export's current lifetime unless replacing its storage measurably simplifies the code.

### 2. Close Error queries

Give each public `hasError` and `getErrors` call one operation lifetime around path resolution and branch search. Shared path and placement machinery receives no query-specific state. Phase 9F-B separates placement retention from operation lifetime; Phase 10 carries the common owner through pending path selection. Common guarded continuations may stop operation-local work after closure, but version retention and publication never infer ownership from that owner's presence, type, or open state.

- A successful synchronous result closes immediately. A pending result closes in the transition that produces its complete outcome, before fulfillment.
- A fatal operation-specific query or index failure closes the query before it escapes. It never becomes `true`, `false`, or part of an Error list.
- After an early query result in a live execution, later settlement still updates the captured Promise version, property version, and any index required by shared publication, then performs no query-specific indexing, traversal, or reflection. Phase 9C makes fatal execution resumption stop before settlement.
- Finding one Error completes `hasError`. `getErrors` remains open until it has collected every Error in the complete captured branch, including Errors revealed through its captured Promise frontier.
- Keep query state operation-local so concurrent queries over the same Promise frontier remain independent. Placement versions and the refcount index remain shared.

Keep the lazily created visited set, optional Error collection, and pending `hasError` resolver in the operation-local query state. The Error collection's presence distinguishes complete collection from first-Error search; no separate strategy or mode is needed. The open fact is the sole stop condition and replaces `hasError`'s former separate `found` state. A counter proof may complete `hasError` without an Error identity; `getErrors` records only reached identities.

Observe each captured property wait and the public path/query result so a fatal rejection closes at its originating asynchronous layer before aggregate propagation. Create the collected-wait `Promise.all` only if the synchronous walk remains open; its observed inputs make another aggregate observer unnecessary. Keep unused readiness observed so a later fatal rejection cannot become unhandled, but perform no query work after closure. Clear the visited set, pending resolver, and accumulated Errors on close so a never-settling sibling retains only the closed query fact.

Do not cancel shared settlement, detach versions, suppress source Promise rejection, or add another Error-search algorithm.

### 3. Reuse the rule in later phases

- Phase 7C applies it to all controlled Array operation work.
- Phase 7D orders internal dispatch, preparation, member resolution, isolation, and invocation.
- Phase 7E unifies the lifetime mechanism, applies it to registered preparation and Promise-aware scalar conversion outside invocation, and makes nested components share their operation's owner.
- Phase 8 extends the shared lifetime across managed receiver preparation and argument export.
- Phases 9F-A and 10 keep external boundary preparation inside the selected operation lifetime while preserving phase completion rules.
- Phase 10 applies it while Promise-valued path segments resume from their protected prefix.

### Verification

- Ready and delayed failures of operation-specific query traversal or indexing are fatal and never become query results or collected Errors. A shared publication failure that has already produced graph Error data follows ordinary Error-query behavior.
- After `hasError` completes early or either query fails fatally, resolving an earlier captured Promise performs required Promise version and refcount settlement but invokes no query-specific reflection.
- Early synchronous `hasError === true` leaves no active query work and no unobserved unused readiness rejection.
- A pending successful query remains active through its last required branch and closes in its final fulfillment transition. Fatal failure closes before its rejection propagates.
- A rejected graph Promise becomes Error data: it completes `hasError` with `true`, while `getErrors` still collects every other required branch.
- Concurrent queries over one Promise frontier keep independent query state when one closes early or fails while sharing settlement and index state.
- Closing releases accumulated query-only Error state even when an unused sibling never settles.
- Closing is idempotent and creates no lease, gate, phase, or output-lifetime behavior of its own.
- Export retains its captured-frontier and complete Error-scan behavior. Export and Error queries agree on graph Error data; fatal query or index failures are outside that data.

Update [`AGENTS.md`](../AGENTS.md), [`runtime-spec.md`](runtime-spec.md), [`counters-implementation.md`](counters-implementation.md), and [`cycles-as-data.md`](cycles-as-data.md).

---

## Phase 7C: Simplify controlled Array boundaries

### Problem

Controlled Array preparation uses a generic `exportArgs` mask even though most inputs need logical conversion or retention rather than host export. Working own and inherited Array overrides expose managed receivers and are intentionally removed. Native `concat` reflects on retained values, and supplied sort comparators receive exact managed elements.

### Design

Use Phase 7A's exporter only for the sort comparator's inputs. Keep every other controlled Array operation on logical values and internal remaps. Give the common invocation one Phase 7B operation lifetime covering all controlled Array work.

### 1. Use controlled dispatch only

Logical Arrays support only Cascada's controlled method table:

1. A table name selects that controlled operation without inspecting the host method surface. Validate its supported observation or mutation mode.
2. Every other name is unsupported. Do not inspect custom Array properties, prototypes, accessors, or proxies to find a callable.

Store each generic fallback's native intrinsic in the controlled method table. A specialized producer captures any intrinsic it needs beside its implementation. Never read `Array.prototype` during selection or invocation. This removes dynamic host-property reads from the call path; it is not a defense against primordial tampering. Controlled intrinsics receive only runtime-owned working data, prepared scalar values, or retained payload in positions that store it without inspection. Cascada assumes the global `Array`, `Array[Symbol.species]`, the standard Array intrinsics, and `Array.prototype` remain unmodified; document this trusted runtime requirement rather than adding protocol-defense machinery to every internal Array.

Delete Array-override selection, receiver export, result import, override-specific receiver-lease inference, and the Array own-language-property shadow check. The latter can only produce a misleading error for an index-shaped unsupported method name. Retain `requiresArrayMaterialization` only for representation mutation and COW. Preserve controlled behavior and eligible backing reuse. Imported Array storage never becomes mutable ArrayView backing. External Arrays use the public native boundary established by Phase 9F and preserved under hierarchical ordering in Phase 9F-A.

Keep the generic native-equivalence path: a definition without a specialized producer runs its captured same-named intrinsic against the internal remap. Keep `view`, direct observation, remap production, and native fallback as distinct load-bearing cases. Document their observation and mutation precedence in the table header rather than replacing them with a result union or hand-written method implementations.

### 2. Prepare only consumed inputs

Replace `exportArgs` with the controlled algorithm's actual input consumption:

| Methods and positions | Preparation |
| --- | --- |
| `at(0)`, `copyWithin(0..2)`, `fill(1..2)`, `flat(0)`, search `fromIndex`, `slice(0..1)`, `splice(0..1)`, `toSpliced(0..1)`, `with(0)` | Logical numeric conversion |
| `join(0)` | Logical string conversion |
| `fill(0)`, every `push`/`unshift` value, `splice(2...)`, `toSpliced(2...)`, `with(1)` | Retain exact payload |
| Search value | Resolve its top-level availability; an Error or rejection poisons, otherwise compare only identity or primitive value |
| Every `concat` item | Resolve only enough to classify it as a logical Array or non-Array value |
| `sort`/`toSorted` comparator | Resolve and validate an executable Function or `undefined` |

Preserve argument count and omission. Leave `undefined` available for position-specific defaults, and do not resolve ignored extra arguments. Retained payload keeps an Error or Promise unchanged; an Error or rejection in a consumed conversion, search, `concat` item classification, or executable position poisons the call. Use a small shared implementation for scalar conversion and retention; keep search, `concat`, and sort as the only custom preparations.

Logical numeric and string preparation deliberately replaces native coercion of exported objects. It never invokes `valueOf`, `toString`, `Symbol.toPrimitive`, or other host hooks on an external identity; an external object such as `Date` is invalid in such a scalar position. Managed records, logical Arrays, and managed classes retain Cascada's intrinsic conversion rules. This intentionally narrows native equivalence to supported logical scalar inputs.

Implement `at` directly from the prepared index and captured property placement; it needs neither a Proxy nor a native intrinsic. Prepared `slice` bounds are already Number or `undefined`, so remove its coercion fallback and derive a view or remap directly. `join` and Array `toString` continue to convert inspected elements logically before a native join receives only prepared strings.

`includes`, `indexOf`, and `lastIndexOf` capture their search value without leasing it because comparison reads only the captured identity or primitive. Keep the receiver lease while a search may resume reading receiver placements. Ordered searches retain it through their result; `includes` releases it once its complete candidate range has been captured, even if comparisons remain pending. A match closes unused work and releases any pending range question.

### 3. Build `concat` from captured remaps

`concat` has no host boundary. Its captured native intrinsic receives only internal remaps and one-element wrapper Arrays, never a retained value directly:

1. Capture the receiver's property versions while its ordinary receiver lease is active. A remap result records them directly; an eligible ArrayView result performs the equivalent retained-property and Promise version capture without allocating a remap.
2. As soon as an item resolves to a logical Array or ArrayView, synchronously capture its length, holes, property placements, and exact property versions into an internal remap. Keep the source root leased until publication or failure so later mutation cannot change managed values retained by those placements.
3. Retain every successfully classified non-Array item exactly. Never inspect or export its contents; a managed retained item keeps its ordinary call lease through publication or failure.
4. Wrap each retained item as one internal element and concatenate it with the captured remaps. Native Array behavior preserves length and holes and enforces the supported Array-length limit without consulting the retained item.

`Symbol.isConcatSpreadable` is outside the language graph and is ignored. Every successfully classified non-logical-Array item is one scalar result element. Preserve eligible ArrayView backing reuse without ever using imported storage as mutable backing.

### 4. Use one sort-record pipeline

Comparator readiness and validation precede element collection. Default and comparator sorting then share these steps:

1. Capture every present property placement and resolve its top-level value through the captured version.
2. Partition the records, in source order, into sortable non-`undefined` records and explicit-`undefined` placements. Count holes separately.
3. When fewer than two sortable records remain, perform no comparison conversion, comparator export, or comparator call.
4. Otherwise prepare only the sortable records:
   - Default sort converts each occurrence once to its logical string key.
   - A supplied comparator creates one dense runtime Array containing all sortable values and passes it as one root to `exportManyValues`. Pair the exported snapshot values with the dense placement records by position.
5. Stable-sort only the sortable placement records with a runtime comparator, then append explicit-`undefined` placements. Preserve holes for `sort`; append ordinary `undefined` values for those holes in `toSorted`.

Exporting the dense comparator snapshot once preserves aliases and cycles across every future comparison without copying the receiver or walking its indexes twice. Keep it as one export root and one Error domain: `exportManyValues` would give each candidate a separate visited set and may repeatedly traverse an aliased graph. If export reaches an Error anywhere in the host-visible graph, abort before invoking the comparator.

Comparison count intentionally determines Error consumption. With zero or one sortable record, neither default conversion nor comparator export runs, so an Error remains retained Array data. With at least two sortable records, default conversion consumes an Error as its conversion outcome, while comparator export consumes every Error it reaches before external code. This also removes the current eager conversion failure for a lone unconvertible value and matches the absence of a native comparison.

The native sorter receives only internal placement records. Its wrapper passes paired exported values to the exact comparator Function with `undefined` as `this`; repeated comparisons reuse the same exported identities. The comparator runs synchronously, may mutate or retain exported managed values, treats exact Functions and external identities as read-only, and must not reenter Cascada. The Phase 9F boundary rejects mutation-capable external identities before they reach a controlled callback; Phase 9F-A preserves that behavior; observation-only identities remain exact and read-only.

Consume the comparator result directly without import or coercion. An Error is the callback Error outcome. A Promise or any other non-Number result is a validation Error. A ready Number, including `NaN`, reaches the sorter. The snapshot is neither the receiver nor the result; final ordering moves the original property placements.

Lazy or per-comparison export cannot work because export may wait while a native comparator must return synchronously. Sorting exported values directly would lose the exact source placements for duplicates and aliases. The eager dense snapshot and placement records are therefore load-bearing, but no controlled Array method otherwise exports logical input data.

### 5. Stop unused Array work

The common invocation owns one per-call context containing the open/closed operation fact. Pass that context through the Array table's preparation and execution hooks; only helpers that schedule or resume operation work retain and check it. Synchronous helpers may ignore it. Do not use module-scoped current-operation state or create a lifetime per method.

The lifetime covers input preparation, logical conversion, recursive `flat`, search continuation, comparator snapshot export, and remap construction until the Array result is handed to the common invocation. Mutation publication remains owned by `transformProperty` and its ordinary transition. Concrete early-stop cases include `includes` after an early match, recursive `flat`, independently resolving `concat` items, and sibling conversion or sort branches after a fatal failure.

- Close synchronously before exposing a final result or propagating a fatal failure.
- An intermediate data Error does not itself close the operation. Finish the Error scan and other preparation required by the selected boundary, then close when its final Error outcome is determined.
- An early final result, such as `includes === true`, closes unfinished operation work.
- In a live execution, a late registered continuation first completes shared placement-version, refcount, and required publication bookkeeping. If the operation is locally closed, it performs no further conversion, reflection, comparison, callback, remap, protection, or result-production work. Phase 9C makes execution fatality stop the continuation before settlement.
- A top-level input Promise is operation work, so closure prevents admission of its late value. Shared graph settlement in a live execution performs its required admission and publication before observing only local closure.
- Leases and export output retain their own last-access and Error-scan lifetimes. Local operation closure neither cancels settlement needed by a live execution nor replaces those rules; execution fatality has no graph work left to preserve.

### Verification

#### Array dispatch and inputs

- Controlled table names always use controlled dispatch without host method-surface inspection; every other name is unsupported.
- An own or inherited Array override is never invoked, and the removed Array shadow check no longer gives index-shaped unsupported names a special error.
- Controlled dispatch uses its generic captured-intrinsic fallback under the documented unmodified-Array-primordials contract. Primordial tampering is outside the supported environment and is not tested as runtime behavior.
- Removing override selection and its materialization inference changes neither controlled Array behavior nor valid backing reuse.
- Indexes, bounds, separators, stored payload, search values, and `concat` use only their declared logical preparation. Omitted, explicit-`undefined`, and ignored extra arguments retain their native distinctions.
- Object-valued scalar inputs follow Cascada logical conversion. External identities invoke no native conversion hook and produce a validation Error.
- Direct `at` matches native negative, fractional, `NaN`, infinite, out-of-range, omitted, and explicit-`undefined` index behavior.
- Identity-only Array search values are not leased. Retained payloads, captured logical Array `concat` items, and delayed `flat`, observation-mode `sort`, and `toSorted` placements remain protected until publication or failure. Resumed ordered searches keep their receiver lease.
- After a local final result in a live execution, late settlement performs shared bookkeeping only and no unused Array work. After execution fatality, resumption performs neither. `includes` early success and recursive `flat` failure cover both stop checks outside argument preparation.
- Controlled `concat` captures and protects each logical Array item before another item can delay publication, combines those remaps with internally wrapped retained items, enforces the Array-length limit, and neither exports retained contents nor consults their `Symbol.isConcatSpreadable` protocol.
- Generic `splice` and specialized `flat` retain native-equivalent plain-Array results under the trusted species and primordial assumptions.

#### Comparator boundary

- Default sorting prepares one logical key per sortable occurrence only when comparison is possible and exports no receiver or element.
- A supplied comparator receives values from one eager dense snapshot of only comparator-visible values. Aliases remain aliases, repeated comparisons reuse the same host identities, and the native sorting engine never receives managed elements.
- Zero or one sortable value causes no key conversion, export, or comparator call. Explicit `undefined` and holes never reach the comparator and do not perturb its call sequence over sortable values.
- A lone Error or unconvertible value remains Array data. With at least two sortable records, default conversion Errors poison default sort and comparator snapshot Errors poison comparator sort before external code.
- Comparator export consumes every Error before sorting. A throw or Error result aborts sorting; any non-Number result, including a Promise, is invalid. The result is neither imported nor coerced.
- Exported managed comparator values may be mutated or retained without changing Cascada state. Exact Functions and external identities remain read-only.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`data-classes.md`](data-classes.md), [`array-view.md`](array-view.md), [`outbound-export.md`](outbound-export.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), [`work-bounds.md`](work-bounds.md), and the public API documentation.

---

## Phase 7D: Order invocation preparation and member resolution

### Problem

Common invocation currently performs record and managed-class member reflection during category selection. A poisoned argument can therefore invoke a getter, Proxy trap, or prototype reflection even though the call must not occur.

### Design

Separate reflection-free internal dispatch from dynamic member resolution. Keep native String and controlled Array selection early; prepare required inputs before every member lookup that may inspect application state.

### 1. Finish internal dispatch first

- Internal dispatch may use admitted category, method name, requested mode, controlled Array tables, and the trusted native String surface. It invokes no application hook.
- Reject `constructor`, an unsupported controlled name, or an unsupported mode immediately. Because no executable boundary was selected, perform no boundary-specific receiver or argument preparation and return only that validation Error.
- Controlled Array selection remains an internal table lookup. A boxed String's own indexes and `length` are deliberately not method candidates. String then selects only Function-valued own data properties from stable `String.prototype` and `Object.prototype`; descriptor lookup on these trusted ordinary prototypes invokes no application hook. Accessors, including `Object.prototype.__proto__`, are unsupported and never invoked. Feed the selected Function into the common host-call description instead of adding another invocation path. Do not export arguments after early String selection failure.

### 2. Resolve dynamic members after preparation

```text
classify boundary
start and finish required receiver and argument preparation
resolve the dynamic callable or member
isolate the receiver when managed mutation requires it
invoke
```

- Defer the current record member lookup and shadow checks and managed-class prototype descriptor traversal until the boundary's required receiver and arguments are clean.
- If preparation produces an Error, perform no dynamic member getter, Proxy trap, descriptor access, callable test, or invocation. If preparation succeeds, resolve and validate the member exactly once, then invoke at most once.
- Resolve a managed member from the prepared receiver before mutation isolation. A managed class uses its admitted prototype chain. Isolation preserves that method and prototype; do not resolve the member again from the working copy.
- A missing or non-callable dynamic member is therefore reported only after required argument preparation. A clean invalid call may allocate export copies that it then discards. Accept that cost rather than adding an early host lookup or a separate Error-scan preflight.
- This cost differs deliberately from early String failure: trusted String selection is reflection-free, while record and managed-class lookup may inspect application-controlled state and must wait for clean preparation.
- Phase 8 replaces the current record host-member resolver with managed-record placement resolution. Verify the common ordering contract, not the temporary resolver interface.
- Keep one invocation coordinator. Category handlers describe their preparation and dynamic resolver; do not add another call path or compatibility interface.

### Verification

- A failed or poisoned argument prevents record and managed-class member reflection and invocation. Clean preparation resolves the member once and preserves existing validation and failure classification.
- A clean missing dynamic member is reported only after all required argument preparation; an argument Error prevents that lookup. This uses one preparation pass even when export copies are later discarded.
- Managed member resolution happens once against the prepared pre-isolation receiver. Mutation isolation neither repeats nor changes it.
- Rejecting a constructor, unsupported controlled name, or unsupported mode performs no boundary-specific input preparation. Controlled Array and native String selection stays early and invokes no application hook; a String accessor is never invoked, and failed String selection exports no arguments.
- Valid String calls preserve native results and export their explicit arguments through the ordinary host boundary.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-invocation.md`](managed-invocation.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 7E: Unify operation work lifetimes

### Problem

Invocation, export, and Error queries independently implement the same open/close fact, fatal-rejection observation, and guarded continuation. Registered receiver and argument roots still prepare through raw continuations, while Promise-aware Array-length conversion has no operation owner. These parallel mechanisms can drift and let work continue after its local result is final.

### Design

Use one minimal operation-lifecycle mechanism everywhere. Unify only lifetime behavior; keep resources and boundary policy at their natural scopes.

### 1. Define the common owner

- Use one idempotent close transition for the operation's open/closed fact, operation-specific resource release, and registered release callbacks. Existing operation state may hold the fact directly; no wrapper is needed merely to provide a close method. Implement the transition as a shared function or an owner method using the same common implementation, whichever is simpler. No internal call may mark the operation closed while bypassing its registered releases. A pending nested component registers one synchronous, idempotent, non-throwing release for its independently stored resources and unregisters it on normal completion. Local closure releases those resources without cancelling settlement needed by the live execution. Execution fatality uses its separate stop rule.
- The helpers receive only results already classified at their boundary. They never decide whether a rejection or failure is language Error data or fatal.
- Every owner has one open/closed fact and uses the common close transition. Method names, module placement, and a delegating `owner.close()` are implementation choices. All operation-specific pending registration goes through the guarded continuation helpers. Ready work continues synchronously without allocating release-registry state. Pending nested resources reuse the containing owner and register their release before control returns. No caller manually registers an unguarded operation continuation.
- All components of one issued operation share that owner. A nested component never creates another owner or closes it on successful component completion. The operation coordinator closes after its final success or language-Error outcome completes required processing and publication. A fatal defect fails the execution; fatal delivery does not close local owners or sweep their resources. Do not create an owner per input, branch, method, or Promise.
- A continuation first checks execution fatality and stops if the execution failed. In a live execution, it completes required shared placement-version, refcount, and publication bookkeeping, then performs no operation-specific work after local closure.
- Keep policy and resources with their operations. Invocation retains lease ledgers, export retains output state, Error queries retain traversal and collection state, and gates, phases, publication, and export output retain their own completion rules.
- Add no cancellation framework, task registry, compatibility wrapper, or second continuation path. The release registry contains only synchronous, idempotent releases for independently stored operation resources; it never contains tasks or continuations.

### 2. Reuse the owner without changing boundary policy

- A standalone export owns its operation lifetime. Export used by invocation or callback preparation shares that operation's owner and does not close it on successful export.
- Export output has a separate resource lifetime. Handing completed copies to the caller or discarding them ends output work without closing a shared operation owner.
- A pending nested export registers its output release with the shared owner. Owner closure therefore releases partial output immediately even when an unused input never settles.
- Reaching a language Error discards export copies but does not close the owner. The required Error scan continues; a standalone export's coordinator closes afterward, while a containing invocation closes only after all of its required preparation finishes. Local sibling closure stops unfinished export traversal after required shared settlement in a live execution; execution-fatal resumption stops before settlement.
- `hasError` and `getErrors` use the same owner while retaining their distinct completion rules, visited state, and Error collection. Preserve early `hasError`, complete `getErrors`, and release query-only strong state through the common close transition's operation-specific release work.
- Invocation uses the owner while retaining its argument and receiver lease ledgers. Phase 8 later makes argument export share this same owner.
- Move InvocationWork's continuation and fatal-observation methods to the common lifetime helpers. Keep only its lease ledgers and the owner state needed to release them.
- Replace only duplicated open facts, fatal observers, and guarded-transition wrappers in invocation, export, and Error queries. `runExportStep` remains export's per-reflection Error-capture policy and is not lifetime code. Retain no local lifetime path or adapter beside the common helpers.

### 3. Close registered preparation

Start every registered receiver and argument root synchronously under the invocation's one lifetime.

- Before admitting a fulfilled top-level input, verify that the invocation remains open.
- A captured property continuation checks execution fatality first; in a live execution, it completes shared settlement before checking whether its local owner allows further preparation.
- A fatal failure in any root fails the execution. Late roots stop at the common execution check before graph traversal, reflection, materialization, Error collection, or lease acquisition; no local-owner sweep is needed.
- Language Errors still complete the required receiver-then-argument collection. Preserve aliases, cycles, logical Promise versions, and balanced receiver and argument leases.

Phase 8 removes registered argument preparation in favor of export, but reuses this receiver-preparation lifetime. The registered-argument wiring is deliberately temporary; verify the shared closure and balanced-lease contract, not that preparation path's interface. Do not add a transitional adapter or a second managed lifetime.

### 4. Close Promise-aware scalar conversion

Every Promise-aware scalar conversion must use the guarded continuation helpers before it registers pending work. Controlled Array conversion reuses its invocation. Array-length assignment makes its already-required mutation context an explicit owner, so completely ready ordinary assignment and length conversion allocate no additional owner object or release-registry state. Rename `transformValue`'s current `operation` readiness result to `readiness` so it cannot be confused with the owner. Phase 10 extends the same ownership through common path operations. Remove the optional unprotected asynchronous path.

- Recursive logical-Array conversion branches share one lifetime.
- A fatal branch fails the execution and propagates its authoritative Error; later conversion work stops before shared settlement. In a live execution, a branch stopped only by local closure still settles shared property versions but performs no further conversion or reflection.
- A language Error remains a conversion outcome and completes all work required by that consumed input.
- Observe every pending mutation continuation through the common helper at its originating layer even when the non-blocking API does not return that Promise.
- `assignPath` may return before a pending mutation publishes. Its immediate non-blocking return does not close the owner; successful or failed gate publication does.
- Preserve ready behavior, scalar semantics, mutation gating, Error publication, and allocation. Do not add a conversion-specific scheduler or lease.

### Verification

- Every operation-specific pending registration passes through the common helper and therefore has an owner before registration. Completely ready assignment and conversion allocate no owner and remain synchronous.
- Standalone export and queries use one owner, which their existing operation state may implement without a wrapper allocation. Export nested in invocation shares its parent's owner. Successful nested export and completed output do not close the invocation. A fatal nested failure fails the execution without a separate owner-close transition.
- A language Error keeps export's required scan active without closing a shared owner. Local sibling closure in a live execution stops later export traversal after required shared settlement; an execution-fatal resumption stops before settlement. Preserve output discard, complete Error membership, aliases, cycles, and captured frontiers; Error order is unspecified.
- `hasError`, `getErrors`, and invocation preserve their existing completion, failure classification, operation-specific cleanup, and lease behavior after the duplicated lifetime code is removed. `runExportStep` retains its current Error-capture behavior.
- A fatal registered receiver or argument branch fails the execution. A root that resumes afterward stops before metadata, lease, copy, reflection, or shared property settlement. Local closure in an otherwise live execution still permits required shared settlement.
- A fatal Array-length conversion branch stops late sibling conversion and reflection through execution failure. A language Error still completes its required conversion outcome and ordinary mutation failure publication.
- A hidden pending Array-length continuation remains owned and active after `assignPath` returns. It normally closes after publication; a detected fatal fails the execution, while an internal wait behind a never-settling blocker may remain pending without delaying any pending outward operation result.
- Every live-execution terminal route balances its leases and releases registered resources once, including success, language Error, supported host failure, and early completion. Repeated close calls are harmless, every supported close entry performs the same complete transition, and a late release registration is immediately balanced after closure. After execution fatality, resumptions stop without closing or balancing dead operation metadata. Invocation, conversion, export, Error queries, mutation gates, and external phases retain their distinct resource lifetimes.

Update [`AGENTS.md`](../AGENTS.md), [`managed-invocation.md`](managed-invocation.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`outbound-export.md`](outbound-export.md), [`counters-implementation.md`](counters-implementation.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), [`work-bounds.md`](work-bounds.md), and the public API documentation.

---

## Phase 8: Generalize managed invocation

**Status: Implemented.**

### Problem

Before this phase, an own Function placement on a managed record cannot be invoked as a method with that record as `this`. Registered-class invocation already provides the required managed-state boundary, but it contains synchronous-only argument/result machinery and rejects a direct Promise instead of treating it as the call's completion.

### Outcome

- Rename **registered-class invocation** to **managed invocation**, including its module and architecture document. Keep no compatibility module or document alias.
- Use that one path for managed records and managed class instances. Add no record-specific invocation path.
- Remove the old record host-method surface. Inherited `Object.prototype` methods, accessors, and non-enumerable Functions are no longer callable on records; an own enumerable Function placement becomes the method instead.
- Retain Phase 7A's rest-argument `run` signature and consume its already collected internal argument Array; Phase 9A performs the only public change to the final argument-Array and operation-facts signature.

### 1. Reuse the existing managed boundary

This phase does not build another invocation mechanism. Both receiver forms reuse Phase 5's complete receiver preparation, mutation isolation, validation, and publication; Phase 7A's argument export and selection-to-call protection; Phase 7D's deferred member resolution; and Phase 7E's common operation lifecycle. Runtime-controlled methods retain their logical-input preparation.

The pre-call sequence remains:

1. Select the managed boundary from admitted category, method name, and mode without member reflection.
2. Prepare the complete receiver and export all explicit arguments under one operation lifecycle.
3. Finish both and collect complete required cause/source/kind membership with unspecified Error order.
4. If preparation is clean, resolve and validate the method once from the prepared receiver or admitted class prototype.
5. Isolate a mutation receiver, then invoke once.

A fatal failure in either preparation closes operation-specific work in both. A language Error keeps the operation open until both finish required Error handling, then closes the combined outcome. After local closure in a live execution, guarded continuations still settle shared placement versions and refcounts but perform no further traversal, reflection, copying, or lease acquisition. Phase 9C makes execution-fatal resumption stop before settlement. The two preparations never receive separate lifetimes.

Selection must also protect an argument whose root Promise fulfills before the receiver is available. In `invokeMethod`, immediately after receiver traversal reports pending selection and before returning to the caller, register one guarded FIFO root-resolution continuation per Promise argument. Lease a traversable fulfillment until argument export starts; a non-traversable fulfillment is a no-op. If receiver selection starts first, normal export registration supplies the protection. Do not export or traverse arguments before receiver category selection, and release every selection lease on success or failure. If the receiver is ready and internal dispatch rejects the call, attach no argument continuation. Once receiver selection is pending, provisional root capture is required even if selection later fails; it performs no argument traversal or export.

### 2. Add managed-record method selection

After preparation, an own enumerable string-keyed record placement other than the globally forbidden `constructor` placement may supply the method. Read its prepared logical value once, test callability, and invoke it as:

```js
Reflect.apply(callable, preparedReceiver, exportedArgs)
```

A Promise-backed placement is therefore interchangeable with its resolved Function. Inherited properties, accessors, non-enumerables, resolved non-Functions, `constructor`, and extracted Functions are not record methods; a Function remains data outside a supported call position. Managed classes retain Phase 5's admitted-prototype-chain selection and state contract. The common selector passes the prepared receiver to member resolution; managed classes may ignore it.

A nested call such as `this.increaseBy(1)` is ordinary JavaScript on the already prepared receiver, not another Cascada invocation.

### 3. Preserve managed-state boundaries

- Export all explicit arguments together. Managed argument data is an independent graph with aliases, cycles, and admitted prototypes preserved across argument positions; the method may mutate, retain, store, or return it without changing Cascada sources.
- Functions and external identities cross exactly and remain read-only as arguments. Argument export creates no source lease; later external mutation requires a separate authorized receiver operation.
- External identities inside the managed receiver are opaque leaves. Managed code may retain, replace, remove, compare, or return them, but may not inspect or mutate their host state. `api!.db.close()` may mutate external `db`; a managed `api!.close()` may not call `this.db.close()` internally.
- Managed state may contain Promises or Errors between calls. A clean prepared receiver contains neither, and a completed mutation receiver may contain neither.
- The complete receiver graph is the call's work bound. Preparation, isolation, and finalization may traverse it; no call walk enters unrelated graph state.
- A managed-record call therefore costs `O(receiver graph + exported arguments)`, unlike the old record host-method path. This deliberate bound is required because ordinary method code may read any receiver property through `this`; add no selective receiver-preparation mode.
- The caller's mode is authoritative. An observation does not mutate its receiver; any method that may do so runs as a mutation.

### 4. Remove superseded registered-call machinery

Keep receiver preparation, argument export, and receiver isolation as three existing responsibilities instead of preserving the old joint synchronous path:

- Prepare only the complete receiver. Export arguments through `exportManyValues`; do not materialize or cross-remap receiver and argument identities.
- Remove registered argument-preparation leases. Keep only selection-to-receiver protection, observation receiver leases, and mutation receiver-source leases until isolation.
- Finalization only validates that the receiver contains no Promise or Error and admits new identities as runtime-owned. Remove its active-read-lease scan: exported arguments cannot retain Cascada argument identities, and receiver-source leases end at isolation.
- Delete registered result copying. Use common method-result import for observations and non-receiver mutation results. It revisits admitted managed containers and marks every reached managed identity shared, protecting descendants split between the result and final receiver without result-provenance tracking. Keep the complete-graph copier only for qualifying receiver-isolation subgraphs.
- Simplify receiver materialization and remapping to receiver input only. Delete the old joint receiver/argument preparation, forced result-copy map, `prepareResult`, and the copier's `promiseFound` result.
- Delete the record half of the old own-placement shadow check, `getRecordMethod`, and the `TYPE.Record` host-call branch. Retain managed-class own-placement shadowing and route records into managed selection.

This phase should remove the superseded helpers and fields in the same change; keep no compatibility path.

### 5. Complete managed results

Managed invocation owns result completion: an observation returns the imported method result, while a mutation returns the ordinary `{ mutatedValue, result }` outcome after receiver validation. Importing the whole mutation outcome would cross the wrong boundary. A mutation transition must publish its validated receiver before exposing the imported result.

A synchronous call completes that work immediately. A Promise nested inside a synchronous result is independent data, not invalid state; return immediately and let import continue its retained placement when the Promise settles.

One Promise returned directly by the method extends the managed invocation and becomes its one operation Promise:

- Managed code may access its invocation-owned receiver and inspect read-only exact external arguments until that Promise settles. Every asynchronous access of either kind must belong to it and finish before settlement. Exact external identities may be retained or returned inertly. The managed structure of exported argument copies may outlive the invocation; exact external leaves follow the same rule.
- Detached receiver or external-input work, later receiver access from a nested result Promise, and re-entry into the invocation's execution while its external action is active are forbidden trusted-contract violations. A separate execution may start synchronously. A nested result Promise must not fulfill with the receiver; return it directly when its completion retains invocation state. It may carry an exact external identity inertly but cannot inspect or mutate it after its guard ends. Add no async-context tracking.
- An observation leases every traversable prepared-receiver identity through settlement. Fulfillment imports the result with ordinary shared ownership; rejection remains rejection and leaves the receiver unchanged. Release leases after the last access on every completion path. Later mutations use COW without waiting; add no readers-writer phase.
- A mutation ends receiver-source leases after isolation and keeps its private receiver behind the ordinary transition gate; the gate, not another lease, protects it. Fulfillment uses common method-result import for a non-receiver result, validates the receiver, and publishes one mutation outcome. The result cannot become observable before receiver publication.
- Keep internal preparation readiness separate from the produced method result. The common coordinator must not pass a produced result Promise through an internal continuation whose rejection is fatal.
- Observe a direct mutation Promise at the managed boundary and return a non-rejecting internal completion to the mutation transition. Fulfillment creates the normal mutation outcome. Rejection creates an outcome that poisons the receiver while its `result` remains the admitted direct Promise, so the operation Promise adopts its contextualized rejection.
- If a mutation returns its working receiver, return the published receiver with ordinary result ownership. A receiver validation failure publishes at the selected mutation scope and becomes the operation result; pending transport rejects only after that graph effect is published.

Import every managed result without copying it. Common method-result import revisits admitted containers to enforce result-boundary restrictions and retain reached managed descendants. This also protects a non-receiver mutation result when arbitrary JavaScript mutation detaches an admitted result container while leaving descendants in the receiver; it needs no separate import policy.

### Verification

#### Selection and reuse

- Ready and Promise-backed own enumerable Function placements receive the prepared record as `this`. Inherited, accessor, non-enumerable, resolved non-Function, and extracted Function values remain unavailable as record methods.
- `constructor` remains unavailable as a managed record method.
- Records no longer call inherited `hasOwnProperty`, `toString`, or other `Object.prototype` methods. An own accessor is not invoked, and neither it nor an own non-enumerable Function supplies a method.
- Receiver or argument preparation failure performs no post-preparation record method-placement read, managed-class prototype descriptor traversal, callable validation, or invocation.
- Receiver and argument Errors, including mixed ready and pending failures, combine with complete cause/source/kind membership and unspecified Error order. Successful receiver/argument processing and effects retain their defined order.
- `this.helper()` mutates the already isolated receiver and publishes only through the outer invocation.
- Records and classes share one preparation, export, isolation, validation, result, and cleanup path.
- The caller's mode matches method behavior.
- Managed methods treat nested external identities as opaque. Explicit selection such as `api!.db.close()` uses the external operation path instead of hiding host access inside managed code.

#### Promise lifetime and protection

- When a root argument Promise fulfills while receiver selection remains pending, its traversable fulfillment is protected until export starts. A later source mutation cannot change the exported argument, and every selection lease balances on success or failure.
- A direct-Promise observation holds receiver leases but no readers-writer phase. Exported arguments retain no source lease, and later mutation uses COW without waiting.
- A direct-Promise mutation remains private behind one gate. Later operations wait; fulfillment validates and publishes once; rejection is handled as language failure rather than fatal, poisons the receiver, and preserves its contextualized rejection with the native reason as cause.
- A direct mutation Error applies the same receiver-failure effect whether returned, fulfilled, thrown, or rejected by the host action. An independent nested result Error does not poison an otherwise published valid receiver.
- A completed mutation receiver containing a Promise or Error fails validation. A direct result Promise extends the invocation; a nested result Promise does not.
- A nested result Promise may retain or fulfill with an exported managed argument copy or an inert exact external identity, but never with the invocation-owned receiver. It cannot inspect or mutate the external identity after its guard ends.
- Receiver leases balance after fulfillment, rejection, and validation failure; argument export leaves no source lease on success or failure.
- Managed invocation does not restore selection leases after export capture or acquire another argument-source lease. It uses Phase 7E's common operation lifetime, so fatal preparation or completion cannot strand an acquisition attempted by a later parallel branch.
- A fatal receiver-preparation or argument-export failure closes the other preparation. A language Error completes required preparation in both before the final Error outcome closes them. Later resumption after a local close in a live execution performs shared bookkeeping only and neither traverses newly revealed data nor allocates output; after execution fatality it returns before bookkeeping.
- Direct fulfillment uses common import and shared ownership in FIFO order.
- A synchronous result containing a nested Promise succeeds immediately instead of producing the old registered-result validation Error; its retained placement imports later fulfillment.
- Returning a receiver child retains that exact identity and marks it shared. A later receiver mutation uses ordinary COW and preserves the returned logical value.
- Returning a detached admitted container while retaining one of its descendants in the receiver marks the complete result graph shared; later receiver mutation preserves the earlier result.
- Observation materialization does not permanently share reused receiver children unless the imported result retains them.
- Direct-Promise work may use the prepared receiver and inspect read-only exact external arguments until settlement but may not reenter Cascada. Later receiver access or external-state inspection remains a trusted-contract violation, not an instrumented restriction. Exact external identities may be retained or returned inertly. The managed structure of exported argument copies remains independent host data.

#### Removed machinery

- Receiver and argument preparation preserve no cross-input remapping; exported arguments are independent from receiver state.
- Managed invocation has no registered-only argument preparation, active-lease finalization scan, result deep copy, forced result-copy map, `prepareResult`, or `promiseFound` copier result.
- The record placement now supplies the method, while a managed-class own placement still hides its admitted prototype method.
- Equivalent record and class failures produce the same cause/source/kind membership and balanced selection and receiver leases; tests do not assert Error order.
- Receiver preparation and isolation retain their aliases, cycles, logical Array, admitted-prototype, metadata, and refcount guarantees after the simplification.

Phase 9D-A supersedes the ready-versus-rejected direct-Error distinction: every direct Error follows the same call-failure rules, while an Error from an independent nested result remains independent. Phase 9F-A supplies owner-isolated repairable guard metadata and external subtree poison independently of ordinary Error-valued properties.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`managed-invocation.md`](managed-invocation.md), [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 9A: Establish context external foundations

### Terms for Phases 9A–9F

- **Execution:** one operation family's execution-local graph and identity state, fatal outcome, and pending outward obligations. Its external identity map owns binding state and readers-writer cursors.
- **Operation context:** the immutable `{ execution, errorContext }` carrier for one causal source operation.
- **ContextChain:** a public Chain subclass that imports a root host context and filters its compiler mutation access tree. Entered contextual Chains retain the originating route and select the same runtime records.
- **Mutation scope:** the placement whose logical state receives one mutation's success, failure, or repair. `!` selects it independently of the actual native owner. Assignment/deletion default to their target; observations have no mutation scope.
- **Compiler mutation access tree:** a finite own String-keyed property map of static mutation access prefixes, with `{}` endpoints. Calls contribute receiver paths, property mutations contribute containing paths, and repair-only contributes its selected scope path. The kernel leaves this compiler-owned input unchanged.
- **Static external mutation tree:** fixed context-local child maps with Symbol-held scope metadata. Registered external nodes may contain requested nested scopes; prune managed endpoints and empty connecting branches.
- **External boundary/location:** a registered external scope on a static context route, including nested native scopes. Its Symbol-held record holds parent, depth, and binding, with node identity distinguishing the context route; first native crossing and selected mutation scope are separate facts.
- **Actual use:** performing a supported call or property operation through its owning external boundary. Managed retention and copying grant no native authority; metadata queries inspect ordered scope state without native property access.
- **Mutable external value:** an exact external identity registered at one context location. It is a receiver capability; native property access uses that owner's phase and cannot expose the capability as a value.
- **External snapshot:** the detached managed value produced by reading mutable external state. It preserves graph topology, supported prototypes, and Functions while copying traversable data under its synchronous nested-readiness contract.
- **Mutation scope depth:** the operation's compiler-selected `!` prefix depth. It is separate from the path's `firstDynamicSegment`, which records source staticness.

### Problem

External ordering needs explicit execution-scoped coordination and mutation-scope facts. Establish these foundations without changing external behavior; Phase 9F supplies public external operations; Phase 9F-A replaces their coordination and repair semantics. Phase 13 cuts Cascada over from its hidden external sequencing mechanism.

### Design

### 1. Associate Chains with an execution

Expose:

~~~js
new Execution()

new Chain(initialValue, operationContext)

new ContextChain(
  initialValue,
  operationContext,
  mutationAccessTree = undefined,
)
~~~

Both constructors require an operation context. Keep these fixed runtime arguments positional. `Chain` admits existing Cascada data, while a root `ContextChain` imports raw host data and accepts the compiler-owned mutation access tree. These trusted control facts need no defensive shape validation.

Ordinary and writable entered Chains need no mutation capability flag. `enter` uses the ordinary two-argument Chain constructor, sets `_readOnly` only for read-only entry, and sets `_closed` at its shared callback-completion point before lease release or publication. The common Chain operation-entry check rejects new issuance through a closed Chain; already-issued work retains its root storage. Chain has no entry-specific closure method. Contextual entry retains its external-tree branch and compact origin facts; external tree edges identify canonical locations, while node depth and entry origin preserve routing provenance for managed placement capture at the operation's ordered turn. Shared tree-query functions select boundaries without putting methods among child keys. Observations use the common walker, while mutations additionally assert the entry restriction. Keep no entered subclass, parallel operation path, or compatibility alias for `_mutates`. Ordinary Chains expose no public `close()` method.

Every Chain belongs to the execution supplied by its initialization operation context. Related top-level Chains use operation contexts with the same execution; internally created child, private, and entered Chains inherit that execution through their operation contexts. Independent work explicitly creates its own execution. Missing required operation context never creates a private execution; malformed root integration may throw an ordinary programming exception, while a defect escaping valid operation work follows its enclosing fatal boundary. Different executions never share external authority, phases, or poison.

`ContextChain` gives root context import and external mutation indexing an explicit public boundary. It extends Chain and uses the same operations. Its `mutationAccessTree` input is the compact compiler tree specified in [integration.md](integration.md#compiler-construction-of-the-mutation-access-tree); Phase 9E completion supplies the final runtime representation and constructor cutover.

For `apis.data!.write()`, `apis!.data.write()`, `apis.data.status = value`, and `delete apis.data.status`, the compiler contribution is `{ apis: { data: {} } }`. Calls select their receivers and property writes/deletions their containing paths, regardless of poison-scope depth. Only static prefixes appear in the compiler tree, so import never evaluates or retains a computed suffix.

The common importer processes the host root once. Omission means no discovery requests; `{}` requests only the root as a potential external owner. Import filters requested original placements using staged/admitted categories, removes non-external endpoints, and records external scopes, including requested native descendants, without searching unrelated subtrees. Public `import(value, operationContext)` creates no mutation authority or registration and never downgrades an existing binding.

Import failure classification remains unchanged. A supported boundary or host-reflection failure produces a language Error for the current synchronous segment; an existing Error in the input remains data; an internal failure is fatal. Admission, origin, sharing, Promise versions, tree leaves, and new external identity entries are one transaction: stage them locally and publish them only when the segment commits. A later Promise fulfillment is its own segment, so its failure poisons only that captured placement and does not undo the earlier import.

`enter` creates an ordinary Chain and preserves canonical tree/provenance facts. Managed and mixed entry use normal placement gates/leases; external subtree coverage uses a reservation view under Phase 9F-A. External nodes can have nested scopes and completion is separate from poison. No contextual-binding gate or first-boundary-only entry rule remains in the final design.

Keep state at its natural scope:

- In Phase 9A, the execution owns the external identity binding map; Phase 9F-A scope nodes own reservations and poison. Phase 9B moves existing execution-scoped graph state into it.
- A root ContextChain with discovered external boundaries owns its static external mutation tree. An entered Chain carries the reached node as its own tree root.
- Admission, COW protection, leases, versions, refcounts, and canonical thenable-continuation state temporarily remain module-wide until Phase 9B localizes them. Identity declarations, captured thenability, and managed-class registration remain runtime-wide configuration.
- Export copies, traversal sets, invocation releases, and similar temporary state remain operation-local.
- Constant method tables and other immutable definitions remain module-local.

Do not turn the execution into a container for unrelated registries or move operation-local work into it.

### 2. Capture only non-derivable operation facts

Replace the positional mutation Boolean with one operation-facts record:

~~~js
run(chain, path, method, args, {
  mutationScopeDepth, // undefined for observation; 0 selects the root
})
~~~

- `args` is a required native Array of ordered argument roots.
- `mutationScopeDepth` identifies the depth of the exact `!` prefix. Test it with `!== undefined`.
- `path` ends at the receiver; `method` is not a graph placement.

The path carries its input segments and one trusted compiler fact: firstDynamicSegment, the first computed key position (path length for an entirely static path). Capture it beside the path and preserve it through entry and path composition. Source staticness cannot be derived from ready String/Number values. This fact controls mutable-external route permission; it does not replace ordinary segment validation or indicate readiness.

At issuance, copy every retained path and argument Array. Trust the compiler/runtime-owned record, method, and scope depth. Do not inspect or validate a language path segment before traversal reaches it. Replace the old signature directly and add no adapter.

Phase 9A uses only the presence of `run`'s scope depth to preserve observation-versus-mutation dispatch. Assignment and deletion remain ordinary mutations. Phase 9F-A consumes the numeric depths when it selects managed and external scopes; retaining the final API now avoids a transitional signature or adapter.

All path-consuming public operations share the same captured firstDynamicSegment fact, including lookup, queries, export, assignment, deletion, run, repair, and entry. Keep it with path input using one consistent public representation, not inside opaque source-error context or per-segment wrapper objects. Assignment/deletion default their mutation scope to the target; run retains mutationScopeDepth and repair. Compiler control facts are trusted and need no malformed-call tests.

Keep the single optional assignment/deletion fact positional:

~~~js
assignPath(chain, path, value, mutationScopeDepth = path.length)
deletePath(chain, path, mutationScopeDepth = path.length)
~~~

Do not allocate a general facts record for operations with nothing else to carry.

Lookup and `run` consume their receiver path. Assignment and deletion traverse only the containing path before the final key. Replacing an external-valued managed placement is managed structural mutation; reaching an external identity before the final key selects a host property operation. Empty assignment replaces the root, and empty deletion replaces it with `null`.

### 3. Build static external mutation trees where needed

Implement the **Static external mutation tree** section of [`external-context-ordering.md`](external-context-ordering.md) as the authoritative algorithm:

- builds the tree and commits unique identity bindings inside the initial ContextChain import transaction;
- provides the internal anchored-path query for an exact boundary, deepest registered prefix, or required scope descendants;
- keeps the tree fixed after construction and derives live authority from its shared identity bindings.

Hierarchical reservations propagate completion dependencies upward; own poison and descendant Error summaries are separate tree metadata. Invalid bindings leave the runtime tree intact and remain visible to queries. Phase 9F-A routes public operations through the coordinator and rejects controlled changes that would disturb the fixed namespace.

### Verification

- Root ContextChain construction imports its raw value exactly once and atomically filters the compiler mutation access tree, including through already-admitted managed nodes. A boundary Error commits no import or external-index state for that segment; an internal failure is fatal.
- Receiver and property-container routes contribute the compiler nodes above, independently of `!` depth. Property mutation never scans its old target. Merged prefixes and non-external endpoints produce only the required unique records.
- External boundaries outside every supplied path are absent from the tree and remain observation-only.
- Ordinary Chain construction admits existing Cascada data without import. A root ContextChain with omitted compiler input imports its host value without building a tree; `{}` selects only its root. Promise branches and later graph changes add no leaves.
- Wrapping a public `import()` result in an ordinary Chain creates no tree or external mutation authority.
- Context cycles and aliases are bounded by the finite compiler tree. Explicit distinct locations remain distinguishable; unselected graph paths are never enumerated.
- Assignment through one managed placement followed by mutation through another uses ordinary COW and preserves every live leaf on the first placement.
- COW, Array remaps, managed aliases, and `enter` leave the static tree unchanged.
- An entered Chain keeps the common Chain operation surface, source execution, originating context route, and reached runtime node. It creates no subtree copy, registration, or separate authority relation.
- A boundary reached as an absolute context path and as a relative path from one or more entered Chains returns the same leaf location and absolute boundary path. The entered Chain identity is not a new external location.
- Every production Chain has an explicit initialization operation context. Related Chains share its execution; omission fails fatally at the justified construction entry check without creating an execution.
- Runtime trees remain ContextChain-local; entered Chains share reached nodes and retain their originating route for canonical access. External identity coordination remains execution-local, and identity and operation facts retain their existing scopes.
- Compiler/runtime control facts receive no defensive shape validation. Whole-root replacement/deletion contributes no compiler request; a root receiver or property-container request contributes `{}`. `mutationScopeDepth === 0` selects the root poison scope; observation uses `undefined`.
- Normally constructed Chain instances carry no entry state. Chains created by `enter` preserve read-only, mutating, and closed issuance behavior through the common Chain implementation; no `_mutates` alias remains.
- Caller mutation of captured inputs cannot change issued work.
- The static tree and binding map support the internal coordinator. Public external-ordering routes and mutable-capability rejection switch together in Phase 9F-A; no conflict pruning or first-use state is retained.
- Rewrite [`enter.md`](enter.md) to document the common Chain representation; remove its current ordinary-Chain capability and close contract when the code changes.

---

## Phase 9B: Make graph state execution-local and plumb operation context

### Problem

The module-wide metadata store makes independent executions importing the same host identity share admission, ownership, leases, Promise versions, ArrayView attachment, and refcount state. Classification and Promise version sharing can change logical behavior; the other shared facts can impose another execution's protection or bookkeeping even when their current effect is only conservative. For example, a class instance admitted as external in one execution remains external in another execution created after its class is registered as managed. Each execution must instead admit and track its own graph independently.

Managed values move between executions only through export and import. External code can independently supply the same exact external identity to several executions, but their ordering state is isolated; sharing a mutation-capable external identity this way is therefore a host-contract violation that Cascada does not detect across executions.

Execution and source attribution ultimately travel together in Cascada. Introduce their final operation-context carrier while moving graph state, but preserve existing Error behavior in this phase. Phase 9C adds execution-level fatal coordination, Phase 9D-A activates causal recoverable-Error attribution, and Phase 9D-B adds expression extraction and a separate rejecting value through the public API. Synchronous external-code re-entry into the same execution remains a fatal contract violation because safely permitting it would require an ordering path around otherwise-ready host mutations; another execution remains independent.

### Design

### 1. Let Execution own mutable graph state

Extend the `Execution` created in Phase 9A with:

- one `WeakMap` containing admitted metadata for identities used by that execution;
- one `WeakMap` containing that execution's sampled thenability and canonical continuation state; and
- the existing external-identity coordination `WeakMap`.

The metadata map retains the single-record design from Phase 3. It contains the admitted category and prototype, import origin, sharing and leases, placement versions, ArrayView attachment, refcount parents and counters, and other persistent graph facts. Phase 9D-A finishes causal Error use of the existing placement-version overlays. A managed copy receives metadata only in the execution that creates it.

Every runtime question that depends on admission or thenability uses the selected execution. This includes metadata lookup and creation, admission, `isPromise`, `typeOf`, traversability, ownership, leases, Promise versions, ArrayViews, and refcounts. The first operation that may sample thenability supplies its complete operation context so a throwing `then` getter has the correct source. Migrate every call site together; no compatibility helper may consult a module-wide store. Context-free raw shape probes remain separate and are used only where no execution exists, principally declaration walks. Semantic `isError` remains context-free and excludes fatal `FatalError`; admitted Error metadata adds no category that native detection cannot see. Phase 9D-A adds causal native-Error contextualization and makes every Promise test recognize all native Error forms before sampling `then`.

An execution samples an identity's `then` at most once and owns the captured callable, any acquisition failure, the canonical Promise, and every continuation fact derived from them. Sampling receives the current operation context because reading `then` may itself fail; that first acquisition failure keeps the sampling operation's source. Supplying the same thenable to another execution independently samples, invokes, and orders it there. A native Promise remains one host Promise, but its Cascada continuations, versions, and graph effects are execution-local.

Invoking a captured custom `then` is also a supported host boundary. A synchronous invocation failure keeps the operation context that first creates the execution's canonical Promise and is stored as that canonical rejection. Later consumers preserve it. Ordinary fulfillment or rejection supplied by the thenable remains its captured outcome and is processed by each boundary that introduced the Promise.

At the Phase 9B boundary this canonical representation remains transitional. The Phase 9C supported-thenable addendum, not Phase 9D-A, deletes it together with execution-local sampling and lets each supported source own settlement, subscriptions, and FIFO delivery directly.

Declaration APIs run before an execution exists. They inspect thenability only for that declaration call, deduplicating aliases with operation-local state; their sampling creates no persistent fact outside that call and uses no execution context. Remove the module-wide captured-thenable map in this phase. The Phase 9C addendum then removes the operation-local probe abstraction and cache; Phase 9D-A keeps declaration probes local, preserves Error before direct recognition, and installs the final ordinary declaration-validation outcome. No final declaration path owns poison, kind, a Promise, synthetic thenable, or persistent capture.

No mutable graph bookkeeping remains in a module-wide identity map. Do not add an ambient current execution, an identity-to-execution registry, or fallback global metadata.

### 2. Carry the final operation context

#### Operation context

Add one immutable runtime-owned control record:

~~~js
const operationContext = { execution, errorContext }
~~~

`execution` selects the execution-local graph state. `errorContext` is opaque source information supplied by Cascada; the prototype may use a simple String or record, while later integration may supply path, line, column, operation, and diagnostic details without changing graph APIs.

The caller selects `errorContext` for each semantic operation, not merely for its enclosing statement. Nested calls, lookups, conditions, commands, and control-flow boundaries may therefore carry different contexts even on one source line. Async diagnostic-route or command-buffer stacks may later supplement that source, but never replace or rewrite it.

Do not reproduce Cascada's compact context tables, dynamic context cloning, or diagnostic stacks without a graph-kernel need; the opaque `errorContext` remains their integration point. Execution-wide fatal coordination is required by [`error-handling.md`](error-handling.md): the execution owns the first fatal outcome and the currently pending operation-result rejection actions, while a higher scheduler observes that same outcome rather than creating separate fatal state.

Every graph operation receives one operation context. Chain initialization binds the Chain to its operation context's execution but does not retain that operation's source context for later work. Each later Chain operation receives its own operation context. Public import and any other boundary without a Chain also receive an operation context. A continuation captures the same operation context as the operation that registered it. This trusted two-field protocol needs no class, factory, freezing, or defensive validation of arbitrary shape or source payload. It does require the minimal explicit presence and execution-binding checks needed to select the right fatal state before graph access; an incidental `TypeError` would lose deliberate attribution and may occur too late. Package export makes it a kernel integration surface, not application language data: Cascada constructs these contexts and never exposes arbitrary Chain/context pairing as a script input.

The operation context selects the execution used by an operation. A Chain also retains its initialization execution as a private invariant because its state and any committed external-tree entries belong to that execution. Remove the public execution getter and every helper that derives an operation's execution from the Chain. At each public Chain operation, fatally assert that `operationContext.execution` matches the Chain binding, then pass the operation context through its graph work. Unwrap its execution only to access execution-owned state or validate the Chain binding. `enter` and other internal Chain creation reuse the containing operation context and bind the new Chain to the same execution. This check prevents silent mixing of two metadata or external-authority domains; it is not a second execution-selection path.

Chain initialization uses its operation context only for work caused there. A ready root retains no creation context. A pending root establishes its root property version and Promise version during initialization so sampling, settlement, admission, and rejection retain the initialization operation context even when the first consumer arrives later. Replacing the root creates a new version with the replacing operation's context.

Keep source context separate from mutable work state. `InvocationWork`, `ErrorQueryWork`, export state, and mutation owners still manage open/closed work and resources; they retain the source operation context only when pending work needs it. Operation-bound graph helpers receive the operation context consistently. Execution-owned stores and Chain binding checks unwrap its execution. Pure shape and prototype helpers remain context-free.

This phase carries `errorContext` unchanged but does not reinterpret current Errors. Existing import diagnostics read `operationContext.errorContext` instead of their old positional source input and retain the current `"(imported at: ...)"` message suffix; Phase 9D-A replaces that suffix with structured attribution. Other Error behavior remains unchanged. At this historical phase boundary, first thenability sampling or captured-then invocation retains the responsible operation context with its execution-local raw outcome. The Phase 9C addendum deletes that retained capture before Phase 9D-A and makes each ordinary recognition or subscription use its own operation context directly. Do not add temporary context strings, an execution-only public API, or an adapter signature.

### 3. Migrate state and APIs together

Change every production graph-operation boundary directly. Place the required operation context after ordinary semantic inputs and before optional compiler/runtime facts:

~~~js
new Chain(initialValue, operationContext)

new ContextChain(
  initialValue,
  operationContext,
  mutationAccessTree = undefined,
)

import(value, operationContext)
lookupPath(chain, path, operationContext)
exportPath(chain, path, operationContext)
hasError(chain, path, operationContext)
getErrors(chain, path, operationContext)
assignPath(chain, path, value, operationContext, mutationScopeDepth = path.length)
deletePath(chain, path, operationContext, mutationScopeDepth = path.length)
run(chain, path, method, args, operationContext, facts)
enter(chain, path, operationContext, entryMutable, onEntered)
~~~

Non-sharing read uses the same `(chain, path, operationContext)` order. A root `ContextChain` performs its own import with its initialization operation context. Internal helpers that start a standalone boundary receive that operation context; helpers within an operation reuse the containing operation context. Add no execution parameter, overload, compatibility helper, or second selection path.

Every production Chain requires an explicit initialization operation context. Related operations carry the same execution; isolated work creates a new `Execution`. Internal Chains reuse the current operation context and bind to its execution. Keep `operationContext` separate from operation `facts`: the operation context selects execution and source, while `mutationScopeDepth`, repair, and other compiler facts describe one operation.

Apply the migration atomically:

- `execution.js` owns execution-local metadata, thenability/continuation state, and the external-identity coordination map.
- `meta.js`, admission, ownership, leases, placement versions, ArrayViews, refcounts, and verification accept the operation context and select its execution; no module-wide metadata fallback remains.
- `language-values.js` owns Promise semantics and makes caller-facing Promise detection `isPromise(value, operationContext)`. `Execution` owns only its thenability and continuation state; do not turn it into a value-semantics service. Any execution-only cached lookup remains private. Remove the module-wide captured-thenable map; declaration code uses separate raw, operation-local probes.
- `chain.js` stores initialization execution privately and checks every operation context before graph work. Remove public execution access and helpers deriving an operation execution from its Chain.
- Every execution-bound fatal entry receives its registering operation context and uses execution-owned `failExecution`. Data declarations outside execution return ordinary validation Errors. Missing required operation context follows Phase 9D-A's narrow fatal-entry contract; operation context is never optional for execution-bound work.
- `language-values.js`, `operation-lifecycle.js`, invocation/export/query owners, mutation owners, and every continuation carry the registering operation context while work needs it.
- Context-root import, host results, managed results, and Promise fulfillment retain their existing boundary behavior under the selected execution.

Keep omitted-operation-context convenience entirely in `test/support.js`. Its lazy default is one fresh `Execution` per test and one placeholder operation context for related omitted calls. Attribution and separate-execution tests pass explicit operation contexts. Production code receives no environment check, optional default, test hook, or compatibility overload.

### 4. Keep configuration runtime-wide

Identity declarations and managed-class registration are host configuration, not graph bookkeeping:

- Keep the declaration `WeakMap` and managed-prototype `Set` runtime-wide.
- Declaration APIs remain outside graph operation context. Their validation and reflection retain host-API Error behavior; Phase 9D-A contextualizes such an Error only if it later enters the graph.
- Do not consume a declaration when one execution admits the identity. It applies to future admission in every execution but never reclassifies existing execution metadata.
- Repeated matching declarations remain idempotent; declaration conflicts still return Error. Declarations no longer compare themselves with admitted metadata.
- Rewrite declaration walks to use declarations, raw structure, operation-local thenability sampling, and class registration. They neither inspect nor stop at admitted metadata.
- Declaration APIs are valid only before the declared data enters any execution. Late declaration remains unsupported and undetected; add no runtime-wide admission registry.

At the Phase 9B endpoint the fatal reporter and synchronous external-code re-entry guard remain runtime-wide. Phase 9C moves both concerns to their natural execution scope: it adds execution-owned first-fatal state, centralized fatal checks, pending-operation-result fatal delivery, and one active-external-action Boolean per execution. The Boolean is set only around an exact synchronous external action, restored in `finally`, and never spans a Promise boundary. Rejecting same-execution re-entry preserves ready synchronous mutation and avoids a second nested ordering path, while external code may synchronously start a separate execution. Contextless declaration/configuration touches no execution guard. Immutable method tables, captured primordials, and sentinel Symbols remain module constants. Traversal maps, releases, copies, and other temporary state remain operation-local.

### 5. Preserve execution boundaries

Admission is fixed per identity within one execution. Importing the same host identity into another execution performs independent admission under current declarations and class registration, with new origin, ownership, placement-version, and refcount state and no host-storage change.

Export followed by import is the only supported transfer of managed data between executions. Exported host copies carry neither declaration nor category; later import classifies the new identities normally. Passing an unexported runtime-owned managed identity between executions is unsupported and need not be detected.

External code may independently supply the same exact external identity to several executions, but their authority and phases do not coordinate. A mutation-capable external identity must therefore belong to only one execution; enforcing that host contract across executions is outside Cascada.

### Verification

- The same record, Array, class instance, Promise-bearing container, or thenable receives independent admission, ownership, placement versions, refcounts, and continuation state in two executions.
- A class instance admitted before class registration remains fixed there; another execution admitting it after registration applies the current registry independently.
- Every admitted category remains fixed within its execution. Tests do not treat declarations made after use as supported reconfiguration.
- Declarations remain runtime-wide, persistent, atomic, and context-free, while declaration thenability sampling is local to one declaration call.
- Two Chains in one execution still share graph state and thenable FIFO order. State in another execution changes neither.
- Every production constructor and operation signature above requires an operation context. A mismatched Chain execution fails fatally before metadata or external-tree access; internal and entered Chains reuse the containing execution.
- Runtime-owned contexts and compiler facts receive no defensive validation of arbitrary shape or source payload. Operations trust the required context and retain only meaningful Chain/execution binding checks after selecting execution-owned state. Contexts for operations emitted from one source clause may legitimately share the same opaque source fact.
- Two imports carrying distinct `errorContext` values produce distinguishable diagnostics, and neither operation substitutes the other's operation context. Phase 9D-A preserves this test with structured attribution instead of the transitional message suffix.
- At the Phase 9B boundary, every caller-facing Promise predicate receives an operation context and each execution samples and canonicalizes a thenable independently, with no global fallback. The Phase 9C addendum supersedes that endpoint: it removes sampling and canonicalization while retaining the operation context for each effectful recognition or subscription.
- A pending root establishes its exact version during initialization and retains that operation context with its deferred work. A ready root does not become a later source-context fallback.
- Context-root import, host-call results, managed results, and Promise fulfillment keep their existing boundary behavior while using the operation's execution.
- The test harness alone supplies omitted operation contexts, using one shared fresh execution per test. Production callers must supply them, but malformed trusted integration calls are ordinary programming errors rather than a separately tested semantic path.
- Every operation-bound fatal entry receives the registering operation context in Phase 9B even though fatal output remains unchanged. The contextless configuration path is explicit and cannot become an operation fallback.
- Export/import produces independent receiving identities and metadata. No supported API transfers unexported managed data between executions, and cross-execution mutable external sharing remains an explicit host-contract violation.
- Refcount inspection and `test/verify-refcounts.js` select one execution explicitly and cannot observe another execution's index.
- Metadata remains non-reflective and physically outside graph objects. Metadata, thenability state at this phase endpoint, the fatal reporter, and the active-external-action Boolean are execution-local; declarations, immutable definitions, and sentinels remain runtime-wide. No ambient execution, runtime-wide re-entry counter, identity-to-execution registry, compatibility store, or parallel admission path remains.

The Phase 9C supported-thenable addendum supersedes every thenability-specific requirement in Phases 2B, 4, 6, 9A, and 9B above. Those passages describe the implemented pre-addendum state; the addendum is the sole owner of removing capture, canonicalization, and execution-local continuation state before Phase 9D-A begins. It also supersedes Phase 9C's transitional producer-recording details for operation-result return below.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-processing.md`](import-processing.md), [`enter.md`](enter.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), public API documentation, and execution-isolation examples.

---

## Phase 9C: Own and observe fatal execution state

### Problem

Phase 9B gives every operation an execution and source context, but fatal failures still use a process-wide report-and-rethrow path. Unrelated work cannot reliably fail every still-pending operation result or record a fatal after a result returns, competing failures can create competing outcomes, and shutdown has no authoritative lifecycle.

### Outcome

Implement the fatal branch of [`error-handling.md`](error-handling.md). Each execution selects one `FatalError`, retains rejection actions only for execution-bound operation results that are currently pending, stops internal work at centralized execution checks, and reports that exact occurrence once through the reporter captured for that execution. It also owns one Boolean for the synchronous lifetime of its current external action, so re-entry checks never couple independent executions. It does not walk or settle internal tasks. Contextless host-configuration APIs remain synchronous and touch no execution activity state. Any operation result completed before fatality is unregistered and remains completed. Keep the existing recoverable Error attribution until Phase 9D-A replaces it; Phase 9D-B supplies a separate expression failure container while graph Errors remain non-thenable.

The remaining Error architecture has one implementation owner per concern:

| Concern | Phase |
| --- | --- |
| Execution fatal authority, per-execution reporting, centralized stop checks, bounded pending-operation-result delivery, and the sync-first operation-result contract | 9C and its completion step |
| Supported ordered-thenable contract and removal of cached capture/canonical-settlement machinery | 9C addendum |
| Final recoverable-Error construction, immutability, precise poison predicates, causal attribution, authoritative kinds, and compound and query-reflection semantics | 9D-A |
| Conservative admission-classification and contextless declaration probes after removal of the transitional host-failure marker | 9D-A |
| Host-boundary and execution-bound conservative-probe fatal checks | 9C establishes the transitional checks; 9D-A centralizes the final host boundary while keeping the admission probe distinct |
| Ordinary graph Error results, expression extraction, and a separate rejecting expression value | 9D-B |
| External-phase recoverable Error state | 9E-9F |
| Promise-valued path failure and lifecycle integration | 10 |
| Final Promise-version terminology and coherent placement-version lifecycle names | 12 |
| Cascada scheduler, compiler operation-context table, diagnostics, Promise ownership, public API, and platform cutover; extension of all standing inventories across the integration | 13 |

Phase 11 preserves the implemented import processor and changes no Error semantics.

### 1. Establish the fatal branch

- `FatalError` directly extends native `Error`. Its trusted factory receives the supplied `errorContext` directly rather than adding repeated defensive checks. Semantic recognition first establishes native Error identity with `Error.isError`, so arbitrary non-Error Proxies are not traversed, and then uses ordinary `instanceof` inheritance. Standard Error constructors and prototype chains must remain unmodified. Add no construction token, instance registry, exact-prototype comparison, frozen shared prototype, or own `then` solely to defend this programming API against deliberate construction, subclassing, prototype replacement, or prototype mutation. Fatal Error is never admitted, combined, queried, repaired, or returned as language data.
- Phase 9D-A owns the recoverable hierarchy, factories, immutability, kinds, and attribution: `PoisonError` directly extends native `Error`, and `CompoundPoisonError` extends `PoisonError`.
- Submit an existing `FatalError` unchanged to the receiving execution. Wrap any other failure escaping a fatal-on-escape transition with the causing operation's source context, including `PoisonError` or `CompoundPoisonError`. Poison is recoverable only when an explicitly language-outcome transition recognizes it before the fatal lane.
- Freeze each completed `FatalError` after construction. It carries immutable source, message, and exact cause reference but no reporting state. Phase 9D-A owns poison-wrapper and compound-child-array immutability; Phase 9D-B supplies the separate PoisonedValue thenable; the Error classes remain non-thenable and shared prototypes remain ordinary. Each execution's first write to `fatalError` prevents duplicate reporting within that execution; another execution receiving the same Error closes and reports independently.

`failExecution(operationContext, reason)` becomes the sole operation fatal entry. `runInternalStep(operationContext, work)` is its synchronous fatal-on-escape envelope:

1. Preserve an existing `FatalError` as the candidate, or create one from any other escaping failure and the current operation source.
2. Submit the candidate to the execution's trusted `fail(candidate)` transition.
3. Propagate the authoritative Error returned by the execution.

Do not make Error class the continuation policy. Use one common guarded continuation path for execution and local-lifetime checks. A transition body that admits language Error consumes poison and performs its publication, collection, or result effect explicitly; any Error escaping the body reaches the one fatal-on-escape envelope. Do not add a Boolean policy argument or parallel continuation families. Phase 9D-A completes the call-site audit as causal Error handling changes.

The guard that merely skips a callback after an already-committed fatal does not classify a new exception from that callback. Therefore every asynchronous contextualization, admission, validation, and bookkeeping body runs inside the shared fatal-on-escape guard. Contextualize raw input rejection inside that envelope and return the ordinary Error through normalized kernel work. Expression and native outward boundaries perform deliberate rejection conversion after required work; they do not throw poison through the trusted fatal envelope. Audit root import, initial causal consumption, managed direct-result handling, and Promise-backed imported-property publication so their ready and pending routes cannot disagree about fatal state.

Declaration validation outside execution returns ordinary host API Errors. A malformed root integration call likewise throws an ordinary JavaScript programming error without constructing a `FatalError`, execution, or reporting path. If such a defect escapes work already running under a valid operation context, that enclosing fatal guard submits it normally.

Remove `reportFatalError`, mutable module-global reporter routing, `FatalError` report state and methods, and every competing reporter or fatal-state path. Use the recoverable and fatal classification contracts consistently; Phase 9D-A owns removal of the `CascadaError` base and export.

### 2. Let Execution own the fatal outcome

Separate failure classification from delivery to a waiting caller. Invalid user data, invalid operation arguments, language errors, and ordinary exceptions or rejections from supported native calls produce poison at their causal boundary; they do not set `execution.fatalError`. The particular host exception need not have been anticipated. Fatal classification applies to unexpected runtime/integration defects or a violation that makes continued execution untrustworthy.

An outward pending-result rejection action is only a stored way to reject that result if its execution suffers such a fatal failure. It does not authorize the operation to classify invalid input as fatal. For example, a lookup waiting on a never-settling input must still fail promptly if unrelated runtime bookkeeping in the same execution breaks. An invalid argument to another otherwise-normal operation produces poison and leaves that waiting lookup and the execution live. Native Promise rejection with `PoisonError` is recoverable Error transport; rejection with the execution's `FatalError` is fatal delivery. The word "rejection" alone determines neither classification.

Construct each `Execution` with an immutable reporter, defaulting to a no-op only when its creator supplies none. Validate an explicitly supplied reporter once at that host-configuration boundary and capture it in a private field; operation work never reads mutable global routing. Private fields on the execution also hold the nullable fatal slot and one initially empty Set of rejection actions for currently pending operation results. One internal Boolean on the execution records only whether an exact external action is active on the current synchronous stack. Expose the fatal outcome through a normal read-only `execution.fatalError` class getter. The trusted `execution.fail(candidate)` transition atomically:

1. Keeps the first fatal candidate.
2. Rejects every currently pending operation result with that Error and clears the Set.
3. Invokes that execution's captured reporter after fatal state is committed.

`execution.js` owns those fields, the read-only getter, trusted pending-result registration/removal, and the atomic `fail` method. `runExternalAction` saves the active-action Boolean, sets it for only the exact synchronous call, and restores it in `finally`; an execution-bound admission probe uses the same field around its distinct conservative reflection. A Boolean is sufficient because supported same-execution external boundaries do not nest. Saving the previous value preserves correct unwinding without introducing a depth counter. Contextless declarations neither read nor write it. `failExecution` is the supported semantic route, but deliberate direct invocation of trusted execution methods is unsupported programming-API misuse rather than a threat requiring another token or wrapper. Do not duplicate the Error onto another field or defensively revalidate the trusted commit path. The null/non-null state of `fatalError` is the fatal latch; the active-action Boolean is an unrelated synchronous ordering fact, not `hadFatalError`. Commit fatal state before rejecting operation results and reporting. Rejecting their native wrapper Promises invokes no external code synchronously. Capture the reporter in a local and invoke it as an unbound synchronous best-effort notification under a protective catch; never pass the execution as its receiver or argument. Ignore its return without sampling thenability, and preserve the fatal Error if it throws; any asynchronous work the reporter starts is host-owned. The reporter is notification, never the delivery or control-transfer path; with no reporter, the operation result and `fatalError` query remain authoritative, and no asynchronous global throw is added. Later candidates neither replace nor reattribute the first Error and do not report again. Do not add another fatal state, Promise, reporter, runtime-wide re-entry counter, operation-owner registry, internal-work listener set, or cancellation registry. Cascada passes its per-render `onError` when constructing the execution, so concurrent executions may report independently.

The Error and facade layers call the execution's trusted `fail` and `registerFatalResultRejection` transitions directly. Keeping state and transitions on their owner removes the module-private state map and free-standing adapter exports. These methods are package-integration protocol, not security capabilities.

This repository implements and tests the execution fatal outcome, centralized stop checks, execution-scoped external-action activity, and one common `returnOperationResult` helper in the package's host-facing facade around actual import, observation, export, invocation, entry, mutation, and Error-query routes. Every ready result remains direct; every direct Promise returned by an execution-bound operation gets one removable fatal rejection action for exactly its pending lifetime. Core-operation and other internal Promise results do not. Chain and context-root construction check public entry, perform available initialization through the common host and subscription boundaries, and return immediately without an outward wrapper or constructor-specific final check. Contextless declaration and host-configuration APIs remain synchronous because they have no execution to observe, and they may run while another execution is inside external code. In Phase 13 Cascada uses the documented public API completed in 9D-B. Each public kernel call owns its result; higher-runtime operations with additional work own their separate final completion, and delegated aliases add no wrapper.

Treat removal of global reporter routing as an explicit repository migration, not only a new-behavior test. Audit `test/setup.js`, `test/support.js`, fatal subprocess fixtures, `test/verify-refcounts.js`, direct `Execution` construction, and every import or call of `setFatalErrorReporter` or `reportFatalError`. A test that needs fatal capture supplies its reporter before constructing the execution and routes the operation through that execution. A captured reporter may append to mutable test result storage, but it must not forward through a mutable “current reporter” compatibility slot that recreates global routing. Remove global reset behavior. Fatal fixtures use an explicit execution; malformed missing-context calls receive no dedicated semantic test matrix.

Operation owners remain the local Phase 7E lifetime mechanism and are never registered with the execution. They carry no fatal-reject action and serve only live-execution local completion. A public operation issued after fatal throws the stored Error synchronously; an already-issued internal operation simply returns when its next common continuation observes fatal state.

Shared settlement precedes a local-owner check while the execution remains live. An execution-fatal check comes first and stops all graph and cleanup work; fatal delivery does not close local owners or balance their releases.

It also removes fatal-observation complexity from the existing Phase 7E helper stack. Delete `observeFatal` and any per-result fatal observer: a fatal-on-escape transition submits its failure immediately, ignored owned Promises are marked handled at their producer, and operation result Promises use `returnOperationResult`. Keep the owner local and minimal—its direct `open` fact, idempotent `close()`, and lazy release set. Do not retain a trivial `mayContinue` wrapper or use lifecycle code as a Promise-combinator layer. Phase 9D-A finishes the consolidation by replacing initial/internal/prepared/single/all continuation variants with one guarded operation-transition entry plus explicit admission, publication, and complete-collection bodies at their natural semantic boundaries.

### 3. Check once and stop failed-execution work

Put fatal checkpoints only at centralized semantic transition boundaries:

- public operation entry;
- at common continuation resumption, before settlement or operation work;
- at the supported external-boundary exit, before processing its return or throw;
- at supported-thenable subscription exit, before using its return or classifying an invocation throw;
- and scheduler dispatch.

Do not poll inside hook-free synchronous helpers or loops. JavaScript cannot change the execution's fatal state concurrently there. Allow an active synchronous host call to return; the mandatory check in its boundary helper discards its result when nested work closed the execution. A bounded amount of extra hook-free work after closure is acceptable when avoiding it would spread checks below these transition points. Result-contributing work and host effects must not ignore closure.

A subscription may synchronously drain callbacks from earlier pending registrations. An older callback's fatal rejects its own returned chain, which need not unwind the currently subscribing stack. The common subscription boundary therefore checks the subscribing operation's execution when `then` returns or throws and propagates its authoritative fatal before any result processing or new pending registration. This is a scheduling boundary, so its supplied continuations run without setting the execution's active-external-action Boolean. A failure confined to another execution does not stop this one unless that `FatalError` enters its boundary.

Implement one common guarded-resumption shape: if `execution.fatalError !== null`, return; otherwise perform shared settlement, then apply the ordinary local-owner check before operation-specific work. Public entry and the existing exact supported-external-action wrapper use the same direct field check at their boundaries; Phase 9D-A replaces that wrapper with final `runExternalBoundary`, which owns the check thereafter. Do not introduce a separate post-external-action helper, subscription, listener, cancellation token, fatal-cleanup callback, or configurable guard policy.

After closure:

- start no new operation or supported host work;
- a component that detects the fatal submits and propagates the authoritative Error to unwind its current call or Promise reaction;
- a later continuation checks fatal state first and returns without settlement, cleanup, or operation-specific work; and
- no private publication or host effect occurs after that check.

Keep the detector/observer distinction explicit. A detecting Promise reaction must not commit fatality and then fulfill successfully with `undefined`; doing so would make every downstream consumer responsible for distinguishing swallowed failure from a real successful `undefined`. Propagating the authoritative rejection is native structured control transfer. Check-and-return belongs to later resumptions that observe the already-closed execution. When an older detecting reaction runs during a newer subscription, rejection of the older chain and fatal propagation at the newer subscription's exit are both required. Skipping the newer supplied callback alone cannot make the issuing operation return successfully.

Remove the earlier Phase 7E rule that an asynchronous fatal must first close its local owner. `Execution.fail` commits synchronously before the failure can reach an aggregate, so the execution check already stops every late sibling. Audit query contexts and the current `observeFatal` and `run` paths so a detecting transition immediately submits and propagates the authoritative Error, while a later resumption that sees `fatalError` simply returns. Normal, language-Error, and live-execution local completion still close normally.

Audit every existing kernel-owned Promise that may reject before its semantic consumer attaches: internal continuations and aggregates, gates, cleanup Promises, and the derived reaction used to bridge a core result into its outward wrapper. A real consumer handles its source Promise, but any derived Promise it creates must itself be returned, owned, or marked handled. Keep or introduce a named `markPromiseHandled` helper only if at least two actual producer sites need that exact operation; otherwise perform the exact ownership action at its sole site rather than naming a general mechanism. Do not observe unused host input or change publication. Phase 9E applies the same rule to its new external phase Promises; Phase 9D-B audits input consumption and expression-result delivery without changing graph Error thenability.

Do not register any internal wait, gate, phase, aggregate, or detached Promise for fatal delivery. Common continuation helpers check execution fatal state first. On fatal they simply return without inspecting the settlement payload. In a live execution they perform required shared settlement and then apply the ordinary `owner.open` check. A never-settling source Promise is not cancelled or awaited; its continuation may remain pending indefinitely. Every execution-bound operation whose direct result is waiting on it has its separate operation-result rejection action.

Do not add fatal-specific settlement for private gates, external phases, or aggregates. If their blocker settles, they reach the same execution check and stop before publication or host work. If it never settles, they may remain pending. Fatal is never installed as graph data or repairable phase poison.

Implement one explicitly sync-first `returnOperationResult(operationContext, result)` helper in the package's host-facing facade. Thin exported wrappers perform the public-entry check, call the unchanged core operation, let it complete boundary-specific processing, and pass only its operation context and classified direct result to the helper. Internal modules import core operations directly, so they never wrap an intermediate result; add no public/internal flag. The helper receives either a ready semantic result or a direct result whose required core transitions remain pending; any ready Error at this point is already classified language poison. Core direct-result paths consume synchronously delivered custom thenables before returning. The helper therefore recognizes Error, Function, and fixed admitted category before ordinary pending recognition, returns a ready result directly, and treats any supported thenable left in this position as pending. It neither records producers, probes native Promise branding, nor performs a preliminary subscription or duplicate synchronous fatal check. This relies on every effectful core boundary propagating fatality before returning, including a subscription that delivers older queued work. Only the hook-free interval after those checks and before registration is protected by JavaScript run-to-completion. The outward bridge is itself a subscription and uses the same scheduling check; any wrapper or derived chain created before an escaping failure retains explicit rejection ownership even if it cannot be returned to the caller.

For a direct Promise, construct one native outward wrapper and one idempotent fatal reject action. Register that action in the execution's pending-operation-result Set and consume the source through the same common guarded continuation used elsewhere. The outward-settlement reaction deletes the action before settling the wrapper with the already classified result. Merely settling the internal source queues that reaction and does not complete the operation result; fatality committed before it runs rejects the still-pending wrapper. Once it runs and unregisters, the outward result wins over later fatality. Immediately handle the derived continuation Promise. The helper accepts no operation owner, resource cleanup, result mode, or boundary-specific option. Registration performs no task cancellation, owner closure, dependency walk, or resource notification; ordinary internal checkpoints stop later work. Thus fatal fails every pending operation result even behind a never-settling dependency without adding a wrapper, registration, or microtask to synchronous or immediate non-blocking returns.

Do not replace this with one permanently pending shared fatal Promise. A settled `Promise.race` cannot detach its losing fatal reaction, so one long-lived execution would retain historical reactions and potentially their result values without bound. Do not retreat to a root-only race either: package-level public operations are independently observable and must fail promptly. The Set contains only currently pending outward obligations and is not an operation, task, owner, cleanup, or cancellation registry.

Native Promise settlement assimilates a fulfilled object with a callable `then`, while a ready return does not. Preserve sequential equivalence through source invariants rather than a second result transport. A successful non-Promise language-data result must not expose a callable `then` through native lookup: ready assignment returns and publishes `PropertyValidation` for a callable own placement; Promise-backed property publication performs the same validation when fulfillment becomes available; managed host mutation reports `InvalidManagedReceiver`; and managed-class declaration or snapshot adoption rejects a callable or accessor `then` anywhere on the retained prototype chain. Managed prototypes remain stable after declaration, standard record/Array prototypes remain stable, and exact Functions and external identities remain read-only after admission. Non-callable `then` data remains ordinary. Imported callable thenables already take the Promise path before admission. Operation return therefore recognizes Error, Function, and fixed admitted category before checking the remaining direct result for supported thenability; it keeps no separate producer fact or Promise-brand path.

Use `src/index.js` as that facade unless an actual module cycle requires a tiny dedicated facade module; do not create a wrapper layer speculatively. Keep the public-entry `fatalError` checks visible in the wrappers instead of adding a configurable public-operation runner.

Audit the package export manifest as the coverage source, not a hand-maintained subset of call sites:

- thin facade wrappers cover public `import`, `lookupPath`, `export`, `hasError`, `getErrors`, `run`, `enter`, `assignPath`, and `deletePath`;
- exported `Chain` and `ContextChain` construction perform the entry check and use the common host/subscription checks during initialization; construction may consume thenables and is non-blocking, but is not hook-free and adds no final recheck or outward Promise;
- `externalState`, `managedState`, and `managedStateClass` stay on their contextless synchronous configuration path; and
- exported Error classes, predicates/constants, and `Execution` configuration are not semantic operation-result boundaries.

Phase 13 consumes only the documented root API completed in 9D-B. Public graph operations own their outward results; guarded composition helpers expose the shared Error and execution mechanisms without creating an unwrapped graph API. Cascada does not duplicate factories or guards and owns the completion of its own operations when additional required work follows a kernel call.

No package-exported execution operation may bypass this boundary. The small package-surface test in the Method section reads the actual exports and fails when a new public operation is added without an explicit classification in this list.

Do not add an execution-idle counter, quiescence barrier, operation-owner registry, internal-work listener set, or general task registry. The narrow Set of currently pending operation-result reject actions is the fatal delivery mechanism required by the public contract; it contains no operation work or release callbacks. Do not interrupt synchronous JavaScript, cancel native Promises, settle gates or phases for shutdown, or undo completed host effects. Fatal-capable continuations submit directly through `failExecution` even after their originating owner closes.

Audit every `.then`, Promise constructor/resolver, FIFO registration, aggregate continuation, and callback stored for later execution. Each asynchronous callback must be exactly one of:

- an operation transition entering the common execution check before semantic work;
- an explicitly admitted input/callback rejection channel whose causal classification and bookkeeping produce ordinary Error data inside its guarded transition; expression/native rejection conversion belongs at the final outward boundary;
- a custom-thenable settlement callback that checks the same execution before recording first settlement;
- the no-op ownership handler for a kernel-owned Promise;
- or the operation-result reactions installed through the common guarded continuation path.

Promise executors that only capture a resolver are synchronous construction, not later work. No other callback may publish graph state, invoke external code, allocate operation resources, or dispatch scheduler work after fatality. Representative route tests run under strict unhandled-rejection behavior; source search assists each audit but does not pretend to prove dynamic semantics, and no runtime registry is added.

Diagnostic formatting remains above the kernel. It may inspect opaque source data and cause stacks only outside graph transitions and under `try`/`catch`. Formatter or reporter failure cannot replace the stored Error or execution outcome. The reporter used here is the execution's immutable captured reporter, not mutable global routing.

### Verification

- `FatalError` directly extends native `Error`, is immutable and non-thenable under the supported stable Error prototype contract, and no longer uses the transitional `CascadaError` base. Existing fatal instances are submitted unchanged to each receiving execution, whose earlier fatal Error remains authoritative. Transitional poison remains recoverable only when a language-outcome continuation recognizes it; poison escaping a fatal-on-escape transition becomes the exact cause of a new `FatalError`. Phase 9D-A owns the one final poison/base-class cutover.
- Error recognition uses `Error.isError` followed by ordinary `instanceof`; shared Error prototypes are neither frozen nor shadowed solely to resist deliberate mutation. Modified Error constructors or prototype chains are unsupported.
- The ordinary `FatalError` constructor and one trusted fatal factory supply the source without a private token or instance registry. Malformed internal calls are not a supported runtime path. Phase 9D-A extends the same construction pattern and authoritative kind table to poison.
- `runInternalStep` and fatal-on-escape Promise reactions attribute every failure escaping valid execution work to the causing operation and propagate the execution's first fatal outcome. A root call lacking its trusted operation context throws an ordinary programming error and constructs no fatal outcome. Setup validation outside execution returns ordinary host API Errors.
- Fatal state and rejection of currently pending outward wrappers commit before reporting. One occurrence reports once through its execution's captured reporter, later candidates cannot replace it, and the same occurrence closes and reports independently through another execution's reporter.
- Each execution owns one active-external-action Boolean. Exact external actions and execution-bound admission reflection save, set, and restore it only on their synchronous stack. Same-execution public re-entry is fatal, another execution remains usable and may be entered synchronously, and no Boolean state spans returned Promise work. Contextless configuration touches no execution activity state and may run during an external action.
- Public entry, guarded continuations, external-boundary exit, subscription exit, and scheduler dispatch observe the same nullable `fatalError` value. Operation return relies on these actual boundaries, including queued work delivered inside `then`, and needs no duplicate facade-wide check.
- Closure starts no new graph, operation, or host work. A resumed continuation checks fatal first and simply returns before settlement, cleanup, or publication.
- Operation owners remain local and never register with the execution or retain a fatal-reject action.
- `Execution.fail` stores one Error, rejects and clears only current pending outward wrappers, reports, and walks no internal task, gate, phase, aggregate, or owner. Private fields hold the state; the read-only getter exposes the outcome, while trusted `fail` and pending-result registration methods keep their transitions on the owning object. Deliberate direct method use or prototype tampering is unsupported and earns no adapter or token.
- Every pending execution-bound operation result rejects with the exact authoritative Error. Each direct Promise has exactly one rejection action while pending and none after settlement; one long-lived execution retains no historical operation-result reaction or value graph. A ready-only execution, ready result, and immediate non-blocking return allocate no outward wrapper, Set entry, or microtask for fatal observation. Contextless host-configuration APIs stay synchronous and are not part of an execution shutdown.
- A fatal discovered after any successful outward operation-result settlement is stored in `execution.fatalError`, reported once by that execution, and closes remaining work without changing the delivered result; it may still make that result's trustworthiness unknown. Internal source settlement alone does not win while its outward-settlement reaction remains queued. Reading `null` before remaining work finishes is not a success guarantee.
- For every result-bearing operation, inject a fatal from boundary processing or Promise-property publication that contributes to its result and verify that the outward result cannot settle successfully. Separately verify that a fire-and-register task, nested result Promise, or short-circuited sibling which no longer contributes may fail after delivery: the delivered result remains unchanged while the execution stores and reports the fatal. These tests pin the operation's semantic frontier rather than adding dependency tracking to fatal handling.
- A fatal from unrelated work rejects every pending operation result even when an internal normal input never settles. That internal operation may remain pending; if it later resumes, it stops at the common check.
- Closing a local owner inside a live execution stops its operation-only work without cancelling required shared settlement or preventing a later fatal report; a failed execution skips both.
- Fatal detection and observation invoke no local-owner `close()`, registered release, gate/phase completion, or scheduler/buffer sweep. A direct field check and return are the only internal cancellation behavior; rejecting pending outward wrappers is result delivery, not internal cancellation.
- Two concurrent executions use their independently captured reporters and active-external-action Booleans without cross-routing or cross-blocking. External code in one may synchronously enter the other. A normal-function reporter receives `undefined` as `this` and is not given the `Execution`. A synchronous reporter throw cannot replace the first fatal outcome; reporter return thenability is not inspected, reporter re-entry sees the committed non-null `fatalError`, and absence of a reporter never causes an asynchronous global throw.
- The test harness, direct-construction tests, refcount verifier, and subprocess fixtures pass reporters through `Execution` construction. No test-only global setter, reset, or mutable forwarding route conceals the production ownership rule.
- Every existing kernel-owned Promise category in the audit is handled without observing unused host input; every derived Promise is returned, owned, or handled.
- No competing or mutable-global reporter, fatal state, cancellation framework, fatal-only terminal state, owner registry, idle counter, quiescence barrier, or general task registry remains.

Add route-matrix tests for already-failed public entry, every execution-bound operation's ready and pending result, immediate non-blocking returns, common resumption after fatal before any later effect, custom-thenable settlement after fatal, same-execution host-boundary re-entry failure, permitted synchronous entry into another execution, an admission-classification hook that catches that nested fatal, fire-and-register operations, fatal state behind an installed gate, a never-settling internal dependency, a trusted language-outcome callback rejecting poison, and a callback whose contract admits no Error outcome throwing that same poison. Pin the ordering boundary: internal source settlement followed in the same synchronous turn by fatal commit still loses because outward settlement has not run; an already settled outward result remains unchanged. On one long-lived execution, settle many operation results and verify completed outcomes remain unchanged and retain no observable fatal-delivery behavior; keep one result pending, fail the execution, and verify it rejects promptly without touching its source Promise. Review the module-private registration's direct deletion and clear paths instead of exposing production state or adding a test-only query solely to inspect the Set. Cover ready and Promise-backed callable-own-`then` assignment, inherited callable `then` rejection during managed prototype declaration, managed receiver mutation, and an asynchronously completed operation result so native Promise assimilation cannot create a second behavior. Exercise supported native Error contextualization through ready and pending root import, Chain-value, managed direct-result, and nested imported-property paths and verify every unexpected asynchronous escape closes the execution. Verify separately that contextless host-configuration calls stay synchronous, acquire no execution state, and may run during an external action. Test the shared lifecycle primitive directly for owner closure and release-set clearing across ready success, ready language Error, fulfillment, poison rejection, and early close; integration tests assert each externally meaningful lease and late-effect invariant rather than adding test-only access to private owners. Do not use a global `afterEach` quiescence assertion or test-wide owner registry: pending operations can be legitimate, and fatal execution deliberately performs no internal cleanup walk. Phase 13 applies the same result matrix to Cascada's public operations, including script completion.

Update [`AGENTS.md`](../AGENTS.md), [`error-handling.md`](error-handling.md), [`runtime-spec.md`](runtime-spec.md), operation-lifecycle documentation, diagnostics, and public fatal-reporting documentation. Phase 13 owns the higher runtime's consumption of the exposed execution fatal outcome.

---

## Phase 9C addendum: Simplify supported thenables

**Implemented.** Supported thenables own scheduling and the kernel preserves immediate progress. The completed subscription boundary below propagates fatality from queued delivery and preserves rejection ownership.

### Problem

Caching a callable `then` per execution, invoking a source once, and creating a canonical native Promise would duplicate settlement and subscriber behavior already owned by a supported thenable. It would also turn Cascada-style synchronous readiness into native-Promise microtask readiness and add identity state unrelated to execution-owned graph effects. The kernel needs ordinary source subscriptions with the same fatal checkpoints as other scheduling boundaries.

The runtime does not need to support arbitrary objects that merely expose a callable `then`. It needs native Promises with standard behavior and Cascada-style ordered, chainable thenables that preserve program order while allowing already-ready values to call a continuation synchronously.

### Final contract

Use the authoritative supported-thenable contract in [`data-limitations.md`](data-limitations.md):

- recognize Error and Function before thenability;
- require a stable callable `then`, one consistent outcome, once-only delivery per subscription, enough independent subscriptions for all consumers, FIFO callback delivery, and a chainable return. FIFO spans settlement: a later ready subscription cannot overtake an earlier registered callback not yet delivered;
- allow the callback to run synchronously when the source is ready and preserve that synchronous transition;
- require a callback delivered before its own subscription returns to let its throw escape that `then` call, and a callback delivered after its subscription returned pending to reject that returned chain on failure. The latter remains pending delivery even when a subsequent subscription drains it synchronously. A host implementation unable to provide this sync-first chain behavior must expose a native Promise instead;
- require a custom thenable's fulfillment value to be final and non-thenable; the custom thenable, not the kernel, owns nested assimilation;
- perform an ordinary `.then(onFulfilled, onRejected)` subscription at every required program position through the common continuation helper; and
- treat dynamic or Proxy-dependent `then`, changing methods, repeated or inconsistent settlement, non-FIFO delivery, insufficient subscriber support, and nested custom-thenable fulfillment as unsupported host data. Do not validate, normalize, repair, cache, or add cycle machinery for these cases. A getter or invocation failure that ordinary execution safely observes still follows that boundary's normal failure classification.

The custom thenable owns outcome state, registrations, FIFO delivery, and chaining. An execution owns only the graph state and effects produced by its subscriptions. Supplying one host thenable to two executions therefore adds ordinary subscribers to the same source; it does not create two private source queues or promise isolation inside the host object.

Treat `then` as a narrow trusted scheduling protocol, not as a general host callback. Its body performs its own subscription, delivery, and chaining work and must not synchronously invoke Cascada APIs except through a supplied callback. The kernel therefore does not set the execution's active-external-action Boolean while the supplied continuation runs; doing so would misclassify every legal synchronous delivery as re-entry. Swallowing a throw from the currently supplied synchronous callback violates the contract. Catching an older pending callback's throw to reject its already-returned chain is required chaining behavior and may occur during a later subscription. The common subscription-exit check propagates any fatal this delivery establishes in the subscribing execution; add no secondary subscriber queue or per-delivery diagnostic state.

### Implementation

The final action-based Error kind names below describe the required causal boundary. Keep the existing transitional kind vocabulary during this addendum; Phase 9D-A performs the coherent rename and final Error factory cutover. Do not pull that representation work or Phase 9E authority registration into this rewrite.

Rewrite the thenable path as one direct mechanism rather than adapting the capture implementation:

1. Remove `Execution._thenables` and every execution-wide or module-wide thenability registry.
2. Delete `capturedThenableOf`, `captureThenable`, `recordPromise`, `isCapturedPromise`, `createPromiseProbe`, its private declaration `WeakMap`, the captured-callable record, `canonical`, and any first-settlement, subscriber-queue, Promise-species, or active thenable-cycle support whose only purpose was arbitrary-thenable normalization.
3. Replace the Boolean-probe-then-subscribe sequence with one common possible-value consumer. For a raw value it recognizes Error and Function and consults fixed admitted metadata before accessing `then`; an already admitted non-Promise identity is never reinterpreted. If the value is direct, it invokes the ready transition directly. If it is a supported thenable, it performs that source's ordinary `.then(onFulfilled, onRejected)` subscription at the consumer's program position. A getter read is not sampled for later reuse.
4. Keep the common continuation body minimal: wrap only the execution-fatal check, operation-lifetime check, shared-settlement step, and semantic transition already required there. Invoke the trusted thenable protocol narrowly rather than through the generic external-code envelope, which must not remain active across a synchronous supplied callback. At subscription exit, propagate the subscribing execution's stored fatal before using a result or classifying an invocation throw. Preserve an escaping callback `FatalError`; while the execution remains live, classify a safely observed access or pre-outcome invocation throw at this operation as `ThenAccessFailed` or `ThenInvocationFailed`.
5. Let the helper's ordinary return shape carry readiness: a synchronous callback returns its transition result directly; otherwise `then` returns its pending supported chain. A transition callback that starts another possible thenable consumes it through the same helper before returning, so after Error, Function, and fixed admitted-category precedence a thenable left in this trusted result position is actually pending. Check that result directly. Do not introduce a `{ pending, value }` wrapper, `callbackRan` or `settledSynchronously` Boolean, backwrite test, or another readiness algebra. A callback backwrite may store the resulting graph value, aggregate member, or progress fact, but it is not the readiness signal.
   A local fact may record that a supplied continuation was entered solely to distinguish its synchronous throw from a pre-outcome `then` invocation failure. That fact never determines readiness. Once a continuation starts, any throw from it escapes exactly once; do not invoke the rejection continuation again.
6. Audit every pending-only decision together. `continueAllInternalResultsOrFatal` runs each component and adds only its returned pending chain to `Promise.all`; a synchronously consumed custom thenable may fill its value slot but must not contribute `undefined` or force a microtask. Export determines pending lifetime from the normalized aggregate result rather than pre-scanning its inputs. Root and Chain initialization, `enter` publication, mutation gate selection, operation finalization and result observation, managed-preparation release registration, invocation lease retention, Array preparation and `includes`, Error-query wait collection, path work, derived-chain handling, and operation-result return likewise allocate pending machinery only from the normalized returned result. Mark only returned pending derived chains handled. JavaScript run-to-completion permits registration first and pending protection immediately after `then` returns: a callback not delivered synchronously cannot interleave before that protection is installed and the operation returns.
7. Make `returnOperationResult` preserve Error, Function, and fixed admitted-category precedence before ordinary supported thenability. Remove producer recording as its pending-result signal. Core direct-result paths must consume a synchronously settled custom thenable before returning, so a thenable that reaches the public return is pending and receives the one outward native wrapper and fatal-reject action.
8. Keep declaration APIs synchronous. They reject a reached callable thenable through direct contextless validation and keep no probe helper or sample cache. Alias deduplication remains only where the declaration identity walk itself requires it.
9. Consume a possible placement thenable before committing its representation. Use an unpublished staging version for any logical backwrite needed by the resolver. If the resolver transition returns directly, publish its final value directly into runtime-owned storage; if imported storage must retain the physical thenable, commit that final value through the existing fixed-overlay mechanism. Install a distinct Promise version only when the resolver transition returns pending. The returned result, not whether staging was written, selects the representation. Removing source-thenable canonicalization does not merge actually pending versions or change the rule that each consumer registers at its exact program position.
10. Remove `ThenableCycle` from the authoritative kind table and causal-boundary matrix. Retain `ThenAccessFailed` and `ThenInvocationFailed` only for failures ordinary supported use can safely observe at the current operation boundary. Admission's separate conservative structure-classification catch still admits an uninspectable non-thenable identity as opaque, and declaration recognition still returns contextless validation; do not broaden either into a context-free `isPromise` probe.
11. Preserve atomic import while moving subscriptions into validation. Synchronous custom deliveries reuse the current segment's staging and identity state. Give the segment one local lifecycle fact, `staging -> committed` or `staging -> abandoned`, using existing segment state when available. During staging, deliveries participate in the active walk. Commit grants pending subscriptions authority to import and publish on later delivery; abandonment makes their later callbacks return after the common execution and segment checks without admission, Promise version or leaf creation, or publication. Release staging collections on either terminal transition and retain only the lifecycle fact and captured work still needed by owned reactions. No committed shared version exists for an abandoned callback to settle. Keep those reactions handled without cancelling the source or adding an execution registry, transaction class, or second subscription path. Later delivery for a committed placement starts a new segment at its existing FIFO position. This generic staging lifetime is established here and preserved by Phases 9F-B, 10, and 11. Final raw-Error construction, semantic deduplication, and their tests remain Phase 9D-A work; no cross-segment wrapper interning is required.
12. Keep mutable-authority discovery separate from ordinary thenable consumption. Discover direct paths in the original context using the segment's admitted/staged category facts; stop at any Promise or thenable, including a synchronous custom one. A staged fulfillment does not establish a direct path. Commit discovery and import atomically without extra subscriptions or early overlay publication. Ordinary import still consumes thenables and uses its logical placement reads.
13. Rewrite rejection observation for supported custom receivers. `markPromiseHandled` must use the ordinary subscription protocol rather than applying `Promise.prototype.then` to its input. An observer can complete synchronously; only a returned pending derived chain that can reject carries another ownership obligation. Consume already-classified rejection without replacement, extra normalization, or recursively adding no-op observers. Fulfillment-only phase completion needs no rejection-only observer; potentially rejecting derived reactions still need an owner.
14. Audit every subscription as a possible synchronous callback point. Before subscribing, initialize callback-visible staging and captured versions, and complete only publication required regardless of readiness. A synchronous callback uses that staging without requiring pending-only machinery. After the subscription returns pending, install the gates, Promise versions, leases, and registrations required by its unfinished dependency before the issuing stack returns. Semantic protection independent of pending delivery still precedes the protected callback: mutating `enter` installs its exclusion gate before `onEntered`, and read-only entry protects its captured value before `onEntered`. Entry transfer uses the captured property version without independently consuming it during private Chain setup, and mutation-walk continuation work must not be followed by stale parent publication. Use existing placement staging and capture mechanisms, not a second entry or continuation path.

Do not retain adapters for the old API. Change every caller in the same rewrite and remove the obsolete exports and tests.

### Implemented simplifications

- Ordinary property reads normalize newly reached placements. Indexing, remapping, and traversal then use their logical values, so refcounts need no callback that installs a Promise version and placement code needs no create-or-reuse Promise version path. Ready outcomes publish directly where storage permits; fixed overlays cover preserved imported or non-writable storage.
- Import owns the fulfillment-segment processor and its subscriptions. Synchronous delivery writes the active staged version; later committed delivery imports a new segment and publishes through the existing property-version commit. This removes the property-to-import callback loop and installer callbacks considered for Phase 11.
- Finalization returns one continuation that completes the logical result and closes the operation. Explicitly admitted callback/input rejection becomes ordinary Error data before normalized completion; no observer is needed solely for cleanup.
- Mutation-path handoff suppresses stale enclosing publication after synchronous continuation completion. Mutable entry initializes a private Chain without consuming the captured source, installs its exclusion gate, and then transfers that exact version.
- Completed managed-receiver validation reads retained logical data directly and rejects thenables without invoking them. Ordinary preparation continues to consume availability.

### Scope of the returned-result rule

Apply the same direct-or-pending invariant wherever pending state is currently inferred before a transition runs:

| Area | Simplification | State that remains load-bearing |
| --- | --- | --- |
| Scalar and aggregate continuation | Run the common consumer; aggregate only returned pending chains | Aggregate slots still store semantic values and logical ordering |
| Root, Chain, and `enter` publication | Consume first; keep ready outcomes direct and install publication waiting only for the returned pending chain | Entry gates and source-root publication still encode ordering |
| Export | Decide release registration and owner closure from the normalized export result, not a readiness-input pre-scan | Partial copies, alias maps, and Error collection retain their own output lifetime |
| Mutation and path traversal | Add pending-only protection for unfinished path selection or publication, never merely for an independent result after target handoff | `pathSelectionComplete` or an equivalent retained target records handoff; captured original values and protected-prefix facts retain publication semantics |
| Invocation and managed preparation | Retain pending-only receiver or argument leases from normalized subresults | `receiverReached` remains necessary because a receiver may be reached before the method's independent result becomes pending; `leaseInputsThroughResult` keeps receiver and retained-payload leases until a pending result has finished consuming them |
| Array and Error-query branches | Add only returned pending branches to `includes`, flattening, preparation, or query waits | Query open/found state and remaining-branch counts still encode early completion and full collection |
| Property publication | Commit ready custom outcomes directly or through a fixed imported overlay; create a Promise version only for a returned pending resolver | A staging or Promise version backwrite carries the logical property value and is not a readiness flag |
| Operation finalization and derived-chain ownership | Close directly completed work immediately; observe or mark handled only a chain that remains pending | Source settlement and operation closure keep their existing semantic owners |

Apply the returned-result rule to the dependency whose lifetime is being decided. Once traversal selects its target, the containing operation owns any independent result; a pending result cannot add prefix protection or extend receiver publication or source capture already completed. Represent handoff with one local `pathSelectionComplete` fact set immediately before invoking the selected target operation, or reuse a retained selected target that expresses exactly that fact. This is semantic progress, like invocation's `receiverReached`, and is distinct from a callback-ran or result-readiness flag.

Do not apply automatic consumption where thenable-shaped input or output is itself forbidden. Declaration APIs and synchronous-only callback contracts, such as an Array `sort` comparator, reject a callable thenable without invoking it. The synchronous mutable-external snapshot walk likewise rejects nested thenables, and completed managed-receiver validation rejects retained thenables, even if they could deliver synchronously. Direct host or property results retain their ordinary consumption boundary. Refcount indexing, Array remap, and graph walks inspect already-normalized logical placements or their pending-version facts without invoking a host thenable merely to classify readiness. Mutable-authority discovery instead follows the compiler tree through original placement inputs using staged/admitted categories, stopping at all thenable sources without following their logical overlays. Do not delete semantic state such as `receiverReached`, query open/found state, phase membership, Promise version values, or mutation publication facts merely because a continuation result also describes readiness.

### Cascada compatibility

Cascada's `ResolvedValue` demonstrates the required direct callback return. Its existing `PoisonedValue` is a precedent for synchronous rejection, but not a conforming implementation: it catches a callback's thrown `PoisonError` and converts it into another poison value. The new contract requires that throw to escape. Phase 9D-B installs the minimal conforming `PoisonedValue`, and Phase 13 replaces Cascada's legacy wrapper; add no compatibility catch or adapter in the kernel. `RuntimePromise` delegates scheduling to native Promise machinery but retains legacy attribution and wrapping that Phase 13 removes. Compatibility tests must distinguish useful scheduling behavior from these migration differences and exercise callback throws as well as outcomes. The FIFO crossing rule also applies to queued delivery: a later ready subscription cannot overtake an earlier undelivered callback. `IteratorWaitToken` is single-consumer and remains an internal scheduler token; it must not cross the kernel data boundary as a supported thenable.

### Verification

- Native pending Promises and pending custom thenables notify Cascada consumers in subscription order and preserve the existing sequential-equivalence tests.
- When an earlier pending subscription has settled but its callback has not yet been delivered, a later subscription cannot run synchronously ahead of it. If delivering that earlier callback commits fatality, its returned chain rejects and the currently issuing operation propagates the subscribing execution's authoritative fatal at subscription exit, even if its own callback was skipped or its new chain remains pending.
- A ready custom fulfillment or rejection completes the available transition in the same turn; no native Promise or microtask is allocated merely to normalize it.
- A callback throw from ready delivery unwinds synchronously through the fatal transition, including from a fire-and-register operation. A callback throw after pending delivery rejects its returned chain and still records the execution fatal even when that operation no longer contributes to an already delivered result.
- Multiple subscriptions to one supported custom thenable receive its same outcome exactly once in FIFO order. Sharing it between executions produces independent graph effects without execution-local thenability state.
- Public ready values remain direct. A genuinely pending native Promise or custom thenable receives one removable fatal-reject action, rejects promptly on fatality, and unregisters before outward settlement wins.
- Direct host-call, import, property-Promise version, path, mutation, query, and export routes preserve their boundary-specific success, poison, and fatal behavior for both native Promises and supported custom thenables.
- Ready custom thenables in root and Chain initialization, `enter`, `continueAllInternalResultsOrFatal`, mutation preparation, invocation preparation, export, `includes`, and Error queries remain direct and acquire no pending-only wait, gate, lease, release, outward wrapper, observer, or microtask. Pending forms acquire exactly the protection required by that route before the issuing stack returns.
- Tests determine readiness solely from the normalized transition result. A synchronous callback may or may not backwrite semantic state and may itself consume another ready custom thenable; neither case allocates a readiness flag. If nested required work remains pending, the returned chain alone triggers pending machinery.
- A synchronously consumed custom thenable assigned to runtime-owned storage publishes its final value without a Promise version. The same value in imported physical storage remains untouched and receives a fixed logical overlay. Pending native and custom sources still receive distinct versions per placement and program position.
- Declaration tests cover ordinary callable-thenable rejection, Errors before thenability, and atomic failure without persistent thenability state. They do not promise one getter read for an unstable object.
- Ordinary raw recognition classifies a safely observed throwing `then` access or invocation at the exact operation boundary. A previously admitted non-Promise identity keeps its fixed category and is not probed again even if external code later changes or poisons `then`; declaration recognition remains the separate contextless validation case.
- Delete tests whose only asserted feature is per-execution sampling, canonical settlement, Promise-subclass species isolation, self/mutual thenable-cycle detection, or compensation for repeated, inconsistent, non-FIFO, or single-consumer thenables. These are no longer supported semantics.
- Add compatibility tests for Cascada-style synchronous resolved values and the conforming rejecting protocol, including synchronous callback throws and pending-chain rejection. Record the existing `PoisonedValue` thrown-poison conversion as a migration difference rather than promising unchanged compatibility. Scheduler-only single-consumer tokens remain internal.
- A ready custom key followed by `pop()` of a never-settling element publishes the Array mutation immediately. Later lookup or mutation through the resolved prefix remains ready; the independent result creates no prefix gate, lease, or provisional external reservation.
- Synchronous custom import outcomes share the current segment's staging and identity state. Verify both segment transitions, `staging -> committed` and `staging -> abandoned`, and release of staging collections in either case. A later validation failure commits none of the segment's admissions, retentions, overlays, or tree leaves. Settle an earlier pending subscription after that failure and verify no later admission or publication and no unhandled rejection. Raw-Error occurrence-specific assertions belong to Phase 9D-A.
- Initial context-tree discovery skips every Promise or thenable source, including a ready custom one and a thenable root. Ordinary import still consumes those values, but no imported outcome adds a leaf. Direct locations retain complete finite-alias discovery and atomic commit; failed discovery commits neither graph facts nor leaves.
- Entry and mutation fixtures include custom delivery inside subscription, including FIFO delivery of earlier queued callbacks before the new callback. Verify fully initialized private state, exact version capture, enclosing COW writeback, and absence of stale publication after synchronous completion.
- Rejection observation accepts a pending custom thenable whose `then` delegates to a native Promise. Exercise synchronous observer completion, pending rejection, and detached owned reactions; no native-receiver TypeError or unnecessary observer chain remains.
- Run the complete suite with strict unhandled-rejection behavior and confirm every derived chain is returned, deliberately stored, or handled at its exact producer.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`error-handling.md`](error-handling.md), [`runtime-spec.md`](runtime-spec.md), data-declaration documentation, and Phase 13's Cascada migration inventory with this final contract.

---

## Phase 9C completion: Propagate fatal state at scheduling and publication boundaries

**Implemented.** All four deliverables below are complete. Preserve Phase 9C's first-fatal authority, execution-local reporting, bounded pending outward obligations, ordinary FIFO subscriptions, staged import, and local lifetimes.

Validation: **1,172 tests pass** on Node `v24.14.1` under strict unhandled-rejection handling, including the refcount-oracle and stress fixtures after the final defensive-complexity cleanup. An isolated process that omits `run`'s binding check fails its mismatch test; production source and test hooks are unchanged by that sensitivity check. Fatal construction/reporting also passes the `Error.prepareStackTrace` probe without invoking that hook.

### 1. Complete the common subscription boundary

[`thenValue`](../src/language-values.js) and ownership subscriptions share [`runSubscription`](../src/thenable-subscription.js). Supported FIFO delivery may run older callbacks whose original subscriptions returned pending. Their failure rejects their own chains; it need not escape the newer `then` call. The shared boundary propagates fatality at subscription exit and owns any returned chain discarded by that exceptional exit.

At the common subscription boundary:

- Retain the direct `then` result, check the subscribing operation context's `execution.fatalError`, and throw the exact stored fatal before returning that result. The same fatal precedence applies if the invocation itself throws after delivering older work: an ordinary invocation exception cannot replace or conceal the already-committed fatal.
- Preserve `continuationStarted` or its equivalent solely for exception origin. A throw from the newly supplied synchronous continuation escapes once; do not redeliver it through the rejection callback. A supported invocation failure before any callback remains recoverable while the execution is live. Returning poison or catching a raw host failure does not itself fail the execution.
- Do not set the execution's active-external-action Boolean during scheduling or supplied callbacks. Keep later fatal-observing continuations as check-and-return. The active subscribing stack must propagate fatality at its own boundary even when its callback did no work.
- Use this one boundary for import, Chain and context-root initialization, property continuations, invocation, export, queries, and the outward bridge. No constructor-specific patch, facade-wide final recheck, cached source state, new callback flag, or second subscription is required to detect the fatal.
- Include ordinary ownership subscriptions in the source audit. [`markPromiseHandled`](../src/thenable-subscription.js) has no-op callbacks, but invoking a supported custom `then` may still drain other registered work. Where that subscription can return to active semantic work, carry the existing operation context and apply the same subscription-exit rule; do not assume no-op callbacks make the invocation hook-free. Reuse the scheduling primitive if needed, keeping ownership handlers free of admission, contextualization, and recursive observation. Do not add a separate scheduler or broaden observation to unused host input.
- Preserve rejection ownership on exceptional exits. Review every affected producer of a returned chain and [`returnOperationResult`](../src/index.js): a chain or outward wrapper allocated before a subscription propagates fatality must not become an unhandled rejection merely because it can no longer be returned. Keep such handling at the producer, with the shared no-op ownership mechanism. The outward helper uses its native Promise executor to own bridge setup: an escaping failure submits through `failExecution` and rejects the outward Promise that is returned to the caller. It removes the current registration on an exceptional exit and creates no separate abandoned wrapper. Fatality before outward registration stops that registration; fatality during an already-registered bridge rejects and clears that obligation through the ordinary execution commit. Do not add a second fatal registry or settle internal gates to cover this case.

Add integration regressions to [`test/supported-thenables.test.js`](../test/supported-thenables.test.js), using its existing [`OrderedThenable`](../test/ordered-thenable.js) rather than a new runtime scheduling harness:

1. Obtain an existing `FatalError` by failing an explicitly constructed seed execution through `runInternalStep`. Create a separate live execution with a captured reporter and distinct operation contexts for the earlier and later subscriptions. They share that execution; the seed execution does not.
2. Start an unrelated public `runtime.import(new Promise(() => {}), operationContext)` and attach its rejection consumer immediately. It is the pending outward obligation that must reject without its input settling.
3. Subscribe a `Chain` to an unresolved `OrderedThenable`. Set `flushOnSubscribe = true`, then resolve the source with the existing fatal. Before yielding or awaiting, issue the next subscription through public import or construction. The source must drain the first subscription during this call.
4. Run import, `Chain`, and `ContextChain` construction as separate cases with fresh live fixtures. Each must throw the execution's exact authoritative fatal synchronously, retaining its original source and cause. Neither a successful `undefined` nor a constructed Chain is an acceptable result after this boundary has failed. Previously pending outward results must reject with that same fatal, the reporter must run exactly once, and no later graph publication or host effect may occur.
5. Include a conforming variant that drains the older queue but leaves the new subscription pending. This must not let a failed issuing operation proceed to fresh outward registration. Also cover an invocation throw after draining the older fatal, and a pending custom derived chain whose ownership or outward-bridge subscription drains queued work. These cases verify the boundary and exceptional ownership, not a particular private Set layout.

Do not require older queued callback failures to escape a newer subscription's `then` call; their own returned chains still reject normally. Test healthy queued delivery and synchronous continuation throws separately so the fix neither forbids valid FIFO behavior nor redelivers one outcome. Sharing a source with another execution must preserve that other execution's work unless it receives a fatal itself.

### 2. Preserve captured placement state at entry publication

[`enter`](../src/enter.js) transfers the complete captured private-root placement through the ordinary gate completion. Preserve presence, recovery, pending source dependencies, and captured publication authority. Pending normalized-property consumption uses [`requirePromiseVersion`](../src/property-versions.js); a runtime defect escaping valid work reaches the existing fatal-on-escape boundary without a fallback subscription or an entry-specific pending mechanism.

Verify through [`test/enter.test.js`](../test/enter.test.js) and [`test/placement-version-boundaries.test.js`](../test/placement-version-boundaries.test.js): a ready callback result can be delivered while valid private-root publication remains pending behind its ordinary gate, as specified in [`enter.md`](enter.md). Fatal callback throws or rejections abandon publication without settling gates, while the execution's outward fatal boundary rejects still-pending public results. Preserve unrelated pending captures and source settlement in live executions.

Direct corruption of private Chain state is excluded by the support boundary and receives no dedicated diagnostic or regression fixture. Do not join callback-result and publication lifetimes or add fatal-specific gate settlement.

### 3. Make execution-binding coverage independent per operation

[`test/execution-context.test.js`](../test/execution-context.test.js) verifies each Chain binding check independently from already-failed public entry. A mismatch case must reach that binding check while the destination execution is still live.

Use a parameterized fixture with a fresh live destination execution for every mismatch case. Recreate the source Chain and effect counters where needed to isolate the case. Cover `lookupPath`, `lookupPathForExpression`, export, both Error queries, both path mutations, `run`, and `enter`. For each case assert:

- the destination execution is live before issuance;
- the fatal identifies the Chain/execution binding mismatch and attributes it to the supplied operation context;
- the source execution remains live and its logical value is unchanged; and
- no graph traversal, destination admission or external-authority access, or host/entry callback happens before the mismatch is rejected. Retain the existing external-tree access sentinel and metadata/authority assertions where applicable.

Test already-failed public entry separately with a correctly bound Chain and operation context. It must throw the exact stored fatal before work. These tests prove different boundaries and cannot share the failed destination fixture. As a bounded sensitivity check, verify that omitting a required binding check in an isolated copy makes the affected mismatch case fail; do not retain mutation hooks or production introspection for this check.

### 4. Align the contracts and completion claims

Update the relevant paragraphs in [`AGENTS.md`](../AGENTS.md), [`error-handling.md`](error-handling.md), [`data-limitations.md`](data-limitations.md), and [`runtime-spec.md`](runtime-spec.md) in the same implementation change:

- Fatal checkpoints include supported subscription exit on both return and throw. Explain older queued delivery relative to its original subscription, and distinguish it from swallowing a throw from the currently supplied callback.
- Chain and context-root construction remain non-blocking and allocate no outward wrapper. Their initialization can invoke host reflection and subscriptions, so it uses those common checks; neither constructor is described as hook-free or exempt from subscription-exit propagation.
- The outward-registration proof relies on these actual effectful boundaries. JavaScript run-to-completion protects the intervening hook-free work, not execution of a supplied `then` method.
- Replace `runtime-spec.md`'s Chain-roots claim that an execution owns “Promise sampling” with execution-owned graph, property-version, and external identity state. Supported sources own subscriptions, settlement, and FIFO delivery. Align affected comments and test names; restore no thenability cache.
- Keep fatal state in private `Execution` fields and fatal commit/registration in trusted methods on that owner. The Error and facade layers call them directly; add no module-private state map, free-standing adapter exports, authorization token, or file-boundary indirection.
- Keep immediate missing-Promise version failure distinct from valid pending publication. A known runtime defect requires no scheduling slot or source settlement before it can fail the execution.

### 5. Remove defensive complexity for unsupported API misuse

**Implemented as the final Phase 9C simplification.** Keep the semantic checks that protect graph state, execution isolation, and native Promise transport, but do not add mechanisms solely for deliberate mutation of trusted runtime objects or malformed internal calls:

- Store the reporter, fatal slot, and pending outward rejectors in private `Execution` fields. Put their transitions on `Execution` itself and remove the parallel state `WeakMap` and free-standing commit/registration adapters.
- Recognize kernel Errors with `Error.isError` followed by ordinary `instanceof`. This avoids touching arbitrary non-Error Proxies while relying on the declared stable standard Error prototype contract. Freeze factory-created Error instances and compound child arrays, but do not freeze shared Error prototypes or shadow `then` solely to survive deliberate prototype modification.
- Trust the required operation context. A malformed root integration call throws an ordinary programming error and creates no contextless `FatalError`; a defect escaping work already enclosed by a valid operation context remains fatal through that enclosing guard. Retain Chain/execution mismatch and closed-entry checks because they protect real isolation and capability invariants.
- `managedStateClass` samples a supplied function's object prototype once and does not separately probe constructibility, because Cascada never invokes its constructor. Prototype validation walks only the native-`then` surface: a callable or accessor `then` is unsafe, while unrelated accessors are permitted and simply remain unavailable as Cascada methods. Selected-method lookup rejects an accessor without invoking it.

Delete tests whose only purpose was modified `Error.prototype`, hostile prototype replacement on an otherwise native Error, a callable non-constructor Proxy that fabricates an object prototype, or malformed-operation-context classification. Preserve ordinary native Error contextualization, reporter/fatal delivery, declaration atomicity through genuinely unsafe `then`, and selected-accessor rejection coverage.

### Preserve the remaining phase boundaries

The following mechanisms retain their semantic purpose: `continuationStarted` distinguishes exception origin; `receiverReached` and `pathSelectionComplete` identify dependency handoff, while mutation outcome records separate publication from an independently pending result; entry gates and read protection may precede even a synchronous callback. Operation-local aggregates and Boolean-search races are not execution-fatal races. Reporter return values remain uninspected and reporter-owned. Do not delete or normalize these mechanisms solely because another path returns a Promise.

Keep coordinated replacements with their existing implementation owners:

| Implementation responsibility | Owner |
| --- | --- |
| Recoverable index-publication safety and successful-result native `then` restrictions | Implemented by 9D-0 |
| Immutable native poison hierarchy, precise recognition, causal kinds, diagnostic-only causes, and complete semantic collection | Implemented by 9D-A; cause contract integrated in 9F/13 |
| Causal continuations, private exact-action external escapes, unified local closure, and contextless declaration handling | Implemented by 9D-A |
| Query-specific rejection wrapper and the integration-only package surface | 9D-B query normalization and public API completion |
| Inert external entries and external coordination; dynamic Promise-valued paths | 9E/9F and 10 |
| Import's existing segment processor and ordinary property-version commit | 11 preservation; no further processor rewrite is currently required |
| Atomic Promise-version to Promise-version terminology and lifecycle cleanup | 12 |
| Cascada's legacy Promise wrappers, scheduler, compiler operation contexts, diagnostics, and already-owned iterator finalization | 13 |

Causal source and kind live in the first required boundary continuation. The external-action producer preserves the post-external-action fatal check, and the common owner transition preserves live-execution releases.

### Acceptance and verification

- Keep the import/construction and entry-publication integration sequences above as regressions for immediate fatal propagation. Their current behavior is covered by the completed suite, including never-settling sources.
- Pass the new import/construction/ownership/bridge cases, the revised entry fixture, and the independent execution-binding matrix. Assert exact fatal identity, source/cause preservation, one report, prompt rejection behind never-settling inputs, no later semantic work, and strict rejection ownership.
- Retain native Promise behavior, ready custom fulfillment and recoverable rejection, synchronous callback throws exactly once, pending-chain rejection, FIFO across settlement, independent executions, staged import commit/abandonment, entry version capture, and COW publication. Existing tests cover these healthy invariants; add focused combinations where the boundary changes create a new risk.
- Run `npm test -- --reporter dot`, including its refcount-oracle fixtures and stress cases, with strict unhandled-rejection handling. Recheck fatal construction/reporting remains hook-free with respect to `Error.prepareStackTrace`; do not inspect cause stacks to implement these checks.
- Audit changed subscription producers, derived chains, and the outward bridge. Verify direct removal/clearing of current pending rejectors by source inspection and observable settlement behavior; expose no private rejection Set, test-only owner registry, or global quiescence counter.
- All four deliverables pass. The recoverable kernel work is implemented in 9D-0/9D-A; the expression boundary is implemented in 9D-B and Cascada integration remains assigned to 13.

---

## Phase 9D-0: Preserve valid state after recovery and safe successful outputs

**Implemented.** Atomic index publication and successful-result native `then` validation are complete, with refcount-oracle and stress coverage.

### Outcome

Recoverable failure leaves every retained refcount index valid. Successful values have the same semantics through ready and pending native Promise transport. These invariants support the expanded recoverability in 9D-A without changing Phase 9C's fatal lane, ordinary continuation mechanism, or operation lifetimes.

### 1. Make index construction safe to abandon

- Index presence means a complete valid index, never an in-progress marker. Downward closure includes every traversable child reached through a bookkeeping cut. Assignment, query, imported fulfillment, COW, and indexed replacement use the same `buildRefIndex` and `prepareLiveEdge` publication invariant.
- Prepare new indexes, cuts, and reverse-edge additions in one operation-local staging map. Discover logical placements, count their captured graph with DFS back-edge cuts, then publish the complete region in one synchronous hook-free commit. Reuse already-complete indexes, including any completed independently by required shared settlement during discovery. There is no separate cut-target queue, partial descendant publication, or persistent construction state.
- Complete fallible reflection and logical-value preparation before installing new persistent index facts. Stage reverse-edge additions to existing indexes too; abandoning a failed build leaves their parent multiplicities and counters valid. A descendant cannot be published while its cut still reaches an unfinished ancestor.
- Capture exact placement versions. Later synchronous subscriptions may advance an earlier captured Promise version; discover that newly available graph before counting, repeating only while available work advances the captured frontier. Reuse ordinary normalization and shared property publication; those are valid independent transitions and are not rolled back. Do not reread physical slots, resubscribe, add callback-ran flags, or defer a ready commit to a microtask.
- Preserve each caller's normal failure effect and causal kind. A supported reflection failure recovered by assignment or publication remains recoverable; a bookkeeping defect remains fatal. Query-operation reflection classification moves to 9D-A. Do not make all reflection fatal, copy the whole graph, add a transaction/rollback manager, or clear existing indexes after failure. Import's staged admission and refcount staging protect their respective facts.

### 2. Close the successful-result assimilation gap

- An exact Function or external identity used as a successful non-Promise language value must have a stable native `then` lookup that safely yields a non-callable value from first use onward. Read-only-after-admission alone does not establish this initial condition. Function and Error classification still precede availability recognition; a Function is never consumed as a Promise merely because it has callable `then`. Unsafe exact values are outside this host contract, without a thenability cache, facade wrapper, or recurring arbitrary reflection probe.
- Classification precedence and supported output are distinct requirements. Recognizing an Error or Function without sampling a hostile `then` does not promise that every such Function can be successfully returned through native Promise transport. Errors retain their separate Error semantics.
- The complete managed receiver validation walk checks native `then` lookup on each managed receiver identity before successful mutation publication, including newly created descendants and previously admitted managed identities. Inspect own descriptors and the actual prototype chain through the exact supported reflection boundary; callable data properties and accessors produce `InvalidManagedReceiver` without invoking accessors. This includes non-enumerable own properties, Array non-index properties, and inherited descriptors. Preserve declaration and method-selection validation of managed prototypes. Prior admission is not proof that host mutation preserved safe lookup.
- Use this same check to reject unadmitted stored thenables without consuming them. Known managed identities with unsafe `then` still contribute Errors from their other graph placements. A validation failure uses the existing receiver-failure effect. No separate Promise-validation branch or per-placement callable-`then` branch remains in receiver validation.
- Ready assignment and Promise-backed publication keep their existing `PropertyValidation` rule for an ordinary callable `then` placement. A non-callable data `then` stays ordinary data. The native lookup check does not expand graph traversal to non-enumerables or Array non-index properties, or copy hidden fields into managed output.
- Managed result admission, external observation, export, and public result completion preserve these source invariants and exact-value contracts. Complete receiver preparation, COW isolation, transition gates, and immediate publication when only an independent result remains pending retain their existing semantics. Phase 9F-A applies this rule to its new external routes and Phase 13 to host-facing render routes.

### Verification and implementation

- `test/index-recovery.test.js` retains both identities in `a.b = b; b.back = a`, then makes a later sibling's reflection fail while assigning into an indexed destination. Ready/deferred assignment, imported fulfillment, and indexed replacement preserve the causal mutation Error and leave the execution live. The tests query and mutate retained aliases afterward, check existing reverse-parent edges, and run the refcount oracle without requiring canonical cuts or counter totals.
- The same file exercises ready and deferred query-triggered index abandonment, captured versions advanced during later synchronous subscription with and without an existing index, and an adjacent internal parent-DAG corruption that remains fatal. Query-reflection tests assert recoverable `QueryReflectionFailed` under 9D-A; abandoned index publication leaves retained state valid.
- `test/managed-invocation.test.js` covers ready and pending mutation completion after installing hidden callable data, accessors, Array non-index properties, nested and newly created unsafe descendants, and inherited callable/accessor `then`. It verifies no accessor invocation, the receiver-poisoning effect, exact cause on descriptor reflection failure, retention of other receiver Errors, and accepted hidden non-callable data omitted from graph export.
- `test/export.test.js` verifies exact Function and observation-only external identity preservation through ready and pending lookup, selected-value export, and graph export. The hostile exact-Function review probe documents unsupported host behavior, rather than a promised runtime diagnostic.
- `src/refcounts.js` owns staged index construction and `src/managed-invocation.js` owns native lookup validation. The invariants are recorded in `AGENTS.md`, `error-handling.md`, `data-limitations.md`, `runtime-spec.md`, `counters-implementation.md`, `managed-invocation.md`, and `outbound-export.md`.
- Validation: `npm test -- --reporter dot` passes under strict unhandled-rejection behavior. Preserve Phase 9C's completed status and ordinary continuation architecture.

---

## Phase 9D-A: Establish causal recoverable Error handling

**Status: Implemented.** Verification includes native-equivalence, refcount-oracle, causal-attribution, query-recovery, integration-route, complete preparation and collection, fixed-version receiver materialization and ArrayView retention, failed storage mutation with surviving aliases under the managed-storage contract, and complete target/gate/ancestor publication outcomes. Phase 9D-B preserves these regressions through the expression boundary. Shared poison prototypes remain ordinary and are not frozen as a misuse defense.

Implementation ownership: `error.js` supplies Error factories, precise native recognition, and the single external-escape mechanism; `operation-lifecycle.js` supplies only local owner closure and releases; `language-values.js` supplies thenable subscription, ready admission, and type facts; `internal-step.js` supplies immediate and deferred guarded operation work, initial causal consumption, complete input collection, and clean-input preparation. Array semantic steps consume exact external escapes inside their guarded continuations; query outcomes settle through one finish transition. Property versions and staged import retain source attribution without sideband origin state. `export.js` uses one visited set and Error accumulator for the whole batch. The [integration tests](../test/causal-failures.test.js) reuse those implementations; They consume the public API.

### Problem

Recoverable failure must retain its causal operation, preserve complete Error membership, and leave valid graph state usable. Boundary recovery must distinguish exact supported host failure from adjacent runtime defects while preserving synchronous progress, FIFO subscriptions, and execution-owned fatal delivery.

### Outcome

Implement causal recoverable Error handling from [`error-handling.md`](error-handling.md). The exact causal boundary supplies a recoverable failure's source and kind; later consumers preserve it. Preserve the addendum's ordinary supported-thenable subscriptions and causal placement/import behavior through Phase 9D-B's expression boundary. Keep synchronous same-execution external-code re-entry forbidden without coupling another execution. Every internal failure continues through Phase 9C's fatal lane.

This phase uses two recurring terms:

- A **causal boundary** is the exact supported action allowed to convert its raw failure into recoverable poison.
- A **causal introduction** is one boundary contextualization of a raw failure. Later retention and propagation preserve that wrapper; a separate execution of a causal boundary may create another wrapper.

Collection represents unique semantic failures by raw cause, opaque source-context identity, and kind; it is not an event log. Repeated execution of one prepared source handle with the same cause and kind deliberately merges in collection, even when separate calls created separate wrappers. The source identifies the causal source position or explicitly derived diagnostic route, not a mandatory dynamic invocation ID. Do not add an occurrence counter or allocate a fresh source handle on every loop iteration to defeat this equivalence.

Boundary and consumer are roles of actions, not modules. One import, lookup, export, or invocation may consume an existing Error in one step and cause a new failure at another causal boundary.

Missing diagnostic information never makes an application failure fatal. Catch script/language failures and supported external-action failures at their causal boundaries and produce poison with the boundary's ordinary result or mutation effect. The host may throw an unfamiliar Error or arbitrary supported reason; "expected failure" means that this action is allowed to fail, not that Cascada predicted the particular exception. Fatal classification is reserved for runtime defects, broken invariants, or host behavior that has made safe continuation untrustworthy, rather than inability to supply a file, line, or other diagnostic detail.

Use **operation context** for the required `{ execution, errorContext }` carrier, **source-error context** for its opaque diagnostic source, and **host configuration outside execution** for setup APIs:

- **Unavailable source location:** the runtime still knows the operation and execution. Supply the ordinary operation context with a diagnostic handle identifying the boundary and an unknown location where necessary. The application failure is poison. Do not make diagnostic completeness a prerequisite for recovery or add a second execution-selection path.
- **A setup API called outside any execution:** there is no Chain placement to poison yet. Expected declaration/configuration validation returns its ordinary Error value without changing configuration. If that value is passed into a Chain or returned by a host call during execution, the existing admission/call boundary contextualizes it as poison. No execution or `FatalError` is manufactured for setup validation.
- **Required operation context:** every execution-bound Chain initialization, operation, continuation, and participating helper receives its operation context as trusted compiler/runtime control state. A malformed root integration call produces an ordinary JavaScript programming error while accessing its required execution; it creates no contextless fatal diagnostic, fallback execution, or reporting path. If the defect escapes work already enclosed by a valid operation context, that enclosing fatal guard submits it normally. Chain binding remains execution-specific; each operation supplies its own operation context rather than falling back to the Chain's initialization source. Section 2 retains the isolation and closed-entry checks and the ordinary fatal-on-escape behavior without a malformed-control test matrix.

Cascada's successful values and effects remain deterministic under sequential equivalence. **No required Error may be lost: complete Error collection is also part of determinism.** Error handling uses only the exceptions enumerated in [`data-limitations.md`](data-limitations.md#allowed-nondeterminism-in-error-handling), including unspecified Error ordering and timing-dependent detection of invalid mutable-external sharing across independent context imports. These exceptions grant no permission to omit required failures or make collection membership depend on which input settles first. Source identity and Error presentation do not impose a new execution order. Add no nondeterminism to successful work.

### 1. Install final recoverable Error attribution

**Source attribution** identifies the Cascada code responsible for the failing operation: its source path, line, column, and operation identity, carried by the operation context's opaque source-error context. Every command, helper, Chain initialization, and continuation created to perform that operation carries its operation context for as long as its work can produce a failure. A helper's JavaScript implementation location, the point where a Promise settles, and a later consumer's source do not replace that source. A managed observation whose host method throws or returns a rejecting Promise therefore attributes the new failure to the Cascada observation call that invoked the method. A host stack may supplement this information with the native throw site.

The **raw failure payload** is the native Error or other value that was returned, thrown, fulfilled, or rejected. The final kernel Error retains both complete diagnostic inputs: its `errorContext` preserves all Cascada source/diagnostic facts supplied by the operation context, including any captured async route, and its `.cause` preserves the original native cause, including that object's message, stack, custom diagnostic fields, and nested cause chain. These are complementary records. Do not replace the native cause with a message-only Error or discard Cascada diagnostic fields during normalization. Execution authority and mutable operation state are not source diagnostics and remain outside the Error.

Retaining the exact native cause does not require eagerly reading its stack, copying its fields onto the kernel wrapper, or traversing its nested causes. Native fields never overwrite Cascada source attribution, and a bounded diagnostic view does not replace or truncate either retained diagnostic input. The payload-containment requirements below concern object access through `.cause`, not selection of the source line or removal of native diagnostic information.

Use these concrete native-Error branches:

~~~text
Error
|- PoisonError
|  `- CompoundPoisonError
`- FatalError
~~~

- `PoisonError` is recoverable language data and a direct native Error. Phase 9D-B preserves its non-thenable graph representation and adds a separate expression failure container.
- `CompoundPoisonError` extends `PoisonError` and contains flattened poison leaves. Both poison classes are native Errors; only `PoisonError` directly extends native `Error`.
- Phase 9C's `FatalError` remains the separate fatal branch and is never admitted, combined, queried, repaired, or returned as language data.
- Complete the hierarchy once: remove transitional runtime `CascadaError` and its public export, make `PoisonError` extend native `Error` directly, and keep Phase 9C's direct `FatalError`. Semantic classification checks the recoverable and fatal branches directly.

Create kernel Errors through the shared factories in `error.js`. Semantic recognition first establishes native Error identity with `Error.isError`, avoiding prototype traversal for arbitrary non-Error Proxies, and then uses ordinary `instanceof` inheritance. Standard Error constructors and prototype chains must remain unmodified. The runtime is a programming API, not a security boundary: add no construction token, instance registry, exact-prototype comparison, frozen shared prototype, own `then`, or validation solely to reject deliberate construction, subclassing, prototype replacement, or prototype mutation. Internal factories trust their compiler/runtime-supplied kind and source. Each factory installs all concrete-subclass fields before freezing the complete wrapper; compound child arrays are copied and frozen first, and `errorContext` is an immutable opaque handle or value. The Error classes remain non-thenable; Phase 9D-B supplies a separate expression container. Do not copy methods onto instances or add recurring prototype-integrity checks. The exact cause identity remains diagnostic-only and outside graph traversal; later mutation of that external cause cannot replace the wrapper's cause reference or change its stored message, source, or classification. Do not copy arbitrary enumerable cause properties or eagerly read a cause stack into the wrapper. The protected diagnostic adapter may inspect the exact cause later.

Name the trusted causal factory `createPoisonError(reason, operationContext, kind)`: it submits an existing `FatalError`, preserves existing poison, and otherwise creates one causal occurrence. `combineErrors` remains the trusted compound factory. Phase 9D-B exposes both through the documented public API and removes the existing integration-only package subpath. This is package-composition trust, not a security boundary, so add no caller capability or duplicate higher-runtime constructor.

Error outputs must preserve owner isolation, immutable Chain outputs, and external-capability containment. This requirement covers diagnostic references exposed to external code, including `.cause`, as well as ordinary returned graph data. The choice of storage or wrapper mechanism must preserve that guarantee.

The concrete failure is a managed observation that executes `throw this`. Its public poison can expose the actual managed receiver as `failure.cause`; assigning `failure.cause.n = 9` then changes the value read through the Chain. A normal native Error can expose the same reference through `new Error(message, { cause: this })` or another diagnostic field. Freezing the poison only fixes its own properties; it does not detach the object reached through `.cause`. A separate safe `#` view does not protect native code receiving the poison directly.

The failure-payload policy in this plan preserves exact public cause identity by requiring diagnostic-only host payloads: raw returned Errors, throw/rejection reasons, and references reachable from them must not retain an unexported managed source or a mutation-capable external identity. This is an explicit restriction on supported host failure payloads, not a consequence of wrapper freezing or merely a cleanup implementation detail. Primitive reasons and compliant native Errors retain their exact causes. If arbitrary payloads containing protected identities must be supported, the public cause boundary must change so it cannot expose those identities directly; exact unrestricted public causes and source protection cannot both be assumed.

Document this as a host contract in `data-limitations.md` and the host-call API, not a promise of deep runtime enforcement. Audit runtime-created validation reasons and diagnostic payloads so the runtime itself never embeds a protected receiver, argument, or capability. Construct fixed messages and safe primitive facts instead. Do not walk arbitrary causes, invoke getters, export/copy a thrown receiver, or add a cause registry merely to enforce this restriction. Preserve hook-free contextualization and cause/context/kind deduplication. If unrestricted arbitrary object throws are required later, hiding raw causes behind a trusted diagnostic interface is a separate API revision; it is not part of this cutover. Phase 9F-A applies the restriction to exact external receivers, and Phase 13 applies it to higher-runtime host boundaries.

Settle the kernel Error surface in this phase, before instances are frozen. Kernel Errors expose `name`, unformatted `message`, opaque `errorContext`, optional exact `cause`, `kind` on poison, and `.errors` only on `CompoundPoisonError`. They do not expose Cascada's legacy `_errorContext`, expanded `context`, `fullMessage`, `totalErrorCount`, `kinds`, `getInfo`, line, column, path, or label fields. Phase 13 must provide source formatting and compatibility presentation, if desired by an application, as a separate immutable diagnostic view; it never decorates the frozen kernel Error. This is a deliberate API cutover, not a deferred decision.

Recognize every native Error form before sampling `then`. Use precise `isPoisonError`, `isFatalError`, and native `Error.isError`; remove semantic `isError`, which conflates unclassified native Errors with admitted poison. Guard thenability with native Error recognition: a native Error remains an Error even when it has a callable or throwing `then`, which is never read. Declaration APIs likewise preserve an Error before probing thenability. Both packages target Node `>=24`, and supported browsers must provide native `Error.isError`, so 9D-A uses and tests the exact native predicate without an approximation. Phase 13 applies and verifies that settled platform contract in Cascada.

Every poison call site supplies a `kind` from the authoritative table in `error-handling.md` and an operation source. Export one frozen `ERROR_KIND` vocabulary:

- Implement exactly the complete table in `error-handling.md`; implementation-only kinds are invalid.
- Rename transport-specific pairs to `ChainValueFailed`, `ContextValueFailed`, `AssignmentValueFailed`, and `OperationInputFailed`, and rename one-to-one `...Threw` kinds to their action-based `...Failed` replacements.
- Use `InvalidCallbackResult` for every unsupported controlled-callback result, including a Promise where a synchronous result is required.
- Treat `UserCallThrew` as a semantic split, never a rename or compatibility alias: audit every former call site and use `InvocationFailed` for the selected external Function or method and its direct result boundary, or `ControlledCallbackFailed` for a callback or comparator owned by a controlled operation. Distinguish forbidden mutation-capability export (`ExternalCapabilityEscape`, implemented in Phase 9F-A) from export reflection failure (`ExportReflectionFailed`).
- Use PascalCase keys equal to their string values. Audit trusted construction and forwarding paths when they change, and verify their outcomes without adding runtime membership checks. `Multiple` is only the compound meta-kind; no empty, arbitrary, or generic fallback is valid.
- A kind names the violated semantic contract, while the opaque source identifies its causal source. Preserve a distinction when contract, graph/result effect, recovery meaning, or materially useful diagnosis differs; collapse transport or implementation-mechanism splits when those facts are the same. Do not merge import, lookup, query, and export reflection merely because reflection was their physical mechanism.
- Messages remain separate from kind and source.

Arrival mode is not structured Error data. Preserve the exact cause, but never record or infer whether it arrived by return, throw, fulfillment, or rejection. Equivalent ready and pending failures use the same kind and graph effect.

Contextualize a native host Error once per causal boundary:

- Wrap it in a new `PoisonError` with the exact native Error as `cause`.
- Invoke no host hook while contextualizing: use fixed text or safely read own primitive diagnostic data, and never coerce the Error, inspect arbitrary properties, sample `then`, or require its stack. Copy no cause properties onto the wrapper.
- Preserve an existing poison unchanged. Submit an existing `FatalError` unchanged to the current execution and propagate its authoritative fatal Error.
- Separate introductions may create equivalent immutable wrappers. Reuse through an existing walk map is optional; do not retain an Error map across segments or intern wrappers per execution/runtime. Collection compares raw cause, opaque source-context identity, and kind. Existing contextualized Errors propagate by exact reference.
- A root import returns its contextual wrapper. A nested import leaves host storage unchanged and stores the contextual wrapper in the parent-key placement's fixed logical version. Physical alias identity between separately constructed wrappers is not required.
- Store no wrapper on the native Error identity and keep no execution-wide Error-keyed cache.

`combineErrors` accepts only contextualized poison and no execution or context:

1. Require at least one input; zero is a fatal invariant failure. Return a sole input unchanged.
2. Expand direct compounds to their already-flat child arrays. The compound factory establishes this invariant, so do not recurse.
3. Accept unspecified Error order; do not sort semantic children or allocate ordered branch summaries.
4. Deduplicate by raw cause, source-context identity, and kind using collection-local state. Share this rule with `getErrors`. Different contexts or kinds remain distinct. A leaf without a cause uses its own identity for that component; explicit `cause: undefined` or `cause: null` is a present cause, so do not use nullish coalescing to choose the fallback. Compare primitive causes by ordinary Map equality without coercion, including its `NaN` and signed-zero behavior. Execution identity is not an additional key: the same cause, source handle, and kind remain equivalent if imported across executions. Ordinary render-local source handles are already distinct.
5. Reuse an input that represents the complete union; otherwise return the sole retained leaf or construct `CompoundPoisonError` from several leaves.

`getErrors` delegates combination to the `combineErrors` factory and its one-level `flattenAndDeduplicateErrors` normalization; no compound consumer needs recursive flattening. Reusing a complete input preserves its source, message, children, and identity. Only when a new compound is needed does the factory pass the finalized leaf array to the trusted constructor and use the caller-supplied message to name the failed boundary. The constructor freezes that array; the factory freezes the complete compound. The resulting leaf-only `.errors` exposes a representative of every semantic Error. A retained leaf supplies representative context without claiming to be the primary or earliest failure. Its `.kind` is the leaves' sole common kind or `ERROR_KIND.Multiple`. Distinct kinds are a diagnostic projection, not stored `.kinds` state. Presentation may sort a separate view without changing the created Error.

Complete collectors may accumulate arrivals and use identity visited sets; they need no ordered child summaries or extra alias/cycle ordering pass solely for Errors. Keep required collection complete and use one local semantic-deduplication helper in export, `getErrors`, managed preparation, and compound construction. Successful root/input positions, FIFO captures, and effect ordering are unchanged. `hasError` retains its first-proof short circuit. The allowed nondeterminism is exhaustively bounded by `data-limitations.md`: Error array order/representatives, competing fatal detection and outward settlement, short-circuit Error-query outcomes, and detection of invalid competing external bindings. Do not extend these exceptions to successful data or effects.

### 2. Classify only at causal boundaries

Every boundary uses this funnel:

~~~text
existing FatalError        -> submit unchanged; propagate the execution's authoritative fatal Error
existing poison              -> preserve unchanged
native Error consumed as data -> contextualize this introduction
expected supported-external-action failure -> create PoisonError here
other raw failure            -> create FatalError and fail the execution
successful value             -> continue
~~~

Required property publication retains a previously contextualized Error when preflight, index preparation, or mutation writeback also fails. Optional synchronization of an already committed Promise slot retains its settled logical value when storage refuses the write or its preflight; it introduces no new Error or recovery baseline. Apply the same rule to synchronous thenable normalization, with a fixed overlay when necessary. Keep actual mutation publication on the required placement-transfer path. Required validation, indexing, and structural work still report failures, and fatality always propagates. Every recoverable retry combines the current diagnostic with the new failure through ordinary semantic deduplication before admission and Promise version publication; it never replaces the earlier cause. Keep one operation-local current value and the existing staged edge commit, with no failure-history registry or graph rescan.

A controlled Array mutation can capture an independent removed-value Error before receiver replay fails. Publish the receiver replay failure through the ordinary mutation outcome, and combine it with the independent result Error for the operation result. A pending independent result may delay that result but never receiver publication or release of receiver protection. Do not traverse nested removed-result payload to look for additional Errors.

An independent result-import failure and a receiver-validation failure are separate required completion outcomes. If both fail, publish the receiver-validation poison at the receiver and combine both failures in the operation result with their original attribution. Result-import failure alone preserves valid receiver mutation. Combine only failures already discovered by these required steps; do not traverse unrelated nested result Promises.

A direct language-result Error always means its boundary failed; it is not a successful language payload. A native Error is contextualized once and an existing poison is preserved. A mutating call applies the same receiver-failure effect whether the Error is returned, fulfilled, thrown, or rejected. An Error reached later through an independent nested result remains independent. Host protocol intermediates are different: reading a non-callable native Error from `object.then` is a successful availability probe, whereas a getter throwing that same Error failed. Keep the protocol's semantic selection inside the exact external action (for example, read the candidate and return it only if callable), then classify its outcome. Do not classify every raw reflection return as a language result or box protocol intermediates in a general result algebra. An existing `FatalError` physically encountered by the protocol still enters the authoritative fatal lane before an ordinary indeterminate/non-callable fallback.

Apply this classification before success handling regardless of JavaScript transport. A non-thenable `FatalError` may physically arrive as a ready return, Promise fulfillment, throw, rejection, or nested imported value; submit it to the current execution unchanged and never admit it as language data.

Make the common post-boundary ready-admission choke point enforce the resulting invariant: an Error reaching ordinary graph admission is already poison. Submit `FatalError` through the fatal lane, and treat any remaining raw native Error as a fatal missed-boundary defect rather than admitting it as generic Error metadata. Boundary-specific import walking may inspect a raw Error only long enough to create its occurrence wrapper before entering this choke point. Test ready, fulfilled, nested, imported, assigned, and host-result routes so no inbound path can bypass contextualization.

Use one private identity-branded external-escape marker, created only around an exact supported external action by `runExternalAction`. That producer owns the selected execution's active-action Boolean and the post-external-action fatal checkpoint. It saves and restores the Boolean around only the synchronous call; add no runtime-wide depth. `catchExternalThrow` at the causal operation consumes only this marker and supplies the fixed operation context and kind. It performs contextualization and the operation-specific failure effect outside its catch; adjacent unmarked runtime failures remain fatal. The marker is neither language data, an Error kind, nor an integration export.

Shared enumeration, descriptor, numeric, and placement helpers keep ordinary return contracts. Returning poison from the key-reflection primitive would require a propagation branch before filtering/iteration and at every intervening indexing/export caller; graph-poison data also differs from a query's own reflection failure. The one private escape carrier preserves both distinctions without mutable policy on contexts or parallel direct-recovery paths. Query/index/export tests pair host traps with adjacent internal defects and verify retained cyclic indexes and non-callable native Error-valued `then` probes.

`runExternalBoundary(operationContext, kind, action)` is the trusted three-argument composition of that same producer and consumer. The action's return or throw is checked against authoritative fatal state before normal outcome classification. A ready language-result Error is contextualized, and the caller applies its result or graph effect outside recovery. Protocol intermediates select their meaningful result inside the exact action. The helper owns no preparation, export, import, publication, bookkeeping, or cleanup and exposes no failure callback or policy mode.

Each initial or resumed semantic step consumes its exact host-failure markers before returning to the common fatal envelope. An issuance-level catch cannot recover a marker that has already crossed a nested fatal guard. Controlled Array work classifies supported reflection/storage failures inside those steps as `PropertyMutationFailed` for mutation and `InvocationFailed` for observation; explicit invalid or unsupported controlled modes/results retain `InvalidArrayOperation`; logical scalar conversion owns `ScalarConversionFailed`, including nested Array element reflection. Complete all selected preparation inputs after a ready or pending failure, preserving sparse positions and the same Error membership under either delivery.

Complete collectors separate candidate-key discovery from individual descriptor inspection. Capture placement presence before consuming values, but recover an unreadable descriptor locally so it cannot hide other known keys. A key-list reflection failure ends only the undiscoverable interior. Use the same candidate discovery beneath ordinary enumeration; its callers retain their own complete-collection, query-failure, or atomic-import semantics. Logical Arrays keep numeric key order, and bounded ArrayViews inspect only their selected range without allocating keys for every hole. No catch-policy flag or configurable graph walker is required. Receiver validation records exact reflection failures in its existing accumulator, keeps earlier Errors, and continues accessible sibling placements; unknown identities that cannot pass native-then inspection remain unadmitted.

Array preparation for `flat`, `sort`, and `toSorted` captures sparse placement inputs through the common candidate-key discovery, retaining an unreadable placement as its own failure input and continuing other known keys. Keep these preparation inputs separate from structural remaps, which preserve payload and retain ordinary capture semantics. Flat propagates capture failures while continuing every branch required by its depth; depth zero does not inspect nested values. Sorting joins resolved records and capture failures without an early success-only preparation step, then carries every failure through required default-key conversion or comparator export. A failed candidate cannot prove that fewer than two sortable values exist; the no-conversion fast path applies only when that is established. Invoke no comparator after preparation failure. Capture presence before subscribing to values, preserve holes and ArrayView bounds, and iterate captured sparse keys rather than scanning logical length.

Captured Array intrinsics run trusted algorithms over runtime-owned remaps. Predictable `with` index and growth-length errors are validated before the intrinsic; remap capture wraps only exact host reflection, so internal defects cannot become recoverable Array failures. Application comparators use `ControlledCallbackFailed`; unsupported callback output uses `InvalidCallbackResult`. The selected callback boundary owns a returned Promise's rejection. Scalar conversion uses its own narrow `ScalarConversionFailed` action.

Do not force conservative probes through recoverable classification. Complete the two explicit probe paths while removing the generic `catchRawUserCodeFailure` interface:

- Execution-bound admission classification catches only its exact structural reflection probe. An ordinary host-reflection failure yields the existing `{ type: external }` fallback rather than poison. After either return or throw, a newly committed `execution.fatalError` wins; an existing `FatalError` is submitted normally. Pass the operation context required for that check instead of retaining a context-free admission-classification path.
- Contextless declaration thenability recognition preserves an Error first and directly rejects a reached callable thenable. Inability to inspect an unsupported identity returns an ordinary declaration-validation Error and atomically records no declarations. Configuration may run while an execution is inside external code because it touches no execution activity state; deliberately recursive configuration through its own reflection is unsupported and receives no guard. An unexpected implementation exception escapes synchronously, while an existing `FatalError` is thrown unchanged; declaration code constructs no fatal outcome. Alias deduplication belongs only to the declaration identity walk, not to a thenability cache. The probe creates no fake rejecting thenable, Promise, poison, kind, operation context, or persistent thenability state.

Require an operation context on successful, failing, immediate-return, and deferred routes alike as trusted compiler/runtime protocol. Ordinary helpers depend on that invariant and add no defensive shape validation or malformed-control test matrix. A malformed root integration call throws the ordinary JavaScript programming error produced while accessing its required execution; it constructs no contextless fatal outcome, selects no fallback execution, and reports nowhere. If such a defect escapes work already running under a valid operation context, that enclosing `runWithFatalGuard` submits it normally. Keep Chain/execution mismatch and closed-entered-Chain checks at their existing meaningful boundaries because they protect actual isolation and capability lifetime.

Fatal fixtures use explicit executions. Preserve valid operation contexts through ordinary helper signatures and compiler integration tests rather than checking malformed calls repeatedly at runtime. Initial entry reads and throws an existing fatal; continuation dispatch skips work after execution failure or local-owner closure. Both call the same internal `runWithFatalGuard` body after those checks. Keep that body outside the integration exports and give it no routing fallback, repeated entry checks, or lifecycle policy.

Document these requirements in the trusted-control principle and Operation Context section of `AGENTS.md`, and the integration, fatal-construction, and verification sections of `error-handling.md`.

These probes share only the principle that inability to establish a fact has a statically specified conservative result. Their result shapes and execution invariants differ, so keep the exact catch with each probe. Do not add `tryHostAction`, a result algebra, callback, fallback mode, or optional-context overload to generalize them. Audit any other `catchRawUserCodeFailure` caller: move an observable supported-external-action failure to `runExternalBoundary`, but retain an explicitly specified conservative probe as a local catch.

Audit every existing `throw` site as well as every `catch` and rejection handler that classifies or recovers from failure. A raw internal throw must be assigned to the exact envelope that receives it and classified against the same rule; do not assume that existing `throw new Error(...)` means fatal merely because no catch currently narrows it. Expectedness belongs to the transition contract, not the Error class. The one common continuation helper handles only execution and local lifetime; each transition body handles its Error semantics explicitly. Do not create parallel language/fatal continuation frameworks or one configurable policy helper. Each surviving catch has exactly one of these roles:

1. The chosen external-boundary mechanism catches the exact supported synchronous external action and performs the one fatal check at action exit. Direct classification or the single branded escape consumer preserves/contextualizes its reason; the causal caller applies the graph effect outside recovery. A marker consumer catches no unbranded internal failure.
2. A language-outcome transition body preserves an expected ready or rejected poison and performs publication, complete collection, or operation-result handling.
3. A fatal-on-escape envelope submits an existing `FatalError` unchanged or makes every other escaping value, including poison, the cause of a new fatal Error.
4. After fatal state commits, the reporter catch preserves it. Local release uses ordinary `try`/`finally` only to clear live-operation state; a release failure escapes to the fatal-on-escape envelope rather than being swallowed or reclassified.
5. An explicitly specified conservative probe catch returns only that probe's indeterminate or validation outcome. It creates no poison and never hides an existing or newly committed execution fatality.

`continueOperation` is the sole guarded semantic subscription entry. `consumeValue` handles first admission and causal rejection, property-version advancement reads an already-published logical value, and `collectInputs` completes independent input collection with poison stored outside readiness Promises. These are one operation-work family in `internal-step.js`, not lifecycle policy variants. `operation-lifecycle.js` contains only the owner/close/release protocol. `prepareInputs` composes the same collector: join every required outcome, combine poison once, and run the success continuation only with clean inputs. Structural payload and mutation-tuple joins keep their individual values through `collectInputs`; no policy flag or second subscription engine is needed. Every owner close entry delegates to the same idempotent transition, which closes operation-specific resources and registered releases once and immediately balances late release registration. A result-completion continuation may perform final Error/result handling and close its operation; do not attach a detached cleanup observer or thread cleanup callbacks through every category solely to avoid this common completion.

Implement one complete, idempotent operation-close transition: mark the operation closed once, release its operation-specific resources, and drain callbacks registered by `releaseOnClose` through the same `try`/`finally` path. The semantic step that determines the live operation's final outcome calls that transition before returning; a late release registration is immediately balanced. These resource and late-work invariants are required. Whether the implementation is a shared function, an owner method, or a method delegating to the shared function is an internal choice with no language/API significance. Reuse the existing owner state and choose the simplest design; do not add a wrapper object or rewrite working cleanup solely to impose one method location. Eliminate any call path that can close the owner while bypassing its registered releases, and remove duplicated open-state mutation where consolidating it simplifies the implementation. No settlement observer is needed solely to close the operation. Keep local closure separate from execution fatality: the common resumption checks fatal state before local open state, and fatal delivery performs no owner sweep.

Remove or narrow every classification catch outside these roles. Expected synchronous language Errors normally return as values. An exact adapter may deliberately throw poison only where a native API requires throwing to abort, and its owner catches that escape before the fatal-on-escape envelope. A rejection handler used only for Promise ownership does not classify failure. Do not add a Boolean "poison allowed" flag or a second continuation family.

For each trusted callback, document whether its result admits a language Error. If it does, direct poison and direct-Promise poison rejection are the same recoverable outcome; if it does not, poison throw or rejection is fatal. In particular, update `enter`: a synchronous throw from its trusted callback remains fatal, while a returned poison and poison rejection from a callback result whose contract admits language Error follow the same entry completion/publication behavior. JavaScript cannot infer whether a poison rejection in such an admitted channel was intentional, so do not add a sideband intent marker solely for that distinction.

Invalid host output is recoverable when the boundary can reject it without compromising runtime invariants, such as an unsupported callback result or invalid completed managed receiver. If managed-class member selection reaches an accessor, do not invoke it: return `InvalidManagedReceiver` through the ordinary selection-failure path. Mutation poisons its selected scope while retaining the original receiver in the recovery baseline; observation fails only its result. Unrelated prototype accessors are valid but remain outside the Cascada method surface. Managed invocation owns selection after complete preparation and before isolation, with no special successful-receiver outcome for rejected selection. Host behavior is fatal when it has already made runtime state, ownership, ordering, publication, or cleanup untrustworthy.

Make query-reflection failure an explicit query-operation outcome. Classify each exact effectful reflection failure as `QueryReflectionFailed` through the selected external-boundary mechanism; never recover an arbitrary traversal exception. Bubble poison through the query body, close its local owner, and discard any partially collected query-only set; do not call `found`, convert it to Boolean, append it to `getErrors`, or throw it through the fatal-on-escape envelope. Phase 9D-0 is a prerequisite: discarding a query-local collection does not repair invalid persistent indexes. Early proof, failed reflection, and exhausted traversal all settle one query outcome through its finish transition. Own the readiness continuation without racing it against the outcome it already settles. A ready query returns poison directly. The final query completion returns or fulfills with that ordinary Error; Phase 9D-B removes the checkpoint query-rejection wrapper. Update the ready/deferred query-reflection cases in test/index-recovery.test.js to expect QueryReflectionFailed, then query and mutate the retained aliases after disabling the trap and run the refcount oracle in the still-live execution. Add no query-result wrapper or general result algebra.

A direct Promise returned by supported external code settles after the synchronous envelope. Its first existing boundary continuation captures the context and kind when the Promise is accepted and converts a raw rejection when it runs. The operation's existing returned Promise carries that outcome. Do not recreate the external-action envelope, persist attribution on the source Promise or its metadata, or allocate an attribution-only Promise.

Use this inventory for every kind emitted by the graph kernel before Phases 9E-10. The higher-runtime names reserved in [`error-handling.md`](error-handling.md) remain in `ERROR_KIND` but have no kernel boundary row:

| Causal boundary | Source | Kind |
| --- | --- | --- |
| Failure accessing `then` during ordinary recognition | Recognizing operation | `ThenAccessFailed` |
| Synchronous failure invoking `then` for a required continuation | Subscribing operation | `ThenInvocationFailed` |
| Ordinary Chain root value or rejection | Chain initialization | `ChainValueFailed` |
| Context root value or rejection | Context import | `ContextValueFailed` |
| Supported import reflection failure | Import operation | `ImportReflectionFailed` |
| Assignment value or rejection | Assignment operation | `AssignmentValueFailed` |
| Required operation input failure | Consuming operation | `OperationInputFailed` |
| Null or undefined lookup receiver | Lookup operation | `NullLookup` |
| Scalar lookup receiver | Lookup operation | `ScalarLookup` |
| Invalid path segment | Segment-consuming operation | `InvalidPathSegment` |
| Supported lookup reflection failure | Lookup operation | `LookupReflectionFailed` |
| Supported reflection failure during `hasError` or `getErrors` traversal | Query operation | `QueryReflectionFailed` |
| Absent selected method | Invocation operation | `MissingFunction` |
| Present non-callable method | Invocation operation | `NotAFunction` |
| External call throw, returned Error, direct rejection, nested returned failure, or controlled Array observation reflection failure | Invocation operation | `InvocationFailed` |
| Controlled callback or comparator throw, returned Error, or poison rejection | Owning controlled operation | `ControlledCallbackFailed` |
| Unsupported controlled-callback result | Owning controlled operation | `InvalidCallbackResult` |
| Supported reflection failure during export | Export operation | `ExportReflectionFailed` |
| Invalid completed managed receiver | Managed mutation | `InvalidManagedReceiver` |
| Supported scalar-conversion hook failure | Conversion operation | `ScalarConversionFailed` |
| Supported required property reflection, write, or commit failure, including controlled Array mutation | Mutation operation | `PropertyMutationFailed` |
| Unsupported property shape or placement | Property-consuming operation | `PropertyValidation` |
| Invalid Array length | Array-length assignment | `InvalidArrayLength` |
| Invalid or unsupported controlled Array mode or result | Array invocation operation | `InvalidArrayOperation` |
| Receiver category does not support the requested mutation | Invocation operation | `UnsupportedMutation` |
| Trusted runtime callback whose result contract admits no poison throws or rejects, including with poison | Owning operation | fatal `FatalError` |
| Internal query traversal, refcount, Promise version, publication, gate, cleanup, or other transition that admits no Error outcome | Failing operation | fatal `FatalError` |

An absent intermediate placement reads as `undefined` and therefore produces `NullLookup` when traversed. A missing method remains distinct from a present non-callable method. Conservative metadata and declaration probes emit no poison kind and are intentionally absent from this causal-boundary inventory. Phases 9E-10 implement the external-operation and Promise-path kinds already reserved by the authoritative architecture table; they do not add unreviewed implementation-only kinds.

### 3. Preserve origin through deferred work

Each causal boundary subscribes to a native Promise or supported custom thenable through the common helper with a continuation closure that captures that boundary's operation context. The source carries no consumer context. A raw rejection is contextualized when that boundary consumes it; a later non-boundary consumer preserves the resulting Error. A safely observed access or invocation failure is contextualized at the recognizing or subscribing operation. Use one hook-free contextualization primitive for ready native Errors, synchronous external-action throws caught by `runExternalBoundary`, and raw asynchronous rejections.

For example, if a managed observation issued on line 12 returns a Promise that rejects after a lookup on line 20 has started waiting for it, the resulting poison identifies the observation on line 12. Reading, storing, copying, collecting, exporting, or rethrowing that poison preserves line 12. If the observation succeeds and a subsequent operation on line 20 independently fails, that new failure identifies line 20. A nested Cascada call has its own source-error context even on the same line; an existing poison from the inner call keeps that inner source when the outer call consumes it. An invocation whose body is native external code uses the Cascada call's source, with any native stack kept as supplementary diagnostics.

- Import-created root and nested Promises use the import operation.
- A pending Chain root installs its exact initial property version and Promise version during Chain initialization.
- Assigned Promises use the assignment operation.
- A direct host result and Promises admitted inside it use the invocation operation.
- A copied or derived pending placement gets a fresh Promise version at its own FIFO position but preserves the source Promise version's eventual contextualized Error.
- A later consumer supplies context only for a new failure it causes.

Do not retain Chain initialization context as a fallback. Different operations on one Chain may therefore produce Errors with different sources. Capture the originating operation context and kind only in the first existing continuation or boundary work that may still create a new Error. Store neither on the source Promise, its identity metadata, the Chain, a property version, or a Promise version. After success they are discarded; after failure the contextualized Error carries them. Shared settlement is source-neutral.

This prohibition removes only sideband attribution. Keep state with another purpose: a pending Promise version's current logical value, fixed imported placement versions for a contextualized Error or synchronously consumed custom thenable, poison held outside thenable fulfillment during complete collection, and `execution.fatalError`. A contextualized Error stored as a logical placement value carries its own attribution; the placement or Promise version carries no separate source or kind.

Do not add a forwarding Promise used only for attribution, Promise subclass, overridden chaining method, parallel continuation system, or runtime-wide Promise brand. Contextualize in the first import, Promise version, validation, or publication continuation the boundary already needs. A direct result flows through the Promise returned by that continuation; a placement continuation uses FIFO readiness and reads the logical value published by the earlier resolver instead of interpreting the raw payload again.

Normalized language-result continuations receive an ordinary Error through the same callback on ready and fulfilled routes. Only explicitly admitted external/input/callback rejection channels normalize recoverable rejection. Pure internal propagation returns the Error as data; semantic transitions perform their remaining work:

- **Graph publication:** publish the Error as the logical value and complete required bookkeeping before returning or fulfilling with that Error.
- **Complete independent-input collection:** record every poison outside the aggregate Promise and fulfill internal branches with non-thenable readiness values. An unclassified raw rejection reaching the collector, or a fatal rejection, still fails immediately.

Apply that same logical-value rule to local completion and structural Array consumers. Ordinary Error payloads must not skip lease release, placement/value capture, comparisons, or retention. Trusted readiness-only transitions keep fatal-on-rejection behavior.

Automatic invocation preparation, argument export, script/result export, and `getErrors` preserve every semantically distinct Error in their required inputs and captured graph frontier. After finding poison, continue all required sibling and nested Error collection, suppress host invocation, and keep operation work open until collection finishes. Output copies and other resources may be released after their last access, but discarding failed output must not discard the Error accumulator or required continuations. Combine the complete cause/source/kind membership once, preserving each leaf's attribution. Export uses one visited set and one Error accumulator across the whole required batch; successful roots retain their output positions, but Error membership needs no separate per-root domain or nested compound pass. Do not use an aggregate whose first recoverable rejection settles the operation, an early owner close, or a catch returning only the first Error in these paths. A required pending sibling keeps collection pending; execution fatality retains its existing independent outward rejection behavior.

Collection follows the operation's semantic inputs. It does not execute an unselected language branch or traverse unrelated host data to discover hypothetical failures. `hasError` answers only existence and may stop at its first proof without consuming or deleting stored Error values; it is not a substitute for complete collection in invocation, export, or `getErrors`.

Delete helpers whose only purpose is converting every poison rejection into fulfillment. Keep separate helpers for publication and complete collection only when they remove duplication; do not replace them with flags, a shared result wrapper, or a configurable continuation path.

Supported thenable use follows the 9C addendum:

- Recognize Error and Function and fixed admitted metadata before ordinary thenability. Consume each raw possible Promise and register each required continuation directly through the common helper at its program position; do not split recognition and subscription into repeated `then` reads.
- Let the Promise or custom thenable own its one outcome, subscriptions, FIFO delivery across settlement, chaining, and nested assimilation. Custom fulfillment is final and non-thenable. A synchronous callback throw escapes the `then` call; a later callback throw rejects the returned chain.
- Keep no execution-local thenability state, cached callable, canonical Promise, private settlement record, Promise-species path, subscriber queue, or active cycle set. The common helper owns only Cascada's execution/lifetime guard and semantic transition.
- Attribute a safely observed access or synchronous invocation failure to the operation performing it. Attribute each raw rejection independently at its introducing causal boundary; later consumers preserve an existing contextualized Error.
- Treat the custom `then` body as the supported scheduling protocol rather than generic external code. Its supplied continuation may enter kernel transitions synchronously because subscription does not mark an external action active; any other synchronous re-entry from the thenable body is unsupported.
- Declaration probes remain contextless and direct. A failed `then` read produces ordinary declaration validation rather than a rejecting capture or persistent fact.

Observe only Promises consumed or owned by supported kernel work. Mark kernel-owned Promises handled when their consumer may attach later, without replacing them. Do not recursively observe unused host input; discarded-expression handling remains a higher-runtime responsibility.

Preserve `declarationValidationError` for contextless public host-configuration validation, including a declaration whose `then` property cannot be inspected safely. It returns an ordinary host API Error and does not enter the language Error or execution-fatal funnels.

### 4. Reuse placement versions and keep import atomic

Use the existing parent-key `meta.placementVersions` map; do not introduce another Error or Promise overlay store:

- Pending Promise versions and fixed imported logical overlays already share logical read, replacement, detachment, and captured-version behavior. Reuse the fixed form for both contextualized native Errors and synchronously consumed custom thenables whose imported physical storage must remain unchanged; finish causal Error migration through this common path.
- Managed receiver materialization and mutation isolation recognize every placement version, including fixed overlays. Compare prepared logical values with physical descriptors through the existing selective materialization walk, copy affected ancestors, and preserve aliases/cycles. Use the same version-presence predicate for mutation isolation; do not add a detached-receiver policy, eager whole-graph copy, or another subscription.
- Derived ArrayViews retain every fixed logical placement in the existing version map; actually pending placements receive fresh versions at the derivation's program position. Apply this centrally to slice/concat/pop/shift views, bounded derivatives, COW, and growth. Propagation keeps the original poison and source, without raw-Error reinterpretation or an Error cache.
- Placement replacement/removal prepares the new logical edge, completes physical storage work, then replaces/detaches the old version and commits refcount facts. Under the [managed-storage Proxy contract](data-limitations.md#proxies-in-managed-storage), each primitive write, definition, or deletion implements the requested property/Array operation on success and leaves the represented graph unchanged on failure. The old fixed value or pending Promise version therefore remains available through every surviving alias after supported failure. Use these common primitives for ordinary assignment/deletion, Array replay, and enclosing publication; add no Proxy detection, speculative writes, per-caller rollback, or recovery guarantee for violating traps. This restriction applies to individual storage operations, not whole managed methods or opaque external mutations.
- Keep a mutation's existing `{ mutatedValue, result }` outcome alive through target publication and every ancestor writeback. Combine every newly caused publication failure with the required result, including a gate that could not be installed and an independently pending removed Array result. Publish state failure promptly; completed receiver leases/gates do not wait for an independent result, and its Error does not retroactively poison already completed state.
- A pending mutation's completion observes its captured gate's committed logical value. Register that continuation at issuance, immediately after shared publication and before later consumers: registering after receiver readiness would let later mutations advance the Promise version before the earlier operation captures its result. Gate fulfillment alone is not publication success. Preserve the already collected result through ready ancestor writeback and pending ancestor Promise version advancement, without adding another result representation or scheduling queue.
- Promise continuation and settlement remain Promise-specific.
- Initialization, assignment, import, copy, and retained results install versions in the selected execution.
- An initial Promise resolver contextualizes its raw rejection once; derived versions preserve the source Promise version's published Error.
- `language-properties.js` reads the live version before physical storage and no longer derives Error source from import origin.

Keep import as one function-based staged identity walk per synchronous segment:

- Stage admissions, origins, retentions, actually pending Promise placements, fixed logical versions for imported Errors or synchronously consumed custom thenables, raw-Error occurrence wrappers, and external-tree leaves; commit only after the whole segment validates. Wrappers need no cross-segment interning; collection merges equivalent raw-cause/source/kind results.
- Preserve the addendum's segment lifetime: synchronous custom delivery joins this walk and identity map; later delivery for a committed placement starts a fresh segment. A failed segment commits none of its state and abandons unpublished subscriptions' later semantic work while retaining rejection ownership.
- Keep mutable-authority discovery as a separate occurrence walk over directly accessible original context inputs, reusing staged admission facts. It skips every Promise or thenable rather than following imported outcomes. Admission still deduplicates identities and consumes ordinary data thenables, while tree construction preserves finite direct alias paths. The two walks commit atomically without a discovery subscription or early overlay publication.
- Do not add an `ImportTransaction` class.

Source attribution uses only causal work and completed Error fields. There are no attribution-only Promise paths, transport-specific Error kinds, generic source strings, imported-at message suffixes, or catches that merely forward/reclassify failures outside the defined roles.

### 5. Publish the trusted composition surface and reconcile contracts

The causal host, Error factory, and guarded-continuation implementations share one composition surface. The public root supplies the required facilities and keeps unwrapped graph operations private. The implementation remains shared, with no duplicated factory, guard, private host-depth protocol, or transport mode.

Document the composition protocol in [integration.md](integration.md) and verify standalone calls and iterator advancement in integration tests:

- The initial semantic body enters `runInternalStep` with its immutable operation context. It prepares/exports inputs and selects any authorized receiver before `runExternalBoundary` invokes the exact external action. A ready success or poison is processed synchronously by the causal body.
- The first required deferred continuation uses `continueOperation`, which delegates ordinary subscription to `thenValue` and owns the same execution and local-open checks as kernel work. A higher-runtime operation with no graph resources needs no artificial graph owner. Semantic callbacks explicitly admit poison or let an unexpected escape become fatal; there is no configurable recovery policy. The source and fixed kind are retained in this existing boundary work, not on the thenable.
- A supported custom `then` invokes its supplied continuation under the scheduling contract; no active-external-action Boolean is set around that continuation. External Functions, callbacks, iterator methods, and loader hooks use the execution-scoped external-action envelope and its one post-action fatal check. Both repositories share that implementation, Error recognition, and causal factories.
- Private kernel composition returns the classified result without an outward registration. Each public kernel operation owns its result once. Cascada uses those public operations; a higher-runtime operation with additional work owns its final completion, while a delegating alias or callback adapter consumes an existing result without wrapping it again.

Phase 9D-B supplies the public API and expression boundary and reruns these routes. Phase 13 consumes that public surface without private imports or duplicate guards. The package classifier distinguishes public kernel operations, each owning its result, from guarded composition helpers and delegated aliases, which create no extra result boundary.

Keep settled semantic rules in the architecture and principles, and outstanding code-removal and implementation tasks in this plan. Document the private exact-action marker rule and shared-helper rationale. Phase 13 owns the local iterator-finalization and diagnostic route/view requirements.

Complete the documentation alignment in this phase alongside the implementation: `AGENTS.md` and `error-handling.md` must describe the final poison hierarchy, the separate required-operation-context and outside-execution configuration contracts, and one complete idempotent local close without prescribing its method location. Their fatal-delivery rules and prohibition lists must distinguish internal work and operation owners, which have no registered fatal reject action, from actually pending outward operation results, which retain Phase 9C's required removable reject actions. These actions deliver the execution's already-classified fatal; they do not classify invalid application data as fatal. Examples and tests assert complete Error membership and preserved attribution without requiring Error order. Phase 13 owns the corresponding higher-runtime changes and verification of its existing platform requirements.

### Verification

- `PoisonError` and `FatalError` directly extend native `Error`; `CompoundPoisonError` extends `PoisonError`. All three are native Errors, and `CompoundPoisonError` also has poison semantics through its parent. Remove the runtime `CascadaError` base and export. Phase 9D-B retains non-thenable Errors and verifies the separate expression container and its assimilation.
- Every Error form precedes thenability inspection, including hostile Error values with throwing `then` properties. Precise predicates distinguish raw native Error, poison, and fatal state, and native `Error.isError` passes the package's Node 24 and cross-realm tests; Phase 13 verifies the containing Cascada runtime's browser matrix.
- Every poison has a stable defined source and nonempty kind. Ready and pending forms of one failure use the same kind; later consumers preserve both.
- Attribution tests distinguish the originating operation from later consumption: ready throw and deferred rejection from a managed observation keep the observation's source through lookup, copied placements, collection, and export. A successful observation followed by a failing operation uses the latter's source. Check exact source-handle identity independently of the raw `.cause` payload, including distinct operations on one line and one raw native Error introduced at two different causal boundaries. Collection retains both distinct sources while propagation of already-contextualized poison adds none.
- A native Error with a stack, safe custom diagnostic fields, and a nested native cause remains the exact `.cause` after ready and deferred contextualization and later propagation. Its Cascada source handle retains all supplied diagnostic facts and captured route frames. Construction performs no eager stack read or cause-field copying; bounded presentation leaves both full diagnostic inputs retained. Native fields named like source fields cannot overwrite the wrapper's Cascada attribution.
- A script or supported host failure with no file/line information still produces poison using its boundary's ordinary diagnostic handle and leaves the execution live. Cover ready throws and deferred rejections with unfamiliar native Errors and supported primitive reasons; no reason-specific allowlist determines recoverability. Expected pre-execution declaration validation returns an ordinary Error without creating an execution, and passing that Error into execution data contextualizes it as poison.
- Operation contexts remain required trusted control facts on successful, failing, immediate, and deferred routes. Compiler/integration tests prove valid propagation; do not add a malformed-context semantic matrix. A malformed root integration call creates no `FatalError`, execution state, or report, while the same programming defect escaping work already enclosed by a valid operation context follows that enclosing fatal guard. Missing optional source-location fields on a valid operation context remain nonfatal.
- Arrival mode creates no structured field or transport-specific kind. Equivalent returned, thrown, fulfilled, and rejected failures retain one contract-based classification.
- Invalid data/arguments and supported native-call exceptions produce poison on ready and deferred routes without setting `execution.fatalError` or invoking its reporter. A later valid operation succeeds, and an unrelated pending operation is not fatally rejected. In a separate test, inject a real internal bookkeeping defect and verify prompt authoritative fatal rejection of pending outward results, including one whose input never settles. A recoverable poison rejection must never be mistaken for an execution-fatal delivery action.
- Existing poison propagates by reference. Separately constructed wrappers with the same raw cause, source-context identity, and kind deduplicate in both `getErrors` and compounds. Different contexts or kinds remain distinct, including reuse of one raw Error at different sources. No execution/runtime Error cache exists.
- Repeat one source operation with the same singleton Error and with primitive causes, including explicit `undefined`, `null`, `false`, zero, and `NaN`; equivalent failures merge even across independent invocations. Distinct source handles or kinds remain distinct; independently created causeless leaves remain distinct. Verify the same rule in compounds and `getErrors`, including deliberate source-handle reuse across executions. Do not test event counts through collection length.
- Contextualization invokes no host hook and copies no cause property onto the wrapper.
- Kernel-created failure reasons contain no protected receiver, argument, or external capability. Compliant host reasons retain exact cause identity without any cause-graph walk. The `throw this` and Error-with-receiver examples are documented unsupported payloads, not tests promising arbitrary deep validation; freezing and safe diagnostic views are not claimed to fix their aliasing.
- Raw import, assignment, and host-result rejections use their introducing boundary. Shared settlement and copied versions never substitute the consumer that advances them.
- Native Promises and supported custom thenables use ordinary subscriptions through the common helper. Each introducing boundary supplies its own context while later consumers preserve the resulting Error; sync-first delivery stays synchronous, FIFO spans settlement, only returned pending chains enter pending-only machinery, and no execution-local thenability state is created.
- Root and nested imported native Errors receive occurrence wrappers without modifying host storage. Ready, synchronous custom, and later pending introductions preserve the same attribution and collection membership without requiring identical newly constructed wrapper objects. Failed import commits nothing; its earlier pending subscriptions cannot later create occurrences or publish data. The existing placement-version map owns fixed overlays.
- Extend the addendum's staging tests with raw-Error equivalence across direct values, synchronous custom delivery, and later pending segments. Check cause/context/kind membership, frozen wrappers, and exact-reference propagation of existing poison; do not require cross-construction `===`. Failed validation publishes no wrappers, and abandoned pending subscriptions cannot create or publish them later.
- Direct Error transport has one causal and graph effect whether returned, fulfilled, thrown, or rejected. Internal failures retain Phase 9C's fatal behavior.
- Every raw `throw` site and every failure-classifying or recovery catch has one documented boundary classification; catches outside the allowed roles are removed or narrowed. Safely detected invalid managed prototype shape is recoverable before invocation, while a throw after invariants become untrustworthy is fatal. One common continuation path handles execution and local lifetime, while each transition body explicitly consumes expected poison or lets an unexpected escape become fatal. A callback result contract that admits poison treats ready and rejected poison equivalently. Boundary policy is assigned per action rather than per module, and “native code” alone grants no recoverable boundary.
- Closing through any retained internal close entry releases operation-specific resources and registered callbacks once. Repeated close and late release registration preserve that invariant. Verify live success, poison, supported host failure, and early completion through the existing lifecycle tests; do not assert that cleanup must reside in a particular class or module. Internal cleanup defects remain fatal, while execution-fatal delivery itself does not invoke local close.
- Admission classification preserves an uninspectable exact identity as external without constructing poison, while a fatal established during its reflection still wins. Contextless declaration thenability recognition is direct; an unreadable `then` returns ordinary validation and creates no synthetic thenable or persistent state. Neither probe generalizes `runExternalBoundary`.
- Probe tests cover a classification Proxy trap throwing an ordinary value or an existing `FatalError`; only the ordinary failure falls back to the exact opaque identity. They retain Phase 9C's same-execution nested-fatal post-probe case, in which a hook catches the fatal re-entry result but admission still propagates the execution's authoritative failure. Declaration tests cover alias deduplication, a throwing `then` getter, atomic no-declaration failure, an Error with hostile `then`, and configuration invoked during an execution's external action. Expected declaration failures are ordinary synchronous host API Errors and leave the registry unchanged. Deliberately recursive configuration through its own reflection is unsupported and receives no guard. An unexpected declaration implementation exception escapes synchronously without constructing a `FatalError`, while an existing `FatalError` is preserved unchanged. Tests needing an existing fatal first fail an explicit execution. Declaration handling creates no execution, poison kind, Promise, or persistent capture, and asserts no stable behavior for repeated access to an unsupported dynamic getter.
- The authoritative causal kind inventory covers every kind emitted by the graph kernel and contains no transport-named or implementation-only additions; higher-runtime reservations remain unmodified, and `declarationValidationError` remains the explicit contextless host-configuration path.
- Factory-produced kernel Error wrappers are frozen and compounds expose copied frozen arrays. Deliberate misuse of the exported constructors or prototypes is outside the programming API contract and receives no runtime hardening. The kernel surface contains no legacy presentation or location fields; a separate diagnostic view formats the opaque context and exact cause without decorating the Error.
- Supported query reflection failure is the query operation's QueryReflectionFailed outcome, not a found graph Error. hasError does not answer true and getErrors returns it as the query outcome rather than adding it to a completed collection. Ready query failure returns its ordinary Error directly; pending query failure fulfills with that same ordinary Error result. Internal traversal, indexing, and bookkeeping failures remain fatal.
- Query tests cover ready and pending reflection failure for both APIs, including partial `getErrors` collection. They verify exact poison identity and kind, owner closure, absence from the collected set, Boolean non-conversion, pending fulfillment with the query Error, and fatal treatment of adjacent internal traversal failure.
- The boundary verification covers exact reflection failures, adjacent internal failures, and retained cyclic indexes on query and export routes. Reading a non-callable native Error-valued `then` succeeds as a protocol probe; throwing the same Error is `ThenAccessFailed`. Existing or newly committed fatal state always wins. No policy stored on a source context or graph identity, duplicate traversal, or parallel marker/direct recovery mode survives the cutover.
- Trusted-integration tests exercise a standalone host call and iterator advancement with ready, synchronously delivered custom, and pending outcomes. External code attempting to re-enter the same execution fails it before graph work; even if it catches that fatal and returns a normal value, the post-external-action checkpoint propagates the original authoritative fatal. The same external action may synchronously enter another execution without changing either one's state. Adjacent trusted continuation failures stay fatal. Each public kernel call owns its pending outward result once. Guarded composition helpers add no result boundary, and delegating aliases do not wrap an already exposed result. A distinct higher-runtime operation with additional required work owns its own completion.
- Collection tests permute settlement timing for nested export properties, `getErrors`, receiver/argument preparation, aliases, and cycles. Compare complete semantic membership and preserved leaf attribution; assert neither child order nor representative wrapper/source. Delayed aliases need no ordered-summary machinery. Test both outcomes of an Error proof racing query reflection failure and ensure closure prevents further query work.
- Complete-collection regression tests cover descriptor failures before and after poison, required pending siblings, records, Arrays, bounded ArrayViews, aliases, and cycles through export, receiver preparation, and argument export. Ready failures remain synchronous; pending siblings keep collection open. Receiver-validation tests cover native-then reflection, key-list failure, and per-placement reflection with Errors on both sides, including Errors inside a still-inspectable admitted child. Pair these with a fatal internal-metadata defect.
- Mutation-completion tests cross valid/failed result import with valid/invalid receiver state on ready and direct-Promise calls; retain both independently attributed failures and deduplicate equivalent existing poison. Include Errors already collected inside an admitted result graph when receiver validation fails, without rescanning that graph or awaiting independent nested Promises. Rejected prototype selection is tested in observation and mutation modes, at root and nested placements, with ready, synchronous-custom, and pending preparation; keep prototypes stable, verify mutation scope poison, and permit a valid method after repair restores the receiver.
- Array preparation tests cover unreadable placement descriptors and failures reading captured values with required Errors on both sides, including a controlled pending sibling, ready/custom delivery, sparse bounded ArrayViews, default sorting and comparator export, and sorting in observation and mutation modes. Verify zero comparator calls after failure, exact original attribution, and a live execution. Flat depth-zero tests preserve unconsumed payload; successful sorting with fewer than two sortable values keeps its no-conversion behavior.
- Publication tests combine a rejected placement value with descriptor or writeback failure, preserve every Error discovered across retries, and deduplicate an existing poison thrown again. Cover indexed and unindexed owners and synchronous custom settlement, then query the retained Promise version and run the refcount oracle. Array removed-result tests cross ready/pending `pop` and `shift` results with receiver replay failure: the receiver publishes its own failure immediately and the independent result combines both without extending the gate.
- `test/placement-version-boundaries.test.js` exercises record/class methods with ready, synchronous custom, and native-Promise receiver data, nested fixed values, aliases, and cycles in observation and mutation modes. Assert host-visible logical values, unchanged imported storage, and no repeated source subscription. Array tests preserve exact contextual poison through slice/concat/pop/shift, bounded derivatives, COW/growth, and complete collection without duplicate causal membership.
- The same tests fail assignment/deletion before physical effects with ready, fixed-Error, and pending old values, indexed and unindexed aliases, and controlled Array replay. Query and mutate the surviving alias, settle/reject its original source, and run the refcount oracle before and after. Retain adjacent corruption tests that remain fatal. The oracle checks the logical edge and allows a settled Promise version to overlay a previous ready physical value after failed writeback; it still rejects a missing placement or inconsistent pending storage.
- `test/publication-failures.test.js` crosses ready/custom/pending managed success/failure with target publication failure, failed gate installation, ready/pending ancestor writeback, and pending removed Array results. Assert complete cause/source/kind membership, graph effects, no later Error entering an earlier gate result, released receiver leases, and healthy repair before an independent result settles. Use controlled pending inputs and strict rejection ownership; do not infer completion from a raw gate payload.
- Existing multi-Error tests compare semantic membership and select diagnostic leaves by cause/source/kind rather than child position. Successful value and effect ordering assertions remain unchanged.
- Verify no loss across automatic invocation and export: mix a ready Error with later rejecting required siblings and nested properties, reverse their settlement order, and compare the complete cause/source/kind sets. Assert that external code is never invoked, each leaf keeps its original source and cause, and a first Error does not close required collection. Use a manually controlled pending sibling to show that the result remains pending after another input fails and completes only after that sibling contributes its outcome. Deduplicate equivalent leaves while retaining different sources or kinds; do not count repeated propagation as another failure. Repeat these cases after the Phase 9D-B graph/expression boundary and through Phase 13's compiler-generated call and final-export routes.

Update [`AGENTS.md`](../AGENTS.md), [`error-handling.md`](error-handling.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-processing.md`](import-processing.md), [`managed-invocation.md`](managed-invocation.md), [`enter.md`](enter.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), public API documentation, and integration documentation and tests.

---

## Phase 9D-B: Separate graph Errors from expression failure values

**Status: Implemented.** Expression extraction and its ready failure container, normalized query outcomes, and the public root API are complete.

The shared observation walker supplies lookupPathForExpression; one internal pending-result boundary owns fatal delivery for both outward result contracts. getErrors finalizes once through combineErrors, with null for an empty collection. Input consumption uses the existing thenable boundary. The integration-only module, query rejection wrapper, identity-only Array transfer continuation, and pure mutation-outcome catches are removed. General normalized-input collection no longer treats rejection as language Error data; admitted input/callback channels retain their causal conversion.

Verification: all 1,217 tests pass with strict unhandled-rejection handling, including the refcount oracle, public API classification, expression-boundary tests, query-result shape and collection tests, publication regressions, and fatal delivery. Public standalone-call tests retain every required argument Error and suppress invocation in both argument orders. Expression lookup ordering tests preserve earlier success or validation failure across later assignment with pending roots and properties, native Promises, and ordered custom thenables.

### Outcome and scope

Keep recoverable Errors as ordinary non-thenable data throughout graph storage, property versions, preparation, invocation completion, publication, queries, and normalized operation results. A kernel result is `T | PoisonError | Promise<T | PoisonError>`: pending recoverable completion fulfills with its Error after the same required processing as ready completion. Raw host rejection is contextualized at its causal input boundary; rejection escaping trusted work still follows the fatal contract. Do not add `then` to either Error class.

Introduce one separate expression-facing `PoisonedValue`, containing an ordinary Error, and the public `lookupPathForExpression` operation. Successful expression values are exactly String, Number, Boolean, and BigInt primitives. Expressions receive one of those values, a Promise fulfilling with one or rejecting with an Error, or a ready PoisonedValue rejecting with its contained Error. Null, undefined, and Symbols cannot enter expressions; objects, Arrays, Functions, and external identities stay in operation Chains. This is the only Chain operation returning a ready PoisonedValue; other graph operations keep ordinary Error results. Expression-created failures and final native delivery may use the same container through its public factory. This boundary is also used for call results before expression evaluation. Phase 13 implements the corresponding compiler separation; this phase supplies and tests the public kernel contract without adapting the current Cascada compiler.

### 1. Preserve ordinary Error transport in the kernel

- `PoisonError` directly extends native Error; `CompoundPoisonError` extends it. Both remain non-thenable. Preserve immutable instances, exact diagnostic causes, opaque source contexts, kinds, leaf-only compounds, and cause/context/kind deduplication. One distinct leaf remains that leaf; do not construct singleton compounds or intern wrappers.
- Normalize raw host and expression rejections once through their existing causal input-consumption continuation. Preserve an already contextualized Error by reference. Import, Chain initialization, assignment, arguments, and host results consume a supplied PoisonedValue through its supported synchronous rejection delivery and publish the contained Error, never the wrapper. No PoisonedValue becomes an admitted graph identity, fixed placement, pending Promise version, or refcounted payload. Phase 10 adds the same consumption for reached thenable path segments, including synchronously rejecting PoisonedValues; 9D-B does not add a separate segment path. Apply each boundary's existing availability contract: consume supported thenables where availability is allowed; use the existing validation outcome where thenables are forbidden, including declaration input. Do not add a container-specific admission branch. Callable-own-`then` placement validation protects a property named `then`; it does not detect a container stored under an arbitrary key, and the container's method is inherited. Correct input consumption is the graph invariant.
- A ready Error and a normalized Promise fulfillment with that Error take the same semantic callback. Do not add rejection handlers for language Errors at every internal continuation. Only an explicitly admitted callback/input rejection channel converts such rejection to a logical Error; a raw or poison escape from trusted work with no Error-result contract remains fatal. Keep enter's admitted callback-result rejection handling and complete its local resources before returning the ordinary Error. A synchronous trusted callback throw remains fatal.
- Remove the query-specific rejection wrapper in `ErrorQueryWork.run`. A failed query returns or fulfills with its ordinary `QueryReflectionFailed` Error. `hasError` never converts that query failure to true, and `getErrors` never inserts it into a successful collection.
- `getErrors` completes every required captured branch and returns null when no Error is found, the original leaf when one distinct Error remains, or a CompoundPoisonError for several. Pending completion fulfills with the same null or ordinary Error result. Finding Errors is successful inspection, not a rejecting outcome. No PoisonedValue is created. Preserve the existing flattening, cause/context/kind deduplication, leaf attribution, and unspecified child order. A query failure returns its own QueryReflectionFailed Error instead of a completed collection. `hasError` retains its Boolean result and existence-only early completion.
- Finalize getErrors in its existing query-completion continuation after the full captured frontier settles: return null for an empty collector; otherwise call the existing combineErrors factory once. Let that factory own flattening and deduplication, without a preceding duplicate normalization pass or singleton compound allocation. Keep the query owner open through required collection and result construction. Preserve existing path failures as collected Errors, while missing and healthy primitive terminals contribute none. Update public consumers, examples, and tests to handle null or a leaf/compound directly; remove Array-result assumptions and redundant consumer-side combination. Do not add a result record, query transport mode, or compatibility Array API. A query failure and a collected Error share the ordinary Error representation; result shape is not proof that collection completed, and a previously stored QueryReflectionFailed remains ordinary collectable graph Error data.
- Gates publish their captured logical value, including an ordinary Error, through their existing FIFO resolver and completion transition. Complete required target and ancestor publication, combine independent publication failures, and close local work before exposing the operation outcome. A gate's physical source payload never substitutes for its committed logical version. Keep independent result Promises separate from receiver protection.
- Keep complete collectors and their existing readiness/result storage when that state represents required work. Ordinary Errors can safely fulfill Promises; no record or wrapper is needed solely to defeat Error assimilation. Exclusive phase completions carry null or exact poison directly. Mutation receiver/result records retain their separate effect and result semantics. Do not introduce a general result algebra, transport policy flag, or second continuation engine.
- Remove redundant identity-only Array transfer continuations and catches around pure mutation-outcome discrimination where their deletion preserves the existing fatal envelope. Keep the remaining pending lifetime guards, publication ordering, and Error-valued Array payload behavior. Remove source comments promising a future then method on Error, obsolete rejection-boxing helpers, and transport-only tests in the same change.

### 2. Add the minimal expression failure value

Expose `createPoisonedValue(error)` and `isPoisonedValue(value)` through the public package API. The factory accepts an already classified leaf or compound Error as trusted runtime input. It returns one immutable non-Error container with one immutable `.error` reference. Source, cause, kind, and compound children live only on that Error. Creating another container must neither create another causal occurrence nor change collection membership. The predicate recognizes this runtime-owned expression type using its ordinary class identity; it is for expression results, not arbitrary host-value admission. Input admission consumes the supported thenable protocol instead. Add no brand registry, marker property, or tamper-defense machinery.

Its inherited `then(_onFulfilled, onRejected)` returns this when the rejection handler is not callable, otherwise directly returns `onRejected(this.error)`. Delivery is synchronous and repeatable. Let callback throws escape normally. Native await and Promise assimilation reject with the contained Error. Returning that ordinary Error from a native rejection handler fulfills successfully; returning the PoisonedValue propagates rejection.

Keep the container concrete: no subscriber state, scheduler, Error cloning, lazy grouping, RuntimePromise, callback-thrown-poison conversion, catch/finally methods, or shared-prototype freezing. It is an expression boundary value, never the kernel's Error representation. The public factory also serves failures created by Cascada arithmetic, validation, loading, and other expression work without a lookup. Those causal producers create their ordinary Error using the public factories and their own operation context before wrapping it.

### 3. Implement public expression extraction

Add `lookupPathForExpression(chain, path, operationContext)` alongside `lookupPath`. Reuse the existing observation walker, property versions, supported input consumption, execution checks, and boundary classification. It is a shallow terminal validation of the selected logical value, not another walker or an export operation. Implement it as a short specialized counterpart to lookupPath, sharing the internal observation machinery and adding terminal expression validation and failure conversion before its one outward result boundary. It need not call the public lookupPath facade. A small amount of operation-specific orchestration is preferable to a generic mode flag or adapter introduced solely to share these few lines; keep traversal, ordering, attribution, and lifetime mechanisms shared.

- Accept exactly String, Number, Boolean, and BigInt primitives. This boundary performs only the documented type validation; expression evaluation, operator semantics, and numeric validity belong to Cascada. Reject null, undefined, Symbols, boxed primitives, Functions, Arrays, records, class instances, and external identities. BigInt is supported as an expression value, without conversion to Number or loss of precision.
- Preserve a selected existing Error. For another unsupported expression value produce a causeless `InvalidExpressionValue` validation Error attributed to this extraction's operation context. Add that contract-based kind to the authoritative kind table. Do not retain the rejected value as a diagnostic payload, invoke conversion hooks, read its contents, deep-export it, or await unused descendants. A missing final placement yields undefined under ordinary lookup and therefore produces InvalidExpressionValue here. A failed intermediate path or an existing Error retains its original failure instead. The failed observation does not poison or replace its source Chain.
- Apply the same terminal validation inside the common guarded path continuation for ready values, synchronous custom delivery, and pending delivery. Respect ordinary external authority and reflection checks before extraction; primitive validation cannot grant extraction authority to a mutation-capable external identity.
- Convert the completed recoverable outcome to expression transport only at the outward expression boundary: ready success returns its primitive, ready failure returns a PoisonedValue, pending success fulfills with its primitive, and pending failure rejects with the exact ordinary Error. Here `ExpressionValue` means `string | number | boolean | bigint`, a type description, not a runtime wrapper. The result type is `ExpressionValue | PoisonedValue | Promise<ExpressionValue>`. A native Promise rejects with Error, never with the container.
- Keep outward completion tied to the final expression result. Validate and perform required publication before its settlement. Exactly one fatal reject action belongs to a genuinely pending outward operation; a ready PoisonedValue allocates neither a Promise nor a fatal registration. Do not pass a newly created ready wrapper through the kernel's pending-work detector or turn it into a gate. Preserve the first-fatal-before-outward-settlement rule during conversion. Avoid wrapping an already returned public lookup in another public result boundary: compose the core walker and one final outward return internally.

Use PoisonedValue only when the operation completes with a recoverable failure synchronously, including synchronous delivery by a supported thenable. Once the outward operation is pending, reject its existing result Promise directly with the ordinary Error after required processing. Do not allocate or assimilate a new PoisonedValue in the pending completion path. Consuming a caller-supplied PoisonedValue remains ordinary input handling; it does not justify creating another wrapper. Preserve fatal checks through final outward settlement, and keep intentional rejection settlement outside trusted work that interprets an escaping rejection as fatal.

Reuse existing guarded continuations and outward-result machinery, with a ready failure factory and direct pending rejection. Do not build a generic outcome projection, expression evaluator, additional scheduler, transport mode, or arbitrary managed-result conversion API. This project supplies operation-chain extraction, Error factories, and the ready failure container. Cascada owns expression evaluation and its implementation tests. Kernel integration tests use public operations to verify extraction, result transport, Error identity, and expression-result ingress without implementing operators or compiler lowering.

### 4. Supply the public higher-runtime surface

Cascada uses only the documented root package API. Keep unwrapped graph operations private to this package. Remove `./integration` and migrate its package export, documentation, tests, and import sites in the same phase; do not leave an alias or adapter. Cascada's repository migration remains Phase 13.

Expose the existing Error factories `createPoisonError`, `validationError`, and `combineErrors`, the expression factory/predicate, and existing kinds and precise Error predicates at the root. Expose the guarded composition capabilities needed by higher-runtime-owned work: `runInternalStep`, `continueOperation`, `runExternalBoundary`, `isPending`, `failExecution`, and `returnOperationResult`. These reuse the same implementations and trust compiler/runtime operation contexts. Do not expose the raw subscription primitive, private external-escape protocol, private owner state, or a second set of unwrapped Chain operations. `isPending` continues to accept normalized kernel results only; it is not an expression-value predicate. Consume incoming expression thenables before using that detector; create outgoing ready containers after pending-work classification. Do not add isPoisonedValue or instanceof probes to isPending: those neither normalize an incoming container nor preserve the existing reflection behavior of supported Proxy thenables.

Provide causal `importMethodResult` through a normal public operation boundary with the `InvocationFailed` attribution already established by 9D-A. This covers higher-runtime-owned host protocols without misusing context import or copying its implementation. Classify this operation with the other public results. Guarded composition helpers themselves are building blocks, not separately returned operations, and register no result merely for invoking a callback.

Every public kernel operation owns its own pending outward result. Cascada treats those as completed API boundaries, owns any results it buffers or discards, and does not reapply the kernel return helper to the same delegated result. A separate higher-runtime operation, such as a render with additional required work, owns its own completion; do not remove that completion merely because it depends on public kernel operations. Keep registrations bounded by currently pending public results and remove each on settlement. Update the actual package-export classification and route tests to enforce these scopes.

### Public-result cost and acceptance criteria

Keep the specified per-public-operation fatal obligation. A pending result must reject promptly with the execution's first fatal even if its source never settles. Public-only integration does not by itself prove that every internal command needs an outward result; the current contract deliberately assigns one to each public kernel operation. A different public composition contract requires an explicit architecture decision, not an unwrapped private import, implicit mode, or removal of fatal delivery during implementation.

A bounded Node v24.14.1 / Windows x64 measurement of the 9D-A baseline compared actual public lookupPath with the unwrapped integration lookup, using identical executions and values. Each trial issued 2,000 empty-path lookups, then awaited all results and checked every value. Ready trials used a root of 7; pending fan-out trials shared one unresolved root, resolved to 7 after issuance; dependent trials put each lookup result into the next Chain before issuing the next lookup. After four warm-up pairs, nine measured pairs alternated order with explicit GC before each trial. Timings include issuance and settlement, but exclude initial Chain construction and GC. These are local microbenchmarks, not a Cascada workload or an API equivalence claim.

| Workload | Core median total (range), ms | Public median total (range), ms |
| --- | --- | --- |
| Ready | 3.04 (2.07?5.11) | 3.26 (1.55?5.00) |
| Shared pending source | 5.36 (3.28?7.43) | 8.03 (5.69?10.10) |
| Dependent Chains | 25.49 (18.08?45.00) | 25.50 (20.07?41.67) |

A separate async_hooks PROMISE-initialization count over 100 operations, with timing instrumentation disabled for the timed trials, found identical ready counts (204 including the harness), pending fan-out counts of 207 core / 507 public, and dependent counts of 407 / 707. The current public boundary therefore adds three native Promise allocations per pending lookup in these cases, plus rejector registration/removal. A direct-source versus wrapped-result reaction-order probe also confirms the extra delivery reaction. The broad timing ranges and graph work prevent a reliable dependent-chain speed claim; allocation overhead is clear. The core comparison lacks independently fatal-rejectable results and is not a drop-in replacement.

In 9D-B preserve the ready fast path and one pending registration, eliminate duplicate outward wrappers on delegated results, and avoid adding a second wrapper merely for primitive conversion. Verify fatal interruption of a never-settling source and fatality during final conversion. In Phase 13 measure representative compiled sequential, branching, and asynchronous renders against the same completion semantics, separating Promise allocations, peak pending obligations, and total latency. If that shows material cost, bring an explicit public composition/ownership proposal for decision before changing this contract. Do not add a benchmark framework or performance thresholds from these noisy microbenchmarks.

### 5. Verification and documentation

Use integration tests over the actual public API and strict unhandled-rejection execution. Cover:

- Ordinary leaf/compound Errors remain non-thenable; direct await and Promise fulfillment preserve identity. PoisonedValue is not a native Error, exposes the exact Error, rejects await/assimilation with it, supports synchronous repeated callbacks and missing handlers, and does not catch callback throws. Recognition distinguishes the container from primitives, ordinary Errors, and native Promises without making the predicate an admission probe. Returning a caught Error successfully and propagating its wrapper have distinct tested outcomes.
- Every accepted expression type (including BigInt beyond Number precision), null/undefined/Symbol and object rejection without conversion hooks, missing final placement producing InvalidExpressionValue, failed prefix, raw rejection, existing leaf/compound, and fatal value through ready, synchronous-custom, and pending expression lookup. Add pending path cases when Phase 10 supplies them. Validation leaves the Chain unchanged and does not wait for an unused nested Promise.
- Public import, Chain construction, assignment, arguments, and host-result consumption accept expression wrappers and rejected expression Promises, preserve cause/source/kind and Error identity, and store only ordinary Errors. Cover both root and nested placement input, the wrapper's inherited then method, and immediate and deferred host-result delivery. At boundaries forbidding thenables, assert the existing validation outcome and no declaration/admission side effect. Ready wrappers add no microtask, Promise version, gate, or pending-only lease. Two causal uses of one raw rejection retain distinct sources; propagation of an existing Error does not.
- Graph lookup, mutation, invocation, export, and query recoverable outcomes remain ready Errors or Promise fulfillments with Errors after required work. Healthy hasError returns false and healthy getErrors returns null. Verify complete getErrors results with zero, one, and several distinct leaves, nested compounds, duplicates, aliases, cycles, and reversed settlement order. One distinct leaf preserves its exact identity; several produce one frozen leaf-only compound. Include ready, synchronous-custom, and pending cases, including a pending healthy frontier fulfilling with null. Query-reflection failure returns its exact operation Error instead of a partial collection; test a stored QueryReflectionFailed separately as ordinary collected data. For hasError, exercise false, true, and QueryReflectionFailed through ready and pending delivery, retain each query result in a Chain, and extract it through lookupPathForExpression: only successful query Booleans reach expression continuations. Query poison preserves its exact Error/source/kind and never becomes truthy success. Retain supported Proxy-thenable coverage where ordinary then access works but unused prototype reflection throws; normalization must not introduce that reflection. Complete queries and input/export collection wait for controlled failing siblings and retain full membership regardless of settlement order.
- Preserve 9D-A's `array-complete-collection`, `placement-version-boundaries`, and `publication-failures` regressions: retained Error payloads in flat/search/sort and copied Arrays, fixed-version materialization, surviving aliases after failed storage, exact gate capture before later mutation, complete target/ancestor publication errors, receiver publication before independent result settlement, and balanced live-operation leases. Existing native-equivalence and refcount-oracle suites remain green.
- Internal raw/poison callback escapes still fail execution; admitted entry-result rejection completes normally as an ordinary Error. First-fatal checks, closed entry, cross-execution isolation, boundary attribution, and late continuation behavior remain intact. Primitive lookup registers once only while pending, and fatal committed before its final outward settlement wins even during conversion. Ready failure returns a PoisonedValue synchronously. Pending failure rejects directly with the exact ordinary Error, without an intermediate failure-container allocation or assimilation.
- Public export classification covers all new facilities, confirms `./integration` is removed, and distinguishes public operations, constructors/configuration, expression factories, guarded composition helpers, and delegated aliases. Standalone host calls collect all exported argument failures and never invoke host code after failed preparation.

Update AGENTS, the Error architecture, data limitations, runtime spec, README, import, run, enter, managed invocation, export, and integration documentation with these final contracts. Update Phase 13 for compiler routing, expression-created failures, diagnostic inspection, final render export, and the public-only dependency. Remove claims that Error subclasses acquire then or that all kernel operation failures reject. Mark this phase implemented only after its source, tests, package API, and documentation all satisfy this end state.

---

## Phase 9D-C: Promise-version lifecycle and terminology

**Status: Implemented.** Source, tests, fixtures, architecture, and implementation documentation use the final vocabulary. This phase preserves Promise, placement, ordering, import, ownership, and failure semantics.

### Outcome

A **Promise version** is the exact logical placement version created when ordered consumption of a supported thenable remains pending. It stores the logical value at that placement and program position as settlement advances it. It is not the source Promise, and its identity survives settlement and capture after detachment. A synchronously delivered thenable creates no Promise version: it publishes directly or uses a fixed placement version when physical storage must remain unchanged.

The representation discriminator is `promiseBacked`. It identifies a pending-origin version, not whether its current logical value remains pending. Fixed versions use the common placement-version storage without that discriminator.

A version may update a placement only while it is that placement's installed version. Before installation or after detachment, publication updates only its captured logical value, while validation, admission, and required retention still run. Initial publication commits the current staged value through the ordinary property transition and retains a version only where required; that value may still be pending. This same identity rule governs synchronous preparation, live settlement, and detached settlement. Import retains separate transaction staging so graph admission and initial placement installation commit together after validation.

### Lifecycle and helper boundaries

1. **Prepare.** `transferPlacement` and first raw-property consumption create callback-visible staging before subscribing through the ordinary sync-first consumption path. Synchronous completion publishes a ready value; only a returned pending continuation requires a Promise-backed version.
2. **Install: `installPlacementVersion`.** After preparation identifies pending work and marks its record `promiseBacked`, attach that exact version before later delivery can run. This helper only associates the version with the placement; the enclosing property transition commits the current staged value and any physical write or refcount change. Fixed versions use the same attachment mechanism.
3. **Continue: `continueCapturedPromiseVersion`.** Register on the captured version's source at the caller's FIFO position and read its logical state at delivery; the source callback payload is not authoritative. `observePromiseVersion` adds explicit capture protection when an observation can resume after transition publication. Operation owners govern local continuation lifetime only. Shared settlement and ownership transfers use the continuation without adding observation retention.
4. **Publish: `publishPromiseVersion`.** Validate and admit an available placement value, apply required retention, and commit its value, Boolean presence, and recovery together through the common property path. A pending replacement requires a fresh version and is rejected here. Initial preparation uses this same publication transition on its staging record, without allocating persistent Promise state for ready work.
5. **Commit: `commitPromiseVersion`.** Update the version's complete prepared placement together with any live physical writeback and refcount edge, releasing obsolete producer dependencies. An uninstalled or detached version updates only its captured state; it cannot alter the placement or its refcount edge. Imported physical storage stays unchanged.
6. **Transfer: `transferPlacement`.** Copying or retaining a pending placement creates a distinct destination version at the copier's program position and advances it from the captured source. Transfer carries presence and recovery with the logical value. Synchronous transfer publishes directly; only pending transfer installs a Promise-backed destination.
7. **Detach: `detachPlacementVersion`.** Replacement or deletion removes the placement association. Existing captures may finish their work without changing the replacement placement.

Use `getPlacementVersion` for general overlays; `getPromiseVersion`, `requirePromiseVersion`, and private `isLivePromiseVersion` select or check Promise-backed versions. Captured placements retain their source as `sourceVersion`. Entry transfers the complete private-root placement before releasing its gate. Available-value settlement uses `publishPromiseVersion`; operation publication uses the complete placement commit.

Fixed placement versions share installation, reading, and detachment but do not require Promise continuation or fork state. Keep no compatibility exports, delegating publication alias, lifecycle class hierarchy, alternate continuation engine, or persistent versions for ready runtime-owned properties. Later phases use these same names and transitions.

### Verification

- Ready values and synchronously delivered custom thenables preserve synchronous results and allocate no Promise version.
- Pending native and custom thenables create one version per placement and program position. Continuations preserve FIFO order and consume the version's current logical value.
- Publication validation, refcount commit, physical writeback, imported-storage protection, detachment, COW forks, Array copies, gates, path resumption, and mutating entry retain their semantics.
- Forks receive distinct versions. Detached versions finish captured work without changing replacement placements.
- Missing required versions and fatal publication defects fail at the same boundary with the same operation context.
- All 1,217 tests pass under strict unhandled-rejection handling, including the refcount oracle. Repository-wide terminology and discriminator audits leave no obsolete implementation names or adapters; no permanent source analyzer is added.

---

## Phase 9E: Build the external coordination kernel

The atomic admission, binding, compiler-input, and public-context foundation is implemented. Phase 9F-A implements hierarchical scope discovery and reservations. Keep this phase's transactional and identity invariants; the tree and scheduling mechanisms are specified by Phase 9F-A and external-context-ordering.md.

### Binding and compiler input

Accept one compiler-owned finite property tree, including {} endpoints, without modifying or retaining it. Discover only directly accessible original named data placements; every Promise/thenable source stops discovery independently of normal import delivery. Omitted requests select nothing. Managed endpoints grant no authority. Reuse staged/admitted identity facts and perform no unrelated subtree search or admitted-identity reclassification.

Stage admission, shared ownership, versions, discovered locations, and registrations atomically. Reject two distinct selected paths to one external identity within a context before commit, including finite selected aliases/cycles. An abandoned import cannot change existing bindings or permit its subscribed work to publish. Otherwise-valid independent context registrations invalidate shared authority at commit; regular-Chain import and inert aliases do not.

The execution-local identity map distinguishes correct contextual use, invalid off-path use, and permanent binding conflict. Correct entry-derived routes retain the original canonical context and static provenance. Off-path use fails locally in either import order; no earlier output is rewritten and no exposure/alias history is stored. Mutable identities belong to only one execution under the host contract.

### Verification retained by Phase 9F-A

Preserve constructor input ownership, safe literal keys including __proto__, transactional rollback, existing-admission behavior, import permutations, settled-output immutability, directly reachable root selection, thenable skipping, conflicting bindings, and no late discovery. Test real operation inputs and supported reflection failure, not malformed trusted compiler-tree shapes. Hierarchical discovery additionally records requested native descendants rather than assuming external nodes are leaves; its new verification belongs to Phase 9F-A.

## Phase 9E-A: Preserve Error identity and bound query summaries

Implemented. Error union preserves an input representing the complete result, and graph summaries count immediate contributing placements. These common contracts precede external query integration and require no new restriction on supported graphs.

### Idempotent Error union

- Ordinary propagation returns its exact Error, including a compound, without calling combination just to forward it.
- `combineErrors` reuses an input Error that represents the complete semantic union. Preserve cause/source/kind deduplication and leaf-only immutable compounds. A sole input returns directly; after collecting the union, an input compound with the union's member count already covers it: each deduplicated input member set is a subset of that union, so equal cardinality proves equality. Allocate only when no input represents that union. Keep no interning cache or persistent membership state.
- `getErrors`, export, publication, and phase completion use this same rule. Preserve the existing compound's source, message, children, and identity when reused. Distinct required failures still form a complete union.
- Verify `combineErrors([E]) === E`, `combineErrors([E, E]) === E`, combinations with an already-contained child, and public `getErrors`/export of repeated compound occurrences. New independent causes, sources, or kinds must still enlarge the union.

### Immediate-child presence summaries

- Implement [graph presence summaries](counters-implementation.md). Keep Error, Promise, and cycle-cut summaries as counts of immediate contributing placements. A traversable child contributes one per nonzero summary through each parent key; direct Error, pending, and cut placements contribute their ordinary single category.
- Update index construction, edge contribution capture, live publication, COW/remap indexing, and query pruning together. Preserve atomic fallible preparation/commit, downward index closure, the acyclic projection, and existing cut traversal.
- Propagate only zero/nonzero changes with exact local edge multiplicity. One placement transition changes each category in only one direction, so each ancestor's presence changes at most once: on its first addition or last removal. Complete fallible child indexing and capture old/new contributions before publication. After storage succeeds, update live counters directly within the synchronous commit, without callbacks or suspension; reconverging contributions accumulate there, and unchanged presence stops propagation. Each category crosses an affected reverse edge at most once. Keep separate placement transitions separate; no future-count map, ancestor sort, BigInt, saturation, cached topology, or rescan of unrelated graph data is needed.
- Remove obsolete weighted-delta helpers and tests asserting descendant totals. The independent verifier checks local child-presence contributions, edge multiplicity, complete index regions, and cycles. Sharing and leases are independent ownership mechanisms and remain unchanged.
- Reproduce the small-graph defect with eleven records each containing 32 aliases to the next child, plus a root with that branch and one independent Error. Index, replace the large branch, and require `hasError` and `getErrors` to retain the surviving Error. Repeat for pending-Promise presence, reversed property order, repeated removal/reinsertion, reconverging parents, and cycle cuts. Use few identities; this is not a large-graph stress limitation.
- Include a cyclic diamond with a cut on one arm, built through different insertion histories. Remove and reinsert contributions through each arm, and verify surviving Error and Promise reachability against the independent verifier. Equivalent raw graphs may have different cuts and local totals; require identical observations, not a canonical projection.

Verified by the full suite: 1,309 tests pass with strict unhandled-rejection handling. `test/error-union.test.js` covers complete-union reuse, overlapping compounds with and without a complete input, and public collection/publication identity across ready and pending delivery; `test/presence-summaries.test.js` covers dense aliases, reconvergence, pending frontiers, and cyclic diamonds. `test/index-recovery.test.js` also covers a later discovered subscription settling an earlier skipped version, requiring another discovery pass. Import, COW, Array remap, publication-failure, and index-recovery tests use the independent local-contribution verifier.

## Phase 9F: Public external operation baseline

The public external routes, logical property snapshots, fixed-location admission checks, and method-result isolation are present in the working implementation. Keep their supported boundary, Error, and ownership behaviors as the starting point for Phase 9F-A. This checkpoint does not claim conformance to the hierarchical reservation and subtree-repair architecture.

The replacement scope is explicit in Phase 9F-A: reuse stable boundary/import/export mechanisms, rewrite conflicting coordination and routing sections, and remove their superseded state in the same cutover. Do not revert unrelated 9F correctness fixes or completed 9C through 9E-A mechanisms.

## Phase 9F-A: Scope coordination and managed rollback

**Status: implemented.** Hierarchical external reservations, automatic rollback of each failed managed mutation, owning-placement scope poison, and retained-state repair use the existing boundary and graph machinery. Phase 9F-B consolidates their placement and ownership primitives; Phase 10 adds Promise-valued path segments; Phase 13 integrates the public API into Cascada.

Verification: the full suite passes with strict unhandled-rejection handling. The public hierarchy, entry, rollback, repair, discovery, and pending-presence regressions are in test/scope-recovery.test.js and test/external-paths.test.js; existing placement, publication, managed invocation, native Array equivalence, and fatal tests cover their shared machinery. Frontier tests cover 1,000 queued writes and 2,000 independently finishing sibling operations.

### Implementation boundaries

| Source area | Responsibility |
| --- | --- |
| external-mutation-tree.js | Build the finite nested tree from directly accessible compiler-selected placements. Store identity bindings, original scope poison, and immediate-child poison presence behind one Symbol. Commit registrations atomically. |
| external-operation.js | One direct/subtree reservation algorithm for ordinary operations and covered entry views. Keep undominated dependency frontiers separate from actual effect lifetimes. |
| path-context.js, path-operation.js | Capture static provenance and tree route facts in one traversal. Own issuance checks, reservations, scope blockers, and effect completion for path operations, including entry; select the managed publication owner at the ordered path turn. Coordinate mixed-scope rejection, failure publication, and repair. |
| mutations.js, property-versions.js | Protect managed baselines through publication. Capture and transfer complete placement presence, value/version, and recovery state through COW, gates, Array movement, and entered roots. |
| enter.js | Use ordinary managed gates or leases and common external reservations. Transfer the private root at closure; protect Array structure while retaining the requested element reference and each contained command's baseline. |
| observations.js | Capture ordinary managed paths and collect external metadata under one covering reservation. Keep query completion separate from the last use of its external reservation. |
| managed-invocation.js | Prepare and validate the full native receiver; use one complete copier for mutation isolation, preserving aliases and cycles. Observation-only representation materialization retains its distinct purpose. |
| array-invocation.js, array-methods.js, array-remap.js | Publish controlled mutations from protected Array baselines through views or remaps. Native intrinsic tracing retains touched placements, deletions, and surviving source length. It does not replay physical writes into the baseline or keep an operation log. |
| external-access.js, external-snapshot.js, import-processing.js, import.js, export.js | Preserve boundary classification, native snapshots, complete collection, atomic admission, and borrowed-result isolation; validate nested registered identities along their selected route. |

The existing walkers retain separate scope-prefix and receiver-suffix selection. Both reuse ordinary placement transitions and writeback; external prefix selection uses that same walker without copying a healthy prefix merely to reach native state. Receiver publication uses the common transition so captured versions and independent result/publication failures have one implementation. A placement transition has local baseline and lease state, without another operation owner. Repair selects its exact placement and uses common restoration/publication without constructing a private mutation Chain or applying write-specific structural widening.

Capture the first external boundary, the scope covering the requested mutation prefix, the deepest crossed scope, and the exact tree branch together with static provenance. Reuse these issuance facts for entry lowering, authority checks, repair, and queries. A failed prefix or a structurally widened Array target is selected during traversal and retains its own exact branch lookup. Entry uses the common path coordinator while keeping callback closure, private placement transfer, and covered-view completion at their own boundaries. Successful private-scope results transfer complete placement state through one capture helper; receiver failure still poisons its enclosing mutation scope rather than becoming a successful stored result.

Capture, pending delivery, transfer, and gate completion carry presence, value/source version, and recovery as one placement state in property-versions.js. Array placement references use this same state after lazy capture. Fresh assignment and captured-source transfer share staging and publication. Operation publication commits the complete placement atomically; shared Promise settlement uses the same storage/index commit with its required Error fallback. Gate release follows the published logical version and never substitutes a raw rejection for normalized poison. A restored Promise keeps its availability without extending repair's result or reservation. Ready and pending mutation outcomes use the same publication path, without rereading their own gate. Controlled intrinsic tracing owns only a partial remap; already-complete remaps enter common Array finalization directly.

Native mutation preparation and copying remain separate. Preparation consumes and collects the entire required receiver and arguments before method selection; the complete copier then creates invocation storage only for a valid call. Combining them would introduce partially built output and cleanup state into preparation, including calls that never reach invocation. Mutation does not first run the observational materializer, so it allocates only one isolated graph.

Attachment protection retains the counter-pruned containsPromise walk. Captured settlement, cyclic attachment, and deferred publication need protection before later mutation; an extra subscription, persistent summary, or permanently shared private root would impose a broader mechanism. Ordinary placement capture/transfer owns retention elsewhere.

### Completion checklist

- Every public external access path and contextual query uses the new kernel, including work issued through entered Chains and work delayed before native selection. Scheduling retains only undominated frontiers, separately from actual effect lifetimes; a deferred native access never acquires a later managed gate as a prerequisite.
- Internal COW, Array placement movement, and managed entry reuse common transfer of placement presence, source version, and recovery state. A no-op creates no property or Array element; gate installation never commits placeholder growth, and presence-sensitive traversal/callbacks distinguish holes from explicit undefined. Phase 9F-C extends this path to metadata-only Array placements and independent captured length knowledge.
- Every managed mutation preserves its ordered pre-operation scope through required publication. Failed work is discarded; repair reveals that baseline consistently for private, shared, leased, and imported values. Ordinary Error data and successful mutation with an independent Error result retain their semantics.

- Mutation selection and publication have one coordinator, including Array length changes. Requested authority stays distinct from a widened structural owner. Keep operation-specific fixed-location checks and ordinary preselection Error handling; derive no extra preservation-mode flag from protected baselines.
- No reader counter, phase cursor, poison-completion payload, contextual-binding gate, recovery side store, or dependent-gate bypass is active or exported. External completion carries no Error or native payload.
- Keep ordinary managed gates, counted managed leases, property-version capture, closure checks, and independent effect/result lifetimes. Those are not superseded external mechanics.
- All retained tests protect final semantics; rewrite obsolete expected behavior without preserving compatibility fixtures. Keep regression coverage for supported reflection, Error membership, source attribution, pending publication, aliases/cycles, and fatal handling.
- Inspect module imports/exports, unused state/options, comments, examples, public docs, and package exports. Delete unused helpers and experimental files in the same change. No audit artifact is required.
- Mark 9F-A complete only after full public integration verification and this deletion check. Phase 10 and Phase 13 consume the final mechanism, not a second cleanup phase.

### 1. Establish the final semantic boundaries

Use mutation-and-observation.md for the four managed mechanisms and entry distinction, external-context-ordering.md for native reservations, error-handling.md for poison/repair, enter.md for reference/control-flow entry, and data-limitations.md for host restrictions. Treat these as final requirements, not selectable compatibility modes.

- Managed mutation scopes exclude canonical registered mutable external locations. Controlled managed operations may retain inert external aliases elsewhere; their presence alone is not an invalid scope and grants no external authority. Check the selected tree route without a managed subtree scan. Native managed receiver preparation separately rejects registered mutable identities anywhere in its complete receiver, including inert aliases. Observation-only external references remain opaque leaves. Reject invalid mixed scopes before mutation, preserving their selected root value under placement poison.
- External scopes may nest. Sibling work overlaps; ancestor/descendant operations conflict when at least one mutates. Parent-wide native methods remain supported and preserve fixed registered identities/locations.
- Entry may be mixed. It reserves access only and never exempts contained operations from mutation scope rules. Support Cascada reference arguments and path-specific delayed control flow.
- Managed rollback is per mutation, including controlled writes and native managed methods, not per entered callback or command sequence. Protect the baseline at the ordered turn and discard failed working state without undo logs or native effect compensation.
- Repair exposes the selected managed baseline and clears covered external subtree poison first. Repair-and-call starts from that repaired state under the same required protection; new failure cannot resurrect cleared poison.
- Preserve nonblocking result availability, imported-data protection, complete required Error unions, shared/leased managed isolation, ordinary final Error replacement, and independent nested-result lifetimes.

### 2. Build a fixed hierarchical external tree

Extend compiler-guided initial discovery to requested native child data placements below an external node. A runtime node can contain both child keys and a Symbol-held external scope record. Keep parent, depth, binding, reservation, and poison facts inside internal metadata rather than reserving property names. Continue through the finite compiler paths only; do not enumerate native interiors or add an endpoint-used flag.

Replace the leaf-shaped { path, context } representation with safe child maps and Symbol-held metadata on both branches and leaves. No string key is reserved for runtime fields. Use ordinary mutable metadata for ordering and poison while canonical topology stays fixed after commit; node freezing is not required for correctness. Test path, context, constructor, and __proto__ as actual native child names, including a node that is both a registered scope and a parent.

Reuse existing managed admission. Newly discovered native object scopes are staged as external, not default-managed, and already-managed identities are never promoted. Only original own data placements are eligible. Skip absent, accessor, primitive, Error, Function, and all thenable sources; ordinary import still consumes availability normally. Prune empty connecting branches and keep initial admission/registration atomic. Preserve duplicate-path rejection, independent-context conflict policy, and no registration from later settlement.

Keep compiler-named native descriptor inspection inside the existing import reflection boundary. A supported throw produces ImportReflectionFailed at context initialization and abandons all staged registrations/admissions without changing an earlier valid binding. Preserve fatal precedence. Do not enumerate native ownKeys or invoke getters; compiler control shapes remain trusted.

Commit identity bindings during initial context import, independently of ordering-state allocation. Never defer registration to first observation or mutation. Preserve the execution-local identity lookup that rejects off-path use before the original location has ever been used; no native-object flag is needed.

Distinguish first native crossing from selected external scope. Explicit external bang selects its node; default operations select the deepest registered scope covering their receiver/container, and unregistered suffixes remain under that scope. Registered descendants require static source provenance even below an external parent. Dynamic ordinary suffix keys remain supported but cannot select registered nodes. Root and entered routes use the same location facts. Supported invalid selection stays poison; host replacement of a fixed identity remains outside the support boundary.

Use exact branch lookup, deepest covering scope lookup, and first native crossing for operation selection. Exact entry eligibility comes from the selected node identity; descendant enumeration needed only by tests stays in test support. Nodes retain no context Chain: the shared binding entry and selected node already identify authority. Update compiler integration and public examples. No source operation needs to scan an unrelated tree branch just to select its scope.

Keep location authority separate from retained identity. A controlled write to copy.count must not fail because copy also holds an inert registered identity; neither a ready alias nor a later resolution of an unrelated pending alias creates a canonical location there. Keep ordinary off-path use rejection and native receiver capability checks at their existing consumption boundaries. Do not introduce a managed contains-external flag, an alias index, or a preparatory whole-graph scan. Controlled Array operations may retain/remap inert aliases as data, while registered canonical locations remain fixed and native callback/export boundaries still reject capability escape.

### 3. Replace external phase state with upward completion dependencies

Implement the dependency table in external-context-ordering.md: observation waits for selected subtree mutations plus strict-ancestor direct mutations; mutation/repair waits for selected subtree observations/mutations plus strict-ancestor direct observations/mutations. Keep direct and subtree frontiers distinct so siblings remain independent and parent observations exclude child mutations.

Forbidden dynamic observations validate only their statically reached prefix. Use the same frontier to wait for direct mutations at that prefix and its ancestors; publish observation membership only in their subtree aggregates, so unconsumed child scopes remain independent. Query fallback selection must not reserve a dynamically chosen child. After ordering, preserve reached binding conflicts and own poison without collecting descendant Errors, otherwise return local selection poison. Verify ready and pending failures, later repair, competing bindings, every public observation result contract, and entered/rebased references with the strict external sequence model.

One fulfillment-only completion represents an operation's required native effects and boundary processing. Keep capture and publication synchronous and composable for Phase 13 reference-argument batching. Capture and deduplicate required predecessor completions before publishing this completion's frontier memberships. Form a fixed wait from that snapshot. Maintain an undominated pending frontier: after a mutation captures prerequisites, remove older same-view frontier entries selected at its own or descendant scopes, then publish that mutation. It waits for the removed entries and covers all their future conflicts. Do not remove strict-ancestor or unrelated entries, prune another entry view, or let observations replace mutations.

Frontier replacement changes scheduling membership only. It must not finish captured operations, release their resources, discharge enclosing-entry obligations, clear poison, or rewrite existing dependency waits. Actual completion idempotently removes remaining memberships at its normal last-use point. Keep removable memberships with no receiver/result payload. Neither rolling Promise aggregates nor a set of all pending predecessors may retain cumulative history: n queued same-scope mutations require a dependency chain with O(n) total edges, not O(n²). A long-lived independent sibling must not retain completed operations. Reuse selected tree locations and ancestor paths; introduce no transitive-dependency index.

Empty dependency sets mean no prerequisite, not Promise.resolve(). Ready native work remains synchronous and removes its own reservation membership in its completion transition without removing an unrelated pending operation. Reuse completion state; add no second ready-result transport. Compare wide concurrent readers, long serialized write streams, mixed ancestor/descendant work, and entry views. Validate frontier replacement against the unpruned conflict relation, including actual completion and effect-lifetime cleanup, rather than merely comparing set sizes.

Capture explicit inputs, source provenance, and the issuing entry view, and acquire statically selected external coverage at original issuance before managed gates can wait. Capture external predecessors and publish one reservation synchronously. Continue managed namespace capture through its ordinary FIFO/version path without waiting for external predecessors first; native access, subtree metadata capture, and entry callbacks require both prerequisites. Never reserve again after a managed, input, or predecessor wait. Revalidate authority before deferred native access. Completion carries no Error state, and fatality rejects public results without settling or cancelling internal reservations.

Capture canonical managed placement state, including pending gate/version and poison, at this ordered path turn. After waiting for external predecessors, recheck identity binding authority and external scope poison under the reservation, without rereading later managed gates or namespace versions as prerequisites. An earlier native command must finish before a later mixed entry that already waits for it. Authorized entered work uses its private managed path and inherited view; retained copies gain no authority from an old capture. Replace ambiguous live-guard rescans with these capture points, not an extra gate history or bypass graph.

Use this reservation turn for all statically selected routes, including gated paths, entries at managed ancestors, and ancestor Error queries. Only the issuing Chain determines the view. One reservation completion covers both predecessor ordering and enclosing-entry lifetime; early local failure must not break a dependency chain by completing before its predecessors. Managed-only lookup/export/method preparation adds no native subtree reservation. Do not retain unreserved command tickets, late reselection, a second scheduling queue, or a dependency-bypass graph. Phase 10 separately implements unresolved managed-key selection and its prefix-to-target ordering handoff; do not assume delayed acquisition is safe or add candidate-resource machinery in 9F-A.

Phase 13 batches reference selection using these primitives without postponing a ready path's reservation for a disjoint pending argument. Keep path capture, managed FIFO registration, and external dependency capture/publication composable; record effect lifetime separately from scheduling-frontier membership. The concrete public multi-reference handoff belongs to Phase 13, not a speculative 9F-A overload.

Use this kernel for calls, read/write/delete, repair, Error metadata queries, and external entry. Delete the single-owner reader-group cursor and direct-poison completion transport when this replacement passes. Do not retain a mode selecting the previous algorithm. Measure overlapping ready/pending sibling work and frontier retention; an implementation with fewer helpers but duplicated queue state is not a simplification.

### 4. Store poison at its owner and summarize descendants

External scope metadata stores own poison separately from its native value and gate. Track immediate child branches containing Errors, propagating membership changes upward without descendant counters or persistent compound wrappers. Do not install child Errors as ancestor-owned poison. The canonical tree remains fixed and acyclic; permanent binding conflict is a separate, nonrepairable source for access/query results. Its discovery must update Error summaries at both the existing and newly committed locations: before replacing a valid binding with conflict, its existing location is available for upward propagation. Later competing locations seed their own summaries from the already-conflicted entry. No reverse alias registry is needed.

Apply the same zero/nonzero presence propagation rule as Phase 9E-A: a parent changes only when an immediate child branch becomes empty or nonempty. A fixed tree has one parent per child and no graph multiplicity or cycle bookkeeping. Reuse the invariant, not the whole refcount implementation; do not create a generic propagation framework merely to share a few state transitions.

A strict-ancestor own poison blocks with that original Error. Otherwise selected whole-subtree work checks its complete required Error union after predecessors and invokes no native action when blocked. Healthy siblings remain usable. A blocked mutation adds no poison; observations add no scope poison. Update error summaries before releasing completion so the next operation cannot miss the effect. Whole-subtree metadata queries hold one covering observation reservation and collect child records directly; they must not reacquire child reservations after a later writer has queued behind that query.

External getErrors collects required own and descendant metadata, including children when the selected external root also owns poison. It does not read native properties or await hidden managed recovery data. Use existing Error deduplication and null/single/compound results; preserve every distinct cause/source/kind and do not reattribute propagation. hasError may short-circuit. Queries blocked above their target retain ordinary blocker semantics. Managed index pruning cannot hide external summary work.

### 5. Implement managed rollback and placement poison

At the selected managed scope's ordered turn, after earlier conflicting work and before the first write, capture its logical value, placement presence, and source version. Preserve it using existing ownership/COW and temporary protection with an explicit last-use point. Do not capture an early-issuance snapshot that omits preceding effects. Pending retained contents keep their normal settlement and attribution. A failed prefix before scope selection retains the first-failed-placement rule, widened only as required for Array structure below; do not invent a deeper scope or wait for unused path inputs.

Implement structural poison ownership in the common managed mutation selection/publication path. Retain an explicit broader bang scope. Intrinsic Array length writes, truncation, and remapping use the Array owner; ordinary index placement failure follows Phase 9F-C's local creation and committed-growth rule. Select and protect the required owner before effects, using captured baselines, COW, gates, and placement transitions. Never widen recovery after later conflicting writes have been allowed through.

Keep requested mutation authority, the actual receiver/container, and the rollback/publication owner distinct within that one selection path. Determine the structural owner from the reached category and operation, not the spelling of a final length key alone. Pending path/category information advances selection at its FIFO turn; protect the required owner before effects, without reading an unused suffix or widening ownership after later conflicting work can proceed. Replace lengthExternalMutationBranch, its extra parent observation walk, post-construction scopeDepth edits, and captured RHS parameter rewriting with this common selection and normal input conversion. Keep the requested RHS capture and its lease lifetime intact.

Check fixed locations against the operation's actual structural effects at the selected owner. Managed and native Array length conversion determines whether truncation would remove a registered index; reject it before writing. Share the tree-index check, preserve native coercion and validation, and ignore non-index native properties when checking length. Share the fixed-location invariant without adding a whole-graph diff or a generic mutation-effects framework. Array growth and truncation above all registered indexes remain permissible; the mere presence of a registered descendant is not grounds to reject a controlled structural write. An explicit managed bang covering registered mutable resources remains invalid even when an implicitly widened structural owner would be permitted. This includes controlled Array mutators such as push: an Array-wide call scope differs from an ordinary index assignment or length write.

Preserve complete Array length, holes, values, and source versions in the baseline; discard failed working state and restore through ordinary repair. Add no length undo log, affected-object registry, or duplicate poison on elements/ancestors. Keep shared settlement, ordinary Error-data assignment, and independent result availability separate from mutation failure: structural ownership does not require waiting for stored data when its publication is otherwise complete. COW representation changes alone do not widen poison. A wider recovery owner grants no wider mutation authority and must not alone reject an ordinary sibling write that preserves registered locations. Explicit mixed managed bang scopes remain invalid; external Arrays retain their external scope/no-rollback contract.

Preserve the existing placement state without awaiting an old target merely to capture rollback. Final replacement/deletion waits for preceding unfinished transitions at that placement, including entry, but never for the ordinary pending data those transitions publish. Keep gate publication distinct from value availability in captured and copied versions. With no preceding transition, replacement remains ready even if the old data never settles. Retain any existing source version; do not normalize or subscribe to otherwise unused old input solely to create a snapshot. Subsequent consumption after repair follows ordinary availability and source attribution. An absent placement remains distinct from a present undefined value.

Give selected mutation work one internal completion contract separating its publication effect from its independent result. Reuse the existing mutatedValue/result pair where it fits ordinary placement publication; presence and recovery state remain with their owning placement. Update producers and consumers together so run, scoped path work, and final publication do not repeatedly accept a pair or bare Error and reconstruct the pair around privateChain._state.value. Handle expected failures once at the coordinator that knows their applicable owner. Failures before selection and shared validation/export helpers keep ordinary Error results; do not force them into fabricated receiver outcomes or retain a compatibility normalizer for superseded producers. Result Error alone is not evidence of mutation failure, and an independently pending result must not hold completed receiver publication open.

Keep selection blocked by existing poison at the selected scope or a strict ancestor out of new-failure publication. Return the original Error with the entire prior placement/recovery state unchanged; repeated blocked attempts must not replace a healthy retained baseline with the Error or layer new recovery records. An ordinary Error at that scope gains no invented baseline. Preserve permitted final replacement/deletion and explicit repair. Conversely, existing Error inputs that fail preparation for a healthy selected scope still require its normal failure effect. Decide from selection and the owning placement, not merely from the returned Error's identity or class.

Derive result sharing from actual retained identities and the existing boundary ownership rules. When the result and published managed value are the same identity, marking that value shared reflects its second owner; add no redundant returns-receiver flag to the outcome. Nested aliases still receive ordinary result-import/sharing treatment. A primitive equality or immutable Error needs no managed ownership state.

Keep scope-prefix selection and receiver-suffix traversal under the common mutation coordinator. They consume different path segments and reuse ordinary COW/writeback. Successful external-prefix selection does not COW managed parents. A supported reflection failure during managed selection publishes ordinary placement poison through its captured placement, without acquiring broader external coverage or adding poison to a native scope that was not reached. Earlier native work retains its earlier namespace capture, and an already-acquired reservation preserves its predecessors until completion. Remove failure-only external acquisition hooks. An observation walker alone cannot provide recovery writeback. Preserve captured versions, first-failed-placement behavior, attribution, and attachment ownership across deferred failure.

Reconstruct the owning path once when installing the operation's placement or pending publication. Deferred completion updates that captured placement without repeating ancestor writeback. Intrinsic Array length changes supply their receiver publication at selection, including a pending publication, rather than replacing an ancestor after later siblings have COWed. Verify pending method and length changes followed by sibling writes, failure followed by replacement, and captures before each transition. Deferred structural widening must use the captured placement version for baseline selection, recovery, entry transfer, and writeback, even after that version detaches. Use the common placement capture rather than rereading the live owning property. Determine structural ownership after preceding work makes Array length available; retain that selection through publication.

Perform assignment, deletion, controlled Array work, and native managed calls on working state independent of the baseline. Controlled operations copy affected paths and reuse Array structural sharing. Native methods can write anywhere in their receiver, so provide a complete isolated receiver graph preserving aliases/cycles and admitted structure. Reuse the existing complete-graph copier and remove selective mutation-isolation discovery/reconnection where the root is always protected. Do not add copy-history state, intercept native writes, or deep-copy unrelated scope descendants. Remove candidate replay into the protected baseline solely to preserve native identity; replay may target independent working storage, followed by one publication. Keep observation preparation/materialization separate.

Full graph isolation for a native managed mutating call is an accepted graph-sized copying/allocation cost even on success. Measure to remove duplicate materialization/copy passes and unnecessary retention, not to condition baseline recovery on sharing history. Where preparation already creates a fully independent receiver, use that same working graph under existing ownership facts. Keep observation materialization, controlled path COW/Array views, and opaque external leaves distinct. No no-baseline fallback for failed native managed mutation is permitted.

Receiver preparation collects every required Error and retains its source leases through complete receiver and argument readiness. Method selection then precedes one complete copy into independent invocation storage. Keep this straightforward sequence and post-invocation validation; do not allocate partial mutation copies during preparation or add a separate pending-copy cleanup lifetime.

Controlled Array mutation publishes one candidate derived from its protected baseline. View fast paths retain sparse structure without a full copy. Other native intrinsics operate on an ordinary sparse Array of placement references. They move those references without consuming their payloads, then common placement transfer materializes the result. Publish the resulting logical Array through the ordinary scope transition. Receiver preservation is invariant here, so there is no preservation-mode flag, physical replay, or write-preflight path for an owned baseline. Removed elements gain ordinary retained ownership.

Bound length-assignment copying to the final retained range; do not copy discarded placements merely to delete them. Use the ordinary protected scope baseline without a separate in-place resize or write-preflight path. Represent complete remaps sparsely rather than allocate an operation for every absent index; omit only writes/deletes that are semantic no-ops under the supported storage contract. Reuse bounded candidate/key enumeration, including descriptor checks needed for representation constraints. Full-range sparse work should follow present affected properties and length; a narrow selected range must not scan a large unrelated prefix merely to avoid a few holes. Preserve required mutation order, length/holes, captured versions, sharing, and live-edge bookkeeping. Do not add another graph index or replace native method algorithms solely to enforce one traversal shape.

On success publish working state through the ordinary placement transition and release operation-only baseline protection. On preparation, copying, invocation, direct native result, validation, or required publication failure, discard private working changes and publish poison while retaining the baseline for repair. Complete this effect before releasing its gate. Baseline retention must not depend on whether the value was previously shared or on whether failure was ready or pending. Keep the baseline available until final publication succeeds; failure to publish a successful candidate must not lose it. An independent result Error or nested result failure does not roll back successful receiver publication; ordinary assignment of Error data and successful removal of an Error-valued element remain valid operations.

Extend existing owning-placement versions: the visible value is the original Error, and private recovery state retains the baseline/value version. No Error carries graph data. No separate guard class, node poison flag, fallback poison store, or failed-receiver reconstruction is needed. Recording poison must not require inspecting/copying the failed target. Copy owning ancestors where ordinary isolation requires it, publish fresh placement state on poison/clear, and preserve that state when COW copies parents. Retain ordinary ArrayView/Array placement semantics, including holes and missing record properties: a missing placement is not an own property holding undefined. Failed private changes cannot leak altered shape or length into the retained baseline.

Implement common logical placement capture/transfer in the existing property-version machinery and use it for path COW, Array movement/retention, and entered-root handoff/publication. Transfer presence, visible value or captured source version, and retained recovery state together, with ordinary sharing for every retained owner, including a hidden baseline. Preserve gate-installation and FIFO subscription order at callers. Keep fresh-property writes and ArrayView overlays as storage-specific publication details; derive the helper shape from these actual callers rather than introduce another snapshot type, policy framework, or ready-value wrapper. Boundary import/export and standalone Error extraction retain their distinct contracts and never transfer private recovery state merely because they encounter an Error.

Update logical reads, capture/fork/transfer, index maintenance, import/export, queries, and replacement/deletion consistently. Queries/indexes see the visible Error once, not the hidden baseline as a second edge; retained source settlement remains live. An earlier captured healthy value or Error does not change. Permitted final replacement/deletion discards scope poison and its baseline; fixed external namespace restrictions still apply. Derive current canonical namespace poison during the existing ordered path capture where possible. Any retained tree reference must follow the canonical owner's logical placement through ordinary ancestor COW, authorized entered-root publication, and repair. Update it as part of canonical publication, without changing already-issued operations' earlier captures; never let copying or repairing an unrelated retained graph retarget it or clear canonical protection. Store no duplicate Error or alias registry.

Preserving recovery metadata during a placement fork also preserves ownership of the hidden baseline. Cover two retained containers that each hold the same poisoned placement: repairing and mutating one must not change the other's later recovery. Use existing capture/sharing rules rather than a second recovery ownership system.

Attachment protection uses the existing counter-pruned containsPromise walk. Pending settlement, captured Error queries, cycles resolving to an attachment, ancestor replacement, and deferred paths require protection before later conflicting mutation. Keep ordinary leases, sharing, and captured versions; add no extra subscriptions, eager ref index, descendant summary, or unconditional permanent sharing of private roots.

Use the same mechanism for ordinary managed mutation failure, invalid mixed bang, forbidden fixed-namespace structural work, and supported ancestor reflection/publication failure. A failed managed prefix may reserve its connecting tree node, but its Error remains solely in managed placement state; publish tree ownPoison only at a registered external identity. Test this separation before and after repair, including queued failures. Keep all independently required Errors without changing their source/kind. Remove namespace-only record.recovery storage, success paths that mutate the preserved baseline, and retention of partially modified failed receivers. Earlier completed operations remain committed; entry is access ordering, and higher-level guard/recover owns rollback across a sequence. Fatality does not trigger a rollback/cancellation sweep.

### 6. Implement subtree repair

Repair-only selects its target under ordinary managed placement ordering and required exclusive external reservations. Clear selected managed placement poison and expose its preserved baseline; clear repairable external own poison in the covered static subtree and update summaries. Do not traverse hidden managed contents solely to clear poison or rewrite independent earlier managed failures and ordinary Error data. Strict-ancestor own poison blocks; derived external summaries do not. Permanent conflicts remain. Successful repair returns undefined without invoking a native method or external-resource read/write. Ordinary managed selection and required restoration preflight keep their existing supported-reflection boundaries.

Implement the repair target-state table in error-handling.md: healthy or absent managed targets return undefined without rewriting managed contents; retained scope poison restores its baseline; ordinary Error data without a baseline returns that same Error; valid external scopes clear covered repairable metadata; inaccessible ancestors and invalid selected bindings return their blockers. Descendant permanent binding conflicts survive otherwise valid subtree clearing. Repair-and-call invokes nothing when repair selection returns an Error.

Restore the baseline and remove managed poison in one placement-version publication. Retain the prior visible Error and complete baseline through fallible ancestor COW, index preparation, and supported storage/publication work. On supported failure preserve that state and all covered external poison; return the causal boundary failure. Commit successful restoration and external summary clearing under the held protection before releasing gates/reservations or notifying dependants. Do not clear recovery metadata first or expose a partially repaired namespace.

Repair uses existing causal Error kinds: unsupported external authority is ExternalLocationConflict, and supported preparation/reflection retains its boundary kind. Healthy or absent managed repair selects its exact placement and returns undefined, without structural widening to an Array or clearing unrelated native siblings; ordinary Error data returns that same Error. There is no generic repair-failure kind.

Repair-and-call performs the same clearing before normal preparation and invocation under the same required ordering. Its managed mutation captures the repaired baseline; failure discards new working changes and records only new required poison, never the deliberately cleared Error. Preflight scope/placement selection before clearing. Existing returned Errors and earlier captured values remain unchanged. A descendant binding conflict still blocks whole-subtree native work. Repair preserves identities and creates no authority; native effects are not rolled back.

### 7. Unify mixed and external entry with reservation ownership

Retain managed placement gates/leases, private Chain roots, ordinary ancestor COW, and source-version transfer. Entry permits mixed branches and grants no mutation authority. No eager selected-subtree copy is required; actual managed mutations perform their normal COW.

Preserve placement presence through entry setup and publication. Initialize a missing target as an absent private root placement; normal reads yield undefined, while assignment of undefined establishes presence. A delayed no-op callback must not create a missing record key or Array element. Reuse ordinary placement/version transfer for presence, value, source version, and recovery state; add no entry dirty flag or comparison against the initial value. Extend capture/fork/transfer, logical traversal, publication, and index maintenance together so absent completion cannot become a present undefined edge. Deletion follows the original reference: property deletion removes the placement, preserving Array holes and length, while original Chain-root deletion produces null even through nested entry. Phase 9F-C completes preservation of that reference origin and transparent target selection.

Detach settled absent versions from live owner metadata after their last already-issued writer finishes only when removing the overlay exposes the same logical absence, or its authority has moved to another representation. An overlay still masking stale physical storage is current logical state, not settled-placement history. Readers retain captured versions independently. Bound retained owner slots to required logical overlays and unfinished publication dependencies, without deferred cleanup queues. Verify repeated absent entries, COW copies with captured consumers, and queued prefix failure followed by repair for record properties and Array holes. Test replacement/deletion behind a gate that publishes never-settling data, multiple queued replacements with intermediate observations, and failed replacement retaining that pending publication for repair. Phase 9F-C applies the same retirement condition to metadata-only protection and publication.

Select entry protection through the reference anchoring defined in Phase 9F-C; ordinary gates and private placement transfer implement the resulting managed reservation. Determine caller-relative replacement semantics before rebasing, and preserve context-tree coordinates and original source-static provenance. Each contained command uses ordinary mutation selection, publication, and repair with its own context and scope. Array index creation can establish length before final element publication; keep those dependencies separate and preserve growth after deletion. No placeholder commits growth, no entry gate broadens mutation authority, and no callback-wide rollback is introduced. Ordinary version transfer carries pending presence through export, enumeration, receiver preparation, and controlled Array callbacks. A sparse-preserving callback skips an element that remains absent; dense copying produces explicit undefined where native semantics require it. Presence publication need not await ordinary pending element data. Dense copies select retained positions before waiting, discard unused dependencies, and retain receiver/payload protection until output ownership is established. Phase 9F-C owns the shared anchoring, growth, and logical-placement changes; retain these common transfer and lifetime obligations.

An entry reserves its external subtree in the current ordering view. Every read-only entry uses observation coverage, including an external root; every mutating entry uses exclusive coverage. Managed read-only entry additionally leases its captured root where needed. Entry transfers complete placement/recovery state for ordinary inspection, permitted replacement, and explicit repair. Contained commands retain their normal poison and binding checks. Entry grants no mutation authority or callback-wide rollback. Phase 9F-C completes transparent reference anchoring, deferred application-target validation, and command-owned failure attribution using these placement and reservation mechanisms.

Use a covered reservation view for contained commands, with the same frontier algorithm and original tree locations. Earlier outside work is captured by the outer reservation; later conflicting outside work waits on it. Contained work does not rejoin that later queue. Nested entries reserve within their parent's view and retain their own lifetime. Store only actual covered authority/provenance and pending frontier state; no duplicate native operation queue, scope scheduler for managed data, or copied registration tree.

Publish the entry's outer reservation before waiting, then wait for captured predecessors before invoking the callback. The private view must not bypass those prerequisites. Actual contained access checks selected binding and scope poison; unused references do not suppress callbacks. Empty prerequisites add no Promise/microtask. Apply the same rule in nested views and both entry modes; do not recapture later managed namespace state or wait for unrelated managed descendants.

Use section 3's reservation turn. Each contained command with selected external coverage acquires its one reservation for ordering and entry completion at issuance, before managed gates can wait. Its completion waits for predecessors plus required local effects and boundary processing. Remove completed membership promptly. Callback closure stops issuance and captures its root subtree frontiers, which cover unfinished reservations directly or through replacing reservations, including already-issued nested entries. Keep no separate entry-effect registry. Independent nested results do not extend access. Publish the managed root separately through ordinary versions, preserving ready sibling access while native child effects remain pending. Structural widening of an element entry's managed gate does not widen its native coverage.

Transfer complete placement state into and out of the entered root, including presence, a preexisting Error, retained baseline, and captured source version, through ordinary version transfer. A visible value or Error alone is insufficient. Cover nested entry and deferred publication without replacing a contained operation's baseline with the entry-start value; canonical namespace references must follow the same publication. A failed mutation followed by repair restores its retained presence, while successful earlier commands stay committed. Keep recovery data outside Errors and outside the public gate payload.

Remove contextual external binding gates, owned-gate dependency/bypass traversal, and parallel unfinished-scope indexes once covered entry views and correctly captured managed placement state replace their behaviors. Do not retain a late live-gate rescan or combine managed root publication with the external view's all-effects completion. Reuse normal Chain representation; readonly/closed checks remain at common issuance boundaries.

### 8. Preserve boundary and import behavior

Keep ExternalAccess responsible for native suffix traversal and result conversion; PathOperation owns route selection, reservation, and final scope effect. No second reservation is acquired while walking a native suffix. Reads use logical snapshots when they reach managed sources; native methods cannot directly use those sources as receivers. Once a path crosses managed storage, reject writes/deletes and mutating calls through all subsequent native descendants. Reject the mutating path at the first managed crossing rather than carrying another route flag; no later external container may restore mutation authority. Observation-only reads and supported calls keep their ordinary behavior. Do not use prior admission alone as an ownership test or add an alias registry.

A supported observation path can cross external to managed to external to managed state; it cannot switch readers only once at the first managed identity. Keep per-identity category dispatch and the existing native-access/capability checks at each relevant crossing. Managed reads use logical placements, and reaching managed storage still grants no native call/write authority. Retain the compact traversal unless splitting it demonstrably removes logic instead of creating mutually dispatching walkers. A shared thenability probe is optional only if it removes real duplication: it must be non-consuming, preserve Error/Function/admitted-category precedence, keep the causal reflection and managed-snapshot/native-path failure kinds, and never invoke then, admit a source, or await an intermediate value. Revert the extraction if its policy arguments or adapters cost more than the duplication it removes.

Apply capability validation before snapshotting registered identities at any depth. With nested registration, extracting apis.db.config as data fails with ExternalCapabilityEscape when that node is registered; reading a scalar through its canonical route remains valid, while an unregistered supported sibling retains detached-copy semantics. Managed-parent lookup may retain inert aliases without granting authority. Observation failures do not add scope poison. Document these read consequences beside registration, not as a second snapshot mode.

Native arguments and assigned values use common export. An Error-valued RHS causes no native write and poisons its selected scope. Native write/delete false and throws preserve action-specific kinds; a setter is invoked once without readback. Method receiver results that expose registered mutable identities fail capability checks after any completed effects. An independent ordinary result Error does not retroactively poison successful mutation publication.

Keep atomic ready-only mutable property snapshots, direct-Promise availability, nested-Promise rejection without subscription, logical managed/ArrayView reads, aliases/cycles, prototypes/Functions, complete discoverable Error collection, and no source admission before copy selection. Observation-only property import stays distinct. Snapshots never poison on observation failure.

Capture native snapshot key candidates before inspecting individual descriptors. Exclude Symbols and non-index Array keys before descriptor reads, and collect descriptor/read failures independently so one failed property cannot hide accessible sibling Errors. Verify failures before, between, and after Error-valued properties through both lookup and export; ignored Array properties must not be inspected.

Keep ordinary method-result import nonblocking for nested availability. Existing managed result graphs use complete placement captures, selective borrowed pending copies and ancestor propagation where result policy differs, source Error attribution, unchanged source settlement, aliases/cycles, and unchanged-branch sharing. Consume lazy descendants through ordinary source reads before applying result-specific validation. Reconcile staged fresh aliases when a later traversal edge reveals their managed ownership; property order cannot decide source isolation. Preserve invocation attribution for raw Errors newly produced by native mutation. Preserve presence and recovery baselines in those copies and when captured versions settle; repair of a copy remains isolated from its source. Standalone Errors and newly created result-boundary failures gain no recovery baseline. The host relinquishes mutation of returned managed data. No new ready-only result limitation, whole-result await, or automatic native receiver snapshot is introduced.

Reuse lookup's underlying sharing, logical reads, and captured-version helpers for admitted result data; do not call public lookup or add a Chain/path owner merely to retain a result. Keep transactional fresh admission and result-specific validation distinct. Selective pending-container and ancestor copies preserve source/result differences, aliases, cycles, and unchanged-branch sharing. A common capture helper is justified only where it actually removes duplicate semantics; add no general policy walker, unconditional graph copy, or full-result wait.

Share the containing operation owner for path export and other identical lifetimes. Preserve separate output release, receiver publication, entry closure, query finality, and independent result processing. Close work only after required effects/collection and preserve common fatal handling without cancellation.

### 9. Cut over and remove superseded mechanics

Replace all public external lookup, expression extraction, Error-query, export, assignment/deletion, call, repair, and entry routes together once the kernel is proven. No public result registers duplicate fatal rejection ownership. Existing graph Errors remain nonthenable; expression extraction retains its ready PoisonedValue/pending-rejection distinction.

Delete obsolete first-boundary-only tree selection, leaf-only location assumptions, reader counters/cursors, binding gates, duplicate poison transport, recovery side stores, and dependent-gate bypass/index code as each replacement lands. Do not delete static binding checks, normal managed property versions/COW/leases, immutable outputs, borrowed-result copies, or mixed-entry lifetime handling. Keep source/architecture terminology aligned and remove unused tests only when they pin a superseded representation; migrate semantic regressions to the new public behavior.

Audit behavior and retained state, not just old symbol names: depth/dynamicDepth/capturePathOrigin must not conceal an owned-gate bypass or parallel scope index. Derive observation-versus-mutation selection explicitly from the operation mode; remove comparisons that rely on undefined arithmetic yielding NaN in path-operation.js. Native child topology, Symbol metadata, repair producers, and entry effect membership must all use the final representation.

Treat net simplification as a measured outcome. The new ownership rule removes successful mixed mutation composition, while nested scopes add hierarchy and entry views. Compare code/state and full integration behavior; do not claim all old gate code removable until the tests establish that. Retain no prototype modules, adapter routes, or audit files after the final implementation.

For optional simplification candidates, compare the integrated result against the working implementation on concept/state count, execution paths, cleanup obligations, source size, and relevant copying/retention costs. Keep only a demonstrated improvement; revert an unsuccessful candidate without reverting required semantics or the bounded-retention fix. Delete rejected code and temporary comparison fixtures in the same phase.

The following focused candidate remains an evaluation, not a missing semantic requirement or mandated rewrite. Check the current code before experimenting, and remove it once resolved:

- Borrowed-result import: evaluate whether consuming authoritative source captures can reduce fresh-versus-borrowed reconciliation while keeping result-specific validation writes confined to the result. Preserve lazy admission, both alias traversal orders, cycles, original source settlement, selective copying, and ready progress; reject a replacement that needs repeated graph traversal or a whole-result wait.

### Verification

#### Discovery, authority, and fixed structure

- Register external parent and child scopes from one finite compiler tree; verify safe property names, external branches with metadata and children, managed endpoint pruning, no native subtree enumeration, and no getters/thenables during discovery.
- Throw from a Proxy descriptor read beneath a registered external parent during nested discovery. Assert ImportReflectionFailed with the import operation context, no partial admissions/tree/binding changes, and unchanged prior bindings. A native ownKeys trap that throws must remain uncalled when compiler-named descriptors suffice. Exercise safe child names on nested branch scopes.
- Skip synchronous/fulfilled thenable routes while ordinary import still works. Register requested native objects as external without reclassifying previously managed identities.
- Preserve atomic duplicate-path rollback, cyclic selected aliases, context/context conflict, context/regular import permutations, inert aliases, no retroactive output failure, and no late node creation.
- Before any native use through the original context, copy a managed parent and attempt external property reads, observational calls, mutating calls, assignment, and deletion through the copy. Every attempt must fail locally without native effects or poison at the canonical location; subsequent canonical use succeeds. Repeat with an alias imported before context registration, and keep authorized entered routes valid.
- Enforce static provenance at nested scopes, including ready computed keys, dynamic unregistered suffixes, entered route rebasing, and deterministic mutation-failure scope. Keep unrelated dynamic managed/observation-only paths valid.
- Reject runtime replacement/deletion/remapping of registered nodes and connecting paths, while ordinary native child replacements and managed sibling changes remain valid. Host replacement of a committed identity is outside the support boundary and has no diagnostic guarantee; retain no misuse-specific tests.
- Default native assignment/deletion selects the containing receiver's deepest registered scope, not a registered final value being replaced. An explicit ancestor prefix still widens that scope. Verify that a refused fixed-binding write waits for earlier sibling work, poisons the containing scope, blocks later siblings, and cannot be repaired by clearing only the child. Repeat through entered routes.
- Compare canonical services!.count rejection with ordinary services.count assignment and controlled copy!.count success where copy retains an inert db alias. Cover deletion, controlled Array remapping, shared/COW copies, and an unused pending alias. Do not traverse or await unrelated data or add retroactive scope poison when it resolves. Direct off-path external use still fails locally; native managed receiver preparation and callback/export capability checks still reject the alias without poisoning its canonical location.

#### Ordering and entry

- Exercise config.init and db.addUser overlapping, then parent reset waiting for both and blocking later children. Repeat all read/write combinations at equal, ancestor, descendant, and sibling scopes.
- Consecutive ready external calls with no pending conflicts run native actions before issuance returns; empty/completed frontiers add no Promise wait. Repeat after a prior pending phase drains, and verify cleanup never drops a genuinely pending sibling or ancestor.
- Queue native work, repair, invalid mixed mutation, and replacement behind a mixed entry's managed gate, then issue an equal/ancestor entry or ancestor Error query. Preserve issuance order, Error membership, and termination, including release between issuances and nested views. Existing path captures must not acquire later gates. Check both overtaking and unnecessary sibling blocking.

- Reserve native command N behind an earlier native predecessor, then issue mixed ancestor entry E so its managed gate and external reservation wait behind N. Settle the predecessor and verify N finishes before E starts; N must not acquire E's later gate or poison. Repeat with namespace failure/repair, and verify permanent binding conflict is still rechecked before native access.
- A parent observation waits for child writes and excludes later child writes, but overlaps child observations. Waiting child operations participate in captured frontiers before they start.
- Cover pending RHS export, method arguments, direct Promise results, rejected input, snapshot failure, and later ready operations; none may overtake an earlier reservation.
- Fail managed-prefix reflection after an external reservation is acquired. Preserve placement-only poison and the original Error; do not poison the unreached native scope or acquire a wider reservation. A ready local failure may be exposed before predecessors finish, but later repair/native work must still wait for those predecessors. Preserve earlier leased namespace captures and fixed bindings.
- Traverse external, managed, then external state through both direct and deeper aliases. Reject writes, deletes, and mutating calls at the managed crossing, while supported reads still return detached snapshots. No native mutation or downstream property access may occur after that rejection.
- Issue a native-bound command inside an entry while an earlier managed gate delays its route, then close the callback. The outer reservation must still cover that command when it later reaches native access. Repeat with selection poison and an independent pending result.
- Query an external parent, queue a parent mutation, and ensure collecting child metadata does not acquire a reservation behind that mutation.
- Keep one external child indefinitely pending while thousands of independent sibling operations finish. Completed records and cumulative aggregate Promises must not accumulate at ancestors or in entry lifetime tracking. Verify exact membership cleanup, fixed captured waits, no self/later dependencies, and bounded state for repeated ready/pending readers and serialized writers.

- Queue thousands of same-scope writes behind one pending operation and verify linear captured dependency count. Compare mixed observation/mutation traces at ancestor, child, and sibling scopes with the conflict relation. Cover strict-ancestor entries that must survive pruning, readers that must not replace writers, view-local replacement, and completion after membership was already pruned. Enclosing entries still wait for every required effect and Error publication; frontier removal alone releases nothing.
- Enter a mixed branch for reference arguments and delayed control flow; contained invalid mixed bang poisons but runs no method. Entry at a.x leaves a.y ready under shared/imported/COW ancestors.

- Enter an absent record property and absent Array indexes (in-range hole, at length, and beyond length) with ready and delayed no-op callbacks. Preserve own-property presence, Array holes/length, and earlier captured outputs. Explicit undefined assignment creates a property. Cover nested entries, failed contained mutation followed by repair, and an earlier successful command followed by failure.
- While an Array-index entry is pending, compare length-only knowledge, final presence, value readiness, and structural/whole-value dependencies according to Phase 9F-C. No placeholder length is observable. Check no-op hole completion versus explicit undefined in export, enumeration, indexing, and controlled Array callbacks. Exercise shared/imported ancestors, ArrayViews, fixed external siblings, and deferred root publication. Readonly absent-target entry creates no placement or structural growth. Cover pending owner work followed by a structural operation and a third owner operation, with intermediate captures and without diagnostic observations. Compare direct, entered-target, entered-owner, and nested routes across failure, repair, creation, and deletion; replacement/deletion can discard never-settling ordinary data. Include private/shared/leased/imported Arrays, supported Proxy storage, and nested entry outliving its outer callback. Preserve local element poison and its captured baseline, committed Array growth, broader explicit scope recovery, and fixed bindings. While dense copies await presence, mutate a retained sibling or payload and verify the earlier output stays unchanged. Cover ready/synchronous/deferred payloads, copied/nested gates publishing pending data, discarded unresolved positions, explicit undefined versus holes, and lease release before ordinary element data settles.
- Exercise child entry, later parent entry, then more commands from the child; no deadlock or overtaking. Preserve nested entry after parent closure and native command order after mixed root publication.

- Queue read-only and mutating entries behind a pending external mutation; an immediate contained read must see the completed predecessor state. Repeat in nested views, with ready/synchronous delivery, predecessor failure at the selected scope, strict-ancestor poison, and selected-binding conflict. The callback can remain a no-op at any poison or invalid binding; actual contained access preserves its blocker and skips native effects. Verify reservation release without adding descendant poison or taking later managed gates.
- A ready managed sibling remains available while native child effects are pending. Closing the callback alone does not release native coverage; an independent nested result does not prolong completed effects.
- Test read-only mixed and external-root observation coverage: observations overlap and conflicting mutations wait. Cover nested readonly capability, deepest registered entry selection, and invalid native-property entry.

- Enter an already-poisoned managed target through direct, pending, nested, and compiler-style reference/control-flow routes. The callback can inspect and, when mutable, repair or replace it; strict-ancestor poison still prevents entry. Preserve incoming and outgoing recovery state and canonical namespace references.

#### Managed rollback

- For assignment/deletion, controlled Arrays, and native managed methods, compare ready, synchronous custom delivery, and pending success/failure on private, shared, leased, imported, indexed, and versioned values. Success publishes changes; failure followed by repair exposes the identical pre-operation logical state, independent of COW history.

- Compare receiver-at-scope and deeper-receiver calls, including root scope, through ready and pending managed values. Keep one correct scope publication, original attribution, and unaffected siblings; a failed prefix poisons only its prescribed reachable owner and never invokes the method. Reject a mixed managed bang before native work, while valid external scopes retain their own mutation route.
- Mutate several fields then throw, reject, return Error, or fail receiver validation, including stored Promise/Error and unsafe then. Discard the failed receiver; repair exposes valid baseline state with original aliases, cycles, prototypes, Array holes/length, and permitted external leaves. Never retain that receiver inside an Error.
- Fail during copying, supported Proxy reflection/write, Array replay, and final ancestor publication. Preserve the baseline without recopying the failing target, keep required independent Errors, and retain fixed resources. No failed private write changes another owner.
- Queue mutation behind earlier pending work. Its rollback baseline includes earlier effects and excludes later ones. Retained nested Promise versions settle with original attribution; rollback neither cancels nor rewinds source settlement. A ready sibling must not await an unrelated baseline property.
- Give each managed mutation queued at a pending placement its own publication version, retaining direct source availability and synchronous thenable progress. Preserve the producer's pending publication across copies so a settled source signal cannot cause repeated subscriptions while later work is unfinished. Compare whole-container replacement, a queued method, a property write/delete or element entry, and a later method/observation across individual microtask turns. Cover records, managed classes, and Arrays, structural poison and repair, earlier captures, and independent pending results. Issue observations between scope publication and the next write; lookup, export, expression lookup, queries, observational methods, and read-only entry must retain their earlier state even if they resume after that write. Protect captured transition values before publication through the common version mechanism. Predecessor delivery cannot expose ready state before the queued mutation takes its turn. External receiver selection observes managed prefixes and keeps its existing reservation ordering.
- Queue two and three independently pending Array length assignments before mutable entry, nested entry, or a contained mutation. Vary settlement order, rejection, native Promise versus synchronous thenable delivery, and earlier copies, views, and borrowed results. Assert intermediate event-loop progress while later inputs remain pending, correct sparse shape and recovery, capture isolation, and no fatal outcome. Bound livelock regressions in a subprocess with time and heap limits.
- Fork a root before admitting its descendants, then perform healthy repair, scoped no-op deletion, or no-op mutable entry before a later write. Both owners retain every reused child of a copied container, including the path child and future Promise fulfillment. Cover records and Arrays, raw lazy and imported data, pending initialization and assignment, and direct/nested entry deletion. Do not observe/export the fork before the mutation; that can admit or share the child and hide an isolation defect.
- Cover failed Array index creation and intrinsic structural failure separately under Phase 9F-C. Element poison retains its absent baseline and committed growth; repair restores a hole. Intrinsic or explicitly broader Array failure retains the complete Array baseline. Cover empty/nested Arrays, ArrayViews, captured pending elements, in-range holes, and unchanged aliases. No ancestor receives duplicate poison. Ordinary sibling appends remain valid when they preserve fixed external locations; failure and repair preserve those bindings.
- Delay actual structural mutation, issue later conflicting work, then fail and repair. The structural owner must have been selected and gated before any length change; repair cannot erase later successful effects. A successfully published Promise-valued element and an independent pending removed-element result retain their ordinary availability without prolonging completed structural work.

- With fixed external indexes, allow Array growth and truncation that preserves every registered placement; reject removal or remapping of one. Cover ready/pending length conversion, shared/leased parents, explicit broader scopes, and ordinary record properties named length. Check that routing does not capture the RHS twice, lose its lease, or confuse the structural owner with external authority.
- Preserve earlier successful commands inside enter when a later command fails. Successful controlled removal returning an Error remains committed; independent ready/pending result validation does not undo a successful receiver. Explicit Error assignment remains ordinary data.

- Exercise a selected mutation with independent healthy, Error, and pending results, plus publication failure combined with an independent result Error. Receiver publication and baseline release finish at their own boundary; all required result Errors survive. Returning the actual receiver establishes lasting sharing, and a later mutation cannot change the returned value. Keep selection/argument/export failures as ordinary Errors until their applicable mutation owner handles them.
- Replace/delete a never-settling old managed target without waiting or consuming that old input solely for rollback. Retain an existing version without rebinding attribution; after a failed overwrite and repair, preserve old presence/absence and original availability.
- Repair a raw or normalized Promise baseline behind a preceding entry. Repair completes after restoration publication while the old value remains pending; later fulfillment or rejection follows ordinary availability and preserves established source attribution. No helper assumes that an unconsumed baseline already has a Promise version.
- Fail a root mutation inside an entered Chain, close it, then repair through the outer Chain. Repeat nested entry, a pending private root, and ready independent callback results; transfer the contained mutation's exact baseline, not the entry-start state. An Error obtained by lookup/getErrors and stored elsewhere carries no recovery state.

- Fork a managed container containing scope poison, repair and mutate one copy, then repair the other. Each restores its own logical baseline and original versions; extracted standalone Errors carry no recovery state.

- Fail a managed mutation, issue several blocked calls/writes through its poisoned scope, and repair once. Restore the original logical baseline, presence, and source version with the same Error attribution throughout; no nested recovery record or Error-as-baseline remains. Cover ready/pending routes, ordinary Error data without recovery, and a healthy scope whose preparation consumes an existing argument Error and therefore does require a new failure effect.
- Cover failed prefix selection, root and primitive-valued scope placements, ArrayView-backed placements, repair then failing repair-and-call, and final replacement/deletion of scope poison. Old cleared Errors never reappear; independent earlier failures remain. No snapshot/log survives after its successful operation unless another owner retains it.
- Measure copies and peak retained state for large mostly unchanged managed receivers and short controlled writes. Use existing full-graph/native and path-COW mechanisms; retain no duplicate isolation walk, rollback coordinator, or experiment files merely to optimize speculative cases.

  Verification measurement (Node 24.14.1): an imported receiver containing a root record, a 5,000-element Array, and 5,000 child records has 5,002 managed container identities. A native mutation changing one scalar creates 5,002 isolated containers, with 10,004 distinct baseline/working containers simultaneously reachable during invocation; ready and pending direct results produce the same counts. Controlled assignment to that scalar creates three path copies, for 5,005 simultaneous baseline/output containers. Successful publication leaves no recovery record on the root placement. These are container identity counts, excluding bookkeeping, Promise allocations, and heap/GC overhead; they confirm one complete native isolation copy versus path-only controlled COW, not a general heap benchmark. No measurement fixtures are retained.

- For preparation/copy fusion, compare ready, synchronous-thenable, and pending receiver graphs with aliases, cycles, ArrayViews, imported source versions, and multiple preparation Errors. Verify no method runs before complete preparation, earlier captures stay unchanged, and later mutation cannot change pending call inputs. Compare graph passes, allocations, lease lifetime, and peak retained state; a shorter helper is not sufficient evidence of simplification.

- Compare the retained Array baseline with any independent working storage across view, remap, and traced-intrinsic routes that survive the rewrite. Verify sparse shape, pending removed elements, alias preservation, representation constraints, and failure recovery. Ready view operations must not acquire a full-Array materialization solely to force one code path; no operation may replay changes into its protected baseline.

- Measure sparse full-range truncation and complete-remap work against present affected properties, and narrow-range work against its selected range. Cover holes versus explicit undefined, non-writable/non-configurable storage, captured pending elements, indexed Arrays, and supported reflection/publication failure. For attachment-protection changes, retain the Promise-cycle, pending-query, ancestor-replacement, and deferred-path integration cases; compare repeated assignments of an already admitted ready graph without pinning private flags or exact incidental reflection counts.

#### Poison, repair, and captured values

- Child poison blocks whole-parent work but not healthy siblings; strict-ancestor own poison blocks all descendants unchanged. Blocked attempts create no extra Error or child poison.
- Combine own and multiple child Errors at an external subtree, deduplicating overlapping compounds without loss, including query while selected root owns poison. Query no native properties and retain hasError short-circuit semantics.
- Register a competing context after the first tree already has healthy summaries; ancestor hasError/getErrors must see conflict in both contexts without a reverse alias index. Repeat a third registration and repair; permanent conflict remains visible.
- Repair an external child through a derived ancestor summary; reject bypass of ancestor-owned poison. Repair of an external parent clears every repairable external descendant. Permanent conflict remains and summaries update before successors resume.
- Fail supported preparation and publication during managed repair, including ancestor COW/index work and a scope covering external poison. Assert the original Error, complete baseline, and external Errors remain intact, no callback runs, and a later successful repair restores atomically. Cover ready/pending restoration, indexed and captured placements, and absent baselines; dependants must see either the prior poison or the complete repaired state.
- Refuse restoration storage after repair waits behind an entry. The repair result contains the new boundary failure while the original placement poison and baseline remain unchanged, matching ready repair. A repair-and-call publication failure instead retains its repaired baseline and cannot resurrect cleared poison.
- Repair-and-call clears first: ready/pending preparation failure and method throw/rejection poison only with new Errors. Repaired old Errors never reappear. Repair-only invokes no native method or external-resource read/write. Ordinary managed path selection, COW, and required publication/index preparation retain their existing supported-reflection failure boundaries; preflight must finish before clearing poison.

- Cover healthy and absent managed repair, an ordinary Error without recovery state, ready and pending scope poison, an invalid selected binding, and descendant permanent conflict. Assert exact results, no unintended property creation or managed subtree traversal, and no call when repair returns an Error.
- Poison/repair a managed scope while an older lookup, entered snapshot, or placement capture retains its previous state. Neither guard installation nor clearing mutates that earlier logical value or Error. Retain pending source versions and causal context.

- Poison a canonical managed namespace containing fixed external resources, retain a copy, then force canonical ancestor COW through an unrelated sibling write. Repair the canonical namespace and verify native access resumes while the copy retains its Error. Reverse the repair order: repairing the unrelated copy must not clear canonical protection or grant native authority. Repeat through nested entered-root handoff/publication and captured pending versions; already-issued native work retains its original ordered namespace capture.
- Preserve fixed resource identities after invalid mixed-scope rejection and supported ancestor reflection/publication failure. Verify ordinary final Error replacement separately from guard repair.

- A valid external mutation through a healthy managed prefix must not copy that prefix just for selection. Fail supported prefix reflection with shared/leased ancestors and with a preceding managed gate: publish the prescribed recoverable placement effect without changing earlier captures, losing retained fixed identities, invoking native work, or waiting for unused suffix inputs.

#### Boundary and lifetime regressions

- Compare canonical scalar lookup beneath a registered native child, direct extraction of that child, and snapshotting an unregistered sibling. Include a nested registered identity inside an otherwise copyable snapshot result. Reject capability escape before copying its interior, preserve local observation failure, and repeat through authorized entered routes.
- Preserve ready-only snapshot copies, ArrayView logical keys/length/holes, aliases/cycles, prototypes, complete Error collection, no partial admission, no pending nested subscriptions, and independent output identity.
- Preserve nonblocking fresh and already-managed nested method results, borrowed-result source version/attribution, unchanged branches, source/result isolation, and deferred capability rejection without extending the completed receiver reservation. Borrowed gates retain publication separately from data availability through the result's validated version. Verify dense Array copies after deletion, progress when publication installs pending data, and result validation after failed replacement and repair; no consumer may follow unchecked source publication instead.
- Borrow a managed container while a missing record property or Array hole is gated by entry. No-op completion remains absent in both source and result; assigning undefined establishes presence. Preserve aliases and presence-sensitive Array operations, without transferring private recovery state through the result boundary. A queued mutation through the absent placement produces ordinary poison, and repair restores absence without a missing-property fatal.
- Retain setter/no-readback, write/delete false, export failure before native effects, getter/direct-result failure kinds, independent result/publication Error union, and native receiver escape after effects.

- Observe external-to-managed-to-external-to-managed paths through logical versions, including ArrayViews and repeated crossings. Reject direct calls/writes on managed receivers and off-path registered identities. At a native intermediate or managed snapshot placement, reject both pending and synchronously delivering thenables without invoking then; preserve their distinct failure kinds. A final native property Promise retains its normal availability contract. Cover reflection failure and confirm observation errors add no scope poison.
- Verify query closure does not acquire unused reservations, already-reserved work releases normally in a live execution, discarded pending work remains handled, and fatality stops before further native work/publication without settling internal gates.
- Run the full existing integration suite after migration. Update assertions for accepted hierarchical scope and recursive-repair behavior, not to conceal regressions in ordering, source isolation, or Error completeness.

## Phase 9F-B: Consolidate placement transitions and capture ownership

**Status: implemented.** Placement capture, version construction, producer tracking, and complete publication share the property-version module. Observation capture declares protection explicitly; continuation ownership only controls local work. Public semantics and the 9F-A fixes are preserved.

**Consolidation results:** three producer-specific version-construction implementations use one constructor; five pending-publication registration sites use one tracker; continuation-based ownership inference has been removed. Mutation walkers publish complete placement state without editing version fields first. Import keeps raw-input subscription and transactional admission while reusing captured-source resolution and version bookkeeping. Sharing import admission with ordinary consumption was rejected because it commits admission before segment validation. Import staging and complete commit keep distinct field updates: staged presence can precede data delivery while preserving an unfinished validation transition. Generic placement updating and both placement-outcome and uniform mutation-outcome record experiments were tested and reverted: they added field-preservation instructions, conversions, or continuations without removing producer or caller responsibilities. The natural invocation outcome and placement-aware publication boundary remain.

**Validation:** 1,810 tests pass with strict unhandled rejections (`npm test -- --reporter dot --timeout 15000`). The ownership matrix includes both lazy and previously observed children. Direct and nested entry publication failures remain visible to lookup, export, and Error queries and preserve repair state for records and Arrays; nested entry publication still releases replacement before pending data settles. The normal suite explores 64 distinct seeded schedules in a time/heap-capped subprocess; an extended run with `CASCADA_SEQUENCE_SEEDS=128` passed 512 schedules. Independent expected snapshots detect overtaking, lost poison, and sparse-shape corruption. Repeated capture/failure/repair/replacement checks bound live bookkeeping while an unrelated retained input remains pending. The two large structural sequence tests exceeded the default two-second timeout in the unchanged baseline; the longer timeout accommodates their bounded workload.

### 1. Map responsibilities and establish the shared contracts

Inspect every constructor, writer, transfer, and consumer of placement state, including property-versions.js, import-processing.js, mutations.js, observations.js, managed-traversal.js, entry, Array remaps/views, and boundary result capture. Include outcome producers and consumers in path-operation.js, run.js, external-access.js, managed-invocation.js, and array-invocation.js. Use a compact working inventory to identify who owns source consumption, complete state capture, retention, producer progress, installation, publication, and release. Distinguish duplication from necessary staging, boundary-validation, or lifetime differences; a direct field assignment in unpublished import staging is not by itself evidence of a second protocol.

Use capturePlacement/capturePlacementFromVersion for complete logical state, createVersionFromPlacement for destination construction, resolvePlacement for captured delivery, and trackVersionPublication for the producer returned by a subscription. Transfers, queued mutations, and borrowed-result preparation reuse those mechanics. observePromiseVersion owns observation protection; continueCapturedPromiseVersion owns continuation only. Keep semantic placement contents, version-local control state, and identity metadata distinct: a fork needs its own version and publication authority, preserves its destination's capture obligations, and follows the appropriate source dependency. Copying a complete logical placement does not mean cloning every internal flag, source publisher, lease count, or installation fact.

Use these invariants to choose the implementation boundary and consolidate their wording in AGENTS.md and the relevant architecture documents:

- **Establish order before suspension.** Capture known predecessors and reserve known conflicting effects before waiting. Within one ordering view, later conflicting operations cannot become new prerequisites of earlier work. Parent completion may still depend on its contained work in a private entry view. FIFO subscriptions preserve the dependency order already established; callback order alone does not order work handed to another Promise.
- **Capture complete logical state.** A placement includes presence, visible value or captured source version, and recovery state. Preserve the dependencies and retention obligations needed to advance it. Lazy admission is not evidence of fresh ownership. Array length and holes remain structural facts of the Array owner.
- **Protect before publication.** When another logical owner or unfinished reader needs a value, establish its protection before later writers can access it. A pending capture records the corresponding obligation for its future value. Publication without such a capture does not imply permanent sharing.
- **Publish through captured authority.** Deferred work advances its captured version. It may update live storage only while that version remains installed; detachment removes live publication authority without invalidating earlier captures. Select the owner of all affected structure before effects and preserve it through completion.
- **Wait for actual progress.** A continuation either consumes advanced logical state or waits for the producer that can advance it. A settled source signal cannot substitute for unfinished producer publication or justify polling. Preserve direct source consumption for supported synchronous thenables.

These contracts need shared enforcement, not extra validation of trusted records, caller checklists, or a new global scheduler. Preserve the distinctions between source availability, required transition publication, and an independent operation result; no single completion Promise may silently replace them.

### 2. Consolidate the version lifecycle

Start from capturePlacement, retainPlacement, transferPlacement, the guarded version continuations, and the existing atomic commit machinery. Evaluate a focused rewrite of their shared lifecycle and the corresponding caller sections. Centralize duplicated construction, advancement, producer-dependency handoff, and installation/publication mechanics in property-versions.js where that removes caller responsibility. Callers supply semantic work or prepared placement state, rather than independently maintaining the shared version protocol. Keep ready paths ready and allocate pending machinery only when the relevant returned continuation remains pending.

Initialize callback-visible staging before subscription; a supported custom thenable can deliver before then returns. The same staged state must support synchronous completion and later installation. Preserve fixed overlays for unchanged imported storage, independent versions for captured copies, atomic storage/index publication, detached-version settlement, original Error attribution, and complete presence/recovery transfer. Keep supported physical-storage failure handling distinct from runtime defects. The mutation coordinator still chooses the failure owner and rollback baseline; a shared commit must not guess those policies from a payload Error.

Every complete placement record carries an explicit Boolean presence at construction and transfer boundaries. Normalize internal version defaults when constructing that record, and preserve absence independently of an undefined value. Internal versions may retain a documented implicit-present default; this does not require redundant fields on every version or runtime validation of trusted records.

Preserve each capture and subscription's program position. Distinguish non-consuming placement capture from reading/normalizing a value and from waiting for an unfinished transition. Replacement, deletion, and rollback capture must not subscribe to or await an unused old value merely to obtain a uniform record, including a raw Promise without an existing version. Repair may restore that pending baseline without waiting for its data. Likewise, enumerating Array placements is not value consumption: preserve lazy capture at the method's actual read or transfer point and do not subscribe to discarded elements. Reuse already-consumed fixed outcomes without probing the original thenable again.

Keep future consumers attached to the relevant producer without adding redundant observers or a second completion transport. Once a dependency can no longer affect delivery, publication, or a retained capture, release its operation-only references; an installed settled version must not accumulate historical producer/operation chains. Keep reactions that still serve detached captures and rejection ownership valid. Do not cancel source Promises or infer that source settlement alone proves those dependencies obsolete.

The importer retains ownership of transactional admission, segment staging/commit/abandonment, source/result policy differences, and processing newly available segments. Share generic version mechanics without making the version module choose import policy, import graph data itself, or orchestrate import segments. Do not replace staging with an eager transfer that commits before validation: admissions, import-owned sharing/retention changes, and result versions remain staged until the segment succeeds. Ordinary source normalization required to consume a borrowed placement remains independent source work. Abandoned result work cannot publish, while independently owned source settlement remains valid. Preserve selective borrowed-result copying, lazy descendant ownership, aliases/cycles, and unchanged-branch sharing without awaiting the whole result or copying it unconditionally. Following a borrowed transition's publication, including during repair or further copying, must still pass through the result's validation; it cannot expose an unchecked source placement as the result's completed state.

The evaluation concerns concrete placement-protocol duplication in the current producers. It does not authorize redoing an unrelated import restructuring experiment or moving code solely to obtain a different module layout. Add no canonical settlement Promise, subscriber queue, ImportTransaction, second overlay store, policy-driven walker, or compatibility adapter.

### 3. Make capture ownership explicit

Express retention, temporary borrowing, and ownership transfer at their existing semantic boundaries. A retained capture establishes sharing for a ready managed value and a future retention obligation for a pending version; copies and gate handoffs carry that obligation until it is satisfied. Cover COW children, lookup and method results, entered roots, borrowed imports, and hidden recovery baselines through the same rules. Both copied parents retain every reused child, including a path child that a healthy repair or no-op may leave unchanged.

Temporary consumers continue to use leases for their actual last-use interval. Establish lasting result ownership before releasing temporary protection. A true ownership transfer need not create permanent sharing, and internal non-retaining reads must remain non-retaining. Do not replace the current distinctions with unconditional markShared on settlement, blanket full-graph leases, or another ownership registry.

Do not move capture protection into a consumer callback that may run after publication exposes the value to a later writer. Conversely, a closed temporary consumer must not acquire a new lease when an old reaction resumes; use the existing lifetime release rules without cancelling shared settlement or another capture's retention. Keep protection bounded to the captured values and relevant Promise frontier. Preserve attachment-root protection and ArrayView backing rules unless the replacement proves their invariants; per-version retention alone is not evidence that aliases, cycles resolving into a captured ancestor, or deferred ancestor writeback no longer need protection.

Remove retention inference based on the presence, type, or open state of an OperationOwner. Operation lifetime governs whether local work may resume; capture ownership governs which logical value must survive. Common guarded helpers may still use the existing owner for continuation checks. Shared settlement and required retention remain valid independently of a particular consumer's closure. Choose the smallest shared capture/transfer interface that enforces this separation without adding an owner object to each placement, parallel ready/pending paths, or a matrix of caller-specific policy flags.

### 4. Preserve complete mutation targets and boundary-specific outcomes

Trace the selected receiver, publication/rollback owner, captured version, and placement state through deferred mutation, structural widening, entry, repair, and publication failure. Reuse the existing target and placement records so the selected target carries its state through completion instead of reconstructing it from live storage. Preserve one synchronous ancestor reconstruction; deferred completion cannot replay obsolete parents over later sibling writes. Array widening selects the structural owner without broadening external authority or the explicitly selected broader scope.

Lower-level invocation produces a receiver and an independent result. The mutation coordinator accepts that outcome or an explicit placement when presence or recovery matters, then publishes complete placement state. Keep this conversion at the publication boundary rather than making invocation synthesize placement state or adding an intermediate normalized outcome. Preserve successful removal of Error-valued data, ordinary Error assignment, combined independent result/publication failures, and repair's atomic restoration semantics.

Keep the owner-rooted entered Array path and ordinary contained-command execution; add no stand-in element replay, callback-wide rollback, or special Array scheduler.

### 5. Evaluate each change and complete the cutover

Establish the responsibility inventory, contracts, and ownership regression matrix below before changing production code. Implement one complete consolidation at a time; capture ownership and version publication may change together when protection depends on both. Do not force a section order that requires temporary adapters or leaves protection until after publication. Gate each capture/retention change on the ownership matrix and each lifecycle change on the relevant publication, import, ordering, and liveness checks before proceeding. Preserve the boundary-specific mutation outcomes described above.

For each consolidation, compare the responsibilities, independently mutable facts, caller obligations, and execution paths before and after. Record relevant counts of independent version-construction and advancement sites, retention decisions/callers, and outcome shapes alongside the responsibilities eliminated. Counts are evidence, not targets: moving the same complexity into flags or policy callbacks is no simplification. Check ready-path overhead, Promise allocation, graph traversal/copying, and retained state where the change affects them; prefer focused measurements to a new benchmark framework. Keep a change only when the combined implementation is simpler and preserves the contracts. Revert neutral or worse experiments instead of retaining adapters or compensating special cases. If a material simplification requires a semantic restriction, explain the affected supported behavior and discuss it before changing the contract.

Remove superseded helpers, direct protocol-maintenance paths, obsolete options, and temporary probes in the same cutover. Preserve useful semantic regressions even when reverting an experiment; remove tests that only pin its discarded representation. Keep only a concise result and any unresolved work in this phase's completion note; do not add a separate audit-history document. Update AGENTS.md, mutation-and-observation.md, import-processing.md where its boundary changes, and the Phase 10/11 instructions to describe the retained design without contradictory alternatives.

### Verification and acceptance

Extend existing integration and sequence tests rather than introducing a new test framework. Reuse test/operation-sequences.test.js, test/fixtures/pending-structural-publication.js, test/placement-version-boundaries.test.js, and the supported-thenable, import, scope-recovery, Array, and publication-failure suites. Assert semantic outcomes and independent bookkeeping consistency, not private field names or exact Promise-chain shape. Exercise each shared primitive through more than one public route so a caller-specific bypass cannot pass only its own regression.

Supplement short exhaustive sequences with bounded seeded exploration combining capture, mutation, entry, repair, and publication. Reuse createRandom from test/native-equivalence-support.js; keep fixed seeds and explicit limits in the normal suite, with an opt-in larger run. Record seeds and count distinct command/schedule traces rather than treating run count as coverage; failure output must identify the input and schedule needed to reproduce it. Vary releases between issuances and issuance between individual microtask turns, including several independently pending inputs. Reduce discovered failures to focused regressions. Follow [the audit guidance](prompts/audit.md) for meaningful combinations and exploration bounds; passing a finite exploration does not prove the invariants universally.

Use independent expected values and event-order constraints alongside comparisons between runtime routes. For a new oracle or substantial extension, demonstrate that it rejects representative incorrect outcomes or traces. Check a new regression against its original failing behavior where practical; locally reverting production code is optional, not required for every retained regression. Sensitivity checks and combination coverage address different test weaknesses.

- Cross ready values, synchronous supported thenables, native pending fulfillment/rejection, fixed imported versions, and detached captures through ordinary reads, COW, Array movement, entry, queries, and boundary results. Include a later subscription synchronously draining earlier queued callbacks: no new subscriber overtakes an earlier one, and setup after then returns cannot overwrite state already advanced by a callback. No extra microtask is added to ready work.
- Preserve an earlier observation issued before a later write even when its delivery follows that write, and preserve retained results after delivery. Cover record/class receivers, parent and scalar captures, export, lookup, expression extraction, Error queries, observational methods, and read-only entry.
- Preserve forks through healthy repair, scoped no-ops, mutable entry on a pending placement, and a queued scope operation followed by an element write. Cross those cases with lazily unadmitted children and children protected by an earlier observation; the unobserved cases must not acquire protection accidentally through test setup. Include hidden recovery baselines. Check temporary lease release separately from permanent sharing.
- Queue two and three independently pending structural operations with captures and entries; vary settlement order and failure. Keep the bounded subprocess regression and run new scenarios capable of event-loop starvation or unbounded allocation with time and heap limits using that pattern. Acceptance requires progress when the relevant input settles while unrelated later inputs remain pending; an in-process timeout cannot detect microtask livelock safely. Preserve sparse shape, rollback, and repair.
- Preserve complete absence/presence and recovery through copies, gates, remaps, borrowed results, and entered-root deletion. Compare direct, entered-element, and entered-owner commands where their semantics agree; structural failures occur at their command's turn.
- Replace or detach a placement before an earlier consumer resumes. Earlier work follows its captured value and authority, never a later live gate. A gate publishing pending data releases completed transition ordering without making that data ready or extending the operation for an independent result.
- Capture, replace, delete, fail, and repair an otherwise unused raw pending value without inspecting or awaiting it merely for bookkeeping. Keep never-settling old data from blocking replacement or restoration. Preserve Array methods' lazy reads and skipped/discarded Promise payloads.
- Fail supported storage, reflection, indexing preparation, and boundary validation during publication. Preserve earlier captures, valid indexes, the required baseline, original attribution, and every independently required Error. Failed repair retains the prior poison and recovery state.
- Verify atomic import and abandoned callbacks, borrowed pending descendants and aliases encountered in different orders, unchanged source settlement, and result-specific validation confined to the result. Synchronous delivery joins its current segment; later committed delivery starts the proper segment without adding external authority.
- Apply a source/result validation difference to a borrowed gate that later publishes pending data, then copy, replace, or repair it before fulfillment. The source remains unchanged and every result consumer follows its validated version. Fail import after an earlier staged synchronous or pending delivery; no import-owned admission, sharing, version, or external binding escapes abandonment.
- Exercise local consumer closure and fatal resumption with pending captures. Live shared settlement still fulfils required publication/retention; closed local work performs no further traversal or effects. Fatality retains its independent outward rejection contract without an internal cancellation sweep.
- Preserve issuance-time external ordering and mixed-entry reservation views through pending managed gates. No new reservation algorithm, late live-gate scan, unnecessary managed-only external wait, or dependency on later conflicting work is introduced.
- Repeat capture, mutation, failure, repair, and replacement with both completed and outstanding consumers. Acceptance requires dependency storage bounded by live data, retained captures, and unfinished work: holding those bounds fixed must not produce growth with cycle count. Additional retained snapshots or unfinished dependencies legitimately require additional storage. Preserve cyclic attachment, ancestor replacement, and indexed ArrayView cases; use deterministic bookkeeping checks, not GC timing or a global quiescence requirement.
- Run the full suite with strict unhandled-rejection handling, explicitly including the committed sequence suites, external ordering checks, and bounded structural-publication subprocess, and invoke the existing refcount oracle through affected fixtures. Completion requires an explicit verdict for each experiment, removal of superseded code for retained changes, and clear ownership of the shared lifecycle and capture contracts. Reduced line count alone is not acceptance evidence.

### Following phase boundaries

Phase 10 uses these established placement and ownership primitives when pending path keys delay selection; it owns that new behavior and its ordering handoff. Phase 11 remains a preservation check of the resulting importer after Phase 10, not a second consolidation. Phase 13 integrates the public behavior into Cascada. External reservations, native snapshots, Array algorithms, and entry semantics receive no independent rewrite in 9F-B unless a concrete duplication in the selected placement work requires a smaller shared change.

Preserve the existing external contract in implementation and test expectations: an Array-wide bang covering registered resources, including push, is invalid while an ordinary index append may use narrower placement authority ([namespace rules](external-context-ordering.md#runtime-nodes-and-identity-validation)). Hidden access to shared mutable state through independently scheduled external routes, including an observation-only alias, violates the [host ownership contract](data-limitations.md#identity-and-hidden-state); this phase adds no alias scan or coordination for that excluded behavior.

## Phase 9F-C: Preserve entry equivalence and order Array growth

**Status: complete.** General redundant-copy elimination and logical identity across protection copies remain Phase 9F-D work.

Implemented through the common placement and structural-publication paths:

- Installed fixed and pending versions govern value, presence, recovery, candidate enumeration, and indexed edges independently of physical storage. Absent overlays retire only when physical fallback is absent.
- Single-path reference capture stops at the narrowest usable anchor, retains unavailable/intrinsic/native suffixes, and preserves original destination semantics and static provenance. Contained commands own validation, attribution, rollback, and repair. Native selection uses the runtime tree directly; the public API has no separate entry selector.
- Entry gates live in logical versions. Necessary COW isolates earlier owners without widening a selectable element/property gate. Protection itself writes no placement and does not resize backing storage. Actual commands publish through captured reference authority, including ordinary supported storage failures.
- Array element creation publishes logical growth before element completion. Potential contributions register before predecessor waits and terminate after required publication, including nested and queued entries. Record creation/deletion order uses sparse placement tokens; entering one record property does not enumerate unrelated siblings.
- Each logical Array owns an ordered length sequence with exact/range questions, passive read-only captures, and independent COW histories, as specified by [captured Array shape](array-view.md#captured-shape-and-pending-placements). Pending watchers use existing operation work and release registration. Ordinary arrays without installed versions incur no transition scan. Structural mutations retain predecessor transition dependencies separately from ordinary payload availability.
- Complete traversals capture shape and all logical candidates before suspension. Export, borrowed copies, native receiver materialization, scalar conversion, and Array consumers preserve logical presence, length, and record order. Placement-value observations use the common publication-time retention before later writers can receive the captured value. Ready-only external snapshots reject unresolved structure without subscribing. Nonnegative at uses its placement; bounded slice can use a range proof; with retains exact output shape.
- Controlled Array algorithms establish their own shape dependencies through existing preparation or capture: at/slice/search prepare their bounds; join/toString/flat/sorting finalize captured shape; concat captures remaps and waits for their required lengths while retaining input leases through output placement. Only intrinsic execution has a common exact-length preparation step. Do not precede complete capture with a redundant length wait or store slice bounds separately on operation work.


Verification: the full strict-unhandled-rejection suite passes; the new structural integration tests cover early growth, nested creation/deletion, same-index ordering, bounded consumers, record/native order, shape capture, shrink without payload waiting, snapshot rejection, optional discovery, no-write protection, and logical poison growth/repair. Phase 9F-D's known alias/cycle and mutation-through-alias gaps remain explicit below.

Entry is a reference and ordering optimization. The final contract is equivalence with the corresponding direct commands, including observable aliases and cycles. This phase delivers reference selection, values/presence, own-key order, Array structure, effects, Error attribution and repair, owner isolation, and dependency-scoped progress. Phase 9F-D owns the remaining protection-copy topology gaps and deterministic mutation-through-alias semantics. Completing 9F-C does not claim those gaps are fixed or turn them into permitted timing exceptions. Entry must not suppress conditional work, introduce a dependency cycle into covered work, or add callback-wide rollback. A branch that issues no data command leaves its placement values, presence, order, and structure unchanged, including when its requested reference cannot currently be traversed.

This phase implements one entered path with one mutable/readonly mode. Establish entry before evaluating its callback, including a slow condition inside that callback. Operations on the protected branch use the entered Chain. Coordinating separate mutation and observation path lists belongs to Phase 13, not this implementation: a callback that mutates `x.child` and observes `x.other` uses those two declared references in the future API. With the current API, one entry at their enclosing `x` can cover both through the entered Chain, at the cost of protecting that larger branch. An unrelated original Chain does not inherit entry ownership merely because the callback uses it. Add no speculative multi-path overload or implicit callback-wide routing.

This phase delivers three connected changes: transparent reference anchoring, placement-local Array failure/publication, and captured Array-length knowledge. The growth mechanism tracks only information about length; ordinary gates and placement versions continue to order element effects. Native authority remains governed by the external tree and the actual contained operation.

### Settled design rules

- Entry captures protection and a reference. Protection alone commits no data command, presence change, own-key reordering, or Array growth. Use the existing ownership and COW mechanisms for isolation; do not add an entry-specific no-op-copy or identity-restoration mechanism. Full no-op alias/cycle preservation and the deterministic mutation rule are Phase 9F-D obligations, not assumptions about what current physical COW already guarantees.
- Preserve concurrency and owner isolation. For a directly selectable managed placement, protection must leave unrelated sibling reads and mutations able to progress while entry remains open. Sharing, import protection, leases, or representation changes alone do not authorize a wider gate. Earlier owners remain usable independently. Do not broaden protection to avoid copies or to defer the element-gate cutover.
- Logical placement versions are authoritative. Keep managed entry protection in those versions; installing or completing protection must not require a physical write merely to mirror a gate or restore an unchanged source. Preserve required source settlement and earlier captures. Physical writeback is a representation choice, and failed required publication after an actual mutation keeps its ordinary poison/recovery behavior. Metadata-only protection must still isolate owners: installing a version on a shared identity must not make earlier owners wait for, or receive, the entry's effects.
- A placement commit publishes its required structural effects to its captured container before exposing completion. Creation/deletion, value, presence, recovery, and indexed edges must describe the same committed transition. Captures include earlier structural effects and exclude later ones.
- Contained commands consume and validate their logical destinations at their own operation contexts, independently of private storage keys. Required validation retains the command's selected scope and rollback/publication authority until it completes; ordinary pending data does not. Deferring unused-target validation does not remove predecessor ordering, fatal execution handling, execution-binding checks, closed-entry checks, or readonly capability restrictions. Entry setup is not unconditionally infallible.

### Common structural publication

Use the ordinary placement commit for both final placement state and the container effects of committed creation/deletion. Complete fallible preparation before publishing those facts consistently and releasing dependent work. Apply the rule to direct operations, entered private roots, nested/rebased references, copied or detached versions, and logical outcomes without physical writeback. Publish through captured container authority, never by reselecting a later container at the original path. Intermediate committed effects remain relevant even if final presence and value equal their initial state.

Array growth and record key order share this publication boundary, not necessarily a data structure. Reserve each entry's possible structural effect at issuance, before predecessor waits or callback execution: an Array growth bound or a record insertion position. Growth combines contributions with `max`; record order depends on the program sequence of deletion and recreation. A record's replacement or no-op keeps its old position; creation or recreation uses the reserved position, before later sibling creations even if they complete first. Retain only the facts each requires at its container/capture position. Do not introduce a universal event stream, entry command log, or general ordering journal by default. Share structural bookkeeping further only where it removes total state and work without losing either rule.

Output shape derives from captured structural facts. Omitting a separate shape wait also requires proving that the consumer captures every unresolved contribution relevant to its output, including metadata-only placements. Publication ordering alone does not prove that coverage. The completed [implementation evaluations](#implementation-evaluations) record the coverage and publication proofs used by the implementation.

### Required validation and mutation completion

Distinguish installing ordinary pending data from unfinished validation of the mutation itself. A Promise assigned to an unconstrained placement can publish immediately; its later rejection becomes ordinary Error data without inventing scope rollback. If the destination's semantic rules require its resolved value to determine whether the mutation is valid, that validation remains required transition work. Installing a Promise version does not prove success or release its rollback baseline. Issuance remains non-blocking and keeps the existing return contract; ordinary pending assignments and independent results gain no additional wait.

Route required destination validation through the common mutation preparation/publication path for ready, synchronously delivered, and deferred values. Retain the captured scope, its pre-operation placement, command operation context, and publication authority until validation and required publication finish. Existing gates order conflicting work; failure publishes the same kind, causal source, poison scope, and repair baseline as ready failure. For `{then: 1}`, assigning a Function to `then` must produce `PropertyValidation` attributed to the assignment and allow repair to restore `1`, whether the Function is ready or supplied by a Promise. An explicitly selected whole-record scope is poisoned and repaired as a whole in both cases. An ordinary assigned Error or input rejection remains data under the normal assignment boundary, including at `then`; it gains no recovery baseline merely because validation consumed the input asynchronously. Distinguish that payload from a failure of destination validation.

Keep this mechanism concrete: ordinary property assignment preserves its callable-`then` restriction, and intrinsic Array `length` assignment keeps its existing value validation. Invalid keys and readonly String length remain selection-time rules. Carry only the destination facts those existing rules need through reference rebasing; do not introduce a configurable validator table, policy registry, or parallel entry-validation path.

Use the existing mutation finalizer and complete placement transfer, not a second late-failure or rollback channel. Do not let deferred destination validation degrade a failed mutation into an ordinary Error-valued property after its coordinator has closed. Do not reselect a live scope when validation resumes, roll back later successful writes, or replace an independently published ancestor; captured versions retain their own authority. Entry completion transfers the command's classified outcome and recovery without reattributing it to entry or using its rejected candidate value as a new baseline. Keep destination facts on the logical reference/operation where needed, rather than attaching them to every value or Error.

### 1. Capture references without consuming unused targets

Use one reference-capture and rebasing rule for managed, mixed, and external entry. Protect the narrowest enclosing placement or registered external scope that can be selected without consuming unavailable or invalid suffix data, and retain the requested suffix as the reference's relative path. A requested target that is already an ordinary placement needs no suffix. Entry into an Array's intrinsic length protects the Array placement and retains `length` as its suffix. An unavailable, absent, primitive, or poisoned intermediate retains the remaining suffix at that intermediate's owning placement. A native suffix uses its deepest valid statically selected registered scope; an observation-only external value gains no mutation authority or external reservation merely because it is entered.

Distinguish preceding transition work from pending data. Resolve/capture the preceding placement transition and honor conflicting external predecessors before activating the private reference. Do not await an ordinary pending data value solely to select an unused suffix. For example, capturing `obj.branch.child` may protect `obj.branch` while its value remains pending; a no-op callback must be able to complete without awaiting that value. The retained data keeps its ordinary settlement. A directly available ordinary target uses its narrower placement protection.

Keep the selected protection anchor fixed for this single-path entry's lifetime, retaining the requested suffix as the private reference's path. An enclosing anchor required by unavailable/invalid suffix data, intrinsic structure, or registered native scope selection can delay access within its coverage; covered commands proceed through the private entered Chain and cannot wait on their own outer gate. For a directly selectable managed placement, keep unrelated siblings available even with imported/shared/leased ancestors or ArrayView materialization. Do not gate the topmost protected container merely to avoid protection-time copying: an imported root is shared, so that rule would serialize otherwise independent work across the whole Chain, including repeated no-op entries. Do not add late narrowing, sibling-read bypasses, or a second path scheduler to coordinate an additional reference accessed through the original Chain. Phase 13 owns coordination of declared observation and mutation paths, including shared pending prefixes. Ordinary outside operations keep their normal ordering, and no condition or application read is moved before entry merely to accommodate its implementation.

Entry setup does not perform an assignment, native property read, or application-level use of its requested suffix. Leave missing-prefix, primitive-prefix, invalid-key, intrinsic-property, and stored-poison behavior to the contained command at its own operation context. A no-op entry through `obj.missing.x` preserves absence; assigning through that reference fails exactly as direct `obj.missing.x = value` would. Entering `a.length` and assigning through the reference performs the ordinary Array length operation. A contained lookup or mutation blocked by existing poison preserves that original Error and its ordinary effect. Entry itself neither duplicates that poison nor turns it into a new repair baseline.

Supported failure while inspecting a managed target is also a reason to stop reference selection at the last usable enclosing placement and retain the unconsumed suffix. Do not suppress a no-op callback, publish an inspection Error, or cache a newly contextualized failure merely because optional target discovery encountered a throwing descriptor trap. An actual contained command performs the ordinary supported read/validation at its own context and preserves any pre-existing poison. Evaluate this fallback with the shared protection mechanism, including imported/shared parents and failed copying: protection must not require consuming the same unreadable suffix again. Unexpected runtime escapes remain fatal; this rule does not turn internal failures into failed target discovery. Keep native setup free of leaf reflection as specified in section 7.

Every operation on the private Chain composes the retained suffix and source provenance through the same path-capture boundary. Preserve the logical destination's category, key-dependent rules, and root/property replacement semantics independently of the private holder's storage key. Root/property/intrinsic classification alone is insufficient: an ordinary record property named `then` still forbids a callable assigned value. Commands validate that destination through common mutation/publication even when entry represents it as the private root's `value`; do not add an entry-specific `then` check or defer validation to final entry writeback. Unused references remain unvalidated. Deleting through entry at an original Chain root produces `null`, just like direct root deletion; deleting through entry at a property removes that property. Nested empty-path entries preserve all these destination facts. Derive them from the reference origin and retained path rather than treating the mere existence of `_contextOrigin` as evidence that the target is a property.

Keep complete captured placement state: value, presence, source version, and recovery. Capture the final private state through ordinary gate publication. Each contained managed mutation keeps its own rollback boundary; earlier successful contained commands survive a later command's failure. A callback's independent Error result does not itself poison the reference. A pending contained transition may outlive callback issuance closure, and a pending data value may outlive completed placement publication.

Preserve the containing record's own-key order as well as final placement state. Starting with `{a: 1, b: 2}`, deleting and recreating `a` yields keys `["b", "a"]`, whether done directly or through entry at `a`. Replacement without deletion and no-op entry preserve the existing order. Integer-like keys keep their ordinary numeric ordering. Gate installation is not a logical insertion; final present/value equality cannot erase an intervening deletion and recreation. Captures made while entry is pending must observe the order at their own program position, including relative order with independently issued sibling creation.

Apply the common structural-publication rule to record order consistently in traversal, managed receiver preparation, copying, and export; an export-only shuffle is insufficient. Keep structural facts at the captured container and retain only information needed by live data and unfinished captures.

Mutable entry uses ordinary placement gates with the COW needed to preserve earlier owners. Phase 9F-D owns identifying and eliminating redundant protection copies; leave no provisional unzip state or consumer-specific identity repair in this phase. Readonly managed entry leases its captured anchor. External reservations cover the selected registered subtree and use the existing private reservation view. Contained operations receive no authority beyond their original paths. Preserve fatal-on-entry behavior, Chain/execution isolation, and readonly capability checks without adding validation of trusted compiler records.

Replace the whole-Array out-of-range entry gate with an owner-isolated element gate as part of this phase's placement and growth integration; a Phase 9F-D topology mechanism is not a prerequisite. That change can expose a protection-copy alias separation where the enclosing gate previously happened to preserve it. Track this specific deferred gap in 9F-D rather than retaining wider blocking or adding a temporary unzip implementation. A no-op entry must not gain a new storage failure merely because protection introduced a fallible write to restore its unchanged source. Required source settlement and captured values remain intact; final value equality alone proves neither a no-op nor absence of structural effects.

Readonly capture establishes protection before a source producer can publish to later writers, including when the callback starts with a pending anchor value. Copying its Promise into a private holder and leasing only an already-ready value is insufficient. Reuse complete placement capture/transfer and the existing lease ledger: ready temporary captures use leases; pending captures retain the source version before publication if those primitives cannot establish a temporary lease early enough. Preserve the existing sticky retention contract rather than adding a producer-specific lease registry solely to avoid conservative COW. Callback closure stops entry-only work and prevents unbalanced late lease acquisition, but does not clear retention or dependencies still required by an independently captured result or contained operation. Never infer capture protection merely from an operation owner's presence or open state.

Replace eager entry-target rejection and Array-specific private-root branches with this shared capture rule. Keep `_rootPath` only as ordinary reference rebasing, including unavailable managed suffixes and native suffixes; do not maintain an independent entry walker for each category. Scope-selecting mutation walks still distinguish intrinsic length/invalid Array keys from ordinary placements where their semantics require it. The removal of out-of-range widening must not break valid direct length writes.

### 2. Publish placement-local Array failures and growth

- A newly broken mutation prefix poisons its first failed placement, creating it when absent. For a canonical Array index, creation may extend length. `a[5].child = value` and `a[5]!.init()` create Error at index 5 when that is the first failed placement; they do not poison healthy siblings or the whole Array merely because index 5 was out of range.
- Honor an explicit broader mutation scope. Array-wide intrinsic mutation still owns its structural transition and recovery. Invalid Array keys cannot become placements, and intrinsic `length` is not a placement; their failure owner remains the Array. Narrow failure ownership means the narrowest valid destination consistent with the selected scope and committed structural effects, not an unconditional ban on container poison.
- Entry's ordering anchor does not choose a contained command's semantic poison scope. Delayed target validation uses the command's operation context, not the earlier entry-setup context. Blocked commands preserve existing poison and recovery; no-op entry creates no Error to collect.
- Missing intermediate containers are never auto-vivified. A failed mutation that creates poison at an absent placement retains that captured absent baseline under the ordinary rollback rule; repair restores absence, assignment replaces the Error, and deletion removes it. Restoring absence invents no value. For an Array element, committed length growth remains and the repaired/deleted placement becomes a hole. An assigned/imported ordinary Error without a recovery baseline still returns unchanged from repair. Cover ready and deferred failed-prefix publication together; current record-prefix failure already retains absence and must not lose that capability during unification.
- Successful out-of-range assignment publishes an element creation at its ordered turn before its RHS value is known. Later RHS failure stays at the element in an already-grown Array. Share that element-creation transition with entry's committed creation. It writes one element rather than republishes the whole Array.
- Centralize representation growth and element publication. Native Arrays grow through ordinary index creation; ArrayViews extend or materialize under their existing ownership rules. Preflight fallible storage/index work and preserve the normal publication-failure outcome. Do not leave an unaccounted structural change or lose an independently required Error if a write fails.
- A refused required physical write or deletion poisons the selected placement without poisoning its containing node merely to store the Error. Selecting that placement requires readable original descriptors along its reached path under the managed-storage contract; do not add unread recovery baselines or retries for hosts that hide them. Use captured version authority, or isolate the containing node and publish a logical overlay when no version exists. Preserve unaffected aliases. Verify direct, entered, and nested-entry assignment, creation, deletion, and ready/synchronous/pending calls against the same poison scope, causal context, growth, and repair baseline. A separate copy or ancestor-writeback failure retains all earlier mutation failures; aggregate an independent result separately so it cannot delay completed graph publication.
- Imported Arrays and imported backing remain physically unchanged, including length. A logical mutation or entry protection may copy at issuance under ordinary COW. Keep required isolation and representation copying in this phase; Phase 9F-D evaluates redundant copies and their logical-identity effects. Shared views may reuse only storage that the existing representation permits them to change.

### 3. Keep length knowledge separate from element completion

For a mutating entry at an Array index, the relevant structural fact is whether a contained command has committed creation at that index. Its length contribution is either `index + 1` or no growth. Once creation commits, that contribution is irreversible through the element reference: assigning and deleting index 5 still leaves length at least 6. Mutating a nested Array's length changes that nested value, not the containing Array. Readonly entry registers no growth contribution: it can capture earlier growth sources but cannot create an element, so its own callback lifetime adds no length or range dependency.

Record creation at the ordinary logical placement commit, including a pending RHS and creation of an Error. Notify length consumers as soon as their answer is determined. Do not release the element gate: later contained replacement, deletion, mutation, and repair remain ordered until normal entry publication. Callback closure seals new issuance; it does not by itself prove no growth. Resolve an uncommitted contribution as no growth only after every already-issued contained or nested transition that could create that element and final entry publication have finished without committing creation. Final absence is not required: a queued no-op entry may inherit a present element from its predecessor, whose contribution already accounts for that growth. Every contribution whose required source work completes must obtain a terminal outcome; inherited presence must not strand it as pending. A publication failure that creates present poison at the element also commits creation, even without physical writeback; it must not follow an already-delivered no-growth outcome. Reuse the existing entry/gate completion dependencies rather than adding a task registry. Pending data alone does not extend structural completion. Final absence is not evidence of no growth after an earlier creation.

Apply common structural publication to the captured containing Array's creation/no-growth outcome, including absence and failed physical writeback that leaves logical poison. Logical growth need not have a matching physical slot; storage length cannot override committed length knowledge. Synchronously available facts must already be visible when a completing gate resumes its consumers, without a later notification turn needed to catch them up.

The same creation outcome must reach enclosing length captures through nested entries, rebased references, and copied pending placements. Track committed creation, not an entry-specific dirty flag or a comparison of initial and final values. A nested root entry cannot postpone already committed outer-Array growth until every callback returns. Conversely, speculative receiver changes that an individual mutation rolls back do not establish an earlier growth result.

Element presence, length contribution, and element value availability are distinct. An entry may establish length while keeping its final presence undecided; its final placement may then contain a pending value. Retain the existing separation between transition publication and data settlement.

A fixed-index mutating entry need not wait merely to decide whether its absent target is currently a hole or beyond the final length. If the known minimum already covers the index, no growth contribution is needed. Otherwise register possible growth to `index + 1`; ordinary max composition handles the case where an earlier entry eventually covers it. With minimum 3 and a pending entry at index 5, entry at index 4 can start immediately. Its creation contributes 5, which is either relevant or dominated by earlier growth to 6. Target-specific predecessors still apply, and operations whose success or result really depends on range must obtain that answer.

Establish a known growth contribution at the entry's ordering position, before waiting for a preceding transition at the same element, not only when its callback starts. From an empty Array, a delayed no-op entry at index 5 followed by a second entry that creates index 5 must give a subsequent length observer 6; a capture between those entries excludes the second contribution. Registering it only after the first entry releases its gate can incorrectly deliver 0 to the later observer. Couple registration to ordinary placement protection and captured publication authority. If the containing Array is still unavailable, preserve common prefix ordering so its dependencies are established before later access can capture that Array; do not guess an identity or add a global reservation mechanism. This does not make a no-op entry consume an unused pending suffix.

Queued ordinary mutations and queued entries use the same structural activation rule. Reserve their growth contribution and creation position at issuance, then initialize presence and retained record position from the completed captured predecessor before publishing their own effects. An undecided predecessor's issuance-time presence is not a baseline. This initialization consumes no ordinary payload. Verify plain assignment and deletion behind entries that create, delete, or leave their targets absent; include record order and Array growth before an assigned payload settles.

### 4. Capture ordered length knowledge

Length observation follows the same rule as placement observation: capture earlier effects and dependencies at the operation's program position, and never acquire later effects or waits on resumption. Ordinary native Arrays use their physical length. ArrayView owns any additional length knowledge, using its fixed number or existing ordered growth/watcher sequence. A native owner acquires an attached projection when that knowledge becomes necessary; its placement versions and logical identity stay with the owner. Store no parallel logical-length field on native Array metadata. Length knowledge does not belong to a parent placement, shared physical backing, or an execution-wide scheduler. A length capture retains that Array's knowledge at its capture position. A COW/materialized destination gets its own future sequence; shared source outcomes do not grant either destination authority to append contributions to the other's view.

Possible growth stays in logical placements and the existing length sequence; it does not reserve physical capacity. ArrayView owns registration, capture, copying, growth, and ready-state normalization; the linked-list module has no native Array or backing-storage knowledge. A projection owning its native backing can mutate in place. Sharing backing or changing only bounds relinquishes that authority. COW forks length knowledge onto independent storage. Imported backing is never modified. Runtime-owned storage accepts valid length changes under the managed-storage contract; refused element writes retain ordinary publication and repair semantics. Native receiver preparation materializes the logical surface. Keep the projection and ownership details in [ArrayView](array-view.md).

The committed baseline is logical state, not disposable watcher bookkeeping. A failed writeback that publishes a present Error at index 5 commits length 6 even if physical length stays 3. Reclaiming all settled contributions and watchers must preserve that length in the baseline; every semantic length consumer and copy uses the logical state. Retire its metadata only when another authoritative representation preserves the same current length and earlier captures remain valid. Ordered shrink, replacement, and rollback may establish a different resulting length; element deletion or repair-to-absence alone does not undo committed growth. Do not require an extra physical length write or forced materialization merely to avoid retaining authoritative logical length.

Use one ordered linked sequence of potential/committed growth contributions and length/range questions. A growth contribution records its bound and shares the source's one creation-or-no-growth outcome. A question records its position. Active questions subscribe for delivery; read-only captures retain passive markers and refresh only when their answer is consumed. Both preserve the same prefix boundaries and use the same answer and release rules. Ready questions return synchronously without a watcher. Ordinary index assignment can contribute committed growth; it does not create an unresolved entry contribution.

For a watcher, derive bounds from its captured baseline and preceding sequence only:

```text
minimum = max(captured baseline, preceding committed growth)
maximum = max(minimum, preceding unresolved growth bounds)
```

On captured length state, `resolveLength(work, onLength)` delivers exact length when the bounds coincide. `resolveInRange(index, work, onInRange)` delivers true below the minimum and false at or above the maximum; otherwise it remains pending. Recheck the question whenever its required bounds change and return as soon as every remaining outcome gives the same answer. A resolved answer carries its captured number/Boolean into continuation work; it does not instruct the callback to reread current live length.

The supplied operation work carries its immutable operation context and owns an operation-specific pending watcher. Use the common guarded continuation and lazy release-on-close mechanisms; context alone does not establish watcher lifetime. Ready answers allocate no watcher or release registration. Pending registration establishes its release before returning control, unregisters on normal completion, and unlinks operation-only state on closure without settling internal waits or cancelling shared source contributions. Shared growth outcomes and independently retained length captures keep their own lifetimes. Add no watcher-owner wrapper or execution-wide registry.

For example, with baseline 0 and sequence `potential 6 -> watcher A -> committed 8 -> watcher B`, A still needs 0 versus 6 while B immediately receives 8. Watchers protect their earlier knowledge; they are not gates that block independent later watchers. Becoming the first list item is sufficient for exact readiness but is not the only way to become ready.

Separate answer readiness from storage reclamation. The bounds above determine readiness without requiring nodes to be removed. Committed growth can dominate earlier unresolved bounds for a watcher whose captured prefix includes that growth, but cannot affect an earlier watcher. A larger unresolved potential is not a committed floor. Later watchers may therefore complete while older contributions and watchers remain pending.

Use bounded reclamation that preserves every retained observation and capture:

- Unlink resolved no-growth contributions after updating affected bounds. Remove completed watchers and release closed operation-only state through the ordinary lifetime rules.
- Coalesce adjacent settled growth contributions to their maximum when no retained watcher or capture boundary separates them. Do this behind unresolved contributions as well as at the head: one never-completing contribution must not pin unbounded settled history behind it.
- Fold settled leading contributions into the baseline when no retained boundary needs their earlier history. Never move a later committed floor backward across an observation that excludes it.
- Complete list updates and remove delivered watchers before dispatching continuations, so synchronous re-entry cannot change an already selected answer or observe a half-updated list. Reclaiming length state never completes element gates or cancels the underlying entry.

Discard an unresolved contribution whose bound is already covered by its preceding committed minimum. A settled contribution also absorbs consecutive preceding contributions with no greater bound or value, stopping at any pending watcher. This subsumes adjacent settled-growth coalescing without another cleanup mechanism. Removing a contribution from one sequence neither cancels its source work nor removes it from an independently captured sequence. Do not prune across pending watchers merely because later growth determines a later answer.

Read-only shape capture retains a passive marker rather than cloning the sequence. Successful complete traversal reads and releases its resolved answer; discarded output and local closure release unused markers without cancelling source work. Only COW or another independently mutable destination forks earlier growth outcomes into its own future sequence, without copying questions. When current bounds coincide, replace the live Array's sequence with that ready number; earlier questions keep the old sequence and future uncertainty starts from the number. Reclamation cannot remove an outcome still needed by another capture or copy.

The max calculation applies between ordered structural transitions that can shrink or remap the Array. Gate the Array only while its own publication remains unfinished. Array methods publish independent placements through remaps or derived views; retained placements carry their captured transitions, presence, and recovery, while removed or overwritten source placements have no write authority over the result. Do not add a blanket element-transition wait or a method-specific affected-range policy. Wait only for the method's required arguments, shape, and consumed values. An independent removed-element result may remain pending after receiver publication. Backing reuse must preserve this destination authority; correctness must not depend on mandatory eager copying of the whole Array. Capture affected logical placements through the common candidate layer, including installed versions beyond the published minimum or physical length. A truncation to `n` must account for unfinished placements at indexes at least `n`; scanning only the current physical/published range or unresolved growth contributions is insufficient. Enumerate candidates, not every integer up to a predicted maximum, and preserve ordinary pending payload without waiting for values the mutation does not consume.

Starting with `[0, 1, 2]`, entry at index 5 followed by `length = 1` must leave `[0]`, even if the entry creates its element only later. Also cover creation already committed to length 6 while the element gate remains open: exact length does not establish transition completion. Capture conflicting placement transitions before waiting for them and honor them through publication; later source publication cannot resurrect truncated elements or growth in the resulting Array. Direct length assignment waits only for transitions in its truncated suffix, then publishes the resized candidate with its rollback baseline intact. This dependency is part of the direct-assignment contract even though the candidate has independent storage. Methods including `pop`, `shift`, `splice`, `fill`, `copyWithin`, `reverse`, `unshift`, and `push` retain or discard captured placements without a method-wide transition wait. Fixed length `n` only conflicts with transitions at indexes at least `n`; it need not wait for exact prior length or retained-prefix entries, even if those entries have unresolved growth. Resolve a pending length input under the existing protected receiver before selecting that suffix. For direct length assignment, a shape proof alone never removes the truncated suffix's effect dependencies. Reuse ordinary gates and captured publication authority, not a second effect scheduler or a shrink contribution in the max sequence. Root replacement and rollback retain old captured histories while establishing their own resulting Array state.

Implement incremental updates over the affected frontier; do not rescan the Array or keep settled history merely for convenience. Callback order among genuinely dependent continuations follows the existing guarded FIFO machinery. The independent sequence and integration oracles verify these ordering and reclamation bounds.

Performance follow-up: cached prefix bounds can still require quadratic total updates during forward settlement with an outstanding length question, even a single question. This is a cost of the representation, not a semantic lower bound. Evaluate any alternative summary or invalidation scheme against that schedule, mixed range questions, captured forks, closure, and retention; keep it only if the work reduction justifies its total complexity. Preserve immediate answers and independent progress. This does not justify repeated owner copies or retaining contributions that can no longer affect any answer in their sequence.

### 5. Keep logical placements authoritative independently of physical storage

Keep backing-reuse eligibility distinct from ordinary materialization. Backing derivation and extension require resolved shape matching its storage window. Preparing a shared-storage derivation marks the backing Array with the ordinary shared flag; installing a projection only to track length does not. Entry and ordinary mutation on a native Array may continue in place through its attached projection when ordinary ownership permits and committed length matches physical storage. Distinct views and a mismatch between committed and physical length require materialization before indexed mutation; this includes retained storage after shrink and logical growth without physical storage. Ownership, leases, and property-representation copy requirements still apply, with no separate backing-ownership flag. End extension may reuse shared backing beyond preserved bounds. Native receiver preparation materializes the logical surface of every ArrayView projection after settling its required graph.

An undecided Array placement is part of the logical value even when it is beyond the known minimum. Install its ordinary gate version in the logical owner's `placementVersions`; ArrayView owns the growth sequence without storing the gate in a physical element or resizing storage. Isolate earlier owners using ordinary capture and COW, and preserve their independent access and values. Integrate element protection with structural publication and growth ordering in this phase. General logical-identity preservation across protection copies is deferred to Phase 9F-D, so it introduces no additional gate mechanism or prerequisite here.

Physical backing length is storage information, not the maximum for a captured length question. It may include another view's storage or a tail retained by a bounded view. Length bounds come from the ordered captured growth state. Backing ownership controls in-place writes, not observation ordering or committed logical length.

Re-evaluate ArrayView attachment, extension, and derivation eligibility against the captured logical surface. Existing physical-end checks alone are insufficient when logical length differs from storage: appending one element to logical length 6 with physical length 3 must produce length 7, not a window of length 4. Reuse backing only when its bounds and placement overlays represent the required range without losing logical state or exposing another view's retained tail; otherwise use existing materialization. Entry and ordinary mutation must use the same materialization eligibility, including logical length without matching physical storage. Attaching a projection preserves the native Array's logical owner and stores its length knowledge in that projection only. A separately published view owns its result's length and dependencies, derived from the selected operation rather than blindly copying the source baseline. Apply this rule to empty suffixes and zero-count operations too. Do not add another ArrayView window or storage mode merely to preserve a fast path.

Centralize logical-placement candidate capture as the union of ordinary stored candidates and installed logical versions, whether pending or settled. Deduplicate keys and preserve ordinary reflection/error handling and logical enumeration order. An installed version supplies value, presence, transition, and recovery without requiring a physical descriptor. A candidate is not proof of settled presence: an undecided placement remains a required dependency, known absence remains absent, and a resolved `undefined` with present=true is still a property. The shared property layer owns this merge and presence filtering for records, Arrays, and ArrayViews. ArrayView supplies physical candidates and translated storage operations, with no parallel logical read or enumeration API.

`hasLanguageProperty` is independent of physical gate storage. For an ordinary placement, consult its installed version on the logical owner before physical fallback: `present === false` means known absence; otherwise the version identifies a present or undecided candidate (`version.present !== false` in the existing representation). Only a placement without a version falls back to its physical descriptor. A true candidate answer does not establish final presence: presence-sensitive consumers resolve the captured placement transition before treating it as an element, while ready-only consumers reject unresolved presence. Preserve ordinary key classification and intrinsic-property behavior. Reuse `PropertyPlacement` capture and presence resolution rather than adding another presence representation or consumer-specific physical fallback.

The common predicate and placement capture serve `getPropertyPlacement`, lookup/mutation selection, logical traversal and receiver preparation, the controlled Array remap `has` trap, searches, and `join`. An undecided hole must remain a captured dependency even without a physical slot; after completion each caller applies its ordinary hole versus present-undefined semantics. These consumers use metadata-only protection directly.

Apply each consumer's logical source range to both stored and version candidates before consuming their values, presence, or dependencies. Whole-value consumers include all captured logical placements, including undecided indexes beyond the minimum; bounded consumers exclude placements outside their consumed range, not everything beyond the minimum. A pending creation at index 1 on an empty Array matters to `slice(0, 2)`. A placement at index 5 is outside that element range, though its growth may still affect the slice's length when the minimum is below 2. Range filtering removes unused element dependencies, not structural dependencies needed to determine bounds or output shape. Once the minimum is at least 2, `slice(0, 2)` need not consume index 5 or wait for its growth. Apply ranges in logical source coordinates before view-offset or output-index rebasing.

Keep the no-installed-versions path as ordinary physical enumeration, with no union bookkeeping or version scan. Otherwise start with the existing version map and deduplicated candidates; a backed version still supplies authoritative placement state without a second value traversal. Do not add a separate collection of unbacked versions or another maintained index without measurements demonstrating material cost in this path. Evaluate and retain such an index only if it reduces total work enough to justify its maintenance and state; revert it otherwise.

Merge Array candidates in ascending canonical index order, independent of gate installation or settlement order. Reuse the existing physical candidate enumeration over the published storage range, including its bounded index scans where these avoid inspecting unrelated backing. Supplement it with installed logical versions; never extend that physical scan to the speculative maximum merely to discover undecided placements. This phase requires neither a new sparse-key index nor a universal ban on bounded index scans.

Use this logical-placement path consistently in direct lookup and presence handling, managed traversal, Error queries, receiver preparation, COW/materialization, retained-property preparation, result import, export, mutable-external property snapshots, and refcount index construction/verification. Physical mirroring is a storage optimization, not a prerequisite for logical visibility. A gate may settle to a present Error with recovery when ordinary publication fails and cannot write physical storage; that Error must remain discoverable and counted after pending status ends. Maintain the actual pending, present, absent, and Error edge transitions through the common commit. Keep verifier checks for authoritative versions and complete logical edges rather than disabling verification or exempting only pending values. Once growth covers an index, its logical version still governs visibility whether or not a physical descriptor exists.

Mutable-external property snapshots use the same stored-plus-version candidates when they reach managed data, but keep their synchronous ready-only contract. An unresolved required value, placement presence, or Array length produces `InvalidExternalSnapshot`; do not skip an undecided placement beyond the minimum, substitute minimum/physical length for exact length, subscribe to a gate or nested thenable, allocate a length watcher, or deliver partial output. Ready committed logical length above physical storage is valid and contributes trailing holes to the detached Array. Length remains structural state, not an unresolved language property or synthetic Promise version. Complete ready traversal establishes captured shape without installing a wait. Discard failed output while continuing collection of accessible required Errors. Preserve transactional admission and existing snapshot attribution; a failed observation adds no external scope poison. The selected native property's direct Promise may still settle before snapshotting, and method results retain ordinary import semantics.

Whole-value copying carries all captured logical placements and unfinished length contributions, including undecided placements beyond the minimum and settled overlays without physical storage. Fork destination placement versions under the existing transfer rules, with their own retained-value obligations and publication authority. Publication follows the captured source transition into each valid destination; never reselect the current Array at the original path. A later replacement must remain untouched, and copies made before and after entry installation must retain their distinct logical values.

Retire a completed absent version only after required producers/writers finish and removing it cannot reveal stale physical data. Physical fallback must represent the same logical absence, or authoritative state must have moved to another representation. For example, physical `x: 1` masked by an absent overlay must not reappear when that overlay completes. Retain a necessary overlay until ordinary deletion/materialization makes fallback safe; it is current state, not history. Derive safety from captured storage facts and completed publication rather than adding recurring reflection probes or a cleanup registry. Preserve independently captured versions and retire genuinely redundant absent slots through the common detachment path. Apply this rule to records, Arrays, deletion, repair-to-absence, and copies as well as no-op entry.

Contained command write-through obeys that same installed-version authority at every enclosing entry reference. A detached entry advances its private placement and captured structural effects but cannot write to or delete from storage governed by a later version. Do not repair a stale storage flag by giving an obsolete writer renewed authority. Backing-sharing Array copies transfer every required in-range logical overlay, including absence that masks a physical slot; present-key enumeration alone is insufficient. Preserve destination storage facts independently of transferred source contents.

ArrayView retained-property capture, synchronous thenable normalization, and Promise settlement publish only into logical overlays, without writing shared physical slots. Reads and traversals over a view use the common logical-property boundary, so settled Errors, cycles, and absence never require backing writeback. Fresh suffix insertion may write beyond preserved bounds; indexed mutation materializes through the ordinary path. Verify pending fulfillment/rejection through offset and repeatedly derived views, including read-only entry completion before payload rejection, and run the storage oracle on both source and result. Derivation and settlement must not invalidate another owner's physical-absence facts or require a storage copy merely to advance a version.

Bound repeated derivation work by recording the constructed view's retained prefix. Normalized, protected physical values in that prefix need no rescan; capture its installed versions and the uncaptured suffix instead. A new suffix value stays eligible for ordinary ownership transfer until another result retains it. Recompute the result's prefix from its selected source range, clamp it on contraction, and carry no prefix fact into materialized Arrays. Keep independent version captures, absence overlays, offset translation, and first-capture reflection handling. Test storage-work counts at different Array sizes for repeated shared and leased push/pop; verify retained-prefix child protection through the common consistency oracle. Initial capture, materialization, and new-result indexing retain their required graph-sized work. Keep the existing rollback coordinator and shared-backing paths rather than adding a separate plain-Array execution policy.

Ordered truncation removes installed versions throughout the truncated logical range even when they have no physical descriptor. Their source settlement may still serve earlier captures, but cannot publish into the shortened owner. Verify a copied undecided element that later receives pending data, followed by shrink and then append, with both payload/completion orders. Check the live owner and a retained post-shrink result; later payload settlement must neither restore the removed element nor write outside ArrayView bounds.

A gate Promise alone does not encode absence. All presence-sensitive consumers follow the captured placement's present flag. Sparse outputs remove an absent result; dense operations produce `undefined` where their native semantics require it; explicit undefined assignment stays present. Preserve growth independently when creation was followed by deletion.

Length watchers and growth notifications are internal structural dependencies, not extra language placements or a second set of graph Promise counts. Index the actual pending element placement. An operation that promises completed shape must prove that shape at delivery; reuse required placement completion where it already establishes the proof instead of adding a duplicate length wait. Indexing and Error queries do not wait for length independently of the data they consume.

### 6. Allocate and capture before waiting for complete shape

Retain one explicitly named synchronous accessor for the known published minimum, for storage/representation work that does not claim exact semantic length. Remove ambiguous general reads of `logicalArrayLength` and the ArrayView length getter from semantic callers, while preserving private view bounds where their meaning is purely representational. Semantic callers use committed logical length even when no growth contribution or watcher remains; physical length alone is not a fallback for a retained logical baseline.

Integrate pending intrinsic reads explicitly at the language-property consumption boundary. `length` remains Array structure, not a placement: an observation of it resumes from the captured length query through ordinary guarded continuation. Do not pass its pending result into `observePromiseVersion` or `requirePromiseVersion`, whose contracts require an actual placement version. Do not install a synthetic `length` version, add a graph Promise edge, or classify structural waiting as rejected user data. Reuse this intrinsic-read path for ordinary lookup, expression extraction, and traversal through an intrinsic value; assignment and deletion retain their ordinary intrinsic mutation rules. Ready intrinsic reads stay synchronous and runtime failures keep their fatal classification.

Classify each consumer by the information it actually needs, not merely by whether it currently calls the length helper:

- Exact length: public length reads, normalization of potentially valid negative indexes, append positions, shape-sensitive bounds, and intrinsic methods when their result/effects genuinely require it.
- Range: checks whose sole question is whether a particular fixed index is valid; fixed positive bounds may also use a range result when that fully determines the derived shape. For `with`, only its index-validity check belongs here: producing its dense output still requires the exact captured length, as does any length-dependent index normalization. Do not replace a needed exact length with one insufficient Boolean.
- Placement value: after ordinary argument conversion, `at` at a finite nonnegative possible Array index can use ordinary placement capture and result retention without a length/range query. A hole and an out-of-range index both return undefined; an entry at that exact index keeps its ordinary dependency. Preserve omitted/invalid argument and infinite-index behavior, and return undefined for nonnegative indexes beyond the Array index limit rather than passing them into graph-key validation. A negative index first checks range at `-index - 1`; an impossible position returns undefined, and a potentially valid one obtains exact length for normalization. Reuse the existing element-result path, including Error propagation and external-capability checks.
- Logical capture: copies and traversals record ready properties and pending placements immediately. A storage allocator needs a provisional size, not necessarily final length. Do not add a length wait to fixed-index entry just to preserve an obsolete widening branch.

After required argument processing, return any result already determined by bounds before asking for exact length. A slice with reversed same-sign bounds, positive-infinite start, negative-infinite end, or nonnegative start beyond the captured maximum is empty. Forward searches whose nonnegative start is out of range and backward searches whose negative start cannot reach the Array likewise have an empty consumed range. Use the common range question, including for infinite indexes, instead of per-method length sentinels. `with` validates positive and negative indexes by range; valid output still requires exact shape. Test these outcomes while unrelated growth remains unresolved, with both ready and pending arguments, preserving argument failures and required conversion work.

Forward searches with an absolute start scan the committed prefix immediately and ask whether their next index is in range only when they exhaust that prefix. Resume as soon as that range question permits progress; later unresolved growth is not a dependency of an already determined match. A nonnegative `lastIndexOf` start proven in range likewise needs no exact length. Relative starts and unbounded backward search retain their required length dependency. Preserve ordered first/last-match selection for index searches and concurrent early success for `includes`, including while both values and growth remain pending. Lease the receiver while further placement reads remain possible; `includes` releases it after all candidates are captured without awaiting independent comparisons. Test successive partial growth, holes versus present undefined, later overwrite/growth exclusion, ready/synchronous/pending arguments, resumed reflection failure, and release of leases and unused range questions on completion.

Export allocates and registers its output shell before traversal, preserving aliases/cycles and copying all ready properties synchronously. Capture pending placements and the corresponding length state at that same turn, without letting later contributions enter that capture. Set the fresh output Array's length to the exact captured result before delivery: deleting an absent placeholder alone does not undo physical growth caused by that placeholder. Finalization may shrink this private output while preserving genuine trailing holes after creation/deletion. A pending length must not delay capture of ready siblings, nor require a new export lease.

Complete consumers finalize from captured structural state, never current live length. Their required traversal proves exact captured shape, so export and complete managed receiver preparation use no separate length watcher or Promise join. Output discarded because of Error needs no shape completion; any output-only watcher must release without leaving the Error-collection result waiting on its abandoned internal Promise. Do not solve this with cancellation of shared growth sources. Length-only observations and bounded consumers may still need watchers to obtain answers before complete element traversal. Internal captures that deliberately preserve pending data retain unfinished shape instead of waiting.

Native receiver readiness also requires physical representation of the complete logical surface. Resolved values alone do not establish this: an absent physical property and a logically present undefined compare equal by value, an absence overlay may hide physical data, and logical length or key order may differ after all Promises settle. Observational receiver materialization accounts for presence, Array shape, and record order, including nested containers. It identifies affected containers and ancestors, then seeds the common receiver copier's identity map with unchanged containers. Mutation isolation uses that same copier without reusable identities. Both paths preserve aliases/cycles and copy the same logical surface, without separate population loops. Use existing placement and structural facts rather than per-method fixes or another registry. Establish this eligibility before introducing each new overlay or structural state, independently of the proof that traversal has finished waiting.

Internal import/result capture and COW can preserve unfinished length knowledge as managed state; do not delay a host method's independent result merely to allocate such a copy. Undecided Array placements stay metadata-only in these logical copies because physical placeholders would inflate their published minimum. Fresh record copies instead reserve physical key positions beneath their logical overlays, preserving the relative order of keys without explicit order tokens. Copy population does not create new insertion events: retain captured tokens through later value publication, including deletion/recreation completed while a copy is pending. Protection writes no source placement and does not resize backing storage. Native managed invocation still waits until its complete receiver is ready. Error queries and indexing need all relevant logical dependencies but do not acquire an exact-length wait when length cannot affect their answer. Export finishes complete captured shape before delivery; mutable-external property snapshots require it to be ready synchronously and reject unresolved state under section 5 rather than waiting.

Audit callers that never read length as well as existing length call sites. Ready/pending presence handling, sparse enumeration, ArrayView projection and descriptors, refcount oracles, retained remaps, and physical growth paths are part of this sweep. Reuse existing logical traversal and placement publication rather than adding a second Array-only boundary walker.

### 7. Preserve external authority through runtime anchoring

The public entry operation performs reference capture itself, with no separate compiler selector. Keep the user-visible reference at the requested target. Reserve the appropriate static external coverage before managed path suspension, using the common external reservation view and predecessor capture; contained commands reuse that view.

Preserve full original source provenance when splitting/rebasing a suffix, including across nested entries. Clamping the anchor's fact must not make the retained suffix static. A computed native suffix remains usable if it does not select/cross a registered descendant; a computed mutable-resource route never gains authority. Retain invalid/unavailable suffix facts for ordinary command validation rather than validating unused application data as an entry mutation. Entry cannot fabricate a registered scope or a guessed mutable candidate.

Native setup captures the registered reference and its ordering protection without reading an unregistered leaf or invoking its getter. Selected or strict-ancestor poison and binding conflict do not themselves consume an unused reference or suppress a no-op callback. Preserve the selected canonical path and existing metadata so actual contained commands apply ordinary selected-scope poison, repair, and binding rules at their own contexts. Do not copy a blocker into a new entry Error or let setup repair it. Waiting for already captured external predecessors remains necessary; this change grants no bypass of their unfinished effects.

An entered native leaf has no independent poison/recovery state. Assignment/deletion of an ordinary native property remains allowed; replacing or deleting a fixed registered binding remains forbidden. Contained operations cannot bypass selected or ancestor poison or invalid bindings, and copying or rebasing a reference creates no repair authority. No-op reference setup adds no new data poison or host effect. Actual commands perform access checks and publish failure effects; entry setup does not consume these blockers. An invalid dynamic suffix grants no authority to reserve or use a guessed native target. A malformed trusted control record or unexpected runtime failure retains the ordinary fatal boundary.

### Implementation evaluations

These evaluations are complete. The requirements and regression cases below preserve their proofs; general copy reuse and alias semantics remain Phase 9F-D work.

#### A. Placement protection and record-order publication

Common metadata-only placement protection and captured publication preserve owner isolation, presence/recovery, record order, and unrelated sibling progress. Existing COW isolates earlier owners without widening the selected gate. Optional discovery stops at an unreadable suffix; actual commands validate and publish through their captured authority. No physical write is needed merely to protect or complete an unchanged placement.

Array growth and record order use the common structural commit with separate container facts. Record creation positions are reserved at issuance. Captures share the relevant outcome tokens, and completed tokens that only preserve physical order are removed from the live map. Empty order tracking adds no sort or captured copy. Nonnegative order tokens remain authoritative when physical key order differs. Required storage failures belong to the contained command, so it can inspect and repair them before entry closes.

The committed insertion position is part of placement state, published with value, presence, and recovery. A queued successor reads this completed state, not a snapshot of its predecessor's mutable order token. Same-container copies and borrowed-result import preserve that state; assignment from a different result holder uses the destination's preceding position. Ordinary data settlement preserves an already published insertion. Each transition owns its structural reservation and passes it explicitly to the common commit; no mutable structural slot is shared through a live publication version. Pending-prefix mutation uses the same reservation and commit machinery while preserving direct supported-thenable delivery. A detached version still publishes its reserved structural outcome to earlier captures, without regaining storage authority. No separate structural initialization or predecessor-token chain is required.

A settled present version can still authorize publication by already-issued path work, even when its value matches physical storage. Keep that authority until ordinary replacement or deletion; storage equality alone does not prove retirement safe. Retained versions carry current placement state without historical producer chains. Completed absent versions retire only when physical fallback and writer completion also prove absence.

#### B. Growth sequence and bounded reclamation

The linked sequence implements captured exact/range bounds and reclaims settled contributions without another scheduler. The independent prefix-bounds oracle covers 1,000 small schedules. A second oracle drives real entries, creation/no-growth, copied owners, and length/range consumers through 60 schedules. Dedicated tests cover registration before predecessor waits, queued same-index producers, inherited presence, nested completion, synchronous re-entry, ready/synchronous/pending data, and failed publication.

A seeded native-semantics oracle also exercises mixed ordinary commands and target, owner, and nested entries on records and Arrays. It compares captured exports, record key order, Array length, and final state across 96 ten-command schedules, with imported and owned inputs, ready and pending payloads, readonly/no-op entries, and randomized settlement under batched and individually drained delivery. Keep this independent of structural-token and length-sequence implementation details; model the native command at its issuance position and compare each retained prefix.

An independent poison/recovery model covers 128 twelve-command schedules, seeded with stacked commands behind a delayed no-op entry, then mixing assignment, deletion, failed prefixes, repair, and additional entries. Exercise imported/owned inputs, ordinary/target/owner routes, pending payloads, randomized release, and both captured-prefix and no-intermediate-observation runs. Compare complete Error membership and attribution, healthy key order and data, logical Array length, and indexed graph consistency. Dedicated regressions cover creation followed by a queued replacement/deletion/repair, failed invocation and prefix publication, and subsequent append.

With an unresolved head, an earlier watcher, and 10,000 settled contributions, reclamation retains three nodes, then two after watcher closure, and no history after final settlement. Adjacent settled growth coalesces without crossing retained watcher/capture boundaries. Completed source work always has a terminal growth outcome; pending ordinary element data does not delay it. No more aggressive cross-watcher pruning or separate missing-slot index is needed.

Sources retain one final growth outcome, with reverse subscriptions only for captured prefixes having pending length/range questions. Unobserved forks consume source outcomes on demand and never register permanently with them. A shared outcome revision invalidates cached bounds without retaining owners or scanning an unchanged frontier. Active completion starts at its changed contribution: the preceding subscribed sources keep that prefix current. Propagate through the suffix, consuming any completed unobserved tail outcomes too, and compact touched nodes in the same pass. The list retains its last pending question so insertion and removal adjust subscriptions only over the interval whose observation status changes; no separate watcher registry or whole-list subscription rebuild is needed. Completion and local closure unsubscribe questions; idle sequences fold settled contributions at their next read. Verify repeated COW under a never-settling contribution, active versus closed questions, synchronous reads after source settlement, and independence from later growth. A thousand unused forks add no reverse subscriptions, while an active question receives its captured answer normally. Check traversal work as well as retained nodes: reverse-order growth/no-growth settlement and repeated question registration/closure must not rescan unaffected prefixes. A branching bounds oracle covers active and lazy forks, partial completion, range and exact questions, and arbitrary question closure.

#### C. Complete traversal establishes shape

Every relevant growth fact is committed before its captured placement transition completes. Complete traversal captures all required metadata-only candidates and ready siblings before suspension, then finalizes its captured shape without a separate shape watcher or Promise join. The proof covers nested entries, forks, absence, failed publication, and synchronous re-entry.

Discarded output does not leave a shape-only wait delaying complete Error collection. Bounded and length-only consumers retain their independently earlier readiness. Mutable-external snapshots remain ready-only, and completed traversal does not by itself prove physical storage eligible for native delivery or ArrayView reuse.

### 8. Verification and removal of superseded paths

Use differential integration tests: issue identical commands directly, through an entered target, through an entered enclosing owner, and through nested entry. Compare resulting data, own-key order, length/holes, Error kind/source/cause and recovery, native effects, imported storage, and earlier retained outputs. Retain existing alias/cycle coverage of graph copying and owner isolation; the stronger no-op protection-copy topology matrix and lease-dependent mutation-alias regression belong to Phase 9F-D. Do not pin their current failing behavior as a compatibility requirement or report full entry equivalence before that work completes. Scheduling expectations compare dependency requirements and completion of otherwise completing work rather than requiring independent work to complete in identical order.

Required cases:

- No-op and actual-use entry through an absent, primitive, poisoned, or pending intermediate; an unused never-settling data Promise must not suppress a no-op callback. A contained failure has the command's source context. Include readonly entry and existing poison propagation.
- A supported descriptor failure during optional managed target discovery leaves a no-op callback usable and adds no poison. Repeat with an actual contained read/write, ready/pending prefixes, readonly entry, and imported/shared parents; consumed failure uses the command's context. An unexpected runtime failure remains fatal. Existing external target/ancestor poison and binding conflict also permit a no-op callback, while actual access preserves the original blocker and cannot repair or bypass it through rebasing.
- Compare ready and pending values for a single entry at `x` whose callback evaluates a slow condition, reads `other`, and writes `child` through the entered Chain. Covered work completes independently of its outer gate; outside access obeys that gate. With a ready narrower entry at `x.child`, an ordinary outside read of `x.other` remains available. A pending intermediate may require fixed enclosing protection, and an unused never-settling suffix still permits a no-op callback. Multiple declared paths, overlap merging, and callback reads through separately entered references are Phase 13 cases.
- Ready and delayed entry, nested entry, captures during entry, later independent sibling writes, and whole-root replacement preserve captured values and earlier owners. Sibling writes remain visible after entry completes; publication through an old captured version must not overwrite a later ancestor or replacement. General no-op copy reuse and its alias/cycle assertions are deferred to Phase 9F-D.
- Hold a directly selectable narrow entry open while reading an unrelated ready sibling and publishing a sibling mutation through another entry. Require both to progress before release, including when an imported root is shared, an unshared ancestor is leased, or representation copying is required. Repeat no-op entries and nested entries, with a whole-value capture concurrently awaiting the protected branch. Verify captured values, exclusion of later effects, owner isolation, and progress; whole-Chain or whole-Array serialization must not substitute for protection of the selected placement.
- Begin export and retain the value in another Chain while entry is open. An owner retained before entry stays usable and receives none of its writes. Add an independent sibling write and root replacement: current state keeps those effects and earlier captures exclude them. Required source settlement remains independent of entry completion. Phase 9F-D adds the copy-identity assertions to these capture/ordering tests.
- Starting with `{a: 1, b: 2}`, delete and recreate `a` directly and through entry: both export keys `["b", "a"]`. Contrast replacement without deletion and no-op entry. Include delayed/nested entry, independent sibling creation, integer-like keys, captures made while entry is open, COW, and a managed method observing own-key order. Each capture reflects only its preceding structural effects; a final-value comparison or export-only reorder must not satisfy the test.
- Readonly entry captures a pending managed value before a later outside mutation, then reads it after both resume. It observes the captured value, while the source observes the later mutation. Cover native and synchronously delivered custom Promises, publication handoffs, callback closure before fulfillment, and independently pending contained observations; retention stays correct and live leases balance.
- Readonly entry at an absent out-of-range index creates no growth source. A never-completing readonly callback does not delay length or range answers; repeat with earlier genuine pending growth so queries retain exactly those prior dependencies.
- Ordinary and entered whole-root assignment/deletion; property and Array-element deletion; nested empty-path entry; intrinsic Array-length entry and a readonly String length used by a mutating command. Failed/no-op selection must not change data merely because the compiler inserted entry.
- Starting with `{then: 1}`, assign a Function directly, through entry at `then`, through an entered enclosing record, and through nested empty-path entry. Use distinct entry and command contexts. Cover ready Functions, synchronous thenable fulfillment, and deferred fulfillment. Require `PropertyValidation` at the command context, equivalent poison ownership, and repair restoring `1`. Observe inside the callback as well as after entry completion so final publication cannot hide a command that incorrectly succeeded. Repeat with an absent `then` baseline and an explicit whole-record scope where the entered reference covers it. Broader failure poisons that record, not only its field, and repair restores its complete baseline.
- While destination validation is pending, capture earlier values and issue conflicting replacement, deletion, repair, and ancestor replacement. Check ordered publication, original baseline ownership, and absence of stale writes into later state. Repeat when entry's callback closes before the contained transition finishes. Verify that ordinary Function assignment to another property/root and non-callable `then` remain valid, unused entry performs no validation, and ordinary pending assignments/rejections retain non-blocking issuance and data-Error semantics. No broader scope waits merely because unrelated data remains pending.
- Missing record and out-of-range Array prefix failures with healthy/failing RHS and failed invocation; original Error propagation; element replacement/deletion/repair; explicit broader bang scopes and invalid Array keys.
- Creation followed by deletion, including pending assigned values and nested entry; no creation; contained command failure/repair after an earlier successful creation; separate length readiness, entry completion, final presence, and value settlement.
- An outer callback closes while an already-issued nested entry is pending. Length remains unresolved until that nested work creates the element or finishes without creation. Creation then resolves length even while the nested element gate remains closed; a pending assigned value alone does not delay that notification.
- Independent ascending and descending fixed-index entries, including ambiguous range at issuance. Each callback starts without waiting for an unrelated element's growth outcome; same-index and structural conflicts remain ordered.
- Issue two entries at index 5 on an empty Array before the first completes, capturing length between their issuance and again after both. With first no-op/second creation, the earlier capture receives 0 and the later receives 6. With first creation/second no-op, both receive 6 and the second contribution terminates despite inherited presence. Include deletion/repair, pending payload, nested entries, COW captures, and synchronous predecessor delivery. Check registration order and reclaimed contribution state as well as final length; no new whole-Array gate may substitute for the element ordering rule.
- `potential 6 -> exact watcher -> committed 8 -> exact watcher`, with the earlier watcher receiving 0 or 6 and the later one receiving 8 immediately. Interleave affected/unaffected range watchers, no-growth, later potential growth that may disappear, and synchronous watcher re-entry.
- A never-completing contribution followed by many settled growth contributions retains a coalesced maximum where no watcher/capture separates them. Intervening retained boundaries preserve their own answers, and completed or closed watchers release their state without cancelling element work.
- Ready length/range answers use no pending watcher. A pending watcher releases operation-only state on normal completion or local closure while independent captured queries and source contributions continue. Exercise synchronous answer delivery, callback re-entry, and fatal resumption without adding malformed-control tests or fatal cancellation.
- Earlier/later captured copies, leases, sibling COW, view materialization, complete root replacement, and rollback while source entry remains pending. Assert both final values and absence of later effects in earlier length captures.
- Length captures through different placements holding the same Array follow ordinary ownership/COW. Distinct ArrayViews sharing backing retain independent length state; changing the parent placement or physical backing cannot retarget a captured length view or introduce later contributions.
- Register multiple possible endpoints without physical or logical growth, reuse backing after no-op entry, and copy before mutating storage shared with another view. Verify independent COW length histories, passive captures alongside active questions and closure, ready-state normalization while earlier questions remain pending, late earlier questions after later growth permits derivation, and native receiver length after no-growth completion. Many read-only captures allocate only one marker each and add no source subscriptions. Imported Arrays and imported Proxy Arrays receive no resize or write. Preserve placement-local failure for refused element writes, including logical growth without physical element creation, and retain bounded work for independent entries and lazy captures.
- Growth dominating other length contributions while their element gates remain open. A length-only observer may finish; an element consumer, pop/truncate/remap, or whole-value completion retains its own required dependencies.
- From `[0, 1, 2]`, enter index 5 and issue `length = 1` before entry completes. Cover no creation, later creation, creation already committed while the gate remains open, and nested work outliving the callback. The ordered result is `[0]`, with no late resurrection or regrowth. Repeat affected-range capture with shrinking/remapping operations and metadata-only placements, earlier retained copies, and pending payload that the mutation does not consume. Distinguish a shape answer from completion of conflicting transitions; do not make truncation wait for an unused never-settling element value. An entry in the retained prefix must not delay fixed length assignment, including unresolved growth below the assigned length. Check a pending length RHS with independent entries both inside and outside that suffix. `push` remains synchronous behind an in-range entry, and an out-of-range creation may establish its append position before its entry closes. Test both owned and imported Arrays and preserve earlier captured exports.
- Queries, export, receiver preparation, internal result capture, Array remaps, and indexed/unindexed graphs containing a metadata-only pending placement, before and after growth covers its index. Resolve to value, Error, absence, and present undefined; verify refcounts with pending and settled states. Interleave stored and metadata-only Array indexes in differing issuance orders; callbacks retain ordinary numeric index order and holes retain their semantics.
- Enter an absent record key, an in-range Array hole, and an out-of-range index without a physical gate write. Verify that candidate presence and placement capture retain the undecided dependency. Exercise `indexOf`, `lastIndexOf`, `includes`, `join`, and controlled sparse remaps before completion; no-op/deletion preserves absence, explicit undefined remains present, and Error outcomes remain visible. Repeat with transferred versions and ArrayViews. Settled present and absent overlays override missing or stale physical descriptors; intrinsic/key classification stays unchanged.
- Read mutable external properties containing managed records/Arrays with metadata-only undecided placements, including an index beyond the minimum and unresolved length. Snapshotting rejects with `InvalidExternalSnapshot` without subscribing to nested data/gates, allocating a shape wait, changing external scope poison, or admitting partial copies. Include a synchronously delivering nested thenable and accessible sibling Errors to verify no subscription and complete collection. After supported failed writeback followed by repair/deletion, ready logical length 6 over physical length 3 produces a length-6 snapshot with trailing holes. Repeat through ArrayViews and aliases/cycles; direct property Promise delivery remains allowed before copying, and method-result import retains pending data normally.
- Bounded consumers include an undecided placement within their consumed range even beyond the minimum, and exclude out-of-range element values and Errors. For `slice(0, 2)`, cover pending index 1 on an empty source, pending index 5 with minimum at least 2, and pending index 5 with minimum 0: the last case retains its shape dependency without consuming index 5's value. Repeat with nonzero view offsets and settled metadata-only versions. Ordinary Arrays without installed versions retain the physical enumeration path.
- `with` can decide nonnegative-index validity from range knowledge, but a valid call still delivers a dense Array of the exact captured length. Include unresolved growth, a provably invalid index, negative-index normalization, and later growth excluded from the captured result.
- Nonnegative `at` reads an unaffected ready or absent index without waiting for another index's unresolved growth. Reading the entered index itself keeps its required transition and value dependencies. Cover holes, present undefined, Error, retained managed results, external-capability rejection, pending data, numeric conversion, negative indexes, infinities, and indexes beyond the Array index limit. Compare values with ordinary indexed reads and dependency behavior with the specified consumed placement.
- Verify refused optional settlement synchronization separately from required mutation publication: direct, entered, and nested-entered pending assignments on records and Arrays retain their settled logical value, with and without an existing refcount index. Cover throwing and false-returning storage traps, synchronous thenable normalization, original rejection identity, subsequent repair/replacement, and fatal precedence. The physical slot may retain the Promise. Required indexing failure still becomes poison, and required mutation writes still retain repair baselines.
- Failed required publication after a contained mutation leaves a settled, present Error without physical writeback. Direct lookup, presence, `hasError`, `getErrors`, export, copying, and the refcount verifier agree on that logical placement. Repair/replacement/deletion preserve the appropriate baseline and growth. Include failure before the intended element obtains physical storage so no growth cannot be announced before its logical Error creation. A no-op entry commits no logical growth and creates no storage failure merely to restore its unchanged placement.
- Supported failed writeback leaving a logical Error at index 5 with physical length 3 retains committed logical length 6 after contributions and watchers are reclaimed. Cover direct assignment and entered publication, lookup of length, copying/materialization, and export after repair or deletion leaves a trailing hole. Element repair/deletion preserves length 6; a later ordered shrink can change it without altering earlier captures. Verify this through supported publication, not fabricated internal records, and keep imported backing unchanged.
- On an Array whose ready logical length exceeds physical storage, exercise `push`, `concat`, `slice`, `pop`, `shift`, and past-length assignment through eligible reuse and materialization routes. Include empty suffixes, zero-count operations, attached source projections, separately published views, nonzero offsets, and backing with another view's retained tail. Results use captured logical shape, and neither derivation nor attachment loses source length state or exposes unrelated storage.
- Observational managed methods inspect nested logical state with `Object.hasOwn`, `.length`, and `Object.keys`: present undefined without a physical slot, logical absence masking a physical property, length exceeding physical storage after repair/deletion, and reordered record keys with unchanged values. Calls must see the logical surface even after all Promises settle. Repeat through mutation isolation, with aliases/cycles and earlier retained owners; native reuse and materialization agree. Export-only assertions do not establish receiver correctness.
- Absence-overlay retirement preserves absence when physical storage is stale; if the chosen representation prevents such a state, verify that invariant through the common publication path. Cover deletion, repair-to-absence, metadata-only completion, and copied pending placements on records and Arrays. Lookup, presence, enumeration/export, and refcounts must not resurrect the old value or a physical gate. Repeated absent entries still reclaim redundant slots; do not preserve every settled version to make the test pass.
- Export captures ready siblings before waiting for shape, preserves trailing holes, aliases and cycles, and excludes later sibling mutation or growth. Contrast a no-op out-of-range entry with creation followed by deletion: removing an absent pending output must leave the exact captured length in both cases. Internal result capture retains pending shape without delaying unrelated data or inflating the copied minimum.
- Verify that every growth/no-growth fact needed by a successful complete traversal is available when its last captured placement transition completes, including nested entry, forks, failed publication, and synchronous re-entry. Where this proves shape, complete export and receiver preparation without a separate shape watcher. Error collection still completes after output is discarded, with no abandoned shape-only wait delaying it. Bounded and length-only observers keep their independent earlier readiness.
- Public lookup and expression extraction of an unresolved Array `length` use structural continuation, return their captured answer, and create no synthetic placement version or graph Promise edge. Include ready length, later growth/replacement, traversal through an intrinsic value, and unchanged intrinsic mutation validation.
- Plain, view-backed, imported, and shared Arrays; nonzero view offsets and backing with unrelated retained tail. Imported physical length/elements never change. No-op entry creates no element and causes no physical or logical growth. Element publication uses ordinary supported reflection failure handling.
- Protection-only installation/completion for records and Arrays requires no storage write merely to mirror a gate or restore unchanged source state. Cover fallible storage, pending source settlement, captures while entry is open, and earlier owners that must neither wait for nor receive its effects. Required writes after actual contained mutations keep their ordinary failure behavior.
- Queue deletion or scope repair after a delayed creation, then queue a ready, pending, or nested no-op entry on that same placement. Cover record keys, Array holes, out-of-range indexes, values, objects, and poison, with and without intermediate captures. Verify committed growth, earlier outputs, final absence, Error-query/export agreement, indexed edges, and a subsequent real writer. Separately derive and re-derive ArrayViews after queued deletion leaves an absent overlay over physical backing; exercise slice offsets, concat, append, pop, shift, observation/mutation modes, and later source writes. Ordinary assigned Error data has no invented repair baseline.
- Registered native targets and native suffixes, no-op throwing-getter suffixes, ordinary property replacement/deletion, binding protection, metadata poison/repair, mixed entry, static provenance, permitted dynamic suffixes, rejected dynamic registered selection, and nested reservation views.
- Fatal and local closure preserve existing behavior: no internal cancellation or source settlement for fatality, no callbacks after execution failure, no retained historical watcher/owner state, and no additional pending-result fatal registration.

Integration coverage uses the existing entry, scope-recovery, supported-thenable, publication-failure, Array, and refcount suites. Assertions cover scope, attribution, recovery, captured values, and progress as well as final results. Array method capture tests compare native results across owned, imported, shared, and offset-view receivers while element entries remain open, with and without intermediate exports. Verify immediate receiver-shape publication, independent removed-element results, late overwrite/growth, retained output immutability, absence, moved poison/recovery, failed publication followed by repair, and supported failure at successive source-reflection actions. Start an index before mutation and verify it during pending work and after publication. Sorting and argument preparation retain their actual value dependencies; direct length truncation retains its suffix wait. The independent growth oracles preserve sequence and reclamation invariants. There is no separate public anchor selector, entry command journal, or alternate entry-validation path.

Guard work with deterministic checks, not elapsed-time thresholds. Repeated in-range writes beside an unfinished out-of-range entry and independent element-entry loops must not copy an otherwise owned native Array merely because growth remains unresolved. Read-only shape captures must not clone the contribution sequence or add active subscriptions merely to retain a position. Measure the loop's completion work as well as issuance, with individually delivered forward and reverse completion. Repeated ready length/range reads after dominating growth must not rescan irrelevant contributions; earlier watchers and independent captures must retain their own answers. Tests of discarded COW forks must establish real sharing rather than relying on uncertainty to force a copy.

### 9. Contract ownership and remaining phases

The delivered contract is documented in AGENTS.md and the runtime references:

- `data-limitations.md` defines supported host storage and static mutable-resource authority.
- `enter.md`, `mutation-and-observation.md`, and `external-context-ordering.md` define non-consuming reference capture, fixed anchors, readonly capability, captured publication, external reservations, and command-owned validation.
- `error-handling.md` defines placement-local Array failure, committed growth, explicit broader scopes, deferred destination validation, and per-command recovery.
- `array-view.md` and `runtime-spec.md` define authoritative logical placements, captured structural state, physical representation eligibility, and consumer-specific readiness.
- `integration.md` and `promise-path-segments.md` define the public operation boundary and source provenance through rebasing.

The runtime owns reference capture. Unused application suffixes cause no validation failure; actual contained commands preserve their operation context, poison scope, and rollback authority until required validation and publication finish. Normal pending data retains non-blocking issuance. Fatal/runtime integration checks and external binding restrictions remain unchanged.

Phase 9F-C is complete with the mechanisms and verification described above. Phase 9F-D owns redundant-copy elimination, alias/cycle identity across protection copies, and deterministic mutation through aliases. Its known out-of-range no-op entry gap remains an implementation gap, not a permitted exception to sequential equivalence. Phase 13 owns mutation/observation path-list coordination and compiler integration; the current API protects one reference with one mutable/readonly mode. Neither deferred feature introduces an alternate path or completion condition in this phase.

## Phase 9F-D: Preserve logical identity and eliminate redundant copies

**Status: deferred design and evaluation, not ready for implementation.** Finish Phase 9F-C first. This phase records the agreed scope, evidence, candidate approaches, and unresolved questions so they can be revisited before implementation. It does not select a finished copy-reuse mechanism or a mutation-through-alias rule.

### Scope and relationship to 9F-C

Seek one common solution for unnecessary COW caused by temporary protection or an operation that makes no logical change. Entry is one producer, not the architecture's unit of reuse. Preserve logical graph identity as well as immutable captured values; reducing allocations alone does not establish correctness.

9F-C owns transparent single-path references, metadata-only placement protection, ordinary ownership isolation, record-order publication, and captured Array growth. It retains necessary copies and finishes without an unzip mechanism. Its element-gate cutover may separate aliases in an out-of-range no-op entry where the former whole-Array gate happened to preserve them. Include that case here alongside existing in-range and record-entry failures; do not retain wider gates or temporary identity adapters to hide the deferred work.

The final contracts remain sequential equivalence, owner isolation, immutable outputs, imported-data protection, and non-blocking issuance. No-op protection must preserve aliases and cycles; this is an agreed requirement, not an open choice. The remaining semantic choice is how actual managed writes through aliases behave deterministically. Defer that decision and the mechanisms here, without documenting timing-dependent successful data as an accepted limitation. Keep existing 9F-C ordering and isolation tests; add the stronger identity comparisons in this phase rather than pinning known failures as compatibility behavior.

### 1. Settle deterministic mutation through aliases

A real mutation exposes a broader problem than redundant copying. A managed method can produce an ordinary runtime-owned graph with `this.a = this.b = {k: 1}`. After it returns a primitive, issue a readonly entry on the receiver followed by `a.k = 2`. With an immediately completing callback, current export yields `a === b` and `b.k === 2`. With a pending callback, its lease forces COW and export yields `a !== b` and `b.k === 1`, even after all work finishes. An ordinary observational managed call awaiting an argument produces the same difference without entry. A self-cycle exposes the corresponding difference in `self.k`.

The public-API reproduction uses a `ContextChain` containing `init() { const child = {k: 1}; this.a = child; this.b = child; return 0 }` and `observe() { return 0 }`. Run `init` with `{mutationScopeDepth: 0}`, without extracting a managed receiver value that would mark it shared. Compare `enter(chain, [], context, false, () => input)` and, separately, `run(chain, [], "observe", [input], context, {})`, with `input` ready, synchronously delivered, or pending. Issue `assignPath(chain, ["a", "k"], 2, context)` before resolving pending input, then compare complete exports. Repeat with `init` setting `this.k = 1; this.self = this`, assigning `["k"]`, and checking the self-reference and `self.k`. All twelve scenarios were exercised: ready/synchronous delivery agreed, and pending delivery changed successful data. Imported-alias controls followed the COW outcome in both timings. These are supported operations, not forged metadata or external writes.

Select explicitly between deterministic path-local replacement and write-through aliases within one owner, or demonstrate a simpler rule satisfying the same contracts. Path-local replacement resembles existing COW outcomes but permits in-place mutation only where observationally equivalent. Write-through aliases requires owner-consistent updates of the shared logical identity. Multiple graph paths do not themselves add an owner. Physical representation and lease timing must not choose the language outcome. This choice remains open for discussion; neither option is adopted here. Native methods retain their complete-receiver isolation and internal alias semantics, and external authority is unchanged.

Undoing a no-op copy cannot fix a real write. Do not block managed writers behind observations, add artificial permanent sharing through diagnostic lookups, or change operation scheduling to make the reproduction disappear. Turn this matrix into an integration regression after selecting the mutation rule.

### 2. Classify reuse candidates before designing state

Keep required copies distinct from redundant ones:

- **Mutable no-op entry:** evaluate reverting protection-only copies along its path, including nested/repeated entry and captured consumers. An independently returned callback Error does not itself mutate or poison the reference.
- **Leases:** a lease is temporary protection, not itself a copy. A writer may copy while a lease is live. Releasing that lease does not make a copy containing a real change redundant; evaluate reuse only when the relevant captured logical state is unchanged.
- **Same-value assignment:** prefer avoiding COW before allocation when existing ready facts establish that the operation has no required change. Do not await an unused old value just to compare it. Preserve input/destination validation, supported publication failures, presence, recovery, and structural effects. Assigning `undefined` to an absent placement creates it; replacing poison can remove an Error. Use language-appropriate equality without coercion, including Number `NaN` and signed-zero behavior, rather than a blanket comparison that changes semantics.
- **Existing no-op paths:** audit absent deletion, healthy repair, controlled Array operations with no effect, and other common transitions for reusable proofs. Required input processing and Error handling still happen. Probes found absent deletion already preserved aliases while same-value assignment and an idle mutating managed method copied; start with the successful pattern.
- **Managed native mutations:** retaining an isolated complete receiver graph is acceptable even when a method ultimately changes nothing. Always copying here is explicitly acceptable if detection is difficult. Do not require deep graph comparison, mutation-intercepting Proxies, or a write journal merely to recognize arbitrary native no-ops. Result aliases, key order, transient effects, and rollback make final leaf equality insufficient.
- **Representation/materialization:** a copy may be necessary to express logical presence, versions, ArrayView shape, or native-ready receiver state, even when logical identity is unchanged. Reusing the logical source identity does not always mean discarding its materialized storage.
- **Output/boundary copies:** export and mutable-external snapshots still produce independent native/managed output under their respective contracts. They are not redundant merely because source COW can be eliminated. Never expose original managed storage to native code.

Preserve every committed effect: Array creation followed by deletion retains length growth; record deletion and recreation affects own-key order; failed mutation and repair keep their ordinary baseline and effects. Entry has no callback-wide rollback, and earlier successful commands survive later failure. Equal final values alone prove none of these absent.

### 3. Evaluate a common captured-copy publication mechanism

The zipper candidate copies while descending a path and reuses originals while completing it, stopping where a committed change makes ancestor reuse invalid. Treat this as publication through captured versions, not a second backward mutation walk.

Each actually copied node may need its original and publication authority. Keeping only the root cannot establish partial reuse. Existing recursive continuations may retain these facts instead of persistent per-node fields, but suspended closures still retain per-node information; compare both costs. A parent-placement walk may use the explicitly captured path. Do not discover all aliases by scanning the current parent graph, maintain a global reverse-alias history, or reselect a newer live path on completion.

Include a protection copy that is copied or retained again before it completes. Those captures need the source/version decision appropriate to their own program positions; updating only the current parent placements cannot repair them. Repeated no-op copies must not retain an unbounded chain of originals after their required captures finish.

For each captured copy, establish whether it represents the same logical state: value, presence, recovery, record order, Array length/holes, aliases/cycles, and captured Promise frontier. Derive evidence from ordinary transitions where possible. Avoid a deep equality scan, callback-wide dirty flag, global mutation journal, or identity registry merely to repair eager copies. A settled copy may retain its logical source identity even where its physical representation must remain distinct.

Publication authority is temporal. Only the still-installed version may change live storage; an obsolete/detached version serves its earlier captures. Never replay remembered whole-ancestor writebacks, overwrite independent sibling writes or root replacement, or undo later committed work. The zipper stops for that version where change prevents reuse; it does not dictate the answer for every earlier capture.

An export or another Chain captured before a later sibling write may still reuse the original even when the current copy cannot. Existing COW/retention or a temporary lease must protect that earlier decision before the later mutation. The shared flag records ownership, not whether a mutation happened. Preserve required earlier Promise settlement; freezing a representation must not prevent its captured source versions from advancing normally.

Make the decision visible through the common publication path before exposing dependent completion. FIFO reactions on one Promise do not order work transferred to another signal. Supported synchronous thenables can deliver or re-enter during subscription, so preparation, staging, installation, and exposure must obey the same lifecycle as pending delivery. An eager consumer cannot repair temporal history by rereading the live path.

Do not leave accidental permanent ownership after undoing protection. A probe using current shallow-copy/placement-transfer primitives and a modeled restoration illustrates the risk: lease a runtime-owned `{a: child, b: child}`, perform no-op entry at `a.k`, restore the original root, release the lease, and later assign `a.other = 2`. The protection copy has permanently retained children, so the later assignment separates aliases; without the entry it updates both under current mutation rules. The restoration was a model of the candidate, not an existing runtime feature.

Never clear sticky sharing or retention on exit: an independent lookup, real copy, or escaped capture may legitimately have established it meanwhile. Evaluate temporary protection using existing leases and captured dependencies, with ordinary retention for actual escaped ownership. Include pending child versions whose later publication might inherit accidental retention. Preserve 9F-C's safe pending-capture protection until a common replacement proves all consumers correct; add no producer-specific registry solely to avoid conservative copying.

### 4. Make captured identity usable by every relevant consumer

Start with a capture while entry is open, not only final live state. With `{x: {a: child, b: child}}` and another owner retaining `child`, enter `x.a.k` and begin export before deciding whether to mutate. A no-op must preserve `a === b`; a real mutation must match its direct counterpart under the selected rule. Repeat with `{x: {a: child}, y: {b: child}}`, self-cycles, and cycles spanning containers. Restoring only the live root cannot fix an already-started export or another Chain. Redirecting aliases only inside copied ancestors cannot establish cross-container relationships. Installing protection on the shared source violates earlier-owner isolation.

Top-down export is not by itself a reason to give export an independent unzip algorithm. Evaluate common source finalization with the existing capture and identity-map machinery, including output shells and their references when needed for cycles. Reusing source identity means producing one appropriate output shell within that export; exported storage remains independent. A separate export-only backward-restoration pass would leave other consumers inconsistent.

Compare immediate graph capture with narrow temporary protection or deferred finalization. Do not lease/wait for a whole branch to settle before starting traversal merely to simplify identity decisions: ready siblings must be captured immediately, earlier captures must exclude later effects, and unrelated work must remain available. Retain only dependencies needed by that capture; never rewrite delivered outputs.

Audit the shared mechanism's real consumers:

- Chain lookup/retention and borrowed managed method-result capture, including results referencing a receiver with pending logical properties.
- Export, batch argument export, and controlled host-callback snapshots, reusing their common graph/capture boundary.
- Managed receiver preparation, materialization, isolation, and result publication.
- COW, ArrayView/remap copying, and identity-sensitive controlled operations such as `includes`, `indexOf`, and `lastIndexOf`.
- Ready-only mutable-external snapshots: unresolved required state still fails locally without nested subscriptions or waits. Ordinary result import retains its separate non-blocking contract.
- Error queries and indexed graph traversal: maintain correct edges through ordinary publication, without adding identity/shape waits that their result does not need.

Consumers should share a proof and publication rule, not necessarily one traversal when their readiness or boundary semantics differ. Bound work to the copied path, explicit receiver/inputs, produced output, captured frontier, and maintained dependencies. Add no unrelated graph scan, repeated deep comparison, consumer-specific repair protocol, or lifetime history.

### 5. Retain the experiment evidence and verify the combined behavior

An independent graph-capture model preserved same-container aliases, cross-container aliases, self-cycles, and spanning cycles in eight no-op/actual-COW cases while allowing ready siblings to proceed. It deferred the logical identity decision. This motivates testing capture-based alternatives to wider gating; it is not an integrated proof of ownership, synchronous delivery, record order, or runtime lifetimes.

A separate four-case capture experiment compared protected/unprotected capture with a later synchronous/microtask mutation. A single mutable reuse decision lost an earlier export's alias relationship; temporary protection separated the later write and preserved the earlier decision. This demonstrates the need for capture-specific history, not a requirement to add a new lease type or identity object.

The integrated matrix must cover:

- Same-container and cross-container aliases, self-cycles and spanning cycles, records, Arrays and managed classes; compare topology within one exported graph or through supported identity-sensitive operations, not JavaScript identity across separate exports.
- Runtime-owned, imported, shared and leased ancestors; ArrayViews and supported descriptor-driven representation copies. Earlier owners remain independently readable and receive neither entry waits nor writes.
- No-op entry through absent, pending, or unreadable suffixes. Proving reuse must not consume an unused target, invoke extra reflection, or create a new wait or failure. Actual contained commands keep their normal validation and operation context.
- No-op and real commands, same-value assignment, absent deletion, repair, failure, creation/deletion, nested entry outliving its callback, repeated entries, queued same-index entries, and independent sibling entries.
- Captures before, during and after protection through export and another Chain; later sibling mutation/entry, root replacement, and earlier Promise publication. Earlier captures exclude later effects, live state retains them, and no old ancestor is replayed.
- Ready, synchronously delivered and pending inputs; synchronous re-entry, source settlement, local closure, fatal resumption, balanced leases, release of operation-only originals, and independently retained output lifetimes.
- Whole-value capture waiting for a protected branch while unrelated ready sibling reads and writes progress, including repeated no-op entries and independent Array elements. Do not pass final-output comparisons by gating the whole Chain, topmost shared/leased ancestor, or whole Array.
- The twelve-case mutation-through-alias matrix in section 1, even where no redundant copy exists, and the accidental-retention history after no-op completion.

Protect captures made during entry from the first integrated prototype. Reject a design as soon as it fails those cases; a special solution for captures begun only after entry is not a useful parallel implementation.

### 6. Work to complete before implementation

Revisit the mutation-alias decision first, then select the smallest common evidence for no logical change and the scope/lifetime of any original references. Determine how existing placement/ownership mechanisms convey the result to captures already in progress, and whether avoiding allocation at known no-op transitions removes enough work without a general unzip.

Compare recursive retained originals, captured publication state, and consumer finalization only through bounded prototypes connected to real callers. Measure total concepts, code removed and added, fields and lifetimes, allocations, retained data, path/graph work, and ready/pending costs. A reduction in one module that introduces parallel protocols elsewhere is not a simplification. Avoid unused production scaffolding while evaluating.

Keep a candidate only if it improves the implementation and satisfies the agreed contracts; revert it otherwise. If the remaining identity or ownership mechanism needs substantial machinery, present concrete counterexamples, measurements, and alternatives for discussion before integrating it. Concurrency is not negotiable as a copy-elimination optimization. Native arbitrary no-op detection may be omitted as agreed. Update the architecture and detailed implementation steps after these evaluations and decisions; this draft deliberately does not prescribe the final data model or claim the problem solved.

## Phase 10: Support Promise-valued path segments

Implement [Promise-valued paths](promise-path-segments.md) through the existing observation and mutation walkers using Phase 9F-B's shared placement and capture-ownership contracts. Use explicit observation capture where protection must precede publication, and plain captured continuations for non-retaining work; do not infer that choice from an operation owner. Preserve complete presence/recovery through shared capture and publication primitives. Managed paths and observation-only external paths support dynamic inputs. Mutable external resources require static selection; only their already-selected native suffix can contain dynamic input keys. This phase adds no candidate-resource reservations.

### 1. Consume segments at their logical position

- Normalize each reached String/Number segment exactly once. Consume supported thenables through the common guarded helper before normalization; a synchronous custom delivery continues immediately. A ready PoisonedValue supplies its original Error through the ordinary rejection callback.
- A raw ready or rejected segment failure uses PathSegmentFailed; a resolved non-String/Number value uses InvalidPathSegment. Preserve already-contextualized poison and fatal classification. Do not coerce unsupported values or stringify Promise objects.
- Stop at a failed prefix before consuming unused segments. Unconsumed Promises remain host-owned; do not observe rejection solely to suppress host reporting.
- Carry the path's firstDynamicSegment compiler fact through capture, composition, and entry. It describes source selection, not current readiness. A computed ready String does not become a static mutable-resource route.
- Initial discovery filters only the compiler mutation access tree's static prefixes. An external owner reached before the first dynamic key is eligible; a managed endpoint requests no descendant search. Promise-valued path support adds no leaves or late discovery.

### 2. Protect unfinished path selection once

Walk available segments synchronously. Initialize callback-visible staging, captured versions, and unconditional writeback before subscription. A custom callback may run before then returns. Only a returned pending chain while path selection remains unfinished installs pending-only protection before the issuing stack returns.

- An observation leases the longest reached managed prefix. Later managed mutation uses COW, preserving that captured value without blocking it.
- A mutation gates the reached managed prefix and continues against its private value. If the prefix covers registered locations, establish its external ordering position before publishing that gate and before later operations issue. Implement the handoff to a selected target without acquiring behind later statically reserved work. Evaluate reusing ordinary gate/reservation transitions, preserving narrow sibling progress after selection; retain only an implementation that simplifies the combined ordering model. If preserving that progress needs new scheduling machinery, discuss the smallest semantic restriction before adopting it. Do not reserve guessed native child candidates or treat entry-lifetime membership alone as an ordering position.
- If a static prefix already selected one mutable external boundary, reserve its ordinary phase before waiting for native-suffix input keys. No managed COW or per-property gate is installed inside native storage.
- An observation-only external identity needs no mutation lock or fixed namespace.

Retain one pathSelectionComplete fact, set immediately before handing the selected target to its operation. A pending independent target result does not imply unfinished selection. Reuse one prefix lease/gate across later segments; a ready custom key followed by pop of a pending element must leave the completed Array mutation visible immediately and add no prefix protection for that removed result.

Reuse captured versions and FIFO continuations. Do not add callback-ran flags, a second result algebra, temporary Chains, a new path scheduler, or a second receiver gate. A coarser gate can carry final publication but does not broaden the selected semantic poison scope.

### 3. Reject dynamic mutable-resource selection deterministically

- A dynamic source key before a reached mutable boundary is an invalid external route, including when its current value is ready. Use ExternalLocationConflict with a static-path diagnostic. Fail before native reflection, capability extraction, or external phase reservation.
- Observation returns its local Error. Mutation publishes at an explicit managed scope already selected before the dynamic key; when its intended scope lies beyond the key, use the longest static managed prefix. Capture this fallback location from path facts before waiting, and publish through the existing mutation transition. Never poison a guessed leaf or all resources beneath the prefix.
- Detection time may depend on path readiness; Error location does not. A poisoned prefix returns its original Error before any new validation or unused segment work.
- Dynamic paths selecting ordinary managed or observation-only external data remain supported even when their shared prefix also contains a registered mutable sibling. No blanket rejection of a mixed managed prefix is allowed.
- A dynamic key within an unregistered suffix remains valid, but cannot select or cross a registered descendant without static provenance. Stored native intermediate values, receivers, and callables must be ready; only final lookup values or direct call results consume availability. Final assignment/deletion does not read the old target.
- Entry follows Phase 9F-C's transparent runtime anchoring. Preserve the requested reference and source provenance while protecting its available enclosing placement or registered external scope. Unavailable or invalid application suffixes are consumed only by actual contained commands; no-op entry must not subscribe to unused Promise segments or publish their validation failures. A pending transition still orders conflicting work. Rebasing cannot grant static authority, and the compiler performs no host-category-dependent entry selection.

### 4. Reuse the operation lifetime and publication boundary

A path component reuses its containing query, export, invocation, or entry owner. Standalone lookup, mutation, and repair obtain one OperationOwner through one centralized provision point. The allocation point may be eager or first-pending, but optional-owner branches must not spread through walkers. Preserve Phase 9F-B's separation: capture semantics determine value retention, while common guarded continuations use the operation owner only for local-work lifetime. Version retention and publication never infer ownership from that owner's presence, type, or open state; no query-specific or path-specific version mode is added.

Every pending continuation uses common guarded helpers. In a live execution it finishes required shared settlement before checking local closure; after closure it performs no key normalization, traversal, lease/gate acquisition, native access, publication, or result work. Fatal resumption stops before shared settlement as usual. Observe owned pending walker reactions at their originating layer even when a non-blocking mutation does not return them.

A mutation owner closes after its required gate publication, not its immediate issuance return. Repair closes after its selected scope transition. Read/export/query source protection ends only after final capture; export output keeps its separate lifetime. An independent result cannot extend completed receiver or path protection. A blocking scope ends action-only work without waiting for unused arguments, retaining owned rejection handling and shared settlement.

Repair selects managed placements through ordinary path resolution; registered external scopes additionally require static provenance. Preserve Phase 9F-A rollback baselines across pending path selection, including original placement presence and source versions. Repair exposes the selected managed baseline and clears covered external subtree poison before any call, bypassing no strict-ancestor own poison. It does not erase independent earlier managed failures, ordinary Error data, or permanent binding conflicts.

### Verification

- Exercise root, middle, and final native/custom Promise segments through lookup, lookupPathForExpression, assignment, deletion, run, export, hasError/getErrors, repair, and managed entry. Include ready custom fulfillment, synchronous PoisonedValue failure, pending rejection, unsupported resolved keys, and skipped unused suffixes.
- Extend the existing cross-operation checks in `test/operation-sequences.test.js`, `test/array-native-equivalence.test.js`, and `test/reflection-boundaries.test.js` with pending path selection. Preserve earlier export/query/method frontiers after a resolved child is replaced; compare Array observations across pending entry deletion and a later overwrite against native sequential results; inject supported reflection failures before and after selection resumes. Keep scenarios without extra diagnostic lookups, which could supply missing sharing protection, and verify maintained indexes with the existing refcount oracle. Reuse these suites rather than introducing a separate audit runner.
- Compare ready and pending equivalent paths for values, COW, scope poison location, and complete required Error membership. For expression extraction, ready failure returns its PoisonedValue while already-pending failure rejects with the ordinary Error.
- Test one prefix lease/gate across several pending segments, old-value capture under later mutation, Array views, aliases/cycles, imported/fixed versions, and a ready selected operation with an independent pending result.
- Dynamically select a mutable resource with a ready computed key and a pending key: both fail locally before native access with the same predetermined failure scope. Preserve the exact blocking poison and leave candidate resource phases untouched. Test explicit ancestor bang and default mutation scopes, regular-Chain aliases, and composed/entered provenance.
- Select a managed child or observation-only external sibling through those same dynamic prefixes successfully, without mutable-resource locks. Select a mutable owner statically and use pending suffix input keys under its one phase.
- Verify static discovery creates no candidate leaves from dynamic-only resource selection. A first external boundary found before a dynamic native suffix remains eligible. Context registration remains atomic and later fulfillment adds no authority.
- Enter a managed mixed target through a pending key, then issue a later static native access beneath its available enclosing anchor. Capture the initial external ordering position before later access and retain the pending suffix in the private reference; a no-op callback can finish without consuming the key. A contained command consumes it at its own operation context. Keep Phase 9F-C's single-path anchor fixed, preserve captured predecessors, and allow unrelated work outside its coverage to proceed without reservation/gate cycles. Reject any dynamically derived attempt to use a registered identity. Repeat within nested entries. Separately test the ordinary managed-mutation handoff to a non-resource sibling described above; coordination of multiple declared entry paths remains in Phase 13.
- Exercise closure before a later key resolves, shared settlement after local closure, fatality behind an unresolved key, and ownership of discarded pending reactions. No local closure releases another operation's gate or phase early.
- Cover complete contextual Error queries through static paths, terminal poisoned guards with hidden never-settling children, accessible sibling Errors, ancestor collection of external scope metadata, and old results after repair. No native properties are read to inspect scope poison.
- Ensure no provisional phase map, all-candidate wait, deferred candidate reservation, extra path queue, callback-readiness flag, or compatibility route remains.

## Phase 11: Review imported-Promise settlement ownership

### Problem

The import processor owns segment processing, validation, staging, and abandonment for synchronous and pending custom delivery. It uses the shared placement mechanics established by Phase 9F-B without an installer callback or property-to-import delegation loop. Mutable-authority discovery independently follows Phase 9E's directly accessible source rule.

### Outcome

This phase is a preservation check after Phase 9F-B consolidation and Phase 10 Promise-path changes, with no further production rewrite planned. Verify the resulting processor against the constraints below. The bounded lifecycle evaluation belongs to Phase 9F-B; do not repeat it here or reopen the importer without a newly demonstrated defect or duplicated responsibility.

### Constraints

- Preserve one atomic staged import walk per synchronous segment. A failed segment commits no admissions, origins, retentions, pending Promise placements, fixed imported logical versions, or external-tree leaves.
- Synchronous custom delivery continues the active segment and identity map. Later delivery for a committed placement starts a fresh segment at its existing FIFO position and retains its originating boundary context. An abandoned segment's callbacks retain no import or publication authority.
- Keep external-tree discovery as a separate occurrence walk because it must preserve finite alias paths; commit it atomically with identity admission.
- Reuse placement versions and the existing Promise version. Add no `ImportTransaction`, second overlay store, or parallel continuation path.
- Make no change merely to move code between files. A neutral or larger conceptual result is a failed experiment and must be reverted.

### Verification

- Ready and Promise-fulfilled imports preserve the same admission, attribution, alias, cycle, placement-version, and tree-discovery behavior.
- Failed fulfillment segments leave no partial state.
- The importer still owns raw-input subscription, fulfillment-segment processing, and import policy; shared placement code owns capture, construction, producer tracking, and commits of complete prepared logical state. Ordinary consumption must not admit data ahead of segment validation. Borrowed transition projection continues through result validation, including after copies or repair. No installer callbacks, import-policy forwarding, property-to-import delegation loop, or duplicate processor have returned.

Keep [`import-processing.md`](import-processing.md) aligned with the retained Phase 9F-B boundary; update it here only if a newly justified change is retained.

---

## Phase 13: Cut Cascada over to the execution Error architecture

### Problem

The kernel phases establish the final Error semantics, but Cascada currently owns per-render reporting, root fatal racing, compact source formatting, `RuntimeError`, `RuntimeContextError`, `PoisonedValue`, `PoisonErrorGroup`, `RuntimePromise`, sync-first Promise-like values, legacy kind names, and compiler/runtime helpers that encode the previous transport model. Scattered documentation-update bullets do not provide an end-to-end migration or prove that the final script result, diagnostics, thenable ordering, and browser/runtime support use the kernel architecture without adapters.

### Outcome

Move Cascada to the kernel's Error and execution contracts in one explicit integration phase. Preserve Cascada's useful per-render reporting, compact diagnostic context, bounded formatting, result-driven root completion, and ordered sync-first continuation behavior while removing duplicate Error representations, fatal state, attribution, and Promise paths.

### 1. Integrate execution-owned fatal handling

- Create one `Execution` for each render/run and pass that render's `onError` as its immutable reporter. Concurrent executions with different reporters must not cross-route failures.
- Replace the compiler's error-context-only data flow with an explicit render-local operation-context table. The generated `getErrorContexts`/`prepareErrorContexts` path currently creates one compact tuple per static source entry for each render; change that setup to pair each immutable source handle with the current render's `Execution` once and expose the resulting immutable `{ execution, errorContext }` entries to generated code. Every emitted graph call and command stores or passes its selected operation context directly. It must not recover execution through a diagnostic tuple, a Chain, ambient state, or a later consumer.
- Reuse one operation-context object for repeated execution of the same exact prepared source handle within one render, so ordinary loops and repeated commands do not allocate a two-field record per invocation. Distinct compiler source handles remain distinct even when they share a line, and a dynamically derived immutable diagnostic handle receives its own operation context. Reuse intentionally allows repeated failures with the same cause and kind at that source to merge in collection; collection counts unique semantic failures, not invocations. Runtime-created nested operations reuse the current execution but use the source handle for the operation they actually perform. Prepare derived contexts when a distinct diagnostic route is created, as specified in section 4, without adding mutable operation state to the carrier or allocating fresh handles solely to defeat deduplication.
- Treat the Chain/operation-context pairing as trusted compiler/runtime protocol. Scripts cannot supply it directly; verify that compiler lowering passes the required operation context through all routes rather than adding defensive checks to every generated command and helper. A malformed root integration call throws an ordinary programming error and creates no fatal state or fallback execution. A cross-execution Chain binding or closed entered Chain with a supplied valid operation context deliberately fails that execution before graph access. A future host API may validate its own application inputs but must not add another execution-selection path.
- Make `RenderState`, command buffers, iterators, child buffers, and the scheduler check the execution's `fatalError` at their existing entry, resumption, and dispatch boundaries. Every execution-bound operation passes its classified direct result through the common sync-first `returnOperationResult` helper; only an actually pending operation result registers one removable outward reject action. Replace `raceRootResult` with that general helper and remove its extra rejection-classification catch because operation results are already classified. Remove duplicate fatal Booleans/latches, report idempotence, and candidate selection after all consumers use the execution outcome.
- Remove `RenderState`'s eagerly allocated fatal Promise and its no-op observer. Store only the reject actions of operation results that are currently pending and delete each on normal settlement; a ready-only render allocates no wrapper or registration, and a long-lived successful render retains no historical losing-race reactions.
- Do not preserve `raceRootResult`'s independent `.then` policy or its conversion of an already-failed ready call into `Promise.reject`. The facade helper preserves Error, Function, and fixed admitted-category precedence before ordinary supported thenability, shares the kernel's one continuation path, and throws an already-present `fatalError` synchronously.
- Replace Cascada's `RuntimeError.report`, `RuntimeError.reportAndThrow`, `reportRuntimeContractError`, `createSyncRuntimeError`, `RenderState.reportFatalError`, `RenderState.reportAndThrowFatalError`, and context-keyed fatal adapters according to scope. Execution-bound runtime defects use the kernel's `FatalError` through `failExecution` or observe the execution's existing outcome. Compilation, loading, configuration, and malformed root integration calls outside a render propagate ordinary synchronous programming exceptions and construct no `FatalError`. Do not leave a `RuntimeError` compatibility alias, generic fatal factory for failures outside execution, or competing reporter path. In particular, delete Cascada's no-callback `report(error)` fallback that throws asynchronously: the captured reporter is notification only, and fatal control transfer comes from the detecting call, a pending outward result, a later public-entry check, or `execution.fatalError`.
- Use the same `returnOperationResult` helper for script completion and every other execution-bound public operation. First produce the script result through common export; do not expose a raw managed lookup, a nested Promise container, or a fire-and-register issuance outcome as proof of work the script intends to include. Before final host delivery, convert an ordinary recoverable Error to rejecting expression/native transport after complete export. Public entry throws an existing `fatalError` synchronously; otherwise the operation performs its required boundary processing synchronously as far as possible. The already-classified result preserves Error, Function, and fixed admitted-category precedence before ordinary supported thenability. Return a ready result directly. For an actually pending direct native Promise or supported thenable, synchronously create the outward wrapper, register its idempotent reject action, attach source settlement through the common helper, and delete the action before normal resolution or rejection. Fatal commit rejects and clears the remaining actions. Do not add a second post-operation fatal check: a transition that detects fatality must submit and propagate it, while a later observer checks and returns. Once a result settles, deliver it without waiting for unrelated work. A later fatal is stored and reported by the execution and cannot change the delivered result. Contextless configuration calls remain synchronous and outside this mechanism.
- Use only the documented root package API completed in 9D-B. Graph operations keep their public result boundaries; Cascada does not import private implementations or retain an unwrapped-operation route. Use the same public Error factories, expression factory, guarded composition primitives, and fatal submission for work owned by Cascada. Each kernel call owns its pending API result. Each render with additional required work owns its separate final result once; delegating environment/top-level aliases and callback adapters consume that result without wrapping it again. Compiler commands and buffer lanes are internal scheduler work, not additional outward operations. Tests enforce this classification and reject imports from the removed integration subpath or private kernel files. Measure representative compiled render workloads using the [public-result cost acceptance criteria](#public-result-cost-and-acceptance-criteria): report ready/pending mixes, dependent and branching work, native Promise allocation, peak pending obligations, and end-to-end latency. Compare only implementations preserving prompt fatal delivery and all required completion. If public-result ownership is a material cost, request an explicit architecture decision with the measurements and a concrete public composition proposal; do not restore private imports or silently weaken result guarantees.
- Keep operation owners local. Internal commands, scheduler waits, and guarded helper transitions register no outward result. Public kernel calls retain their own pending-result obligations, and a render with additional required work retains its own. Common resumptions stop after fatality.
- Delete Cascada's fatal broadcast/cancellation path: `_fatalAbortBroadcasted`, `_abortActiveLaneRuns`, fatal-only `CommandIterator.abort` and `ObserverState.abort`, and `_rejectPendingCommandResultsAfterFatal`. Replace `_throwIfFatalLaneAbandoned` and its callers with the ordinary execution check. Do not bulk-reject internal command results merely because the execution failed; an actually pending result exposed by a public operation already has its outward reject action, while purely internal waits stop if they resume.
- Do not cancel or specially settle native Promises, gates, phases, or synchronous external code. A never-resumed internal wait may remain pending without delaying any pending operation result. Section 3 defines the sole additional host-effect exception: local finalization of an iterator the operation already owns. It does not authorize command dispatch, graph transitions, phase/gate settlement, owner sweeps, or cancellation after fatal.

### 2. Replace the legacy recoverable representation

- Use the public kernel PoisonError, CompoundPoisonError, FatalError, Error factories, and separate PoisonedValue factory/predicate. Remove duplicate Cascada Error construction, grouping, wrapper, fatal, and recognition implementations after their callers use those facilities. Keep ordinary Errors inside operation Chains. Compiler lowering converts graph results to expression values only through lookupPathForExpression; expression-created failures use createPoisonedValue on an attributed ordinary Error. Remove compatibility names and markers rather than adapting their old shapes.
- Adopt the kernel's documented ordinary Promise and supported thenable contracts at Cascada integration boundaries. Preserve causal attribution at the producer and avoid a second subscriber queue or transport adapter. Cascada owns replacement of its expression Promise helpers; this project does not specify their internal design. IteratorWaitToken remains an internal scheduler token.
- Cascada consumes the public Error recognition/combination and input-boundary contracts. Kernel integration must preserve complete required Error membership and causal attribution; expression operand evaluation and collection implementation remain Cascada work. Use public getErrors for complete graph inspection and hasError for existence. A successful query yields ordinary data; QueryReflectionFailed remains a distinct failure. Diagnostic inspection returns null when healthy and a safe immutable view for poison. Do not duplicate kernel Error construction or diagnostic data contracts in an expression implementation.
- Map every old Error kind to the authoritative contract-based `ERROR_KIND` table. Treat `UserCallThrew` as a call-site split: selected external Function/method failures use `InvocationFailed`, while callbacks and comparators owned by controlled operations use `ControlledCallbackFailed`. Delete transport-named aliases in the same cutover rather than keeping compatibility kinds.
- Update compiler-generated catches and async boundaries. A language-outcome channel preserves expected poison; a callback, cleanup, scheduler, or bookkeeping transition whose contract admits no Error outcome is fatal-on-escape even when the escaped object is poison.
- Replace legitimate uses of legacy poison `finally` with ordinary local completion/cleanup control flow. Do not preserve `PoisonedValue`'s suppression of a failing finalizer or its thrown-poison conversion. A trusted live cleanup failure, including escaped poison, reaches the fatal envelope; section 3's already-fatal host iterator finalization is the separately specified exception.
- Replace Cascada's cause-only deduplication with the kernel's cause/context/kind equivalence in collection and compounds. Remove mandatory source sorting, logical child-order tests, primary-source guarantees, and stored `.kinds`. Derive diagnostic projections when needed; any sorting belongs to a separate view. Add no persistent Error cache or canonical wrapper registry.
- Remove copying of arbitrary enumerable cause properties and eager cause-stack reads during Error construction. Preserve the exact compliant cause reference under 9D-A's diagnostic-only payload contract. A safe language view uses only the hook-free summaries in section 4; a catch around arbitrary cause inspection is insufficient protection against re-entry or side effects.
- Move `didIterate` and every equivalent loop-progress fact off poison wrappers and leaves into the owning loop's operation-local state. Pass that state directly to failure handling; frozen Errors remain immutable semantic outcomes and never double as control-flow transport. Cover failure before the first iteration and after at least one iteration.
- Keep load-failure policy and discarded-expression Promise handling above the kernel. Cascada owns every Promise it creates and every kernel result it buffers, schedules, or discards instead of returning; attach handling at that exact producer, storage, or discard site. Do not introduce a generic fatal-versus-recoverable policy hook or recursively inspect discarded graph values.

Audit `runtime/call.js` (`callWrapAsyncInternal`, environment calls, and their wrappers), callback/extension dispatch, iterator acquisition/advancement/close, and render-owned loader hooks as host boundaries. Replacing their catches with factories is insufficient: prepare/export inputs, invoke only the exact external action through the shared envelope, check authoritative fatal state there, and perform result admission or fixed-kind rejection conversion in the existing guarded completion work. Keep compiler-generated macro/runtime callbacks in their declared trusted callback roles rather than treating every callable as external code. A host protocol result such as an iterator step record is validated/selected by that protocol before its language `value` enters admission; arbitrary protocol objects are not direct language results.

Remove the raw `.apply(executionContext, args)`/implicit `context.ctx` receiver path for standalone external Functions. A standalone host call uses `undefined` as its supplied `this`; code requiring the old context receives an explicitly declared receiver or argument exported through the common boundary before invocation. Document this API change and migrate built-in environment adapters at the same time. If an API explicitly declares a receiver, export its managed context snapshot alongside the explicit arguments, or select an exact external receiver through ordinary authority and phases. It must never expose a live unexported context by an implicit calling convention. Do not infer managed mutation or external authority from a external Function's use of `this`.

Apply 9D-A's diagnostic-only payload restriction to raw host returned Errors, throws, and rejections from these calls. Higher-runtime validation errors must contain safe facts, not context/receiver objects. Apply 9D-0's successful native `then` restriction to exact Functions, exact external values, exported context snapshots, and final render results. Preserve complete required input/export collection; callback and standalone-call adapters must not reintroduce fail-fast collection accidentally.

Audit the higher runtime against this exact causal inventory; existing poison reaching any row propagates unchanged, while only a raw failure caused by that row receives its kind and operation source:

| Cascada causal boundary | Kind |
| --- | --- |
| BigInt division or remainder by zero | `DivideByZero` |
| Requested binding absent after a successful module load | `ImportBindingMissing` |
| Operator operands violate that operator's supported type contract | `IncompatibleOperands` |
| Loop concurrency limit is outside the accepted numeric modes | `InvalidConcurrentLimit` |
| Value cannot be emitted by the text-output contract | `InvalidTextValue` |
| Iterator acquisition, advancement, yielded-value consumption, or required local close fails while execution is live | `IteratorFailed` |
| Import, include, or component loading fails under configured nonfatal load policy | `LoadFailed` |
| A numeric operation produces forbidden `NaN` | `NaNResult` |
| Value cannot satisfy the requested destructuring form | `NotDestructurable` |
| Value cannot satisfy the requested iteration or membership form | `NotIterable` |
| Lexical/context lookup cannot find the requested variable | `UnknownVariable` |

If a runtime feature no longer has one of these semantics, remove its kind from both this inventory and the authoritative table instead of retaining an unused compatibility value.

### 2A. Integrate the operation-chain boundary in Cascada

- Emit the compact compiler mutation access tree defined in [integration.md](integration.md#compiler-construction-of-the-mutation-access-tree) and pass it once to ContextChain initialization. Collect all potentially executed receiver, property-container, and repair routes; truncate source-computed suffixes and merge static prefixes without evaluating application code. Use property maps with `{}` endpoints throughout, and distinguish omitted input from a root request. Keep poison-scope depth and actual-operation staticness separate. Emit special property names as own data keys. Cascada chooses literal versus constant allocation; the kernel preserves either input. Remove scope-path lists, property-target lists, endpoint flags, and compiler dependencies on private tree records in this cutover.
- Canonicalize routes from entered Chains against their originating root context before truncation and merging. Preserve computed-prefix provenance across rebasing; a relative static suffix cannot grant authority lost in its prefix. Include nested-entry and observation-only programs in compiler tests: the former contribute the correct root-relative routes, while the latter emit no mutation requests merely for method calls.
- Test generated trees for different `!` positions on the same receiver, property assignment/deletion, root cases, overlapping routes, conditional mutations, dynamic receiver versus native-suffix keys, and special property names. Reuse one compiled program with managed and external contexts at different first-boundary depths, including constant-tree reuse across renders. Verify generated setup has no application-expression evaluation or subtree scan, and retain compact shared prefixes in emitted code.
- Replace the hidden external sequencing mechanism with public context-path calls, property operations, and repair, then remove its compiler/runtime routing in that same Cascada cutover. Inventory its actual consumers first: `SequenceChain` also serves explicitly declared sequences, so do not delete unrelated sequence language features merely because they share an implementation. No sequence adapter or duplicate external scheduler remains.
- Adopt Phase 9F-A per-mutation managed rollback, owning-placement baseline retention, external subtree poison summaries, clear-before-call repair, and mixed-entry reservations. Keep compiler guard/recover sequence rollback separate from kernel mutation rollback. Preserve first-dynamic-segment source facts; compiler reference arguments and delayed control flow use enter without granting bang authority. Keep nonblocking assignment/deletion and recoverable failure from selected returned data, not an execution-wide Error history. Test compiled reference functions and conditional repair/replacement on a poisoned final target; ordinary entry must preserve its recovery state and run the callback without a compiler-only bypass.
- Emit entry at the source reference and let the runtime select its ordering anchor under Phase 9F-C. Establish entry before evaluating a slow condition; the condition and body run inside its callback. Supply source-static provenance without guessing host categories or calling a separate entry-target selector. Compare optimized entry lowering against unoptimized control flow, including false/no-op branches, missing/pending prefixes, intrinsic length, root deletion, source attribution, and repair. Supply nested mutation access paths and preserve fixed registered identities under native reset. Test the same compiled source with managed and external host shapes.
- Extend entry with mutation and observation path lists through the [batch entry protocol](enter.md#multiple-reference-arguments). These lists describe the callback's access requirements, independently of the context mutation access tree used for external registration. Capture each available anchor and its retained suffix at issuance, preserving original source provenance, and reserve static external coverage before managed gates can wait. Coordinate overlapping paths and shared pending prefixes before installing gates so one declared reference cannot queue behind another reference in the same entry. Derive references from shared selection/protection without duplicate mutating roots or writeback; start disjoint captures independently. Preserve per-reference readonly capability and captured managed values, including deferred fulfillment protection. Sharing scheduling state must not turn a readonly snapshot into a live mutable alias, and a read-only parent plus mutable child does not justify exclusive native access to the entire parent.
- Invoke the callback once the batch's references have passed their captured predecessor transitions and external effects. This readiness does not require resolving unused data values or retained path suffixes. Preserve each issued reference and its ordering position throughout selection; contained commands consume their own suffixes at their operation contexts and use the references supplied by the batch. For mutation `x.child` and observation `x.other`, both references participate in one entry before its slow condition runs, including when `x` is pending. Do not hoist the condition or all application reads before entry, or route a covered sibling read through an original Chain that would encounter the entry's own gate. An unrelated original Chain receives no implicit batch ownership. Do not nest sequential acquire-and-wait callbacks, delay ready reservations behind unrelated captures, or reserve guessed native candidates. Generated code never accesses private tree state. Phase 9F-C supplies the single-path capture/publication primitives only; Phase 13 owns list coordination, overlap handling, and its public API.

- Verify f(managedBranch, db) followed by db!.set(2) while managedBranch waits behind an earlier gate: f's eventual write must precede set(2). Test opposite argument orders across queued calls, equal and ancestor/descendant references, and a pending managed key whose prefix covers another argument. Include previous outside entries, pending external predecessors, nested issuing views, mixed readonly/mutable references and captured managed snapshots, selection failure, fatal resumption, and unrelated sibling progress. Assert no self/later dependencies, overlapping private publications, early release, or loss of Error effects; effect completion registration alone is not proof of reservation priority.
- Test an entry with mutation list `[x.child]` and observation list `[x.other]`, with its slow condition inside the callback and ready, synchronously delivered, and pending `x`. Reads through the supplied observation reference and writes through the mutation reference must complete without waiting on the entry's own protection. Repeat reads in loops and called Cascada functions, overlap with readonly ancestor references, and interleave later outside work. Include an unused reference with a never-settling Promise or invalid segment: unused data neither suppresses the callback nor creates poison. These are multi-path tests in this phase, not prerequisites for Phase 9F-C.

This phase changes Cascada's consumers of the public kernel API. Expression implementation, operator semantics, and compiler expression design belong to Cascada and are outside this project's deliverables. Do not implement or redesign them here.

Cascada retains graph and call results in Chains and uses lookupPathForExpression when selecting a value for expression evaluation. The kernel supplies only the documented extraction types and failure transport. Cascada can use the public Error factories and createPoisonedValue for its own synchronously completed failures; its pending failures use ordinary Promise rejection. Expression results entering Chain construction, import, assignment, or arguments use the existing supported input-consumption boundary and retain their causal Error.

Error queries remain successful inspection with a separate query-failure outcome. Diagnostic objects and Error collections remain ordinary data. Cascada owns how its expressions consume query results or explicitly propagate collected Errors; no expression evaluator, truthiness rule, arithmetic implementation, or compiler shortcut belongs in this package.

Final render/script output may be a graph. Complete public export, including nested availability and all required Errors, before delivery. A synchronous failure can use PoisonedValue; a pending render rejects its existing Promise directly with the ordinary Error. Preserve the final render fatal obligation through true settlement, without duplicating a delegated kernel result. Native callback adapters receive the ordinary Error.

Verify the integration using public operations: extraction types and ready/pending transport, call-result Chains, thenable paths after Phase 10, causal Error round trips through input consumption, and final export with complete nested Error membership. Compiler and expression implementation tests remain in Cascada.

### 3. Preserve local iterator finalization without fatal cancellation

Keep the ordinary finalization of a host iterator already owned by the exiting loop. This is an explicit narrow revision of the blanket no-host-work-after-fatal wording. Cascada's `for await` loops can call the iterator's `return()` implicitly when a pending `next()` completes and the loop observes fatal state; changing `break` to `return` does not suppress that native finalization. Distinguish this host protocol from internal `CommandIterator.abort`, which is removed with the scheduler's broadcast path.

- Use one operation-local iterator adapter/finalization path and at-most-once close ownership. Preserve ordinary iterator-protocol decisions about when `return` is required; do not manually close an iterator a second time after native `for await` already closes it. Wrap host acquisition, `next`, and live `return` actions through the shared integration boundary and validate their protocol results there. A live close failure is `IteratorFailed` at the owning loop's source. On otherwise successful break/return it becomes the loop's failure; when the loop already has a primary language failure, preserve that failure and own the secondary close outcome, matching throw-completion precedence in IteratorClose. Do not invent compound membership merely because finalization also failed. Fatal detection during either path always wins. An adapter may throw already-classified poison only to signal protocol abrupt completion; the loop's causal owner handles that expected escape before the fatal envelope, as specified in 9D-A.
- If fatal state is already committed when ordinary loop exit reaches close, allow only that exact owned iterator's `return` protocol to finalize. No new iteration, yielded-value admission, command dispatch, managed publication, or external mutation operation may start. A pending `next()` that never resumes does not trigger a sweep or forced close.
- Keep the execution-scoped external-action prohibition during that finalizer. Its deliberate post-fatal semantics differ from ordinary host-result processing: capture and own the close result/rejection without replacing, re-reporting, or waiting to deliver the authoritative fatal. Implement this one local boundary explicitly, not as an `allowAfterFatal` flag on ordinary graph/host operations. If the normal envelope cannot retain a close Promise before propagating the authoritative fatal, factor out its exact synchronous active-action bracketing for reuse by this adapter and expose that narrow primitive through the documented public API; keep the post-external-action fatal classifier on ordinary calls and verify that no other caller uses the finalization exception. The adapter marks only its execution and restores the Boolean in `finally`.
- Own every returned/derived close Promise at this finalization site. A close throw or rejection after fatal cannot create poison, select another fatal, or become an unhandled rejection. A never-settling close may leave internal finalization pending, while any pending public result has already been rejected through its independent outward action. Do not await cleanup before outward fatal delivery. A local runtime defect during live finalization remains fatal; the post-fatal best-effort handling is limited to secondary outcomes after the first fatal is authoritative.
- Update `AGENTS.md`, `error-handling.md`, `data-limitations.md`, and higher-runtime loop documentation to enumerate this exception. Kernel fatal observation still skips leases, owners, gates, phases, and graph work; no global list of finalizers, owner registry, listener, abort sweep, or cancellation mechanism is introduced.

### 4. Preserve diagnostics without kernel coupling

- Preserve Cascada's existing attribution path: compiler source entries identify the originating code, emitted calls and queued commands retain that entry, and the boundary that accepts a host result retains it through deferred rejection. Preserve the behavior of `PoisonError.wrap` that an existing poison keeps its original source. The compact source tables, command-owned operation contexts, and existing boundary continuations provide this behavior without a second Promise transport. Native Promise chaining by itself does not retain source attribution.
- Represent source as an immutable opaque handle backed by Cascada's compact context tables. Remove `renderState` from the context tuple and diagnostic stack frames, and remove `getRenderState`, `isFatalReported`, and `throwReportedFatal`; kernel graph code must not depend on the source shape or recover execution authority through it. Replace mutating context helpers such as `setContextLabel` and `mergeAddedContext` with builders that return a new immutable handle; copy retained route frames and added-context facts before making the complete handle immutable. Retain only source/diagnostic facts, with no render state, Execution, buffer, iterator, Chain, receiver, or closure pointing to operation work.
- Preserve async routes by capturing them where causal work is created, before deferred execution can lose its caller route. When a macro/include/extension or other existing diagnostic route adds frames, derive an immutable opaque source handle containing the static source and that immutable route, and pair it with the execution in the operation context. Pass it through the existing operation/continuation path; the eventual Error retains that handle. Propagated poison keeps its original handle. Replace `_diagnosticStack` and mutable render-owned route lookup only after every existing capture/forwarding site has a replacement. An adapter accepting an optional route is not itself a retention path. Use compact shared immutable frame tails or prepared context tables per route as appropriate; do not introduce an execution-wide diagnostic registry or reconstruct origin from a later consumer.
- Reuse handles for repeated work within the same prepared route. A deliberately distinct derived handle participates in the source component of Error equivalence, so failures on different diagnostic routes may remain distinct while repeated calls at one reused handle merge. Document and test that choice; do not promise both event-log multiplicity and static-handle reuse.
- Implement one hook-free formatter that projects immutable kernel Error facts and trusted source handles into the immutable non-thenable plain view consumed by `peekError`/`#`. Use safe stored messages, primitive source facts, recursively safe child views, and diagnostic-only cause summaries. Never put poison, a native Error, an exact arbitrary cause, or a protected identity in the view. Retain all semantic child/kind membership while bounding rendered text independently; display truncation must not silently truncate `.errors` or machine-readable kinds. A diagnostic Array or child must not become thenable through copied host properties.
- A language diagnostic view invokes no cause getter, `toString`, `then`, arbitrary Proxy reflection, or custom stack formatter. For a native Error recognized with `Error.isError`, a known own data-string message may be used through hook-free descriptor inspection; do not read accessor values or require a stack. For other causes use primitive-safe text or a fixed type summary without traversing the object. Source formatting reads only the runtime-created immutable diagnostic facts above. If richer host diagnostics need native cause stacks or application-specific inspection, keep that explicit host-side activity outside active language evaluation; it is not an extensible formatter hook used by `#`.
- Make formatter failure return a minimal successful immutable non-thenable view, never healthy `null`, poison, or a thrown diagnostic exception. Build the fallback solely from trusted stored kind/message/source facts, with a fixed fallback message where necessary and safe child views for compounds. Keep the fallback builder small and hook-free; it needs no Error factory, execution, or host callbacks. A failure formatting one child preserves the other children and that child's semantic kind through its fallback. Protective catches isolate presentation defects; they are not permission to invoke effectful host hooks during formatting.
- Implement the settled public split: kernel Errors expose only `name`, unformatted `message`, opaque `errorContext`, optional exact `cause`, poison `kind`, and compound-only `.errors`. Replace legacy `_errorContext`, expanded `context`, `fullMessage`, `totalErrorCount`, `kinds`, `getInfo`, and per-location fields with the separate immutable diagnostic view where Cascada still needs presentation. Do not decorate the frozen kernel Errors or leave accidental compatibility properties on them.
- Formatter failure never changes the semantic Error, its source, or execution state. Reporter failure preserves the already-committed fatal and cannot select/report a second candidate or change outward settlement. Safe language formatting and the captured host reporter have different responsibilities and do not share a configurable policy callback.

### 5. Reconcile public API and platform support

- Export the Error classes and recognition APIs directly. Treat deliberate direct construction, subclassing, prototype manipulation, and arbitrary caller-supplied kinds or sources as unsupported programming-API misuse; add no protection mechanism for them.
- Preserve and verify the existing Node `>=24` floor in both packages, including package metadata, CI, and documentation; this is already present, not a new version-floor migration. Require browser environments that provide native `Error.isError` and verify that support in the browser matrix. Use the native predicate directly without an approximate fallback. Older unsupported Node and browser environments remain outside the platform contract.
- Document normalized kernel results as T | PoisonError | Promise<T | PoisonError>, primitive expression results as ExpressionValue | PoisonedValue | Promise<ExpressionValue>, and getErrors results as null or a combined ordinary Error, with query-reflection failure returning its own Error instead of a completed collection. Expression and final native rejection reasons are ordinary Errors. Final script return accepts fully exported graphs as well as primitives and applies explicit failure conversion after export.
- Replace `markValuePromiseHandled` and any equivalent recursive scan with the explicit ownership split: the kernel owns its constructed and derived Promises until immediate consumption, delayed handled storage, or outward transfer; Cascada owns compiler-, loader-, iterator-, buffer-, and scheduler-created Promises plus any kernel result it does not return; the host caller owns a returned public Promise. Keep `markPromiseHandled` only where a known producer's semantic consumer attaches later, and apply it to the derived Promise as well as its source when needed. `observeDiscardedExpression` handles the exact discarded result at the compiler-emitted discard site. Never traverse unused host input or a discarded graph looking for Promises. Audit producers and transfers across both repositories, cover them with strict unhandled-rejection route tests, and remove broad safety-net scans.
- Remove all temporary adapters after the compiler, runtime, diagnostics, and public API use the final model.

### Verification

- Two simultaneous renders route fatal failures only to their own reporters and retain independent authoritative Errors.
- A throwing reporter cannot prevent outward fatal rejection, and a later candidate or nested reporter failure cannot replace the execution's first fatal or trigger another report. Test this through migrated Cascada render routes, not only kernel `Execution` unit tests.
- A fatal while any operation result is pending rejects it promptly, including behind a never-settling dependency. A result delivered first remains delivered while a later detached fatal is queryable and reported.
- A fatal in admission, validation, copying, Error collection, or publication that contributes to the final script export prevents successful render completion. A fatal in work that no longer contributes may occur after delivery and reaches the render's `onError` without revising that result. No render route treats a raw managed lookup, nested Promise container, or fire-and-register issuance outcome as completed script work when the omitted work is intended to contribute.
- Every ready operation result remains ready and incurs no outward wrapper, rejection registration, or microtask. A render whose outward results are all ready keeps an empty registration Set. Immediate non-blocking returns also remain direct. Error recognition precedes thenability, so ready poison is not accidentally assimilated merely to observe fatal state.
- Cascada starts no command, graph work, or new host effect after closure except the exact already-owned iterator finalization in section 3. It does not cancel or specially settle source Promises, gates, or phases, and ignores late operation work at common continuation checkpoints. An internal wait may remain pending without delaying any operation result.
- No fatal broadcast flag, iterator-abort sweep, bulk pending-command rejection, or shared fatal Promise remains. Actually pending operation results are the only registered outward fatal-delivery obligations, and repeated settled results leave the Set empty.
- Iterator tests cover normal exhaustion and required close on live break/return, close failure with and without an earlier language failure, and fatal observed after a pending `next` resumes. In the fatal case the body performs no further work and required local `return` runs at most once; its ready throw, rejection, never-settling result, and attempted kernel re-entry cannot delay/rewrite the authoritative outward fatal or produce unhandled rejection. A never-resumed `next` triggers no forced close. These tests distinguish native host iterator finalization from removed internal scheduler abort APIs.
- Standalone Function, environment method, extension/callback, iterator, and render-owned loader routes use the execution-scoped external-action guard and guarded continuation. An external action that catches its attempted same-execution kernel re-entry and returns success still yields that execution's first fatal; starting a distinct render execution is permitted. Compiler-controlled script calls and recursion remain internal and must not be wrapped as external actions. Cover ready, synchronous custom delivery, pending completion, and cross-execution entry. Standalone calls supply no raw context as `this`; declared context inputs are exported snapshots, and exact external receivers require ordinary path authority. Runtime-created failure payloads and successful results obey the 9D-A/9D-0 boundary contracts.
- Ready and pending poison have identical kind, source, graph effect, and public behavior across compiler-generated control flow, callbacks, calls, import, export, and mutation.
- Through compiled calls and final script export, repeat the kernel complete-collection and publication-failure scenarios: an unreadable property between required failures, a later rejecting sibling, Array sorting/flattening, and an independent operation-result Error alongside receiver publication failure. Verify complete semantic membership, originating script source plus exact native causes, no native invocation with failed prepared inputs, and no early script-result settlement. Keep atomic import, failed-query, structural-payload, and iterator-finalization precedence as specified; do not replace those contracts with universal collection.
- Port the source-location assertions in Cascada's `tests/poison/runtime-promise.js` and the origin-preservation cases in `tests/poison/unit.js` before removing `RuntimePromise` and `valueWithOrigin`; adapt assertions to the final Error surface without weakening their source expectations. Verify ready throws, delayed host rejection, Promise-backed property access, deferred sequential commands, and a failing call inside a macro whose result is consumed elsewhere. Assert original path and exact line/column, not merely nonempty diagnostics. Add a successful producer followed by a separately failing consumer and distinct nested operations on one line. Reusing one raw native Error at two different source handles must retain both attributed leaves in collection; repeated propagation of one poison must still merge. Error order remains unspecified.
- Native Promises and Cascada's retained sync-first thenables use the same ordinary continuation helper. Ready custom outcomes add no microtask, repeated subscriptions preserve FIFO order across settlement, synchronous callback failures unwind through the fatal path, and the normalized returned result is the sole readiness test. Only returned pending chains enter wait/protection machinery; no resolved-value marker, callback/backwrite readiness flag, or kernel thenability cache exists, and `IteratorWaitToken` never crosses the integration boundary.
- Compatibility tests cover the former `PoisonedValue` thrown-poison conversion explicitly: the replacement lets a synchronous callback throw escape unchanged, while pending callback failure rejects its returned chain. Rejection observation accepts custom receivers and creates no observer for synchronous completion; independent results never extend completed path selection or receiver publication.
- A failing trusted live cleanup callback is never suppressed by migrated legacy `finally` handling; ready throws and deferred failures retain the callback's fatal-on-escape contract.
- Ready and pending `#` inspection returns the same non-thenable diagnostic-view shape, healthy inspection returns `null`, child selection never rethrows poison through assimilation, and query failure remains poison. Frozen Error wrappers receive no `didIterate` or other control-state writes.
- Hostile cause getters, coercion methods, `then`, and stack-formatting hooks record zero invocations during `#`, including hooks that would attempt re-entry. A deliberately induced formatter defect produces the minimal successful view with preserved kind/source and safe compound children; it never changes Error state or returns healthy `null`. Primitive reasons, native Errors with accessor diagnostic fields, and opaque hostile causes have safe summaries. Mutating an original source-builder input after publication cannot change stored Error attribution or a previously returned view.
- No legacy Error wrapper, Promise subclass, separate fatal Boolean/latch, report state, transport kind, attribution property, or compatibility path remains.
- Compact contexts and captured diagnostic routes survive deferred work, nested calls, copies, and later Error propagation without consumer reattribution. Derived handles retain no render/buffer/execution authority. Complete child/kind membership survives bounded compound text display. Exact compliant causes remain available for explicit host diagnostics; language inspection does not trigger arbitrary cause-stack formatting.
- Every compiler-emitted kernel call carries an operation context from the current render's table. Repeated execution of one exact static source reuses its immutable carrier; distinct source handles remain distinct; no diagnostic handle retains or recovers `RenderState` or execution authority.
- Cascada imports only the documented root API. Kernel operation calls own their pending results; helpers and scheduler commands do not create extra registrations. A render with additional required work owns its final result exactly once, while aliases delegate it unchanged.
- Focused Error, result-return, and Promise-ownership audits and route tests cover both repositories. The actual-export classifier fails on unclassified package exports, while no custom source analyzer or semantic manifest is introduced. Discarded expressions and every stored or fire-and-forget higher-runtime Promise have one exact owner without recursive Promise scanning.
- The complete Node and browser test matrix passes under the documented support policy.

Update Cascada runtime and compiler documentation, kernel integration documentation, public API and type documentation, Error examples, and the supported-platform matrix.
