import assert from "node:assert/strict"
import { classifySafeguard, witnessFaultReceipts } from "./safeguards/evidence.mjs"

describe("safeguard evidence classification", () => {
    const entry = { witnesses: ["checks publication"] }
    const baseline = { completed: true, instrumented: true }
    const failing = message => ({ ...baseline, failures: [{ fullTitle: "checks publication", err: { message } }] })

    for (const message of ["Timeout of 30000ms exceeded", "spawnSync node ETIMEDOUT",
        "SyntaxError: Unexpected token '}'", "Error [ERR_MODULE_NOT_FOUND]: missing fixture",
        "Safeguard fault no longer matches src/property-versions.js"]) {
        it(`does not count a named witness's infrastructure failure: ${message}`, () => {
            assert.equal(classifySafeguard(entry, failing(message)).status, "inconclusive")
        })
    }
    it("requires a loaded fault and an actual named assertion failure", () => {
        const result = failing("AssertionError: expected immutable earlier result")
        assert.equal(classifySafeguard(entry, result).status, "witnessed")
        assert.equal(classifySafeguard(entry, { ...result, instrumented: false }).status, "uninstrumented")
        assert.equal(classifySafeguard(entry, { ...baseline, failures: [] }).status, "lost")
    })
    it("reads child receipts from the actual json-stream string Error shape", () => {
        const receipt = { pid: 4652, edit: 0, file: "src/managed-invocation.js" }
        const message = `[cascada-safeguard] ${JSON.stringify(receipt)}\nAssertionError: expected release`
        assert.deepEqual(witnessFaultReceipts({ err: message, stack: message }), [receipt])
        assert.deepEqual(witnessFaultReceipts({ err: { message, stack: message } }), [receipt])
        assert.deepEqual(witnessFaultReceipts({ err: "AssertionError: expected release" }), [])
        assert.equal(classifySafeguard(entry, { ...baseline,
            failures: [{ fullTitle: "checks publication", err: "child failed", stack: "SyntaxError: Unexpected token" }] }).status,
        "inconclusive")
    })
})
