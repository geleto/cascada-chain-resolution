import { runInNewContext } from "node:vm"
import * as errorUtils from "../src/error.js"

import {
    Chain,
    arrayViews,
    assignPath,
    buildRefIndex,
    countPromiseRegistrations,
    deferred,
    enter,
    expect,
    externalState,
    errorCause,
    exportValue,
    flushMicrotasks,
    getRefCounter,
    hasError,
    languageValues,
    importValue,
    lookupPath,
    propertyVersions,
    readPath,
    reportFatalError,
    metaOf,
    managedState,
    managedStateClass,
    run,
    setFatalErrorReporter,
    thrownBy,
    verifyRefCounts,
} from "./support.js"

describe("run", () => {
    it("rejects unsupported calls before consuming arguments", () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const before = registrations()
        const mutation = new Chain([1])
        const mutationError = run(
            mutation,
            [],
            "map",
            [pending.promise],
            { mutationScopeDepth: 0 },
        )
        expect(mutationError instanceof Error).to.be(true)
        expect(mutation._state.value).to.be(mutationError)

        const unsupportedMode = new Chain([1])
        const unsupportedModeError = run(
            unsupportedMode,
            [],
            "slice",
            [pending.promise],
            { mutationScopeDepth: 0 },
        )
        expect(unsupportedModeError instanceof Error).to.be(true)
        expect(unsupportedMode._state.value).to.be(unsupportedModeError)

        const observation = new Chain([1])
        const constructorError = run(
            observation,
            [],
            "constructor",
            [pending.promise],
            {},
        )
        expect(constructorError.message).to.be(
            "Method is not callable: constructor",
        )
        expect(observation._state.value).to.eql([1])

        expect(registrations()).to.be(before)
        pending.resolve(1)
    })

    it("uses native String calls and logical Array conversion", async () => {
        const scalar = function scalar() {}
        expect(run(
            new Chain("ab"),
            [],
            "concat",
            [scalar],
            {},

        )).to.be(String.prototype.concat.call("ab", scalar))
        expect(run(
            new Chain([1, 2]),
            [],
            "slice",
            [scalar],
            {},

        ) instanceof Error).to.be(true)

        const argument = deferred()
        const limit = deferred()
        const chain = new Chain("ab")
        const result = run(chain, [], "concat", [argument.promise], {})
        const split = run(
            new Chain("ab"),
            [],
            "split",
            [
                "",
                limit.promise,
            ],
            {},
        )

        expect(result instanceof Promise).to.be(true)
        argument.resolve(["c", "d"])
        limit.resolve(scalar)
        expect(await result).to.be("abc,d")
        expect(await split).to.eql(
            String.prototype.split.call("ab", "", scalar),
        )
    })

    it("exports only arguments that native code receives", async () => {
        const nested = deferred()
        const argument = { nested: nested.promise }
        let received
        const target = {}
        Object.defineProperty(target, "read", {
            enumerable: true,
            value(value) {
                received = value
                return value.nested
            },
        })

        const ordinary = run(
            new Chain(target),
            [],
            "read",
            [argument],
            {},
        )
        expect(ordinary instanceof Promise).to.be(true)
        nested.resolve(3)
        expect(await ordinary).to.be(3)
        expect(received).not.to.be(argument)
        expect(received).to.eql({ nested: 3 })

        const indexReady = deferred()
        const indexed = run(
            new Chain([1]),
            [],
            "at",
            [{ ready: indexReady.promise }],
            {},
        )
        expect(indexed).to.be(1)
        indexReady.resolve(true)

        const retainedReady = deferred()
        const retained = { ready: retainedReady.promise }
        const pushed = run(
            new Chain([]),
            [],
            "push",
            [retained],
            {},
        )
        expect(pushed instanceof Promise).to.be(false)
        expect([...pushed]).to.eql([retained])
        retainedReady.resolve(true)
    })

    it("handles arguments captured from other Chains", async () => {
        const pending = deferred()
        const source = new Chain({ argument: pending.promise })
        const argument = lookupPath(source, ["argument"])
        const target = {}
        Object.defineProperty(target, "read", {
            enumerable: true,
            value(value) {
                return value.answer
            },
        })

        const observed = run(
            new Chain(target),
            [],
            "read",
            [argument],
            {},
        )
        assignPath(source, ["argument"], { answer: 2 })
        pending.resolve({ answer: 1 })

        expect(await observed).to.be(1)
        expect(exportValue(source, [])).to.eql({
            argument: { answer: 2 },
        })

        const payloadSource = new Chain({ item: { answer: 3 } })
        const item = lookupPath(payloadSource, ["item"])
        const pushed = run(
            new Chain([]),
            [],
            "push",
            [item],
            {},
        )

        expect(pushed instanceof Promise).to.be(false)
        expect([...pushed]).to.eql([item])
        expect([...pushed][0]).to.be(item)
        assignPath(payloadSource, ["item", "answer"], 4)
        expect([...pushed][0].answer).to.be(3)
        expect(exportValue(payloadSource, [])).to.eql({
            item: { answer: 4 },
        })
    })

    it("uses ordinary String invocation and imports results", async () => {
        const replacement = deferred()
        const chain = new Chain("abc")
        const replacementResult = run(
            chain,
            [],
            "replace",
            [
                "a",
                replacement.promise,
            ],
            {},
        )

        replacement.resolve(() => "x")

        expect(await replacementResult).to.be("xbc")

        const parts = run(
            new Chain("a,b"),
            [],
            "split",
            [","],
            {},
        )
        const partsChain = new Chain(parts)
        run(partsChain, [], "push", ["c"], { mutationScopeDepth: 0 })

        expect(parts).to.eql(["a", "b"])
        expect(partsChain._state.value).to.eql(["a", "b", "c"])
        expect(partsChain._state.value).not.to.be(parts)
    })

    it("allows String dispatch protocols and imports their results", () => {
        let calls = 0
        const external = { value: 1 }
        class Matcher {
            [Symbol.match]() {
                calls++
                return external
            }
        }
        const result = run(
            new Chain("abc"),
            [],
            "match",
            [new Matcher()],
            {},
        )
        const resultChain = new Chain(result)
        assignPath(resultChain, ["value"], 2)

        expect(calls).to.be(1)
        expect(result).to.be(external)
        expect(external).to.eql({ value: 1 })
        expect(resultChain._state.value).to.eql({ value: 2 })
        expect(resultChain._state.value).not.to.be(external)
    })

    it("imports results delegated through intrinsic String methods", () => {
        const external = ["a"]
        const matcher = /a/
        matcher.exec = () => external

        const result = run(
            new Chain("abc"),
            [],
            "match",
            [matcher],
            {},
        )
        const resultChain = new Chain(result)
        assignPath(resultChain, ["0"], "changed")

        expect(result).to.be(external)
        expect(external).to.eql(["a"])
        expect(resultChain._state.value).to.eql(["changed"])
        expect(resultChain._state.value).not.to.be(external)
    })

    it("uses only own enumerable data properties as record methods", () => {
        const source = { value: 2 }
        let accessed = false
        Object.defineProperty(source, "read", {
            enumerable: true,
            value() {
                return this.value
            },
        })
        Object.defineProperty(source, "hidden", {
            value() {
                return 3
            },
        })
        Object.defineProperty(source, "accessor", {
            get() {
                accessed = true
                return () => 4
            },
        })

        expect(run(new Chain(source), [], "read", [], {})).to.be(2)
        expect(run(
            new Chain(source),
            [],
            "hidden",
            [],
            {},

        ) instanceof Error).to.be(true)
        expect(run(
            new Chain(source),
            [],
            "accessor",
            [],
            {},

        ) instanceof Error).to.be(true)
        expect(accessed).to.be(false)
    })

    it("returns a synchronous observation failure without changing its receiver", () => {
        const failure = new Error("observation failed")
        const source = { value: 2 }
        Object.defineProperty(source, "fail", {
            enumerable: true,
            value() {
                throw failure
            },
        })
        const chain = new Chain(source)

        expect(errorCause(run(chain, [], "fail", [], {}))).to.be(failure)
        expect(chain._state.value).to.be(source)
        expect(source.value).to.be(2)
    })

    it("returns a delayed synchronous observation failure", async () => {
        const argument = deferred()
        const failure = new Error("delayed observation failed")
        const source = { value: 2 }
        Object.defineProperty(source, "fail", {
            enumerable: true,
            value() {
                throw failure
            },
        })
        const chain = new Chain(source)

        const result = run(
            chain,
            [],
            "fail",
            [argument.promise],
            {},
        )
        argument.resolve("ready")

        expect(errorCause(await result)).to.be(failure)
        expect(chain._state.value).to.be(source)
        expect(source.value).to.be(2)
        expect(metaOf(source).readLeaseCount).to.be(undefined)
    })

    it("preserves host result Promise outcomes", async () => {
        const returned = deferred()
        const argument = deferred()
        const fulfilledError = new Error("fulfilled Error")
        const rejectedError = new Error("rejected Error")
        const source = {}
        const chain = new Chain(source)
        Object.defineProperty(source, "result", {
            enumerable: true,
            value() {
                return returned.promise
            },
        })

        const fulfilled = run(
            chain,
            [],
            "result",
            [argument.promise],
            {},
        )
        argument.resolve("ready")
        returned.resolve(fulfilledError)
        expect(errorCause(await fulfilled)).to.be(fulfilledError)

        const ready = run(
            chain,
            [],
            "result",
            [],
            {},
        )
        expect(ready).not.to.be(returned.promise)
        expect(errorCause(await ready)).to.be(fulfilledError)

        const returnedData = deferred()
        const hostValue = {}
        Object.defineProperty(source, "data", {
            enumerable: true,
            value() {
                return returnedData.promise
            },
        })
        const dataResult = run(chain, [], "data", [], {})
        expect(dataResult).not.to.be(returnedData.promise)
        returnedData.resolve(hostValue)
        expect(await dataResult).to.be(hostValue)
        expect(metaOf(hostValue).imported).to.be(true)

        const failed = deferred()
        Object.defineProperty(source, "failure", {
            enumerable: true,
            value() {
                return failed.promise
            },
        })
        const rejection = run(chain, [], "failure", [], {})
        failed.reject(rejectedError)
        let rejected
        try {
            await rejection
        } catch (error) {
            rejected = error
        }
        expect(errorCause(rejected)).to.be(rejectedError)
        expect(chain._state.value).to.be(source)
    })

    it("honors declarations on ready and promised host results", async () => {
        class Managed {}
        const managed = managedState(new Managed())
        const external = externalState({})
        const source = {}
        Object.defineProperties(source, {
            managed: { enumerable: true, value: () => managed },
            external: {
                enumerable: true,
                value: () => Promise.resolve(external),
            },
        })
        const chain = new Chain(source)

        expect(run(chain, [], "managed", [], {})).to.be(managed)
        expect(metaOf(managed).type).to.be(
            languageValues.TYPE_MANAGED_CLASS,
        )
        expect(await run(chain, [], "external", [], {})).to.be(external)
        expect(metaOf(external).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
    })

    it("leases a receiver through a pending host result", async () => {
        const completion = deferred()
        const source = { value: 1 }
        Object.defineProperty(source, "laterRead", {
            enumerable: true,
            value() {
                return completion.promise.then(() => this.value)
            },
        })
        const chain = new Chain(source)

        const result = run(chain, [], "laterRead", [], {})
        assignPath(chain, ["value"], 2)
        completion.resolve()

        expect(await result).to.be(1)
        expect(source.value).to.be(1)
        expect(chain._state.value).not.to.be(source)
        expect(chain._state.value.value).to.be(2)
        expect(metaOf(source).readLeaseCount).to.be(undefined)
    })

    it("admits a promised host receiver alias before releasing its lease", async () => {
        const completion = deferred()
        const source = { value: 1 }
        Object.defineProperty(source, "laterSelf", {
            enumerable: true,
            value() {
                return completion.promise.then(() => this)
            },
        })
        const chain = new Chain(source)

        const result = run(chain, [], "laterSelf", [], {})
        completion.resolve()
        const alias = await result
        assignPath(chain, ["value"], 2)

        expect(alias).to.be(source)
        expect(alias.value).to.be(1)
        expect(chain._state.value).not.to.be(source)
        expect(chain._state.value.value).to.be(2)
        expect(metaOf(source).readLeaseCount).to.be(undefined)
    })

    it("adopts host result thenables into one operation Promise", async () => {
        const completion = deferred()
        const thenable = {
            then: completion.promise.then.bind(completion.promise),
        }
        let returned = thenable
        const source = { value: 1 }
        Object.defineProperty(source, "result", {
            enumerable: true,
            value() {
                return returned
            },
        })
        const chain = new Chain(source)

        const result = run(chain, [], "result", [], {})

        expect(result).not.to.be(thenable)
        completion.resolve("done")
        expect(await result).to.be("done")

        const failed = deferred()
        const failure = new Error("failed")
        const rejectedThenable = {
            then: failed.promise.then.bind(failed.promise),
        }
        returned = rejectedThenable

        const rejectedResult = run(
            chain,
            [],
            "result",
            [],
            {},
        )
        expect(rejectedResult).not.to.be(rejectedThenable)
        failed.reject(failure)
        let rejection
        try {
            await rejectedResult
        } catch (error) {
            rejection = error
        }
        expect(errorCause(rejection)).to.be(failure)

        assignPath(chain, ["value"], 2)
        expect(chain._state.value).to.be(source)
        expect(source.value).to.be(2)
        expect(metaOf(source).readLeaseCount).to.be(undefined)
    })

    it("prepares nested Promises before invoking a record method", async () => {
        const pending = deferred()
        const registrationCount = countPromiseRegistrations(pending.promise)
        const source = { nested: { pending: pending.promise } }
        Object.defineProperty(source, "seesPending", {
            enumerable: true,
            value() {
                return this.nested.pending
            },
        })
        const initialCount = registrationCount()

        const result = run(new Chain(source), [], "seesPending", [], {})

        expect(result instanceof Promise).to.be(true)
        expect(registrationCount() > initialCount).to.be(true)
        pending.resolve(1)
        expect(await result).to.be(1)
    })

    it("exposes prepared logical Promise values to record methods", async () => {
        const runtimePending = deferred()
        const runtimeOwned = { pending: runtimePending.promise }
        Object.defineProperty(runtimeOwned, "stillPending", {
            enumerable: true,
            value() {
                return this.pending === runtimePending.promise
            },
        })
        readPath(new Chain(runtimeOwned), ["pending"])

        const importedPending = deferred()
        const imported = { pending: importedPending.promise }
        Object.defineProperty(imported, "stillPending", {
            enumerable: true,
            value() {
                return this.pending === importedPending.promise
            },
        })
        importValue(imported, "ordinary receiver")

        runtimePending.resolve("runtime")
        importedPending.resolve("imported")
        await flushMicrotasks()

        expect(run(new Chain(runtimeOwned), [], "stillPending", [], {})).to.be(
            false,
        )
        expect(run(new Chain(imported), [], "stillPending", [], {})).to.be(false)
    })

    it("imports a record method result that aliases its receiver", async () => {
        const pending = deferred()
        const root = { pending: pending.promise }
        root.self = function () {
            return this
        }
        const languageKeys = Reflect.ownKeys(root)
        const earlierRead = readPath(new Chain(root), ["pending"])

        const invocation = run(new Chain(root), [], "self", [], {})
        expect(invocation instanceof Promise).to.be(true)

        const resolved = { done: true }
        pending.resolve(resolved)
        const result = await invocation
        expect(result).to.be(root)
        expect(Reflect.ownKeys(root)).to.eql(languageKeys)
        expect(metaOf(root).imported).to.be(undefined)
        expect(metaOf(root).shared).to.be(true)
        expect(await earlierRead).to.be(resolved)
        await flushMicrotasks()

        expect(root.pending).to.be(resolved)
        expect(readPath(new Chain(root), ["pending"])).to.be(resolved)
    })

    it("preserves holes and identities in Array observers", () => {
        const child = {}
        const source = [child, , 3]
        const chain = new Chain(source)
        const sliced = run(chain, [], "slice", [0], {})
        const reversed = run(chain, [], "toReversed", [], {})

        expect(sliced.keys()).to.eql(["0", "2"])
        expect(sliced.get("0")).to.be(child)
        expect(Object.keys(reversed)).to.eql(["0", "1", "2"])
        expect(reversed).to.eql([3, undefined, child])
        expect(source).to.eql([child, , 3])
    })

    it("preserves native defaults after promised arguments", async () => {
        const sliceEnd = deferred()
        const copyEnd = deferred()
        const flatDepth = deferred()
        const separator = deferred()
        const sliced = run(
            new Chain([1, 2, 3]),
            [],
            "slice",
            [
                0,
                sliceEnd.promise,
            ],
            {},
        )
        const copiedChain = new Chain([1, 2, 3])
        const copied = run(
            copiedChain,
            [],
            "copyWithin",
            [
                1,
                0,
                copyEnd.promise,
            ],
            { mutationScopeDepth: 0 },
        )
        const flattened = run(
            new Chain([[1], [2]]),
            [],
            "flat",
            [flatDepth.promise],
            {},
        )
        const joined = run(
            new Chain([1, 2]),
            [],
            "join",
            [separator.promise],
            {},
        )

        sliceEnd.resolve(undefined)
        copyEnd.resolve(undefined)
        flatDepth.resolve(undefined)
        separator.resolve(undefined)

        expect([...(await sliced)]).to.eql([1, 2, 3])
        expect(await copied).to.be(copiedChain._state.value)
        expect(copiedChain._state.value).to.eql([1, 1, 2])
        expect(await flattened).to.eql([1, 2])
        expect(await joined).to.be("1,2")
    })

    it("recognizes cross-realm Array intrinsics without export", () => {
        const pending = deferred()
        const source = runInNewContext("[]")
        source.push(pending.promise)

        const result = run(new Chain(source), [], "slice", [], {})

        expect(result instanceof Promise).to.be(false)
        expect(result.get("0")).to.be(pending.promise)
        pending.resolve(1)
    })

    it("derives numeric slices without copying their backing", () => {
        const source = [0, 1, 2, 3, 4]
        const sliced = run(
            new Chain(source),
            [],
            "slice",
            [
                1,
                -1,
            ],
            {},
        )

        expect(arrayViews.isArrayView(sliced)).to.be(true)
        expect(arrayViews.backingOf(sliced)).to.be(source)
        expect([...sliced]).to.eql([1, 2, 3])

        const changed = new Chain(sliced)
        run(changed, [], "push", [5], { mutationScopeDepth: 0 })
        expect(arrayViews.isArrayView(changed._state.value)).to.be(false)
        expect(exportValue(new Chain(source), [])).to.eql([0, 1, 2, 3, 4])
    })

    it("derives views from physically resolved COW Promise forks", async () => {
        const imported = importValue({ value: 1 }, "fork result")
        const pending = deferred()
        const chain = new Chain({ values: [pending.promise, "b"] })

        lookupPath(chain, ["values"])
        assignPath(chain, ["values", "1"], "B")
        pending.resolve(imported)
        await flushMicrotasks()

        const values = chain._state.value.values
        const sliced = run(new Chain(values), [], "slice", [0, 2], {})
        expect(values[0]).to.be(imported)
        expect(readPath(new Chain(sliced), ["0"])).to.be(imported)
    })

    it("appends concat items to the receiver backing", () => {
        const left = [1, , 3]
        const right = [, 5]
        const concatenated = run(
            new Chain(left),
            [],
            "concat",
            [
                right,
                6,
            ],
            {},
        )

        expect(arrayViews.isArrayView(concatenated)).to.be(true)
        expect(arrayViews.backingOf(concatenated)).to.be(left)
        expect(arrayViews.projectionOf(left).length).to.be(3)
        expect(arrayViews.projectionOf(right)).to.be(right)
        expect(concatenated.keys()).to.eql(["0", "2", "4", "5"])
        expect([...concatenated]).to.eql([
            1,
            undefined,
            3,
            undefined,
            5,
            6,
        ])
        expect(exportValue(new Chain(left), [])).to.eql([1, , 3])
        expect(right).to.eql([, 5])

        const self = [1, , 3]
        const selfConcat = run(
            new Chain(self),
            [],
            "concat",
            [self],
            {},
        )
        expect(selfConcat.keys()).to.eql(["0", "2", "3", "5"])
        expect([...selfConcat]).to.eql([
            1,
            undefined,
            3,
            1,
            undefined,
            3,
        ])
        expect(exportValue(new Chain(self), [])).to.eql([1, , 3])
    })

    it("does not probe appended values for runtime-private brands", () => {
        const value = new Proxy({}, {
            get(target, key, receiver) {
                if (
                    typeof key === "symbol" &&
                    key !== Symbol.isConcatSpreadable
                ) throw new Error("runtime brand was probed")
                return Reflect.get(target, key, receiver)
            },
        })

        const result = run(
            new Chain([1]),
            [],
            "concat",
            [value],
            {},
        )

        expect(arrayViews.isArrayView(result)).to.be(true)
        expect(result.get("1")).to.be(value)
    })

    it("gives concatenated Promise properties independent mirrors", async () => {
        const pending = deferred()
        const leftChain = new Chain([pending.promise])
        const right = [pending.promise]
        const concatenated = run(
            leftChain,
            [],
            "concat",
            [right],
            {},
        )
        const mirrors = [
            propertyVersions.getPromiseMirror(leftChain._state.value, "0"),
            propertyVersions.getPromiseMirror(right, "0"),
            propertyVersions.getPromiseMirror(concatenated, "0"),
            propertyVersions.getPromiseMirror(concatenated, "1"),
        ]

        expect(new Set(mirrors).size).to.be(4)
        assignPath(leftChain, ["0"], 9)
        pending.resolve(1)

        expect(await exportValue(new Chain(concatenated), [])).to.eql([1, 1])
        expect(exportValue(leftChain, [])).to.eql([9])
        expect(exportValue(new Chain(right), [])).to.eql([1])
        verifyRefCounts(concatenated, leftChain._state.value, right)
    })

    it("materializes ineligible slice and concat results", () => {
        const slicedSource = importValue([1, 2, 3])
        const concatSource = importValue([1, 2])
        const nestedSource = importValue({ values: [1, 2, 3] })
        const middle = run(
            new Chain([1, 2, 3]),
            [],
            "slice",
            [
                0,
                2,
            ],
            {},
        )
        const sliced = run(
            new Chain(slicedSource),
            [],
            "slice",
            [1],
            {},
        )
        const concatenated = run(
            new Chain(concatSource),
            [],
            "concat",
            [[3]],
            {},
        )
        const middleConcat = run(
            new Chain(middle),
            [],
            "concat",
            [[4]],
            {},
        )
        const nestedSlice = run(
            new Chain(nestedSource),
            ["values"],
            "slice",
            [1],
            {},
        )

        expect(Array.isArray(sliced)).to.be(true)
        expect(Array.isArray(concatenated)).to.be(true)
        expect(Array.isArray(middleConcat)).to.be(true)
        expect(metaOf(nestedSource.values).imported).to.be(true)
        expect(Array.isArray(nestedSlice)).to.be(true)
        expect(sliced).to.eql([2, 3])
        expect(concatenated).to.eql([1, 2, 3])
        expect(middleConcat).to.eql([1, 2, 4])
        expect(nestedSlice).to.eql([2, 3])
        expect(slicedSource).to.eql([1, 2, 3])
        expect(concatSource).to.eql([1, 2])
    })

    it("forks Promise property versions at the operation position", async () => {
        const pending = deferred()
        const chain = new Chain([pending.promise])
        const copy = run(chain, [], "slice", [], {})

        assignPath(chain, ["0"], 9)
        pending.resolve(1)

        expect(await exportValue(new Chain(copy), [])).to.eql([1])
        expect(exportValue(chain, [])).to.eql([9])
        verifyRefCounts(copy)
        verifyRefCounts(chain._state.value)
    })

    it("tracks duplicate Promise placements by index during remapping", async () => {
        const pending = deferred()
        const chain = new Chain([pending.promise, pending.promise])
        const source = chain._state.value
        const source0 = propertyVersions.getOrCreatePromiseMirror(
            source,
            "0",
            pending.promise,
        )
        const source1 = propertyVersions.getOrCreatePromiseMirror(
            source,
            "1",
            pending.promise,
        )

        expect(source0 === source1).to.be(false)
        run(chain, [], "reverse", [], { mutationScopeDepth: 0 })

        const reversed = chain._state.value
        const reversed0 = propertyVersions.getPromiseMirror(reversed, "0")
        const reversed1 = propertyVersions.getPromiseMirror(reversed, "1")
        expect(reversed0 === reversed1).to.be(false)
        expect(reversed0 === source1).to.be(false)
        expect(reversed1 === source0).to.be(false)

        const copied = new Chain([pending.promise, 0])
        run(copied, [], "copyWithin", [1, 0, 1], { mutationScopeDepth: 0 })
        expect(
            propertyVersions.getPromiseMirror(copied._state.value, "0") ===
                propertyVersions.getPromiseMirror(copied._state.value, "1"),
        ).to.be(false)

        pending.resolve(1)
        expect(await exportValue(chain, [])).to.eql([1, 1])
        expect(await exportValue(copied, [])).to.eql([1, 1])
        verifyRefCounts(chain._state.value)
        verifyRefCounts(copied._state.value)
    })

    it("does not export Error values nested in host inputs", async () => {
        const direct = new Error("direct")
        const nested = deferred()
        const flat = run(new Chain([direct]), [], "flat", [], {})
        let received
        const target = {}
        Object.defineProperty(target, "inspect", {
            enumerable: false,
            value(value) {
                received = value
                return value.error === direct
            },
        })
        const argument = { error: nested.promise }
        const inspected = run(
            new Chain(target),
            [],
            "inspect",
            [argument],
            {},
        )

        expect(flat.map(errorCause)).to.eql([direct])
        expect(inspected instanceof Promise).to.be(true)
        nested.reject(direct)
        expect(errorCause(await inspected)).to.be(direct)
        expect(received).to.be(undefined)
    })

    it("combines every Error within each failed host argument", () => {
        const first = new Error("first")
        const second = new Error("second")
        const third = new Error("third")
        let invoked = false
        const target = {}
        Object.defineProperty(target, "inspect", {
            enumerable: false,
            value() {
                invoked = true
            },
        })

        const result = run(
            new Chain(target),
            [],
            "inspect",
            [
                { first, nested: { second } },
                { third },
            ],
            {},
        )

        expect(invoked).to.be(false)
        expect(result.errors.map(errorCause)).to.eql([first, second, third])
    })

    it("keeps shared failed inputs as separate argument roots", () => {
        const first = new Error("first")
        const second = new Error("second")
        const shared = { first, second }
        let invoked = false
        const target = {}
        Object.defineProperty(target, "inspect", {
            enumerable: false,
            value() {
                invoked = true
            },
        })

        const result = run(
            new Chain(target),
            [],
            "inspect",
            [
                shared,
                shared,
            ],
            {},
        )

        expect(invoked).to.be(false)
        expect(result.errors.map(errorCause)).to.eql([first, second])
    })

    it("poisons only arguments consumed by an Array method", async () => {
        const direct = new Error("direct")
        const rejected = new Error("rejected")
        const pending = deferred()
        const concatItem = deferred()

        expect(errorCause(run(
            new Chain("abc"),
            [],
            "slice",
            [direct],
            {},

        ))).to.be(direct)
        expect(errorCause(run(
            new Chain([1]),
            [],
            "with",
            [
                direct,
                2,
            ],
            {},

        ))).to.be(direct)

        const pushed = new Chain([1])
        expect(run(
            pushed,
            [],
            "push",
            [direct],
            { mutationScopeDepth: 0 },

        )).to.be(2)
        expect(errorCause(readPath(pushed, ["1"]))).to.be(direct)

        const pushedPromise = deferred()
        const promisedPush = new Chain([])
        expect(run(
            promisedPush,
            [],
            "push",
            [pushedPromise.promise],
            { mutationScopeDepth: 0 },

        )).to.be(1)
        pushedPromise.reject(rejected)
        await flushMicrotasks()
        expect(errorCause(readPath(promisedPush, ["0"]))).to.be(rejected)
        expect(promisedPush._state.value).not.to.be(rejected)

        expect(errorCause(run(
            new Chain([direct]),
            [],
            "includes",
            [direct],
            {},

        ))).to.be(direct)
        expect(errorCause(run(
            new Chain([direct]),
            [],
            "indexOf",
            [direct],
            {},

        ))).to.be(direct)
        expect(errorCause(run(
            new Chain([direct]),
            [],
            "lastIndexOf",
            [direct],
            {},

        ))).to.be(direct)

        const concatenated = run(
            new Chain([]),
            [],
            "concat",
            [concatItem.promise],
            {},
        )
        concatItem.reject(rejected)
        expect(errorCause(await concatenated)).to.be(rejected)

        const delayed = run(
            new Chain([1]),
            [],
            "slice",
            [pending.promise],
            {},
        )
        pending.reject(rejected)
        expect(errorCause(await delayed)).to.be(rejected)

        const mutation = new Chain([1, 2])
        const mutationFailure = run(
            mutation,
            [],
            "copyWithin",
            [direct],
            { mutationScopeDepth: 0 },

        )
        expect(errorCause(mutationFailure)).to.be(direct)
        expect(errorCause(run(
            new Chain([]),
            [],
            "concat",
            [direct],
            {},

        ))).to.be(direct)
        expect(mutation._state.value).to.be(mutationFailure)

        const mutationPending = deferred()
        const delayedMutation = new Chain([1, 2])
        const mutationResult = run(
            delayedMutation,
            [],
            "copyWithin",
            [mutationPending.promise],
            { mutationScopeDepth: 0 },
        )
        mutationPending.reject(rejected)
        const delayedFailure = await mutationResult
        expect(errorCause(delayedFailure)).to.be(rejected)
        expect(delayedMutation._state.value).to.be(delayedFailure)
    })

    it("does not resolve ignored controlled Array arguments", () => {
        const ignored = deferred()
        const registrations = countPromiseRegistrations(ignored.promise)
        const initial = registrations()

        const result = run(
            new Chain([1, 2]),
            [],
            "slice",
            [
                0,
                1,
                ignored.promise,
            ],
            {},
        )

        expect([...result]).to.eql([1])
        expect(registrations()).to.be(initial)
        ignored.resolve(2)
    })

    it("does not treat an arbitrary .errors property as a compound", async () => {
        const firstPending = deferred()
        const secondPending = deferred()
        const first = new Error("first")
        const second = new Error("second")
        const nested = new Error("nested")
        second.errors = [nested]

        const delayed = run(
            new Chain([1, 2]),
            [],
            "copyWithin",
            [
                firstPending.promise,
                secondPending.promise,
                firstPending.promise,
            ],
            {},
        )
        secondPending.reject(second)
        firstPending.reject(first)

        const combined = await delayed
        expect(combined.errors.map(errorCause)).to.eql([first, second])
        expect(combined.errors.includes(nested)).to.be(false)
        expect(errorCause(combined.errors[1]).errors).to.eql([nested])

        const ready = run(
            new Chain([1, 2]),
            [],
            "copyWithin",
            [
                first,
                second,
                first,
            ],
            {},
        )
        expect(ready.errors.map(errorCause)).to.eql([first, second])

        const concatPending = deferred()
        const concatResult = run(
            new Chain([]),
            [],
            "concat",
            [
                first,
                concatPending.promise,
                first,
            ],
            {},
        )
        concatPending.reject(second)
        const concatCombined = await concatResult
        expect(concatCombined.errors.map(errorCause)).to.eql([first, second])
        expect(concatCombined.errors.includes(nested)).to.be(false)
    })

    it("skips dynamic member lookup when argument export fails", () => {
        const failure = new Error("invalid argument")
        let reflections = 0
        const receiver = new Proxy({}, {
            get(target, key, current) {
                if (key === "missing") reflections++
                return Reflect.get(target, key, current)
            },
            getOwnPropertyDescriptor(target, key) {
                if (key === "missing") reflections++
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const chain = new Chain(receiver)
        reflections = 0

        const result = run(
            chain,
            [],
            "missing",
            [failure],
            {},
        )

        expect(errorCause(result)).to.be(failure)
        expect(reflections).to.be(0)
    })

    it("rejects a record accessor after clean argument export", async () => {
        const pending = deferred()
        let lookups = 0
        const receiver = {}
        Object.defineProperty(receiver, "missing", {
            get() {
                lookups++
                return undefined
            },
        })

        const result = run(
            new Chain(receiver),
            [],
            "missing",
            [pending.promise],
            {},
        )

        expect(lookups).to.be(0)
        pending.resolve(3)
        expect((await result).message).to.be("Method is not callable: missing")
        expect(lookups).to.be(0)
    })

    it("rejects unsupported String members without exporting arguments", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const before = registrations()

        const missing = run(
            new Chain("value"),
            [],
            "missing",
            [pending.promise],
            {},
        )
        const accessor = run(
            new Chain("value"),
            [],
            "__proto__",
            [pending.promise],
            {},
        )

        expect(missing.message).to.be("Method is not callable: missing")
        expect(accessor.message).to.be("Method is not callable: __proto__")
        expect(missing.kind).to.be(errorUtils.ERROR_KIND.MissingFunction)
        expect(accessor.kind).to.be(errorUtils.ERROR_KIND.NotAFunction)
        expect(registrations()).to.be(before)
        const failure = new Error("unused argument rejected")
        const handled = pending.promise.catch(error => error)
        pending.reject(failure)
        expect(await handled).to.be(failure)
    })

    it("prepares flat candidates concurrently without resolving retained values", async () => {
        const first = deferred()
        const second = deferred()
        const retained = deferred()
        const firstCount = countPromiseRegistrations(first.promise)
        const secondCount = countPromiseRegistrations(second.promise)
        const chain = new Chain([
            first.promise,
            second.promise,
            [retained.promise],
        ])
        const initial = [
            firstCount(),
            secondCount(),
        ]

        const result = run(chain, [], "flat", [1], {})

        expect(firstCount() > initial[0]).to.be(true)
        expect(secondCount() > initial[1]).to.be(true)
        first.resolve([1])
        second.resolve(2)

        const flattened = await result
        expect(flattened.slice(0, 2)).to.eql([1, 2])
        expect(flattened[2]).to.be(retained.promise)
        retained.resolve(3)
    })

    it("materializes before a restricted element mutation", () => {
        const inserted = { value: 1 }
        const root = [1, 2]
        Object.defineProperty(root, "1", {
            value: 2,
            enumerable: true,
            writable: false,
            configurable: true,
        })
        const result = run(
            new Chain(root),
            [],
            "fill",
            [inserted],
            { mutationScopeDepth: 0 },
        )

        expect(result instanceof Error).to.be(false)
        expect(result).to.eql([inserted, inserted])
        expect(root).to.eql([1, 2])
        const chain = new Chain(result)
        assignPath(chain, ["0", "value"], 2)
        expect(inserted).to.eql({ value: 1 })
        verifyRefCounts(chain._state.value)
    })

    it("shares payloads added by owned Array mutations", () => {
        const cases = [
            { method: "push", args: value => [value], index: 1 },
            { method: "unshift", args: value => [value], index: 0 },
            { method: "splice", args: value => [1, 0, value], index: 1 },
        ]
        for (const { method, args, index } of cases) {
            const value = { answer: 1 }
            const chain = new Chain([0])

            run(chain, [], method, [...args(value)], { mutationScopeDepth: 0 })
            assignPath(chain, [String(index), "answer"], 2)

            expect(value).to.eql({ answer: 1 })
            expect(chain._state.value[index]).to.eql({ answer: 2 })
            verifyRefCounts(chain._state.value)
        }
    })

    it("transfers wholly removed splice elements from an owned receiver", () => {
        const removedValue = { value: 1 }
        const chain = new Chain([removedValue, 2])

        const removed = run(chain, [], "splice", [0, 1], { mutationScopeDepth: 0 })

        expect(removed).to.eql([removedValue])
        expect(metaOf(removedValue)?.shared).not.to.be(true)
        assignPath(new Chain(removed), ["0", "value"], 3)
        expect(removedValue.value).to.be(3)
        expect(chain._state.value).to.eql([2])
    })

    it("shares splice results retained by a copy-on-write source", () => {
        const removedValue = { value: 1 }
        const source = [removedValue, 2]
        const chain = new Chain(source)
        lookupPath(chain, [])

        const removed = run(chain, [], "splice", [0, 1], { mutationScopeDepth: 0 })
        assignPath(new Chain(removed), ["0", "value"], 3)

        expect(source[0]).to.be(removedValue)
        expect(removedValue.value).to.be(1)
        expect(removed[0]).to.eql({ value: 3 })
        expect(chain._state.value).to.eql([2])
    })

    it("publishes removed ArrayView endpoints as retained values", () => {
        for (const [method, removedIndex] of [
            ["shift", 0],
            ["pop", 1],
        ]) {
            const source = [{ value: 1 }, { value: 2 }]
            const view = run(new Chain(source), [], "slice", [], {})
            const chain = new Chain(view)
            lookupPath(chain, [])

            const removed = run(chain, [], method, [], { mutationScopeDepth: 0 })
            const removedChain = new Chain(removed)
            assignPath(removedChain, ["value"], 3)

            expect(arrayViews.isArrayView(chain._state.value)).to.be(true)
            expect(removed).to.be(source[removedIndex])
            expect(source[removedIndex].value).to.be(removedIndex + 1)
            expect(removedChain._state.value).to.eql({ value: 3 })
            expect(removedChain._state.value).not.to.be(removed)
            verifyRefCounts(
                source,
                view,
                chain._state.value,
                removedChain._state.value,
            )
        }
    })

    it("returns transformed Arrays from mutators in observation mode", () => {
        const source = [1, 2]
        const chain = new Chain(source)
        const result = run(chain, [], "push", [3], {})
        const cleared = run(new Chain([1]), [], "fill", [], {})
        const spliced = run(new Chain([1, 2, 3]), [], "splice", [1, 1, 9], {})

        expect([...result]).to.eql([1, 2, 3])
        expect(cleared).to.eql([undefined])
        expect(spliced).to.eql([1, 9, 3])
        expect(exportValue(chain, [])).to.eql([1, 2])
    })

    it("selects observation-mode mutators by intrinsic name", () => {
        const source = [1]
        source.push = 0
        const chain = new Chain(source)

        const result = run(chain, [], "push", [2], {})
        const original = exportValue(chain, [])

        expect([...result]).to.eql([1, 2])
        expect([...original]).to.eql([1])
        expect(Object.hasOwn(original, "push")).to.be(false)
    })

    it("ignores concat protocols outside the language graph", () => {
        const source = [1]
        const chain = new Chain(source)

        const spread = { [Symbol.isConcatSpreadable]: true, 0: 2, length: 1 }
        const result = run(
            chain,
            [],
            "concat",
            [spread],
            {},
        )
        expect([...result]).to.eql([1, spread])
    })

    it("keeps every earlier value stable across prepends", () => {
        const sourceChain = new Chain([2, 3])
        const first = run(sourceChain, [], "unshift", [1], {})
        const second = run(new Chain(first), [], "unshift", [0], {})

        expect([...second]).to.eql([0, 1, 2, 3])
        expect([...first]).to.eql([1, 2, 3])
        expect(exportValue(sourceChain, [])).to.eql([2, 3])
    })

    it("materializes when an endpoint no longer reaches a physical edge", () => {
        const sourceChain = new Chain([1, 2, 3])
        const shorter = run(sourceChain, [], "pop", [], {})
        const extended = run(new Chain(shorter), [], "push", [4], {})

        expect(Array.isArray(extended)).to.be(true)
        expect(extended).to.eql([1, 2, 4])
        expect([...shorter]).to.eql([1, 2])
        expect(exportValue(sourceChain, [])).to.eql([1, 2, 3])
    })

    it("mutates an owned Array synchronously", () => {
        const source = [1, 2]
        const chain = new Chain(source)

        expect(run(chain, [], "push", [3], { mutationScopeDepth: 0 })).to.be(3)
        expect(chain._state.value).to.be(source)
        expect(source).to.eql([1, 2, 3])
    })

    it("keeps observation results lazily ref-indexed", () => {
        const result = run(new Chain([{ value: 1 }]), [], "slice", [], {})

        expect(getRefCounter(result)).to.be(undefined)
    })

    it("keeps slice reflection inside the selected range", () => {
        const runtime = createProbe()
        const view = run(
            new Chain(runtime.value),
            [],
            "slice",
            [
                500,
                502,
            ],
            {},
        )

        expect([...view]).to.eql(["inside", undefined])
        expect(runtime.ownKeyScans()).to.be(0)
        expect(runtime.inspected.every(inRange)).to.be(true)
        expect(runtime.inspected.includes(500)).to.be(true)

        runtime.reset()
        const exported = exportValue(new Chain(view), [])
        expect(exported.length).to.be(2)
        expect(Object.keys(exported)).to.eql(["0"])
        expect(runtime.ownKeyScans()).to.be(0)
        expect(runtime.inspected.every(inRange)).to.be(true)

        const external = createProbe()
        importValue(external.value, "bounded slice")
        external.reset()
        const sliced = run(
            new Chain(external.value),
            [],
            "slice",
            [
                500,
                502,
            ],
            {},
        )

        expect(Array.isArray(sliced)).to.be(true)
        expect(sliced.length).to.be(2)
        expect(Object.keys(sliced)).to.eql(["0"])
        expect(external.ownKeyScans()).to.be(0)
        expect(external.inspected.every(inRange)).to.be(true)

        external.reset()
        const full = run(new Chain(external.value), [], "slice", [], {})
        expect(full.length).to.be(1000)
        expect(Object.keys(full)).to.eql(["0", "500", "999"])
        expect(external.ownKeyScans()).to.be(1)

        function inRange(index) {
            return index >= 500 && index < 502
        }

        function createProbe() {
            const target = new Array(1000)
            target[0] = "before"
            target[500] = "inside"
            target[999] = "after"
            const inspected = []
            let ownKeyScans = 0
            const value = new Proxy(target, {
                ownKeys(target) {
                    ownKeyScans++
                    return [...Reflect.ownKeys(target), "1001"]
                },
                getOwnPropertyDescriptor(target, key) {
                    if (arrayViews.isArrayIndex(String(key))) {
                        inspected.push(Number(key))
                    }
                    if (key === "1001") {
                        return {
                            value: "outside",
                            enumerable: true,
                            writable: true,
                            configurable: true,
                        }
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
                get(target, key, receiver) {
                    return key === "1001"
                        ? "outside"
                        : Reflect.get(target, key, receiver)
                },
            })
            return {
                inspected,
                value,
                ownKeyScans: () => ownKeyScans,
                reset() {
                    inspected.length = 0
                    ownKeyScans = 0
                },
            }
        }
    })

    it("rejects host conversion hooks without invoking them", () => {
        const slice = (...bounds) => run(
            new Chain([1, 2]),
            [],
            "slice",
            [...bounds],
            {},
        )
        for (const bound of [Symbol(), 1n]) {
            expect(slice(bound) instanceof Error).to.be(true)
        }

        let endConversions = 0
        function start() {}
        function end() {}
        start.valueOf = () => {
            throw new Error("slice start conversion failed")
        }
        end.valueOf = () => {
            endConversions++
            return 2
        }

        const result = slice(start, end)
        expect(result.errors.length).to.be(2)
        expect(endConversions).to.be(0)
    })

    it("returns slice source reflection as a language Error", () => {
        const failure = new Error("slice reflection failed")
        const source = new Proxy([1], {
            getOwnPropertyDescriptor(target, key) {
                if (key === "0") throw failure
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        expect(errorCause(run(new Chain(source), [], "slice", [0], {}))).to.be(
            failure,
        )
    })

    it("preserves imported cycles through structural mutations", () => {
        const cases = [
            ["reverse", []],
            ["splice", [0, 1]],
            ["sort", [(left, right) => left.rank - right.rank]],
        ]
        for (const [method, args] of cases) {
            const cyclic = { rank: 2 }
            cyclic.self = cyclic
            const other = { rank: 1 }
            const source = [cyclic, other]
            importValue(source, `run ${method} cycle`)
            const chain = new Chain(source)

            const result = run(chain, [], method, [...args], { mutationScopeDepth: 0 })

            expect(source).to.eql([cyclic, other])
            expect(cyclic.self).to.be(cyclic)
            expect(result instanceof Error).to.be(false)
            verifyRefCounts(source, chain._state.value, result)
        }
    })

    it("does not inspect sparse holes in full-range Array operations", () => {
        const length = 10000
        const cases = [
            ["slice", false, []],
            ["push", true, [3]],
            ["pop", true, []],
            ["fill", true, [3, length - 2, length - 1]],
            ["copyWithin", true, [length - 1, 0, 1]],
            ["splice", true, [length - 1, 1]],
            ["toReversed", false, []],
        ]

        for (const [method, mutate, args] of cases) {
            let descriptorReads = 0
            const target = new Array(length)
            target[0] = 1
            target[length - 1] = 2
            const source = new Proxy(target, {
                getOwnPropertyDescriptor(target, key) {
                    if (arrayViews.isArrayIndex(String(key))) {
                        descriptorReads++
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const result = run(
                new Chain(source),
                [],
                method,
                args,
                mutate ? { mutationScopeDepth: 0 } : {},
            )

            expect(result instanceof Error).to.be(false)
            expect(descriptorReads < 20).to.be(true)
        }
    })

    it("copy-on-writes a shared mutation receiver", () => {
        const shared = [1, 2]
        const root = { left: shared, right: shared }
        importValue(root)
        const chain = new Chain(root)

        expect(run(chain, ["left"], "push", [3], { mutationScopeDepth: 1 })).to.be(3)
        expect(exportValue(chain, [])).to.eql({
            left: [1, 2, 3],
            right: [1, 2],
        })
    })

    it("never uses imported nested Arrays as mutable backing", () => {
        const external = { values: [1, 2] }
        importValue(external)
        const chain = new Chain(external)

        expect(run(chain, ["values"], "push", [3], { mutationScopeDepth: 1 })).to.be(3)
        expect(external.values).to.eql([1, 2])
        expect(exportValue(chain, [])).to.eql({
            values: [1, 2, 3],
        })
    })

    it("keeps independently rooted imported Arrays materialized", () => {
        const values = [1, 2, 3]
        importValue({ values })

        const result = run(new Chain(values), [], "slice", [1], {})

        expect(Array.isArray(result)).to.be(true)
        expect(result).to.eql([2, 3])
        expect(values).to.eql([1, 2, 3])
    })

    it("gates delayed mutation preparation and returns its result separately", async () => {
        const start = deferred()
        const chain = new Chain([1, 2, 3])
        const result = run(
            chain,
            [],
            "splice",
            [
                start.promise,
                1,
                9,
            ],
            { mutationScopeDepth: 0 },
        )

        expect(chain._state.value instanceof Promise).to.be(true)
        expect(result instanceof Promise).to.be(true)
        start.resolve(1)
        expect(await result).to.eql([2])
        expect(await exportValue(chain, [])).to.eql([1, 9, 3])
    })

    it("selects a pending mutation receiver before its inputs", async () => {
        const receiver = deferred()
        const start = deferred()
        const receiverCount = countPromiseRegistrations(receiver.promise)
        const startCount = countPromiseRegistrations(start.promise)
        const chain = new Chain(receiver.promise)
        const initialReceiverCount = receiverCount()
        const initialStartCount = startCount()

        const result = run(chain, [], "splice", [start.promise, 1], { mutationScopeDepth: 0 })

        expect(receiverCount()).to.be(initialReceiverCount)
        expect(startCount() > initialStartCount).to.be(true)
        expect(chain._state.value instanceof Promise).to.be(true)

        receiver.resolve([1, 2])
        await flushMicrotasks()
        start.resolve(0)
        expect(await result).to.eql([1])
        expect(await exportValue(chain, [])).to.eql([2])
    })

    it("leases each captured identity once while the receiver is pending", async () => {
        const receiver = deferred()
        const payload = { value: 1 }
        const payloadChain = new Chain(payload)
        const chain = new Chain(receiver.promise)

        const result = run(
            chain,
            [],
            "splice",
            [
                1,
                0,
                payload,
                payload,
            ],
            { mutationScopeDepth: 0 },
        )
        expect(metaOf(payload).readLeaseCount).to.be(1)

        assignPath(payloadChain, ["value"], 2)
        receiver.resolve([0])
        expect(await result).to.eql([])

        expect(payload.value).to.be(1)
        expect(payloadChain._state.value.value).to.be(2)
        expect(chain._state.value[1]).to.be(payload)
        expect(chain._state.value[2]).to.be(payload)
        expect(metaOf(payload).readLeaseCount).to.be(undefined)
    })

    it("leases retained controlled inputs while preparation is pending", async () => {
        const start = deferred()
        const payload = { value: 1 }
        const payloadChain = new Chain(payload)
        const receiver = new Chain([0])

        const result = run(
            receiver,
            [],
            "splice",
            [
                start.promise,
                0,
                payload,
            ],
            { mutationScopeDepth: 0 },
        )
        expect(metaOf(payload).readLeaseCount).to.be(1)

        assignPath(payloadChain, ["value"], 2)
        start.resolve(1)
        expect(await result).to.eql([])

        expect(payload.value).to.be(1)
        expect(payloadChain._state.value.value).to.be(2)
        expect(receiver._state.value[1]).to.be(payload)
        expect(metaOf(payload).readLeaseCount).to.be(undefined)
    })

    it("does not lease arguments ignored by a controlled method", async () => {
        const start = deferred()
        const ignored = { value: 1 }

        const result = run(
            new Chain([1, 2]),
            [],
            "slice",
            [
                start.promise,
                undefined,
                ignored,
            ],
            {},
        )
        expect(metaOf(ignored)).to.be(undefined)

        start.resolve(0)
        expect(await exportValue(new Chain(await result), [])).to.eql([1, 2])
        expect(metaOf(ignored)).to.be(undefined)
    })

    it("releases retained-input leases when preparation fails", async () => {
        const start = deferred()
        const failure = new Error("invalid start")
        const payload = { value: 1 }
        const receiver = new Chain([0])

        const result = run(
            receiver,
            [],
            "splice",
            [
                start.promise,
                0,
                payload,
            ],
            { mutationScopeDepth: 0 },
        )
        expect(metaOf(payload).readLeaseCount).to.be(1)

        start.reject(failure)
        expect(errorCause(await result)).to.be(failure)
        expect(errorCause(receiver._state.value)).to.be(failure)
        expect(metaOf(payload).readLeaseCount).to.be(undefined)
    })

    it("leases controlled inputs revealed while another input waits", async () => {
        const first = deferred()
        const second = deferred()
        const value = { answer: 1 }
        const valueChain = new Chain(value)

        const result = run(
            new Chain([]),
            [],
            "concat",
            [
                first.promise,
                second.promise,
            ],
            {},
        )
        first.resolve(value)
        await flushMicrotasks()
        expect(metaOf(value).readLeaseCount).to.be(1)

        assignPath(valueChain, ["answer"], 2)
        second.resolve("done")
        const concatenated = await result

        expect(readPath(new Chain(concatenated), ["0"])).to.be(value)
        expect(value.answer).to.be(1)
        expect(valueChain._state.value.answer).to.be(2)
        expect(metaOf(value).readLeaseCount).to.be(undefined)
    })

    it("captures concat Array items before another item resolves", async () => {
        const delayed = deferred()
        const item = [1]
        const itemChain = new Chain(item)

        const result = run(
            new Chain([]),
            [],
            "concat",
            [
                item,
                delayed.promise,
            ],
            {},
        )
        assignPath(itemChain, ["0"], 2)
        delayed.resolve("done")

        expect([...(await result)]).to.eql([1, "done"])
        expect(itemChain._state.value).to.eql([2])
    })

    it("protects captured concat item values until publication", async () => {
        const delayed = deferred()
        const child = { value: 1 }
        const item = [child]
        const itemChain = new Chain(item)

        const result = run(
            new Chain([]),
            [],
            "concat",
            [
                item,
                delayed.promise,
            ],
            {},
        )
        assignPath(itemChain, ["0", "value"], 2)
        delayed.resolve("done")

        const output = [...(await result)]
        expect(output).to.eql([child, "done"])
        expect(child.value).to.be(1)
        expect(itemChain._state.value[0].value).to.be(2)
    })

    it("transforms the FIFO property version of a pending receiver", async () => {
        const receiver = deferred()
        const source = [1]
        const chain = new Chain(receiver.promise)
        const escaped = lookupPath(chain, [])

        assignPath(chain, ["0"], 9)
        const result = run(chain, [], "push", [2], { mutationScopeDepth: 0 })

        receiver.resolve(source)
        expect(await escaped).to.be(source)
        expect(await result).to.be(2)
        expect(source).to.eql([1])
        expect(await exportValue(chain, [])).to.eql([9, 2])
    })

    it("publishes a delayed receiver before its independent result", async () => {
        const start = deferred()
        const chain = new Chain([1, 2, 3])
        const result = run(chain, [], "splice", [start.promise, 1], { mutationScopeDepth: 0 })
        const receiver = lookupPath(chain, [])
        const order = []

        receiver.then(() => order.push("receiver"))
        result.then(() => order.push("result"))
        start.resolve(1)
        await Promise.all([receiver, result])

        expect(order).to.eql(["receiver", "result"])
    })

    it("completes a delayed result after receiver supersession", async () => {
        const start = deferred()
        const chain = new Chain({ values: [1, 2, 3] })
        const result = run(
            chain,
            ["values"],
            "splice",
            [
                start.promise,
                1,
            ],
            { mutationScopeDepth: 1 },
        )

        assignPath(chain, ["values"], ["newer"])
        start.resolve(1)

        expect(await result).to.eql([2])
        expect(await exportValue(chain, [])).to.eql({
            values: ["newer"],
        })
    })

    it("installs Promise payloads without gating endpoint mutation", async () => {
        const item = deferred()
        const chain = new Chain([1])

        expect(run(chain, [], "push", [item.promise], { mutationScopeDepth: 0 })).to.be(2)
        expect(chain._state.value instanceof Promise).to.be(false)
        expect(chain._state.value[1]).to.be(item.promise)

        item.resolve({ value: 2 })
        expect(await exportValue(chain, [])).to.eql([
            1,
            { value: 2 },
        ])
        verifyRefCounts(chain._state.value)
    })

    it("does not gate a removed Promise result", async () => {
        const removed = deferred()
        const chain = new Chain([1, removed.promise])
        const result = run(chain, [], "pop", [], { mutationScopeDepth: 0 })

        expect(chain._state.value instanceof Promise).to.be(false)
        expect(result instanceof Promise).to.be(true)
        expect(exportValue(chain, [])).to.eql([1])
        removed.resolve(7)
        expect(await result).to.be(7)
    })

    it("preserves a null mutation result", () => {
        const chain = new Chain([null])

        expect(run(chain, [], "pop", [], { mutationScopeDepth: 0 })).to.be(null)
        expect(chain._state.value).to.eql([])
    })

    it("does not lease an Array for an independent controlled result", async () => {
        const selected = deferred()
        const array = [selected.promise]
        const chain = new Chain(array)

        const result = run(chain, [], "at", [0], {})
        assignPath(chain, ["0"], 2)

        expect(chain._state.value).to.be(array)
        selected.resolve(1)
        expect(await result).to.be(1)
        expect(array).to.eql([2])
    })

    it("leases an Array only while controlled arguments resolve", async () => {
        const index = deferred()
        const array = [1]
        const chain = new Chain(array)

        const result = run(chain, [], "at", [index.promise], {})
        assignPath(chain, ["0"], 2)

        index.resolve(0)
        expect(await result).to.be(1)
        expect(array).to.eql([1])
        expect(chain._state.value).to.eql([2])
    })

    it("searches Promise elements with method-specific early stopping", async () => {
        const first = deferred()
        const later = deferred()
        const chain = new Chain([first.promise, 2, later.promise])

        const index = run(chain, [], "indexOf", [2], {})
        expect(run(chain, [], "includes", [2], {})).to.be(true)
        first.resolve(1)
        expect(await index).to.be(1)
        later.resolve(3)
    })

    it("leases an Array while ordered search continues", async () => {
        const first = deferred()
        const array = [first.promise, 2]
        const chain = new Chain(array)

        const result = run(chain, [], "indexOf", [2], {})
        assignPath(chain, ["1"], 3)

        first.resolve(1)
        expect(await result).to.be(1)
        expect(array).to.eql([1, 2])
        expect(chain._state.value).to.eql([1, 3])
    })

    it("does not lease an Array after includes captures its versions", async () => {
        const first = deferred()
        const array = [first.promise, 2]
        const chain = new Chain(array)

        const result = run(chain, [], "includes", [1], {})
        assignPath(chain, ["1"], 1)

        expect(chain._state.value).to.be(array)
        first.resolve(0)
        expect(await result).to.be(false)
        expect(array).to.eql([0, 1])
    })

    it("does not register Promise elements beyond an indexOf match", async () => {
        const first = deferred()
        const later = deferred()
        const firstCount = countPromiseRegistrations(first.promise)
        const laterCount = countPromiseRegistrations(later.promise)
        const chain = new Chain([first.promise, 2, later.promise])
        const initialFirst = firstCount()
        const initialLater = laterCount()

        const result = run(chain, [], "indexOf", [2], {})

        expect(firstCount() > initialFirst).to.be(true)
        expect(laterCount()).to.be(initialLater)
        first.resolve(1)
        expect(await result).to.be(1)
        expect(laterCount()).to.be(initialLater)
        later.resolve(3)
    })

    it("distinguishes omitted and explicit undefined lastIndexOf starts", async () => {
        const values = [1, 2, 1]

        expect(run(
            new Chain(values),
            [],
            "lastIndexOf",
            [1],
            {},

        )).to.be(2)
        expect(run(
            new Chain(values),
            [],
            "lastIndexOf",
            [
                1,
                undefined,
            ],
            {},

        )).to.be(0)

        const start = deferred()
        const result = run(
            new Chain(values),
            [],
            "lastIndexOf",
            [
                1,
                start.promise,
            ],
            {},
        )
        start.resolve(undefined)
        expect(await result).to.be(0)
    })

    it("protects delayed flat and sort placements until publication", async () => {
        const cases = [
            { method: "flat", args: [], ready: [3] },
            { method: "sort", args: [() => 0], ready: { value: 3 } },
            { method: "toSorted", args: [() => 0], ready: { value: 3 } },
        ]
        for (const { method, args, ready } of cases) {
            const delayed = deferred()
            const child = { value: 1 }
            const source = [child, delayed.promise]
            const chain = new Chain(source)

            const result = run(chain, [], method, [...args], {})
            assignPath(chain, ["0", "value"], 2)
            delayed.resolve(ready)

            const output = [...(await result)]
            expect(output[0]).to.be(child)
            expect(child.value).to.be(1)
            expect(chain._state.value[0].value).to.be(2)
        }
    })

    it("preserves sort holes while toSorted reads through them", () => {
        const source = [3, , 1, undefined]
        const sorted = run(new Chain(source), [], "sort", [], {})
        const copied = run(new Chain(source), [], "toSorted", [], {})

        expect([...sorted]).to.eql([1, 3, undefined, undefined])
        expect(Object.keys(sorted)).to.eql(["0", "1", "2"])
        expect([...copied]).to.eql([1, 3, undefined, undefined])
        expect(Object.keys(copied)).to.eql(["0", "1", "2", "3"])
    })

    it("resolves a comparator binding before native sort", async () => {
        const comparator = deferred()
        const chain = new Chain([3, 1, 2])
        const result = run(
            chain,
            [],
            "sort",
            [comparator.promise],
            { mutationScopeDepth: 0 },
        )

        expect(chain._state.value instanceof Promise).to.be(true)
        comparator.resolve((left, right) => left - right)
        expect(await result).to.eql([1, 2, 3])
        expect(await exportValue(chain, [])).to.eql([1, 2, 3])
    })

    it("does not gate for Promises outside the inspected conversion path", () => {
        const pending = deferred()
        const value = { unrelated: pending.promise }
        const root = [value]
        const chain = new Chain(root)

        const result = run(chain, [], "sort", [], { mutationScopeDepth: 0 })

        expect(result).to.be(root)
        expect(chain._state.value).to.be(root)
        pending.resolve(1)
    })

    it("rejects Promise-returning comparators without mutation", () => {
        const comparison = deferred()
        const registrations = countPromiseRegistrations(comparison.promise)
        const values = [2, 1]
        const chain = new Chain(values)
        const result = run(
            chain,
            [],
            "sort",
            [() => comparison.promise],
            { mutationScopeDepth: 0 },
        )

        expect(result instanceof Error).to.be(true)
        expect(registrations()).to.be(0)
        expect(chain._state.value).to.be(result)
        expect(values).to.eql([2, 1])
        comparison.resolve(0)
    })

    it("propagates a RuntimeError returned by a comparator", () => {
        const source = [2, 1]
        const chain = new Chain(source)
        const failure = new errorUtils.RuntimeError(
            new Error("fatal comparator result"),
            "comparator internals",
        )
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })
        try {
            const caught = thrownBy(() => run(
                chain,
                [],
                "sort",
                [() => failure],
                { mutationScopeDepth: 0 },
            ))

            expect(caught).to.be(failure)
            expect(reported).to.be(failure)
            expect(source).to.eql([2, 1])
        } finally {
            setFatalErrorReporter()
        }
    })

    it("attributes String conversion failures to conversion", () => {
        const failure = run(new Chain([Symbol("value")]), [], "join", [], {})

        expect(failure.kind).to.be(errorUtils.ERROR_KIND.ConversionThrew)
    })

    it("exports one aliased snapshot to a sort comparator", () => {
        const shared = { rank: 2 }
        const first = { rank: 1 }
        const compared = []

        const result = run(
            new Chain([shared, shared, first]),
            [],
            "toSorted",
            [
                (left, right) => {
                compared.push(left, right)
                left.compared = true
                right.compared = true
                return left.rank - right.rank
            },
            ],
            {},
        )

        const sharedCopies = new Set(
            compared.filter(value => value.rank === 2),
        )
        expect(sharedCopies.size).to.be(1)
        expect([...sharedCopies][0]).not.to.be(shared)
        expect(result[0]).to.be(first)
        expect(result[1]).to.be(shared)
        expect(result[2]).to.be(shared)
        expect(shared.compared).to.be(undefined)
        expect(first.compared).to.be(undefined)
    })

    it("exports comparator Errors only when a comparison is possible", () => {
        const failure = new Error("nested comparator input")
        let called = false
        const comparator = () => {
            called = true
            return 0
        }

        const failed = run(
            new Chain([{ failure }, { value: 1 }]),
            [],
            "toSorted",
            [comparator],
            {},
        )
        expect(errorCause(failed)).to.be(failure)
        expect(called).to.be(false)

        const retained = run(
            new Chain([failure]),
            [],
            "toSorted",
            [comparator],
            {},
        )
        expect(errorCause(retained[0])).to.be(failure)
        expect(called).to.be(false)
    })

    it("uses intrinsic conversion for language data", () => {
        let hookCalls = 0
        const record = {
            toString() {
                hookCalls++
                return "record"
            },
            valueOf() {
                hookCalls++
                return 1
            },
        }
        const nested = [2]
        nested.join = () => {
            hookCalls++
            return "nested"
        }
        class DataValue {
            toString() {
                hookCalls++
                return "data"
            }
        }
        managedStateClass(DataValue)

        expect(run(
            new Chain([nested, record, new DataValue()]),
            [],
            "join",
            ["|"],
            {},

        )).to.be("2|[object Object]|[object Object]")
        expect(run(
            new Chain(nested),
            [],
            "toString",
            [],
            {},

        )).to.be("2")
        expect(run(
            new Chain([[1]]),
            [],
            "flat",
            [record],
            {},

        )).to.eql([[1]])
        expect(run(
            new Chain([Object.create(null)]),
            [],
            "join",
            [],
            {},

        ) instanceof Error).to.be(true)
        expect(run(
            new Chain([1]),
            [],
            "join",
            [Symbol()],
            {},

        ) instanceof Error).to.be(true)

        class External {
            toString() {
                hookCalls++
                return "external"
            }
        }
        expect(run(
            new Chain([new External()]),
            [],
            "join",
            [],
            {},

        ) instanceof Error).to.be(true)
        expect(hookCalls).to.be(0)
    })

    it("matches native joining for mutually recursive Arrays", () => {
        const outer = []
        const inner = []
        outer.push(inner, 1)
        inner.push(outer, 2)
        importValue(outer, "recursive Array")

        expect(run(
            new Chain(outer),
            [],
            "toString",
            [],
            {},

        )).to.be(Array.prototype.toString.call(outer))
        expect(run(
            new Chain(outer),
            [],
            "join",
            ["|"],
            {},

        )).to.be(Array.prototype.join.call(outer, "|"))
    })

    it("requires comparator results to be Numbers", () => {
        const result = run(
            new Chain([3, 1, 2]),
            [],
            "toSorted",
            [(left, right) => ({ value: left - right })],
            {},
        )

        expect(result instanceof Error).to.be(true)
    })

    it("invokes record methods only on supported object surfaces", () => {
        const record = {}
        Object.defineProperty(record, "size", {
            enumerable: true,
            value() {
                return { value: this.value }
            },
        })
        record.value = 3
        const callable = () => 4
        Object.defineProperty(record, "getCallable", {
            enumerable: true,
            value() {
                return callable
            },
        })
        Object.defineProperty(record, "isReceiver", {
            enumerable: true,
            value() {
                return this === record
            },
        })

        const size = run(
            new Chain(record),
            [],
            "size",
            [],
            {},
        )
        expect(size).to.eql({ value: 3 })
        const sizeChain = new Chain(size)
        assignPath(sizeChain, ["value"], 4)
        expect(sizeChain._state.value).not.to.be(size)
        expect(size.value).to.be(3)
        expect(run(
            new Chain(record),
            [],
            "getCallable",
            [],
            {},

        )).to.be(callable)
        expect(run(
            new Chain(record),
            [],
            "isReceiver",
            [],
            {},

        )).to.be(true)
        expect(run(
            new Chain(new Date()),
            [],
            "getTime",
            [],
            {},

        ) instanceof Error).to.be(true)

        const callableReceiver = function callableReceiver() {}
        let invoked = false
        callableReceiver.read = () => {
            invoked = true
        }
        expect(run(
            new Chain(callableReceiver),
            [],
            "read",
            [],
            {},

        ) instanceof Error).to.be(true)
        expect(invoked).to.be(false)

        const date = new Date()
        Object.defineProperty(record, "getDate", {
            enumerable: true,
            value: () => date,
        })
        expect(run(
            new Chain(record),
            [],
            "getDate",
            [],
            {},

        )).to.be(date)
    })

    it("routes managed-class and external receivers through category dispatch", () => {
        class ManagedClassReceiver {
            read(addend) {
                return this.value + addend
            }
        }
        managedStateClass(ManagedClassReceiver)
        const managed = new ManagedClassReceiver()
        managed.value = 1

        expect(run(
            new Chain(managed),
            [],
            "read",
            [2],
            {},

        )).to.be(3)

        let invoked = false
        class ExternalReceiver {
            read() {
                invoked = true
            }
        }
        expect(run(
            new Chain(new ExternalReceiver()),
            [],
            "read",
            [],
            {},

        ) instanceof Error).to.be(true)
        expect(invoked).to.be(false)
    })

    it("leases a method receiver while exported arguments resolve", async () => {
        const argument = deferred()
        const record = { value: 1 }
        Object.defineProperty(record, "read", {
            enumerable: true,
            value(addend) {
                return this.value + addend
            },
        })
        const chain = new Chain(record)
        const result = run(
            chain,
            [],
            "read",
            [argument.promise],
            {},
        )

        assignPath(chain, ["value"], 2)
        argument.resolve(0)

        expect(await result).to.be(1)
        expect(chain._state.value.value).to.be(2)
    })

    it("releases selection leases after host export captures inputs", async () => {
        const receiver = deferred()
        const pending = deferred()
        const argument = { value: 1, pending: pending.promise }
        const argumentChain = new Chain(argument)
        const methodReceiver = {}
        Object.defineProperty(methodReceiver, "read", {
            enumerable: true,
            value(value) {
                return value.value
            },
        })

        const result = run(
            new Chain(receiver.promise),
            [],
            "read",
            [argument],
            {},
        )
        expect(metaOf(argument).readLeaseCount).to.be(1)

        receiver.resolve(methodReceiver)
        await flushMicrotasks()
        expect(metaOf(argument).readLeaseCount).to.be(undefined)

        assignPath(argumentChain, ["value"], 2)
        expect(argument.value).to.be(2)
        pending.resolve("ready")
        expect(await result).to.be(1)
    })

    it("exports aliased host arguments without leasing their source", async () => {
        const pending = deferred()
        const argument = { pending: pending.promise, value: 1 }
        const argumentChain = new Chain(argument)
        const receiver = {}
        Object.defineProperty(receiver, "read", {
            enumerable: true,
            value(first, second) {
                return {
                    aliased: first === second,
                    sum: first.value + second.value,
                }
            },
        })

        const result = run(
            new Chain(receiver),
            [],
            "read",
            [
                argument,
                argument,
            ],
            {},
        )
        expect(metaOf(argument).readLeaseCount).to.be(undefined)

        assignPath(argumentChain, ["value"], 2)
        pending.resolve("ready")

        expect(await result).to.eql({ aliased: true, sum: 2 })
        expect(argument.value).to.be(2)
        expect(argumentChain._state.value.value).to.be(2)
        expect(metaOf(argument).readLeaseCount).to.be(undefined)
    })

    it("preserves topology shared across host argument roots", async () => {
        const pending = deferred()
        const shared = { value: 1 }
        const first = { pending: pending.promise }
        const second = { direct: shared, first }
        first.second = second
        let received
        const receiver = {}
        Object.defineProperty(receiver, "inspect", {
            enumerable: true,
            value(...values) {
                received = values
                return true
            },
        })

        const result = run(
            new Chain(receiver),
            [],
            "inspect",
            [
                first,
                second,
            ],
            {},
        )
        pending.resolve(shared)

        expect(await result).to.be(true)
        expect(received[0]).not.to.be(first)
        expect(received[0].second).to.be(received[1])
        expect(received[1].first).to.be(received[0])
        expect(received[0].pending).to.be(received[1].direct)
        expect(received[0].pending).not.to.be(shared)
    })

    it("keeps exported arguments independent through a host result Promise", async () => {
        const completion = deferred()
        const argument = { value: 1 }
        const argumentChain = new Chain(argument)
        let received
        const receiver = {}
        Object.defineProperty(receiver, "read", {
            enumerable: true,
            value(value) {
                received = value
                return completion.promise.then(() => value.value)
            },
        })

        const result = run(
            new Chain(receiver),
            [],
            "read",
            [argument],
            {},
        )

        expect(received).not.to.be(argument)
        expect(metaOf(argument).readLeaseCount).to.be(undefined)
        assignPath(argumentChain, ["value"], 2)
        completion.resolve()

        expect(await result).to.be(1)
        expect(argument.value).to.be(2)
        expect(metaOf(argument).readLeaseCount).to.be(undefined)
    })

    it("preserves admitted prototypes in host arguments", () => {
        let constructions = 0
        class Point {
            constructor(value) {
                constructions++
                this.value = value
            }

            read() {
                return this.value
            }
        }
        managedStateClass(Point)
        const point = new Point(3)
        constructions = 0
        let received
        const receiver = {}
        Object.defineProperty(receiver, "inspect", {
            enumerable: true,
            value(value) {
                received = value
                return value.read()
            },
        })

        expect(run(
            new Chain(receiver),
            [],
            "inspect",
            [point],
            {},

        )).to.be(3)
        expect(received).not.to.be(point)
        expect(Object.getPrototypeOf(received)).to.be(Point.prototype)
        expect(constructions).to.be(0)
        expect(metaOf(received)).to.be(undefined)
    })

    it("leaves no source lease while completing Error collection", async () => {
        const pending = deferred()
        const retained = { pending: pending.promise }
        const failure = new Error("argument reflection failed")
        const broken = new Proxy({}, {
            ownKeys() {
                throw failure
            },
        })
        const receiver = {}
        Object.defineProperty(receiver, "read", {
            enumerable: true,
            value() {},
        })

        const result = run(
            new Chain(receiver),
            [],
            "read",
            [{ retained, broken }],
            {},
        )
        expect(result instanceof Promise).to.be(true)
        expect(metaOf(retained).readLeaseCount).to.be(undefined)

        pending.resolve("done")
        expect(errorCause(await result)).to.be(failure)
    })

    it("continues Error collection after preparation fails", async () => {
        const pending = deferred()
        const failure = new Error("argument reflection failed")
        let reflected = false
        const broken = new Proxy({}, {
            ownKeys() {
                throw failure
            },
        })
        const receiver = {}
        Object.defineProperty(receiver, "read", { value() {} })

        const result = run(
            new Chain(receiver),
            [],
            "read",
            [{ pending: pending.promise, broken }],
            {},
        )
        expect(result instanceof Promise).to.be(true)

        const late = new Proxy({}, {
            ownKeys() {
                reflected = true
                return []
            },
        })
        pending.resolve(late)
        expect(errorCause(await result)).to.be(failure)

        expect(reflected).to.be(true)
        expect(metaOf(late).readLeaseCount).to.be(undefined)
    })

    it("does not admit a top-level input after fatal export closure", async () => {
        const pending = deferred()
        const failure = new Error("fatal argument preparation")
        const broken = {
            then() {
                reportFatalError(failure)
            },
        }
        const receiver = {}
        Object.defineProperty(receiver, "read", { value() {} })

        expect(errorCause(thrownBy(() => run(
            new Chain(receiver),
            [],
            "read",
            [
                pending.promise,
                broken,
            ],
            {},

        )))).to.be(failure)

        let reflected = false
        const late = new Proxy({}, {
            getPrototypeOf(target) {
                reflected = true
                return Reflect.getPrototypeOf(target)
            },
        })
        pending.resolve(late)
        await flushMicrotasks()

        expect(reflected).to.be(false)
        expect(metaOf(late)).to.be(undefined)
    })

    it("abandons late concat work after fatal preparation failure", async () => {
        const pending = deferred()
        const failure = new Error("concat preparation failed")
        const broken = {
            then() {
                reportFatalError(failure)
            },
        }

        expect(errorCause(thrownBy(() => run(
            new Chain([]),
            [],
            "concat",
            [
                pending.promise,
                broken,
            ],
            {},

        )))).to.be(failure)

        let reflected = false
        const late = new Proxy([1], {
            ownKeys(target) {
                reflected = true
                return Reflect.ownKeys(target)
            },
        })
        pending.resolve(late)
        await flushMicrotasks()

        expect(reflected).to.be(false)
        expect(metaOf(late)).to.be(undefined)
    })

    it("abandons late recursive flat work after fatal failure", async () => {
        const late = deferred()
        const failing = deferred()
        const failure = new Error("recursive flat preparation failed")
        const result = run(
            new Chain([late.promise, failing.promise]),
            [],
            "flat",
            [],
            {},
        )

        failing.resolve(new Proxy([1], {
            ownKeys() {
                reportFatalError(failure)
            },
        }))
        expect(errorCause(await result.catch(error => error))).to.be(failure)

        let reflected = false
        const lateArray = new Proxy([2], {
            ownKeys(target) {
                reflected = true
                return Reflect.ownKeys(target)
            },
        })
        late.resolve(lateArray)
        await flushMicrotasks()

        expect(reflected).to.be(false)
    })

    it("balances nested entry and method-argument read leases", async () => {
        const argument = deferred()
        const record = { value: 1 }
        Object.defineProperty(record, "read", {
            enumerable: true,
            value(addend) {
                return this.value + addend
            },
        })

        const result = enter(new Chain(record), [], false, entered => {
            const observed = run(
                entered,
                [],
                "read",
                [argument.promise],
                {},
            )
            expect(metaOf(record).readLeaseCount).to.be(2)
            return observed
        })

        argument.resolve(2)
        expect(await result).to.be(3)
        expect(metaOf(record).readLeaseCount).to.be(undefined)
    })

    it("installs an Error for a missing mutation receiver", () => {
        const root = {}
        const chain = new Chain(root)

        const result = run(chain, ["missing"], "push", [1], { mutationScopeDepth: 1 })

        expect(result instanceof Error).to.be(true)
        expect(root.missing).to.be(result)
        expect(Object.keys(root)).to.eql(["missing"])
    })

    it("uses only controlled Array methods", () => {
        const source = [1, 2]
        Object.defineProperty(source, "map", {
            enumerable: false,
            value() {
                return this.join("-")
            },
        })
        const view = run(new Chain(source), [], "push", [3], {})

        const overridden = run(
            new Chain(view),
            [],
            "map",
            [],
            {},
        )
        expect(overridden instanceof Error).to.be(true)
        expect(run(
            new Chain([1, 2]),
            [],
            "map",
            [value => value],
            {},

        ) instanceof Error).to.be(true)
    })

    it("does not inspect unsupported Array method properties", () => {
        const failure = new Error("broken method")
        const source = []
        Object.defineProperty(source, "broken", {
            value: failure,
            configurable: true,
        })

        const result = run(new Chain(source), [], "broken", [], {})
        expect(result instanceof Error).to.be(true)
        expect(result).not.to.be(failure)
    })

    it("returns a validation Error for intrinsic length receivers", () => {
        for (const receiver of ["abc", [1, 2]]) {
            const root = { target: receiver }
            const chain = new Chain(root)
            const length = receiver.length

            const result = run(chain, ["target", "length"], "push", [1], { mutationScopeDepth: 2 })

            expect(result instanceof Error).to.be(true)
            expect(root.target).to.be(result)
            expect(receiver.length).to.be(length)
        }
    })

    it("isolates one Promise payload reaching several placements", async () => {
        const cases = [
            { method: "push", source: [], args: promise => [promise, promise] },
            {
                method: "unshift",
                source: [],
                args: promise => [promise, promise],
            },
            {
                method: "splice",
                source: [],
                args: promise => [0, 0, promise, promise],
            },
            { method: "fill", source: [0, 0], args: promise => [promise] },
        ]
        for (const { method, source, args } of cases) {
            const payload = { answer: 1 }
            const chain = new Chain(source)

            run(chain, [], method, [...args(Promise.resolve(payload))], { mutationScopeDepth: 0 })
            await flushMicrotasks()
            assignPath(chain, ["0", "answer"], 2)
            await flushMicrotasks()

            const exported = await exportValue(chain, [])
            expect(exported[0].answer).to.be(2)
            expect(exported[1].answer).to.be(1)
            expect(payload.answer).to.be(1)
            verifyRefCounts(chain._state.value)
        }
    })

    it("reports a bookkeeping failure during replay fatally", () => {
        const element = { value: 1 }
        const chain = new Chain([element, 2])
        hasError(chain, [])
        // Corrupt downward closure: the element is still reachable from an
        // indexed owner but no longer carries its own counter.
        delete metaOf(element).parents
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })

        const failure = thrownBy(() => run(chain, [], "reverse", [], { mutationScopeDepth: 0 }))

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Ref counts require a ref-indexed value")
        expect(reported).to.be(failure)
    })

    it("rejects synchronous Cascada reentry from supported user code", () => {
        const observed = new Chain({ value: 1 })
        const cases = [
            () => {
                const receiver = {}
                Object.defineProperty(receiver, "reenter", {
                    enumerable: true,
                    value() {
                        readPath(observed, [])
                    },
                })
                return run(new Chain(receiver), [], "reenter", [], {})
            },
            () => run(
                new Chain([2, 1]),
                [],
                "sort",
                [() => readPath(observed, [])],
                { mutationScopeDepth: 0 },

            ),
            () => lookupPath(new Chain(new Proxy({}, {
                getOwnPropertyDescriptor() {
                    readPath(observed, [])
                },
            })), ["value"]),
        ]

        for (const invoke of cases) {
            let reported
            setFatalErrorReporter(error => {
                reported = error
            })
            const failure = thrownBy(invoke)

            expect(failure instanceof Error).to.be(true)
            expect(failure.message).to.be(
                "Cascada cannot be re-entered from supported user code",
            )
            expect(reported).to.be(failure)
        }
        setFatalErrorReporter()
    })

    it("poisons Array mutation when preparation reflection fails", () => {
        const failure = new Error("Array metadata reflection failed")
        const receiver = new Proxy([1, 2], {
            getOwnPropertyDescriptor(target, key) {
                if (key === "0") throw failure
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const chain = new Chain(receiver)

        const result = run(chain, [], "reverse", [], { mutationScopeDepth: 0 })
        expect(errorCause(result)).to.be(failure)
        expect(chain._state.value).to.be(result)
        expect([...receiver]).to.eql([1, 2])
    })

    it("poisons Array mutation when physical replay fails", () => {
        const cases = [
            {
                method: "reverse",
                handler: failure => ({
                    set(target, key, value, receiver) {
                        if (key === "0") throw failure
                        return Reflect.set(target, key, value, receiver)
                    },
                }),
            },
            {
                method: "pop",
                handler: failure => ({
                    deleteProperty() {
                        throw failure
                    },
                }),
            },
            {
                method: "pop",
                source: [1, new Error("removed")],
                handler: failure => ({
                    set(target, key, value, receiver) {
                        if (key === "length") throw failure
                        return Reflect.set(target, key, value, receiver)
                    },
                }),
            },
        ]

        for (const { method, source = [1, 2], handler } of cases) {
            const failure = new Error(`${method} replay failed`)
            const receiver = new Proxy(source, handler(failure))
            const chain = new Chain(receiver)
            buildRefIndex(receiver)

            const result = run(chain, [], method, [], { mutationScopeDepth: 0 })

            expect(errorCause(result)).to.be(failure)
            expect(chain._state.value).to.be(result)
            verifyRefCounts(receiver)
        }
    })

    it("poisons Array mutation when a comparator throws", () => {
        const failure = new Error("comparison failed")
        const source = [2, 1]
        const chain = new Chain(source)

        const result = run(chain, [], "sort", [
            () => {
            throw failure
        },
        ],
        { mutationScopeDepth: 0 },
        )

        expect(errorCause(result)).to.be(failure)
        expect(chain._state.value).to.be(result)
        expect(source).to.eql([2, 1])
    })

    it("returns a delayed comparator throw after poisoning mutation", async () => {
        const comparator = deferred()
        const failure = new Error("delayed comparison failed")
        const source = [2, 1]
        const chain = new Chain(source)

        const result = run(
            chain,
            [],
            "sort",
            [comparator.promise],
            { mutationScopeDepth: 0 },
        )
        comparator.resolve(() => {
            throw failure
        })

        const outcome = await result
        expect(errorCause(outcome)).to.be(failure)
        expect(chain._state.value).to.be(outcome)
        expect(source).to.eql([2, 1])
    })

    it("reports an unlimited flat of an Array cycle as a language Error", () => {
        const cyclic = [1]
        cyclic.push(cyclic)
        importValue(cyclic)
        const chain = new Chain({ items: cyclic })

        const unlimited = run(chain, ["items"], "flat", [Infinity], {})
        const bounded = run(chain, ["items"], "flat", [2], {})

        expect(unlimited.message).to.be(
            "Cannot flat an Array cycle to unlimited depth",
        )
        expect(bounded instanceof Error).to.be(false)
        expect(bounded.length).to.be(4)
        expect(bounded.slice(0, 3)).to.eql([1, 1, 1])
        expect(bounded[3]).to.be(cyclic)
    })

    it("does not invoke inherited numeric setters while building remaps", () => {
        const descriptor = Object.getOwnPropertyDescriptor(
            Array.prototype,
            "5",
        )
        const observedSource = [0, 1, 2, 3, 4, 5, 6]
        const mutatedSource = [0, 1, 2, 3, 4, 5, 6]
        let observed
        let mutationResult
        try {
            Object.defineProperty(Array.prototype, "5", {
                configurable: true,
                set() {
                    throw new Error("Inherited numeric setter was invoked")
                },
            })
            observed = run(
                new Chain(observedSource),
                [],
                "reverse",
                [],
                {},
            )
            mutationResult = run(
                new Chain(mutatedSource),
                [],
                "reverse",
                [],
                { mutationScopeDepth: 0 },
            )
        } finally {
            if (descriptor) {
                Object.defineProperty(Array.prototype, "5", descriptor)
            } else {
                delete Array.prototype[5]
            }
        }

        expect(mutationResult instanceof Error).to.be(false)
        expect([...observed]).to.eql([6, 5, 4, 3, 2, 1, 0])
        expect(mutatedSource).to.eql([6, 5, 4, 3, 2, 1, 0])
    })

    it("materializes a view before an ordinary indexed write", () => {
        const sourceChain = new Chain([1, 2])
        const view = run(sourceChain, [], "push", [3], {})
        const viewChain = new Chain(view)

        assignPath(viewChain, ["0"], 9)
        expect(exportValue(sourceChain, [])).to.eql([1, 2])
        expect(exportValue(viewChain, [])).to.eql([9, 2, 3])
        verifyRefCounts(viewChain._state.value)
    })
})
