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

Phase 9D supersedes this phase's direct-Error graph effects and compound deduplication: every direct Error means its boundary failed regardless of transport, and only identity-bearing causes deduplicate occurrence wrappers.

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
- Phase 9F independently keeps required external identity phases through settlement.

Export records no external use and grants no external mutation authority.

This is safe because a ready reachable identity is copied during the synchronous transition and later aliases reuse that copy. A value first revealed through a captured mirror was not previously reachable through that placement, so its continuation can traverse it once without rereading earlier source state.

Delete only export's source-retention callback and lease-presence tests. Retention callbacks used by controlled methods for later reads remain call leases. Test snapshot stability while later mutation remains in place.

Export has an open output lifetime. Fatal failure or abandonment closes it and releases partial output and copy state. An already-registered continuation still completes shared Promise-mirror and property-version settlement, then stops before allocating export output, invoking boundary reflection, or publishing an export result. A reached language Error does not close the required Error scan: discard output copies but continue collecting every reached distinct Error. Preserve the captured-frontier, cycle, alias, and distinct-Error behavior documented in [`outbound-export.md`](outbound-export.md).

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

Give each public `hasError` and `getErrors` call one operation lifetime around path resolution and branch search. Phase 7B deliberately keeps that lifetime around `walkObservationPath` because the current shared walker has no operation owner, and passes no query-specific state into shared path-resolution or property-version APIs. Phase 10 supersedes only this plumbing: shared path walkers receive the common owner used by every caller, while property-version APIs remain unaware of it.

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
- Phases 9F and 10 keep external boundary preparation inside the selected operation lifetime while preserving phase completion rules.
- Phase 10 applies it while Promise-valued path segments resume from their protected prefix.

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

The native sorter receives only internal placement records. Its wrapper passes paired exported values to the exact comparator Function with `undefined` as `this`; repeated comparisons reuse the same exported identities. The comparator runs synchronously, may mutate or retain exported managed values, treats exact Functions and external identities as read-only, and must not reenter Cascada. Phase 9F later rejects mutation-capable external identities before they reach a controlled callback; observation-only identities remain exact and read-only.

Consume the comparator result directly without import or coercion. An Error is the callback Error outcome. A Promise or any other non-Number result is a validation Error. A ready Number, including `NaN`, reaches the sorter. The snapshot is neither the receiver nor the result; final ordering moves the original property placements.

