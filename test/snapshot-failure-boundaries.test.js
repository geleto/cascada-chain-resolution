import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "../src/index.js"

describe("external snapshot failure boundaries", () => {
    for (const route of ["lookup", "export"]) {
        it(`collects later prototype inspection failure after an unsafe then: ${route}`, () => {
            const ctx = { execution: new r.Execution(), errorContext: route }
            const cause = new Error("later prototype descriptor")
            const ancestor = new Proxy({}, {
                getOwnPropertyDescriptor(target, key) {
                    if (key === "then") throw cause
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const prototype = Object.create(ancestor, {
                then: { get() { assert.fail("Prototype accessors must not run") } },
            })
            // Instance declarations do not bind a prototype before admission.
            // An own data property masks native thenability, leaving the retained
            // prototype check responsible for rejecting the unsafe accessor.
            const source = Object.assign(Object.create({}), { then: undefined, value: 1 })
            assert.equal(r.managedState(source), source)
            Object.setPrototypeOf(source, prototype)
            const api = r.externalState({ source })
            const chain = new r.ContextChain({ api }, ctx, { api: {} })
            const failure = (route === "lookup" ? r.lookupPath : r.export)(chain, ["api", "source"], ctx)
            assert(r.isPoisonError(failure))
            assert.equal(failure.errors.length, 2)
            assert(failure.errors.some(error => error.kind === r.ERROR_KIND.InvalidExternalSnapshot))
            assert(failure.errors.some(error => error.kind === r.ERROR_KIND.ExternalPropertyReadFailed && error.cause === cause))
            assert.equal(ctx.execution.fatalError, null)

            function Candidate() {}
            Candidate.prototype = prototype
            const declaration = r.managedStateClass(Candidate)
            assert.equal(declaration.kind, r.ERROR_KIND.DeclarationValidation)
        })
    }

    it("keeps internal snapshot and managed-selection classification defects on the fatal path", function () {
        this.timeout(15000)
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/snapshot-internal-failure.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const pending of [false, true])
    for (const route of ["lookup", "export"])
    for (const action of ["prototype parent", "constructor descriptor", "constructor prototype descriptor"]) {
        it(`returns poison when category reflection fails: ${action}, ${route}, pending=${pending}`, async () => {
            const reports = [], execution = new r.Execution(error => reports.push(error))
            const ctx = { execution, errorContext: `${action} ${route} ${pending}` }
            const cause = new Error(action)
            let inspections = 0
            const constructor = new Proxy(function SnapshotData() {}, {
                getOwnPropertyDescriptor(target, key) {
                    if (action === "constructor prototype descriptor" && key === "prototype") {
                        inspections++
                        throw cause
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const prototype = new Proxy(Object.assign(Object.create(null), { constructor }), {
                getPrototypeOf(target) {
                    if (action === "prototype parent") { inspections++; throw cause }
                    return Reflect.getPrototypeOf(target)
                },
                getOwnPropertyDescriptor(target, key) {
                    if (action === "constructor descriptor" && key === "constructor") {
                        inspections++
                        throw cause
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const source = Object.assign(Object.create(prototype), { value: 1 })
            const signal = pending ? Promise.withResolvers() : undefined
            const native = r.externalState({ source: signal?.promise ?? source, value: 1 })
            const chain = new r.ContextChain({ api: native }, ctx, { api: {} })
            const result = (route === "lookup" ? r.lookupPath : r.export)(chain, ["api", "source"], ctx)
            signal?.resolve(source)
            const failure = await result
            assert(inspections > 0, "The selected host reflection must run")
            assert(r.isPoisonError(failure))
            assert.equal(failure.cause, cause)
            assert.equal(failure.kind, r.ERROR_KIND.ExternalPropertyReadFailed)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(execution.fatalError, null)
            assert.deepEqual(reports, [])
            assert.equal(r.hasError(chain, ["api"], ctx), false)
            assert.equal(r.assignPath(chain, ["api", "value"], 2, ctx), undefined)
            assert.equal(native.value, 2)
        })
    }

    for (const pending of [false, true]) {
        it(`recovers actual prototype reflection failure during managed selection, pending=${pending}`, async () => {
            const reports = [], execution = new r.Execution(error => reports.push(error))
            const ctx = { execution, errorContext: `managed selection ${pending}` }
            const cause = new Error("managed prototype reflection")
            let armed = false, calls = 0, inspections = 0
            class Data { read() { calls++; return this.value } }
            const prototype = new Proxy(Data.prototype, {
                getPrototypeOf(target) {
                    if (armed) {
                        inspections++
                        assert.equal(execution._externalActionActive, true)
                        throw cause
                    }
                    return Reflect.getPrototypeOf(target)
                },
            })
            const source = Object.assign(Object.create(prototype), { value: 1 })
            assert.equal(r.managedState(source), source)
            const chain = new r.Chain(r.import(source, ctx), ctx)
            const signal = pending ? Promise.withResolvers() : undefined
            armed = true
            const result = r.run(chain, [], "read", [signal?.promise ?? 1], ctx, {})
            signal?.resolve(1)
            const failure = await result
            armed = false
            assert(inspections > 0)
            assert(r.isPoisonError(failure))
            assert.equal(failure.kind, r.ERROR_KIND.LookupReflectionFailed)
            assert.equal(failure.cause, cause)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(execution.fatalError, null)
            assert.deepEqual(reports, [])
            assert.equal(calls, 0)
            assert.equal(r.run(chain, [], "read", [], ctx, {}), 1)
            assert.equal(calls, 1)
        })
    }
})
