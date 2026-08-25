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
- Scope leases to actual pending use. Controlled argument preparation releases its receiver before invocation; a controlled method that continues reading its receiver owns that lease itself. An independent controlled result never prolongs receiver protection. Exported host inputs release managed source leases when export finishes; a returned host Promise retains only exact external ordering resources that host code may still use.
- Ready `assignPath` and `deletePath` failures return their Error. Successful and suspended calls return `undefined`; later poison is published in the graph without a hidden result rejection.
- Internal bookkeeping observers handle their own failures and leave no unhandled rejection.
- `combineErrors` deduplicates top-level Error identities in supplied order, returns one unchanged, and combines several without flattening an existing `.errors` payload. Each caller supplies its message; export retains `export: branch contains errors`.

### Verification

- A selected observation executable that throws synchronously returns its Error. A selected mutating executable that throws synchronously also poisons its receiver.
- A rejected graph Promise poisons its captured property version. An operation that observes that transition produces the Error, while `hasError`, `getErrors`, and other Error consumers produce their declared results.
- A Promise returned by supported data or host execution preserves fulfillment and rejection and changes no graph state merely because it rejects or fulfills with an Error.
- Ready `assignPath` and `deletePath` failures return an Error; successful and pending work returns `undefined`, with no hidden derived rejection.
- Direct and delayed synchronous invocation failures produce the same graph and Error result.
- Runtime bookkeeping observers do not replace the public result or create additional unhandled rejections.
- Pending controlled arguments preserve the captured receiver until invocation. A captured independent result does not force later mutation to copy that receiver, while an ordered search that continues reading after a pending element does.
- Whenever preparation supplies one Error to combination, it propagates unchanged; several preserve every distinct top-level identity and their supplied order without flattening existing payloads. Common call preparation discovers them across mixed ready and pending inputs.
- Export and later consumers use the same Error-combination utility.
- `enter` callback throws and callback-Promise rejection remain fatal trusted-transition failures.

Phase 6 supersedes unchanged Promise transport for host results whose fulfillment must cross the import boundary. Such a direct result is adopted by one operation Promise whose fulfillment completes import; its rejection outcome remains unchanged.

