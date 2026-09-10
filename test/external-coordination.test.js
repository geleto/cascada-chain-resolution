import * as externalTree from "../src/external-mutation-tree.js"
import { EXTERNAL_BOUNDARY } from "../src/external-mutation-tree.js"
import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import { ExternalOperationContext, validateExternalAccess } from "../src/external-operation.js"
import { OperationOwner } from "../src/operation-lifecycle.js"

const context = (execution = new runtime.Execution()) => Object.freeze({
    execution, errorContext: Object.freeze({ operation: "external coordination" }),
})
const poison = (ctx, kind = runtime.ERROR_KIND.InvocationFailed) =>
    runtime.createPoisonError(new Error(kind), ctx, kind)
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
const external = () => runtime.externalState({})

function fixture(count = 1) {
    const ctx = context()
    const identities = Array.from({ length: count }, external)
    const chain = new runtime.ContextChain({ identities }, ctx, {
        identities: Object.fromEntries(identities.map((_, index) => [index, {}])),
    })
    const boundaries = externalTree.findDescendantBoundaries(chain._externalMutationTree, [])
    return { ctx, identities, chain, boundaries }
}

const start = (ctx, boundary, exclusive = false, repair = false) =>
    ExternalOperationContext.reserve(ctx, boundary, exclusive, repair)

async function finish(operation, failure = null) {
    if (runtime.isPoisonError(operation)) return operation
    await operation.ready
    const previous = operation.prepare()
    operation.complete(previous ?? failure)
    return previous
}

