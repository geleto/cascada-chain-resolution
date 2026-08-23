# First-Principles Conformance Plan

## Purpose

This plan brings the remaining `src` behavior into conformance with the first principles in [`AGENTS.md`](../AGENTS.md). Phases appear in implementation order. Keep completed phases, but replace proposals with their final design.

`AGENTS.md` is authoritative for settled contracts. Source and tests are authoritative for completed mechanisms.

## Method

Implement each phase independently. After every phase:

- reproduce the affected behavior and add integration coverage;
- run the complete suite;
- run `test/verify-refcounts.js`; and
- review the result for structural simplifications, unifications, dead weight, and load-bearing complexity.

Prefer one general transition over special cases. Do not pin helper boundaries, mirror fields, cycle-cut placement, exact counters, or another interchangeable representation. Delete superseded mechanisms in the same change.

Baseline: commit `3d5a47a` (2026-08-06), with 648 tests passing in each metadata mode.

## Shared design constraints

- Imported identities and their physical storage are never modified, except when an explicitly requested mutation operates on the exact external identity.
- Observations and mutations may change runtime-owned representation when their logical results are correct and every value they must preserve remains unchanged.
- Sharing and leasing protect logical values, not runtime-owned backing storage. Fixed ArrayView bounds may protect an old value while another value extends the backing; a raw reference may observe its physical length change while every protected Cascada value remains logically unchanged.
- COW or materialization is required when representation reuse would change a protected logical value, when an operation needs owned storage for imported data, or when the current physical representation cannot perform an otherwise valid logical transition.
- Host-call arguments are prepared from logical values. Result admission applies each receiver category's origin and ownership rule to identities deliberately supplied to or produced by host code.
- Controlled runtime methods are the only methods that receive Cascada values directly. Every explicit argument resolves for Error propagation; the method otherwise resolves only nested data it consumes and reuses backing whenever the rules above permit it.
- Registered instances and their state retain ordinary graph ownership. Registered-class invocation adds only the preparation and mutation isolation required before synchronous class code receives a receiver.
- Graph poisoning and API failure are independent outputs. An observation failure affects only its result. A mutation poisoned before invocation or by a synchronous throw replaces its targeted receiver placement or root with the Error and exposes the same Error through the API. A Promise returned by invoked code keeps its own fulfillment and rejection outcome. No consumed Error is lost.
- A fatal failure belongs to the runtime mechanism or its declared kernel or host contract, not to the requested language operation. Broken invariants and bookkeeping belong here. Whether a failure was thrown does not determine its class.

---

## Phase 0: Remove the ArrayView prepend optimization

Complete.

### Final design

- An ArrayView has fixed start and end bounds and reads through one effective backing; a logical index translates by the start bound.
- `unshift` mutates a sole-owned native Array directly and otherwise uses the remap path. It does not move storage shared by fixed views.
- Array method dispatch has no prepend-specific view strategy.
- ArrayView attachment still pins the raw Array's current logical bounds, allowing later values to reuse its backing without changing earlier values.
- Existing and revised integration tests verify behavior and the language surface without pinning private field names.

### Verification

- `unshift` matches JavaScript for owned and preserved receivers.
- Earlier values remain unchanged across `slice` and repeated `unshift` operations.
- Append at the physical endpoint still reuses runtime-owned backing while earlier fixed views remain unchanged.
- The complete suite passes 648 tests in both metadata modes, including the refcount oracle.

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
- The complete suite passes 649 tests in both metadata modes, including the refcount oracle.

[`cycles-as-data.md`](cycles-as-data.md) records the ownership-independent projection rule.

---

## Phase 2A: Separate logical failures from representation limits

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
- The obsolete property-shape Error set and Array replay catch are gone. Normal property helpers keep their ordinary return types; one private boundary-failure signal carries exact thrown user code to the owning transition.

### Verification

- Integration coverage verifies absent accessors and non-enumerables, representation fallback, missing-value semantics, poisoning and refcounts, exact reflection failures, and fatal synchronous re-entry.
- Imported and protected sources remain unchanged; valid mutations on ordinary restricted storage materialize only when the planned transition needs it.
- Existing `enter` callback failure tests retain fatal abort semantics.
- The complete suite passes 668 tests in both metadata modes, including the refcount oracle.

