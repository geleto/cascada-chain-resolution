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
- Controlled runtime methods are the only methods that receive Cascada values directly. They resolve only the properties they consume and reuse backing whenever the rules above permit it.
- A registered instance and its complete semantic state graph form one ownership, leasing, Promise-gating, and copy-on-write unit. State identities never acquire an owner outside that unit.

---

## Phase 0: Remove the ArrayView prepend optimization

Complete.

### Final design

- An ArrayView has one backing and fixed start and end bounds; a logical index translates by the start bound.
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

[`indexComponent`](../src/refcounts.js) marks a child shared when placing a cycle cut. A cut is bookkeeping, while sharing is ownership; a lazy Error query can therefore change a later mutation strategy.

Delete that mark. `setCycleCut` alone keeps the reverse-parent projection acyclic.

### Verification

- An exclusive cyclic or diamond graph behaves identically with and without a preceding Error query.
- Index creation and cycle-cut placement do not create sharing or change a later mutation strategy.
- Real sharing, leases, and import still preserve their logical values, including through ArrayView reuse.

Update [`cycles-as-data.md`](cycles-as-data.md) to state that ref indexing records no ownership.

---

## Phase 2: Make property-shape failures uniformly fatal

### Problem

[`propertyShapeError`](../src/language-properties.js) records thrown errors so Array replay can catch and return them as data. The same descriptor failure is therefore fatal through ordinary assignment and a language Error through Array replay.

### Design

Delete `propertyShapeErrors`, `isPropertyShapeError`, and the replay `try`/`catch`. Descriptor and internal-representation failures are kernel failures; value failures remain language data:

| `commitArrayLength` condition | Class |
| --- | --- |
| `Invalid array length` | language Error |
| `Array length is read-only` | fatal invariant failure |
| `Cannot delete an Array element while setting length` | fatal invariant failure |
| `Cannot grow this ArrayView in place` | fatal invariant failure |

Conformant external descriptor state is imported and copied before mutation. Reaching a hostile descriptor on runtime-owned storage therefore indicates invalid input or a broken invariant, not language data.

Also derive Promise-publication error context from the parent whose property shape failed, not from the assigned value.

### Verification

- Every caller classifies the same property-shape condition identically.
- Invalid length remains a language Error.
- Partial `fill` writes completed before a hostile descriptor remain correctly indexed when the fatal is reported.
- Array-length reduction retains and accounts for deletions completed before a non-configurable element causes a fatal.
- Imported sources COW successfully and remain unchanged.
- Unsupported Promise descriptor shapes remain fatal with their existing attribution.
- Promise-publication failures derive their error context from the parent whose property shape failed, not from the assigned value.

---

## Phase 3: Establish data-type and identity classification

### Problem

`isTracked` currently answers several unrelated questions: whether a value is a language container, may receive metadata, and can be a method receiver. That cannot represent opaque class identities, record functions, or the type capabilities in `AGENTS.md`. Inline metadata also cannot record ownership on an imported or opaque identity without modifying it.

Import also treats existing metadata as evidence of a runtime-owned island. Explicit import is itself the external-ownership fact, so metadata, mirrors, ref indexes, leases, and ArrayView attachment must not prevent an identity from becoming imported.

### Design

Use one external metadata `WeakMap` for every runtime-managed identity:

- make `metaOf` a direct WeakMap lookup;
- make metadata creation a direct WeakMap insertion after the caller has classified the identity, rather than classifying again inside `ensureMeta`;
- remove the metadata Symbol, inline/WeakMap mode switch, import migration, mode files, scripts, and test plumbing; and
- keep all metadata outside both runtime and imported values.

Represent the admitted category with named numeric constants, not strings or constructor names:

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

The numbers carry no ordering; callers compare only the named constants. Resolve callable thenables before value classification. For available values, one classifier applies the precedence in `AGENTS.md` and returns one `TYPE_*` value.

Make that classification the only source for semantic category decisions. Import and export traversal, ownership transitions, path access, method selection, receiver preparation, mutation policy, and capability helpers consume the admitted type instead of repeating prototype, registration, `isTracked`, or other category tests. Delete superseded classifiers and category-specific inference. Structural checks remain only when they answer a representation question rather than a language-type question—for example, whether an already classified logical Array currently has a native Array backing.

