import assert from "node:assert/strict"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import * as candidate from "../../src/index.js"

const tick = () => new Promise(setImmediate)
const pending = Symbol("held")
const indexes = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4]
const initial = { values: ["A", "B", "C"], at: 2, delivered: 1, indexes }
const previous = process.argv.find(arg => arg.startsWith("--baseline="))?.slice("--baseline=".length)
const baseline = previous && await import(pathToFileURL(resolve(previous, "src/index.js")))
const mutation = { mutationScopeDepth: 0 }

async function observations(r, mode, method, args, early, first, predecessor) {
    const ctx = { execution: new r.Execution(), errorContext: "held structural point" }
    const tail = Promise.withResolvers(), start = Promise.withResolvers(), end = Promise.withResolvers()
    const { values, at, delivered, indexes } = predecessor
    const source = new r.Chain(values.slice(), ctx, mode)
    r.run(source, [], "splice", [at, tail.promise], ctx, mutation)
    const controls = [start.promise, end.promise, ...args.slice(2)]
    const output = new r.Chain(r.run(source, [], method, controls, ctx, {}), ctx, mode)
    const read = () => indexes.map(i => r.run(output, [], "at", [i], ctx, {}))
    let points = early && read()
    const deliveries = [start, end]
    deliveries[first].resolve(args[first])
    await tick()
    deliveries[1 - first].resolve(args[1 - first])
    await tick()
    points ||= read()
    await tick()
    const observed = await Promise.all(points.map(point => Promise.race([point, Promise.resolve(pending)])))
    const normalized = Math.min(values.length, at < 0 ? Math.max(0, values.length + at) : at)
    const completions = Array.from({ length: values.length - normalized + 1 }, (_, count) =>
        values.toSpliced(at, count)[method](...args))
    for (const [i, value] of observed.entries()) if (value !== pending)
        for (const native of completions) assert.equal(value, native.at(indexes[i]))
    tail.resolve(delivered)
    const final = completions[Math.min(delivered, completions.length - 1)]
    assert.deepEqual(await Promise.all(points), indexes.map(i => final.at(i)))
    return observed
}

async function compare(mode, method, args, early, first, predecessor, totals) {
    const result = await observations(candidate, mode, method, args, early, first, predecessor)
    totals.points += result.length
    totals.ready += result.filter(value => value !== pending).length
    if (!baseline) return
    const prior = await observations(baseline, mode, method, args, early, first, predecessor)
    for (const [i, value] of prior.entries()) {
        if (value !== pending) assert.equal(result[i], value,
            JSON.stringify({ method, mode, args, early, first, predecessor, index: predecessor.indexes[i] }))
        else if (result[i] !== pending) totals.gained++
    }
}
for (const method of ["toSpliced", "slice"]) {
    const totals = { points: 0, ready: 0, gained: baseline ? 0 : undefined }
    const ends = method === "slice" ? [-5, -2, -1, 0, 1, 2, 3, Infinity] : [0, 1, 2, 3, 5]
    for (const mode of [candidate.CHAIN_MODE.Sequential, candidate.CHAIN_MODE.Unordered])
        for (const start of [-4, -2, -1, 0, 1, 2, 3, 5]) for (const end of ends)
            for (const added of method === "slice" ? [[]] : [[], ["I", "J"]])
                for (const early of [true, false]) for (const first of [0, 1]) {
                    const args = [start, end, ...added]
                    await compare(mode, method, args, early, first, initial, totals)
                }
    console.log(JSON.stringify({ method, ...totals }))
}

