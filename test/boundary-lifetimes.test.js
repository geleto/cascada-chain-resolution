import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

describe("boundary contract and lifetime regressions", () => {
    for (const fixture of ["array-failure-release", "array-reflection-release", "array-surface", "array-view-failure-retention", "array-range-failure-retention",
        "array-validation-retention", "array-remap-failure-retention", "deferred-validation-retention",
        "boundary-release", "call-selection-release", "capture-fatal", "discarded-argument-leaves", "external-owner-release",
        "flat-completion", "inspection-failure-retention", "mutation-failure-retention", "path-release", "preparation-authority", "preparation-output-release", "prepared-boundaries",
        "public-surface-release", "receiver-identity", "registration-release", "result-contract", "terminal-release", "outward-registration-release"])
    for (const stackLimit of ["array-view-failure-retention", "array-range-failure-retention", "preparation-output-release",
        "array-validation-retention", "array-remap-failure-retention", "deferred-validation-retention"].includes(fixture) ? [10, 50, 1000] : [10, 1000]) {
        it(`checks ${fixture} at stack limit ${stackLimit}`, function () {
            this.timeout(70000)
            const result = spawnSync(process.execPath, [...process.execArgv,
                "--unhandled-rejections=strict", "--expose-gc", `--stack-trace-limit=${stackLimit}`,
                `test/fixtures/${fixture}.mjs`], { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
            assert.equal(result.error, undefined, String(result.error))
            assert.equal(result.status, 0, result.stdout + result.stderr)
        })
    }

    for (const stackLimit of [50, 1000]) {
        it(`checks completed-work-retention at stack limit ${stackLimit}`, function () {
            this.timeout(70000)
            const result = spawnSync(process.execPath, [...process.execArgv,
                "--unhandled-rejections=strict", "--expose-gc", `--stack-trace-limit=${stackLimit}`,
                "test/fixtures/completed-work-retention.js"],
            { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
            assert.equal(result.error, undefined, String(result.error))
            assert.equal(result.status, 0, result.stdout + result.stderr)
        })
    }

    for (const plain of [false, true]) {
        it(`completes finite preparation back-references, plain=${plain}`, function () {
            this.timeout(190000)
            const result = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict",
                "test/fixtures/preparation-back-references.mjs", ...(plain ? ["--plain"] : [])],
            { encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024 })
            assert.equal(result.error, undefined, String(result.error))
            assert.equal(result.status, 0, result.stdout + result.stderr)
        })
    }
})
