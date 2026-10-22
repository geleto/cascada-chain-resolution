import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { runSensitivity } from "./fixtures/receiving-invocation-differential.mjs"
import { receivingFaults } from "./fixtures/receiving-invocation-faults.mjs"
import { enabled as traceEnabled } from "./trace-state.js"

describe("receiving and invocation differential", function () {
    this.timeout(120000)
    it("detects wrong values, aliases, missing poison, effects and completion", async () => {
        assert.deepEqual(await runSensitivity(), ["value", "alias", "effect", "completion", "poison"])
    })
    it("witnesses five executed production faults and rejects a no-op loader", () => {
        const run = (fault, enabled) => spawnSync(process.execPath, [...process.execArgv,
            "--unhandled-rejections=strict", "--import", "./test/safeguards/fault-hook.mjs",
            fileURLToPath(new URL("./fixtures/receiving-invocation-differential.mjs", import.meta.url))], {
            encoding: "utf8", timeout: 20000,
            env: { ...process.env, CASCADA_RECEIVING_WITNESS: fault.name,
                CASCADA_SAFEGUARD_FAULT: enabled ? JSON.stringify([fault.edit]) : "" },
        })
        const verifyDetected = (fault, result) => {
            assert.equal(result.error, undefined, result.error?.message)
            assert.match(result.stderr, new RegExp(`receiving differential fault executed: ${fault.name}`), "runtime fault branch receipt")
            assert.notEqual(result.status, 0, "a substituted defect must fail the witness")
            assert.match(result.stderr, fault.assertion, "the intended semantic assertion must detect the fault")
        }
        const noop = run(receivingFaults[0], false)
        assert.equal(noop.status, 0, noop.stderr)
        assert.throws(() => verifyDetected(receivingFaults[0], noop), /runtime fault branch receipt/)
        for (const fault of receivingFaults) verifyDetected(fault, run(fault, true))
    })
    it("replays bounded histories with independent graph and causal oracles", () => {
        const seeds = Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 8)
        assert(Number.isInteger(seeds) && seeds >= 8)
        const child = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict", "--max-old-space-size=256",
            fileURLToPath(new URL("./fixtures/receiving-invocation-differential.mjs", import.meta.url))],
        { encoding: "utf8", timeout: 110000,
            env: { ...process.env, CASCADA_SEQUENCE_EXPECT_TRACE: traceEnabled ? "1" : "0" } })
        assert.equal(child.error, undefined, child.error?.message)
        assert.equal(child.status, 0, child.stderr)
        const result = JSON.parse(child.stdout)
        assert.equal(result.programs, seeds)
        assert.equal(result.histories, seeds * 95)
        assert.equal(result.failed, 0)
        assert.equal(result.skipped, 0)
        for (const route of ["import", "method-result", "host-result", "observation", "snapshot", "managed-result"])
        for (const delivery of ["ready", "synchronous", "native", "ordered", "reversed"])
        for (const outcome of ["healthy", "poison"])
        for (const ownership of route === "snapshot" ? ["fresh"] : ["fresh", "prepared"])
        for (const availability of route === "snapshot" ? ["root"] : ["root", "nested"])
            assert(result.coverage.includes(`${route}:${delivery}:${outcome}:${ownership}:${availability}`), "missing checked joint route/delivery/outcome/ownership/availability")
        for (const route of ["import", "method-result", "host-result", "observation", "snapshot", "managed-result"])
        for (const delivery of ["ready", "synchronous", "native", "ordered", "reversed"])
            assert(result.coverage.includes(`${route}:${delivery}:direct-rejection:fresh:root`), "missing direct rejection boundary")
        assert.deepEqual(result.controls, ["healthy-Error", "independent-result-effect", "ready-only-snapshot", "scope-query"])
    })
})