Lazy or per-comparison export cannot work because export may wait while a native comparator must return synchronously. Sorting exported values directly would lose the exact source placements for duplicates and aliases. The eager dense snapshot and placement records are therefore load-bearing, but no controlled Array method otherwise exports logical input data.

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
- Identity-only Array search values are not leased. Retained payloads, captured logical Array `concat` items, and delayed `flat`, observation-mode `sort`, and `toSorted` placements remain protected until publication or failure. Resumed ordered searches keep their receiver lease.
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

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-invocation.md`](managed-invocation.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 7E: Unify operation work lifetimes

### Problem

Invocation, export, and Error queries independently implement the same open/close fact, fatal-rejection observation, and guarded continuation. Registered receiver and argument roots still prepare through raw continuations, while Promise-aware Array-length conversion has no operation owner. These parallel mechanisms can drift and let abandoned work continue.

### Design

Use one minimal operation-lifecycle mechanism everywhere. Unify only lifetime behavior; keep resources and boundary policy at their natural scopes.

### 1. Define the common owner

- The common helpers operate on one open/closed fact and the operation's idempotent `close()`. Existing operation-specific state may implement this interface directly, so do not allocate a wrapper merely to hold it. A pending nested component with independently stored operation-only resources registers one synchronous, idempotent, non-throwing release with the owner and unregisters it on normal completion. This includes values already collected by an unfinished aggregate. Closing runs remaining releases immediately without cancelling shared settlement.
- The helpers receive only results already classified at their boundary. They never decide whether a rejection or failure is language Error data or fatal.
- Every owner has an explicit Boolean open fact and idempotent `close()`. Existing operation state implements that contract directly instead of receiving a wrapper. All operation-specific pending registration goes through the guarded continuation helpers. Ready work continues synchronously without allocating release-registry state. Pending nested resources reuse the containing owner and register their release before control returns. No caller manually registers an unguarded operation continuation.
- All components of one issued operation share that owner. A nested component never creates another owner, does not close on successful component completion, and closes the shared owner at the originating asynchronous layer before its fatal failure reaches an aggregate. The operation coordinator closes after its final success or language-Error outcome completes required processing and publication. Do not create an owner per input, branch, method, or Promise.
- A late continuation first completes shared mirror, property-version, refcount, and required publication bookkeeping. It then performs no operation-specific admission, traversal, conversion, reflection, copying, comparison, protection, invocation, or result production after closure.
- Keep policy and resources with their operations. Invocation retains lease ledgers, export retains output state, Error queries retain traversal and collection state, and gates, phases, publication, and export output retain their own completion rules.
- Add no cancellation framework, task registry, compatibility wrapper, or second continuation path. The release registry contains only synchronous, idempotent releases for independently stored operation resources; it never contains tasks or continuations.

### 2. Reuse the owner without changing boundary policy

- A standalone export owns its operation lifetime. Export used by invocation or callback preparation shares that operation's owner and does not close it on successful export.
- Export output has a separate resource lifetime. Handing completed copies to the caller or discarding them ends output work without closing a shared operation owner.
- A pending nested export registers its output release with the shared owner. Owner closure therefore releases partial output immediately even when an abandoned input never settles.
- Reaching a language Error discards export copies but does not close the owner. The required Error scan continues; a standalone export's coordinator closes afterward, while a containing invocation closes only after all of its required preparation finishes. Fatal closure by export or another component abandons unfinished export traversal after shared settlement.
- `hasError` and `getErrors` use the same owner while retaining their distinct completion rules, visited state, and Error collection. Preserve early `hasError`, complete `getErrors`, and release query-only strong state in their own `close()`.
- Invocation uses the owner while retaining its argument and receiver lease ledgers. Phase 8 later makes argument export share this same owner.
- Move InvocationContext's continuation and fatal-observation methods to the common lifetime helpers. Keep only its lease ledgers and the owner state needed to release them.
- Replace only duplicated open facts, fatal observers, and guarded-transition wrappers in invocation, export, and Error queries. `runExportStep` remains export's per-reflection Error-capture policy and is not lifetime code. Retain no local lifetime path or adapter beside the common helpers.

### 3. Close registered preparation

Start every registered receiver and argument root synchronously under the invocation's one lifetime.

- Before admitting a fulfilled top-level input, verify that the invocation remains open.
- A captured property continuation completes its shared settlement before checking whether further preparation remains allowed.
- A fatal failure in any root closes all unfinished roots. Late roots perform no graph traversal, reflection, materialization, Error collection, or lease acquisition.
- Language Errors still complete the required receiver-then-argument collection. Preserve aliases, cycles, logical Promise versions, and balanced receiver and argument leases.

Phase 8 removes registered argument preparation in favor of export, but reuses this receiver-preparation lifetime. The registered-argument wiring is deliberately temporary; verify the shared closure and balanced-lease contract, not that preparation path's interface. Do not add a transitional adapter or a second managed lifetime.

### 4. Close Promise-aware scalar conversion

Every Promise-aware scalar conversion must use the guarded continuation helpers before it registers pending work. Controlled Array conversion reuses its invocation. Array-length assignment makes its already-required mutation context an explicit owner, so completely ready ordinary assignment and length conversion allocate no additional owner object or release-registry state. Rename `transformValue`'s current `operation` readiness result to `readiness` so it cannot be confused with the owner. Phase 10 extends the same ownership through common path operations. Remove the optional unprotected asynchronous path.

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

A fatal failure in either preparation abandons operation-specific work in both. A language Error keeps the operation open until both finish required Error handling, then closes the combined outcome. Guarded continuations still settle shared mirrors, property versions, and refcounts after closure, but perform no further traversal, reflection, copying, or lease acquisition. The two preparations never receive separate lifetimes.

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
- A fatal receiver-preparation or argument-export failure abandons the other preparation. A language Error completes required preparation in both before the final Error outcome closes them. Later settlement performs shared bookkeeping only and neither traverses newly revealed data nor allocates output.
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

Phase 9D supersedes the ready-versus-rejected direct-Error distinction: every direct Error follows the same call-failure and receiver-poisoning rules, while an Error from an independent nested result remains independent.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`managed-invocation.md`](managed-invocation.md), [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 9A: Establish context external foundations

### Terms for Phases 9A–9F

- **Execution:** an object shared by every related Chain in one Cascada execution. Phase 9B moves graph metadata, thenability, and continuation state into it. Phase 9E uses its external-identity map for location and readers-writer phase state; phase completions carry repairable poison.
- **Operation context:** the final immutable `{ execution, errorContext }` carrier. Phase 9B uses it to select execution-local state; Phase 9C uses it for fatal coordination, and Phase 9D activates its opaque source fact for causal recoverable-Error attribution.
- **ContextChain:** a public `Chain` subclass for root context initialization. It imports its host value and may build a static external mutation tree; an entered ordinary Chain carries the reached tree node when one exists.
- **Mutation scope:** the context prefix whose state one operation may change. `!` selects it for a call; assignment and deletion use their complete target path. An observation has no mutation scope.
- **Scope mutation path:** a compiler-provided String/Number prefix selected by `!`. Its selected subtree may contain external effects.
- **Property mutation path:** a compiler-provided complete String/Number target of an assignment or deletion. Only its containing path may cross an external boundary.
- **Static external mutation tree:** one positive mutation-authority index per context Chain with non-empty scope or property mutation paths. Initial import searches only those paths and records their synchronously reached external boundaries; later queries may only prune conflicted leaves.
- **External boundary:** an external Chain root or the first external identity reached from managed state. It encapsulates the host suffix below it for one operation.
- **Actual use:** a call or property operation through an external boundary. Import, managed storage, assignment, return, copying, and merely carrying an external descendant inside managed state are not uses.
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

The constructor arguments are fixed runtime concepts, so keep them positional rather than allocating an options record for every Chain. `Chain` admits existing Cascada data and needs no `errorContext`. A root `ContextChain` imports raw host context data and therefore receives `errorContext` plus the two compiler path Arrays. These control arguments come from the Cascada runtime and need no defensive validation.

Ordinary Chains are mutation-capable and need no capability flag or close lifecycle. `enter` always creates an ordinary `Chain` with an exact internal `entryMutable` Boolean and one-shot closed state. When the selected path reaches the external mutation tree, that Chain also carries the reached node as `_externalMutationTree`. Store no parent or path because the node is the complete required tree fact. The internal `ExternalMutationTree` owns branch and boundary queries; observations otherwise use the common walker, while mutations additionally assert the entry restriction. Keep no entered subclass, parallel operation path, or compatibility alias for `_mutates`. Ordinary Chains expose no public `close()` method.

Every Chain belongs to exactly one execution. The runtime passes the same execution to every related top-level Chain; internally created child, private, and entered Chains inherit it. Only a standalone Chain or ContextChain that omits `execution` creates a private execution. Different executions never share external authority, phases, or poison.

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

Phase 9E adds identity use, readers-writer phases with repairable-poison completion payloads, and conflict pruning. Phase 9F routes public operations through the query and rejects controlled changes that would disturb a live leaf. Phase 9A changes no public external behavior.

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
- Related top-level Chains share their explicit execution; omitting it creates an isolated private execution.
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

Execution and source attribution ultimately travel together in Cascada. Introduce their final operation-context carrier while moving graph state, but preserve existing Error behavior in this phase. Phase 9C adds execution-level fatal coordination, and Phase 9D activates causal recoverable-Error attribution without changing the operation API again.

### Design

### 1. Let Execution own mutable graph state

Extend the `Execution` created in Phase 9A with:

- one `WeakMap` containing admitted metadata for identities used by that execution;
- one `WeakMap` containing that execution's sampled thenability and canonical continuation state; and
- the existing external-identity coordination `WeakMap`.

The metadata map retains the single-record design from Phase 3. It contains the admitted category and prototype, import origin, sharing and leases, Promise mirrors, ArrayView attachment, refcount parents and counters, and other persistent graph facts. Phase 9D generalizes mirrors into placement-version overlays. A managed copy receives metadata only in the execution that creates it.

Every runtime question that depends on admission or thenability uses the selected execution. This includes metadata lookup and creation, admission, `isPromise`, `typeOf`, traversability, ownership, leases, Promise mirrors, ArrayViews, and refcounts. The first operation that may sample thenability supplies its complete operation context so a throwing `then` getter has the correct source. Migrate every call site together; no compatibility helper may consult a module-wide store. Context-free raw shape probes remain separate and are used only where no execution exists, principally declaration walks. Semantic `isError` remains context-free and excludes fatal `RuntimeError`; admitted Error metadata adds no category that native detection cannot see. Phase 9D adds causal native-Error contextualization and makes every Promise test recognize all native Error forms before sampling `then`.

An execution samples an identity's `then` at most once and owns the captured callable, any acquisition failure, the canonical Promise, and every continuation fact derived from them. Sampling receives the current operation context because reading `then` may itself fail; that first acquisition failure keeps the sampling operation's source. Supplying the same thenable to another execution independently samples, invokes, and orders it there. A native Promise remains one host Promise, but its Cascada continuations, mirrors, and graph effects are execution-local.

Invoking a captured custom `then` is also a supported host boundary. A synchronous invocation failure keeps the operation context that first creates the execution's canonical Promise and is stored as that canonical rejection. Later consumers preserve it. Ordinary fulfillment or rejection supplied by the thenable remains its captured outcome and is processed by each boundary that introduced the Promise.

Phase 9D replaces that custom canonical rejection/assimilation representation with a source-neutral cached settlement record. It retains the execution-local sampling and FIFO ownership established here.

Declaration APIs run before an execution exists. They inspect thenability only for that declaration call, deduplicating aliases with operation-local state; their sampling creates no persistent thenability or continuation fact. Remove the module-wide captured-thenable map.

No mutable graph bookkeeping remains in a module-wide identity map. Do not add an ambient current execution, an identity-to-execution registry, or fallback global metadata.

### 2. Carry the final operation context

#### Operation context

Add one immutable runtime-owned control record:

~~~js
const operationContext = { execution, errorContext }
~~~

`execution` selects the execution-local graph state. `errorContext` is opaque source information supplied by Cascada; the prototype may use a simple String or record, while later integration may supply path, line, column, operation, and diagnostic details without changing graph APIs.

The caller selects `errorContext` for each semantic operation, not merely for its enclosing statement. Nested calls, lookups, conditions, commands, and control-flow boundaries may therefore carry different contexts even on one source line. Async diagnostic-route or command-buffer stacks may later supplement that source, but never replace or rewrite it.

Do not reproduce Cascada's compact context tables, dynamic context cloning, or diagnostic stacks without a graph-kernel need; the opaque `errorContext` remains their integration point. Execution-wide fatal coordination is required by [`error-handling.md`](error-handling.md): the execution owns the first fatal outcome and fatal Promise, while a higher scheduler observes that same outcome rather than creating separate fatal state.

Every graph operation receives one operation context. Chain initialization binds the Chain to its operation context's execution but does not retain that operation's source context for later work. Each later Chain operation receives its own operation context. Public import and any other boundary without a Chain also receive an operation context. A continuation captures the same operation context as the operation that registered it. This trusted two-field protocol needs no class, factory, freezing, or defensive shape validation.

The operation context selects the execution used by an operation. A Chain also retains its initialization execution as a private invariant because its state and any committed external-tree entries belong to that execution. Remove the public execution getter and every helper that derives an operation's execution from the Chain. At each public Chain operation, fatally assert that `operationContext.execution` matches the Chain binding, then pass the operation context through its graph work. Unwrap its execution only to access execution-owned state or validate the Chain binding. `enter` and other internal Chain creation reuse the containing operation context and bind the new Chain to the same execution. This check prevents silent mixing of two metadata or external-authority domains; it is not a second execution-selection path.

Chain initialization uses its operation context only for work caused there. A ready root retains no creation context. A pending root establishes its root property version and mirror during initialization so sampling, settlement, admission, and rejection retain the initialization operation context even when the first consumer arrives later. Replacing the root creates a new version with the replacing operation's context.

Keep source context separate from mutable work state. `InvocationContext`, `ExportContext`, Error-query state, and mutation owners still manage open/closed work and resources; they retain the source operation context only when pending work needs it. Operation-bound graph helpers receive the operation context consistently. Execution-owned stores and Chain binding checks unwrap its execution. Pure shape and prototype helpers remain context-free.

This phase carries `errorContext` unchanged but does not reinterpret current Errors. Existing import diagnostics read `operationContext.errorContext` instead of their old positional source input and retain the current `"(imported at: ...)"` message suffix; Phase 9D replaces that suffix with structured attribution. Other Error behavior remains unchanged. When first thenability sampling or captured-then invocation fails, retain the responsible operation context with that execution-local raw outcome so Phase 9D can contextualize it without guessing. Do not add temporary context strings, an execution-only public API, or an adapter signature.

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
- `error.js` changes the operation fatal entry to `runFatal(operationContext, work)`, and every operation-bound caller passes its registering operation context. Keep current report-and-rethrow behavior until Phase 9C changes only the failure semantics. State declarations use a separate contextless fatal entry; do not make the operation context optional or overload `runFatal`. Phase 9C gives the contextless path its explicit source sentinel.
- `resolution.js`, `operation-lifecycle.js`, invocation/export/query owners, mutation owners, and every continuation carry the registering operation context while work needs it.
- Context-root import, host results, managed results, and Promise fulfillment retain their existing boundary behavior under the selected execution.

Keep omitted-operation-context convenience entirely in `test/support.js`. Its lazy default is one fresh `Execution` per test and one placeholder operation context for related omitted calls. Attribution and separate-execution tests pass explicit operation contexts. Production code receives no environment check, optional default, test hook, or compatibility overload.

### 4. Keep configuration runtime-wide

Identity declarations and managed-class registration are host configuration, not graph bookkeeping:

- Keep the declaration `WeakMap` and managed-prototype `Set` runtime-wide.
- Declaration APIs remain outside graph operation context. Their validation and reflection retain host-API Error behavior; Phase 9D contextualizes such an Error only if it later enters the graph.
- Do not consume a declaration when one execution admits the identity. It applies to future admission in every execution but never reclassifies existing execution metadata.
- Repeated matching declarations remain idempotent; declaration conflicts still return Error. Declarations no longer compare themselves with admitted metadata.
- Rewrite declaration walks to use declarations, raw structure, operation-local thenability sampling, and class registration. They neither inspect nor stop at admitted metadata.
- Declaration APIs are valid only before the declared data enters any execution. Late declaration remains unsupported and undetected; add no runtime-wide admission registry.

The fatal reporter and synchronous host-code re-entry guard remain runtime-wide contracts. Phase 9C adds execution-owned first-fatal state and cooperative shutdown and moves report-once state onto each `RuntimeError`. Immutable method tables, captured primordials, and sentinel Symbols remain module constants. Traversal maps, releases, copies, and other temporary state remain operation-local.

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
- Runtime-owned contexts and compiler facts receive no defensive shape validation. Contexts for operations emitted from one source clause may legitimately share the same opaque source fact.
- Two imports carrying distinct `errorContext` values produce distinguishable diagnostics, and neither operation substitutes the other's operation context. Phase 9D preserves this test with structured attribution instead of the transitional message suffix.
- Every caller-facing Promise predicate receives an operation context. Each execution samples and canonicalizes a thenable independently; no global thenability fallback remains. A throwing first sample or captured-then invocation retains its registering operation context for Phase 9D.
- A pending root establishes its exact version during initialization and retains that operation context with its deferred work. A ready root does not become a later source-context fallback.
- Context-root import, host-call results, managed results, and Promise fulfillment keep their existing boundary behavior while using the operation's execution.
- The test harness alone supplies omitted operation contexts, using one shared fresh execution per test. Strict API tests exercise every production signature directly and verify that an omitted operation context fails fatally before graph work.
- Every operation-bound fatal entry receives the registering operation context in Phase 9B even though fatal output remains unchanged. The contextless configuration path is explicit and cannot become an operation fallback.
- Export/import produces independent receiving identities and metadata. No supported API transfers unexported managed data between executions, and cross-execution mutable external sharing remains an explicit host-contract violation.
- Refcount inspection and `test/verify-refcounts.js` select one execution explicitly and cannot observe another execution's index.
- Metadata remains non-reflective and physically outside graph objects. Metadata and thenability stores are execution-local; declarations, the fatal reporter, the re-entry guard, immutable definitions, and sentinels remain at their stated scopes. No ambient execution, identity-to-execution registry, compatibility store, or parallel admission path remains.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-preparation.md`](import-preparation.md), [`enter.md`](enter.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), public API documentation, and execution-isolation examples.

