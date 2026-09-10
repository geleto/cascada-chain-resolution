# First-Principles Conformance Plan

## Purpose

This plan records the final design and the work needed to bring `src` into conformance with [`AGENTS.md`](../AGENTS.md). Phases appear in implementation order, with completion status recording progress separately from design decisions.

`AGENTS.md` is authoritative for settled contracts. Source and tests are authoritative for completed mechanisms.

Phase 9C, its supported-thenable addendum and completion step, and Phases 9D-0, 9D-A, 9D-B, and 9D-C are implemented. Phase 9E, including its completion addendum, implements atomic registration, compiler mutation access trees, Symbol-backed location records, and single-owner coordination with direct poison completion. Phase 9E-A implements idempotent Error unions and bounded graph presence summaries. Phase 9F next routes public external operations and implements logical snapshots. Managed ownership remains independent of mutation scopes; external mutation is confined to state owned by its selected external boundary.

## Current checkpoint and agreed changes

The current kernel has ordinary FIFO subscriptions, atomic import and index publication, successful-output native-then validation, immutable causal Error wrappers, complete semantic Error collection, one local close transition, and the public higher-runtime API. Poison remains ordinary non-thenable Error data. Expression lookup returns a ready PoisonedValue or a directly rejecting pending Promise; getErrors returns null or a combined Error, and query failures fulfill with ordinary Error data. Context import validates unique external locations and commits execution-local bindings. The internal external coordinator supplies readers-writer ordering and repairable phase poison; public operation routing remains Phase 9F.

| Agreed requirement | Implementation owner |
| --- | --- |
| Ordinary FIFO thenable subscriptions; no source cache, canonical settlement Promise, species/cycle repair, or duplicate subscriber queue | Phase 9C addendum |
| Synchronous callback staging; pending-only versions, gates, leases and operation-result registration; ordinary custom-thenable rejection observation | Phase 9C addendum |
| Atomic import staging/commit/abandonment; mutable-authority discovery uses directly accessible original context inputs | Phase 9C addendum for import; Phase 9E completion for discovery |
| Subscription exit propagates the subscribing execution's authoritative fatal, including one committed by an older queued reaction during that subscription | Phase 9C completion; preserved by 9D-A/9D-B and 13 |
| A detected missing required Promise version fails immediately at publication; fatal detection never waits for the corrupt source to settle | Phase 9C completion |
| Dependency-scoped readiness and a semantic target handoff; an independent result does not retain a completed path or receiver | Addendum for existing routes; Phase 10 for Promise-valued paths |
| Recoverable failure leaves every retained refcount index valid, including downward closure through cycle cuts | Phase 9D-0, preserved by 9D-A query recovery |
| Successful ready and pending outputs obey the same native `then` surface restriction | Phase 9D-0; 9D-B expression-boundary verification; 9F/13 boundary integration |
| Raw failure payloads exposed through `Error.cause` are diagnostic-only host data and cannot expose unexported managed state or mutation-capable external identities; source attribution remains the originating operation's source-error context | Phase 9D-A contract and kernel producer audit; 9F/13 integration |
| Immutable Error wrappers propagated by reference; cause/context/kind deduplication in queries and compounds; unspecified Error order; no persistent wrapper interning | Phase 9D-A, preserved by 9D-B and 13 |
| Operation context is trusted compiler/runtime protocol; malformed root integration calls produce ordinary programming errors, while defects escaping a valid operation enter its fatal guard | Phase 9D-A kernel entry audit; Phase 13 compiler/integration verification |
| No required Error is lost: complete collection is part of determinism; Error order and only the enumerated reporting/detection races may vary | Existing 9C fatal semantics; 9D-A collection/query tests; 9D-B graph/expression boundary; 9E/9F invalid-binding tests; Phase 13 integration |
| Reject off-path regular-Chain access locally in either import order; do not poison the context, rewrite old placements, or revoke settled results | Phase 9E binding kernel and 9F/10 access routing |
| Competing independent context registrations invalidate one shared binding at otherwise-valid import commit; no first-arrival winner or repairable authority transfer | Phase 9E, with 9F/10 integration |
| Reject distinct compiler-selected paths to one external identity within a root context at import; merge shared prefixes and native suffixes under one owner; retain one binding location | Phase 9E completion; 9F public access integration; 10 pending-route preservation |
| One actual external boundary per phase handle; completion-only read groups; observations never add or clear poison | Phase 9E; Phase 9F query composition |
| Compiler-owned mutation access trees with `{}` endpoints; bounded filtering into Symbol-backed location records; no receiver cache or phase payload wrapper | Phase 9E completion; Phase 13 compiler emission |
| Static mutable-resource selection; deterministic dynamic-route failure scope; no speculative candidate reservations | Phase 9F path facts and Phase 10 segment handling |
| Earlier managed and whole-resource entry-binding gates precede external phases; inner commands use normal phases | Phase 9F entry integration; Phase 13 lowering |
| Idempotent compound Error union; bounded immediate-child query summaries | Phase 9E-A before Phase 9F query integration |
| Mutable-only fixed namespace; upfront structural restrictions; ordered external scope metadata queries | Phase 9F |
| One selected scope owns mutation poison; retain managed scopes with fixed native bindings, block every contextual descendant route, and repair only that scope | Phase 9F scope guards and publication; Phase 10 pending paths |
| Managed lookup, import, retention, and mutation use ordinary sharing, leases, versions, and COW regardless of `!`; external methods mutate only their external owner's state | Phase 9F ownership and boundary integration; Phase 10 dynamic paths |
| Keep the separate ready-only mutable-external property snapshot contract, including logical reads of reached managed sources | Phase 9F snapshot integration |
| One public package API for Chain operations, guarded higher-runtime work, Error factories, and expression extraction | 9D-B public surface; Phase 13 compiler/runtime consumers |
| Final Promise-backed placement terminology and one explicit prepare/install/continue/publish/commit/detach lifecycle | Phase 9D-C atomic terminology migration |
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


Retain the strengths that already solve the problem: Phase 9C's first-fatal commit before reporting, removable pending outward obligations, local operation lifetimes, placement versions, and purpose-specific readiness records. Mutation outcome records keep receiver publication separate from an independently pending result. Ordinary invocation returns its result directly through the common completion continuation. Phase 11 remains a preservation check, not another Promise rewrite. Phase 9D-C gives the existing Promise-backed placement mechanism one coherent vocabulary and lifecycle without changing its semantics. Cascada's compact causal sources and bounded diagnostic presentation remain useful; its broad catches, cause-only collection, and mutable poison control fields are replaced. Its existing single root fatal race is not evidence of a current per-operation retention leak; the bounded-obligation design is needed when generalizing outward completion to every pending public operation.

Recoverable graph **Errors** are ordinary non-thenable PoisonError and CompoundPoisonError instances. Ready and pending normalized kernel results carry them as data after required processing. A separate PoisonedValue supplies rejecting transport at expression extraction and explicit higher-runtime failure propagation. Successful Error inspection remains data; collection membership, source attribution, and publication do not depend on expression transport.

## Method

Bake each settled decision into its owning phase's requirements and verification. Remove superseded instructions, historical alternatives, and resolved contradiction entries wherever they describe that decision. Keep concrete removal tasks for code that still exists, but do not retain obsolete designs as phase history or explain settled requirements through a sequence of corrections.

Distinguish semantic defects from documentation clarifications and implementation improvements. Class-hierarchy wording and the placement of an internal helper do not by themselves establish an architectural contradiction. Choose simpler implementations autonomously while preserving the required observable behavior and resource invariants.

Resolve implementation choices through source inspection and a bounded prototype where needed, then select the simplest design that satisfies the settled contracts. Consult the user when an unresolved choice materially changes language or host behavior, required Error membership or attribution, determinism, ownership, failure classification, or supported inputs, or when the investigation does not establish a defensible best approach. Present the concrete issue, recommendation, and remaining tradeoff. Do not reopen an already-settled decision or request confirmation merely to choose helper placement, internal storage, or another equivalent mechanism.

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

