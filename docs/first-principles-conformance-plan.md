# First-Principles Conformance Plan

## Purpose

This plan records the implemented mechanisms and brings the remaining `src` behavior into conformance with [`AGENTS.md`](../AGENTS.md). Phases appear in implementation order. Completed phases describe their implemented design; later phases describe only the work that remains.

`AGENTS.md` is authoritative for settled contracts. Source and tests are authoritative for completed mechanisms.

## Method

Implement each phase independently. After every phase:

- reproduce the affected behavior and add integration coverage;
- run the complete suite;
- run `test/verify-refcounts.js`; and
- review the result for structural simplifications, unifications, dead weight, and load-bearing complexity.

Prefer one general transition over special cases. Do not pin helper boundaries, mirror fields, cycle-cut placement, exact counters, or another interchangeable representation. Delete superseded mechanisms in the same change.

### Standing mechanical inventory

The plan's “static inventory” requirements are permanent CI checks, not one-time review notes. Build one lightweight production-source checker, reusing an existing parser where available, with three rule families below. Derive mechanically visible facts such as package exports, factory constants, and Promise syntax directly. Use a small checked classification manifest only for ownership or boundary facts that syntax cannot decide; do not duplicate inferred entries or build three analyzers. The checker fails closed when it discovers an unclassified syntactic site. It establishes coverage, not a false static proof of dynamic graph effects: focused route tests own those semantics. `rg` remains useful for discovery but is not the conformance test.

1. **Error construction and kinds.** Enumerate trusted poison/fatal factory calls, their forwarding helpers, and every `ERROR_KIND` reference. Verify that factory paths receive the required operation/source context, kind-bearing calls use an exact `ERROR_KIND.<Key>`, the frozen table has equal key/value strings, and no string-literal, empty, generic, or implementation-only kind bypasses it.
2. **Package and Cascada result exposure.** Read each package entry's actual exports and classify every export as an execution-bound semantic operation, non-blocking Chain construction, contextless configuration, recognition/data, a delegating alias, or the trusted higher-runtime integration entrypoint. Route-matrix tests prove that each execution-bound outward result is exposed exactly once, construction performs only its public-entry check, pending results register exactly once, integration calls register nothing, and aliases add no wrapper or registration. A new export fails until classified.
3. **Promise production and ownership.** Enumerate native Promise construction and combinators, `Promise.withResolvers`, native or captured-then registration, stored asynchronous callbacks, resolver paths, and derived reactions. Classify who owns every potentially rejecting Promise, when ownership transfers, whether a delayed consumer requires handling, and which fatal checkpoint guards the callback. Phase 9D-C additionally covers every syntactically visible site that can receive or return a language value; route tests prove that poison is rejected or kept in purpose-specific non-thenable state rather than used as a native-Promise fulfillment payload.

Machine-check mechanically visible coverage; use focused route tests for semantic facts such as graph effect, terminal owner closure, and rejection ownership. Do not add a production registry, wrapper Promise, generalized result algebra, or runtime validation solely to make an inventory easier.

Whenever a phase changes operation terminal routing, its focused tests assert local owner closure, an empty release set, and balanced leases for every live-execution success, language-Error, supported-failure, and early-completion branch it touches. Pending work and fatal execution are explicit exceptions with their own assertions; do not infer global JavaScript quiescence or track every owner process-wide.

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

- A live mirror supplies its logical value before physical inspection. Otherwise a graph placement is exactly an own enumerable string-keyed data property; accessors, non-enumerables, inherited properties, and missing keys are absent and are never invoked.
- Reads, enumeration, import, COW, indexing, and mutation use that one property policy. Exact user-controlled reflection is captured at the primitive that invokes it; the owning operation returns or publishes its Error while adjacent runtime failures remain fatal.
- A physical blocker is a representation condition, not a language Error. Ordinary mutation uses the same path-copy fallback as COW. Final assignment shadows a physical non-placement in the new container, and final deletion treats it as absent.
- Ordinary native Array mutation runs once against a lazy traced remap. It preflights only the recorded operations, then either completes them on normal storage or commits them once to the receiver. Invalid Array length remains poison, while read-only length, blocked shrink, ArrayView growth, and restricted element commits are representation fallback.
- A failed mutation preparation, logical transition, or synchronous mutating-function call replaces the nearest receiver placement or root that represents the failed transition and returns the same Error. Observations return an Error without changing their receiver; an independent result failure does not poison an otherwise valid mutation.
- A final missing read is `undefined`, assignment creates the placement, and deletion is a no-op. Traversal through missing, `undefined`, or primitive data publishes one path Error at the first failed mutation segment. Reaching an existing Error preserves and returns that identity.
- Invalid intrinsic targets poison their receiver placement. Request validation before `run` captures a receiver remains an API-only Error.
- Supported host calls, controlled callbacks, and reflection hooks reject synchronous Cascada re-entry as a fatal host-contract violation. Trusted `enter` callbacks retain their existing fatal-abort behavior.
- If import fails after marking an identity, a later explicit import revisits that identity and resumes admission instead of treating the partial metadata as completion.
- Normal property helpers keep their ordinary return types; one private boundary-failure signal carries exact thrown user code to the owning transition.

### Verification

- Integration coverage verifies absent accessors and non-enumerables, representation fallback, missing-value semantics, poisoning and refcounts, exact reflection failures, and fatal synchronous re-entry.
- Imported and protected sources remain unchanged; valid mutations on ordinary restricted storage materialize only when the planned transition needs it.
- `enter` callback failure retains fatal abort semantics.

