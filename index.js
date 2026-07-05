// ─── Notation ───────────────────────────────────────────────────────────────
//   a.k.y = 1   → assignPath(a, ['k','y'], 1)
//   = a.k.y     → lookupPath(a, ['k','y'])
//   delete a.k  → deletePath(a, ['k'])
//   P(V)        → a promise P that resolves to immutable value V
//
// A "record" {promise, current} lives at node[PROMISES_CURRENT][key]:
//   promise : the exact instance last placed at this edge (identity guard)
//   current : the newest version of its resolved value, V → V′ → V″,
//             each op reading the latest current and storing its COW back.
// The FIFO order of continuations on one promise = program order, for free.
//
// A record is born at three points — PLACEMENT, DISCOVERY, FORK. Only the
// first two seed `current` from the raw resolved value. A FORK (shallow copy
// of a node whose edge holds a promise) seeds from the SOURCE record's
// `current` at the copier's FIFO slot: the copied world branches off at
// exactly the copier's position in program order.

const PROMISES_CURRENT = Symbol("promises_current")

// ─── Assumed primitives ──────────────────────────────────────────────────────
function isPromise(x)  { /* is x a promise */ }
function isError(x)    { /* is x a language Error node */ }
function isTracked(x)  { /* x is a tracked object/array (not a primitive) */ }
function isShared(x)   { /* IMMUTABLE-marked OR (if RC) refcount > 1 */ }
function isMissing(x)  { return x === undefined || x === null }
function isArray(x)    { /* is x an array */ }
function onResolve(p, fn) { /* p.then(fn); FIFO among continuations on p */ }
function markImmutable(x) { /* set the IMMUTABLE mark on an object/array */ }
function propagateClean(parent, key) { /* settled promise removed → clean bookkeeping */ }
function updateCleanCounts(parent, key) { /* adjust counts for the written edge */ }
function resetMetadata(copy) { /* fresh mark state, empty parents, recomputed counts */ }

// ─── Hidden shadow map ───────────────────────────────────────────────────────
function shadowMap(node) {
    let map = node[PROMISES_CURRENT]
    if (map === undefined) {
        map = Object.create(null)                    // null proto: no inherited keys
        Object.defineProperty(node, PROMISES_CURRENT, {
            value: map, enumerable: false, writable: true, configurable: true,
        })
    }
    return map
}

// PLACEMENT / DISCOVERY initializer: marks the resolved value immutable, then
// seeds `current` with it and mirrors it into the property — but only if THIS
// record still owns the key and the property still holds the promise unchanged.
// The mark is load-bearing: it is what makes every consumer's advance COW
// (V → V′) instead of mutating V in place, and what keeps two edges holding
// the same promise (a.k = P; b.m = P) from corrupting each other through the
// shared resolved value.
// Keyed on record identity, not promise identity: survives a.k = P … a.k = P.
// (The FORK birth point uses its own initializer — see forkPromiseEdges.)
function registerWriteback(node, key, rec) {
    onResolve(rec.promise, v => {
        if (isTracked(v)) markImmutable(v)           // BEFORE any consumer can observe it
        rec.current = v                              // slot ← V (the initializer)
        const map = node[PROMISES_CURRENT]
        if (map && map[key] === rec && node[key] === rec.promise) {
            node[key] = v
            propagateClean(node, key)
        }
        // else a later op reassigned/deleted the edge: keep current alive
        // privately for reads that captured this record; leave the property alone.
    })
}

// BIRTH 1 — PLACEMENT: assigning a promise to an edge. Always a FRESH record,
// overwriting any prior one — two placements of the same promise at the same
// edge are divergent worlds and must not share a chain.
function placePromise(node, key, promise) {
    const rec = { promise, current: undefined }      // current overwritten before any read
    shadowMap(node)[key] = rec
    registerWriteback(node, key, rec)                // FIRST: the FIFO ordering invariant
    node[key] = promise
    return rec
}

// BIRTH 2 — DISCOVERY: find the record for a pending promise reached during a
// walk, or lazily create one for an orphan (imported data, raw literal).
// COW-copied edges must never arrive here recordless — they are forked eagerly
// in shallowCopy; minting one lazily here would seed from the raw resolved
// value and lose every write made by ops issued before the copy.
function getOrCreatePlacement(node, key, promise) {
    const map = shadowMap(node)
    const existing = map[key]
    if (existing !== undefined && existing.promise === promise) return existing
    const rec = { promise, current: undefined }
    map[key] = rec
    registerWriteback(node, key, rec)
    return rec
}

function clearPlacement(node, key) {
    const map = node[PROMISES_CURRENT]
    if (map) delete map[key]
}

// ─── Copy-on-write ───────────────────────────────────────────────────────────
function cowIfShared(obj) {
    if (!isTracked(obj)) return obj                  // primitives pass through
    if (isShared(obj)) return shallowCopy(obj)       // immutable/shared → copy
    return obj                                        // exclusively owned → mutate in place
}

function shallowCopy(obj) {
    const copy = isArray(obj) ? [...obj] : {...obj}
    // The copy must not drag the source's shadow map along (old edges, foreign
    // world); reset unconditionally so objects and arrays agree.
    delete copy[PROMISES_CURRENT]
    resetMetadata(copy)                              // fresh mark, empty parents, recomputed counts
    forkPromiseEdges(obj, copy)                      // BIRTH 3 — eager, never minted lazily later
    return copy
}

