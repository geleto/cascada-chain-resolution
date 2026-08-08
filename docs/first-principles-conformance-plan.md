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

- Imported identities and their physical storage are never modified.
- Observations and mutations may change runtime-owned representation when their logical results are correct and every value they must preserve remains unchanged.
- Sharing and leasing protect logical values, not runtime-owned backing storage. Fixed ArrayView bounds may protect an old value while another value extends the backing; a raw reference may observe its physical length change while every protected Cascada value remains logically unchanged.
- COW or materialization is required only when representation reuse would change a protected logical value, or when an operation needs owned storage for imported data.
- Host-call arguments are exported. Result admission imports new host identities and applies each receiver category's ownership rule to identities deliberately supplied to host code.
- Controlled runtime methods are the only methods that receive Cascada values directly. Every explicit argument resolves for Error propagation; the method otherwise resolves only nested data it consumes and reuses backing whenever the rules above permit it.
- A registered instance and its complete semantic state graph form one ownership, leasing, Promise-gating, and copy-on-write unit. State identities never acquire an owner outside that unit.
- A language operation that cannot produce its requested logical value publishes an Error at that value. A no-result mutation poisons the nearest replaceable value whose transition failed; a call poisoned before invocation leaves its receiver unchanged. No consumed Error is lost.
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

## Phase 2: Enforce the language Error boundary

### Problem

[`propertyShapeError`](../src/language-properties.js) tags thrown errors so Array replay can catch and return them as data. The same descriptor failure is therefore fatal through ordinary assignment and poisoned data through Array replay. This caller-dependent third category violates the poison-or-fatal model.

Mutation handling then treats a bare Error as an independent result and preserves the receiver. For commands such as assignment, which have no usable result channel, this can discard the only Error instead of poisoning the logical value whose transition failed.

Promise publication also asserts that its physical property remains writable even though mirror state is authoritative and physical writeback is only an optimization.

API and graph settlement are also conflated: host-returned and public-operation Promises pass through poisoning helpers, so an API Promise may fulfill with an Error even when the Promise it represents rejected. Graph property settlement must poison; API result transport need not normalize rejection into fulfillment.

Multi-Error construction is also local to export even though Error preservation is a language-wide rule. Its current helper always wraps, so one Error and several Errors do not yet follow the common contract.

### Design

Use one outcome rule for every operation:

- an Error consumed while preparing a call becomes its result and prevents invocation, leaving the receiver unchanged;
- a failure of a mutation transition poisons the nearest replaceable logical value whose transition failed, and is also its result when the operation has a result channel; and
- a failure of an independent result does not poison a receiver whose mutation completed validly.

Make that distinction explicit in the operation outcome. Do not infer it from whether a helper threw or returned an Error, and do not use the current blanket rule that every bare Error preserves the mutation receiver.

Keep API result transport separate from the logical outcome. If the operation completes synchronously, return its Error rather than throwing. If it has already returned a Promise, reject that Promise with the final Error or ordered aggregate instead of fulfilling it with an Error merely for uniformity. This does not change graph poisoning: a rejected Promise stored at a property still advances that captured version to an Error, even when an API operation waiting on it rejects its own result Promise.

Keep rejection outside the graph transition. Internal property and mirror continuations publish Error values as before; only the public operation's completion gate rejects. A Promise returned directly by supported host execution preserves its rejection reason unless the operation must first combine several consumed language Errors.

Delete `propertyShapeErrors`, `isPropertyShapeError`, and the replay `try`/`catch`. A value or descriptor that prevents a requested language transition is a language Error, including a read-only, accessor, non-enumerable, or non-configurable property. Preflight it at the operation-owned boundary and publish it through the outcome rule above. A commit helper may assert only a condition that its caller has already handled or that cannot occur on its runtime-created destination.

| `commitArrayLength` condition | Class |
| --- | --- |
| `Invalid array length` | poison the logical Array |
| `Array length is read-only` | poison the logical Array |
| `Cannot delete an Array element while setting length` | poison the logical Array |
| `Cannot grow this ArrayView in place` | materialize and retry; fatal only if a preflighted commit still reaches this impossible state |

