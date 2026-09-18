import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { createRandom, randomInteger } from "../native-equivalence-support.js"
import { OrderedThenable } from "../ordered-thenable.js"
import { verifyRefCounts } from "../verify-refcounts.js"

// Model only language state and rollback. Promise delivery changes availability,
// never the expected sequential value at a command's issuance position.
function apply(state, command, array) {
    const key = array ? 0 : "n"
    if (command.kind === "replace") return { value: fresh(command.value, array), poisoned: false }
    if (command.kind === "repair") return { ...state, poisoned: false }
    if (state.poisoned) return state
    if (command.kind === "fail") return { ...state, poisoned: true }
    const value = structuredClone(state.value)
    if (command.kind === "write" || command.kind === "entry") value[key] = command.value
    else if (command.kind === "delete") delete value[key]
    else if (command.kind === "length") value.length = command.value % 5
    return { value, poisoned: false }
}

function fresh(value, array) {
    return array ? [value, , value + 1] : { n: value, child: { stable: true } }
}

function check(actual, expected) {
    assert.equal(r.isPoisonError(actual), expected.poisoned, "scope poison")
    if (!expected.poisoned) assert.deepStrictEqual(actual, expected.value)
}

// Check sensitivity to overtaking, lost poison, and sparse-shape corruption.
assert.throws(() => check({ n: 2 }, { value: { n: 1 }, poisoned: false }))
assert.throws(() => check({ n: 1 }, { value: { n: 1 }, poisoned: true }))
assert.throws(() => check([1, undefined, 2], { value: [1, , 2], poisoned: false }))

const seedCount = Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16)
const traces = new Set()
let cases = 0
for (let index = 0; index < seedCount; index++) {
    const seed = (0x51f15e + Math.imul(index, 0x9e3779b9)) >>> 0
    for (const array of [false, true]) for (const delivery of ["native", "ordered"]) {
        const random = createRandom(seed)
        const ctx = { execution: new r.Execution(), errorContext: {} }
        const chain = new r.Chain({ item: fresh(0, array) }, ctx)
        const sources = [], snapshots = [], work = [], forks = [], trace = []
        let state = { value: fresh(0, array), poisoned: false }
        const kinds = ["replace", "write", "delete", "entry", "fail", "repair", "noop", "capture", "fork"]
        if (array) kinds.push("length")
        const keep = value => {
            // Observe each outward result even if a later command discards it.
            const promise = Promise.resolve(value)
            promise.catch(() => {})
            work.push(promise)
            return promise
        }
        function input(value, delayed) {
            if (!delayed) return value
            const source = delivery === "native" ? Promise.withResolvers() : new OrderedThenable()
            if (delivery === "ordered") source.flushOnSubscribe = true
            sources.push({ source, value })
            return delivery === "native" ? source.promise : source
        }
        function capture(route) {
            const expected = structuredClone(state)
            if (route === "fork") {
                const fork = new r.Chain(r.lookupPath(chain, [], ctx), ctx)
                forks.push(fork)
                // Leave the fork unobserved until later work has had its turn.
                snapshots.push({ fork, expected })
                return
            }
            const result = route === "capture" ? r.lookupPath(chain, ["item"], ctx) : r.export(chain, ["item"], ctx)
            const retained = route === "capture" ? keep(result).then(value => new r.Chain(value, ctx)) : undefined
            if (retained) {
                const checked = retained.then(captured => r.export(captured, [], ctx)).then(actual => check(actual, expected))
                keep(checked)
                // A lookup can contain pending logical properties. Re-export
                // this same retained graph after later writes, not just its copy.
                snapshots.push({ retained, expected })
                return
            }
            const checked = keep(result).then(actual => {
                check(actual, expected)
                return actual
            })
            keep(checked)
            snapshots.push({ result: checked, expected })
        }
        try {
            for (let step = 0; step < 18; step++) {
                // Seed each run with pending replacement, capture, and queued
                // mutation; the remaining commands vary failure and ownership.
                const kind = step < 3 ? ["replace", "capture", "write"][step] : kinds[randomInteger(random, kinds.length)]
                const command = { kind, value: randomInteger(random, 30), delayed: step === 0 || random() < 0.6 }
                trace.push(command)
                const key = array ? 0 : "n"
                let result
                if (kind === "capture" || kind === "fork") capture(kind)
                else {
                    if (kind === "replace") result = r.assignPath(chain, ["item"], input(fresh(command.value, array), command.delayed), ctx)
                    else if (kind === "write") result = r.assignPath(chain, ["item", key], input(command.value, command.delayed), ctx)
                    else if (kind === "length") result = r.assignPath(chain, ["item", "length"], input(command.value % 5, command.delayed), ctx)
                    else if (kind === "delete") result = r.deletePath(chain, ["item", key], ctx)
                    else if (kind === "repair") result = r.repairPath(chain, ["item"], ctx)
                    else if (kind === "fail") result = r.run(chain, ["item"], "missingMethod", [], ctx, { mutationScopeDepth: 1 })
                    else if (kind === "noop") result = r.deletePath(chain, ["item", array ? 20 : "absent"], ctx, 1)
                    else {
                        const value = input(command.value, command.delayed)
                        result = r.enter(chain, ["item"], ctx, true, inside => r.assignPath(inside, [key], value, ctx))
                    }
                    keep(result)
                    state = apply(state, command, array)
                }
                // Observe some intermediate states, without serializing issuance.
                if (random() < 0.4) { trace.push({ export: true }); capture("export") }
                if (sources.length && random() < 0.7) {
                    const selected = randomInteger(random, sources.length)
                    const [{ source, value }] = sources.splice(selected, 1)
                    trace.push({ release: selected })
                    source.resolve(value)
                }
                const turns = randomInteger(random, 5)
                trace.push({ turns })
                for (let turn = 0; turn < turns; turn++) await Promise.resolve()
            }
            while (sources.length) {
                const selected = randomInteger(random, sources.length)
                const [{ source, value }] = sources.splice(selected, 1)
                trace.push({ release: selected })
                source.resolve(value)
                await new Promise(setImmediate)
            }
            await Promise.all(work)
            check(await r.export(chain, ["item"], ctx), state)
            for (const snapshot of snapshots) check(snapshot.fork
                ? await r.export(snapshot.fork, ["item"], ctx)
                : snapshot.retained ? await r.export(await snapshot.retained, [], ctx)
                    : await snapshot.result, snapshot.expected)
            assert.equal(ctx.execution.fatalError, null)
            verifyRefCounts(ctx, chain._state, ...forks.map(fork => fork._state))
            traces.add(JSON.stringify({ array, delivery, trace }))
            cases++
        } catch (error) {
            throw new Error(`seed=${seed}, array=${array}, delivery=${delivery}, trace=${JSON.stringify(trace)}`, { cause: error })
        }
    }
}
assert.equal(traces.size, cases, "count distinct command/schedule traces")
console.log(JSON.stringify({ cases, distinctTraces: traces.size }))