[`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and [`import-preparation.md`](import-preparation.md) record the completed behavior.

---

## Phase 2B: API Promise transport and Error aggregation

Complete.

### Final design

- Graph-value rejection becomes poison, trusted-transition rejection is fatal, and a data or host result preserves its Promise outcome. Canonical Promises are used only for ordered runtime continuations, not to convert results.
- Return the produced result unchanged: a value or Error directly, and a Promise or thenable with its original fulfillment or rejection. If producing it was already pending, the existing operation Promise adopts it. Result rejection does not retroactively poison published state.
- When settlement must admit a fulfilled host value or release a lease, register an internal FIFO observer without replacing the result.
- Scope leases to actual pending use. Controlled argument preparation releases its receiver before invocation; a controlled method that continues reading its receiver owns that lease itself. An independent controlled result never prolongs receiver protection. Export captures managed inputs without source leases; a returned host Promise retains only exact external ordering resources that host code may still use.
- Ready `assignPath` and `deletePath` failures return their Error. Successful and suspended calls return `undefined`; later poison is published in the graph without a hidden result rejection.
- Internal bookkeeping observers handle their own failures and leave no unhandled rejection.
- `combineErrors` flattens `CompoundPoisonError` inputs, deduplicates leaves by `leaf.cause ?? leaf` in supplied order, returns one unchanged, and combines several. Each caller supplies its message; export retains `export: branch contains errors`.

### Verification

- A selected observation executable that throws synchronously returns its Error. A selected mutating executable that throws synchronously also poisons its receiver.
- A rejected graph Promise poisons its captured property version. An operation that observes that transition produces the Error, while `hasError`, `getErrors`, and other Error consumers produce their declared results.
- A Promise returned by supported data or host execution preserves fulfillment and rejection and changes no graph state merely because it rejects or fulfills with an Error.
- Ready `assignPath` and `deletePath` failures return an Error; successful and pending work returns `undefined`, with no hidden derived rejection.
- Direct and delayed synchronous invocation failures produce the same graph and Error result.
- Runtime bookkeeping observers do not replace the public result or create additional unhandled rejections.
- Pending controlled arguments preserve the captured receiver until invocation. A captured independent result does not force later mutation to copy that receiver, while an ordered search that continues reading after a pending element does.
- Whenever preparation supplies one Error to combination, it propagates unchanged; several preserve every distinct underlying cause and their supplied order. Common call preparation discovers them across mixed ready and pending inputs.
- Export and later consumers use the same Error-combination utility.
- `enter` callback throws and callback-Promise rejection remain fatal trusted-transition failures.

Phase 6 supersedes unchanged Promise transport for host results whose fulfillment must cross the import boundary. Such a direct result is adopted by one operation Promise whose fulfillment completes import; its rejection outcome remains unchanged.

Phase 9D-A supersedes this phase's direct-Error graph effects and compound deduplication: every direct Error means its boundary failed regardless of transport, and only repeated references to the exact same occurrence wrapper deduplicate.

Phase 9D-C supersedes this phase's blanket `enter` callback-Promise rejection rule: an admitted poison rejection follows ordinary entry completion, while a raw or fatal rejection remains fatal.

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

Every available value has one admitted category represented by a named numeric constant for Error, Array, Function, String, primitive, record, registered class, or opaque identity. The numeric values carry no meaning or ordering. A callable thenable is resolved at its captured property version before its available result is admitted; Promise therefore has no type constant. Error is available terminal data and has `TYPE_ERROR`.

Admission is the sole ordinary type-classification boundary. `admitValue` samples thenability at the current program position and leaves a pending Promise unclassified. Its first callable `then` and optional native FIFO queue live in separate Promise-capture state, so pending transport never creates typeless value metadata. Continuation registration invokes that exact function, and no layer reads `then` again.

`getOrCreateMeta(value, knownType?)` is the sole metadata-record creator. Existing records win; a known runtime-created type avoids reflection; otherwise creation classifies the available value and stores all resulting facts atomically. `admitReadyValue` delegates to it without replacing the input. If classification reflection cannot identify a supported structure, creation conservatively admits that object unchanged as opaque. A non-fatal failure while sampling or invoking `then` is captured as that Promise's rejection and follows the ordinary property-version resolver. Every created metadata record therefore has a fixed type, and every later operation requires and extends that record.

Class registration records the exact prototype in a dedicated `Set`; it does not admit or attach metadata to the prototype. An admitted instance stores that exact prototype with `TYPE_REGISTERED`. The registry and instance metadata are separate because a subclass prototype may itself be admitted as an instance of its registered base while also defining another registered class. An instance admitted before registration remains opaque. Type and class definition remain fixed across later registration and prototype mutation. Records and registered instances use one admitted `prototype` fact for copying; later work never re-reflects on the value to derive it.

Records, Arrays, and registered instances are traversable. Functions, Errors, and opaque identities can carry import, ownership, and lease facts, but graph traversal stops at them. `new Chain(value)` admits its root without changing ownership or import status; normal property reads admit children before any identity fact is recorded.

Semantic category decisions consume admitted type. The class registry is read only during first admission; later decisions never reclassify an instance from its prototype. Other structural checks remain only for representation and property shape. `isTracked`, typeless metadata, and public semantic prototype classification are absent.

### Verification

- Every category in `AGENTS.md` is classified independently of method name, using named numeric constants.
- A Promise is resolved before classification; an Error is classified as available terminal data.
- Thenability is sampled once at a program position; both callable and non-callable samples are covered, and direct admission leaves a Promise identity unclassified.
- A fresh assigned graph is admitted at issuance, so nested Promise discovery protects any COW attachment before later mutation.
- An admitted Error remains `TYPE_ERROR` after prototype mutation makes `instanceof Error` false.
- Class registration uses a dedicated `Set` of exact prototypes and neither admits nor modifies them.
- Admitting a registered subclass prototype preserves both its base-instance classification and its own class definition.
- Metadata creation classifies the available value or accepts its known runtime-created type; every created record is typed.
- Callable-then capture uses separate Promise state and creates no value metadata.
- A previously unseen child is admitted before extraction, sharing, leasing, indexing, or Promise-mirror installation records facts on it.
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

Before pending work can retain a source, lease every reached record, Array, and registered instance. Acquire further leases as required Promise resolution reveals identities, and release each lease after the operation's last access. Host calls consume every explicit argument, while controlled methods consume only the branches selected by the method. Resolve and inspect every consumed input even after finding an Error, and preserve receiver-then-argument Error order independently of Promise settlement.

#### 2. Prepare registered-class calls

One registered-class receiver-category module follows the isolation contract now recorded in [`managed-invocation.md`](managed-invocation.md). Registration rejects prototype-chain accessors before recording the class. Method-behavior restrictions are trusted except for the receiver and result validation specified below; the boundary adds no snapshots, comparisons, or scheduling instrumentation to detect violations.

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

Registered-class invocation adds no persistent state and no registered-class-specific graph behavior outside its boundary. Do not snapshot arguments or support registered-class accessors or asynchronous registered-class methods. Registered instances remain ordinary graph data outside invocation; assignment, deletion, lookup, import, `enter`, refcounting, Promise mirrors, and path COW gain no registered-class-specific path.

### Verification

#### Common invocation

- Records, Arrays, Strings, registered instances, and unsupported receiver categories share one invocation coordinator; category selection retains each supported mode and rejects unsupported opaque execution without invocation.
- Pending argument preparation leases every exact traversable source retained by a continuation, including identities revealed by Promise resolution, and releases all leases on success or failure. Controlled Array calls reuse this mechanism without resolving retained payloads.

#### Registered preparation and calls

- Ready registered-class calls invoke and return synchronously. Pending receiver and argument preparation preserves captured property versions and FIFO order.
- Nested registered state such as `Line3 { start: Vec3, end: Vec3 }` receives settled prototype-preserving values with aliases, cycles, Array holes, and logical property values intact. Imported Promise storage is not modified.
- Several prepared input Errors are combined once with every distinct original at the top level in receiver-then-argument order.
- A registered-class observation cannot observe a later mutation while its preparation is pending. Its receiver lease provides COW protection without a snapshot or gate, but does not protect against a method violating the trusted read-only contract.

#### Mutation isolation

- Every mutation uses the same selective isolation walk and preserves prior and imported owners without a first-mutation marker or registered refcounts.
- A receiver reached beneath a copied ancestor is copied before registered-class code runs, so direct class mutation cannot change the ancestor's preserved value.
- A protected receiver root takes the complete-copy path. The pre-call walk allocates no receiver graph copy when no reached identity qualifies; cycles only expand a copy already required. No graph-size heuristic or separate copy-decision pass exists.
- Mutation isolation remains correct for ready and pending argument identities. When the receiver and an argument overlap, an argument root or nested occurrence of a copied receiver identity is remapped to the same copy without copying unrelated argument data. An empty copy map adds no isolation copy; representation materialization remains independent. Promise discovery and cycles back to a receiver ancestor also preserve correct isolation.
- Every argument lease acquisition is balanced after finalization. Any actively leased identity retained in the receiver remains exact and becomes shared before its lease ends; every other identity retains its ordinary admission and ownership state.
- An isolation-created receiver-root replacement is published even when finalization leaves it unchanged. Finalization never makes the publication decision.
- An Error anywhere in the prepared receiver graph poisons an observation result or the mutation's receiver placement. A Promise or Error left in the completed receiver, other preparation poison, and a synchronous throw follow the same common failure path without publishing invalid state. A Promise or other language failure confined to an independent result affects only that result and does not poison a valid mutated receiver.

#### Class and result contracts

- A conforming method may store an argument-only identity for mutation in a later registered-class call. A receiver-argument alias uses the isolated receiver copy without changing the original Cascada argument; no runtime mutation detector or argument snapshot enforces the trusted restriction.
- Returning `this` yields the published receiver and marks its additional ownership. Every other traversable result is copied unconditionally into a graph independent from the receiver and arguments, preserving its own aliases, cycles, registered-class prototypes, and logical Arrays as unattached native Arrays.
- Registration rejects prototype accessors, and a Promise-valued result is rejected without being awaited. Trusted representation, external-state, reentry, and post-return restrictions add no runtime enforcement machinery; ordinary registered state access remains ordinary graph access.
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
- Repeating the same declaration is idempotent.
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
- A direct Promise returns one operation Promise. Fulfillment produces the imported value or an admission Error; rejection remains unchanged.
- An identity already admitted in the current metadata store keeps its category and origin. Retain it without another graph walk and mark it shared only when the result adds an owner. Phase 9B later scopes that store to one execution.
- Imported physical storage keeps its Promise. The mirror publishes logical settlement without imported writeback; runtime-owned storage keeps ordinary writeback.

Reflection and failure rules are:

- Enumeration and descriptor lookup remain at their existing user-code boundary.
- Do not invoke ordinary accessors or inspect non-enumerable properties.
- An import-walk enumeration or descriptor failure commits no origin, sharing, or Promise mirror from that synchronous segment.
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
- Imported Promise fulfillment continues the captured import boundary and remains mirror-only. Runtime-owned Promise settlement keeps ordinary writeback.
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
- Produces no unresolved language Promise, ArrayView, mirror, metadata, or other runtime-only representation.

Call categories select single-root or batch export; they do not implement another export, copy, readiness, or Error walk. Put preparation, Promise continuation, copying, and Error collection in the export module. Invocation, Array, observation, and script-result code call that module rather than wrapping or extending its walk.

This boundary copier remains separate from Phase 5's complete-graph copier. Boundary export resolves Promise-backed state and consumes every Error; receiver isolation copies already prepared private state and rejects Promise or Error state. Parameterizing one copier for both jobs would merge different invariants rather than remove duplicate behavior.

Export preserves admitted managed-class prototypes. This makes exported managed-class values usable without invoking constructors. Classes that depend on native internal slots, such as `Date`, do not satisfy the managed-class contract and must remain external.

### 2. Never export Errors

- Every root consumes every distinct Error reached beneath it and becomes that Error or one compound Error.
- Batch export combines failed roots in root order, flattening nested compounds and deduplicating leaves by underlying cause.
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

Close the selection collection at the synchronous handoff and each call collection after its last access. Final cleanup closes every collection on success, language Error, rejection, and fatal failure. An aggregate failure may settle while already-registered preparation continues, so later work must not leave a lease in a closed collection. Release is idempotent and never depends on the lease count observed when the operation first returns.

Only managed traversable identities use read leases. A read-only `enter` therefore leases a managed traversable target, but not a Function or external identity. External ordering belongs to Phases 9 and 10.

Keep the existing load-bearing leases: managed receiver preparation, an exact managed receiver awaiting selected input preparation or direct-Promise completion, retained controlled payloads, an ordered Array search that resumes reading its receiver, and managed read-only `enter`.

### 4. Export without source leases

- Read and capture every available placement synchronously during each export transition.
- Capture a pending placement through its exact Promise mirror. Its FIFO continuation traverses every newly revealed branch synchronously before returning.
- After each transition, retain only output copies, identity maps, and captured property versions. Never reread already captured state; read a newly revealed branch once, synchronously, at the FIFO position of its captured mirror.
- Acquire no managed source lease, and retain no selection lease after the export handoff. Later managed mutation may proceed normally without changing the captured export.
- Phase 9F independently keeps required external identity phases through settlement.

Export records no external use and grants no external mutation authority.

This is safe because a ready reachable identity is copied during the synchronous transition and later aliases reuse that copy. A value first revealed through a captured mirror was not previously reachable through that placement, so its continuation can traverse it once without rereading earlier source state.

Delete only export's source-retention callback and lease-presence tests. Retention callbacks used by controlled methods for later reads remain call leases. Test snapshot stability while later mutation remains in place.

Export has an open output lifetime. Local operation closure releases partial output and copy state. In a live execution, an already-registered continuation still completes shared Promise-mirror and property-version settlement, then stops before allocating export output, invoking boundary reflection, or publishing an export result. Phase 9C makes an execution-fatal resumption stop before settlement as well. A reached language Error does not close the required Error scan: discard output copies but continue collecting every reached distinct Error. Preserve the captured-frontier, cycle, alias, and distinct-Error behavior documented in [`outbound-export.md`](outbound-export.md).

### 5. Reuse the matching inbound boundary

- Every existing host call uses Phase 6 import for its result, including the operation Promise for a direct Promise.
- Every script result uses common export.
- Phase 8 reuses export and import for managed methods.
- Phase 9F rejects mutation-capable external identities during host-input export, reuses export for external-property assignment, and snapshots values read from mutable external state.

### Verification

#### Boundary behavior

- Every explicit argument to an existing host call and every script result uses common export.
- One export batch preserves aliases across ordered roots. Each root consumes every reached distinct Error; failed roots are combined in position order, and no Error is exported.
- Exported managed data is independent and contains no unresolved language Promise, ArrayView, mirror, or metadata. Managed-class copies preserve their admitted prototypes without invoking constructors. Functions and external identities remain exact; export records no use or authority.
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

Promise settlement may outlive the operation that registered it. While the execution remains live, shared mirror, property-version, and refcount settlement must continue, but a locally closed continuation must not perform more operation-specific reflection, allocation, protection, invocation, or publication. Export already enforces this distinction by closing at every asynchronous layer before a fatal rejection reaches an aggregate. Error queries and later preparation rewrites need the same rule. Phase 9C adds the simpler execution-fatal rule: check fatal state first and skip both shared and operation work because the failed execution's graph is no longer observable.

### Design

Use the **Operation Work Lifetimes** contract in [`AGENTS.md`](../AGENTS.md). Unify the lifetime rule, not unrelated resource storage.

### 1. Close operation work once

- Keep one open/closed fact at the natural operation scope.
- Close it synchronously in the transition that determines the final operation outcome, before returning, resolving, or propagating that outcome. An unfinished sibling simply returns when it next observes the closed owner; add no separate signal. A direct Promise becomes final only after boundary completion.
- A reached data Error is not necessarily final. A graph-Promise rejection first becomes data Error: `hasError` may finish with `true`, while `getErrors` and export continue their required Error collection. Failure of operation-specific query traversal or indexing is fatal and never becomes collected Error data; a supported failure during shared property publication follows that publication boundary.
- In a live execution, a continuation first completes shared Promise-mirror and property-version settlement, including index maintenance required to publish into an already indexed graph. It then stops if the operation is locally closed. Phase 9C puts the execution-fatal check before settlement. Index construction or traversal requested only by the query is operation work and does not continue after either stop.
- Concurrent preparation components share the operation lifetime, while leases, gates, phases, and output state retain their own last-access and publication rules.
- Release operation-only strong state when closing if no unfinished result can use it. Late continuations retain only what they need to observe execution fatality first and, in a live execution, the local closed fact after shared settlement.
- Reuse an operation owner where one already exists. Error queries use local state; Phase 7B adds no shared lifetime module. Add no cancellation framework, task registry, adapter, raw-Promise path, or generic cleanup abstraction.
- Keep Phase 7A export's current lifetime unless replacing its storage measurably simplifies the code.

### 2. Close Error queries

Give each public `hasError` and `getErrors` call one operation lifetime around path resolution and branch search. Phase 7B deliberately keeps that lifetime around `walkObservationPath` because the current shared walker has no operation owner, and passes no query-specific state into shared path-resolution or property-version APIs. Phase 10 supersedes only this plumbing: shared path walkers receive the common owner used by every caller, while property-version APIs remain unaware of it.

- A successful synchronous result closes immediately. A pending result closes in the transition that produces its complete outcome, before fulfillment.
- A fatal operation-specific query or index failure closes the query before it escapes. It never becomes `true`, `false`, or part of an Error list.
- After an early query result in a live execution, later settlement still updates the captured mirror, property version, and any index required by shared publication, then performs no query-specific indexing, traversal, or reflection. Phase 9C makes fatal execution resumption stop before settlement.
- Finding one Error completes `hasError`. `getErrors` remains open until it has collected every Error in the complete captured branch, including Errors revealed through its captured Promise frontier.
- Keep query state operation-local so concurrent queries over the same Promise frontier remain independent. Mirrors, property versions, and the refcount index remain shared.

Keep the lazily created visited set, optional Error collection, and pending `hasError` resolver in the operation-local query state. The Error collection's presence distinguishes complete collection from first-Error search; no separate strategy or mode is needed. The open fact is the sole stop condition and replaces `hasError`'s former separate `found` state. A counter proof may complete `hasError` without an Error identity; `getErrors` records only reached identities.

Observe each captured property wait and the public path/query result so a fatal rejection closes at its originating asynchronous layer before aggregate propagation. Create the collected-wait `Promise.all` only if the synchronous walk remains open; its observed inputs make another aggregate observer unnecessary. Keep unused readiness observed so a later fatal rejection cannot become unhandled, but perform no query work after closure. Clear the visited set, pending resolver, and accumulated Errors on close so a never-settling sibling retains only the closed query fact.

Do not cancel shared settlement, detach mirrors, suppress source Promise rejection, or add another Error-search algorithm.

### 3. Reuse the rule in later phases

- Phase 7C applies it to all controlled Array operation work.
- Phase 7D orders internal dispatch, preparation, member resolution, isolation, and invocation.
- Phase 7E unifies the lifetime mechanism, applies it to registered preparation and Promise-aware scalar conversion outside invocation, and makes nested components share their operation's owner.
- Phase 8 extends the shared lifetime across managed receiver preparation and argument export.
- Phases 9F and 10 keep external boundary preparation inside the selected operation lifetime while preserving phase completion rules.
- Phase 10 applies it while Promise-valued path segments resume from their protected prefix.

### Verification

- Ready and delayed failures of operation-specific query traversal or indexing are fatal and never become query results or collected Errors. A shared publication failure that has already produced graph Error data follows ordinary Error-query behavior.
- After `hasError` completes early or either query fails fatally, resolving an earlier captured Promise performs required mirror and refcount settlement but invokes no query-specific reflection.
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

1. Capture the receiver's property versions while its ordinary receiver lease is active. A remap result records them directly; an eligible ArrayView result performs the equivalent retained-property and mirror capture without allocating a remap.
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

Comparison count intentionally determines Error consumption. With zero or one sortable record, neither default conversion nor comparator export runs, so an Error remains retained Array data. With at least two sortable records, default conversion consumes an Error as its conversion outcome, while comparator export consumes every Error it reaches before host code. This also removes the current eager conversion failure for a lone unconvertible value and matches the absence of a native comparison.

The native sorter receives only internal placement records. Its wrapper passes paired exported values to the exact comparator Function with `undefined` as `this`; repeated comparisons reuse the same exported identities. The comparator runs synchronously, may mutate or retain exported managed values, treats exact Functions and external identities as read-only, and must not reenter Cascada at this phase's end state. Phase 9D-B later replaces that temporary restriction with explicit operation contexts. Phase 9F later rejects mutation-capable external identities before they reach a controlled callback; observation-only identities remain exact and read-only.

Consume the comparator result directly without import or coercion. An Error is the callback Error outcome. A Promise or any other non-Number result is a validation Error. A ready Number, including `NaN`, reaches the sorter. The snapshot is neither the receiver nor the result; final ordering moves the original property placements.

Lazy or per-comparison export cannot work because export may wait while a native comparator must return synchronously. Sorting exported values directly would lose the exact source placements for duplicates and aliases. The eager dense snapshot and placement records are therefore load-bearing, but no controlled Array method otherwise exports logical input data.

### 5. Stop unused Array work

The common invocation owns one per-call context containing the open/closed operation fact. Pass that context through the Array table's preparation and execution hooks; only helpers that schedule or resume operation work retain and check it. Synchronous helpers may ignore it. Do not use module-scoped current-operation state or create a lifetime per method.

The lifetime covers input preparation, logical conversion, recursive `flat`, search continuation, comparator snapshot export, and remap construction until the Array result is handed to the common invocation. Mutation publication remains owned by `transformProperty` and its ordinary transition. Concrete early-stop cases include `includes` after an early match, recursive `flat`, independently resolving `concat` items, and sibling conversion or sort branches after a fatal failure.

- Close synchronously before exposing a final result or propagating a fatal failure.
- An intermediate data Error does not itself close the operation. Finish the Error scan and other preparation required by the selected boundary, then close when its final Error outcome is determined.
- An early final result, such as `includes === true`, closes unfinished operation work.
- In a live execution, a late registered continuation first completes shared mirror, property-version, refcount, and required publication bookkeeping. If the operation is locally closed, it performs no further conversion, reflection, comparison, callback, remap, protection, or result-production work. Phase 9C makes execution fatality stop the continuation before settlement.
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
- A lone Error or unconvertible value remains Array data. With at least two sortable records, default conversion Errors poison default sort and comparator snapshot Errors poison comparator sort before host code.
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

- The common helpers operate on one open/closed fact and the operation's idempotent `close()`. Existing operation-specific state may implement this interface directly, so do not allocate a wrapper merely to hold it. A pending nested component with independently stored operation-only resources registers one synchronous, idempotent, non-throwing release with the owner and unregisters it on normal completion. This includes values already collected by an unfinished aggregate. Local closure runs remaining releases immediately without cancelling settlement needed by the live execution. Phase 9C adds the preceding execution-fatal stop.
- The helpers receive only results already classified at their boundary. They never decide whether a rejection or failure is language Error data or fatal.
- Every owner has an explicit Boolean open fact and idempotent `close()`. Existing operation state implements that contract directly instead of receiving a wrapper. All operation-specific pending registration goes through the guarded continuation helpers. Ready work continues synchronously without allocating release-registry state. Pending nested resources reuse the containing owner and register their release before control returns. No caller manually registers an unguarded operation continuation.
- All components of one issued operation share that owner. A nested component never creates another owner, does not close on successful component completion, and closes the shared owner at the originating asynchronous layer before its fatal failure reaches an aggregate. The operation coordinator closes after its final success or language-Error outcome completes required processing and publication. Do not create an owner per input, branch, method, or Promise.
- In a live execution, a late continuation first completes shared mirror, property-version, refcount, and required publication bookkeeping, then performs no operation-specific work after local closure. Phase 9C first checks execution fatality and skips both.
- Keep policy and resources with their operations. Invocation retains lease ledgers, export retains output state, Error queries retain traversal and collection state, and gates, phases, publication, and export output retain their own completion rules.
- Add no cancellation framework, task registry, compatibility wrapper, or second continuation path. The release registry contains only synchronous, idempotent releases for independently stored operation resources; it never contains tasks or continuations.

### 2. Reuse the owner without changing boundary policy

- A standalone export owns its operation lifetime. Export used by invocation or callback preparation shares that operation's owner and does not close it on successful export.
- Export output has a separate resource lifetime. Handing completed copies to the caller or discarding them ends output work without closing a shared operation owner.
- A pending nested export registers its output release with the shared owner. Owner closure therefore releases partial output immediately even when an unused input never settles.
- Reaching a language Error discards export copies but does not close the owner. The required Error scan continues; a standalone export's coordinator closes afterward, while a containing invocation closes only after all of its required preparation finishes. Local sibling closure stops unfinished export traversal after required shared settlement in a live execution; Phase 9C makes an execution-fatal resumption stop before settlement.
- `hasError` and `getErrors` use the same owner while retaining their distinct completion rules, visited state, and Error collection. Preserve early `hasError`, complete `getErrors`, and release query-only strong state in their own `close()`.
- Invocation uses the owner while retaining its argument and receiver lease ledgers. Phase 8 later makes argument export share this same owner.
- Move InvocationContext's continuation and fatal-observation methods to the common lifetime helpers. Keep only its lease ledgers and the owner state needed to release them.
- Replace only duplicated open facts, fatal observers, and guarded-transition wrappers in invocation, export, and Error queries. `runExportStep` remains export's per-reflection Error-capture policy and is not lifetime code. Retain no local lifetime path or adapter beside the common helpers.

### 3. Close registered preparation

Start every registered receiver and argument root synchronously under the invocation's one lifetime.

- Before admitting a fulfilled top-level input, verify that the invocation remains open.
- In a live execution, a captured property continuation completes its shared settlement before checking whether its local owner allows further preparation. Phase 9C adds the preceding execution-fatal check.
- A fatal failure in any root closes all unfinished roots. Late roots perform no graph traversal, reflection, materialization, Error collection, or lease acquisition.
- Language Errors still complete the required receiver-then-argument collection. Preserve aliases, cycles, logical Promise versions, and balanced receiver and argument leases.

Phase 8 removes registered argument preparation in favor of export, but reuses this receiver-preparation lifetime. The registered-argument wiring is deliberately temporary; verify the shared closure and balanced-lease contract, not that preparation path's interface. Do not add a transitional adapter or a second managed lifetime.

### 4. Close Promise-aware scalar conversion

Every Promise-aware scalar conversion must use the guarded continuation helpers before it registers pending work. Controlled Array conversion reuses its invocation. Array-length assignment makes its already-required mutation context an explicit owner, so completely ready ordinary assignment and length conversion allocate no additional owner object or release-registry state. Rename `transformValue`'s current `operation` readiness result to `readiness` so it cannot be confused with the owner. Phase 10 extends the same ownership through common path operations. Remove the optional unprotected asynchronous path.

- Recursive logical-Array conversion branches share one lifetime.
- A fatal branch closes unfinished conversion work before it propagates through an aggregate. In a live execution, a branch stopped only by local closure still settles shared property versions but performs no further conversion or reflection; Phase 9C stops an execution-fatal resumption before settlement.
- A language Error remains a conversion outcome and completes all work required by that consumed input.
- Observe every pending mutation continuation through the common helper at its originating layer even when the non-blocking API does not return that Promise.
- `assignPath` may return before a pending mutation publishes. Its immediate non-blocking return does not close the owner; successful or failed gate publication does.
- Preserve ready behavior, scalar semantics, mutation gating, Error publication, and allocation. Do not add a conversion-specific scheduler or lease.

### Verification

- Every operation-specific pending registration passes through the common helper and therefore has an owner before registration. Completely ready assignment and conversion allocate no owner and remain synchronous.
- Standalone export and queries use one owner, which their existing operation state may implement without a wrapper allocation. Export nested in invocation shares its parent's owner. Successful nested export and completed output do not close the invocation, while a fatal nested failure does.
- A language Error keeps export's required scan active without closing a shared owner. Local sibling closure in a live execution stops later export traversal after required shared settlement; an execution-fatal resumption stops before settlement. Existing output discard, Error order, alias, cycle, and captured-frontier behavior remains unchanged.
- `hasError`, `getErrors`, and invocation preserve their existing completion, failure classification, operation-specific cleanup, and lease behavior after the duplicated lifetime code is removed. `runExportStep` retains its current Error-capture behavior.
- A fatal registered receiver branch closes late argument work, and a fatal argument branch closes late receiver work. A root that resumes after execution fatality stops before metadata, lease, copy, reflection, or shared property settlement. Local closure in an otherwise live execution still permits required shared settlement.
- A fatal Array-length conversion branch closes late sibling conversion and reflection. A language Error still completes its required conversion outcome and ordinary mutation failure publication.
- A hidden pending Array-length continuation is observed and remains active after `assignPath` returns. It normally closes after publication; if it detects fatal failure it closes its local owner, and if an unrelated fatal occurs behind a never-settling blocker it may remain pending without delaying any public API result.
- Every registered lease remains balanced after success, language Error, rejection, and a fatal failure detected by that operation. After an unrelated execution fatal, a resumed continuation closes and balances its local owner; one behind a never-settling blocker may retain dead lease metadata for the lifetime of that pending reaction. Invocation, non-invocation conversion, export, Error queries, mutation gates, and later external phases retain their distinct resource lifetimes while following the same closed-work rule.

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
3. Finish both and collect their required Errors in receiver-then-argument order.
4. If preparation is clean, resolve and validate the method once from the prepared receiver or admitted class prototype.
5. Isolate a mutation receiver, then invoke once.

A fatal failure in either preparation closes operation-specific work in both. A language Error keeps the operation open until both finish required Error handling, then closes the combined outcome. After local closure in a live execution, guarded continuations still settle shared mirrors, property versions, and refcounts but perform no further traversal, reflection, copying, or lease acquisition. Phase 9C makes execution-fatal resumption stop before settlement. The two preparations never receive separate lifetimes.

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
- Delete the record half of the old own-placement shadow check, `getRecordMethod`, and the `TYPE_RECORD` host-call branch. Retain managed-class own-placement shadowing and route records into managed selection.

This phase should remove the superseded helpers and fields in the same change; keep no compatibility path.

### 5. Complete managed results

Managed invocation owns result completion and deliberately supplies no common `admitResult` hook: an observation returns the imported method result, while a mutation returns the ordinary `{ mutatedValue, result }` outcome after receiver validation. Importing the whole mutation outcome would cross the wrong boundary. A mutation transition must publish its validated receiver before exposing the imported result.

A synchronous call completes that work immediately. A Promise nested inside a synchronous result is independent data, not invalid state; return immediately and let import continue its retained placement when the Promise settles.

One Promise returned directly by the method extends the managed invocation and becomes its one operation Promise:

- Managed code may access its invocation-owned receiver and inspect read-only exact external arguments until that Promise settles. Every asynchronous access of either kind must belong to it and finish before settlement. Exact external identities may be retained or returned inertly. The managed structure of exported argument copies may outlive the invocation; exact external leaves follow the same rule.
- Detached receiver or external-input work, later receiver access from a nested result Promise, and Cascada reentry during an active invocation are forbidden trusted-contract violations. A nested result Promise must not fulfill with the receiver; return it directly when its completion retains invocation state. It may carry an exact external identity inertly but cannot inspect or mutate it after its guard ends. Add no async-context tracking.
- An observation leases every traversable prepared-receiver identity through settlement. Fulfillment imports the result with ordinary shared ownership; rejection remains rejection and leaves the receiver unchanged. Release leases after the last access on every completion path. Later mutations use COW without waiting; add no readers-writer phase.
- A mutation ends receiver-source leases after isolation and keeps its private receiver behind the ordinary transition gate; the gate, not another lease, protects it. Fulfillment uses managed mutation-result import for a non-receiver result, validates the receiver, and publishes one mutation outcome. The result cannot become observable before receiver publication.
- Keep internal preparation readiness separate from the produced method result. The common coordinator must not pass a produced result Promise through an internal continuation whose rejection is fatal.
- Observe a direct mutation Promise at the managed boundary and return a non-rejecting internal completion to the mutation transition. Fulfillment creates the normal mutation outcome. Rejection creates an outcome that poisons the receiver while its `result` remains the admitted direct Promise, so the operation Promise adopts its contextualized rejection.
- If a mutation returns its working receiver, return the published receiver with ordinary result ownership. A receiver validation failure poisons the receiver and becomes the operation result; pending transport rejects only after that graph effect is published.

Import every managed result without copying it. Ordinary observation import may retain an admitted root without rescanning. A non-receiver mutation result uses managed mutation-result import because arbitrary JavaScript mutation may detach an admitted result container while leaving descendants in the receiver.

### Verification

#### Selection and reuse

- Ready and Promise-backed own enumerable Function placements receive the prepared record as `this`. Inherited, accessor, non-enumerable, resolved non-Function, and extracted Function values remain unavailable as record methods.
- `constructor` remains unavailable as a managed record method.
- Records no longer call inherited `hasOwnProperty`, `toString`, or other `Object.prototype` methods. An own accessor is not invoked, and neither it nor an own non-enumerable Function supplies a method.
- Receiver or argument preparation failure performs no post-preparation record method-placement read, managed-class prototype descriptor traversal, callable validation, or invocation.
- Receiver and argument Errors, including mixed ready and pending failures, combine in logical receiver-then-argument order.
- `this.helper()` mutates the already isolated receiver and publishes only through the outer invocation.
- Records and classes share one preparation, export, isolation, validation, result, and cleanup path.
- The caller's mode matches method behavior.
- Managed methods treat nested external identities as opaque. Explicit selection such as `api!.db.close()` uses the external operation path instead of hiding host access inside managed code.

#### Promise lifetime and protection

- When a root argument Promise fulfills while receiver selection remains pending, its traversable fulfillment is protected until export starts. A later source mutation cannot change the exported argument, and every selection lease balances on success or failure.
- A direct-Promise observation holds receiver leases but no readers-writer phase. Exported arguments retain no source lease, and later mutation uses COW without waiting.
- A direct-Promise mutation remains private behind one gate. Later operations wait; fulfillment validates and publishes once; rejection is handled as language failure rather than fatal, poisons the receiver, and preserves its contextualized rejection with the native reason as cause.
- Direct mutation fulfillment with an Error returns that Error without poisoning an otherwise valid receiver. Direct rejection poisons the receiver and preserves the contextualized rejection.
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
- Equivalent record and class failures produce the same receiver-then-argument Error order and balanced selection and receiver leases.
- Receiver preparation and isolation retain their aliases, cycles, logical Array, admitted-prototype, metadata, and refcount guarantees after the simplification.

Phase 9D-A supersedes the ready-versus-rejected direct-Error distinction: every direct Error follows the same call-failure rules, while an Error from an independent nested result remains independent. Phase 9F adds the live-external-leaf exception to ordinary receiver poisoning.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`managed-invocation.md`](managed-invocation.md), [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 9A: Establish context external foundations

### Terms for Phases 9A–9F

- **Execution:** an object shared by every related Chain in one Cascada execution. Phase 9B moves graph metadata, thenability, and continuation state into it. Phase 9E uses its external-identity map for location and readers-writer phase state; phase completions carry repairable poison inside non-thenable state records.
- **Operation context:** the final immutable `{ execution, errorContext }` carrier. Phase 9B uses it to select execution-local state; Phase 9C uses it for fatal coordination, and Phase 9D-A activates its opaque source fact for causal recoverable-Error attribution.
- **ContextChain:** a public `Chain` subclass for root context initialization. It imports its host value and may build a static external mutation tree; an entered ordinary Chain carries the reached tree node when one exists.
- **Mutation scope:** the context prefix whose state one operation may change. `!` selects it for a call; assignment and deletion use their complete target path. An observation has no mutation scope.
- **Scope mutation path:** a compiler-provided String/Number prefix selected by `!`. Its selected subtree may contain external effects.
- **Property mutation path:** a compiler-provided complete String/Number target of an assignment or deletion. Only its containing path may cross an external boundary.
- **Static external mutation tree:** one positive mutation-authority index per context Chain with non-empty scope or property mutation paths. Initial import searches only those paths and records their synchronously reached external boundaries; later queries may only prune conflicted leaves.
- **External boundary:** an external Chain root or the first external identity reached from managed state. It encapsulates the host suffix below it for one operation.
- **Actual use:** selecting a supported call or property operation through an external boundary, or selecting that boundary in a broader external mutation scope. Direct capability extraction and operations that only carry, copy, inspect graph Error state, or reject the identity at a boundary are not uses.
- **Mutable external value:** an external identity recorded in a static external mutation tree. It is a path-bound capability: Cascada may call it or access properties through its fixed context location, but may not expose the identity as a value.
- **External snapshot:** the detached managed value produced by reading inside mutable external state. It has the same visible graph-copy semantics as export, preserving Arrays, cycles, aliases, prototypes, and Functions while copying every traversable identity, but uses its own synchronous walk because it starts from raw external data and contains no Promise.
- **Mutation scope depth:** the compiler-selected `!` prefix depth. Assignment and deletion default it to their complete target depth.

### Problem

External ordering needs explicit execution-scoped coordination and mutation-scope facts. Establish these foundations without changing external behavior; Phase 9F exposes repair and performs the atomic cutover from the hidden sequence mechanism.

### Design

### 1. Associate Chains with an execution

Expose:

~~~js
new Execution()

new Chain(initialValue, execution = new Execution())

new ContextChain(
  initialValue,
  errorContext,
  execution = new Execution(),
  scopeMutationPaths = [],
  propertyMutationPaths = [],
)
~~~

This is the Phase 9A transitional surface only. Phase 9B replaces both constructors atomically with the explicit operation-context signatures at lines below and removes every implicit private execution; Phase 9C and later use only that final surface. Within Phase 9A, the constructor arguments are fixed runtime concepts, so keep them positional rather than allocating an options record for every Chain. `Chain` temporarily admits existing Cascada data without `errorContext`. A root `ContextChain` imports raw host context data and therefore receives `errorContext` plus the two compiler path Arrays. These control arguments come from the Cascada runtime and need no defensive validation.

Ordinary Chains are mutation-capable and need no capability flag or close lifecycle. `enter` always creates an ordinary `Chain` with an exact internal `entryMutable` Boolean and one-shot closed state. When the selected path reaches the external mutation tree, that Chain also carries the reached node as `_externalMutationTree`. Store no parent or path because the node is the complete required tree fact. The internal `ExternalMutationTree` owns branch and boundary queries; observations otherwise use the common walker, while mutations additionally assert the entry restriction. Keep no entered subclass, parallel operation path, or compatibility alias for `_mutates`. Ordinary Chains expose no public `close()` method.

Every Chain belongs to exactly one execution. During this transitional phase, the runtime passes the same execution to every related top-level Chain; internally created child, private, and entered Chains inherit it, while a standalone Chain or ContextChain that omits `execution` creates a private execution. Phase 9B removes that omission path and requires an explicit initialization operation context. Different executions never share external authority, phases, or poison.

`ContextChain` gives root context import and external mutation indexing an explicit public boundary. It extends `Chain` and uses the same operations; it adds no parallel walker or invocation path. Its internal `ExternalMutationTree` owns construction, commit, branch selection, and exact, prefix, and descendant queries. An entered ordinary Chain may carry one reached node for the same queries. Each root path entry is a native Array of String or Number segments:

- `apis.data!.write()` contributes `["apis", "data"]` to `scopeMutationPaths`.
- `apis!.data.write()` contributes `["apis"]` to `scopeMutationPaths`.
- `apis.data.status = value` contributes `["apis", "data", "status"]` to `propertyMutationPaths`.
- `delete apis.data.cache` contributes `["apis", "data", "cache"]` to `propertyMutationPaths`.

Consume the compiler paths during construction without retaining them. String-keyed tree children make Number and equivalent String property segments select the same node. Tree insertion naturally merges duplicate and overlapping paths. Promise-valued segments belong to Phase 10 operation paths and cannot appear here.

A root `ContextChain` invokes the common importer once and passes itself and both path Arrays internally. It is a distinct public Chain type, not a second importer. Two empty Arrays import the root and build no tree. Public `import(value, errorContext)` remains available for ordinary host data but cannot create external mutation authority; wrapping its result in `Chain` leaves external identities observation-only.

Import failure classification remains unchanged. A supported boundary or host-reflection failure produces a language Error for the current synchronous segment; an existing Error in the input remains data; an internal failure is fatal. Admission, origin, sharing, Promise mirrors, tree leaves, and new external identity entries are one transaction: stage them locally and publish them only when the segment commits. A later Promise fulfillment is its own segment, so its failure poisons only that captured placement and does not undo the earlier import.

`enter` creates an ordinary Chain from the selected value, source execution, and exact `entryMutable` Boolean. When the path reaches a node in the source external mutation tree, the entered Chain also carries that node as `_externalMutationTree`. Nested entry walks from that node, and entry below an external leaf remains clamped to the leaf. A leaf is the stable location token: it is unique to its root ContextChain and canonical path and remains the same through entered contextual Chains. No source Chain, copied subtree, or separate location record is needed. Phase 9E adds use and readers-writer phase state to the execution's stable external identity entries; phase completions carry repairable poison.

Keep state at its natural scope:

- In Phase 9A, the execution owns only the future Phase 9E external identity use-and-phase map. Phase 9B moves existing execution-scoped graph state into it.
- A root ContextChain with discovered external boundaries owns its static external mutation tree. An entered Chain carries the reached node as its own tree root.
- Admission, COW protection, leases, mirrors, refcounts, and canonical thenable-continuation state temporarily remain module-wide until Phase 9B localizes them. Identity declarations, captured thenability, and managed-class registration remain runtime-wide configuration.
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

The path Array is the complete runtime path input. Its segments are String or Number values and, after Phase 10, may be Promises resolving to either. Do not add sideband facts describing how a segment was produced.

At issuance, copy every retained path and argument Array. Trust the compiler/runtime-owned record, method, and scope depth. Do not inspect or validate a language path segment before traversal reaches it. Replace the old signature directly and add no adapter.

Phase 9A uses only the presence of `run`'s scope depth to preserve observation-versus-mutation dispatch. Assignment and deletion remain ordinary mutations. Phase 9F consumes the numeric depths when it selects managed and external scopes; retaining the final API now avoids a transitional signature or adapter.

`lookupPath` needs no added facts: its Chain and path identify the tree query. Assignment and deletion already identify property mutation by their operation and default `mutationScopeDepth` to `path.length`; only an explicit broader `!` supplies another depth. `run` needs `mutationScopeDepth` because the `!` position is not derivable from its receiver path; Phase 9F adds `repair` to the same record. Controlled callbacks receive none. Host-input and script-result export receive the execution only to reject indexed mutable external identities. Error queries treat external identities as terminal.

Keep the single optional assignment/deletion fact positional:

~~~js
assignPath(chain, path, value, mutationScopeDepth = path.length)
deletePath(chain, path, mutationScopeDepth = path.length)
~~~

Do not allocate a general facts record for operations with nothing else to carry.

Lookup and `run` consume their receiver path. Assignment and deletion traverse only the containing path before the final key. Replacing an external-valued managed placement is managed structural mutation; reaching an external identity before the final key selects a host property operation. Empty assignment replaces the root, and empty deletion replaces it with `null`.

### 3. Build static external mutation trees where needed

Implement the **Static external mutation tree** section of [`external-context-ordering.md`](external-context-ordering.md) as the authoritative algorithm. Phase 9A only:

- builds the tree and stable empty identity entries inside the initial ContextChain import transaction;
- provides the internal anchored-path query for an exact boundary, first boundary prefix, or live scope descendants;
- keeps the tree fixed and dormant after construction.

Phase 9E adds identity use, readers-writer phases with non-thenable repairable-poison state records, and conflict pruning. Phase 9F routes public operations through the query and rejects controlled changes that would disturb a live leaf. Phase 9A changes no public external behavior.

### Verification

- Root ContextChain construction imports its raw value exactly once and atomically builds the tree from both compiler-provided path Arrays, including through already-admitted managed nodes. A boundary Error commits no import or external-index state for that segment; an internal failure is fatal.
- `!`, assignment, and deletion contribute the paths above. A property mutation never scans its old target. Duplicate, overlapping, empty, and external-free paths produce only the required unique leaves.
- External boundaries outside every supplied path are absent from the tree and remain observation-only.
- Ordinary Chain construction admits existing Cascada data without import. A root ContextChain with two empty Arrays imports its host value but builds no tree. Promise branches and later graph changes add no leaves.
- Wrapping a public `import()` result in an ordinary Chain creates no tree or external mutation authority.
- Cycles terminate; acyclic aliases retain their distinct finite leaf paths.
- Assignment through one managed placement followed by mutation through another uses ordinary COW and preserves every live leaf on the first placement.
- COW, Array remaps, managed aliases, and `enter` leave the dormant tree unchanged.
- An entered Chain keeps the common Chain operation surface and source execution. When it reaches the external mutation tree, it carries that node as its tree root without copying it or retaining a semantic parent relation.
- A boundary reached as an absolute context path and as a relative path from one or more entered Chains returns the same leaf location and absolute boundary path. The entered Chain identity is not a new external location.
- In the Phase 9A transitional API, related top-level Chains share their explicit execution and omission creates an isolated private execution. Phase 9B's final API removes omission and tests that every production Chain has an explicit initialization operation context.
- Root context trees remain ContextChain-local; entered Chains carry only a reached node. External identity coordination remains execution-local, and identity and operation facts retain their existing scopes.
- Compiler/runtime control facts receive no defensive shape validation. An empty property mutation path is root value replacement and discovers nothing; an empty scope path or `mutationScopeDepth === 0` selects the root scope. Observation uses `undefined`.
- Normally constructed Chain instances carry no entry state. Chains created by `enter` preserve read-only, mutating, and closed issuance behavior through the common Chain implementation; no `_mutates` alias remains.
- Caller mutation of captured inputs cannot change issued work.
- The tree query and stable identity entries remain dormant. Phase 9A adds no use state, readers-writer phase or phase poison, conflict pruning, mutable-value rejection, or public external-ordering route; the hidden sequence mechanism remains until Phase 9F.
- Rewrite [`enter.md`](enter.md) to document the common Chain representation; remove its current ordinary-Chain capability and close contract when the code changes.

---

## Phase 9B: Make graph state execution-local and plumb operation context

### Problem

The module-wide metadata store makes independent executions importing the same host identity share admission, ownership, leases, Promise mirrors, ArrayView attachment, and refcount state. Classification and mirror sharing can change logical behavior; the other shared facts can impose another execution's protection or bookkeeping even when their current effect is only conservative. For example, a class instance admitted as external in one execution remains external in another execution created after its class is registered as managed. Each execution must instead admit and track its own graph independently.

Managed values move between executions only through export and import. Host code can independently supply the same exact external identity to several executions, but their ordering state is isolated; sharing a mutation-capable external identity this way is therefore a host-contract violation that Cascada does not detect across executions.

Execution and source attribution ultimately travel together in Cascada. Introduce their final operation-context carrier while moving graph state, but preserve existing Error behavior in this phase. Phase 9C adds execution-level fatal coordination, Phase 9D-A activates causal recoverable-Error attribution, Phase 9D-B permits synchronous re-entry, and Phase 9D-C completes the rejecting-thenable representation without changing the operation API again.

### Design

### 1. Let Execution own mutable graph state

Extend the `Execution` created in Phase 9A with:

- one `WeakMap` containing admitted metadata for identities used by that execution;
- one `WeakMap` containing that execution's sampled thenability and canonical continuation state; and
- the existing external-identity coordination `WeakMap`.

The metadata map retains the single-record design from Phase 3. It contains the admitted category and prototype, import origin, sharing and leases, placement versions, ArrayView attachment, refcount parents and counters, and other persistent graph facts. Phase 9D-A finishes causal Error use of the existing placement-version overlays. A managed copy receives metadata only in the execution that creates it.

Every runtime question that depends on admission or thenability uses the selected execution. This includes metadata lookup and creation, admission, `isPromise`, `typeOf`, traversability, ownership, leases, Promise mirrors, ArrayViews, and refcounts. The first operation that may sample thenability supplies its complete operation context so a throwing `then` getter has the correct source. Migrate every call site together; no compatibility helper may consult a module-wide store. Context-free raw shape probes remain separate and are used only where no execution exists, principally declaration walks. Semantic `isError` remains context-free and excludes fatal `RuntimeError`; admitted Error metadata adds no category that native detection cannot see. Phase 9D-A adds causal native-Error contextualization and makes every Promise test recognize all native Error forms before sampling `then`.

An execution samples an identity's `then` at most once and owns the captured callable, any acquisition failure, the canonical Promise, and every continuation fact derived from them. Sampling receives the current operation context because reading `then` may itself fail; that first acquisition failure keeps the sampling operation's source. Supplying the same thenable to another execution independently samples, invokes, and orders it there. A native Promise remains one host Promise, but its Cascada continuations, mirrors, and graph effects are execution-local.

Invoking a captured custom `then` is also a supported host boundary. A synchronous invocation failure keeps the operation context that first creates the execution's canonical Promise and is stored as that canonical rejection. Later consumers preserve it. Ordinary fulfillment or rejection supplied by the thenable remains its captured outcome and is processed by each boundary that introduced the Promise.

Phase 9D-A replaces that custom canonical rejection/assimilation representation with a source-neutral cached settlement record. It retains the execution-local sampling and FIFO ownership established here.

Declaration APIs run before an execution exists. They inspect thenability only for that declaration call, deduplicating aliases with operation-local state; their sampling creates no persistent fact outside that call and uses no execution context. Remove the module-wide captured-thenable map in this phase. Phase 9D-A, when it removes the transitional raw host-failure marker, preserves Error before probing and replaces the temporary rejecting-thenable representation of a failed sample with the final ordinary declaration-validation outcome. No final declaration probe owns poison, kind, a Promise, synthetic thenable, or persistent capture.

No mutable graph bookkeeping remains in a module-wide identity map. Do not add an ambient current execution, an identity-to-execution registry, or fallback global metadata.

### 2. Carry the final operation context

#### Operation context

Add one immutable runtime-owned control record:

~~~js
const operationContext = { execution, errorContext }
~~~

`execution` selects the execution-local graph state. `errorContext` is opaque source information supplied by Cascada; the prototype may use a simple String or record, while later integration may supply path, line, column, operation, and diagnostic details without changing graph APIs.

The caller selects `errorContext` for each semantic operation, not merely for its enclosing statement. Nested calls, lookups, conditions, commands, and control-flow boundaries may therefore carry different contexts even on one source line. Async diagnostic-route or command-buffer stacks may later supplement that source, but never replace or rewrite it.

Do not reproduce Cascada's compact context tables, dynamic context cloning, or diagnostic stacks without a graph-kernel need; the opaque `errorContext` remains their integration point. Execution-wide fatal coordination is required by [`error-handling.md`](error-handling.md): the execution owns the first fatal outcome and the currently pending public-result rejection actions, while a higher scheduler observes that same outcome rather than creating separate fatal state.

Every graph operation receives one operation context. Chain initialization binds the Chain to its operation context's execution but does not retain that operation's source context for later work. Each later Chain operation receives its own operation context. Public import and any other boundary without a Chain also receive an operation context. A continuation captures the same operation context as the operation that registered it. This trusted two-field protocol needs no class, factory, freezing, or defensive validation of arbitrary shape or source payload. It does require the minimal explicit presence and execution-binding checks needed to select the right fatal state before graph access; an incidental `TypeError` would lose deliberate attribution and may occur too late. Package export makes it a kernel integration surface, not application language data: Cascada constructs these contexts and never exposes arbitrary Chain/context pairing as a script input.

The operation context selects the execution used by an operation. A Chain also retains its initialization execution as a private invariant because its state and any committed external-tree entries belong to that execution. Remove the public execution getter and every helper that derives an operation's execution from the Chain. At each public Chain operation, fatally assert that `operationContext.execution` matches the Chain binding, then pass the operation context through its graph work. Unwrap its execution only to access execution-owned state or validate the Chain binding. `enter` and other internal Chain creation reuse the containing operation context and bind the new Chain to the same execution. This check prevents silent mixing of two metadata or external-authority domains; it is not a second execution-selection path.

Chain initialization uses its operation context only for work caused there. A ready root retains no creation context. A pending root establishes its root property version and mirror during initialization so sampling, settlement, admission, and rejection retain the initialization operation context even when the first consumer arrives later. Replacing the root creates a new version with the replacing operation's context.

Keep source context separate from mutable work state. `InvocationContext`, `ExportContext`, Error-query state, and mutation owners still manage open/closed work and resources; they retain the source operation context only when pending work needs it. Operation-bound graph helpers receive the operation context consistently. Execution-owned stores and Chain binding checks unwrap its execution. Pure shape and prototype helpers remain context-free.

This phase carries `errorContext` unchanged but does not reinterpret current Errors. Existing import diagnostics read `operationContext.errorContext` instead of their old positional source input and retain the current `"(imported at: ...)"` message suffix; Phase 9D-A replaces that suffix with structured attribution. Other Error behavior remains unchanged. When first thenability sampling or captured-then invocation fails, retain the responsible operation context with that execution-local raw outcome so Phase 9D-A can contextualize it without guessing. Do not add temporary context strings, an execution-only public API, or an adapter signature.

### 3. Migrate state and APIs together

Change every production graph-operation boundary directly. Place the required operation context after ordinary semantic inputs and before optional compiler/runtime facts:

~~~js
new Chain(initialValue, operationContext)

new ContextChain(
  initialValue,
  operationContext,
  scopeMutationPaths = [],
  propertyMutationPaths = [],
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
- `error.js` changes the transitional operation fatal entry to `runFatal(operationContext, work)`, and every operation-bound caller passes its registering operation context. Keep current report-and-rethrow behavior until Phase 9C replaces it with execution-owned `submitRuntimeFailure` and runtime-only transition helpers. State declarations use a separate contextless fatal entry; do not make the operation context optional. Phase 9C gives the contextless path its explicit source sentinel and synchronous throw behavior without an execution reporter.
- `resolution.js`, `operation-lifecycle.js`, invocation/export/query owners, mutation owners, and every continuation carry the registering operation context while work needs it.
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

The fatal reporter and synchronous host-code re-entry guard remain runtime-wide at the end of this phase. Phase 9C adds execution-owned first-fatal state, centralized fatal checks, and pending-public-result fatal delivery, captures reporter routing and report idempotence on each execution, and removes mutable global reporter routing. Phase 9D-B removes the re-entry guard. Immutable method tables, captured primordials, and sentinel Symbols remain module constants. Traversal maps, releases, copies, and other temporary state remain operation-local.

### 5. Preserve execution boundaries

Admission is fixed per identity within one execution. Importing the same host identity into another execution performs independent admission under current declarations and class registration, with new origin, ownership, placement-version, and refcount state and no host-storage change.

Export followed by import is the only supported transfer of managed data between executions. Exported host copies carry neither declaration nor category; later import classifies the new identities normally. Passing an unexported runtime-owned managed identity between executions is unsupported and need not be detected.

Host code may independently supply the same exact external identity to several executions, but their authority and phases do not coordinate. A mutation-capable external identity must therefore belong to only one execution; enforcing that host contract across executions is outside Cascada.

### Verification

- The same record, Array, class instance, Promise-bearing container, or thenable receives independent admission, ownership, placement versions, refcounts, and continuation state in two executions.
- A class instance admitted before class registration remains fixed there; another execution admitting it after registration applies the current registry independently.
- Every admitted category remains fixed within its execution. Tests do not treat declarations made after use as supported reconfiguration.
- Declarations remain runtime-wide, persistent, atomic, and context-free, while declaration thenability sampling is local to one declaration call.
- Two Chains in one execution still share graph state and thenable FIFO order. State in another execution changes neither.
- Every production constructor and operation signature above requires an operation context. A mismatched Chain execution fails fatally before metadata or external-tree access; internal and entered Chains reuse the containing execution.
- Runtime-owned contexts and compiler facts receive no defensive validation of arbitrary shape or source payload. Operations still perform the minimal explicit context-presence and execution-binding checks required before selecting execution-owned state. Contexts for operations emitted from one source clause may legitimately share the same opaque source fact.
- Two imports carrying distinct `errorContext` values produce distinguishable diagnostics, and neither operation substitutes the other's operation context. Phase 9D-A preserves this test with structured attribution instead of the transitional message suffix.
- Every caller-facing Promise predicate receives an operation context. Each execution samples and canonicalizes a thenable independently; no global thenability fallback remains. A throwing first sample or captured-then invocation retains its registering operation context for Phase 9D-A.
- A pending root establishes its exact version during initialization and retains that operation context with its deferred work. A ready root does not become a later source-context fallback.
- Context-root import, host-call results, managed results, and Promise fulfillment keep their existing boundary behavior while using the operation's execution.
- The test harness alone supplies omitted operation contexts, using one shared fresh execution per test. Strict API tests exercise every production signature directly and verify that an omitted operation context fails fatally before graph work.
- Every operation-bound fatal entry receives the registering operation context in Phase 9B even though fatal output remains unchanged. The contextless configuration path is explicit and cannot become an operation fallback.
- Export/import produces independent receiving identities and metadata. No supported API transfers unexported managed data between executions, and cross-execution mutable external sharing remains an explicit host-contract violation.
- Refcount inspection and `test/verify-refcounts.js` select one execution explicitly and cannot observe another execution's index.
- Metadata remains non-reflective and physically outside graph objects. Metadata and thenability stores are execution-local; declarations, the fatal reporter, the re-entry guard, immutable definitions, and sentinels remain at their stated scopes. No ambient execution, identity-to-execution registry, compatibility store, or parallel admission path remains.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-preparation.md`](import-preparation.md), [`enter.md`](enter.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), public API documentation, and execution-isolation examples.

