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

## Phase 6: Establish state modes and inbound admission

### Problem

Class registration is too coarse for context data: records cannot be declared external, while managing one class instance requires registering its whole class. Import also infers origin from operational metadata and splits one boundary into imported and runtime walks.

### Design

[`managed-and-external-state.md`](managed-and-external-state.md) is the detailed architecture.

#### 1. Declare identity capabilities

Add `externalState(value)`, `managedState(value)`, and variadic `managedStateClass(...classes)`. A successful identity declaration returns its original argument. Replace `registerDataClass` and registered/opaque API terminology without adding compatibility aliases. Keep `import` as the sole public host-data entry point. Phase 10 adds execution for admitted external identities.

Store explicit identity declarations in one external `WeakMap` and managed class prototypes in one `Set`. Do not modify declared objects or admit them merely by declaring them. Repeated matching declarations are idempotent. An explicit identity declaration overrides a class rule; a contradictory identity declaration or a declaration contradicting an admitted type returns a validation Error without changing the established mode.

`externalState` applies shallowly to records, Arrays, and class instances. Functions, Errors, Promises, callable thenables, and primitives reject it. `managedState` walks the currently reachable managed data once, declaring every reached class instance while preserving aliases and cycles and stopping at explicit external identities. Arrays remain managed unless explicitly declared external. The walk does not register encountered classes. Every managed class prototype must satisfy the existing registered-class contract. Validate the complete declaration, including prototypes and conflicts, before recording anything. `externalState` rejects a Promise or callable thenable argument, while `managedState` rejects one anywhere in its declaration walk. Neither waits for it.

A class instance added later follows its own identity or class declaration. Do not infer a declaration from managed containment or add an encountered class to the class registry.

`managedStateClass` validates every supplied exact prototype before committing any of them and affects only later admission. Reuse the existing registered-prototype validation and delete the superseded registration API and terminology.

#### 2. Make admission authoritative

Resolve callable thenables before admission. Preserve Error and Function semantics first. An identity obtained as live external property state remains external, including a record or Array. An explicit external identity declaration likewise admits a record, Array, or class instance as external. Otherwise classify logical Arrays intrinsically, apply an explicit managed declaration to a record or class instance, default records to managed, and use the exact managed-prototype registry or external default for class instances. An explicit identity declaration therefore overrides the record default and any class rule.

Admission resolves these inputs once and stores the final category and prototype in the existing identity metadata. Later runtime behavior reads only admitted metadata. A copy receives fresh metadata containing its source category and prototype; it receives no declaration or class-registry entry. Classification remains fixed after first admission.

Make import consume these categories without becoming the classification owner. An identity with established origin and classification retains them; import does not infer either from operational metadata.

#### 3. Make import one-way

Every host-provided root, including each context root, passes through the existing `import(value, errorContext)` boundary. Values transferred within Cascada retain their admission, origin, and ownership without importing again. External identities are observation-only by default. Phase 9 owns context construction, occurrence indexing, external mutation authority, and ordering without adding another inbound data boundary.

Implement declarations and authoritative classification first, then replace import's imported/runtime split with the one-way walk below.

Use one importer for public host roots and supported host-call and external-property results. Honor `externalState` and `managedState` declarations returned by host code. A new managed identity becomes imported and shared. Existing identity metadata identifies an already admitted result, including unexported data returned by another Cascada execution. Retain it without another graph walk or origin change, and mark it shared when the result adds an owner. Phase 10 uses the same importer without adding another boundary implementation.

Pass the complete host result, ready or direct-Promise, to this boundary once. A ready result returns its admitted logical value. A direct Promise returns an operation Promise whose fulfillment is the admitted value or an admission Error and whose rejection is unchanged. Replace the current observer that discards asynchronous admission output; otherwise ready and Promise-backed host results are not sequentially equivalent.

For each synchronous import segment, capture and validate the complete reached shape before committing origin, sharing, or Promise mirrors. This prevents a reflection failure from leaving a partially imported graph. After validation, record new identity origins, mark managed traversable identities shared, and traverse records, Arrays, and managed class instances once while preserving aliases and cycles. Stop at Functions, Errors, and external identities.

At host-root and supported host-result boundaries, register every reached Promise placement through its captured property version. Promise fulfillment continues the same import boundary for newly reached values. Imported physical storage retains its Promise and publishes settlement only through the mirror; normal runtime-owned writeback remains unchanged.