// BIRTH 3 — FORK. For every copied edge holding a promise, mint the copy's
// record NOW, at the copier's program position.
//
// Why eager: a record minted lazily by a later walk would seed `current` from
// the RAW resolved value, stranding every advance (V → V′ → …) made by ops
// issued BEFORE this copy — their writes silently vanish from the copied world.
//
// Why seeding from the source record is correct: this initializer is registered
// at the copier's FIFO slot, so it runs after every continuation of earlier ops
// (their advances are already folded into srcRec.current) and before every
// continuation of later ops. The two worlds diverge at exactly this point in
// program order — uniformly for pending AND settled-but-unreplaced promises.
//
// Why mark the captured value: it is now shared by two worlds, so the first
// advance on either side must COW rather than mutate in place.
//
// Chain advances themselves go through this same shallowCopy, so nested
// promise edges inside resolved values are forked by this same rule too.
function forkPromiseEdges(source, copy) {
    for (const key of Object.keys(copy)) {           // own enumerable keys / array indices
        const p = copy[key]
        if (!isPromise(p)) continue
        const srcRec = getOrCreatePlacement(source, key, p)  // DISCOVERY if the source edge was an orphan;
                                                             // registered before ours → source writeback runs first
        const rec = { promise: p, current: undefined }
        shadowMap(copy)[key] = rec
        onResolve(p, () => {                         // registered at the COPIER's program position
            const v = srcRec.current                 // chain state as of the copier's position in program order
            if (isTracked(v)) markImmutable(v)       // shared by two worlds now
            rec.current = v
            const map = copy[PROMISES_CURRENT]
            if (map && map[key] === rec && copy[key] === p) {
                copy[key] = v                        // mirror, same guard as registerWriteback
                propagateClean(copy, key)
            }
        })
    }
}

// ─── assignPath :  a.k.y = 1 ─────────────────────────────────────────────────
async function assignPath(root, path, value) {
    root = cowIfShared(root)                          // root COW decided synchronously
    if (isError(root)) return root                    // into an error root → no-op
    if (isPromise(root)) return deriveRootAssign(root, path, value)  // sole async-return case

    let parent = root
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i]
        let child = parent[key]

        if (isPromise(child)) {
            const rec = getOrCreatePlacement(parent, key, child)
            await child                               // enqueues AFTER writeback (FIFO)
            // resume-slice is synchronous to the next suspension; read input first:
            const before = rec.current                // earlier ops' mutations already folded in
            const next   = cowIfShared(before)        // V → V′  (V′ → V″ for a later op)
            rec.current  = next
            const map = parent[PROMISES_CURRENT]
            if (map[key] === rec && parent[key] === before)   // record owns key AND value unchanged
                parent[key] = next
            parent = next
            continue
        }

        if (isError(child)) return root               // no-op into an error branch

        if (isMissing(child)) child = {}              // create missing intermediate
        else                  child = cowIfShared(child)

        parent[key] = child                           // top-down incremental install
        parent = child
    }

    const lastKey = path[path.length - 1]
    if (isError(parent[lastKey])) return root
    if (isPromise(value)) placePromise(parent, lastKey, value)
    else {
        clearPlacement(parent, lastKey)               // plain value ends any prior chain's ownership
        parent[lastKey] = value
    }
    updateCleanCounts(parent, lastKey)
    return root
}

// ─── lookupPath :  = a.k.y ───────────────────────────────────────────────────
async function lookupPath(root, path) {
    let parent = root
    if (isPromise(parent)) parent = await deriveRoot(parent)

    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i]
        const child = parent[key]

        if (isPromise(child)) {
            const rec = getOrCreatePlacement(parent, key, child)
            await child
            parent = rec.current                      // continue through CURRENT, never raw V
            continue
        }
        if (isError(child))   return child            // Error return feeds guard/recover
        if (isMissing(child)) return undefined
        parent = child
    }

    const lastKey = path[path.length - 1]
    const val = parent[lastKey]
    if (isError(val)) return val

    if (isPromise(val)) {
        const rec = getOrCreatePlacement(parent, lastKey, val)
        // Ends AT a promise → return a DERIVED promise resolving to current at OUR
        // resume moment: includes earlier ops' advances, excludes later ops'.
        return resolveThenMark(val, () => rec.current)
    }

    if (isTracked(val)) markImmutable(val)            // escaping object/array → immutable
    return val
}

// Not awaited by lookup itself — values resolve at the point of consumption.
async function resolveThenMark(promise, readCurrent) {
    await promise
    const v = readCurrent()
    if (isTracked(v)) markImmutable(v)                // resolved escaping value → immutable
    return v
}

// ─── deletePath :  delete a.k ────────────────────────────────────────────────
async function deletePath(root, path) {
    root = cowIfShared(root)
    if (isError(root))   return root
    if (isPromise(root)) return deriveRootDelete(root, path)

    let parent = root
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i]
        let child = parent[key]

        if (isPromise(child)) {
            const rec = getOrCreatePlacement(parent, key, child)
            await child
            const before = rec.current
            const next   = cowIfShared(before)
            rec.current  = next
            const map = parent[PROMISES_CURRENT]
            if (map[key] === rec && parent[key] === before) parent[key] = next
            parent = next
            continue
        }
        if (isError(child))   return root             // no-op through an error branch
        if (isMissing(child)) return root             // nothing to delete
        child = cowIfShared(child)
        parent[key] = child
        parent = child
    }

    const lastKey = path[path.length - 1]
    if (isError(parent[lastKey])) return root
    clearPlacement(parent, lastKey)                   // drop shadow entry: no later writeback re-mirrors
    delete parent[lastKey]
    updateCleanCounts(parent, lastKey)
    return root
}