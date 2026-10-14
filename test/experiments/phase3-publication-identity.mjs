// Design model only: no production imports or loader hooks. Identity decisions
// use supplied producer outcomes; a separate history oracle checks aliases.
import assert from "node:assert/strict"

const PENDING = 0, FRESH = 1, FORWARD = 2

class Identities {
    constructor() {
        this.work = []
        this.draining = false
        this.links = this.notifications = this.merges = this.moves = 0
    }
    fresh() { return { state: FRESH } }
    pending() { return { state: PENDING, size: 1 } }
    root(cell) {
        let root = cell
        while (root.into) { this.links++; root = root.into }
        while (cell.into) {
            const next = cell.into
            cell.into = root
            cell = next
        }
        return root
    }
    publish(cell) {
        const root = this.root(cell)
        assert.equal(root.state, PENDING)
        root.state = FRESH
        root.size = undefined
        this.deliver(root)
        this.drain()
    }
    forward(cell, target) {
        const from = this.root(cell), to = this.root(target)
        assert.equal(from.state, PENDING)
        assert.notEqual(from, to)
        // A terminal root never moves. Only pending/pending joins use weight.
        const winner = to.state === FRESH || to.size >= from.size ? to : from
        const loser = winner === from ? to : from
        if (winner.state === PENDING) winner.size += loser.size
        loser.state = FORWARD
        loser.into = winner
        loser.size = undefined
        const moving = loser.queries
        loser.queries = undefined
        for (const query of moving ?? []) {
            this.moves++
            if (query.left === loser) query.left = winner
            if (query.right === loser) query.right = winner
            if (query.left === query.right || winner.state === FRESH) this.work.push(query)
            else (winner.queries ??= new Set()).add(query)
        }
        moving?.clear()
        this.merges++
        this.drain()
    }
    deliver(root) {
        for (const query of root.queries ?? []) this.work.push(query)
        root.queries = undefined
    }
    drain() {
        if (this.draining) return
        this.draining = true
        try {
            for (let at = 0; at < this.work.length; at++) {
                const query = this.work[at]
                this.work[at] = undefined
                if (!query.open) continue
                this.notifications++
                query.resume()
            }
        } finally { this.work.length = 0; this.draining = false }
    }
    compare(left, right) {
        left = this.root(left); right = this.root(right)
        if (left === right) return true
        return left.state === FRESH && right.state === FRESH ? false : undefined
    }
    watch(left, right) {
        const model = this
        const query = { left, right, answer: undefined, open: true,
            detach() {
                this.left?.queries?.delete(this)
                this.right?.queries?.delete(this)
            },
            close() {
                this.detach()
                this.open = false
                this.left = this.right = undefined
            },
            resume() {
                if (!this.open) return
                this.detach()
                this.left = model.root(this.left)
                this.right = model.root(this.right)
                this.answer = model.compare(this.left, this.right)
                if (this.answer !== undefined) return this.close()
                for (const root of [this.left, this.right]) {
                    if (root.state === PENDING) (root.queries ??= new Set()).add(this)
                }
            },
        }
        query.resume()
        return query
    }
}

// The oracle retains the whole immutable command history for verification only.
// The selected mechanism above retains no predecessor, children, or command log.
function oracleRoot(history, index) {
    while (history[index].state === FORWARD) index = history[index].target
    return index
}
function oracleCompare(history, left, right) {
    left = oracleRoot(history, left); right = oracleRoot(history, right)
    if (left === right) return true
    return history[left].state === FRESH && history[right].state === FRESH ? false : undefined
}
let comparisons = 0
for (let pattern = 0; pattern < 256; pattern++) {
    for (const order of ["oldest", "newest", "mixed"]) {
        const model = new Identities(), cells = [model.fresh(), model.fresh()]
        const history = [{ state: FRESH }, { state: FRESH }]
        for (let index = 2; index < 10; index++) {
            cells.push(model.pending())
            history.push({ state: PENDING, target: index < 5 ? index - 1 : index - 3 })
        }
        const queries = []
        for (let a = 0; a < cells.length; a++) for (let b = a; b < cells.length; b++)
            queries.push({ a, b, query: model.watch(cells[a], cells[b]) })
        const check = () => {
            for (const { a, b, query } of queries) {
                assert.equal(query.answer, oracleCompare(history, a, b))
                assert.equal(model.compare(cells[a], cells[b]), oracleCompare(history, a, b))
                comparisons += 2
            }
        }
        check()
        const indices = order === "oldest" ? [2, 3, 4, 5, 6, 7, 8, 9]
            : order === "newest" ? [9, 8, 7, 6, 5, 4, 3, 2] : [4, 8, 2, 6, 9, 3, 7, 5]
        for (const index of indices) {
            const node = history[index]
            if (pattern & (1 << (index - 2))) {
                node.state = FRESH
                model.publish(cells[index])
            } else {
                node.state = FORWARD
                model.forward(cells[index], cells[node.target])
            }
            check()
        }
        for (const { query } of queries) {
            assert.equal(query.open, false)
            assert.equal(query.left, undefined)
        }
    }
}