Treat fallible enumeration and descriptor lookup at their existing user-code boundary. Ordinary accessors and non-enumerable properties remain outside the graph and are not invoked. Delete runtime-island detection, `hasOperationalMetadata`, `promoteRoot`, the separate runtime walk, `runtimeScanned`, `metadataBeforeRuntimeScan`, `discoverRuntimePromise`, and the root/result preparation split. Imported origin is explicit, so no host-change reconciliation or import-specific ArrayView machinery exists.

Chain construction, assignment, and internal transfer do not imply import.

This phase implements declarations, authoritative admission, and one-way import. Phase 7 centralizes outbound export without reopening admission.

### Verification

- Records and Arrays admit as managed by default, except that `externalState` or live external property state makes their exact identities external. An undeclared class instance admits as external.
- Identity declarations return their exact arguments, are atomic across nested classes, aliases, cycles, and prototype validation, and reject Promises or intrinsic categories they cannot change without waiting or partially committing.
- `managedStateClass` affects later instances only. Explicit identity declarations override defaults and class rules, contradictions return an Error without reclassification, and `externalState` remains shallow and exact for records, Arrays, and class instances through every alias.
- Public `import` accepts arbitrary host roots, honors existing declarations, and leaves external identities observation-only. Transfers from existing Cascada values do not import again.
- Copies preserve admitted managed-class type and prototype without acquiring declaration entries.
- One importer handles public host roots and supported host results, visits each new managed identity once, preserves aliases and cycles, and stops at external identities, Functions, and Errors. Existing identity metadata skips graph import for an admitted result, whose origin remains unchanged.
- Ready and Promise-backed host results have the same admission outcome. A direct Promise fulfills with the imported value or admission Error, preserves rejection, and never publishes a raw fulfillment whose admission failed.
- An admitted result, including unexported data returned by another Cascada execution, is recognized from identity metadata and retained without traversing it again.
- Imported Promise settlement remains mirror-only and continues import for newly fulfilled data under the captured boundary. Runtime-owned Promise settlement keeps its existing writeback behavior.
- Import invokes no ordinary accessor. A throwing enumeration or descriptor trap produces the boundary's language Error and commits no origin, sharing, or Promise mirror from that synchronous segment; internal failures remain fatal.
- No runtime-island, separate runtime scan, compatibility registration, or registered/opaque category API remains. Host mutation of imported managed storage is unsupported.