Carry the placement-version and publication regressions in 9D-A through their later implementation owners: 9D-B preserves their membership with ordinary graph Errors; 9D-C renames the placement mechanism atomically; 9F applies logical-version copying and complete independent result/publication outcomes to external snapshots and managed/external completion; Phase 10 verifies resumed path publication through every ancestor, with gate completion captured before later work; Phase 11 preserves these behaviors without another settlement mechanism; Phase 13 checks causal membership and ordering through compiler-issued operations and final script export. New routes use the same version, storage-commit, and outcome rules, including the [managed-storage Proxy contract](data-limitations.md#proxies-in-managed-storage). Do not treat these later routes as tested by the current kernel suite.

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
- Ordinary native Array mutation runs once against a lazy traced remap. It preflights only the recorded operations, then either completes them on normal storage or commits them once to the receiver. Invalid Array length remains poison, while read-only length, blocked shrink, ArrayView growth, and restricted element commits are representation fallback.
- A failed mutation preparation, logical transition, or synchronous mutating-function call publishes failure at the selected mutation scope and returns the same Error. Use ordinary prefix failure only before reaching that scope. Observations return an Error without changing their receiver; an independent result failure does not poison an otherwise valid mutation.
- A final missing read is `undefined`, assignment creates the placement, and deletion is a no-op. Traversal through missing, `undefined`, or primitive data publishes one path Error through the common scope transition, using the first failed placement only before reaching the scope. Reaching an existing Error preserves and returns that identity.
- Invalid intrinsic targets use their containing receiver placement as the default scope; an explicit ancestor scope still owns failure. Request validation before `run` captures a receiver remains an API-only Error.
- Supported host calls, controlled callbacks, and reflection hooks reject synchronous re-entry into their own execution as a fatal host-contract violation. Another execution remains independent. Trusted `enter` callbacks retain their existing fatal-abort behavior.
- If import fails after marking an identity, a later explicit import revisits that identity and resumes admission instead of treating the partial metadata as completion.
- Normal property helpers keep their ordinary return types; one private boundary-failure signal carries exact thrown user code to the owning transition.

### Verification

- Integration coverage verifies absent accessors and non-enumerables, representation fallback, missing-value semantics, poisoning and refcounts, exact reflection failures, fatal same-execution re-entry, and permitted entry into a separate execution.
- Imported and protected sources remain unchanged; valid mutations on ordinary restricted storage materialize only when the planned transition needs it.
- `enter` callback failure retains fatal abort semantics.

[`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and [`import-preparation.md`](import-preparation.md) record the completed behavior.

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

Class registration records the exact prototype in a dedicated `Set`; it does not admit or attach metadata to the prototype. An admitted instance stores that exact prototype with `TYPE.ManagedClass`. The registry and instance metadata are separate because a subclass prototype may itself be admitted as an instance of its registered base while also defining another registered class. An instance admitted before registration remains opaque. Type and class definition remain fixed across later registration and prototype mutation. Records and registered instances use one admitted `prototype` fact for copying; later work never re-reflects on the value to derive it.

Records, Arrays, and registered instances are traversable. Functions, Errors, and opaque identities can carry import, ownership, and lease facts, but graph traversal stops at them. `new Chain(value)` admits its root without changing ownership or import status; normal property reads admit children before any identity fact is recorded.

Semantic category decisions consume admitted type. The class registry is read only during first admission; later decisions never reclassify an instance from its prototype. Other structural checks remain only for representation and property shape. `isTracked`, typeless metadata, and public semantic prototype classification are absent.

### Verification

- Every category in `AGENTS.md` is classified independently of method name, using named numeric constants.
- A Promise is resolved before classification; an Error is classified as available terminal data.
- Thenability is sampled once at a program position; both callable and non-callable samples are covered, and direct admission leaves a Promise identity unclassified.
- A fresh assigned graph is admitted at issuance, so nested Promise discovery protects any COW attachment before later mutation.
- An admitted Error remains `TYPE.Error` after prototype mutation makes `instanceof Error` false.
- Class registration uses a dedicated `Set` of exact prototypes and neither admits nor modifies them.
- Admitting a registered subclass prototype preserves both its base-instance classification and its own class definition.
- Metadata creation classifies the available value or accepts its known runtime-created type; every created record is typed.
- Callable-then capture uses separate Promise state and creates no value metadata.
- A previously unseen child is admitted before extraction, sharing, leasing, indexing, or Promise-version installation records facts on it.
- A class registered before admission is registered data; an instance admitted first remains opaque.
- Array and Promise subclasses retain Array and Promise semantics even if registered.
- Every semantic category decision uses admitted type; remaining structural predicates cannot override it.
- Import, extraction, and leases record identity facts on opaque instances without traversing them.
- Classification lookup after admission adds no Proxy reflection, and prototype mutation changes neither type nor admitted prototype.
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

A Promise fulfilled from either boundary continues that same import; it is not another boundary case. Phase 8 routes managed-method results through this importer. Phase 9F does the same for external calls and property reads. Neither phase adds another inbound walk.

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
- Imported physical storage keeps its Promise. The Promise version publishes logical settlement without imported writeback; runtime-owned storage keeps ordinary writeback.

Reflection and failure rules are:

- Enumeration and descriptor lookup remain at their existing user-code boundary.
- Do not invoke ordinary accessors or inspect non-enumerable properties.
- An import-walk enumeration or descriptor failure commits no origin, sharing, or Promise version from that synchronous segment.
- Boundary failures become language Errors; internal failures remain fatal.

Delete the superseded imported/runtime split and its supporting machinery: runtime-island detection, `hasOperationalMetadata`, `promoteRoot`, the runtime walk, `runtimeScanned`, `metadataBeforeRuntimeScan`, `discoverRuntimePromise`, the root/result preparation split, host-change reconciliation, and import-specific ArrayView handling.

Phase 7A adds the matching outbound boundary without reopening admission. Phase 9F reuses this importer for external operations.

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
- Imported Promise fulfillment continues the captured import boundary and remains Promise version-only. Runtime-owned Promise settlement keeps ordinary writeback.
- Import invokes no ordinary accessor. A throwing enumeration or descriptor trap commits nothing from that synchronous segment and produces the boundary's language Error; internal failures remain fatal.
- No runtime-island scan, compatibility registration, or registered/opaque category API remains. Host mutation of imported managed storage remains unsupported.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`data-classes.md`](data-classes.md), [`import-preparation.md`](import-preparation.md), [`array-view.md`](array-view.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

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

Phase 7C reuses the exporter for controlled host-callback inputs. Phase 8 reuses it for managed-method arguments. Phase 9F reuses it for external-method arguments and external-property assignments.

Keep `run(chain, path, method, mutation, ...arguments)` through Phase 8. Its rest parameter already supplies one internal argument Array; pass that Array directly to common export. Phase 9A replaces the signature with the argument-Array and operation-facts API; Phase 9F adds repair to that facts record when repair becomes usable.

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

Use this one rule for script results, host arguments, controlled callback inputs, and Phase 9F external-property assignment. Add no policy switch or second Error walk.

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
- Phase 9F independently keeps required external identity phases through settlement.

Export records no external use and grants no external mutation authority.

This is safe because a ready reachable identity is copied during the synchronous transition and later aliases reuse that copy. A value first revealed through a captured Promise version was not previously reachable through that placement, so its continuation can traverse it once without rereading earlier source state.

Delete only export's source-retention callback and lease-presence tests. Retention callbacks used by controlled methods for later reads remain call leases. Test snapshot stability while later mutation remains in place.

Export has an open output lifetime. Local operation closure releases partial output and copy state. In a live execution, an already-registered continuation still completes shared Promise-version and property-version settlement, then stops before allocating export output, invoking boundary reflection, or publishing an export result. Phase 9C makes an execution-fatal resumption stop before settlement as well. A reached language Error does not close the required Error scan: discard output copies but continue collecting every reached distinct Error. Preserve the captured-frontier, cycle, alias, and distinct-Error behavior documented in [`outbound-export.md`](outbound-export.md).

### 5. Reuse the matching inbound boundary

- Every existing host call uses Phase 6 import for its result, including the operation Promise for a direct Promise.
- Every script result uses common export.
- Phase 8 reuses export and import for managed methods.
- Phase 9F rejects mutation-capable external identities during host-input export, reuses export for external-property assignment, and snapshots values read from mutable external state.

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

Give each public `hasError` and `getErrors` call one operation lifetime around path resolution and branch search. Phase 7B deliberately keeps that lifetime around `walkObservationPath` because the current shared walker has no operation owner, and passes no query-specific state into shared path-resolution or property-version APIs. Phase 10 supersedes only this plumbing: shared path walkers receive the common owner used by every caller, while property-version APIs remain unaware of it.

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
- Phases 9F and 10 keep external boundary preparation inside the selected operation lifetime while preserving phase completion rules.
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

Delete Array-override selection, receiver export, result import, override-specific receiver-lease inference, and the Array own-language-property shadow check. The latter can only produce a misleading error for an index-shaped unsupported method name. Retain `requiresArrayMaterialization` only for representation mutation and COW. Preserve controlled behavior and eligible backing reuse. Imported Array storage never becomes mutable ArrayView backing. External Arrays remain unsupported until Phase 9F adds exact external operations.

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

`includes`, `indexOf`, and `lastIndexOf` capture their search value without leasing it because comparison reads only the captured identity or primitive. Keep the receiver lease for `indexOf` and `lastIndexOf` when ordered scanning resumes after a pending element; `includes` continues to capture every property version it will inspect before returning.

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

The native sorter receives only internal placement records. Its wrapper passes paired exported values to the exact comparator Function with `undefined` as `this`; repeated comparisons reuse the same exported identities. The comparator runs synchronously, may mutate or retain exported managed values, treats exact Functions and external identities as read-only, and must not reenter Cascada. Phase 9F later rejects mutation-capable external identities before they reach a controlled callback; observation-only identities remain exact and read-only.

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
- Move InvocationContext's continuation and fatal-observation methods to the common lifetime helpers. Keep only its lease ledgers and the owner state needed to release them.
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
- Delete registered result copying. Use ordinary import for observations and managed mutation-result import for non-receiver mutation results. Managed mutation-result import revisits admitted managed containers and marks every reached managed identity shared, protecting descendants split between the result and final receiver without result-provenance tracking. Keep the complete-graph copier only for qualifying receiver-isolation subgraphs.
- Simplify receiver materialization and remapping to receiver input only. Delete the old joint receiver/argument preparation, forced result-copy map, `prepareResult`, and the copier's `promiseFound` result.
- Delete the record half of the old own-placement shadow check, `getRecordMethod`, and the `TYPE.Record` host-call branch. Retain managed-class own-placement shadowing and route records into managed selection.

This phase should remove the superseded helpers and fields in the same change; keep no compatibility path.

### 5. Complete managed results

Managed invocation owns result completion and deliberately supplies no common `admitMethodResult` hook: an observation returns the imported method result, while a mutation returns the ordinary `{ mutatedValue, result }` outcome after receiver validation. Importing the whole mutation outcome would cross the wrong boundary. A mutation transition must publish its validated receiver before exposing the imported result.

A synchronous call completes that work immediately. A Promise nested inside a synchronous result is independent data, not invalid state; return immediately and let import continue its retained placement when the Promise settles.

One Promise returned directly by the method extends the managed invocation and becomes its one operation Promise:

- Managed code may access its invocation-owned receiver and inspect read-only exact external arguments until that Promise settles. Every asynchronous access of either kind must belong to it and finish before settlement. Exact external identities may be retained or returned inertly. The managed structure of exported argument copies may outlive the invocation; exact external leaves follow the same rule.
- Detached receiver or external-input work, later receiver access from a nested result Promise, and re-entry into the invocation's execution while its external action is active are forbidden trusted-contract violations. A separate execution may start synchronously. A nested result Promise must not fulfill with the receiver; return it directly when its completion retains invocation state. It may carry an exact external identity inertly but cannot inspect or mutate it after its guard ends. Add no async-context tracking.
- An observation leases every traversable prepared-receiver identity through settlement. Fulfillment imports the result with ordinary shared ownership; rejection remains rejection and leaves the receiver unchanged. Release leases after the last access on every completion path. Later mutations use COW without waiting; add no readers-writer phase.
- A mutation ends receiver-source leases after isolation and keeps its private receiver behind the ordinary transition gate; the gate, not another lease, protects it. Fulfillment uses managed mutation-result import for a non-receiver result, validates the receiver, and publishes one mutation outcome. The result cannot become observable before receiver publication.
- Keep internal preparation readiness separate from the produced method result. The common coordinator must not pass a produced result Promise through an internal continuation whose rejection is fatal.
- Observe a direct mutation Promise at the managed boundary and return a non-rejecting internal completion to the mutation transition. Fulfillment creates the normal mutation outcome. Rejection creates an outcome that poisons the receiver while its `result` remains the admitted direct Promise, so the operation Promise adopts its contextualized rejection.
- If a mutation returns its working receiver, return the published receiver with ordinary result ownership. A receiver validation failure publishes at the selected mutation scope and becomes the operation result; pending transport rejects only after that graph effect is published.

Import every managed result without copying it. Ordinary observation import may retain an admitted root without rescanning. A non-receiver mutation result uses managed mutation-result import because arbitrary JavaScript mutation may detach an admitted result container while leaving descendants in the receiver.

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

Phase 9D-A supersedes the ready-versus-rejected direct-Error distinction: every direct Error follows the same call-failure rules, while an Error from an independent nested result remains independent. Phase 9F adds the live-external-leaf exception to ordinary receiver poisoning.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`managed-invocation.md`](managed-invocation.md), [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 9A: Establish context external foundations

### Terms for Phases 9A–9F

- **Execution:** one operation family's execution-local graph and identity state, fatal outcome, and pending outward obligations. Its external identity map owns binding state and readers-writer cursors.
- **Operation context:** the immutable `{ execution, errorContext }` carrier for one causal source operation.
- **ContextChain:** a public Chain subclass that imports a root host context and filters its compiler mutation access tree. Entered contextual Chains retain the originating route and select the same runtime records.
- **Mutation scope:** the placement whose logical state receives one mutation's success, failure, or repair. `!` selects it independently of the actual native owner. Assignment/deletion default to their target; observations have no mutation scope.
- **Compiler mutation access tree:** a finite own String-keyed property map of static mutation access prefixes, with `{}` endpoints. Calls contribute receiver paths, property mutations contribute containing paths, and repair-only contributes its selected scope path. The kernel leaves this compiler-owned input unchanged.
- **Static external mutation tree:** the context-local runtime tree produced by filtering those explicit routes during initial import. Its connecting maps terminate at first external boundaries; non-external endpoints and empty branches disappear.
- **External boundary/location:** the first external owner reached on a static context route. Its runtime leaf record contains the Symbol-valued identity entry and canonical context/path information, and is itself the registered location.
- **Actual use:** performing a supported call or property operation through its owning external boundary. Managed retention and copying grant no native authority; metadata queries inspect ordered scope state without native property access.
- **Mutable external value:** an exact external identity registered at one context location. It is a receiver capability; native property access uses that owner's phase and cannot expose the capability as a value.
- **External snapshot:** the detached managed value produced by reading mutable external state. It preserves graph topology, supported prototypes, and Functions while copying traversable data under its synchronous nested-readiness contract.
- **Mutation scope depth:** the operation's compiler-selected `!` prefix depth. It is separate from the path's `firstDynamicSegment`, which records source staticness.

### Problem

External ordering needs explicit execution-scoped coordination and mutation-scope facts. Establish these foundations without changing external behavior; Phase 9F exposes repair and routes public external operations. Phase 13 cuts Cascada over from its hidden external sequencing mechanism.

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

Ordinary Chains are mutation-capable and need no capability flag or close lifecycle. `enter` creates an ordinary Chain with an exact internal `entryMutable` Boolean and one-shot closed state. Contextual entry retains its originating context, canonical route, and reached runtime-tree node as needed to preserve source provenance and live guard checks. Shared tree-query functions select boundaries without putting methods among child keys. Observations use the common walker, while mutations additionally assert the entry restriction. Keep no entered subclass, parallel operation path, or compatibility alias for `_mutates`. Ordinary Chains expose no public `close()` method.

Every Chain belongs to the execution supplied by its initialization operation context. Related top-level Chains use operation contexts with the same execution; internally created child, private, and entered Chains inherit that execution through their operation contexts. Independent work explicitly creates its own execution. Missing required operation context is fatal and never creates a private execution. Different executions never share external authority, phases, or poison.

`ContextChain` gives root context import and external mutation indexing an explicit public boundary. It extends Chain and uses the same operations. Its `mutationAccessTree` input is the compact compiler tree specified in [integration.md](integration.md#compiler-construction-of-the-mutation-access-tree); Phase 9E completion supplies the final runtime representation and constructor cutover.

For `apis.data!.write()`, `apis!.data.write()`, `apis.data.status = value`, and `delete apis.data.status`, the compiler contribution is `{ apis: { data: {} } }`. Calls select their receivers and property writes/deletions their containing paths, regardless of poison-scope depth. Only static prefixes appear in the compiler tree, so import never evaluates or retains a computed suffix.

The common importer processes the host root once. Omission means no discovery requests; `{}` requests only the root as a potential external owner. Import filters requested original placements using staged/admitted categories, removes non-external endpoints, and records first external owners without searching managed subtrees. Public `import(value, operationContext)` creates no mutation authority or registration and never downgrades an existing binding.

Import failure classification remains unchanged. A supported boundary or host-reflection failure produces a language Error for the current synchronous segment; an existing Error in the input remains data; an internal failure is fatal. Admission, origin, sharing, Promise versions, tree leaves, and new external identity entries are one transaction: stage them locally and publish them only when the segment commits. A later Promise fulfillment is its own segment, so its failure poisons only that captured placement and does not undo the earlier import.

`enter` creates an ordinary Chain from the selected value, source execution, and exact `entryMutable` Boolean. It selects a reached node of the same runtime tree without copying or registering it. The boundary record is unique to its originating ContextChain and canonical path; retain the originating route needed to apply live ancestor guards even when the entered Chain holds an older managed snapshot. Ordinary authority lookup stops at the first boundary. Mutable-external entry accepts only that whole boundary through a static route and gates its context binding as specified in Phase 9F. Execution identity entries own binding state and phase cursors; exclusive completions fulfill directly with null or exact poison.

Keep state at its natural scope:

- In Phase 9A, the execution owns only the future Phase 9E external identity use-and-phase map. Phase 9B moves existing execution-scoped graph state into it.
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

Phase 9A uses only the presence of `run`'s scope depth to preserve observation-versus-mutation dispatch. Assignment and deletion remain ordinary mutations. Phase 9F consumes the numeric depths when it selects managed and external scopes; retaining the final API now avoids a transitional signature or adapter.

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
- provides the internal anchored-path query for an exact boundary, first boundary prefix, or live scope descendants;
- keeps the tree fixed after construction and derives live authority from its shared identity bindings.

Readers-writer phases fulfill exclusive completions directly with null or exact poison. Invalid bindings leave the runtime tree intact and remain visible to queries. Phase 9F routes public operations through the coordinator and rejects controlled changes that would disturb the fixed namespace.

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
- The static tree and binding map support the internal coordinator. Public external-ordering routes and mutable-capability rejection switch together in Phase 9F; no conflict pruning or first-use state is retained.
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

Keep source context separate from mutable work state. `InvocationContext`, `ExportContext`, Error-query state, and mutation owners still manage open/closed work and resources; they retain the source operation context only when pending work needs it. Operation-bound graph helpers receive the operation context consistently. Execution-owned stores and Chain binding checks unwrap its execution. Pure shape and prototype helpers remain context-free.

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

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-preparation.md`](import-preparation.md), [`enter.md`](enter.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), public API documentation, and execution-isolation examples.

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
11. Preserve atomic import while moving subscriptions into validation. Synchronous custom deliveries reuse the current segment's staging and identity state. Give the segment one local lifecycle fact, `staging -> committed` or `staging -> abandoned`, using existing segment state when available. During staging, deliveries participate in the active walk. Commit grants pending subscriptions authority to import and publish on later delivery; abandonment makes their later callbacks return after the common execution and segment checks without admission, Promise version or leaf creation, or publication. Release staging collections on either terminal transition and retain only the lifecycle fact and captured work still needed by owned reactions. No committed shared version exists for an abandoned callback to settle. Keep those reactions handled without cancelling the source or adding an execution registry, transaction class, or second subscription path. Later delivery for a committed placement starts a new segment at its existing FIFO position. This generic staging lifetime is required here, not in the optional Phase 11 experiment. Final raw-Error construction, semantic deduplication, and their tests remain Phase 9D-A work; no cross-segment wrapper interning is required.
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
| Invocation and managed preparation | Retain pending-only receiver or argument leases from normalized subresults | `receiverReached` remains necessary because a receiver may be reached before the method's independent result becomes pending; `leaseReceiverThroughResult` remains the semantic policy for whether that pending result still reads the receiver |
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

### 2. Use the existing required-Promise version invariant at entry publication

In [`publishEnteredValue`](../src/enter.js), a pending private-root value requires its existing Promise version. A missing Promise version fails immediately, independently of whether the raw value ever settles.

Use [`requirePromiseVersion`](../src/property-versions.js) and let the existing fatal-on-escape transition submit its exception immediately with the entry operation context. Keep no alternate raw-source subscription for corrupt state. Preserve the ordinary `continuePromiseVersion` publication path and its ownership when the required Promise version exists. This reuses an invariant already required by property transitions and adds no new validation pass, recovery mode, or entry-specific pending state.

Adapt [`test/fixtures/enter-publication-fatal.js`](../test/fixtures/enter-publication-fatal.js) and its caller in [`test/enter.test.js`](../test/enter.test.js):

- Retain the existing deliberate runtime-corruption scenario: the mutating entry callback assigns directly to `privateChain._state.value`, bypassing the root transition. Use a never-settling Promise as the decisive case; an already-fulfilled raw Promise must have the same immediate failure.
- Catch the synchronous failure from entry and assert it is the execution's stored fatal, with the entry's causal source and a missing-required-Promise version cause. Replace the old delayed-publication message expectation with the shared invariant's diagnostic; do not preserve bespoke wording by keeping another branch.
- Start and observe an unrelated pending public result before entry. Assert it rejects with the exact fatal without resolving the corrupt source, the reporter runs once, the entered Chain has closed to new issuance, and the outer gate remains pending. Run the subprocess under strict unhandled-rejection behavior and assert no derived rejection escapes ownership.
- Preserve healthy entry coverage: a ready callback result may be delivered while valid private-root publication remains pending behind its ordinary gate, as specified in [`enter.md`](enter.md). Do not join these two lifetimes, await every private publication before delivering the callback result, or add fatal-specific gate settlement.

This is prompt handling of an already-detected runtime invariant failure, not classification of invalid user data as fatal. Replacing this existing corruption fixture does not justify extra malformed-internal-input tests or defensive checks throughout helpers.

### 3. Make execution-binding coverage independent per operation

[`test/execution-context.test.js`](../test/execution-context.test.js) verifies each Chain binding check independently from already-failed public entry. A mismatch case must reach that binding check while the destination execution is still live.

Use a parameterized fixture with a fresh live destination execution for every mismatch case. Recreate the source Chain and effect counters where needed to isolate the case. Cover `lookupPath`, internal `readPath`, export, both Error queries, both path mutations, `run`, and `enter`. For each case assert:

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
- Managed result admission, external observation, export, and public result completion preserve these source invariants and exact-value contracts. Complete receiver preparation, COW isolation, transition gates, and immediate publication when only an independent result remains pending retain their existing semantics. Phase 9F applies this rule to its new external routes and Phase 13 to host-facing render routes.

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

Document this as a host contract in `data-limitations.md` and the host-call API, not a promise of deep runtime enforcement. Audit runtime-created validation reasons and diagnostic payloads so the runtime itself never embeds a protected receiver, argument, or capability. Construct fixed messages and safe primitive facts instead. Do not walk arbitrary causes, invoke getters, export/copy a thrown receiver, or add a cause registry merely to enforce this restriction. Preserve hook-free contextualization and cause/context/kind deduplication. If unrestricted arbitrary object throws are required later, hiding raw causes behind a trusted diagnostic interface is a separate API revision; it is not part of this cutover. Phase 9F applies the restriction to exact external receivers, and Phase 13 applies it to higher-runtime host boundaries.

Settle the kernel Error surface in this phase, before instances are frozen. Kernel Errors expose `name`, unformatted `message`, opaque `errorContext`, optional exact `cause`, `kind` on poison, and `.errors` only on `CompoundPoisonError`. They do not expose Cascada's legacy `_errorContext`, expanded `context`, `fullMessage`, `totalErrorCount`, `kinds`, `getInfo`, line, column, path, or label fields. Phase 13 must provide source formatting and compatibility presentation, if desired by an application, as a separate immutable diagnostic view; it never decorates the frozen kernel Error. This is a deliberate API cutover, not a deferred decision.

Recognize every native Error form before sampling `then`. Use precise `isPoisonError`, `isFatalError`, and native `Error.isError`; remove semantic `isError`, which conflates unclassified native Errors with admitted poison. Guard thenability with native Error recognition: a native Error remains an Error even when it has a callable or throwing `then`, which is never read. Declaration APIs likewise preserve an Error before probing thenability. Both packages target Node `>=24`, and supported browsers must provide native `Error.isError`, so 9D-A uses and tests the exact native predicate without an approximation. Phase 13 applies and verifies that settled platform contract in Cascada.

Every poison call site supplies a `kind` from the authoritative table in `error-handling.md` and an operation source. Export one frozen `ERROR_KIND` vocabulary:

- Implement exactly the complete table in `error-handling.md`; implementation-only kinds are invalid.
- Rename transport-specific pairs to `ChainValueFailed`, `ContextValueFailed`, `AssignmentValueFailed`, and `OperationInputFailed`, and rename one-to-one `...Threw` kinds to their action-based `...Failed` replacements.
- Use `InvalidCallbackResult` for every unsupported controlled-callback result, including a Promise where a synchronous result is required.
- Treat `UserCallThrew` as a semantic split, never a rename or compatibility alias: audit every former call site and use `InvocationFailed` for the selected external Function or method and its direct result boundary, or `ControlledCallbackFailed` for a callback or comparator owned by a controlled operation. Distinguish forbidden mutation-capability export (`ExternalCapabilityEscape`, implemented in Phase 9F) from export reflection failure (`ExportReflectionFailed`).
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

Property publication retains a previously contextualized Error when preflight, index preparation, or physical writeback also fails. Every recoverable retry combines the current diagnostic with the new failure through ordinary semantic deduplication before admission and Promise version publication; it never replaces the earlier cause. Keep one operation-local current value and the existing staged edge commit, with no failure-history registry or graph rescan.

A controlled Array mutation can capture an independent removed-value Error before receiver replay fails. Publish the receiver replay failure through the ordinary mutation outcome, and combine it with the independent result Error for the operation result. A pending independent result may delay that result but never receiver publication or release of receiver protection. Do not traverse nested removed-result payload to look for additional Errors.

An independent result-import failure and a receiver-validation failure are separate required completion outcomes. If both fail, publish the receiver-validation poison at the receiver and combine both failures in the operation result with their original attribution. Result-import failure alone preserves valid receiver mutation. Combine only failures already discovered by these required steps; do not traverse unrelated nested result Promises.

A direct language-result Error always means its boundary failed; it is not a successful language payload. A native Error is contextualized once and an existing poison is preserved. A mutating call applies the same receiver-failure effect whether the Error is returned, fulfilled, thrown, or rejected. An Error reached later through an independent nested result remains independent. Host protocol intermediates are different: reading a non-callable native Error from `object.then` is a successful availability probe, whereas a getter throwing that same Error failed. Keep the protocol's semantic selection inside the exact external action (for example, read the candidate and return it only if callable), then classify its outcome. Do not classify every raw reflection return as a language result or box protocol intermediates in a general result algebra. An existing `FatalError` physically encountered by the protocol still enters the authoritative fatal lane before an ordinary indeterminate/non-callable fallback.

Apply this classification before success handling regardless of JavaScript transport. A non-thenable `FatalError` may physically arrive as a ready return, Promise fulfillment, throw, rejection, or nested imported value; submit it to the current execution unchanged and never admit it as language data.

Make the common post-boundary ready-admission choke point enforce the resulting invariant: an Error reaching ordinary graph admission is already poison. Submit `FatalError` through the fatal lane, and treat any remaining raw native Error as a fatal missed-boundary defect rather than admitting it as generic Error metadata. Boundary-specific import walking may inspect a raw Error only long enough to create its occurrence wrapper before entering this choke point. Test ready, fulfilled, nested, imported, assigned, and host-result routes so no inbound path can bypass contextualization.

Use one private identity-branded external-escape marker, created only around an exact supported external action by `runExternalAction`. That producer owns the selected execution's active-action Boolean and the post-external-action fatal checkpoint. It saves and restores the Boolean around only the synchronous call; add no runtime-wide depth. `catchExternalThrow` at the causal operation consumes only this marker and supplies the fixed operation context and kind. It performs contextualization and the operation-specific failure effect outside its catch; adjacent unmarked runtime failures remain fatal. The marker is neither language data, an Error kind, nor an integration export.

Shared enumeration, descriptor, numeric, and placement helpers keep ordinary return contracts. Returning poison from the key-reflection primitive would require a propagation branch before filtering/iteration and at every intervening indexing/export caller; graph-poison data also differs from a query's own reflection failure. The one private escape carrier preserves both distinctions without mutable policy on contexts or parallel direct-recovery paths. Query/index/export tests pair host traps with adjacent internal defects and verify retained cyclic indexes and non-callable native Error-valued `then` probes.

`runExternalBoundary(operationContext, kind, action)` is the trusted three-argument composition of that same producer and consumer. The action's return or throw is checked against authoritative fatal state before normal outcome classification. A ready language-result Error is contextualized, and the caller applies its result or graph effect outside recovery. Protocol intermediates select their meaningful result inside the exact action. The helper owns no preparation, export, import, publication, bookkeeping, or cleanup and exposes no failure callback or policy mode.

Each initial or resumed semantic step consumes its exact host-failure markers before returning to the common fatal envelope. An issuance-level catch cannot recover a marker that has already crossed a nested fatal guard. Controlled Array work uses one fixed `InvalidArrayOperation` consumer inside those steps; logical scalar conversion owns `ScalarConversionFailed`, including nested Array element reflection. Complete all selected preparation inputs after a ready or pending failure, preserving sparse positions and the same Error membership under either delivery.

Complete collectors separate candidate-key discovery from individual descriptor inspection. Capture placement presence before consuming values, but recover an unreadable descriptor locally so it cannot hide other known keys. A key-list reflection failure ends only the undiscoverable interior. Use the same candidate discovery beneath ordinary enumeration; its callers retain their own complete-collection, query-failure, or atomic-import semantics. Logical Arrays keep numeric key order, and bounded ArrayViews inspect only their selected range without allocating keys for every hole. No catch-policy flag or configurable graph walker is required. Receiver validation records exact reflection failures in its existing accumulator, keeps earlier Errors, and continues accessible sibling placements; unknown identities that cannot pass native-then inspection remain unadmitted.

Array preparation for `flat`, `sort`, and `toSorted` captures sparse placement inputs through the common candidate-key discovery, retaining an unreadable placement as its own failure input and continuing other known keys. Keep these preparation inputs separate from structural remaps, which preserve payload and retain ordinary capture semantics. Flat propagates capture failures while continuing every branch required by its depth; depth zero does not inspect nested values. Sorting joins resolved records and capture failures without an early success-only preparation step, then carries every failure through required default-key conversion or comparator export. A failed candidate cannot prove that fewer than two sortable values exist; the no-conversion fast path applies only when that is established. Invoke no comparator after preparation failure. Capture presence before subscribing to values, preserve holes and ArrayView bounds, and iterate captured sparse keys rather than scanning logical length.

Captured Array intrinsics run trusted algorithms over runtime-owned remaps. Predictable `with` index and growth-length errors are validated before the intrinsic; runtime remap traps wrap only exact host reflection, so internal defects cannot become recoverable Array failures. Application comparators use `ControlledCallbackFailed`; unsupported callback output uses `InvalidCallbackResult`. The selected callback boundary owns a returned Promise's rejection. Scalar conversion uses its own narrow `ScalarConversionFailed` action.

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

Invalid host output is recoverable when the boundary can reject it without compromising runtime invariants, such as an unsupported callback result or invalid completed managed receiver. In particular, if managed-class member selection reaches an accessor, do not invoke it: return `InvalidManagedReceiver` and preserve the original receiver. Unrelated prototype accessors are valid but remain outside the Cascada method surface. Managed invocation owns selection after complete preparation and before isolation, and carries this rejection through the existing `{ mutatedValue: receiver, result: failure }` mutation outcome. No common member-selection hook, new result wrapper, or change to other invalid-call publication rules is needed. Host behavior is fatal when it has already made runtime state, ownership, ordering, publication, or cleanup untrustworthy.

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
| External call throw, returned Error, direct rejection, or nested returned failure | Invocation operation | `InvocationFailed` |
| Controlled callback or comparator throw, returned Error, or poison rejection | Owning controlled operation | `ControlledCallbackFailed` |
| Unsupported controlled-callback result | Owning controlled operation | `InvalidCallbackResult` |
| Supported reflection failure during export | Export operation | `ExportReflectionFailed` |
| Invalid completed managed receiver | Managed mutation | `InvalidManagedReceiver` |
| Supported scalar-conversion hook failure | Conversion operation | `ScalarConversionFailed` |
| Supported property reflection, write, or commit failure | Property mutation operation | `PropertyMutationFailed` |
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
- Placement replacement/removal prepares the new logical edge, completes physical storage work, then replaces/detaches the old version and commits refcount facts. Under the [managed-storage Proxy contract](data-limitations.md#proxies-in-managed-storage), each primitive write, definition, or deletion implements the requested property/Array operation on success and leaves the represented graph unchanged on failure. The old fixed value or pending Promise version therefore remains available through every surviving alias after supported failure. Use these common primitives for ordinary assignment/deletion, Array replay, and enclosing publication; add no Proxy detection, speculative writes, per-caller rollback, or recovery guarantee for violating traps. This restriction applies to individual storage operations, not whole managed methods or opaque external mutations. Runtime-internal Array remapping Proxies remain available.
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
- Mutation-completion tests cross valid/failed result import with valid/invalid receiver state on ready and direct-Promise calls; retain both independently attributed failures and deduplicate equivalent existing poison. Rejected prototype selection is tested in observation and mutation modes, at root and nested placements, with ready, synchronous-custom, and pending preparation; preserve the receiver and allow a later valid operation after the invalid prototype is restored.
- Array preparation tests cover unreadable placement descriptors and failures reading captured values with required Errors on both sides, including a controlled pending sibling, ready/custom delivery, sparse bounded ArrayViews, default sorting and comparator export, and sorting in observation and mutation modes. Verify zero comparator calls after failure, exact original attribution, and a live execution. Flat depth-zero tests preserve unconsumed payload; successful sorting with fewer than two sortable values keeps its no-conversion behavior.
- Publication tests combine a rejected placement value with descriptor or writeback failure, preserve every Error discovered across retries, and deduplicate an existing poison thrown again. Cover indexed and unindexed owners and synchronous custom settlement, then query the retained Promise version and run the refcount oracle. Array removed-result tests cross ready/pending `pop` and `shift` results with receiver replay failure: the receiver publishes its own failure immediately and the independent result combines both without extending the gate.
- `test/placement-version-boundaries.test.js` exercises record/class methods with ready, synchronous custom, and native-Promise receiver data, nested fixed values, aliases, and cycles in observation and mutation modes. Assert host-visible logical values, unchanged imported storage, and no repeated source subscription. Array tests preserve exact contextual poison through slice/concat/pop/shift, bounded derivatives, COW/growth, and complete collection without duplicate causal membership.
- The same tests fail assignment/deletion before physical effects with ready, fixed-Error, and pending old values, indexed and unindexed aliases, and controlled Array replay. Query and mutate the surviving alias, settle/reject its original source, and run the refcount oracle before and after. Retain adjacent corruption tests that remain fatal. The oracle checks the logical edge and allows a settled Promise version to overlay a previous ready physical value after failed writeback; it still rejects a missing placement or inconsistent pending storage.
- `test/publication-failures.test.js` crosses ready/custom/pending managed success/failure with target publication failure, failed gate installation, ready/pending ancestor writeback, and pending removed Array results. Assert complete cause/source/kind membership, graph effects, no later Error entering an earlier gate result, released receiver leases, and healthy repair before an independent result settles. Use controlled pending inputs and strict rejection ownership; do not infer completion from a raw gate payload.
- Existing multi-Error tests compare semantic membership and select diagnostic leaves by cause/source/kind rather than child position. Successful value and effect ordering assertions remain unchanged.
- Verify no loss across automatic invocation and export: mix a ready Error with later rejecting required siblings and nested properties, reverse their settlement order, and compare the complete cause/source/kind sets. Assert that external code is never invoked, each leaf keeps its original source and cause, and a first Error does not close required collection. Use a manually controlled pending sibling to show that the result remains pending after another input fails and completes only after that sibling contributes its outcome. Deduplicate equivalent leaves while retaining different sources or kinds; do not count repeated propagation as another failure. Repeat these cases after the Phase 9D-B graph/expression boundary and through Phase 13's compiler-generated call and final-export routes.

Update [`AGENTS.md`](../AGENTS.md), [`error-handling.md`](error-handling.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-preparation.md`](import-preparation.md), [`managed-invocation.md`](managed-invocation.md), [`enter.md`](enter.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), public API documentation, and integration documentation and tests.

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
- Remove the query-specific rejection wrapper in `ErrorQueryContext.run`. A failed query returns or fulfills with its ordinary `QueryReflectionFailed` Error. `hasError` never converts that query failure to true, and `getErrors` never inserts it into a successful collection.
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

1. **Prepare: `preparePropertyVersion`.** Create callback-visible staging before subscribing through the ordinary sync-first consumption path. Synchronous completion publishes a ready value; only a returned pending continuation requires a Promise-backed version.
2. **Install: `installPlacementVersion`.** After preparation identifies pending work and marks its record `promiseBacked`, attach that exact version before later delivery can run. This helper only associates the version with the placement; the enclosing property transition commits the current staged value and any physical write or refcount change. Fixed versions use the same attachment mechanism through `installFixedPlacementVersion`.
3. **Continue: `continuePromiseVersion`.** The placement-facing helper takes owner, key, source Promise, operation context, callback, and optional operation owner. It captures the required version and registers at the caller's FIFO position. Module-private `continueCapturedPromiseVersion` serves existing exact captures, including PropertyPlacement resolution and forks. Both read the captured version's current logical value when delivery runs; the source callback payload is not authoritative.
4. **Publish: `publishPromiseVersion`.** Validate and admit an available value, apply required retention, and commit through the common property path. A pending replacement requires a fresh version and is rejected here. Initial preparation uses this same publication transition on its staging record, without allocating persistent Promise state for ready work.
5. **Commit: `commitPromiseVersion`.** Update the version's logical value together with any live physical writeback and refcount edge. An uninstalled or detached version updates only its captured value; it cannot alter the placement or its refcount edge. Imported physical storage stays unchanged.
6. **Fork: `forkPromiseVersion`.** Copying or retaining a pending placement creates a distinct destination version at the copier's program position and advances it from the captured source. Synchronous transfer publishes directly; only pending transfer installs a Promise-backed destination.
7. **Detach: `detachPlacementVersion`.** Replacement or deletion removes the placement association. Existing captures may finish their work without changing the replacement placement.

Use `getPlacementVersion` for general overlays; `getPromiseVersion`, `requirePromiseVersion`, and private `isLivePromiseVersion` select or check Promise-backed versions. Captured placement fields use `promiseVersion`; a fork's input is `sourceVersion`. The entry publication boundary calls the placement-facing continuation directly with its private root owner and key. Publication callers use `publishPromiseVersion` directly.

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

Implemented, including the compiler tree input, runtime location records, and direct poison transport specified below. Public external-operation cutover remains in 9F. Observation-only external identities remain unlocked.

### 1. Filter the compiler mutation access tree at import

Use `ContextChain(initialValue, operationContext, mutationAccessTree = undefined)`. The compiler emits a finite own String-keyed property map at every node, including `{}` endpoints. [Compiler construction rules](integration.md#compiler-construction-of-the-mutation-access-tree) are authoritative: calls contribute receiver routes, assignment/deletion contribute containing routes, repair-only contributes its selected route, and every route stops before its first source-computed segment. Poison scope remains an operation fact. Merge prefixes at compilation, with no terminal flag when a requested node also has children. Omission means no requests; `{}` requests only the root. Whole-root replacement/deletion contributes no route.

The compiler retains its input. Do not mutate it, retain it in deferred import callbacks, require fresh allocation per context, or add a reuse option. Build only the filtered runtime branches and location records, without a preliminary deep copy or request trie. No String endpoint or path-list compatibility API remains.

During initial synchronous import, walk the compiler tree together with the original context inputs:

- Use staged/admitted categories. A first external identity becomes one location record and ends traversal immediately, even when the compiler node contains requested descendants.
- At a managed container, read only the compiler node's requested own language placements. Remove managed endpoints and branches left without records. Do not enumerate a managed subtree to discover resources.
- Missing or primitive values, Errors, and Functions contribute no record. Every original Promise or thenable stops discovery, including fulfilled Promises and synchronous custom delivery. Reuse admission facts without a second thenable probe or subscription. Ordinary import retains its normal logical reader and thenable consumption.
- Root discovery setup applies only to the directly supplied original root. Later root or placement delivery never extends authority, even when an earlier import has settled an overlay for that source.
- Every recursive step consumes a compiler-tree edge. Preserve distinct explicit routes through managed aliases and cycles without an identity visited set, recursion-stack cut, completed-scope cache, or relative-path collection. Bound tree reflection to requested placement occurrences and allocation to those routes and produced records.

Stage exact-identity-to-location registrations in the same import transaction as admission, sharing, and placement versions. A second distinct selected location for one identity fails the entire initial segment with import-attributed `ExternalLocationConflict`, leaving prior bindings unchanged. Shared compiler prefixes and several native suffixes beneath one first owner produce one location. Unselected and thenable-only aliases create no claim. Supported reflection failure abandons the same segment; already-owned pending callbacks cannot admit or publish after abandonment.

Commit entries only after the whole synchronous segment validates. An otherwise-valid competing ContextChain registration invalidates shared authority for both locations; a regular Chain's import creates no claim. Preserve the first binding Error. No arrival-order winner, late discovery, or repairable authority transfer is introduced.

### 2. Make each runtime boundary record its location

The runtime tree contains own String-keyed branch maps and terminal location records, as specified by [runtime nodes](external-context-ordering.md#runtime-nodes-and-identity-validation). Each immutable record holds:

- `[EXTERNAL_BOUNDARY]`: its execution-local identity entry, using one internal Symbol;
- its immutable canonical root-relative `path`;
- the originating root `context` needed for canonical guards and binding-entry ordering.

The Symbol is both the discriminator and the entry reference. The compiler never emits it. No Boolean external flag, class discriminator, node wrapper, separate location token, duplicate entry field, or receiver/identity cache is needed. The identity entry's valid `binding` points directly to this record; conflict replaces that binding with Error while the record stays in the tree. The same entry owns the phase cursor.

Arrange ContextChain initialization so committed records have their canonical context anchor before construction returns, preserving the common import transaction and root-value publication lifecycle. Entered Chains select the same records and retain the originating route needed for live access. They do not register, copy a subtree, or derive authority from an old managed snapshot.

Keep navigation in common tree-query functions that accept a runtime node and relative path. Do not put query methods among String child keys. Check the boundary Symbol before traversing or enumerating a node so record metadata is never treated as a child path. Preserve exact branch selection, first-boundary lookup for native suffixes, exact-boundary selection for entry, and descendant enumeration including conflicted entries. A native suffix must not silently widen an explicit entry request. Prune only during construction; committed records and their connecting namespace stay fixed.

Separate actual-value verification from record-only authority checks:

- At an actual boundary crossing, look up the reached value in the execution's identity map. Its entry must equal the record's Symbol-valued entry; a mismatch remains the fatal fixed-identity violation. Do not store another exact identity merely to repeat this comparison.
- Validate current authority by checking the entry's binding against the record or returning its existing conflict Error. Reservation, metadata queries, and deferred authority rechecks use that entry directly, without native reflection or reconstructing a receiver.
- An actual external value reached without a contextual location remains observation-only if unregistered. Registered off-path access returns local `ExternalLocationConflict` without changing the legitimate binding or phase.
- Ordinary Chain/execution and entered-Chain checks remain at their existing public boundaries. Trusted compiler and internal records gain no defensive shape validation, brand registry, or malformed-call tests.

### 3. Coordinate one actual external boundary

`ExternalOperationContext.reserve(operationContext, boundary, exclusive, repair)` validates the selected record's binding and reserves one phase immediately, or returns its binding Error without reservation. Its native `ready` Promise waits for captured predecessors; `prepare()` then rechecks current authority and returns the exact blocking poison unless repairing. `complete(failure)` releases the phase after required boundary work. Actual-value verification occurs where traversal reaches the boundary; the coordinator needs no stored receiver.

Reach the boundary through earlier managed and context-binding entry gates first. At that path's FIFO turn, publish the successor before subscribing to predecessors. Reserve before waiting for native-suffix inputs. Capture explicit graph inputs at issuance through ordinary versions and leases; capture does not grant external authority or require unused action inputs to finish behind a blocker.

A contextual Error query composes independent observations of required scope records under its existing query owner. It does not select several owners for one native action. Keep no candidate map, provisional mode, reselection, whole-selection aggregate, or second scheduler. Public outward fatal-result registration belongs to the existing operation boundary.

### 4. Use one readers-writer cursor with direct poison completion

Observations wait for the preceding mutation. Mutations and repairs wait for preceding mutations and observations. Observations do not wait for one another. Every native property mutation belongs to the entire first external owner: reserve before waiting for its assigned input, hold through complete export and native write, and install no Promise or managed gate in native storage.

The cursor holds the latest exclusive completion Promise and an optional ReadGroup. An observation captures that exclusive predecessor and joins the current group. The next exclusive reservation seals the group, captures its drain and the exclusive predecessor, and installs its successor before attaching either wait. An empty group stays joinable until sealing.

ReadGroup holds only its pending count, sealed state, and native completion Promise/resolver. Its completion is a drain signal with no payload. An exclusive completion fulfills directly with `null` or the exact ordinary `PoisonError`/`CompoundPoisonError`. Initialize healthy state with `Promise.resolve(null)` and resolve subsequent completions with their chosen poison directly. No payload record, wrapper callback, or `.poison` extraction remains.

Consume completions through common guarded FIFO continuations, including already-settled native Promises. Do not infer readiness from a separately exposed value or add a synchronous shortcut. Completion sources are fulfillment-only; potentially rejecting derived reactions retain ordinary ownership.

An observation releases only after its captured predecessor and required snapshot or metadata work. Early query closure stops query-only work but does not release reservations prematurely. Fatality neither completes nor cancels internal phases: resumed work stops at the common execution check, and outward pending results reject independently.

### 5. Publish only phase-owned poison

- Observation success or failure preserves predecessor poison exactly. ReadGroup collects no observation Errors.
- A normal mutation blocked by predecessor poison returns that same Error, skips native work and unused action preparation, and forwards it unchanged.
- An executable external-scope mutation publishes its required failure in that phase. A managed ancestor owning the failure is published first by Phase 9F; the child's phase completes with unchanged predecessor poison. The coordinator stays independent of managed graph state.
- Repair bypasses only the selected scope's old poison and publishes clear state or the new failure. It neither repairs descendants nor changes authority.
- A binding conflict discovered after reservation cannot change repairable phase poison. Revalidate before deferred host access; already-invoked work finishes its required boundary processing.
- Fatal Error never becomes phase poison and adds no completion or cleanup state. Containment quarantine and observation-driven poison propagation have no role under the host ownership contract.

### Completion addendum: implementation and verification

Implemented. The constructor, tree queries, location records, coordinator, and existing callers use the final representation below. Public external routing remains in 9F.

Verification: `npm.cmd test -- --reporter dot` passes all 1,294 tests. The bounded-discovery regressions pre-admit shared graphs, then verify zero descendant reads for a root endpoint and exactly one read per requested placement, including an explicit route through a cycle. Binding, thenable, import-abandonment, entry, phase-poison, and fatal-delivery regressions pass; source searches find no superseded constructor or discovery path.

| Work | Owning phase |
| --- | --- |
| Compact compiler-tree constructor input; bounded filtering and pruning; Symbol-backed location records; removal of receiver caches and completion payload wrappers; existing caller/fixture cutover | **9E completion addendum, complete** |
| Actual-value/entry verification and record-only binding checks as internal kernel primitives; canonical location and entered-tree navigation | **9E completion addendum, complete** |
| Idempotent Error union and immediate-child query summaries | **9E-A**, after the addendum; these fix separate graph-summary issues |
| Apply source-staticness and actual-value checks to public operations; live ancestor guards; native receiver selection; binding-entry gates; snapshotting and contextual Error queries; public entry-target handoff | **9F** |
| Pending input-key delivery through those existing routes and guards | **10** |
| Generate canonical mutation access trees in Cascada; compiled-code size/allocation choices; consume the public operation and entry handoff | **13**, in Cascada |

The 9E addendum verifies its internal coordination and tree interfaces without implementing the 9F public external routes early. Install canonical location metadata now; enforce live ancestor ordering and poison when those routes are integrated in 9F. Removing exponential discovery does not replace 9E-A's independent graph-counter correction.

Rewrite `external-mutation-tree.js` around the one compiler-guided walk and common queries. Remove request insertion, subtree scanning, relative discovery caching, cycle flags, node methods/wrappers, duplicated boundary/location fields, and receiver storage. Update `chain.js`, `import.js`, `import-preparation.js`, `enter.js`, coordinator consumers, and test fixtures directly to the final tree input and records; add no adapter. Keep ordinary import's logical reader and atomic staging. Update `external-operation.js` to use record-only authority checks and direct poison completion, preserving actual-value validation at its causal crossing.

Fixtures supply compiler-shaped trees explicitly. Do not reconstruct scope-list behavior in a test helper by scanning host data to infer its external descendants, and do not retain a path-list overload merely to preserve existing tests. Compiler emission tests belong to Phase 13; kernel tests supply the specified output and prove its interpretation.

The README documents the constructor shape and links to `integration.md` for compiler construction. The ordering architecture owns runtime records and filtering. Phase 13 emits the compiler tree; Phase 9F consumes these completed runtime queries for public routing and entry selection.

Verify supported behavior through ContextChain import and existing coordinator integration tests:

- Compiler-shaped inputs use `{}` at every endpoint. Cover omitted input versus root `{}`, root calls and property writes versus whole-root replacement, overlapping prefixes, Number/String key equivalence, empty String keys, `__proto__`, and keys matching record or former query-method names.
- Test one compiler tree against contexts with the first external boundary at the root, an internal requested node, or an endpoint, and against an entirely managed context. Prune rejected endpoints and newly empty branches. No native child reflection occurs after reaching an external owner.
- Scope position does not alter access selection: `apis!.db.write()` and `apis.db!.write()` contribute the same route. Property assignment/deletion never inspect the old final target. Static-prefix requests ending at a managed node never scan its descendants or evaluate a computed key.
- Preserve native Promise and custom-thenable coverage at root, intermediate, and terminal positions, including synchronous delivery, rejection, and already-settled import overlays. Direct siblings still register; ordinary import results, rejection ownership, and Error attribution stay unchanged. Discovery adds no subscription.
- Cover a direct alias plus a thenable-only alias in both traversal orders, explicit duplicate locations through managed aliases and finite cycle routes, repeated native suffix requests under one owner, regular/context import orders, competing context claims, and cross-execution isolation.
- Verify bounded discovery with a self-cyclic tail wrapped twelve times by `{ left: previous, right: previous }`: only thirteen managed identities represent exponentially many routes. Pre-admit it to isolate discovery work. Compiler input `{}` must inspect no descendants; a finite selected route must read only its named occurrences. Test a shared acyclic graph with many unrequested routes to a resource too; discovery neither expands nor registers them. Assert the finite work bound rather than implementation-specific cache contents or timing.
- Reuse one unchanged compiler tree for several contexts/executions. Distinct selected identities have independent entries. The same selected identity in two independent ContextChains of one execution still creates the ordinary shared conflict, even when the compiler object is identical. Different executions keep independent runtime records and phases under the existing host ownership contract. Failed construction cannot mutate the compiler input; abandoned callbacks cannot publish or invalidate an existing binding.
- Verify the internal actual-value/entry check makes a mismatch fatal at a valid boundary crossing, off-path access returns local poison, and common tree queries retain conflicting records for metadata consumers. Canonical selection through entered Chains returns the original record; exact branch lookup does not accept a native-child suffix. Phase 9F verifies the public PropertyValidation outcome and live guard behavior.
- Preserve overlapping observations, full-group drain, readers finishing before later readers join, sealing, independent owners, whole-owner pending property input/write ordering, and native FIFO delivery for pending and settled predecessors.
- Verify healthy completion is `null` and leaf/compound poison remains the exact original object through native completion, observations, blocked mutation, and repair. Preserve old captured outcomes, binding-conflict behavior, unused never-settling arguments behind a blocker, and managed-scope-owned failure leaving child phase poison unchanged.
- Preserve query-owner early closure with later normal phase release, complete required metadata collection, no native reflection during metadata queries, causal host throws/rejections, and prompt outward fatal delivery behind a never-settling predecessor.
- Run the full suite. Source searches must leave no alternate constructor format, subtree-discovery machinery, redundant boundary/receiver representation, completion payload wrapper, speculative selection API, or fatal cancellation path.

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

## Phase 9F: Route and cut over external operations

This phase preserves Phase 9E's import-time rejection of distinct candidate paths to one external identity and uses its single-location binding/access policy. Regular-Chain aliases fail locally without invalidating the context; only competing context registrations create shared invalid authority. No old placement is rewritten.

### Problem

Phases 9A through 9E-A provide execution-local graph state, causal Error handling, the static external mutation tree, durable identity state, readers-writer phases, poison, and internal repair. Route every external call and property operation through those mechanisms and expose repair. This repository has no hidden sequence-Chain implementation to remove; Cascada's compiler/runtime migration belongs to Phase 13.

### 0. Preserve managed ownership at external boundaries

Apply the [ownership boundary](external-context-ordering.md#managed-and-external-ownership) throughout the public cutover. An external method may mutate only state owned by its selected first external boundary. A managed ancestor, sibling, or aliased identity stays managed and cannot be mutated through native references, even under a broader `!`. Separately owned external resources likewise gain no mutation permission from a shared managed parent. Hosts that need one native operation to mutate a combined graph declare its owning record external before import.

- Managed lookup, assignment inputs, retained results, entered branches, and parent captures keep ordinary sharing, leases, captured versions, COW, and receiver isolation. A `!` path or an external child changes neither their category nor their ownership rules. Keep the existing protection of pending versions, Array backing, receiver/result aliases, indexes, and imported storage.
- Keep ordinary import identity admission and within-graph aliases/cycles. A raw identity admitted as managed is read-only to external code, wherever native references to it occur. Do not detach initial managed aliases according to mutation paths, promote admitted identities to native-writable storage, scan opaque interiors, or track hidden aliases. Supported checks apply only at actually reached boundaries; excluded hidden writes remain a host-contract violation.
- The static tree records discovered external boundaries and their parents for authority, ordering, and fixed-location checks. Paths finding no external boundary add nothing. Add no capture selector, persistent scope-copy markers, descendant copy flags, or managed-source storage mode.
- Managed-only observations need no external phase solely because they lie under a `!` prefix or have an external sibling. They still obey ordinary managed gates and captured versions. Actual external access reaches its owning boundary through earlier managed gates before reserving its phase. Phase 10 protects dynamic managed prefixes through the ordinary walkers and rejects dynamic mutable-boundary selection without reserving speculative phases. A broader managed mutation prefix retains its ordinary gate but does not authorize effects on other external owners.
- Preserve opaque external references through managed sharing and COW without reading or cloning their interiors. A retained parent grants no external authority at its new location. Direct capability extraction and native export retain their rejection rules, and graph changes must preserve live registered locations.
- Copy property results read inside mutable external state under that boundary's observation phase. A reached managed source is read through its logical versions and Array projection; the snapshot never grants native mutation of that source. Retain the existing ready-only nested snapshot contract. Ordinary managed pending data remains supported without that restriction.
- Host-method results keep their ordinary import contract: return independent data or relinquish mutation of the returned managed identities. A host that will keep mutating a returned graph must provide a detached copy. A new shallow result container does not establish independence for its descendants. Do not add a general borrowed-result adapter or scope-dependent Array implementation to ordinary managed operations.
- State the corresponding native-collection limitation in `data-limitations.md`: an external Array uses native method effects and result ownership, not the controlled Array method table. Receiver-returning native methods fail the existing receiver-escape check; shallow borrowed results require host-provided detachment or ownership relinquishment. Do not add implicit callback export, automatic observational mutators, or a second set of Array algorithms at the external boundary.
- Apply ownership to dependencies as well as effects. A hidden read of another mutable external owner's state is unordered, even when the selected receiver is observation-only. Require one combined external owner or explicit detached inputs; keep immutable configuration and read-only protected managed source references permitted. Check only actually reached identity metadata, never closures or opaque interiors.

### 1. Finalize the public operation API

Extend `run` with the required exact `repair` Boolean:

~~~js
run(chain, path, method, args, operationContext, {
  mutationScopeDepth,
  repair,
})
~~~

- `repair: true` requires a mutation scope, is valid only for `run`, and performs repair-and-call.
- Assignment and deletion accept no repair fact.
- Add `repairPath(chain, path, operationContext)` for repair-only. It targets the selected retained managed scope or registered external boundary, creates no registration or authority, and invokes no external code. It clears scope poison while preserving the retained value; ordinary Error values still use assignment/deletion. Add it to the public facade and package-surface classification so pending repair uses the common outward fatal boundary while ready repair remains direct.
- Assignment still replaces, and deletion removes, an ordinary Error at their final managed placement. Neither operation implicitly repairs a retained managed guard or external phase poison.
- Keep assignment/deletion's non-blocking issuance contract. Required publication and poison effects continue independently of that immediate return. Do not add a completion-Promise API to force scripts to collect mutation failures. Recoverable script failure derives only from poisoned returned data; repair and replacement may remove Errors, and complete collection does not retain failures outside the required output/data frontier. Fatal result delivery remains separate.

#### Retained managed scope poison

The common semantics are defined by [scope transitions](error-handling.md#scope-transitions); this section specifies retained namespace storage.

The selected mutation scope owns the failure once. A scope at or inside an external boundary uses that boundary's phase poison. A managed scope retaining fixed external bindings keeps its underlying value and records poison in scope metadata. For `api.managedContainer!.externalApi.someCall()`, failure poisons `managedContainer` only; the selected child still has an exclusive ordering phase but receives no new poison for that failure. Ordinary managed scopes without fixed native bindings keep ordinary Error-value publication. An unauthorized alias mutation follows its local graph-failure effect without changing the legitimate context's scope or phase.

- Keep the guard at its owning context placement, independent of shared managed identity metadata. Preserve earlier captured values through ordinary versions/COW. Use one authoritative scope record for retained state and poison, referenced from the existing logical placement/transition and canonical context-tree path as needed; add no second poison copy on descendants, graph-wide registry, or reverse alias index.
- Placement versions already live in metadata. Use that existing representation to expose the scope's logical Error, retaining its actual previous logical value once as recovery state. Repair publishes the retained value through an ordinary placement transition; it neither assumes physical storage still holds that value nor changes an earlier captured Error version back into data. Poison and repair preserve protected ancestors through ordinary COW. They need no copy of the retained scope's children solely to change its guard. COW of a surrounding context preserves the canonical scope's guard and recovery association; an ordinary captured data copy keeps the logical Error and gains no recovery authority. Do not put a mutable poison field on the retained managed identity or copy operational metadata wholesale.
- Normal lookup, `hasError`, `getErrors`, export, and subsequent mutation observe the guard's Error and do not traverse its retained contents. Integrate this at the common logical-value/publication boundary; indexed Error queries must agree with unindexed queries. Retained data is recovery state, not an additional graph or Error-collection frontier. A captured Error stays immutable after repair.
- All live external access obeys current ancestor guards, including operations issued later through a previously entered Chain. Its managed snapshot does not grant authority to bypass live context ordering or poison. Carry the canonical ancestor scope context through entry and enforce it in shared external-access preparation. Preserve legitimate access by the entry that owns its private gate; an older or outside entry cannot treat that later gate as its own. Do not solve this by poisoning child phases or rereading an old managed snapshot as current authority.
- Publish managed-scope poison before completing the child external phase. Pass only phase-owned failure to `ExternalOperationContext.complete`: use `complete(null)` when the managed guard owns the new failure, preserving any existing child predecessor poison. This keeps the Phase 9E coordinator unaware of managed data and needs no second failure policy or mode on that coordinator.
- A blocked descendant contributes the existing ancestor Error and performs no host access or new scope poisoning. Required input Error collection remains complete without changing the blocking guard's original poison. Independently preexisting descendant poison remains intact; it is not another copy of this operation's failure.
- Repair orders through the selected scope's existing managed transition or external phase. It bypasses and clears that scope only, making retained managed data available again. Repair-and-call bypasses that selected scope's old poison, then clears it on success or replaces it with the new failure. Pass external repair intent to the coordinator only when the selected repair scope is external. A deeper repair cannot pass an unrepaired ancestor, and repairing an ancestor performs no descendant sweep or implicit child repair. Ordinary assignment/deletion cannot clear a retained scope guard.
- Preserve the fixed namespace under its guard. Reject forbidden namespace replacement, remapping, and arbitrary managed mutating receivers before effects; do not invoke on a preserved candidate and validate afterward. An external call cannot modify its managed namespace. Ordinary managed receiver isolation outside that namespace remains unchanged.

#### Static mutable-resource paths

Carry one firstDynamicSegment source fact with captured path input through all public path operations and entry composition. Ready computed keys remain dynamic; segment readiness and input validation keep their separate meanings. Compiler/runtime facts are trusted, but ready String values alone cannot establish this authority distinction. Do not place source provenance inside opaque errorContext or allocate a wrapper per segment.

For concatenation of captured paths `prefix` and `suffix`, use `prefix.firstDynamicSegment < prefix.length ? prefix.firstDynamicSegment : prefix.length + suffix.firstDynamicSegment`. Path length is the fully static sentinel, so an unconditional minimum would incorrectly mark a static suffix dynamic. Truncating to length `k` uses `Math.min(firstDynamicSegment, k)`. Entry retains canonical prefix provenance independently of its relative suffix; removing an already consumed computed prefix must not grant static authority. Verify fully static concatenation, a computed key in either operand, truncation before and after that key, empty paths, and nested entry rebasing. A whole-path Boolean cannot distinguish forbidden computed resource selection from a permitted computed suffix inside a statically selected resource.

For a managed `api` containing mutable external `db`, distinguish `api.db!.addUser(1)` from `api[getDbApiSynchronously()]!.addUser(1)`. Only the former supplies the static child location. Verify that returning `"db"` directly, through a synchronous custom thenable, or through a pending Promise leaves the latter dynamic. Cover a resource registered by another static use and a program containing only the dynamic mutation request. Context discovery must not evaluate expressions or build child candidates from that request.

After applying any existing prefix guard, reject a computed route that would select a mutable external boundary before native reflection or phase reservation. Use ExternalLocationConflict with a static-path diagnostic. Observation returns its local Error. Mutation uses an explicit managed scope already selected before the dynamic key, or the longest static managed prefix when its intended scope lies beyond that key. Retain that failure location independently of detection timing. Phase 10 adds pending delivery of the same rule; no candidate reservation or guessed-resource poison exists even for ready computed keys.

A dynamic route to managed data or an observation-only external identity remains supported, including beside registered mutable siblings. Dynamic keys inside an already statically selected mutable boundary remain valid native suffix inputs. Fixed namespace restrictions apply only to registered mutable identities in their originating context; physical COW and inert aliases do not create another namespace or external authority.

#### Whole mutable-external entry

Compiler lowering enters only the whole first mutable external boundary through a static path, never a native child. A conditional modification of resource.startPosition.x enters resource even while the condition is pending. An entry is a whole-resource exclusive control-flow scope, including a read-only callback; the entered Chain's capability still forbids writes when entryMutable is false. Observation-only external identities need no mutable-resource lock.

Reuse the ordinary entry gate at the contextual binding. Keep the exact resource in the private Chain, with its canonical tree location and own gate ownership. Outside and earlier entered routes wait at that binding gate before reserving external phases; commands inside reserve normal phases and bypass only their own binding gate. Entry holds no external phase across its callback. Already-reserved predecessor work keeps its captured path turn and never waits for a later entry gate; deferred binding validation does not restart path capture. Close issuance and republish the same binding through ordinary gate publication; already-issued native work remains ordered by its phases. No private phase scheduler, native child Chain, resource copy, or native-property managed writeback is needed. Inner repair remains possible because entry itself does not consume phase poison.

A requested property beneath a mutable external boundary is PropertyValidation poison, even when incorrect compiler lowering generated it. Check this once at semantic entry target selection, before native child reflection, gate installation, or callback invocation; do not convert it to a fatal trusted-control defect or silently widen the target. Respect existing ancestor guards and external phase predecessors. Read-only entry failure is local; mutating entry failure publishes at the owning external scope without replacing its exact binding. Existing poison remains the original Error.

Compiler analysis enforces static whole-boundary entry where the boundary is known. Host category and exact binding still come from runtime admission/discovery; lowering cannot infer the first external boundary merely from a bang position. Preserve path provenance through nested entries so a computed prefix cannot become static by rebasing a suffix. Entry is control flow, not an arbitrary namespace replacement.

Define the public kernel/Cascada handoff for entry-target selection in this phase. Generated setup uses the completed import tree to resolve the relevant static prefixes of access/effect paths before delayed callback work starts; source analysis alone cannot classify host objects. A requested scope already above the external boundary retains its managed entry, while a planned scope below that boundary must be lowered to the whole boundary with the remaining operation suffix rebased into the entered Chain. Selection uses runtime-owned tree facts without native child reflection, waiting for keys, or creating authority. Dynamic native suffix inputs remain unconsumed until their ordered operation reaches them. Selection must not silently widen an explicit `enter` call: the strict child-entry validation above remains in force. Expose only the path information needed by generated code through the documented public API, without a second tree or scheduler. Phase 13 consumes this handoff. Verify the same compiled static effect path against contexts whose first external boundary occurs at different depths, plus an entirely managed context, and preserve fine-grained managed entry wherever no external boundary requires widening.

### Common scope transitions and Error queries

Implement the [scope transition table](error-handling.md#scope-transitions) once before category routing. Resolve the selected scope and report receiver effect/result into its existing transition. Preparation, controlled methods, managed invocation, external work, and deferred writeback must not publish independent receiver poison when an ancestor scope owns the failure. Preserve the distinct successful mutation/independent Error-result case.

A blocking guard returns its exact leaf or compound Error and skips descendant work, unused suffixes, and invocation-only argument preparation. Retain issuance capture, already-owned rejection handling, and shared settlement. New failures before reaching a scope follow ordinary prefix rules; failure after reaching it belongs to that scope. Repair-and-call bypasses old poison privately until its one ordered completion and never reintroduces the replaced Error.

Contextual hasError/getErrors observe accessible runtime-owned scope poison in phase order without native reflection or capability extraction. Exact healthy scope results are false/null; poison results are true/the original Error. Ancestor queries combine all required accessible managed Errors and external-scope metadata observations, using the static tree and ordinary query owner. A zero managed summary must not hide external scopes. A poisoned guard is terminal and its retained children are not traversed or awaited. Binding conflicts remain visible Errors; copied aliases gain no live authority. Preserve captured query results across later repair, and release already-reserved observations normally after hasError short-circuits.

### 2. Use one external-operation lifecycle

Implement the [routing and capture points](external-context-ordering.md#routing-and-capture-points) before extending category-specific invocation. In particular, replace `run`'s unconditional selection of `walkMutationPath` for every mutating call: an external scope must not trigger managed-prefix COW before method dispatch discovers the external receiver. Use the fixed tree and scope depth to select the required transitions, while actual traversal still respects earlier logical gates and guards. Property operations likewise classify the containing placement rather than consuming the final old value. Reuse the existing traversal and transition mechanisms; add no complete parallel external walker or phase reservation at the root ahead of earlier managed gates.

After hook-free internal dispatch accepts the operation:

1. Capture the final compiler-provided operation facts.
2. Query the complete receiver or property path for the exact external boundary or first boundary prefix. Observations query too. Select the owning external boundary for the actual host effect; a broader managed mutation scope does not select unrelated owners for mutation.
3. Capture ready managed property versions and explicit inputs at issuance. Traverse earlier managed gates through their existing FIFO continuations before reserving a descendant external phase. The fixed single context location makes that gate the ordering boundary for all valid access; an outside phase must not block work inside the entry whose gate it awaits.
4. At the statically selected mutable boundary, create one single-boundary phase handle and publish its successor before subscribing to its predecessor. Observation-only identities require no phase. Preserve the managed scope or entry-binding gate independently. Export rejects mutable capabilities instead of acquiring authority for them.
5. Wait only for required readiness and selected phase predecessors. Validate current bindings before host access. A later conflict is a shared binding Error; an off-path regular access is operation-local. Neither causes eager graph rewriting. A reservation invalidated by a later binding conflict forwards its predecessor poison unchanged; an already-invalid binding acquires no reservation.
6. A blocking scope or binding Error returns its original poison before descendant or action-only input preparation. Otherwise finish the executable boundary's required preparation and complete Error collection; preparation failure skips native work.
7. Otherwise traverse the captured host suffix once and resolve or invoke its selected member once.
8. Process the boundary result: import call results and observation-only external-property results; snapshot property results inside mutable external state.
9. Publish managed state, external phase poison, or repair, then fulfill exclusive completions with null or exact poison and release observation drain signals.

Before step 7, do not inspect the selected external receiver's host suffix, descriptors, getters, setters, properties, or methods. Earlier argument export and other required boundary preparation may perform only the host reflection explicitly allowed by their own contracts and causal boundaries. Prepare a callable as executable rather than importing it as data. Constructors remain unsupported.

Waiting at an earlier managed gate delays reservation of the known static location; it does not create authority. Once the reached boundary's phase is reserved, its host suffix cannot acquire a phase for another identity. A mutation-capable identity found in host input fails export without acquiring a phase.

Integrate Phase 9E's actual-value/entry verification at the reached boundary and its record-only authority checks at reservation and deferred host access. Test an external owner whose ordered mutation replaces an owned native child used as a later method receiver: subsequent invocation uses the replacement after the predecessor completes, through the same owner phase and unchanged tree record. A mutating call on the owner and one on its native child serialize together; no child phase or receiver cache exists. Managed receiver access still follows ordinary captured versions and COW.

### 3. Compose managed and external mutation scopes

`mutationScopeDepth` identifies the complete `!` prefix:

- **External scope:** select the exact external boundary. Use its phase and no managed COW, lease, or gate. A deeper `!` clamps to the first external boundary because the host suffix is opaque.
- **Managed scope:** use the ordinary managed transition at that prefix. An external host effect selects only its reached first external boundary; managed siblings and other external owners remain outside that effect.
- A managed method receives no authority over opaque external descendants merely because they occur in its receiver.
- Queue at an earlier managed gate before reserving descendant external phases. Once this operation reaches its managed working value, publish its selected external successor before waiting for that external predecessor. Do not confuse the earlier gate with this operation's own publication gate.
- Keep a pending managed gate and selected external phases through the same direct-Promise boundary.
- If a managed mutation scope owns an external call's failure, retain its underlying prefix and publish the managed guard's poison before releasing the child phase. The child phase preserves predecessor poison unchanged; it does not receive the same failure. If the selected mutation scope is external, its own phase remains the poison owner.

For managed `apis` containing external `db`:

- `apis.db!.write()` selects `db`.
- `apis!.db.refresh()` protects and publishes managed `apis` and selects `db` for the host effect. It cannot mutate managed `apis` data or a separately owned external sibling.
- If `apis` is external, either form selects only `apis`.

Mutation scopes grant no COW bypass or native ownership of managed data. All managed retention uses ordinary sharing and COW; external identities remain exact and mutate only their owned state under their phases. Use an explicitly external aggregate when one native operation needs a combined mutable receiver graph.

The registered mutable resource paths and their context ancestors form a fixed namespace. Reject whole replacement/deletion of its nodes, structural remapping of resource-bearing nodes, and arbitrary managed mutating methods whose receiver includes that namespace before effects. Use the affected static-tree path once at common mutation selection; do not prepare a whole proposed graph to rediscover fixed bindings. Ordinary off-namespace children remain freely mutable, and observation-only external identities impose no namespace restriction.

Physical COW preserves the same namespace bindings. Entry, scope poison, and repair use logical placement/guard transitions without replacing the resource-bearing structure. Remove the namespace-specific preserveReceiver proposal, candidate validation, and recovery copies. Ordinary receiver isolation, storage preflight, and validation remain required outside the namespace.

Entry follows the whole-boundary contract in section 1. Managed entry can gate a namespace prefix while its contained operations mutate permitted children. It cannot publish arbitrary root replacement through that private Chain. Reuse the same namespace selection check for public and entered operations, including their deferred continuations.

### 4. Route external calls and properties

The first external boundary owns its opaque host suffix:

- Traverse that suffix only after the boundary's predecessor phase completes.
- Give no deeper host identity another tree location or phase.
- Never scan untouched external properties.

Traverse ready native intermediate values synchronously after the selected predecessors and explicit inputs finish. A Promise or supported thenable reached before the final lookup value is invalid: do not subscribe, await, admit its fulfillment, or resume the suffix. Method receivers and selected callables must likewise be ready. Consume availability only for the final lookup value or direct host-call result, retaining the phase through that boundary completion. Snapshot only the final selected property result and keep its nested-data prohibition. Preserve the same ready-only restriction for an admitted managed source reached through a native alias. This concerns values stored along the native path, separately from Phase 10's operation-input keys.

A property-only path reaching an admitted managed source uses its logical property helpers and ready snapshot semantics. The reference grants no managed mutation placement or raw native receiver: a direct host call on that managed receiver returns `InvocationFailed`, and a write/delete targeting its managed storage returns `UnsupportedMutation`, before native action. Use ordinary managed paths or methods on a returned snapshot instead. Apply these checks only to actually reached metadata. A native method selected on an external receiver may retain read-only managed references, but mutating them through hidden code violates the host ownership contract. Host-call results retain ordinary import; a host that continues mutating returned storage must supply a detached copy.

Property operations behave as follows:

| Operation | Boundary behavior |
| --- | --- |
| Read exact mutation-capable identity | Return `ExternalCapabilityEscape`; do not expose it or record use |
| Read below mutable external state | Return a detached managed snapshot |
| Read observation-only external state | Use ordinary import |
| Write | Export the captured right-hand value before native assignment or setter; any Error prevents the write; successful assignment has logical result `undefined` |
| Delete | Perform native deletion; a false native result is `ExternalPropertyDeleteFailed`, while successful deletion has logical result `undefined` |

A native setter must finish synchronously. Assignment and deletion are mutations. Without a broader `!`, their mutation scope is the complete target path. Replacing an external-valued managed placement is a managed structural write; reaching external state before the final key is a host property operation.

Use native `Reflect.set`/`Reflect.deleteProperty` at the exact causal host boundary and inspect their Boolean success; do not silently accept a false Proxy result. Existing thrown/rejected failures use the same action kind. Export the RHS before native assignment, retain no managed source in native storage, and never read back the assigned property to manufacture a result. Neither final assignment nor deletion reads or consumes the old target. Replacing/deleting a Promise-valued property is valid, but traversing that Promise to reach another target is not. Deferred failure must publish its defined graph or external-phase poison without a separate script-level mutation-result check.

For mutable external `config.db`, `config.db.query()` is an observation and `config.db!.close()` is a mutation. `var db = config.db` fails because it would expose the capability. `var status = config.db.status` returns a detached managed snapshot.

External calls use ordinary result import, with two additional escape checks:

- Reject every identity recorded in any static external mutation tree.
- For a call inside mutable external state, also reject its exact native receiver anywhere in traversable result data, including below the indexed opaque boundary and after direct-Promise fulfillment. A genuinely observation-only external receiver may return itself through ordinary import: its storage is read-only and its established external category remains exact. The additional scan protects mutable native state, not identity equality by itself.

Errors are terminal diagnostic data rather than traversable result containers. Apply Phase 9D-A's failure-payload restriction to external throws, rejections, and returned Errors: neither their exact reason nor reachable diagnostic references may retain the selected mutation-capable receiver or another unexported protected identity. Do not claim that the traversable-result receiver scan catches `Error.cause` or arbitrary diagnostic fields. Audit runtime-generated snapshot/capability/repair failures to avoid such references; document unsafe host payloads without adding cause traversal or a second capability scanner.

Apply Phase 9D-0's successful-value native `then` contract to observation-only exact identities and detached managed snapshots. Snapshot adoption and validation must not produce a managed value whose native lookup can assimilate it through an inherited or hidden callable/accessor `then`. Preserve the snapshot walk's existing prohibition on nested Promises and its graph-copy semantics; do not add another availability-consumption path to repair invalid snapshot data.

An opaque external result that secretly contains a receiver alias remains a host-contract violation because Cascada does not inspect opaque state.

### 5. Snapshot mutable external properties

Use one dedicated synchronous snapshot transaction. It has export's visible graph-copy semantics but is neither export nor an import mode:

- Preserve aliases, cycles, Arrays with length and holes, prototypes, Functions, and enumerable own String-keyed properties.
- Omit symbols, inherited properties, and non-enumerables.
- Copy every traversable source identity and admit each copy as managed.
- Validate a custom-prototype copy with the managed-class prototype contract without registering that prototype globally.
- Preserve Functions without granting external authority.
- Treat getter and Proxy failures as property-operation Errors.
- Discard output on Error while completing the synchronously discoverable required Error frontier. Never expose a partial copy.
- Copy admitted managed sources through their logical properties and Array projections; reject any registered mutable external identity reached in output, including a cycle back to the selected boundary, with `ExternalCapabilityEscape`.

A possible Promise selected directly as the property result is consumed through the common helper. A synchronous custom outcome proceeds directly to snapshotting; an actually pending result retains the phase through later delivery and snapshot completion. The synchronous snapshot walk itself accepts no Promise or supported thenable, even one that could deliver synchronously; a nested one produces `InvalidExternalSnapshot` without invocation, Promise version, or continuation. Completed managed-receiver validation retains its own equivalent prohibition on stored thenables. These are validation contracts, not opportunities to await or unwrap nested data.

The final snapshot contains no external location or mutation authority. Export, managed receiver isolation, and this snapshot may share only identical low-level container, key-reading, and safe-definition helpers; do not build one configurable graph walker.

Implement the [snapshot transaction](external-context-ordering.md#snapshot-transaction) directly. The source-reading boundary is selected from existing execution metadata, with no admission or second source index. Reuse `language-properties.js` for managed key candidates, presence, and logical values; `array-view.js` for logical Arrays; and the admitted prototype for copy construction. Raw external state retains its external reflection semantics. Select only the explicit path and produced output graph. Do not snapshot whole managed ancestors or unrelated descendants merely because one reached source is managed.

The same read rule applies when the explicit property suffix reaches managed source data. Reject an unresolved logical value there with `InvalidExternalSnapshot`; do not subscribe or wait behind a gate while holding an external phase. Ready fixed and Promise-backed logical values are copied without touching their stale physical sources or bypassing FIFO publication. The direct host property-result Promise is the sole asynchronous snapshot input; nested host thenables, including synchronous custom thenables, remain invalid. This keeps the existing ready-data snapshot restriction without creating a configurable export mode, async managed-source subwalk, extra lease, or gate.

Use one identity map for host and managed nodes together, registering each output container before children. Continue Error collection after output is discarded, retaining only visitation and diagnostic state. Validate prototypes, managed-class shape, and native `then` safety before committing the copies' admission in one synchronous segment. Do not run ordinary import on the source or leave partially admitted output after failure. Source identities, metadata, versions, authority, and phase poison remain unchanged.

Managed parent retention follows section 0: use ordinary sharing and COW, retaining opaque external leaves only as inert references. Access through a copied parent grants no authority, and export rejects a mutable capability at any depth. Ordinary call-result import borrows managed storage; hosts must return independent data or relinquish mutation of that storage and its managed descendants. Import preserves managed aliases without scope-dependent normalization or hidden-native-alias scans.

### 6. Keep mutation-capable external values out of host inputs

Host-input export copies managed data and preserves observation-only external identities exactly. If it reaches an identity recorded in any static external mutation tree of the execution, return `ExternalCapabilityEscape` and perform no host call or write. Apply this to:

- explicit method arguments;
- external-property write values;
- script results; and
- controlled-callback inputs.

The same rule applies after Promise fulfillment. No provenance token, lookup-to-call owner, provisional input phase, or release callback is needed: a value is either observation-only or forbidden from crossing as input.

`run` retains the existing managed capture rules after internal dispatch. Producing lookups have already captured and shared their logical values; selected preparation uses ordinary leases, COW, and placement versions.

Controlled Arrays retain their specialized preparation:

- `concat` captures logical structure and versions through its existing argument leases.
- `fill`, `push`, `unshift`, `splice`, `toSpliced`, and `with` store payload without inspecting it.
- `includes`, `indexOf`, and `lastIndexOf` compare only the root primitive or identity.
- Numeric and string positions synchronously capture values required for conversion; external identities are invalid there.
- `sort` and `toSorted` with a comparator export one comparator-visible snapshot. Common export rejects a mutation-capable element before the comparator runs.

### 7. Preserve phase lifetime, poison, and attribution

- Route every live-execution exit after phase reservation through normal completion, including blocked access and recoverable preparation or boundary failure. Complete only after captured predecessors and required boundary work; local query closure alone cannot release a phase. Fatality leaves internal phases alone and rejects outward pending results independently.
- A direct operation Promise retains selected phases and any managed gate through final result import, snapshot, or rejection.
- A nested result Promise is result data and extends neither phases nor authority.
- External storage never receives a Cascada Error value, Promise version, or poison replacement for the exact external object. A poisoned exported write value prevents the native write and poisons the selected managed guard or external phase. Test both scope choices: native property and identity remain intact, later access is blocked by the one owning scope, and repairing it allows a clean operation. A native Error read by an observation poisons only its returned language data.
- Every observation failure affects only its result, including snapshot and reflection failure. Reservation exclusivity does not grant mutation intent or permission to poison.
- Failed or rejected mutation publishes its required combined Error at its selected poison scope only. Under a managed guard, complete ordered child phases with unchanged predecessor poison. Publish the guard before those completions. Completed native effects remain visible after repair; no rollback or duplicate descendant poison is introduced.
- Conflict performs no access through the selected external receiver, is permanent, and cannot be repaired.
- Repair-only bypasses and clears repairable predecessor poison and returns `undefined`. Repair-and-call bypasses old poison, then clears it on success or publishes the new mutation Error.
- External code must not synchronously re-enter its execution while its invocation remains active. Attempted same-execution re-entry is fatal. A separate execution may start immediately; independent work in the original execution may start after the synchronous host call returns with its own explicit operation context.
- A direct host Promise must not depend on a nested operation ordered behind its own active managed gate or external phase. Such a dependency cycle is invalid host behavior.

Attribute new failures at the selecting operation:

| Failure | Kind |
| --- | --- |
| Getter, descriptor, or Proxy property read, including a ready Error result or direct rejection | `ExternalPropertyReadFailed` |
| Setter or deletion | `ExternalPropertyWriteFailed` / `ExternalPropertyDeleteFailed` |
| Member selection, call throw, returned Error, or direct call rejection | Phase 9D-A invocation kind |
| Direct native call on a managed receiver reached through an external alias | `InvocationFailed` |
| External write/delete targeting managed storage through an alias | `UnsupportedMutation` |
| Promise reached as an intermediate native property-path value | `ExternalPropertyReadFailed` |
| Mutation-capable identity escape | `ExternalCapabilityEscape` |
| Promise nested in mutable-property snapshot | `InvalidExternalSnapshot` |
| Repair validation | `ExternalRepairFailed` |
| Fixed-leaf identity mismatch | fatal `FatalError` |

Preexisting poison and mutation poison retain their original child attribution. Repair-and-call host failure keeps its host-call kind.

The external-property observation is one causal boundary. Do not split action throw from returned or rejected Error with a second value kind or a multi-kind `runExternalBoundary` policy; all have the same selected operation, recovery, graph effect, and useful diagnosis.

### 8. Cut over atomically

Switch calls, property operations, managed/external scope composition, mutable-input rejection, snapshots, repair, and entered contextual Chains together. Remove superseded local routing in the same change. Phase 13 removes Cascada's hidden sequence mechanism when it adopts this public API.

Keep no adapter, overlapping scheduler, fallback path, live external occurrence graph, reverse leaf index, external-input provenance, or second invocation path.

### Verification

#### Static authority and identity use

- Initial context import filters the compiler mutation access tree into directly accessible first-external-boundary records. Non-external endpoints are pruned; Promise/thenable sources, delivery, and later graph changes add no leaf.
- Initial mutable-authority discovery skips all Promise and thenable sources, including synchronous custom deliveries and already-settled logical overlays. Ordinary import may consume them but adds no authority through their outcomes; failed import leaves no latent subscription able to add admission or authority.
- Absolute ContextChain use and the equivalent relative entered-Chain use resolve to the same leaf in either issuance order.
- Another Chain, path, copied/moved alias, or Promise-revealed occurrence conflicts before host access. The first reason remains stable.
- Duplicate discovery of one normalized location merges; distinct candidate paths to one external identity reject the complete initial context import without changing existing bindings. Competing otherwise-valid independent context registrations invalidate shared authority at import commit. Entered Chains reuse the original leaf without registering again.
- Tree queries derive authority from shared binding state without deleting invalid discovery leaves. An unregistered identity remains observation-only; a known invalid identity fails rather than falling back to observation-only behavior.
- Managed assignment and later COW leave original live bindings unchanged.
- Replacement, deletion, and Array remapping reject before disturbing a live leaf; unrelated Array changes remain valid.
- Reject arbitrary managed mutation of a namespace-bearing receiver before its method runs, whether the receiver is owned, imported, shared, leased, or indexed. Reject whole namespace replacement/deletion/remapping without preparing a preserved candidate. Verify allowed sibling managed writes, physical COW, nested entry, scope poison, and explicit repair keep the same mutable identities and paths. Observation-only external children impose no restriction.
- Traversal validates the exact live identity against its leaf entry. Mismatch is fatal.

#### Snapshot and ownership integration

- Retain a managed value below a `!` prefix and a managed parent containing registered external children. Later managed writes and methods preserve the retained logical values through ordinary COW and leases. Include pending captured versions, nested poison, aliases/cycles, Array remaps, and entered Chains; no eager scope snapshot or extra source category is needed.
- Initial managed aliases across compiler mutation paths retain ordinary admission and ownership behavior, in either discovery order and with synchronous or pending delivery. A mutation path with no discovered external boundary creates no tree nodes or external dependencies. Preserve segment atomicity and abandoned-callback behavior.
- A pending external mutation of one owner must not block a managed sibling lookup solely because a compiler scope contains both. Existing managed prefix gates still order operations that actually share that prefix transition. Verify that a broad managed `!` selects only the reached external owner for native effects and does not consume an unrelated sibling's phase poison.
- Use an explicitly external owning record containing plain state and a native service. Native methods and property writes update its owned state under the same boundary; property snapshots remain unchanged after later mutation. Ordinary managed data elsewhere keeps sharing/COW. Do not add hidden-alias corruption tests: the host contract forbids an external owner from mutating admitted managed identities, even through `this.child`.

- Copy an already-managed Record, Array, and managed class reached as the direct external property result and below a larger host result; copies have distinct identities and preserve aliases/cycles spanning both source categories. Preserve the source's own-property visibility and admitted prototype.
- Cover physical raw Errors replaced by fixed contextualized versions, synchronously delivered thenables retained physically, settled Promise versions, and ArrayView remaps/holes. Output must use logical values and complete original Error attribution, never raw storage or a physical backing Array.
- An unresolved managed property or gate on the selected managed suffix or inside the output graph returns local `InvalidExternalSnapshot` without another subscription. Test a gate whose completion would depend on the current external phase: the observation fails promptly and releases normally, rather than deadlocking. A physically retained but logically ready Promise is valid; a raw nested thenable remains invalid even if synchronously ready.
- Combine ready poison, getter/Proxy failure, invalid nested availability, and later enumerable sibling Errors. Collect all required distinct failures without exposing partial output, committing its admission, or changing phase poison. Invalid nested thenables are not invoked, and unselected branches are untouched.
- Retain a managed parent containing a registered external leaf and ordinary managed data. Mutate the external owner through its valid location, and mutate the managed data through its ordinary path. The retained managed values stay unchanged; using its inert capability through the retained parent fails locally, while native export rejects it at any depth. No lookup traverses an external interior merely to retain its managed parent.
- Reaching another registered mutable identity through a host suffix fails before its properties or methods are inspected; a cycle to the selected capability cannot escape by snapshotting. No late phase is acquired.
- A data observation copies a managed source, but a native call or write directly targeting it through the external alias is rejected before hooks or effects. The classified observation failure remains local; an authorized mutation failure follows the selected mutation poison rule. Do not add tests expecting detection of hidden closure/private-field writes excluded by the host contract.

#### Ordering and scopes

- Distinguish a literal static resource path from the same ready String produced by a computed segment. The latter produces local validation poison before native access; ready and pending variants publish mutation failure at the same predetermined managed scope/static prefix. Test a valid managed or observation-only external sibling through the same computed prefix and valid dynamic native suffixes below a statically selected mutable owner.
- Query a healthy and poisoned external scope directly and from a managed ancestor. Require false/null or true/the original Error, no native getters, and complete accessible sibling membership. Repeat with a poisoned ancestor retaining hidden Errors and a never-settling Promise: return that guard's exact Error without hidden traversal. Verify indexed/unindexed agreement, query ordering around mutation/repair, and stable previous results.

- Fail `api.managedContainer!.externalApi.someCall()` on ready and pending host routes, including partial native effects. The parent guard is the sole new poison owner. Subsequent parent/descendant lookups, queries, exports, mutations, and attempted deeper repair observe its original Error without native access. Repairing `managedContainer` restores access; the child needs no second repair and still has the same identity and predecessor phase state.
- Capture an entered Chain before that failure, wait in its callback, then issue external access through it after the ancestor mutation was issued and after poison publication. It must respect the later ancestor gate and then return the same poison, with no host reflection. Test nested entries and entry directly at the external child. Preserve legitimate private work by the entry owning the gate, and preserve ordinary pre-failure managed snapshots. This proves that single-scope poisoning has no contextual bypass.
- Compare parent-scoped and child-scoped failures. An independently preexisting child poison remains after parent repair and requires its own explicit repair; the parent operation never copies its new failure into that child. Guard installation and clearing agree across indexed/unindexed `hasError`, complete `getErrors`, lookup, and export, with stable cause/source/kind and immutable earlier Error outputs.

- Observations wait for the previous exclusive phase and overlap one another. Mutation and repair wait for the read group.
- A descendant phase is reserved only after earlier managed gates permit reaching that fixed location; it is published before waiting for its external predecessor. No host suffix creates late authority.
- Start a mutating `enter`, suspend its callback, issue an outside observation of an external child, then resume the callback and mutate that child. The inner mutation and entry must complete before the outside observation, without a phase/gate cycle. Repeat with outside mutation and repair, nested entries, and a broader managed `!`. Entry itself never holds a phase needed by its nested operations.
- `apis.db!.write()`, `apis!.db.refresh()`, and an opaque external ancestor select the documented scopes. Cover `api.db!.addUser(1); api.db.getUserData(); api.db.getUserInfo(); api!.close()` with external `api`: both observations wait for mutation, overlap one another, and finish before close. Have mutation replace a property or method and assert the later selection sees it; no getter, descriptor, or method lookup occurs before its predecessor. Repeat with managed prefixes and separate registered siblings.
- External mutation uses no managed gate. A managed prefix independently uses ordinary COW and gating.
- A broader managed scope grants no native mutation authority over sibling owners; invalid or otherwise unselected identities grant no host authority. Promise-valued path reservations are verified in Phase 10.
- Root and entered Chains share ordering and poison for the same leaf in both issuance directions.
- For the same static child-entry request, a managed branch retains ordinary fine-grained entry while a mutable external receiver produces PropertyValidation without invoking the callback or reflecting on the native child. Cover both entry modes, existing leaf/compound poison, pending predecessors, unchanged native bindings, and no execution fatal.
- Issue an assignment of a never-settled input to one external property, then two observations of unrelated properties, then another mutation. No later native action may run before the first input is exported and written. Both observations may then overlap, and the next mutation must wait for both. Include rejection, deep pending assignment input, old target Promises that must not be read, and synchronous inputs; no Promise or gate may be installed in native storage.
- Verify that an external predecessor waiting for its argument can complete after a later entry installs its binding gate. Deferred binding validation must not make that predecessor wait for the entry whose inner phase follows it.
- Compare `api.db!.write()` and `api!.db.write()` with managed `api` and external `db`: the former must not enumerate or COW managed ancestors merely to locate its receiver; the latter also protects and publishes the managed scope. Cover an earlier managed gate, a pending native result, and failure in each scope.
- Issue a mutable-external observation with a pending native-suffix key, then a mutation of an unrelated native property. The mutation waits for that observation; another observation in the same group may overlap. Repeat with a pending call argument and with a primitive final read result. Phase 10 supplies Promise-valued suffix keys; Phase 9F covers ordinary call-input waits.
- Start a complete contextual Error query over a ready mutable scope and an unrelated pending managed branch, then issue repair of the mutable scope. The query retains the scope's earlier poison regardless of when the unrelated branch settles. Earlier branch gates still delay the corresponding metadata reservation.
- Enter a whole mutable external boundary before a slow condition resolves, issue outside reads/writes, then issue inner native property operations. Outside access waits at the binding gate, inner work completes without a phase/gate cycle, and later operations follow the inner phases. Cover nested and earlier captured entries, read-only capability enforcement, false conditions, poison and repair, and observation-only identities without locks. Compiler tests reject dynamic mutable entry and enter the resource root for deep conditional writes.

#### Boundaries and cleanup

- Through each public operation route that reserves phases, queue a successor on the same external owner and verify progress after success and every recoverable exit: predecessor poison, late binding conflict, input/export validation failure, native throw/rejection, property reflection or snapshot failure, repair failure, and `hasError` early closure, as applicable. Assert exact successor poison and no premature native action while required predecessors or boundary work remain pending. Exercise ready and pending routes using the normal test timeout; add no production timeout, readiness flag, or cleanup registry. Fatal tests instead assert outward rejection without requiring internal phase release.
- An authorized external method or property mutation can change its exact receiver and then fail, including a Proxy write/delete trap that changes data before throwing. Verify retained effects, causal Error attribution, phase poison, successor ordering, and repair without rollback. Apply the managed-storage trap restriction only when the kernel changes managed placements; do not apply it inside opaque external state or to runtime-internal Array remapping.
- Cross argument-export, host-call, result-admission/snapshot, and post-call capability failures at the same operation. Retain every independent failure the operation is required to collect, while applying the documented managed-placement, external-phase, and operation-result effects separately. A safely rejected pre-call selection preserves state when required; an independent result failure does not erase a completed valid mutation, and phase publication cannot overwrite an already discovered operation Error. Verify ready, synchronous-custom, and pending routes, unchanged Error attribution, and no host invocation after required preparation fails.
- During a later synchronous subscription, deliver earlier captured versions and then continue mixed managed/external path selection. Earlier operations must use their captured logical versions and selected exact external identities, never reread a newer managed prefix. Preserve aliases and occurrence-specific authority while bounding cycles. Pair failures with retained-index and owner-isolation checks; do not expand leases, gates, or phases to unrelated result Promises.

- External operations return directly when all required predecessor and operation transitions complete synchronously; a native predecessor subscription makes the result pending even after that predecessor has settled. Required preparation precedes every host reflection or invocation.
- Parameterize direct host-call and property-result routes with ordinary values, synchronous custom delivery, pending custom delivery, and native Promises. Once predecessor continuations permit execution, synchronous success and failure finish required import or snapshotting and phase publication in that transition; pending delivery retains exactly the selected phase and any required managed gate through boundary completion.
- A method selected through mutable external state remains callable without exposing that function as a property value.
- Mutable external identities never escape through lookup, return, export, external-property assignment, script result, or callback input. Internal managed assignment may retain an alias but grants no authority; access through another unregistered location fails locally without poisoning the context.
- Exact selection validates current binding authority after phase predecessors and before host access. Regular-Chain aliases fail locally in either import order; competing contexts share invalid authority. No selection grants partial host access or commits a new cross-context use claim.
- Every explicit host argument and external write value uses common export, including after Promise fulfillment.
- Native write/delete traps returning false produce their action-specific failure and mutation poison, with no assigned-value or Boolean success payload. A setter receives an independent exported RHS, is selected/invoked once after ordering and preparation, and is never read back. An external Array uses native behavior: a scalar-returning mutation can succeed, while a receiver-returning mutation fails the result escape check after its effects and requires repair. Do not pin behavior for hidden borrowed-result or callback violations outside the host contract.
- Importing an already registered external identity through public import, a method result, or a regular Chain never downgrades its binding restrictions. Cover both valid and conflicted entries and deferred delivery, without changing any legitimate phase state.
- Mutable-property snapshots preserve Arrays, aliases, cycles, prototypes, and Functions while copying every traversable identity, including already-managed sources. They reject invalid nested availability and registered mutable identities, complete every discoverable Error, and expose no partial data or output admission.
- Observation-only property results and all call results use ordinary import. Calls inside mutable external state additionally reject their exact receiver. A genuinely observation-only external identity may return itself unchanged; it gains no mutation authority.
- A direct property Promise retains its phase until snapshot completion. Nested snapshot Promises create no Promise version or continuation.
- Reject a Promise or supported thenable as an intermediate native value without subscription, including an already-fulfilled native Promise and a synchronously delivering custom thenable. Cover lookup, call, assignment, and deletion; no suffix getter, setter, or method is reached. A final lookup Promise remains supported. Final assignment/deletion replaces or removes a Promise-valued target without reading it or taking ownership of its rejection. Keep other required input Error collection complete; an observation failure stays local and an authorized mutation poisons its selected phase.
- A nested ready custom thenable is rejected by snapshot validation without invoking `then`, just like a pending one. A completed managed receiver containing either is likewise invalid; direct-result consumption must not weaken either nested-data contract.
- Comparator sort rejects mutation-capable elements through common export and needs no extra phase or release callback.
- Exclusive completions fulfill directly with null or exact non-thenable poison; ReadGroup is a drain signal. Observations preserve predecessor poison, blocked mutation returns the same Error, and only explicit repair clears it. Each native operation has one actual selected boundary.
- Failure and repair preserve the Phase 9D-A contexts and kinds; repair never clears conflict.
- External snapshot, capability, invocation-validation, and repair Errors expose no protected identity in runtime-created reasons. Compliant external failure payloads preserve exact cause and source on ready and deferred routes, while the host documentation explicitly covers unsafe diagnostic references. Successful observation-only exact outputs and detached snapshots obey the same native `then` invariant before and after a pending phase predecessor.
- External ordering uses only the static tree, execution identity map, ordinary managed path continuations, and common phase kernel. This repository retains no alternate external scheduler or routing adapter.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`external-context-ordering.md`](external-context-ordering.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`managed-invocation.md`](managed-invocation.md), [`import-preparation.md`](import-preparation.md), [`outbound-export.md`](outbound-export.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), compiler lowering, path-operation documentation, and public API documentation.

---

## Phase 10: Support Promise-valued path segments

Implement [Promise-valued paths](promise-path-segments.md) through the existing observation and mutation walkers. Managed paths and observation-only external paths support dynamic inputs. Mutable external resources require static selection; only their already-selected native suffix can contain dynamic input keys. This phase adds no candidate-resource reservations.

### 1. Consume segments at their logical position

- Normalize each reached String/Number segment exactly once. Consume supported thenables through the common guarded helper before normalization; a synchronous custom delivery continues immediately. A ready PoisonedValue supplies its original Error through the ordinary rejection callback.
- A raw ready or rejected segment failure uses PathSegmentFailed; a resolved non-String/Number value uses InvalidPathSegment. Preserve already-contextualized poison and fatal classification. Do not coerce unsupported values or stringify Promise objects.
- Stop at a failed prefix before consuming unused segments. Unconsumed Promises remain host-owned; do not observe rejection solely to suppress host reporting.
- Carry the path's firstDynamicSegment compiler fact through capture, composition, and entry. It describes source selection, not current readiness. A computed ready String does not become a static mutable-resource route.
- Initial discovery filters only the compiler mutation access tree's static prefixes. An external owner reached before the first dynamic key is eligible; a managed endpoint requests no descendant search. Promise-valued path support adds no leaves or late discovery.

### 2. Protect unfinished path selection once

Walk available segments synchronously. Initialize callback-visible staging, captured versions, and unconditional writeback before subscription. A custom callback may run before then returns. Only a returned pending chain while path selection remains unfinished installs pending-only protection before the issuing stack returns.

- An observation leases the longest reached managed prefix. Later managed mutation uses COW, preserving that captured value without blocking it.
- A mutation gates that managed prefix and continues against its private value. Later contextual access through the prefix, including mutable external access, observes the gate before reserving native phases.
- If a static prefix already selected one mutable external boundary, reserve its ordinary phase before waiting for native-suffix input keys. No managed COW or per-property gate is installed inside native storage.
- An observation-only external identity needs no mutation lock or fixed namespace.

Retain one pathSelectionComplete fact, set immediately before handing the selected target to its operation. A pending independent target result does not imply unfinished selection. Reuse one prefix lease/gate across later segments; a ready custom key followed by pop of a pending element must leave the completed Array mutation visible immediately and add no prefix protection for that removed result.

Reuse captured versions and FIFO continuations. Do not add callback-ran flags, a second result algebra, temporary Chains, a new path scheduler, or a second receiver gate. A coarser gate can carry final publication but does not broaden the selected semantic poison scope.

### 3. Reject dynamic mutable-resource selection deterministically

- A dynamic source key before a reached mutable boundary is an invalid external route, including when its current value is ready. Use ExternalLocationConflict with a static-path diagnostic. Fail before native reflection, capability extraction, or external phase reservation.
- Observation returns its local Error. Mutation publishes at an explicit managed scope already selected before the dynamic key; when its intended scope lies beyond the key, use the longest static managed prefix. Capture this fallback location from path facts before waiting, and publish through the existing mutation transition. Never poison a guessed leaf or all resources beneath the prefix.
- Detection time may depend on path readiness; Error location does not. A poisoned prefix returns its original Error before any new validation or unused segment work.
- Dynamic paths selecting ordinary managed or observation-only external data remain supported even when their shared prefix also contains a registered mutable sibling. No blanket rejection of a mixed managed prefix is allowed.
- A dynamic key inside an already statically selected external owner remains an ordinary native suffix key. Stored native intermediate values, receivers, and callables must be ready; only final lookup values or direct call results consume availability. Final assignment/deletion does not read the old target.
- Static whole-boundary entry follows Phase 9F. Compiler lowering does not enter a mutable native property or rebase a computed route into static authority. Managed entry keeps Promise-valued key support.

### 4. Reuse the operation lifetime and publication boundary

A path component reuses its containing query, export, invocation, or entry owner. Standalone lookup, mutation, and repair obtain one OperationOwner through one centralized provision point. The allocation point may be eager or first-pending, but optional-owner branches must not spread through walkers. Property-version APIs remain unaware of operation ownership.

Every pending continuation uses common guarded helpers. In a live execution it finishes required shared settlement before checking local closure; after closure it performs no key normalization, traversal, lease/gate acquisition, native access, publication, or result work. Fatal resumption stops before shared settlement as usual. Observe owned pending walker reactions at their originating layer even when a non-blocking mutation does not return them.

A mutation owner closes after its required gate publication, not its immediate issuance return. Repair closes after its selected scope transition. Read/export/query source protection ends only after final capture; export output keeps its separate lifetime. An independent result cannot extend completed receiver or path protection. A blocking scope ends action-only work without waiting for unused arguments, retaining owned rejection handling and shared settlement.

Repair reaches only its selected retained managed guard or statically selected external boundary. A marker inside native state stops at the first boundary without consuming its unused suffix. It bypasses no poisoned ancestor and clears no child poison.

### Verification

- Exercise root, middle, and final native/custom Promise segments through lookup, lookupPathForExpression, non-sharing readPath, assignment, deletion, run, export, hasError/getErrors, repair, and managed entry. Include ready custom fulfillment, synchronous PoisonedValue failure, pending rejection, unsupported resolved keys, and skipped unused suffixes.
- Compare ready and pending equivalent paths for values, COW, scope poison location, and complete required Error membership. For expression extraction, ready failure returns its PoisonedValue while already-pending failure rejects with the ordinary Error.
- Test one prefix lease/gate across several pending segments, old-value capture under later mutation, Array views, aliases/cycles, imported/fixed versions, and a ready selected operation with an independent pending result.
- Dynamically select a mutable resource with a ready computed key and a pending key: both fail locally before native access with the same predetermined failure scope. Preserve the exact blocking poison and leave candidate resource phases untouched. Test explicit ancestor bang and default mutation scopes, regular-Chain aliases, and composed/entered provenance.
- Select a managed child or observation-only external sibling through those same dynamic prefixes successfully, without mutable-resource locks. Select a mutable owner statically and use pending suffix input keys under its one phase.
- Verify static discovery creates no candidate leaves from dynamic-only resource selection. A first external boundary found before a dynamic native suffix remains eligible. Context registration remains atomic and later fulfillment adds no authority.
- Exercise closure before a later key resolves, shared settlement after local closure, fatality behind an unresolved key, and ownership of discarded pending reactions. No local closure releases another operation's gate or phase early.
- Cover complete contextual Error queries through static paths, terminal poisoned guards with hidden never-settling children, accessible sibling Errors, ancestor collection of external scope metadata, and old results after repair. No native properties are read to inspect scope poison.
- Ensure no provisional phase map, all-candidate wait, deferred candidate reservation, extra path queue, callback-readiness flag, or compatibility route remains.

## Phase 11: Review imported-Promise settlement ownership

### Problem

The import processor owns subscriptions, staging, and abandonment for synchronous and pending custom delivery. import-preparation.js owns the fulfillment-segment processor and calls the ordinary property-version commit, with no installer callbacks or property-to-import delegation loop. Mutable-authority discovery independently follows Phase 9E's directly accessible source rule.

### Outcome

This phase is a preservation check after the Error and Promise-path changes, with no further production rewrite planned. Retain the processor implemented by the Phase 9C addendum and verify the constraints below. Reopen its structure only if those later changes introduce a concrete duplicated responsibility; do not repeat an already-completed experiment.

### Constraints

- Preserve one atomic staged import walk per synchronous segment. A failed segment commits no admissions, origins, retentions, pending Promise placements, fixed imported logical versions, or external-tree leaves.
- Synchronous custom delivery continues the active segment and identity map. Later delivery for a committed placement starts a fresh segment at its existing FIFO position and retains its originating boundary context. An abandoned segment's callbacks retain no import or publication authority.
- Keep external-tree discovery as a separate occurrence walk because it must preserve finite alias paths; commit it atomically with identity admission.
- Reuse placement versions and the existing Promise version. Add no `ImportTransaction`, second overlay store, or parallel continuation path.
- Make no change merely to move code between files. A neutral or larger conceptual result is a failed experiment and must be reverted.

### Verification

- Ready and Promise-fulfilled imports preserve the same admission, attribution, alias, cycle, placement-version, and tree-discovery behavior.
- Failed fulfillment segments leave no partial state.
- The importer still owns fulfillment processing; property-version code only commits the prepared logical value. No installer callbacks, import-policy forwarding, or duplicate processor have returned.

Update [`import-preparation.md`](import-preparation.md) only if the experiment is retained.

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
- Adopt Phase 9F's single-scope poison and repair semantics, plus its whole-resource entry contract. Preserve the first-dynamic-segment source fact through operation paths and entry composition. Lower slow conditional native writes by entering the statically selected whole mutable resource, never its native child; observation-only external paths remain unrestricted by mutable authority. Lowering preserves the ordinary non-blocking assignment/deletion contract and owns rejection handling for pending work it creates or discards; it does not collect discarded recoverable outcomes into script failure. Export only the selected script result: repair clears the targeted retained guard, while fresh replacement may remove ordinary Error values. Supply raw context roots once to `ContextChain`; ordinary imports create no authority and cannot downgrade existing bindings.
- Use Phase 9F's public entry-target selection handoff after context import; do not guess host categories or external-boundary depth from source mutation markers. Emit rebased operation suffixes for the selected whole-resource entry and retain ordinary managed entry paths when the supplied context is managed. A managed read lease alone cannot order native descendant access deferred by a callback; plan the required mutable-resource entries before that deferred work. Test one compiled program with managed and external host shapes at different boundary depths.

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
