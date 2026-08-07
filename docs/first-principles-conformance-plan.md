# First-Principles Conformance Plan

## Purpose

Eight defects found by evaluating `src` against `AGENTS.md`. Six produce wrong observable results (1a–1d, 2a, 3), one derives a fact from the wrong evidence (2b), one is an optimization (4).

Phases remain here after completion; update status and final design rather than removing them.

## Method

Implement phases in order and evaluate each independently. After every code phase:

- run the complete suite with inline and WeakMap metadata;
- reproduce each recorded failing case and confirm it now conforms;
- run `test/verify-refcounts.js` as the ref-index consistency oracle; and
- keep only changes whose conformance gain justifies their complexity.

Prefer integration tests through public operations. Behavioral tests must not pin mirror fields, helper boundaries, cycle-cut placement, or exact counter totals. Where a phase deletes a mechanism, delete it in the same change rather than leaving it unreachable.

## Baseline

Commit `3d5a47a`, 2026-08-06. 648 tests pass in each metadata mode. Every defect below reproduces against that green baseline, so the suite covers none of them.

## Copy triggers

`AGENTS.md` names three grounds for copying, and the source has one predicate for each. All three are legitimate; do not attempt to eliminate or merge any of them.

| Ground | Predicate | Granularity |
| --- | --- | --- |
| it is shared | `meta.shared` | identity, permanent |
| it is leased | `meta.readEnterCount` | identity, released on completion |
| it would otherwise change shared storage | `requiresArrayMaterialization` | element range |

