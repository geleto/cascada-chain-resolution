# Subtree counters, `normalize`, `hasError` — step-by-step implementation

Implements issues.md items 8–12 against the current kernel (index.js / helpers.js).
"Refcounting" throughout means **subtree promise/error counting** (issues #8): we count
pending promises and Error values reachable below each node, never references —
ownership/COW stays mark-based. Spec reference: initial-spec.md, "Subtree counters".

Ground rules for the whole sequence:

- Each step ends with the full suite green (64 tests + the new ones added along the way).
  Steps 1 and 2 are behavior-neutral refactors; counting only goes live in step 3.
- Four pillars that every piece of pseudocode below serves:
  1. **Counters have no safe default** — `parents` edges are exact or the counts lie.
  2. **Two thin write helpers** — `setProperty`/`deleteProperty` own all counter
     bookkeeping; no bare `node[key] =` / `delete node[key]` outside them (two
     sanctioned exceptions, listed in step 2). Promise mirrors are deliberately not
     their concern — mirror lifecycle stays at the operation sites, as in the current
     kernel. A full-recompute variant was considered and rejected for the runtime path
     (it moves complexity rather than removing it); it survives as the test-suite
     consistency oracle (step 5).
  3. **Acyclicity is load-bearing** — delta propagation loops forever on a cycle. All
     cycle checking lives in adoption of external data (two-color for in-value cycles,
     ancestor closure for writeback back-edges) and nowhere else: internal ops cannot
     create cycles because COW copies the target before a self-referencing set
     (`a.property = a` installs the pre-copy `a` into the new copy).
  4. **Zero is edge-triggered and verified asynchronously** — never fire a watcher
     synchronously; always re-check.

---

## Step 1 — Unify metadata under one `META` Symbol (behavior-neutral)

Fold `PROMISE_MIRRORS` and `IMMUTABLE` (index.js:37–38) into a single record. Also fold
in basics item 1 here (non-extensible ⇒ immutable), since `hasImmutableMark` is being
rewritten anyway.

```js
const META = Symbol("META")

function createMeta() {
    return {
        immutable: false,   // set once, never cleared; false at birth = old "no mark"
        mirrors: null,      // lazy Object.create(null) — the promise mirror map
        adopted: false,     // counters valid ONLY when true (step 3)
        pendingCount: 0,
        errorCount: 0,
        parents: null,      // lazy Map<parentNode, edgeCount> (step 3)
        watchers: null,     // lazy array of resolve fns (step 4)
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
function hasImmutableMark(value) {
    return isTracked(value) &&
        (metaOf(value)?.immutable === true || !Object.isExtensible(value))
}

function markImmutable(value) {
    if (isPromise(value)) return settlePromise(value).then(markImmutable)
    if (!isTracked(value) || !Object.isExtensible(value)) return value  // frozen: implicit
    ensureMeta(value).immutable = true
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
and put forked mirrors into `copyMeta.mirrors`. Counter fields stay zero/false — dormant
until step 3.

**Checkpoint:** all 64 tests pass; the frozen-import probe no longer throws.

---

## Step 2 — Route every property write through `setProperty`/`deleteProperty` (behavior-neutral)

Two thin helpers that today just perform the write; step 3 fills in the counting. They
own **only** counter bookkeeping — promise mirror lifecycle (creation, clearing,
`canUpdateMirrorToLive` guards) stays at the operation sites exactly as in the current
kernel. The helpers need no mirror awareness because a promise physically at the key
counts as (1,0) through `countsOf`, so assign/writeback/delete deltas come out right
automatically. The existing structure — `walkMutationPath`, the `onTarget` callbacks —
is preserved; this step is a minimal, greppable substitution of the bare writes.

```js
function setProperty(parent, key, value) {
    // step 3: adopt entering value; delta = countsOf(new) − countsOf(old);
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

Two **sanctioned bypasses** (pin as comments, they are the only ones):

1. `shallowCopy`'s key loop — the copy is unobservable during construction and (step 3)
   its totals are snapshotted, so per-key deltas would be zero-sum noise.
2. Blank `{}` intermediates minted by `walkMutationPath` — created empty, trivially
   adopted at birth (step 3: `adopted: true`, counts 0); their installation into the
   tree *does* go through `setProperty`.

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
        const meta = metaOf(value)
        // callers guarantee adoption before counting (commitSet adopts newValue;
        // parents in the tree are adopted by construction)
        return [meta.pendingCount, meta.errorCount]
    }
    return [0, 0]                             // primitive / null / undefined / hole
}