Graph traversal admits records, Arrays, and registered state graphs; functions remain opaque callable values and carry no ownership metadata.

Store registered-class definitions in the same metadata `WeakMap`, on the class prototype's record. Registration creates that record without admitting the prototype as language data. On a metadata-bearing identity's first admission, consult its prototype's registration and store its numeric `type` in the identity's metadata; for `TYPE_REGISTERED`, also store the matching class definition there. Later operations read this admitted classification rather than reclassifying the identity. The type is a stable admission fact, not a cache. Primitives, functions, Promises, and Errors remain structurally classified without metadata. A COW-created identity receives the source unit's known type and registered-class definition when its metadata is created.

An unregistered or intrinsic instance may carry import, sharing, and lease facts without becoming traversable. Import classifies and marks the identity, then stops without enumerating its properties or inspecting hidden state. `new Chain(value)` admits its root classification without changing its ownership or import status; supported children are admitted when normal traversal first reaches them.

Metadata, admitted type, and registered-class definition follow identity across prototype changes. Require `registerDataClass` before an instance is supplied through Chain construction, import, assignment, or a host result; registration affects only identities admitted afterward. Do not add retroactive discovery or reclassification. Benchmark representative property walks, but do not retain two metadata systems merely for a small lookup difference.

A registered instance reached from ordinary graph data is the ownership boundary for every runtime-managed identity in its semantic state graph. A nested registered instance belongs to the enclosing unit. Import, sharing, and leases attach to the unit root; traversal still reaches its enumerable state to prepare Promise versions and maintain indexes. Internal aliases and cycles remain within the unit. State entering or leaving the unit is copied or transferred by the atomic-instance phase, so descendants never need independent ownership state.

Ordinary placement and extraction transitions account for owners at the registered-unit root. A second owner marks the whole unit shared; placements within the unit remain state edges and add no owner. Do not discover ownership by scanning graph multiplicity.

Use the same import walk for new and previously imported data. In one import pass:

1. Visit each reached supported identity once, carrying its enclosing registered unit when one exists.
2. Outside a registered unit, retain an existing import boundary or mark the identity imported and shared with the current boundary. A registered instance starts one imported unit; its state descendants use that unit's boundary without acquiring independent ownership.
3. Stop at an opaque unregistered identity without enumerating or traversing its properties.
4. For a language container, enumerate its current physical language properties. Reuse an unchanged imported Promise version, replace a displaced version at the current program position, and remove a stale mirror when its physical placement changed or was deleted.
5. Recurse into every currently available supported child, retaining the current registered unit across its complete state graph.
6. Apply the same admission before publishing a Promise fulfillment.

Import never infers runtime origin from existing metadata. A host-call operation may instead identify values it deliberately supplied to host code; result admission applies their known category policy and imports every newly introduced identity.

An imported Promise mirror retains the source Promise identity of its property version so a later import can distinguish an unchanged physical placement from a new one after settlement. This is property-version state, not import state. Reconciliation must not add another resolver for an unchanged placement.

Reimport uses the ordinary old-to-new edge transition, not a mirror-only scan. A ref index retains the last published value and cut state of each indexed property; normal publication and external reconciliation update that same placement record. This supplies the old edge after the host has changed the physical property, so reverse parents and Promise, Error, and cycle-cut totals remain exact. Unindexed containers need no parallel snapshot: their current physical properties and Promise mirrors are sufficient.

If an Array with an existing attachment becomes imported, detach the existing view family first. Materialize its current backing and retained property versions into runtime-owned storage, record one backing redirect in external metadata, and remove the attachment from the imported Array. Existing views resolve their backing through that redirect, so they need no registry or mutation. The imported identity then exposes its current external contents, while every earlier view remains fixed and no view reads or writes imported storage.

Delete `isTracked`, `isPlainObjectPrototype` as a public classifier, direct registration tests outside first admission, and every parallel semantic-category inference. Also delete runtime-island detection, `promoteRoot`, the separate runtime walk, `runtimeScanned`, `metadataBeforeRuntimeScan`, `discoverRuntimePromise`, the root/result preparation split, and the early return that skips an already-imported root. Explicit import always re-enters the bounded walk; unmarked assignment values remain local runtime data.

