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
- Scope leases to actual pending use. Controlled argument preparation releases its receiver before invocation; a controlled method that continues reading its receiver owns that lease itself. An independent controlled result never prolongs receiver protection. Export captures managed inputs without source leases; a returned host Promise retains only exact external ordering resources that host code may still use.
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

Phase 7A adds the matching outbound boundary without reopening admission. Phase 10 reuses this importer for external operations.

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

Phase 7C reuses the exporter for controlled host-callback inputs. Phase 8 reuses it for managed-method arguments. Phase 10 reuses it for external-method arguments and external-property assignments.

Keep `run(chain, path, method, mutation, ...arguments)` through Phase 8. Its rest parameter already supplies one internal argument Array; pass that Array directly to common export. Phase 9 replaces the signature once when it adds repair, compiler-static external-operation facts, and the final argument-Array API.

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
- Batch export combines failed roots in root order without flattening their compound payloads.
- Any reached Error prevents host invocation or assignment and replaces a script result. No Error crosses the host boundary.

Use this one rule for script results, host arguments, controlled callback inputs, and Phase 10 external-property assignment. Add no policy switch or second Error walk.

### 3. Correct lease lifetimes

Keep two lease purposes distinct:

- A **selection lease** protects each ready managed traversable argument root while a pending receiver prevents boundary selection.
- A **call lease** protects a selected managed identity that the call will read later or publish as retained logical data.

Use one small lease-ledger mechanism for both purposes, but keep separate ledgers where last access differs. Selection, receiver, and retained-payload leases cannot share one release point without either releasing protection early or retaining it longer than needed. The export output lifetime is not a lease ledger: it may discard output while the complete Error scan must continue.

When the receiver becomes ready:

1. Select the call boundary.
2. Start selected preparation synchronously. Each input must be captured into export output, protected by any required call lease, or identified as ignored.
3. Release every selection lease immediately after that handoff, whether preparation returned a value, Promise, Error, or threw.

An exported or ignored input keeps no lease after the handoff. A retained controlled-method payload keeps its call lease until publication or abandonment.

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
- Phase 10 independently keeps required external identity phases through settlement.

Export records no external use and grants no external mutation authority.

This is safe because a ready reachable identity is copied during the synchronous transition and later aliases reuse that copy. A value first revealed through a captured mirror was not previously reachable through that placement, so its continuation can traverse it once without rereading earlier source state.

Delete only export's source-retention callback and lease-presence tests. Retention callbacks used by controlled methods for later reads remain call leases. Test snapshot stability while later mutation remains in place.

Export has an open output lifetime. Fatal failure or abandonment closes it and releases partial output and copy state. An already-registered continuation still completes shared Promise-mirror and property-version settlement, then stops before allocating export output, invoking boundary reflection, or publishing an export result. A reached language Error does not close the required Error scan: discard output copies but continue collecting every reached distinct Error. Preserve the captured-frontier, cycle, alias, and distinct-Error behavior documented in [`outbound-export.md`](outbound-export.md).

### 5. Reuse the matching inbound boundary

- Every existing host call uses Phase 6 import for its result, including the operation Promise for a direct Promise.
- Every script result uses common export.
- Phase 8 reuses export and import for managed methods.
- Phase 10 adds external argument guards around export and uses it for external-property assignment without adding another boundary path.

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

## Phase 7B: Close abandoned operation work

### Problem

Promise settlement may outlive the operation that registered it. Shared mirror, property-version, and refcount settlement must continue, but an abandoned continuation must not perform more operation-specific reflection, allocation, protection, invocation, or publication. Export already enforces this distinction by closing at every asynchronous layer before a fatal rejection reaches an aggregate. Error queries and later preparation rewrites need the same rule.

### Design

Use the **Operation Work Lifetimes** contract in [`AGENTS.md`](../AGENTS.md). Unify the lifetime rule, not unrelated resource storage.

### 1. Close operation work once

- Keep one open/closed fact at the natural operation scope.
- Close it synchronously in the transition that determines the final operation outcome, before returning, resolving, or propagating that outcome. An unfinished sibling is then abandoned; add no separate abandonment signal. A direct Promise becomes final only after boundary completion.
- A reached data Error is not necessarily final. A graph-Promise rejection first becomes data Error: `hasError` may finish with `true`, while `getErrors` and export continue their required Error collection. Failure of operation-specific query traversal or indexing is fatal and never becomes collected Error data; a supported failure during shared property publication follows that publication boundary.
- A continuation first completes shared Promise-mirror and property-version settlement, including index maintenance required to publish into an already indexed graph. It then stops if the operation is closed. Index construction or traversal requested only by the query is operation work and does not continue.
- Concurrent preparation components share the operation lifetime, while leases, gates, phases, and output state retain their own last-access and publication rules.
- Release operation-only strong state when closing if no unfinished result can use it. Late continuations retain only what they need to observe the closed fact after shared settlement.
- Reuse an operation owner where one already exists. Error queries use local state; Phase 7B adds no shared lifetime module. Add no cancellation framework, task registry, adapter, raw-Promise path, or generic cleanup abstraction.
- Keep Phase 7A export's current lifetime unless replacing its storage measurably simplifies the code.

### 2. Close Error queries

Give each public `hasError` and `getErrors` call one operation lifetime around path resolution and branch search. Phase 7B deliberately keeps that lifetime around `walkObservationPath` because the current shared walker has no operation owner, and passes no query-specific state into shared path-resolution or property-version APIs. Phase 11 supersedes only this plumbing: shared path walkers receive the common owner used by every caller, while property-version APIs remain unaware of it.

- A successful synchronous result closes immediately. A pending result closes in the transition that produces its complete outcome, before fulfillment.
- A fatal operation-specific query or index failure closes the query before it escapes. It never becomes `true`, `false`, or part of an Error list.
- Later settlement still updates the captured mirror, property version, and any index required by shared publication, then performs no query-specific indexing, traversal, or reflection.
- Finding one Error completes `hasError`. `getErrors` remains open until it has collected every Error in the complete captured branch, including Errors revealed through its captured Promise frontier.
- Keep query state operation-local so concurrent queries over the same Promise frontier remain independent. Mirrors, property versions, and the refcount index remain shared.