---

## Phase 9C: Coordinate fatal execution shutdown

### Problem

Phase 9B gives every operation an execution and source context, but fatal failures still use a process-wide report-and-rethrow path. Unrelated work cannot reliably fail a still-pending root or record a fatal after the root returns, competing failures can create competing outcomes, and shutdown has no authoritative lifecycle.

### Outcome

Implement the fatal branch of [`error-handling.md`](error-handling.md). Each execution selects one `RuntimeError`, fails its live operation work, wakes its pending root and scheduler, and reports that exact occurrence once. A completed root remains completed. Keep the existing recoverable Error representation and attribution until Phase 9D replaces them atomically.

### 1. Establish the fatal branch

- Make `RuntimeError` a direct, non-thenable native Error branch. It is fatal and never admitted, combined, queried, repaired, or returned as language data.
- Submit an existing `RuntimeError` unchanged to the receiving execution. Wrap any other raw internal failure with the causing operation's source context. Propagate an escaping `PoisonError` or `CompoundPoisonError` without fatal submission.
- Give each `RuntimeError` one private report-once fact. It prevents duplicate reporting when the same occurrence crosses another reporting surface or execution; every receiving execution may still close.

`runFatal(operationContext, work)` becomes the sole operation fatal entry:

1. Propagate an escaping `PoisonError` or `CompoundPoisonError` unchanged.
2. Preserve an existing `RuntimeError` as the candidate, or create one from the raw internal failure and current operation source.
3. Submit the candidate to `operationContext.execution.fail`.
4. Propagate the authoritative Error returned by the execution.

