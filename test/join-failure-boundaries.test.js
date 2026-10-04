import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "cascada-chain-resolution"

describe("prepared join failure boundaries", () => {
    it("rejects real string-size overflow without failing unrelated operation work", () => {
        const sourceRoot = new URL("../src/index.js", import.meta.url).href
        const result = spawnSync(process.execPath,
            ["--unhandled-rejections=strict", "--input-type=module", "-e", `
                import assert from "node:assert/strict"
                import { constants } from "node:buffer"
                const r = await import(${JSON.stringify(sourceRoot)})
                const sparse = () => new Array(2 ** 30)
                const separator = "x".repeat(300000)
                const entry = "y".repeat(2 ** 23)
                const cases = [
                    { source: sparse, method: "join", args: [] },
                    { source: sparse, method: "toString", args: [] },
                    { source: sparse, method: "join", args: [], assignedLength: true },
                    { source: sparse, method: "join", args: [], view: true },
                    { source: () => new Array(2000), method: "join", args: [separator] },
                    { source: () => new Array(64).fill(entry), method: "join", args: [""] },
                    { source: () => [sparse()], method: "join", args: [] },
                    { source: () => [sparse(), []], method: "sort", args: [] },
                    { source: () => [sparse(), []], method: "toSorted", args: [] },
                    { source: () => [1], method: "at", args: [sparse()] },
                ]
                assert(2 ** 30 - 1 > constants.MAX_STRING_LENGTH)
                for (const pending of [false, true]) for (const scenario of cases) {
                    const source = scenario.source()
                    assert.throws(() => Reflect.apply(Array.prototype[scenario.method], source, scenario.args), RangeError)
                    const reports = [], execution = new r.Execution(error => reports.push(error))
                    const ctx = { execution, errorContext: { pending, method: scenario.method,
                        view: scenario.view, assignedLength: scenario.assignedLength } }
                    const signal = pending ? Promise.withResolvers() : undefined
                    const siblingSignal = Promise.withResolvers()
                    const sibling = r.import(siblingSignal.promise, ctx)
                    const unrelated = new r.Chain({ value: 1 }, ctx)
                    const initial = scenario.assignedLength ? [] : source
                    let chain = new r.Chain(r.import(signal?.promise ?? initial, ctx), ctx)
                    if (scenario.assignedLength) r.assignPath(chain, ["length"], source.length, ctx)
                    if (scenario.view) chain = new r.Chain(r.run(chain, [], "slice", [0], ctx, {}), ctx)
                    const result = r.run(chain, [], scenario.method, scenario.args, ctx, {})
                    assert.equal(result instanceof Promise, pending)
                    signal?.resolve(initial)
                    const failure = await result
                    assert(r.isPoisonError(failure))
                    assert.equal(failure.kind, r.ERROR_KIND.ScalarConversionFailed)
                    assert.equal(failure.errorContext, ctx.errorContext)
                    assert.equal(execution.fatalError, null)
                    assert.deepEqual(reports, [])
                    assert.equal(r.lookupPath(unrelated, ["value"], ctx), 1)
                    r.assignPath(unrelated, ["value"], 2, ctx)
                    assert.equal(r.lookupPath(unrelated, ["value"], ctx), 2)
                    siblingSignal.resolve(3)
                    assert.equal(await sibling, 3)
                    assert.equal(r.lookupPath(chain, ["length"], ctx), source.length)
                    if (scenario.assignedLength) assert.equal(initial.length, 0)
                }
            `], { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const pending of [false, true]) {
        it(`preserves native UTF-16 strings and sparse separators, pending=${pending}`, async () => {
            for (const [source, separator] of [
                [[], "long separator"],
                [["😀"], "long separator"],
                [new Array(5), "😀"],
                [["😀", , null, undefined, "end"], "|"],
                [[["😀", , "end"], , "last"], "::"],
            ]) {
                const ctx = { execution: new r.Execution(), errorContext: { pending } }
                const signal = pending ? Promise.withResolvers() : undefined
                const chain = new r.Chain(r.import(signal?.promise ?? source, ctx), ctx)
                const result = r.run(chain, [], "join", [separator], ctx, {})
                signal?.resolve(source)
                assert.equal(await result, source.join(separator))
                assert.equal(ctx.execution.fatalError, null)
            }
        })
    }

    it("keeps join and scalar-conversion defects fatal before and after suspension", () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/join-internal-failure.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const pending of [false, true]) {
        it(`preserves recoverable Symbol conversion, pending=${pending}`, async () => {
            const reports = [], execution = new r.Execution(error => reports.push(error))
            const ctx = { execution, errorContext: "Symbol conversion" }
            const signal = pending ? Promise.withResolvers() : undefined
            const symbol = Symbol("value")
            const chain = new r.Chain([signal?.promise ?? symbol, "b"], ctx)
            const result = r.run(chain, [], "join", ["|"], ctx, {})
            signal?.resolve(symbol)
            const failure = await result
            assert(r.isPoisonError(failure))
            assert.equal(failure.kind, r.ERROR_KIND.ScalarConversionFailed)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(execution.fatalError, null)
            assert.deepEqual(reports, [])
            assert.equal(r.import(1, ctx), 1)
        })

        for (const value of [Symbol("index"), 0n]) {
            it(`preserves recoverable ${typeof value} numeric conversion, pending=${pending}`, async () => {
                const reports = [], execution = new r.Execution(error => reports.push(error))
                const initialize = { execution, errorContext: "initialization" }
                const ctx = { execution, errorContext: "numeric conversion" }
                const signal = pending ? Promise.withResolvers() : undefined
                const chain = new r.Chain(["a", "b"], initialize)
                const result = r.run(chain, [], "at", [signal?.promise ?? value], ctx, {})
                assert.equal(result instanceof Promise, pending)
                signal?.resolve(value)
                const failure = await result
                assert(r.isPoisonError(failure))
                assert.equal(failure.kind, r.ERROR_KIND.ScalarConversionFailed)
                assert.equal(failure.errorContext, ctx.errorContext)
                assert.equal(execution.fatalError, null)
                assert.deepEqual(reports, [])
                assert.equal(r.lookupPath(chain, [0], initialize), "a")
            })
        }

        it(`converts supported primitives to strings, pending=${pending}`, async () => {
            for (const value of [0n, 42n, 2, true, "text"]) {
                const ctx = { execution: new r.Execution(), errorContext: "string conversion" }
                const signal = pending ? Promise.withResolvers() : undefined
                const chain = new r.Chain([signal?.promise ?? value, "b"], ctx)
                const result = r.run(chain, [], "join", ["|"], ctx, {})
                assert.equal(result instanceof Promise, pending)
                signal?.resolve(value)
                assert.equal(await result, [value, "b"].join("|"))
                assert.equal(ctx.execution.fatalError, null)
            }
        })
    }
})
