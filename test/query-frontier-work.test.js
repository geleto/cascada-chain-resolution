import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

describe("query completion work", function () {
    this.timeout(45000)
    const fixture = fileURLToPath(new URL("./fixtures/query-frontier-work.mjs", import.meta.url))
    function run(extra = []) {
        return spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict",
            "--expose-gc", "--max-old-space-size=256", fixture, ...extra],
        { encoding: "utf8", timeout: 30000, windowsHide: true })
    }
    it("releases spent completion stages while a descendant remains pending", () => {
        const result = run()
        assert.ifError(result.error)
        assert.equal(result.status, 0, result.stdout + result.stderr)
        assert.equal(JSON.parse(result.stdout).rows.length, 6)
    })
    it("rejects an inactive Promise tracker", () => {
        const result = run(["--disable-tracker"])
        assert.ifError(result.error)
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /Promise tracker must observe required pending work/)
    })
})
