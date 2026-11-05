// Run: node test/experiments/array-layout-technical-probes.mjs
// Design probes, not a production Array evaluator or a replacement for integration tests.
// Native Arrays are the successful-layout oracle; failed controls keep their domains.
import assert from 'node:assert/strict'
import { Execution } from '../../src/index.js'
import * as metadata from '../../src/meta.js'
import { initializePlacements, initializeHolder, activateRelationships, addParent,
    getParentPlacements } from '../../src/parent-placements.js'
import { runGraphTransition, releasePin, reconsider } from '../../src/ownership.js'

const READY = 0, PENDING = 1, FAILED = 2
const SPAN = 0, DROP = 1, INSERT = 2
const ready = value => ({ state: READY, value })
const pending = () => ({ state: PENDING })
const failed = cause => ({ state: FAILED, cause })
const report = {}

// 1. A deliberately small method-specific evaluator. It does not enumerate controls.
// Shape refers only to scalar control facts; selectors retain captured cell identities.
class Control {
    constructor(min, max) { this.min = min; this.max = max; this.state = PENDING }
    settle(value) {
        assert(value >= this.min && value <= this.max)
        this.min = this.max = value
        this.state = READY
    }
    reject() { this.state = FAILED; this.cause = new Error('control failed') }
    unknown() { return this.state === FAILED ? failed(this.cause) : pending() }
}
const cells = n => Array.from({ length: n }, (_, index) => ({ index }))
const span = values => ({ kind: SPAN, values })
const drop = (values, control) => ({ kind: DROP, values, control })
const insert = (values, control, inserted) => ({ kind: INSERT, values, control, inserted })
function bounds(part) {
    if (part.kind === SPAN) return [part.values.length, part.values.length]
    if (part.kind === INSERT) {
        const n = part.values.length + part.inserted.length
        return [n, n] // Correlated pieces total L+k even while the boundary is unknown.
    }
    return [part.values.length - part.control.max, part.values.length - part.control.min]
}
function shape(parts) {
    return parts.map(bounds).reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0])
}
function inRange(parts, index) {
    const [min, max] = shape(parts)
    if (index < min) return ready(true)
    if (index >= max) return ready(false)
    const controls = parts.filter(p => bounds(p)[0] !== bounds(p)[1]).map(p => p.control)
    return controls.some(c => c.state === PENDING) ? pending() : failed(controls[0].cause)
}
function selectPart(part, index, fromEnd) {
    const n = part.values.length
    if (part.kind === SPAN) return ready(part.values[fromEnd ? n - 1 - index : index])
    const control = part.control
    if (part.kind === DROP) {
        if (fromEnd) return ready(part.values[n - 1 - index])
        return control.min === control.max ? ready(part.values[index + control.min]) : control.unknown()
    }
    if (fromEnd) index = n + part.inserted.length - 1 - index
    if (index < control.min) return ready(part.values[index])
    if (index >= control.max + part.inserted.length) return ready(part.values[index - part.inserted.length])
    if (control.min !== control.max) return control.unknown()
    return index < control.min + part.inserted.length ? ready(part.inserted[index - control.min]) :
        ready(part.values[index - part.inserted.length])
}
function select(parts, index, fromEnd = false) {
    for (const part of fromEnd ? parts.toReversed() : parts) {
        const [min, max] = bounds(part)
        if (index < min) return selectPart(part, index, fromEnd)
        if (index >= max && min === max) { index -= max; continue }
        // The probe handles endpoint-independent facts and one uncertain region.
        // A general candidate selector is intentionally not implemented here.
        return part.control.unknown()
    }
    return ready(undefined)
}

