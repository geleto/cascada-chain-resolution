import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as r from "cascada-chain-resolution"

describe("Array sort failure boundaries", () => {
    for (const method of ["sort", "toSorted"]) for (const pending of [false, true]) {
        for (const outcome of ["throw", "return Error", "return poison", "invalid", "Promise"]) {
            it(`${method} keeps explicit comparator failure recoverable: ${outcome}, pending=${pending}`, async () => {
                const reports = [], execution = new r.Execution(error => reports.push(error))
                const initialization = { execution, errorContext: "initialization" }
                const ctx = { execution, errorContext: "comparison" }
                const signal = pending ? Promise.withResolvers() : undefined
                const original = [pending ? signal.promise : 2, 1]
                const chain = new r.Chain(r.import(original, initialization), initialization)
                const cause = new Error("comparator failed")
                const poison = r.createPoisonError(cause, initialization, r.ERROR_KIND.InvocationFailed)
                const comparator = () => {
                    if (outcome === "throw") throw cause
                    if (outcome === "return Error") return cause
                    if (outcome === "return poison") return poison
                    if (outcome === "Promise") return Promise.resolve(0)
                    return "invalid"
                }
                const result = r.run(chain, [], method, [comparator], ctx,
                    method === "sort" ? { mutationScopeDepth: 0 } : {})
                if (pending) {
                    assert(result instanceof Promise)
                    signal.resolve(2)
                }
                const failure = await result
                assert(r.isPoisonError(failure))
                if (outcome === "return poison") assert.equal(failure, poison)
                else {
                    assert.equal(failure.errorContext, ctx.errorContext)
                    assert.equal(failure.kind, outcome === "throw" || outcome === "return Error"
                        ? r.ERROR_KIND.ControlledCallbackFailed : r.ERROR_KIND.InvalidCallbackResult)
                    if (outcome === "throw" || outcome === "return Error") assert.equal(failure.cause, cause)
                }
                assert.equal(execution.fatalError, null)
                assert.deepEqual(reports, [])
                assert.equal(original[0], pending ? signal.promise : 2)
                assert.equal(original[1], 1)
                if (method === "sort") assert.equal(r.lookupPath(chain, [], ctx), failure)
                else assert.deepEqual(r.export(chain, [], ctx), [2, 1])
                assert.equal(r.import(3, ctx), 3)
            })
        }
    }

    it("keeps internal comparator and thenability defects fatal before and after suspension", () => {
        // Inject defects into trusted helpers, leaving all public calls, host
        // values, primordials, and runtime integration facts intact.
        const sourceRoot = new URL("../src/", import.meta.url).href
        const script = `
            import assert from "node:assert/strict"
            import { registerHooks } from "node:module"
            const root = ${JSON.stringify(sourceRoot)}
            let armed, checkingResult = false
            globalThis.sortBoundaryFault = site => {
                if (!armed || armed.site !== site || site === "pending" && !checkingResult) return
                const cause = armed.cause
                armed = undefined
                throw cause
            }
            registerHooks({ load(url, context, next) {
                const result = next(url, context)
                let source = String(result.source)
                const markers = url === root + "array-methods.js" ? [
                    ["function comparePreparedKeys(left, right) {", "default"],
                    ["function compareExported(comparator, left, right, operationContext) {", "custom"],
                ] : url === root + "thenable-subscription.js" ? [
                    ["function mayBeThenable(value, operationContext) {", "pending"],
                ] : []
                for (const [marker, site] of markers) {
                    assert(source.includes(marker), "Sort fault anchor needs updating")
                    source = source.replace(marker, marker + ' globalThis.sortBoundaryFault("' + site + '");')
                }
                return markers.length ? { ...result, source } : result
            } })
            const r = await import(root + "index.js")
            for (const method of ["sort", "toSorted"])
            for (const pending of [false, true])
            for (const site of ["default", "custom", "pending"])
            for (const poison of [false, true]) {
                const label = [method, pending, site, poison].join(" ")
                const reports = [], execution = new r.Execution(error => reports.push(error))
                const initialization = { execution, errorContext: "initialization" }
                const ctx = { execution, errorContext: label }
                const signal = pending ? Promise.withResolvers() : undefined
                const original = [pending ? signal.promise : 2, 1]
                const chain = new r.Chain(r.import(original, initialization), initialization)
                const sibling = r.import(new Promise(() => {}), initialization)
                    .then(value => ({ value }), error => ({ error }))
                const cause = poison ? r.createPoisonError(new Error("internal defect"),
                    initialization, r.ERROR_KIND.InvocationFailed) : new Error("internal defect")
                checkingResult = false
                armed = { site, cause }
                const comparator = () => { checkingResult = true; return 0 }
                let result, synchronousFailure
                try {
                    result = r.run(chain, [], method, site === "default" ? [] : [comparator], ctx,
                        method === "sort" ? { mutationScopeDepth: 0 } : {})
                } catch (error) { synchronousFailure = error }
                const outcome = Promise.resolve(result).then(value => ({ value }), error => ({ error }))
                if (pending) {
                    assert(result instanceof Promise, label)
                    signal.resolve(2)
                }
                const observed = await outcome
                const fatal = execution.fatalError
                assert(r.isFatalError(fatal), label)
                assert.equal(fatal.cause, cause, label)
                assert.equal(fatal.errorContext, ctx.errorContext, label)
                assert.equal(pending ? observed.error : synchronousFailure, fatal, label)
                assert.equal((await sibling).error, fatal, label)
                assert.deepEqual(reports, [fatal], label)
                assert.equal(original[0], pending ? signal.promise : 2, label)
                assert.equal(original[1], 1, label)
                assert.throws(() => r.assignPath(chain, [0], 3, ctx), error => error === fatal, label)
                armed = undefined
            }
        `
        const child = spawnSync(process.execPath,
            ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
            { encoding: "utf8", timeout: 10000 })
        assert.equal(child.status, 0, child.stdout + child.stderr)
    })
})
