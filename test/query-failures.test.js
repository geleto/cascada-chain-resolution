import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import * as kernel from "cascada-chain-resolution/integration"
import * as refcounts from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new runtime.Execution(), errorContext: {} })
const flush = async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve()
}

// The same physical descriptor/keys helpers serve query indexing and export.
// These cases distinguish their host escapes from adjacent trusted failures.
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
                    " returns its own reflection failure, deferred=" +
                    deferred,
                async () => {
                    const ctx = context()
                    const cause = new Error("query reflection")
                    let fail = true
                    const target = { clean: 1 }
                    const root = new Proxy(target, {
                        ownKeys(value) {
                            if (fail) throw cause
                            return Reflect.ownKeys(value)
                        },
                    })
                    target.self = root
                    const chain = new runtime.Chain(
                        deferred ? Promise.resolve(root) : root,
                        ctx,
                    )
                    const result = query(chain, [], ctx)
                    const failure = deferred
                        ? await result.catch(error => error)
                        : result
                    assert(runtime.isPoisonError(failure))
                    assert.equal(failure.cause, cause)
                    assert.equal(failure.errorContext, ctx.errorContext)
                    assert.equal(
                        failure.kind,
                        runtime.ERROR_KIND.QueryReflectionFailed,
                    )
                    assert.equal(ctx.execution.fatalError, null)
                    fail = false
                    assert.equal(runtime.hasError(chain, [], ctx), false)
                    assert.deepEqual(runtime.getErrors(chain, [], ctx), [])
                    runtime.assignPath(chain, ["clean"], 2, ctx)
                    verifyRefCounts(ctx, root, chain._state.value)
                },
            )
        }
    }

    it("rejects partial getErrors promptly without waiting for unrelated pending siblings", async () => {
        const ctx = context()
        const known = kernel.createPoisonError(
            new Error("known"),
            ctx,
            kernel.ERROR_KIND.HostCallFailed,
        )
        const reveal = Promise.withResolvers()
        const cause = new Error("query scan")
        let scans = 0
        const branch = new Proxy(
            { pending: new Promise(() => {}) },
            {
                ownKeys(target) {
                    if (++scans === 2) throw cause
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
        assert.equal(scans, 2)
        assert.equal(runtime.lookupPath(chain, ["known"], ctx), known)
        verifyRefCounts(ctx, chain._state.value)
    })

    for (const proofFirst of [false, true]) {
        it(
            "closes hasError on the first proof or query failure, proofFirst=" +
                proofFirst,
            async () => {
                const ctx = context()
                const proof = Promise.withResolvers()
                const reveal = Promise.withResolvers()
                const cause = new Error("reflection")
                let scans = 0
                const branch = new Proxy(
                    { pending: new Promise(() => {}) },
                    {
                        ownKeys(target) {
                            if (++scans === 2) throw cause
                            return Reflect.ownKeys(target)
                        },
                    },
                )
                const chain = new runtime.Chain(
                    { proof: proof.promise, reveal: reveal.promise },
                    ctx,
                )
                const result = runtime.hasError(chain, [], ctx)
                // Install rejection ownership before choosing either outcome.
                const outcome = result.catch(error => error)
                if (proofFirst) proof.reject(new Error("proof"))
                else reveal.resolve(branch)
                await flush()
                if (proofFirst) reveal.resolve(branch)
                else proof.reject(new Error("proof"))
                const answer = await outcome
                await flush()
                if (proofFirst) {
                    assert.equal(answer, true)
                    assert.equal(scans, 1) // Only shared publication remains after closure.
                } else {
                    assert.equal(answer.cause, cause)
                    assert.equal(
                        answer.kind,
                        runtime.ERROR_KIND.QueryReflectionFailed,
                    )
                    assert.equal(scans, 2)
                }
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