---

## Phase 9C: Own and observe fatal execution state

### Problem

Phase 9B gives every operation an execution and source context, but fatal failures still use a process-wide report-and-rethrow path. Unrelated work cannot reliably fail every still-pending public operation result or record a fatal after a result returns, competing failures can create competing outcomes, and shutdown has no authoritative lifecycle.

### Outcome

Implement the fatal branch of [`error-handling.md`](error-handling.md). Each execution selects one `RuntimeError`, retains rejection actions only for execution-bound public API results that are currently pending, stops internal work at centralized execution checks, and reports that exact occurrence once through the reporter captured for that execution. It does not walk or settle internal tasks. Contextless host-configuration APIs remain synchronous. Any public result completed before fatality is unregistered and remains completed. Keep the existing recoverable Error attribution until Phase 9D-A replaces it; Phase 9D-C later changes poison thenability.

The remaining Error architecture has one implementation owner per concern:

| Concern | Phase |
| --- | --- |
| Execution fatal authority, per-execution reporting, centralized stop checks, bounded pending-public-result delivery, and the sync-first public-result contract | 9C |
| Final recoverable-Error construction, immutability, precise poison predicates, causal attribution, authoritative kinds, compound semantics, query reflection, and thenable capture/cycles | 9D-A |
| Conservative admission-classification and contextless declaration probes after removal of the transitional host-failure marker | 9D-A |
| Host-boundary fatal check | 9D-A; synchronous re-entry activates its observable case in 9D-B |
| Rejecting-thenable poison and extension of the standing Promise-production inventory to language-value payloads | 9D-C |
| External-phase recoverable Error state | 9E-9F |
| Promise-valued path failure and lifecycle integration | 10 |
| Cascada scheduler, compiler operation-context table, diagnostics, Promise ownership, public API, and platform cutover; extension of all standing inventories across the integration | 12 |