Keep the lazily created visited set, optional Error collection, and pending `hasError` resolver in the operation-local query state. The Error collection's presence distinguishes complete collection from first-Error search; no separate strategy or mode is needed. The open fact is the sole stop condition and replaces `hasError`'s former separate `found` state. A counter proof may complete `hasError` without an Error identity; `getErrors` records only reached identities.

Observe each captured property wait and the public path/query result so a fatal rejection closes at its originating asynchronous layer before aggregate propagation. Create the collected-wait `Promise.all` only if the synchronous walk remains open; its observed inputs make another aggregate observer unnecessary. Keep abandoned readiness observed so a later fatal rejection cannot become unhandled, but perform no query work after closure. Clear the visited set, pending resolver, and accumulated Errors on close so a never-settling sibling retains only the closed query fact.

Do not cancel shared settlement, detach mirrors, suppress source Promise rejection, or add another Error-search algorithm.

### 3. Reuse the rule in later phases

- Phase 7C applies it to all controlled Array operation work.
- Phase 7D orders internal dispatch, preparation, member resolution, isolation, and invocation.
- Phase 7E unifies the lifetime mechanism, applies it to registered preparation and Promise-aware scalar conversion outside invocation, and makes nested components share their operation's owner.
- Phase 8 extends the shared lifetime across managed receiver preparation and argument export.
- Phases 9 and 10 keep external boundary preparation inside the selected operation lifetime while preserving phase completion rules.
- Phase 11 applies it while Promise-valued path segments resume from their protected prefix.

### Verification

- Ready and delayed failures of operation-specific query traversal or indexing are fatal and never become query results or collected Errors. A shared publication failure that has already produced graph Error data follows ordinary Error-query behavior.
- After `hasError` completes early or either query fails fatally, resolving an earlier captured Promise performs required mirror and refcount settlement but invokes no query-specific reflection.
- Early synchronous `hasError === true` leaves no active query work and no unobserved abandoned readiness rejection.
- A pending successful query remains active through its last required branch and closes in its final fulfillment transition. Fatal failure closes before its rejection propagates.
- A rejected graph Promise becomes Error data: it completes `hasError` with `true`, while `getErrors` collects it without abandoning other required branches.
- Concurrent queries over one Promise frontier keep independent query state when one closes early or fails while sharing settlement and index state.
- Closing releases accumulated query-only Error state even when an abandoned sibling never settles.
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

Delete Array-override selection, receiver export, result import, override-specific receiver-lease inference, and the Array own-language-property shadow check. The latter can only produce a misleading error for an index-shaped unsupported method name. Retain `requiresArrayMaterialization` only for representation mutation and COW. Preserve controlled behavior and eligible backing reuse. Imported Array storage never becomes mutable ArrayView backing. External Arrays remain unsupported until Phase 10 adds exact external operations.

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

Implement `at` directly from the prepared index and captured property origin; it needs neither a Proxy nor a native intrinsic. Prepared `slice` bounds are already Number or `undefined`, so remove its coercion fallback and derive a view or remap directly. `join` and Array `toString` continue to convert inspected elements logically before a native join receives only prepared strings.

`includes`, `indexOf`, and `lastIndexOf` capture their search value without leasing it because comparison reads only the captured identity or primitive. Keep the receiver lease for `indexOf` and `lastIndexOf` when ordered scanning resumes after a pending element; `includes` continues to capture every property version it will inspect before returning.

### 3. Build `concat` from captured remaps

`concat` has no host boundary. Its captured native intrinsic receives only internal remaps and one-element wrapper Arrays, never a retained value directly:

1. Capture the receiver's property versions while its ordinary receiver lease is active. A remap result records them directly; an eligible ArrayView result performs the equivalent retained-property and mirror capture without allocating a remap.
2. As soon as an item resolves to a logical Array or ArrayView, synchronously capture its length, holes, property origins, and exact property versions into an internal remap. Keep the source root leased until publication or failure so later mutation cannot change managed values retained by those origins.
3. Retain every successfully classified non-Array item exactly. Never inspect or export its contents; a managed retained item keeps its ordinary call lease through publication or failure.
4. Wrap each retained item as one internal element and concatenate it with the captured remaps. Native Array behavior preserves length and holes and enforces the supported Array-length limit without consulting the retained item.

`Symbol.isConcatSpreadable` is outside the language graph and is ignored. Every successfully classified non-logical-Array item is one scalar result element. Preserve eligible ArrayView backing reuse without ever using imported storage as mutable backing.

### 4. Use one sort-record pipeline

Comparator readiness and validation precede element collection. Default and comparator sorting then share these steps:

1. Capture every present property origin and resolve its top-level value through the captured version.
2. Partition the records, in source order, into sortable non-`undefined` records and explicit-`undefined` origins. Count holes separately.
3. When fewer than two sortable records remain, perform no comparison conversion, comparator export, or comparator call.
4. Otherwise prepare only the sortable records:
   - Default sort converts each occurrence once to its logical string key.
   - A supplied comparator creates one dense runtime Array containing all sortable values and passes it as one root to `exportValue`. Pair the exported snapshot values with the dense origin records by position.
5. Stable-sort only the sortable origin records with a runtime comparator, then append explicit-`undefined` origins. Preserve holes for `sort`; append ordinary `undefined` values for those holes in `toSorted`.

Exporting the dense comparator snapshot once preserves aliases and cycles across every future comparison without copying the receiver or walking its indexes twice. Keep it as one export root and one Error domain: `exportManyValues` would give each candidate a separate visited set and may repeatedly traverse an aliased graph. If export reaches an Error anywhere in the host-visible graph, abort before invoking the comparator.

Comparison count intentionally determines Error consumption. With zero or one sortable record, neither default conversion nor comparator export runs, so an Error remains retained Array data. With at least two sortable records, default conversion consumes an Error as its conversion outcome, while comparator export consumes every Error it reaches before host code. This also removes the current eager conversion failure for a lone unconvertible value and matches the absence of a native comparison.

