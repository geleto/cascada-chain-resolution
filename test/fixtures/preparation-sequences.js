import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { createRandom, randomInteger } from "../native-equivalence-support.js"
import { ChainedThenable, OrderedThenable } from "../ordered-thenable.js"
import { verifyRefCounts } from "../verify-refcounts.js"

// Two input boundaries receive one identity. Availability changes only when
// preparation runs, never its values, aliases, cycles, or receiving topology.
function graph(array, leaf) {
    const shared = array ? [leaf] : { leaf }
    if (array) shared.push(shared)
    else shared.self = shared
    return shared
}

function input(shared, nested, before, after, drain) {
    const value = {}
    for (let i = 0; i < before; i++) value[`before${i}`] = nested ? { shared } : shared
    value.drain = drain
    for (let i = 0; i < after; i++) value[`after${i}`] = shared
    return value
}

function check(actual, expected, nested, before, after) {
    assert.deepEqual(actual, expected)
    const shared = nested ? actual.before0.shared : actual.before0
    for (let i = 0; i < before; i++) assert.equal(nested ? actual[`before${i}`].shared : actual[`before${i}`], shared)
    for (let i = 0; i < after; i++) assert.equal(actual[`after${i}`], shared)
}

assert.throws(() => check({ before0: {}, drain: "drained", after0: {} },
    input(graph(false, 7), false, 1, 1, "drained"), false, 1, 1))

const seeds = Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16)
const coverage = new Set()
let programs = 0, runs = 0
for (let seed = 0; seed < seeds; seed++) {
    const random = createRandom(seed + 0x19fa)
    const nested = seed % 2 === 0, early = Math.floor(seed / 2) % 2 === 0
    const delivery = ["ready", "native", "ordered"][seed % 3]
    const before = 1 + randomInteger(random, 3), after = 1 + randomInteger(random, 3)
    const leafValue = 1 + randomInteger(random, 1000)
    for (const boundary of ["import", "chain", "assignment", "method-result"]) for (const array of [false, true]) {
        programs++
        for (const mode of ["bare", "verified", "observed"]) {
            const ctx = { execution: new r.Execution(), errorContext: {} }
            const trigger = new ChainedThenable()
            const leaf = delivery === "ordered" ? new OrderedThenable() : Promise.withResolvers()
            const shared = graph(array, delivery === "ready" ? leafValue : delivery === "ordered" ? leaf : leaf.promise)
            const earlier = r.import(trigger, ctx), drain = trigger.then(() => "drained")
            trigger.resolve(shared)
            if (early) await earlier
            const value = input(shared, nested, before, after, drain)
            const expected = input(graph(array, leafValue), nested, before, after, "drained")
            try {
                const received = boundary === "import" ? r.import(value, ctx) :
                    boundary === "method-result" ? r.importMethodResult(value, ctx) : value
                const chain = new r.Chain(boundary === "assignment" ? null : received, ctx)
                if (boundary === "assignment") r.assignPath(chain, [], received, ctx)
                if (mode !== "bare") verifyRefCounts(ctx, chain._state, shared)
                if (mode === "observed") r.lookupPath(chain, ["after0"], ctx)
                const exported = r.export(chain, [], ctx)
                leaf.resolve(leafValue)
                check(await exported, expected, nested, before, after)
                await earlier
                verifyRefCounts(ctx, chain._state, shared)
                assert.equal(ctx.execution.fatalError, null)
            } catch (cause) {
                throw new Error(`seed=${seed}, boundary=${boundary}, array=${array}, nested=${nested}, early=${early}, delivery=${delivery}, mode=${mode}`, { cause })
            }
            for (const key of [`boundary:${boundary}`, `array:${array}`, `nested:${nested}`,
                `drain:${early ? "before" : "during"}`, `delivery:${delivery}`, `harness:${mode}`]) coverage.add(key)
            runs++
        }
    }
}
console.log(JSON.stringify({ programs, runs, coverage: [...coverage].sort() }))