describe("external binding commit", () => {
    for (const shape of ["direct", "managed aliases"]) {
        for (const reverse of [false, true]) {
            it(`rejects duplicate candidate paths atomically: ${shape}, reverse=${reverse}`, () => {
                const ctx = context()
                const identity = external()
                const shared = { identity }
                const value = shape === "direct" ? identity : shared
                const keys = reverse ? ["second", "first"] : ["first", "second"]
                const root = Object.fromEntries(keys.map(key => [key, value]))
                root.self = root
                const request = shape === "direct" ? {} : { identity: {} }
                const tree = Object.fromEntries(keys.map(key => [key, request]))
                const chain = new runtime.ContextChain(root, ctx, tree)
                const failure = runtime.lookupPath(chain, [], ctx)
                assert.equal(failure.kind, runtime.ERROR_KIND.ExternalLocationConflict)
                assert.equal(failure.errorContext, ctx.errorContext)
                assert.equal(chain._externalMutationTree, undefined)
                for (const value of [root, shared, identity]) {
                    assert.equal(ctx.execution._metadata.has(value), false)
                    assert.equal(ctx.execution._externalIdentities.has(value), false)
                }
                assert.equal(ctx.execution.fatalError, null)
            })
        }
    }

    it("stops merged native-suffix requests at one owning boundary", () => {
        const ctx = context()
        const identity = external()
        const chain = new runtime.ContextChain({ items: [identity] }, ctx,
            { items: { 0: { opaque: {}, field: {} } } })
        const boundaries = externalTree.findDescendantBoundaries(chain._externalMutationTree, [])
        assert.equal(boundaries.length, 1)
        assert.deepEqual(boundaries[0].path, ["items", "0"])
        assert.equal(boundaries[0][EXTERNAL_BOUNDARY].binding, boundaries[0])
        assert.equal(boundaries[0][EXTERNAL_BOUNDARY].phase, undefined)
    })

    it("abandons pending import work without invalidating an existing registration", async () => {
        const { ctx, identities: [existing], boundaries: [boundary] } = fixture()
        const duplicate = external()
        const pending = Promise.withResolvers()
        const root = { existing, pending: pending.promise, rawError: new Error("staged"), first: duplicate, second: duplicate }
        const chain = new runtime.ContextChain(root, ctx, { existing: {}, first: {}, second: {} })
        assert.equal(runtime.lookupPath(chain, [], ctx).kind, runtime.ERROR_KIND.ExternalLocationConflict)
        assert.equal(boundary[EXTERNAL_BOUNDARY].binding, boundary)
        assert.equal(boundary[EXTERNAL_BOUNDARY].phase, undefined)
        const late = { identity: external(), error: new Error("abandoned") }
        pending.resolve(late)
        await flush()
        assert.equal(root.pending, pending.promise)
        for (const value of [root, duplicate, late, late.identity]) {
            assert.equal(ctx.execution._metadata.has(value), false)
            assert.equal(ctx.execution._externalIdentities.has(value), false)
        }
    })

    for (const regularFirst of [false, true]) {
        it(`leaves regular imports inert and invalidates competing context bindings, regularFirst=${regularFirst}`, () => {
            const ctx = context()
            const identity = external()
            const root = { identity, inertAlias: identity }
            assert.equal(validateExternalAccess(identity, undefined, ctx), null)
            let ordinary
            if (regularFirst) ordinary = new runtime.Chain(runtime.import(root, ctx), ctx)
            const first = new runtime.ContextChain(root, ctx, { identity: {} })
            if (!regularFirst) ordinary = new runtime.Chain(runtime.import(root, ctx), ctx)
            const boundary = externalTree.findExactBoundary(first._externalMutationTree, ["identity"])
            assert.equal(boundary[EXTERNAL_BOUNDARY].binding, boundary)
            assert.equal(validateExternalAccess(identity, undefined, ctx).kind, runtime.ERROR_KIND.ExternalLocationConflict)
            assert.equal(boundary[EXTERNAL_BOUNDARY].binding, boundary)
            assert.equal(boundary[EXTERNAL_BOUNDARY].phase, undefined)
            assert.equal(runtime.lookupPath(ordinary, ["identity"], ctx), identity)

            const secondContext = context(ctx.execution)
            const second = new runtime.ContextChain({ identity }, secondContext, { identity: {} })
            const failure = boundary[EXTERNAL_BOUNDARY].binding
            assert.equal(failure.kind, runtime.ERROR_KIND.ExternalLocationConflict)
            assert.equal(failure.errorContext, secondContext.errorContext)
            assert.equal(validateExternalAccess(identity, boundary, ctx), failure)
            assert.equal(validateExternalAccess(identity, undefined, ctx), failure)
            for (const chain of [first, second]) {
                assert.equal(externalTree.findDescendantBoundaries(chain._externalMutationTree, []).length, 1)
                assert.equal(externalTree.findDescendantBoundaries(chain._externalMutationTree, ["identity", "opaque"])[0][EXTERNAL_BOUNDARY].binding, failure)
                assert.equal(externalTree.findExactBoundary(chain._externalMutationTree, ["identity"])[EXTERNAL_BOUNDARY].binding, failure)
                assert.equal(runtime.lookupPath(chain, ["identity"], ctx), identity)
            }
            new runtime.ContextChain({ identity }, ctx, { identity: {} })
            assert.equal(boundary[EXTERNAL_BOUNDARY].binding, failure)
            assert.equal(boundary[EXTERNAL_BOUNDARY].phase, undefined)
        })
    }

    for (const registered of [false, true]) {
        it(`treats a changed identity at an exact leaf as fatal: registered=${registered}`, () => {
            const { ctx, identities, boundaries: [boundary] } = fixture(2)
            const changed = registered ? identities[1] : external()
            assert.throws(() => validateExternalAccess(changed, boundary, ctx), runtime.isFatalError)
            assert.equal(runtime.isFatalError(ctx.execution.fatalError), true)
        })
    }

    it("invalidates both context claims in either registration order", () => {
        for (const paths of [["left", "right"], ["right", "left"]]) {
            const ctx = context()
            const identity = external()
            const chains = paths.map(key => new runtime.ContextChain({ [key]: identity }, ctx, { [key]: {} }))
            const boundaries = chains.map((chain, index) => externalTree.findExactBoundary(chain._externalMutationTree, [paths[index]]))
            const failure = boundaries[0][EXTERNAL_BOUNDARY].binding
            assert.equal(failure.kind, runtime.ERROR_KIND.ExternalLocationConflict)
            for (const boundary of boundaries) {
                assert.equal(validateExternalAccess(identity, boundary, ctx), failure)
                assert.equal(boundary[EXTERNAL_BOUNDARY].phase, undefined)
            }
        }
    })
})