### Verification

- Each category in the `AGENTS.md` table is classified independently of its method name.
- Classification uses named numeric `TYPE_*` constants; no string tag or constructor name becomes runtime state.
- Class registration and identity state use the same external metadata map; no separate class registry or prototype property is introduced.
- Every semantic category decision uses the central classification; no subsystem independently infers the value's language type.
- Remaining structural predicates answer only representation or property-shape questions and cannot override the admitted type.
- A class registered before instance admission is a language container; an unregistered class remains opaque.
- Array and Promise subclasses keep their Array and Promise classification even if registered.
- Registered-state traversal prepares Promise and index state without assigning independent ownership to descendants.
- No imported identity receives an own metadata property; opaque identities are not traversed.
- Import, extraction, and leases record identity facts on unregistered and intrinsic objects.
- Primitives, functions, Promises, and Errors remain outside metadata.
- After identity classification, metadata lookup and creation add no Proxy reflection and never modify the identity.
- Prototype mutation does not change an identity's admitted type or registered-class definition.
- Cycles, DAG aliases, repeated identities, nested and root Promises, rejection, and opaque leaves import without modifying the graph.
- Pre-existing mirrors, ref indexes, sharing, leases, or ArrayView attachment never create a runtime island or prevent explicit import.
- A direct alias becomes imported in either traversal order.
- Reimport reaches current children once, reconciles added, replaced, and deleted indexed and unindexed placements, reuses unchanged Promise versions without another resolver, and retains the first boundary.
- Importing an attached Array detaches earlier views onto runtime-owned backing. Later host and Cascada mutation cannot change those views or make Cascada modify the imported Array.
- `new Chain` admits its root type while preserving ownership status; explicit import additionally classifies its supplied value as external.
- Imported Promise settlement remains mirror-only.
- The complete suite and refcount oracle pass in the single metadata mode; benchmark results are recorded.

Update [`runtime-spec.md`](runtime-spec.md), [`import-preparation.md`](import-preparation.md), [`enter.md`](enter.md), and active documentation that requires both metadata modes.

---

## Phase 4: Make registered instances atomic

### Problem

Registered instances are currently traversed and copied like ordinary containers. A property may therefore be published independently, opaque host class code can receive unresolved or internal state, and protecting the receiver root does not protect state identities that are independently shared.

Unregistered instances need host-ready property values too, but remain opaque identities rather than atomic state units.

### Design

Treat a registered instance and its complete semantic state graph as the value of its containing placement. Any mutation within that graph transitions this whole-unit version:

1. Capture the placement containing the registered unit and its exact version.
2. If the unit is imported, shared, or leased, clone its complete logical state into one prototype-preserving runtime-owned unit. Preserve internal aliases and cycles, and fork every Promise property version at this operation's program position.
3. Copy or transfer assigned state into the unit so no runtime-managed descendant gains an outside owner. Prepare the assigned value completely before its final host-value write.
4. If preparation waits, publish the operation's ordinary Promise version at the unit placement and keep the prepared unit private.
5. Apply the property change and republish the complete unit in one synchronous transition. Failure restores the prior unit version; a detached completion cannot overwrite a later replacement or deletion.

This is the one registered-unit transition used by property writes and later method mutations. It replaces per-property class gates, instance locks, queues, and shallow class COW. A ready transition completes synchronously without a gate. A rejected data Promise becomes a language Error at its captured state position and the mutation returns nothing.

Introduce receiver preparation on the same unit primitive. Locate the selected registered receiver within its enclosing unit and preserve that correspondence through any copy. An observation prepares a host-ready snapshot of the receiver and leases the enclosing unit while pending. A mutation prepares the complete private unit, then invokes the corresponding receiver inside it; if preparation waits, the unit placement is already its FIFO gate. Both paths preserve prototypes, aliases, cycles, and Promise versions at the operation's program position. The method-dispatch phase adds arguments and invocation to this operation state rather than adapting it.

Giving a registered-state descendant another owner copies it out of the unit unless the same transition removes it and transfers ownership. Giving the whole instance another owner shares the whole unit. An unregistered or intrinsic instance instead uses an ordinary property-version transition: require the exact identity to be runtime-owned, unshared, unleased, and unimported, export and settle the assigned value, then publish only that host-ready property value.

