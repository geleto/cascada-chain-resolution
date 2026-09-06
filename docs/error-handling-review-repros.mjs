// Targeted review probes, not assertions of desired behavior.
// Run from the repository root:
// node --unhandled-rejections=strict docs/error-handling-review-repros.mjs C:/Projects/cascada
import * as runtime from "../src/index.js"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

function context(label) {
    return Object.freeze({
        execution: new runtime.Execution(),
        errorContext: Object.freeze({ label }),
    })
}

function record(probe, facts) {
    console.log(JSON.stringify({ probe, ...facts }))
}

{
    const ctx = context("recoverable indexing failure")
    const target = new runtime.Chain({ slot: 0 }, ctx)
    runtime.hasError(target, [], ctx)

    const a = {}
    const b = { back: a }
    a.b = b
    a.bad = new Proxy({}, {
        ownKeys() { throw new Error("reflection failed") },
    })
    const retained = new runtime.Chain(b, ctx)
    const failure = runtime.assignPath(target, ["slot"], a, ctx)
    record("recoverable assignment", {
        error: failure?.name,
        kind: failure?.kind,
        executionStillLive: ctx.execution.fatalError === null,
    })
    try {
        runtime.hasError(retained, [], ctx)
    } catch (error) {
        record("query after recoverable assignment", {
            error: error.name,
            message: error.message,
        })
    }
}

{
    const ctx = context("exact diagnostic cause")
    const chain = new runtime.Chain({
        n: 1,
        fail() { throw this },
    }, ctx)
    const failure = runtime.run(chain, [], "fail", [], ctx, {})
    const before = runtime.lookupPath(chain, ["n"], ctx)
    // Deliberately exercise the access exposed by the diagnostic cause.
    // This demonstrates the source alias; it does not propose permitting
    // host mutation of an unexported managed receiver.
    failure.cause.n = 9
    record("cause exposes managed source", {
        kind: failure.kind,
        before,
        after: runtime.lookupPath(chain, ["n"], ctx),
    })
}

{
    const ctx = context("Function classification and native assimilation")
    let calls = 0
    function fn() {}
    fn.then = onFulfilled => {
        calls++
        onFulfilled("assimilated")
    }
    const ready = new runtime.Chain({ fn }, ctx)
    const pending = new runtime.Chain(Promise.resolve({ fn }), ctx)
    const direct = runtime.lookupPath(ready, ["fn"], ctx)
    const delayed = await runtime.lookupPath(pending, ["fn"], ctx)
    record("Function then precedence", {
        readyIsFunction: direct === fn,
        delayed,
        calls,
        executionStillLive: ctx.execution.fatalError === null,
    })
}

{
    const ctx = context("managed receiver validation")
    const chain = new runtime.Chain({
        n: 1,
        change() {
            Object.defineProperty(this, "then", {
                value: onFulfilled => onFulfilled(99),
                configurable: true,
            })
            return this
        },
    }, ctx)
    const result = runtime.run(chain, [], "change", [], ctx, {
        mutationScopeDepth: 0,
    })
    record("non-enumerable then survives validation", {
        resultIsError: Error.isError(result),
        nativeThen: typeof result.then,
        awaited: await result,
        executionStillLive: ctx.execution.fatalError === null,
    })
}

if (process.argv[2]) {
    const loopModule = pathToFileURL(resolve(
        process.argv[2], "src/runtime/loop.js",
    ))
    const { iterateAsyncSequential } = await import(loopModule.href)
    let failed = false
    let closed = 0
    let bodyCalls = 0
    const pending = Promise.withResolvers()
    const iterable = {
        [Symbol.asyncIterator]() { return this },
        next() { return pending.promise },
        return() {
            closed++
            return Promise.resolve({ done: true })
        },
    }
    const source = [1, 1, "loop", "review", null, {
        isFatalErrorReported() { return failed },
    }]
    const result = iterateAsyncSequential(iterable, () => {
        bodyCalls++
    }, ["x"], source)
    failed = true
    pending.resolve({ done: false, value: 1 })
    await result
    record("Cascada iterator close after fatal observation", {
        closed,
        bodyCalls,
    })
}