Phase 11 is an optional implementation simplification and changes no Error semantics.

### 1. Establish the fatal branch

- Make only `RuntimeError` a direct native Error branch in this fatal-focused phase. Give its exported constructor a module-private token and semantic brand, and let its factory trust the supplied `errorContext`; verify source-bearing call sites statically rather than adding repeated defensive checks. `RuntimeError.prototype` receives an own non-callable `then` and is then frozen, so a fatal Error remains non-thenable even if host code later extends `Error.prototype`. This is targeted protection of Cascada's own Error transport protocol: native Promise assimilation must not turn the fatal branch into the language-thenable branch. It does not broaden the platform contract into general tolerance of modified Array, String, Object, or Error primordials. Fatal Error is never admitted, combined, queried, repaired, or returned as language data.
- Leave the existing poison hierarchy, kinds, and construction untouched in 9C. Phase 9D-A changes `PoisonError` to extend native `Error` directly, removes the remaining runtime `CascadaError`, and installs final poison factories, brands, immutability, kinds, and attribution in one cutover. Do not perform half of that recoverable migration here.
- Submit an existing `RuntimeError` unchanged to the receiving execution. Wrap any other failure escaping runtime-only work with the causing operation's source context, including `PoisonError` or `CompoundPoisonError`. Poison is recoverable only when an explicitly language-outcome transition recognizes it before the fatal lane.
- Freeze each completed `RuntimeError` after construction and freeze its prototype once its methods are final. It carries immutable source, message, and exact cause reference but no reporting state. Poison remains on its existing transitional representation; Phase 9D-A installs and freezes the final poison wrappers and copied compound child arrays, and Phase 9D-C freezes both poison prototypes after installing their final `then`. Each execution's first write to `fatalError` prevents duplicate reporting within that execution; another execution receiving the same Error closes and reports independently.

`submitRuntimeFailure(operationContext, reason)` becomes the sole operation fatal entry. `runRuntimeTransition(operationContext, work)` is its synchronous runtime-only envelope:

1. Preserve an existing `RuntimeError` as the candidate, or create one from any other escaping failure and the current operation source.
2. Submit the candidate to module-private `commitFatal(operationContext.execution, candidate)`.
3. Propagate the authoritative Error returned by the execution.

Do not make Error class the continuation policy. Use one common guarded continuation path for execution and local-lifetime checks. A transition body that admits language Error consumes poison and performs its publication, collection, or result effect explicitly; any Error escaping the body reaches the one runtime-fatal envelope. Do not add a Boolean policy argument or parallel continuation families. Phase 9D-A completes the call-site audit as causal Error handling changes.

`runContextlessFatal(work)` is the sole executionless path. It uses one explicit contextless-source sentinel, converts an unexpected defect to `RuntimeError`, and throws synchronously. It reports nowhere and closes no execution: the synchronous caller already receives the failure, while reporting belongs to an execution. If the same Error later reaches an execution, that execution submits and reports it normally. Do not add a reporter parameter, mutable global routing, or report state on the Error. Host-configuration validation may still throw an ordinary host API Error.

Remove `reportFatalError`, mutable module-global reporter routing, `RuntimeError` report state and methods, and every competing reporter or fatal-state path. Retain `CascadaError` only as the temporary poison base and public compatibility export until Phase 9D-A removes both together. Apart from expected-poison/runtime-only separation required for sound fatal handling, do not change poison representation, kinds, contextualization, or boundary recovery in this phase.

### 2. Let Execution own the fatal outcome

Construct each `Execution` with an immutable reporter, defaulting to a no-op only when its creator supplies none. Validate an explicitly supplied reporter once at that host-configuration boundary and capture it in one module-private state record keyed by the exact execution; operation work never reads mutable global routing. The same record holds the nullable fatal slot and one initially empty Set of rejection actions for currently pending public results. Expose the fatal outcome through a read-only `execution.fatalError` getter over that record. Host code can query it but cannot assign, clear, or replace it. Module-private `commitFatal(execution, candidate)` accesses that same record and atomically:

1. Keeps the first fatal candidate.
2. Rejects every currently pending public result with that Error and clears the Set.
3. Invokes that execution's captured reporter after fatal state is committed.

`execution.js` owns only that module-private per-execution record, the read-only getter, private pending-result registration/removal, and atomic module-private `commitFatal`. Do not expose a public fatal mutator, mirror the Error onto another field, or add a token check to the trusted internal commit path. The null/non-null state of `fatalError` is the latch; do not add a separate `hadFatalError` Boolean. Commit fatal state before rejecting public results and reporting. Rejecting their native wrapper Promises invokes no host code synchronously. Invoke the reporter as a synchronous best-effort notification under a protective catch, ignore its return without sampling thenability, and preserve the fatal Error if it throws; any asynchronous work the reporter starts is host-owned. The reporter is notification, never the delivery or control-transfer path; with no reporter, the public result and `fatalError` query remain authoritative, and no asynchronous global throw is added. Later candidates neither replace nor reattribute the first Error and do not report again. Do not add another fatal state, Promise, reporter, operation-owner registry, internal-work listener set, or cancellation registry. Cascada passes its per-render `onError` when constructing the execution, so concurrent executions may report independently.

This repository implements and tests the execution fatal outcome, centralized stop checks, and one common public-result exposure helper in the package's host-facing facade around actual import, observation, export, invocation, entry, mutation, and Error-query routes. Every ready result remains direct; every direct Promise returned by an execution-bound public API operation gets one removable fatal rejection action for exactly its pending lifetime. Core-operation and other internal Promise results do not. Chain and context-root construction perform only the public-entry check and return immediately. Contextless declaration and host-configuration APIs remain synchronous because they have no execution to observe. In Phase 12 the higher Cascada runtime imports the unwrapped core functions through one explicit trusted integration subpath and reuses the same exposure helper only for its outward public operations, including final script completion.

Treat removal of global reporter routing as an explicit repository migration, not only a new-behavior test. Audit `test/setup.js`, `test/support.js`, fatal subprocess fixtures, `test/verify-refcounts.js`, direct `Execution` construction, and every import or call of `setFatalErrorReporter` or `reportFatalError`. A test that needs fatal capture supplies its reporter before constructing the execution and routes the operation through that execution. A captured reporter may append to mutable test result storage, but it must not forward through a mutable “current reporter” compatibility slot that recreates global routing. Remove global reset behavior and migrate contextless fatal injection either to the non-reporting contextless contract or to an explicit operation context, whichever the test actually intends.

Operation owners remain the local Phase 7E lifetime mechanism and are never registered with the execution. They carry no fatal-reject action and serve only live-execution local completion. A public operation issued after fatal throws the stored Error synchronously; an already-issued internal operation simply returns when its next common continuation observes fatal state.

This phase supersedes earlier-phase statements that shared settlement continues after a fatal execution failure or that fatal detection/observation closes an operation owner and balances its releases. Shared settlement still precedes a local-owner check while the execution remains live; an execution-fatal check comes first and stops all graph and cleanup work.

It also removes fatal-observation complexity from the existing Phase 7E helper stack. Delete `observeFatal` and any per-result fatal observer: a runtime-only transition submits its failure immediately, ignored owned Promises are marked handled at their producer, and public result Promises use `exposeResultOrFatal`. Keep the owner local and minimal—its direct `open` fact, idempotent `close()`, and lazy release set. Do not retain a trivial `mayContinue` wrapper or use lifecycle code as a Promise-combinator layer. Phase 9D-A finishes the consolidation by replacing initial/internal/prepared/single/all continuation variants with one guarded operation-transition entry plus explicit admission, publication, and complete-collection bodies at their natural semantic boundaries.

### 3. Check once and stop failed-execution work

Put fatal checkpoints only at centralized semantic transition boundaries:

- public operation entry;
- at common continuation resumption, before settlement or operation work;
- at the supported host-boundary exit, before processing its return or throw;
- and scheduler dispatch.

Do not poll inside hook-free synchronous helpers or loops. JavaScript cannot change the execution's fatal state concurrently there. Allow an active synchronous host call to return; the mandatory check in its boundary helper discards its result when nested work closed the execution. A bounded amount of extra hook-free work after closure is acceptable when avoiding it would spread checks below these transition points. Result-contributing work and host effects must not ignore closure.

Implement one common guarded-resumption shape: if `execution.fatalError !== null`, return; otherwise perform shared settlement, then apply the ordinary local-owner check before operation-specific work. Public entry and the existing exact supported-host wrapper use the same direct field check at their boundaries; Phase 9D-A replaces that wrapper with final `runHostBoundary`, which owns the check thereafter. Do not introduce a separate post-host helper, subscription, listener, cancellation token, fatal-cleanup callback, or configurable guard policy.

After closure:

- start no new operation or supported host work;
- a component that detects the fatal submits and propagates the authoritative Error to unwind its current call or Promise reaction;
- a later continuation checks fatal state first and returns without settlement, cleanup, or operation-specific work; and
- no private publication or host effect occurs after that check.

Keep the detector/observer distinction explicit. A detecting Promise reaction must not commit fatality and then fulfill successfully with `undefined`; doing so would make every downstream consumer responsible for distinguishing swallowed failure from a real successful `undefined`. Propagating the authoritative rejection is native structured control transfer. Check-and-return belongs to later resumptions that observe the already-closed execution.

Remove the earlier Phase 7E rule that an asynchronous fatal must first close its local owner. `commitFatal` commits synchronously before the failure can reach an aggregate, so the execution check already stops every late sibling. Audit query contexts and the current `observeFatal` and `run` paths so a detecting transition immediately submits and propagates the authoritative Error, while a later resumption that sees `fatalError` simply returns. Normal, language-Error, and live-execution local completion still close normally.

Audit every existing kernel-owned Promise that may reject before its semantic consumer attaches: internal continuations and aggregates, gates, cleanup Promises, and the derived reaction used to bridge a core result into its public wrapper. A real consumer handles its source Promise, but any derived Promise it creates must itself be returned, owned, or marked handled. Keep or introduce a named `markPromiseHandled` helper only if at least two actual producer sites need that exact operation; otherwise perform the exact ownership action at its sole site rather than naming a general mechanism. Do not observe unused host input or change publication. Phase 9E applies the same rule to its new external phase Promises; Phase 9D-C separately inventories every Promise producer and fulfillment path affected when poison becomes thenable.

Do not register any internal wait, gate, phase, aggregate, or detached Promise for fatal delivery. Common continuation helpers check execution fatal state first. On fatal they simply return without inspecting the settlement payload. In a live execution they perform required shared settlement and then apply the ordinary `owner.open` check. A never-settling source Promise is not cancelled or awaited; its continuation may remain pending indefinitely. Every execution-bound public API operation whose direct result is waiting on it has its separate public-result rejection action.

Do not add fatal-specific settlement for private gates, external phases, or aggregates. If their blocker settles, they reach the same execution check and stop before publication or host work. If it never settles, they may remain pending. Fatal is never installed as graph data or repairable phase poison.

Implement one explicitly sync-first `exposeResultOrFatal(execution, result)` helper in the package's host-facing facade. Thin exported wrappers perform the public-entry check, call the unchanged core operation, let it complete boundary-specific processing, and pass only its classified direct result to the helper. Internal modules import core operations directly, so they never wrap an intermediate result; add no public/internal flag. The helper receives either a ready semantic result or the operation's kernel-owned native direct Promise; any ready Error at this point is already classified language poison. It performs no custom-thenable sampling and no second synchronous fatal check: if the operation returned, every possible synchronous detector already propagated, and asynchronous work cannot interleave before registration completes. It recognizes Error before Promise and returns a ready result directly.

For a direct Promise, construct one native public wrapper and one idempotent fatal reject action. Register that action in the execution's pending-public-result Set and attach guarded intrinsic fulfillment and rejection reactions to the source in the same hook-free transition. Either normal source outcome deletes the action before settling the wrapper with the already classified result; fatal commit rejects the wrapper and clears its action. Own or immediately handle any derived reaction Promise. The helper accepts no operation owner, resource cleanup, result mode, or boundary-specific option. Registration performs no task cancellation, owner closure, dependency walk, or resource notification; ordinary internal checkpoints stop later work. Thus fatal fails every pending public result even behind a never-settling dependency without adding a wrapper, registration, or microtask to synchronous or immediate non-blocking returns.

Do not replace this with one permanently pending shared fatal Promise. A settled `Promise.race` cannot detach its losing fatal reaction, so one long-lived execution would retain historical reactions and potentially their result values without bound. Do not retreat to a root-only race either: package-level public operations are independently observable and must fail promptly. The Set contains only currently pending outward obligations and is not an operation, task, owner, cleanup, or cancellation registry.

Use `src/index.js` as that facade unless an actual module cycle requires a tiny dedicated facade module; do not create a wrapper layer speculatively. Keep the public-entry `fatalError` checks visible in the wrappers instead of adding a configurable public-operation runner.

Audit the package export manifest as the coverage source, not a hand-maintained subset of call sites:

- thin facade wrappers cover public `import`, `lookupPath`, `export`, `hasError`, `getErrors`, `run`, `enter`, `assignPath`, and `deletePath`;
- exported `Chain` and `ContextChain` construction perform the entry check but add no final recheck or Promise because construction is one hook-free non-blocking transition;
- `externalState`, `managedState`, and `managedStateClass` stay on their contextless synchronous configuration path; and
- exported Error classes, predicates/constants, and `Execution` configuration are not semantic operation-result boundaries.

Phase 12 may add one documented trusted integration subpath containing the same unwrapped core operations for Cascada. It is not another implementation or dynamic mode; its calls register no outward results, and the higher runtime must not expose it as its host API.

No package-exported execution operation may bypass this inventory. The standing package/result-exposure inventory in the Method section reads the actual export surface and fails when a new public operation is added without an explicit classification in this list.

Do not add an execution-idle counter, quiescence barrier, operation-owner registry, internal-work listener set, or general task registry. The narrow Set of currently pending public-result reject actions is the fatal delivery mechanism required by the public contract; it contains no operation work or release callbacks. Do not interrupt synchronous JavaScript, cancel native Promises, settle gates or phases for shutdown, or undo completed host effects. Fatal-capable continuations report directly through `commitFatal` even after their originating owner closes.

Apply the standing Promise-production inventory to every `.then`, Promise constructor/resolver, FIFO registration, aggregate continuation, and callback stored for later execution. Each asynchronous callback must be exactly one of:

- an operation transition entering the common execution check before semantic work;
- a custom-thenable settlement callback that checks the same execution before recording first settlement;
- the no-op ownership handler for a kernel-owned Promise;
- or the guarded intrinsic reactions installed by the one public-result wrapper.

Promise executors that only capture a resolver are synchronous construction, not later work. No other callback may publish graph state, invoke host code, allocate operation resources, or dispatch scheduler work after fatality. Keep the source inventory and its semantic classification manifest in CI with representative route tests; discovery by `rg` alone is not conformance, and no runtime registry is added.

Diagnostic formatting remains above the kernel. It may inspect opaque source data and cause stacks only outside graph transitions and under `try`/`catch`. Formatter or reporter failure cannot replace the stored Error or execution outcome. The reporter used here is the execution's immutable captured reporter, not mutable global routing.

### Verification

- `RuntimeError` directly extends native `Error`, is branded, immutable, and non-thenable, and no longer uses the transitional `CascadaError` base. Existing fatal instances are submitted unchanged to each receiving execution, whose earlier fatal Error remains authoritative. Transitional poison remains recoverable only when a language-outcome continuation recognizes it; poison escaping runtime-only work becomes the exact cause of a new `RuntimeError`. Phase 9D-A owns the one final poison/base-class cutover.
- `RuntimeError.prototype` is frozen with its own non-callable `then`; later `Error.prototype` mutation cannot make a fatal Error assimilable.
- The protected `RuntimeError` constructor rejects public construction without the private token. The standing Error-construction inventory proves that every trusted fatal factory path supplies a source; do not test malformed internal calls as a supported runtime path. Phase 9D-A extends the same construction pattern and the authoritative kind inventory to poison.
- Runtime-only synchronous and asynchronous envelopes attribute every escaping failure to the causing operation and propagate the execution's first fatal outcome. `runContextlessFatal` uses the sentinel, closes no execution, reports nowhere, and throws synchronously; later submission of the same Error to an execution is reported there.
- Fatal state and rejection of currently pending public wrappers commit before reporting. One occurrence reports once through its execution's captured reporter, later candidates cannot replace it, and the same occurrence closes and reports independently through another execution's reporter.
- Public entry, guarded continuations, host-boundary exit, and scheduler dispatch observe the same nullable `fatalError` value; result exposure needs no redundant final check after a core operation returns.
- Closure starts no new graph, operation, or host work. A resumed continuation checks fatal first and simply returns before settlement, cleanup, or publication.
- Operation owners remain local and never register with the execution or retain a fatal-reject action.
- `commitFatal` stores one Error, rejects and clears only current pending public wrappers, reports, and walks no internal task, gate, phase, aggregate, or owner. The public `Execution` surface exposes only the read-only query; assignment cannot clear or replace the stored outcome, and no fatal commit or registration operation is package-exported.
- Every pending execution-bound public API operation result rejects with the exact authoritative Error. Each direct Promise has exactly one rejection action while pending and none after settlement; one long-lived execution retains no historical public-result reaction or value graph. A ready-only execution, ready result, and immediate non-blocking return allocate no public wrapper, Set entry, or microtask for fatal observation. Contextless host-configuration APIs stay synchronous and are not part of an execution shutdown.
- A fatal discovered after any successful public-result delivery is stored in `execution.fatalError`, reported once by that execution, and closes remaining work without changing the delivered result; it may still make that result's trustworthiness unknown. Reading `null` before remaining work finishes is not a success guarantee.
- A fatal from unrelated work rejects every pending public result even when an internal normal input never settles. That internal operation may remain pending; if it later resumes, it stops at the common check.
- Closing a local owner inside a live execution stops its operation-only work without cancelling required shared settlement or preventing a later fatal report; a failed execution skips both.
- Fatal detection and observation invoke no local-owner `close()`, registered release, gate/phase completion, or scheduler/buffer sweep. A direct field check and return are the only internal cancellation behavior; rejecting pending public wrappers is result delivery, not internal cancellation.
- Two concurrent executions use their independently captured reporters without cross-routing. A synchronous reporter throw cannot replace the first fatal outcome; reporter return thenability is not inspected, reporter re-entry sees the committed non-null `fatalError`, and absence of a reporter never causes an asynchronous global throw.
- The test harness, direct-construction tests, refcount verifier, and subprocess fixtures pass reporters through `Execution` construction. No test-only global setter, reset, or mutable forwarding route conceals the production ownership rule.
- Every existing kernel-owned Promise category in the audit is handled without observing unused host input; every derived Promise is returned, owned, or handled.
- No competing or mutable-global reporter, fatal state, cancellation framework, fatal-only terminal state, owner registry, idle counter, quiescence barrier, or general task registry remains.

Add route-matrix tests for already-failed public entry, every execution-bound public API operation's ready and pending result, immediate non-blocking returns, common resumption after fatal before any later effect, custom-thenable settlement after fatal, host-boundary-exit re-entry failure, fire-and-register operations, fatal state behind an installed gate, a never-settling internal dependency, a trusted language-outcome callback rejecting poison, and a runtime-only callback throwing the same poison. On one long-lived execution, settle many public results and verify the pending-result Set returns to empty after each wave; keep one result pending, fail the execution, and verify it rejects promptly and the Set clears without touching its source Promise. Verify separately that contextless host-configuration calls stay synchronous and do not acquire execution state. For every live-execution terminal path changed by the lifecycle consolidation, assert that the local owner is closed, its release set is empty, and every acquired lease is balanced on success, language Error, supported boundary failure, and early sibling completion. Do not use a global `afterEach` quiescence assertion or test-wide owner registry: pending operations can be legitimate, and fatal execution deliberately performs no internal cleanup walk. Phase 12 applies the same result matrix to Cascada's public operations, including script completion.

Update [`AGENTS.md`](../AGENTS.md), [`error-handling.md`](error-handling.md), [`runtime-spec.md`](runtime-spec.md), operation-lifecycle documentation, diagnostics, public fatal-reporting documentation, and the higher runtime's consumption of the exposed execution fatal outcome.

---

## Phase 9D-A: Establish causal recoverable Error handling

### Problem

Phase 9B carries the final operation context to every boundary, and Phase 9C provides one authoritative fatal lane. Recoverable Error attribution, Promise behavior, and boundary handling still use the transitional model.

### Outcome

Implement causal recoverable Error handling from [`error-handling.md`](error-handling.md). The exact causal boundary supplies a recoverable failure's source and kind; later consumers preserve it. Install source-neutral custom-thenable settlement and causal placement/import behavior while poison remains non-thenable. Phase 9D-B removes the re-entry restriction; Phase 9D-C then performs the rejecting-thenable cutover. Every internal failure continues through Phase 9C's fatal lane.

This phase uses two recurring terms:

- A **causal boundary** is the exact supported action allowed to convert its raw failure into recoverable poison.
- A **causal occurrence** is one boundary-position contextualization of a raw failure. Later retention and propagation preserve that wrapper; another causal boundary creates another occurrence.