The same rule applies outside length changes. An assignment or deletion that cannot change its physical target poisons the containing logical value that the mutation path can replace. A String length, invalid Array key, or failed property-path transition must not return an otherwise unobservable Error while leaving the failed value valid.

User-controlled execution reached by a supported language operation is a language boundary. Catch each accessor, coercion, callback, selected method, and Proxy or reflection hook at the exact call or reflection primitive. An observation returns its Error; import returns it for the admitted branch; a mutation publishes it through the mutation outcome above. Do not wrap the whole observation, import, or mutation transition. Internal mirror, refcount, lease, closed-state, and impossible-commit failures remain fatal.

A Promise version always advances in its mirror, and a live mirror establishes logical property presence as well as value. Reads and presence checks therefore consult it before physical storage. Write the resolved value back physically only when the live runtime-owned property can still accept it; otherwise leave the version mirror-only. Delete Promise-publication writability and descriptor requirements that exist only to protect writeback. Any remaining placement validation derives its error context from the parent whose property failed, not from the assigned value.

Keep the host boundary narrow. A synchronous throw from the getter, callback, method, override, or mutator selected by `run` becomes its ready Error result. A Promise returned by that executable remains the API's asynchronous result and may reject. A throw from Cascada's preparation, reconciliation, or bookkeeping remains fatal unless it came from an exact user-controlled boundary or that operation has another explicit language-failure outcome.

Keep `resolveOperationResultOrFatal` and `runOperationCallbackOrFatal` for trusted runtime transitions only. Do not route a host-returned or public-operation Promise through a helper that makes rejection fatal or converts it into a fulfilled Error. Retain the existing fatal sites for kernel API and closed-state contract violations, mirror/refcount/lease corruption, and impossible low-level ArrayView writes; they are runtime failures rather than failed language results.

Generalize `exportErrorOutcome` into the one Error-combination utility. It accepts Errors already ordered by their operation, returns one original unchanged, and creates an Error with an `.errors` array only for several. An existing aggregate remains one terminal Error identity rather than being flattened; its own `.errors` payload is preserved. The caller supplies the contextual aggregate message, so export retains `export: branch contains errors`. Delete the export-local constructor and update export's documented single-Error behavior.

### Verification

- Every caller classifies the same property-shape condition identically.
- Invalid, read-only, and non-deletable length changes poison the logical Array rather than leaving it valid or reporting a fatal.
- ArrayView growth that cannot reuse its backing materializes and succeeds; reaching the refusal after preflight remains an invariant failure.
- Assignment, deletion, String length, invalid Array keys, and path failures publish an observable Error at the failed logical value instead of discarding it.
- Array replay and ordinary property mutation share the same failure path; no tagged Error set or caller-specific catch changes the classification.
- A failed mutation cannot expose an unaccounted partial value. Any partial physical work becomes unreachable when the containing logical value is poisoned.
- Imported sources COW successfully and remain unchanged.
- Proxy traps and accessors reached by lookup, export, Error queries, import, mutation, classification, or controlled methods become language Errors without converting adjacent runtime failures into data.
- Existing tests that classify user-controlled reflection as fatal are rewritten around returned or published Errors; tests that deliberately corrupt mirrors, refcounts, leases, or commit preconditions remain fatal.
- A Promise version settles logically when physical writeback is unavailable; subsequent presence checks and reads use the mirror while the physical property remains unchanged.
- Remaining placement failures derive their error context from the parent whose property shape failed, not from the assigned value.
- A selected `run` executable that throws synchronously returns that Error. If it returns a rejected Promise, the `run` result rejects with the same reason; an injected runtime invariant failure on either path is still reported as fatal.
- A rejected property Promise poisons its captured graph version, while an API observation waiting on that version may reject its returned Promise.
- API rejection changes no mirror or stored value beyond the ordinary graph-poisoning transition that produced its Error.
- One exported Error propagates unchanged; several retain every distinct original Error identity in the aggregate.
- Export and later consumers use one Error-combination mechanism.

Update [`runtime-spec.md`](runtime-spec.md), [`run.md`](run.md), [`import-preparation.md`](import-preparation.md), and [`export-error-set.md`](export-error-set.md).

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

Classification may reflect on a user-supplied identity. Route a throwing Proxy or prototype hook through Phase 2's exact language boundary before creating metadata; do not leave a partially admitted identity.

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