// A future entry aliases its final private prefix, including a generation
// created AFTER entry issuance. One extra fresh identity at close is incorrect.
{
    const model = new Identities(), before = model.fresh(), entry = model.pending()
    const inside = model.pending(), comparison = model.watch(entry, inside)
    model.forward(entry, inside)
    assert.equal(comparison.answer, true)
    assert.equal(model.compare(inside, before), undefined)
    model.publish(inside)
    assert.equal(model.compare(entry, inside), true)
    assert.equal(model.compare(entry, before), false)
}

// Pending shared ancestry permits equality after only the forwarding outcome.
// A closed search removes its registrations even if publication never completes.
{
    const model = new Identities(), pending = model.pending(), later = model.pending()
    const same = model.watch(pending, later), other = model.watch(pending, model.fresh())
    model.forward(later, pending)
    assert.equal(same.answer, true)
    assert.equal(other.answer, undefined)
    other.close()
    assert.equal(model.root(pending).queries?.size ?? 0, 0)
    assert.equal(other.left, undefined)
}

const scales = []
for (const size of [128, 512, 2048, 8192]) {
    const model = new Identities(), base = model.pending(), cells = [base]
    for (let i = 0; i < size; i++) cells.push(model.pending())
    const comparison = model.watch(cells.at(-1), base)
    for (let i = size; i > 0; i--) model.forward(cells[i], cells[i - 1])
    assert.equal(comparison.answer, true)
    assert.equal(model.root(base).queries?.size ?? 0, 0)
    let depth = 0, node = cells.at(-1)
    while (node.into) { depth++; node = node.into }
    assert(depth <= Math.ceil(Math.log2(size + 1)))
    assert(model.links < 8 * size)
    // Direct predecessor forwarding would keep `size` links from the last
    // capture after reverse settlement. Weighted union has no backward edges.
    scales.push({ size, directForwardingDepth: size, weightedDepth: depth,
        links: model.links, notifications: model.notifications })
}

// All prefixes remain compared with one unresolved base. Resubscribing every
// query at every alias forwarding would perform N*(N+1)/2 wakeups. Moving only
// registrations in the smaller identity class needs no such wakeup cascade.
const shared = []
for (const size of [128, 512, 2048, 8192]) {
    const model = new Identities(), base = model.pending(), cells = [base]
    const queries = []
    for (let i = 0; i < size; i++) {
        cells.push(model.pending())
        queries.push(model.watch(base, cells.at(-1)))
    }
    for (let i = size; i > 0; i--) model.forward(cells[i], cells[i - 1])
    for (const query of queries) assert.equal(query.answer, true)
    assert.equal(model.notifications, size)
    assert(model.moves <= 2 * size)
    assert.equal(model.root(base).queries?.size ?? 0, 0)
    shared.push({ size, naiveWakeups: size * (size + 1) / 2,
        notifications: model.notifications, registrationMoves: model.moves })
}

// Count forward nodes reachable from ONE old, idle capture after balanced joins.
// This makes the logarithmic retained-redirect limitation explicit.
const redirects = []
for (const size of [128, 512, 2048, 8192]) {
    const model = new Identities(), leaves = Array.from({ length: size }, () => model.pending())
    let layer = leaves.slice()
    while (layer.length > 1) {
        const next = []
        for (let i = 0; i < layer.length; i += 2) {
            model.forward(layer[i], layer[i + 1])
            next.push(layer[i + 1])
        }
        layer = next
    }
    model.publish(layer[0])
    let nodes = 1, at = leaves[0]
    while (at.into) { nodes++; at = at.into }
    assert(nodes <= 1 + Math.log2(size))
    redirects.push({ size, idleCaptureNodes: nodes })
    model.root(leaves[0])
    assert.equal(leaves[0].into.into, undefined)
}