The native sorter receives only internal origin records. Its wrapper passes paired exported values to the exact comparator Function with `undefined` as `this`; repeated comparisons reuse the same exported identities. The comparator runs synchronously, may mutate or retain exported managed values, treats exact Functions and external identities as read-only, and must not reenter Cascada. Phase 10 later applies external source-use ordering before such identities reach a controlled callback.

Consume the comparator result directly without import or coercion. An Error is the callback Error outcome. A Promise or any other non-Number result is a validation Error. A ready Number, including `NaN`, reaches the sorter. The snapshot is neither the receiver nor the result; final ordering moves the original property origins.

Lazy or per-comparison export cannot work because export may wait while a native comparator must return synchronously. Sorting exported values directly would lose the exact source origins for duplicates and aliases. The eager dense snapshot and origin records are therefore load-bearing, but no controlled Array method otherwise exports logical input data.

### 5. Close abandoned Array work

The common invocation owns one per-call context containing the open/closed operation fact. Pass that context through the Array table's preparation and execution hooks; only helpers that schedule or resume operation work retain and check it. Synchronous helpers may ignore it. Do not use module-scoped current-operation state or create a lifetime per method.

The lifetime covers input preparation, logical conversion, recursive `flat`, search continuation, comparator snapshot export, and remap construction until the Array result is handed to the common invocation. Mutation publication remains owned by `transformProperty` and its ordinary transition. Concrete abandonment cases include `includes` after an early match, recursive `flat`, independently resolving `concat` items, and sibling conversion or sort branches after a fatal failure.

- Close synchronously before exposing a final result or propagating a fatal failure.
- An intermediate data Error does not itself close the operation. Finish the Error scan and other preparation required by the selected boundary, then close when its final Error outcome is determined.
- An early final result, such as `includes === true`, abandons unfinished operation work.
- A late registered continuation first completes shared mirror, property-version, refcount, and required publication bookkeeping. If the operation is closed, it performs no further conversion, reflection, comparison, callback, remap, protection, or result-production work.
- A top-level input Promise is operation work, so closure prevents admission of its late value. Shared graph settlement still performs its required admission and publication before observing closure.
- Leases and export output retain their own last-access and Error-scan lifetimes. Closing the operation neither cancels shared settlement nor replaces those rules.

### Verification

#### Array dispatch and inputs

