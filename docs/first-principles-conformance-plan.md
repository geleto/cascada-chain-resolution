# First-Principles Conformance Plan

## Purpose

This plan brings the remaining `src` behavior into conformance with the first principles in [`AGENTS.md`](../AGENTS.md). Phases appear in implementation order. Keep completed phases, but replace proposals with their final design.

`AGENTS.md` is authoritative for settled contracts. Source and tests are authoritative for completed mechanisms.

## Method

Implement each phase independently. After every phase:

- reproduce the affected behavior and add integration coverage;
- run the complete suite in every supported metadata mode;
- run `test/verify-refcounts.js`; and
- review the result for structural simplifications, unifications, dead weight, and load-bearing complexity.

Prefer one general transition over special cases. Do not pin helper boundaries, mirror fields, cycle-cut placement, exact counters, or another interchangeable representation. Delete superseded mechanisms in the same change.

Baseline: commit `3d5a47a` (2026-08-06), with 648 tests passing in each metadata mode.

## Shared design constraints

- Imported identities and their physical storage are never modified, except when an explicitly requested mutation operates on the exact opaque identity.
- Observations and mutations may change runtime-owned representation when their logical results are correct and every value they must preserve remains unchanged.
- Sharing and leasing protect logical values, not runtime-owned backing storage. Fixed ArrayView bounds may protect an old value while another value extends the backing; a raw reference may observe its physical length change while every protected Cascada value remains logically unchanged.
- COW or materialization is required when representation reuse would change a protected logical value, when an operation needs owned storage for imported data, or when the current physical representation cannot perform an otherwise valid logical transition.
- Host-call arguments are exported. Result admission imports new host identities and applies each receiver category's ownership rule to identities deliberately supplied to host code.
- Controlled runtime methods are the only methods that receive Cascada values directly. Every explicit argument resolves for Error propagation; the method otherwise resolves only nested data it consumes and reuses backing whenever the rules above permit it.
- An instance of a registered class and its complete semantic state graph form one ownership, leasing, Promise-gating, and copy-on-write unit. State identities never acquire an owner outside that unit.
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
- Aliases and cycles inside one ownership unit do not change later mutation strategy. Real additional owners, leases, and import retain their existing protection.

### Verification

- An exclusive cyclic or diamond graph behaves identically with and without a preceding Error query.
- Index creation and cycle-cut placement do not create sharing or change a later mutation strategy.
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

### Problem

Host-returned and public-operation Promises currently pass through helpers that may make rejection fatal or turn it into fulfillment with an Error. Multi-Error construction is local to export and always wraps, so one Error and several Errors do not follow one language-wide rule.

### Design

Keep graph poisoning separate from API transport:

- return a ready Error directly;
- if an API already returned a Cascada operation Promise and that operation later becomes poisoned, reject it with the final Error or aggregate;
- an operation that deliberately consumes Errors, such as `hasError` or `getErrors`, fulfills with its declared result instead;
- ready `assignPath` and `deletePath` failures return their Error, while successful or pending calls return `undefined`; do not add result Promises merely to report a later failure; and
- a Promise returned by supported data or host execution remains the API result with its original fulfillment and rejection behavior. Its rejection is an independent result failure and does not retroactively poison a successfully published mutation receiver.

Keep three Promise meanings explicit while sharing the canonical FIFO machinery: graph-value rejection becomes poison, a trusted transition rejection is fatal, and a data/host result preserves its outcome. A Cascada operation completion applies that operation's outcome contract, rejecting only when its final result is poison. Remove `invokeObservationMethodWithExportedArgs`'s `resolveInitialValueOrPoison` wrapper from the host-result path. Keep `resolveOperationResultOrFatal` and `runOperationCallbackOrFatal` for trusted runtime transitions.

A rejected public Promise is an intentional API result and follows ordinary host unhandled-rejection behavior if ignored. No separate internal or helper Promise may reject without being represented by that public result or handled by the runtime.

Generalize `exportErrorOutcome` into the one Error-combination utility. It deduplicates top-level Error identities in the order supplied by the operation, returns one original unchanged, and creates an Error with an `.errors` array only for several. Do not flatten an existing Error's `.errors` payload or attach a classification brand: any Error, including a user-created one with that property, remains one terminal identity. The caller supplies the aggregate message, so export retains `export: branch contains errors`. Delete the export-local constructor.

### Verification

- A selected observation executable that throws synchronously returns its Error. A selected mutating executable that throws synchronously also poisons its receiver.
- A rejected graph Promise poisons its captured property version. An operation poisoned by that transition rejects its public Promise, while `hasError`, `getErrors`, and other Error consumers fulfill normally.
- A Promise returned by supported data or host execution preserves fulfillment and rejection and changes no graph state merely because it rejects or fulfills with an Error.
- Ready `assignPath` and `deletePath` failures return an Error; successful and pending work returns `undefined`, with no hidden derived rejection.
- Direct and delayed synchronous invocation failures follow the same graph outcome, returning a ready Error or rejecting an already-returned Cascada operation Promise respectively.
- A consumed public rejection is the only rejection produced for one API result. Runtime-owned helper Promises do not create additional unhandled rejections.
- One Error propagates unchanged. Several preserve every distinct top-level identity and their operation-defined order without flattening existing payloads.
- Export and later consumers use the same Error-combination utility.
- `enter` callback throws and callback-Promise rejection remain fatal trusted-transition failures.