// A settled key stays canonical when a much larger pending class joins it.
const terminalJoins = []
for (const size of [128, 512, 2048, 8192]) {
    const model = new Identities(), terminal = model.fresh()
    const leaves = Array.from({length: size}, () => model.pending())
    const queries = leaves.map(cell => model.watch(cell, terminal))
    let layer = leaves.slice()
    while (layer.length > 1) {
        const next = []
        for (let i = 0; i < layer.length; i += 2) {
            model.forward(layer[i], layer[i + 1]); next.push(layer[i + 1])
        }
        layer = next
    }
    const cached = new Map([[terminal, 'existing output']])
    model.forward(layer[0], terminal)
    assert.equal(model.root(terminal), terminal)
    let idleDepth = 0, at = leaves[0]
    while (at.into) { idleDepth++; at = at.into }
    assert(idleDepth <= Math.log2(size) + 1)
    for (const cell of leaves) assert.equal(cached.get(model.root(cell)), 'existing output')
    for (const query of queries) assert.equal(query.answer, true)
    assert.equal(model.root(terminal).queries, undefined)
    assert(model.moves <= size * (Math.log2(size) + 1))
    terminalJoins.push({ size, idleDepth, moves: model.moves, notifications: model.notifications })
}

// Sort's normative Set operations include a present singleton. V8 24 skips
// that physical write; the public conformance case follows logical sort's
// specified footprint, not this host shortcut. Omit it from the native probe.
// Observe writes made by the same native intrinsics used on runtime remaps.
// This does not treat copying a remap or view as a language publication.
const arrayCases = [
    ["fill", [1, 2], [1, 1, 1], false], ["fill", [1, 1], [1], true],
    ["reverse", [1], [], false], ["reverse", [1, 1], [], true],
    ["reverse", new Array(4), [], false],
    ["copyWithin", [1, 2], [0, 1, 1], false], ["copyWithin", [1, 2], [0, 0], true],
    ["copyWithin", new Array(4), [0, 1], false],
    ["sort", [], [], false], ["sort", new Array(4), [], false],
    ["sort", [1, 2], [], true],
    ["push", [], [], true], ["unshift", [], [], true],
    ["pop", [], [], true], ["shift", [], [], true], ["splice", [], [], true],
]
for (const [method, input, args, expected] of arrayCases) {
    assert.equal(probeArrayWrites(method, input, args), expected,
        `${method}: logical writes include equal structural assignments`)
}

function probeArrayWrites(method, input, args) {
    let published = false
    const before = input.slice()
    const tracked = new Proxy(input, {
        set(target, key, value) { published = true; return Reflect.set(target, key, value) },
        deleteProperty(target, key) {
            if (Object.hasOwn(target, key)) published = true
            return Reflect.deleteProperty(target, key)
        },
    })
    const result = Reflect.apply(Array.prototype[method], tracked, args)
    if (["fill", "reverse", "copyWithin", "sort"].includes(method))
        assert.equal(result, tracked, "These mutators return the receiver, including when they write nothing")
    if (!published) assert.deepEqual(input, before, "A zero-write outcome can reuse the complete baseline")
    return published
}

// Exhaust the small sparse shapes and already-converted scalar bounds. The
// classifier describes logical writes; the native Proxy independently observes
// stores/deletions. This checks baseline reuse, not production preparation,
// scope recovery, publication, or allocation. No production Proxy is proposed.
let sparseArrayChecks = 0, zeroWriteArrays = 0
for (let length = 0; length <= 4; length++) {
    const bounds = [undefined, -Infinity, -1, 0, 1, length, length + 1, Infinity, NaN]
    for (let pattern = 0; pattern < 3 ** length; pattern++) {
        const source = new Array(length)
        let digits = pattern
        for (let index = 0; index < length; index++, digits = Math.floor(digits / 3)) {
            if (digits % 3) source[index] = digits % 3 === 1 ? undefined : 1
        }
        const relative = (value, fallback) => {
            if (value === undefined) return fallback
            const integer = Number.isNaN(value) ? 0 : Math.trunc(value)
            return integer < 0 ? Math.max(length + integer, 0) : Math.min(integer, length)
        }
        const check = (method, args, writes) => {
            const observed = probeArrayWrites(method, source.slice(), args)
            // The specified singleton sort writes; V8 skips that physical store.
            if (method !== "sort" || length !== 1) assert.equal(observed, writes, `${method}: footprint`)
            sparseArrayChecks++
            if (!writes) zeroWriteArrays++
        }
        for (const start of bounds) for (const end of bounds)
            check("fill", [1, start, end], relative(start, 0) < relative(end, length))
        let reversedWrite = false
        for (let index = 0; index < Math.floor(length / 2); index++)
            reversedWrite ||= Object.hasOwn(source, index) || Object.hasOwn(source, length - index - 1)
        check("reverse", [], reversedWrite)
        check("sort", [], Object.keys(source).length > 0)
        for (const target of bounds) for (const start of bounds) for (const end of bounds) {
            const to = relative(target, 0), from = relative(start, 0)
            const count = Math.max(0, Math.min(relative(end, length) - from, length - to))
            let writes = false
            for (let index = 0; index < count; index++)
                writes ||= Object.hasOwn(source, from + index) || Object.hasOwn(source, to + index)
            check("copyWithin", [target, start, end], writes)
        }
    }
}