`runContextlessFatal(work)` is the sole executionless path. It uses one explicit contextless-source sentinel, reports directly, and closes no execution. Host-configuration validation may still throw an ordinary host API Error.

Remove `reportFatalError`, the reported-fatal `WeakSet`, and every competing reporter or fatal-state path. Do not change poison representation, kinds, contextualization, or boundary recovery in this phase.

### 2. Let Execution own the fatal outcome

`Execution.fail` atomically:

1. Keeps the first fatal candidate.
2. Fails all live operation work. Each owner releases its resources and rejects its pending public outcome, when present.
3. Rejects the already-handled `fatalPromise` with that Error.
4. Invokes the one runtime-wide reporter.

`execution.js` owns the first-fatal latch, readable `fatalError`, handled `fatalPromise`, live operation registry, and atomic `fail`. Commit the fatal state before reporting. Later candidates neither replace nor reattribute it. The execution exposes that same handled Promise to its root and higher scheduler; do not add another fatal latch, Promise, or reporter.

### 3. Stop operation work cooperatively

Check fatal state at:

- public operation entry;
- after shared settlement and before operation-specific continuation work;
- before a host effect that follows a wait;
- scheduler dispatch; and
- root completion.

After closure:

- start no new operation or supported host work;
- fail pending operation outcomes with the authoritative `RuntimeError`;
- release operation-only resources;
- continue required shared settlement, publication, bookkeeping, and cleanup;
- continue the cleanup sweep if a release violates its non-throwing contract.

A pending public result remains owned by its existing operation owner. Give that owner one idempotent fatal reject action until normal settlement or close; `Execution.fail` invokes it directly rather than racing every operation Promise against `fatalPromise`.

Replace the earlier lifecycle rule that closes an owner before its fatal failure escapes. A component submits the failure through `runFatal` while its owner is still registered; `Execution.fail` then invokes the owner's fatal rejection, cleanup, close, and unregister transition. Normal and language-Error completion still use ordinary `close()`.

Remove the current pre-fatal `close(operation)` behavior from `operation-lifecycle.js` paths such as `observeFatal` and `run`. Their fatal path must reach `runFatal` with the owner still registered. Introduce the named `markPromiseHandled` helper when `fatalPromise` gives the existing inline rejection no-op its second real use; it changes neither the Promise nor its semantic consumers.

Normal root completion waits only for the returned value's required boundary processing and export, raced against `fatalPromise`. It does not wait for unrelated operations, Chains, shared settlement, or cleanup. If the result completes first, later work continues. A later fatal is stored in `execution.fatalError`, reported, and closes remaining work, but cannot change the delivered result. A missing `fatalError` while work remains does not guarantee eventual success.

Do not add an execution-idle counter, quiescence barrier, or task registry. Do not interrupt synchronous JavaScript, cancel native Promises, or undo completed host effects. Existing operation owners register with their execution while open and unregister on close; fatal-capable continuations report directly through `Execution.fail` even after their originating owner closes.

Diagnostic formatting remains above the kernel. It may inspect opaque source data and cause stacks only outside graph transitions and under `try`/`catch`. Formatter or reporter failure cannot replace the stored Error or execution outcome.

### Verification

- `RuntimeError` is a direct, non-thenable native Error. Existing instances are submitted unchanged to each receiving execution, whose earlier fatal Error remains authoritative. `runFatal` propagates an escaping recoverable Error unchanged; poison is never escalated merely because it propagates.
- `runFatal` attributes raw synchronous and asynchronous internal failure to the causing operation and returns the execution's first fatal outcome. `runContextlessFatal` uses the sentinel and closes no execution.
- Fatal state commits before reporting. One occurrence reports once, later candidates cannot replace it, and the same occurrence may close another execution without another report.
- Public entry, guarded continuations, post-wait effects, scheduler dispatch, and root completion observe the same fatal latch.
- Closure starts no new operation or host work, rejects pending public results through their owners, releases operation-only resources, and still completes required shared settlement and cleanup.
- A component cannot unregister its owner before fatal submission; the fatal transition rejects that owner's pending result before closing it.
- Fatal work wakes and fails a pending root with the exact authoritative Error. The root otherwise completes as soon as its returned value finishes required boundary processing and export, without waiting for unrelated or never-settling work.
- A fatal discovered after successful root delivery is stored in `execution.fatalError`, reported once, and closes remaining work without changing the delivered result. Reading `null` before remaining work finishes is not a success guarantee.
- A fatal from other execution work immediately rejects an operation waiting on a never-settling normal input with the execution's exact authoritative Error.
- Closing an owner abandons its operation-only work without cancelling required shared settlement or preventing a later fatal report.
- Reporter, formatter, and cleanup-release failure cannot replace the first fatal outcome or prevent the remaining cleanup sweep.
- No competing reporter, fatal state, cancellation framework, idle counter, quiescence barrier, or task registry remains.

Update [`AGENTS.md`](../AGENTS.md), [`error-handling.md`](error-handling.md), [`runtime-spec.md`](runtime-spec.md), operation-lifecycle documentation, scheduler integration, diagnostics, and public fatal-reporting documentation.

---

## Phase 9D: Complete causal recoverable Error handling

### Problem

Phase 9B carries the final operation context to every boundary, and Phase 9C provides one authoritative fatal lane. Recoverable Error representation, attribution, Promise behavior, and boundary handling still use the transitional model.

### Outcome

Implement the recoverable branch of [`error-handling.md`](error-handling.md) atomically. The exact causal boundary supplies a recoverable failure's source and kind; later consumers preserve it. `PoisonError` represents recoverable failure in both synchronous and asynchronous positions, while every internal failure continues through Phase 9C's fatal lane.

This phase uses two recurring terms:

- A **causal boundary** is the exact supported action allowed to convert its raw failure into recoverable poison.
- A **causal occurrence** is one boundary-position contextualization of a raw failure. Later retention and propagation preserve that wrapper; another causal boundary creates another occurrence.

### 1. Install the final recoverable Error model

Use these concrete native-Error branches:

~~~text
Error
|- PoisonError
|  `- CompoundPoisonError
`- RuntimeError
~~~

- `PoisonError` is recoverable language data and a sync-first rejecting thenable. Synchronous Error checks detect it; `await` and native Promise assimilation reject with that exact Error.
- Its `then` exists only for assimilation and `await`. Without a rejection callback it returns `this`; otherwise it returns that callback's result and propagates a callback throw synchronously. It needs no `catch`, `finally`, Promise-compatible chaining, Promise subclass, or wrapper.
- `CompoundPoisonError` contains flattened poison leaves.
- Phase 9C's `RuntimeError` remains the separate fatal branch and is never admitted, combined, queried, repaired, or returned as language data.
- Do not add a shared runtime `CascadaError` base. Semantic classification checks the recoverable and fatal branches directly.

Recognize every native Error form before sampling `then`. Guard thenability with native `Error.isError`, not semantic `isError`: a native Error remains an Error even when it has a callable or throwing `then`, which is never read. Semantic `isError` recognizes native host Errors and both poison classes but excludes `RuntimeError`. Declaration APIs likewise preserve an Error before probing thenability.

Every poison has a nonempty `kind` and `errorContext`. Export one frozen `ERROR_KIND` vocabulary:

