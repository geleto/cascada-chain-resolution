import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { enabled as traceEnabled } from "./trace-state.js"

const fixture = "test/fixtures/generated-runner-control.mjs"
function run(scenario, limit = 3, extraArgs = [], timeout = 10000) {
    const env = { ...process.env, CASCADA_RUNNER_CONTROL: scenario,
        CASCADA_SEQUENCE_EXPECT_TRACE: traceEnabled ? "1" : "0",
        CASCADA_SEQUENCE_CONTINUE: String(limit), CASCADA_SEQUENCE_TIMEOUT_MS: String(timeout) }
    delete env.CASCADA_SEQUENCE_WORKER
    const result = spawnSync(process.execPath,
        [...process.execArgv, ...extraArgs, "--unhandled-rejections=strict", fixture],
        { encoding: "utf8", env, timeout: timeout * 3 + 10000, windowsHide: true })
    assert.ifError(result.error)
    return { ...result, summary: result.stdout.trim() ? JSON.parse(result.stdout.trim().split("\n").at(-1)) : null }
}

describe("generated investigation continuation", function () {
    this.timeout(45000)
    it("reports two independent failures and runs healthy cases before, between and after them", function () {
        const { status, stderr, summary } = run("failures")
        assert.equal(status, 1)
        assert.match(stderr, /scripted failure first/)
        assert.match(stderr, /scripted failure second/)
        assert.match(stderr, /active replay: .*"harness":"control"/)
        assert.match(stderr, /abandoned sibling replays=1/)
        assert.deepEqual(summary.receipts.map(receipt => receipt.id), ["before", "between", "after"])
        assert.equal(new Set(summary.receipts.map(receipt => receipt.pid)).size, 3, "failed workers were discarded")
        assert.deepEqual({ ...summary, receipts: undefined },
            { receipts: undefined, attempted: 5, passed: 3, failed: 2, skipped: 0 })
    })
    it("bounds failures and reports work skipped after reaching the limit", function () {
        const { status, stderr, summary } = run("failures", 1)
        assert.equal(status, 1)
        assert.match(stderr, /scripted failure first/)
        assert.doesNotMatch(stderr, /scripted failure second/)
        assert.deepEqual(summary.receipts.map(receipt => receipt.id), ["before"])
        assert.deepEqual({ ...summary, receipts: undefined },
            { receipts: undefined, attempted: 2, passed: 1, failed: 1, skipped: 3 })
    })
    for (const scenario of ["escape", "deadline"]) it(`restarts after a worker ${scenario}`, function () {
        const { status, stderr, summary } = run(scenario, 3, [], scenario === "deadline" ? 5000 : 10000)
        assert.equal(status, 1)
        assert.match(stderr, scenario === "deadline" ? /worker deadline exceeded/ : /worker escaped/)
        assert.match(stderr, /active replay: .*"harness":"control"/)
        assert.match(stderr, /abandoned sibling replays=1/)
        assert.deepEqual(summary.receipts.map(receipt => receipt.id), ["before", "after"])
        assert.equal(new Set(summary.receipts.map(receipt => receipt.pid)).size, 2)
        assert.deepEqual({ ...summary, receipts: undefined },
            { receipts: undefined, attempted: 3, passed: 2, failed: 1, skipped: 0 })
    })
    it("keeps ordinary fail-fast execution available", function () {
        const { status, stderr, summary } = run("failures", 0)
        assert.equal(status, 1)
        assert.match(stderr, /scripted failure first/)
        assert.doesNotMatch(stderr, /scripted failure second/)
        assert.equal(summary, null)
    })
    it("returns successful totals and verifies instrumentation in the actual runtime worker", function () {
        const { status, stderr, summary } = run("success", 3, ["--import", "./test/trace-runtime.js"])
        assert.equal(status, 0, stderr)
        assert.deepEqual({ ...summary, receipts: undefined },
            { receipts: undefined, attempted: 2, passed: 2, failed: 0, skipped: 0 })
        assert.equal(new Set(summary.receipts.map(receipt => receipt.pid)).size, 1, "successful worker is reused")
        for (const receipt of summary.receipts) {
            assert.equal(receipt.traceEnabled, true)
            assert.ok(receipt.preparations > 0, "loader executed an actual runtime preparation")
        }
    })
    it("rejects a no-op loader when actual runtime instrumentation is required", function () {
        const env = { ...process.env, CASCADA_RUNNER_CONTROL: "success", CASCADA_SEQUENCE_CONTINUE: "1",
            CASCADA_SEQUENCE_EXPECT_TRACE: "1" }
        delete env.CASCADA_SEQUENCE_WORKER
        delete env.NODE_OPTIONS
        const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "./test/trace-state.js", fixture],
            { encoding: "utf8", env, timeout: 20000, windowsHide: true })
        assert.ifError(child.error)
        assert.equal(child.status, 1)
        assert.match(child.stderr, /did not execute the required preparation tracer/)
        const summary = JSON.parse(child.stdout)
        assert.deepEqual(summary, { receipts: [], attempted: 1, passed: 0, failed: 1, skipped: 1 })
    })
    for (const [name, expected] of [["preparation-sequences", 164], ["placement-sequences", 16],
        ["array-sequences", 24], ["nested-sequences", 24], ["external-sequences", 24], ["boundary-histories", 160]])
    it(`runs ${name} through the isolated continuation worker`, function () {
        this.timeout(90000)
        const env = { ...process.env, CASCADA_SEQUENCE_SEEDS: "4", CASCADA_SEQUENCE_CONTINUE: "2",
            CASCADA_SEQUENCE_EXPECT_TRACE: traceEnabled ? "1" : "0" }
        delete env.CASCADA_SEQUENCE_WORKER
        delete env.CASCADA_SEQUENCE_START
        const child = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict", `test/fixtures/${name}.js`],
            { encoding: "utf8", env, timeout: 80000, windowsHide: true })
        assert.ifError(child.error)
        assert.equal(child.status, 0, child.stderr)
        const { attempted, passed, failed, skipped } = JSON.parse(child.stdout)
        assert.deepEqual({ attempted, passed, failed, skipped }, { attempted: expected, passed: expected, failed: 0, skipped: 0 })
    })
})