### Verification

- Ready registered-unit transitions complete synchronously.
- Direct and nested assigned Promises gate the whole registered unit; later access to any part of that unit resumes in FIFO order.
- A shared, leased, or imported registered unit COWs as one complete graph. The preserved unit and imported storage remain unchanged, while prototype, aliases, cycles, and logical Promise versions are preserved in the copy.
- Assigning an ArrayView or runtime-managed graph into registered state stores a private host-ready copy or transfers sole ownership; independently extracting a descendant produces a copy.
- A nested registered value, such as each endpoint of a registered line, remains state owned by the outer unit rather than an independently shared value.
- Invoking a nested registered receiver mutates the corresponding receiver inside a whole-unit copy; an observation leases the outer unit without exposing its state.
- Two ordinary placements of one registered unit make the whole unit shared; a mutation through either placement COWs before installing its Promise gate, so the other placement cannot bypass or observe the transition.
- A rejected assigned Promise stores its Error in the new unit and returns nothing. A fatal preparation failure restores the prior unit version and exposes neither partial nor unexported state.
- Reassigning the same Promise creates a distinct whole-unit operation version, and a later replacement or deletion cannot be overwritten by a detached completion or restoration.
- Registered observation and mutation preparation capture the complete state graph and register receiver dependencies before the method-dispatch phase adds argument dependencies.
- Internal aliases and cycles remain inside the unit and cannot bypass its Promise gate, lease, or COW boundary.
- Imported, shared, or leased unregistered identities reject writes and remain physically unchanged.
- Ready and pending unregistered property writes publish only exported host values and retain ordinary property-version ordering.

Update [`data-classes.md`](data-classes.md) and the path-operation documentation.

---

## Phase 5: Dispatch methods by data type

### Problem

Method dispatch still follows the tracked/untracked split: inherited record methods can execute, own record functions are rejected, unregistered instances are rejected, and Array overrides receive only shallow-materialized views. The Array-specific mutation flag is also validated before the receiver category is known.

### Design

Implement the `AGENTS.md` capability table directly. Treat `run`'s Boolean as the requested operation mode, rename its internal `mutateArray` terminology without changing the positional API, and validate the mode only after classifying the resolved receiver and selected callable. A class or record function named `push` is not an Array mutator.

After Promise resolution and Error propagation, method selection follows the classification phase's precedence:

- a logical Array first selects a supported standard method or an observation-only override;
- a string selects a native observation on the primitive;
- a record captures and resolves only the selected own language-property version; it never searches the prototype or exposes the record as callable state;
- a registered class selects its declared method surface;
- an unregistered or intrinsic instance selects an observational method on its exact identity.

Outside the record-function case, an own enumerable language property shadows the method and is not executable. Capture descriptors before preparing arguments; invoke an accessor getter only later with the prepared receiver. Missing or non-callable selections produce the existing validation Error.

Constructors remain unsupported. A descriptor lookup or executable getter that throws becomes a language Error; an accessor without a getter or a getter returning a non-callable value produces the existing validation Error. Call preparation must not turn either into a kernel failure.

Prepare each host call as one ordered transition:

1. Capture the receiver category, selected callable or accessor, requested mode, and selected property version at the operation's program position.
2. Establish receiver protection and prepare receiver dependencies before any argument dependency. Export one complete native Array snapshot for an override; use the atomic-instance phase's registered observation snapshot or whole-unit mutation transition; or lease an exact observational receiver.
3. Export explicit arguments from left to right in the same snapshot context. Preserve aliases and cycles across the receiver and every argument.
4. Once all preparation is ready, invoke host code exactly once and synchronously. A registered mutation may change only its prepared unit and publishes the complete unit before waiting for a returned Promise. That Promise delays only its independent result; lease the unit root until settlement rather than keeping the mutation private.
5. Admit every result immediately using the operation's known origins. Import new host identities, exported arguments, Array override receivers, and registered observation snapshots if returned. Wherever the result contains a registered mutation's whole receiver, preserve and share that unit; copy out a state descendant that remains owned by the unit, or transfer one relinquished by the same transition. Preserve an unsnapshotted unregistered/intrinsic receiver wherever it occurs. Release all operation leases in this result transition.