## Phase 5: Make registered instances atomic

### Problem

Registered instances are currently traversed and copied like ordinary containers. A property may therefore be published independently, opaque host class code can receive unresolved or internal state, and protecting the receiver root does not protect state identities that are independently shared.

Unregistered instances need host-ready property values too, but remain opaque identities rather than atomic state units.

### Design

A registered instance reached from ordinary graph data is the ownership boundary for its complete semantic state graph. A nested registered instance belongs to the enclosing unit. Import, sharing, and leases attach to the unit root; traversal still reaches state to prepare Promise versions and maintain indexes. Placements inside the unit are state edges, not additional owners.

Registered semantic state may contain primitives, Errors, records, logical Arrays, and nested registered instances. Errors are immutable terminal data whose identity is preserved. A Promise is admissible only through the value it resolves to. A Function or unregistered or intrinsic identity reached as semantic state is a fatal registered-class contract violation: it cannot be isolated by a generic whole-unit copy. Reject it when admission, assignment, or Promise publication reaches it, before the affected unit is published or passed to host code.

Treat the complete unit as the value of its containing placement. Any mutation within it uses one transition:

1. Capture the placement containing the registered unit and its exact version.
2. If the unit is imported, shared, or leased, clone its complete logical state into one prototype-preserving runtime-owned unit. Preserve internal aliases and cycles, and fork every Promise property version at this operation's program position.
3. Copy or transfer assigned state into the unit so no runtime-managed descendant gains an outside owner. Prepare the assigned value completely before its final host-value write.
4. If preparation waits, publish the operation's ordinary Promise version at the unit placement and keep the prepared unit private.
5. Apply the property change and republish the complete unit in one synchronous transition. Preparation failure restores the prior unit version; a detached completion cannot overwrite a later replacement or deletion.

Working-unit selection is the transition's only representation branch. Reuse an exact unit when it is exclusively owned and safe to mutate; otherwise clone the complete unit. Preparation, Promise gating, invocation, publication, and detachment then follow the same path. Do not create separate in-place and copy-on-write pipelines.

This transition serves property writes and later method mutations. It replaces per-property class gates, instance locks, queues, and shallow class COW. A ready transition completes synchronously without a gate. A rejected data Promise becomes a language Error at its captured state position and the mutation returns nothing.

A registered host mutation starts with the unit's captured logical placements and reconciles its complete final own enumerable state through the same property-version transitions. The method must leave admissible, fully resolved state synchronously; a Promise left in state or another invalid state identity is a fatal class-contract violation. A normal host throw becomes the method's Error result after completed valid synchronous changes are reconciled. A returned Promise belongs only to the independent result and never authorizes later state mutation.

Receiver preparation uses the same unit primitive. Locate the selected registered receiver inside its enclosing unit and preserve that correspondence through a copy. An observation prepares a host-ready snapshot and leases the enclosing unit while pending. A mutation prepares the complete private unit, then invokes the corresponding receiver inside it; if preparation waits, the unit placement is already its FIFO gate. The dispatch phase adds arguments and invocation to this operation state rather than adapting it.

Giving a state descendant another owner copies it out unless the same transition removes it and transfers ownership. Giving the whole instance another owner shares the whole unit. An unregistered or intrinsic instance instead uses an ordinary property-version transition: require the exact identity to be runtime-owned, unshared, unleased, and unimported, export and settle the assigned value, then publish only that host-ready property value.

Graph walks carry the enclosing registered unit after crossing its root. State descendants retain graph structure and preparation state but no independent ownership. This context remains part of the unified import walk in Phase 6 rather than becoming an atomic-instance-only traversal.

### Verification