- Keep the established names and reservations in `error-handling.md`.
- Rename transport-specific pairs to `ChainValueFailed`, `ContextValueFailed`, `AssignmentValueFailed`, and `OperationInputFailed`.
- Use `InvalidCallbackResult` for every unsupported controlled-callback result, including a Promise where a synchronous result is required.
- Use PascalCase keys equal to their string values. `Multiple` is only the compound meta-kind; no empty or generic fallback is valid.
- Messages remain separate from kind and source.

Contextualize a native host Error once per causal occurrence:

- Wrap it in a new `PoisonError` with the exact native Error as `cause`.
- Invoke no host hook while contextualizing: use fixed text or safely read own primitive diagnostic data, and never coerce the Error, inspect arbitrary properties, sample `then`, or require its stack.
- Preserve an existing poison unchanged. Submit an existing `RuntimeError` unchanged to the current execution and propagate its authoritative fatal Error.
- Reusing one native Error at another causal boundary creates another occurrence wrapper.
- A root import returns its occurrence wrapper. A nested import leaves host storage unchanged and stores the wrapper as that parent-key placement's fixed logical version.
- Store no wrapper on the native Error identity and keep no execution-wide Error-keyed cache.

`combineErrors` accepts only contextualized poison and no execution or context:

1. Require at least one input; zero is a fatal invariant failure.
2. Flatten nested compounds.
3. Preserve caller-defined logical order.
4. Deduplicate occurrence wrappers by an object, Function, or Symbol cause. For a primitive or absent cause, use leaf identity so separately thrown equal primitives remain distinct.
5. Return the original leaf when only one remains; otherwise create `CompoundPoisonError`.

The compound exposes all surviving leaves through `.errors`. Its primary context is the first leaf's source; `.kinds` contains distinct child kinds in first-occurrence order, and `.kind` is that sole kind or `ERROR_KIND.Multiple`. Its caller-supplied message names the failed boundary without enumerating children.

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

Wrap only the exact synchronous host-controlled action in private `runUserCode`:

1. Enter the runtime-wide re-entry guard.
2. Run the host action.
3. Rethrow `RuntimeError` unchanged; wrap every other throw, including poison, in private `UserCodeFailure`.
4. Leave the guard in `finally`.

The owning semantic boundary catches only `UserCodeFailure`, preserves a contained poison or contextualizes another reason with its context and kind, and then applies its graph effect. Preparation, export, import, publication, bookkeeping, and cleanup remain outside this envelope. An unmarked failure from that work is fatal. Application code and effectful host reflection use the envelope. A captured built-in is runtime-owned only on runtime-owned, hook-free inputs; applying it where a Proxy or host trap may run is supported host code.

Invalid host output is recoverable when the boundary can reject it without compromising runtime invariants, such as an unsupported callback result or invalid completed managed receiver. Host behavior is fatal when it makes runtime state, ownership, ordering, publication, or cleanup untrustworthy.

A direct Promise returned by supported host code settles after the synchronous envelope. Its first existing boundary continuation converts a raw rejection with the context and kind recorded when the Promise was accepted. Do not recreate the host envelope or allocate an attribution-only Promise.

Use this implementation inventory:

| Causal boundary | Source | Kind |
| --- | --- | --- |
| Throwing `then` getter on first sample | Sampling operation | `ThenAccessThrew` |
| Synchronous failure invoking captured `then` | Custom thenable: operation creating its settlement Promise; native Promise: registering operation | `ThenInvocationThrew` |
| Ordinary Chain root value or rejection | Chain initialization | `ChainValueFailed` |
| Context root value or rejection | Context import | `ContextValueFailed` |
| Supported import reflection failure | Import operation | `ImportThrew` |
| Assignment value or rejection | Assignment operation | `AssignmentValueFailed` |
| Required operation input failure | Consuming operation | `OperationInputFailed` |
| Null or undefined lookup receiver | Lookup operation | `NullLookup` |
| Scalar lookup receiver | Lookup operation | `ScalarLookup` |
| Invalid path segment | Segment-consuming operation | `InvalidPathSegment` |
| Supported lookup reflection failure | Lookup operation | `LookupThrew` |
| Absent selected method | Invocation operation | `MissingFunction` |
| Present non-callable method | Invocation operation | `NotAFunction` |
| Host call throw, returned Error, direct rejection, or nested returned failure | Invocation operation | `UserCallThrew` |
| Controlled callback or comparator throw or returned Error | Owning controlled operation | `UserCallThrew` |
| Unsupported controlled-callback result | Owning controlled operation | `InvalidCallbackResult` |
| Export validation or supported reflection failure | Export operation | `ExportValueError` or `ExportThrew` |
| Invalid completed managed receiver | Managed mutation | `InvalidManagedReceiver` |
| Trusted runtime callback failure without an explicit host-code contract | Owning operation | fatal `RuntimeError` |
| Query, refcount, mirror, publication, gate, cleanup, or other runtime-owned failure | Failing operation | fatal `RuntimeError` |

An absent intermediate placement reads as `undefined` and therefore produces `NullLookup` when traversed. A missing method remains distinct from a present non-callable method. Phases 9E–10 add their external-operation and Promise-path kinds without changing this funnel.

### 3. Preserve origin through deferred work

A custom thenable's cached settlement Promise carries only its private non-thenable raw first-settlement record. It does not recursively process the result and carries no consumer source. Each causal boundary that introduced the thenable interprets the record with the operation context retained by that boundary; later non-boundary consumers preserve its contextualized outcome. Use one hook-free contextualization primitive for ready native Errors, marked synchronous host throws, and raw boundary-Promise rejections.

- Import-created root and nested Promises use the import operation.
- A pending Chain root installs its exact initial property version and Promise mirror during Chain initialization.
- Assigned Promises use the assignment operation.
- A direct host result and Promises admitted inside it use the invocation operation.
- A copied or derived pending placement gets a fresh mirror at its own FIFO position but preserves the source mirror's eventual contextualized Error.
- A later consumer supplies context only for a new failure it causes.

Do not retain Chain initialization context as a fallback. Different operations on one Chain may therefore produce Errors with different sources. Attach the originating operation context only to the root version, mirror, continuation, or boundary work that may still create a new Error. Release it after settlement has produced a contextualized Error or successful value. Shared settlement is source-neutral.

Do not add `valueWithOrigin`, a forwarding Promise, Promise subclass, overridden chaining method, parallel continuation system, or runtime-wide Promise brand. Contextualize in the first import, mirror, validation, or publication continuation the boundary already needs.

An existing contextualized poison rejection normally propagates unchanged. Intercept it only for a different semantic transition:

- **Graph publication:** publish the Error as the placement's logical value, then reject the operation with that exact Error.
- **Complete independent-input collection:** record every poison outside the aggregate Promise and fulfill internal branches with non-thenable readiness values. An unclassified raw rejection reaching the collector, or a fatal rejection, still fails immediately.

Delete helpers whose only purpose is converting every poison rejection into fulfillment. Keep separate helpers for publication and complete collection only when they remove duplication; do not replace them with flags, a shared result wrapper, or a configurable continuation path. The custom-thenable first-settlement record remains private to assimilation.

Thenability acquisition and assimilation are execution-local:

