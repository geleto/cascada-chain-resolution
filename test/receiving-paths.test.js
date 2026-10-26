import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready, rejected, OrderedThenable } from "./ordered-thenable.js"
import { verifyParents } from "./verify-parents.js"
import { verifyRefCounts } from "./verify-refcounts.js"

const context = () => ({ execution: new r.Execution(), errorContext: "receiving path" })

describe("stable categories along external paths", () => {
    for (const mutable of [false, true]) for (const fails of [false, true])
    for (const timing of ["ready", "synchronous", "pending"])
    it(`selects the receiver before consuming arguments: mutable=${mutable}, fails=${fails}, ${timing}`, async () => {
        const ctx = context(), events = [], signal = timing === "pending" ? Promise.withResolvers() : undefined
        const service = r.externalState({ get read() {
            events.push("member")
            return value => { events.push("call"); return value }
        } })
        const api = r.externalState({ get service() { events.push("receiver"); return service } })
        const source = mutable ? new r.ContextChain({ api }, ctx, { api: {} }) :
            new r.Chain(r.import({ api }, ctx), ctx)
        const error = r.createPoisonError(new Error("argument"), ctx, r.ERROR_KIND.OperationInputFailed)
        const argument = timing === "pending" ? signal.promise : timing === "synchronous" ?
            (fails ? rejected(error) : ready(7)) : fails ? error : 7
        const result = r.run(source, ["api", "service"], "read", [argument], ctx, {})
        if (timing === "pending" || fails) assert.deepEqual(events, ["receiver"])
        if (fails) signal?.reject(error)
        else signal?.resolve(7)
        assert.equal(await result, fails ? error : 7)
        assert.deepEqual(events, fails ? ["receiver"] : ["receiver", "member", "call"])
    })

    it("keeps an external root opaque but imports its selected property for queries", async () => {
        const ctx = context()
        let reads = 0
        const data = { failure: rejected(new Error("child")) }
        const api = r.externalState({ get data() { reads++; return data } })
        const source = new r.Chain(r.import({ api }, ctx), ctx)
        assert.equal(r.hasError(source, ["api"], ctx), false)
        assert.equal(r.getErrors(source, ["api"], ctx), null)
        assert.equal(reads, 0)
        assert.equal(r.hasError(source, ["api", "data"], ctx), true)
        const queried = r.getErrors(source, ["api", "data"], ctx)
        assert(r.isPoisonError(queried))
        const received = new r.Chain(r.lookupPath(source, ["api", "data"], ctx), ctx)
        assert.equal(r.hasError(received, [], ctx), true)
        const failure = r.getErrors(received, [], ctx)
        assert.equal(queried, failure)
        assert.equal(await r.export(source, ["api", "data"], ctx), failure)
        assert.equal(reads, 4)
    })

    for (const query of ["hasError", "getErrors"])
    for (const mode of ["ready", "synchronous", "native", "ordered"])
    for (const failure of ["none", "getter", "direct rejection", "nested rejection", "classification", "shape"]) {
        it(`queries received external property data: ${query}, ${mode}, ${failure}`, async () => {
            const ctx = context(), cause = new Error("external query input")
            const data = failure === "classification" || failure === "shape" ? new Proxy({}, {
                [failure === "classification" ? "getPrototypeOf" : "ownKeys"]() { throw cause },
            }) : { healthy: new Error("ordinary data"), child: failure === "nested rejection" ? rejected(cause) : 7 }
            let release, reads = 0
            const directFailure = failure === "direct rejection"
            const value = mode === "ready" ? directFailure ? rejected(cause) : data
                : mode === "synchronous" ? directFailure ? rejected(cause) : ready(data)
                : mode === "native" ? new Promise((resolve, reject) => {
                    release = () => directFailure ? reject(cause) : resolve(data)
                }) : new OrderedThenable()
            if (mode === "ordered") release = () => directFailure ? value.reject(cause) : value.resolve(data)
            const api = r.externalState({ get data() {
                reads++
                if (failure === "getter") throw cause
                return value
            } })
            const chain = new r.Chain({ api }, ctx)
            const result = r[query](chain, ["api", "data"], ctx)
            // A throwing getter never transfers its unused result Promise.
            if (failure !== "getter") release?.()
            const actual = await result
            if (query === "hasError") assert.equal(actual, failure !== "none")
            else if (failure === "none") assert.equal(actual, null)
            else {
                assert(r.isPoisonError(actual))
                assert.equal(actual.cause, cause)
                assert.equal(actual.errorContext, ctx.errorContext)
                assert.equal(actual.kind, r.ERROR_KIND[failure === "getter" || failure === "direct rejection"
                    ? "ExternalPropertyReadFailed" : failure === "nested rejection"
                        ? "OperationInputFailed" : "ImportReflectionFailed"])
            }
            assert.equal(reads, 1)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const query of ["hasError", "getErrors"]) {
        for (const category of ["record", "array", "class", "managed class", "external record", "external array"]) {
            it(`preserves ${category} classification through property ${query}`, () => {
                const ctx = context(), poison = r.createPoisonError(new Error("child"), ctx, r.ERROR_KIND.OperationInputFailed)
                class Data { constructor() { this.failure = poison } }
                if (category === "managed class") r.managedStateClass(Data)
                const data = category.endsWith("array") ? [poison]
                    : category.endsWith("class") ? new Data() : { failure: poison }
                if (category.startsWith("external")) r.externalState(data)
                const chain = new r.Chain(r.externalState({ data }), ctx)
                const managed = category === "record" || category === "array" || category === "managed class"
                assert.equal(r[query](chain, ["data"], ctx), query === "hasError" ? managed : managed ? poison : null)
                assert.equal(r.lookupPath(chain, ["data"], ctx), data)
                // Opaque class/declared-external data can still be explicitly read.
                assert.equal(r[query](chain, ["data", category.endsWith("array") ? 0 : "failure"], ctx),
                    query === "hasError" ? true : poison)
            })
        }

        it(`establishes imported protection through ${query}`, () => {
            const ctx = context(), data = { value: 1 }, api = r.externalState({ data })
            const native = new r.Chain(api, ctx)
            assert.equal(r[query](native, ["data"], ctx), query === "hasError" ? false : null)
            const received = new r.Chain(data, ctx)
            r.assignPath(received, ["value"], 2, ctx)
            assert.equal(data.value, 1)
            assert.equal(r.lookupPath(received, ["value"], ctx), 2)
        })

        it(`keeps registered mutable ${query} metadata-only`, () => {
            const ctx = context()
            let reads = 0
            const api = r.externalState({ get data() { reads++; throw new Error("Must not inspect native state") } })
            const native = new r.ContextChain({ api }, ctx, { api: {} })
            assert.equal(r[query](native, ["api", "data"], ctx), query === "hasError" ? false : null)
            assert.equal(reads, 0)
        })
    }

    it("gives separate native snapshots independent managed identities", () => {
        const ctx = context()
        const row = { value: 1, self() { return this } }
        const api = r.externalState({ row, change() { this.row.value = 2 } })
        const chain = new r.ContextChain({ api }, ctx, { api: {} })
        const first = new r.Chain(r.run(chain, ["api", "row"], "self", [], ctx, {}), ctx)
        r.run(chain, ["api"], "change", [], ctx, { mutationScopeDepth: 1 })
        const second = r.run(chain, ["api", "row"], "self", [], ctx, {})
        const pair = new r.Chain({ first: r.lookupPath(first, [], ctx), second }, ctx)
        const exported = r.export(pair, [], ctx)
        assert.notEqual(exported.first, exported.second)
        assert.equal(exported.first.value, 1)
        assert.equal(exported.second.value, 2)
    })

    for (const mode of ["native", "ordered"]) {
        it(`releases a managed receiver snapshot before arguments finish: ${mode}`, async () => {
            const ctx = context()
            const row = { value: 1, read(delta) { return this.value + delta } }
            const api = r.externalState({ row, change() { return ++this.row.value } })
            const chain = new r.ContextChain({ api }, ctx, { api: {} })
            const pending = mode === "native" ? Promise.withResolvers() : new OrderedThenable()
            const result = r.run(chain, ["api", "row"], "read", [pending.promise ?? pending], ctx, {})
            assert.equal(r.run(chain, ["api"], "change", [], ctx, { mutationScopeDepth: 1 }), 2)
            pending.resolve(10)
            assert.equal(await result, 11)
            assert.equal(row.value, 2)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("selects a native receiver after earlier effects, before waiting for its arguments", async () => {
        const ctx = context(), prior = Promise.withResolvers(), argument = Promise.withResolvers()
        const services = [0, 1, 2].map(version => r.externalState({ read(value) { return version + value } }))
        const api = r.externalState({
            value: 0,
            async change() { await prior.promise; this.value++ },
            get service() { return services[this.value] },
        })
        const source = new r.ContextChain({ api }, ctx, { api: {} })
        assert.equal(r.run(source, ["api", "service"], "read", [7], ctx, {}), 7)
        const change = r.run(source, ["api"], "change", [], ctx, { mutationScopeDepth: 1 })
        const result = r.run(source, ["api", "service"], "read", [argument.promise], ctx, {})
        const laterChange = r.run(source, ["api"], "change", [], ctx, { mutationScopeDepth: 1 })
        assert.equal(api.value, 0)
        prior.resolve()
        await change
        assert.equal(api.value, 1)
        argument.resolve(7)
        assert.equal(await result, 8)
        await laterChange
        assert.equal(r.run(source, ["api", "service"], "read", [7], ctx, {}), 9)
    })

    for (const mutable of [false, true]) for (const action of ["lookup", "export", "expression", "call"]) {
        it(`fails on a fatal before consuming its suffix: mutable=${mutable}, action=${action}`, async () => {
            const origin = context(), reports = [], ctx = { execution: new r.Execution(error => reports.push(error)), errorContext: "consumer" }
            let reads = 0, fatal
            const cause = new Error("original fatal")
            Object.defineProperty(cause, "after", { get() { reads++; return "not reached" } })
            try { r.failExecution(origin, cause) } catch (error) { fatal = error }
            const api = r.externalState({ data: { fatal } })
            const source = mutable ? new r.ContextChain({ api }, ctx, { api: {} }) :
                new r.Chain(r.import({ api }, ctx), ctx)
            const pending = Promise.withResolvers()
            const outstanding = r.lookupPath(new r.Chain(pending.promise, ctx), [], ctx)
            const rejected = assert.rejects(outstanding, error => error === fatal)
            const path = ["api", "data", "fatal", "cause", "after"]
            assert.throws(() => action === "call" ? r.run(source, path, "toString", [], ctx, {}) :
                action === "expression" ? r.lookupPathForExpression(source, path, ctx) :
                action === "export" ? r.export(source, path, ctx) : r.lookupPath(source, path, ctx), error => error === fatal)
            assert.equal(reads, 0)
            assert.equal(ctx.execution.fatalError, fatal)
            assert.deepEqual(reports, [fatal])
            pending.resolve(1)
            await rejected
        })
    }

    for (const mutable of [false, true]) {
        it(`keeps managed leaf capabilities and presence across external paths: mutable=${mutable}`, () => {
            const ctx = context()
            let calls = 0
            const fn = () => { calls++; return 9 }
            fn.read = fn
            const data = { n: 3, fn, text: "abc", empty: undefined }
            const api = r.externalState({ data })
            const source = mutable ? new r.ContextChain({ api }, ctx, { api: {} }) :
                new r.Chain(r.import({ api }, ctx), ctx)
            const captured = new r.Chain(r.lookupPath(source, ["api", "data"], ctx), ctx)
            for (const suffix of [["n", "toFixed"], ["fn", "name"], ["missing", "x"], ["empty", "x"]]) {
                const expected = suffix[0] === "n" || suffix[0] === "fn" ? r.ERROR_KIND.ScalarLookup : r.ERROR_KIND.NullLookup
                assert.equal(r.lookupPath(source, ["api", "data", ...suffix], ctx).kind, expected)
                assert.equal(r.lookupPath(captured, suffix, ctx).kind, expected)
            }
            for (const [key, method, expected] of [["n", "toFixed", r.ERROR_KIND.NotAFunction],
                ["fn", "read", r.ERROR_KIND.NotAFunction], ["missing", "read", r.ERROR_KIND.NullLookup],
                ["empty", "read", r.ERROR_KIND.NotAFunction]]) {
                assert.equal(r.run(source, ["api", "data", key], method, [], ctx, {}).kind, expected)
                assert.equal(r.run(captured, [key], method, [], ctx, {}).kind, expected)
            }
            assert.equal(calls, 0)
            assert.equal(r.lookupPath(source, ["api", "data", "text", "length"], ctx), 3)
            assert.equal(r.lookupPath(source, ["api", "data", "text", 1], ctx), "b")
            assert.equal(r.run(source, ["api", "data", "text"], "toUpperCase", [], ctx, {}), "ABC")
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const mutable of [false, true]) {
        for (const [name, value] of [["number", 3], ["boolean", true], ["bigint", 3n],
            ["symbol", Symbol("leaf")], ["null", null], ["undefined", undefined],
            ["Function", () => 7], ["String", "abc"]]) {
            it(`keeps direct external leaf capabilities: mutable=${mutable}, ${name}`, () => {
                const ctx = context()
                const api = r.externalState({ value })
                const source = mutable ? new r.ContextChain({ api }, ctx, { api: {} }) :
                    new r.Chain(r.import({ api }, ctx), ctx)
                const captured = new r.Chain(r.lookupPath(source, ["api", "value"], ctx), ctx)
                const kind = value == null ? r.ERROR_KIND.NullLookup : r.ERROR_KIND.ScalarLookup
                const path = ["api", "value", "toString"]
                assert.equal(r.lookupPath(source, path, ctx).kind, kind)
                assert.equal(r.lookupPath(captured, ["toString"], ctx).kind, kind)
                assert.equal(r.export(source, path, ctx).kind, kind)
                const expression = r.lookupPathForExpression(source, path, ctx)
                assert(r.isPoisonedValue(expression))
                assert.equal(expression.error.kind, kind)
                if (!mutable) {
                    assert.equal(r.hasError(source, path, ctx), true)
                    assert.equal(r.getErrors(source, path, ctx).kind, kind)
                } else {
                    // Registered-resource queries consume scope metadata, not native data.
                    assert.equal(r.hasError(source, path, ctx), false)
                    assert.equal(r.getErrors(source, path, ctx), null)
                }
                if (typeof value === "string") {
                    assert.equal(r.lookupPath(source, ["api", "value", "length"], ctx), 3)
                    assert.equal(r.lookupPath(source, ["api", "value", 1], ctx), "b")
                    assert.equal(r.run(source, ["api", "value"], "toUpperCase", [], ctx, {}), "ABC")
                } else {
                    assert.equal(r.run(source, ["api", "value"], "toString", [], ctx, {}).kind,
                        r.ERROR_KIND.NotAFunction)
                    assert.equal(r.run(captured, [], "toString", [], ctx, {}).kind,
                        r.ERROR_KIND.NotAFunction)
                }
                assert.equal(ctx.execution.fatalError, null)
            })
        }

        it(`rejects direct external Function member selection: mutable=${mutable}`, () => {
            const ctx = context()
            let reads = 0, calls = 0, inputs = 0
            const fn = () => 1
            Object.defineProperty(fn, "read", { get() { reads++; return () => { calls++; return 7 } } })
            const api = r.externalState({ fn })
            const source = mutable ? new r.ContextChain({ api }, ctx, { api: {} }) :
                new r.Chain(r.import({ api }, ctx), ctx)
            const unused = { then(resolve) { inputs++; return Promise.resolve(2).then(resolve) } }
            const result = r.run(source, ["api", "fn"], "read", [unused], ctx, {})
            assert.equal(result.kind, r.ERROR_KIND.NotAFunction)
            assert.equal(reads, 0)
            assert.equal(calls, 0)
            assert.equal(inputs, 0)
        })

        for (const timing of ["ready", "synchronous", "native", "ordered"])
        it(`receives final external leaf values before applying capabilities: mutable=${mutable}, ${timing}`, async () => {
            const ctx = context(), fn = () => 7
            const pending = timing === "native" ? Promise.withResolvers() : timing === "ordered" ? new OrderedThenable() : undefined
            const input = timing === "ready" ? fn : timing === "synchronous" ? ready(fn) : pending.promise ?? pending
            const api = r.externalState({ value: input })
            const source = mutable ? new r.ContextChain({ api }, ctx, { api: {} }) :
                new r.Chain(r.import({ api }, ctx), ctx)
            const captured = new r.Chain(r.lookupPath(source, ["api", "value"], ctx), ctx)
            const lookup = r.lookupPath(captured, ["name"], ctx)
            const call = r.run(captured, [], "toString", [], ctx, {})
            pending?.resolve(fn)
            assert.equal((await lookup).kind, r.ERROR_KIND.ScalarLookup)
            assert.equal((await call).kind, r.ERROR_KIND.NotAFunction)
            assert.equal(ctx.execution.fatalError, null)
        })

        it(`preserves inherited native properties and selected external methods: mutable=${mutable}`, () => {
            const ctx = context()
            const child = r.externalState(Object.create({ value: 9, read() { return this.value } }))
            const api = r.externalState(Object.create({ child }))
            const source = mutable ? new r.ContextChain({ api }, ctx, { api: {} }) :
                new r.Chain(r.import({ api }, ctx), ctx)
            assert.equal(r.lookupPath(source, ["api", "child", "value"], ctx), 9)
            assert.equal(r.run(source, ["api", "child"], "read", [], ctx, {}), 9)
        })
    }

    for (const action of ["assign", "delete", "call"]) for (const leaf of ["fn", "number", "text"])
    it(`rejects direct external leaf mutation and repairs its scope: ${action}, ${leaf}`, () => {
        const ctx = context()
        let reads = 0, calls = 0
        const fn = () => 1
        fn.value = 3
        Object.defineProperty(fn, "change", { get() { reads++; return () => { calls++; return 7 } } })
        const api = r.externalState({ fn, number: 3, text: "abc", read() { return 11 } })
        const source = new r.ContextChain({ api }, ctx, { api: {} })
        const path = ["api", leaf]
        const result = action === "assign" ? r.assignPath(source, [...path, "value"], 9, ctx) :
            action === "delete" ? r.deletePath(source, [...path, "value"], ctx) :
                r.run(source, path, "change", [], ctx, { mutationScopeDepth: 1 })
        const failure = r.getErrors(source, ["api"], ctx)
        assert(r.isPoisonError(failure), "Rejected leaf mutation must poison its selected scope")
        assert.equal(failure.kind, action === "call" ? r.ERROR_KIND.InvocationFailed : r.ERROR_KIND.UnsupportedMutation)
        if (action === "call") assert.equal(result, failure)
        assert.equal(fn.value, 3)
        assert.equal(api.number, 3)
        assert.equal(api.text, "abc")
        assert.equal(reads, 0)
        assert.equal(calls, 0)
        assert.equal(r.repairPath(source, ["api"], ctx), undefined)
        assert.equal(r.run(source, ["api"], "read", [], ctx, {}), 11)
        assert.equal(ctx.execution.fatalError, null)
    })

    for (const timing of ["ready", "synchronous", "pending"]) {
        it(`preserves managed receiver selection through ${timing} delivery`, async () => {
            const ctx = context(), signal = Promise.withResolvers()
            const child = { n: 3, empty: undefined }
            const data = timing === "ready" ? child : timing === "synchronous" ? ready(child) : signal.promise
            const source = new r.Chain(r.import(r.externalState({ data: { child: data } }), ctx), ctx)
            const missing = r.run(source, ["data", "child", "missing"], "read", [], ctx, {})
            const number = r.run(source, ["data", "child", "n"], "toFixed", [], ctx, {})
            signal.resolve(child)
            assert.equal((await missing).kind, r.ERROR_KIND.NullLookup)
            assert.equal((await number).kind, r.ERROR_KIND.NotAFunction)
        })
    }

    it("ends native access before a captured String receiver waits for arguments", async () => {
        const ctx = context(), signal = Promise.withResolvers()
        const api = r.externalState({ data: { text: "before" }, change() {
            this.data.text = "after"
            signal.resolve("!")
            return 7
        } })
        const source = new r.ContextChain({ api }, ctx, { api: {} })
        const result = r.run(source, ["api", "data", "text"], "concat", [signal.promise], ctx, {})
        assert.equal(r.run(source, ["api"], "change", [], ctx, { mutationScopeDepth: 1 }), 7)
        assert.equal(await result, "before!")
        assert.equal(r.lookupPath(source, ["api", "data", "text"], ctx), "after")
    })

    for (const mutable of [false, true]) {
        it(`rechecks a receiver newly registered while arguments wait: mutable=${mutable}`, async () => {
            const ctx = context(), pending = Promise.withResolvers()
            let calls = 0, reads = 0
            const child = r.externalState({ read() { calls++; return 7 } })
            const api = r.externalState({ get child() { reads++; return child } })
            const source = mutable ? new r.ContextChain({ api }, ctx, { api: {} }) :
                new r.Chain(r.import({ api }, ctx), ctx)
            const result = r.run(source, ["api", "child"], "read", [pending.promise], ctx, {})
            const canonical = new r.ContextChain({ child }, ctx, { child: {} })
            pending.resolve(1)
            assert.equal((await result).kind, r.ERROR_KIND.ExternalLocationConflict)
            assert.equal(calls, 0)
            assert.equal(reads, 1, "Authority revalidation must not select the receiver again")
            assert.equal(r.run(canonical, ["child"], "read", [], ctx, {}), 7)
        })
    }

    for (const mutable of [false, true]) for (const received of [false, true]) {
        it(`uses managed visibility and dispatch: mutable=${mutable}, received=${received}`, () => {
            const ctx = context()
            let getters = 0
            const record = { n: 2, read() { return this.n } }
            Object.defineProperty(record, "secret", { value: 99 })
            Object.defineProperty(record, "accessor", { enumerable: true, get() { getters++; return 99 } })
            const array = [3, 2, 1]
            array.custom = 99
            const api = r.externalState({ record, array })
            const chain = mutable ? new r.ContextChain({ api }, ctx, { api: {} }) :
                new r.Chain(r.import({ api }, ctx), ctx)
            if (received) r.lookupPath(chain, ["api", "record"], ctx)
            assert.equal(r.lookupPath(chain, ["api", "record", "secret"], ctx), undefined)
            assert.equal(r.lookupPath(chain, ["api", "record", "accessor"], ctx), undefined)
            assert.equal(getters, 0)
            assert.equal(r.run(chain, ["api", "record"], "read", [], ctx, {}), 2)
            assert.equal(r.lookupPath(chain, ["api", "array", "length"], ctx), 3)
            assert.equal(r.lookupPath(chain, ["api", "array", "custom"], ctx), undefined)
            assert.deepEqual(r.run(chain, ["api", "array"], "toSorted", [], ctx, {}), [1, 2, 3])
            assert.equal(record.n, 2)
            assert.deepEqual([...api.array], [3, 2, 1])
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    for (const timing of ["ready", "synchronous", "pending"]) {
        it(`continues received managed paths through ${timing} properties`, async () => {
            const ctx = context()
            const signal = Promise.withResolvers()
            const child = { n: 4, read() { return this.n } }
            const value = timing === "ready" ? child : timing === "synchronous" ? ready(child) : signal.promise
            const api = r.externalState({ data: { child: value } })
            const chain = new r.Chain(r.import(api, ctx), ctx)
            const lookup = r.lookupPath(chain, ["data", "child", "n"], ctx)
            const call = r.run(chain, ["data", "child"], "read", [], ctx, {})
            if (timing !== "pending") assert.equal(call, 4)
            signal.resolve(child)
            assert.equal(await lookup, 4)
            assert.equal(await call, 4)
            assert.equal(api.data.child, value)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("rejects a native Promise receiver without subscribing", () => {
        const ctx = context()
        let subscriptions = 0
        const pending = { then() { subscriptions++; throw new Error("must not subscribe") } }
        const chain = new r.Chain(r.import(r.externalState({ pending }), ctx), ctx)
        const result = r.run(chain, ["pending"], "read", [], ctx, {})
        assert.equal(result.kind, r.ERROR_KIND.ExternalPropertyReadFailed)
        assert.equal(subscriptions, 0)
    })

    for (const action of ["assign", "delete", "call"]) {
        it(`rejects native ${action} across managed storage and allows repair`, () => {
            const ctx = context()
            const native = r.externalState({ n: 1, change() { this.n++; return this.n } })
            const record = { native, n: 1, change() { this.n++; return this.n } }
            const api = r.externalState({ record, read() { return 7 } })
            const chain = new r.ContextChain({ api }, ctx, { api: { record: { native: {} } } })
            const path = ["api", "record"]
            if (action === "assign") r.assignPath(chain, [...path, "n"], 2, ctx)
            if (action === "delete") r.deletePath(chain, [...path, "n"], ctx)
            if (action === "call") r.run(chain, path, "change", [], ctx, { mutationScopeDepth: 1 })
            assert.equal(r.hasError(chain, ["api"], ctx), true)
            assert.equal(record.n, 1)
            assert.equal(native.n, 1)
            r.repairPath(chain, ["api"], ctx)
            assert.equal(r.run(chain, ["api"], "read", [], ctx, {}), 7)
            const captured = new r.Chain(r.lookupPath(chain, path, ctx), ctx)
            r.assignPath(captured, ["n"], 9, ctx)
            assert.equal(r.lookupPath(captured, ["n"], ctx), 9)
            assert.equal(record.n, 1)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("uses entered references without inspecting an unused managed suffix", () => {
        const ctx = context()
        let reads = 0
        const api = r.externalState({ get data() { reads++; return { n: 2, read() { return this.n } } } })
        const chain = new r.ContextChain({ api }, ctx, { api: {} })
        r.enter(chain, ["api", "data"], ctx, false, () => undefined)
        assert.equal(reads, 0)
        r.enter(chain, ["api", "data"], ctx, false, entered => {
            assert.equal(r.lookupPath(entered, ["n"], ctx), 2)
            assert.equal(r.run(entered, [], "read", [], ctx, {}), 2)
        })
        assert.equal(reads, 2)
        assert.equal(ctx.execution.fatalError, null)
    })
})

describe("unreadable imported Array slots", () => {
    it("keeps inaccessible physical data masked through views, repair and mutation", () => {
        const ctx = context(), child = { n: 1 }, cause = new Error("unreadable slot")
        let fail = true
        const source = new Proxy([child, child], {
            getOwnPropertyDescriptor(target, key) {
                if (key === "0" && fail) { fail = false; throw cause }
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const chain = new r.Chain(r.import(source, ctx), ctx)
        const failure = r.lookupPath(chain, [0], ctx)
        assert.equal(failure.cause, cause)
        const view = new r.Chain(r.run(chain, [], "slice", [], ctx, {}), ctx)
        const reversed = new r.Chain(r.run(view, [], "toReversed", [], ctx, {}), ctx)
        assert.equal(r.lookupPath(view, [0], ctx), failure)
        assert.equal(r.lookupPath(reversed, [1], ctx), failure)
        assert.equal(r.repairPath(view, [0], ctx), failure)
        r.assignPath(chain, [1, "n"], 2, ctx)
        assert.equal(child.n, 1)
        assert.equal(r.lookupPath(view, [1, "n"], ctx), 1)
        r.assignPath(view, [0], { n: 3 }, ctx)
        assert.equal(r.lookupPath(view, [0, "n"], ctx), 3)
        assert.equal(r.lookupPath(chain, [0], ctx), failure)
        assert.equal(r.lookupPath(reversed, [1], ctx), failure)
        verifyParents(ctx, chain._state, view._state, reversed._state)
        verifyRefCounts(ctx, chain._state, view._state, reversed._state)
    })
})