- Ready registered-unit transitions complete synchronously.
- Direct and nested assigned Promises gate the whole unit; later access to any part resumes in FIFO order.
- A shared, leased, or imported unit COWs as one complete graph while preserving its prototype, aliases, cycles, and Promise versions.
- Assigning an ArrayView or runtime-managed graph into state stores a private host-ready copy or transfers sole ownership; independently extracting a descendant copies it out.
- Nested registered values belong to the outer unit, including when invoking one of their methods.
- Two ordinary placements of one unit share the whole unit; mutation through either COWs before installing its Promise gate.
- Rejected assigned Promises store their Error in the new unit and return nothing. Fatal preparation failures expose neither partial nor unexported state.
- Reassignment, replacement, and deletion cannot be overwritten by a detached completion or restoration.
- Receiver preparation captures complete state and registers receiver dependencies before dispatch adds argument dependencies.
- Internal aliases and cycles cannot bypass the unit's Promise gate, lease, or COW boundary.
- Functions and unregistered or intrinsic identities are rejected as registered semantic state before publication or host invocation.
- A registered method's additions, replacements, and deletions are reconciled across the complete unit, including valid changes completed before a host throw.
- A registered method cannot publish Promise state or mutate the unit after returning; its returned Promise delays only its independent result.
- Imported, shared, or leased unregistered identities reject writes and remain physically unchanged.
- Ready and pending unregistered property writes publish only exported host values in ordinary property-version order.

Update [`data-classes.md`](data-classes.md) and the path-operation documentation.

---

## Phase 6: Reconcile explicit import

### Problem

Import currently treats existing runtime metadata as proof that an identity is runtime-owned, splits preparation between root and runtime walks, and does not fully reconcile host changes on reimport. An ArrayView family attached before explicit import can consequently retain imported storage as mutable backing.

### Design

Use one import walk for new and previously imported data:

1. Visit each reached supported identity once, carrying its enclosing registered unit.
2. Outside a registered unit, retain an existing import boundary or mark the identity imported and shared with the current boundary. A registered root starts one imported unit; its state descendants use that boundary without independent ownership.
3. Stop at a Function, Error, or opaque identity without enumerating its properties or hidden state.
4. Reconcile the union of the container's current physical language keys, previously indexed placement keys, and live mirror keys. Reuse an unchanged imported Promise version, replace a displaced version at the current program position, and publish an ordinary deletion transition for a recorded key that disappeared. Only current physical keys contribute children to recurse into.
5. Recurse into every currently available supported child and apply the same admission before publishing a Promise fulfillment.

Treat each external enumeration, descriptor lookup, and property read as its own admission boundary. If host reflection or an accessor fails, return the Phase 2 language Error for the imported branch; do not wrap the whole import transition and accidentally convert an internal reconciliation failure into data.

Import never infers runtime origin from metadata, mirrors, indexes, leases, or ArrayView attachment. Host-call result admission may instead recognize identities deliberately supplied to host code; it applies their category policy and imports every new host identity.

Retain the source Promise identity on an imported property's mirror so reimport can distinguish an unchanged physical placement after settlement. This is property-version state, not import state, and an unchanged placement gains no second resolver.

Reconcile indexed properties through the ordinary old-to-new edge transition. Each indexed placement retains only its last published logical value; the existing `cycleCuts` entry already is its previous cut state. Runtime publication and external reconciliation update the value record and ordinary cut state together. This preserves reverse parents and Promise, Error, and cycle-cut totals after the host changes a physical property without maintaining a second cut flag. Unindexed containers need no parallel snapshot.

Each ArrayView family shares one single-purpose backing reference. Deriving a view shares that reference; fixed bounds and Promise mirrors remain per view. If its attached raw Array becomes imported, directly or as state of an imported registered unit, create runtime-owned storage with the same physical length and enumerable indexed slots, update the family reference once, and remove the attachment from the imported Array. Existing view mirrors remain authoritative on their views; no retained Promise version moves to or is merged through the shared backing. Every existing derived view follows the new storage without a registry or metadata lookup on each access. Array operations consume the enclosing-unit context carried by their graph walk; descendants do not need duplicate import or ownership fields.

Late explicit import deliberately transitions the raw Array identity to its current physical external contents. Values previously derived from its attached logical view retain their earlier bounds and property versions on the detached runtime backing. The raw identity and those derived values are therefore reconciled separately rather than forcing one placement transition to represent both.

This backing reference is not Phase 0's deleted prepend storage: it has no base index, moving window, or prepend behavior. It exists only so one import transition can detach a complete view family without modifying imported data.

Delete runtime-island detection, `promoteRoot`, the separate runtime walk, `runtimeScanned`, `metadataBeforeRuntimeScan`, `discoverRuntimePromise`, the root/result preparation split, and the early return that skips an already-imported root. Explicit import always performs the bounded reconciliation walk; unmarked assignment values remain local runtime data.

