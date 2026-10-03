import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

describe("cross-boundary histories", () => {
    it("preserves cached graph generations, aliases, and ordered effects across readiness schedules", function () {
        this.timeout(120000)
        const seeds = Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16)
        assert(Number.isInteger(seeds) && seeds >= 4, "at least four seeds cover both shapes and mutation routes")
        const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--max-old-space-size=256",
            fileURLToPath(new URL("./fixtures/boundary-histories.js", import.meta.url))],
        { encoding: "utf8", timeout: 110000, env: process.env })
        assert.equal(child.error, undefined, child.error?.message)
        assert.equal(child.status, 0, child.stderr)
        const { programs, coverage, retirementPrograms, retirementCoverage } = JSON.parse(child.stdout)
        assert.equal(programs, seeds * 32)
        assert.equal(retirementPrograms, 128)
        // Enumerate the joint interaction keys independently from the output.
        // Checking separate boundary/delivery counters cannot prove re-entry
        // actually combined pending state, release and the selected mutation.
        for (const boundary of ["import", "assignment", "method-result", "host-call"])
        for (const delivery of ["ready", "synchronous", "native", "ordered"])
        for (const release of ["before-delivery", "after-delivery"])
        for (const route of ["direct", "entry"]) for (const shape of ["dense", "sparse"]) {
            const settled = ["method-result", "host-call"].includes(boundary) && ["native", "ordered"].includes(delivery)
            const key = [boundary, delivery, release, route, shape, settled ? "settled-reentry" : "immediate-reentry"].join(":")
            assert(coverage.includes(key), `missing actual history ${key}`)
            const retired = [boundary, delivery, release, route, shape, "immediate-reentry"].join(":")
            assert(retirementCoverage.includes(retired), `missing actual retired history ${retired}`)
        }
    })
})