- Controlled table names always use controlled dispatch without host method-surface inspection; every other name is unsupported.
- An own or inherited Array override is never invoked, and the removed Array shadow check no longer gives index-shaped unsupported names a special error.
- Controlled dispatch uses its generic captured-intrinsic fallback under the documented unmodified-Array-primordials contract. Primordial tampering is outside the supported environment and is not tested as runtime behavior.
- Removing override selection and its materialization inference changes neither controlled Array behavior nor valid backing reuse.
- Indexes, bounds, separators, stored payload, search values, and `concat` use only their declared logical preparation. Omitted, explicit-`undefined`, and ignored extra arguments retain their native distinctions.
- Object-valued scalar inputs follow Cascada logical conversion. External identities invoke no native conversion hook and produce a validation Error.
- Direct `at` matches native negative, fractional, `NaN`, infinite, out-of-range, omitted, and explicit-`undefined` index behavior.
- Identity-only Array search values are not leased. Retained payloads, captured logical Array `concat` items, and delayed `flat`, observation-mode `sort`, and `toSorted` origins remain protected until publication or failure. Resumed ordered searches keep their receiver lease.
- After a final result or fatal failure, late settlement performs shared bookkeeping only and no abandoned Array work. `includes` early success and recursive `flat` failure cover this outside argument preparation.
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

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`registered-class-invocation.md`](registered-class-invocation.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 7E: Unify operation work lifetimes

### Problem

Invocation, export, and Error queries independently implement the same open/close fact, fatal-rejection observation, and guarded continuation. Registered receiver and argument roots still prepare through raw continuations, while Promise-aware Array-length conversion has no operation owner. These parallel mechanisms can drift and let abandoned work continue.

### Design

Use one minimal operation-work mechanism everywhere. Unify only lifetime behavior; keep resources and boundary policy at their natural scopes.

### 1. Define the common owner

- The common helpers operate on one open/closed fact and the operation's idempotent `close()`. Each operation keeps cleanup inside its own `close()`; add no cleanup callback or registration mechanism. Existing operation-specific state may implement this interface directly, so do not allocate a wrapper merely to hold it.
- The helpers receive only results already classified at their boundary. They never decide whether a rejection or failure is language Error data or fatal.
- All operation-specific pending registration goes through the guarded continuation helpers. A helper that receives a ready result continues synchronously without materializing lifetime state. Before it registers or observes a pending result, it materializes the standalone operation's lazy owner or reuses the containing operation's owner. No caller manually registers an unguarded operation continuation.
- All components of one issued operation share that owner. A nested component never creates another owner, does not close on successful component completion, and closes the shared owner at the originating asynchronous layer before its fatal failure reaches an aggregate. The operation coordinator closes after its final success or language-Error outcome completes required processing and publication. Do not create an owner per input, branch, method, or Promise.
- A late continuation first completes shared mirror, property-version, refcount, and required publication bookkeeping. It then performs no operation-specific admission, traversal, conversion, reflection, copying, comparison, protection, invocation, or result production after closure.
- Keep policy and resources with their operations. Invocation retains lease ledgers, export retains output state, Error queries retain traversal and collection state, and gates, phases, publication, and export output retain their own completion rules.
- Add no cancellation framework, task registry, cleanup registry, compatibility wrapper, or second continuation path.

### 2. Reuse the owner without changing boundary policy

- A standalone export owns its operation lifetime. Export used by invocation or callback preparation shares that operation's owner and does not close it on successful export.
- Export output has a separate resource lifetime. Handing completed copies to the caller or discarding them ends output work without closing a shared operation owner.
- Reaching a language Error discards export copies but does not close the owner. The required Error scan continues; a standalone export's coordinator closes afterward, while a containing invocation closes only after all of its required preparation finishes. Fatal closure by export or another component abandons unfinished export traversal after shared settlement.
- `hasError` and `getErrors` use the same owner while retaining their distinct completion rules, visited state, and Error collection. Preserve early `hasError`, complete `getErrors`, and release query-only strong state in their own `close()`.
- Invocation uses the owner while retaining its argument and receiver lease ledgers. Phase 8 later makes argument export share this same owner.
- Replace only duplicated open facts, fatal observers, and guarded-transition wrappers in invocation, export, and Error queries. `runExportStep` remains export's per-reflection Error-capture policy and is not lifetime code. Retain no local lifetime path or adapter beside the common helpers.

### 3. Close registered preparation

Start every registered receiver and argument root synchronously under the invocation's one lifetime.

- Before admitting a fulfilled top-level input, verify that the invocation remains open.
- A captured property continuation completes its shared settlement before checking whether further preparation remains allowed.
- A fatal failure in any root closes all unfinished roots. Late roots perform no graph traversal, reflection, materialization, Error collection, or lease acquisition.
- Language Errors still complete the required receiver-then-argument collection. Preserve aliases, cycles, logical Promise versions, and balanced receiver and argument leases.

Phase 8 removes registered argument preparation in favor of export, but reuses this receiver-preparation lifetime. The registered-argument wiring is deliberately temporary; verify the shared closure and balanced-lease contract, not that preparation path's interface. Do not add a transitional adapter or a second managed lifetime.

### 4. Close Promise-aware scalar conversion

Every Promise-aware scalar conversion must use the guarded continuation helpers before it registers pending work. Controlled Array conversion reuses its invocation. Array-length assignment carries a lazy owner slot; the helper materializes it only when conversion first becomes pending, so completely ready ordinary assignment and length conversion retain their current allocation. Rename `transformValue`'s current `operation` readiness result to `readiness` so it cannot be confused with the owner. Phase 11 extends the same lazy ownership through common path operations. Remove the optional unprotected asynchronous path.

- Recursive logical-Array conversion branches share one lifetime.
- A fatal branch closes unfinished conversion work before it propagates through an aggregate. Later branches still settle shared property versions but perform no further conversion or reflection.
- A language Error remains a conversion outcome and completes all work required by that consumed input.
- Observe every pending mutation continuation through the common helper at its originating layer even when the non-blocking API does not return that Promise.
- `assignPath` may return before a pending mutation publishes. Its immediate non-blocking return does not close the owner; successful or failed gate publication does.
- Preserve ready behavior, scalar semantics, mutation gating, Error publication, and allocation. Do not add a conversion-specific scheduler or lease.

### Verification

- Every operation-specific pending registration passes through the common helper and therefore has an owner before registration. Completely ready assignment and conversion allocate no owner and remain synchronous.
- Standalone export and queries use one owner, which their existing operation state may implement without a wrapper allocation. Export nested in invocation shares its parent's owner. Successful nested export and completed output do not close the invocation, while a fatal nested failure does.
- A language Error keeps export's required scan active without closing a shared owner. Fatal sibling closure abandons later export traversal after shared settlement. Existing output discard, Error order, alias, cycle, and captured-frontier behavior remains unchanged.
- `hasError`, `getErrors`, and invocation preserve their existing completion, failure classification, operation-specific cleanup, and lease behavior after the duplicated lifetime code is removed. `runExportStep` retains its current Error-capture behavior.
- A fatal registered receiver branch abandons late argument work, and a fatal argument branch abandons late receiver work. Resolving an abandoned root adds no metadata, lease, copy, or reflection while shared property settlement still completes.
- A fatal Array-length conversion branch abandons late sibling conversion and reflection. A language Error still completes its required conversion outcome and ordinary mutation failure publication.
- A hidden pending Array-length continuation is observed, remains active after `assignPath` returns, and closes only after publication or fatal failure.
- Every registered lease remains balanced after success, language Error, rejection, and fatal failure. Invocation, non-invocation conversion, export, Error queries, mutation gates, and later external phases retain their distinct resource lifetimes while following the same closed-work rule.

Update [`AGENTS.md`](../AGENTS.md), [`registered-class-invocation.md`](registered-class-invocation.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`outbound-export.md`](outbound-export.md), [`counters-implementation.md`](counters-implementation.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), [`work-bounds.md`](work-bounds.md), and the public API documentation.

---

## Phase 8: Generalize managed invocation

### Problem

Managed record functions cannot use their containing state as `this`, while registered-class invocation is already the required managed-state boundary. Managed methods also reject Promise results instead of treating a direct Promise as the call's completion.

### Design

Generalize Phase 5 through the lifetime and invocation ordering completed by Phases 7D and 7E instead of adding another invocation path.

#### Rename

- Rename **registered-class invocation** to **managed invocation**.
- Rename its module and architecture document at the same time.
- Use managed invocation for managed records and managed class instances.
- Keep no compatibility module or document alias, and add no record-specific invocation path.

### 1. Resolve managed methods after preparation

For a managed record:

- Treat each own enumerable string-keyed data placement as a possible method placement.
- After clean receiver and argument preparation, read the placement from the prepared record and test callability. Complete receiver preparation has already resolved its captured logical version, so a Promise-backed placement is interchangeable with its resolved Function.
- Invoke a selected Function with the prepared record as `this`.
- Do not expose inherited properties, accessors, non-enumerables, or resolved non-Functions as methods.
- Keep a Function as data outside a supported call position.

Managed classes retain Phase 5's admitted-prototype-chain selection and managed-class state contract, with Phase 7D's deferred descriptor traversal and callable validation.

### 2. Share one invocation lifecycle

Both receiver forms reuse Phase 5's receiver preparation, leases, mutation isolation, validation, publication, and cleanup. Change only the boundaries that later phases centralize:

- Replace registered argument preparation with Phase 7A export.
- Replace independent result copying with Phase 6 import and ordinary shared ownership.
- Keep runtime-controlled methods on their existing logical-input preparation.
- Reuse Phase 7A's selection-to-call lease handoff and operation-wide cleanup; add no managed-method lease pool or export-source lease.
- Reuse Phase 7E's common operation lifetime across receiver preparation and argument export, and Phase 7D's dynamic member-resolution order.

Retain Phase 7A's rest-argument `run` signature. Managed invocation consumes the already collected internal argument Array; Phase 9 performs the only public signature change.

The common pre-call lifecycle is:

1. Select the managed boundary from admitted category, method name, and mode without member reflection.
2. Start complete receiver preparation and Phase 7A argument export synchronously.
3. Finish both preparations and consume their required Errors.
4. If preparation is clean, resolve and validate the method exactly once.
5. Isolate a mutating receiver, then invoke exactly once.

Receiver preparation and argument export start synchronously under one operation lifetime. A fatal failure in either abandons operation-specific work in both. A language Error keeps the owner open until both preparations complete their required Error handling, after which the coordinator closes the final Error outcome. Already-registered continuations still settle shared mirrors, property versions, and refcounts but perform no further receiver or argument traversal, reflection, copying, or lease acquisition after closure. Do not give each preparation an independent lifetime.

The method receives independent managed argument copies with admitted prototypes. It may mutate, retain, store, or return those copies without changing their Cascada sources. Functions and external identities remain exact and read-only as arguments. Argument export creates no source lease; later external mutation requires selecting the identity as an authorized receiver.

External identities inside the managed receiver are opaque leaves. Managed code may retain, replace, remove, compare, or return them, but may not inspect or mutate their host state. Such access must be a separate Cascada operation selecting the external identity as its receiver. `api!.db.close()` can therefore mutate external `db`; a managed `api!.close()` may not call `this.db.close()` internally.

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
- Let later mutation proceed through COW without waiting; do not add a readers-writer phase.
- On fulfillment, import the result and give retained managed identities ordinary shared ownership.
- On rejection, preserve the rejection and leave the receiver unchanged.
- Release receiver leases after the last access on every completion path.

### 5. Complete mutations

For a mutation:

- Keep the isolated receiver private behind the ordinary transition gate.
- End receiver-source preparation leases when isolation begins.
- A synchronous result validates and publishes the receiver immediately, then imports the result.
- A direct Promise keeps the receiver private. On fulfillment, validate and publish the receiver once, then import the result.
- Release receiver leases at receiver finalization. If finalization publishes a synchronous graph value while result import remains pending, do not extend those leases to the outer operation Promise.
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
- Receiver or argument preparation failure performs no post-preparation record method-placement read, managed-class prototype descriptor traversal, callable validation, or invocation.
- `this.helper()` mutates the already isolated receiver and publishes only through the outer invocation.
- Records and classes share one preparation, export, isolation, validation, result, and cleanup path.
- The caller's mode matches method behavior.
- Managed methods treat nested external identities as opaque. Explicit selection such as `api!.db.close()` uses the external operation path instead of hiding host access inside managed code.

#### Promise lifetime and protection

- A direct-Promise observation holds receiver leases but no readers-writer phase. Exported arguments retain no source lease, and later mutation uses COW without waiting.
- A direct-Promise mutation remains private behind one gate. Later operations wait; fulfillment validates and publishes once; rejection poisons the receiver while preserving rejection.
- A completed mutation receiver containing a Promise or Error fails validation. A direct result Promise extends the invocation; a nested result Promise does not.
- Receiver leases balance after fulfillment, rejection, and validation failure; argument export leaves no source lease on success or failure.
- Managed invocation does not restore selection leases after export capture or acquire another argument-source lease. It uses Phase 7E's common operation lifetime, so fatal preparation or completion cannot strand an acquisition attempted by a later parallel branch.
- A fatal receiver-preparation or argument-export failure abandons the other preparation. A language Error completes required preparation in both before the final Error outcome closes them. Later settlement performs shared bookkeeping only and neither traverses newly revealed data nor allocates output.
- Direct fulfillment uses common import and shared ownership in FIFO order.
- A synchronous result containing a nested Promise returns immediately; its retained placement imports later fulfillment.
- Direct-Promise work may use prepared receiver and arguments until settlement but may not reenter Cascada. Later detached or nested-result access remains a trusted-contract violation, not an instrumented restriction.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`registered-class-invocation.md`](registered-class-invocation.md), [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 9: Establish context external ordering

### Terms

- **Context Chain:** a Chain holding a host-provided context root.
- **Compiler-static path:** a path whose segments are all compiler-known Strings or Numbers. A computed or Promise-valued segment is dynamic even when ready.
- **External occurrence index:** a per-context-Chain index from normalized paths to synchronously reached external identities. Indexing storage is not identity use.
- **Actual use:** lookup, receiver access, property access, or argument use that reaches an external identity. Import, export, assignment, return, and storage are not uses.
- **Fixed external location:** the one compiler-static `(context Chain, normalized path)` authorized by an external identity's first valid mutation.
- **External phase:** readers-writer state attached to an exact mutation-eligible external identity. Observations after an exclusive operation wait for it and may overlap one another; the next mutation or repair waits for those observations.
- **Selected external boundary:** the first external identity whose phase was synchronously selected on an operation path; that phase guards host traversal below the identity for that operation.
- **External operation facts:** separate mutation and repair Booleans supplied by the runtime caller. Either fact makes phase access exclusive; repair-only performs no host action.

### Problem

Mutation-eligible external identities used through context Chains need readers-writer ordering because managed COW, leases, and transition gates cannot protect their host state. Mutation remains limited to one compiler-static path of one context Chain. Outside-context use is observation-only and makes later mutation unavailable.

### Design

[`external-context-ordering.md`](external-context-ordering.md) is the detailed architecture.

### 1. Add one external phase mechanism

Implement one readers-writer mechanism for mutation-eligible external identities used through context Chains. It owns:

- synchronous successor publication;
- predecessor waiting;
- concurrent observation groups;
- exclusive mutation and repair;
- async-child reservations; and
- completion, including direct-Promise boundary processing.

Keep graph publication and poison at their natural owners. Do not infer external ordering from managed graph state or add another command scheduler.

Use two phase-access modes and one orthogonal repair fact:

- observation joins a concurrent read phase;
- mutation and repair enter exclusively; and
- an exclusive operation may repair only, mutate only, or repair and mutate.

Cascada syntax is outside this project. Its compiler lowers unmarked access to observation, `!` to mutation, bare `!!` to repair-only, and `!!` attached to a mutation to repair-and-mutate.

Use required positional Booleans rather than an options object. A variable-mode API places `repair` immediately after `mutation`; `run` therefore becomes:

```js
run(chain, path, method, mutation, repair, args)
```

`args` is a required native Array of explicit argument values; `[]` represents no arguments. It is operation control data rather than one language value. Treat its elements as separate ordered roots for preparation, export, Error positions, and invocation. Validate the Array together with `method`, `mutation`, and `repair` before receiver traversal.

An inherently mutating API receives only a positional `repair` Boolean. Add a dedicated repair-only path operation instead of encoding it as a host observation or dummy callback. The combinations are:

| `mutation` | `repair` | Behavior |
| --- | --- | --- |
| `false` | `false` | Shared observation |
| `true` | `false` | Exclusive mutation |
| `true` | `true` | Exclusive mutation after bypassing old selected poison |

Reject `(false, true)` on an operation that would access host state. Do not add a repair-and-observe form; Cascada issues repair-only followed by an ordinary observation. Replace the old rest-argument signature directly and add no compatibility overload.

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
  poison every selected mutation phase, if any
  do not invoke host code
```

After the first valid mutation, every later use must be compiler-static at that exact Chain and path. A conflicting use returns a validation Error before host access and does not alter the fixed state. Phase and use state are local to one execution.

Any mutation rejected by this state machine, including one attempted through a different location after fixation, poisons every selected mutation phase without host access. An operation that selected no phase still returns the validation Error. An incompatible observation returns its validation Error without poisoning.

### 4. Select and enter phases before graph work

- A context external operation selects its reached identity directly.
- A supplied marked context prefix selects indexed external identities at or below its path.
- An outside-context external operation records outside use synchronously and remains observation-only without a phase. Reject it before host access if the identity is already mutation-authorized; otherwise the outside use permanently prevents later mutation authority.
- Give each selected mutation-eligible identity one phase state. Duplicate context selections join that phase but never redirect access or grant alias authority.
- Classify external dispatch before managed COW, transition gating, receiver preparation, waiting, export, or host reflection.
- Exact external dispatch uses neither managed COW nor a transition gate. Managed work outside selected external identities remains unchanged.
- External identities never acquire a read lease. Mutation-eligible context identities are protected by their selected external phases; unphased outside-context use permanently disables mutation.
- Register every selected receiver and argument phase when the operation enters the graph API.
- Complete and freeze the selected phase set before the first wait. Never retain one operation phase while acquiring another.
- Publish all Chain and external successors before waiting for any predecessor.
- Let observations after one exclusive operation share a read phase. The next exclusive operation waits for that whole group.
- Never make entries created by one operation wait on one another.
- Merge duplicate selections by making the entry exclusive if any selection is exclusive and setting repair only when an explicit repair scope covers that identity.
- External selection, predecessor waiting, and use validation share the owning operation's Phase 7E lifetime. Closure prevents later operation-specific preparation or host work but neither retracts published successors nor releases a phase before its completion rule permits it.
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
- The first selected external identity on a path guards the complete host suffix traversed through it.
- Record each deeper external identity when reached, but do not add its phase to the active operation.
- If required resolution from a context source reveals an external identity with no selected external boundary, return a validation Error before accessing or passing that identity to host code.
- If a non-context source reveals an external identity, record outside use before host access. It needs no phase because that use makes future mutation impossible; reject it if the identity is already fixed elsewhere.
- Never pre-scan an external graph or compare external descendants for aliases.
- A selected receiver phase guards the exact external receiver and the hidden host state it encapsulates. A selected argument phase gives read-only access to its exact external identity.
- Independently scheduled external roots must not share mutable hidden state. A later-discovered alias cannot retroactively join an earlier phase.
- Ordering is execution-local; the host owns concurrency between executions.

### 7. Store poison and repair it in phase order

- Store poison in the execution's phase entry for the exact identity, never in global identity metadata or application data and never by replacing the identity.
- Existing poison contributes its Error at the selecting receiver or argument position unless that exact scope is explicitly repaired. Complete required preparation, then skip host code on an unrepaired Error.
- Ordinary observation failure does not poison. Phase 10's external-containment violation poisons its external container's selected phase even when discovered by an observation; an unphased outside-context access only returns the Error.
- Mutation failure or rejection records its combined Error on every selected mutation phase after predecessors finish. Preserve completed host effects.
- Dynamic, `OUTSIDE_CONTEXT`, and `MULTIPLE_USE` mutation invoke no host code and poison any selected mutation phases.
- A repair-only request enters its explicitly selected phases exclusively, bypasses and clears their old poison, performs no host access, has logical result `undefined`, and is idempotent.
- A repair-and-mutate request is one exclusive operation. It bypasses old poison, performs the mutation, and leaves the selected phases clear on success or stores only the new mutation poison on failure.
- Repair requires a compiler-static context path and records ordinary use without establishing mutation authority. It clears neither application Errors nor ancestor or unrelated poison. It never changes use history or mutation eligibility.

### 8. Remove superseded sequencing

Delete every hidden sequence Chain and duplicate scheduler. Add no compiler external classification, special importer, external graph model, second invocation coordinator, or second phase algorithm.

### Verification

#### Index and authority

- Context construction and later context transitions index external occurrences without recording use. Storing one identity at several paths or in several context Chains leaves it unused.
- Use follows the complete state transition above. Repeated use at one static location is stable; dynamic, outside-context, different-path, different-Chain, and mixed use have their specified sticky outcomes.
- Only one compiler-static context location may reach host mutation. The first valid mutation fixes it; every incompatible later use fails before host access without changing the binding.
- Each index answers exact, longest-prefix, and descendant queries without storing use or phase state.

#### Ordering

- Duplicate context identity selections join one phase without granting alias access. Outside-context observations use no phase and make mutation unavailable.
- Observations wait for the previous exclusive operation and overlap one another; the next mutation or repair waits for the group even if one of those observations made the identity mutation-ineligible.
- External phase entry occurs at graph-operation entry without self-wait or acquisition-order deadlock. Executions share no use or phase state.
- A closed operation performs no late external selection, use validation, or host preparation, while every phase already entered still completes and releases in phase order.
- Deep context traversal remains under its selected external boundary. No operation adds a phase after waiting; an uncovered later context identity fails before further host access. Non-context traversal records outside use and remains unphased.
- Exact external work avoids managed COW and transition gates. Other managed behavior remains unchanged.
- External receiver, argument, property, and `enter` ordering uses phases without creating `readLeaseCount` metadata.
- Async children and `enter` reserve indexed identities before suspension and use child-local phases. Nested, empty, and unrelated children remain independent.

#### Failure and removal

- Existing poison prevents ordinary host invocation. Ordinary observation failure does not poison; an external-containment violation poisons its container's selected phase, if any. Mutation failure or rejection preserves completed effects and poisons every selected mutation phase.
- Repair-only is exclusive, idempotent, accesses no host state, has logical result `undefined`, and clears only explicitly selected phase poison. Repair-and-mutate is one exclusive operation whose failure installs new poison after bypassing the old poison. Neither form changes use history or mutation eligibility.
- External phase access is either shared observation or exclusive work. Repair is an orthogonal exclusive-operation fact; no third phase algorithm or combined repair-and-observe request exists.
- Mutation-capable APIs use required positional mutation and repair Booleans, reject repair combined with host observation, and expose repair-only without requiring a dummy method or callback. `run` accepts one required native argument Array and treats its elements as ordered roots. No rest signature, options object, or compatibility signature remains.
- No hidden Chain, compiler external classification, special importer, external graph model, second invocation coordinator, or second phase algorithm remains.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`external-context-ordering.md`](external-context-ordering.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`enter.md`](enter.md), [`runtime-spec.md`](runtime-spec.md), the Chain operation API, compiler lowering, and path-operation documentation.

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

Select Phase 9 requests consistently from facts supplied by the Cascada caller:

- unmarked external property reads and method calls observe;
- an ordinary explicit mutation mutates without repair;
- a bare repair request uses Phase 9's repair-only path operation and never enters invocation; and
- a repairing mutation repairs and mutates as one exclusive operation.
- A ready computed path may observe, but is dynamic and cannot establish or use mutation authority.
- Phase 11 applies the same rule after Promise-valued path segments settle.

### 2. Reuse the common invocation coordinator

Reuse the common coordinator completed by Phases 7D, 7E, and 8 for Error collection, preparation, dynamic member resolution, invocation, result admission, category completion, operation lifetime, and cleanup. Pass it the captured external phase scope. Add no external-specific coordinator, queue, Error collector, graph copier, importer, exporter, availability resolver, or preparation path.

External dispatch and phase selection wrap every affected call category at coordinator entry. They complete before that category's receiver or argument preparation can wait and invoke no host code. Phase 7D's ordering still requires explicit input preparation to finish before host suffix traversal, reflection, or callable resolution; Phase 8's managed behavior remains unchanged.

An external call follows this lifecycle:

1. Discover context receiver and argument phase coverage available without waiting, then register the complete phase set at graph-operation entry. An outside-context operation records use but selects no phase.
2. Wait for phase predecessors.
3. For repair-and-mutate, bypass old poison only on explicitly repaired receiver scopes. Unrepaired receiver or argument poison remains an input Error.
4. Export every explicit argument and collect its Errors before inspecting host state.
5. If preparation is clean, traverse each context host suffix under its already selected external boundary. Record and validate every newly reached identity before further host access, but acquire no additional phase. Outside-context traversal records outside use and proceeds without a phase only when the identity is not fixed elsewhere.
6. Perform descriptor or proxy reflection on the final receiver and invoke a getter at most once.
7. Prepare a selected call candidate by resolving readiness, propagating Error, and testing callability. Do not import the Function as graph data.
8. Invoke exactly once, then import the property-read or call result.
9. Clear repaired poison on success or replace it with new mutation poison on failure, then release phases after boundary completion.

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
- **Write:** export any supported value before native assignment or setter execution. Any reached Error prevents the write.
- **Delete:** perform native deletion and return its Boolean result.

For writes:

- Managed records, Arrays, and class instances become independent host copies under Phase 7A's prototype decision.
- Functions and external identities remain exact.
- A native setter must complete synchronously.
- Successful assignment returns the captured logical right-hand value, not a value reread from the host property.

### 5. Guard external arguments

Every explicit argument source supplies its Chain and normalized path:

- A context source covers every indexed external identity reached beneath its selected logical value, including inside an exported managed container. Record each complete source location as an observation use.
- Discover and register every synchronously available covered identity in `OBSERVE` with the receiver phases before export or any wait. An argument never establishes or receives mutation authority.
- If Promise resolution from a context source later reveals an external identity outside that coverage, return a validation Error before export passes it to host code. Never acquire an argument phase late.
- A non-context source records outside use when export reaches an external identity. Reject an identity already fixed elsewhere; otherwise pass it without a phase because outside use permanently prevents future mutation.
- Export keeps the exact external identity but transfers no mutation authority.
- Apply the same source-coverage rule before passing an external identity to a runtime-controlled callback.

### 6. Enforce host-call lifetime contracts

- An external observation may read ordinary and hidden state but does not mutate it.
- Mutation may change its phase-protected exact receiver and exported managed argument copies. Exact Functions and external identities remain read-only as arguments.
- A direct Promise keeps every selected identity phase active through fulfillment import or rejection.
- A nested result Promise does not extend the operation or retain later receiver or input access.
- Host code may retain exported data but may not independently mutate an external resource while Cascada may use it.
- Host code may not reenter Cascada during an active direct invocation.
- Repair affects phase poison only; it never changes actual-use history or the fixed external location.

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
- Every supported exported value may be assigned. Any reached Error prevents the write; assignment returns its captured logical right-hand value; deletion returns the native Boolean; setters are synchronous.
- External-call and property-read results share Phase 6 import. Returning or storing an exact identity records no use.
- Phase predecessors and argument export finish before receiver reflection or getter execution. A selected callable is prepared without importing it as data, and poisoned preparation invokes no host code.

#### Lifetime and failure

- Context receiver and argument phases register together. Observations wait for the previous exclusive operation and overlap one another; the next mutation or repair waits for the group. Non-context external observations use no phase and make later mutation unavailable.
- One operation's phase set is fixed before its first wait. Deep traversal and Promise-backed input preparation never acquire another phase while retaining it.
- A Promise-revealed argument identity outside the selected boundary coverage produces a validation Error before host invocation and leaves no phase or lease behind.
- A direct Promise retains phases but no managed source lease through import or rejection. A nested result Promise does not extend the operation.
- External receiver and argument identities never acquire read leases. Ready and pending context access use the same phase lifetime; outside-context access is unphased.
- Ordinary observation failure does not poison. An external-containment violation poisons its container's selected phase, if any. Failed or rejected mutation poisons selected phases while preserving completed host effects. Dynamic, outside-context, or multiple-use mutation invokes no host code and poisons any selected phases. Repair-only clears selected poison without host access; repair-and-mutate replaces old poison with any new mutation failure.
- Deep external mutation works without graph pre-scanning. Hidden shared mutable state across independently scheduled roots remains a host-contract violation.
- No new coordinator, collector, copier, queue, importer, exporter, resolver, or preparation path exists.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`external-context-ordering.md`](external-context-ordering.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-preparation.md`](import-preparation.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), compiler lowering, the path-operation documentation, and the public API documentation.

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

