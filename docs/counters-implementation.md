# Subtree counters, `normalize`, `hasError` — step-by-step implementation

Historical plan for the Subtree Counters section in issues.md. The issue numbers were
later renumbered; "refcounting" throughout means **subtree promise/error counting**:
we count
pending promises and Error values reachable below each node, never references —
ownership/COW stays mark-based. Spec reference: initial-spec.md, "Subtree counters".

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
     cycle checking lives in boundary validation/ref-indexing (two-color for in-value cycles,
     direct target-reachability for writeback back-edges) and nowhere else: internal ops cannot
     create cycles because COW copies the target before a self-referencing set
     (`a.property = a` installs the pre-copy `a` into the new copy).
  4. **Zero is edge-triggered and verified asynchronously** — never fire a watcher
     synchronously; always re-check. The verification is scheduled through the uniform
     wrapper (`onResolve` on the settling promise), never a bare `queueMicrotask` —
     the wrapper contract covers the runtime's own scheduling too.

---

## File layout — plug & play

Layering, bottom-up, **no circular imports**. Source files live under `src/`:

- **helpers.js** — the promise wrapper (`settlePromise`/`onResolve` + the ambient
  settling record) and type predicates. Unchanged role.
- **validate.js** (new, tiny) — pure validation helpers: cycle/frozen-subtree checks
  and writeback back-edge reachability. It depends only on helpers.js.
- **meta.js** (new, tiny) — the META symbol, `createMeta`/`metaOf`/`ensureMeta`,
  `hasSharedMark`/`markShared`. Both layers above use it; neither owns it.
- **refcounts.js** — hook/counter logic ONLY. Public hooks, named to hide the whole
  machinery: `refSetProperty`/`refDeleteProperty` (no language write/delete;
  `refSetProperty` returns the value index.js should write, because validation can
  turn an entering value into Error), `copyCounters(source, copy)`,
  `screenExternalValue(target, value)` (value in → value-or-Error out; the single
  boundary hook — validation always, plus the ref-indexing commit when the target is
  ref-indexed), `whenSettled(node)` (normalize's waiter — resolves to an Error or to
  nothing; absorbs frozen handling and ref-indexing violations), `probeErrors(branch)`
  (hasError's counter-guided probe — true at the first error, false once settled
  clean; marks nothing, creates no waiters), `branchHasErrors(node)` (frozen/untracked
  ⇒ false), and `copyFull(node)`. Internals —
  `refIndexBranch`, `ensureRefIndexed`, `getRefCounts`, edges, settlement subscriptions — are not exported.
  It never imports index.js; its one upward need — minting a promise mirror during
  ref-indexing — is injected once at startup:
  `refcounts.initRef({ mintPromiseMirror: getOrCreatePromiseMirror })`.
- **verify-refcounts.js** — test-only consistency oracle. It imports the narrow
  `getRefCounter` accessor from refcounts.js and is not used by runtime code.
- **index.js** — the ops, language property writes/deletes, mirrors, COW, the import scanner (`scanImportBoundary` —
  it mints and marks, so it belongs here), and `normalize`/`hasError` themselves:
  language operations, ~ten lines each — normalize on `whenSettled` + `copyFull`,
  marking its target shared at call time; hasError on `probeErrors` — zero
  frozen-awareness, zero counter arithmetic, zero settlement mechanics.

The contract: **non-ref-indexed behavior ≡ base-kernel behavior** — with refcounts.js
stubbed to passthroughs (no `initRef` wiring needed), every operation behaves exactly as
today, and this is testable: the full base suite must pass against the stub.
Bookkeeping activates per-branch, purely by the presence of counter META, checked
inside the hooks at commit time.

The complete index.js diff, site by site — every pre-existing site is the same length
or *shorter* than today (the CLEAN stubs die); the only genuinely new logic lines are
one `screenExternalValue`, one `copyCounters`, and the `initRef` call:

