import assert from "node:assert/strict"
import { assertGraph } from "./graph-oracle.js"

const cycle = () => {
    const value = { k: 1 }
    value.self = value
    return value
}

describe("independent graph oracle", () => {
    it("accepts equivalent multi-root aliases and cycles at different addresses", () => {
        const actual = cycle(), expected = cycle()
        assertGraph({ a: actual, b: [actual, actual] }, { a: expected, b: [expected, expected] })
    })

    it("rejects alias splitting even when all values match", () => {
        const expected = cycle()
        assert.throws(() => assertGraph([cycle(), cycle()], [expected, expected]), /preserve aliases/)
    })

    it("rejects merging distinct generations even when all values match", () => {
        const actual = cycle()
        assert.throws(() => assertGraph([actual, actual], [cycle(), cycle()]), /distinct identities/)
    })

    it("rejects redirecting a cycle to another equal-valued node", () => {
        const actual = cycle()
        actual.self = cycle()
        assert.throws(() => assertGraph(actual, cycle()), /preserve aliases/)
    })

    it("checks Array holes separately from undefined and trailing length", () => {
        assertGraph([1, , undefined, ,], [1, , undefined, ,])
        assert.throws(() => assertGraph([1, undefined], [1, ,]), /placements/)
        assert.throws(() => assertGraph([1], [1, ,]), /length/)
    })

    it("checks record order and null or managed-class prototypes", () => {
        assertGraph(Object.assign(Object.create(null), { a: 1 }), Object.assign(Object.create(null), { a: 1 }))
        assert.throws(() => assertGraph({ b: 2, a: 1 }, { a: 1, b: 2 }), /key order/)
        assert.throws(() => assertGraph({ a: 1 }, Object.assign(Object.create(null), { a: 1 })), /prototype/)
        class Cell { constructor() { this.k = 1 } }
        assertGraph(new Cell(), new Cell())
        assert.throws(() => assertGraph({ k: 1 }, new Cell()), /prototype/)
    })

    it("rejects accessor placements without invoking their getters", () => {
        let reads = 0
        const accessor = { get k() { reads++; return 1 } }
        assert.throws(() => assertGraph(accessor, { k: 1 }), /own data placement/)
        assert.throws(() => assertGraph({ k: 1 }, accessor), /model must use data placements/)
        assert.equal(reads, 0)
    })

    it("preserves primitive distinctions and exact Function and Error leaves", () => {
        const fn = () => 1, error = new Error("supplied"), symbol = Symbol("leaf")
        assertGraph({ fn, error, symbol, value: NaN }, { fn, error, symbol, value: NaN })
        assert.throws(() => assertGraph({ value: -0 }, { value: 0 }), /exact leaf/)
        assert.throws(() => assertGraph({ fn: () => 1 }, { fn }), /exact leaf/)
        assert.throws(() => assertGraph({ error: new Error("supplied") }, { error }), /exact leaf/)
    })
})