### Verification

- Existing metadata, mirrors, indexes, leases, or ArrayView attachment never prevent explicit import.
- Cycles, aliases, nested and root Promises, rejection, and opaque leaves import without modifying the graph.
- A direct alias becomes imported in either traversal order.
- Reimport reaches current children once, reconciles added, replaced, and deleted indexed and unindexed placements, and retains the first boundary.
- External deletion of an indexed ordinary or Promise property is found through the recorded-key union even though the key is absent from current enumeration.
- An unchanged Promise placement keeps one mirror and resolver; a changed placement gets a fresh version at the import position.
- Indexed reconciliation reuses the existing cycle-cut state and stores no duplicate cut flag.
- Registered state is traversed for preparation and indexing without giving descendants independent ownership.
- An attached Array inside an imported registered unit detaches through the carried unit context even though the Array has no independent import mark.
- Importing an attached Array moves every earlier derived view to runtime-owned backing without moving or merging its mirrors. The raw identity exposes its current external contents; later host and Cascada mutation cannot change the derived views or make Cascada modify the imported Array.
- ArrayView operations use the family backing reference without per-access metadata lookup.
- Imported Promise settlement remains mirror-only.
- Throwing external reflection or accessors poison import, while reconciliation invariants remain fatal.

Update [`runtime-spec.md`](runtime-spec.md), [`import-preparation.md`](import-preparation.md), [`enter.md`](enter.md), and [`array-view.md`](array-view.md).

---

## Phase 7: Dispatch methods by data type

### Problem

Method dispatch still preserves the legacy capabilities of the tracked/untracked split even after it consumes admitted types: inherited record methods can execute, own record functions are rejected, unregistered instances are rejected, and Array overrides receive only shallow-materialized views. The Array-specific mutation flag is also validated before the receiver category is known.

### Design

Implement the `AGENTS.md` capability table directly. Treat `run`'s Boolean as the requested operation mode, rename its internal `mutateArray` terminology without changing the positional API, and validate the mode only after classifying the resolved receiver and selected callable. A class or record function named `push` is not an Array mutator.

Resolve the receiver and every explicit argument before deciding the poison result, even after finding an Error. Collect every distinct original Error consumed by their required preparation in receiver-then-argument order, independent of settlement order. Use one bucket for receiver resolution and selection, then one for each explicit argument; order within one composite input is not semantic. Return one Error unchanged; for several, return an Error whose `errors` array contains the originals. An Error nested inside composite data participates only when the receiver category's preparation or the operation's behavior reaches it.
Use the Error-combination utility established in Phase 2; call preparation only owns discovery order.

Once the receiver version is available, method selection follows admitted type:

- a logical Array first selects a supported standard method or an observation-only override;
- a string selects a native observation on the primitive;
- a record captures and resolves only the selected own language-property version; it never searches the prototype or exposes the record as callable state;
- a registered class selects its declared method surface; and
- an unregistered or intrinsic instance selects an observational method on its exact identity.

Outside the record-function case, an own enumerable language property shadows the method and is not executable. Capture descriptors before preparing arguments without invoking an accessor getter. A reflection, missing, shadowing, or non-callable failure occupies the receiver Error bucket, and argument preparation still completes. Invoke an accessor getter only after preparation is otherwise clean; its failure becomes the call's language Error.

Constructors remain unsupported. A descriptor lookup or executable getter that throws becomes a language Error. An Error produced by resolving a record function property or returned by an executable getter propagates unchanged; another non-callable value, or an accessor without a getter, produces the existing validation Error. Call preparation must not turn these outcomes into fatal runtime failures.

Prepare every call as one ordered transition:

1. Capture the requested mode and the receiver, method-property, and argument versions at the operation's program position.
2. Start receiver-version preparation first. Once that value is available and non-Error, capture its category and callable or accessor descriptor without invoking an executable getter. Then export one complete native Array snapshot for an override, use the registered observation snapshot or whole-unit mutation transition, lease an exact observational receiver, or retain the controlled runtime receiver.
3. Without waiting for a pending receiver, immediately start top-level resolution of every explicit argument from left to right and do not short-circuit after an Error. Once receiver selection determines the boundary, extend those captured values through the required deep preparation. Host-bound positions share one snapshot context that preserves aliases and cycles across the receiver and arguments and leases every exact runtime-managed identity that cannot be copied. Controlled positions otherwise resolve only nested data their method consumes. Even a JavaScript method that ignores an argument position must wait for it and include its Errors.
4. If preparation consumed any Errors, complete the API result without invoking an executable getter, callback, method, override, or mutator: return the single original or ordered aggregate when ready, or reject the already-returned operation Promise with it after all required inputs settle. A mutation poisoned before invocation leaves its receiver unchanged.
5. Otherwise invoke the selected operation exactly once and synchronously. Controlled runtime code follows its method-specific logical transition. Host code follows its declared boundary. Reconcile a registered mutation's complete, ready final unit state through Phase 5's ordinary transitions before publishing it or its Error result. A returned Promise remains the API's independent asynchronous result and may reject; lease the unit root until settlement rather than keeping the mutation private.
6. Admit every result immediately using known origins. A controlled runtime result retains its runtime origin and is not imported merely because it is a method result. Import new host identities and returned snapshot identities created for arguments, Array overrides, or registered observations. Preserve the origin of an exact receiver, opaque argument, or Function supplied without snapshotting and account for its additional owner. Preserve and share a registered mutation's whole receiver; copy out state still owned by the unit, or transfer state relinquished by the same transition. Release all operation leases in this result transition.

The coordinator owns sequencing and snapshot identity; category dispatch owns receiver policy. Use one local operation state for copies, aliases, cycles, Errors, and waits. Do not add a persistent coordinator, queue, or parallel preparation path.

Controlled method preparation contributes every nested Error it actually reaches to the receiver bucket before dependent mutation or callback work runs. Structure-only methods do not inspect nested values merely to search for Errors.

Generalize the existing raw export walk into one multi-root host snapshot. Public export, Array override receivers, and host-call arguments share its copies map, visited set, readiness tree, and ordered per-input Error buckets, so aliases and cycles remain shared across receiver and argument positions and settlement order cannot reorder Errors. One operation-wide seen set removes duplicate Error identities without determining their order. Controlled runtime methods bypass this snapshot because they consume Cascada values and nested data selectively. Do not introduce another host graph copier.

Registered observations are side-effect-free. A registered mutation may change only its prepared receiver unit during synchronous invocation. It may expose that unit or copies of its state only through its result; asynchronous mutation and detached retention are contract violations. Unregistered and intrinsic observations may read intrinsic state but must not mutate or depend on ordinary properties. Host code may retain an exact unsnapshotted receiver, opaque argument, or Function only through its returned value or until its returned Promise settles; the operation leases exact runtime-managed identities for that interval, and detached retention is unsupported. A record function is invoked without the record as its receiver; it may use explicit arguments and read-only host state, but cannot read or mutate its containing record or other Cascada graph state.

Keep executable Function positions explicit. The current controlled callback position is the `sort`/`toSorted` comparator: it receives settled logical elements, is synchronous, read-only, and non-retaining, and a Promise result remains unsupported. Supported String native protocols and callbacks execute inside their host boundary. Passing a Function as ordinary data does not authorize another runtime path to invoke it.

Reject Array mutators in observation mode, mutations through Array overrides, and mutating unregistered or intrinsic calls. Delete unreachable observation-mutator handling, but keep observation view dispatch: `concat` may extend eligible runtime backing while its receiver retains fixed bounds.

Do not add sharing or lease guards that forbid otherwise safe ArrayView backing reuse. An Array imported directly or as registered-unit state never attaches or serves as mutable backing; it materializes or COWs first using the operation's carried unit context.

Delete ordinary receiver selection through `requiresArrayMaterialization`, its `receiver === targetValue` lease inference, and `invokeObservationMethodWithExportedArgs`'s independent per-argument exports. Array overrides always export; exact observational receivers lease explicitly by category. Keep `requiresArrayMaterialization` where representation mutation and copy-on-write still need it.