Update [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and [`export-error-set.md`](export-error-set.md).

---

## Phase 3: Use one external metadata store

### Problem

Inline metadata modifies runtime identities, must migrate when an identity becomes imported, and forces every metadata operation through a storage-mode branch. Metadata location therefore carries meaning that does not belong to the identity's semantics.

### Design

Keep all identity metadata in one `WeakMap`:

- make `metaOf` a direct `WeakMap.get`, which safely returns `undefined` for values that cannot have metadata and triggers no Proxy reflection;
- insert new records only in that map;
- remove `ensureMeta`'s storage-location option, the metadata Symbol, inline/WeakMap switch, import migration, mode files, scripts, test plumbing, and documentation obligations; and
- keep imported and runtime-owned values physically unchanged by bookkeeping.

Benchmark representative property walks. If the single map has a material cost, optimize its access path without restoring parallel storage modes.

### Verification

- Metadata lookup changes no identity and triggers no Proxy reflection.
- Imported language containers carry metadata without physical modification.
- Existing conformant ownership, Promise-version, ArrayView, and refcount behavior is unchanged.
- The complete suite and refcount oracle pass in the single metadata mode; representative lookup results are recorded.

Update active documentation that requires both metadata modes.

---

## Phase 4: Establish data-type and identity classification

### Problem

`isTracked` currently answers whether a value is a language container, can have metadata, and can be a method receiver. Those are different questions, and the predicate cannot express opaque identities, record functions, or the capability table in `AGENTS.md`.

### Design

Represent every available value's admitted category with named numeric constants, never strings or constructor names:

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

The numbers carry no ordering. Resolve a callable thenable at its captured property version before classifying its available result. There is no `TYPE_PROMISE` because a Promise is version transport, not an available value category; an Error is available terminal data and therefore has `TYPE_ERROR`.

Use one classifier with the precedence in `AGENTS.md`. `admitIdentity` is the only ordinary metadata-creation path: it classifies every available non-primitive identity, creates its record, and stores its type at first admission. This includes Functions and Errors; retaining `TYPE_ERROR` ensures later prototype mutation cannot change an Error's category. Primitives have no identity metadata, and Promises are resolved rather than admitted as available values. COW admits a created identity with its source unit's known type and registered-class definition.

Every operation admits an identity before recording import, sharing, leasing, mirrors, counters, or any other identity fact. Later metadata operations require and extend that admitted record; they never classify or create one. Delete `ensureMeta` rather than recreating it behind another helper name. A definition-only prototype record has no admitted type and its mere existence proves neither admission nor ownership.

Classification may reflect on a user-supplied identity. Route a throwing Proxy or prototype hook through Phase 2A's exact language boundary before creating metadata; do not leave a partially admitted identity.

Class registration is the sole deliberate exception to ordinary admission: it creates a definition-only record on the prototype without admitting that prototype as language data. If the prototype is later admitted, `admitIdentity` completes the same record with a type. When an instance is admitted, consult its prototype record and store the definition with `TYPE_REGISTERED`. Registration must precede admission and has no retroactive effect.

Make admitted type the only source for semantic category decisions. Import and export traversal, ownership, path access, method selection, receiver preparation, mutation policy, and capability helpers consume it instead of repeating prototype, registration, `isTracked`, or category tests. Structural predicates remain only for representation and property shape, such as whether a classified logical Array currently has native backing.

Records, Arrays, and registered state are traversable. Functions, Errors, and unregistered or intrinsic identities may carry identity facts, but traversal stops without inspecting their properties or hidden state. `new Chain(value)` admits the root type without changing ownership or import status; supported children are admitted when normal traversal reaches them.

Metadata, type, and class definition follow identity across prototype changes. Delete `isTracked`, public semantic use of `isPlainObjectPrototype`, direct registration tests after admission, and every parallel category inference. This phase changes category decisions, not the import-origin rules replaced in Phase 6.

### Verification

- Every category in `AGENTS.md` is classified independently of method name, using named numeric constants.
- A Promise is resolved before classification; an Error is classified as available terminal data.
- An admitted Error remains `TYPE_ERROR` after prototype mutation makes `instanceof Error` false.
- Class registration and identity state use the same metadata map, with no separate registry or prototype property.
- Admission is the only ordinary metadata-record creation path; no subsystem lazily creates an untyped record.
- A previously unseen child is admitted before extraction, sharing, leasing, indexing, or Promise-mirror installation records facts on it.
- A class registered before admission is registered data; an instance admitted first remains opaque.
- Array and Promise subclasses retain Array and Promise semantics even if registered.
- Every semantic category decision uses admitted type; remaining structural predicates cannot override it.
- Import, extraction, and leases record identity facts on opaque instances without traversing them.
- Classification lookup after admission adds no Proxy reflection, and prototype mutation changes neither type nor class definition.
- A classification reflection trap becomes the admitting operation's language Error and leaves no partial type record.
- `new Chain` admits type while preserving ownership status.

---

## Phase 5: Make instances of registered classes atomic

### Problem

Instances of registered classes are currently traversed and copied like ordinary containers. A property may therefore be published independently, host class code can receive unresolved or internal state, and protecting the receiver root does not protect state identities that are independently shared.

### Design

An instance of a registered class reached from ordinary graph data is the root of an atomic registered-class unit containing its complete semantic state graph. A nested instance of a registered class belongs to the enclosing unit. Import, sharing, leases, Promise gating, and copy-on-write apply to the whole unit; when it must be preserved, Cascada copies the complete unit rather than a property path. Traversal still reaches state to prepare Promise versions and maintain indexes. Placements inside the unit are state edges, not additional owners.

Registered-class semantic state may contain primitives, Errors, records, logical Arrays, and nested instances of registered classes. Errors are immutable terminal data whose identity is preserved. A Promise is admissible only through the value it resolves to. A Function or unregistered or intrinsic identity reached as semantic state is a fatal registered-class contract violation: it cannot be isolated by a generic whole-unit copy. Reject it when admission, assignment, or Promise publication reaches it, before the affected unit is published or passed to host code.

Class-defined accessors are executable surface over the unit, not semantic state. An own enumerable data property is state and shadows that surface. An own accessor descriptor is invalid state; registration does not turn arbitrary instance descriptors into declared class behavior.

Treat the complete unit as the value of its containing placement. Any mutation within it uses one transition:

1. Capture the placement containing the registered-class unit and its exact version.
2. If the unit is imported, shared, or leased, clone its complete logical state into one prototype-preserving runtime-owned unit. Preserve internal aliases and cycles, and fork every Promise property version at this operation's program position.
3. Copy or transfer assigned state into the unit so no runtime-managed descendant gains an outside owner. Prepare the assigned value completely before its final host-value write.
4. If preparation waits, publish the operation's ordinary Promise version at the unit placement and keep the prepared unit private.
5. Apply the property change and republish the complete unit in one synchronous transition. A language Error during mutating preparation replaces the containing unit placement with that Error; a fatal preparation failure publishes nothing. A detached completion cannot overwrite a later replacement or deletion.

Select a registered property operation before applying the transition:

- Reading a class-defined getter uses the registered-class observation snapshot. Its result crosses the ordinary host-result admission boundary, and the getter cannot mutate the published unit.
- Assigning through a class-defined setter completely resolves and exports the assigned value, prepares the same private whole-unit mutation used by a method, invokes the setter once and synchronously, then reconciles and publishes the complete unit. A setter cannot continue mutating asynchronously; JavaScript assignment exposes no setter return value to await.
- Reading a setter-only accessor produces `undefined`, matching JavaScript property access. Assigning through a getter-only accessor produces the Phase 2A language Error.
- A setter throw is a failed no-result mutation: poison the containing registered-class unit through Phase 2A's outcome rule instead of publishing its private partial state as a valid unit. Effects already completed outside the unit cannot be rolled back.
- If no own state placement or class-defined accessor handles an assignment, create an own enumerable, writable, configurable data property without consulting the prototype chain. Generic inherited behavior, including `Object.prototype.__proto__`, never creates graph state.

Working-unit selection is the transition's only representation branch. Reuse an exact unit when it is exclusively owned and safe to mutate; otherwise clone the complete unit. Preparation, Promise gating, invocation, publication, and detachment then follow the same path. Do not create separate in-place and copy-on-write pipelines.

This transition serves state-property writes, class-defined setters, and later method mutations. It replaces per-property class gates, instance locks, queues, and shallow class COW. A ready transition completes synchronously without a gate. A rejected data Promise becomes a language Error at its captured state position and the mutation returns nothing.

A registered host mutation starts with the unit's captured logical placements and reconciles its complete final own enumerable state through the same property-version transitions. The method must leave admissible, fully resolved state synchronously; a Promise left in state or another invalid state identity is a fatal class-contract violation. A normal host throw replaces the containing unit placement with its Error and returns the same Error, making private partial state unreachable. A returned Promise belongs only to the independent result, preserves its fulfillment and rejection, and never authorizes later state mutation.

Receiver preparation uses the same unit primitive. Locate the selected registered receiver inside its enclosing unit and preserve that correspondence through a copy. An observation prepares a host-ready snapshot and leases the enclosing unit while pending. A mutation prepares the complete private unit, then invokes the corresponding receiver inside it; if preparation waits, the unit placement is already its FIFO gate. The dispatch phase adds arguments and invocation to this operation state rather than adapting it.

Giving a state descendant another owner copies it out unless the same transition removes it and transfers ownership. Giving the whole instance of the registered class another owner shares the whole unit.

Graph walks carry the enclosing registered-class unit after crossing its root. State descendants retain graph structure and preparation state but no independent ownership. This context remains part of the unified import walk in Phase 6 rather than becoming a separate traversal.

### Verification

- Ready registered-unit transitions complete synchronously.
- Direct and nested assigned Promises gate the whole unit; later access to any part resumes in FIFO order.
- A shared, leased, or imported unit COWs as one complete graph while preserving its prototype, aliases, cycles, and Promise versions.
- Assigning an ArrayView or runtime-managed graph into state stores a private host-ready copy or transfers sole ownership; independently extracting a descendant copies it out.
- Nested registered values belong to the outer unit, including when invoking one of their methods.
- Two ordinary placements of one unit share the whole unit; mutation through either COWs before installing its Promise gate.
- Rejected assigned Promises store their Error in the new unit and return nothing. Fatal preparation failures expose neither partial nor unexported state.
- Reassignment, replacement, and deletion cannot be overwritten by a detached completion or restoration.
- A class-defined getter observes a host-ready snapshot and cannot modify the published unit.
- A class-defined setter receives one fully resolved exported value and runs once through the same whole-unit COW, Promise gate, reconciliation, and publication path as a method mutation.
- A pending setter value gates the complete unit; later access through any alias resumes after publication in FIFO order.
- Own state shadows class accessors. A setter-only accessor reads as `undefined`; a getter-only assignment and an own accessor state descriptor produce language Errors. An ordinary missing state key becomes an own data placement without invoking inherited behavior such as `Object.prototype.__proto__`.
- A class-defined setter throw poisons the containing unit and returns the same Error; its private partial state is not published as a valid unit.
- Receiver preparation captures complete state and registers receiver dependencies before dispatch adds argument dependencies.
- Internal aliases and cycles cannot bypass the unit's Promise gate, lease, or COW boundary.
- Functions and unregistered or intrinsic identities are rejected as registered-class semantic state before publication or host invocation.
- A successful method of a registered class has its additions, replacements, and deletions reconciled across the complete unit. A synchronous throw instead poisons the containing unit and leaves private partial changes unreachable.
- A method of a registered class cannot publish Promise state or mutate the unit after returning; its returned Promise remains only the independent API result and rejection does not poison the published unit.

Update [`data-classes.md`](data-classes.md), [`runtime-spec.md`](runtime-spec.md), and the path-operation documentation. Replace the existing test that expects a class-defined prototype setter to be shadowed: its own-record-accessor case remains invalid, its class-defined setter must run, and its inherited non-accessor case must still create an own state placement.

---

## Phase 6: Reconcile explicit import

### Problem

Import currently treats existing runtime metadata as proof that an identity is runtime-owned, splits preparation between root and runtime walks, and does not fully reconcile host changes on reimport. Promise publication still asserts physical shape and writability before normal runtime-owned writeback even though the mirror owns the logical version. An ArrayView family attached before explicit import can consequently retain imported storage as mutable backing.

### Design

Complete Promise publication and mirror presence together. A resolver always advances its live mirror. Write the resolved value back only when a live runtime-owned physical placement remains an own enumerable writable data property; imported storage and another unsuitable representation remain unchanged. Delete `assertCanPublishPromiseProperty`; Phase 2A already removed value-derived attribution from its failures. Mirror creation retains one internal assertion that the captured key was a valid data placement; fallible reflection classifies the boundary before reaching it.

Reads and presence consult a live mirror before physical storage. Language-key enumeration includes every live mirror placement, while conformant physical storage retains its original key position. Host changes to imported storage are reimported before another operation uses it: reconciliation adopts the current physical key order, detaches recorded or mirrored placements that disappeared, and never appends those deleted keys to observable enumeration. This avoids separate order state while preserving the captured version until the explicit reimport transition.

Use one import walk for new and previously imported data:

1. Visit each reached supported identity once, carrying its enclosing registered-class unit.
2. Outside a registered-class unit, retain an existing import boundary or mark the identity imported and shared with the current boundary. An instance of a registered class starts one imported unit; its state descendants use that boundary without independent ownership.
3. Stop at a Function, Error, or opaque identity without enumerating its properties or hidden state.
4. Reconcile the union of the container's current physical language keys, previously indexed placement keys, and live mirror keys. Current physical data keys define observable order. Reuse an unchanged imported Promise version, replace a displaced version at the current program position, and publish an ordinary deletion transition for any recorded or mirrored placement that disappeared. Only current physical data properties contribute children to recurse into.
5. Recurse into every currently available supported child and apply the same admission before publishing a Promise fulfillment.

Treat each external enumeration and descriptor lookup as its own admission boundary. A throwing Proxy trap returns the Phase 2A language Error for the imported branch. Ordinary non-placements are ignored without invoking them; an own accessor in registered-class semantic state remains the Phase 5 class-state Error. Do not wrap the whole import transition and accidentally convert an internal reconciliation failure into data.

Import never infers runtime origin from metadata, mirrors, indexes, leases, or ArrayView attachment. Host-call result admission may instead recognize identities deliberately supplied to host code; it applies their category policy and imports every new host identity.

Retain the source Promise identity on an imported property's mirror so reimport can distinguish an unchanged physical placement after settlement. This is property-version state, not import state, and an unchanged placement gains no second resolver.

Reconcile indexed properties through the ordinary old-to-new edge transition. Each indexed placement retains only its last published logical value; the existing `cycleCuts` entry already is its previous cut state. Runtime publication and external reconciliation update the value record and ordinary cut state together. This preserves reverse parents and Promise, Error, and cycle-cut totals after the host changes a physical property without maintaining a second cut flag. Unindexed containers need no parallel snapshot.

Each ArrayView family shares one single-purpose backing reference. Deriving a view shares that reference; fixed bounds and Promise mirrors remain per view. If its attached raw Array becomes imported, directly or as state of an imported registered-class unit, create runtime-owned storage with the same physical length and enumerable indexed slots, update the family reference once, and remove the attachment from the imported Array. Existing view mirrors remain authoritative on their views; no retained Promise version moves to or is merged through the shared backing. Every existing derived view follows the new storage without a registry or metadata lookup on each access. Array operations consume the enclosing-unit context carried by their graph walk; descendants do not need duplicate import or ownership fields.

Late explicit import deliberately transitions the raw Array identity to its current physical external contents. Values previously derived from its attached logical view retain their earlier bounds and property versions on the detached runtime backing. The raw identity and those derived values are therefore reconciled separately rather than forcing one placement transition to represent both.

This backing reference is not Phase 0's deleted prepend storage: it has no base index, moving window, or prepend behavior. It exists only so one import transition can detach a complete view family without modifying imported data.

Delete runtime-island detection, `promoteRoot`, the separate runtime walk, `runtimeScanned`, `metadataBeforeRuntimeScan`, `discoverRuntimePromise`, and the root/result preparation split. Phase 2A already made an explicit retry revisit a partially admitted root; the unified walk extends that rule into bounded reconciliation of every reached identity. Unmarked assignment values remain local runtime data.

### Verification

- Existing metadata, mirrors, indexes, leases, or ArrayView attachment never prevent explicit import.
- Cycles, aliases, nested and root Promises, rejection, and opaque leaves import without modifying the graph.
- A direct alias becomes imported in either traversal order.
- Reimport reaches current children once, reconciles added, replaced, and deleted indexed and unindexed placements, and retains the first boundary.
- External deletion of an indexed ordinary or Promise property is found through the recorded-key union even though the key is absent from current enumeration. Reimport detaches it before subsequent graph access.
- Reads, presence checks, and enumeration agree on every live mirror placement; current physical keys determine order after reimport.
- An unchanged Promise placement keeps one mirror and resolver; a changed placement gets a fresh version at the import position.
- Indexed reconciliation reuses the existing cycle-cut state and stores no duplicate cut flag.
- Registered state is traversed for preparation and indexing without giving descendants independent ownership.
- An attached Array inside an imported registered-class unit detaches through the carried unit context even though the Array has no independent import mark.
- Importing an attached Array moves every earlier derived view to runtime-owned backing without moving or merging its mirrors. The raw identity exposes its current external contents; later host and Cascada mutation cannot change the derived views or make Cascada modify the imported Array.
- ArrayView operations use the family backing reference without per-access metadata lookup.
- Imported Promise settlement remains mirror-only. Runtime-owned settlement also remains logical when physical writeback is unavailable.
- Ordinary accessors and non-enumerable properties are ignored without invocation. Throwing Proxy reflection poisons import, invalid registered-class state follows Phase 5, and reconciliation invariants remain fatal.

Update [`runtime-spec.md`](runtime-spec.md), [`import-preparation.md`](import-preparation.md), [`enter.md`](enter.md), and [`array-view.md`](array-view.md).

---

## Phase 7: Enable ordered opaque mutations

### Problem

Opaque identities were originally observation-only. Explicit mutation of their ordinary or hidden host state is a new capability: it must operate on the exact object, so copy-on-write cannot isolate aliases and imported-data protection needs its deliberate exception. Fully serializing every operation would preserve order but would also make independent observations wait for one another.

Property access and host calls must share the same ordering state. Otherwise a pending write can be bypassed by a method call, an opaque argument can be mutated while host code retains it, or a pending observation can overlap a later mutation through another alias.

### Design

Treat each opaque identity as one exact external resource. Its aliases deliberately observe the same mutations. Do not traverse, copy, or materialize it; mutations made through independently retained host references remain outside Cascada's ordering guarantees.

Use one per-identity operation gate for property accesses and every host call that receives the identity as an exact receiver or argument. One host operation contributes at most one entry per opaque identity; a designated mutating receiver makes that entry a mutation, while every other use is an observation.

- An observation waits for the preceding mutation, then runs without waiting for other observations in the same interval. It remains outstanding until its synchronous result completes or its returned Promise settles.
- A mutation reserves its place as soon as its receiver identity is captured, waits for the preceding mutation and every earlier outstanding observation, and blocks every later operation until it completes. Argument or assigned-value preparation is part of that mutation, so later work cannot overtake a pending input.
- Aliases use the same gate. Fulfillment, rejection, and a synchronous Error all finish the operation and release the work behind it without changing that operation's own API outcome.

Run ready work synchronously. Register waits through the ordinary Promise helpers at the operation's program position; do not turn an unblocked operation into a Promise, add a microtask hop, or build separate property and method queues.

An opaque property read is a host observation on the exact object. A write resolves and exports its value before touching the object, then performs native property assignment on that exact object, including a native setter. A setter must complete synchronously because JavaScript assignment exposes no returned Promise. A host throw follows Phase 2A's language outcome, while effects already completed on the external object remain visible.

Phase 8 routes opaque method calls through this same gate. An explicitly requested method mutation may change only the exact receiver. Its returned Promise remains the API result and also keeps the mutation outstanding until settlement; observation Promises keep only their own observation outstanding.

### Verification

- Ready opaque property reads and writes remain synchronous.
- Two observations after one mutation wait for that mutation but not for one another; the next mutation waits for both observations.
- Once its receiver is captured, a mutation with a pending assigned value reserves its position before preparing that value, and later access cannot overtake it.
- Property reads and writes share one gate through every alias; Phase 8 reuses it rather than adding method-specific ordering.
- An opaque identity used several times in one host call contributes one gate entry; a mutating receiver takes precedence over its read-only argument aliases.
- Fulfilled and rejected observation and mutation Promises release exactly the operations that depend on them while preserving their API outcomes. A rejection delays but does not poison later operations.
- Imported and multiply referenced opaque identities mutate the exact object deliberately; no copy, traversal, or ownership mark creates a second resource.
- Native getters and setters run only after ordered preparation. A setter throw poisons the targeted Cascada placement or root and returns the same Error; completed effects on the exact external identity remain visible through other aliases.
- Host mutation outside Cascada is not presented as ordered with runtime operations.

Update [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), and the path-operation documentation.

---

## Phase 8: Dispatch methods by data type

### Problem

Method dispatch still preserves the legacy capabilities of the tracked/untracked split even after it consumes admitted types: inherited record methods can execute, own record functions are rejected, instances of unregistered classes are rejected, and Array overrides receive only shallow-materialized views. The Array-specific mutation flag is also validated before the receiver category is known.

### Design

Implement the `AGENTS.md` capability table directly. Treat `run`'s Boolean as the requested operation mode, rename its internal `mutateArray` terminology without changing the positional API, and validate the mode only after classifying the resolved receiver and selected callable. A class or record function named `push` is not an Array mutator.

Resolve the receiver and every explicit argument before deciding the poison result, even after finding an Error. Collect every distinct original Error consumed by their required preparation in receiver-then-argument order, independent of settlement order. Use one bucket for receiver resolution and selection, then one for each explicit argument; order within one composite input is not semantic. Return one Error unchanged; for several, return an Error whose `errors` array contains the originals. An Error nested inside composite data participates only when the receiver category's preparation or the operation's behavior reaches it.
Use the Error-combination utility established in Phase 2B; call preparation only owns discovery order.

Once the receiver version is available, method selection follows admitted type:

- a logical Array first selects a supported standard method or an observation-only override;
- a string selects a native observation on the primitive;
- a record captures and resolves only the selected own language-property version; it never searches the prototype or exposes the record as callable state;
- an instance of a registered class selects that class's declared method surface; and
- an opaque instance selects an observational or explicitly requested mutating method on its exact identity.

An own enumerable data placement shadows a non-record method and is not executable. Ordinary record and Array accessors are non-placements and are never invoked or treated as overrides. Capture the selected descriptor before preparing arguments. Only a registered-class or opaque accessor declared executable by its receiver category may run, and only after preparation is otherwise clean; its failure becomes the call's language Error. Reflection, missing, shadowing, and non-callable failures occupy the receiver Error bucket while argument preparation still completes.

Constructors remain unsupported. A descriptor lookup or supported executable getter that throws becomes a language Error. An Error produced by resolving a record function property or returned by an executable getter propagates unchanged; another non-callable value, or a supported accessor without a getter, produces the existing validation Error. Call preparation must not turn these outcomes into fatal runtime failures.

Prepare every call as one ordered transition:

1. Capture the requested mode and the receiver, method-property, and argument versions at the operation's program position.
2. Start receiver-version preparation first. Once that value is available and non-Error, capture its category and callable or accessor descriptor without invoking an executable getter. Then export one complete native Array snapshot for an override, use the registered-class observation snapshot or whole-unit mutation transition, reserve the Phase 7 opaque-identity entry, lease another exact observational receiver, or retain the controlled runtime receiver.
3. Without waiting for a pending receiver, immediately start top-level resolution of every explicit argument from left to right and do not short-circuit after an Error. Once receiver selection determines the boundary, extend those captured values through the required deep preparation. Host-bound positions share one snapshot context that preserves aliases and cycles across the receiver and arguments and leases every exact runtime-managed identity that cannot be copied. Each exact opaque identity captured in those positions enters the Phase 7 gate once for the operation; a mutating receiver dominates its argument aliases. Controlled positions otherwise resolve only nested data their method consumes. Even a JavaScript method that ignores an argument position must wait for it and include its Errors.
4. If preparation consumed any Errors, do not invoke an executable getter, callback, method, override, or mutator. An observation returns the single original or ordered aggregate and leaves its receiver unchanged. A mutation replaces its targeted receiver placement or root with that poison and exposes the same poison through the API. Return it when ready, or reject the already-returned operation Promise after all required inputs settle.
5. Otherwise invoke the selected operation exactly once and synchronously. Controlled runtime code follows its method-specific logical transition. Host code follows its declared boundary. A synchronous mutating-function throw poisons the targeted receiver and becomes the API Error; an observation throw affects only the result. Reconcile a successful registered-class mutation's complete, ready final unit state through Phase 5's ordinary transitions. A returned Promise remains the API result with its original fulfillment and rejection. For a registered-class mutation the unit is already published and leased; for an opaque operation the Promise also keeps the Phase 7 gate entry outstanding until settlement.
6. Admit every result immediately using known origins. A controlled runtime result retains its runtime origin and is not imported merely because it is a method result. Import new host identities and returned snapshot identities created for arguments, Array overrides, or registered-class observations. Preserve the origin of an exact receiver, opaque argument, or Function supplied without snapshotting and account for its additional owner. Preserve and share a registered-class mutation's whole receiver; copy out state still owned by the unit, or transfer state relinquished by the same transition. Release all operation leases and completed Phase 7 gate entries in this result transition.

The coordinator owns sequencing and snapshot identity; category dispatch owns receiver policy. Use one local operation state for copies, aliases, cycles, Errors, and waits. Do not add a persistent coordinator, queue, or parallel preparation path.

Controlled method preparation contributes every nested Error it actually reaches to the receiver bucket before dependent mutation or callback work runs. Structure-only methods do not inspect nested values merely to search for Errors.

Generalize the existing raw export walk into one multi-root host snapshot. Public export, Array override receivers, and host-call arguments share its copies map, visited set, readiness tree, and ordered per-input Error buckets, so aliases and cycles remain shared across receiver and argument positions and settlement order cannot reorder Errors. One operation-wide seen set removes duplicate Error identities without determining their order. Controlled runtime methods bypass this snapshot because they consume Cascada values and nested data selectively. Do not introduce another host graph copier.

Registered-class observations are side-effect-free. A registered-class mutation may change only its prepared receiver unit during synchronous invocation. It may expose that unit or copies of its state only through its result; asynchronous mutation and detached retention are contract violations. An opaque observation may read ordinary and hidden state but must not mutate its exact receiver; an explicit opaque mutation may change only that receiver and follows Phase 7 ordering. Host code may retain an exact unsnapshotted receiver, opaque argument, or Function only through its returned value or until its returned Promise settles. Traversable exact values are leased and opaque identities keep their Phase 7 entries for that interval; detached retention is unsupported. A record function is invoked without the record as its receiver; it may use explicit arguments and read-only host state, but cannot read or mutate its containing record or other Cascada graph state.

Keep executable Function positions explicit. The current controlled callback position is the `sort`/`toSorted` comparator: it receives settled logical elements, is synchronous, read-only, and non-retaining, and a Promise result remains unsupported. Supported String native protocols and callbacks execute inside their host boundary. Passing a Function as ordinary data does not authorize another runtime path to invoke it.

Reject Array mutators in observation mode and mutations through Array overrides. Delete unreachable observation-mutator handling, but keep observation view dispatch: `concat` may extend eligible runtime backing while its receiver retains fixed bounds.

Do not add sharing or lease guards that forbid otherwise safe ArrayView backing reuse. An Array imported directly or as registered-unit state never attaches or serves as mutable backing; it materializes or COWs first using the operation's carried unit context.

Delete ordinary receiver selection through `requiresArrayMaterialization`, its `receiver === targetValue` lease inference, and `invokeObservationMethodWithExportedArgs`'s independent per-argument exports. Array overrides always export; exact observational receivers lease explicitly by category. Keep `requiresArrayMaterialization` where representation mutation and copy-on-write still need it.

Preserve the host-call error boundary: a synchronous host-method, executable getter, or reflection throw becomes a ready Error result, and a mutating-function throw also poisons its targeted receiver. A returned Promise preserves its own fulfillment and rejection without retroactive graph poisoning. Property and value failures follow Phase 2A's publication rule; bookkeeping, impossible-transition, and declared host-contract violations remain fatal.

### Verification

- Every data type accepts only the methods and modes in `AGENTS.md`.
- A ready call invokes and returns synchronously.
- A call waits for every explicit argument even when an earlier input is already an Error.
- One ready input Error is returned unchanged. A delayed poisoned call rejects its operation Promise with the single original or an aggregate containing every original Error in receiver-then-argument order, even when their Promises settle in another order.
- A descriptor or non-callable selection Error combines ahead of argument Errors; an executable getter is not invoked after preparation is poisoned.
- An Error obtained from the selected record property or executable getter propagates unchanged instead of being replaced by a non-callable validation Error.
- Nested Errors remain data until required preparation or method behavior reaches them; every Error reached by one call appears once in that call's poison result.
- A controlled method that consumes several Error elements, such as sort preparation, returns their aggregate without invoking its comparator; a structure-only method leaves uninspected nested Errors as data.
- A mutation poisoned before invocation replaces its targeted receiver placement or root with the same single or aggregate Error returned through the API.
- A record function waits for its captured property version, receives exported arguments, is not called with the record as `this`, and cannot observe record state; inherited and non-callable selections fail.
- Array mutators requested as observations and mutations through Array overrides fail, while a same-named record or class function still follows its own category.
- Supported standard Array methods retain controlled behavior and resolve only the properties each method consumes; unsupported native methods remain rejected unless explicitly overridden.
- Array overrides receive complete exported native Arrays containing no ArrayView, unresolved language property, or original runtime-managed identity.
- Receiver and argument preparation uses one operation state, preserves aliases and cycles across positions, and cannot be changed by later Cascada mutation.
- Public export and host calls use one multi-root snapshot engine; receiver and argument aliases share one exported identity.
- Controlled runtime results remain runtime-owned, while identities first produced by host code are imported.
- Registered-class observations and mutations see only settled host-ready state and preserve imported or prior owners.
- A registered-class mutation publishes its complete synchronous unit transition before any returned Promise settles. Leasing the unit root protects its entire state graph; later mutation COWs the whole unit.
- Opaque observations and explicit mutations receive the exact identity and use Phase 7 ordering through every alias.
- Opaque property accesses and method calls use the same gate; neither path can bypass the other.
- A pending host result leases each exact traversable argument and keeps every opaque receiver or argument in the Phase 7 gate until settlement. Opaque observations may overlap, while later mutation waits for every preceding use; all leases and gate entries are released on fulfillment or rejection.
- `Date.prototype.getTime` succeeds as an observation. `Date.prototype.setTime` succeeds only as an explicit mutation, and an observation-mode request leaves the Date unchanged.
- Strings retain native observational behavior.
- Record functions may observe read-only host state such as time, but cannot read or mutate their containing record or other Cascada graph state.
- Own enumerable data state shadows non-record methods. Ordinary graph accessors remain absent and uninvoked; constructor, missing-getter, non-callable, and throwing supported descriptor/accessor cases retain their specified classification.
- Receiver and top-level argument preparation begin together with receiver registration first. A ready receiver's callable or accessor is captured before category-specific argument preparation, without invoking executable host code early.
- An Array override returning `this` yields its imported exported snapshot. A registered result may contain its whole receiver at any depth; that identity retains its runtime origin and the whole unit becomes shared.
- A registered-class observation returning its receiver snapshot or state imports that snapshot rather than exposing the original unit.
- A registered-state descendant returned while the unit still owns it becomes an independent copy. A descendant removed by the same mutation may transfer without copying.
- An exact unsnapshotted receiver, opaque argument, or Function returned directly, through a Promise, or inside another result retains its origin and accounts for any additional owner.
- Other new direct and fulfilled results are imported immediately.
- A synchronous observation throw returns an Error without changing its receiver. A synchronous mutating-function throw poisons its targeted receiver and returns the same Error; partial physical effects on an exact opaque identity remain visible through other aliases. A returned Promise preserves its fulfillment or rejection and does not retroactively poison the receiver.
- Runtime invariant and bookkeeping failures remain fatal across the same call paths.
- Promise interleavings preserve receiver-before-argument registration and FIFO transitions.
- Valid `concat`, `push`, indexed growth, and length growth still reuse runtime-owned backing without changing earlier logical values.
- Imported Arrays never acquire ArrayView attachment or act as mutable backing, and their physical storage remains unchanged.

Update [`run.md`](run.md), [`array-view.md`](array-view.md), [`data-classes.md`](data-classes.md), and [`runtime-spec.md`](runtime-spec.md).
