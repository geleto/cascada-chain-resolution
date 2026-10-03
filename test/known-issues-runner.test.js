import assert from "node:assert/strict"
import { checkReport, summarize } from "./known-issues/run.mjs"

describe("deferred conformance baseline", () => {
    const failure = { fullTitle: "known identity witness", err: {
        code: "ERR_ASSERTION", operator: "strictEqual", message: "false !== true"
    } }
    const report = () => ({ stats: { tests: 2, pending: 0, passes: 1 },
        tests: [{ fullTitle: failure.fullTitle }, { fullTitle: "passing control" }],
        failures: [structuredClone(failure)] })
    const baseline = summarize(report())

    it("recognizes the same strict failure independently of duration and stack", () => {
        const result = report()
        result.stats.duration = 100
        result.failures[0].err.stack = "a different source line"
        checkReport(result, baseline)
    })

    it("rejects an additional failure", () => {
        const result = report()
        result.stats.passes = 0
        result.failures.push({ ...failure, fullTitle: "new failure" })
        assert.throws(() => checkReport(result, baseline), assert.AssertionError)
    })

    it("rejects a different failure at a known witness", () => {
        const result = report()
        result.failures[0].err = { code: "FATAL", message: "execution closed" }
        assert.throws(() => checkReport(result, baseline), assert.AssertionError)
        result.failures[0].err = { ...failure.err, message: "undefined !== true" }
        assert.throws(() => checkReport(result, baseline), assert.AssertionError)
    })

    it("flags a fixed witness for promotion into the default suite", () => {
        const result = report()
        result.stats.passes = 2
        result.failures = []
        assert.throws(() => checkReport(result, baseline), assert.AssertionError)
    })

    it("rejects missing or skipped cases", () => {
        const result = report()
        result.stats.tests = 1
        result.stats.passes = 0
        assert.throws(() => checkReport(result, baseline), assert.AssertionError)
        const skipped = report()
        skipped.stats.pending = 1
        skipped.stats.passes = 0
        assert.throws(() => checkReport(skipped, baseline), assert.AssertionError)
    })

    it("rejects replacing a passing control even when counts match", () => {
        const result = report()
        result.tests[1].fullTitle = "different control"
        assert.throws(() => checkReport(result, baseline), assert.AssertionError)
    })
})