- An observation leases the longest resolved prefix only when it is managed. An external prefix uses its selected phases and no read lease.
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

### 3. Stop closed path work

Use the common operation-work lifetime completed by Phase 7E. It covers segment preparation and normalization, resumed traversal, prefix protection, external candidate selection, and final operation publication.

- A path component receives its containing operation's owner. A standalone walker carries a lazy owner slot. Every pending segment continuation, external predecessor wait, and other asynchronous registration goes through Phase 7E's guarded helpers; the helper reuses the containing owner or materializes the standalone owner before registering. A completely ready path allocates none. This is generic operation state, not query state; do not thread it through property-version APIs.
- A continuation first completes shared mirror, property-version, refcount, and required settlement bookkeeping. If the operation is closed, it performs no later segment normalization, path traversal, lease or gate acquisition, external-phase work, host access, or result production.
- Observe every pending walker continuation at its originating layer even when a non-blocking mutation API does not return that Promise.
- Ordinary publication required to complete the current operation happens before closure. Closing neither abandons an installed mutation gate nor releases an external phase before its own completion rule permits it.
- A standalone observation's final result or fatal failure closes operation work at its originating transition. A pending mutation closes only after its gate publishes success or failure; its immediate non-blocking API return is not completion. A segment rejection first becomes the ordinary language Error and completes observation or gated-mutation failure before closure.
- When a Promise-valued path is one component of a larger invocation, export, or Error query, only that larger owner determines the final outcome; path resolution reuses its lifetime rather than creating an independent one.

