import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { assertGraph } from "../graph-oracle.js"
import { createRandom } from "../native-equivalence-support.js"

let cases = 0
function flatten(array, depth) {
    const ctx = { execution: new r.Execution(), errorContext: "finite flat expansion" }
    const source = new r.Chain(array, ctx)
    const value = r.run(source, [], "flat", [depth], ctx, {})
    assert(!(value instanceof Promise))
    const result = new r.Chain(value, ctx)
    assert.equal(ctx.execution.fatalError, null)
    cases++
    return { ctx, source, value, output: r.export(result, [], ctx) }
}

for (const depth of [4096, 2 ** 53, 2 ** 54, Number.MAX_VALUE]) {
    for (const emptyExit of [false, true]) {
        const array = []
        if (emptyExit) array.push([])
        array.push(array)
        const { output } = flatten(array, depth)
        assert.equal(output.length, emptyExit ? 2 : 1)
        assert.equal(output.at(-1).at(-1), output.at(-1))
        if (emptyExit) assert.deepEqual(output[0], [])
    }
    assert.deepEqual(flatten([[1], [[], [2]], , 3], depth).output, [1, 2, 3])
}

const emitting = []; emitting.push(0, emitting)
const emitted = flatten(emitting, 4096).output
assert.equal(emitted.length, 4098)
assert(emitted.slice(0, -1).every(value => value === 0))
assert.equal(emitted.at(-1)[1], emitted.at(-1))

for (const shape of ["emitting", "branching", "mutual"]) for (const depth of [2 ** 54, Number.MAX_VALUE]) {
    const array = []
    if (shape === "emitting") array.push(0, array)
    else if (shape === "branching") array.push(array, array)
    else { const other = [array, 0]; array.push(other) }
    const { ctx, source, value } = flatten(array, depth)
    assert(r.isPoisonError(value))
    assert.equal(value.kind, r.ERROR_KIND.InvalidArrayLength)
    assert.equal(value.errorContext, ctx.errorContext)
    assert.equal(r.lookupPath(source, ["length"], ctx), array.length)
    assert.equal(r.import(7, ctx), 7)
}

// These depths are below a one-emission-per-lap conservative bound, but their
// exact expansion already exceeds Array capacity. Counting must not unfold it.
for (const shape of ["single", "double", "mutual", "nested"]) {
    const array = []
    let depth
    if (shape === "single") { array.push(0, array); depth = 0xfffffffe }
    else if (shape === "double") { array.push(0, 0, array); depth = 2 ** 31 }
    else if (shape === "mutual") { const other = [0, 0, array]; array.push(other); depth = 0xffffffff }
    else { const other = []; other.push(0, other); array.push(array, other); depth = 100000 }
    const { ctx, source, value } = flatten(array, depth)
    assert(r.isPoisonError(value), shape)
    assert.equal(value.kind, r.ERROR_KIND.InvalidArrayLength, shape)
    assert.equal(r.lookupPath(source, ["length"], ctx), array.length)
    assert.equal(r.export(new r.Chain(r.run(new r.Chain([[7]], ctx), [], "flat", [1], ctx, {}), ctx), [], ctx)[0], 7)
    assert.equal(ctx.execution.fatalError, null)
}

let doubled = [1]
for (let level = 0; level < 35; level++) doubled = [doubled, doubled]
const overflow = flatten(doubled, 35).value
assert(r.isPoisonError(overflow))
assert.equal(overflow.kind, r.ERROR_KIND.InvalidArrayLength)

// Successful native flattening is an independent oracle at bounded depths.
// Vary cycles, aliases, holes, empty exits, payload leaves and retained Arrays.
for (let seed = 0; seed < 48; seed++) {
    const arrays = Array.from({ length: 3 }, () => [])
    for (let i = 0; i < 3; i++) {
        arrays[i].length = 2
        arrays[i][0] = arrays[(i + 1 + seed % 2) % 3]
        if (seed & (1 << i)) arrays[i][1] = seed % 3 === 0 ? [] : i
    }
    for (const depth of [0, 1, 2, 3, 5, 8]) {
        const expected = arrays[0].flat(depth)
        const { output } = flatten(arrays[0], depth)
        assert.doesNotThrow(() => assertGraph(output, expected), `seed=${seed}, depth=${depth}`)
    }
}

// Empty side branches disappear at different depths around the same cycle.
// At enormous depths, remove whole laps and compare the final sixteen steps
// with native flat; the consumed prefix must still select the correct ring.
const empty = [[]]
for (let i = 1; i <= 6; i++) empty.push([empty[i - 1], empty[i - 1]])
const ring = Array.from({ length: 3 }, () => [])
for (let i = 0; i < ring.length; i++) ring[i].push(empty[i + 1], ring[(i + 1) % 3], empty[6 - i])
for (const prefix of [0, 2, 3]) for (const depth of [0, 1, 2, 5, 8, 16, 2 ** 54, Number.MAX_VALUE]) {
    let source = ring[0]
    for (let i = 0; i < prefix; i++) source = [source]
    const expected = depth <= 16 ? source.flat(depth) :
        ring[(depth % 3 - (prefix + 16) % 3 + 3) % 3].flat(16)
    assert.doesNotThrow(() => assertGraph(flatten(source, depth).output, expected), `prefix=${prefix}, depth=${depth}`)
}

// General graphs mix shared empty branches, emitting cycles and branching
// cycles. Native finite flattening checks both ordering and retained aliases.
for (let seed = 0; seed < 32; seed++) {
    const random = createRandom(0xf1a7 + seed)
    const nodes = Array.from({ length: 6 }, () => [])
    for (const node of nodes) for (let i = 0, length = Math.floor(random() * 4); i < length; i++) {
        const choice = Math.floor(random() * 8)
        if (choice < nodes.length) node.push(nodes[choice])
        else if (choice === 6) node.push(seed)
        else node.length++
    }
    for (const depth of [0, 1, 2, 4, 7]) assert.doesNotThrow(() =>
        assertGraph(flatten(nodes[0], depth).output, nodes[0].flat(depth)), `mixed seed=${seed}, depth=${depth}`)
}
console.log(`${cases} finite flattening cases passed`)