Update [`AGENTS.md`](../AGENTS.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`data-classes.md`](data-classes.md), [`import-preparation.md`](import-preparation.md), [`array-view.md`](array-view.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 7: Centralize outbound export

### Problem

Export is scattered across host-call categories, including a shallow Array-override receiver path. This duplicates availability resolution, copying, and lease lifetime decisions at each outbound boundary.

### Design

[`managed-and-external-state.md`](managed-and-external-state.md) defines the complete inbound and outbound boundary architecture shared with Phase 6.

Use one exporter and graph copier for every explicit argument passed to native JavaScript, every value assigned to an external property, and every public script result. This includes managed record and managed-class methods; runtime-controlled methods such as supported Array methods remain the exception and consume logical values directly. Export resolves required availability, removes runtime representations, and copies managed records, Arrays, and class instances into independent host data while preserving aliases, cycles, and admitted prototypes. Functions and external identities remain exact. Keep two named Error policies: host input preserves nested Errors while a consumed top-level Error prevents invocation or assignment; public result consumes every reached Error. Do not duplicate the walk or turn the difference into a general strategy layer.

Source leases protect managed data only while export may still read it. Release them when export finishes, before host invocation. A returned host Promise may retain exported copies and exact external identities but never prolongs leases on their managed sources. Phase 10 keeps any external identity phase independently through settlement.

Make common host-input preparation export both receivers and explicit arguments required by the selected boundary. An Array override therefore receives one complete native Array containing no ArrayView, unresolved language Promise, or original managed traversable identity. Its result uses Phase 6's ordinary host-result import. Delete override-specific receiver selection through `requiresArrayMaterialization` and its receiver-lease inference; retain that predicate only for representation mutation and COW. Do not restrict valid ArrayView backing reuse, and never use imported Array storage as mutable backing.

An own enumerable Function placement continues to shadow an Array standard method and remains observation-only. Reject mutation through an override and native Array mutation requested as observation. Preserve controlled method behavior, including eligible backing reuse by observations such as `concat`.

Host results use Phase 6's common import, including its operation-Promise result for direct Promises, and public script results use the common export. No host category owns a second importer, exporter, graph copier, or availability resolver.

Phase 10 adds external argument guards around this one exporter. Export itself grants no mutation authority and adds no guard-specific path.

### Verification

- Every native JavaScript argument, externally assigned value, and public script result uses the common export. Managed methods use it; runtime-controlled methods do not.
- Host-input export preserves nested Errors and stops on a consumed top-level Error; public-result export consumes and combines all reached Errors through the same copier.
- Exported managed data is independent, preserves admitted prototypes, and contains no unresolved language Promise or internal representation. Functions and external identities remain exact, while export records no use or mutation authority.
- Managed source leases end when export finishes. A returned host Promise retains no lease on exported source data.
- Common host-input preparation exports each boundary-consumed receiver and argument. An Array override receives one complete exported native Array, and returning it yields its imported host value rather than the logical receiver.
- Array overrides remain observation-only; same-named managed methods and controlled Array methods keep their category semantics.
- Removing override-specific materialization inference does not change controlled Array behavior or valid backing reuse.
- Host results retain the Phase 6 importer, while no host category adds another importer, exporter, graph copier, or availability resolver.

Update [`AGENTS.md`](../AGENTS.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`array-view.md`](array-view.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 8: Generalize managed invocation

### Problem

Managed record functions cannot use their containing state as `this`, while registered-class invocation is already the required managed-state boundary. Managed methods also reject Promise results instead of treating a direct Promise as the call's completion.

### Design

#### Managed invocation

Rename registered-class invocation and its architecture document as managed invocation, and use it for managed records and managed class instances. Retain no compatibility module or document alias, and do not add a parallel record-method implementation.

Every own enumerable string-keyed data placement of a managed record is a possible method placement. Capture and prepare its logical property version before testing callability, so a Promise-backed placement is interchangeable with its resolved Function. Inherited properties, accessors, non-enumerables, and resolved non-Functions are unavailable as managed methods. Invoke a selected Function with the prepared record as `this`; outside a supported call position it remains data. Managed classes keep prototype method selection and their existing state contract.

Both receiver forms use Phase 5's complete receiver preparation, leases, mutation isolation, validation, and publication. Phase 8 replaces registered argument preparation with Phase 7 export and replaces independent result copying with import and ordinary shared ownership. Ordinary graph operations may leave Promises or Errors in managed state between calls, but receiver preparation consumes them and a completed mutation receiver may contain neither. A nested call such as `this.increaseBy(1)` is ordinary JavaScript on that prepared receiver, not another invocation or protection layer.

The complete receiver graph is the managed call's explicit work bound. Preparation, mutation isolation, and finalization may each traverse it; no call walk may escape into unrelated graph state.

Export every explicit argument after required phases complete and before host method selection. The method receives independent managed copies with admitted prototypes, while Functions and external identities remain exact. It may mutate, retain, or return exported managed data without changing Cascada sources. Runtime-controlled methods keep their existing logical-input preparation.

An observation remains read-only with respect to its receiver. Managed code may access its exported inputs and, for a mutation, change its isolated receiver until its direct result settles. Every asynchronous access or effect must belong to work represented by that Promise and finish before it settles; detached work and Cascada reentry during the active invocation are forbidden trusted contracts, not reasons to add async-context tracking. A Promise nested in a result may not later access the receiver. External effects require the guards already entered for exact external arguments.

A direct Promise keeps a managed call active until settlement. A Promise nested in a synchronous result is independent data and does not extend the call. Return an operation Promise that applies normal result handling to fulfillment and preserves rejection.

For an observation, lease every traversable receiver identity until the direct Promise settles. Argument-source leases end when export finishes before invocation. Later mutation proceeds through COW without delaying the observation. On fulfillment, import the result and give retained managed identities ordinary shared ownership; on rejection, leave the receiver unchanged and preserve the rejection. Release receiver leases after either path's last access.

For a mutation, keep the isolated receiver private behind its ordinary transition gate; receiver-source preparation leases end when isolation begins and argument-source leases end when export finishes. On fulfillment, validate and publish the receiver, then import the result; fulfillment with the working receiver returns the published receiver. A validation failure poisons the receiver and becomes the fulfilled operation result. On rejection, poison the receiver as for a mutator throw while preserving the rejection outcome.

A synchronous managed mutation publishes immediately. Import its result and mark retained managed identities shared instead of copying them. Directly returning `this` returns the published receiver with ordinary result ownership. Nested Promise placements continue through import without waiting.

### Verification

- A ready or Promise-backed own enumerable Function placement receives its prepared record as `this`; inherited, accessor, non-enumerable, and resolved non-Function placements remain unavailable, and extracted Functions remain data.
- `this.helper()` changes the already isolated receiver inside one managed invocation and publishes through its outer transition.
- Managed records and managed classes share one receiver preparation, argument export, isolation, validation, result, and cleanup implementation.
- The caller's operation mode must match the selected method's behavior. An observation method never mutates its receiver; a mutating method runs only in mutation mode.
- A managed observation returning a direct Promise holds receiver leases through settlement but no readers-writer phase. Exported arguments retain no source lease, and later mutation proceeds through COW without waiting.
- A managed mutation returning a direct Promise remains private behind a transition gate. Later operations wait, fulfillment validates and publishes once, and rejection poisons the receiver while preserving the rejection outcome.
- A completed managed mutation receiver containing a Promise or Error fails validation. This does not reject a direct result Promise, which extends the invocation, or a Promise nested in an independent result.
- Managed receiver and export-source leases are balanced after fulfillment, rejection, validation failure, and argument export.
- Direct-Promise fulfillment uses common import and shared ownership in FIFO order.
- A synchronous managed result containing a nested Promise returns immediately and imports its later fulfillment through the retained result placement.
- Work represented by a direct Promise may use the prepared receiver and exported arguments until settlement but may not reenter Cascada; nested-result or other later work is a trusted contract violation rather than an instrumented restriction.

Update [`AGENTS.md`](../AGENTS.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`registered-class-invocation.md`](registered-class-invocation.md), [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 9: Establish context external ordering

### Problem

Exact external identities need readers-writer ordering because managed COW, leases, and transition gates cannot protect their host state. Mutation must also remain limited to one compiler-static path of one context Chain.

### Design

[`external-context-ordering.md`](external-context-ordering.md) is the detailed architecture.

Implement one small readers-writer phase mechanism for external identities. It owns synchronous successor publication, predecessor waiting, observation grouping, nested child reservations, and completion. Keep graph publication and external poison at their natural owners; do not infer external ordering from managed graph state or add another command scheduler.

Phase 9 owns context construction integration. It marks the Chain as context, passes its host root through Phase 6's common importer, indexes every synchronously reached external occurrence, and maintains the index when ordinary context graph transitions add, remove, or move one. This is placement bookkeeping only: import, indexing, assignment, return, and storage never record a use.

Every operation carries a compiler-static-path fact independently of receiver classification. A path is compiler-static only when every segment to the reached identity is a compiler-known String or Number; a computed or Promise-valued segment remains dynamic even if ready.

Keep one execution-scoped WeakMap for external identity use: no entry, `{ usedInContextChain, usedAtPath, allUsesStatic, mutationAuthorized }`, `OUTSIDE_CONTEXT`, or `MULTIPLE_USE`. The object form names one exact context Chain and normalized path. Before mutation authority exists, a dynamic use at that location permanently clears `allUsesStatic`; another context Chain or path, or mixed context and non-context use, records `MULTIPLE_USE`. Lookup, receiver and property access, and argument use update this state before host access.

Mutation records its use first. It proceeds only from one recorded context Chain and path whose uses are all compiler-static. The first valid mutation sets `mutationAuthorized` before host access and fixes that location. Every later use must be compiler-static at the same Chain and path; an incompatible use returns a validation Error without host access and leaves the fixed state unchanged. A dynamic, `OUTSIDE_CONTEXT`, or `MULTIPLE_USE` mutation produces a validation Error, poisons the selected external phase, and invokes no host code.

Allow traversal and mutation below external identities. Record each external identity when reached, but never pre-scan external graphs or compare their descendants for aliases. The host must not expose one mutable resource through independently scheduled external roots. Hidden sharing is outside Cascada's guarantees because an identity discovered during host traversal cannot retroactively join an earlier operation phase.

Give every external identity one readers-writer phase state so duplicate selections join one phase. This does not redirect access through aliases or grant them authority. Exact operations select their reached identities directly. A context `!` prefix selects indexed external identities at or below that path. The index answers exact, longest-prefix, and descendant queries but stores no identity use or phase state. Managed operations retain ordinary COW, leases, and gates.

Classify before managed COW, transition gating, receiver preparation, or host reflection. An indexed external occurrence or exact external receiver selects external dispatch without COW or a transition gate. Managed work remains ordinary outside the selected external identities.

Register every selected receiver and argument identity phase when the operation enters the graph API. Publish all Chain and external successors before waiting. Consecutive observations share a read phase after the preceding mutation; the next mutation waits for the group. Entries created by one operation never wait on one another, duplicate identity entries merge at the strongest mode, and a direct Promise retains membership through boundary completion.

Each `!` source guards the exact external receiver or argument and the host state it encapsulates. Cascada does not enumerate that hidden state, so independently scheduled external roots must not overlap it. Ordering is execution-local; the host owns concurrency between separate executions.

Before async control flow or `enter` suspends, query affected context paths and reserve every external identity phase its child may use. Child operations enter child-local phase state rather than their own outer reservation, and the reservation closes after the child drains. Apply the same rule recursively; empty and unrelated children do not block other work.

Store each poison Error in external identity metadata as part of its phase state, never in application data and never by replacing the external value. Existing poison contributes its Error at the selecting receiver or argument position and skips host code after required preparation. Observations do not poison. A failed, rejected, dynamic, outside-context, or multiple-use mutation records its combined Error on every selected mutation phase; completed host effects remain visible. `!!` enters phases normally, bypasses existing poison, and removes selected poison Errors on success without changing use history.

Use named `OBSERVE`, `MUTATE`, and `REPAIR` modes at the shared external operation and phase boundary. Keep Boolean Chain and `enter` capabilities where only read versus write exists. Expose one bulk phase-entry boundary for external commands, async control flow, `enter`, and Phase 10 operations. Delete every hidden sequence Chain and duplicate scheduler. Add no compiler external classification, second importer, external graph model, or second invocation coordinator.

### Verification

- Context construction and later context placement transitions index external occurrences without recording use. Storing one identity at several paths or in several context Chains leaves it unused.
- Before the first mutation, actual use transitions through unused, one exact context Chain/path with its sticky staticness fact, outside-context, and multiple-use states. Repeating one static context location is stable; a dynamic use makes it mutation-ineligible, while another context Chain or path or mixed context/non-context use becomes multiple use.
- A mutation records its location first. Only one compiler-static context location reaches host code and becomes fixed. Every later use at another or dynamic location fails before host access without changing that binding; dynamic, outside-context, and multiple-use mutation poison the selected identity phase.
- Each context Chain index answers exact, longest-prefix, and descendant queries but stores no identity use or phase state.
- Duplicate selections of one external identity join one phase without granting alias access. Earlier observations wait after the previous mutation but overlap one another; the next mutation waits for the group even when later observation changes the use state.
- Exact external work avoids managed COW and transition gates. Managed behavior remains unchanged outside selected external identities.
- Every selected identity phase is registered at graph-operation entry without self-wait or acquisition-order deadlock. Separate executions share no use or phase state.
- Async children and `enter` reserve indexed external identities before suspension and drain through child-local phases. Nested, empty, and unrelated children behave independently.
- Existing poison prevents host invocation. Observation failure does not poison; mutation failure or rejection preserves completed effects and poisons every selected identity phase. Repair clears phase poison but not use history.
- `OBSERVE`, `MUTATE`, and `REPAIR` are the only external operation modes; Boolean capabilities remain Boolean.
- No hidden Chain, compiler external classification, second phase algorithm, special importer, or external graph model remains.

Update [`AGENTS.md`](../AGENTS.md), [`external-context-ordering.md`](external-context-ordering.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`enter.md`](enter.md), [`runtime-spec.md`](runtime-spec.md), the Chain operation API, compiler lowering, and path-operation documentation.

---

## Phase 10: Implement ordered external operations

### Problem

External state needs property and method observations plus explicit mutation of ordinary or hidden host state. Phase 9 provides actual-use validation and identity phases; Phase 10 applies them at the common host boundary.

### Design

Treat external state as exact host state. Do not graph-traverse, copy, or materialize it. Observation may occur anywhere. Mutation is valid only while actual use state identifies one compiler-static path of one context Chain. External identities reached through host properties remain external and record their own use history.

At graph-operation entry, use the reached identity or the context Chain's occurrence index to classify external versus managed dispatch and bulk-register every receiver and argument identity phase. Do this before COW, a transition gate, waiting, input export, or host inspection. Record each actual use and compiler-static-path fact before host access, then validate mutation eligibility after all required identities are known. A same-named managed, Array, or String operation keeps its category behavior.

Reuse Phase 5's common coordinator for ordered Error collection, host-member selection, invocation, result admission, category completion, and cleanup. Pass it the captured phase scope. Phase 10 adds no coordinator, graph copier, Error collector, queue, importer, exporter, or preparation path.

Use the common `OBSERVE`, `MUTATE`, and `REPAIR` modes. `!` selects `MUTATE`, `!!` selects `REPAIR`, and an unmarked external property read or method call selects `OBSERVE`. Ready computed paths remain valid for observation but are dynamic and cannot establish or use mutation authority. Phase 11 extends observation and poisoned mutation handling across Promise-valued segments.

A new identity obtained through external-property traversal remains external, including a record or Array. If traversal instead encounters identity metadata admitting the value as managed, return an Error and poison the external container's identity phase without replacing either value. Check only the property actually reached; never traverse external state to search for managed children. Continue through the existing external-property boundary under the operation's selected identity phases without adding a nested guard or path walker. A host-call result remains free to return separately admitted managed data through the ordinary import boundary.

Property reads import their value. Property writes export any supported value before native assignment or setter execution. Managed structures and class instances become independent prototype-preserving copies; Functions and external identities remain exact. A top-level Error prevents the write. A setter must complete synchronously. Successful assignment returns the captured logical right-hand value, and deletion returns the native Boolean outcome.

After phase predecessors finish, export every explicit argument and collect its Errors before inspecting host state. If preparation is clean, traverse the host suffix, record every newly reached external use, validate mutation eligibility, and perform descriptor or proxy reflection on the final receiver. Invoke a getter at most once and prepare its result as the call candidate by resolving readiness, propagating Error, and testing callability without importing it as data. Import only a property-read value or the selected method's result. Constructors remain unsupported.

Every Chain source used by an explicit argument supplies its Chain, path, and optional `!`. Reaching an external identity records that actual source use. `!` is a mutation use and an unmarked source is an observation. Register all argument identity phases before export. Export keeps external identities exact but does not transfer authority. The same coverage rule applies before a runtime-controlled callback receives one.

An external observation may read ordinary and hidden state but does not mutate it. Mutation may change only the phase-protected receiver and mutation-borrowed exact arguments. A direct Promise keeps identity phases active through fulfillment import or rejection; a nested result Promise does not. Host code may retain exported data but cannot independently mutate a resource while Cascada may use it. Host code may not reenter Cascada during the active direct invocation.

Treat each exact external identity as one host resource without searching for shared internals. `!!` repairs selected external identity phases but never changes actual-use history.

### Verification

- Ready external property and method operations remain synchronous. Mutation reaches host code only after one compiler-static context-location use validation.
- The first valid mutation fixes that location. A later dynamic or different-location observation or mutation returns a validation Error before host access.
- Occurrence lookup, classification, and identity-phase registration happen at graph-operation entry before COW, gating, waiting, export, or host inspection; newly revealed exact identities record use before host access.
- Exact external access avoids managed COW and transition gates; disjoint managed behavior remains unchanged.
- Every new external-property identity remains external. Encountering an admitted managed identity poisons its external container without replacing data, while untouched external properties are never scanned. Host-call results may retain already admitted managed data.
- Repair removes the external container's metadata poison; if the invalid managed property remains, the next traversal poisons it again.
- Every native JavaScript argument is exported. Managed structures and class instances are independent prototype-preserving copies; Functions and external identities remain exact under the selected guards.
- Every supported exported value may be assigned to external state. A top-level Error prevents the write; successful assignment returns its logical right-hand value, deletion returns the native Boolean, and setters finish synchronously.
- External-call and external-property results share Phase 6 import. Returning or storing an exact identity records no use.
- Phase predecessors and argument export finish before receiver reflection or a getter. The call candidate is prepared without importing it as data, and poisoned preparation invokes no host code.
- Receiver and argument identity phases register at graph-operation entry. Observations wait for the previous mutation but overlap one another; the next mutation waits for the group.
- A direct Promise retains identity phases, but no managed source lease, through fulfillment import or rejection. Nested result Promises do not extend the operation.
- Observation failure does not poison. Mutation failure and dynamic, outside-context, or multiple-use mutation poison every selected identity phase while preserving completed host effects; `!!` repairs phase state only.
- Mutation requires actual use through one compiler-static path of one context Chain. Deep external mutation is supported without pre-scanning external graphs; hidden mutable sharing between independently scheduled roots remains a host-contract violation.
- No new coordinator, Error collector, graph copier, queue, importer, exporter, or preparation path exists.

Update [`AGENTS.md`](../AGENTS.md), [`external-context-ordering.md`](external-context-ordering.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`import-preparation.md`](import-preparation.md), [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), compiler lowering, the path-operation documentation, and the public API documentation.

---

## Phase 11: Support Promise-valued path segments

### Problem

Path walkers currently stringify each segment immediately. They support Promise-backed values encountered along a known path, but a Promise supplied as a key becomes `"[object Promise]"`. Waiting for the key before starting the operation would let later mutations overtake it.

### Design

[`promise-path-segments.md`](promise-path-segments.md) is the detailed architecture.

Treat path segments as String or Number operation inputs and normalize them only when ready. Any other resolved value produces a validation Error. Walk the ready leading prefix synchronously. If every segment is ready, use the existing path unchanged. Before waiting for the first pending segment, acquire one scope at the longest resolved prefix: an observation takes the ordinary read lease, while a mutation installs the ordinary transition gate and works on its private value.

Prepare each later segment through the common Promise and Error machinery only when traversal reaches it, then resume from the protected prefix. Release the lease or publish the gate through the ordinary completion path. Several pending segments share that one scope; do not wait for unused segments or nest one scope per segment.

A segment skipped after a known prefix failure remains an unconsumed host input. Cascada neither waits for it nor attaches a rejection observer merely to suppress host-level unhandled-rejection reporting.

Reuse the lease, COW, gate, mirror, and publication transitions already shared by path walking and `enter`. Factor a lower-level transition only when both callers need the identical lifecycle. Do not implement this by calling `enter`, constructing temporary Chains, or adding a key-resolution queue, scheduler, or operation-specific preparation path.

On a context Chain, query the ready prefix in its external-occurrence index before waiting. Register the appropriate phase for every indexed external identity the unresolved suffix may reach, together with the managed prefix lease or gate, before waiting on any predecessor. Candidate selection is not actual use. After resolution, record only the identity and normalized context path actually reached, with a dynamic-path fact. External observation proceeds normally; external mutation poisons without host access because mutation authority requires a compiler-static path.

### Verification

- Ready String and Number segments retain their current synchronous behavior and allocation path; any other resolved segment produces a validation Error without invoking coercion hooks.
- A Promise-valued segment is resolved and normalized instead of being stringified as a Promise object.
- An observation with a pending segment leases the longest resolved prefix once; a later managed mutation uses COW and does not change the observation's captured result.
- A mutation with a pending segment gates the longest resolved prefix before waiting, so later conflicting operations cannot overtake it while unrelated paths continue.
- Several pending segments are consumed as traversal reaches them under one prefix lease or gate, preserving aliases, mirrors, FIFO continuation order, and Error identity without waiting for unused segments.
- A broken ready prefix does not wait for unused segment inputs.
- An unused segment Promise remains host-owned; Cascada registers no continuation solely to suppress a later rejection.
- Segment rejection or invalid normalization follows ordinary observation and mutation Error publication at the protected prefix.
- Promise-valued root, middle, and final segments work across lookup, assignment, deletion, invocation, export, Error queries, and `enter` paths through the common walkers rather than operation-specific adapters.
- A ready compiler-known String or Number segment may participate in an external mutation path. A computed ready segment and every Promise-valued segment are dynamic even when they normalize to the same key.
- A pending context suffix registers every indexed candidate external phase before waiting but records use only for the resolved identity and path. External observation remains valid; external mutation records dynamic use, poisons its selected phase, and invokes no host code.
- No temporary Chain, direct `enter` call, new queue, or second path scheduler is introduced.

Update [`AGENTS.md`](../AGENTS.md), [`promise-path-segments.md`](promise-path-segments.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), [`enter.md`](enter.md), and the public path-operation documentation.