### 4. Reuse common path transitions

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

### 5. Protect possible external targets before waiting

For a context Chain with an unresolved suffix:

1. Query the ready prefix in its external occurrence index.
2. Select every indexed external identity that the unresolved suffix may reach.
3. Register each selected phase together with the managed prefix lease or gate before waiting on a predecessor.
4. Treat this conservative selection only as protection, not actual use.
5. After resolution, record only the exact identity and normalized path reached, with a dynamic-path fact.

If the reached external identity is covered by a selected external boundary, observation proceeds normally. Otherwise observation returns a validation Error before host access. External mutation returns the ordinary validation Error and invokes no host code because a computed or Promise-valued segment is never compiler-static; it poisons a selected phase when one covers the target and otherwise follows the managed prefix's gated failure.

### Verification

#### Segment behavior

- Ready String and Number segments retain current synchronous behavior and allocation. Other ready values produce validation Errors without coercion.
- Promise-valued segments resolve and normalize instead of becoming `"[object Promise]"`.
- Broken ready prefixes do not wait for unused inputs. Unused Promise segments remain host-owned and receive no suppression continuation.
- Segment rejection and invalid normalization follow ordinary Error publication at the protected prefix.
- Root, middle, and final Promise segments work through common walkers for lookup, assignment, deletion, invocation, export, Error queries, and `enter`.
- `hasError` and `getErrors` reuse their query owner and preserve early `hasError`, complete `getErrors`, fatal classification, and query-state release. Path export reuses its export owner and output lifetime. `run` and `enter` reuse their containing owner; standalone lookup and ordinary path operations use the lazy owner. These plumbing changes alter no ready-path or existing pending-value behavior.

