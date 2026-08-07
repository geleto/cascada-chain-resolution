# First-Principles Conformance Plan

## Purpose

This plan brings the remaining `src` behavior into conformance with the first principles in `AGENTS.md`. Phases group changes by cause; [Implementation order](#implementation-order) gives their landing order. Keep a phase after completion, but replace its proposal and status with the final design.

This document records only information needed to implement or verify these changes. `AGENTS.md` is authoritative for settled contracts; source and tests are authoritative for completed mechanisms.

## Method

Implement each checkpoint independently. After every checkpoint:

- run the complete suite in every supported metadata mode;
- reproduce the affected failures and confirm the new behavior;
- run `test/verify-refcounts.js`; and
- keep only changes whose conformance or simplification gain justifies their complexity.

Prefer integration tests through public operations. Do not pin mirror fields, helper boundaries, cycle-cut placement, exact counter totals, or another interchangeable representation. Delete a superseded mechanism in the same change.

Baseline: commit `3d5a47a` (2026-08-06), with 648 tests passing in each metadata mode.

## Shared design constraints

Copying has three grounds: an identity is shared, it is leased, or a write would change storage shared with another value. [`requiresCopyOnWrite`](../src/meta.js#L54-L58) covers the first two; [`requiresArrayMaterialization`](../src/array-view.js#L267-L269) covers the third.

Keep these facts at their existing scopes:

- sharing is permanent; a lease is released;
- `attachmentRoot !== undefined` means the current path is already being copied and is part of [`mustPreserveValue`](../src/mutations.js#L42-L45);
- `mustPreserveValue(value) || requiresArrayMaterialization(value)` means the logical source survives the operation, but its callers use that fact differently. Extract a shared helper only if doing so removes more complexity than it adds; and
- ArrayView attachment remains a conservative presence test for mutation because the runtime cannot know whether a sibling view still exists.

---

## Phase 0: Delete in-place prepend

Status: ready; implement before Phase 1.

### Reason

[`baseIndex`](../src/array-view.js#L12-L25) exists only for in-place prepend. Every view operation carries its coordinate adjustment, while [`#canPrepend`](../src/array-view.js#L66-L106) scans backing descriptors and the prototype chain to prove that one optimization safe. Native `unshift` is already O(n), so this saves one allocation but no asymptotic work. The mechanism does not earn its complexity.

### Changes

- Delete `tryPrependArrayView`, `ArrayView.tryPrepend`, `#prepend`, `#canPrepend`, and `baseIndex`.
- Replace the shared `_storage` record with a direct `_backing` reference.
- Remove `baseIndex` arithmetic from the constructor, `#physicalKey`, `enumerableArrayKeys`, and `canGrowEnd`.
- Let `unshift` mutate a sole-owned native Array directly; otherwise use the existing remap path.
- Update the **Representation** section of [`array-view.md`](array-view.md).
- Replace [`array-view.test.js:47-52`](../test/array-view.test.js#L47-L52), which pins private field names and constructs its subject through the observation-mutator behavior removed in Phase 5, with a behavioral test.

This does **not** remove ArrayView attachment. It still records that a raw Array backs a view, forcing later writes to preserve that view, and stores the raw identity's logical bounds when they differ from the physical backing. `meta.arrayView`, `projectionOf`, and Phase 1 Part B therefore remain.

### Verification

- `unshift` matches JavaScript for sole-owned and preserved receivers.
- `slice` then `unshift`, and two views then `unshift`, leave every retained view unchanged.
- Append at the physical endpoint still reuses storage where ownership permits; an existing view's fixed end remains unchanged.
- `verify-refcounts` passes.

---

## Phase 1: Apply ownership to `ArrayView`

Status: Parts A and B ready; Part A lands after Phase 5.

### Problems

`ArrayView` currently checks import status but not sharing or leases. Four observable failures follow:

| Defect | Failure |
| --- | --- |
| 1a | `push` or indexed growth can mutate a backing Array retained by an extracted owner or pending receiver. Cascada's logical result is correct, but the retained raw identity changes. |
| 1b | After `slice` attaches a view, an opaque method receives a materialized copy even when the attachment still spans the complete backing. Non-enumerable and Symbol receiver state is lost. |
| 1c | A view attached before import gives the Array metadata; import mistakes it for a runtime-owned island, and later growth can modify imported data. Part A must protect this independently of Phase 2b. |
| 1d | Observation `concat` physically extends its receiver, while an Array mutator dispatched with `mutateArray: false` both mutates and returns the wrong kind of result. Phase 5 closes the dispatch half. |

The resulting rules are:

- A contiguous subrange may be a view only over a runtime-owned, attachable backing. Imported Arrays materialize because the host can still mutate them.
- An observation never physically extends its receiver.
- A mutating append may reuse storage only at the physical endpoint of a writable backing.
- Any physical write additionally requires that neither the backing nor the operation must preserve the raw Array.

### Part A: Make backing growth obey ownership

The following cases distinguish the required changes:

| Case | Shape | Current breach | Required protection |
| --- | --- | --- | --- |
| 0 | shared or leased ancestor, unmarked child, observation `concat` | child and preserved ancestor grow | remove observation growth |
| 1 | full-span `ArrayView`, shared backing, mutation `push` | escaped backing grows | backing guard |
| 2 | shared ancestor, attached raw child, indexed growth | old ancestor's child grows | assignment guard |
| 3 | shared ancestor, attached raw child, mutation `push` | old ancestor's child grows | method guard |

After extracting the ancestor in cases 2 and 3, `requiresCopyOnWrite(child)` remains false; ownership does not propagate to child identities until the path is copied. A backing-only test therefore cannot protect those cases.

#### 1. Remove observation growth

Remove `concat`'s `view` entry and `tryConcatArrayView`. Its existing `createConcatResultRemap` already produces the correct independent result. Once Phase 5 rejects observation mutators, `definition.view` in `invokeArrayObservationMethod` becomes unreachable and should also be deleted.

This is simpler than carrying ancestor preservation context through every observation solely to retain a `concat` allocation optimization.

#### 2. Guard the backing

[`canGrowEnd`](../src/array-view.js#L42-L52) must refuse growth when [`requiresCopyOnWrite(backing)`](../src/meta.js#L54-L58) is true. Put the guard there because it describes the backing itself and must cover a logical receiver that is already an `ArrayView`.

Do not substitute `importBoundaryOf`: when a view is attached before import, `importBoundaryOf(backing)` is false but `requiresCopyOnWrite(backing)` is true because import still marks it shared. The general predicate also covers extraction and leases.

#### 3. Guard the operation

Both fast paths must refuse physical growth when a copy-on-write walk is preserving the raw Array:

| Site | Refuse when |
| --- | --- |
| [`tryArrayViewAssignment`](../src/mutations.js#L236-L258) | `Array.isArray(array) && mustPreserveValue(array, attachmentRoot)` |
| [`tryAppendArrayView`](../src/array-methods.js#L599-L612) | `Array.isArray(thisValue) && mustPreserveValue` |

The assignment path then reaches its existing parent-copy logic. The method path reaches `createMutationRemap` and produces an independent receiver.

For `run`, pass the already computed `mustPreserveValue` through `invokeArrayMutationMethod` to the selected view function. Only append inspects it after Phase 0; `pop` and `shift` change bounds without writing the backing. This is per-operation context, not persistent state or method metadata.

The `Array.isArray` test is load-bearing. A retained raw Array must refuse growth, while a published `ArrayView` has fixed bounds and may derive a longer view when its backing itself is not shared or leased. Using `sourceSurvives` would incorrectly reject this safe case because it also includes `requiresArrayMaterialization`.

Keep the dependency direction: the backing guard belongs in `array-view.js`; operation context stays in `mutations.js` and `run.js`. `array-view.js` must not import the mutation helper.

### Part B: Select opaque receivers by extent

Array attachment is not itself a reason to materialize an opaque receiver. For a raw Array with an attached projection, pass the exact raw Array when that projection spans its complete physical backing—after Phase 0, `_start === 0 && _end === backing.length`. Materialize when the extent differs or the value is itself a published `ArrayView`.

State this as an extent test, not “the raw Array equals the logical value.” Imported Promise overlays deliberately differ from their physical slots while still requiring the raw receiver. Mutation keeps its conservative presence-based materialization test because an indexed write must preserve any sibling view.

Verify both sides: a discarded `slice` must not change the exact receiver of a later opaque call, while a bounds-only shrink must materialize because the attachment no longer spans the backing. Also cover settled Promise properties, holes, and a backing grown past the attachment.

### Verification

- Cover cases 0–3 above as integration tests. For cases 2 and 3, assert both the raw child and the extracted ancestor remain unchanged.
- For case 1, assert the escaped backing remains unchanged and `export` of the mutated Chain equals the pushed Array. `lookupPath` returns and shares the exact logical identity; it is not export. An internal `ArrayView` may serialize as `{}` because its representation fields are non-enumerable, while language operations and `export` still see its logical Array.
- Keep a direct shared Array + `push` regression. `pop`, root `lookupPath`, then `push` is one construction; the lookup is the extraction that creates the second owner. Without it, `pop` then `push` correctly mutates a sole-owned native Array.
- Keep the already-correct shared-ancestor + unmarked, unattached child case. It must continue through ordinary parent COW rather than the view fast path.
- Prove the guards are not over-conservative: a retained published `ArrayView` may still extend at the endpoint when its backing is neither shared nor leased.
- Test slice-before-import and import-before-slice; imported storage must never change.
- `concat` preserves receiver storage and matches native identity, holes, and elements.
- The opaque receiver is the original raw Array when its attachment spans the backing, including non-enumerable and Symbol state; otherwise materialization preserves logical length, elements, and holes.
- `slice`, `pop`, `shift`, and `push` retain view reuse where ownership permits.

### Documents to update

Update [`array-view.md`](array-view.md) to state:

- attachment requires a runtime-owned, non-imported backing, but not sole ownership;
- observations never physically extend their receiver, so `concat` uses its remap;
- mutating growth requires both the backing guard and the operation guard; and
- opaque methods receive the raw Array exactly when the attachment spans its backing. Export still always materializes the logical surface.

---

## Phase 2: Keep ownership facts at identity scope

Status: 2a ready; 2b requires a complete ownership-transition design.

### Phase 2a: Ref indexing must not create sharing

[`indexComponent`](../src/refcounts.js#L155-L161) calls `markShared(child)` when placing a cycle cut. A cut is bookkeeping, while sharing is ownership; a lazy Error query can therefore make a later exclusive mutation copy.

Delete that call. `setCycleCut` alone keeps the reverse-parent projection acyclic, so counter behavior and cut placement do not change.

Verify that a cyclic exclusive graph mutates identically with and without a preceding `hasError`, and that a diamond remains exclusive; genuinely shared or imported graphs still copy. A completed, non-owning observation may leave bookkeeping but must not change later mutation behavior. `lookupPath` extraction and pending receiver leases are intentionally excluded from that statement.

### Phase 2b: Replace metadata inference with an ownership model

[`walkImported`](../src/import-preparation.js#L29-L32) treats any identity with metadata as a runtime-owned island. Mirrors, refcounts, sharing, ArrayView attachment, and leases all create metadata, so subsystem order currently decides ownership. `runtimeScanned` and `metadataBeforeRuntimeScan` then try to reconstruct the lost distinction.

Do not add an independent `runtimeOwned` Boolean beside `importBoundary`; that admits a meaningless fourth combination. Model one exclusive identity state:

```text
unclassified | runtime-owned | imported(importBoundary)
```

`shared` and `readEnterCount` remain orthogonal. Entering `imported` must atomically mark the identity shared.

The imported walk must distinguish:

| Identity reached by import | Transition |
| --- | --- |
| explicitly runtime-owned | remain runtime-owned and become shared; import borrows the existing runtime world |
| unclassified but scanned through a runtime-owned island | remain unclassified; scanning is not ownership, so a later direct imported path may still claim it |

The unresolved contract is: **what event establishes that an unclassified identity is runtime-owned?** Resolve every source of identity before implementation:

- `new Chain(unmarkedValue)`;
- runtime Array method results;
- remap and materialization results;
- runtime-owned Promise settlement results;
- containers created by mutation;
- importing an identity already marked runtime-owned; and
- an identity first scanned through a runtime island and later reached directly by import.

Only then decide whether `metadataBeforeRuntimeScan` disappears. Preserve the import work bound: each previously known identity reached by one import may be rescanned at most once.

Verification must cover each transition, import isolation, runtime-owned islands, direct aliases, rescan-once, and Promise-placement discovery. Update [`cycles-as-data.md`](cycles-as-data.md) to state that indexing writes no ownership, and [`import-preparation.md`](import-preparation.md) with the final classification model.

---

## Phase 3: Make property-shape failures uniformly fatal

Status: 3a ready; 3b depends on the Phase 4a decision.

### Phase 3a: Remove error reclassification

[`propertyShapeError`](../src/language-properties.js#L43-L51) records thrown errors so [`applyRemapToArray`](../src/array-remap.js#L147-L150) can catch and return them as data. The same non-writable property is therefore fatal through `assignPath` and a language Error through Array replay.

Delete `propertyShapeErrors`, `isPropertyShapeError`, and the `try`/`catch` in `applyRemapToArray`. Descriptor and representation failures are kernel failures; value failures remain data:

| `commitArrayLength` condition | Class | Reason |
| --- | --- | --- |
| `Invalid array length` | data | a conformant runtime-owned Array can receive an invalid value |
| `Array length is read-only` | fatal | requires external descriptor state that was not imported |
| `Cannot delete an Array element while setting length` | fatal | same: a non-configurable external element |
| `Cannot grow this ArrayView in place` | fatal | internal representation invariant; conformant paths materialize first |

`ArrayView.set("length", …)` already reports the same failed growth invariant fatally. Phase 1 makes `canGrowEnd` stricter, but `transformArrayLength` consults that predicate before `commitArrayLength`, so newly refused views still materialize first.

Also fix [`assertCanPublishPromiseProperty`](../src/language-properties.js#L120-L133) to derive error context from the parent whose property shape failed, not from the value.

Keep hostile-descriptor tests on non-imported data: imported mutation copies into ordinary writable storage and cannot exercise the partial failure. Change these expectations from returned Error to fatal while preserving assertions about completed partial state:

- [`run.test.js:774-797`](../test/run.test.js#L774-L797): partial `fill` and refcount accounting;
- [`path-operations.test.js:452-479`](../test/path-operations.test.js#L452-L479): partial Array length semantics.

Add separate imported frozen/locked cases that verify successful COW, unchanged originals, and refcount accounting. The existing imported Promise-accessor case ([`import.test.js:1142-1165`](../test/import.test.js#L1142-L1165)) and descriptor-swap fixture ([`promise-property-fatal.js`](../test/fixtures/promise-property-fatal.js)) remain fatal with unchanged messages.

### Phase 3b: Strict metadata-mode agreement, only if Phase 4a is rejected

Today `lookupPath` on a frozen, never-imported object fatals in inline mode when metadata cannot be defined, but succeeds in WeakMap mode. Metadata layout is an implementation choice, so this divergence must disappear.

Phase 4a resolves it on the permissive side by deleting inline storage. If Phase 4a is rejected, make `ensureMeta` explicitly reject a non-extensible, non-imported identity in both modes with the diagnostic that the external data was never imported. Keep this as a separate commit from 3a.

### Verification

- All callers classify the same property-shape condition identically.
- Partial replay state remains correctly accounted after a fatal.
- Imported frozen and locked sources copy successfully and remain unchanged.
- Existing unsupported Promise descriptor shapes remain fatal.
- If 3b lands, the frozen non-imported case fails identically in both metadata modes with the import diagnostic.

---

## Phase 4: Simplify metadata lookup and storage

Status: attempt after Phases 1–3; benchmark before keeping.

### Phase 4a: Use one WeakMap

Implement the complete single-WeakMap design, benchmark representative property-walk paths against the current implementation, and keep it unless a material regression justifies inline metadata.

With one `META_MAP`:

- `metaOf` becomes `META_MAP.get(value)`; `WeakMap#get` already returns `undefined` for unsupported keys;
- remove `CASCADA_META_STORAGE`, the metadata Symbol, storage branches, `STORE_META_IN_WEAKMAP`, and its plumbing in `test/support.js`, `import.test.js`, and `refcounts.test.js`;
- remove `inline-mode.js`, `weakmap-mode.js`, their package scripts, and mode-specific assertions;
- remove import-time metadata migration and the obsolete `imported` parameter of `ensureMeta`; and
- remove storage-location semantics from [`import-preparation.md`](import-preparation.md) and [`runtime-spec.md`](runtime-spec.md), and remove the two-mode requirement from [`enter.md`](enter.md), [`run.md`](run.md), [`plan.md`](plan.md), and [`work-bounds-plan.md`](work-bounds-plan.md).

This chooses these semantics explicitly:

- metadata follows an identity across prototype changes;
- metadata lookup and storage do not reflect on the value; metadata creation still validates through `isTracked` and may trigger Proxy reflection; and
- the frozen non-imported case becomes readable, giving up its accidental eager import diagnostic. It may still fail on a later write.

Verify the complete suite in the single mode, `verify-refcounts`, a frozen non-imported read, and an identity whose prototype changes after receiving metadata.

### Phase 4b: Fallback if one WeakMap is materially slower

If both storage modes remain, first evaluate replacing `metaOf`'s `isTracked` classification with an object guard before the inline and WeakMap lookups. Decide and test the observable consequences rather than inheriting them:

- Proxy lookup traps change from `getPrototypeOf` to the storage operations; and
- metadata would continue to follow an identity after its prototype becomes untracked.

Confirm primitives, `null`, Promises, and Errors still return `undefined`. Use a prototype-classification memo only if the guarded lookup cannot preserve the chosen semantics and a benchmark demonstrates material benefit. Before such a memo, add a test for registering a data class after one of its instances was first classified so negative cache entries cannot go stale.

If 4a is rejected, land Phase 3b before evaluating this fallback.

---

## Phase 5: Reject Array mutators dispatched as observations

Status: ready; land before Phase 1 Part A.

JavaScript has no out-of-place `push`; today the same method returns a length with `mutateArray: true` and an Array with `false`. A logical-Array mutator dispatched with `mutateArray: false` must return a validation Error.

Check only after the receiver resolves as a logical Array in [`invokeSelectedMethod`](../src/run.js#L84-L108). A name-based check at the `run` entry would incorrectly reject an opaque non-Array method named `push`.

Then delete the unreachable mutator branch from [`invokeArrayObservationMethod`](../src/array-invocation.js#L56-L89). Mutation still uses mutator view functions; Phase 1 later deletes the remaining observation view branch with `concat`'s view.

Verify Array mutators are rejected in observation mode, non-mutating Array methods still work, and a registered non-Array data class with a `push` method still dispatches opaquely. Update [`run.md`](run.md) by removing the observation-mutator dispatch row and its no-op semantics.

---

## Implementation order

Land small, independently evaluable checkpoints:

1. **Phase 0** — delete prepend-in-place and `baseIndex`.
2. **Phase 5** — reject observation mutators and remove their observation-only dispatch.
3. **Phase 1 Part A** — remove observation growth and protect mutation growth.
4. **Phase 2a** — stop ref indexing from creating sharing.
5. **Phase 1 Part B** — select opaque receivers by attachment extent.
6. **Phase 3a** — make property-shape failures uniformly fatal.
7. **Phase 2b** — only after its ownership transitions are resolved and reviewed.
8. **Phase 4a** — implement completely and benchmark. Keep it, or revert it, land Phase 3b, and evaluate Phase 4b.

Phase 0 is a simplification, not a dependency: if it is rejected, Phase 1 must apply both growth guards to prepend as well as append. Phase 1 closes imported-backing corruption independently of Phase 2b. Phase 3b and Phase 4a are mutually exclusive answers to the metadata-mode divergence.