| site | today | after |
|---|---|---|
| `assignPath` onTarget (plain) | `clearPromiseMirror; parent[key]=v; updateCleanCounts` | `clearPromiseMirror; value = refSetProperty(...); parent[key]=value` |
| `assignPath` onTarget (promise) | mirror + writeback registration + bare write + stub | same mirror code + `refSetProperty`, then write in index.js |
| `deletePath` onTarget | `clearPromiseMirror; delete parent[key]; updateCleanCounts` | `clearPromiseMirror; refDeleteProperty(...); delete parent[key]` |
| writeback in `onResolvedValue` | `node[key] = value; propagateClean` | `value = refSetProperty(...); node[key]=value` |
| walk installs (sync + suspended) | bare write (+ clear) | `refSetProperty`, then write in index.js |
| `shallowCopy` | — | `copyCounters(obj, copy)` before `return copy` |
| import scanner | `scanImportedValue` | `scanImportBoundary`: screen first, then mint + mark as today |
| op entry points | — | **unchanged** — lazy ref-indexing needs nothing at entry |
| exports | — | `+ normalize, hasError` (~ten lines each) |
| startup | — | `refcounts.initRef({ mintPromiseMirror })` |

One consistency rule inside index.js: every internal continuation — including the
three root-promise re-entries and `markShared`'s promise branch — goes through
`onResolve`, never bare `settlePromise(...).then(...)`, so the ambient settling record
is always accurate. Greppable: `.then(` appears only inside helpers.js.

---

## Step 1 — Unify metadata under one `META` Symbol (behavior-neutral)

Fold `PROMISE_MIRRORS` and `SHARED` (index.js:37–38) into a single record, housed
in the new tiny **meta.js** (see File layout) so index.js and refcounts.js both reach
it without importing each other. Also fold in basics item 1 here (non-extensible ⇒
shared for COW), since `hasSharedMark` is being rewritten anyway.

