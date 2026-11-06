import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

function rejectsSettings(fixture, settings, args, diagnostic) {
    const env = { ...process.env }
    for (const name of Object.keys(env)) if (name.startsWith("CASCADA_SEQUENCE_") || name.startsWith("CASCADA_CONFLICT_")) delete env[name]
    Object.assign(env, settings)
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
        fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)), ...args],
    { encoding: "utf8", timeout: 5000, windowsHide: true, env })
    assert.equal(result.error, undefined, `${fixture}: ${result.error?.message}`)
    assert.notEqual(result.status, 0, `${fixture} accepted ${JSON.stringify({ settings, args })}`)
    assert.match(result.stderr, diagnostic)
    assert.equal(result.stdout, "", "Invalid settings must not certify a coverage summary")
}

describe("generated verification settings", () => {
    it("rejects invalid seed counts before any fixture can certify an empty run", function () {
        this.timeout(60000)
        for (const fixture of ["array-sequences.js", "nested-sequences.js", "external-sequences.js",
            "promise-key-differential.js", "placement-sequences.js", "preparation-sequences.js", "boundary-histories.js",
            "receiving-invocation-differential.mjs"])
            for (const seeds of ["0", "invalid", "1.5", "", "-1"])
                rejectsSettings(fixture, { CASCADA_SEQUENCE_SEEDS: seeds }, [], /CASCADA_SEQUENCE_SEEDS/)
        rejectsSettings("boundary-histories.js", { CASCADA_SEQUENCE_SEEDS: "3" }, [], /CASCADA_SEQUENCE_SEEDS/)
        rejectsSettings("receiving-invocation-differential.mjs", { CASCADA_SEQUENCE_SEEDS: "7" }, [], /CASCADA_SEQUENCE_SEEDS/)
    })

    it("rejects starts outside the selected program range", function () {
        this.timeout(60000)
        for (const fixture of ["array-sequences.js", "nested-sequences.js", "external-sequences.js", "promise-key-differential.js"])
            for (const start of ["24", "invalid", "-1", ""])
                rejectsSettings(fixture, { CASCADA_SEQUENCE_SEEDS: "4", CASCADA_SEQUENCE_START: start }, [], /CASCADA_SEQUENCE_START/)
    })

    it("rejects rounded program indexes even when the selected range is small", function () {
        this.timeout(30000)
        // Before validation, these five selected positions repeat one index and
        // include the exclusive end because seeds * 6 exceeds exact integers.
        const settings = { CASCADA_SEQUENCE_SEEDS: "1501199875790166", CASCADA_SEQUENCE_START: "9007199254740991" }
        for (const fixture of ["array-sequences.js", "nested-sequences.js", "external-sequences.js", "promise-key-differential.js"])
            rejectsSettings(fixture, settings, [], /CASCADA_SEQUENCE_SEEDS/)
    })

    it("rejects malformed and empty publication and conflict shards", function () {
        this.timeout(60000)
        for (const shard of ["1/-1", "0/0", "1/1", "-1/2", "0/2/3", "0/1.5", "", "9007199254740992/9007199254740993", "999999/1000000"]) {
            rejectsSettings("publication-pairs.js", {}, [shard], /publication-pair shard/)
            rejectsSettings("conflict-matrix.js", { CASCADA_CONFLICT_PART: shard }, [], /CASCADA_CONFLICT_PART/)
        }
        rejectsSettings("publication-pairs.js", {}, ["sample", "unexpected"], /publication-pair/)
    })

    it("rejects an unrecognized full-matrix selector", () => {
        rejectsSettings("conflict-matrix.js", { CASCADA_CONFLICT_MATRIX: "ful" }, [], /CASCADA_CONFLICT_MATRIX/)
    })

    it("rejects invalid continuation limits and out-of-range worker deadlines", function () {
        this.timeout(30000)
        for (const limit of ["", "-1", "invalid", "1.5"])
            rejectsSettings("placement-sequences.js", { CASCADA_SEQUENCE_CONTINUE: limit }, [], /CASCADA_SEQUENCE_CONTINUE/)
        for (const timeout of ["", "0", "invalid", "2147483648"])
            rejectsSettings("placement-sequences.js", { CASCADA_SEQUENCE_CONTINUE: "1", CASCADA_SEQUENCE_TIMEOUT_MS: timeout }, [], /CASCADA_SEQUENCE_TIMEOUT_MS/)
    })
})