- Sample `then` at most once per identity in one execution. A throwing getter uses the first sampling operation.
- Register directly on a genuine native Promise's captured native `then`. Native assimilation precedes fulfillment, so classify a fulfilled Error but do not resample fulfillment thenability.
- Invoke a captured custom `then` only with callbacks that fulfill one cached settlement Promise with a hook-free record equivalent to `{ fulfilled, value }` or `{ rejected, reason }`. Never give an arbitrary thenable a native Promise resolver.
- A throw before custom-thenable settlement uses the operation creating the settlement Promise and is stored as its already contextualized rejected outcome. Ignore a throw or callback after settlement.
- Each causal boundary that introduced the thenable interprets the record with its retained operation context. The same raw rejection is contextualized independently at each introducing boundary; a later non-boundary consumer receives the existing Error. Fulfillment recognizes every Error form first, then consumes a nested thenable through execution-local capture using that boundary context before continuing.
- The settlement record never escapes the continuation mechanism. Successful invocation retains neither the callable nor its operation context. A failed sample retains its contextualized rejecting state for that execution.
- Declaration probes remain contextless, raw, and operation-local.

Observe only Promises consumed or owned by supported kernel work. Mark kernel-owned Promises handled when their consumer may attach later, without replacing them. Do not recursively observe unused host input; discarded-expression handling remains a higher-runtime responsibility.

### 4. Generalize placement versions and keep import atomic

Replace `meta.mirrors` with one parent-key placement-version map:

- Promise mirrors and fixed imported-Error overlays share logical read, replacement, detachment, and captured-version behavior.
- Promise continuation and settlement remain Promise-specific.
- Initialization, assignment, import, copy, and retained results install versions in the selected execution.
- An initial Promise resolver contextualizes its raw rejection once; derived versions preserve the source mirror's published Error.
- `language-properties.js` reads the live version before physical storage and no longer derives Error source from import origin.

Keep import as one function-based staged identity walk per synchronous segment:

- Stage admissions, origins, retentions, Promise placements, fixed Error versions, and external-tree leaves; commit only after the whole segment validates.
- A failed segment commits none of them. Promise fulfillment starts a fresh segment.
- Keep external-tree discovery as a separate occurrence walk: admission deduplicates identities, while tree construction must preserve every finite alias path. The two walks still commit atomically.
- Do not add an `ImportTransaction` class.

Try making `import-preparation.js` own one fulfillment-segment processor that `property-versions.js` calls after imported Promise settlement. Keep the rewrite only if it removes the property-version-to-import dependency and the installer-callback tuple rather than recreating them under new names; otherwise retain the current function-based flow.

### 5. Migrate components without adapters

| Component | Responsibility |
| --- | --- |
| `error.js` | Poison classes, `ERROR_KIND`, contextualization, compounds, and `runUserCode`; retain Phase 9C's fatal branch unchanged |
| `language-values.js` | Context-free semantic Error recognition, Error-before-Promise precedence, direct native-Promise registration, and non-assimilating custom-thenable settlement and nested capture |
| `meta.js` | Placement-scoped fixed versions; no native-Error wrapper cache |
| `property-versions.js` | Common placement overlays and Promise-specific settlement |
| `language-properties.js` | Current-context validation and logical-version-first reads |
| `resolution.js` / `operation-lifecycle.js` | FIFO continuation and operation lifetime; ordinary poison propagation plus distinct publication and complete-collection transitions |
| Import, assignment, lookup, invocation, conversion, and export modules | Their narrow causal boundaries and exact kinds; Phases 9E–9F apply the same funnel to external operations |

Invocation applies the common boundary to managed records and classes, String host calls, controlled Array callbacks, member reflection, argument export, direct host-result Promises, and result import. Complete every required argument Error scan before host invocation. Export and Error queries preserve reached Errors and classify only failures they cause. Mutation and observation use their own contexts for path validation, reflection, and publication. Declarations remain the explicit contextless host-configuration exception.

Delete the transitional machinery in the same change:

- `CascadaError`, `PoisonedValue`, `RuntimePromise`, and `PoisonErrorGroup`;
- `valueWithOrigin` and attribution-only Promise paths;
- transport-specific Error kinds and generic source strings such as `\"run method result\"`;
- separate imported-Error overlay storage;
- the imported-at message suffix;
- catches that merely forward or reclassify failures outside the classification and recovery roles defined by `error-handling.md`.

### 6. Implement in a safe order

Keep the full suite green after Phase 9C, then change Phase 9D in this order:

1. Apply the transport-neutral kind renames and direct Error inheritance. Remove the public runtime `CascadaError` base only after both concrete branches no longer extend it.
2. Make every Promise predicate recognize all native Error forms before sampling `then`, and make zero-input `combineErrors` fail as a runtime invariant.
3. Install causal contextualization at existing boundary continuations and remove `valueWithOrigin` and attribution-only Promise paths.
4. Replace custom-thenable native assimilation with the source-neutral settlement record.
5. Audit every internal Promise fulfillment that can currently return poison. In particular, update `continueInitial`, `continuePrepared`, `continuePreparedAll`, and the aggregates in `operation-lifecycle.js`, `export.js`, `managed-invocation.js`, and `observations.js` so publication and complete collection keep poison outside non-thenable readiness fulfillment.
6. Add rejecting-thenable behavior to `PoisonError` and `CompoundPoisonError` only after those internal paths are safe. Remove any remaining transitional wrappers in the same change.

Do not commit or review an intermediate step as the phase end state. The order exists only to keep failures observable while implementing and testing the atomic final behavior.

### Verification

#### Representation and attribution

- Both poison types are native Errors, sync-first rejecting thenables, and reject with their exact identity through `await` and assimilation. `RuntimeError` is a non-thenable native Error. No shared runtime base or legacy wrapper remains.
- Every Error form precedes thenability inspection, including hostile Error values with throwing `then` properties.
- Every poison has a stable nonempty source and kind. Ready and pending forms of one failure use the same kind; later consumers preserve both.
- Reusing one native Error at two boundaries creates two occurrence wrappers. Propagating one preserves it; combining them deduplicates by their shared identity-bearing cause. Separately occurring equal primitive causes remain distinct.
- Root and nested imported native Errors receive occurrence wrappers without modifying host storage. A failed import segment commits none; a later successful import receives the later context.
- The attribution matrix covers ready and Promise-backed values, direct and copied property versions, repeated consumers, and genuinely new downstream failures.

#### Promise and boundary behavior

- Raw import, assignment, and host-result rejections use their introducing boundary. Shared settlement and copied mirrors never substitute the consumer that advances them.
- Throwing `then` acquisition and captured-then invocation use their exact operations and preserve native first-settlement-wins behavior. Native registration failure belongs to the registering operation, and native fulfillment is not resampled for thenability. A custom thenable's cached Promise exposes only a private non-thenable first-settlement record; each introducing boundary applies its retained attribution and nested capture. Successful thenability state retains no operation context.
- Two causal boundaries consuming one custom thenable's raw rejection create separately contextualized occurrences; a cached acquisition or invocation failure instead preserves the first sampling or invocation operation.
- A `RuntimeError` in any ready, fulfilled, thrown, rejected, or nested host-result position is submitted unchanged to the current execution and never admitted, stored, or exported as language data.
- `runUserCode` marks every nonfatal throw from only the exact synchronous supported host action. Its boundary preserves contained poison or contextualizes another reason and applies the graph effect. Adjacent runtime work and trusted callbacks without a host-code contract remain fatal. Synchronous host re-entry is fatal.
- A direct Error follows the same boundary and graph-effect rules whether returned, fulfilled, thrown, or rejected. A direct mutation Error poisons the receiver; an Error from an independent nested result does not retroactively poison published state.
- Direct host-result rejection is converted once in its existing boundary continuation. No attribution-only Promise or parallel continuation path remains.
- Required independent inputs all settle and combine poison in logical order without fulfilling an aggregate branch with a thenable Error. An unclassified or fatal rejection closes the operation.
- Kernel-owned Promises remain handled; unused host input is not observed solely to suppress rejection reporting.

