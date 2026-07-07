# Subtree counters, `normalize`, `hasError` — step-by-step implementation

Implements issues.md items 8–12 against the current kernel (index.js / helpers.js).
"Refcounting" throughout means **subtree promise/error counting** (issues #8): we count
pending promises and Error values reachable below each node, never references —
ownership/COW stays mark-based. Spec reference: initial-spec.md, "Subtree counters".

Ground rules for the whole sequence:

- Each step ends with the full suite green (the current suite plus the new tests
  added along the way — don't hardcode counts, they go stale).
  Steps 1 and 2 are behavior-neutral refactors; counting only goes live in step 3.
- Four pillars that every piece of pseudocode below serves:
  1. **Counters have no safe default** — `parents` edges are exact or the counts lie.
  2. **Two thin write helpers** — `setProperty`/`deleteProperty` own all counter
     bookkeeping; no bare `node[key] =` / `delete node[key]` outside them (three
     sanctioned bypasses, listed in step 2). Promise mirrors are deliberately not
     their concern — mirror lifecycle stays at the operation sites, as in the current
     kernel. A full-recompute variant was considered and rejected for the runtime path
     (it moves complexity rather than removing it); it survives as the test-suite
     consistency oracle (step 5). All counter code lives in its own module,
     refcounts.js (see File layout): index.js only calls the hooks, and with the
     module stubbed to passthroughs the kernel is bit-for-bit the base kernel.
  3. **Acyclicity is load-bearing** — delta propagation loops forever on a cycle. All
     cycle checking lives in boundary validation/indexing (two-color for in-value cycles,
     direct target-reachability for writeback back-edges) and nowhere else: internal ops cannot
     create cycles because COW copies the target before a self-referencing set
     (`a.property = a` installs the pre-copy `a` into the new copy).
  4. **Zero is edge-triggered and verified asynchronously** — never fire a watcher
     synchronously; always re-check. The verification is scheduled through the uniform
     wrapper (`onResolve` on the settling promise), never a bare `queueMicrotask` —
     the wrapper contract covers the runtime's own scheduling too.

---

## File layout — plug & play

Layering, bottom-up, **no circular imports**:

- **helpers.js** — the promise wrapper (`settlePromise`/`onResolve` + the ambient
  settling record) and type predicates. Unchanged role.
- **meta.js** (new, tiny) — the META symbol, `createMeta`/`metaOf`/`ensureMeta`,
  `hasSharedMark`/`markShared`. Both layers above use it; neither owns it.
- **refcounts.js** — hook/counter logic ONLY. Public hooks, named to hide the whole
  machinery: `setProperty`/`deleteProperty` (return nothing — index-failure handling
  is internal: the Error is written at the key), `copyCounters(source, copy)`,
  `screenExternalValue(target, value)` (value in → value-or-Error out; the single
  boundary hook — validation always, plus the indexing commit when the target is
  indexed), `whenSettled(node)` (resolves to an Error or to nothing; absorbs ALL
  frozen handling and indexing violations), `branchHasErrors(node)` (frozen/untracked
  ⇒ false), `copyFull(node)`, and the test-only `verifyRefCounts`. Internals —
  `indexBranch`, `ensureIndexed`, `countsOf`, edges, settlement subscriptions — are not exported.
  It never imports index.js; its one upward need — minting a promise mirror during
  indexing — is injected once at startup:
  `refcounts.init({ mintMirror: getOrCreatePromiseMirror })`.
- **index.js** — the ops, mirrors, COW, the import scanner (`scanImportBoundary` —
  it mints and marks, so it belongs here), and `normalize`/`hasError` themselves:
  language operations, ~ten lines each on top of `whenSettled`/`branchHasErrors`/
  `copyFull` — zero frozen-awareness, zero counter arithmetic, zero settlement mechanics.

The contract: **unindexed behavior ≡ base-kernel behavior** — with refcounts.js
stubbed to passthroughs (no `init` wiring needed), every operation behaves exactly as
today, and this is testable: the full base suite must pass against the stub.
Bookkeeping activates per-branch, purely by the presence of counter META, checked
inside the hooks at commit time.

The complete index.js diff, site by site — every pre-existing site is the same length
or *shorter* than today (the CLEAN stubs die); the only genuinely new logic lines are
one `screenExternalValue`, one `copyCounters`, and the `init` call:

| site | today | after |
|---|---|---|
| `assignPath` onTarget (plain) | `clearPromiseMirror; parent[key]=v; updateCleanCounts` | `clearPromiseMirror; setProperty(parent, key, v)` |
| `assignPath` onTarget (promise) | mirror + writeback registration + bare write + stub | same mirror code + `setProperty` |
| `deletePath` onTarget | `clearPromiseMirror; delete parent[key]; updateCleanCounts` | `clearPromiseMirror; deleteProperty(parent, key)` |
| writeback in `onResolvedValue` | `node[key] = value; propagateClean` | `value = screenExternalValue(node, value)` then `setProperty(node, key, value)` |
| walk installs (sync + suspended) | bare write (+ clear) | `setProperty` (+ clear) |
| `shallowCopy` | — | `copyCounters(obj, copy)` before `return copy` |
| import scanner | `scanImportedValue` | `scanImportBoundary`: screen first, then mint + mark as today |
| op entry points | — | **unchanged** — lazy indexing needs nothing at entry |
| exports | — | `+ normalize, hasError` (~ten lines each) |
| startup | — | `refcounts.init({ mintMirror })` |

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
        pendingCount: 0,
        errorCount: 0,
        settlementVerifyScheduled: false,
        // parents is added by indexBranch when counters become live:
        // undefined => not indexed; empty Map => indexed root / no indexed parents.
        // settlementWatchers is added only by normalize/hasError while callers wait.
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
`parents` is not created until `copyCounters` or `indexBranch` makes counters live.

**Checkpoint:** the full suite passes; the frozen-import probe no longer throws.

---

## Step 2 — Create refcounts.js as a passthrough stub; funnel writes through it (behavior-neutral)

Create the module with `setProperty`/`deleteProperty` that today just perform the
write, and funnel index.js's bare writes through them; step 3 fills the stub in. This
step also *proves* the plug-and-play contract — the full suite runs against the stub.
The helpers own **only** counter bookkeeping — promise mirror lifecycle (creation,
clearing, `canUpdateMirrorToLive` guards) stays at the operation sites in index.js
exactly as in the current kernel. The helpers need no mirror awareness because a promise physically at the key
counts as (1,0) through `countsOf`, so assign/writeback/delete deltas come out right
automatically. The existing structure — `walkMutationPath`, the `onTarget` callbacks —
is preserved; this step is a minimal, greppable substitution of the bare writes.
Also in this step (behavior-identical today, required by step 4's ambient settling
record): convert index.js's remaining bare `settlePromise(...).then` continuations —
the three root-promise re-entries and `markShared`'s promise branch — to
`onResolve`; afterwards `.then(` appears only inside helpers.js (greppable).

```js
function setProperty(parent, key, value) {
    // step 3: index entering value if needed; delta = countsOf(new) − countsOf(old);
    //         swap parent edges; propagate
    parent[key] = value
}

function deleteProperty(parent, key) {
    // step 3: delta = −countsOf(old); remove parent edge; propagate
    delete parent[key]
}
```

Note there is no add/replace/delete case analysis to get wrong: `countsOf(undefined)`
is (0,0), so a new property and a replacement are the same expression, and delete is
just the negative half.

Call-site mapping (every write in index.js today; mirror code at each site unchanged):

| site | today | becomes |
|---|---|---|
| `assignPath` onTarget, plain value | `clearPromiseMirror; parent[key] = value` | `clearPromiseMirror; setProperty(parent, key, value)` |
| `assignPath` onTarget, promise value (BIRTH 1) | mirror into map; register writeback; `parent[key] = value` | same, write via `setProperty` |
| `deletePath` onTarget | `clearPromiseMirror; delete parent[key]` | `clearPromiseMirror; deleteProperty(parent, key)` |
| writeback in `onResolvedValue`, guard passes | `node[key] = value` (mirror kept) | `setProperty(node, key, value)` |
| suspended walk install (guard passes) | `parent[key] = next` (mirror kept) | `setProperty(parent, key, next)` |
| sync walk install (`next !== child`) | `clearPromiseMirror; parent[key] = next` | `clearPromiseMirror; setProperty(parent, key, next)` |

Three **sanctioned bypasses** (pin as comments, they are the only ones):

1. `shallowCopy`'s key loop — the copy is unobservable during construction and (step 3)
   its totals are snapshotted, so per-key deltas would be zero-sum noise.
2. Blank `{}` intermediates minted by `walkMutationPath` — created empty and
   unobservable during construction; their installation into the tree *does* go
   through `setProperty`, which indexes them only if the parent is already indexed.
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
function countsOf(value) {                    // [pending, error]
    if (isPromise(value)) return [1, 0]       // pending OR settled-but-unreplaced
    if (isError(value)) return [0, 1]
    if (isTracked(value)) {
        if (!Object.isExtensible(value)) return [0, 0]   // frozen rule: permanent
        const meta = ensureIndexed(value)     // robust: index-if-needed, per spec
        if (isError(meta)) throw meta         // owned in-tree data failing validation
        // is a kernel-usage bug → fatal; the Error channel for external values is
        // validateExternalValue in the writeback, which runs before countsOf.
        return [meta.pendingCount, meta.errorCount]
    }
    return [0, 0]                             // primitive / null / undefined / hole
}

function applyCountDelta(node, dPending, dError) {
    if (dPending === 0 && dError === 0) return
    const meta = metaOf(node)                 // node is indexed: parents Map exists
    meta.pendingCount += dPending
    meta.errorCount += dError
    if (meta.settlementWatchers !== undefined && meta.pendingCount === 0 && dPending < 0) {
        scheduleVerify(node)                  // step 4; zero-crossing, edge-triggered
    }
    for (const [parent, multiplicity] of meta.parents) {
        applyCountDelta(parent, dPending * multiplicity, dError * multiplicity)
    }
    // termination: acyclic by invariant — boundary validation rejects cycles (3b)
}

function hasCounters(node) {
    return metaOf(node)?.parents !== undefined
}

function addParentEdge(child, parent) {       // child tracked & extensible & indexed
    const parents = metaOf(child).parents
    parents.set(parent, (parents.get(parent) ?? 0) + 1)
}

function removeParentEdge(child, parent) {
    const parents = metaOf(child)?.parents
    if (parents === undefined) return
    const n = parents.get(parent)
    if (n === 1) parents.delete(parent)
    else if (n !== undefined) parents.set(parent, n - 1)
    // Never delete the parents Map itself: empty Map still means "indexed".
}
```

Invariant worth a comment: **a node's `parents` field is both the indexed marker and
the exact reverse-edge multiset.** `parents === undefined` means counters are not live;
an empty `Map` means indexed root / no indexed parents; a populated `Map` stores
`Map<parentNode, edgeCount>`. Commits maintain the edge counts, which is why a
disconnected world's deltas (revoked mirrors advancing `currentValue`) can never reach
a world that doesn't reference the value — exact per world, no special-casing.

The flip side, stated honestly: with strong edges, every COW'd-away world remains
referenced by its reused children and keeps receiving deltas, so per-delta propagation
cost grows with the COW history of a hot key — a **time** tax, not just memory. The
sandbox accepts this (short-lived runs); the real implementation requires WeakRef
edges pruned on dead deref to bound both.

### 3b. Boundary validation and branch indexing (absorbs `scanImportedValue`)

**Validation and indexing are separate concerns** (they were one function in earlier
drafts, which conflated them): boundary validation is EAGER — import and every external
writeback check the frozen and cycle rules the moment data enters, so the language
invariants hold unconditionally, never "until first indexing" — while counter indexing
is LAZY and branch-level (3d′). Cycles can enter solely through external data —
internal operations cannot create them, because COW copies the target before a
self-referencing set. (Caveat: the kernel API *called
directly*, as tests do, can bypass compiler discipline — `assignPath(root, ["self"],
root)` with an un-escaped root would build a cycle no guard sees, since the value is
already in the live tree and it is not a writeback. Documented as invalid input: compiled code
cannot produce it, and the `verifyRefCounts` oracle catches accidents in tests.)

**Indexing is transactional — two passes.** The validate pass is *pure*: no metadata,
no mirrors, no edges. The commit pass runs only after the entire value validated, and
cannot fail. A single-pass indexer that mints while scanning would, on a late
cycle/frozen violation, leave already-indexed live nodes (DAG shares inside the
rejected value) carrying parent edges into the junk world — future deltas would
propagate into it and retain it.

```js
// Entry points (see File layout for module placement):
//
// screenExternalValue(target, value) — refcounts.js. Value in → value-or-Error out;
//   the single boundary hook, EAGER for every externally-resolved writeback value
//   (also called by import's scanner with target = null). Internally: validate —
//   frozen rule + in-value cycles + back-edge (O(1) for untracked values) — then,
//   only when the target is indexed, indexBranch(value, target); else pass through.
//   ONE universal back-edge mechanism in v1: descend the value — through indexed
//   nodes too when a target is present, `validated`-set-deduped — and reject on
//   node === target; a cycle created by this write must reach the written target,
//   so the identity check suffices for indexed and unindexed targets alike.
//
// scanImportBoundary(value) — index.js (it mints mirrors and marks): calls
//   validateExternalValue FIRST — transactional: a cyclic or frozen-violating import
//   returns the Error value and leaves no metadata, mirrors, or marks behind — then
//   mints a mirror for every promise key and registers mark-on-settle continuations
//   (markShared of mirror.currentValue + recursive re-scan — the ownership
//   obligation). Builds NO counters/parents: import does not index.
//
// indexBranch(value, backEdgeTarget = null) — refcounts.js, the counter indexer:
//   validate, then commit counters/edges/mirrors transactionally (mirror minting via
//   the injected mintMirror). Returns the value or an Error — it NEVER throws;
//   normalize/hasError surface the Error by language semantics (return Error / true),
//   because indexing has no parent/key to commit into.
function indexBranch(value, backEdgeTarget = null) {
    if (!isTracked(value)) return value       // counted at the edge by countsOf

    const failure = validate(value, new Set(), new Set())
    if (failure) return failure
    commit(value)
    return value

    // ---- pass 1: PURE validation — returns Error or null --------------------
    function validate(node, visiting, validated) {
        if (node === backEdgeTarget) {        // FIRST, before ANY early exit — an
            return new Error(                 // indexed or already-validated node
                "Cycle: value reaches the write target")  // must not hide the target
        }
        if (!Object.isExtensible(node)) {
            return validateFrozenSubtree(node, new Set())   // frozen rule, below
        }
        if (visiting.has(node)) return new Error("Cycle in indexed data")
        if (validated.has(node)) return null  // in-value diamond: validated once
        if (hasCounters(node) && backEdgeTarget === null) {
            return null                       // pure indexing: live DAG share, already
            // valid — stop here. With a target present we DESCEND indexed nodes
            // instead: the target could hide anywhere below them.
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
    function commit(node) {
        if (!Object.isExtensible(node)) return          // frozen: no metadata, (0,0) by rule
        const meta = ensureMeta(node)
        if (hasCounters(node)) return                   // DAG share / already live
        let pending = 0, errors = 0
        for (const key of Object.keys(node)) {
            const child = node[key]
            if (isPromise(child)) {
                pending += 1
                mintMirror(node, key, child)   // Discovery, EAGER — the injected
                // index.js callback (refcounts.init). Nothing rescans indexed
                // regions: an orphan promise with no writeback would hold
                // pendingCount up forever. (Import's marking continuations belong
                // to scanImportBoundary in index.js, not to the indexer.)
            } else if (isError(child)) {
                errors += 1                             // imported Errors are language errors
            } else if (isTracked(child)) {
                commit(child)
                const [cp, ce] = countsOf(child)
                pending += cp; errors += ce
                if (Object.isExtensible(child)) addParentEdge(child, node)
            }                                           // primitives contribute nothing
        }
        meta.pendingCount = pending
        meta.errorCount = errors
        meta.parents = new Map()                        // set last: counters now live
    }

    // Non-extensible nodes may not contain promises or Errors ANYWHERE beneath
    // (extensible descendants included). Valid frozen subtrees carry no metadata:
    // no counters, no parents, no mirrors — countsOf reports (0,0) by rule.
    function validateFrozenSubtree(node, seen) {
        if (seen.has(node)) return new Error("Cycle in indexed data")
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
// normalize/hasError — this is what creates an indexed region) and by countsOf
// inside already-indexed regions. Callers guarantee node is tracked AND extensible —
// frozen values never receive metadata and are handled explicitly by
// normalize/hasError (step 4). NEVER throws: whenSettled surfaces an Error by
// language semantics; countsOf, whose inputs are owned in-tree data, treats an Error
// here as a kernel-usage bug and throws it itself (fatal, basics item 2).
function ensureIndexed(node) {
    const meta = ensureMeta(node)
    if (meta.parents === undefined) {
        const result = indexBranch(node)
        if (isError(result)) return result
    }
    return meta
}
```

**One universal back-edge check (v1).** The validate pass descends through indexed
nodes when a `backEdgeTarget` is present (the `validated` set prevents DAG re-walks)
and checks `node === target` — as the *first* test, before any early exit, so nothing
can hide the target. The ancestor-closure stop-at-indexed variant is deliberately NOT
in v1 (one mechanism only); add it later only if profiling shows large live DAG shares
inside writeback values.

Callers, by entry point (**lazy indexing, eager validation** — see 3d′):
- `indexBranch` — the **first `normalize`/`hasError` on a branch** (via
  `whenSettled` → `ensureIndexed`), at the caller's program position: creates the
  indexed region, stopping at already-indexed sub-branches (boundary edge + totals
  reuse); and `setProperty` on an already-indexed parent (downward closure).
- `screenExternalValue` — **every** external writeback, indexed target or not (eager
  boundary validation, with the `indexBranch` commit folded in when the target is
  indexed — the call site is one line).
- `scanImportBoundary` (lives in index.js) — `import` (`rescan` parameter removed —
  the marking, mirror-minting, and validation obligations cannot be skipped; delete
  the "can skip promise rescan" test). Validate-first, transactional: a cyclic or
  frozen-violating import returns the Error value and leaves no metadata, mirrors, or
  marks behind. Builds no counters/edges; profiling may later promote import to
  index-while-walking, since the walk is already paid.

### 3c. Filling in the write helpers

```js
function setProperty(parent, key, value) {
    // LAZY GATE — evaluated at commit time, never captured at registration: a
    // continuation (writeback, suspended remainder, fork initializer) registered
    // while parent was unindexed does full bookkeeping here if parent is indexed
    // by the time it commits.
    if (metaOf(parent)?.parents === undefined) {  // unindexed world: no bookkeeping
        parent[key] = value
        return
    }
    value = indexBranch(value)                    // keeps the region downward-closed;
                                                  // already-indexed values pass through;
                                                  // a failure becomes the Error written
                                                  // below — invisible to callers (void)
    const old = parent[key]                       // may be the promise being replaced:
    const [oldP, oldE] = countsOf(old)            //   counts (1,0) with zero mirror logic
    const [newP, newE] = countsOf(value)
    if (isTracked(old) && Object.isExtensible(old)) removeParentEdge(old, parent)
    if (isTracked(value) && Object.isExtensible(value)) addParentEdge(value, parent)
    parent[key] = value
    applyCountDelta(parent, newP - oldP, newE - oldE)
}

function deleteProperty(parent, key) {
    if (metaOf(parent)?.parents === undefined) {  // lazy gate, as above
        delete parent[key]
        return
    }
    const old = parent[key]
    const [oldP, oldE] = countsOf(old)
    if (isTracked(old) && Object.isExtensible(old)) removeParentEdge(old, parent)
    delete parent[key]
    applyCountDelta(parent, -oldP, -oldE)
}
```

The delta rules: **new property** → `+countsOf(new)`; **replaced property** →
`−countsOf(old) +countsOf(new)`; **delete** → `−countsOf(old)` (a cleared key's
contribution is simply removed). Mirror lifecycle stays untouched at the sites, next to
the helper calls, as today. One site-specific addition: the writeback in
`onResolvedValue` screens and, if needed, indexes with the back-edge guard before writing, because
externally-resolved values are the one place a cycle can enter:

```js
// inside onResolvedValue — ONE added line; eager screening, Error-izing, and the
// indexed-target counter commit all hide behind the name:
value = screenExternalValue(node, value)
mirror.currentValue = value
if (canUpdateMirrorToLive(node, key, mirror)) setProperty(node, key, value)
```

Why the deltas compose without double counting, in both walk shapes:

- **In-place mutation** (owned child): no install commit at the parent; the deeper
  commit's delta propagates up through the child's existing `parents` edge. Exact.
- **COW install**: the copy's subtree is mutated while the copy still has empty
  `parents` (deltas stop at the copy); the install commit then computes
  `countsOf(finalCopy) − countsOf(oldChild)` in one step. Exact, no double path.

### 3d′. Lazy, branch-level indexing — the rules (decided)

Counters/edges/META-counting exist only where `normalize`/`hasError` have been used;
everything else pays zero bookkeeping. Mirrors and shared marks are independent of
indexing and always maintained. Cost profile: never-checked data pays nothing; the
first check pays one O(branch) scan — unavoidable in any design, something must find
the promises once; repeated checks are O(1) after that.

1. **Indexed regions are downward-closed** (load-bearing): indexing walks whole
   subtrees, and a write into an indexed parent indexes the entering value. This is
   what keeps the truncated ancestor closure sound: every ancestor chain into a node
   is an unindexed prefix followed by an indexed suffix, and a write-created cycle
   must return to the written target — so it is caught either by closure membership
   (indexed suffix) or by validation's descent through the unindexed prefix.
2. **The gate is evaluated at commit time, never captured at registration** — see the
   `setProperty` pseudocode. Different indexing attempts and pre-indexing continuations
   may ride the same pending promise; this is safe by idempotence: the `parents` field
   is created only once, and `getOrCreatePromiseMirror` reuses the existing mirror for
   the same promise, so no duplicate writebacks or marks register.
3. **Deltas stop at a region's top** naturally (no `parents` edges above); indexing an
   ancestor branch later connects regions through the boundary edge — no special case.
4. **Copies inherit the source's indexing**: an indexed source ⇒ the snapshot in 3d
   (keeps downward-closure, and a rebound COW root keeps its counts live for
   settlement waiters); an unindexed source ⇒ no metadata work at all beyond fork mirrors.
5. **Boundary validation is eager even where indexing is lazy**: import and every
   external writeback validate the frozen and cycle rules regardless of indexing —
   only counter building is deferred, so the language invariants (acyclicity, frozen
   purity) hold at all times, not merely in indexed regions. For an unindexed target
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
    copyCounters(obj, copy)                         // no-op unless obj is indexed
    return copy
}
```

`copyCounters(source, copy)` lives in refcounts.js. It is the only counter-specific
piece of shallow-copy work: if `metaOf(source)?.parents === undefined`, it returns.
Otherwise it creates/uses the copy's META, snapshots `pendingCount`/`errorCount`, sets
`copyMeta.parents = new Map()` (indexed copy, no indexed parents yet), and registers
`copy` as a parent on each reused tracked/extensible child. `parents` is the indexed
marker here too; no `adopted` bit exists.

The fork initializer needs no counter code: when it later commits the captured value
into the copy's key it goes through `setProperty(copy, key, value)` with its mirror
kept untouched, replacing the snapshotted (1,0) with `countsOf(value)` — uniform with
every other writeback.

**Checkpoint:** all prior tests pass, plus new count-assertion tests (step 5 list).

---

## Step 4 — Settlement waiters, `normalize`, `hasError`

```js
// Resolves to an Error (frozen/cycle/indexing violation — a language value, never a
// throw) or to undefined once the branch is settled. ALL the special cases live
// here so normalize/hasError need none: frozen nodes are validated (pure, repeatable
// — frozen data is static; a WeakSet cache is a real-impl option) and are then
// already-settled by rule; indexing happens on first use; subscribe-at-zero is
// handled below.
function whenSettled(node) {
    if (!Object.isExtensible(node)) {
        return Promise.resolve(validateFrozenSubtree(node, new Set()) ?? undefined)
    }
    const meta = ensureIndexed(node)
    if (isError(meta)) return Promise.resolve(meta)
    return new Promise(resolve => {
        const watchers = meta.settlementWatchers ??= []
        watchers.push(resolve)                    // watchers resolve with undefined
        if (meta.pendingCount === 0) scheduleVerify(node)   // subscribe-at-zero:
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
        if (meta.settlementWatchers === watchers && meta.pendingCount === 0) {
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
installs a new promise, the re-check sees `pendingCount > 0` and stays armed.

```js
// index.js. ORDERED like every other op: whenSettled's sync prefix indexes the
// branch and registers at normalize's program position; remainders resume in FIFO.
// Completion is branch settlement (pendingCount 0, per the spec); in-place effects of
// later-issued ops landing before settlement are included. No call-time marking: a
// query must not change ownership state. Frozen roots, indexing violations, watcher
// mechanics — all hidden inside whenSettled.
function normalize(root, segments = [], full = false) {
    const target = lookupPath(root, segments, false)   // no ownership at resolve time:
    return settle(target)                              // the RETURN is marked instead

    function settle(value) {
        if (isPromise(value)) return onResolve(value, settle)
        if (isError(value) || !isTracked(value)) return Promise.resolve(value)
        return whenSettled(value).then(failure => {
            if (failure) return failure            // frozen/cycle violation → Error
            if (branchHasErrors(value)) {
                return new Error("normalize: branch contains errors") // sandbox collapse
            }
            if (full) return copyFull(value)
            return markShared(value) // only the RETURN escapes — shared ownership;
        })                              // marked shared at completion, never at call time
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

function hasError(root, segments) {
    // sharedOwnership=false — pure inspection: a boolean escapes, nothing else, so
    // the SHARED ownership mark is never set. The counter metadata is a separate
    // concern and hasError DOES build it: the first call indexes the reached branch
    // (whenSettled → ensureIndexed) and the region is maintained from then on, so
    // every later hasError on it is O(1) plus path resolution. Ordered like every
    // other op: registrations at hasError's program position, FIFO resumption;
    // completion is the reached branch's settlement (pendingCount 0).
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
        return whenSettled(value).then(failure =>       // frozen handled inside
            isError(failure) || branchHasErrors(value)) // violation → true
    }
}
```

`hasError` waits for the reached branch's settlement because program-order semantics
demand it: a pending remainder of an earlier op may still add or remove an error, and
any such remainder is suspended on a promise counted inside the branch (if the branch
counts zero pending, no such remainder can exist).

Export both; drop the leftover stub imports.

**Checkpoint:** full suite green.

---

## Step 5 — Test matrix (new tests, beyond keeping the 64 green)

Counting correctness:
- counts after assign/delete/overwrite of promises, Errors, nested structures;
  same tracked child under two keys of one parent (multiplicity 2 — resolve inside it
  decrements the parent twice).
- writeback replaces (1,0) with the resolved value's counts, including a resolved value
  that itself contains promises (indexing at writeback when the target is indexed).
- rejected promise: (1,0) → (0,1) at the same key; `errorCount` visible at the root.
- COW fork: after copying a node with a pending key, both worlds count it; each world's
  counts diverge with subsequent writes; revoked-mirror advances change no live counts.
- delete of a promise key revokes writeback *and* decrements `pendingCount`.

Indexing / boundary screening:
- raw root handed to `normalize`/`hasError` is indexed lazily; imported structures are
  screened eagerly and mint mirrors for every promise key without building counters.
- DAG in indexed value: shared node counted via both edges, scanned once.
- cycle inside an indexed value → Error surfaced; external writeback resolving to an
  ancestor of the target → Error committed (back-edge closed).
- transactionality: a failed indexing/screening pass leaves no trace — a rejected value containing a
  live DAG-shared node must leave that node's `parents`, counts, and mirrors exactly
  as before the attempt (assert with `verifyRefCounts`), and the rejected structure's
  own nodes carry no META.

Lazy, branch-level indexing:
- ops on never-checked data leave no counter metadata anywhere (assert no `parents`
  fields after a mutation-heavy run with no normalize/hasError).
- first `normalize` on a sub-branch indexes only that branch — the root above it stays
  unindexed; a later `normalize` on the root stops at the indexed branch, connects the
  regions via the boundary edge, and a resolve inside the branch then decrements both.
- the commit-time gate: a suspended write registered *before* a branch was indexed,
  resuming *after* `normalize` indexed it, must be reflected in the counts (and the
  watcher must wait for it) — this is the "different indexing attempts ride the same promise"
  case; also assert no duplicate writebacks fire.
- copies: COW of an unindexed source carries no counter META; COW of an indexed source
  is indexed with snapshotted totals.
- eager boundary validation: an external writeback resolving to a value that reaches
  the written target commits an Error at the key immediately — under an UNINDEXED
  target (the `node === target` reachability descent) and under an indexed one (the
  ancestor closure); the tree never contains a cycle, even transiently. Same pair of
  cases for a frozen violation inside the resolved value.
- settlement semantics: after `h = hasError(root, ["b"])`, a synchronous `assignPath`
  adding an Error into owned `b` IS reflected (`h` → true), and a plain write after
  `normalize` on an owned branch appears in its result — both ops observe the settled
  branch, they do not snapshot it. Neither sets the SHARED mark at call time
  (`hasError` never, `normalize` only on its return at completion) — while both DO
  index: assert META is present and maintained after a first `hasError`, and that a
  second `hasError` on the same branch performs no rescan (O(1) after settlement).
- wrapper-only scheduling: no `queueMicrotask`/`setTimeout` anywhere in index.js
  (greppable); the zero-verification rides `onResolve` on the settling promise, so
  it runs after every consumer already registered on that promise — assert ordering
  against an earlier-issued suspended write that re-arms the count.
- frozen node containing a promise or Error anywhere beneath (including via an
  extensible descendant) → Error; valid frozen subtree stays zero-metadata.

Consistency oracle (the rejected full-recompute design, in its right home):
- a test-only `verifyRefCounts(...roots)` builds a closure over BOTH child keys and
  `parents` edges (upward) — disconnected-but-retained COW worlds are included
  automatically: the same strong parent edges that create them also make them
  reachable for verification. It then recomputes every node's totals from scratch
  and asserts they equal the stored counters, and that every stored `parents` edge is
  mirrored by an actual live key reference (and vice versa, with matching
  multiplicity) within the closure. Run it after every operation
  in the counting tests — any incremental-bookkeeping drift fails loudly at the op
  that caused it, giving the self-healing benefit of a recompute design with zero
  runtime cost.

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
  and ops on never-indexed data behave bit-for-bit like the base kernel.
- unhandled-rejection guard: whole matrix runs under a `process.on("unhandledRejection")`
  sentinel, per basics item 2.
