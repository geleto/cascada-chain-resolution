# First-Principles Conformance Plan

## Purpose

This plan brings the remaining `src` behavior into conformance with the first principles in [`AGENTS.md`](../AGENTS.md). Phases group changes by cause; [Implementation order](#implementation-order) gives their landing order. Keep completed phases, but replace proposals with their final design.

`AGENTS.md` is authoritative for settled contracts. Source and tests are authoritative for completed mechanisms.

## Method

Implement each checkpoint independently. After every checkpoint:

- reproduce the affected behavior and add integration coverage;
- run the complete suite in every supported metadata mode;
- run `test/verify-refcounts.js`; and
- review the result for structural simplifications, unifications, dead weight, and load-bearing complexity.

Prefer one general transition over special cases. Do not pin helper boundaries, mirror fields, cycle-cut placement, exact counters, or another interchangeable representation. Delete superseded mechanisms in the same change.

Baseline: commit `3d5a47a` (2026-08-06), with 648 tests passing in each metadata mode.

## Shared design constraints

- Imported identities and their physical storage are never modified.
- Observations and mutations may change runtime-owned representation when their logical results are correct and every value they must preserve remains unchanged.
- Sharing and leasing protect logical values, not backing storage. Fixed ArrayView bounds may protect an old value while another value extends the runtime-owned backing.
- COW or materialization is required only when representation reuse would change a protected logical value, or when an operation needs owned storage for imported data.
- Host-call arguments are exported and every new direct or fulfilled result crosses import immediately. Receivers follow the category rules in `AGENTS.md`; returning the exact receiver preserves its existing origin.
- Controlled runtime methods are the only methods that receive Cascada values directly. They resolve only the properties they consume and reuse backing whenever the rules above permit it.

---

## Phase 0: Remove the ArrayView prepend optimization

Complete.

### Final design

- `ArrayView` stores `_backing`, `_start`, and `_end`; physical indexes are `_start + logicalIndex`.
- `unshift` mutates a sole-owned native Array directly and otherwise uses the remap path. It does not move storage shared by fixed views.
- Array method dispatch has no prepend-specific view strategy.
- ArrayView attachment still pins the raw Array's current logical bounds, allowing later values to reuse its backing without changing earlier values.
- Tests verify behavior and the language surface without pinning private field names.

### Verification

- `unshift` matches JavaScript for owned and preserved receivers.
- Earlier values remain unchanged across `slice` and repeated `unshift` operations.
- Append at the physical endpoint still reuses runtime-owned backing while earlier fixed views remain unchanged.
- The complete suite passes 648 tests in both metadata modes, including the refcount oracle.

---

## Phase 1: Establish data-type and identity classification

### Problem

`isTracked` currently answers several unrelated questions: whether a value is a language container, may receive metadata, and can be a method receiver. That cannot represent opaque class identities, record functions, or the type capabilities in `AGENTS.md`. Inline metadata also cannot record ownership on an imported or opaque identity without modifying it.

### Design

Use one external metadata `WeakMap` for every runtime-managed identity:

- make `metaOf` a direct WeakMap lookup;
- remove the metadata Symbol, inline/WeakMap mode switch, import migration, mode files, scripts, and test plumbing; and
- keep all metadata outside both runtime and imported values.

Separate classification helpers by question. Graph traversal continues to admit only records, Arrays, and registered class instances. Method dispatch separately distinguishes records, logical Arrays, strings, registered classes, and unregistered or intrinsic instances. Functions remain opaque callable values rather than property containers. Registration must be queryable directly instead of being inferred from `isTracked`.

An unregistered or intrinsic instance may carry import, sharing, and lease facts without becoming traversable. Import marks such an identity imported and shared, then stops without reflecting on its properties or hidden state. `new Chain(value)` remains classification-neutral.

Metadata follows identity across prototype changes. A later `registerDataClass` call changes graph classification without losing existing identity facts. Benchmark representative property walks, but do not retain two metadata systems merely for a small lookup difference.

### Verification

- Each category in the `AGENTS.md` table is classified independently of its method name.
- A custom class is unregistered before registration and a registered language container afterward.
- Opaque and imported identities receive no own metadata property and are never traversed.
- Import, extraction, and leases record identity facts on unregistered and intrinsic objects.
- Creating a Chain preserves existing identity facts and does not mark its value imported or shared.
- Primitives, Promises, and Errors remain outside metadata.
- Metadata lookup and storage trigger no Proxy reflection, including for an imported frozen identity, and never modify that identity.
- Prototype mutation and late class registration do not lose identity facts or cache stale classification.
- The complete suite and refcount oracle pass in the single metadata mode; benchmark results are recorded.

Update [`runtime-spec.md`](runtime-spec.md), [`import-preparation.md`](import-preparation.md), and documentation that requires both metadata modes.

---

## Phase 2: Make class property writes atomic

### Problem

Class property assignment currently stores Cascada values directly. Native class code can therefore encounter an ArrayView, tracked graph identity, or pending language Promise. Waiting on the assigned field alone also leaves the instance visible in a partially updated state.

### Design

Treat a class-property write as one transition on the placement containing the instance:

1. Capture that placement's property version.
2. For a registered instance, apply normal copy-on-write; for an unregistered or intrinsic instance, require the exact identity to be runtime-owned, unshared, unleased, and unimported.
3. Export and settle the assigned value, including nested language Promises.
4. If preparation waits, publish the ordinary Promise gate at the instance placement and retain the instance privately.
5. Write only the prepared host value, then republish the instance. Later operations resume from the same gate in FIFO order.

Use the existing property-version transition; do not add a class lock, queue, or pending-field representation. A rejected data Promise becomes the assigned Error value and the mutation returns nothing, as for every language write. A fatal preparation failure restores the unchanged instance before reporting, so no partial state is published. A ready value completes synchronously without installing a gate.

All semantic state of a registered class must remain in own enumerable string-keyed properties. An unregistered or intrinsic instance remains opaque even though Cascada may write one of its ordinary properties under the exclusive-ownership rule.

### Verification

- Ready primitive and graph values are exported and written synchronously.
- Assigning an ArrayView or tracked graph stores no internal representation and preserves aliases and cycles in the exported value.
- Direct and nested Promises gate the containing instance, never the destination field.
- Later writes and method calls queue at that property version and observe FIFO order.
- A rejected assigned Promise stores its Error value, publishes atomically, and returns nothing.
- A fatal preparation failure restores the unchanged instance before reporting and exposes no partial write.
- Registered writes COW across imported, shared, and leased owners.
- Imported, shared, or leased unregistered identities reject writes and remain physically unchanged.
- Reassigning the same Promise creates a distinct property version.

Update [`data-classes.md`](data-classes.md) and the path-operation documentation.

---

## Phase 3: Dispatch methods by data type

### Problem

Method dispatch still follows the tracked/untracked split: inherited record methods can execute, own record functions are rejected, unregistered instances are rejected, and Array overrides receive only shallow-materialized views. The Array-specific mutation flag is also validated before the receiver category is known.

### Design

Implement the `AGENTS.md` capability table directly. Treat `run`'s Boolean as the requested operation mode, rename its internal `mutateArray` terminology without changing the positional API, and validate the mode only after classifying the resolved receiver and selected callable. A class or record function named `push` is not an Array mutator.

Method selection is category-specific:

- a record captures and resolves only the selected own language-property version; it never searches the prototype or exposes the record as callable state;
- a logical Array first selects a supported standard method or an observation-only override;
- a registered class selects its declared method surface;
- an unregistered or intrinsic instance selects an observational method on its exact identity; and
- a string selects a native observation on the primitive.

Outside the record-function case, an own enumerable language property shadows the method and is not executable. Capture descriptors before preparing arguments; invoke an accessor getter only later with the prepared receiver. Missing or non-callable selections produce the existing validation Error.

Constructors remain unsupported. A descriptor lookup that throws, an accessor without a getter, and a getter that throws or returns a non-callable value retain their existing language-Error or fatal classification; call preparation must not blur those boundaries.

Prepare each host call through one operation-wide coordinator:

- export every explicit argument and, for an Array override, the complete native Array receiver snapshot;
- preserve aliases and cycles across all exported positions and register receiver dependencies before argument dependencies;
- prepare every registered-class property before native code consumes it; use an owned copy rather than modifying imported state;
- lease an exact observational receiver until the call completes, while a pending registered mutation reuses Phase 2's instance gate and remains private; and
- import every new synchronous or fulfilled result immediately, while an already owned exact receiver retains its origin and gains another owner only when the result creates one.

Registered observations are side-effect-free. A registered mutation may change only its prepared receiver and may not retain it or mutate after its result settles. Unregistered and intrinsic observations may read intrinsic state but must not mutate or depend on ordinary properties. A record function uses only its explicit arguments.

Reject Array mutators in observation mode, mutations through Array overrides, and mutating unregistered or intrinsic calls. Delete unreachable observation-mutator handling, but keep observation view dispatch: `concat` may extend eligible runtime backing while its receiver retains fixed bounds.

Do not add sharing or lease guards that forbid otherwise safe ArrayView backing reuse. Imported Arrays never attach or serve as mutable backing; they materialize or COW first.

### Verification

- Every data type accepts only the methods and modes in `AGENTS.md`.
- A ready host call invokes and returns synchronously.
- A record function waits for its captured property version, receives exported arguments, and cannot observe record state; inherited and non-callable selections fail.
- Array mutators requested as observations and mutations through Array overrides fail, while a same-named record or class function still follows its own category.
- Standard Arrays retain controlled behavior and resolve only the properties each method consumes.
- Array overrides receive complete exported native Arrays containing no ArrayView, unresolved language property, or original tracked identity.
- Receiver and argument export uses one snapshot, preserves aliases and cycles across positions, and cannot be changed by later Cascada mutation.
- Registered observations and mutations see only settled host-ready state and preserve imported or prior owners.
- A pending registered mutation keeps its instance gated until the method settles; later operations observe no partial state.
- Unregistered and intrinsic observations receive exact identity; mutating calls fail.
- `Date.prototype.getTime` succeeds on an exact Date receiver, while `Date.prototype.setTime` requested as a mutation fails without changing it.
- Strings retain native observational behavior.
- Own enumerable state shadows non-record methods. Constructor, missing-getter, non-callable, and throwing descriptor/accessor cases retain their specified classification.
- Callable and accessor selection precedes asynchronous argument readiness without invoking host code early.
- An Array override or isolated registered call returning `this` yields an imported prepared copy, never the original identity.
- An exact class receiver returned directly or through a Promise retains its origin and accounts for any additional owner.
- Other new direct and fulfilled results are imported immediately.
- Promise interleavings preserve receiver-before-argument registration and FIFO transitions.
- Valid `concat`, `push`, indexed growth, and length growth still reuse runtime-owned backing without changing earlier logical values.
- Imported Arrays never acquire ArrayView attachment or act as mutable backing, and their physical storage remains unchanged.

Update [`run.md`](run.md), [`array-view.md`](array-view.md), and [`data-classes.md`](data-classes.md).

---

## Phase 4: Keep ownership facts at their source

### Phase 4a: Ref indexing must not create sharing

[`indexComponent`](../src/refcounts.js) marks a child shared when placing a cycle cut. A cut is bookkeeping, while sharing is ownership; a lazy Error query can therefore change a later mutation strategy.

Delete that mark. `setCycleCut` alone keeps the reverse-parent projection acyclic.

#### Verification

- An exclusive cyclic or diamond graph behaves identically with and without a preceding Error query.
- Index creation and cycle-cut placement do not create sharing or change a later mutation strategy.
- Real sharing, leases, and import still preserve their logical values, including through ArrayView reuse.

Update [`cycles-as-data.md`](cycles-as-data.md) to state that ref indexing records no ownership.

### Phase 4b: Import is the external-ownership fact

[`walkImported`](../src/import-preparation.js) currently treats pre-existing metadata as evidence of a runtime-owned island. That inference is unnecessary and wrong: a value passed to import is external by definition. Snapshot receivers cross through export, while exact unregistered receivers are governed by their identity ownership and are never inferred from graph metadata.

Use one import walk:

1. Visit each newly reached supported object identity once per import pass.
2. If it is already imported, retain its first boundary and stop; that identity was prepared at its first admission.
3. Otherwise mark it imported and shared.
4. If it is an opaque unregistered instance, stop without reflecting on or traversing hidden state.
5. Otherwise enumerate its current language properties, prepare each Promise property as an imported property version, and recurse into every available supported child.
6. Apply the same admission to Promise fulfillments before publishing them.

Metadata, mirrors, ref indexes, leases, and ArrayView attachment never imply runtime origin. Delete:

- runtime-island detection;
- `promoteRoot`, the separate runtime walk, and the root/result preparation split;
- `runtimeScanned` and `metadataBeforeRuntimeScan`;
- `discoverRuntimePromise`; and
- the proposed `RUNTIME_OWNED` state and all admission-point bookkeeping.

`new Chain(value)` remains classification-neutral. External assignment values must already have crossed import; unmarked assigned values are local runtime data. A caller that explicitly invokes import declares the supplied graph external, regardless of metadata already present.

#### Verification

- Cycles, DAG aliases, repeated identities, nested and root Promises, rejection, frozen data, and opaque class leaves import without modifying the graph.
- Pre-existing mirrors, ref indexes, sharing, leases, or ArrayView attachment never prevent explicit import or create a runtime island.
- A direct alias is classified by its imported path in either traversal order.
- Repeated import is idempotent and retains the first boundary attribution.
- `new Chain` preserves an identity's existing status, while explicit import always classifies its supplied value as external.
- Imported Promise settlement remains mirror-only.

Update [`import-preparation.md`](import-preparation.md).

---

## Phase 5: Make property-shape failures uniformly fatal

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
- Imported frozen and locked sources COW successfully and remain unchanged.
- Unsupported Promise descriptor shapes remain fatal with their existing attribution.
- Promise-publication failures derive their error context from the parent whose property shape failed, not from the assigned value.

---

## Implementation order

1. **Phase 0 (complete)** — removed prepend-in-place and `baseIndex`.
2. **Phase 1** — establish one external identity map and independent data-type classifiers.
3. **Phase 2** — make registered and unregistered class-property writes atomic and host-ready.
4. **Phase 3** — dispatch each method category and apply one host-call boundary.
5. **Phase 4a** — stop ref indexing from creating sharing.
6. **Phase 4b** — replace runtime-island inference with one external import walk.
7. **Phase 5** — make property-shape failures uniformly fatal.