#### Graph, compounds, and import

- Promise mirrors and fixed Error overlays use one placement-version map and common logical access. Fixed versions are never treated as pending.
- Compound construction rejects zero inputs, flattens nested compounds, preserves logical order, deduplicates identity-bearing causes, retains separately occurring equal primitive causes, exposes all surviving leaves, and derives `.kind` and `.kinds` correctly.
- Existing Error queries preserve occurrence identity. `hasError` still exits early; `getErrors` and argument/export collection remain complete. Runtime-owned traversal failure is fatal.
- A graph Error is published before its assimilating operation Promise rejects with it.
- Import remains segment-atomic. Tree discovery and admission remain separate walks but commit together. Keep the fulfillment-processor dependency experiment only if it removes indirection.

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
- `phase`: the readers-writer cursor whose completion payload is the sole repairable poison state.

The location is the live tree leaf supplied by Phase 9A. `CONFLICT` retains the first stable `ExternalLocationConflict` and its context. The Error identifies the first incompatible use category and locations without retaining operation history. Later uses preserve it without reattribution. There is no reverse leaf list, proposed transition, operation history, or separate current-poison field on the durable entry.

Import, storage, copying, return, and other value transport do not count as actual use. A call or property operation through an external boundary does:

~~~text
unset + live leaf L       -> ONE(L)
unset + any other use     -> CONFLICT
ONE(L) + same leaf L      -> unchanged
ONE(L) + any other use    -> CONFLICT
CONFLICT + any use        -> preserve the first conflict Error
~~~

Mutation additionally requires a live tree leaf. An identity absent from every static tree is observation-only and needs no identity entry or phase.

A direct lookup that would expose a mutation-capable identity fails before exposure and records no use, but still joins its observation phase. Export rejects it without recording use or acquiring a phase. A conflict discovered by an operation with a phase publishes its Error after the ordered predecessor and performs no host access.

Use through a copied, moved, aliased, Promise-revealed, differently pathed, or differently chained occurrence conflicts. The operation performs no host access. Conflict is permanent, does not cancel earlier issued work, and cannot be repaired.

Evaluate all use proposals for one operation as one batch:

1. Read one pre-operation state.
2. Compute proposals and collect conflicts in deterministic receiver/path order.
3. If any conflict exists, commit every permanent conflict but no compatible new `ONE` state.
4. Otherwise commit all new locations together immediately before host access.

Only static-tree lookup prunes leaves. When it encounters a committed conflict, remove that queried leaf and return no candidate. The identity map continues to reject references absent from the tree.

### 2. Coordinate one operation locally

`ExternalOperationContext` reuses the ordinary operation context and owns one identity-keyed map of selected records. Each record contains:

- selected location;
- strongest access mode;
- proposed `use` transition;
- phase-completion handle; and
- repair intent.

It owns no graph traversal, scope selection, host invocation, managed publication, durable identity state, or final result. Phase 9F creates it only when an operation selects indexed external coordination and supplies the complete selection before the first wait.

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

Each successor captures its predecessor completion, including repairable poison. Observations in one read group share their exclusive predecessor, overlap one another, and do not retroactively consume peer poison. Their completed group combines new poison in issuance order for the next exclusive operation.

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
- Batch evaluation is iteration-independent: a failed batch commits all permanent conflicts and no compatible first locations.
- Conflict does not cancel earlier phases, never invokes host code, preserves its first Error, and cannot be repaired.
- Observations overlap after their exclusive predecessor. Mutation and repair wait for the entire read group.
- Every successor is published and the set is frozen before predecessor waiting. One operation's entries never wait on one another.
- Mutation poison preserves child attribution. Observation does not replace it; repair changes only repairable phase poison.
- `ExternalOperationContext` uses one selected-record map and contains only operation-local coordination.
- Each durable identity entry contains only `use` and `phase`; repairable poison exists only in phase-completion payloads.
- Add no public route, path selector, second index, hidden-Chain adapter, scheduler, live occurrence graph, or reverse leaf index.

---

## Phase 9F: Route and cut over external operations

### Problem

Phases 9A–9E provide execution-local graph state, causal Error handling, the static external mutation tree, durable identity state, readers-writer phases, poison, and internal repair. Route every external call and property operation through those mechanisms, expose repair, and remove the hidden sequence Chain in the same change.

### 1. Finalize the public operation API

Extend `run` with the required exact `repair` Boolean:

~~~js
run(chain, path, method, args, {
  mutationScopeDepth,
  repair,
})
~~~

- `repair: true` requires a mutation scope, is valid only for `run`, and performs repair-and-call.
- Assignment and deletion accept no repair fact.
- Add `repairPath(chain, path)` for repair-only. It targets an existing fixed external location, invokes no host code, and repairs no managed graph Error.
- Assignment still replaces, and deletion removes, an Error at their final managed placement. Neither operation implicitly repairs external phase poison.

### 2. Use one external-operation lifecycle

After hook-free internal dispatch accepts the operation:

1. Capture the final compiler-provided operation facts.
2. Query the complete receiver or property path for the exact external boundary or first boundary prefix. Observations query too. Mutation also selects live external leaves below its mutation scope.
3. Create one `ExternalOperationContext` when indexed coordination is selected. Merge records by identity, let mutation win over observation, publish every phase successor, and freeze the set before waiting.
4. Capture ready managed property versions, any ready external boundary, and input export. Apply the ordinary managed lease or gate at a managed prefix. Export rejects mutation-capable external values instead of selecting phases for them.
5. Wait for phase predecessors and ordinary readiness concurrently.
6. Finish all required preparation and Error collection.
7. Evaluate every use proposal from one pre-operation state. Commit permanent conflicts deterministically. If any preparation or conflict Error exists, commit no compatible location and perform no host reflection.
8. Otherwise commit all new locations together, traverse the captured host suffix once, and resolve or invoke its selected member once.
9. Process the boundary result: import call results and observation-only external-property results; snapshot property results inside mutable external state.
10. Publish managed state, mutation poison, or repair, then complete the selected phases.

Before step 8, do not inspect application-controlled proxies, descriptors, getters, setters, properties, or methods. Prepare a callable as executable rather than importing it as data. Constructors remain unsupported.

The phase set never expands after the first wait. A later-revealed mutation-capable receiver must match an already selected boundary or fail before host access. A mutation-capable identity found in host input fails export without acquiring a phase.

### 3. Compose managed and external mutation scopes

`mutationScopeDepth` identifies the complete `!` prefix:

- **External scope:** select the exact external boundary. Use its phase and no managed COW, lease, or gate. A deeper `!` clamps to the first external boundary because the host suffix is opaque.
- **Managed scope:** use the ordinary managed transition at that prefix. Select live external leaves below it only for an external host effect declared by this operation.
- A managed method receives no authority over opaque external descendants merely because they occur in its receiver.
- Publish every selected external successor before a managed transition waits.
- Keep a pending managed gate and selected external phases through the same direct-Promise boundary.

For managed `apis` containing external `db`:

- `apis.db!.write()` selects `db`.
- `apis!.db.refresh()` protects and publishes managed `apis` and selects live external leaves under `apis` for the declared host effect.
- If `apis` is external, either form selects only `apis`.

The static tree is not a COW predicate. Managed assignment creates another owner; later mutation through either managed placement uses ordinary COW. External identities remain exact and mutate in place only under their phases.