// A predecessor with several possible deletions can exclude a previously
// issued rear coordinate before either its length or the old data settles.
{
    const seed = 20261128, cases = 1600
    let state = seed
    const random = n => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % n
    const totals = { points: 0, ready: 0, gained: baseline ? 0 : undefined }
    for (let i = 0; i < cases; i++) {
        const n = 2 + random(8), values = Array.from({ length: n }, (_, i) => "v" + i)
        const at = random(2 * n + 5) - n - 2, start = random(2 * n + 7) - n - 3
        const method = random(29) % 2 ? "slice" : "toSpliced"
        const end = method === "slice" ? random(2 * n + 7) - n - 3 : random(n + 7) - 2
        const insert = method === "toSpliced" ? Array.from({ length: random(4) }, (_, j) => "i" + j) : []
        const mode = random(17) % 2 ? candidate.CHAIN_MODE.Unordered : candidate.CHAIN_MODE.Sequential
        const first = random(13) % 2, early = Boolean(random(11) % 2)
        const predecessor = { values, at, delivered: random(n + 1),
            indexes: Array.from({ length: 2 * (n + 3) }, (_, j) => j - n - 3) }
        await compare(mode, method, [start, end, ...insert], early, first, predecessor, totals)
    }
    console.log(JSON.stringify({ seed, cases, ...totals }))
}

// A failed count obstructs the old suffix. A failed start with positive
// deletion obstructs all old slots. A zero count leaves those slots healthy
// in Unordered and the end insertion remains discoverable there.
let failurePoints = 0
for (const mode of [candidate.CHAIN_MODE.Sequential, candidate.CHAIN_MODE.Unordered])
    for (const failure of ["start", "count", "tail"]) for (const at of [-2, 1, 4])
        for (const count of [0, 2]) for (const tailResult of [0, 1, "reject"])
            for (const first of [0, 1]) {
                const ctx = { execution: new candidate.Execution(), errorContext: "held failure" }
                const tail = Promise.withResolvers(), controls = [Promise.withResolvers(), Promise.withResolvers()]
                const cause = candidate.validationError(failure, ctx, candidate.ERROR_KIND.OperationInputFailed)
                const earlier = candidate.validationError("predecessor", ctx, candidate.ERROR_KIND.OperationInputFailed)
                const source = new candidate.Chain(["A", "B", "C"], ctx, mode)
                candidate.run(source, [], "splice", [2, tail.promise], ctx, mutation)
                const output = new candidate.Chain(candidate.run(source, [], "toSpliced",
                    [controls[0].promise, controls[1].promise, "I"], ctx, {}), ctx, mode)
                const points = indexes.map(i => candidate.run(output, [], "at", [i], ctx, {}))
                for (const i of [first, 1 - first]) {
                    if (failure === (i ? "count" : "start")) controls[i].reject(cause)
                    else controls[i].resolve(i ? count : at)
                    await tick()
                }
                const expected = ["C", undefined, earlier].map(last => {
                    const old = last === undefined ? ["A", "B"] : ["A", "B", last]
                    if (failure === "start") {
                        const sequential = mode === candidate.CHAIN_MODE.Sequential
                        return [...old.map(v => count || sequential ? cause : v), sequential ? cause : "I"]
                    }
                    if (failure === "count") {
                        const pos = Math.min(old.length, at < 0 ? Math.max(0, old.length + at) : at)
                        return [...old.slice(0, pos), "I", ...old.slice(pos).fill(cause)]
                    }
                    return old.toSpliced(at, count, "I")
                })
                const seen = await Promise.all(points.map(p => Promise.race([p, Promise.resolve(pending)])))
                for (const [i, value] of seen.entries()) if (value !== pending)
                    for (const possible of expected) assert.equal(value, possible.at(indexes[i]), JSON.stringify({ phase: "held", mode, failure, at, count, tailResult, first, index: indexes[i] }))
                if (tailResult === "reject") tail.reject(earlier)
                else tail.resolve(tailResult)
                const native = expected[tailResult === "reject" ? 2 : tailResult]
                for (const [i, value] of (await Promise.all(points)).entries())
                    assert.equal(value, native.at(indexes[i]), JSON.stringify({ phase: "final", mode, failure, at, count, tailResult, first, index: indexes[i] }))
                failurePoints += points.length
            }
console.log(JSON.stringify({ failurePoints }))
