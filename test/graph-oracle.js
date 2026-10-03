import assert from "node:assert/strict"

// Compare a detached managed-data graph with an independently constructed model.
// The two identity maps detect both duplicated aliases and merged generations;
// scalar equality alone cannot do either. Functions and supplied Errors are exact
// leaves. Other exact external leaves are asserted by their boundary's oracle.
// This checker imports no runtime helpers or metadata.
function assertGraph(actual, expected) {
    const expectedToActual = new Map(), actualToExpected = new Map()
    visit(actual, expected, "$")

    function visit(actual, expected, path) {
        if (expected === null || typeof expected !== "object" || Error.isError(expected)) {
            assert.equal(actual, expected, `${path}: exact leaf`)
            return
        }
        assert(actual !== null && typeof actual === "object", `${path}: expected a container`)
        if (expectedToActual.has(expected)) {
            assert.equal(actual, expectedToActual.get(expected), `${path}: preserve aliases and cycles`)
            return
        }
        assert(!actualToExpected.has(actual), `${path}: keep distinct identities separate`)
        expectedToActual.set(expected, actual)
        actualToExpected.set(actual, expected)
        assert.equal(Object.getPrototypeOf(actual), Object.getPrototypeOf(expected), `${path}: prototype`)
        assert.equal(Array.isArray(actual), Array.isArray(expected), `${path}: Array structure`)
        if (Array.isArray(expected)) assert.equal(actual.length, expected.length, `${path}: Array length`)
        const keys = Object.keys(expected)
        assert.deepEqual(Object.keys(actual), keys, `${path}: placements and key order`)
        for (const key of keys) {
            const placement = `${path}[${JSON.stringify(key)}]`
            const actualDescriptor = Object.getOwnPropertyDescriptor(actual, key)
            const expectedDescriptor = Object.getOwnPropertyDescriptor(expected, key)
            assert("value" in actualDescriptor, `${placement}: own data placement`)
            assert("value" in expectedDescriptor, `${placement}: model must use data placements`)
            visit(actualDescriptor.value, expectedDescriptor.value, placement)
        }
    }
}

export { assertGraph }