Boundary and consumer are roles of actions, not modules. One import, lookup, export, or invocation may consume an existing Error in one step and cause a new failure at another causal boundary.

### 1. Install final recoverable Error attribution

Use these concrete native-Error branches:

~~~text
Error
|- PoisonError
|  `- CompoundPoisonError
`- RuntimeError
~~~

- `PoisonError` is recoverable language data and a direct native Error. It remains non-thenable at this phase boundary; Phase 9D-C adds its final sync-first rejecting `then` only after every internal fulfillment path is safe.
- `CompoundPoisonError` contains flattened poison leaves.
- Phase 9C's `RuntimeError` remains the separate fatal branch and is never admitted, combined, queried, repaired, or returned as language data.
- Complete the hierarchy once: remove transitional runtime `CascadaError` and its public export, make `PoisonError` extend native `Error` directly, and keep Phase 9C's direct `RuntimeError`. Semantic classification checks the recoverable and fatal branches directly.

Create runtime Errors only through factories in `error.js`. Reuse Phase 9C's module-private construction token, brand, and finalization pattern for the two exported poison classes; `instanceof` or prototype shape alone is not trusted. Direct public construction fails as host API misuse, and a public subclass cannot obtain the token. The token check is the only construction-time validation. Internal factories trust their compiler/runtime-supplied kind and source. Each factory installs all concrete-subclass fields before invoking one private finalizer. That finalizer freezes the complete wrapper; compound child arrays are copied and frozen first, and `errorContext` is an immutable opaque handle or value. Freeze each concrete prototype only after its final methods are installed; Phase 9D-C performs the poison-prototype freeze when it adds `then`. Do not copy methods onto instances or add recurring prototype-integrity checks. The exact cause identity remains diagnostic-only and outside graph traversal; later mutation of that external cause cannot replace the wrapper's cause reference or change its stored message, source, or classification. Do not copy arbitrary enumerable cause properties or eagerly read a cause stack into the wrapper. The protected diagnostic adapter may inspect the exact cause later.

Settle the kernel Error surface in this phase, before instances are frozen. Kernel Errors expose `name`, unformatted `message`, opaque `errorContext`, optional exact `cause`, `kind` on poison, and `.errors` only on `CompoundPoisonError`. They do not expose Cascada's legacy `_errorContext`, expanded `context`, `fullMessage`, `totalErrorCount`, `kinds`, `getInfo`, line, column, path, or label fields. Phase 12 must provide source formatting and compatibility presentation, if desired by an application, as a separate immutable diagnostic view; it never decorates the frozen kernel Error. This is a deliberate API cutover, not a deferred decision.

Recognize every native Error form before sampling `then`. Use precise `isPoisonError`, `isRuntimeError`, and native `Error.isError`; remove semantic `isError`, which conflates unclassified native Errors with admitted poison. Guard thenability with native Error recognition: a native Error remains an Error even when it has a callable or throwing `then`, which is never read. Declaration APIs likewise preserve an Error before probing thenability. Both packages target Node `>=24`, and supported browsers must provide native `Error.isError`, so 9D-A uses and tests the exact native predicate without an approximation. Phase 12 applies and verifies that settled platform contract in Cascada.

Every poison call site supplies a `kind` from the authoritative table in `error-handling.md` and an operation source. Export one frozen `ERROR_KIND` vocabulary:

- Implement exactly the complete table in `error-handling.md`; implementation-only kinds are invalid.
- Rename transport-specific pairs to `ChainValueFailed`, `ContextValueFailed`, `AssignmentValueFailed`, and `OperationInputFailed`, and rename one-to-one `...Threw` kinds to their action-based `...Failed` replacements.
- Use `InvalidCallbackResult` for every unsupported controlled-callback result, including a Promise where a synchronous result is required.
- Treat `UserCallThrew` as a semantic split, never a rename or compatibility alias: audit every former call site and use `HostCallFailed` for the selected host Function or method and its direct result boundary, or `ControlledCallbackFailed` for a callback or comparator owned by a controlled operation. Also distinguish invalid export values (`InvalidExportValue`) from reflection failure (`ExportReflectionFailed`).
- Use PascalCase keys equal to their string values. Verify trusted construction and forwarding paths through the standing Error-construction inventory rather than runtime membership checks. `Multiple` is only the compound meta-kind; no empty, arbitrary, or generic fallback is valid.
- A kind names the violated semantic contract, while the opaque source identifies its exact occurrence. Preserve a distinction when contract, graph/result effect, recovery meaning, or materially useful diagnosis differs; collapse transport or implementation-mechanism splits when those facts are the same. Do not merge import, lookup, query, and export reflection merely because reflection was their physical mechanism.
- Messages remain separate from kind and source.

Arrival mode is not structured Error data. Preserve the exact cause, but never record or infer whether it arrived by return, throw, fulfillment, or rejection. Equivalent ready and pending failures use the same kind and graph effect.

Contextualize a native host Error once per causal boundary:

- Wrap it in a new `PoisonError` with the exact native Error as `cause`.
- Invoke no host hook while contextualizing: use fixed text or safely read own primitive diagnostic data, and never coerce the Error, inspect arbitrary properties, sample `then`, or require its stack. Copy no cause properties onto the wrapper.
- Preserve an existing poison unchanged. Submit an existing `RuntimeError` unchanged to the current execution and propagate its authoritative fatal Error.
- During one boundary identity walk, stage the first raw-Error wrapper in that walk's identity map and reuse it at every aliased occurrence. Reusing the raw Error at another causal boundary creates another occurrence wrapper.
- A root import returns its occurrence wrapper. A nested import leaves host storage unchanged and stores the shared wrapper as each aliased parent-key placement's fixed logical version.
- Store no wrapper on the native Error identity and keep no execution-wide Error-keyed cache.

`combineErrors` accepts only contextualized poison and no execution or context:

1. Require at least one input; zero is a fatal invariant failure.
2. Flatten nested compounds.
3. Preserve caller-defined logical order.
4. Deduplicate exact leaf identity only. Different occurrence wrappers remain distinct even when they share one object, Function, Symbol, or primitive cause.
5. Return the original leaf when only one remains; otherwise create `CompoundPoisonError`.

The compound exposes all surviving leaves through its frozen `.errors`. Its primary context is the first leaf's source, and `.kind` is their sole common kind or `ERROR_KIND.Multiple`. Collection order is semantic. Distinct kinds are a diagnostic projection derived from the leaves rather than duplicated as `.kinds` state. Its caller-supplied message names the failed boundary without enumerating children. Diagnostic presentation may group a separate view by cause identity but cannot change semantic occurrences.

### 2. Classify only at causal boundaries

Every boundary uses this funnel:

~~~text
existing RuntimeError        -> submit unchanged; propagate the execution's authoritative fatal Error
existing poison              -> preserve unchanged
native Error consumed as data -> wrap this causal occurrence
expected supported-host failure -> create PoisonError here
other raw failure            -> create RuntimeError and fail the execution
successful value             -> continue
~~~

A direct Error always means its boundary failed; it is not a successful payload. A native Error is contextualized once and an existing poison is preserved. A mutating call applies the same receiver-failure effect whether the Error is returned, fulfilled, thrown, or rejected. An Error reached later through an independent nested result remains independent.

Apply this classification before success handling regardless of JavaScript transport. A non-thenable `RuntimeError` may physically arrive as a ready return, Promise fulfillment, throw, rejection, or nested imported value; submit it to the current execution unchanged and never admit it as language data.

Make the common post-boundary ready-admission choke point enforce the resulting invariant: an Error reaching ordinary graph admission is already branded poison. Submit `RuntimeError` through the fatal lane, and treat any remaining raw native Error as a fatal missed-boundary defect rather than admitting it as generic Error metadata. Boundary-specific import walking may inspect a raw Error only long enough to create its occurrence wrapper before entering this choke point. Test ready, fulfilled, nested, imported, assigned, and host-result routes so no inbound path can bypass contextualization.

Replace `runUserCode`, `UserCodeFailure`, `catchUserCodeFailure`, and `catchRawUserCodeFailure` with one private `runHostBoundary(operationContext, kind, action)`. Its `try` contains only the exact synchronous host action. On either return or throw, it first checks `operationContext.execution.fatalError`; if synchronous nested work already closed that execution, it throws the authoritative Error without inspecting the host outcome. Otherwise a thrown reason or ready Error result is handled outside the action's `try`: an existing `RuntimeError` is submitted and the authoritative fatal outcome is thrown, existing poison is returned unchanged, and another reason becomes a new poison occurrence. The causal caller therefore sees only success or poison and applies that boundary's graph or result effect outside the catch. A failure in contextualization or failure application escapes to the surrounding runtime-only transition and is fatal. The helper has no callback, recoverable/fatal flag, or preparation, export, import, publication, bookkeeping, or cleanup behavior. It owns the post-host check; do not add a second helper or caller check. A lower-level effectful primitive does not catch; its causal caller wraps only the primitive invocation. Application callbacks and effectful host reflection use this boundary. A captured built-in is runtime-owned only on runtime-owned, hook-free inputs; applying it where a Proxy or host trap may run is supported host code. “Native code” alone is not a recoverable category. Keep the runtime-wide re-entry guard until Phase 9D-B so this phase changes Error semantics without also changing nested execution.

Do not force conservative probes through `runHostBoundary`. Complete the two explicit replacements exposed when `catchRawUserCodeFailure` is deleted:

- Execution-bound admission classification catches only its exact structural reflection probe. An ordinary host-reflection failure yields the existing `{ type: external }` fallback rather than poison. After either return or throw, a newly committed `execution.fatalError` wins; an existing `RuntimeError` is submitted normally. Pass the operation context required for that check instead of retaining a context-free admission-classification path.
- Contextless declaration thenability sampling uses one operation-local identity cache. Preserve an Error before sampling; cache a callable/non-callable result once per reached identity. A nonfatal throw from the getter returns an ordinary declaration-validation Error and atomically records no declarations; an escaping `RuntimeError` remains the contextless fatal outcome. The probe creates no fake rejecting thenable, Promise, poison, kind, operation context, or persistent thenability state.

These probes share only the principle that inability to establish a fact has a statically specified conservative result. Their result shapes and execution invariants differ, so keep the exact catch with each probe. Do not add `tryHostAction`, a result algebra, callback, fallback mode, or optional-context overload to generalize them. Audit any other `catchRawUserCodeFailure` caller: move an observable supported-host failure to `runHostBoundary`, but retain an explicitly specified conservative probe as a local catch.

Audit every existing `throw` site as well as every `catch` and rejection handler that classifies or recovers from failure. A raw internal throw must be assigned to the exact envelope that receives it and classified against the same rule; do not assume that existing `throw new Error(...)` means fatal merely because no catch currently narrows it. Expectedness belongs to the transition contract, not the Error class. The one common continuation helper handles only execution and local lifetime; each transition body handles its Error semantics explicitly. Do not create parallel language/fatal continuation frameworks or one configurable policy helper. Each surviving catch has exactly one of these roles:

1. `runHostBoundary` catches the exact supported synchronous host action, performs the one fatal check at action exit, and then preserves or contextualizes its reason; its causal caller applies the boundary's graph effect outside the catch.
2. A language-outcome transition body preserves an expected ready or rejected poison and performs publication, complete collection, or public-result handling.
3. A runtime-only envelope submits an existing `RuntimeError` unchanged or makes every other escaping value, including poison, the cause of a new fatal Error.
4. After fatal state commits, the reporter catch preserves it. Local release uses ordinary `try`/`finally` only to clear live-operation state; a release failure escapes to the runtime-fatal envelope rather than being swallowed or reclassified.
5. An explicitly specified conservative probe catch returns only that probe's indeterminate or validation outcome. It creates no poison and never hides an existing or newly committed runtime fatality.

Remove `continueResult`, `continueInitial`, `continueInternal`, `continuePrepared`, `continueInternalAll`, `continuePreparedAll`, `resolveInitial`, and `closeWhenDone` as lifecycle-layer variants. In `resolution.js`, remove `observeResultPromise` and replace `continueInternalPromiseOrFatal` with the same one guarded operation-transition registration used everywhere else. Keep initial value admission and later property-version advancement as separately named semantic bodies because only the first classifies a raw rejection; graph-Error publication and complete required-input collection likewise remain explicit semantic bodies. They may all use the common registration entry, but they are not modes or options of it. The transition that determines an operation's outcome closes its owner directly before exposing that outcome; no settlement observer is needed solely to detect fatality or close it.

Remove or narrow every classification catch outside these roles. Expected synchronous language Errors normally return as values. An exact adapter may deliberately throw poison only where a native API requires throwing to abort, and its owner catches that escape before the runtime-only envelope. A rejection handler used only for Promise ownership does not classify failure. Do not add a Boolean "poison allowed" flag or a second continuation family.

For each trusted callback, document whether its result admits a language Error. If it does, direct poison and direct-Promise poison rejection are the same recoverable outcome; if it does not, poison throw or rejection is fatal. In particular, update `enter`: a synchronous throw from its trusted callback remains fatal, while a returned poison and poison rejection from a callback result whose contract admits language Error follow the same entry completion/publication behavior. JavaScript cannot infer whether a poison rejection in such an admitted channel was intentional, so do not add a sideband intent marker solely for that distinction.

Invalid host output is recoverable when the boundary can reject it without compromising runtime invariants, such as an unsupported callback result or invalid completed managed receiver. In particular, if managed-class member selection detects that an admitted prototype now contains an accessor before invoking it or publishing state, return `InvalidManagedReceiver` and preserve the original receiver; the forbidden prototype change is not by itself fatal while the runtime can reject it safely. Host behavior is fatal when it has already made runtime state, ownership, ordering, publication, or cleanup untrustworthy.

Make query-reflection failure an explicit query-operation outcome. Wrap each exact effectful reflection action with `runHostBoundary(..., QueryReflectionFailed, action)` rather than catching the whole traversal. Bubble the returned poison through the query body, close its local owner, and discard any partially collected query-only set; do not call `found`, convert it to Boolean, append it to `getErrors`, or throw it through the runtime-only envelope. A ready query returns it directly. While poison remains non-thenable in 9D-A, the existing language-outcome Promise reaction deliberately rejects the direct query Promise with that poison outside the runtime-only catch; after 9D-C, returning the thenable poison has the same rejection result and the transitional rejection adapter is removed. Add no query-result wrapper or general result algebra.

A direct Promise returned by supported host code settles after the synchronous envelope. Its first existing boundary continuation captures the context and kind when the Promise is accepted and converts a raw rejection when it runs. The operation's existing returned Promise carries that outcome. Do not recreate the host envelope, persist attribution on the source Promise or its metadata, or allocate an attribution-only Promise.

Use this inventory for every kind emitted by the graph kernel before Phases 9E-10. The higher-runtime names reserved in [`error-handling.md`](error-handling.md) remain in `ERROR_KIND` but have no kernel boundary row:

| Causal boundary | Source | Kind |
| --- | --- | --- |
| Throwing `then` getter on first sample | Sampling operation | `ThenAccessFailed` |
| Synchronous failure invoking captured `then` | Custom thenable: operation creating its settlement Promise; native Promise: registering operation | `ThenInvocationFailed` |
| Self or mutual custom-thenable assimilation cycle | Introducing boundary that detects the active-path repetition | `ThenableCycle` |
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
| Host call throw, returned Error, direct rejection, or nested returned failure | Invocation operation | `HostCallFailed` |
| Controlled callback or comparator throw, returned Error, or poison rejection | Owning controlled operation | `ControlledCallbackFailed` |
| Unsupported controlled-callback result | Owning controlled operation | `InvalidCallbackResult` |
| Value forbidden at export | Export operation | `InvalidExportValue` |
| Supported reflection failure during export | Export operation | `ExportReflectionFailed` |
| Invalid completed managed receiver | Managed mutation | `InvalidManagedReceiver` |
| Supported scalar-conversion hook failure | Conversion operation | `ScalarConversionFailed` |
| Supported property reflection, write, or commit failure | Property mutation operation | `PropertyMutationFailed` |
| Unsupported property shape or placement | Property-consuming operation | `PropertyValidation` |
| Invalid Array length | Array-length assignment | `InvalidArrayLength` |
| Invalid or unsupported controlled Array mode or result | Array invocation operation | `InvalidArrayOperation` |
| Unsupported value at an import boundary | Import operation | `InvalidImportValue` |
| Receiver category does not support the requested mutation | Invocation operation | `UnsupportedMutation` |
| Trusted runtime callback whose result contract admits no poison throws or rejects, including with poison | Owning operation | fatal `RuntimeError` |
| Internal query traversal, refcount, mirror, publication, gate, cleanup, or other runtime-only failure | Failing operation | fatal `RuntimeError` |

An absent intermediate placement reads as `undefined` and therefore produces `NullLookup` when traversed. A missing method remains distinct from a present non-callable method. Conservative metadata and declaration probes emit no poison kind and are intentionally absent from this causal-boundary inventory. Phases 9E-10 implement the external-operation and Promise-path kinds already reserved by the authoritative architecture table; they do not add unreviewed implementation-only kinds.

### 3. Preserve origin through deferred work

Every captured thenable's cached settlement Promise carries only its private non-thenable raw first-settlement record. Its callbacks first return when the execution is already fatal; otherwise they record first settlement. The kernel invokes the captured method once and never uses the returned derived Promise as FIFO or settlement state. It does not recursively process the raw result and carries no consumer source. Each causal boundary registers a continuation whose closure captures its operation context and interprets the record; later non-boundary consumers preserve its contextualized outcome. Use one hook-free contextualization primitive for ready native Errors, synchronous host-action throws caught by `runHostBoundary`, and raw boundary-Promise rejections.

- Import-created root and nested Promises use the import operation.
- A pending Chain root installs its exact initial property version and Promise mirror during Chain initialization.
- Assigned Promises use the assignment operation.
- A direct host result and Promises admitted inside it use the invocation operation.
- A copied or derived pending placement gets a fresh mirror at its own FIFO position but preserves the source mirror's eventual contextualized Error.
- A later consumer supplies context only for a new failure it causes.

Do not retain Chain initialization context as a fallback. Different operations on one Chain may therefore produce Errors with different sources. Capture the originating operation context and kind only in the first existing continuation or boundary work that may still create a new Error. Store neither on the source Promise, its identity metadata, the Chain, a property version, or a mirror. After success they are discarded; after failure the contextualized Error carries them. Shared settlement is source-neutral.

This prohibition removes only sideband attribution. Keep state with another purpose: a mirror's current logical value, fixed imported-Error placement versions, poison held outside thenable fulfillment during complete collection, `execution.fatalError`, and the execution's thenability cache. A contextualized Error stored as a logical placement value carries its own attribution; the placement or mirror carries no separate source or kind.

Do not add `valueWithOrigin`, a forwarding Promise used only for attribution, Promise subclass, overridden chaining method, parallel continuation system, or runtime-wide Promise brand. Contextualize in the first import, mirror, validation, or publication continuation the boundary already needs. A direct result flows through the Promise returned by that continuation; a placement continuation uses FIFO readiness and reads the logical value published by the earlier resolver instead of interpreting the raw payload again.

An existing contextualized poison rejection normally propagates unchanged. Intercept it only for a different semantic transition:

- **Graph publication:** publish the Error as the placement's logical value, then reject the operation with that exact Error.
- **Complete independent-input collection:** record every poison outside the aggregate Promise and fulfill internal branches with non-thenable readiness values. An unclassified raw rejection reaching the collector, or a fatal rejection, still fails immediately.

Delete helpers whose only purpose is converting every poison rejection into fulfillment. Keep separate helpers for publication and complete collection only when they remove duplication; do not replace them with flags, a shared result wrapper, or a configurable continuation path. The custom-thenable first-settlement record remains private to assimilation.

Thenability acquisition and assimilation are execution-local:

- Sample `then` at most once per identity in one execution. A throwing getter uses the first sampling operation.
- Create one cached settlement Promise and invoke every captured `then`, including intrinsic `Promise.prototype.then`, only with callbacks that fulfill it with a hook-free record equivalent to `{ fulfilled, value }` or `{ rejected, reason }`. Never pass an arbitrary thenable a native Promise resolver, and never use the object returned by `then` as kernel state.
- Calling intrinsic `then` on a Promise subclass or an instance with an own `constructor` may invoke host-controlled `Symbol.species` and produce a host-controlled derived Promise. Treat synchronous acquisition, species, and invocation failure as `ThenInvocationFailed`, ignore the derived result for kernel ordering, and own or handle any kernel-derived reaction as required. Native assimilation precedes fulfillment, so classify a fulfilled Error but do not resample native fulfillment thenability.
- A throw before first settlement uses the operation creating the settlement Promise and becomes its already contextualized rejection. Ignore a throw or callback after settlement; keep no duplicate failure or attribution field beside the cached Promise.
- Each causal boundary that introduced the thenable interprets the record in a continuation that captures its operation context. The same raw rejection is contextualized independently at each introducing boundary; a later non-boundary consumer receives the existing Error. Fulfillment recognizes every Error form first; only a non-native thenable then consumes a nested thenable through execution-local capture using that boundary context before continuing.
- Each boundary assimilation keeps an active-path identity set. Encountering an identity already active on that path produces `ThenableCycle` at the introducing boundary. Remove identities when their nested assimilation finishes so aliases and later noncyclic reuse are not rejected. Cover self-cycles, mutual cycles, repeated callbacks, and settle-then-throw behavior.
- The settlement record never escapes the continuation mechanism. Successful invocation retains neither the callable nor its operation context. A failed sample retains its contextualized rejecting state for that execution.
- Declaration probes remain contextless, raw, and operation-local. They cache only the facts needed by that declaration; a failed `then` read produces ordinary declaration validation rather than a rejecting capture.