let factChecks = 0
for (let length = 0; length <= 7; length++) {
    const source = cells(length), x = { x: true }, z = { z: true }
    for (let start = 0; start <= length; start++) {
        const count = new Control(0, length - start)
        const beforeAppend = [span(source.slice(0, start)), span([x]), drop(source.slice(start), count)]
        const output = [...beforeAppend, span([z])]
        const expectedMin = start + 2, expectedMax = length + 2
        assert.deepEqual(shape(output), [expectedMin, expectedMax]); factChecks++
        for (const reject of [false, true]) {
            if (reject) count.reject()
            for (let i = 0; i < expectedMin; i++) {
                assert.deepEqual(inRange(output, i), ready(true)); factChecks++
            }
            for (let i = 0; i < start; i++) {
                assert.equal(select(output, i).value, source[i]); factChecks++
            }
            assert.equal(select(output, start).value, x)
            assert.equal(select(output, 0, true).value, z)
            // Reverse's front query is the predecessor's back query.
            assert.equal(select(output, 0, true).state, READY)
            assert.deepEqual(inRange(output, expectedMax), ready(false)); factChecks += 4
            if (expectedMin < expectedMax)
                assert.equal(inRange(output, expectedMin).state, reject ? FAILED : PENDING)
        }
        for (let d = 0; d <= length - start; d++) {
            const settled = new Control(0, length - start); settled.settle(d)
            const layout = [span(source.slice(0, start)), span([x]), drop(source.slice(start), settled), span([z])]
            const native = source.slice(); native.splice(start, d, x); native.push(z)
            assert.deepEqual(shape(layout), [native.length, native.length])
            for (let i = 0; i < native.length; i++) {
                assert.equal(select(layout, i).value, native[i])
                assert.equal(select(layout, i, true).value, native.at(-1 - i)); factChecks += 2
            }
        }
    }
    const at = new Control(0, length), inserted = insert(source, at, [x])
    assert.deepEqual(shape([inserted]), [length + 1, length + 1])
    at.reject()
    assert.deepEqual(shape([inserted]), [length + 1, length + 1]); factChecks += 2
}

// One repeated guard has one captured meaning. Newer writes replace its older arm.
const guard = {}, base = {}, x = {}, y = {}
function choose(condition, yes, no) {
    if (no?.condition === condition) no = no.no
    return yes === no ? yes : { condition, yes, no }
}
const reduced = choose(guard, y, choose(guard, x, base))
assert.deepEqual(reduced, { condition: guard, yes: y, no: base })
let repeated = base
for (let i = 0; i < 20000; i++) repeated = choose(guard, { i }, repeated)
assert.equal(repeated.no, base)
report.facts = { checks: factChecks, repeatedGuardWrites: 20000, retainedChoiceDepth: 1 }

// Ready count transforms close over one clamped-affine form. No linked shape history.
// The upper clamp is a semantic slice bound, never a way to hide capacity overflow.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
function transformCount(fact, offset, lo = 0, hi = Infinity) {
    const next = { base: fact.base, offset: fact.offset + offset,
        lo: clamp(fact.lo + offset, lo, hi), hi: clamp(fact.hi + offset, lo, hi) }
    const minimum = clamp((next.base?.min ?? 0) + next.offset, next.lo, next.hi)
    const maximum = clamp((next.base?.max ?? 0) + next.offset, next.lo, next.hi)
    return minimum === maximum ? { base: undefined, offset: minimum, lo: minimum, hi: minimum } : next
}
const countValue = (fact, base) => clamp((fact.base ? base : 0) + fact.offset, fact.lo, fact.hi)
let countChecks = 0
{
    const base = { min: 0, max: 8 }, original = { base, offset: 0, lo: 0, hi: Infinity }
    let current = original, expected = Array.from({ length: 9 }, (_, i) => i)
    const captures = []
    for (let i = 0; i < 10000; i++) {
        if (i % 1000 === 0) captures.push({ fact: current, expected: expected.slice() })
        current = transformCount(transformCount(current, 2), -1)
        expected = expected.map(n => Math.max(0, n + 2 - 1))
        for (let value = 0; value <= 8; value++) {
            assert.equal(countValue(current, value), expected[value]); countChecks++
        }
    }
    assert.equal(current.base, base)
    assert.equal(current.offset, 10000)
    for (const capture of captures) for (let value = 0; value <= 8; value++)
        assert.equal(countValue(capture.fact, value), capture.expected[value])
    base.state = FAILED // An independent zero result discards even a failed base.
    current = transformCount(current, -10008)
    assert.equal(current.base, undefined)
    assert.equal(countValue(current), 0)

    let seed = 991
    for (let run = 0; run < 100; run++) {
        current = original; expected = Array.from({ length: 9 }, (_, i) => i)
        for (let i = 0; i < 100; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
            const amount = seed % 5, kind = seed % 3
            const offset = kind === 0 ? amount : kind === 1 ? -amount : 0
            const upper = kind === 2 ? amount : Infinity
            current = transformCount(current, offset, 0, upper)
            expected = expected.map(n => clamp(n + offset, 0, upper))
            for (let value = 0; value <= 8; value++) {
                assert.equal(countValue(current, value), expected[value]); countChecks++
            }
        }
    }
}
report.countFusion = { checks: countChecks, longHistoryOperations: 20000,
    retainedBaseDepth: 1, capturedShapesUnchanged: true }