[`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and [`export-error-set.md`](export-error-set.md) record the completed behavior.

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

[`registered-class-invocation.md`](registered-class-invocation.md) defines this boundary together with the direct-Promise lifetime added in Phase 8; Phase 5's implemented call itself is synchronous.

#### 1. Establish the common invocation lifecycle

Record, Array, String, registered-class, and unsupported receiver selection use one invocation lifecycle. Replace the internal Array-mutation Boolean with an observation-or-mutation request interpreted after receiver classification. The lifecycle coordinates category-owned method selection, selected input preparation, leases, ordered Error collection, one invocation, mutation publication through `transformProperty`, result admission, and cleanup. Each receiver category defines its selection rules, capabilities, and consumed state. Preserve controlled Array methods' selective input preparation.

Before pending work can retain a source, lease every reached record, Array, and registered instance. Acquire further leases as required Promise resolution reveals identities, and release each lease after the operation's last access. Host calls consume every explicit argument, while controlled methods consume only the branches selected by the method. Resolve and inspect every consumed input even after finding an Error, and preserve receiver-then-argument Error order independently of Promise settlement.

#### 2. Prepare registered-class calls

One registered-class receiver-category module follows [`registered-class-invocation.md`](registered-class-invocation.md). Registration rejects prototype-chain accessors before recording the class. Method-behavior restrictions are trusted except for the receiver and result validation specified below; the boundary adds no snapshots, comparisons, or scheduling instrumentation to detect violations.

After registered-class method selection succeeds, prepare every explicit argument and the complete receiver graph in one operation-local state through existing property-version continuations. Preserve aliases and cycles across materialized inputs and expose logical values without changing imported storage. Observations use leases without a gate; pending mutations use the ordinary receiver gate.

#### 3. Isolate registered-class mutations

The [pre-call isolation and mutation lifecycle](registered-class-invocation.md#receiver-mutation) is:

1. During preparation, lease every traversable identity reachable through any argument; keep those leases through finalization and release receiver-only preparation leases.
2. Isolate the prepared receiver once with one fresh copy map. Copy the receiver root when the ordinary mutation context must preserve it because an ancestor path was copied; otherwise use a predicate composed from ordinary identity COW protection, bookkeeping invalidated by direct JavaScript mutation, and Array materialization.
3. Materialize arguments once for host representation, applying copied receiver identities to argument roots and nested paths during that same walk.
4. Invoke once and synchronously.
5. Walk the final receiver once: reject any Promise or Error, admit new identities as runtime-owned, and mark each actively leased traversable identity shared; every other identity remains exact. Allocate no finalization copy or separate source-identity collection.
6. Return the final working receiver as `mutatedValue`; let `transformProperty` decide whether publication is required and release all argument leases after finalization.

Use one metadata-free complete-graph copier for qualifying isolation subgraphs and, with a separate forced-root map, registered-class results. Preserve aliases, cycles, and registered-class prototypes while keeping opaque identities and Functions exact; materialize every logical Array as an unattached native Array with the same logical structure. Reconnect isolation copies through ordinary placement replacement. Preparation failure, final receiver failure, or a synchronous throw poisons the receiver through the common mutation transition.

#### 4. Admit results and classify failures

Return the published receiver when a mutation returns `this`; otherwise copy and admit traversable results as specified by the [result contract](registered-class-invocation.md#results). Promise-valued result data becomes an independent validation Error and is never awaited. A valid mutated receiver still publishes. Runtime invariant failures and host-contract violations exposed at existing boundaries remain fatal; an explicitly returned Error remains an ordinary result.

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

The implemented behavior is documented in [`registered-class-invocation.md`](registered-class-invocation.md), [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), and [`run.md`](run.md).

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
- A matching request for admitted state returns the exact value without another walk; a conflicting request returns a validation Error.
- An identity declaration overrides a class rule; in particular, `externalState(instance)` overrides `managedStateClass(instance.constructor)`.
- A conflicting identity declaration, or one conflicting with an admitted category, returns a validation Error without changing existing state.
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

A Promise fulfilled from either boundary continues that same import; it is not another boundary case. Phase 8 routes managed-method results through this importer. Phase 10 does the same for external calls and property reads. Neither phase adds another inbound walk.

Do not import Chain construction from existing Cascada data, assignment, return, or internal transfer. Those operations preserve admission, origin, and ownership. External identities remain observation-only until Phase 9 adds mutation authority and ordering.

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
- An already admitted identity, including unexported data returned by another Cascada execution, keeps its category and origin. Retain it without another graph walk and mark it shared only when the result adds an owner.
- Imported physical storage keeps its Promise. The mirror publishes logical settlement without imported writeback; runtime-owned storage keeps ordinary writeback.

Reflection and failure rules are:

- Enumeration and descriptor lookup remain at their existing user-code boundary.
- Do not invoke ordinary accessors or inspect non-enumerable properties.
- An import-walk enumeration or descriptor failure commits no origin, sharing, or Promise mirror from that synchronous segment.
- Boundary failures become language Errors; internal failures remain fatal.

Delete the superseded imported/runtime split and its supporting machinery: runtime-island detection, `hasOperationalMetadata`, `promoteRoot`, the runtime walk, `runtimeScanned`, `metadataBeforeRuntimeScan`, `discoverRuntimePromise`, the root/result preparation split, host-change reconciliation, and import-specific ArrayView handling.

Phase 7 adds the matching outbound boundary without reopening admission. Phase 10 reuses this importer for external operations.

### Verification

#### Declarations and admission

- Records and Arrays default to managed. `externalState` makes the exact record or Array external. An undeclared class instance defaults to external.
- Successful declarations return exact arguments, are atomic across nested classes, aliases, cycles, conflicts, and prototype validation, and never wait for Promises. An Error argument is returned unchanged; a nested Error ends only its `managedState` walk branch.
- A matching declaration request for admitted state returns it without rescanning its graph.
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

Update [`AGENTS.md`](../AGENTS.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`data-classes.md`](data-classes.md), [`import-preparation.md`](import-preparation.md), [`array-view.md`](array-view.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 7: Centralize outbound export

### Problem

Export is scattered across host-call categories, including a shallow Array-override receiver path. This duplicates availability resolution, copying, and lease lifetime decisions at each outbound boundary.

### Design

[`managed-and-external-state.md`](managed-and-external-state.md) defines the complete inbound and outbound boundary architecture shared with Phase 6.

### 1. Use one export boundary

Use one exporter and one graph copier for:

- every explicit argument passed to native JavaScript, including managed record and managed-class methods;
- every receiver that its selected host boundary consumes;
- every value assigned to an external property; and
- every public script result.

Runtime-controlled methods, including supported Array methods, remain the exception: they consume logical Cascada values directly.

The common export walk:

- Resolves every value the selected boundary consumes.
- Removes runtime representations.
- Copies managed records, Arrays, and class instances into independent host data.
- Preserves aliases, cycles, and admitted prototypes.
- Keeps Functions and external identities exact.
- Produces no unresolved language Promise or internal representation.

No host category may own another importer, exporter, graph copier, or availability resolver.

### 2. Keep two Error policies

Use the same copier with two named policies:

- **Host-input export:** preserve nested Errors; a consumed top-level Error prevents invocation or assignment.
- **Public-result export:** consume and combine every reached Error.

Do not duplicate the walk or generalize these two concrete policies into a strategy layer.

### 3. End source leases at export completion

- Lease managed sources only while export may still read them.
- Release every source lease when export finishes, before host invocation.
- A returned host Promise may retain exported copies and exact external identities, but never extends leases on managed sources.
- Phase 10 independently keeps required external identity phases through settlement.

Export records no external use and grants no external mutation authority.

### 4. Replace Array-override preparation

Move Array overrides onto common host-input preparation:

- Export the complete override receiver and every explicit argument required by the boundary.
- Give the override one native Array containing no ArrayView, unresolved language Promise, or original managed traversable identity.
- Import its result through Phase 6's host-result boundary. Returning the exported receiver therefore returns its imported host value, not the logical source receiver.
- Delete override-specific receiver selection through `requiresArrayMaterialization` and its receiver-lease inference.
- Retain `requiresArrayMaterialization` only for representation mutation and COW.
- Preserve controlled Array behavior and eligible backing reuse, including observation methods such as `concat`.
- Never use imported Array storage as mutable ArrayView backing.

Method selection remains unchanged:

- An own enumerable Function shadows a standard Array method.
- An override is observation-only; reject mutation through it.
- Reject a native Array mutation requested in observation mode.
- Same-named managed methods and controlled Array methods retain their category semantics.

### 5. Reuse the matching inbound boundary

- Every host result uses Phase 6 import, including its operation Promise for a direct Promise.
- Every public script result uses common export.
- Phase 10 adds external argument guards around the exporter without adding a guard-specific export path.

### Needs your decision

The planned and implemented class-export contracts conflict:

- This phase currently requires: "Export resolves required availability, removes runtime representations, and copies managed records, Arrays, and class instances into independent host data while preserving aliases, cycles, and admitted prototypes."
- The implemented [`data-classes.md`](data-classes.md) contract says: "Registered-class instances export as plain data without prototypes, methods, registration, or metadata."

Decide whether both host-input and public-result export preserve admitted class prototypes, both return plain data, or the two boundaries intentionally differ. Until then, retain the prototype-preserving requirement above and do not infer a resolution from the current implementation.

### Verification

#### Boundary behavior

- Every native JavaScript argument, external-property assignment, and public result uses common export. Managed methods use it; runtime-controlled methods do not.
- Host-input export preserves nested Errors and stops on a consumed top-level Error. Public-result export consumes and combines every reached Error through the same copier.
- Exported managed data is independent and contains no unresolved language Promise or internal representation. Functions and external identities remain exact; export records no use or authority.
- Managed source leases end when export finishes. A returned host Promise retains no managed source lease.
- Host results use Phase 6 import; no host category adds another boundary walk.

#### Array overrides

- Common preparation exports every consumed receiver and argument.
- An Array override receives one complete native Array, and returning it produces its imported host value rather than the logical receiver.
- Overrides remain observation-only; managed methods and controlled Array methods retain their category behavior.
- Removing override-specific materialization inference changes neither controlled Array behavior nor valid backing reuse.

Update [`AGENTS.md`](../AGENTS.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`data-classes.md`](data-classes.md), [`array-view.md`](array-view.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 8: Generalize managed invocation

### Problem

Managed record functions cannot use their containing state as `this`, while registered-class invocation is already the required managed-state boundary. Managed methods also reject Promise results instead of treating a direct Promise as the call's completion.

### Design

Generalize Phase 5 instead of adding another invocation path.

#### Rename

- Rename **registered-class invocation** to **managed invocation**.
- Rename its module and architecture document at the same time.
- Use managed invocation for managed records and managed class instances.
- Keep no compatibility module or document alias, and add no record-specific invocation path.

### 1. Select managed methods

For a managed record:

- Treat each own enumerable string-keyed data placement as a possible method placement.
- Capture and prepare its logical property version before testing callability. A Promise-backed placement is therefore interchangeable with its resolved Function.
- Invoke a selected Function with the prepared record as `this`.
- Do not expose inherited properties, accessors, non-enumerables, or resolved non-Functions as methods.
- Keep a Function as data outside a supported call position.

Managed classes retain Phase 5 prototype method selection and the managed-class state contract.

### 2. Share one invocation lifecycle

Both receiver forms reuse Phase 5's receiver preparation, leases, mutation isolation, validation, publication, and cleanup. Change only the boundaries that later phases centralize:

- Replace registered argument preparation with Phase 7 export.
- Replace independent result copying with Phase 6 import and ordinary shared ownership.
- Keep runtime-controlled methods on their existing logical-input preparation.

The common pre-call lifecycle is:

1. Select the managed method.
2. Prepare the complete receiver graph and argument sources, resolving captured Promise versions and consuming receiver Errors.
3. Complete required external phases.
4. Complete the common pre-invocation work: export every explicit argument and isolate a mutating receiver.
5. Invoke exactly once.

The method receives independent managed argument copies with admitted prototypes. Functions and external identities remain exact. The method may mutate, retain, or return exported managed data without changing its Cascada sources. Exact external identities remain subject to their guards.

Managed state may contain Promises or Errors between calls. The prepared receiver contains neither, and a completed mutation receiver may contain neither.

The complete receiver graph is the call's explicit work bound. Preparation, mutation isolation, and finalization may each traverse it, but no call walk may enter unrelated graph state.

### 3. Apply trusted method contracts

- The caller's mode is authoritative: an observation method does not mutate its receiver; any method that may mutate it runs in mutation mode.
- Managed code may access exported inputs and, for a mutation, its isolated receiver until the direct Promise settles.
- Every asynchronous access or effect belongs to work represented by that direct Promise and finishes before settlement.
- Detached work and Cascada reentry during an active invocation are forbidden. Do not add async-context tracking to enforce this contract.
- A Promise nested in a synchronous result may not later access the receiver or inputs.
- A nested call such as `this.increaseBy(1)` is ordinary JavaScript on the already prepared receiver, not another Cascada invocation.

### 4. Complete observations

For an observation:

- Lease every traversable receiver identity through the direct Promise's settlement.
- End argument-source leases when export finishes, before invocation.
- Let later mutation proceed through COW without waiting; do not add a readers-writer phase.
- On fulfillment, import the result and give retained managed identities ordinary shared ownership.
- On rejection, preserve the rejection and leave the receiver unchanged.
- Release receiver leases after the last access on every completion path.

### 5. Complete mutations

For a mutation:

- Keep the isolated receiver private behind the ordinary transition gate.
- End receiver-source preparation leases when isolation begins.
- End argument-source leases when export finishes.
- A synchronous result validates and publishes the receiver immediately, then imports the result.
- A direct Promise keeps the receiver private. On fulfillment, validate and publish the receiver once, then import the result.
- If the result is the working receiver, return the published receiver with ordinary result ownership.
- A receiver validation failure poisons the receiver and becomes the fulfilled operation result.
- Rejection poisons the receiver as a mutator throw while preserving the rejection outcome.

For every managed call:

- Return one operation Promise for a direct Promise result.
- Treat a Promise nested in a synchronous result as independent data. Return immediately and let its retained result placement continue import later.
- Import all results and mark retained admitted identities shared rather than copying them.

### Verification

#### Selection and reuse

- Ready and Promise-backed own enumerable Function placements receive the prepared record as `this`. Inherited, accessor, non-enumerable, resolved non-Function, and extracted Function values remain unavailable as record methods.
- `this.helper()` mutates the already isolated receiver and publishes only through the outer invocation.
- Records and classes share one preparation, export, isolation, validation, result, and cleanup path.
- The caller's mode matches method behavior.

#### Promise lifetime and protection

- A direct-Promise observation holds receiver leases but no readers-writer phase. Exported arguments retain no source lease, and later mutation uses COW without waiting.
- A direct-Promise mutation remains private behind one gate. Later operations wait; fulfillment validates and publishes once; rejection poisons the receiver while preserving rejection.
- A completed mutation receiver containing a Promise or Error fails validation. A direct result Promise extends the invocation; a nested result Promise does not.
- Receiver and export-source leases balance after fulfillment, rejection, validation failure, and argument export.
- Direct fulfillment uses common import and shared ownership in FIFO order.
- A synchronous result containing a nested Promise returns immediately; its retained placement imports later fulfillment.
- Direct-Promise work may use prepared receiver and arguments until settlement but may not reenter Cascada. Later detached or nested-result access remains a trusted-contract violation, not an instrumented restriction.

Update [`AGENTS.md`](../AGENTS.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`registered-class-invocation.md`](registered-class-invocation.md), [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 9: Establish context external ordering

### Terms

- **Context Chain:** a Chain holding a host-provided context root.
- **Compiler-static path:** a path whose segments are all compiler-known Strings or Numbers. A computed or Promise-valued segment is dynamic even when ready.
- **External occurrence index:** a per-context-Chain index from normalized paths to synchronously reached external identities. Indexing storage is not identity use.
- **Actual use:** lookup, receiver access, property access, or argument use that reaches an external identity. Import, export, assignment, return, and storage are not uses.
- **Fixed external location:** the one compiler-static `(context Chain, normalized path)` authorized by an external identity's first valid mutation.
- **External phase:** readers-writer state attached to an exact external identity. Observations after a mutation wait for it and may overlap one another; the next mutation waits for those observations.

### Problem

Exact external identities need readers-writer ordering because managed COW, leases, and transition gates cannot protect their host state. Mutation must also remain limited to one compiler-static path of one context Chain.

### Design

[`external-context-ordering.md`](external-context-ordering.md) is the detailed architecture.

### 1. Add one external phase mechanism

Implement one readers-writer mechanism for exact external identities. It owns:

- synchronous successor publication;
- predecessor waiting;
- concurrent observation groups;
- exclusive mutation and repair;
- async-child reservations; and
- completion, including direct-Promise boundary processing.

Keep graph publication and poison at their natural owners. Do not infer external ordering from managed graph state or add another command scheduler.

Use three external operation modes:

- `OBSERVE`: unmarked external access; joins a concurrent read phase.
- `MUTATE`: `!`; waits exclusively and may mutate exact selected host state.
- `REPAIR`: `!!`; waits exclusively, bypasses existing poison, and may clear it.

Keep Boolean Chain and `enter` capabilities where they express only read versus write. Expose one bulk external phase-entry boundary to external commands, async control flow, `enter`, and Phase 10 operations.

### 2. Build and maintain the context index

Phase 9 integrates context construction with Phase 6 import:

1. Mark the Chain as a context Chain.
2. Import its host root through the common importer.
3. During the synchronous import walk, index every reached external occurrence by normalized Chain path.
4. Maintain the index when ordinary context graph transitions add, remove, or move an occurrence.

Use the smallest integration point that owns these four steps. Do not add a second importer or pin a public context-construction API in this plan.

The index:

- Answers exact, longest-prefix, and descendant queries.
- Stores occurrence paths only, never use, authority, ownership, or phase state.
- Lets ready operations select external dispatch before managed COW.
- Lets unresolved suffixes conservatively select every external identity they may reach.
- Does not record actual use merely because an identity was imported, indexed, assigned, returned, exported, or stored.

Several context Chains or paths may store the same external identity. Storage alone leaves it unused; actual use determines whether mutation remains possible.

### 3. Record use and fix one mutation location

Every operation supplies its Chain, normalized path, and compiler-static-path fact before graph work. The compiler supplies only generic path staticness; runtime admission still determines whether the reached identity is external.

Use one execution-scoped `WeakMap` with these states:

- no entry: unused;
- `{ usedInContextChain, usedAtPath, allUsesStatic, mutationAuthorized }`: used only at one context location;
- `OUTSIDE_CONTEXT`: used only outside context; or
- `MULTIPLE_USE`: used at different context locations or both inside and outside context.

The object state is **fixed** when `mutationAuthorized` is true. Once `allUsesStatic` becomes false, it never becomes true again.

Record lookup, receiver access, property access, and argument use before host access. Apply this transition:

```text
recordUse(current, chain, path, isStatic):
  if current is fixed:
    same chain + same path + isStatic -> keep fixed state
    otherwise                         -> return validation Error; keep fixed state

  if current is unused:
    context use     -> record chain, path, isStatic, mutationAuthorized = false
    non-context use -> OUTSIDE_CONTEXT

  if current is one unfixed context location:
    same chain + same path -> allUsesStatic &= isStatic
    another location       -> MULTIPLE_USE

  if current is OUTSIDE_CONTEXT:
    non-context use -> OUTSIDE_CONTEXT
    context use     -> MULTIPLE_USE

  if current is MULTIPLE_USE:
    keep MULTIPLE_USE
```

A mutation records its use first, then validates authority:

```text
if state is one context location and allUsesStatic:
  set mutationAuthorized before host access
  this Chain and path become the fixed external location
else:
  return validation Error
  poison the selected external phase
  do not invoke host code
```

After the first valid mutation, every later use must be compiler-static at that exact Chain and path. A conflicting use returns a validation Error before host access and does not alter the fixed state. Phase and use state are local to one execution.

Any mutation rejected by this state machine, including one attempted through a different location after fixation, poisons every selected mutation phase without host access. An incompatible observation returns its validation Error without poisoning.

### 4. Select and enter phases before graph work

- An exact external operation selects its reached identity directly.
- A context `!` prefix selects indexed external identities at or below its path.
- Give each exact identity one phase state. Duplicate selections join that phase but never redirect access or grant alias authority.
- Classify external dispatch before managed COW, transition gating, receiver preparation, waiting, export, or host reflection.
- Exact external dispatch uses neither managed COW nor a transition gate. Managed work outside selected external identities remains unchanged.
- Register every selected receiver and argument phase when the operation enters the graph API.
- Publish all Chain and external successors before waiting for any predecessor.
- Let observations after one mutation share a read phase. The next mutation waits for that whole group.
- Never make entries created by one operation wait on one another.
- When duplicate selections differ only by `OBSERVE`, keep the exclusive `MUTATE` or `REPAIR` mode.
- Keep a direct Promise in its phase through boundary completion; a nested result Promise does not extend it.

### 5. Reserve phases across async children

Before an async condition, loop, or `enter` suspends:

1. Query every affected context path.
2. Reserve each indexed external identity phase that the child may use.
3. Let child operations enter child-local phase state so they do not wait on their own reservation.
4. Release the reservation after the child drains.

Apply this recursively. Empty and unrelated children do not block other work.

### 6. Support deep external state without scanning it

- Allow traversal and mutation below external identities.
- Record an external identity only when an operation reaches it.
- Never pre-scan an external graph or compare external descendants for aliases.
- A `!` source guards the exact external receiver or argument and the hidden host state it encapsulates.
- Independently scheduled external roots must not share mutable hidden state. A later-discovered alias cannot retroactively join an earlier phase.
- Ordering is execution-local; the host owns concurrency between executions.

### 7. Store poison and repair it in phase order

- Store poison in the execution-local phase state associated with the exact identity's metadata, never in application data and never by replacing the identity.
- Existing poison contributes its Error at the selecting receiver or argument position. Complete required preparation, then skip host code.
- Observation failure does not poison.
- Mutation failure or rejection records its combined Error on every selected mutation phase after predecessors finish. Preserve completed host effects.
- Dynamic, `OUTSIDE_CONTEXT`, and `MULTIPLE_USE` mutation poison without host access.
- `!!` enters phases normally in `REPAIR` mode, bypasses only existing poison, and clears selected poison on success.
- Repair never changes use history or mutation eligibility.

### 8. Remove superseded sequencing

Delete every hidden sequence Chain and duplicate scheduler. Add no compiler external classification, special importer, external graph model, second invocation coordinator, or second phase algorithm.

### Needs your decision

- **Duplicate mode merge:** retain the requirement that "duplicate identity entries merge at the strongest mode." The precedence and poison behavior when one operation selects the same identity with both `MUTATE` and `REPAIR` are not specified. `OBSERVE` is shared; both `MUTATE` and `REPAIR` require exclusive entry.

### Verification

#### Index and authority

- Context construction and later context transitions index external occurrences without recording use. Storing one identity at several paths or in several context Chains leaves it unused.
- Use follows the complete state transition above. Repeated use at one static location is stable; dynamic, outside-context, different-path, different-Chain, and mixed use have their specified sticky outcomes.
- Only one compiler-static context location may reach host mutation. The first valid mutation fixes it; every incompatible later use fails before host access without changing the binding.
- Each index answers exact, longest-prefix, and descendant queries without storing use or phase state.

#### Ordering

- Duplicate identity selections join one phase without granting alias access.
- Observations wait for the previous mutation and overlap one another; the next mutation waits for the group even if one of those observations made the identity mutation-ineligible.
- External phase entry occurs at graph-operation entry without self-wait or acquisition-order deadlock. Executions share no use or phase state.
- Exact external work avoids managed COW and transition gates. Other managed behavior remains unchanged.
- Async children and `enter` reserve indexed identities before suspension and use child-local phases. Nested, empty, and unrelated children remain independent.

#### Failure and removal

- Existing poison prevents host invocation. Observation failure does not poison. Mutation failure or rejection preserves completed effects and poisons every selected mutation phase. Repair clears phase poison but not use history.
- `OBSERVE`, `MUTATE`, and `REPAIR` are the only external modes; Boolean read/write capabilities remain Boolean.
- No hidden Chain, compiler external classification, special importer, external graph model, second invocation coordinator, or second phase algorithm remains.

Update [`AGENTS.md`](../AGENTS.md), [`external-context-ordering.md`](external-context-ordering.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`enter.md`](enter.md), [`runtime-spec.md`](runtime-spec.md), the Chain operation API, compiler lowering, and path-operation documentation.

---

## Phase 10: Implement ordered external operations

### Problem

External state needs property and method observations plus explicit mutation of ordinary or hidden host state. Phase 9 provides actual-use validation and identity phases; Phase 10 applies them at the common host boundary.

### Design

Treat each external identity as one exact host resource:

- Never graph-traverse, copy, or materialize external state.
- Allow observation wherever Phase 9 use-state rules permit it.
- Allow mutation only through the fixed external location.
- Do not search for shared internals; hidden mutable sharing between independently scheduled roots remains a host-contract violation.

### 1. Dispatch before managed graph work

At graph-operation entry:

1. Use the reached identity or context Chain's occurrence index to classify external versus managed dispatch.
2. Select all currently known receiver and argument identities.
3. Record their actual locations and compiler-static-path facts.
4. Bulk-register their external phases.
5. Only then perform managed COW, transition gating, waiting, export, or host inspection.

An indexed occurrence or exact external receiver selects external dispatch without COW or a transition gate. A same-named managed, Array, or String operation retains its category behavior.

Select Phase 9 modes consistently:

- Unmarked external property reads and method calls use `OBSERVE`.
- `!` uses `MUTATE`.
- `!!` uses `REPAIR`.
- A ready computed path may observe, but is dynamic and cannot establish or use mutation authority.
- Phase 11 applies the same rule after Promise-valued path segments settle.

### 2. Reuse the common invocation coordinator

Reuse Phase 5's coordinator for Error collection, member selection, invocation, result admission, category completion, and cleanup. Pass it the captured external phase scope. Add no external-specific coordinator, queue, Error collector, graph copier, importer, exporter, availability resolver, or preparation path.

An external call follows this lifecycle:

1. Register known receiver and argument phases at graph-operation entry.
2. Wait for phase predecessors.
3. Export every explicit argument and collect its Errors before inspecting host state.
4. If preparation is clean, traverse the host suffix. Before further access to each newly reached external identity, record its use, enter its phase, retain previously selected phases, wait for its predecessor, and validate mutation eligibility.
5. Perform descriptor or proxy reflection on the final receiver and invoke a getter at most once.
6. Prepare a selected call candidate by resolving readiness, propagating Error, and testing callability. Do not import the Function as graph data.
7. Invoke exactly once, then import the property-read or call result.
8. Complete poison handling and release phases after boundary completion.

If preparation fails, perform no host reflection and invoke no getter, setter, or method. Constructors remain unsupported.

### 3. Keep external-property data external

When property traversal reaches a new identity:

- Keep it external, including a record or Array.
- Record its own use history.
- Continue under the selected external boundary without adding another path walker or nested guard.

If the reached identity already has managed admission metadata:

- Return an Error.
- Poison the external container's phase without replacing either value.
- Inspect only the property reached; never scan other external properties for managed identities.
- Repair may clear the poison, but the same property poisons the container again when next reached.

A host-call result is different: common import may admit separately declared, default-managed, or previously admitted managed data.

### 4. Import reads and export writes

Property operations use the common boundaries:

- **Read:** access exact host state, then import the property value.
- **Write:** export any supported value before native assignment or setter execution. A consumed top-level Error prevents the write.
- **Delete:** perform native deletion and return its Boolean result.

For writes:

- Managed records, Arrays, and class instances become independent host copies under Phase 7's prototype decision.
- Functions and external identities remain exact.
- A native setter must complete synchronously.
- Successful assignment returns the captured logical right-hand value, not a value reread from the host property.

### 5. Guard external arguments

Every explicit argument source supplies its Chain, normalized path, and optional `!`:

- The source covers every external identity reached beneath its selected logical value, including inside an exported managed container.
- Record each reached identity's complete source location as actual use.
- An unmarked source enters `OBSERVE`; a `!` source enters `MUTATE` and may establish the fixed external location under Phase 9 rules.
- Discover and register all argument phases before export.
- Export keeps the exact external identity but transfers no mutation authority.
- Apply the same source-coverage rule before passing an external identity to a runtime-controlled callback.

### 6. Enforce host-call lifetime contracts

- An external observation may read ordinary and hidden state but does not mutate it.
- Mutation may change only its phase-protected exact receiver and mutation-borrowed exact arguments.
- A direct Promise keeps every selected identity phase active through fulfillment import or rejection.
- A nested result Promise does not extend the operation or retain later receiver or input access.
- Host code may retain exported data but may not independently mutate an external resource while Cascada may use it.
- Host code may not reenter Cascada during an active direct invocation.
- `!!` repairs phase poison but never changes actual-use history or the fixed external location.

### Verification

#### Dispatch and authority

- Ready external property and method operations remain synchronous.
- Occurrence lookup, classification, use recording, and known phase registration precede COW, gating, waiting, export, and host inspection.
- Mutation reaches host code only after validating the one compiler-static fixed location. A later dynamic or different-location use fails before host access.
- Exact external access avoids managed COW and transition gates; disjoint managed behavior remains unchanged.

#### Properties and calls

- New external-property identities remain external. A reached admitted managed identity poisons only its external container; untouched properties are never scanned. Host-call results may contain admitted managed data through import.
- Repair removes that container poison; reaching the invalid managed property again restores it.
- Every native JavaScript argument and external-property write uses export. Functions and external identities remain exact under selected phases.
- Every supported exported value may be assigned. A top-level Error prevents the write; assignment returns its captured logical right-hand value; deletion returns the native Boolean; setters are synchronous.
- External-call and property-read results share Phase 6 import. Returning or storing an exact identity records no use.
- Phase predecessors and argument export finish before receiver reflection or getter execution. A selected callable is prepared without importing it as data, and poisoned preparation invokes no host code.

#### Lifetime and failure

- Receiver and argument phases register together. Observations wait for the previous mutation and overlap one another; the next mutation waits for the group.
- A direct Promise retains phases but no managed source lease through import or rejection. A nested result Promise does not extend the operation.
- Observation failure does not poison. Failed, rejected, dynamic, outside-context, or multiple-use mutation poisons selected phases while preserving completed host effects. `!!` changes only phase poison.
- Deep external mutation works without graph pre-scanning. Hidden shared mutable state across independently scheduled roots remains a host-contract violation.
- No new coordinator, collector, copier, queue, importer, exporter, resolver, or preparation path exists.

Update [`AGENTS.md`](../AGENTS.md), [`external-context-ordering.md`](external-context-ordering.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-preparation.md`](import-preparation.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), compiler lowering, the path-operation documentation, and the public API documentation.

