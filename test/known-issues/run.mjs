// A passing check means the explicit deferred-failure baseline is unchanged;
// it does not mean these strict conformance tests pass.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

function summarize(report) {
    return {
        tests: report.stats.tests,
        pending: report.stats.pending,
        passes: report.stats.passes,
        cases: report.tests.map(({ fullTitle }) => fullTitle).sort(),
        failures: report.failures.map(({ fullTitle, err }) => ({
            fullTitle, code: err.code, operator: err.operator, message: err.message
        })).sort((a, b) => a.fullTitle.localeCompare(b.fullTitle))
    }
}

function checkReport(report, baseline) {
    assert.deepEqual(summarize(report), baseline,
        "Deferred conformance changed: investigate new failures; move fixed witnesses into the default suite and update the baseline.")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const root = fileURLToPath(new URL("../../", import.meta.url))
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
        "node_modules/mocha/bin/mocha.js", "--reporter", "json",
        "test/known-issues/phase4-identity.mjs", "test/known-issues/boundary-histories.mjs"],
    { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
    if (result.error) throw result.error
    assert.equal(result.signal, null, "Deferred conformance process must complete")
    const baseline = JSON.parse(readFileSync(new URL("./baseline.json", import.meta.url), "utf8"))
    assert.equal(result.status, Math.min(baseline.failures.length, 255), "Strict suite exits with its failure count")
    // A crash, timeout, or incomplete reporter output cannot match the baseline.
    checkReport(JSON.parse(result.stdout), baseline)
    console.log(`${baseline.tests} strict conformance cases: ${baseline.passes} passing, ${baseline.failures.length} deferred failures unchanged (not passing coverage).`)
}

export { summarize, checkReport }
