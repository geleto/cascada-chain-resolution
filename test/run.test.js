import { runInNewContext } from "node:vm"

import * as propertyVersions from "../src/property-versions.js"
import * as arrayViews from "../src/array-view.js"
import {
    Chain,
    assignPath,
    countPromiseRegistrations,
    deferred,
    enter,
    expect,
    exportValue,
    flushMicrotasks,
    getRefCounter,
    hasError,
    importValue,
    lookupPath,
    metaOf,
    registerDataClass,
    run,
    setFatalErrorReporter,
    thrownBy,
    verifyRefCounts,
} from "./support.js"

describe("run", () => {
    it("validates mutation calls before walking", () => {
        const chain = new Chain([1])

        expect(run(chain, [], "map", true) instanceof Error).to.be(true)
        expect(run(chain, [], "constructor", false) instanceof Error).to.be(true)
        expect(run(chain, [], "push", "yes") instanceof Error).to.be(true)
        expect(chain._state.value).to.eql([1])
    })

    it("resolves arguments while leaving coercion native", async () => {
        const scalar = function scalar() {}
        expect(run(
            new Chain("ab"),
            [],
            "concat",
            false,
            scalar,
        )).to.be(String.prototype.concat.call("ab", scalar))
        expect(run(
            new Chain([1, 2]),
            [],
            "slice",
            false,
            scalar,
        )).to.eql(Array.prototype.slice.call([1, 2], scalar))

        const argument = deferred()
        const limit = deferred()
        const chain = new Chain("ab")
        const result = run(chain, [], "concat", false, argument.promise)
        const split = run(
            new Chain("ab"),
            [],
            "split",
            false,
            "",
            limit.promise,
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
            enumerable: false,
            value(value) {
                received = value
                return value.nested
            },
        })

        const ordinary = run(
            new Chain(target),
            [],
            "read",
            false,
            argument,
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
            false,
            { ready: indexReady.promise },
        )
        expect(indexed instanceof Promise).to.be(true)
        indexReady.resolve(true)
        expect(await indexed).to.be(1)

        const retainedReady = deferred()
        const retained = { ready: retainedReady.promise }
        const pushed = run(
            new Chain([]),
            [],
            "push",
            false,
            retained,
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
            enumerable: false,
            value(value) {
                return value.answer
            },
        })

        const observed = run(
            new Chain(target),
            [],
            "read",
            false,
            argument,
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
            false,
            item,
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
            false,
            "a",
            replacement.promise,
        )

        replacement.resolve(() => "x")

        expect(await replacementResult).to.be("xbc")

        const parts = run(
            new Chain("a,b"),
            [],
            "split",
            false,
            ",",
        )
        const partsChain = new Chain(parts)
        run(partsChain, [], "push", true, "c")

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
            false,
            new Matcher(),
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
            false,
            matcher,
        )
        const resultChain = new Chain(result)
        assignPath(resultChain, ["0"], "changed")

        expect(result).to.be(external)
        expect(external).to.eql(["a"])
        expect(resultChain._state.value).to.eql(["changed"])
        expect(resultChain._state.value).not.to.be(external)
    })

    it("uses normal property access for ordinary methods", () => {
        const source = { value: 2 }
        const failure = new Error("lookup failed")
        Object.defineProperty(source, "read", {
            get() {
                return function read() {
                    return this.value
                }
            },
        })
        Object.defineProperty(source, "fail", {
            get() {
                throw failure
            },
        })

        expect(run(new Chain(source), [], "read", false)).to.be(2)
        expect(run(new Chain(source), [], "fail", false)).to.be(failure)
    })

    it("exposes physical Promise writeback to ordinary methods", async () => {
        const runtimePending = deferred()
        const runtimeOwned = { pending: runtimePending.promise }
        Object.defineProperty(runtimeOwned, "stillPending", {
            value() {
                return this.pending === runtimePending.promise
            },
        })
        lookupPath(new Chain(runtimeOwned), ["pending"], false)

        const importedPending = deferred()
        const imported = { pending: importedPending.promise }
        Object.defineProperty(imported, "stillPending", {
            value() {
                return this.pending === importedPending.promise
            },
        })
        importValue(imported, "ordinary receiver")

        runtimePending.resolve("runtime")
        importedPending.resolve("imported")
        await flushMicrotasks()

        expect(run(new Chain(runtimeOwned), [], "stillPending", false)).to.be(
            false,
        )
        expect(run(new Chain(imported), [], "stillPending", false)).to.be(true)
    })

    it("imports an ordinary method result that aliases its receiver", async () => {
        const pending = deferred()
        const root = { pending: pending.promise }
        const languageKeys = Reflect.ownKeys(root)
        const earlierRead = lookupPath(new Chain(root), ["pending"], false)

        const result = run(new Chain(root), [], "valueOf", false)

        expect(result).to.be(root)
        expect(Reflect.ownKeys(root)).to.eql(languageKeys)
        expect(metaOf(root).importBoundary).not.to.be(undefined)

        const resolved = { done: true }
        pending.resolve(resolved)
        expect(await earlierRead).to.be(resolved)
        await flushMicrotasks()

        expect(root.pending).to.be(pending.promise)
        expect(lookupPath(new Chain(root), ["pending"], false)).to.be(resolved)
    })

    it("preserves holes and identities in Array observers", () => {
        const child = {}
        const source = [child, , 3]
        const chain = new Chain(source)
        const sliced = run(chain, [], "slice", false, 0)
        const reversed = run(chain, [], "toReversed", false)

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
            false,
            0,
            sliceEnd.promise,
        )
        const copiedChain = new Chain([1, 2, 3])
        const copied = run(
            copiedChain,
            [],
            "copyWithin",
            true,
            1,
            0,
            copyEnd.promise,
        )
        const flattened = run(
            new Chain([[1], [2]]),
            [],
            "flat",
            false,
            flatDepth.promise,
        )
        const joined = run(
            new Chain([1, 2]),
            [],
            "join",
            false,
            separator.promise,
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

        const result = run(new Chain(source), [], "slice", false)

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
            false,
            1,
            -1,
        )

        expect(arrayViews.isArrayView(sliced)).to.be(true)
        expect(arrayViews.backingOf(sliced)).to.be(source)
        expect([...sliced]).to.eql([1, 2, 3])

        const changed = new Chain(sliced)
        run(changed, [], "push", true, 5)
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
        const sliced = run(new Chain(values), [], "slice", false, 0, 2)
        expect(values[0]).to.be(imported)
        expect(lookupPath(new Chain(sliced), ["0"], false)).to.be(imported)
    })

    it("appends concat items to the receiver backing", () => {
        const left = [1, , 3]
        const right = [, 5]
        const concatenated = run(
            new Chain(left),
            [],
            "concat",
            false,
            right,
            6,
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
            false,
            self,
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

    it("gives concatenated Promise properties independent mirrors", async () => {
        const pending = deferred()
        const leftChain = new Chain([pending.promise])
        const right = [pending.promise]
        const concatenated = run(
            leftChain,
            [],
            "concat",
            false,
            right,
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
            false,
            0,
            2,
        )
        const sliced = run(
            new Chain(slicedSource),
            [],
            "slice",
            false,
            1,
        )
        const concatenated = run(
            new Chain(concatSource),
            [],
            "concat",
            false,
            [3],
        )
        const middleConcat = run(
            new Chain(middle),
            [],
            "concat",
            false,
            [4],
        )
        const nestedSlice = run(
            new Chain(nestedSource),
            ["values"],
            "slice",
            false,
            1,
        )

        expect(Array.isArray(sliced)).to.be(true)
        expect(Array.isArray(concatenated)).to.be(true)
        expect(Array.isArray(middleConcat)).to.be(true)
        expect(metaOf(nestedSource.values).importBoundary).not.to.be(undefined)
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
        const copy = run(chain, [], "slice", false)

        assignPath(chain, ["0"], 9)
        pending.resolve(1)

        expect(await exportValue(new Chain(copy), [])).to.eql([1])
        expect(exportValue(chain, [])).to.eql([9])
        verifyRefCounts(copy)
        verifyRefCounts(chain._state.value)
    })

    it("tracks duplicate Promise origins by index during remapping", async () => {
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
        run(chain, [], "reverse", true)

        const reversed = chain._state.value
        const reversed0 = propertyVersions.getPromiseMirror(reversed, "0")
        const reversed1 = propertyVersions.getPromiseMirror(reversed, "1")
        expect(reversed0 === reversed1).to.be(false)
        expect(reversed0 === source1).to.be(false)
        expect(reversed1 === source0).to.be(false)

        const copied = new Chain([pending.promise, 0])
        run(copied, [], "copyWithin", true, 1, 0, 1)
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

    it("retains Error values nested in Array and object data", async () => {
        const direct = new Error("direct")
        const nested = deferred()
        const flat = run(new Chain([direct]), [], "flat", false)
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
            false,
            argument,
        )

        expect(flat).to.eql([direct])
        expect(inspected instanceof Promise).to.be(true)
        nested.reject(direct)
        expect(await inspected).to.be(true)
        expect(received).not.to.be(argument)
        expect(received.error).to.be(direct)
    })

    it("applies Error poisoning to every resolved argument", async () => {
        const direct = new Error("direct")
        const rejected = new Error("rejected")
        const pending = deferred()
        const concatItem = deferred()

        expect(run(
            new Chain("abc"),
            [],
            "slice",
            false,
            direct,
        )).to.be(direct)
        expect(run(
            new Chain([1]),
            [],
            "with",
            false,
            direct,
            2,
        )).to.be(direct)

        const pushed = run(
            new Chain([1]),
            [],
            "push",
            false,
            direct,
        )
        expect(pushed).to.be(direct)
        expect(run(
            new Chain([direct]),
            [],
            "includes",
            false,
            direct,
        )).to.be(direct)

        const concatenated = run(
            new Chain([]),
            [],
            "concat",
            false,
            concatItem.promise,
        )
        concatItem.reject(rejected)
        expect(await concatenated).to.be(rejected)

        const delayed = run(
            new Chain([1]),
            [],
            "slice",
            false,
            pending.promise,
        )
        pending.reject(rejected)
        expect(await delayed).to.be(rejected)

        const mutation = new Chain([1, 2])
        expect(run(
            mutation,
            [],
            "copyWithin",
            true,
            direct,
        )).to.be(direct)
        expect(exportValue(mutation, [])).to.eql([1, 2])
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

        const result = run(chain, [], "flat", false, 1)

        expect(firstCount() > initial[0]).to.be(true)
        expect(secondCount() > initial[1]).to.be(true)
        first.resolve([1])
        second.resolve(2)

        const flattened = await result
        expect(flattened.slice(0, 2)).to.eql([1, 2])
        expect(flattened[2]).to.be(retained.promise)
        retained.resolve(3)
    })

    it("does not write length for same-length mutators", () => {
        const root = [3, 1, 2]
        Object.defineProperty(root, "length", { writable: false })
        const chain = new Chain(root)

        expect(run(chain, [], "reverse", true)).to.be(root)
        expect(root).to.eql([2, 1, 3])
    })

    it("accounts for completed placements after a partial mutation error", () => {
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
            true,
            inserted,
        )

        expect(result instanceof Error).to.be(true)
        expect(root).to.eql([inserted, 2])
        const chain = new Chain(root)
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

            run(chain, [], method, true, ...args(value))
            assignPath(chain, [String(index), "answer"], 2)

            expect(value).to.eql({ answer: 1 })
            expect(chain._state.value[index]).to.eql({ answer: 2 })
            verifyRefCounts(chain._state.value)
        }
    })

    it("transfers wholly removed splice elements from an owned receiver", () => {
        const removedValue = { value: 1 }
        const chain = new Chain([removedValue, 2])

        const removed = run(chain, [], "splice", true, 0, 1)

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

        const removed = run(chain, [], "splice", true, 0, 1)
        assignPath(new Chain(removed), ["0", "value"], 3)

        expect(source[0]).to.be(removedValue)
        expect(removedValue.value).to.be(1)
        expect(removed[0]).to.eql({ value: 3 })
        expect(chain._state.value).to.eql([2])
    })

    it("returns transformed Arrays from mutators in observation mode", () => {
        const source = [1, 2]
        const chain = new Chain(source)
        const result = run(chain, [], "push", false, 3)
        const cleared = run(new Chain([1]), [], "fill", false)
        const spliced = run(new Chain([1, 2, 3]), [], "splice", false, 1, 1, 9)

        expect([...result]).to.eql([1, 2, 3])
        expect(cleared).to.eql([undefined])
        expect(spliced).to.eql([1, 9, 3])
        expect(exportValue(chain, [])).to.eql([1, 2])
    })

    it("selects observation-mode mutators by intrinsic name", () => {
        const source = [1]
        source.push = 0
        const chain = new Chain(source)

        const result = run(chain, [], "push", false, 2)
        const original = exportValue(chain, [])

        expect([...result]).to.eql([1, 2])
        expect([...original]).to.eql([1])
        expect(Object.hasOwn(original, "push")).to.be(false)
    })

    it("rejects executable concat protocols", () => {
        const source = [1]
        const chain = new Chain(source)

        const spread = { [Symbol.isConcatSpreadable]: true, 0: 2, length: 1 }
        expect(run(
            chain,
            [],
            "concat",
            false,
            spread,
        ) instanceof Error).to.be(true)
    })

    it("keeps every earlier endpoint view stable across prepends", () => {
        const sourceChain = new Chain([2, 3])
        const first = run(sourceChain, [], "unshift", false, 1)
        const second = run(new Chain(first), [], "unshift", false, 0)

        expect([...second]).to.eql([0, 1, 2, 3])
        expect([...first]).to.eql([1, 2, 3])
        expect(exportValue(sourceChain, [])).to.eql([2, 3])
    })

    it("materializes when an endpoint no longer reaches a physical edge", () => {
        const sourceChain = new Chain([1, 2, 3])
        const shorter = run(sourceChain, [], "pop", false)
        const extended = run(new Chain(shorter), [], "push", false, 4)

        expect(Array.isArray(extended)).to.be(true)
        expect(extended).to.eql([1, 2, 4])
        expect([...shorter]).to.eql([1, 2])
        expect(exportValue(sourceChain, [])).to.eql([1, 2, 3])
    })

    it("mutates an owned Array synchronously", () => {
        const source = [1, 2]
        const chain = new Chain(source)

        expect(run(chain, [], "push", true, 3)).to.be(3)
        expect(chain._state.value).to.be(source)
        expect(source).to.eql([1, 2, 3])
    })

    it("keeps observation results lazily ref-indexed", () => {
        const result = run(new Chain([{ value: 1 }]), [], "slice", false)

        expect(getRefCounter(result)).to.be(undefined)
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

            const result = run(chain, [], method, true, ...args)

            expect(source).to.eql([cyclic, other])
            expect(cyclic.self).to.be(cyclic)
            expect(result instanceof Error).to.be(false)
            verifyRefCounts(source, chain._state.value, result)
        }
    })

    it("does not scan unused sparse indexes while remapping", () => {
        const length = 10000
        const cases = [
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
                new Chain(source), [], method, mutate, ...args,
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

        expect(run(chain, ["left"], "push", true, 3)).to.be(3)
        expect(exportValue(chain, [])).to.eql({
            left: [1, 2, 3],
            right: [1, 2],
        })
    })

    it("never uses imported nested Arrays as mutable backing", () => {
        const external = { values: [1, 2] }
        importValue(external)
        const chain = new Chain(external)

        expect(run(chain, ["values"], "push", true, 3)).to.be(3)
        expect(external.values).to.eql([1, 2])
        expect(exportValue(chain, [])).to.eql({
            values: [1, 2, 3],
        })
    })

    it("keeps independently rooted imported Arrays materialized", () => {
        const values = [1, 2, 3]
        importValue({ values })

        const result = run(new Chain(values), [], "slice", false, 1)

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
            true,
            start.promise,
            1,
            9,
        )

        expect(chain._state.value instanceof Promise).to.be(true)
        expect(result instanceof Promise).to.be(true)
        start.resolve(1)
        expect(await result).to.eql([2])
        expect(await exportValue(chain, [])).to.eql([1, 9, 3])
    })

    it("prepares a pending mutation receiver and argument together", async () => {
        const receiver = deferred()
        const start = deferred()
        const receiverCount = countPromiseRegistrations(receiver.promise)
        const startCount = countPromiseRegistrations(start.promise)
        const chain = new Chain(receiver.promise)
        const initialReceiverCount = receiverCount()
        const initialStartCount = startCount()

        const result = run(chain, [], "splice", true, start.promise, 1)

        expect(receiverCount() > initialReceiverCount).to.be(true)
        expect(startCount() > initialStartCount).to.be(true)
        expect(chain._state.value instanceof Promise).to.be(true)

        receiver.resolve([1, 2])
        start.resolve(0)
        expect(await result).to.eql([1])
        expect(await exportValue(chain, [])).to.eql([2])
    })

    it("transforms the FIFO property version of a pending receiver", async () => {
        const receiver = deferred()
        const source = [1]
        const chain = new Chain(receiver.promise)
        const escaped = lookupPath(chain, [])

        assignPath(chain, ["0"], 9)
        const result = run(chain, [], "push", true, 2)

        receiver.resolve(source)
        expect(await escaped).to.be(source)
        expect(await result).to.be(2)
        expect(source).to.eql([1])
        expect(await exportValue(chain, [])).to.eql([9, 2])
    })

    it("publishes a delayed receiver before its independent result", async () => {
        const start = deferred()
        const chain = new Chain([1, 2, 3])
        const result = run(chain, [], "splice", true, start.promise, 1)
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
            true,
            start.promise,
            1,
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

        expect(run(chain, [], "push", true, item.promise)).to.be(2)
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
        const result = run(chain, [], "pop", true)

        expect(chain._state.value instanceof Promise).to.be(false)
        expect(result instanceof Promise).to.be(true)
        expect(exportValue(chain, [])).to.eql([1])
        removed.resolve(7)
        expect(await result).to.be(7)
    })

    it("searches Promise elements with method-specific early stopping", async () => {
        const first = deferred()
        const later = deferred()
        const chain = new Chain([first.promise, 2, later.promise])

        const index = run(chain, [], "indexOf", false, 2)
        expect(run(chain, [], "includes", false, 2)).to.be(true)
        first.resolve(1)
        expect(await index).to.be(1)
        later.resolve(3)
    })

    it("does not register Promise elements beyond an indexOf match", async () => {
        const first = deferred()
        const later = deferred()
        const firstCount = countPromiseRegistrations(first.promise)
        const laterCount = countPromiseRegistrations(later.promise)
        const chain = new Chain([first.promise, 2, later.promise])
        const initialFirst = firstCount()
        const initialLater = laterCount()

        const result = run(chain, [], "indexOf", false, 2)

        expect(firstCount() > initialFirst).to.be(true)
        expect(laterCount()).to.be(initialLater)
        first.resolve(1)
        expect(await result).to.be(1)
        expect(laterCount()).to.be(initialLater)
        later.resolve(3)
    })

    it("preserves sort holes while toSorted reads through them", () => {
        const source = [3, , 1, undefined]
        const sorted = run(new Chain(source), [], "sort", false)
        const copied = run(new Chain(source), [], "toSorted", false)

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
            true,
            comparator.promise,
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

        const result = run(chain, [], "sort", true)

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
            true,
            () => comparison.promise,
        )

        expect(result instanceof Error).to.be(true)
        expect(registrations()).to.be(0)
        expect(chain._state.value).to.be(values)
        expect(values).to.eql([2, 1])
        comparison.resolve(0)
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
        registerDataClass(DataValue)

        expect(run(
            new Chain([nested, record, new DataValue()]),
            [],
            "join",
            false,
            "|",
        )).to.be("2|[object Object]|[object Object]")
        expect(run(
            new Chain(nested),
            [],
            "toString",
            false,
        )).to.be("2")
        expect(run(
            new Chain([[1]]),
            [],
            "flat",
            false,
            record,
        )).to.eql([[1]])
        expect(run(
            new Chain([Object.create(null)]),
            [],
            "join",
            false,
        ) instanceof Error).to.be(true)
        expect(run(
            new Chain([1]),
            [],
            "join",
            false,
            Symbol(),
        ) instanceof Error).to.be(true)

        class Opaque {
            toString() {
                hookCalls++
                return "opaque"
            }
        }
        expect(run(
            new Chain([new Opaque()]),
            [],
            "join",
            false,
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
            false,
        )).to.be(Array.prototype.toString.call(outer))
        expect(run(
            new Chain(outer),
            [],
            "join",
            false,
            "|",
        )).to.be(Array.prototype.join.call(outer, "|"))
    })

    it("leaves comparator result coercion to native sort", () => {
        let coercions = 0
        const result = run(
            new Chain([3, 1, 2]),
            [],
            "toSorted",
            false,
            (left, right) => ({
                valueOf() {
                    coercions++
                    return left - right
                },
            }),
        )

        expect(result).to.eql([1, 2, 3])
        expect(coercions > 0).to.be(true)
    })

    it("invokes ordinary methods only on supported object surfaces", () => {
        const record = {}
        Object.defineProperty(record, "size", {
            enumerable: false,
            value() {
                return { value: this.value }
            },
        })
        record.value = 3
        const callable = () => 4
        Object.defineProperty(record, "getCallable", {
            enumerable: false,
            value() {
                return callable
            },
        })
        Object.defineProperty(record, "isReceiver", {
            enumerable: false,
            value() {
                return this === record
            },
        })

        const size = run(
            new Chain(record),
            [],
            "size",
            false,
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
            false,
        )).to.be(callable)
        expect(run(
            new Chain(record),
            [],
            "isReceiver",
            false,
        )).to.be(true)
        expect(run(
            new Chain(new Date()),
            [],
            "getTime",
            false,
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
            false,
        ) instanceof Error).to.be(true)
        expect(invoked).to.be(false)

        const date = new Date()
        Object.defineProperty(record, "getDate", {
            enumerable: false,
            value: () => date,
        })
        expect(run(
            new Chain(record),
            [],
            "getDate",
            false,
        )).to.be(date)
    })

    it("leases a method receiver while exported arguments resolve", async () => {
        const argument = deferred()
        const record = { value: 1 }
        Object.defineProperty(record, "read", {
            enumerable: false,
            value(addend) {
                return this.value + addend
            },
        })
        const chain = new Chain(record)
        const result = run(
            chain,
            [],
            "read",
            false,
            argument.promise,
        )

        assignPath(chain, ["value"], 2)
        argument.resolve(0)

        expect(await result).to.be(1)
        expect(chain._state.value.value).to.be(2)
    })

    it("balances nested entry and method-argument read leases", async () => {
        const argument = deferred()
        const record = { value: 1 }
        Object.defineProperty(record, "read", {
            enumerable: false,
            value(addend) {
                return this.value + addend
            },
        })

        const result = enter(new Chain(record), [], false, entered => {
            const observed = run(
                entered,
                [],
                "read",
                false,
                argument.promise,
            )
            expect(metaOf(record).readEnterCount).to.be(2)
            return observed
        })

        argument.resolve(2)
        expect(await result).to.be(3)
        expect(metaOf(record).readEnterCount).to.be(undefined)
    })

    it("installs an Error for a missing mutation receiver", () => {
        const root = {}
        const chain = new Chain(root)

        const result = run(chain, ["missing"], "push", true, 1)

        expect(result instanceof Error).to.be(true)
        expect(root.missing).to.be(result)
        expect(Object.keys(root)).to.eql(["missing"])
    })

    it("allows trusted Array overrides while deferring native callbacks", () => {
        const source = [1, 2]
        Object.defineProperty(source, "map", {
            enumerable: false,
            value() {
                return this.join("-")
            },
        })
        const view = run(new Chain(source), [], "push", false, 3)

        expect(run(
            new Chain(view),
            [],
            "map",
            false,
        )).to.be("1-2-3")
        expect(run(
            new Chain([1, 2]),
            [],
            "map",
            false,
            value => value,
        ) instanceof Error).to.be(true)
    })

    it("returns a validation Error for virtual length receivers", () => {
        for (const receiver of ["abc", [1, 2]]) {
            const root = { target: receiver }
            const chain = new Chain(root)

            const result = run(chain, ["target", "length"], "push", true, 1)

            expect(result instanceof Error).to.be(true)
            expect(root.target).to.be(receiver)
            expect(root.target.length).to.be(receiver.length)
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

            run(chain, [], method, true, ...args(Promise.resolve(payload)))
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

    it("keeps a temporary method receiver outside ownership", async () => {
        const element = { value: 1 }
        const argument = deferred()
        const backing = [0]
        Object.defineProperty(backing, "read", {
            enumerable: false,
            value(addend) {
                return this[1].value + addend
            },
        })
        const first = run(new Chain(backing), [], "push", false)
        const viewChain = new Chain(first)
        assignPath(viewChain, ["1"], element)
        const items = viewChain._state.value
        const chain = new Chain({ items })
        hasError(chain, [])

        const result = run(
            chain,
            ["items"],
            "read",
            false,
            argument.promise,
        )
        expect(metaOf(element).shared).to.be(undefined)
        assignPath(chain, ["items", "1", "value"], 2)
        argument.resolve(0)

        expect(await result).to.be(1)
        expect(metaOf(element).shared).to.be(undefined)
        expect([...getRefCounter(element).parents.keys()]).to.eql([items])

        importValue(items, "temporary method receiver")
        expect(metaOf(element).importBoundary).to.be(undefined)
        expect(run(new Chain(items), [], "read", false, 0)).to.be(1)
        expect(metaOf(element).importBoundary).to.be(undefined)
        verifyRefCounts(chain._state.value, items)
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

        const failure = thrownBy(() => run(chain, [], "reverse", true))

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Ref counts require a ref-indexed value")
        expect(reported).to.be(failure)
    })

    it("reports an unlimited flat of an Array cycle as a language Error", () => {
        const cyclic = [1]
        cyclic.push(cyclic)
        importValue(cyclic)
        const chain = new Chain({ items: cyclic })

        const unlimited = run(chain, ["items"], "flat", false, Infinity)
        const bounded = run(chain, ["items"], "flat", false, 2)

        expect(unlimited instanceof RangeError).to.be(true)
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
                false,
            )
            mutationResult = run(
                new Chain(mutatedSource),
                [],
                "reverse",
                true,
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
        const view = run(sourceChain, [], "push", false, 3)
        const viewChain = new Chain(view)

        assignPath(viewChain, ["0"], 9)
        expect(exportValue(sourceChain, [])).to.eql([1, 2])
        expect(exportValue(viewChain, [])).to.eql([9, 2, 3])
        verifyRefCounts(viewChain._state.value)
    })
})