Before publication, reject any controlled replacement, deletion, or Array remap that would remove, replace, hide, or relocate a live tree leaf. Allow an Array change that preserves every live leaf's exact path and identity. Apply the same validation to a managed host method's private completed receiver: a detected containment violation is recoverable `InvalidManagedReceiver`, poisons that receiver and every selected external phase, and publishes none of the invalid managed state. Host behavior is fatal only when it has already changed external state without authority or made another runtime invariant untrustworthy. A managed alias may be stored, but actual external use through another path conflicts.

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
- Conflict performs no host access, is permanent, and cannot be repaired.
- Repair-only bypasses and clears repairable predecessor poison and returns `undefined`. Repair-and-call bypasses old poison, then clears it on success or publishes the new mutation Error.
- Host code cannot reenter Cascada while its direct invocation remains active.

Attribute new failures at the selecting operation:

| Failure | Kind |
| --- | --- |
| Getter, descriptor, or Proxy property read | `ExternalPropertyReadThrew` |
| Ready Error or direct rejection read from external property | `ExternalPropertyValueFailed` |
| Setter or deletion | `ExternalPropertyWriteThrew` / `ExternalPropertyDeleteThrew` |
| Member selection, call throw, returned Error, or direct call rejection | Phase 9D invocation kind |
| Managed containment inside external live state | `InvalidExternalContainment` |
| Mutation-capable identity escape | `ExternalCapabilityEscape` |
| Promise nested in mutable-property snapshot | `InvalidExternalSnapshot` |
| Repair validation | `ExternalRepairFailed` |
| Fixed-leaf identity mismatch | fatal `RuntimeError` |

Preexisting poison and mutation poison retain their original child attribution. Repair-and-call host failure keeps its host-call kind.

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
- Mutable external identities never escape through lookup, return, export, assignment, script result, or callback input.
- Use proposals commit atomically from one snapshot; failed batches grant no partial authority.
- Every explicit host argument and external write value uses common export, including after Promise fulfillment.
- Mutable-property snapshots preserve Arrays, aliases, cycles, prototypes, and Functions while copying every traversable identity. They reject Errors, nested Promises, managed containment, and separately indexed mutable identities without exposing partial data.
- Observation-only property results and all call results use ordinary import; external call results additionally reject their exact receiver.
- A direct property Promise retains its phase until snapshot completion. Nested snapshot Promises create no mirror or continuation.
- Comparator sort rejects mutation-capable elements through common export and needs no extra phase or release callback.
- Failure and repair preserve the Phase 9D contexts and kinds; repair never clears conflict.
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

Centralize the identical ready-or-Promise consumption and String/Number validation. Observation and mutation keep their existing walkers because mutation also owns COW, writeback, gating, and failure publication. Both walkers follow the same one-time prefix-protection and resumption protocol.

### 2. Protect the first pending prefix once

Walk ready leading segments synchronously. A completely ready path keeps its existing operation and synchronous behavior.

Before registering the first pending segment:

| Prefix | Observation | Mutation |
| --- | --- | --- |
| Managed | Lease the reached prefix value | Install the ordinary transition gate at the reached prefix placement and continue against its private working value |
| External | Publish selected observation phases; no lease | Publish selected mutation phases; no managed gate |

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
- Standalone lookup and mutation obtain one owner through one centralized provision point.

For standalone paths, compare eager `OperationOwner` creation at operation entry with lazy creation at the first asynchronous registration. Keep lazy creation only if it remains confined to that provision point and materially avoids ready-path allocation without spreading optional-owner branches; otherwise create one owner eagerly.

Every pending segment continuation, external predecessor wait, and asynchronous registration uses the guarded FIFO helpers. Property-version APIs remain unaware of operation owners.

A continuation first completes shared mirror, placement-version, refcount, and required settlement bookkeeping. If its owner has closed, it performs no later normalization, traversal, protection, phase work, host access, publication, or result production.

Observe every pending walker continuation at its originating layer, including a non-blocking mutation API that does not return that Promise.

Close work only after required publication:

- A standalone observation closes when its final result or fatal failure is determined.
- A pending mutation closes after its gate publishes success or failure, not when its non-blocking API returns.
- A path component inside invocation, export, or an Error query creates no independent lifetime.
- Closing operation work never abandons required gate or phase completion.

### 4. Protect possible external targets before waiting

On a context Chain with an unresolved suffix:

1. Query the ready prefix in the static external mutation tree for every live leaf the suffix may reach.
2. Merge and publish those phases together with any managed prefix lease or gate.
3. Freeze the phase set before waiting.
4. After resolution, record actual use only for the exact boundary and normalized path reached.

Use the existing live-descendant tree query; add no candidate-path analysis or external index.

A phase selected only because the suffix is unresolved is **provisional**:

- It contributes no use proposal, mutation authority, predecessor poison, or operation Error unless resolution selects that boundary.
- If unselected, it still waits for its predecessor and completes with the prior poison unchanged, preventing later operations from overtaking it.
- Segment failure or resolution to managed state completes it unchanged.
- A leaf independently selected by an explicit broader mutation scope remains an actual mutation entry.

After resolution, acquire no new phase. External mutation succeeds only when the exact boundary is a live leaf already selected for the operation. Otherwise return an Error before host access. An unindexed external identity remains observation-only.

If late external-authority validation fails below a managed gate, republish the unchanged managed prefix rather than poisoning it.

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
- Root, middle, and final Promise segments resolve and normalize for lookup, assignment, deletion, invocation, export, Error queries, and `enter`.
- Broken ready prefixes do not wait for or observe unused segments.
- Segment rejection and invalid fulfillment follow ordinary Error publication at the protected prefix and preserve the source rules above.
- Observation and mutation share consumption and resumption without sharing COW, writeback, gating, or failure-publication logic.

#### Protection and lifetime

- A pending observation leases the longest ready managed prefix once; later mutation COWs without changing its captured result.
- A pending mutation gates that prefix before waiting; conflicting work cannot overtake it and unrelated paths continue.
- Several pending segments share one scope while preserving aliases, mirrors, FIFO order, and Error identity.
- Every asynchronous registration has an owner. Closed work completes shared settlement but performs no later operation work.
- A hidden pending mutation continuation remains observed after its public API returns and closes only through fatal failure or gated publication.
- `hasError` retains early-exit behavior; `getErrors` completes its full Error walk. Both release unfinished query-only state when their shared owner closes, while traversal failure remains fatal.
- Owner provisioning stays centralized; retain laziness only under the criterion above.

#### External ordering

- Before waiting, an unresolved context suffix publishes every possible live external phase and records no actual use.
- Resolution never expands the phase set. Exact external mutation requires a selected live leaf; an unindexed identity remains observation-only.
- Unselected provisional phases carry no authority or new Error but complete in predecessor order with unchanged poison.
- Ready and Promise-resolved equivalent String/Number paths reach the same authority.
- Late authority failure republishes unchanged managed gated state.
- Gate, mirror, phase, and publication failures use their own operation context; source rejection retains its producer.

No temporary Chain, direct `enter` call, new queue, operation-specific walker, or second scheduler remains.

Update [`AGENTS.md`](../AGENTS.md), [`data-limitations.md`](data-limitations.md), [`promise-path-segments.md`](promise-path-segments.md), [`outbound-export.md`](outbound-export.md), [`counters-implementation.md`](counters-implementation.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), [`enter.md`](enter.md), [`work-bounds.md`](work-bounds.md), and public path-operation documentation.