[`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and [`import-preparation.md`](import-preparation.md) record the completed behavior.

---

## Phase 2B: Separate API Promise transport and Error aggregation

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
- Whenever preparation supplies one Error to combination, it propagates unchanged; several preserve every distinct top-level identity and their supplied order without flattening existing payloads. Phase 5 completes discovery across mixed ready and pending call inputs.
- Export and later consumers use the same Error-combination utility.
- `enter` callback throws and callback-Promise rejection remain fatal trusted-transition failures.

The complete suite passes 679 tests in both metadata modes, including the
refcount oracle.

[`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and
[`export-error-set.md`](export-error-set.md) record the completed behavior.

---

## Phase 3: Use one external metadata store

Complete.

### Problem

Inline metadata modifies runtime identities, must migrate when an identity becomes imported, and forces every metadata operation through a storage-mode branch. Metadata location therefore carries meaning that does not belong to the identity's semantics.

### Final design

All identity metadata lives in one `WeakMap`:

- make `metaOf` a direct `WeakMap.get`, which safely returns `undefined` for values that cannot have metadata and triggers no Proxy reflection;
- insert new records only in that map;
- remove `ensureMeta`'s storage-location option, the metadata Symbol, inline/WeakMap switch, import migration, mode files, scripts, test plumbing, and documentation obligations; and
- keep imported and runtime-owned values physically unchanged by bookkeeping.

A representative logical-property-read benchmark showed no regression; the
direct lookup was the fastest measured path.

### Verification

- Metadata lookup changes no identity and triggers no Proxy reflection.
- Imported language containers carry metadata without physical modification.
- Existing conformant ownership, Promise-version, ArrayView, and refcount behavior is unchanged.
- The complete suite passes 679 tests through the single metadata store, and
  the refcount oracle passes.
- Active documentation describes only external metadata.

---

## Phase 4: Establish data-type and identity classification

Complete.

### Final design

Every available value has one admitted category represented by named numeric constants, never strings or constructor names:

```js
const TYPE_ERROR = 1
const TYPE_ARRAY = 2
const TYPE_FUNCTION = 3
const TYPE_STRING = 4
const TYPE_PRIMITIVE = 5
const TYPE_RECORD = 6
const TYPE_REGISTERED = 7
const TYPE_OPAQUE = 8
```

The numbers carry no ordering. A callable thenable is resolved at its captured
property version before its available result is admitted; Promise therefore
has no type constant. Error is available terminal data and has `TYPE_ERROR`.

Admission is the sole ordinary type-classification boundary. `admitValue`
samples thenability at the current program position and leaves a pending
Promise unclassified. Its first callable `then` and optional native FIFO queue
live in separate Promise-capture state, so pending transport never creates
typeless value metadata. Continuation registration invokes that exact function,
and no layer reads `then` again.

`getOrCreateMeta(value, knownType?)` is the sole metadata-record creator.
Existing records win; a known runtime-created type avoids reflection; otherwise
creation classifies the available value and stores all resulting facts
atomically. `admitReadyValue` delegates to it without replacing the input.
If classification reflection cannot identify a supported structure, creation
conservatively admits that object unchanged as opaque. A non-fatal failure while
sampling or invoking `then` is captured as that Promise's rejection and follows
the ordinary property-version resolver.
Every created metadata record therefore has a fixed type, and every later
operation requires and extends that record.

Class registration records the exact prototype in a dedicated `Set`; it
does not admit or attach metadata to the prototype. An admitted instance stores
that exact prototype with `TYPE_REGISTERED`. The registry and instance metadata
are separate because a subclass prototype may itself be admitted as an
instance of its registered base while also defining another registered class.
An instance admitted before registration remains opaque. Type and class
definition remain fixed across later registration and prototype mutation.
Records and registered instances use one admitted `prototype` fact for copying;
later work never re-reflects on the value to derive it.

Records, Arrays, and registered instances are traversable. Functions, Errors,
and opaque identities can carry import, ownership, and lease facts, but graph
traversal stops at them. `new Chain(value)` admits its root without changing
ownership or import status; normal property reads admit children before any
identity fact is recorded.

Semantic category decisions consume admitted type. The class registry is read
only during first admission; later decisions never reclassify an instance from
its prototype. Other structural checks remain only for representation and
property shape. `isTracked`, typeless metadata, and public semantic prototype
classification are gone. This phase preserves the import-origin rules that
Phase 6 will replace.

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
- The complete suite passes 700 tests through the single metadata store,
  including the refcount oracle.

---

## Phase 5: Invoke registered classes

Complete.

### Problem

Registered-class invocation must prepare complete logical inputs and isolate direct nested mutation through the common invocation lifecycle rather than duplicate argument preparation, leasing, Error handling, publication, and result admission.

### Design

[`registered-class-invocation.md`](registered-class-invocation.md) is the detailed architecture.

#### 1. Establish the common invocation lifecycle

Complete.

Consolidate record, Array, String, registered-class, and opaque invocation into one lifecycle before adding registered-class execution. Replace the internal Array-mutation Boolean with an observation-or-mutation request interpreted after receiver classification. The lifecycle coordinates category-owned method selection, selected input preparation, leases and opaque ordering, ordered Error collection, one invocation, mutation publication through `transformProperty`, result admission, and cleanup. Each receiver category defines its selection rules, capabilities, and consumed state. Preserve controlled Array methods' selective input preparation, and delete superseded invocation paths rather than adapting them.

Before pending work can retain a source, lease every reached record, Array, and registered instance. Acquire further leases as required Promise resolution reveals identities, and release each lease after the operation's last access. Keep one category-protection point for the external ordering added in Phase 9; do not add a temporary external path. Host calls consume every explicit argument, while controlled methods consume only the branches selected by the method. Resolve and inspect every consumed input even after finding an Error, and preserve receiver-then-argument Error order independently of Promise settlement.

#### 2. Prepare registered-class calls

Implement one registered-class receiver-category module following [`registered-class-invocation.md`](registered-class-invocation.md). Registration rejects prototype-chain accessors before recording the class. Method-behavior restrictions are trusted except for the receiver and result validation specified below; Phase 5 adds no snapshots, comparisons, or scheduling instrumentation to detect violations.

After registered-class method selection succeeds, prepare every explicit argument and the complete receiver graph in one operation-local state through existing property-version continuations. Preserve aliases and cycles across materialized inputs and expose logical values without changing imported storage. Observations use leases without a gate; pending mutations use the ordinary receiver gate.

#### 3. Isolate registered-class mutations

Implement the [pre-call isolation and mutation lifecycle](registered-class-invocation.md#receiver-mutation) directly:

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

- Records, Arrays, Strings, registered instances, and opaque instances share one invocation lifecycle; each category retains its supported modes and selected-input behavior.
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

Update [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the path-operation documentation.

---

## Phase 6: Establish state modes and the one-way boundary

### Problem

Class registration is too coarse for context data: records cannot be declared external, while managing one class instance requires registering its whole class. Import also infers origin from operational metadata and splits one boundary into imported and runtime walks. Export remains scattered across host-call categories, including a shallow Array-override receiver path.

### Design

[`managed-and-external-state.md`](managed-and-external-state.md) is the detailed architecture.

#### 1. Declare identity capabilities

Add `externalState(value)`, `managedState(value)`, variadic `managedStateClass(...classes)`, and `initialize(value)`. Replace `registerDataClass` and the public import entry point; retain no compatibility aliases.

Store explicit identity declarations in one external `WeakMap` and managed class prototypes in one `Set`. Do not modify declared objects or admit them merely by declaring them. Repeated matching declarations are idempotent. An explicit identity declaration overrides a class rule; a contradictory identity declaration or a declaration contradicting an admitted type returns a validation Error without changing the established mode.

Declarations apply to records and class instances. Arrays, Functions, Errors, Promises, callable thenables, and primitives keep their intrinsic categories and reject a conflicting declaration. `externalState` is shallow. `managedState` walks the currently reachable managed data once, declaring every reached class instance while preserving aliases and cycles and stopping at explicit external identities. It does not register encountered classes. Every managed class prototype must satisfy the existing registered-class contract. Validate the complete declaration, including prototypes and conflicts, before recording anything. `externalState` rejects a Promise or callable thenable argument, while `managedState` rejects one anywhere in its declaration walk. Neither waits for it.

A class instance added later follows its own identity or class declaration. Do not infer a declaration from managed containment or add an encountered class to the class registry.

`managedStateClass` validates every supplied exact prototype before committing any of them and affects only later admission. Reuse the existing registered-prototype validation and delete the superseded registration API and terminology.

#### 2. Make admission authoritative

Resolve callable thenables before admission. Classify Error, logical Array, and Function semantics first. For a record or class instance, apply an explicit identity declaration next. Otherwise records are managed, and a class instance is managed only when its exact prototype was declared managed; every other class instance is external. An explicit identity declaration therefore overrides the record default and any class rule.

Admission resolves these inputs once and stores the final category and prototype in the existing identity metadata. Later runtime behavior reads only admitted metadata. A copy receives fresh metadata containing its source category and prototype; it receives no declaration or class-registry entry. Classification remains fixed after first admission.

Make import consume these categories without becoming the classification owner. An identity with established origin and classification retains them; import does not infer either from operational metadata.

#### 3. Make import one-way

Make `initialize` the sole public host-data entry point. External identities are observation-only by default. Phase 7 composes internal context initialization with the same importer and fixes synchronously reached unique external identities to mutation-capable context paths.

Implement declarations and authoritative classification first. Once they work, review import separately and replace its imported/runtime split rather than mixing classification changes with an incremental import adaptation.

Make import private and use one walk for host-originated data: public initialization, host-call results, and external-property results. Every boundary may import new managed identities and retain imported managed identities but rejects an existing runtime-owned managed identity. Managed-call results may additionally retain their receiver and argument identities. Honor `externalState` and `managedState` declarations returned by host code. No boundary reclassifies or rescans an identity.

For each synchronous import segment, capture and validate the complete reached shape before committing origin, sharing, or Promise mirrors. This prevents a reflection failure from leaving a partially imported graph. After validation, record new identity origins, mark managed traversable identities shared, and traverse records, Arrays, and managed class instances once while preserving aliases and cycles. Stop at Functions, Errors, and external identities.

At initialization and supported host-result boundaries, register every reached Promise placement through its captured property version. Promise fulfillment continues the same import boundary for newly reached values. Imported physical storage retains its Promise and publishes settlement only through the mirror; normal runtime-owned writeback remains unchanged.

Treat fallible enumeration and descriptor lookup at their existing user-code boundary. Ordinary accessors and non-enumerable properties remain outside the graph and are not invoked. Delete runtime-island detection, `hasOperationalMetadata`, `promoteRoot`, the separate runtime walk, `runtimeScanned`, `metadataBeforeRuntimeScan`, `discoverRuntimePromise`, and the root/result preparation split. Imported origin is explicit, so no host-change reconciliation or import-specific ArrayView machinery exists.

Chain construction, assignment, and internal transfer do not imply import. Phase 9 adds external property values as the third private import boundary.

#### 4. Centralize export

Use one export path for explicit arguments and assigned values passed to external, native, or override host code, and for public script results. Export resolves required availability, removes runtime representations, and copies managed traversable data into independent host data while preserving aliases and cycles. Functions and external identities remain exact. Managed invocation and controlled methods do not cross this boundary.

Source leases protect managed data only while export may still read it. Release them when export finishes, before host invocation. A returned host Promise may retain exported copies and exact external identities, but never prolongs leases on their managed sources; only an active external guard entry remains through settlement.

Make common host-input preparation export both receivers and explicit arguments required by the selected boundary. An Array override therefore receives one complete native Array containing no ArrayView, unresolved language Promise, or original managed traversable identity. Its result uses ordinary host-result import. Delete override-specific receiver selection through `requiresArrayMaterialization` and its receiver-lease inference; retain that predicate only for representation mutation and COW. Do not restrict valid ArrayView backing reuse, and never use imported Array storage as mutable backing.

An own enumerable Function placement continues to shadow an Array standard method and remains observation-only. Reject mutation through an override and native Array mutation requested as observation. Preserve controlled method behavior, including eligible backing reuse by observations such as `concat`.

Host results use the same origin-aware private import as initialized roots, and public script results use the common export. Promise settlement continues the boundary that captured it. No host category owns a second importer, exporter, graph copier, or availability resolver.

This phase implements declarations, authoritative admission, initialization, private one-way import, and common export. Phase 7 adds external context guards, Phase 8 generalizes managed invocation, and Phase 9 adds external operations.

### Verification

- Records and Arrays admit as managed by default; an undeclared class instance admits as external.
- `managedState` handles nested class instances, aliases, and cycles without registering their classes or partially committing on failure.
- `managedStateClass` affects later instances only. Explicit identity declarations override it, and a contradictory identity declaration returns an Error without reclassification.
- `externalState` rejects a direct Promise or callable thenable; `managedState` also rejects one nested in its reached graph. Neither waits or partially commits.
- Declarations reject intrinsic and primitive categories they cannot change. `managedState` validates an individually declared class with the same prototype contract as `managedStateClass`.
- `externalState` preserves one exact identity, stops import traversal, and applies through every alias.
- `initialize` replaces public import and accepts arbitrary roots. Initialization leaves external identities observation-only; Phase 7 reuses the importer to record context placements without adding another boundary or walk.
- Initializer functions may return values declared through `externalState` or `managedState`; admission honors those declarations.
- Copies preserve admitted managed-class type and prototype without acquiring declaration entries.
- Import of initialized roots and supported host results visits each newly imported managed identity once, preserves aliases and cycles, and stops at external identities, Functions, and Errors.
- Existing operational metadata never determines import origin. An identity with established origin is retained without rescanning, and host mutation of imported managed storage is unsupported.
- Imported Promise settlement remains mirror-only and continues import for newly fulfilled data under the captured boundary. Runtime-owned Promise settlement keeps its existing writeback behavior.
- Import invokes no ordinary accessor. A throwing enumeration or descriptor trap produces the boundary's language Error, while internal failures remain fatal.
- A reflection failure commits no import origin, sharing, or Promise mirror from that synchronous import segment.
- No runtime-island or separate runtime scan remains.
- Initialization, native/external-result, external-read, and managed-result imports share one private walker and enforce their ownership policies without separate importers.
- Arbitrary initialized roots and supported host-call results use the same one-way origin-aware import. Chain construction, assignment, and internal transfer do not imply import.
- Every external, native, and override host argument or assigned value and every public script result uses the common export; managed invocation and controlled methods do not.
- Exported managed data is independent and contains no unresolved language Promise or internal representation. Functions and external identities remain exact.
- Managed source leases end when export finishes. A returned host Promise retains no lease on exported source data.
- Common host-input preparation exports each boundary-consumed receiver and argument. An Array override receives one complete exported native Array, and returning it yields its imported host value rather than the logical receiver.
- Array overrides remain observation-only; same-named managed methods and controlled Array methods keep their category semantics.
- Removing override-specific materialization inference does not change controlled Array behavior or valid backing reuse.

Update [`AGENTS.md`](../AGENTS.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`data-classes.md`](data-classes.md), [`import-preparation.md`](import-preparation.md), [`array-view.md`](array-view.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 7: Establish external context guards

### Problem

The compiler currently gives every static context sequence-lock path its own hidden Chain. Managed mutation does not need that mechanism, while external context paths need hierarchical readers-writer ordering through async calls and control flow. One Chain per path duplicates the existing path-resolution machinery.

### Design

[`external-context-ordering.md`](external-context-ordering.md) is the detailed architecture.

The compiler supplies each context operation's complete target path and the index of its `!` segment, or no index for an observation. Mark whether every target and scope segment is a literal property or index known during lowering. External mutation requires that static path; the mutation scope is the prefix ending at the index. An external observation uses its complete ready path, and `!!` selects the mutation scope in repair mode. Runtime dispatch interprets these facts only after receiver classification: managed `!` creates no external guard and uses ordinary managed behavior unless the fixed-path mutation check rejects it.

Build one sparse guard tree in one ordinary supplemental Chain for each context execution. Internal `initializeContext` uses Phase 6's private importer to fix every synchronously reached external identity with one context path to that path and leave identities reached by aliases or cycles observation-only. Commit fixed-path facts only after the import segment validates completely. Do not create barriers, wait, scan unavailable data, or add or rebind mutation-capable paths later. External operations add missing runtime scope nodes lazily. Each node is an ordering coordinate, not another Chain.

Keep ordering execution-local. The host owns concurrency and ordering when it exposes the same mutable resource to separate context executions.

Paths overlap when either is an ancestor of the other. Keep operation state only at selected scope nodes: registration finds preceding barriers on overlapping ancestors and descendants without writing child nodes, while siblings remain independent.

Each selected node holds the latest mutation barrier and current observation group. An observation waits for preceding mutations, joins the group, and skips other observations. A mutation waits for preceding mutations and observation groups. A direct Promise retains the operation's barriers through settlement.

Normalize every scope, capture its complete predecessor set, and publish all new barriers in one synchronous transition before waiting or preparing inputs. Barriers owned by one operation never depend on one another. Ready work remains synchronous. Receiver classification is load-bearing: the same syntactic `!` on a managed receiver uses no guard state.

Use `!` only for writes. An external context access without `!` is an observation on its complete ready path. A ready computed observation may select a context-exclusive identity and registers that path before host access. An observation with an unresolved segment cannot access context-exclusive external state. Phase 10 handles Promise-valued path segments without adding prefix reservation to external ordering.

Require each selected `!` scope to contain every external state the operation may change and every observation that must wait for it. The runtime cannot infer sharing hidden behind host methods or sibling paths.

Mutation requires the exact external receiver fixed to the operation's static receiver path by `initializeContext`; a duplicate, unrecorded, or dynamically selected receiver path remains observation-only. Its selected guard scope may stop at an ancestor or extend through the selected method and may differ between operations.

Reject any managed Cascada mutation whose target or receiver is a fixed external path or an ancestor containing one before invocation or publication. Return a validation Error without changing or poisoning the context or guard. This does not reject sibling mutations or physical COW and materialization that preserve the same logical path and identity. Native or application code must not mutate imported managed context storage or replace the placement independently. Explicit external property writes and methods remain guarded mutations of the exact external receiver.

Before an async condition or loop suspends, bulk-enter the external guard paths its child buffer may mutate. Run the child through the entered scopes so later overlapping operations wait while unrelated paths continue.

Store poison on guard scopes, never application values or external identities. Observation failure releases without poisoning. Mutation failure or rejection poisons its selected scope. Add repair-mode entry for compiler `!!`: it waits normal predecessors, may run through selected poison, clears its scope and covered descendant poison on success, and leaves the new Error on failure. Completion changes a barrier only while that barrier remains current.

Expose one bulk guard-entry boundary for async control flow and Phase 9 external operations. Delete the hidden Chain per `!` path. Keep fixed-path recording only at `initializeContext`; the private importer remains one path and only reports the identities and paths it already reaches. Managed invocation, COW, Promise mirrors, ordinary transition gates, and graph walkers gain no guard-specific path. Add one context-path mutation check, not authority-transfer publication logic.

### Verification

- Context initialization atomically fixes every synchronously reached unique external identity to its path and leaves duplicate-path identities observation-only through the common importer without creating barriers; failed validation records no partial path facts, and no mutation-capable path is added or rebound later.
- Runtime external scopes add missing nodes lazily in the same context guard Chain; no `!` path owns another Chain.
- Separate context executions share no guard state; a shared host resource retains host-defined cross-execution concurrency.
- A managed `!` call and matching managed observations never enter the external guard tree.
- A runtime path that resolves to managed state uses no external guard; an external identity not recorded by `initializeContext` remains observation-only.
- External dispatch rejects a mutation whose target path or `!` scope is not compiler-static, while the same syntax may retain ordinary managed behavior after managed receiver classification.
- A ready computed observation registers its resolved path before accessing context-exclusive state; an unresolved path cannot access that state.
- An earlier mutation or observation at `apis` delays conflicting descendant work, and an earlier operation at `apis.user` delays a conflicting operation at `apis`; siblings remain independent.
- Observations after one mutation overlap, retain their entries through direct settlement, and the next mutation waits for all of them without relying on COW leases.
- Several scopes owned by one operation register synchronously without waiting on one another, overtaking, or acquisition-order deadlock.
- Async conditions and loops install all affected guards before suspension; later overlapping work waits while unrelated paths proceed.
- Mutation at a duplicated identity, unrecorded receiver path, or dynamically selected receiver path fails; a fixed identity may use different static guard scopes along its target path.
- An alias or cycle that gives an external identity another root path makes it ineligible for mutation, while unrelated managed aliases and cycles remain valid.
- Every managed mutation whose receiver or target is a fixed external path or ancestor returns an Error without invocation, publication, context poison, or guard poison; sibling mutation and physical COW preserving the binding remain valid.
- Sibling guard scopes overlap only when selected by a common ancestor, so host code must choose scopes that cover all state shared by its operations.
- Observation failure does not poison. Mutation failure and rejection poison the selected scope without changing application data; successful `!!` repair clears only selected and descendant poison.
- Completion of a superseded guard barrier does not replace its successor or restore stale state.

Update [`AGENTS.md`](../AGENTS.md), [`external-context-ordering.md`](external-context-ordering.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`runtime-spec.md`](runtime-spec.md), the context model, compiler lowering, and path-operation documentation.

---

## Phase 8: Generalize managed invocation

### Problem

Managed record functions cannot use their containing state as `this`, while registered-class invocation is already the required managed-state boundary. Managed methods also reject Promise results instead of treating a direct Promise as the call's completion.

### Design

Rename registered-class invocation as managed invocation and use it for managed records and managed class instances. Do not add a parallel record-method implementation.

Every own enumerable string-keyed Function placement of a managed record is callable as a method. Capture its logical property version, reject inherited and non-callable values, and invoke it with the prepared record as `this`. A Function outside a supported call position remains data. Managed classes keep prototype method selection and their existing state contract.

Both receiver forms use Phase 5's complete preparation, leases, mutation isolation, validation, publication, and result rules. A nested call such as `this.increaseBy(1)` is ordinary JavaScript on that prepared receiver, not another invocation or protection layer.

An observation remains read-only. Managed code may access its prepared inputs and, for a mutation, change its isolated receiver until its direct result settles. Every asynchronous access or effect must belong to work represented by that Promise and finish before it settles; detached work is forbidden. External effects remain separate ordered Cascada operations.

A direct Promise keeps a managed call active until settlement. A Promise nested in a synchronous result is independent data and does not extend the call. Return an operation Promise that applies normal result handling to fulfillment and preserves rejection.

For an observation, lease every traversable receiver and argument identity until the direct Promise settles. Later mutation proceeds through COW without waiting. On fulfillment, run common result import and copying; on rejection, leave the receiver unchanged and preserve the rejection.

For a mutation, retain its argument leases and keep the isolated receiver private behind its ordinary transition gate; receiver-source preparation leases end when isolation begins. On fulfillment, validate and publish the receiver, then run common result handling; fulfillment with the working receiver returns the published receiver. A validation failure poisons the receiver and becomes the fulfilled operation result. On rejection, poison the receiver as for a mutator throw while preserving the rejection outcome.

A synchronous managed mutation publishes immediately. Return the published receiver for its direct `this`, and independently copy every other synchronous traversable result. Preserve nested Promise placements during the existing finalization and copy traversals.

### Verification

- Managed record functions receive their prepared record as `this`; inherited functions remain unavailable, and extracted Functions remain data.
- `this.helper()` changes the already isolated receiver inside one managed invocation and publishes through its outer transition.
- Managed records and managed classes share one preparation, isolation, validation, result, and cleanup implementation.
- A managed observation returning a direct Promise leases its complete inputs through settlement; later mutation proceeds through COW without waiting.
- A managed mutation returning a direct Promise remains private behind a transition gate. Later operations wait, fulfillment validates and publishes once, and rejection poisons the receiver while preserving the rejection outcome.
- Direct-Promise fulfillment uses common import and result copying in FIFO order.
- A synchronous managed result containing a nested Promise returns immediately with an independently copied Promise placement and imports its later fulfillment.
- Work represented by a direct Promise may use prepared managed inputs until settlement; other later work is a trusted contract violation rather than an instrumented restriction.

Update [`AGENTS.md`](../AGENTS.md), [`managed-and-external-state.md`](managed-and-external-state.md), [`registered-class-invocation.md`](registered-class-invocation.md), [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the public API documentation.

---

## Phase 9: Implement ordered external operations

### Problem

External state needs property and method observations plus explicit mutation of ordinary or hidden host state. Phase 7 makes initialization-recorded, unique external context paths mutation-capable through runtime `!`; all other external values remain observation-only.

### Design

Treat all external state as exact host state. Do not traverse, copy, or materialize it. Permit observations from ordinary values only while the identity is observation-only. Permit mutation and subsequent observation of context-exclusive state only through its fixed context path or a function borrow from that path.

Reuse Phase 5's common coordinator for selection, input preparation, ordered Error collection, invocation, result admission, mutation publication, and cleanup. Give it the selected external scopes and mode so it owns call registration, lifetime, poison, repair, and release in one place. Phase 9 adds no coordinator, graph copier, Error collector, queue, or preparation path. Interpret the requested mode only after receiver classification: a same-named managed or Array method does not acquire external semantics.

Interpret the compiler-supplied static-path fact and optional `!` segment index only after receiver classification. External mutation requires a static path and selects its Phase 7 guard scope; no index means observation. Managed, Array, and String dispatch retain their existing semantics.

Register the external guard before argument preparation or host invocation. The operation then waits for its guard predecessors and ordinary input readiness without allowing later overlapping work to overtake it. Ready work remains synchronous; use ordinary Promise helpers without adding a microtask hop.

External property operations use the same single guard-entry boundary without adding guard logic to graph walkers. A property read is a host observation on exact state. Privately import its value before releasing its observation entry; a direct Promise retains the entry through settlement and fulfillment import. Assignment and deletion inside a fixed external receiver require a selected `!` guard. Export an assigned value before native assignment, including a native setter. A setter must complete synchronously because JavaScript assignment exposes no returned Promise. A host throw follows Phase 2A's language outcome, while completed external effects remain visible.

Capture external method selection from the exact identity before argument preparation, without invoking an accessor. Invoke an executable getter only after preparation is clean. Reflection, missing, shadowing, getter, and non-callable failures enter the receiver position of Phase 5's ordered Error collection while required argument preparation still completes. A thrown reflection or getter failure becomes a language Error, an Error returned by a getter propagates unchanged, and an accessor without a getter is non-callable. Constructors remain unsupported.

Export explicit arguments through Phase 6, invoke once on the exact receiver, and privately import the result through the common boundary. A context-exclusive external argument requires a Phase 7 function borrow; an ordinary exported occurrence grants no access authority.

An external observation may read ordinary and hidden state but must not mutate it. Mutation may change only the exact context-exclusive receiver selected by its active guard. An observation throw affects only its result; a mutation failure poisons its guard while completed external effects remain visible. A returned Promise preserves its API outcome and keeps the guard active until settlement; fulfillment is privately imported before release.

### Verification

- Ready external property reads and writes remain synchronous.
- Property and method operations on observation-only external identities work through ordinary values and reject mutation.
- Only an external identity reached through its fixed context path or a function borrow supports mutation.
- External mutation rejects a non-static target path or `!` scope before host code runs; the same syntax on a managed receiver retains managed semantics.
- External context observations use their runtime guard path whether or not a mutation has previously used it.
- Observation, call, write, or mutation through another occurrence or a non-context variable is rejected before host code runs.
- A mutation with pending inputs registers its guard before preparation, so later overlapping access cannot overtake it.
- Two observations after an overlapping mutation wait for it but not for one another; the next overlapping mutation waits for both.
- A mutation at `apis` blocks all API descendants, one at `apis.user` blocks only that branch, and one at `apis.user.create` leaves sibling methods independent.
- Assignment and deletion inside a fixed external receiver require and use their selected `!` guard; managed mutation cannot replace the receiver's context binding.
- An external property read imports its direct or fulfilled value before releasing its observation entry.
- A context-exclusive external argument is usable only through a scoped function borrow held through direct settlement.
- A fulfilled or rejected Promise from an external read releases exactly the operations that depend on it while preserving its API outcome. A rejection delays but does not poison later operations.
- External state mutates exact host state deliberately; no copy, traversal, or ownership mark creates another resource.
- Native getters and setters run only after ordered preparation. A setter throw poisons its guard and returns the same Error; completed effects on the exact external identity remain visible.
- External host arguments are exported independent data containing no unresolved language Promise, internal representation, or managed traversable graph identity. Functions and external identities remain exact.
- External reflection, getter, missing, and non-callable failures occupy the receiver position before argument Errors; poisoned preparation never invokes the getter or method.
- A returned external Promise keeps its guard, but no managed source lease, until settlement. Rejection delays later work without replacing the exact receiver.
- A synchronous external observation throw leaves its receiver and guard unpoisoned. A mutating throw poisons the guard while completed effects remain visible on the exact external identity.
- `Date.prototype.getTime` succeeds from an ordinary observation-only Date, while `Date.prototype.setTime` requires a context-exclusive Date path.
- Host mutation outside Cascada is not presented as ordered with runtime operations.
- Managed calls, String observations, controlled Array methods, and Array overrides retain their Phase 5-8 behavior without acquiring external dispatch logic.
- No new coordinator, Error collector, graph copier, queue, or preparation path exists.

Update [`run.md`](run.md), [`runtime-spec.md`](runtime-spec.md), and the path-operation documentation.

---

## Phase 10: Support Promise-valued path segments

### Problem

Path walkers currently stringify each segment immediately. They support Promise-backed values encountered along a known path, but a Promise supplied as a key becomes `"[object Promise]"`. Waiting for the key before starting the operation would let later mutations overtake it.

### Design

[`promise-path-segments.md`](promise-path-segments.md) is the detailed architecture.

Treat path segments as String or Number operation inputs and normalize them only when ready. Any other resolved value produces a validation Error. Walk the ready leading prefix synchronously. If every segment is ready, use the existing path unchanged. Before waiting for the first pending segment, acquire one scope at the longest resolved prefix: an observation takes the ordinary read lease, while a mutation installs the ordinary transition gate and works on its private value.

Prepare each later segment through the common Promise and Error machinery only when traversal reaches it, then resume from the protected prefix. Release the lease or publish the gate through the ordinary completion path. Several pending segments share that one scope; do not wait for unused segments or nest one scope per segment.

Reuse the lease, COW, gate, mirror, and publication transitions already shared by path walking and `enter`. Factor a lower-level transition only when both callers need the identical lifecycle. Do not implement this by calling `enter`, constructing temporary Chains, or adding a key-resolution queue, scheduler, or operation-specific preparation path.

External mutation paths and `!` scopes remain compiler-static. Do not reserve an external guard while a path is unknown. Before gating an unresolved mutation prefix, reject it if the initialized context-path facts show a fixed external binding at or below that prefix. A Promise-valued observation that resolves to context-exclusive external state returns a validation Error before host access. Observation-only external state and other managed state retain their ordinary capabilities.

### Verification

- Ready String and Number segments retain their current synchronous behavior and allocation path; any other resolved segment produces a validation Error without invoking coercion hooks.
- A Promise-valued segment is resolved and normalized instead of being stringified as a Promise object.
- An observation with a pending segment leases the longest resolved prefix once; a later managed mutation uses COW and does not change the observation's captured result.
- A mutation with a pending segment gates the longest resolved prefix before waiting, so later conflicting operations cannot overtake it while unrelated paths continue.
- Several pending segments are consumed as traversal reaches them under one prefix lease or gate, preserving aliases, mirrors, FIFO continuation order, and Error identity without waiting for unused segments.
- A broken ready prefix does not wait for unused segment inputs.
- Segment rejection or invalid normalization follows ordinary observation and mutation Error publication at the protected prefix.
- Promise-valued root, middle, and final segments work across lookup, assignment, deletion, invocation, export, Error queries, and `enter` paths through the common walkers rather than operation-specific adapters.
- A Promise-valued path cannot observe or mutate context-exclusive external state; a mutation whose unresolved prefix contains a fixed external binding fails before installing a gate, no external guard is reserved, and no host code runs.
- Observation-only external state remains observable through a resolved Promise-valued path, while external mutation still requires a compiler-static path and `!` scope.
- No temporary Chain, direct `enter` call, new queue, or second path scheduler is introduced.

Update [`AGENTS.md`](../AGENTS.md), [`promise-path-segments.md`](promise-path-segments.md), [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), [`enter.md`](enter.md), and the public path-operation documentation.