// 2. Ordinary persistent nodes already express overlap between live slice uses.
// There is no producer-wide union-of-ranges scan or per-position subscription table.
let nodeId = 0
const liveLeaves = new Set()
function leaf(value) {
    const node = { id: nodeId++, count: 1, uses: 0, value }
    liveLeaves.add(node.id)
    return node
}
function hold(node) { if (node) node.uses++; return node }
function branch(left, right) {
    if (!left) return right
    if (!right) return left
    return { id: nodeId++, count: left.count + right.count, uses: 0, left: hold(left), right: hold(right) }
}
function release(node) {
    const queue = node ? [node] : []
    while (queue.length) {
        const current = queue.pop()
        assert(current.uses > 0)
        if (--current.uses) continue
        if (current.left) queue.push(current.left, current.right)
        else liveLeaves.delete(current.id)
        current.left = current.right = current.value = undefined
    }
}
function build(values) {
    if (values.length === 1) return leaf(values[0])
    const middle = values.length >> 1
    return branch(build(values.slice(0, middle)), build(values.slice(middle)))
}
function slice(node, start, end) {
    if (!node || start >= end || end <= 0 || start >= node.count) return undefined
    if (start <= 0 && end >= node.count) return node
    const middle = node.left.count
    return branch(slice(node.left, start, end), slice(node.right, start - middle, end - middle))
}
class Frontier {
    constructor(root) { this.pending = [hold(root)]; this.issued = 0 }
    next() {
        while (this.pending.length) {
            const node = this.pending.pop()
            if (!node.left) { this.issued++; return node } // Transfer this use to the item handoff.
            this.pending.push(hold(node.right), hold(node.left))
            release(node)
        }
    }
    close() { while (this.pending.length) release(this.pending.pop()) }
}
{
    const root = hold(build(cells(64)))
    const first = hold(slice(root, 0, 16)), overlap = hold(slice(root, 8, 24))
    release(root)
    assert.equal(liveLeaves.size, 24)
    release(first)
    assert.equal(liveLeaves.size, 16)
    release(overlap)
    assert.equal(liveLeaves.size, 0)

    const root2 = hold(build(cells(64))), frontier = new Frontier(root2)
    const shapeOnly = { count: root2.count } // No path back to content nodes.
    release(root2)
    for (let i = 0; i < 32; i++) release(frontier.next())
    assert.equal(liveLeaves.size, 32)
    assert.equal(shapeOnly.count, 64)
    frontier.close()
    assert.equal(liveLeaves.size, 0)

    // [R(width 0..1), Z]: after issuing position 0, the cursor needs only candidate Z.
    // The issued value independently retains both candidates until selection settles.
    const r = leaf({ r: true }), z = leaf({ z: true }), uncertain = hold(branch(r, z))
    const item = hold(uncertain), remainder = hold(slice(uncertain, 1, 2))
    release(uncertain)
    assert.equal(liveLeaves.size, 2)
    release(item)
    assert.equal(liveLeaves.size, 1)
    assert.equal(remainder.value.z, true)
    release(remainder)
    assert.equal(liveLeaves.size, 0)
}
report.ranges = { overlappingSlices: 'released independently', consumedPrefix: 32,
    retainedUnread: 32, unknownBoundary: 'item and remaining candidates separated' }

// Backward demand projection narrows a use without collecting every other use.
// These finite oracles enumerate only in the test; the projectors use interval arithmetic.
function dropDemand(length, minDrop, maxDrop, start, end) {
    const first = Math.min(length, minDrop + start)
    const last = Math.min(length, maxDrop + end)
    return start >= end ? [0, 0] : [first, Math.max(first, last)]
}
function childDemand(prefixMin, prefixMax, childMax, start, end) {
    const first = Math.min(childMax, Math.max(0, start - prefixMax))
    const last = Math.min(childMax, Math.max(0, end - prefixMin))
    return start >= end ? [0, 0] : [first, Math.max(first, last)]
}
let demandChecks = 0
for (let length = 0; length <= 7; length++) for (let lo = 0; lo <= length; lo++)
    for (let hi = lo; hi <= length; hi++) for (let start = 0; start <= length + 1; start++)
        for (let end = start; end <= length + 1; end++) {
            const [first, last] = dropDemand(length, lo, hi, start, end)
            const expected = new Set()
            for (let d = lo; d <= hi; d++)
                for (let i = start; i < Math.min(end, length - d); i++) expected.add(d + i)
            assert.deepEqual(new Set(Array.from({ length: last - first }, (_, i) => first + i)), expected)
            demandChecks++
        }
