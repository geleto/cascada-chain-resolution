import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "../src/index.js"
import * as metadata from "../src/meta.js"

describe("classification and declaration failure boundaries", () => {
    for (const api of ["externalState", "managedState", "managedStateClass"])
    for (const reflection of [false, true]) {
        it(`keeps ${api} ${reflection ? "reflection" : "validation"} failure poisoned through import and host results`, () => {
            const cause = new Error("declaration inspection failed")
            const input = reflection ? new Proxy(api === "managedStateClass" ? function Candidate() {} : {}, {
                get() { throw cause },
            }) : 1
            const failure = r[api](input)
            assert(r.isPoisonError(failure))
            assert(Object.isFrozen(failure))
            assert.equal(failure.errorContext, undefined)
            assert.equal(failure.kind, reflection ? r.ERROR_KIND.DeclarationReflectionFailed : r.ERROR_KIND.DeclarationValidation)
            if (reflection) assert.equal(failure.cause, cause)
            const ctx = { execution: new r.Execution(), errorContext: "later consumer" }
            const attributed = r.import(failure, ctx)
            assert.equal(attributed.errorContext, ctx.errorContext)
            assert.equal(attributed.kind, failure.kind)
            assert.equal(attributed.cause, reflection ? cause : failure)
            assert.equal(failure.errorContext, undefined)
            const chain = new r.Chain({ failure: attributed }, ctx)
            assert.equal(r.hasError(chain, [], ctx), true)
            assert.equal(r.getErrors(chain, [], ctx), attributed)
            const host = new r.Chain(r.externalState({ read() { return failure } }), ctx)
            const returned = r.run(host, [], "read", [], ctx, {})
            assert.equal(returned.errorContext, ctx.errorContext)
            assert.equal(returned.kind, failure.kind)
            assert.equal(returned.cause, attributed.cause)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const api of ["externalState", "managedState", "managedStateClass"]) {
        it(`preserves healthy Error data and existing poison supplied to ${api}`, () => {
            const healthy = new Error("data")
            const poison = r.externalState(1)
            assert.equal(r[api](healthy), healthy)
            assert.equal(r[api](poison), poison)
            const ctx = { execution: new r.Execution() }
            assert.equal(r.hasError(new r.Chain(r.import(healthy, ctx), ctx), [], ctx), false)
            const host = new Proxy(api === "managedStateClass" ? function Candidate() {} : {}, {
                get() { throw poison },
            })
            assert.equal(r[api](host), poison)
        })
    }

    it("does not commit earlier managed declarations when a later identity cannot be classified", () => {
        class Candidate {}
        const candidate = new Candidate()
        const cause = new Error("classification failed")
        const broken = new Proxy({}, { getPrototypeOf() { throw cause } })
        const failure = r.managedState({ candidate, broken })
        assert(r.isPoisonError(failure))
        assert.equal(failure.cause, cause)
        assert.equal(metadata.identityDeclarationOf(candidate), undefined)
        assert.equal(metadata.identityDeclarationOf(broken), undefined)
    })

    it("admits explicitly external identities without structural classification", () => {
        let inspected = false
        const source = new Proxy({}, { getPrototypeOf() { inspected = true; throw new Error("opaque") } })
        assert.equal(r.externalState(source), source)
        const ctx = { execution: new r.Execution() }
        assert.equal(r.import(source, ctx), source)
        assert.equal(metadata.metaOf(source, ctx).type, metadata.TYPE.External)
        assert.equal(inspected, false)
    })

    for (const api of ["externalState", "managedState", "managedStateClass"]) {
        it(`preserves fatal and non-Error host throws from ${api} without commitment`, () => {
            let fatal
            try { r.failExecution({ execution: new r.Execution(), errorContext: "earlier" }, new Error("Earlier fatal")) }
            catch (error) { fatal = error }
            for (const cause of [undefined, fatal]) {
                function Candidate() {}
                const source = new Proxy(api === "managedStateClass" ? Candidate : {}, {
                    get(target, key) {
                        if (key === (api === "managedStateClass" ? "prototype" : "then")) throw cause
                        return Reflect.get(target, key)
                    },
                })
                if (cause === fatal) assert.throws(() => r[api](source), error => error === fatal)
                else {
                    const failure = r[api](source)
                    assert(r.isPoisonError(failure))
                    assert.equal(failure.kind, r.ERROR_KIND.DeclarationReflectionFailed)
                    assert.equal(failure.errorContext, undefined)
                    assert(Object.hasOwn(failure, "cause"))
                    assert.equal(failure.cause, cause)
                }
                assert.equal(metadata.identityDeclarationOf(source), undefined)
                const instance = new Candidate(), ctx = { execution: new r.Execution(), errorContext: api }
                r.import(instance, ctx)
                assert.equal(metadata.metaOf(instance, ctx).type, metadata.TYPE.External)
            }
        })
    }

    it("preserves a fatal reflection throw during declaration classification", () => {
        let fatal
        try { r.failExecution({ execution: new r.Execution(), errorContext: "earlier" }, new Error("Earlier fatal")) }
        catch (error) { fatal = error }
        const source = new Proxy({}, { getPrototypeOf() { throw fatal } })
        assert.throws(() => r.managedState(source), error => error === fatal)
        assert.equal(metadata.identityDeclarationOf(source), undefined)
    })

    it("makes implementation defects fatal in classification and declarations", () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/classification-declaration-failure.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const site of ["identity prototype", "prototype parent", "constructor descriptor", "constructor prototype"]) {
        it(`returns poison without admission after host ${site} failure`, () => {
            const cause = new Error(site)
            let calls = 0
            const fail = () => { calls++; throw cause }
            const prototype = Object.create(null)
            function Constructor() {}
            Constructor.prototype = prototype
            Object.defineProperty(prototype, "constructor", { value: site === "constructor prototype"
                ? new Proxy(Constructor, { getOwnPropertyDescriptor: fail }) : Constructor })
            const hostPrototype = site === "prototype parent"
                ? new Proxy(prototype, { getPrototypeOf: fail })
                : site === "constructor descriptor"
                    ? new Proxy(prototype, { getOwnPropertyDescriptor: fail }) : prototype
            const source = site === "identity prototype"
                ? new Proxy({}, { getPrototypeOf: fail }) : Object.create(hostPrototype)
            const ctx = { execution: new r.Execution(), errorContext: site }
            const failure = r.import(source, ctx)
            assert(r.isPoisonError(failure))
            assert.equal(failure.cause, cause)
            assert.equal(failure.kind, r.ERROR_KIND.ImportReflectionFailed)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.equal(calls, 1)
            assert.equal(metadata.metaOf(source, ctx), undefined)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const api of ["externalState", "managedState"]) {
        it(`returns host then-read failure from ${api} without a declaration`, () => {
            const cause = new Error("then read failed")
            const source = new Proxy({}, { get(target, key) {
                if (key === "then") throw cause
                return Reflect.get(target, key)
            } })
            assert.equal(r[api](source).cause, cause)
            assert.equal(metadata.identityDeclarationOf(source), undefined)
        })
    }

    for (const trap of ["ownKeys", "getOwnPropertyDescriptor"]) {
        it(`keeps managed declarations atomic after host ${trap} failure`, () => {
            class Candidate { constructor() { this.value = 1 } }
            const cause = new Error(trap)
            const source = new Proxy(new Candidate(), { [trap]() { throw cause } })
            assert.equal(r.managedState({ source }).cause, cause)
            assert.equal(metadata.identityDeclarationOf(source), undefined)
            const ctx = { execution: new r.Execution(), errorContext: trap }
            r.import(source, ctx)
            assert.equal(metadata.metaOf(source, ctx).type, metadata.TYPE.External)
        })
    }

    for (const site of ["class prototype", "prototype descriptor"]) {
        it(`keeps class registration atomic after host ${site} failure`, () => {
            function First() {}
            function Candidate() {}
            const cause = new Error(site)
            const input = site === "class prototype"
                ? new Proxy(Candidate, { get(target, key) {
                    if (key === "prototype") throw cause
                    return Reflect.get(target, key)
                } }) : Candidate
            if (site === "prototype descriptor") Candidate.prototype =
                new Proxy(Candidate.prototype, { getOwnPropertyDescriptor() { throw cause } })
            assert.equal(r.managedStateClass(First, input).cause, cause)
            const source = new First(), ctx = { execution: new r.Execution(), errorContext: site }
            r.import(source, ctx)
            assert.equal(metadata.metaOf(source, ctx).type, metadata.TYPE.External)
        })
    }
})
