import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import * as refcounts from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"

const context = () => ({ execution: new runtime.Execution(), errorContext: {} })
const flush = async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve()
}

// The same physical descriptor/keys helpers serve query indexing and export.
// These cases distinguish their external escapes from adjacent trusted failures.
describe("query and export failure boundaries", () => {
    for (const operation of [
        runtime.hasError,
        runtime.getErrors,
        runtime.export,
    ]) {
        it(
            operation.name +
                " keeps adjacent internal traversal failures fatal",
            () => {
                const ctx = context()
                const root = { value: 1 }
                const chain = new runtime.Chain(root, ctx)
                const cause = new Error("corrupt admission facts")
                Object.defineProperty(
                    ctx.execution._metadata.get(root),
                    "type",
                    {
                        get() {
                            throw cause
                        },
                    },
                )
                assert.throws(
                    () => operation(chain, [], ctx),
                    failure => {
                        assert(runtime.isFatalError(failure))
                        assert.equal(failure.cause, cause)
                        assert.equal(ctx.execution.fatalError, failure)
                        return true
                    },
                )
            },
        )
    }
    for (const query of [runtime.hasError, runtime.getErrors]) {
        for (const deferred of [false, true]) {
            it(
                query.name +
                    " reports its own reflection failure, deferred=" +
                    deferred,
                async () => {
                    const ctx = context()
                    const cause = new Error("query reflection")
                    let fail = false
                    const target = { clean: 1 }
                    const root = new Proxy(target, {
                        ownKeys(value) {
                            if (fail) throw cause
                            return Reflect.ownKeys(value)
                        },
                    })
                    target.self = root
                    new runtime.Chain(root, ctx)
                    const chain = new runtime.Chain(
                        deferred ? Promise.resolve(root) : root,
                        ctx,
                    )
                    fail = true
                    const result = query(chain, [], ctx)
                    const failure = deferred
                        ? await result
                        : result
                    if (query === runtime.hasError) assert.equal(failure, true)
                    else {
                        assert(runtime.isPoisonError(failure))
                        assert.equal(failure.cause, cause)
                        assert.equal(failure.errorContext, ctx.errorContext)
                        assert.equal(failure.kind, runtime.ERROR_KIND.QueryReflectionFailed)
                    }
                    assert.equal(ctx.execution.fatalError, null)
                    fail = false
                    assert.equal(runtime.hasError(chain, [], ctx), false)
                    assert.equal(runtime.getErrors(chain, [], ctx), null)
                    runtime.assignPath(chain, ["clean"], 2, ctx)
                    verifyRefCounts(ctx, root, chain._state.value)
                },
            )
        }
    }

    it("finishes failed getErrors promptly without waiting for unrelated pending siblings", async () => {
        const ctx = context()
        const known = runtime.createPoisonError(
            new Error("known"),
            ctx,
            runtime.ERROR_KIND.InvocationFailed,
        )
        const reveal = Promise.withResolvers()
        const cause = new Error("query scan")
        let scans = 0
        const branch = new Proxy(
            { pending: new Promise(() => {}) },
            {
                ownKeys(target) {
                    if (++scans === 3) throw cause
                    return Reflect.ownKeys(target)
                },
            },
        )
        const chain = new runtime.Chain(
            { known, reveal: reveal.promise, slow: new Promise(() => {}) },
            ctx,
        )
        const result = runtime.getErrors(chain, [], ctx)
        reveal.resolve(branch)
        const failure = await result.catch(error => error)
        assert.equal(failure.cause, cause)
        assert.equal(failure.kind, runtime.ERROR_KIND.QueryReflectionFailed)
        assert.equal(failure.errors, undefined)
        assert.equal(ctx.execution.fatalError, null)
        assert.equal(scans, 3) // Preparation, shared indexing, then the query.
        assert.equal(runtime.lookupPath(chain, ["known"], ctx), known)
        verifyRefCounts(ctx, chain._state.value)
    })

    for (const delivery of ["ready", "synchronous", "native", "ordered"])
    for (const proofFirst of [false, true]) {
        it(
            `hasError returns true for poison or inspection failure: ${delivery}, proofFirst=${proofFirst}`,
            async () => {
                const ctx = context()
                const proof = delivery === "ordered" ? new OrderedThenable() : Promise.withResolvers()
                const reveal = delivery === "ordered" ? new OrderedThenable() : Promise.withResolvers()
                const poison = runtime.createPoisonError(new Error("proof"), ctx, runtime.ERROR_KIND.OperationInputFailed)
                const cause = new Error("reflection")
                let scans = 0
                const branch = new Proxy(
                    { pending: new Promise(() => {}) },
                    {
                        ownKeys(target) {
                            if (++scans === 3) throw cause
                            return Reflect.ownKeys(target)
                        },
                    },
                )
                const input = (value, gate) => delivery === "ready" ? value
                    : delivery === "synchronous" ? ready(value) : gate.promise ?? gate
                const chain = new runtime.Chain({ proof: input(poison, proof), reveal: input(branch, reveal) }, ctx)
                const result = runtime.hasError(chain, [], ctx)
                const pending = delivery === "native" || delivery === "ordered"
                assert.equal(runtime.isPending(result, ctx), pending)
                if (pending) {
                    if (proofFirst) proof.resolve(poison)
                    else reveal.resolve(branch)
                }
                // Neither the other root nor the branch's pending child is required
                // once either kind of poison has proved the Boolean answer.
                assert.equal(await result, true)
                if (pending) {
                    if (proofFirst) reveal.resolve(branch)
                    else proof.resolve(poison)
                }
                await flush()
                // Preparation and shared indexing remain after query closure.
                assert.equal(scans, pending && !proofFirst ? 3 : 2)
                assert.equal(ctx.execution.fatalError, null)
            },
        )
    }

    it("keeps cyclic indexes usable after export reflection fails and preserves all required errors", async () => {
        const ctx = context()
        const cause = new Error("export reflection")
        const later = Promise.withResolvers()
        const laterCause = new Error("later input")
        let fail = false
        const proxy = new Proxy(
            { value: 1 },
            {
                ownKeys(target) {
                    if (fail) throw cause
                    return Reflect.ownKeys(target)
                },
            },
        )
        const root = { proxy, later: later.promise }
        root.self = root
        const chain = new runtime.Chain(root, ctx)
        refcounts.buildRefIndex(root, ctx)
        fail = true
        let done = false
        // Phase 9D-A transport: export fulfills with non-thenable poison.
        // Phase 9D-B changes this outcome to rejection; collection stays complete.
        const exported = runtime.export(chain, [], ctx).then(value => {
            done = true
            return value
        })
        await flush()
        assert.equal(done, false)
        later.reject(laterCause)
        const failure = await exported
        assert.deepEqual(
            new Set(failure.errors.map(error => error.cause)),
            new Set([cause, laterCause]),
        )
        assert(
            failure.errors.some(
                error =>
                    error.kind === runtime.ERROR_KIND.ExportReflectionFailed,
            ),
        )
        assert.equal(ctx.execution.fatalError, null)
        fail = false
        runtime.assignPath(chain, ["proxy", "value"], 2, ctx)
        verifyRefCounts(ctx, root, proxy, chain._state.value)
    })
})