describe("external readers-writer coordination", () => {
    it("reserves, checks authority, and reads phase poison without inspecting native state", async () => {
        const ctx = context()
        let reads = 0
        const identity = runtime.externalState(new Proxy({}, {
            get(target, key, receiver) {
                reads++
                return Reflect.get(target, key, receiver)
            },
            getOwnPropertyDescriptor(target, key) {
                reads++
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        }))
        const chain = new runtime.ContextChain({ identity }, ctx, { identity: {} })
        const boundary = externalTree.findExactBoundary(chain._externalMutationTree, ["identity"])
        reads = 0
        const failure = poison(ctx)
        assert.equal(validateExternalAccess(identity, boundary, ctx), null)
        await finish(start(ctx, boundary, true), failure)
        assert.equal(await finish(start(ctx, boundary)), failure)
        await finish(start(ctx, boundary, false, true))
        assert.equal(await finish(start(ctx, boundary)), null)
        assert.equal(reads, 0)
    })

    it("overlaps observations and waits for the entire group before mutation", async () => {
        const { ctx, boundaries: [boundary] } = fixture()
        const first = start(ctx, boundary)
        const second = start(ctx, boundary)
        const writer = start(ctx, boundary, true)
        const later = start(ctx, boundary)
        let writerReady = false, laterReady = false
        writer.ready.then(() => { writerReady = true })
        later.ready.then(() => { laterReady = true })
        await Promise.all([first.ready, second.ready])
        assert.equal(first.prepare(), null)
        assert.equal(second.prepare(), null)
        first.complete()
        await flush()
        assert.equal(writerReady, false)
        second.complete()
        await writer.ready
        assert.equal(laterReady, false)
        assert.equal(writer.prepare(), null)
        writer.complete()
        assert.equal(await finish(later), null)
    })

    it("keeps an empty read group joinable and seals it only at the next mutation", async () => {
        const { ctx, boundaries: [boundary] } = fixture()
        await finish(start(ctx, boundary), poison(ctx))
        const second = start(ctx, boundary)
        await second.ready
        const writer = start(ctx, boundary, true)
        const afterWriter = start(ctx, boundary)
        let passed = false
        writer.ready.then(() => { passed = true })
        await flush()
        assert.equal(passed, false)
        second.complete(poison(ctx))
        assert.equal(await finish(writer), null)
        assert.equal(await finish(afterWriter), null)
    })

    it("uses native FIFO completion for both settled and pending predecessors", async () => {
        const { ctx, boundaries: [boundary] } = fixture()
        const first = start(ctx, boundary, true)
        assert(first.ready instanceof Promise)
        await finish(first)
        const state = await boundary[EXTERNAL_BOUNDARY].phase.exclusive
        assert.equal(state, null)
        const later = start(ctx, boundary)
        const order = []
        later.ready.then(() => order.push("ready"))
        order.push("issued")
        assert.deepEqual(order, ["issued"])
        await finish(later)
        assert.deepEqual(order, ["issued", "ready"])
    })

    for (const pending of [false, true]) {
        for (const compound of [false, true]) {
            it(`preserves exact poison through readers and blocked mutations: pending=${pending}, compound=${compound}`, async () => {
                const { ctx, boundaries: [boundary] } = fixture()
                const leaf = poison(ctx)
                const failure = compound
                    ? runtime.combineErrors([leaf, poison(context(ctx.execution))], "Several failures")
                    : leaf
                const source = start(ctx, boundary, true)
                await source.ready
                if (!pending) source.complete(failure)
                const read = start(ctx, boundary)
                const write = start(ctx, boundary, true)
                if (pending) source.complete(failure)
                assert.equal(await finish(read, poison(ctx)), failure)
                await write.ready
                assert.equal(write.prepare(), failure)
                // Even a caller-supplied failure cannot replace an existing blocker.
                write.complete(poison(ctx))
                assert.equal(await finish(start(ctx, boundary)), failure)
                assert.equal(await boundary[EXTERNAL_BOUNDARY].phase.exclusive, failure)
            })
        }
    }

    it("does not consume action-only arguments behind predecessor poison", async () => {
        const { ctx, boundaries: [boundary] } = fixture()
        const failure = poison(ctx)
        await finish(start(ctx, boundary, true), failure)
        let consumed = 0, invoked = 0
        const unused = { then() { consumed++; return new Promise(() => {}) } }
        const work = start(ctx, boundary, true)
        const result = runtime.continueOperation(work.ready, ctx, () => {
            const blocked = work.prepare()
            if (blocked) {
                work.complete(blocked)
                return blocked
            }
            return runtime.continueOperation(unused, ctx, () => { invoked++ })
        })
        assert.equal(await result, failure)
        assert.equal(consumed, 0)
        assert.equal(invoked, 0)
    })

    for (const rejected of [false, true]) {
        it(`keeps host effects and attributes one mutation failure: rejected=${rejected}`, async () => {
            const { ctx, identities: [identity], boundaries: [boundary, untouched] } = fixture(2)
            const work = start(ctx, boundary, true)
            await work.ready
            assert.equal(work.prepare(), null)
            const cause = new Error("host mutation failed")
            const raw = runtime.runExternalBoundary(ctx, runtime.ERROR_KIND.InvocationFailed, () => {
                identity.changed = true
                if (rejected) return Promise.reject(cause)
                throw cause
            })
            const failure = await runtime.importMethodResult(raw, ctx)
            work.complete(failure)
            assert.equal(failure.cause, cause)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(failure.kind, runtime.ERROR_KIND.InvocationFailed)
            assert.equal(identity.changed, true)
            assert.equal(await finish(start(ctx, boundary)), failure)
            assert.equal(untouched[EXTERNAL_BOUNDARY].phase, undefined)
        })
    }

    it("orders unrelated native properties through a pending input and native write", async () => {
        const { ctx, identities: [identity], boundaries: [boundary] } = fixture()
        const input = Promise.withResolvers()
        const work = start(ctx, boundary, true)
        const read = start(ctx, boundary)
        let observed = false
        const result = runtime.continueOperation(work.ready, ctx, () => {
            assert.equal(work.prepare(), null)
            return runtime.continueOperation(input.promise, ctx, value => {
                runtime.runExternalBoundary(ctx, runtime.ERROR_KIND.ExternalPropertyWriteFailed, () => {
                    identity.a = value
                })
                work.complete()
            })
        })
        const observation = runtime.continueOperation(read.ready, ctx, () => {
            assert.equal(read.prepare(), null)
            assert.equal(identity.a, 3)
            observed = true
            read.complete()
        })
        await flush()
        assert.equal(observed, false)
        input.resolve(3)
        await Promise.all([result, observation])
        assert.equal(observed, true)
    })

    it("keeps distinct owners independent", async () => {
        const { ctx, boundaries: [first, second] } = fixture(2)
        const pending = start(ctx, first, true)
        await pending.ready
        assert.equal(await finish(start(ctx, second, true)), null)
        pending.complete()
    })

    it("does not add managed-scope-owned failure to its child's phase", async () => {
        const { ctx, boundaries: [boundary] } = fixture()
        const work = start(ctx, boundary, true)
        await work.ready
        assert.equal(work.prepare(), null)
        const scope = new runtime.Chain({}, ctx)
        const failure = poison(ctx)
        runtime.assignPath(scope, [], failure, ctx)
        work.complete(null)
        assert.equal(runtime.getErrors(scope, [], ctx), failure)
        assert.equal(await finish(start(ctx, boundary)), null)
    })

    it("repairs only the selected scope, retaining new failures and immutable old outputs", async () => {
        const { ctx, boundaries: [first, second] } = fixture(2)
        const old = runtime.combineErrors([poison(ctx), poison(context(ctx.execution))], "Old failures")
        await finish(start(ctx, first, true), old)
        await finish(start(ctx, second, true), old)
        const captured = await finish(start(ctx, first))
        assert.equal(await finish(start(ctx, first, false, true)), null)
        assert.equal(await finish(start(ctx, first)), null)
        assert.equal(await finish(start(ctx, second)), old)
        assert.equal(captured, old)
        const repairContext = context(ctx.execution)
        const replacement = poison(repairContext, runtime.ERROR_KIND.ExternalRepairFailed)
        assert.equal(await finish(start(repairContext, second, true, true), replacement), null)
        assert.equal(await finish(start(ctx, second)), replacement)
    })

    it("revalidates delayed access and never repairs conflicting authority", async () => {
        const { ctx, identities: [identity], boundaries: [boundary] } = fixture()
        const old = poison(ctx)
        const previous = start(ctx, boundary, true)
        await previous.ready
        const repair = start(ctx, boundary, true, true)
        new runtime.ContextChain({ identity }, ctx, { identity: {} })
        const conflict = boundary[EXTERNAL_BOUNDARY].binding
        // A conflict during an already issued operation keeps its predecessor state.
        previous.complete()
        await repair.ready
        assert.equal(repair.prepare(), conflict)
        repair.complete(old)
        assert.equal(await boundary[EXTERNAL_BOUNDARY].phase.exclusive, null)
        const phase = boundary[EXTERNAL_BOUNDARY].phase.exclusive
        assert.equal(start(ctx, boundary, true, true), conflict)
        assert.equal(boundary[EXTERNAL_BOUNDARY].phase.exclusive, phase)
        assert.equal(boundary[EXTERNAL_BOUNDARY].binding, conflict)
    })

    it("keeps predecessor poison when a repair loses authority after reservation", async () => {
        const { ctx, identities: [identity], boundaries: [boundary] } = fixture()
        const old = poison(ctx)
        await finish(start(ctx, boundary, true), old)
        const repair = start(ctx, boundary, true, true)
        await repair.ready
        new runtime.ContextChain({ identity }, ctx, { identity: {} })
        assert.equal(repair.prepare(), boundary[EXTERNAL_BOUNDARY].binding)
        repair.complete(boundary[EXTERNAL_BOUNDARY].binding)
        assert.equal(await boundary[EXTERNAL_BOUNDARY].phase.exclusive, old)
    })

    it("allows invoked work to finish after a competing registration", async () => {
        const { ctx, identities: [identity], boundaries: [boundary] } = fixture()
        const work = start(ctx, boundary, true)
        await work.ready
        assert.equal(work.prepare(), null)
        const result = Promise.withResolvers()
        const hostResult = runtime.runExternalBoundary(ctx, runtime.ERROR_KIND.InvocationFailed, () => result.promise)
        new runtime.ContextChain({ identity }, ctx, { identity: {} })
        result.resolve(7)
        assert.equal(await runtime.importMethodResult(hostResult, ctx), 7)
        work.complete()
        assert.equal(validateExternalAccess(identity, boundary, ctx), boundary[EXTERNAL_BOUNDARY].binding)
    })

    for (const early of [false, true]) {
        it(`composes metadata observations with query-local completion: early=${early}`, async () => {
            const { ctx, boundaries } = fixture(2)
            const owner = new OperationOwner(ctx)
            const failures = boundaries.map(() => poison(context(ctx.execution)))
            const writers = boundaries.map(boundary => start(ctx, boundary, true))
            await Promise.all(writers.map(work => work.ready))
            const reads = boundaries.map(boundary => start(ctx, boundary))
            const successor = start(ctx, boundaries[1], true)
            const found = []
            const observations = reads.map(read => runtime.continueOperation(read.ready, ctx, () => {
                if (owner.open) {
                    found.push(read.prepare())
                    if (early) owner.close()
                }
                // This phase's lifetime outlasts a query that has short-circuited.
                read.complete()
            }))
            writers[0].complete(failures[0])
            await observations[0]
            assert.equal(owner.open, !early)
            let successorReady = false
            successor.ready.then(() => { successorReady = true })
            await flush()
            assert.equal(successorReady, false)
            writers[1].complete(failures[1])
            await Promise.all(observations)
            assert.deepEqual(found, early ? [failures[0]] : failures)
            assert.equal(await finish(successor), failures[1])
            owner.close()
        })
    }

    it("keeps one identity's phases isolated between executions", async () => {
        const identity = external()
        const contexts = [context(), context()]
        const boundaries = contexts.map(ctx => externalTree.findExactBoundary(
            new runtime.ContextChain({ identity }, ctx, { identity: {} })._externalMutationTree,
            ["identity"],
        ))
        const pending = start(contexts[0], boundaries[0], true)
        await pending.ready
        assert.equal(await finish(start(contexts[1], boundaries[1], true)), null)
        pending.complete(poison(contexts[0]))
        assert.equal(await finish(start(contexts[1], boundaries[1])), null)
    })

    for (const predecessorCompletes of [false, true]) {
        it(`fatality interrupts outward results without phase cancellation: predecessorCompletes=${predecessorCompletes}`, async () => {
            const { ctx, boundaries: [boundary] } = fixture()
            const predecessor = start(ctx, boundary, true)
            await predecessor.ready
            const successor = start(ctx, boundary, true)
            let effects = 0, phaseCompleted = false
            boundary[EXTERNAL_BOUNDARY].phase.exclusive.then(() => { phaseCompleted = true })
            const result = runtime.returnOperationResult(ctx, runtime.continueOperation(successor.ready, ctx, () => {
                effects++
                successor.complete()
            }))
            if (predecessorCompletes) predecessor.complete()
            let fatal
            assert.throws(() => runtime.failExecution(ctx, new Error("kernel defect")), error => {
                fatal = error
                return runtime.isFatalError(error)
            })
            await assert.rejects(result, error => error === fatal)
            await flush()
            assert.equal(effects, 0)
            assert.equal(phaseCompleted, false)
        })
    }
})
