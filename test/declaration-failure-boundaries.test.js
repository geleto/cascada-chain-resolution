import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "../src/index.js"
import * as metadata from "../src/meta.js"

describe("classification and declaration failure boundaries", () => {
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
                    assert(Error.isError(failure))
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

    it("preserves a fatal reflection throw instead of using declaration classification fallback", () => {
        let fatal
        try { r.failExecution({ execution: new r.Execution(), errorContext: "earlier" }, new Error("Earlier fatal")) }
        catch (error) { fatal = error }
        const source = new Proxy({}, { getPrototypeOf() { throw fatal } })
        assert.throws(() => metadata.inspectDeclarationMetaFacts(source), error => error === fatal)
        assert.equal(metadata.identityDeclarationOf(source), undefined)
    })

    it("lets implementation defects escape classification and declarations", () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/classification-declaration-failure.js", import.meta.url))],
        { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })

    for (const site of ["identity prototype", "prototype parent", "constructor descriptor", "constructor prototype"]) {
        it(`preserves conservative admission after host ${site} failure`, () => {
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
            assert.equal(r.import(source, ctx), source)
            assert.equal(calls, 1)
            assert.equal(metadata.metaOf(source, ctx).type, metadata.TYPE.External)
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
            assert.equal(r[api](source), cause)
            assert.equal(metadata.identityDeclarationOf(source), undefined)
        })
    }

    for (const trap of ["ownKeys", "getOwnPropertyDescriptor"]) {
        it(`keeps managed declarations atomic after host ${trap} failure`, () => {
            class Candidate { constructor() { this.value = 1 } }
            const cause = new Error(trap)
            const source = new Proxy(new Candidate(), { [trap]() { throw cause } })
            assert.equal(r.managedState({ source }), cause)
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
            assert.equal(r.managedStateClass(First, input), cause)
            const source = new First(), ctx = { execution: new r.Execution(), errorContext: site }
            r.import(source, ctx)
            assert.equal(metadata.metaOf(source, ctx).type, metadata.TYPE.External)
        })
    }
})
