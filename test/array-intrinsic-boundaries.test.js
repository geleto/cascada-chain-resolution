import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

const sourceRoot = new URL("../src/", import.meta.url).href
function runFixture(script) {
    const result = spawnSync(process.execPath,
        ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
        { encoding: "utf8", timeout: 10000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
}

describe("trusted Array intrinsic boundaries", function () {
    this.timeout(15000)
    it("rejects sparse concat overflow before native copying or backing extension", () => {
        runFixture(`
            import assert from "node:assert/strict"
            const r = await import(${JSON.stringify(sourceRoot + "index.js")})
            for (const route of ["direct", "imported", "view"])
            for (const large of ["receiver", "argument"])
            for (const pending of [false, true]) {
                const label = [route, large, pending].join(" ")
                const reports = [], execution = new r.Execution(error => reports.push(error))
                const ctx = { execution, errorContext: label }
                const source = large === "receiver" ? new Array(0xffffffff) : [1, 2]
                let chain = new r.Chain(route === "imported" ? r.import(source, ctx) : source, ctx, r.CHAIN_MODE.Complete)
                if (route === "view") chain = new r.Chain(r.run(chain, [], "slice", [0], ctx, {}), ctx, r.CHAIN_MODE.Complete)
                const argument = large === "argument" ? new Array(0xffffffff) : [1]
                const signal = pending ? Promise.withResolvers() : undefined
                const result = r.run(chain, [], "concat", [pending ? signal.promise : argument], ctx, {})
                if (pending) { assert(result instanceof Promise, label); signal.resolve(argument) }
                const failure = await result
                assert(r.isPoisonError(failure), label)
                assert.equal(failure.kind, r.ERROR_KIND.InvalidArrayLength, label)
                assert.equal(failure.errorContext, ctx.errorContext, label)
                assert.equal(r.lookupPath(chain, ["length"], ctx), source.length, label)
                assert.equal(r.run(chain, [], "at", [0], ctx, {}), large === "receiver" ? undefined : 1, label)
                assert.equal(argument.length, large === "argument" ? 0xffffffff : 1, label)
                assert.equal(execution.fatalError, null, label)
                assert.deepEqual(reports, [], label)
            }
            for (const imported of [false, true]) {
                const ctx = { execution: new r.Execution(), errorContext: { imported, growth: true } }
                const source = new Array(0xfffffffe)
                const chain = new r.Chain(imported ? r.import(source, ctx) : source, ctx, r.CHAIN_MODE.Complete)
                const hold = Promise.withResolvers()
                let inside
                const entry = r.enter(chain, [0xfffffffe], ctx, true, entered => {
                    inside = entered
                    return hold.promise
                })
                const result = r.run(chain, [], "concat", [[1]], ctx, {})
                assert(result instanceof Promise)
                r.assignPath(inside, [], 5, ctx)
                hold.resolve()
                await entry
                const failure = await result
                assert(r.isPoisonError(failure))
                assert.equal(failure.kind, r.ERROR_KIND.InvalidArrayLength)
                assert.equal(failure.errorContext, ctx.errorContext)
                assert.equal(r.lookupPath(chain, ["length"], ctx), 0xffffffff)
                assert.equal(ctx.execution.fatalError, null)
            }
        `)
    })

    it("keeps private concat and flat algorithm defects fatal with their causal context", () => {
        runFixture(`
            import assert from "node:assert/strict"
            import { registerHooks } from "node:module"
            const target = ${JSON.stringify(sourceRoot + "array-methods.js")}
            const flatTarget = ${JSON.stringify(sourceRoot + "array-flat-stream.js")}
            let armed
            globalThis.arrayIntrinsicFault = method => {
                if (!armed || armed.method !== method || --armed.remaining > 0) return
                const cause = armed.cause
                armed = undefined
                throw cause
            }
            registerHooks({ load(url, context, next) {
                const result = next(url, context)
                if (url === flatTarget) {
                    const source = String(result.source), marker = "publishLayout(node, ctx)"
                    assert.equal(source.split(marker).length - 1, 1, "Flat publication anchor needs updating")
                    return { ...result, source: source.replace(marker, '(globalThis.arrayIntrinsicFault("flat"), ' + marker + ')') }
                }
                if (url !== target) return result
                let source = String(result.source)
                const concat = "const extended = arrayRemaps.appendView(work.receiver, parts, length,"
                assert.equal(source.split(concat).length - 1, 1, "Concat publication anchor needs updating")
                source = source.replace(concat, 'globalThis.arrayIntrinsicFault("concat"); ' + concat)
                const mapped = "const sequence = concatSequence(receiver, suffix, ctx, streaming)"
                assert.equal(source.split(mapped).length - 1, 1, "Concat mapping anchor needs updating")
                source = source.replace(mapped, 'globalThis.arrayIntrinsicFault("concat"); ' + mapped)
                return { ...result, source }
            } })
            const r = await import(${JSON.stringify(sourceRoot + "index.js")})
            const cases = [
                { method: "concat", imported: false, ordinal: 1 },
                { method: "concat", imported: true, ordinal: 1 },
                { method: "concat", imported: true, ordinal: 2 },
                { method: "flat", imported: false, ordinal: 1 },
                { method: "flat", imported: true, ordinal: 1 },
            ]
            for (const { method, imported, ordinal } of cases)
            for (const pending of [false, true])
            for (const reason of ["Error", "poison", "undefined"]) {
                const label = [method, imported, ordinal, pending, reason].join(" ")
                const reports = [], execution = new r.Execution(error => reports.push(error))
                const initialization = { execution, errorContext: "initialization" }
                const ctx = { execution, errorContext: label }
                const original = method === "flat" ? [[2], 1] : [2, 1]
                const chain = new r.Chain(imported ? r.import(original, initialization) : original, initialization, r.CHAIN_MODE.Complete)
                const signal = pending ? Promise.withResolvers() : undefined
                const argument = method === "flat" ? 1 : [3]
                const sibling = r.import(new Promise(() => {}), initialization)
                    .then(value => ({ value }), error => ({ error }))
                const cause = reason === "undefined" ? undefined : reason === "poison"
                    ? r.createPoisonError(new Error("intrinsic defect"), initialization, r.ERROR_KIND.InvocationFailed)
                    : new Error("intrinsic defect")
                armed = { method, remaining: ordinal, cause }
                let result, synchronousFailure
                try { result = r.run(chain, [], method, [pending ? signal.promise : argument], ctx, {}) }
                catch (error) { synchronousFailure = error }
                const outcome = Promise.resolve(result).then(value => ({ value }), error => ({ error }))
                if (pending) { assert(result instanceof Promise, label); signal.resolve(argument) }
                const observed = await outcome
                const fatal = execution.fatalError
                assert(r.isFatalError(fatal), label)
                assert.equal(fatal.cause, cause, label)
                assert.equal(fatal.errorContext, ctx.errorContext, label)
                assert.equal(pending ? observed.error : synchronousFailure, fatal, label)
                assert.equal((await sibling).error, fatal, label)
                assert.deepEqual(reports, [fatal], label)
                assert.throws(() => r.assignPath(chain, [0], 3, ctx), error => error === fatal, label)
                assert.deepEqual(original, method === "flat" ? [[2], 1] : [2, 1], label)
                armed = undefined
            }
        `)
    })
})