---

## Phase 11: Support Promise-valued path segments

### Problem

Path walkers currently stringify each segment immediately. They support Promise-backed values encountered along a known path, but a Promise supplied as a key becomes `"[object Promise]"`. Waiting for the key before starting the operation would let later mutations overtake it.

### Design

[`promise-path-segments.md`](promise-path-segments.md) is the detailed architecture.

The **ready prefix** is the longest leading path whose segments and placements are available. The **protected prefix** is that same prefix after the operation acquires the one lease or gate needed to resume safely.

### 1. Consume path segments only when reached

Treat every segment as a String or Number operation input:

- Normalize a ready segment only when traversal reaches it.
- Resolve a pending segment through common Promise and Error preparation, then normalize its fulfillment.
- Return a validation Error for any other ready value without invoking coercion hooks.
- Never stringify a Promise object as a key.
- Stop when the known prefix fails. Do not consume or wait for later segments.

An unused segment Promise remains host-owned. Cascada does not wait for it or attach a rejection observer merely to suppress an unhandled rejection.

### 2. Protect the first pending point once

Walk the ready prefix synchronously. If the complete path is ready, use the existing path and allocation behavior unchanged.

Before registering for the first pending segment:

- An observation leases the longest resolved prefix.
- A mutation installs the ordinary transition gate at that prefix and continues against its private working value.
- Publish the selected external phases and managed lease or gate before waiting for any predecessor.