for (let lo = 0; lo <= 3; lo++) for (let hi = lo; hi <= 3; hi++)
    for (let start = 0; start <= 6; start++) for (let end = start; end <= 6; end++) {
        const [first, last] = childDemand(lo, hi, 2, start, end), expected = new Set()
        for (let prefix = lo; prefix <= hi; prefix++)
            for (let child = 0; child < 2; child++)
                if (prefix + child >= start && prefix + child < end) expected.add(child)
        assert.deepEqual(new Set(Array.from({ length: last - first }, (_, i) => first + i)), expected)
        demandChecks++
    }
report.ranges.backwardDemandChecks = demandChecks

// 3. Compare root-dirty wakeups with change-sensitive semantic propagation.
// Persistent prefix versions of a fixed one-slot Array receive possible index-0 writes.
// Each control contributes 0 or 1 to max(oldLength, contribution), never a larger Array.
const EMPTY = 0, UNKNOWN = 1, PRESENT = 2, ERROR = 3
function merge(a, b) {
    if (a === PRESENT || b === PRESENT) return PRESENT
    if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN
    if (a === ERROR || b === ERROR) return ERROR
    return EMPTY
}
function shapeFixture(size, combine = merge) {
    const nodes = [], leaves = [], roots = []
    function make(left, right, state = UNKNOWN) {
        const node = { left, right, state, parents: [], dirty: false }
        left?.parents.push(node); right?.parents.push(node)
        if (left) node.state = combine(left.state, right.state)
        nodes.push(node)
        return node
    }
    function put(node, lo, hi, index, value) {
        if (hi - lo === 1) return value
        const mid = (lo + hi) >> 1
        if (index < mid) return make(put(node?.left, lo, mid, index, value), node?.right ?? empty)
        return make(node?.left ?? empty, put(node?.right, mid, hi, index, value))
    }
    const empty = make(undefined, undefined, EMPTY)
    let root
    for (let i = 0; i < size; i++) {
        const control = make(); leaves.push(control)
        root = put(root, 0, size, i, control); roots.push(root)
    }
    const rootSet = new Set(roots)
    let visits = 0, wakes = 0
    function refresh(node) {
        if (!node.dirty) return node.state
        visits++
        node.state = combine(refresh(node.left), refresh(node.right))
        node.dirty = false
        return node.state
    }
    function dirtySet(leaf, state) {
        leaf.state = state
        const queue = [...leaf.parents], wake = new Set()
        while (queue.length) {
            const node = queue.pop(); visits++
            if (node.dirty) continue
            node.dirty = true
            if (rootSet.has(node)) wake.add(node)
            queue.push(...node.parents)
        }
        for (const node of wake) { wakes++; refresh(node) }
    }
    function changedSet(leaf, state) {
        leaf.state = state
        const queue = [...leaf.parents]
        while (queue.length) {
            const node = queue.pop(); visits++
            const next = combine(node.left.state, node.right.state)
            if (next === node.state) continue
            node.state = next
            if (rootSet.has(node)) wakes++
            queue.push(...node.parents)
        }
    }
    return { leaves, roots, nodes, dirtySet, changedSet, metrics: () => ({ visits, wakes }) }
}
report.propagation = []
for (const size of [32, 128, 512]) {
    const dirty = shapeFixture(size), changed = shapeFixture(size)
    for (let i = 0; i < size; i++) {
        dirty.dirtySet(dirty.leaves[i], EMPTY)
        changed.changedSet(changed.leaves[i], EMPTY)
        for (let j = 0; j < size; j++) {
            const expected = j <= i ? EMPTY : UNKNOWN
            assert.equal(dirty.roots[j].state, expected)
            assert.equal(changed.roots[j].state, expected)
        }
    }
    assert.equal(changed.metrics().wakes, size)
    assert(changed.metrics().visits <= 4 * changed.nodes.length)
    report.propagation.push({ size, nodes: changed.nodes.length,
        dirty: dirty.metrics(), changed: changed.metrics() })
}
// Last selected write is another associative projection over the same structure.
// A later unresolved write blocks selection; a definite later write masks its prefix.
const lastWrite = (left, right) => right === EMPTY ? left : right
let selectionChecks = 0
for (const order of ['forward', 'reverse', 'shuffled']) {
    const size = 256, f = shapeFixture(size, lastWrite), outcomes = Array(size).fill(UNKNOWN)
    const indexes = Array.from({ length: size }, (_, i) => i)
    if (order === 'reverse') indexes.reverse()
    if (order === 'shuffled') {
        let seed = 123456
        for (let i = size - 1; i; i--) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
            const j = seed % (i + 1)
            ;[indexes[i], indexes[j]] = [indexes[j], indexes[i]]
        }
    }
    for (const i of indexes) {
        outcomes[i] = i % 3 ? EMPTY : i + 4 // Distinct selectors, not equal-payload guesses.
        f.changedSet(f.leaves[i], outcomes[i])
        for (let j = 0; j < size; j++) {
            let expected = EMPTY
            for (let k = j; k >= 0; k--) if (outcomes[k] !== EMPTY) { expected = outcomes[k]; break }
            assert.equal(f.roots[j].state, expected); selectionChecks++
        }
    }
    assert(f.metrics().visits <= 4 * f.nodes.length)
    assert.equal(f.metrics().wakes, size)
}
report.selection = { checks: selectionChecks, schedules: 3, finalNotificationsPerVersion: 1 }
{
    const f = shapeFixture(2)
    f.changedSet(f.leaves[0], ERROR)
    assert.equal(f.roots[1].state, UNKNOWN) // The other write can make this failure irrelevant.
    f.changedSet(f.leaves[1], PRESENT)
    assert.equal(f.roots[1].state, PRESENT)
    const g = shapeFixture(2)
    g.changedSet(g.leaves[0], ERROR)
    g.changedSet(g.leaves[1], EMPTY)
    assert.equal(g.roots[1].state, ERROR) // Failure notification without a narrower [0,1] domain.
}