Observe only Promises consumed or owned by supported kernel work. Mark kernel-owned Promises handled when their consumer may attach later, without replacing them. Do not recursively observe unused host input; discarded-expression handling remains a higher-runtime responsibility.

Preserve `hostValidationError` for contextless public host-configuration validation, including a declaration whose `then` property cannot be inspected safely. It returns an ordinary host API Error and does not enter the language Error or execution-fatal funnels.

### 4. Reuse placement versions and keep import atomic

Use the existing parent-key `meta.placementVersions` map; do not introduce another Error or Promise overlay store:

- Promise mirrors and fixed imported-Error overlays already share logical read, replacement, detachment, and captured-version behavior. Finish causal Error migration through this common path.
- Promise continuation and settlement remain Promise-specific.
- Initialization, assignment, import, copy, and retained results install versions in the selected execution.
- An initial Promise resolver contextualizes its raw rejection once; derived versions preserve the source mirror's published Error.
- `language-properties.js` reads the live version before physical storage and no longer derives Error source from import origin.

Keep import as one function-based staged identity walk per synchronous segment:

- Stage admissions, origins, retentions, Promise placements, fixed Error versions, raw-Error occurrence wrappers, and external-tree leaves; commit only after the whole segment validates. The staging identity map reuses one wrapper for every alias to the same raw Error in that segment.
- A failed segment commits none of them. Promise fulfillment starts a fresh segment.
- Keep external-tree discovery as a separate occurrence walk: admission deduplicates identities, while tree construction must preserve every finite alias path. The two walks still commit atomically.
- Do not add an `ImportTransaction` class.

Delete in this phase:

- `valueWithOrigin`;
- attribution-only Promise paths and transport-specific Error kinds;
- generic source strings and the imported-at message suffix;
- catches that merely forward or reclassify failures outside the roles defined by `error-handling.md`.

### Verification

- `PoisonError`, `CompoundPoisonError`, and `RuntimeError` now have the final direct native-Error hierarchy, with `RuntimeError` retained from Phase 9C and the transitional runtime `CascadaError` removed exactly once here. Poison remains non-thenable until Phase 9D-C.
- Every Error form precedes thenability inspection, including hostile Error values with throwing `then` properties. Precise predicates distinguish raw native Error, poison, and fatal state, and the chosen native-Error predicate passes the supported Node/browser matrix.
- Every poison has a stable defined source and nonempty kind. Ready and pending forms of one failure use the same kind; later consumers preserve both.
- Arrival mode creates no structured field or transport-specific kind. Equivalent returned, thrown, fulfilled, and rejected failures retain one contract-based classification.
- Aliases to one raw native Error in a single causal-boundary identity walk receive one occurrence wrapper and remain aliases. Reusing that raw Error at two boundaries creates two wrappers. Propagating and combining preserve both; only aliases to the exact same wrapper deduplicate.
- Contextualization invokes no host hook and copies no cause property onto the wrapper.
- Raw import, assignment, and host-result rejections use their introducing boundary. Shared settlement and copied mirrors never substitute the consumer that advances them.
- Native Promises and custom thenables use one source-neutral, non-assimilating settlement record per execution. A native Promise subclass or own `constructor` may run species construction, but its returned derived Promise never controls kernel FIFO or settlement. Each introducing boundary supplies its own context while later consumers preserve the resulting Error; active-path detection terminates self and mutual cycles without rejecting later noncyclic reuse.
- Root and nested imported native Errors receive occurrence wrappers without modifying host storage. One import segment preserves raw-Error aliases through its staging identity map. Failed import commits nothing, and the existing placement-version map owns fixed overlays.
- Direct Error transport has one causal and graph effect whether returned, fulfilled, thrown, or rejected. Internal failures retain Phase 9C's fatal behavior.
- Every raw `throw` site and every failure-classifying or recovery catch has one documented boundary classification; catches outside the allowed roles are removed or narrowed. Safely detected invalid managed prototype shape is recoverable before invocation, while a throw after invariants become untrustworthy is fatal. One common continuation path handles execution and local lifetime, while each transition body explicitly consumes expected poison or lets an unexpected escape become fatal. A callback result contract that admits poison treats ready and rejected poison equivalently. Boundary policy is assigned per action rather than per module, and “native code” alone grants no recoverable boundary.
- Admission classification preserves an uninspectable exact identity as external without constructing poison, while a fatal established during its reflection still wins. Contextless declaration thenability is sampled once per identity; an unreadable `then` returns ordinary validation and creates no synthetic thenable or persistent state. Neither probe generalizes `runHostBoundary`.
- Probe tests cover a classification Proxy trap throwing an ordinary value or an existing `RuntimeError`; only the ordinary failure falls back to the exact opaque identity. Declaration tests cover alias deduplication, a throwing `then` getter, atomic no-declaration failure, and an Error with hostile `then`; they observe no execution, poison kind, Promise, second getter read, or persistent capture. Phase 9D-B adds the nested-fatal post-probe case once synchronous re-entry is allowed.
- The authoritative causal kind inventory covers every kind emitted by the graph kernel and contains no transport-named or implementation-only additions; higher-runtime reservations remain unmodified, and `hostValidationError` remains the explicit contextless host-configuration path.
- Completed runtime Error wrappers are frozen and compounds expose copied frozen arrays. Public code cannot forge runtime source or kind. The kernel surface contains no legacy presentation or location fields; a separate diagnostic view formats the opaque context and exact cause without decorating the Error.
- Supported query reflection failure is the query operation's `QueryReflectionFailed` outcome, not a found graph Error: a ready `hasError` or `getErrors` returns the poison directly, a pending query rejects with it, `hasError` does not answer `true`, and `getErrors` does not collect or return an Array. Internal query traversal, indexing, and bookkeeping failures remain fatal.
- Query tests cover ready and pending reflection failure for both APIs, including partial `getErrors` collection. They verify exact poison identity and kind, owner closure, absence from the collected set, Boolean non-conversion, pending rejection rather than fulfillment, and fatal treatment of adjacent internal traversal failure.

Update [`AGENTS.md`](../AGENTS.md), [`error-handling.md`](error-handling.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-preparation.md`](import-preparation.md), [`managed-invocation.md`](managed-invocation.md), [`enter.md`](enter.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), public API documentation, and boundary examples.

---

## Phase 9D-B: Allow synchronous Cascada re-entry

### Problem

The runtime-wide host-code re-entry guard rejects supported native code that synchronously invokes Cascada, including nested script loading. Phase 9D-A establishes the required causal Error boundary first, so re-entry can be enabled without changing Error semantics at the same time.

### Outcome

Remove the re-entry guard and let nested operations use the same explicit operation, ordering, and fatal mechanisms as any other operation. Add no ambient execution or special nested-call path.

### Implementation

- Remove the runtime-wide re-entry guard and its depth state.
- Give every nested operation its own explicit operation context. It uses ordinary Chain, gate, lease, phase, and FIFO ordering in the same or another execution.
- At `runHostBoundary` exit, check the current execution before processing a returned value or thrown reason. If nested work closed that execution, discard the host outcome and propagate its authoritative `RuntimeError`; callers add no duplicate check.
- Work in another execution remains independent. If its `RuntimeError` escapes into the current boundary, submit that same occurrence to the current execution under the ordinary fatal rule.
- A direct host Promise must not depend on nested work ordered behind that call's active managed gate. This is an explicit host-code limitation, not a cycle detector. Phase 9F applies the same rule to an active external phase.
- Keep existing receiver and argument lifetime restrictions for detached work and nested result Promises.

### Verification

- Supported host code synchronously invokes Cascada in the same and another execution without a guard or special call path.
- Nested recoverable failures keep the inner causal source.
- A nested fatal in the same execution prevents the outer boundary from importing or publishing its host result even when host code catches the Error.
- A classification reflection hook that catches a nested fatal and returns normally still cannot make the admission probe publish its opaque or classified fallback; the post-probe execution check propagates the authoritative Error.
- Another execution remains independent unless its `RuntimeError` escapes into the current boundary.
- A direct host Promise that waits on nested work behind its own managed gate is documented and tested as an invalid self-wait.

Update [`AGENTS.md`](../AGENTS.md), [`error-handling.md`](error-handling.md), [`data-limitations.md`](data-limitations.md), [`managed-invocation.md`](managed-invocation.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), and nested-operation examples.

---

## Phase 9D-C: Complete the rejecting-thenable poison cutover

### Problem

Phase 9D-A establishes final causal attribution while poison is still non-thenable. Making poison thenable changes native Promise assimilation: any internal fulfillment that returns poison becomes rejection. Audit and change those paths together before installing the final `then` behavior.

### Outcome

Complete the recoverable representation in [`error-handling.md`](error-handling.md). `PoisonError` remains synchronously detectable language data and also acts as a sync-first rejecting thenable. Publication stores it before an operation Promise rejects; complete collection keeps it outside every internal fulfillment payload.

This representation is required to preserve both sides of the public contract without an adapter: ready poison remains directly inspectable, while `await operation()` rejects with the same Error whether the operation completed ready or pending. Plain non-thenable poison would make `await` fulfill in the ready case, and wrapping it at exposure would sacrifice sync-first return. Do not replace 9D-C with facade-only normalization.

### 1. Make internal Promise transitions safe

Keep the full suite green after Phase 9D-B, then extend the standing Promise-production inventory rather than creating a one-time checklist:

1. Require its source checker and classification manifest to cover every kernel Promise producer, resolver call, fulfillment callback, aggregate branch, gate, phase, and public-result settlement that can receive or return a language value. A future unclassified site fails CI. Do not treat the following as exhaustive examples: `continueInitial`, `continuePrepared`, `continuePreparedAll`, mutation and entry gates, and aggregates in `operation-lifecycle.js`, `export.js`, `managed-invocation.js`, and `observations.js`.
2. Keep poison outside readiness payloads. Publication stores the Error before the public Promise rejects; complete collection carries poison through non-thenable records or equivalent internal state.
3. Audit the derived Promises created by these rewritten fulfillment and assimilation paths. Each must be returned, owned, or marked handled without observing unused host input or changing publication. The general existing-Promise audit belongs to Phase 9C; Phase 9E applies the same rule to the external phase Promises it introduces.

Keep purpose-specific non-thenable records for custom-thenable settlement, complete collection, and external phases. They encode different transitions. Do not introduce a shared result algebra or Boolean policy helper merely to box poison; completeness comes from the producer inventory and route tests.

Do not add poison-fulfillment normalization to `exposeResultOrFatal`. After poison becomes thenable, native Promise resolution of the outward wrapper already rejects with it; another public reaction would be redundant and could not prove that an internal transition applied the required graph effect. The standing inventory and route tests guard the internal invariant. Phases 9D-A and 9D-B are migration checkpoints with transitional non-thenable poison, not release points for the final pending-result type; use only their explicitly required local language-outcome adapters and remove those in this atomic cutover rather than adding a facade-wide temporary path.

Update every callback-result contract that admits language Error. A ready poison result and direct-Promise rejection with that poison must follow the same graph effect. In particular, `enter` preserves a poison rejection from its admitted callback-result channel after required entry completion, while a synchronous callback throw or raw rejection from its trusted runtime callback submits and propagates fatal without an entry-specific abort transition. Document pending result shapes as `T | PoisonError | Promise<Awaited<T>>`, with the Promise rejecting rather than fulfilling with poison.

### 2. Install rejecting-thenable poison

Port the minimal useful part of Cascada's sync-first `then` behavior directly onto `PoisonError`; `CompoundPoisonError` inherits it. Without a rejection callback it returns `this`; otherwise it directly returns that callback's result and lets a callback throw propagate normally. Native assimilation supplies a non-throwing rejection function, and kernel code recognizes Error before thenability, so the callback catch and special thrown-poison branch add no required behavior. After installing it, freeze `PoisonError.prototype` and `CompoundPoisonError.prototype` once so host code cannot change existing Error behavior through their shared prototypes. Omit per-instance method copies, integrity polling, wrapper conversion, `catch`, `finally`, Promise-compatible chaining, and `RuntimePromise` machinery.

Delete the remaining transitional machinery in the same change:

- `PoisonedValue`, `RuntimePromise`, and `PoisonErrorGroup`;
- helpers whose only purpose is turning every poison rejection into fulfillment; and
- wrappers or alternate chaining paths superseded by poison's direct `then` behavior.

Do not commit or review the audited-but-not-thenable intermediate step as the phase end state. The two steps are one atomic cutover because either alone leaves incompatible Promise behavior.

### Final architecture verification

#### Representation and attribution

- Both poison types are native Errors, sync-first rejecting thenables, and reject with their exact identity through `await` and assimilation. `RuntimeError` is a non-thenable native Error. Their final concrete prototypes are frozen once; attempted replacement or shadowing of poison `then` cannot alter existing instances. No shared runtime base or legacy wrapper remains.
- Every Error form precedes thenability inspection, including hostile Error values with throwing `then` properties.
- Every poison has a stable defined source and nonempty kind. Ready and pending forms of one failure use the same kind; later consumers preserve both.
- Aliases to one raw native Error within one import boundary share one occurrence wrapper. Reusing it at two boundaries creates two wrappers. Propagating and combining preserve both; only repeated references to the exact same wrapper deduplicate.
- Root and nested imported native Errors receive occurrence wrappers without modifying host storage. A failed import segment commits none; one successful segment preserves aliases through its staging identity map, and a later successful import receives the later context.
- The attribution matrix covers ready and Promise-backed values, direct and copied property versions, repeated consumers, and genuinely new downstream failures.

#### Promise and boundary behavior

- Raw import, assignment, and host-result rejections use their introducing boundary. Shared settlement and copied mirrors never substitute the consumer that advances them.
- Failing `then` acquisition and captured-then invocation use their exact operations and preserve native first-settlement-wins behavior. Native registration or species failure belongs to the registering operation, native fulfillment is not resampled for thenability, and no Promise-subclass species result becomes kernel FIFO state. Every thenable's cached Promise exposes only a private non-thenable first-settlement record; each introducing boundary's continuation closure supplies attribution and non-native nested capture. Active-path detection terminates self and mutual cycles. Successful thenability state retains no operation context.
- Two causal boundaries consuming one custom thenable's raw rejection create separately contextualized occurrences; a cached acquisition or invocation failure instead preserves the first sampling or invocation operation.
- A `RuntimeError` in any ready, fulfilled, thrown, rejected, or nested host-result position is submitted unchanged to the current execution and never admitted, stored, or exported as language data.
- `runHostBoundary` catches only the exact synchronous supported host action and preserves thrown or returned poison or contextualizes another expected reason. Its causal caller applies the graph effect outside the catch and without an intermediate marker. Language-outcome callback bodies preserve poison only when their result contract admits it; adjacent runtime-only work and callbacks whose contracts admit no poison treat a poison escape as fatal.
- A direct Error follows the same boundary and graph-effect rules whether returned, fulfilled, thrown, or rejected. A direct mutation Error poisons the receiver unless doing so would remove a live external leaf, in which case Phase 9F preserves the original managed scope and returns the Error. An Error from an independent nested result does not retroactively poison published state.
- Direct host-result rejection is converted once in its existing boundary continuation. No attribution-only Promise or parallel continuation path remains.
- Required independent inputs all settle and combine poison in logical order without fulfilling an aggregate branch with a thenable Error. An unclassified or fatal rejection closes the operation.
- Every Promise producer and resolver in the cutover inventory is classified, and every derived Promise is returned, owned, or handled; unused host input is not observed solely to suppress rejection reporting. No internal native Promise fulfills with poison.

#### Graph, compounds, and import

- Promise mirrors and fixed Error overlays use one placement-version map and common logical access. Fixed versions are never treated as pending.
- Compound construction rejects zero inputs, flattens nested compounds, preserves semantic logical order, deduplicates exact leaf identity only, exposes an immutable child array, and derives `.kind` correctly without a stored `.kinds` projection.
- Existing Error queries preserve occurrence identity. `hasError` still exits early; `getErrors` and argument/export collection remain complete. Supported query reflection failure is poison; runtime-only traversal failure is fatal.
- Every live-execution terminal route changed by Error classification closes its local owner, clears registered releases, and balances acquired leases. Verify ready and pending success, existing poison, newly contextualized boundary failure, query early exit, and sibling abandonment directly; do not use a global owner/quiescence oracle, and do not expect fatal execution to run local cleanup.
- A graph Error is published before its assimilating operation Promise rejects with it.
- Import remains segment-atomic. Tree discovery and admission remain separate walks but commit together.

#### Integration behavior

- Raw internal failures and existing `RuntimeError` values continue through Phase 9C's fatal lane; recoverable boundary migration adds no competing fatal state.
- Declaration APIs preserve existing Errors and use operation-local raw thenability probes. Contextless configuration failure uses the explicit sentinel.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-preparation.md`](import-preparation.md), [`managed-invocation.md`](managed-invocation.md), [`outbound-export.md`](outbound-export.md), [`enter.md`](enter.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), public API documentation, and boundary examples.

---

## Phase 9E: Build the external coordination kernel

### Problem

Managed COW, leases, and gates cannot order mutation of exact host identities. Build the execution-scoped identity state and readers-writer phase kernel required by [`external-context-ordering.md`](external-context-ordering.md). Do not route public operations through it until Phase 9F can switch every external use site atomically.

Mutation-capable external resources remain limited to one normalized path of one context Chain in one execution. Independently scheduled executions must not share one mutable host resource.

### 1. Store durable state by identity

Use one execution `WeakMap` for identities recorded in any static external mutation tree. Tree construction creates or reuses an entry but records no actual use. Each entry contains only:

- `use`: unset, `ONE(location)`, or permanent `CONFLICT(error)`;
- `phase`: the readers-writer cursor whose non-thenable completion record carries the repairable poison state.

The location is the live tree leaf supplied by Phase 9A. `CONFLICT` retains the first stable `ExternalLocationConflict` and its context. The Error identifies the first incompatible use category and locations without retaining operation history. Later uses preserve it without reattribution. There is no reverse leaf list, proposed transition, operation history, or separate current-poison field on the durable entry.

Import, managed assignment, storage, copying, return, and rejected host-input export do not count as actual use. Selecting a supported call or property operation through an external boundary, or selecting that boundary in a broader external mutation scope, does. Once ordered, the claim remains even if member reflection or later preparation fails before host access:

~~~text
unset + live leaf L       -> ONE(L)
unset + any other use     -> CONFLICT
ONE(L) + same leaf L      -> unchanged
ONE(L) + any other use    -> CONFLICT
CONFLICT + any use        -> preserve the first conflict Error
~~~

Mutation additionally requires a live tree leaf. An identity absent from every static tree is observation-only and needs no identity entry or phase.

A direct lookup that would expose a mutation-capable identity fails before exposure and records no use, but still joins its observation phase. Export rejects it without recording use or acquiring a phase. A conflict discovered by an operation with a phase publishes its Error after the ordered predecessor and performs no access through the selected external receiver.

Use through a copied, moved, aliased, Promise-revealed, differently pathed, or differently chained occurrence conflicts. The operation performs no access through the selected external receiver. Conflict is permanent, does not cancel earlier issued work, and cannot be repaired.

Evaluate all actual uses for one operation as one atomic batch at the first ordered point after exact selection and selected phase predecessors:

1. Read one pre-operation state.
2. Compute proposals and collect conflicts in deterministic receiver/path order.
3. If any conflict exists, commit every permanent conflict but no compatible new `ONE` state.
4. Otherwise commit all new locations together.

A ready operation reaches this point synchronously. A Promise-valued path reaches it in its already-ordered phase continuation. Commit the batch before host access and independently of later preparation success; phase publication prevents a later operation from overtaking it.

If one operation selects the same identity through two different leaves, the batch conflicts; identity-keyed merging must not discard the second location.

Only static-tree lookup prunes leaves. When it encounters a committed conflict, remove that queried leaf and return no candidate. The identity map continues to reject references absent from the tree.

### 2. Coordinate one operation locally

`ExternalOperationContext` reuses the ordinary operation context, stores the operation-wide repair intent once, and owns one identity-keyed map of selected records. Each record contains:

- selected location;
- strongest access mode;
- proposed `use` transition;
- phase-completion handle.

It owns no graph traversal, scope selection, host invocation, managed publication, durable identity state, or final result. Phase 9F creates it only when an operation selects indexed external coordination. Its complete possible phase set is supplied before the first wait; its exact-use set is finalized after any required path resolution.

### 3. Add one readers-writer phase

Use one common primitive rather than another Chain or scheduler:

~~~text
observation:
  predecessor = latest exclusive completion
  join or create current read group

mutation or repair:
  predecessor = current read-group completion
                or latest exclusive completion
  become new exclusive completion
  close current read group
~~~

Create phase state lazily on first selection. For each operation:

1. Merge selections by identity; exclusive access wins.
2. Publish every successor before waiting for any predecessor.
3. Freeze the selected set.

Selections belonging to one operation never wait on each other. No identity acquires another phase after the first wait. A later-revealed identity therefore performs no host access unless it matches an already selected boundary.

Exact external identities use phases, never managed leases or gates. A managed prefix may independently use its ordinary protection.

Every phase Promise fulfills with a hook-free, non-thenable state record equivalent to `{ poison }`; it never fulfills directly with a rejecting-thenable Error. Mark it handled when created because a semantic consumer may attach later. Fatal failure follows the execution fatal path instead. Each successor captures its predecessor record. Observations in one read group share their exclusive predecessor and overlap one another. The group keeps issuance-ordered outcome slots and the poison known so far: an observation snapshots that state when it joins, so already-issued peers do not retroactively consume new poison while later observations do. Group completion exposes the final combined poison to the next exclusive operation.

