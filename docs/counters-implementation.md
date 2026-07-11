# Subtree counters, `normalize`, `hasError` — step-by-step implementation

Step-by-step plan for the Subtree Counters section in issues.md. The issue numbers
were later renumbered; "refcounting" throughout means **subtree promise/error counting**:
we count
pending promises and Error values reachable below each node, never references —
ownership/COW stays mark-based. Spec reference: initial-spec.md, "Subtree counters".

Current implementation note: import and validation were redesigned after the original
counter plan. The current design is lazy: `import(value, errorContext)` is mark-only
(the marker carries error attribution), and validation lives solely at counting time
as `validateCountable` — see `docs/lazy-import.md`. normalize/hasError details are
aligned with issues.md items 6 and 7: there is no ambient settling record;
verification schedules through the wrapper on `Promise.resolve()`; normalize returns synchronously when the answer is decided at issue time;
hasError uses no settlement wait and rides pending promises with per-call state.

Ground rules for the whole sequence:

- Each step ends with the full suite green (the current suite plus the new tests
  added along the way — don't hardcode counts, they go stale).
  Steps 1 and 2 are behavior-neutral refactors; counting only goes live in step 3.
- Four pillars that every piece of pseudocode below serves:
  1. **Counters have no safe default** — `parents` edges are exact or the counts lie.
  2. **Two thin refcount hooks** — `refSetProperty`/`refDeleteProperty` own all counter
     bookkeeping, while src/index.js performs the actual `node[key] =` / `delete node[key]`
     commits. Promise mirrors are deliberately not
     their concern — mirror lifecycle stays at the operation sites, as in the current
     kernel. A full-recompute variant was considered and rejected for the runtime path
     (it moves complexity rather than removing it); it survives as the test-suite
     consistency oracle (step 5). All runtime counter code lives in its own module,
     src/refcounts.js (see File layout): src/index.js only calls the hooks, and with the
     module stubbed to passthroughs the kernel is bit-for-bit the base kernel.
  3. **Acyclicity is load-bearing** — delta propagation loops forever on a cycle. All
     cycle checking lives in counting-time validation/ref-indexing (two-color for in-value cycles,
     direct target-reachability for writeback back-edges) and nowhere else: internal ops cannot
     create cycles when the compiler lowers RHS object values through shared-ownership lookup.
     `a.property = a` stores a COW copy of `a` as it existed before `property` was added.
  4. **Zero is edge-triggered and verified asynchronously** — never resolve a settlement wait
     synchronously; always re-check. The verification is scheduled through the uniform
     wrapper, never a bare `queueMicrotask` — the wrapper contract covers the runtime's
     own scheduling too. It registers on `Promise.resolve()`, not on the
     settling promise; there is no ambient settling record. See issues.md item 6
     for the ordering argument.

---

## File layout — plug & play

Layering, bottom-up, **no circular imports**. Source files live under `src/`:

- **helpers.js** — the promise wrappers (`onValueResolve`, `onInternalResolve`)
  and type predicates. It owns all `.then` usage; value continuations use
  `onValueResolve`, and internal aggregate waits use `onInternalResolve`.
- **meta.js** — the META record and accessors: shared/import markers, promise mirror
  storage, counter fields, parent edges, and optional settlement-wait fields.
- **validate.js** — pure validation helpers: mutation-key/property checks and
  `validateCountable(value, writeTarget, isRefIndexed)`. It depends only on helpers
  and meta; counting-validation failures are Error values, not thrown fatal errors.
- **promise-mirrors.js** — promise mirror storage/birth/clearing and guarded
  settlement. `index.js` injects `setProperty` and `refIndexChildValue` with
  `initPromiseMirrors(setProperty, refIndexChildValue)` so live mirrors perform a
  language write and revoked mirrors prepare their private child without an import cycle.
- **refcounts.js** — counter logic ONLY. Public runtime hooks are
  `refSetProperty(parent, key, value)`, `refDeleteProperty(parent, key)`,
  `refIndexChildValue(parent, value)`,
  `copyCounters(source, copy)`,
  `buildRefIndex(value, inheritedImportContext)`,
  and narrow test/debug accessors. The hooks never perform the language write/delete;
  `refSetProperty` returns the value index.js should write, because validation can
  turn an entering value into Error. When ref-indexing discovers a promise key, it
  calls the promise-mirrors-owned `getOrCreatePromiseMirror`.
- **verify-refcounts.js** — test-only consistency oracle. It imports the narrow
  `getRefCounter` accessor from refcounts.js and is not used by runtime code.
- **index.js** — the operations, language property writes/deletes, COW, import,
  observational context-threading `resolvePath` for lookup/normalize/hasError, `copyToPlainValue`,
  hasError's local promise wait-tree probe, and the normalize/hasError operation shells. It initializes mirror settlement with
  `initPromiseMirrors(setProperty, refIndexChildValue)`.

The contract: **non-ref-indexed behavior ≡ base-kernel behavior** — with refcounts.js
stubbed to passthroughs (no promise-mirror initialization needed), every operation behaves exactly as
today, and this is testable: the full base suite must pass against the stub.
Bookkeeping activates per-branch, purely by the presence of counter META, checked
inside the hooks at commit time.

The complete index.js diff, site by site — every pre-existing write still funnels
through the local `setProperty`/`deleteProperty` wrappers; the only new operation
surface is normalize/hasError and their shared observational resolver:

| site | today | after |
|---|---|---|
| `assignPath` onTarget (plain) | `clearPromiseMirror; parent[key]=v; updateCleanCounts` | `clearPromiseMirror; value = refSetProperty(...); parent[key]=value` |
| `assignPath` onTarget (promise) | mirror + writeback registration + bare write + stub | same mirror code + `refSetProperty`, then write in index.js |
| `deletePath` onTarget | `clearPromiseMirror; delete parent[key]; updateCleanCounts` | `clearPromiseMirror; refDeleteProperty(...); delete parent[key]` |
| promise-mirror writeback | `node[key] = value; propagateClean` | if live: `value = refSetProperty(...); node[key]=value`; if revoked: `value = refIndexChildValue(...)`; always store `mirror.currentValue` |
| walk installs (sync + suspended) | bare write (+ clear) | `refSetProperty`, then write in index.js |
| `shallowCopy` | — | `copyCounters(obj, copy)` before `return copy` |
| `import` | — | mark-only `import(value, errorContext)`; no walk, no validation |
| lookup/normalize/hasError resolver | — | observational, context-threading path walk |
| exports | — | `+ normalize, hasError` |
| startup | — | `initPromiseMirrors(setProperty, refIndexChildValue)` |

One consistency rule inside index.js: every promise continuation goes through
`onValueResolve` or `onInternalResolve`, never bare `.then(...)`. Greppable:
`.then(` appears only inside helpers.js and test code.

---

## Step 1 — Unify metadata under one `META` Symbol (behavior-neutral)

Fold `PROMISE_MIRRORS` and `SHARED` (index.js:37–38) into a single record, housed
in the new tiny **meta.js** (see File layout) so index.js and refcounts.js both reach
it without importing each other. Also fold in basics item 1 here (non-extensible ⇒
shared for COW), since `hasSharedMark` is being rewritten anyway.

```js
const META = Symbol("META")
const hasOwn = Object.prototype.hasOwnProperty

function createMeta() {
    return {
        shared: false,   // set once, never cleared; false at birth = old "no mark"
        mirrors: null,      // lazy Object.create(null) — the promise mirror map
        promiseCount: 0,
        errorCount: 0,
        settlementPromise: undefined,
        settlementResolve: undefined,
        settlementVerifyScheduled: false,
        // parents is added by buildRefIndex when counters become live:
        // undefined => not ref-indexed; empty Map => ref-indexed root / no ref-indexed parents.
    }
}

function metaOf(node) {                    // read-only peek, never creates
    if (!isTracked(node)) return undefined
    if (STORE_META_IN_WEAKMAP) return META_MAP.get(node)
    if (!Object.isExtensible(node)) return undefined
    return hasOwn.call(node, META) ? node[META] : undefined
}

function ensureMeta(node) {                // inline mode requires extensible; WeakMap mode does not
    if (!isTracked(node) || (!STORE_META_IN_WEAKMAP && !Object.isExtensible(node))) {
        reportFatalError(new TypeError("Cannot attach metadata to this value"))
    }
    let meta = metaOf(node)
    if (meta === undefined) {
        meta = createMeta()
        if (STORE_META_IN_WEAKMAP) {
            META_MAP.set(node, meta)
        } else {
            Object.defineProperty(node, META, {
                value: meta, enumerable: false, writable: true, configurable: true,
            })
        }
    }
    return meta
}
```

Rewritten accessors — same observable behavior as today:

```js
function hasSharedMark(value) {
    return isTracked(value) &&
        (metaOf(value)?.shared === true || !Object.isExtensible(value))
}

function markShared(value) {
    if (isPromise(value)) return onValueResolve(value, markShared)
    if (!isTracked(value) || !Object.isExtensible(value)) return value  // frozen: implicit shared mark
    ensureMeta(value).shared = true
    return value
}

function getMirrors(node) {
    const meta = ensureMeta(node)
    meta.mirrors ??= Object.create(null)
    return meta.mirrors
}

function isLivePromiseMirror(node, key, mirror) {
    return metaOf(node)?.mirrors?.[key] === mirror   // no record ⇒ guard fails, as today
}

function clearPromiseMirror(node, key) {             // becomes commit-internal in step 2
    const mirrors = metaOf(node)?.mirrors
    if (mirrors) delete mirrors[key]
}
```

`shallowCopy` change: instead of lazily creating the copy's mirror map, construct the
copy's whole record up front (`Object.defineProperty(copy, META, { value: createMeta(), … })`)
and put forked mirrors into `copyMeta.mirrors`. Counter liveness is still absent:
`parents` is not created until `copyCounters` or `buildRefIndex` makes counters live.

**Checkpoint:** the full suite passes; the frozen-import probe no longer throws.

---

## Step 2 — Create refcounts.js hooks; call them from index.js writes (behavior-neutral)

Create the module with `refSetProperty`/`refDeleteProperty` hooks that initially no-op
for non-ref-indexed data, and call them from the local `setProperty`/`deleteProperty`
wrappers in index.js. index.js still performs the language write/delete; refcounts.js
owns **only** counter bookkeeping. This step also *proves* the plug-and-play contract
— the full suite runs against the stub. Promise mirror storage, birth, clearing,
and guard helpers live in meta.js; writeback behavior
stays in index.js. The hooks need no mirror awareness because a promise physically at the key
counts as [1,0] through `getRefCounts`, so assign/writeback/delete deltas come out right
automatically. The existing structure — `walkMutationPath`, the `onTarget` callbacks —
is preserved; this step is a minimal, greppable substitution of the bare writes.
Also in this step (behavior-identical today, required by normalize/hasError ordering):
convert index.js's remaining bare promise continuations to
`onValueResolve`/`onInternalResolve`; afterwards runtime `.then(` usage is confined
to helpers.js.

```js
function refSetProperty(parent, key, value) {
    // step 3: index entering value if needed; delta = getRefCounts(new) − getRefCounts(old);
    //         swap parent edges; propagate; return the value index.js should write
    return value
}

function refDeleteProperty(parent, key) {
    // step 3: delta = −getRefCounts(old); remove parent edge; propagate
}
```

Note there is no add/replace/delete case analysis to get wrong: `getRefCounts(undefined)`
is [0,0], so a new property and a replacement are the same expression, and delete is
just the negative half.

Call-site mapping (every write in index.js today; mirror code at each site unchanged):

| site | today | becomes |
|---|---|---|
| `assignPath` onTarget, plain value | `clearPromiseMirror; parent[key] = value` | `clearPromiseMirror; value = refSetProperty(...); parent[key] = value` |
| `assignPath` onTarget, promise value (BIRTH 1) | mirror into map; register writeback; `parent[key] = value` | same, `refSetProperty`, then write in index.js |
| `deletePath` onTarget | `clearPromiseMirror; delete parent[key]` | `clearPromiseMirror; refDeleteProperty(...); delete parent[key]` |
| writeback in `onResolvedValue`, guard passes | `node[key] = value` (mirror kept) | `value = refSetProperty(...); node[key] = value` |
| suspended walk install (guard passes) | `parent[key] = next` (mirror kept) | `refSetProperty`, then write in index.js |
| sync walk install (`next !== child`) | `clearPromiseMirror; parent[key] = next` | `clearPromiseMirror; refSetProperty`, then write in index.js |

Three **sanctioned bypasses** (pin as comments, they are the only ones):

1. `shallowCopy`'s key loop — the copy is unobservable during construction and (step 3)
   its totals are snapshotted, so per-key deltas would be zero-sum noise.
2. Blank `{}` intermediates minted by `walkMutationPath` — created empty and
   unobservable during construction; their installation into the tree *does* go
   through index.js's local `setProperty` wrapper, which calls `refSetProperty`
   before writing.
3. `copyToPlainValue` (step 4) — it constructs plain *output* data that leaves the runtime:
   no META, no counts, nothing to bookkeep.

Delete the `propagateClean` / `updateCleanCounts` stubs and their call sites; the write
helpers replace them.

**Checkpoint:** all tests pass; `grep` shows no `parent[key] =` / `delete parent[` in
index.js outside `setProperty`/`deleteProperty`/`shallowCopy`.

---

## Step 3 — Adoption and live counting

### 3a. Counting primitives

```js
function getRefCounts(value) {                    // [promise, error]
    if (isPromise(value)) return [1, 0]       // pending OR settled-but-unreplaced
    if (isError(value)) return [0, 1]
    if (isTracked(value)) {
        if (!Object.isExtensible(value)) return [0, 0]   // frozen rule: permanent
        const counter = getRefCounter(value)
        if (counter === undefined) {
            reportFatalError(new Error("Ref counts require a ref-indexed value"))
        }
        return [counter.promiseCount, counter.errorCount]
    }
    return [0, 0]                             // primitive / null / undefined / hole
}

function applyCountDelta(node, dPromise, dError) {
    if (dPromise === 0 && dError === 0) return
    const meta = metaOf(node)                 // node is ref-indexed: parents Map exists
    const oldPromiseCount = meta.promiseCount
    meta.promiseCount += dPromise
    meta.errorCount += dError
    if (oldPromiseCount > 0 && meta.promiseCount === 0) {
        scheduleVerify(node)                  // step 4; zero-crossing, edge-triggered
    }
    for (const [parent, multiplicity] of meta.parents) {
        applyCountDelta(parent, dPromise * multiplicity, dError * multiplicity)
    }
    // termination: acyclic by invariant — counting-time validation rejects cycles (3b)
}

function isRefIndexed(node) {
    return metaOf(node)?.parents !== undefined
}

function addParentEdge(child, parent) {       // child tracked & extensible & ref-indexed
    const parents = metaOf(child).parents
    parents.set(parent, (parents.get(parent) ?? 0) + 1)
}

function removeParentEdge(child, parent) {
    const parents = metaOf(child)?.parents
    if (parents === undefined) return
    const n = parents.get(parent)
    if (n === 1) parents.delete(parent)
    else if (n !== undefined) parents.set(parent, n - 1)
    // Never delete the parents Map itself: empty Map still means "ref-indexed".
}
```

Invariant worth a comment: **a node's `parents` field is both the ref-indexed marker and
the exact reverse-edge multiset.** `parents === undefined` means counters are not live;
an empty `Map` means ref-indexed root / no ref-indexed parents; a populated `Map` stores
`Map<parentNode, edgeCount>`. Commits maintain the edge counts, which is why a
disconnected world's deltas (revoked mirrors advancing `currentValue`) can never reach
a world that doesn't reference the value — exact per world, no special-casing.

The flip side, stated honestly: with strong edges, every COW'd-away world remains
referenced by its reused children and keeps receiving deltas, so per-delta propagation
cost grows with the COW history of a hot key — a **time** tax, not just memory. The
sandbox accepts this (short-lived runs); the real implementation requires WeakRef
edges pruned on dead deref to bound both.

### 3b. Counting-time validation and branch ref-indexing

**Validation and ref-indexing are separate concerns** (they were one function in earlier
drafts, which conflated them): validation is lazy and runs exactly where counting needs
its guarantees — first normalize/hasError on a branch and writes into already
ref-indexed parents. Import is mark-only, and non-ref-indexed writeback can float until
counting first reaches it. Cycles can enter solely through external data; internal
operations cannot create them when the compiler obeys the ownership lowering, because
RHS object values escape through shared-ownership lookup before the write. For
`a.prop = a`, the stored value is a COW copy of `a` before `prop` is added. (Caveat:
the kernel API *called directly*, as tests do, can bypass compiler discipline —
`assignPath(root, ["self"], root)` with an un-escaped root would build a cycle no
guard sees, since the value is already in the live tree and it is not a writeback.
Documented as invalid input: compiled code cannot produce it, and the
`verifyRefCounts` oracle catches accidents in tests.)

**Ref-indexing is transactional — two passes.** The validate pass is *pure*: no metadata,
no mirrors, no edges. The commit pass runs only after the entire value validated, and
cannot fail. A single-pass ref-indexer that mints while scanning would, on a late
cycle/frozen violation, leave already-ref-indexed live nodes (DAG shares inside the
rejected value) carrying parent edges into the junk world — future deltas would
propagate into it and retain it.

```js
// Entry points (see File layout for module placement):
//
// import(value, context) — index.js/meta.js. Mark-only, O(1): store the import
//   context, set the shared mark, and return. No validation, no mirror minting,
//   no counter work.
//
// refSetProperty(parent, key, value) — refcounts.js. If parent is ref-indexed,
//   validate the entering value with writeTarget = parent, then commit/ref-index
//   it and return the value to write. A validation failure returns an Error to
//   commit at the key. If parent is not ref-indexed, this is a passthrough.
//
// buildRefIndex(value, inheritedImportContext)
//   — refcounts.js.
//   Used by normalize/hasError and by ref-indexed writes. It validates, then
//   commits counters/edges/mirrors transactionally. It always builds the generic
//   ref index; hasError-specific wait registration lives in index.js after
//   counters decide the immediate cases.
//   Mirror minting goes through promise-mirrors-owned getOrCreatePromiseMirror.
//   Data violations return Error values; normalize returns them and hasError
//   treats them as true.
// The real implementation keeps pure validation in validate.js. It is sketched
// inline here only to document the algorithm shape.
function buildRefIndex(value, inheritedImportContext) {
    if (!isTracked(value)) return value       // counted at the edge by getRefCounts

    const failure = validate(value, new Set(), new Set())
    if (failure) return failure
    commit(value)
    return value

    // ---- pass 1: PURE validation — returns Error or null --------------------
    function validate(node, visiting, validated) {
        if (!Object.isExtensible(node)) {
            return validateNonExtensibleSubtree(node, new Set())   // frozen rule, below
        }
        if (visiting.has(node)) return new Error("Cycle in ref-indexed data")
        if (validated.has(node)) return null  // in-value diamond: validated once
        if (isRefIndexed(node)) {
            return null                       // pure ref-indexing: live DAG share, already
            // valid — stop here.
        }
        visiting.add(node)
        for (const key of Object.keys(node)) {
            const child = node[key]
            if (isTracked(child)) {
                const failure = validate(child, visiting, validated)
                if (failure) return failure
            }
        }
        visiting.delete(node)
        validated.add(node)
        return null
    }

    // ---- pass 2: commit — cannot fail; post-order so child totals exist -----
    // ATOMIC-PER-NODE INVARIANT: a node's counters and the parent edges from its
    // children are established together, at the single commit point below, reached
    // only after every child is fully processed. No node is ever partially counted,
    // and — crucially — no child points its parent edge at a not-yet-committed node.
    function commit(node) {
        if (!Object.isExtensible(node)) return [0, 0]   // frozen: no counter metadata, [0,0] by rule
        const meta = ensureMeta(node)
        if (isRefIndexed(node)) {
            return [meta.promiseCount, meta.errorCount]  // DAG share / already live
        }
        let promises = 0, errors = 0
        const trackedChildren = []
        for (const key of Object.keys(node)) {
            const child = node[key]
            if (isPromise(child)) {
                promises += 1
                getOrCreatePromiseMirror(node, key, child)   // Discovery, EAGER.
                // Nothing rescans ref-indexed
                // regions: an orphan promise with no writeback would hold
                // promiseCount up forever. Imported promise keys pass their
                // captured import context into getOrCreatePromiseMirror here.
            } else if (isError(child)) {
                errors += 1                             // imported Errors are language errors
            } else if (isTracked(child)) {
                const childCounts = commit(child)
                const [cp, ce] = childCounts
                promises += cp; errors += ce
                if (Object.isExtensible(child)) trackedChildren.push(child)
            }                                           // primitives contribute nothing
        }
        // COMMIT POINT — atomic: before here `node` is uncounted with nothing
        // pointing at it; after here it is fully counted with every child edge set.
        meta.promiseCount = promises
        meta.errorCount = errors
        for (const child of trackedChildren) addParentEdge(child, node)
        meta.parents = new Map()                        // set last: counters now live
        return [promises, errors]
    }

    // Non-extensible nodes may not contain promises or Errors ANYWHERE beneath
    // (extensible descendants included). Valid frozen subtrees carry no counter metadata:
    // no counters, no parents, no mirrors — getRefCounts reports [0,0] by rule.
    function validateNonExtensibleSubtree(node, seen) {
        if (seen.has(node)) return new Error("Cycle in ref-indexed data")
        seen.add(node)
        for (const key of Object.keys(node)) {
            const child = node[key]
            if (isPromise(child) || isError(child)) {
                return new Error("Non-extensible object contains promise/error")
            }
            if (isTracked(child)) {
                // extensible or not, it is still under the frozen rule
                const failure = validateNonExtensibleSubtree(child, seen)
                if (failure) return failure
            }
        }
        seen.delete(node)
        return null
    }
}

// buildRefIndex is the lazy operation boundary used by normalize/hasError and
// future counter-guided queries. getRefCounts never calls it: below an indexed
// boundary, writes and promise settlement preserve downward closure, so a
// missing tracked-child counter is a fatal invariant failure.
```

**One universal back-edge check.** Values entering a ref-indexed parent call
`validateCountable(value, parent, isRefIndexed)` before committing the entering value.
It descends through the value and checks `node === parent`, so a write-created cycle
cannot hide under an already-ref-indexed DAG share. Keep this as one mechanism; add
ancestor-closure shortcuts later only if profiling shows large live shares in write
values.

Callers, by entry point (**lazy ref-indexing and counting-time validation** — see 3d′):
- `buildRefIndex` — the first `normalize`/`hasError` on a branch, at the caller's
  program position: creates the ref-indexed region, stopping at already-ref-indexed
  sub-branches (boundary edge + totals reuse).
- `refSetProperty` on an already-ref-indexed parent: validates the entering value
  with the write-target back-edge check, then commits/ref-indexes it for downward
  closure. On validation failure it returns an Error to commit at the key.
- `refIndexChildValue` for a revoked promise mirror whose former parent is already
  ref-indexed: runs the same child gate, but creates no property write, parent edge,
  or counter delta. Its prepared return becomes the private `mirror.currentValue`.
- `import` is not a caller. It only marks; imported data is validated later, when
  counting first needs the guarantees.

### 3c. Filling in the write hooks

```js
function indexChildValue(parent, value) {
    const failure = validateCountable(value, parent, isRefIndexed)
    if (failure) return failure
    if (isTracked(value) && Object.isExtensible(value)) {
        commitRefIndex(value)                       // keeps the region downward-closed
    }
    return value
}

function refIndexChildValue(parent, value) {
    if (metaOf(parent)?.parents === undefined) return value
    return indexChildValue(parent, value)
}

function refSetProperty(parent, key, value) {
    // LAZY GATE — evaluated at commit time, never captured at registration.
    if (metaOf(parent)?.parents === undefined) return value

    value = indexChildValue(parent, value)
    const old = parent[key]                       // may be the promise being replaced:
    const [oldP, oldE] = getRefCounts(old)            //   counts [1,0] with zero mirror logic
    const [newP, newE] = getRefCounts(value)
    if (isTracked(old) && Object.isExtensible(old)) removeParentEdge(old, parent)
    if (isTracked(value) && Object.isExtensible(value)) addParentEdge(value, parent)
    applyCountDelta(parent, newP - oldP, newE - oldE)
    return value
}

function refDeleteProperty(parent, key) {
    if (metaOf(parent)?.parents === undefined) return  // lazy gate, as above
    const old = parent[key]
    const [oldP, oldE] = getRefCounts(old)
    if (isTracked(old) && Object.isExtensible(old)) removeParentEdge(old, parent)
    applyCountDelta(parent, -oldP, -oldE)
}

// index.js keeps the language mutation:
function setProperty(parent, key, value) {
    value = refSetProperty(parent, key, value)
    parent[key] = value
    return value
}

function deleteProperty(parent, key) {
    refDeleteProperty(parent, key)
    delete parent[key]
}
```

The delta rules: **new property** → `+getRefCounts(new)`; **replaced property** →
`−getRefCounts(old) +getRefCounts(new)`; **delete** → `−getRefCounts(old)` (a cleared key's
contribution is simply removed). Mirror lifecycle stays at its existing sites. A live
promise writeback uses the same `setProperty` path as every other language write. A
revoked writeback calls the child gate only when its former parent is ref-indexed,
preserving downward closure for the private issue-time world without changing the live
world:

```js
// inside promise mirror writeback:
if (isLivePromiseMirror(node, key, mirror)) value = setProperty(node, key, value)
else value = refIndexChildValue(node, value)
mirror.currentValue = value
```

Why the deltas compose without double counting, in both walk shapes:

- **In-place mutation** (owned child): no install commit at the parent; the deeper
  commit's delta propagates up through the child's existing `parents` edge. Exact.
- **COW install**: the copy's subtree is mutated while the copy still has empty
  `parents` (deltas stop at the copy); the install commit then computes
  `getRefCounts(finalCopy) − getRefCounts(oldChild)` in one step. Exact, no double path.

### 3d′. Lazy, branch-level ref-indexing — the rules (decided)

Counters/edges/META-counting exist only where `normalize`/`hasError` have been used;
everything else pays zero bookkeeping. Mirrors and shared marks are independent of
ref-indexing and always maintained. Cost profile: never-checked data pays nothing; the
first check pays one O(branch) scan — unavoidable in any design, something must find
the promises once; repeated checks are O(1) after that.

1. **Ref-indexed regions are downward-closed** (load-bearing): ref-indexing walks whole
   subtrees, and a write into a ref-indexed parent ref-indexes the entering value. This is
   what keeps the truncated ancestor closure sound: every ancestor chain into a node
   is a non-ref-indexed prefix followed by a ref-indexed suffix, and a write-created cycle
   must return to the written target — so it is caught either by closure membership
   (ref-indexed suffix) or by validation's descent through the non-ref-indexed prefix.
2. **The gate is evaluated at commit time, never captured at registration** — see the
   `setProperty` pseudocode. Different ref-indexing attempts and pre-ref-indexing continuations
   may ride the same pending promise; this is safe by idempotence: the `parents` field
   is created only once, and `getOrCreatePromiseMirror` reuses the existing mirror for
   the same promise, so no duplicate writebacks or marks register.
3. **Deltas stop at a region's top** naturally (no `parents` edges above); ref-indexing an
   ancestor branch later connects regions through the boundary edge — no special case.
4. **Copies inherit the source's ref-indexing**: a ref-indexed source ⇒ the snapshot in 3d
   (keeps downward-closure, and a rebound COW root keeps its counts live for
   settlement waits); a non-ref-indexed source ⇒ no metadata work at all beyond fork mirrors.
5. **Validation is counting-time**: import and non-ref-indexed writeback do not walk.
   Validation runs in `buildRefIndex` and in ref-indexed write commits, exactly where
   counters need acyclicity and the frozen rule. For a ref-indexed write, the
   back-edge check descends the entering value checking `node === target` — sufficient,
   because a cycle created by the write must reach the written target.

### 3d. `shallowCopy` (sanctioned bypass, hook-only counter work)

```js
function shallowCopy(obj, pathKey, markReusedChildrenShared) {
    const copy = isArray(obj) ? new Array(obj.length) : {}
    const pathKeyString = pathKey === undefined ? undefined : String(pathKey)

    for (const key of Object.keys(obj)) {
        const markCopiedValueShared =
            markReusedChildrenShared && key !== pathKeyString
        const value = obj[key]
        copy[key] = value                          // bypass: copy not yet observable
        if (isPromise(value)) {
            // BIRTH 3 — FORK, exactly as today, into the copy's mirror map
        } else if (isTracked(value)) {
            if (markCopiedValueShared) markShared(value)
        }
    }
    copyCounters(obj, copy)                         // no-op unless obj is ref-indexed
    return copy
}
```

`copyCounters(source, copy)` lives in refcounts.js. It is the only counter-specific
piece of shallow-copy work: if `metaOf(source)?.parents === undefined`, it returns.
Otherwise it creates/uses the copy's META, snapshots `promiseCount`/`errorCount`, sets
`copyMeta.parents = new Map()` (ref-indexed copy, no ref-indexed parents yet), and registers
`copy` as a parent on each reused tracked/extensible child. `parents` is the ref-indexed
marker here too; no `adopted` bit exists.

The fork initializer needs no counter code: when it later commits the captured value
into the copy's key it goes through `setProperty(copy, key, value)` with its mirror
kept untouched, replacing the snapshotted [1,0] with `getRefCounts(value)` — uniform with
every other writeback.

**Checkpoint:** all prior tests pass, plus new count-assertion tests (step 5 list).

---

## Step 4 - Settlement waits, `normalize`, `hasError`

### 4a. Shared resolver

lookup, normalize, and hasError share a lookup-shaped path walk that observes only:
callers decide whether the reached value escapes and therefore whether to mark it.
The resolver still threads import context so discovered promise mirrors are flavored
and ref-indexing failures can name the import site.

Path semantics match lookup: promises continue through mirrors, Error values stop the
walk, `__proto__` and own non-enumerable keys read as missing, and primitive/missing
intermediates are broken paths for hasError.

### 4b. Settlement wait for normalize

normalize uses optional settlement fields on the reached branch's META:

- `settlementPromise` is one shared promise generation and exists only while normalize callers are waiting.
- `settlementResolve` holds the resolver for that generation.
- `settlementVerifyScheduled` coalesces queued checks.
- The only wake source is a zero-crossing in `applyCountDelta`.

Verification is registered through `onInternalResolve(Promise.resolve(), verify)`, never a
bare microtask and never an ambient "settling promise". This is still ordered
correctly: a zero-crossing happens inside one promise continuation; every consumer
already registered on that settling promise has already been queued, and registering
the settled-promise continuation at that point puts verification after that queued
batch. On run, re-check `promiseCount === 0`; if an earlier-issued remainder re-armed
the branch, the next zero-crossing schedules again.

```js
function waitForSettlement(node) {
    const meta = metaOf(node)

    if (meta.settlementPromise === undefined) {
        meta.settlementPromise = new Promise(resolve => {
            meta.settlementResolve = resolve
        })
    }
    return meta.settlementPromise
}

function scheduleSettlementVerify(node) {
    const meta = metaOf(node)
    if (meta.settlementPromise === undefined || meta.settlementVerifyScheduled) return

    meta.settlementVerifyScheduled = true
    onInternalResolve(Promise.resolve(), () => {
        meta.settlementVerifyScheduled = false
        if (meta.settlementPromise !== undefined && meta.promiseCount === 0) {
            const resolve = meta.settlementResolve
            meta.settlementPromise = undefined
            meta.settlementResolve = undefined
            resolve()
        }
    })
}
```

`applyCountDelta` calls `scheduleSettlementVerify(node)` only when a settlement wait exists and
the node reaches zero pending promises. No zero-count wait path is needed:
normalize answers synchronously when the branch is already settled.

### 4c. normalize

normalize follows the value-or-promise convention. If the answer is decided before any
suspension, it returns synchronously. Internal waits are consumed through
`onInternalResolve`.

```js
function normalize(root, segments = [], sharedOwnership = true, plainCopy = false) {
    return resolvePath(root, segments, (value, importContext) => {
        return normalizeResolved(value, importContext, sharedOwnership, plainCopy)
    })
}

function normalizeResolved(value, importContext, sharedOwnership, plainCopy) {
    if (isError(value) || !isTracked(value)) return value

    const indexed = buildRefIndex(value, importContext)
    if (isError(indexed)) return indexed

    if (!Object.isExtensible(value)) {
        if (!plainCopy) markResolvedValue(value, importContext, sharedOwnership)
        return plainCopy ? copyToPlainValue(value) : value
    }

    const meta = getRefCounter(value)
    if (meta.promiseCount === 0) {
        if (meta.errorCount > 0) return new Error("normalize: branch contains errors")
        if (plainCopy) return copyToPlainValue(value)
        markResolvedValue(value, importContext, sharedOwnership)
        return value
    }

    markResolvedValue(value, importContext, true)     // the pin
    return onInternalResolve(waitForSettlement(value), () => {
        if (meta.errorCount > 0) return new Error("normalize: branch contains errors")
        return plainCopy ? copyToPlainValue(value) : value
    })
}
```

Marking rule: mark exactly what escapes, plus mark to pin a wait. A settled clean
branch returned as itself is marked only when imported or `sharedOwnership=true`;
settled `plainCopy=true` returns an independent copy and leaves the original
unmarked; settled error returns a single Error and leaves the branch unmarked. A
pending branch is always marked before waiting, even when `sharedOwnership=false`,
because the mark pins the wait-set.

The pin is what makes settlement exact: later-issued operations COW away from the
marked branch, while earlier-issued suspended remainders still land through in-place
mirror advances. The wait-set is therefore the promises present at normalize's call
plus promises recursively exposed by those resolved values. This relies on the
language-integration ownership discipline: a raw promise illegally shared between a
location inside and outside the pinned branch could mutate the branch outside its
counted wait-set.

`copyToPlainValue` is a sanctioned write bypass: it creates plain output data with no metadata
to bookkeep. It uses an old->new identity map consulted before recursion, both for
termination and to preserve DAG identity in the returned value. When copying own
enumerable `__proto__`, pre-create the data slot before plain assignment, just like
COW copy does.

### 4d. hasError

hasError builds on the resolver and counters from normalize, but it never marks and
uses no shared settlement wait. `hasErrorAtPathValue` builds the generic ref index only
for the value reached at the path, then delegates indexed-branch probing to
`probeIndexedBranchForErrors(value, resolveError)`: answer synchronous errors from
`errorCount`, and collect promise waits only when `promiseCount > 0`.
hasError owns the final boolean race.

Empty segments probe the root. Non-empty segments resolve the parent path through
`resolvePath`, then read the terminal key once: broken parent path => true, missing
terminal key => false, Error terminal => true, promise/tracked terminal => probe.

Immediate answers are program-order safe for earlier-issued operations. With
`promiseCount === 0`, every earlier remainder that could touch the branch has
already completed because it would ride a promise counted inside it. With
`errorCount > 0`, the error is reachable only through settled positions; a
suspended earlier remainder able to remove it would have a counted promise on
that path. hasError deliberately does not pin, but its wait tree still gives an
issue-time answer: later-issued installs are outside the collected frontier,
while a later overwrite/delete of a watched pending key can detach the resolved
value from the live tree without changing the captured answer.

`hasErrorAtPathValue` calls generic `buildRefIndex` only at the path-value boundary.
Validation failures answer true; otherwise the branch is fully indexed and answers
come from counters. Behind a promise barrier, settlement prepares the logical child of
an already-indexed parent before later FIFO consumers run. Live writeback updates the
tree and its deltas; revoked writeback privately validates/ref-indexes `currentValue`.
If no current Error is found but `promiseCount > 0`, the pending frontier is
collected by descending only ref-indexed nodes whose counters still contain
promises. Waits are registered after `buildRefIndex` has minted mirrors/writebacks:
`probeIndexedBranchForErrors` returns `Promise.all(waitPromises)`, where each wait
is `onValueResolve(childPromise, () => probeResolvedPromiseForErrors(mirror.currentValue))`.
hasError races `onInternalResolve(cleanPromise, () => false)` against the local error
promise; `Promise.all`/`race` only aggregate already-wrapped internal waits. Each
settlement consumes the prepared mirror value directly: an Error calls the resolver,
primitive and valid non-extensible values are clean, and tracked extensible values go
straight to `probeIndexedBranchForErrors`. Newly exposed issue-time promises return a
nested `Promise.all`, and the whole promise tree resolving means the clean side is false.

**Checkpoint:** full suite green.

---

## Step 5 — Test matrix (new tests, beyond keeping the 64 green)

Counting correctness:
- counts after assign/delete/overwrite of promises, Errors, nested structures;
  same tracked child under two keys of one parent (multiplicity 2 — resolve inside it
  decrements the parent twice).
- writeback replaces [1,0] with the resolved value's counts, including a resolved value
  that itself contains promises (ref-indexing at writeback when the target is ref-indexed).
- revoked writeback under a ref-indexed former parent validates/ref-indexes its private
  logical child, including back-edge replacement, without changing live counts or edges.
- rejected promise: [1,0] → [0,1] at the same key; `errorCount` visible at the root.
- COW fork: after copying a node with a pending key, both worlds count it; each world's
  counts diverge with subsequent writes; revoked-mirror advances change no live counts.
- delete of a promise key revokes writeback *and* decrements `promiseCount`.

Ref-indexing / counting-time validation:
- raw root handed to `normalize`/`hasError` is ref-indexed lazily; imported structures
  are only marked at import and are validated/mirrored when counting reaches them.
- DAG in ref-indexed value: shared node counted via both edges, scanned once.
- cycle inside a ref-indexed value → Error surfaced; write into a ref-indexed parent
  with a value that reaches that parent → Error committed.
- transactionality: a failed validation/ref-indexing pass leaves no trace — a rejected value containing a
  live DAG-shared node must leave that node's `parents`, counts, and mirrors exactly
  as before the attempt (assert with `verifyRefCounts`), and the rejected structure's
  own nodes carry no META.

Lazy, branch-level ref-indexing:
- ops on never-checked data leave no counter metadata anywhere (assert no `parents`
  fields after a mutation-heavy run with no normalize/hasError).
- first `normalize` on a sub-branch ref-indexes only that branch — the root above it stays
  non-ref-indexed; a later `normalize` on the root stops at the ref-indexed branch, connects the
  regions via the boundary edge, and a resolve inside the branch then decrements both.
- the commit-time gate: a suspended write registered *before* a branch was ref-indexed,
  resuming *after* `normalize` ref-indexed it, must be reflected in the counts (and the
  waiter must wait for it) — this is the "different ref-indexing attempts ride the same promise"
  case; also assert no duplicate writebacks fire.
- copies: COW of a non-ref-indexed source carries no counter META; COW of a ref-indexed source
  is ref-indexed with snapshotted totals.
- counting-time validation: a write into a ref-indexed parent validates the entering
  value with the write-target back-edge check and commits an Error on failure. A
  back-edge under a non-ref-indexed target can float in the uncounted region until
  the first normalize/hasError rejects it with import attribution.
- snapshot semantics: a write issued after `normalize` does NOT appear in its result —
  the call-time shared mark makes the write COW away into a new world (assert the
  result matches the call-time state plus resolutions only). A suspended write of an
  *earlier*-issued op DOES appear (mirror advances land in the marked branch).
- `hasError` immediacy: with `errorCount > 0` at issue time it answers true without
  waiting for pending promises; with `promiseCount === 0` it answers false
  immediately; with an error arriving mid-wait it answers true at that settlement
  (early exit), not at full settlement. `hasError` never sets the SHARED mark.
- probe pruning: a branch with one pending promise and large settled-clean siblings —
  assert the pending frontier collection follows only the `promiseCount > 0` spine after
  the branch is indexed.
- sync immediate true: `hasError` on a branch containing a synchronously visible
  Error answers true from the published `errorCount`; the branch is ref-indexed,
  but no hasError wait tree is registered for its pending promises.
- wrapper-only scheduling: no `queueMicrotask`/`setTimeout` anywhere in index.js
  (greppable); zero-verification rides `onInternalResolve(Promise.resolve(), ...)`, registered
  at the zero-crossing, so it runs after the already-queued consumers of the settling
  promise — assert ordering against an earlier-issued suspended write that re-arms the count.
- frozen node containing a promise or Error anywhere beneath (including via an
  extensible descendant) → Error; valid frozen subtree stays zero-counter-metadata.

Consistency oracle (the rejected full-recompute design, in its right home):
- a test-only `verifyRefCounts(...roots)` validates each ref-indexed node independently:
  recompute its totals from its own keys, assert every child edge has the matching
  `parents` entry, and assert every stored parent edge points back through actual
  live keys with matching multiplicity. It recursively follows both child keys and
  stored parent edges, so disconnected-but-retained COW worlds are still reached.
  Run it after every operation in the counting tests; any incremental-bookkeeping
  drift fails loudly at the op that caused it, with zero runtime cost.

Settlement / normalize / hasError:
- `normalize` on an already-settled branch returns synchronously; no settlement wait is created.
- settlement verification re-arms when a queued earlier-op remainder installs a new promise at the
  zero-crossing (the deferred-verification race).
- `normalize` with a path resolves to the target branch by lookupPath rules (Error
  mid-path → Error return; promise mid-path continued through the mirror).
- `normalize` collapse on any error; plain-copy `normalize` output has no META/marks, is
  fully mutable, and preserves diamond identity (two paths to one object → one copy).
- `hasError`: empty path probes root; validation failure → true; error at target or mid-path → true; broken path (intermediate
  missing/primitive) → true; missing terminal property → false; clean branch → false;
  pending branch answers only after settlement and reflects earlier-issued suspended
  writes.
- plug & play: the full base suite passes with refcounts.js stubbed to passthroughs,
  and ops on never-ref-indexed data behave bit-for-bit like the base kernel.
- metadata-storage parity: `npm test` runs the whole matrix in both inline-Symbol
  and WeakMap modes; either mode also has its own focused npm script.
- unhandled-rejection guard: the whole matrix runs under a
  `process.on("unhandledRejection")` sentinel for unexpected rejections, per basics item
  2. A child-process integration test separately pins the intentional host-unhandled
  rejection produced when a discarded mutator continuation fails fatally.
