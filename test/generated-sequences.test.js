import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// Generated programs compare every observation with an independent model and
// run the consistency verifiers between turns. Each fixture runs in a child
// process with bounded time and heap: a regression can livelock the microtask
// queue, which also stops Mocha's own timeout. test/README.md describes how to
// scale and extend them. Coverage assertions keep the default runs from
// silently losing a dimension when a generator changes.
function runFixture(name, timeout) {
    const env = { ...process.env }
    delete env.CASCADA_SEQUENCE_START
    delete env.CASCADA_CONFLICT_PART
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--max-old-space-size=256",
        fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))],
    { encoding: "utf8", timeout, env })
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
}

const product = (...lists) => lists.reduce((combinations, list) =>
    combinations.flatMap(prefix => list.map(item => prefix ? `${prefix}:${item}` : item)), [""])

describe("generated operation sequences", () => {
    it("matches a sequential model for conflicting commands on one placement", function () {
        const full = process.env.CASCADA_CONFLICT_MATRIX === "full"
        this.timeout(full ? 7200000 : 60000)
        const coverage = runFixture("conflict-matrix.js", full ? 7100000 : 55000)
        assert.equal(coverage.triples, 9 * 17 * 17)
        assert.equal(coverage.absentTriples, coverage.triples)
        assert(coverage.paired > 0, "compare runs with and without intermediate reads")
        for (const dimension of product(["container"], ["array", "record"])
            .concat(product(["target"], ["absent", "present"]), product(["sibling"], [1, 2, 3]),
                product(["release"], ["predecessor-first", "predecessor-last"]), product(["observed"], [false, true])))
            assert(coverage.dimensions.includes(dimension), `missing ${dimension}`)
    })

    it("matches an Array slot model across entries, failures, structure, and observation routes", function () {
        this.timeout(120000)
        const { programs, coverage } = runFixture("array-sequences.js", 110000)
        assert.equal(programs, Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16) * 6)
        const required = [
            ...product(["entry"], ["set", "delete", "noop", "pending", "prefix", "repair", "reject"], ["delayed", "ready"]),
            ...product(["direct"], ["set", "pending", "delete", "prefix", "repair", "reject"]),
            ...product(["structural"], ["reverse", "shift", "pop", "push", "unshift", "splice-remove", "splice-insert"], ["direct", "entry"]),
            ...product(["observe"], ["includes", "indexOf", "lastIndexOf", "at", "slice", "with", "concat"], ["direct", "entry", "snapshot"]),
            ...product(["observe"], ["direct", "entry", "snapshot"], ["before-release", "after-release", "after-settle"]),
            ...product(["delivery"], ["native", "ordered"]),
            "length", "read", "settle",
        ]
        for (const combination of required) assert(coverage.includes(combination), `missing ${combination}`)
        // Conflict steps combine one hold, one queued command, and one no-op entry.
        const conflicts = coverage.filter(key => key.startsWith("conflict:")).map(key => key.split(":"))
        for (const [position, values] of [[1, ["noop", "set", "delete", "prefix", "reject"]], [2, ["delete", "repair", "set", "prefix"]], [3, ["nested", "ready"]]])
            for (const value of values) assert(conflicts.some(parts => parts[position] === value), `missing conflict ${value}`)
    })
})