// 4. Exercise the real retirement and COW machinery with an experiment-only adapter
// for its existing preservation-parent protocol. This is not production layout support.
// The adapter intentionally covers ready captured children only, not pending adoption,
// forward-state restoration, counter summaries, or source-range projection.
function preserve(owner, child, token, context, metrics) {
    activateRelationships(child, context)
    const childMeta = metadata.requireMeta(child, context)
    const parents = childMeta.preservationParents ??= new Map()
    let keys = parents.get(owner)
    if (!keys) parents.set(owner, keys = new Set())
    keys.add(token)
    const ownerMeta = metadata.requireMeta(owner, context)
    const releases = ownerMeta.recoveryUses ??= new Map()
    releases.set(token, () => {
        keys.delete(token)
        if (!keys.size) parents.delete(owner)
        if (!parents.size) delete childMeta.preservationParents
        metrics.released++
        reconsider(child, context)
    })
}
for (const separatelyHeld of [false, true]) {
    const context = { execution: new Execution(), errorContext: {} }, metrics = { released: 0 }
    const array = [], child = { back: array }, root = { value: array }, token = {}
    runGraphTransition(context, () => {
        metadata.getOrCreateMeta(array, context, metadata.TYPE.Array, Array.prototype)
        metadata.getOrCreateMeta(child, context, metadata.TYPE.Record, Object.prototype)
        initializePlacements(array, context)
        initializePlacements(child, context)
        initializeHolder(root, context)
        addParent(array, root, 'value', context)
        preserve(array, child, token, context, metrics)
        if (separatelyHeld) metadata.incrementReadLease(child, context)
    })
    assert(metadata.requiresCopyOnWrite(child, context))
    assert.equal(getParentPlacements(child, context).length, 0) // No guessed Array index.
    assert(metadata.requireMeta(child, context).relationshipsActive)
    runGraphTransition(context, () => releasePin(root, context))
    assert.equal(metadata.requireMeta(child, context).relationshipsActive, separatelyHeld)
    assert.equal(metadata.requireMeta(array, context).relationshipsActive, separatelyHeld)
    if (separatelyHeld)
        runGraphTransition(context, () => metadata.decrementReadLease(child, context))
    assert.equal(metadata.requireMeta(child, context).relationshipsActive, false)
    assert.equal(metadata.requireMeta(array, context).relationshipsActive, false)
    assert.equal(metrics.released, 1)
    assert.equal(metadata.requireMeta(child, context).preservationParents, undefined)
}
report.retirement = { realRuntime: true, guessedParentKeys: 0, unrootedCyclesRetired: 2,
    caveat: 'ready-child preservation adapter; not complete layout integration' }

console.log(JSON.stringify(report, null, 2))
