import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready, rejected, OrderedThenable } from "./ordered-thenable.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { spawnSync } from "node:child_process"
import { enabled as traceEnabled } from "./trace-state.js"

const turn = () => new Promise(setImmediate)
const at = (execution, errorContext) => ({ execution, errorContext })
function signal(mode, value, failure = false) {
    if (mode === "synchronous") return { value: failure ? rejected(value) : ready(value), settle() {} }
    const source = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
    // The host owns a rejected input until a reached path consumes it.
    if (failure) source.promise?.catch(() => {})
    return { value: source.promise ?? source, source,
        settle() { source[failure ? "reject" : "resolve"](value) } }
}

describe("imported data and path-key interactions", () => {
    for (const mode of ["synchronous", "native", "ordered"])
    for (const mutable of [false, true]) for (const nested of [false, true])
    it(`keeps entry captures before contained and outside writes: ${mode}, mutable=${mutable}, nested=${nested}`, async () => {
        const ctx = at(new r.Execution(), "entered import")
        const data = signal(mode, { child: { value: 7 } }), key = signal(mode, "child")
        const chain = new r.ContextChain({ branch: data.value, sibling: 19 }, ctx)
        const body = inside => {
            const before = r.export(inside, [], ctx)
            if (mutable) r.assignPath(inside, ["value"], 8, ctx)
            return before
        }
        const captured = r.enter(chain, ["branch", key.value], ctx, mutable, inside => nested
            ? r.enter(inside, [], ctx, mutable, body) : body(inside))
        r.assignPath(chain, ["branch", "child", "value"], 9, ctx)
        const after = r.lookupPath(chain, ["branch", "child", "value"], ctx)
        assert.equal(r.lookupPath(chain, ["sibling"], ctx), 19)
        key.settle(); await turn(); data.settle()
        assert.deepEqual(await captured, { value: 7 })
        assert.equal(await after, 9)
        assert.equal(ctx.execution.fatalError, null)
        verifyRefCounts(ctx, chain._state)
    })

    for (const mode of ["synchronous", "native", "ordered"])
    it(`repairs a failed key without consuming its pending imported baseline: ${mode}`, async () => {
        const ctx = at(new r.Execution(), "pending repair baseline")
        const cause = new Error("key failure"), key = signal(mode, cause, true), data = signal("native", { value: 7 })
        const chain = new r.ContextChain({ branch: { child: data.value }, sibling: 19 }, ctx)
        r.assignPath(chain, ["branch", key.value, "value"], 99, ctx)
        const historical = r.getErrors(chain, ["branch"], ctx)
        const repaired = r.repairPath(chain, ["branch"], ctx)
        let complete = !r.isPending(repaired, ctx)
        const completion = Promise.resolve(repaired).then(value => { complete = true; return value })
        key.settle(); await turn()
        assert.equal(complete, true, "repair restores the baseline without consuming its pending child")
        assert.equal(await completion, undefined)
        assert.equal((await historical).cause, cause)
        const selected = r.lookupPath(chain, ["branch", "child", "value"], ctx)
        assert.equal(r.isPending(selected, ctx), true)
        data.settle()
        assert.equal(await selected, 7)
        assert.equal(r.getErrors(chain, [], ctx), null)
        verifyRefCounts(ctx, chain._state)
    })

    it("releases selected sources before pending data and bounds joint history work", function () {
        this.timeout(30000)
        const child = spawnSync(process.execPath, [...process.execArgv, "--expose-gc", "--unhandled-rejections=strict",
            "test/fixtures/imported-path-lifetime.mjs"], { encoding: "utf8", timeout: 25000, windowsHide: true })
        assert.equal(child.error, undefined, child.error?.message)
        assert.equal(child.status, 0, child.stderr)
        const result = JSON.parse(child.stdout)
        assert.equal(result.lifetimeCases, 12)
        assert.equal(result.traced, traceEnabled)
        assert.deepEqual(result.work.map(row => row.n), [16, 32, 64])
    })

    for (const mode of ["native", "ordered"])
    for (const reenterFirst of [false, true])
    it(`preserves a pending capture through actual retirement and re-entry: ${mode}, first=${reenterFirst}`, async () => {
        const ctx = at(new r.Execution(), "retired import")
        const data = signal(mode, { value: 7 }), key = signal(mode, "child")
        const branch = { child: data.value }, root = { branch, alias: branch }
        const chain = new r.ContextChain(root, ctx)
        const captured = r.lookupPath(chain, ["branch", key.value, "value"], ctx)
        r.assignPath(chain, [], null, ctx)
        key.settle(); await turn()
        assert.equal(ctx.execution._metadata.get(root).relationshipsActive, false, "the original root actually retired")
        let reentered
        if (reenterFirst) reentered = new r.ContextChain(root, ctx)
        data.settle()
        assert.equal(await captured, 7)
        if (!reenterFirst) reentered = new r.ContextChain(root, ctx)
        assert.equal(await r.lookupPath(reentered, ["alias", "child", "value"], ctx), 7)
        assert.equal(root.branch.child, data.value, "retirement and re-entry never rewrite imported storage")
        verifyRefCounts(ctx, chain._state, reentered._state)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const mode of ["native", "ordered"])
    it(`reuses failed inspection across key-delayed import segments: ${mode}`, async () => {
        const ctx = at(new r.Execution(), "failed inspection producer"), cause = new Error("classification")
        let inspections = 0
        const bad = new Proxy({}, { getPrototypeOf() { inspections++; throw cause } })
        const first = signal(mode, bad), second = signal(mode, bad), key = signal(mode, "second")
        const chain = new r.ContextChain({ first: first.value, second: second.value }, ctx)
        const selected = r.lookupPath(chain, [key.value], at(ctx.execution, "delayed consumer"))
        first.settle(); await turn(); key.settle(); second.settle()
        const error = await selected
        assert.equal(error.kind, r.ERROR_KIND.ImportReflectionFailed)
        assert.equal(error.cause, cause)
        assert.equal(error.errorContext, ctx.errorContext)
        assert.equal(error, r.lookupPath(chain, ["first"], ctx))
        assert.equal(inspections, 1, "one failed inspection is shared within the preparation")
        assert.equal(r.import(bad, at(ctx.execution, "retry")).cause, cause)
        assert.equal(inspections, 2, "independent preparation may retry an unadmitted identity")
    })

    for (const mode of ["native", "ordered"])
    for (const registerFirst of [false, true])
    for (const separateExecution of [false, true])
    it(`keeps thenable aliases inert across registration: ${mode}, first=${registerFirst}, isolated=${separateExecution}`, async () => {
        const ctx = at(new r.Execution(), "alias import")
        const registering = separateExecution ? at(new r.Execution(), "other registration") : ctx
        const resource = r.externalState({ value: 7 }), data = signal(mode, resource)
        const alias = new r.ContextChain({ alias: data.value }, ctx, { alias: {} })
        const key = signal(mode, "value")
        const observation = r.lookupPath(alias, ["alias", key.value], ctx)
        let canonical
        const register = () => { canonical = new r.ContextChain({ resource }, registering, { resource: {} }) }
        if (registerFirst) register()
        data.settle(); await turn()
        if (!registerFirst) register()
        key.settle()
        const result = await observation
        if (separateExecution) assert.equal(result, 7)
        else assert.equal(result.kind, r.ERROR_KIND.ExternalLocationConflict)
        assert.equal(ctx.execution._externalRegistrationRevision, separateExecution ? 0 : 1)
        assert.equal(registering.execution._externalRegistrationRevision, 1)
        assert.equal(r.lookupPath(canonical, ["resource", "value"], registering), 7)
        assert.equal(await r.getErrors(alias, [], ctx), null)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const mode of ["synchronous", "native", "ordered"])
    for (const failure of ["key", "data"])
    for (const position of ["intermediate", "target", "nested"])
    for (const action of ["lookup", "export", "hasError", "getErrors", "call", "readonly-entry", "mutable-entry", "nested-entry"])
    it(`preserves the causal failure: ${mode}, ${failure}, ${position}, ${action}`, async () => {
        const execution = new r.Execution(), producer = at(execution, "import producer"), consumer = at(execution, "path consumer")
        const cause = new Error(`${failure} rejection`)
        let calls = 0
        const leaf = { value: 7, read() { calls++; return this.value } }, branch = { leaf }
        const data = signal(mode, failure === "data" ? cause : position === "intermediate" ? branch : position === "target" ? leaf : 7, failure === "data")
        const key = signal(mode, failure === "key" ? cause : "leaf", failure === "key")
        const root = { branch, sibling: 19 }
        if (position === "intermediate") root.branch = data.value
        if (position === "target") branch.leaf = data.value
        if (position === "nested") leaf.value = data.value
        const chain = new r.ContextChain(root, producer)
        const path = ["branch", key.value]
        const result = action === "lookup" ? r.lookupPath(chain, [...path, "value"], consumer) :
            action === "export" ? r.export(chain, path, consumer) :
            action === "hasError" ? r.hasError(chain, path, consumer) :
            action === "getErrors" ? r.getErrors(chain, path, consumer) :
            action === "call" ? r.run(chain, path, "read", [], consumer, {}) :
            r.enter(chain, path, consumer, action === "mutable-entry", inside => action === "nested-entry"
                ? r.enter(inside, [], consumer, false, nested => r.lookupPath(nested, ["value"], consumer))
                : r.lookupPath(inside, ["value"], consumer))
        assert.equal(r.lookupPath(chain, ["sibling"], consumer), 19)
        if (mode !== "synchronous") assert.equal(r.isPending(result, consumer), true)
        // Synchronous sources participate in the active import segment; deferred
        // sources complete after the path has captured its required versions.
        if (failure === "key") { key.settle(); await turn(); data.settle() }
        else { data.settle(); await turn(); key.settle() }
        const error = await result
        if (action === "hasError") assert.equal(error, true)
        else {
            assert.equal(error.kind, failure === "key" ? r.ERROR_KIND.PathSegmentFailed : r.ERROR_KIND.OperationInputFailed)
            assert.equal(error.cause, cause)
            assert.equal(error.errorContext, failure === "key" ? consumer.errorContext : producer.errorContext)
        }
        assert.equal(calls, 0)
        assert.equal(execution.fatalError, null)
        verifyRefCounts(consumer, chain._state)
    })

    for (const mode of ["native", "ordered"])
    it(`does not consume a suffix after imported prefix rejection: ${mode}`, async () => {
        const execution = new r.Execution(), ctx = at(execution, "prefix import")
        const cause = new Error("prefix"), data = signal(mode, cause, true)
        const unused = new OrderedThenable()
        const chain = new r.ContextChain({ branch: data.value }, ctx)
        const result = r.lookupPath(chain, ["branch", unused, "value"], ctx)
        data.settle()
        assert.equal((await result).cause, cause)
        assert.equal(unused.subscriptions, 0, "runtime attaches neither a value consumer nor a rejection observer")
        unused.reject(new Error("unused host-owned suffix"))
        await turn()
        assert.equal(unused.subscriptions, 0)
    })

    for (const mode of ["synchronous", "native", "ordered"])
    for (const contextualized of [false, true])
    it(`keeps policy at each consumer of one thenable: ${mode}, contextualized=${contextualized}`, async () => {
        const execution = new r.Execution(), producer = at(execution, "data producer"), consumer = at(execution, "key consumer")
        const cause = new Error("shared source")
        const input = contextualized ? r.createPoisonError(cause, at(execution, "original poison"), r.ERROR_KIND.InvocationFailed) : cause
        const shared = signal(mode, input, true)
        const chain = new r.ContextChain({ data: shared.value, target: { x: 1 } }, producer)
        const keyError = r.lookupPath(chain, ["target", shared.value], consumer)
        const dataError = r.lookupPath(chain, ["data"], consumer)
        shared.settle()
        const [key, data] = await Promise.all([keyError, dataError])
        assert.equal(key.cause, cause)
        assert.equal(data.cause, cause)
        if (contextualized) { assert.equal(key, input); assert.equal(data, input) }
        else {
            assert.equal(key.kind, r.ERROR_KIND.PathSegmentFailed)
            assert.equal(data.kind, r.ERROR_KIND.OperationInputFailed)
            assert.equal(key.errorContext, consumer.errorContext)
            assert.equal(data.errorContext, producer.errorContext)
        }
        assert.equal(execution.fatalError, null)
    })

    for (const mode of ["native", "ordered"])
    it(`finishes shared delivery after query closure and destination replacement: ${mode}`, async () => {
        const execution = new r.Execution(), ctx = at(execution, "shared publication")
        const cause = new Error("known poison"), input = { value: 7 }
        const data = signal(mode, input), key = signal(mode, "child")
        const root = { bad: r.createPoisonError(cause, ctx, r.ERROR_KIND.OperationInputFailed), child: data.value }
        const chain = new r.ContextChain(root, ctx)
        assert.equal(r.hasError(chain, [], ctx), true, "the query closes with shared import still pending")
        const held = new r.Chain(r.lookupPath(chain, [key.value], ctx), ctx)
        r.assignPath(chain, ["child"], { value: 9 }, ctx)
        data.settle(); await turn(); key.settle()
        assert.equal(await r.lookupPath(held, ["value"], ctx), 7)
        assert.equal(await r.lookupPath(chain, ["child", "value"], ctx), 9)
        assert.equal(execution._metadata.has(input), true, "shared producer still admits its delivered value")
        assert.equal(root.child, data.value, "imported storage is untouched")
        verifyRefCounts(ctx, chain._state, held._state)
    })

    for (const mode of ["native", "ordered"])
    it(`stops import settlement after fatal while another execution remains live: ${mode}`, async () => {
        const first = at(new r.Execution(), "failed execution"), second = at(new r.Execution(), "healthy execution")
        let inspected = 0
        const late = new Proxy({ value: 7 }, { ownKeys(target) { inspected++; return Reflect.ownKeys(target) } })
        const data = signal(mode, late), key = signal(mode, "child")
        const chain = new r.ContextChain({ child: data.value }, first)
        const waiting = r.lookupPath(chain, [key.value, "value"], first)
        const outcome = Promise.resolve(waiting).then(() => assert.fail("fatal result fulfilled"), error => error)
        const internal = Promise.withResolvers()
        const boundary = r.returnOperationResult(first, internal.promise)
        const failed = Promise.resolve(boundary).catch(error => error)
        internal.reject(new Error("injected higher-runtime completion defect"))
        const fatal = await failed
        assert.equal(await outcome, fatal)
        data.settle(); key.settle(); await turn()
        assert.equal(inspected, 0, "fatal resumption stops before import inspection")
        assert.equal(first.execution._metadata.has(late), false)
        const healthy = new r.ContextChain(late, second)
        assert.equal(r.lookupPath(healthy, ["value"], second), 7)
        assert.equal(inspected, 1)
        assert.equal(second.execution.fatalError, null)
    })
})