The coordinator owns sequencing and snapshot identity; category dispatch owns receiver policy. Use one local operation state for copies, aliases, cycles, and waits. Do not add a persistent coordinator, queue, or parallel preparation path.

Registered observations are side-effect-free. A registered mutation may change only its prepared receiver unit during synchronous invocation. It may expose that unit or copies of its state only through its result; asynchronous mutation and external retention are contract violations. Unregistered and intrinsic observations may read intrinsic state but must not mutate or depend on ordinary properties. A record function is invoked without the record as its receiver and uses only its explicit arguments.

Reject Array mutators in observation mode, mutations through Array overrides, and mutating unregistered or intrinsic calls. Delete unreachable observation-mutator handling, but keep observation view dispatch: `concat` may extend eligible runtime backing while its receiver retains fixed bounds.

Do not add sharing or lease guards that forbid otherwise safe ArrayView backing reuse. Imported Arrays never attach or serve as mutable backing; they materialize or COW first.

Delete ordinary receiver selection through `requiresArrayMaterialization`, its `receiver === targetValue` lease inference, and `invokeObservationMethodWithExportedArgs`'s independent per-argument exports. Array overrides always export; exact observational receivers lease explicitly by category. Keep `requiresArrayMaterialization` where representation mutation and copy-on-write still need it.

Preserve the existing call-error boundary: a synchronous host-method throw, executable getter or reflection throw, or returned-Promise rejection becomes a language Error result. Language-property shape assertions, bookkeeping failures, and trusted-call contract violations remain fatal.

### Verification

- Every data type accepts only the methods and modes in `AGENTS.md`.
- A ready host call invokes and returns synchronously.
- A record function waits for its captured property version, receives exported arguments, is not called with the record as `this`, and cannot observe record state; inherited and non-callable selections fail.
- Array mutators requested as observations and mutations through Array overrides fail, while a same-named record or class function still follows its own category.
- Supported standard Array methods retain controlled behavior and resolve only the properties each method consumes; unsupported native methods remain rejected unless explicitly overridden.
- Array overrides receive complete exported native Arrays containing no ArrayView, unresolved language property, or original runtime-managed identity.
- Receiver and argument preparation uses one operation state, preserves aliases and cycles across positions, and cannot be changed by later Cascada mutation.
- Registered observations and mutations see only settled host-ready state and preserve imported or prior owners.
- A registered mutation publishes its complete synchronous unit transition before any returned Promise settles. Leasing the unit root protects its entire exclusive state graph; later mutation COWs the whole unit.
- Unregistered and intrinsic observations receive exact identity; mutating calls fail.
- `Date.prototype.getTime` succeeds on an exact Date receiver, while `Date.prototype.setTime` requested as a mutation fails without changing it.
- Strings retain native observational behavior.
- Own enumerable state shadows non-record methods. Constructor, missing-getter, non-callable, and throwing descriptor/accessor cases retain their specified classification.
- Callable and accessor selection precedes asynchronous argument readiness without invoking host code early.
- An Array override returning `this` yields its imported exported snapshot. A registered result may contain its whole receiver at any depth; that identity retains its runtime origin and the whole unit becomes shared.
- A registered observation returning its receiver snapshot or state imports that snapshot rather than exposing the original unit.
- A registered-state descendant returned while the unit still owns it becomes an independent copy. A descendant removed by the same mutation may transfer without copying.
- An unsnapshotted unregistered or intrinsic receiver returned directly, through a Promise, or inside another result retains its origin and accounts for any additional owner.
- Other new direct and fulfilled results are imported immediately.
- Synchronous host throws and returned-Promise rejections become language Error results without changing the receiver beyond completed synchronous mutation effects.
- Promise interleavings preserve receiver-before-argument registration and FIFO transitions.
- Valid `concat`, `push`, indexed growth, and length growth still reuse runtime-owned backing without changing earlier logical values.
- Imported Arrays never acquire ArrayView attachment or act as mutable backing, and their physical storage remains unchanged.

Update [`run.md`](run.md), [`array-view.md`](array-view.md), and [`data-classes.md`](data-classes.md).