Fatal failure adds no phase-completion path. A successor that resumes after its predecessor completes reaches the common execution check and returns before host or operation work. A successor behind a never-settling predecessor may remain pending because fatal commit rejects every currently pending public operation result through its registered outward rejection action. Fatal Error is never stored as repairable poison or in a phase record.

### 4. Carry poison through phase completion

External poison is phase state, not graph data or host-object state. It never replaces a placement.

- Existing predecessor poison contributes an Error at the receiver position. Required preparation finishes, host code is skipped, and the phase preserves it.
- Ordinary observation failure does not poison.
- Invalid managed containment adds its Error to the selected external boundary.
- Failed or rejected mutation combines all operation Errors and publishes the result through every selected mutation completion. Completed host effects remain visible.
- New failures use their causing operation's context and kind; preexisting Errors retain theirs.
- Exact identity mismatch at a fixed leaf is a fatal runtime invariant failure.

Phase 9E exposes no public repair. Its internal exclusive repair transition may bypass repairable predecessor poison and complete with caller-selected poison, but it cannot clear conflict, record use, create authority, or create a tree leaf. Repair failure uses the repair operation's context and `ExternalRepairFailed`; exact-identity mismatch is fatal. Phase 9F routes repair-only and repair-and-call.

### Verification

- First use stores `ONE(location)`; repeated same-location use preserves it; incompatible use commits one permanent `ExternalLocationConflict`.
- A ready exact use commits synchronously once its phase predecessors are ready. A deferred exact use commits in its selected phase order, so later operations cannot claim its identity first.
- Batch evaluation is iteration-independent: a failed batch commits all permanent conflicts and no compatible first locations.
- Conflict does not cancel earlier phases, never invokes host code, preserves its first Error, and cannot be repaired.
- Observations overlap after their exclusive predecessor. Mutation and repair wait for the entire read group.
- Every successor is published and the set is frozen before predecessor waiting. One operation's entries never wait on one another.
- Phase Promises are handled at creation and fulfill only with non-thenable state records. Repairable poison never becomes a Promise rejection, preserves child attribution, and is changed only by repair.
- Fatal failure creates no phase record or terminal state. A resumed successor performs no host effect after its execution check; a successor behind a never-settling predecessor may remain pending without delaying any public operation result.
- An observation sees poison known when it joins. Earlier peers are unaffected by later peer poison; later observations and the next exclusive operation see it.
- `ExternalOperationContext` uses one selected-record map, stores repair intent once, and contains only operation-local coordination. Selecting two locations for one identity conflicts during merging.
- Each durable identity entry contains only `use` and `phase`; repairable poison exists only in non-thenable phase-state records.
- Add no public route, path selector, second index, hidden-Chain adapter, scheduler, live occurrence graph, or reverse leaf index.

---

## Phase 9F: Route and cut over external operations

### Problem

Phases 9A–9E provide execution-local graph state, causal Error handling, the static external mutation tree, durable identity state, readers-writer phases, poison, and internal repair. Route every external call and property operation through those mechanisms, expose repair, and remove the hidden sequence Chain in the same change.

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
- Add `repairPath(chain, path, operationContext)` for repair-only. It targets a fixed external location already selected by actual use, records no use itself, invokes no host code, and repairs no managed graph Error. Add it to Phase 9C's public-facade inventory in the same change, so a pending repair result uses the common outward fatal-rejection registration while ready repair remains direct.
- Assignment still replaces, and deletion removes, an Error at their final managed placement. Neither operation implicitly repairs external phase poison.

### 2. Use one external-operation lifecycle

After hook-free internal dispatch accepts the operation:

1. Capture the final compiler-provided operation facts.
2. Query the complete receiver or property path for the exact external boundary or first boundary prefix. Observations query too. Mutation also selects live external leaves below its mutation scope.
3. Create one `ExternalOperationContext` when indexed coordination is selected. Merge records by identity, let mutation win over observation, and treat two possible locations for one identity as conflict.
4. Publish every possible phase successor and freeze the set before waiting. Capture ready managed property versions, any ready external boundary, and input export. Apply the ordinary managed lease or gate at a managed prefix. Export rejects mutation-capable external values instead of selecting phases for them.
5. Wait only as needed for phase predecessors and path resolution. Finalize the exact selected locations, evaluate their use batch from one state, and atomically commit permanent conflicts or every compatible location. A later preparation failure does not undo the authority claim.
6. Finish ordinary readiness and required Error collection. If any preparation or conflict Error exists, perform no host reflection.
7. Otherwise traverse the captured host suffix once and resolve or invoke its selected member once.
8. Process the boundary result: import call results and observation-only external-property results; snapshot property results inside mutable external state.
9. Publish managed state, external phase poison, or repair, then complete the selected phases with non-thenable state records.

Before step 7, do not inspect the selected external receiver's host suffix, descriptors, getters, setters, properties, or methods. Earlier argument export and other required boundary preparation may perform only the host reflection explicitly allowed by their own contracts and causal boundaries. Prepare a callable as executable rather than importing it as data. Constructors remain unsupported.

The phase set never expands after the first wait. A later-revealed mutation-capable receiver must match an already selected boundary or fail before host access. A mutation-capable identity found in host input fails export without acquiring a phase.

### 3. Compose managed and external mutation scopes

`mutationScopeDepth` identifies the complete `!` prefix:

- **External scope:** select the exact external boundary. Use its phase and no managed COW, lease, or gate. A deeper `!` clamps to the first external boundary because the host suffix is opaque.
- **Managed scope:** use the ordinary managed transition at that prefix. Select live external leaves below it only for an external host effect declared by this operation.
- A managed method receives no authority over opaque external descendants merely because they occur in its receiver.
- Publish every selected external successor before a managed transition waits.
- Keep a pending managed gate and selected external phases through the same direct-Promise boundary.
- If an external operation below a managed gate fails, republish the unchanged managed prefix. Its Error result and repairable external phase poison carry the failure; do not replace managed state containing a live leaf with an Error.

For managed `apis` containing external `db`:

- `apis.db!.write()` selects `db`.
- `apis!.db.refresh()` protects and publishes managed `apis` and selects live external leaves under `apis` for the declared host effect.
- If `apis` is external, either form selects only `apis`.

The static tree is not a COW predicate. Managed assignment creates another owner; later mutation through either managed placement uses ordinary COW. External identities remain exact and mutate in place only under their phases.

Before publication, reject any controlled replacement, deletion, or Array remap that would remove, replace, hide, or relocate a live tree leaf. Allow an Array change that preserves every live leaf's exact path and identity. Apply the same validation to a managed host method's private completed receiver: a detected violation is recoverable `InvalidManagedReceiver`; discard the private receiver, preserve the original managed state, and return the Error. A mutating managed-call failure that could remove a live leaf follows the same preserve-and-return rule instead of ordinary receiver poisoning. Host behavior is fatal only when it has already changed external state without authority or made another runtime invariant untrustworthy. A managed alias may be stored, but actual external use through another path conflicts.

An entered contextual Chain carries the reached tree node and source execution. Nested entry continues from that node; entry at or below an external boundary remains clamped to it. Root and entered operations use the same selector and phase state. A mutating entry's branch gate excludes outside access until publication and may publish only state that preserves affected live leaves.

### 4. Route external calls and properties

The first external boundary owns its opaque host suffix:

- Traverse that suffix only after the boundary's predecessor phase completes.
- Give no deeper host identity another tree location or phase.
- Never scan untouched external properties.

If property traversal reaches an already admitted managed identity inside external live state, return `InvalidExternalContainment` and poison the selected boundary. Detect this only when reached. A host-call result instead crosses a new import boundary and may contain managed data.

Property operations behave as follows:

| Operation | Boundary behavior |
| --- | --- |
| Read exact mutation-capable identity | Return `ExternalCapabilityEscape`; do not expose it or record use |
| Read below mutable external state | Return a detached managed snapshot |
| Read observation-only external state | Use ordinary import |
| Write | Export the captured right-hand value before native assignment or setter; any Error prevents the write; return the captured logical value |
| Delete | Perform native deletion and return its Boolean result |

A native setter must finish synchronously. Assignment and deletion are mutations. Without a broader `!`, their mutation scope is the complete target path. Replacing an external-valued managed placement is a managed structural write; reaching external state before the final key is a host property operation.

For mutable external `config.db`, `config.db.query()` is an observation and `config.db!.close()` is a mutation. `var db = config.db` fails because it would expose the capability. `var status = config.db.status` returns a detached managed snapshot.

Host calls use ordinary result import, with two additional escape checks:

- Reject every identity recorded in any static external mutation tree.
- For an external call, also reject its exact native receiver anywhere in traversable result data, including below the indexed opaque boundary and after direct-Promise fulfillment.

An opaque external result that secretly contains a receiver alias remains a host-contract violation because Cascada does not inspect opaque state.

### 5. Snapshot mutable external properties

Use one dedicated synchronous snapshot transaction. It has export's visible graph-copy semantics but is neither export nor an import mode:

- Preserve aliases, cycles, Arrays with length and holes, prototypes, Functions, and enumerable own String-keyed properties.
- Omit symbols, inherited properties, and non-enumerables.
- Copy every traversable source identity and admit each copy as managed.
- Validate a custom-prototype copy with the managed-class prototype contract without registering that prototype globally.
- Preserve Functions without granting external authority.
- Treat getter and Proxy failures as property-operation Errors.
- Reject reached Errors without exposing a partial copy.
- Reject already admitted managed containment and any separately indexed mutable external identity.

A Promise selected directly as the property result retains the phase until fulfillment, then snapshots the fulfilled value. The synchronous snapshot walk itself accepts no Promise; a nested Promise produces `InvalidExternalSnapshot` and creates no mirror or continuation.

The final snapshot contains no external location or mutation authority. Export, managed receiver isolation, and this snapshot may share only identical low-level container, key-reading, and safe-definition helpers; do not build one configurable graph walker.

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

- A direct operation Promise retains selected phases and any managed gate through final result import, snapshot, or rejection.
- A nested result Promise is result data and extends neither phases nor authority.
- Ordinary observation failure affects only its result. Invalid managed containment also poisons the selected external boundary.
- Failed or rejected mutation combines all operation Errors and publishes the result through every selected mutation completion. Completed host effects remain visible.
- Conflict performs no access through the selected external receiver, is permanent, and cannot be repaired.
- Repair-only bypasses and clears repairable predecessor poison and returns `undefined`. Repair-and-call bypasses old poison, then clears it on success or publishes the new mutation Error.
- Host code may synchronously issue nested Cascada operations while its direct invocation remains active. They use explicit operation contexts and ordinary ordering, not a separate external-operation or re-entry path.
- A direct host Promise must not depend on a nested operation ordered behind its own active managed gate or external phase. Such a dependency cycle is invalid host behavior.

Attribute new failures at the selecting operation:

| Failure | Kind |
| --- | --- |
| Getter, descriptor, or Proxy property read, including a ready Error result or direct rejection | `ExternalPropertyReadFailed` |
| Setter or deletion | `ExternalPropertyWriteFailed` / `ExternalPropertyDeleteFailed` |
| Member selection, call throw, returned Error, or direct call rejection | Phase 9D-A invocation kind |
| Managed containment inside external live state | `InvalidExternalContainment` |
| Mutation-capable identity escape | `ExternalCapabilityEscape` |
| Promise nested in mutable-property snapshot | `InvalidExternalSnapshot` |
| Repair validation | `ExternalRepairFailed` |
| Fixed-leaf identity mismatch | fatal `RuntimeError` |

Preexisting poison and mutation poison retain their original child attribution. Repair-and-call host failure keeps its host-call kind.

The external-property observation is one causal boundary. Do not split action throw from returned or rejected Error with a second value kind or a multi-kind `runHostBoundary` policy; all have the same selected operation, recovery, graph effect, and useful diagnosis.

### 8. Cut over atomically

Switch calls, property operations, managed/external scope composition, mutable-input rejection, snapshots, repair, and entered contextual Chains together. In the same change delete the hidden sequence Chain and its compiler/runtime routing.

Keep no adapter, overlapping scheduler, fallback path, live external occurrence graph, reverse leaf index, external-input provenance, or second invocation path.

### Verification

#### Static authority and identity use

- Initial context import discovers every external leaf on compiler-provided scope and property paths; later settlement and graph changes add none.
- Absolute ContextChain use and the equivalent relative entered-Chain use resolve to the same leaf in either issuance order.
- Another Chain, path, copied/moved alias, or Promise-revealed occurrence conflicts before host access. The first reason remains stable.
- Duplicate initial leaves do not conflict until actual use; selecting a second does.
- Tree lookup prunes only a queried committed-conflict leaf. An unindexed external identity remains observation-only.
- Managed assignment and later COW leave original live bindings unchanged.
- Replacement, deletion, and Array remapping reject before disturbing a live leaf; unrelated Array changes remain valid.
- Traversal validates the exact live identity against its leaf entry. Mismatch is fatal.

#### Ordering and scopes

- Observations wait for the previous exclusive phase and overlap one another. Mutation and repair wait for the read group.
- Every phase successor is published before the first wait, and no phase is added later.
- `apis.db!.write()`, `apis!.db.refresh()`, and an opaque external ancestor select the documented scopes.
- External mutation uses no managed gate. A managed prefix independently uses ordinary COW and gating.
- Broad scopes select only live leaves; pruned or otherwise unselected identities grant no host authority.
- Root and entered Chains share ordering and poison for the same leaf in both issuance directions.
- Entry at or below an external boundary clamps to it and delays host-suffix traversal until its predecessor finishes.

#### Boundaries and cleanup

- Ready external operations remain synchronous, and required preparation precedes every host reflection or invocation.
- A method selected through mutable external state remains callable without exposing that function as a property value.
- Mutable external identities never escape through lookup, return, export, external-property assignment, script result, or callback input. Internal managed assignment may retain an alias but grants no authority; actual use through another location conflicts.
- Ready exact selections claim use synchronously once their already-published phase predecessors are ready; deferred selections claim it in their selected phase order. Batches commit atomically from one snapshot, two locations for one identity conflict, and failed batches grant no partial authority.
- Every explicit host argument and external write value uses common export, including after Promise fulfillment.
- Mutable-property snapshots preserve Arrays, aliases, cycles, prototypes, and Functions while copying every traversable identity. They reject Errors, nested Promises, managed containment, and separately indexed mutable identities without exposing partial data.
- Observation-only property results and all call results use ordinary import; external call results additionally reject their exact receiver.
- A direct property Promise retains its phase until snapshot completion. Nested snapshot Promises create no mirror or continuation.
- Comparator sort rejects mutation-capable elements through common export and needs no extra phase or release callback.
- Phase completions carry poison only inside non-thenable records. Observation groups expose known poison to later observations and final poison to the next exclusive operation.
- Failure and repair preserve the Phase 9D-A contexts and kinds; repair never clears conflict.
- External ordering uses only the static tree, execution identity map, and common phase kernel. The hidden sequence mechanism and all adapters are gone.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`external-context-ordering.md`](external-context-ordering.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`managed-invocation.md`](managed-invocation.md), [`import-preparation.md`](import-preparation.md), [`outbound-export.md`](outbound-export.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), compiler lowering, path-operation documentation, and public API documentation.

---

## Phase 10: Support Promise-valued path segments

### Problem

Current path walkers stringify every segment immediately. A Promise supplied as a key therefore becomes `\"[object Promise]\"`. Waiting for the key before issuing the operation would let later mutations overtake it.

### Outcome

Implement [`promise-path-segments.md`](promise-path-segments.md). Consume each segment only when traversal reaches it, protect the longest ready prefix once, and resume through ordinary FIFO continuations. Keep observation and mutation as separate walkers.

The **ready prefix** is the longest leading path whose segments and placements are available. The **protected prefix** is that prefix after the operation acquires the one managed lease or gate and all required external phases.

### 1. Centralize segment consumption

Treat every reached segment as a String or Number operation input:

- Normalize a ready segment only when reached.
- Resolve a pending segment through common Promise/Error preparation, then normalize its fulfillment.
- Any other ready value produces `InvalidPathSegment` without invoking coercion hooks.
- Never stringify a Promise object as a key.
- Stop when the known prefix fails; do not consume later segments.

An unused segment Promise remains host-owned. Do not await it or attach a rejection observer solely to suppress host reporting.

For compiler mutation discovery, a mutation path containing a dynamic or Promise-valued segment contributes its longest preceding String/Number prefix as a conservative `scopeMutationPaths` entry. For example, `apis[pendingKey]!.run()` contributes `["apis"]`, while `[pendingKey]!.run()` contributes `[]`. Apply the same rule to dynamic assignment and deletion paths. Initial tree construction therefore remains synchronous and receives no Promise segment; the runtime operation path still carries the actual Promise without sideband metadata.

Centralize the identical ready-or-Promise consumption and String/Number validation. Observation and mutation keep their existing walkers because mutation also owns COW, writeback, gating, and failure publication. Both walkers follow the same one-time prefix-protection and resumption protocol.

### 2. Protect the first pending prefix once

Walk ready leading segments synchronously. A completely ready path keeps its existing operation and synchronous behavior.

Before registering the first pending segment:

| Prefix | Observation | Mutation |
| --- | --- | --- |
| Managed | Lease the reached prefix value | Install the ordinary transition gate at the reached prefix placement and continue against its private working value |
| External | If the ready prefix already selects one exact boundary, use its ordinary observation phase; otherwise publish exclusive provisional phases for every possible live leaf | If the ready prefix already selects one exact boundary, use its ordinary mutation phase; otherwise publish exclusive provisional phases for every possible live leaf and no managed gate |

Publish all managed protection and external phase successors before waiting for any predecessor.

Resume every later segment from the same protected prefix:

~~~text
for each reached segment:
  if ready:
    normalize and continue
  else:
    register one FIFO continuation on its captured version
    resume from the existing protected prefix
~~~

Several pending segments therefore use one prefix scope. Do not acquire another lease, gate, or late phase. Completion releases the lease or publishes the gate through ordinary transitions.

If the known prefix already fails, return or publish its ordinary path Error without waiting for unused segments. A segment failure returns an observation Error or applies the ordinary gated-mutation failure at the protected prefix.

Prefix-wide mutation ordering is unavoidable: before `value[pendingKey]` resolves, any descendant may be the target.

### 3. Use one operation owner

A path component reuses its containing `OperationOwner`:

- `hasError` and `getErrors` use their query owner.
- Path export uses its export owner and separate output lifetime.
- `run` and `enter` use their containing owner.
- `readPath` inherits the owner and external-selection policy of the operation that consumes its temporary result; it is not an output-producing lookup.
- `repairPath` and standalone lookup and mutation obtain one owner through one centralized provision point.

For standalone paths, compare eager `OperationOwner` creation at operation entry with lazy creation at the first asynchronous registration. Keep lazy creation only if it remains confined to that provision point and materially avoids ready-path allocation without spreading optional-owner branches; otherwise create one owner eagerly.

Every pending segment continuation, external predecessor wait, and asynchronous registration uses the guarded FIFO helpers. Property-version APIs remain unaware of operation owners.

A continuation first checks execution fatality and simply returns without doing graph or cleanup work when present. In a live execution it completes shared mirror, placement-version, refcount, and required settlement bookkeeping, then performs no later normalization, traversal, protection, phase work, host access, publication, or result production if its local owner has closed.

Observe every pending walker continuation at its originating layer, including a non-blocking mutation API that does not return that Promise.

Close work only after required publication:

- A standalone observation normally closes when its final result is determined; one that detects fatal failure submits and propagates it without a fatal-specific owner transition, while later observers of the closed execution return.
- A pending mutation normally closes after its gate publishes success or language failure, not when its non-blocking API returns.
- A pending repair normally closes after its selected external phase publishes repair success or language failure.
- A path component inside invocation, export, or an Error query creates no independent lifetime.
- Local operation closure in a live execution does not stop required gate or phase completion. Execution fatality adds no completion transition; a resumed waiter stops at the common check, and a never-resumed internal gate or phase may remain pending without delaying a public operation result.

### 4. Protect possible external targets before waiting

On a context Chain with an unresolved suffix:

1. Query the ready prefix in the static external mutation tree. If it already reaches an exact boundary, the unresolved suffix is normally an operation through that boundary: select its ordinary phase and treat it as actual use independently of later segment success. Repair-only instead stops at that boundary, ignores the opaque suffix, and selects its repair phase without recording use. Otherwise collect every live leaf the unresolved suffix may reach.
2. Merge and publish an exclusive provisional phase for each uncertain leaf together with any managed prefix lease or gate. Observation also uses exclusive provisional phases while its exact location is unknown.
3. Freeze the phase set before waiting.
4. For a provisionally protected suffix, apply the consuming operation's existing external policy after resolution and the selected phase predecessors. Crossing the reached boundary for a call, property operation, or broader external mutation scope commits actual use before host access. Ending on the mutable capability itself records no use when lookup or export rejects it or an Error query treats it as terminal. `readPath` inherits its containing operation's policy. Repair-only requires an existing selected location and neither records use nor creates authority; repair-and-call retains ordinary call use. The exclusive reservation prevents a later operation from overtaking this decision.

Use the existing live-descendant tree query; add no candidate-path analysis or external index.

A phase selected only because the suffix is unresolved is **provisional**. It is exclusive for ordering but grants no mutation authority:

- It contributes no use proposal, mutation authority, predecessor poison, or operation Error unless resolution selects that boundary.
- If unselected, it still waits for its predecessor and completes with the prior poison unchanged, preventing later operations from overtaking it.
- Segment failure or resolution to managed state completes it unchanged.
- A leaf independently selected by an explicit broader mutation scope remains an actual mutation entry.