function applyCountDelta(node, dPending, dError) {
    if (dPending === 0 && dError === 0) return
    const meta = metaOf(node)                 // exists: only adopted nodes propagate
    meta.pendingCount += dPending
    meta.errorCount += dError
    if (meta.watchers !== null && meta.pendingCount === 0 && dPending < 0) {
        scheduleVerify(node)                  // step 4; zero-crossing, edge-triggered
    }
    if (meta.parents !== null) {
        for (const [parent, multiplicity] of meta.parents) {
            applyCountDelta(parent, dPending * multiplicity, dError * multiplicity)
        }
    }
    // termination: acyclic by invariant — adoption rejects cycles (3b)
}

function addParentEdge(child, parent) {       // child tracked & extensible & adopted
    const meta = ensureMeta(child)
    meta.parents ??= new Map()
    meta.parents.set(parent, (meta.parents.get(parent) ?? 0) + 1)
}

function removeParentEdge(child, parent) {
    const parents = metaOf(child)?.parents
    if (!parents) return
    const n = parents.get(parent)
    if (n === 1) parents.delete(parent)
    else if (n !== undefined) parents.set(parent, n - 1)
}
```

Invariant worth a comment: **a node's `parents` always reflect exactly the live keys
referencing it.** Commits maintain this, which is why a disconnected world's deltas
(revoked mirrors advancing `currentValue`) can never reach a world that doesn't
reference the value — exact per world, no special-casing.

The flip side, stated honestly: with strong edges, every COW'd-away world remains
referenced by its reused children and keeps receiving deltas, so per-delta propagation
cost grows with the COW history of a hot key — a **time** tax, not just memory. The
sandbox accepts this (short-lived runs); the real implementation requires WeakRef
edges pruned on dead deref to bound both.

### 3b. The adoption walker (absorbs `scanImportedValue`)

One eager walk for any structure entering tracking. This is also the **only** place
cycle checking exists: cycles can enter solely through external data (import,
externally-resolved writeback values) — internal operations cannot create them, because
COW copies the target before a self-referencing set. Two-color marking: `visiting`
(a Set carried by the walk — the current descent stack) and `adopted` (the black mark).
Reaching a *visiting* node is a cycle → Error. Reaching an *adopted* node is a DAG
share → register the edge, reuse totals, don't recurse.

```js
// Returns value, or an Error node (cycle / frozen violation) the caller commits instead.
// backEdgeTarget is non-null only for externally-resolved writeback values: the node
// being written into. Its ancestor closure is computed LAZILY — only when the walk
// actually encounters an already-adopted node. Every ancestor is adopted by definition,
// and fresh external data contains no adopted nodes, so the hot writeback path never
// pays for the closure.
function adoptValue(value, backEdgeTarget = null) {
    if (!isTracked(value)) return value       // counted at the edge by countsOf
    let ancestorGuard = null                  // lazy ancestorClosure(backEdgeTarget),
                                              // includes the target itself
    const failure = adopt(value, new Set())
    return failure ?? value

    function adopt(node, visiting) {          // returns Error on violation, else null
        if (!Object.isExtensible(node)) {
            return validateFrozenSubtree(node, new Set())   // frozen rule, below
        }
        if (visiting.has(node)) {
            return new Error("Cycle in adopted data")
        }
        const meta = ensureMeta(node)
        if (meta.adopted) {
            // An adopted node inside external data is the only place a back-edge can
            // hide (ancestors are always adopted) — check it here, and only here.
            if (backEdgeTarget !== null) {
                ancestorGuard ??= ancestorClosure(backEdgeTarget)
                if (ancestorGuard.has(node)) {
                    return new Error("Cycle: adopted value reaches its own ancestor")
                }
            }
            return null                       // DAG share: totals reusable as-is
        }
        visiting.add(node)
        let pending = 0, errors = 0
        for (const key of Object.keys(node)) {
            const child = node[key]
            if (isPromise(child)) {
                pending += 1
                getOrCreatePromiseMirror(node, key, child)  // Discovery, EAGER:
                // nothing rescans anymore — an orphan promise with no writeback
                // would hold pendingCount up forever
            } else if (isError(child)) {
                errors += 1                    // imported Errors are language errors
            } else if (isTracked(child)) {
                const failure = adopt(child, visiting)
                if (failure) return failure
                const [cp, ce] = countsOf(child)
                pending += cp; errors += ce
                addParentEdge(child, node)
            }                                  // primitives contribute nothing
        }
        visiting.delete(node)
        meta.pendingCount = pending
        meta.errorCount = errors
        meta.adopted = true
        return null
    }

    // Non-extensible nodes may not contain promises or Errors ANYWHERE beneath
    // (extensible descendants included). Valid frozen subtrees carry no metadata:
    // no counters, no parents, no mirrors — countsOf reports (0,0) by rule.
    function validateFrozenSubtree(node, seen) {
        if (seen.has(node)) return new Error("Cycle in adopted data")
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

function ensureAdopted(node) {                // lazy entry for raw roots handed to ops
    const meta = ensureMeta(node)
    if (!meta.adopted) adoptValue(node)
    return meta
}
```

Callers of `adoptValue`:
- `import` → `importResolvedValue` becomes `markImmutable(value)` + `adoptValue(value)`
  (replaces `scanImportedValue`; the per-promise "mark resolved value" continuations
  stay as today).
- `commitSet` → adopts `newValue` before counting it; passes the ancestor guard only on
  the writeback path (externally-resolved values are where back-edges can enter).
- `ensureAdopted(parent)` at the top of both commit helpers, and on op entry for roots.

### 3c. Filling in the write helpers

```js
function setProperty(parent, key, value) {
    ensureAdopted(parent)
    value = adoptValue(value)                     // raw structure entering the tree;
                                                  // already-adopted values pass through
    const old = parent[key]                       // may be the promise being replaced:
    const [oldP, oldE] = countsOf(old)            //   counts (1,0) with zero mirror logic
    const [newP, newE] = countsOf(value)
    if (isTracked(old) && Object.isExtensible(old)) removeParentEdge(old, parent)
    if (isTracked(value) && Object.isExtensible(value)) addParentEdge(value, parent)
    parent[key] = value
    applyCountDelta(parent, newP - oldP, newE - oldE)
    return value                                  // may be an Error (frozen/cycle violation)
}

function deleteProperty(parent, key) {
    ensureAdopted(parent)
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
`onResolvedValue` pre-adopts with the back-edge guard before writing, because
externally-resolved values are the one place a cycle can enter:

```js
// inside onResolvedValue, before the canUpdateMirrorToLive guard:
value = adoptValue(value, node)   // back-edge target; closure computed lazily,
                                  // only if an adopted node is actually encountered
```

Why the deltas compose without double counting, in both walk shapes:

- **In-place mutation** (owned child): no install commit at the parent; the deeper
  commit's delta propagates up through the child's existing `parents` edge. Exact.
- **COW install**: the copy's subtree is mutated while the copy still has empty
  `parents` (deltas stop at the copy); the install commit then computes
  `countsOf(finalCopy) − countsOf(oldChild)` in one step. Exact, no double path.

### 3d. `shallowCopy` (sanctioned bypass, one constructor expression)

```js
function shallowCopy(obj, pathKey, markReusedChildrenImmutable) {
    const srcMeta = ensureAdopted(obj)
    const copy = isArray(obj) ? new Array(obj.length) : {}
    const copyMeta = createMeta()
    copyMeta.adopted = true
    copyMeta.pendingCount = srcMeta.pendingCount   // identical keys ⇒ identical totals,
    copyMeta.errorCount = srcMeta.errorCount       // incl. (1,0) per forked promise key
    // immutable stays false (the copy is owned); parents stays empty (the copy's own
    // edge is added when the caller installs it); watchers stays null
    defineMeta(copy, copyMeta)

    for (const key of Object.keys(obj)) {
        const value = obj[key]
        copy[key] = value                          // bypass: copy not yet observable
        if (isPromise(value)) {
            // BIRTH 3 — FORK, exactly as today, into copyMeta.mirrors
        } else if (isTracked(value)) {
            if (Object.isExtensible(value)) addParentEdge(value, copy)
            if (markCopiedValueImmutable) markImmutable(value)
        }
    }
    return copy
}
```

The fork initializer needs no counter code: when it later commits the captured value
into the copy's key it goes through `setProperty(copy, key, value)` with its mirror
kept untouched, replacing the snapshotted (1,0) with `countsOf(value)` — uniform with
every other writeback.

**Checkpoint:** all prior tests pass, plus new count-assertion tests (step 5 list).

---

## Step 4 — Zero-watchers, `normalize`, `hasError`

```js
function whenQuiescent(node) {                    // node: tracked, adopted
    const meta = ensureAdopted(node)
    return new Promise(resolve => {
        meta.watchers ??= []
        meta.watchers.push(resolve)
        if (meta.pendingCount === 0) scheduleVerify(node)   // subscribe-at-zero:
        // without this, no delta ever comes and the watcher never fires
    })
}

function scheduleVerify(node) {
    queueMicrotask(() => {                        // NEVER fire synchronously
        const meta = metaOf(node)
        if (meta.watchers !== null && meta.pendingCount === 0) {
            const watchers = meta.watchers
            meta.watchers = null
            for (const fire of watchers) fire()
        }
        // else: a queued consumer re-armed the count — stay subscribed; the next
        // zero-crossing in applyCountDelta re-schedules. O(1) per iteration; this
        // is the counter form of "repeat scanning until quiescent".
    })
}
```

Why `queueMicrotask` + re-check is correct: the zero-crossing happens inside one
continuation of some promise P; suspended remainders of *earlier-issued* ops are
continuations registered on P *before* ours, so their commit jobs are already in the
microtask queue ahead of the verification we enqueue now. If any of them installs a new
promise, the re-check sees `pendingCount > 0` and stays armed.

```js
function normalize(root, full = false) {
    if (isPromise(root)) return settlePromise(root).then(r => normalize(r, full))
    if (isError(root) || !isTracked(root)) return Promise.resolve(root)
    return whenQuiescent(root).then(() => {
        if (metaOf(root).errorCount > 0) {
            return new Error("normalize: branch contains errors")   // sandbox collapse
        }
        if (full) return copyFull(root, new Map())
        markImmutable(root)                        // marks stay; branch is settled
        return root
    })
}

// Plain data out: no META, no marks — the value leaves the runtime.
// The identity map is consulted BEFORE recursing — one map, two rules:
// visited-gate (termination) and identity-reuse (lookup-shared diamonds must not
// duplicate; COW deliberately does not preserve internal aliasing, copyFull does).
function copyFull(value, identityMap) {
    if (!isTracked(value)) return value            // quiescent: no promises/errors left
    const existing = identityMap.get(value)
    if (existing !== undefined) return existing
    const copy = isArray(value) ? new Array(value.length) : {}
    identityMap.set(value, copy)                   // before children (defensive)
    for (const key of Object.keys(value)) copy[key] = copyFull(value[key], identityMap)
    return copy
}

function hasError(root, segments) {
    const reached = lookupPath(root, segments, false)   // inspection: no ownership
    return Promise.resolve(check(reached))

    function check(value) {
        if (isPromise(value)) return settlePromise(value).then(check)
        if (isError(value)) return true
        if (value === undefined) return true            // path failure, per spec
        if (!isTracked(value)) return false             // reached a clean primitive
        return whenQuiescent(value).then(() => metaOf(value).errorCount > 0)
    }
}
```

`hasError` waits for the reached branch's quiescence because program-order semantics
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
  that itself contains promises (adoption at writeback).
- rejected promise: (1,0) → (0,1) at the same key; `errorCount` visible at the root.
- COW fork: after copying a node with a pending key, both worlds count it; each world's
  counts diverge with subsequent writes; revoked-mirror advances change no live counts.
- delete of a promise key revokes writeback *and* decrements `pendingCount`.

Adoption:
- raw root handed to an op is adopted lazily; imported structures adopt eagerly with
  mirrors minted for every promise key.
- DAG in adopted value: shared node counted via both edges, scanned once.
- cycle inside an adopted value → Error committed; external writeback resolving to an
  ancestor of the target → Error committed (back-edge closed).
- frozen node containing a promise or Error anywhere beneath (including via an
  extensible descendant) → Error; valid frozen subtree adopts with zero metadata.

Consistency oracle (the rejected full-recompute design, in its right home):
- a test-only `verifyRefCounts(root)` recomputes every reachable node's totals from
  scratch (own keys, children via recursion) and asserts they equal the stored
  counters, and that every stored `parents` edge is mirrored by an actual live key
  reference (and vice versa, with matching multiplicity). Run it after every operation
  in the counting tests — any incremental-bookkeeping drift fails loudly at the op
  that caused it, giving the self-healing benefit of a recompute design with zero
  runtime cost.

Quiescence / normalize / hasError:
- `normalize` on an already-quiescent branch resolves (subscribe-at-zero verify).
- watcher re-arms when a queued earlier-op remainder installs a new promise at the
  zero-crossing (the deferred-verification race).
- `normalize` collapse on any error; `normalize(full)` output has no META/marks, is
  fully mutable, and preserves diamond identity (two paths to one object → one copy).
- `hasError`: error at target, error mid-path, path failure → true; clean branch →
  false; pending branch answers only after quiescence and reflects earlier-issued
  suspended writes.
- unhandled-rejection guard: whole matrix runs under a `process.on("unhandledRejection")`
  sentinel, per basics item 2.