#### Protection and ordering

- A pending observation leases the longest resolved managed prefix once. Later managed mutation uses COW and cannot change the captured result. An external prefix uses phases without a lease.
- A pending mutation gates the longest resolved prefix before waiting. Conflicting work cannot overtake it; unrelated paths continue.
- Several pending segments share one prefix scope while preserving aliases, mirrors, FIFO order, and Error identity.
- After a final result or fatal failure, a late segment completes shared settlement but performs no normalization, traversal, protection, external-phase work, host access, or result publication. Any installed gate or phase still completes through its own ordinary rule.
- Every pending path registration has an owner because the guarded helper materializes one before registration; callers cannot select an unguarded asynchronous path.
- A hidden pending mutation continuation remains observed after the public API returns, and closes operation work only through fatal failure or gated publication.
- A context suffix registers every candidate external phase before waiting but records use only for the resolved identity and path. Resolution never expands that phase set; an uncovered external target fails before host access.
- Compiler-known ready String or Number segments may participate in external mutation. Computed ready and Promise-valued segments remain dynamic even when they resolve to the same key; external mutation poisons without host access.
- No temporary Chain, direct `enter` call, new queue, operation-specific preparation path, or second scheduler is introduced.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`promise-path-segments.md`](promise-path-segments.md), [`outbound-export.md`](outbound-export.md), [`counters-implementation.md`](counters-implementation.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), [`enter.md`](enter.md), [`work-bounds.md`](work-bounds.md), and the public path-operation documentation.