After resolution, acquire no new phase. External mutation succeeds only when the exact boundary is a live leaf already selected for the operation. Otherwise return an Error before host access. An unindexed external identity remains observation-only.

If late external-authority validation fails below a managed gate, republish the unchanged managed prefix rather than poisoning it.

The protected prefix must also compose with the consuming operation without a protection gap or an independent competing transition:

- A mutating `run` or `enter` keeps the prefix gate as its publication gate through direct completion; it does not install and publish a second receiver gate.
- An observational `run` or `enter`, export, and an Error query acquire or complete their final capture before releasing the prefix lease. Keeping the coarser prefix lease for the operation is valid when it is simpler.
- `readPath` transfers no ownership by itself. Its containing operation determines when the prefix protection may end.
- A repair keeps its exclusive selected phase through repair publication.

The callback for `enter` cannot run until every Promise-valued key needed to identify its target has resolved. Once the path is known, a Promise stored as the target retains ordinary `enter` behavior; do not confuse a pending key with a Promise-valued target.

Repair-only consumes segments only until it reaches the first external boundary, because a repair marker inside opaque external state repairs that boundary. It neither resolves nor observes later path segments. If provisional selection is required before that boundary is known, resolution stops as soon as the selected boundary is reached and every unselected provisional phase completes unchanged.

### 5. Preserve causal failure origin

- A segment rejection that is already contextualized preserves its producer Error.
- A raw ready or rejected segment failure first consumed here uses this operation's context and `PathSegmentFailed`.
- A fulfilled non-String/Number value uses `InvalidPathSegment` at the consuming operation.
- A later lookup, mutation, phase, gate, mirror, or publication failure uses the operation that causes that failure.
- A segment after a failed known prefix is never consumed or attributed by this operation.

### 6. Reuse existing mechanisms

Reuse:

- read leases;
- the COW predicate;
- transition gates;
- Promise mirrors and FIFO continuation;
- ordinary publication; and
- lower-level transitions already shared with `enter` where their lifecycles are identical.

Do not:

- call `enter` from ordinary path operations;
- create temporary Chains;
- add a key-resolution queue, scheduler, second external index, or sideband prefix metadata;
- add operation-specific path-preparation paths;
- merge observation and mutation into a configurable walker; or
- change ready-path synchronous behavior.

### Verification

#### Segment behavior

- Ready String and Number segments preserve current synchronous behavior. Other values fail without coercion.
- Root, middle, and final Promise segments resolve and normalize for lookup, non-sharing `readPath`, assignment, deletion, invocation, export, Error queries, `repairPath`, and `enter`.
- Broken ready prefixes do not wait for or observe unused segments.
- Repair-only stops at the first external boundary and does not wait for a pending opaque suffix.
- Segment rejection and invalid fulfillment follow ordinary Error publication at the protected prefix and preserve the source rules above.
- Observation and mutation share consumption and resumption without sharing COW, writeback, gating, or failure-publication logic.

#### Protection and lifetime

- A pending observation leases the longest ready managed prefix once; later mutation COWs without changing its captured result.
- A pending mutation gates that prefix before waiting; conflicting work cannot overtake it and unrelated paths continue.
- Several pending segments share one scope while preserving aliases, mirrors, FIFO order, and Error identity.
- Compound operations hand prefix protection to their existing lifecycle without an unprotected interval, early publication, or a second competing gate. An `enter` callback waits for pending keys but retains the existing behavior for a Promise stored at the resolved target.
- Every asynchronous registration has an owner. Locally closed work in a live execution completes shared settlement but performs no later operation work; execution-fatal resumption returns before settlement.
- A hidden pending mutation continuation remains observed after its immediate public API return. It closes through ordinary gated publication while the execution is live. On fatal detection or later observation of an already-failed execution it simply returns; if its blocker never settles after an unrelated fatal, it may remain pending because that immediate return is already final.
- `hasError` retains early-exit behavior; `getErrors` completes its full Error walk. Both release unfinished query-only state when their shared owner closes. Supported host reflection failure is the query operation's `QueryReflectionFailed` outcome rather than `true` or a collected Error; internal traversal or bookkeeping failure remains fatal.
- Owner provisioning stays centralized; retain laziness only under the criterion above.

#### External ordering

- Compiler discovery contributes the longest static String/Number prefix of a dynamic mutation path, so every possible mutation-capable boundary is present in the initial tree without putting Promises in compiler path facts.
- Before waiting, an unresolved context suffix normally uses the ordinary phase for an exact boundary already reached by its ready prefix and treats it as actual selection; use commits at its ordered point independently of later segment failure. Repair-only stops at that boundary and records no use. Otherwise the operation publishes an exclusive provisional phase for every possible live external leaf and records no actual use.
- Resolution never expands the phase set. Exact external mutation requires a selected live leaf; an unindexed identity remains observation-only. Repair-only requires an already selected fixed location and cannot establish use or authority; repair-and-call retains ordinary call use semantics.
- Unselected provisional phases carry no authority or new Error but complete in predecessor order with an unchanged non-thenable poison record. Exact use commits before host access and cannot be overtaken by later operations.
- A Promise-resolved path ending on a mutable capability retains the consuming operation's terminal behavior: rejected lookup or export and terminal Error inspection record no use. A path that continues through that boundary performs an actual property or call operation. Phase reservation alone never changes either result.
- Ready and Promise-resolved equivalent String/Number paths reach the same authority.
- Late authority failure republishes unchanged managed gated state.
- Gate, mirror, phase, and publication failures use their own operation context; source rejection retains its producer.

No temporary Chain, direct `enter` call, new queue, operation-specific walker, or second scheduler remains.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`promise-path-segments.md`](promise-path-segments.md), [`outbound-export.md`](outbound-export.md), [`counters-implementation.md`](counters-implementation.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), [`enter.md`](enter.md), [`work-bounds.md`](work-bounds.md), and public path-operation documentation.

---

## Phase 11: Review imported-Promise settlement ownership

### Problem

Imported Promise fulfillment currently spans `property-versions.js` and import preparation through a dependency and installer-callback tuple. The flow is correct, but its ownership may be simpler after the Error and Promise-path architecture is complete.

### Outcome

Evaluate one fulfillment-segment processor owned by `import-preparation.js`. Keep the rewrite only if it removes the property-version-to-import dependency and callback tuple without replacing them with another context object, adapter, or configurable path. Otherwise retain the existing function-based flow unchanged.

### Constraints

- Preserve one atomic staged import walk per synchronous segment. A failed segment commits no admissions, origins, retentions, Promise placements, fixed Error versions, or external-tree leaves.
- Promise fulfillment starts a fresh segment at its existing FIFO position and retains its originating boundary context.
- Keep external-tree discovery as a separate occurrence walk because it must preserve finite alias paths; commit it atomically with identity admission.
- Reuse placement versions and the existing Promise mirror. Add no `ImportTransaction`, second overlay store, or parallel continuation path.
- Make no change merely to move code between files. A neutral or larger conceptual result is a failed experiment and must be reverted.

### Verification

- Ready and Promise-fulfilled imports preserve the same admission, attribution, alias, cycle, placement-version, and tree-discovery behavior.
- Failed fulfillment segments leave no partial state.
- The retained implementation has fewer cross-module concepts than the pre-phase implementation; otherwise the source remains unchanged.

Update [`import-preparation.md`](import-preparation.md) only if the experiment is retained.

---

## Phase 12: Cut Cascada over to the execution Error architecture

### Problem

The kernel phases establish the final Error semantics, but Cascada currently owns per-render reporting, root fatal racing, compact source formatting, `RuntimeContextError`, `PoisonedValue`, `PoisonErrorGroup`, `RuntimePromise`, legacy kind names, and compiler/runtime helpers that encode the previous transport model. Scattered documentation-update bullets do not provide an end-to-end migration or prove that the final script result, diagnostics, and browser/runtime support use the kernel architecture without adapters.

### Outcome

Move Cascada to the kernel's Error and execution contracts in one explicit integration phase. Preserve Cascada's useful per-render reporting, compact diagnostic context, bounded formatting, and result-driven root completion while removing duplicate Error representations, fatal state, attribution, and Promise paths.

### 1. Integrate execution-owned fatal handling

- Create one `Execution` for each render/run and pass that render's `onError` as its immutable reporter. Concurrent executions with different reporters must not cross-route failures.
- Replace the compiler's error-context-only data flow with an explicit render-local operation-context table. The generated `getErrorContexts`/`prepareErrorContexts` path currently creates one compact tuple per static source entry for each render; change that setup to pair each immutable source handle with the current render's `Execution` once and expose the resulting immutable `{ execution, errorContext }` entries to generated code. Every emitted graph call and command stores or passes its selected operation context directly. It must not recover execution through a diagnostic tuple, a Chain, ambient state, or a later consumer.
- Reuse one operation-context object for repeated execution of the same exact prepared source handle within one render, so ordinary loops and repeated commands do not allocate a two-field record per invocation. Distinct compiler source handles remain distinct even when they share a line, and a dynamically derived immutable diagnostic handle receives its own operation context; reuse never merges causal positions. Runtime-created nested operations reuse the current execution but use the source handle for the operation they actually perform. This keeps allocation proportional to prepared source contexts rather than executed operation count without adding mutable operation state to the carrier.
- Treat the raw Chain/operation-context pairing as trusted compiler/runtime protocol. Scripts cannot supply it directly. A missing context, cross-execution Chain binding, or closed entered Chain remains fatal before graph access; if Cascada later exposes a separate general host API, that outer API validates its invocation before calling the kernel rather than weakening the kernel contract or adding another execution-selection path.
- Make `RenderState`, command buffers, iterators, child buffers, and the scheduler check the execution's `fatalError` at their existing entry, resumption, and dispatch boundaries. Every execution-bound public API operation passes its classified direct result through the common sync-first public-result helper; only an actually pending public result registers one removable outward reject action. Replace `raceRootResult` with that general helper and remove its extra rejection-classification catch because public results are already classified. Remove duplicate fatal Booleans/latches, report idempotence, and candidate selection after all consumers use the execution outcome.
- Remove `RenderState`'s eagerly allocated fatal Promise and its no-op observer. Store only the reject actions of public results that are currently pending and delete each on normal settlement; a ready-only render allocates no wrapper or registration, and a long-lived successful render retains no historical losing-race reactions.
- Do not preserve `raceRootResult`'s arbitrary `.then` probe or its conversion of an already-failed ready call into `Promise.reject`. The facade helper recognizes Error before the preclassified native-Promise case and throws an already-present `fatalError` synchronously.
- Replace `RuntimeError.report`, `RuntimeError.reportAndThrow`, `reportRuntimeContractError`, `createSyncRuntimeError`, `RenderState.reportFatalError`, `RenderState.reportAndThrowFatalError`, and context-keyed fatal adapters with `submitRuntimeFailure`, the synchronous non-reporting contextless fatal entry, or direct observation of the execution outcome as appropriate. Do not leave a compatibility reporter path. In particular, delete Cascada's no-callback `report(error)` fallback that throws asynchronously: the captured reporter is notification only, and fatal control transfer comes from the detecting call, a pending outward result, a later public-entry check, or `execution.fatalError`.
- Use the same public-result helper for script completion and every other execution-bound public operation. Public entry throws an existing `fatalError` synchronously; otherwise the operation performs its required boundary processing synchronously as far as possible. The already-classified result is recognized as Error before thenability. Return a ready result directly. For an actually pending direct Promise, synchronously create the outward wrapper, register its idempotent reject action, attach source settlement, and delete the action before normal resolution or rejection. Fatal commit rejects and clears the remaining actions. Do not add a second post-operation fatal check: a transition that detects fatality must submit and propagate it, while a later observer checks and returns. Once a result settles, deliver it without waiting for unrelated work. A later fatal is stored and reported by the execution and cannot change the delivered result. Contextless configuration calls remain synchronous and outside this mechanism.
- Add one package `./integration` subpath that re-exports the existing unwrapped core operations and the one existing exposure helper needed by Cascada, and switch all compiler-command and buffer use to that subpath. It is a trusted package-composition surface, not a second operation implementation or a public/internal flag; the host-facing root entrypoint keeps its wrappers, while integration calls register no outward result. Extend the standing package/result-exposure inventory to Cascada's outward execution-owning render routes: template and script rendering, their exported-value variants, and the environment/top-level APIs that create or delegate to those renders. Expose the direct result owned by each render execution exactly once. A callback adapter consumes that already-exposed result; an environment method or top-level alias that merely delegates to it adds no second wrapper or registration. Compilation, loader/configuration calls outside a render, compiler-generated commands, buffer lanes, and command-result Promises are not public execution-result boundaries and register nothing. Make the inventory test fail if a new outward render route bypasses exposure, a delegating route exposes it again, or Cascada imports a host-facing wrapped kernel operation for internal work.
- Keep operation owners local. Internal commands, waits, and operation Promises do not register with the execution or acquire fatal-reject actions. Common resumptions simply return when `fatalError` is present.
- Delete Cascada's fatal broadcast/cancellation path: `_fatalAbortBroadcasted`, `_abortActiveLaneRuns`, fatal-only `CommandIterator.abort` and `ObserverState.abort`, and `_rejectPendingCommandResultsAfterFatal`. Replace `_throwIfFatalLaneAbandoned` and its callers with the ordinary execution check. Do not bulk-reject internal command results merely because the execution failed; an actually pending result exposed by a public operation already has its outward reject action, while purely internal waits stop if they resume.
- Do not cancel or specially settle native Promises, gates, phases, or synchronous host code. A never-resumed internal wait may remain pending without delaying any pending public result.

### 2. Replace the legacy recoverable representation

- Replace `PoisonedValue`, `PoisonErrorGroup`, `RuntimePromise`, `RuntimeContextError`, `valueWithOrigin`, `createPoison`, `poisonOrReport`, `rethrowPoisonOrReport`, `poisonOrReportedFatal`, `poisonOrRethrow`, `isPoison`, `isRuntimePromise`, the broad semantic `isError`, and compiler-generated wrapper assumptions with kernel `PoisonError`, `CompoundPoisonError`, precise predicates, and the two continuation contracts. Remove poison and resolved-value markers once their remaining non-Error consumers have migrated; retain no forgeable Error marker.
- Rebuild `collectErrors`, `collectThrownError`, and `peekError` on the kernel's complete-collection and Error-query contracts rather than wrapper or generic thenable inspection. A kernel `QueryReflectionFailed` outcome propagates as poison through Cascada's `is-error` and collection paths; it is never coerced to Boolean `true` or inserted into a collected Error list. Keep `poisonIfNaN` and `handleLoadFailure` only as thin higher-runtime causal boundaries that construct or preserve direct poison.
- Map every old Error kind to the authoritative contract-based `ERROR_KIND` table. Treat `UserCallThrew` as a call-site split: selected host Function/method failures use `HostCallFailed`, while callbacks and comparators owned by controlled operations use `ControlledCallbackFailed`. Delete transport-named aliases in the same cutover rather than keeping compatibility kinds.
- Update compiler-generated catches and async boundaries. A language-outcome channel preserves expected poison; a runtime-only callback, cleanup, scheduler, or bookkeeping escape is fatal even when the escaped object is poison.
- Replace source-sorted compound children and cause-based deduplication with semantic collection order and exact-leaf deduplication. Remove stored `.kinds`; derive any distinct-kind presentation from the leaves in first-occurrence order. Keep sorting and grouping only in a separate diagnostic view.
- Remove copying of arbitrary enumerable cause properties and eager cause-stack reads during Error construction. Preserve the exact cause reference; diagnostic formatting may inspect it later under its protective boundary.
- Keep load-failure policy and discarded-expression Promise handling above the kernel. Cascada owns every Promise it creates and every kernel result it buffers, schedules, or discards instead of returning; attach handling at that exact producer, storage, or discard site. Do not introduce a generic fatal-versus-recoverable policy hook or recursively inspect discarded graph values.

Audit the higher runtime against this exact causal inventory; existing poison reaching any row propagates unchanged, while only a raw failure caused by that row receives its kind and operation source:

| Cascada causal boundary | Kind |
| --- | --- |
| BigInt division or remainder by zero | `DivideByZero` |
| Requested binding absent after a successful module load | `ImportBindingMissing` |
| Operator operands violate that operator's supported type contract | `IncompatibleOperands` |
| Loop concurrency limit is outside the accepted numeric modes | `InvalidConcurrentLimit` |
| Value cannot be emitted by the text-output contract | `InvalidTextValue` |
| Iterator acquisition, advancement, or yielded-value consumption fails | `IteratorFailed` |
| Import, include, or component loading fails under configured nonfatal load policy | `LoadFailed` |
| A numeric operation produces forbidden `NaN` | `NaNResult` |
| Value cannot satisfy the requested destructuring form | `NotDestructurable` |
| Value cannot satisfy the requested iteration or membership form | `NotIterable` |
| Lexical/context lookup cannot find the requested variable | `UnknownVariable` |

If a runtime feature no longer has one of these semantics, remove its kind from both this inventory and the authoritative table instead of retaining an unused compatibility value.

### 3. Preserve diagnostics without kernel coupling

- Represent source as an immutable opaque handle backed by Cascada's compact context tables. Remove `renderState` from the context tuple and diagnostic stack frames, and remove `getRenderState`, `isFatalReported`, and `throwReportedFatal`; kernel graph code must not depend on the source shape or recover execution authority through it. Replace mutating context helpers such as `setContextLabel` and `mergeAddedContext` with builders that return a new immutable handle; freeze or otherwise make the compact tuple and added-context payload immutable once published.
- Add one explicit diagnostic formatter adapter that accepts immutable kernel Error facts, optional async diagnostic routes, and exact causes. It may produce bounded compound views, source-formatted messages, and diagnostic stacks outside graph transitions under protective catches.
- Implement the settled public split: kernel Errors expose only `name`, unformatted `message`, opaque `errorContext`, optional exact `cause`, poison `kind`, and compound-only `.errors`. Replace legacy `_errorContext`, expanded `context`, `fullMessage`, `totalErrorCount`, `kinds`, `getInfo`, and per-location fields with the separate immutable diagnostic view where Cascada still needs presentation. Do not decorate the frozen kernel Errors or leave accidental compatibility properties on them.
- Formatter or reporter failure never changes the Error, execution state, or delivered result.

### 4. Reconcile public API and platform support

- Export recognition APIs without allowing public code to forge runtime-attributed Errors, arbitrary kinds, or sources. Preserve `instanceof` only if construction remains protected.
- Raise Cascada's Node floor to `>=24`, matching this package, and require browser environments that provide native `Error.isError`. Use that native predicate directly; do not add an approximate compatibility fallback. JavaScript has no portable substitute with the same cross-realm, spoof-resistant, hook-free semantics, so older Node and browser environments are outside the supported platform contract.
- Update public types to express `T | PoisonError | Promise<Awaited<T>>`, where the Promise rejects with poison or fatal Error and never fulfills with poison.
- Replace `markValuePromiseHandled` and any equivalent recursive scan with the explicit ownership split: the kernel owns its constructed and derived Promises until immediate consumption, delayed handled storage, or outward transfer; Cascada owns compiler-, loader-, iterator-, buffer-, and scheduler-created Promises plus any kernel result it does not return; the host caller owns a returned public Promise. Keep `markPromiseHandled` only where a known producer's semantic consumer attaches later, and apply it to the derived Promise as well as its source when needed. `observeDiscardedExpression` handles the exact discarded result at the compiler-emitted discard site. Never traverse unused host input or a discarded graph looking for Promises. Extend the standing Promise inventory across both repositories and remove broad safety-net scans after every producer and transfer is classified.
- Remove all temporary adapters after the compiler, runtime, diagnostics, and public API use the final model.

### Verification

- Two simultaneous renders route fatal failures only to their own reporters and retain independent authoritative Errors.
- A fatal while any public operation result is pending rejects it promptly, including behind a never-settling dependency. A result delivered first remains delivered while a later detached fatal is queryable and reported.
- Every ready public result remains ready and incurs no outward wrapper, rejection registration, or microtask. A render whose outward results are all ready keeps an empty registration Set. Immediate non-blocking returns also remain direct. Error recognition precedes thenability, so ready poison is not accidentally assimilated merely to observe fatal state.
- Cascada starts no command or host effect after closure, does not cancel or specially settle source Promises, gates, or phases, and ignores late operation work at common continuation checkpoints. An internal wait may remain pending without delaying any public operation result.
- No fatal broadcast flag, iterator-abort sweep, bulk pending-command rejection, or shared fatal Promise remains. Actually pending public results are the only registered outward fatal-delivery obligations, and repeated settled results leave the Set empty.
- Ready and pending poison have identical kind, source, graph effect, and public behavior across compiler-generated control flow, callbacks, calls, import, export, and mutation.
- No legacy Error wrapper, Promise subclass, separate fatal Boolean/latch, report state, transport kind, attribution property, or compatibility path remains.
- Compact contexts, diagnostic routes, cause stacks, bounded compound display, and formatter-failure isolation retain their intended behavior.
- Every compiler-emitted kernel call carries an operation context from the current render's table. Repeated execution of one exact static source reuses its immutable carrier; distinct source handles remain distinct; no diagnostic handle retains or recovers `RenderState` or execution authority.
- Cascada internal graph work imports only the trusted integration subpath and creates no outward wrapper or pending-result registration; each host-facing render result is exposed exactly once.
- The standing Error, result-exposure, and Promise-ownership inventories cover both repositories and fail on unclassified additions. Discarded expressions and every stored or fire-and-forget higher-runtime Promise have one exact owner without recursive Promise scanning.
- The complete Node and browser test matrix passes under the documented support policy.

Update Cascada runtime and compiler documentation, kernel integration documentation, public API and type documentation, Error examples, and the supported-platform matrix.