[`requiresCopyOnWrite`](../src/meta.js#L54-L58) is the single predicate over the first two. `attachmentRoot !== undefined` at [mutations.js:42-45](../src/mutations.js#L42-L45) is not a fourth trigger — it means the walk is already copying this path.

The third ground is load-bearing, not a rogue trigger. An `ArrayView` and its backing share physical storage, so three isolation invariants hold today *because* of it:

| Sequence | Result | Preserved by |
| --- | --- | --- |
| `slice`, then write the source in place | view unchanged | source materializes instead of writing |
| `slice`, then `unshift` the source | view unchanged | one shared `_storage`; `baseIndex` absorbs the shift |
| two views, then `unshift` | both unchanged | the same single `_storage` record |

---

## Phase 1: Bring `ArrayView` under the ownership classification

Status: Parts A, B, and C ready to implement.

`ArrayView` is a second representation of "an Array value" sitting beside copy-on-write ownership instead of inside it. It consults `importBoundaryOf` and nothing else, so it is blind to `shared` and to leases.

### Defect 1a: growth mutates a backing Array another owner holds

[`tryAttachTo`](../src/array-view.js#L28-L40) rejects only imported backings. Growth then writes the backing: [`#prepend`](../src/array-view.js#L193-L202) calls `unshift.apply(storage.array, values)`; [`#extendEnd`](../src/array-view.js#L204-L209) and [`setLength`](../src/array-view.js#L211-L219) do `storage.array.length += …`.

The view path is reached before ownership is honoured in both entry points: [`invokeArrayMutationMethod`](../src/array-invocation.js#L99-L111) tries `definition.view` before acting on `sourceSurvives`, and [`tryArrayViewAssignment`](../src/mutations.js#L236-L258) runs before `mustCopyParent` at [mutations.js:407-411](../src/mutations.js#L407-L411).

```js
const pending = run(chain, ["list"], "slowRead", false)  // captured this === list, [1,2,3]
run(chain, ["list"], "push", true, 99)                   // captured receiver -> [1,2,3,99]

const extracted = lookupPath(chain, ["list"])            // second owner -> markShared
run(chain, ["list"], "push", true, 99)                   // extracted -> [1,2,3,99]
run(chain, ["list"], "unshift", true, 0)                 // extracted -> [0,1,2,3]
assignPath(chain, ["list", "5"], 9)                      // extracted -> [1,2,3,,,9]
```

The logical value diverges correctly, so Cascada's own reads look right and the suite passes. Only the raw Array identity is corrupted — the one the host and captured receivers hold. Violates *"Mutation never changes a shared node in place"*, *"Extracting an existing tracked identity adds another owner and makes it shared"*, and *"If invocation is pending, later Cascada mutation must preserve the captured receiver."*

The lease was taken in the first case — `requiresCopyOnWrite(list)` was true and `sourceSurvives` was true — and the ArrayView path bypassed it anyway.

### Defect 1b: the opaque receiver changes after a read-only `slice`

[`deriveArrayView`](../src/array-methods.js#L577-L591) calls `tryAttachTo`, which writes `meta.arrayView` on the source. [`projectionOf`](../src/array-view.js#L251-L254) then reports the Array as view-backed forever, so [`requiresArrayMaterialization`](../src/array-view.js#L267-L269) is permanently true and [`invokeOrdinaryMethod`](../src/run.js#L166-L175) hands the method a materialized copy.

```js
const prices = [10, 20, 30]
Object.defineProperty(prices, "currency", { value: "EUR", enumerable: false })
Object.defineProperty(prices, "total", {
    value: function () { return `${this.reduce((a, b) => a + b, 0)} ${this.currency}` },
    enumerable: false,
})

run(chain, ["prices"], "total", false)        // "60 EUR"
run(chain, ["prices"], "slice", false, 0, 2)  // read-only, result discarded
run(chain, ["prices"], "total", false)        // "60 undefined"
```

Materialization rebuilds from own enumerable indexes, so non-enumerable and Symbol state is dropped. It fails silently — `reduce` still works, because the copy is a real Array. `AGENTS.md` lists exact opaque receivers among the fixed observable contracts.

The attachment itself is correct and stays: it pins the original's bounds and gives every view over one Array a single storage record. The defect is one *consumer* asking whether an attachment exists when the question is whether the raw Array still equals the logical value.

### Defect 1c: a view attached before import lets the runtime modify imported data

```js
const list = [1, 2, 3]
const chain = new Chain({ list })
run(chain, ["list"], "slice", false, 0, 2)   // attaches a view while runtime-owned
runtime.import(root, "late import")
run(chain, ["list"], "push", true, 99)
assignPath(chain, ["list", "5"], 7)
// list is now [1,2,3,99,,7] — imported data physically modified
```

1b and 2b compose: the attachment gives the Array metadata, [`walkImported`](../src/import-preparation.js#L29-L32) reads that as a pre-existing runtime-owned island and never marks it imported, and `tryAttachTo` — checking only `importBoundaryOf` — proceeds. `markShared` *is* called, which is why Part A closes this independently of Phase 2. Importing before the slice behaves correctly; only the ordering exposes it.

### Defect 1d: an observation physically grows the source

```
run(chain, ["list"], "concat", false, [4, 5])
  source logical : [1,2,3]        source PHYSICAL: [1,2,3,4,5]     JS leaves it at [1,2,3]

run(chain, ["list"], "push", false, 4)
  returns an ArrayView            JS returns the new length, 4
  source PHYSICAL: [1,2,3,4]      an explicitly non-mutating call, mutating
```

[`invokeArrayObservationMethod`](../src/array-invocation.js#L56-L89) tries `definition.view` first, and for `concat` and `push` those extend the backing in place.

`concat`'s growth is legitimate — the attachment pins the source's bounds and the storage is reused. What must not follow is a raw reader seeing the extra elements (Part A) or a permanently materialized receiver (Part B). `push` with `mutateArray: false` is a separate matter: Part C.

### Design

Two `AGENTS.md` rules govern this phase; every correction is a consequence, not a rule of its own.

1. Runtime methods reproduce native JavaScript behaviour; a difference *is* the defect.
2. Use a view of the original whenever possible — mutating in place, mutating as a copy, and observing are the same case.

"Possible" is decided by endpoints and ownership:

- **any contiguous subrange** is a view; no physical write, no further condition.
- **extending** requires the new endpoint to coincide with the storage endpoint — append needs the view's end to be the physical end, prepend its start to be the physical start — plus a writable, extensible backing. A write past the end is an append: the storage extends, the original stays pinned, and the extended view becomes the new value. That view *is* the copy-on-write copy.
- **any physical write to the backing** additionally requires it to be neither shared nor leased. Imported Arrays are therefore never backing, since imported data is always shared.

The third condition is the one the source is missing, and every defect here follows from its absence.

#### Part A — growth honours ownership (closes 1a, 1c, and the raw-reader half of 1d)

Guard [`canGrowEnd`](../src/array-view.js#L42-L52) and [`#canPrepend`](../src/array-view.js#L66-L106) with [`requiresCopyOnWrite`](../src/meta.js#L54-L58) on the backing. A shared or leased backing refuses growth and the caller falls through to the existing remap path, which already produces an independent Array.

Key it on that predicate, not on import status — do not merely strengthen `tryAttachTo`'s `importBoundaryOf` check. On the 1c graph they disagree exactly where the breach occurs:

| Array state | `importBoundaryOf` | `requiresCopyOnWrite` |
| --- | --- | --- |
| view attached, then imported | **false** | **true** |
| imported before any view | true | true |

`markShared` runs even on the mis-classified path, so the general predicate is strictly stronger. It also covers extraction (`shared`) and a pending receiver (`leased`, never `shared`), and subsumes the import case because imported data is always shared.

The guard applies exactly where the backing is physically written. A derivation that writes nothing needs no guard, whether it narrows or expands.

#### Part B — the opaque receiver asks about extent (closes 1b)

`isArrayView(projectionOf(value))` detects only that an attachment exists, and an attachment is ordinary. The receiver needs to know whether the raw Array still equals the logical value: `_start + baseIndex === 0 && _end + baseIndex === backing.length`. If so, pass the raw Array; otherwise, or if the value is itself a published `ArrayView`, materialize.

After a `slice` the attachment spans the whole backing, so 1b's `total()` returns `60 EUR`. After a `concat` has grown the backing it does not, so materialization happens and is genuinely required.

Mutation keeps its presence-based test: an indexed write must not surface through a sibling view, and whether one exists is unknowable.

Validate where physical and logical diverge for other reasons: settled Promise properties, holes, and a backing grown past the attachment.

#### Part C — reject a mutator called with `mutateArray: false` (closes the rest of 1d)

One condition beside the existing check for the opposite direction. JavaScript has no out-of-place `push` — it supplies `toSorted`, `toReversed`, `toSpliced`, and `with` where it wants functional forms. Today `push` returns `4` under `mutateArray: true` and an Array under `false`, for the same name.

This reverses documented design: [`docs/run.md`](run.md) specifies the out-of-place form in its dispatch table and again as *"An intercepted mutator run as an observation returns a distinct post-mutation logical Array even for a no-op."* Both go in the same change, under rule 1.

#### Rules considered and rejected

- *"An observation may only derive narrowing views."* Growth is invisible unless the backing is shared or leased, which Part A already tests.
- *"A derivation marks the source shared and does not attach."* Removing the attachment breaks coordination: a `slice` would take its own `_storage` record and a later prepend on the source would corrupt it.
- *"The growth-view mechanism collapses entirely."* It does not. `concat`, `push`, and `unshift` keep in-place storage reuse whenever the backing is neither shared nor leased.

### Verification

- The pending-receiver, extracted-array, `unshift`, and past-length cases leave the original Array physically unchanged.
- 1c: slicing then importing leaves the backing unchanged under every later mutation. Test both orderings.
- 1d: `concat` leaves a shared or leased backing unchanged, and reuses it otherwise.
- Part B: an opaque receiver is the raw Array when the attachment spans the backing. Test with non-enumerable and Symbol state, which materialization drops.
- Part C: every mutator with `mutateArray: false` returns a validation Error; every non-mutator still works in that form.
- Views still derive for exclusively owned backings, so `slice`/`pop`/`shift`/`push`/`concat`/`unshift` keep their storage reuse where ownership permits.
- Materialization still preserves the logical value exactly — length, elements, holes. Part B changes only *when* it happens.
- The complete suite passes in both metadata modes; `verify-refcounts` passes.

### Documents to update

[`docs/array-view.md`](array-view.md) lines 3, 21, 49, 59: restate the derivation guard as ownership — neither shared nor leased — rather than "not imported", and note that the bound hides growth only from readers reaching the Array through Cascada. The attachment description stays.

[`docs/run.md`](run.md): remove the `false` + "Logical Array mutator" dispatch row and the no-op sentence.

---

## Phase 2: Keep ownership facts at their own scope

Status: 2a ready; 2b needs a field design.

An ownership fact is produced as a byproduct of another subsystem's bookkeeping instead of being stored at the scope that describes it.

### Defect 2a: ref indexing writes an ownership fact

[`indexComponent`](../src/refcounts.js#L155-L161) calls `markShared(child)` when it places a cycle cut. Cuts are bookkeeping; `shared` is ownership. Since indexes are built lazily by Error queries, a pure observation changes a later mutation:

```js
const root = { a: 1 }; root.self = root
assignPath(new Chain(root), ["a"], 2)
// in place: root.a === 2, state.self === state

const root2 = { a: 1 }; root2.self = root2
const c = new Chain(root2)
hasError(c, [])                    // finds nothing; only builds the ref index
assignPath(c, ["a"], 2)
// copied: root2.a === 1, state.self === root2
```

`root` was exclusively owned in both runs, so in-place is correct in both and the fork is fabricated. This violates the sequential-results contract, *"A cut affects bookkeeping only"*, and — now explicitly — *"Graph shape … is never a reason to copy, and never makes a node shared or leased."*

Three facts support removing the call rather than reinterpreting it:

- `markShared` is separable. `setCycleCut` alone keeps the reverse-parent graph acyclic; no counter maintenance needs the child shared.
- [`docs/cycles-as-data.md`](cycles-as-data.md) documents cuts in detail and never mentions `markShared`.
- Keeping it is not even conservative. After the first fork the copy is no longer cyclic, so the indexer never marks it again and later writes mutate in place — a one-shot artifact, not a semantic.

The diamond `{ a: o, b: o }` mutates in place with or without `hasError`, and agrees with the same rule once indexing stops interfering.

### Defect 2b: import infers ownership from metadata existence

[`walkImported`](../src/import-preparation.js#L29-L32) decides whether an identity is a pre-existing runtime-owned island with `metaOf(value) !== undefined`, then needs `runtimeScanned` and `metadataBeforeRuntimeScan` to reconstruct that answer after its own walk destroys it ([import-preparation.js:52-58](../src/import-preparation.js#L52-L58)).

The fact wanted is *"this identity is runtime-owned"*. What is tested is *"some subsystem has touched it"* — a mirror, a refcounter, a `shared` mark, an `arrayView`, or a lease all create metadata. Which subsystem arrived first therefore decides whether an imported graph borrows or claims the identity. This is the second half of Defect 1c.

### Design

1. Record ownership on the identity when it is established — at import, at copy-on-write creation, at extraction, at lease acquisition — not by a later walk that was counting something else.
2. `indexComponent` drops the `markShared` call. Cut placement is unchanged, so the projection stays acyclic and no counter behaviour moves.
3. `walkImported`/`walkRuntime` classify on the explicit state, removing `metadataBeforeRuntimeScan` and letting the two traversals converge.

Keep the import rescan bound: *"Import may … rescan each previously known identity it reaches at most once per import."*

### Verification

- The `hasError`-then-`assignPath` case, the no-query case, and the diamond all mutate in place.
- No observation changes any later mutation result: run each public observation before an identical mutation and compare.
- The same graphs, once shared or imported, still fork, and each fork reuses off-path children unchanged.
- Import isolation, runtime-owned islands, rescan-once, and Promise-placement discovery are unchanged.
- `verify-refcounts` passes; no new test pins counter totals.

### Documents to update

[`docs/cycles-as-data.md`](cycles-as-data.md): state that indexing writes no ownership. [`docs/import-preparation.md`](import-preparation.md): the classification change.

---

## Phase 3: Make property-shape rejection uniformly fatal

Status: ready.

### Defect

[`propertyShapeError`](../src/language-properties.js#L43-L51) registers thrown errors in a `WeakSet` whose only consumer is [`applyRemapToArray`](../src/array-remap.js#L147-L150), which catches them and returns them as data. The same condition therefore has two classes depending on the caller:

```
assignPath(chain, ["1"], 9)        -> THREW (fatal): Cannot assign to non-writable property
run(chain, [], "fill", true, 7)    -> returned Error(Cannot assign to non-writable property)
```

The split also appears within one condition: "Array length is read-only" is returned as data by [`commitArrayLength`](../src/property-versions.js#L261-L265), while "Cannot grow an Array with a read-only length" is thrown by [`assertCanCreateLanguageProperty`](../src/language-properties.js#L79-L93).

### Conformant data never reaches these errors

`AGENTS.md`: *"Cascada never creates non-extensible language data. It can only enter through import"*, and imported data is always shared, so a mutation forks it. Verified:

| Input | Not imported | Imported |
| --- | --- | --- |
| `freeze({retries: 3})`, assign `retries` | fatal | forks; `{retries: 5}`; original untouched |
| non-writable index, `run fill` | Error, array half-filled | forks; `[7,7,7,7]`; original `[0,1,2,3]` |
| non-writable index, `assignPath` | fatal | forks; `[0,9,2,3]` |
| non-writable `length`, assign past end | fatal | forks; `[1,2,5]`; original `[1,2]` |

`lookupPath` on a non-imported frozen object fails with `"Cannot define property Symbol(META), object is not extensible"`, because inline metadata needs an extensible target; imported identities use the `WeakMap`, which is why imported frozen data works.

Every remaining firing is therefore non-conformant input, or a shape Cascada cannot support even when imported — an accessor holding a Promise ([`test/import.test.js:1142-1165`](../test/import.test.js#L1142-L1165)) or a descriptor swapped under a pending version ([`test/fixtures/promise-property-fatal.js`](../test/fixtures/promise-property-fatal.js)). Both are contract violations and both are already fatal.

### Design

Delete the reclassification: `propertyShapeErrors`, `isPropertyShapeError`, and the `try`/`catch` in `applyRemapToArray`. These conditions become uniformly fatal, matching *"Never convert a kernel failure into a language Error."*

Improve the diagnostic, which is the part a user feels: `"Cannot assign to non-writable property"` and the `Symbol(META)` message both mean *"this external data was never imported."* `ensureMeta` can say so when it finds a non-extensible, non-imported target — a message change at an existing failure point, no traversal, no new state.

`commitArrayLength`'s validation errors stay data: they are reachable on runtime-owned Arrays through ordinary length assignment and are genuine data conditions.

Also fix [`assertCanPublishPromiseProperty`](../src/language-properties.js#L120-L133), which derives its error context from the *value* rather than from the parent whose shape failed.

### Verification

- In-place Array replay reports the same class as every other caller for the same condition.
- The four imported rows above continue to fork and mutate successfully.
- [`test/fixtures/promise-property-fatal.js`](../test/fixtures/promise-property-fatal.js) and [`test/import.test.js:1142`](../test/import.test.js#L1142-L1165) report unchanged fatals with unchanged messages.

### Tests that change

[`test/run.test.js:774-797`](../test/run.test.js#L774-L797) asserts a *returned* Error from in-place `fill` on a non-imported locked Array; it becomes a fatal. Its refcount-consistency assertion is the valuable part — rebuild the case on imported data, where the fork path exercises the same accounting without a contract violation.

---

## Phase 4: Memoize language-value classification

Status: ready. No semantics change. Land last, so measurements reflect Phases 1 and 2.

[`readLanguageProperty`](../src/language-properties.js#L201-L214) calls `metaOf` on every property read; [`metaOf`](../src/meta.js#L9-L15) begins with [`isTracked`](../src/language-values.js#L19-L33), which for any prototype other than `Object.prototype` runs [`isPlainObjectPrototype`](../src/language-values.js#L35-L47) — two `getOwnPropertyDescriptor` allocations per read. Every walk pays this per key: `indexComponent`, `copyForWrite`, `raw-walk`, the fenced error walk, `containsPromise`.

Classification is a pure function of the prototype, and prototypes are stable: memoize in a `WeakMap<prototype, boolean>` inside `isTracked`. `DATA_CLASS_PROTOTYPES` is already that shape. The one dynamic input is `registerDataClass`, which may add a prototype at any time — the memo must admit newly registered prototypes rather than cache a stale negative.

Verify with `test/data-classes.test.js` unchanged, including registration after first use of an instance, and with cross-realm and null-prototype classification unchanged.

---

## Completed: `AGENTS.md` changes

Documentation only, already landed, no code change. Recorded so the reasoning is not rediscovered.

- **Copy-on-Write** gained the copy trigger as its leading bullet, stating the reason and enumerating three grounds as sub-bullets, with graph shape prohibited in its own bullet. The old `root.self === root` example read as a copy *trigger* rather than as the shape of a copy, and produced a false dilemma during this review; the example is now `root.back = root`, which shows value semantics falling out of forking. The third ground names `ArrayView` deliberately — "storage shared with another value" otherwise has no referent — and is keyed on whether the operation *would change* shared storage, because "its storage is spanned by a view" would forbid appends that are provably safe.
- **Ownership** gained *"Imported data is always shared"*, the lease definition, and the in-place condition restated as neither shared nor leased.
- **Language Graph**: non-extensible data changed from an assertion to an obligation — *"It can only enter through import."*
- **Runtime and Opaque Methods**, renamed from *Opaque Host Methods*: runtime methods reproduce native JavaScript behaviour; they take and return Cascada values without export or import and convert only what a delegated native operation consumes; they avoid copying and materialization wherever possible, without chasing rare cases; opaque methods have their arguments exported and their tracked result imported, but **not** their receiver.

The receiver asymmetry is the least obvious rule here and had to be measured. It is forced: an argument is a value and can be copied settled, while a receiver copied is no longer the receiver — export drops the prototype and its methods.

---

## Deliberately not candidates

- **`containsPromise`** ([mutations.js:24-40](../src/mutations.js#L24-L40)) and the separate resolution helpers — evaluated and kept in [`first-principles-refactoring.md`](first-principles-refactoring.md) and [`work-bounds-plan.md`](work-bounds-plan.md) Phase 2.
- **`pathAccessError` poisoning an intermediate property** ([mutations.js:392-394](../src/mutations.js#L392-L394)) — intentional and pinned by [`data-classes.test.js:414-426`](../test/data-classes.test.js#L414-L426), [`chain.test.js:107-119`](../test/chain.test.js#L107-L119), [`export.test.js:437-446`](../test/export.test.js#L437-L446).
- **`Promise.all` in [`resolveOperationResultsOrFatal`](../src/resolution.js#L92-L113)** — adds ticks after settlement, but mutation ordering is carried by the gate in `transformValue`, not by tick counting.
- **Per-commit ancestor-cone walks** in `prepareRefEdge` and `propagateCountDelta` — evaluated and retained in [`work-bounds-plan.md`](work-bounds-plan.md) Phase 5.
- **Auto-importing values passed to `assignPath`.** `run` method results are imported because the runtime produced them by calling host code; a value the host supplies carries the host's import obligation.
- **Per-argument export masks for intrinsic Array methods.** `ARRAY_METHODS` already decides per method *and* per argument, and Cascada applies it, never the caller: `fill` preserves its inserted value's identity while awaiting a promised `start`; `concat` never exports argument elements; `includes` does. Do not move any part of this to the call site.
- **Exporting an opaque method's receiver**, or resolving its pending properties. An opaque method reads arbitrarily deep, so settling one level fixes `this.unitPrice` and silently leaves `this.customer.address.city` broken, while settling every level is export — which destroys the receiver. The history-dependence of what it observes is the residue of the same fact and cannot be removed either: suppressing writeback is not available, because `AGENTS.md` requires it precisely so an opaque method can observe the property. A caller needing settled data exports the path and passes it as an **argument**.
- **Registered data classes losing private or non-enumerable state across copy-on-write.** [`data-classes.md`](data-classes.md) already excludes private fields, accessors, non-enumerable and Symbol state; such a class is an invalid registration, not a runtime defect. Unregistered classes cannot be `run` receivers at all.
- **A view path for `toSpliced` or `flat`.** `toSpliced` yields `prefix ++ items ++ suffix`, a single contiguous range only when `items` is empty *and* `start === 0` or `start + deleteCount >= length` — the two cases a caller writes more naturally as `slice`, which already returns a view. `flat` compacts holes, so it is view-able only when the array is also dense. Reconsider only with evidence the shape occurs. The zero-argument cases already reuse: `concat()` and `slice()` both derive full-span views today.

---

## Phase interaction

Phases 1 and 2 both concern ownership. Phase 1 fixes ownership known but ignored; Phase 2 fixes ownership inferred from the wrong evidence. Either closes Defect 1c independently, which is the argument for doing both. Phase 1 is the higher-severity defect and does not need to wait.

Phase 3 is independent and touches a different module boundary. Phase 4 lands last.

After all phases, record outcomes here and add retained-or-reverted entries to [`first-principles-refactoring.md`](first-principles-refactoring.md), which holds the standing record of evaluated proposals.
