import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

describe("receiving boundary contracts", function () {
    this.timeout(30000)
    for (const fixture of ["native-error-data", "receiving-branch-poison", "stable-receiving-categories"]) {
        it(fixture, () => {
            const result = spawnSync(process.execPath, [
                "--unhandled-rejections=strict", "--import", "./test/trace-runtime.js",
                `test/fixtures/${fixture}.mjs`,
            ], { encoding: "utf8", timeout: 25000 })
            assert.equal(result.status, 0, result.stdout + result.stderr)
        })
    }
})