// Complete capture supplies source-free records, including admitted shape facts.
// Normalize each identity once; allocate only final shells, before their edges.
// This checks assembly given successful capture, not production capture, Error
// collection, validation completion, source release, or native receiver reuse.
function assembleCaptured(records, roots, identities) {
    for (const record of records) {
        record.key = identities.root(record.identity)
        assert.equal(record.key.state, FRESH)
    }
    const outputs = new Map()
    let allocations = 0, writes = 0
    const emit = input => {
        if (!input?.record) return input
        const record = input.record
        if (outputs.has(record.key)) return outputs.get(record.key)
        const output = record.array ? new Array(record.length) : Object.create(record.prototype)
        allocations++
        outputs.set(record.key, output)
        for (const [key, child] of record.entries) {
            Object.defineProperty(output, key, {
                value: emit(child), enumerable: true, writable: true, configurable: true,
            })
            writes++
        }
        return output
    }
    const values = roots.map(emit)
    return { values, allocations, writes }
}

const assembly = []
for (const pendingSource of [false, true]) for (const reverse of [false, true]) {
    const identities = new Identities()
    const origin = pendingSource ? identities.pending() : identities.fresh()
    const arrayOrigin = identities.fresh()
    const copied = identities.pending(), arrayCopied = identities.pending()
    const prototype = { marker: true }, exactFunction = () => 7, exactExternal = new Date(0)
    const record = (identity, array = false) => ({
        identity, array, prototype: array ? Array.prototype : Object.prototype,
        length: array ? 4 : undefined, entries: [],
    })
    const a = record(origin), aCopy = record(copied)
    a.prototype = aCopy.prototype = prototype
    const b = record(arrayOrigin, true), bCopy = record(arrayCopied, true)
    const equal1 = record(identities.fresh()), equal2 = record(identities.fresh())
    const ordered = record(identities.fresh())
    const ref = record => ({ record })
    a.entries = [["self", ref(a)], ["array", ref(b)], ["fn", exactFunction], ["__proto__", exactExternal]]
    aCopy.entries = [["self", ref(aCopy)], ["array", ref(bCopy)], ["fn", exactFunction], ["__proto__", exactExternal]]
    b.entries = [["1", ref(a)], ["3", undefined]]
    bCopy.entries = [["1", ref(aCopy)], ["3", undefined]]
    equal1.entries = [["value", 1]]
    equal2.entries = [["value", 1]]
    ordered.entries = [["later", ref(equal1)], ["earlier", ref(equal2)]]
    const records = [a, aCopy, b, bCopy, equal1, equal2, ordered]
    const roots = [a, aCopy, bCopy, equal1, equal2, ordered].map(ref)
    // Records precede these supplied producer outcomes; no shell exists yet.
    const forwards = [[copied, origin], [arrayCopied, arrayOrigin]]
    if (reverse) forwards.reverse()
    for (const [from, to] of forwards) identities.forward(from, to)
    if (pendingSource) identities.publish(origin)
    const { values: [output, alias, array, first, second, order], allocations, writes } =
        assembleCaptured(records, roots, identities)
    assert.equal(output, alias)
    assert.equal(output.self, output)
    assert.equal(output.array, array)
    assert.equal(array[1], output)
    assert.equal(array.length, 4)
    assert.equal(0 in array, false)
    assert.equal(2 in array, false)
    assert.equal(Object.hasOwn(array, 3), true)
    assert.equal(array[3], undefined)
    assert.equal(Object.getPrototypeOf(output), prototype)
    assert.equal(output.fn, exactFunction)
    assert.equal(Object.hasOwn(output, "__proto__"), true)
    assert.equal(output.__proto__, exactExternal)
    assert.notEqual(first, second)
    assert.deepEqual(first, second)
    assert.deepEqual(Object.keys(order), ["later", "earlier"])
    assert.equal(order.later, first)
    assert.equal(order.earlier, second)
    assert.equal(allocations, 5)
    assert.equal(writes, 10)
    assembly.push({ pendingSource, reverse, representations: records.length, allocations, writes })
}

console.log(JSON.stringify({ comparisons, scales, shared, redirects, terminalJoins,
    arrayWriteCases: arrayCases.length, sparseArrayChecks, zeroWriteArrays, assembly }))