Resume later segments from the same protected prefix:

```text
for each segment reached:
  if ready:
    normalize and continue
  else:
    register one FIFO continuation on its captured version
    resume from the existing protected prefix
```

Several pending segments share this one scope. Do not nest a lease or gate per segment. Completion releases the observation lease or publishes the mutation gate through ordinary transitions.

A rejected segment or invalid normalized value follows ordinary failure handling at the protected prefix: an observation returns its Error; a mutation applies the ordinary gated mutation failure.

### 3. Reuse common path transitions

Reuse the existing:

- read-lease counter;
- COW predicate;
- transition-gate placement;
- Promise mirrors and FIFO continuations;
- publication transitions; and
- lower-level path transitions already shared with `enter` where their lifecycles are identical.

Do not implement Promise segments by:

- calling `enter` from ordinary path operations;
- constructing temporary Chains;
- adding a key-resolution queue or scheduler;
- adding an operation-specific path preparation flow; or
- changing ready-path allocation or synchronous behavior.

### 4. Protect possible external targets before waiting

For a context Chain with an unresolved suffix:

1. Query the ready prefix in its external occurrence index.
2. Select every indexed external identity that the unresolved suffix may reach.
3. Register each selected phase together with the managed prefix lease or gate before waiting on a predecessor.
4. Treat this conservative selection only as protection, not actual use.
5. After resolution, record only the exact identity and normalized path reached, with a dynamic-path fact.

