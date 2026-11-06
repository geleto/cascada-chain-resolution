import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

describe("captured Array flattening work", function () {
    this.timeout(15000)
    for (const control of ["normal", "loader", "counter"]) it(`bounds capture and expansion with ${control} control`, () => {
        const child = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict",
            "test/fixtures/array-flat-work.mjs"], {
            encoding: "utf8", timeout: 10000, env: { ...process.env,
                CASCADA_WORK_NOOP_LOADER: control === "loader" ? "1" : "0",
                CASCADA_FLAT_NOOP_COUNTER: control === "counter" ? "1" : "0" },
        })
        assert.equal(child.status, control === "normal" ? 0 : 1, child.error?.message ?? child.stderr)
        if (control === "normal") assert.equal(JSON.parse(child.stdout).cases, 11)
        else assert.match(child.stderr, control === "loader" ? /Flat work requires its runtime counter loader/ :
            /Flat work instrumentation must count executed capture and expansion/)
    })
})