```js
const META = Symbol("META")

function createMeta() {
    return {
        shared: false,   // set once, never cleared; false at birth = old "no mark"
        mirrors: null,      // lazy Object.create(null) — the promise mirror map
        promiseCount: 0,
        errorCount: 0,
        settlementVerifyScheduled: false,
        // parents is added by refIndexBranch when counters become live:
        // undefined => not ref-indexed; empty Map => ref-indexed root / no ref-indexed parents.
        // settlementWatchers is added only by normalize while callers wait.
    }
}

function metaOf(node) {                    // read-only peek, never creates
    return node[META]
}

function ensureMeta(node) {                // node must be tracked AND extensible
    let meta = node[META]
    if (meta === undefined) {
        meta = createMeta()
        Object.defineProperty(node, META, {
            value: meta, enumerable: false, writable: true, configurable: true,
        })
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
    if (isPromise(value)) return onResolve(value, markShared)
    if (!isTracked(value) || !Object.isExtensible(value)) return value  // frozen: implicit shared mark
    ensureMeta(value).shared = true
    return value
}

function getMirrors(node) {                          // replaces getPromiseMirrorMap
    const meta = ensureMeta(node)
    meta.mirrors ??= Object.create(null)
    return meta.mirrors
}

function canUpdateMirrorToLive(node, key, mirror) {
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
`parents` is not created until `copyCounters` or `refIndexBranch` makes counters live.

**Checkpoint:** the full suite passes; the frozen-import probe no longer throws.

---

## Step 2 — Create refcounts.js hooks; call them from index.js writes (behavior-neutral)

Create the module with `refSetProperty`/`refDeleteProperty` hooks that initially no-op
for non-ref-indexed data, and call them from the local `setProperty`/`deleteProperty`
wrappers in index.js. index.js still performs the language write/delete; refcounts.js
owns **only** counter bookkeeping. This step also *proves* the plug-and-play contract
— the full suite runs against the stub. Promise mirror lifecycle (creation,
clearing, `canUpdateMirrorToLive` guards) stays at the operation sites in index.js
exactly as in the current kernel. The hooks need no mirror awareness because a promise physically at the key
counts as [1,0] through `getRefCounts`, so assign/writeback/delete deltas come out right
automatically. The existing structure — `walkMutationPath`, the `onTarget` callbacks —
is preserved; this step is a minimal, greppable substitution of the bare writes.
Also in this step (behavior-identical today, required by step 4's ambient settling
record): convert index.js's remaining bare `settlePromise(...).then` continuations —
the three root-promise re-entries and `markShared`'s promise branch — to
`onResolve`; afterwards `.then(` appears only inside helpers.js (greppable).

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
3. `copyFull` (step 4) — it constructs plain *output* data that leaves the runtime:
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
        const meta = ensureRefIndexed(value)     // robust: ref-index-if-needed, per spec
        if (isError(meta)) throw meta         // owned in-tree data failing validation
        // is a kernel-usage bug → fatal; the Error channel for external values is
        // validateExternalValue in the writeback, which runs before getRefCounts.
        return [meta.promiseCount, meta.errorCount]
    }
    return [0, 0]                             // primitive / null / undefined / hole
}

function applyCountDelta(node, dPromise, dError) {
    if (dPromise === 0 && dError === 0) return
    const meta = metaOf(node)                 // node is ref-indexed: parents Map exists
    meta.promiseCount += dPromise
    meta.errorCount += dError
    if (meta.settlementWatchers !== undefined && meta.promiseCount === 0 && dPromise < 0) {
        scheduleVerify(node)                  // step 4; zero-crossing, edge-triggered
    }
    for (const [parent, multiplicity] of meta.parents) {
        applyCountDelta(parent, dPromise * multiplicity, dError * multiplicity)
    }
    // termination: acyclic by invariant — boundary validation rejects cycles (3b)
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

### 3b. Boundary validation and branch ref-indexing (absorbs `scanImportedValue`)

**Validation and ref-indexing are separate concerns** (they were one function in earlier
drafts, which conflated them): boundary validation is EAGER — import and every external
writeback check the frozen and cycle rules the moment data enters, so the language
invariants hold unconditionally, never "until first ref-indexing" — while counter ref-indexing
is LAZY and branch-level (3d′). Cycles can enter solely through external data —
internal operations cannot create them, because COW copies the target before a
self-referencing set. (Caveat: the kernel API *called
directly*, as tests do, can bypass compiler discipline — `assignPath(root, ["self"],
root)` with an un-escaped root would build a cycle no guard sees, since the value is
already in the live tree and it is not a writeback. Documented as invalid input: compiled code
cannot produce it, and the `verifyRefCounts` oracle catches accidents in tests.)

**Ref-indexing is transactional — two passes.** The validate pass is *pure*: no metadata,
no mirrors, no edges. The commit pass runs only after the entire value validated, and
cannot fail. A single-pass ref-indexer that mints while scanning would, on a late
cycle/frozen violation, leave already-ref-indexed live nodes (DAG shares inside the
rejected value) carrying parent edges into the junk world — future deltas would
propagate into it and retain it.

```js
// Entry points (see File layout for module placement):
//
// screenExternalValue(target, value) — refcounts.js. Value in → value-or-Error out;
//   the single boundary hook, EAGER for every externally-resolved writeback value
//   (also called by import's scanner with target = null). Internally: validate —
//   frozen rule + in-value cycles + back-edge (O(1) for untracked values). For
//   ref-indexed targets, run validateNoBackEdge(value, target) first, then
//   refIndexBranch(value). The back-edge check descends the value and rejects on
//   node === target; a cycle created by this write must reach the written target,
//   so the identity check suffices for ref-indexed and non-ref-indexed targets alike.
//
// scanImportBoundary(value) — index.js (it mints mirrors and marks): calls
//   validateExternalValue FIRST — transactional: a cyclic or frozen-violating import
//   returns the Error value and leaves no metadata, mirrors, or marks behind — then
//   mints a mirror for every promise key and registers mark-on-settle continuations
//   (markShared of mirror.currentValue + recursive re-scan — the ownership
//   obligation). Builds NO counters/parents: import does not index.
//
// refIndexBranch(value) — refcounts.js, the counter ref-indexer:
//   validate, then commit counters/edges/mirrors transactionally (mirror minting via
//   the injected mintMirror). Data violations return the value or an Error;
//   normalize/hasError surface that Error by language semantics (return Error / true),
//   because ref-indexing has no parent/key to commit into. Missing initRef is a
//   fatal runtime configuration error and throws when a promise key is discovered.
// The real implementation keeps the pure validators in validate.js. They are
// shown inline here only to document the algorithm shape.
function refIndexBranch(value) {
    if (!isTracked(value)) return value       // counted at the edge by getRefCounts

    const failure = validate(value, new Set(), new Set())
    if (failure) return failure
    commit(value)
    return value

    // ---- pass 1: PURE validation — returns Error or null --------------------
    function validate(node, visiting, validated) {
        if (!Object.isExtensible(node)) {
            return validateFrozenSubtree(node, new Set())   // frozen rule, below
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
    // This is what makes hasError's early-exit safe (see "Early-exit ref-indexing"): a
    // walk abandoned at the first error commits nothing partial and leaves no dangling
    // upward edge, so no rollback is needed.
    function commit(node) {
        if (!Object.isExtensible(node)) return          // frozen: no metadata, [0,0] by rule
        const meta = ensureMeta(node)
        if (isRefIndexed(node)) return                     // DAG share / already live
        let promises = 0, errors = 0
        const trackedChildren = []
        for (const key of Object.keys(node)) {
            const child = node[key]
            if (isPromise(child)) {
                promises += 1
                mintMirror(node, key, child)   // Discovery, EAGER — the injected
                // index.js callback (refcounts.initRef). Nothing rescans ref-indexed
                // regions: an orphan promise with no writeback would hold
                // promiseCount up forever. (Import's marking continuations belong
                // to scanImportBoundary in index.js, not to the ref-indexer.)
            } else if (isError(child)) {
                errors += 1                             // imported Errors are language errors
            } else if (isTracked(child)) {
                commit(child)                           // may abandon upward on early-exit
                const [cp, ce] = getRefCounts(child)
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
    }

    // Non-extensible nodes may not contain promises or Errors ANYWHERE beneath
    // (extensible descendants included). Valid frozen subtrees carry no metadata:
    // no counters, no parents, no mirrors — getRefCounts reports [0,0] by rule.
    function validateFrozenSubtree(node, seen) {
        if (seen.has(node)) return new Error("Cycle in ref-indexed data")
        seen.add(node)
        for (const key of Object.keys(node)) {
            const child = node[key]
            if (isPromise(child) || isError(child)) {
                return new Error("Non-extensible object contains promise/error")
            }
            if (isTracked(child)) {
                // extensible or not, it is still under the frozen rule
                const failure = validateFrozenSubtree(child, seen)
                if (failure) return failure
            }
        }
        seen.delete(node)
        return null
    }
}

// The lazy-index entry point: called by whenSettled (a branch's FIRST
// normalize/hasError — this is what creates a ref-indexed region) and by getRefCounts
// inside already-ref-indexed regions. Callers guarantee node is tracked AND extensible —
// frozen values never receive metadata and are handled explicitly by
// normalize/hasError (step 4). Data violations do not throw: whenSettled surfaces
// an Error by language semantics; getRefCounts, whose inputs are owned in-tree data,
// treats an Error here as a kernel-usage bug and throws it itself (fatal, basics item 2).
function ensureRefIndexed(node) {
    const meta = ensureMeta(node)
    if (meta.parents === undefined) {
        const result = refIndexBranch(node)
        if (isError(result)) return result
    }
    return meta
}
```

**One universal back-edge check (v1).** Write commits call `validateNoBackEdge` before
`refIndexBranch`. It descends through the entering value and checks `node === target`,
so a write-created cycle cannot hide under a ref-indexed subtree. The
ancestor-closure stop-at-ref-indexed variant is deliberately NOT in v1 (one mechanism
only); add it later only if profiling shows large live DAG shares inside writeback
values.

Callers, by entry point (**lazy ref-indexing, eager validation** — see 3d′):
- `refIndexBranch` — the **first `normalize`/`hasError` on a branch** (via
  `whenSettled` → `ensureRefIndexed`), at the caller's program position: creates the
  ref-indexed region, stopping at already-ref-indexed sub-branches (boundary edge + totals
  reuse); and `setProperty` on an already-ref-indexed parent (downward closure).
- `screenExternalValue` — **every** external writeback, ref-indexed target or not (eager
  boundary validation, with `validateNoBackEdge` followed by `refIndexBranch` when
  the target is ref-indexed).
- `scanImportBoundary` (lives in index.js) — `import` (`rescan` parameter removed —
  the marking, mirror-minting, and validation obligations cannot be skipped; delete
  the "can skip promise rescan" test). Validate-first, transactional: a cyclic or
  frozen-violating import returns the Error value and leaves no metadata, mirrors, or
  marks behind. Builds no counters/edges; profiling may later promote import to
  index-while-walking, since the walk is already paid.

### 3c. Filling in the write hooks

```js
function refSetProperty(parent, key, value) {
    // LAZY GATE — evaluated at commit time, never captured at registration: a
    // continuation (writeback, suspended remainder, fork initializer) registered
    // while parent was non-ref-indexed does full bookkeeping here if parent is ref-indexed
    // by the time it commits.
    if (metaOf(parent)?.parents === undefined) {  // non-ref-indexed world: no bookkeeping
        return value
    }
    value = refIndexBranch(value)                    // keeps the region downward-closed;
                                                  // already-ref-indexed values pass through;
                                                  // a failure becomes the Error returned
                                                  // for index.js to write
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
contribution is simply removed). Mirror lifecycle stays untouched at the sites, next to
the helper calls, as today. One site-specific addition: the writeback in
`onResolvedValue` screens and, if needed, ref-indexes with the back-edge guard before writing, because
externally-resolved values are the one place a cycle can enter:

```js
// inside onResolvedValue — ONE added line; eager screening, Error-izing, and the
// ref-indexed-target counter commit all hide behind the name:
value = screenExternalValue(node, value)
mirror.currentValue = value
if (canUpdateMirrorToLive(node, key, mirror)) value = setProperty(node, key, value)
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
   settlement waiters); a non-ref-indexed source ⇒ no metadata work at all beyond fork mirrors.
5. **Boundary validation is eager even where ref-indexing is lazy**: import and every
   external writeback validate the frozen and cycle rules regardless of ref-indexing —
   only counter building is deferred, so the language invariants (acyclicity, frozen
   purity) hold at all times, not merely in ref-indexed regions. For a non-ref-indexed target
   the back-edge check has no `parents` edges to build a closure from; it descends
   the value checking `node === target` instead — sufficient, because a cycle created
   by the write must reach the written target.

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

## Step 4 — Settlement waiters, `normalize`, `hasError`

```js
// Resolves to an Error (frozen/cycle/ref-indexing violation — a language value, never a
// throw) or to undefined once the branch is settled. ALL the special cases live
// here so normalize/hasError need none: frozen nodes are validated (pure, repeatable
// — frozen data is static; a WeakSet cache is a real-impl option) and are then
// already-settled by rule; ref-indexing happens on first use; subscribe-at-zero is
// handled below.
function whenSettled(node) {
    if (!Object.isExtensible(node)) {
        return Promise.resolve(validateFrozenSubtree(node, new Set()) ?? undefined)
    }
    const meta = ensureRefIndexed(node)
    if (isError(meta)) return Promise.resolve(meta)
    return new Promise(resolve => {
        const watchers = meta.settlementWatchers ??= []
        watchers.push(resolve)                    // watchers resolve with undefined
        if (meta.promiseCount === 0) scheduleVerify(node)   // subscribe-at-zero:
        // without this, no delta ever comes and the watcher never fires
    })
}

function branchHasErrors(node) {                   // valid on a settled branch
    return (metaOf(node)?.errorCount ?? 0) > 0     // frozen/untracked ⇒ false
}

// Verification NEVER uses a bare microtask — the wrapper contract (helpers.js)
// covers the runtime's own scheduling. It is registered through onResolve on the
// promise whose settlement caused the zero-crossing, so it lands at the tail of that
// promise's FIFO queue: after every already-registered consumer, exactly where a
// re-arming install can still precede it and be seen by the re-check.
// helpers.js change: onResolve records the promise it is resuming in an ambient
// `settling` variable around the continuation call; settlingPromise() reads it.
function scheduleVerify(node) {
    const meta = metaOf(node)
    const watchers = meta.settlementWatchers
    if (watchers === undefined || meta.settlementVerifyScheduled) return
    meta.settlementVerifyScheduled = true         // coalesce redundant checks
    // subscribe-at-zero (no settling promise in flight) uses the trivial instance —
    // there is nothing to order against in that case
    onResolve(settlingPromise() ?? Promise.resolve(), () => {
        meta.settlementVerifyScheduled = false
        if (meta.settlementWatchers === watchers && meta.promiseCount === 0) {
            meta.settlementWatchers = undefined
            for (const fire of watchers) fire()
        }
        // else: a queued consumer re-armed the count — stay subscribed; the next
        // zero-crossing in applyCountDelta re-schedules. O(1) per iteration; this
        // is the counter form of "repeat scanning until settled".
    })
}
```

Why the re-check is correct: the zero-crossing happens inside one continuation of some
promise P; suspended remainders of *earlier-issued* ops are continuations registered
on P *before* ours, so they run ahead of the verification that `onResolve` registers
on P now (post-settlement registration lands at the tail of P's queue). If any of them
installs a new promise, the re-check sees `promiseCount > 0` and stays armed.

```js
// index.js. normalize MARKS THE REACHED BRANCH SHARED AT CALL TIME — the mark pins
// the snapshot: later-issued ops hit it and COW away into a new world, so the
// watched branch can never gain promises from them; suspended remainders of
// EARLIER-issued ops still land in it, because mirror advances write the promise's
// position in place regardless of the mark. promiseCount === 0 is therefore the
// EXACT wait-set: the promises present at the call plus, recursively, promises
// arriving inside their resolved values. (No conflict with "a query must not change
// ownership state" — normalize is not a pure query: its return escapes, so the mark
// was owed; marking early is what makes "current state" true.) NO early exit on
// errors: an earlier-issued remainder can still REPLACE an error before settlement,
// so collapse-to-Error is decided only at zero. Frozen branches, ref-indexing
// violations, waiter mechanics — hidden inside whenSettled.
function normalize(root, segments = [], full = false) {
    const target = lookupPath(root, segments, false)   // lookup itself marks nothing;
    return settle(target)                              // normalize marks below

    function settle(value) {
        if (isPromise(value)) return onResolve(value, settle)
        if (isError(value) || !isTracked(value)) return Promise.resolve(value)
        markShared(value)                          // AT CALL TIME — pins the snapshot
        return whenSettled(value).then(failure => {
            if (failure) return failure            // frozen/cycle violation → Error
            if (branchHasErrors(value)) {
                return new Error("normalize: branch contains errors") // sandbox collapse
            }
            return full ? copyFull(value) : value  // already marked
        })
    }
}

// Plain data out: no META, no marks — the value leaves the runtime.
// The identity map is consulted BEFORE recursing — one map, two rules:
// visited-gate (termination) and identity-reuse (lookup-shared diamonds must not
// duplicate; COW deliberately does not preserve internal aliasing, copyFull does).
function copyFull(value, identityMap = new Map()) {
    if (!isTracked(value)) return value            // settled: no promises/errors left
    const existing = identityMap.get(value)
    if (existing !== undefined) return existing
    const copy = isArray(value) ? new Array(value.length) : {}
    identityMap.set(value, copy)                   // before children (defensive)
    for (const key of Object.keys(value)) copy[key] = copyFull(value[key], identityMap)
    return copy
}

// index.js. hasError never marks (pure query — only a boolean escapes) and uses NO
// settlement waiters: it answers for the CURRENT snapshot, counter-guided, via
// refcounts.js's probeErrors. It ref-indexes as it searches but ABANDONS the walk at the
// first error, so it fully ref-indexes a branch only when the branch has no error; a
// bailed-out branch is left safely partially ref-indexed (see "Early-exit ref-indexing").
function hasError(root, segments) {
    // Resolve to the PARENT, then inspect the final key — lookupPath alone returns
    // undefined both for a missing property (no error there → false) and for a
    // broken path (intermediate missing/primitive → true per spec); they must differ.
    if (segments.length === 0) return Promise.resolve(check(lookupPath(root, [], false)))
    const parent = lookupPath(root, segments.slice(0, -1), false)
    const lastKey = segments[segments.length - 1]
    return Promise.resolve(checkParent(parent))

    function checkParent(p) {
        if (isPromise(p)) return onResolve(p, checkParent)
        if (isError(p)) return true                     // error along the path
        if (!isTracked(p)) return true                  // broken path: missing/primitive
        return check(p[lastKey])
    }

    function check(value) {
        if (isPromise(value)) return onResolve(value, check)
        if (isError(value)) return true
        if (value === undefined) return false           // property absent: no error
        if (!isTracked(value)) return false             // reached a clean primitive
        return probeErrors(value)                       // refcounts.js — below
    }
}

// refcounts.js — the counter-guided probe. Marks nothing, creates no waiters.
function probeErrors(branch) {
    if (!Object.isExtensible(branch)) {                 // frozen: no metadata —
        return validateFrozenSubtree(branch, new Set()) !== null  // valid ⇒ no errors
    }
    // Index-and-search in one walk, abandoning at the first error. Returns true
    // (error found — branch left safely partially ref-indexed), or the fully-ref-indexed meta
    // (no error present). Already-ref-indexed subtrees are skipped, so a re-probe re-walks
    // only the still-uncounted spine down to the error.
    const result = refIndexUntilError(branch)
    if (result === true) return true
    if (result.promiseCount === 0) return false         // fully ref-indexed, settled, clean
    // No error yet, promises pending. Follow ONLY pending promises (descend nodes with
    // promiseCount > 0 — settled-clean subtrees are never entered) and probe again at
    // each settlement, at hasError's FIFO slot AFTER the writeback committed the
    // resolved value's counts: first error wins, zero pending → false.
    return onNextSettlementIn(branch, () => probeErrors(branch))
}
```

Why the two immediate answers are program-order safe: with `promiseCount === 0`,
every earlier-issued remainder that could touch this branch has already completed
(any such remainder rides a promise counted inside it), so `errorCount` is the
sequential answer. And a positive `errorCount` cannot be undone by a still-suspended
earlier op — a counted error is reachable only through fully-settled positions; a
remainder able to remove it would have to ride a promise *on the error's path*, which
would make the error uncounted. Versus a full settlement wait, hasError only gets
*faster* in the true direction: it answers at the first error instead of waiting for
the whole branch.

**Early-exit ref-indexing.** `refIndexUntilError` runs the ref-indexing walk (`commit`, plus the
frozen-rule check; the cycle-validation pass is unnecessary — cycles enter only at the
external boundary, and hasError walks owned internal data) and returns `true` the
moment it accounts for an Error, without counting the rest of the branch. This is safe
*only because* of the atomic-per-node commit invariant above: a node is written as
counted, with the parent edges from its children attached, at one point reached after
all its children are processed. So an abandoned walk leaves exactly two kinds of node
— fully counted, or not counted at all — and never a child whose `parents` edge points
at an uncounted node. The clean descendants already committed become disconnected
counted **islands**: their local counts stay exact, and since nothing above them holds
a `parents` edge into an uncounted node, no future delta can propagate into garbage.
No rollback is needed — bailing simply abandons the in-progress local accumulators.
A later `normalize`, or a `hasError` after the error is removed, re-ref-indexes from the
top and reconnects the islands by stopping at them and registering the boundary edge
(the existing already-ref-indexed-subtree rule). Consequence for the "subsequent calls are
fast" property: a branch probed to a *positive* answer is only partially ref-indexed, so a
re-probe re-walks the uncounted spine to the first error (fast — proportional to the
distance to the error, not the branch size); a branch probed to a *negative* answer
was fully ref-indexed and every later query on it is O(1).

Export both; drop the leftover stub imports.

**Checkpoint:** full suite green.

---

## Step 5 — Test matrix (new tests, beyond keeping the 64 green)

Counting correctness:
- counts after assign/delete/overwrite of promises, Errors, nested structures;
  same tracked child under two keys of one parent (multiplicity 2 — resolve inside it
  decrements the parent twice).
- writeback replaces [1,0] with the resolved value's counts, including a resolved value
  that itself contains promises (ref-indexing at writeback when the target is ref-indexed).
- rejected promise: [1,0] → [0,1] at the same key; `errorCount` visible at the root.
- COW fork: after copying a node with a pending key, both worlds count it; each world's
  counts diverge with subsequent writes; revoked-mirror advances change no live counts.
- delete of a promise key revokes writeback *and* decrements `promiseCount`.

Ref-indexing / boundary screening:
- raw root handed to `normalize`/`hasError` is ref-indexed lazily; imported structures are
  screened eagerly and mint mirrors for every promise key without building counters.
- DAG in ref-indexed value: shared node counted via both edges, scanned once.
- cycle inside a ref-indexed value → Error surfaced; external writeback resolving to an
  ancestor of the target → Error committed (back-edge closed).
- transactionality: a failed ref-indexing/screening pass leaves no trace — a rejected value containing a
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
  watcher must wait for it) — this is the "different ref-indexing attempts ride the same promise"
  case; also assert no duplicate writebacks fire.
- copies: COW of a non-ref-indexed source carries no counter META; COW of a ref-indexed source
  is ref-indexed with snapshotted totals.
- eager boundary validation: an external writeback resolving to a value that reaches
  the written target commits an Error at the key immediately — under a non-ref-indexed
  target (the `node === target` reachability descent) and under a ref-indexed one (the
  ancestor closure); the tree never contains a cycle, even transiently. Same pair of
  cases for a frozen violation inside the resolved value.
- snapshot semantics: a write issued after `normalize` does NOT appear in its result —
  the call-time shared mark makes the write COW away into a new world (assert the
  result matches the call-time state plus resolutions only). A suspended write of an
  *earlier*-issued op DOES appear (mirror advances land in the marked branch).
- `hasError` immediacy: with `errorCount > 0` at issue time it answers true without
  waiting for pending promises; with `promiseCount === 0` it answers false
  immediately; with an error arriving mid-wait it answers true at that settlement
  (early exit), not at full settlement. `hasError` never sets the SHARED mark.
- probe pruning: a branch with one pending promise and large settled-clean siblings —
  assert the probe's walk never enters the settled subtrees (promiseCount guidance).
- early-exit partial ref-indexing: `hasError` on a branch whose error sits under an early
  key, with a large clean sibling after it — assert the walk abandons at the error and
  the sibling is left UNcounted (no `parents`), while the clean descendants already
  committed before the error are counted islands with NO parent edge pointing at the
  uncounted ancestors. Then `verifyRefCounts` must pass (no partial node, no dangling
  upward edge), a subsequent write into an island must keep its local counts exact
  without corrupting any uncounted ancestor, and a later `normalize` on the whole
  branch must fully index and reconnect the islands (boundary edges appear).
- a branch `hasError` probes to a *negative* (fully clean, settled) answer is fully
  ref-indexed — a second query on it is O(1); a branch probed to a *positive* answer is
  only partially ref-indexed and a re-probe re-walks the uncounted spine to the error.
- wrapper-only scheduling: no `queueMicrotask`/`setTimeout` anywhere in index.js
  (greppable); the zero-verification rides `onResolve` on the settling promise, so
  it runs after every consumer already registered on that promise — assert ordering
  against an earlier-issued suspended write that re-arms the count.
- frozen node containing a promise or Error anywhere beneath (including via an
  extensible descendant) → Error; valid frozen subtree stays zero-metadata.

Consistency oracle (the rejected full-recompute design, in its right home):
- a test-only `verifyRefCounts(...roots)` validates each ref-indexed node independently:
  recompute its totals from its own keys, assert every child edge has the matching
  `parents` entry, and assert every stored parent edge points back through actual
  live keys with matching multiplicity. It recursively follows both child keys and
  stored parent edges, so disconnected-but-retained COW worlds are still reached.
  Run it after every operation in the counting tests; any incremental-bookkeeping
  drift fails loudly at the op that caused it, with zero runtime cost.

Settlement / normalize / hasError:
- `normalize` on an already-settled branch resolves (subscribe-at-zero verify).
- watcher re-arms when a queued earlier-op remainder installs a new promise at the
  zero-crossing (the deferred-verification race).
- `normalize` with a path resolves to the target branch by lookupPath rules (Error
  mid-path → Error return; promise mid-path continued through the mirror).
- `normalize` collapse on any error; full-mode `normalize` output has no META/marks, is
  fully mutable, and preserves diamond identity (two paths to one object → one copy).
- `hasError`: error at target or mid-path → true; broken path (intermediate
  missing/primitive) → true; missing terminal property → false; clean branch → false;
  pending branch answers only after settlement and reflects earlier-issued suspended
  writes.
- plug & play: the full base suite passes with refcounts.js stubbed to passthroughs,
  and ops on never-ref-indexed data behave bit-for-bit like the base kernel.
- unhandled-rejection guard: whole matrix runs under a `process.on("unhandledRejection")`
  sentinel, per basics item 2.