External observation then proceeds normally. External mutation returns the ordinary validation Error, poisons its selected phase, and invokes no host code because a computed or Promise-valued segment is never compiler-static.

### Verification

#### Segment behavior

- Ready String and Number segments retain current synchronous behavior and allocation. Other ready values produce validation Errors without coercion.
- Promise-valued segments resolve and normalize instead of becoming `"[object Promise]"`.
- Broken ready prefixes do not wait for unused inputs. Unused Promise segments remain host-owned and receive no suppression continuation.
- Segment rejection and invalid normalization follow ordinary Error publication at the protected prefix.
- Root, middle, and final Promise segments work through common walkers for lookup, assignment, deletion, invocation, export, Error queries, and `enter`.

#### Protection and ordering

- A pending observation leases the longest resolved prefix once. Later managed mutation uses COW and cannot change the captured result.
- A pending mutation gates the longest resolved prefix before waiting. Conflicting work cannot overtake it; unrelated paths continue.
- Several pending segments share one prefix scope while preserving aliases, mirrors, FIFO order, and Error identity.
- A context suffix registers every candidate external phase before waiting but records use only for the resolved identity and path.
- Compiler-known ready String or Number segments may participate in external mutation. Computed ready and Promise-valued segments remain dynamic even when they resolve to the same key; external mutation poisons without host access.
- No temporary Chain, direct `enter` call, new queue, operation-specific preparation path, or second scheduler is introduced.

Update [`AGENTS.md`](../AGENTS.md), [`promise-path-segments.md`](promise-path-segments.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), [`enter.md`](enter.md), and the public path-operation documentation.
