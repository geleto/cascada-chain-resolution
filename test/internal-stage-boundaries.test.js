import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

describe("internal semantic-stage failure boundaries", () => {
    it("keeps defects fatal from the first instruction of every public command", () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/entry-failure.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
        assert.match(result.stdout, /48 public entry faults/)
    })

    for (const route of ["hasError", "getErrors", "publication", "export", "join", "flat", "isolation", "validation"])
    it(`keeps ${route} defects fatal during ready and deferred work`, () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/internal-stage-failure.js", import.meta.url)), route],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })
})