Preserve the host-call error boundary: a synchronous host-method, executable getter, or reflection throw becomes a ready Error result, while a returned Promise may reject the API result. Property and value failures follow Phase 2's publication rule; bookkeeping, impossible-transition, and declared host-contract violations remain fatal.

### Verification

- Every data type accepts only the methods and modes in `AGENTS.md`.
- A ready call invokes and returns synchronously.
- A call waits for every explicit argument even when an earlier input is already an Error.
- One ready input Error is returned unchanged. A delayed poisoned call rejects its operation Promise with the single original or an aggregate containing every original Error in receiver-then-argument order, even when their Promises settle in another order.
- A descriptor or non-callable selection Error combines ahead of argument Errors; an executable getter is not invoked after preparation is poisoned.
- An Error obtained from the selected record property or executable getter propagates unchanged instead of being replaced by a non-callable validation Error.
- Nested Errors remain data until required preparation or method behavior reaches them; every Error reached by one call appears once in that call's poison result.
- A controlled method that consumes several Error elements, such as sort preparation, returns their aggregate without invoking its comparator; a structure-only method leaves uninspected nested Errors as data.
- A mutation poisoned before invocation leaves its receiver unchanged.
- A record function waits for its captured property version, receives exported arguments, is not called with the record as `this`, and cannot observe record state; inherited and non-callable selections fail.
- Array mutators requested as observations and mutations through Array overrides fail, while a same-named record or class function still follows its own category.
- Supported standard Array methods retain controlled behavior and resolve only the properties each method consumes; unsupported native methods remain rejected unless explicitly overridden.
- Array overrides receive complete exported native Arrays containing no ArrayView, unresolved language property, or original runtime-managed identity.
- Receiver and argument preparation uses one operation state, preserves aliases and cycles across positions, and cannot be changed by later Cascada mutation.
- Public export and host calls use one multi-root snapshot engine; receiver and argument aliases share one exported identity.
- Controlled runtime results remain runtime-owned, while identities first produced by host code are imported.
- Registered observations and mutations see only settled host-ready state and preserve imported or prior owners.
- A registered mutation publishes its complete synchronous unit transition before any returned Promise settles. Leasing the unit root protects its entire state graph; later mutation COWs the whole unit.
- Unregistered and intrinsic observations receive exact identity; mutating calls fail.
- A pending host result leases each exact runtime-managed receiver or opaque argument until settlement; later writes cannot change what the call observes, and all leases are released on fulfillment or rejection.
- `Date.prototype.getTime` succeeds on an exact Date receiver, while `Date.prototype.setTime` requested as a mutation fails without changing it.
- Strings retain native observational behavior.
- Record functions may observe read-only host state such as time, but cannot read or mutate their containing record or other Cascada graph state.
- Own enumerable state shadows non-record methods. Constructor, missing-getter, non-callable, and throwing descriptor/accessor cases retain their specified classification.
- Receiver and top-level argument preparation begin together with receiver registration first. A ready receiver's callable or accessor is captured before category-specific argument preparation, without invoking executable host code early.
- An Array override returning `this` yields its imported exported snapshot. A registered result may contain its whole receiver at any depth; that identity retains its runtime origin and the whole unit becomes shared.
- A registered observation returning its receiver snapshot or state imports that snapshot rather than exposing the original unit.
- A registered-state descendant returned while the unit still owns it becomes an independent copy. A descendant removed by the same mutation may transfer without copying.
- An exact unsnapshotted receiver, opaque argument, or Function returned directly, through a Promise, or inside another result retains its origin and accounts for any additional owner.
- Other new direct and fulfilled results are imported immediately.
- A synchronous host throw returns an Error without changing the receiver beyond completed synchronous mutation effects; a host-returned Promise rejection rejects the API result while preserving those effects.
- Runtime invariant and bookkeeping failures remain fatal across the same call paths.
- Promise interleavings preserve receiver-before-argument registration and FIFO transitions.
- Valid `concat`, `push`, indexed growth, and length growth still reuse runtime-owned backing without changing earlier logical values.
- Imported Arrays never acquire ArrayView attachment or act as mutable backing, and their physical storage remains unchanged.

Update [`run.md`](run.md), [`array-view.md`](array-view.md), [`data-classes.md`](data-classes.md), and [`runtime-spec.md`](runtime-spec.md).
