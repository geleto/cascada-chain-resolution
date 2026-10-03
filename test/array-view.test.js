import * as arrayViews from "../src/array-view.js"
import * as propertyVersions from "../src/property-versions.js"
import { requiresCopyOnWrite, metaOf } from "../src/meta.js"
import {
    Chain,
    assignPath,
    export as exportValue,
    getErrors,
    hasError,
    import as importValue,
    run,
    lookupPath,
    enter,
    Execution,
} from "../src/index.js"
import { buildRefIndex, hasCycleCut } from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"

import {
    arrayBacking,
    logicalArrayValues,
    logicalProperty,
    logicalKeys,
    deferred,
    errorCause,
    expect,
    flushMicrotasks,
} from "./support.js"

describe("ArrayView", () => {
    for (const method of ["push", "pop"]) for (const protection of ["shared", "leased"]) {
        it(`bounds repeated ${method} storage work with ${protection} backing`, async () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const measurements = []
            for (const size of [10, 1000]) {
                const counts = { keys: 0, descriptors: 0 }
                const values = Array.from({ length: size }, (_, i) => i)
                const backing = new Proxy(values, {
                    ownKeys(target) { counts.keys++; return Reflect.ownKeys(target) },
                    getOwnPropertyDescriptor(target, key) {
                        counts.descriptors++
                        return Reflect.getOwnPropertyDescriptor(target, key)
                    },
                })
                const chain = new Chain(backing, testContext)
                // The first derivation establishes backing ownership once.
                run(chain, [], "push", [], testContext, { repair: false, mutationScopeDepth: 0 })
                const before = chain._state.value
                const hold = deferred()
                const reader = protection === "leased"
                    ? enter(chain, [], testContext, false, () => hold.promise)
                    : lookupPath(chain, [], testContext)
                counts.keys = counts.descriptors = 0
                for (let i = 0; i < 3; i++) {
                    const result = run(chain, [], method, method === "push" ? [i] : [], testContext, { repair: false, mutationScopeDepth: 0 })
                    expect(result).to.be(method === "push" ? size + i + 1 : size - i - 1)
                    expect(arrayBacking(chain._state.value, testContext)).to.be(backing)
                }
                measurements.push({ ...counts })
                hold.resolve()
                await reader
                expect(exportValue(new Chain(before, testContext), [], testContext)).to.eql(Array.from({ length: size }, (_, i) => i))
                expect(exportValue(chain, [], testContext)).to.eql(method === "push"
                    ? [...Array.from({ length: size }, (_, i) => i), 0, 1, 2]
                    : Array.from({ length: size - 3 }, (_, i) => i))
                verifyRefCounts(testContext, before, chain._state.value)
            }
            expect(measurements[0]).to.eql(measurements[1])
            expect(measurements[0].keys).to.be(0)
        })
    }

    it("copies ready Error overlays without rereading backing descriptors", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const errors = Array.from({ length: 16 }, (_, i) => new Error(`retained ${i}`))
        let descriptors = 0
        const backing = new Proxy(errors, {
            getOwnPropertyDescriptor(target, key) {
                descriptors++
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const first = run(new Chain(backing, testContext), [], "push", [], testContext, { repair: false })
        let derived = first
        descriptors = 0
        for (let i = 0; i < 3; i++) {
            derived = run(new Chain(derived, testContext), [], "push", [], testContext, { repair: false })
            expect(arrayBacking(derived, testContext)).to.be(backing)
        }
        expect(descriptors).to.be(0)

        const chain = new Chain(derived, testContext)
        for (let i = 0; i < errors.length; i++) {
            expect(errorCause(lookupPath(chain, [i], testContext))).to.be(errors[i])
        }
        verifyRefCounts(testContext, first, derived, backing)
    })

    it("retains newly assigned suffix children through offset derivations", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const view = run(new Chain([0, 1], testContext), [], "push", [], testContext, { repair: false })
        const chain = new Chain(view, testContext)
        const child = { n: 1 }
        assignPath(chain, ["3"], child, testContext)
        expect(requiresCopyOnWrite(child, testContext)).not.to.be(true)
        const tail = run(chain, [], "slice", [2], testContext, { repair: false })
        const next = run(new Chain(tail, testContext), [], "push", [4], testContext, { repair: false })
        const changed = new Chain(child, testContext)
        assignPath(changed, ["n"], 2, testContext)

        expect(exportValue(chain, [], testContext)).to.eql([0, 1, , { n: 1 }])
        expect(exportValue(new Chain(tail, testContext), [], testContext)).to.eql([, { n: 1 }])
        expect(exportValue(new Chain(next, testContext), [], testContext)).to.eql([, { n: 1 }, 4])
        expect(exportValue(changed, [], testContext)).to.eql({ n: 2 })
        verifyRefCounts(testContext, chain._state.value, tail, next, changed._state.value)
    })

    it("recognizes only canonical JavaScript Array indexes", () => {
        for (const key of ["0", "1", "4294967294"]) {
            expect(arrayViews.isArrayIndex(key)).to.be(true)
        }
        for (const key of [
            "",
            "01",
            "1.0",
            "1e0",
            "-0",
            "4294967295",
        ]) {
            expect(arrayViews.isArrayIndex(key)).to.be(false)
        }
    })

    it("keeps its representation outside the language surface", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = [1, 2]
        Object.defineProperty(source, "hidden", {
            value: 3,
            enumerable: false,
            writable: true,
            configurable: true,
        })
        const view = run(new Chain(source, testContext), [], "push", [3], testContext, { repair: false })

        expect(arrayViews.isArrayView(view, testContext)).to.be(true)
        expect(Object.keys(view)).to.eql([])
        expect(logicalKeys(view, testContext)).to.eql([
            "0",
            "1",
            "2",
        ])
        expect(arrayViews.ArrayView.descriptor(view, "hidden", testContext)).to.be(
            undefined,
        )
        expect([...logicalArrayValues(view, testContext)]).to.eql([1, 2, 3])
    })

    it("recognizes views by identity without reflecting on wrappers", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const view = new arrayViews.ArrayView([1], testContext)
        const wrapper = new Proxy(view, {
            getPrototypeOf() {
                throw new Error("view wrapper was reflected")
            },
        })

        expect(arrayViews.isArrayView(view, testContext)).to.be(true)
        expect(arrayViews.isArrayView(wrapper, testContext)).to.be(false)
    })

    it("keeps logical bounds on the source identity when storage grows", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = [1, , 3]
        const view = run(new Chain(source, testContext), [], "push", [4], testContext, { repair: false })

        expect(arrayViews.isArrayView(source, testContext)).to.be(false)
        expect(metaOf(source, testContext).arrayRange.backing).to.be(source)
        expect(metaOf(source, testContext).arrayRange.lengthState).to.be(3)
        expect(metaOf(metaOf(source, testContext).arrayRange, testContext)).to.be(undefined)
        expect([
            ...logicalArrayValues(source, testContext),
        ]).to.eql([1, undefined, 3])
        expect([...logicalArrayValues(view, testContext)]).to.eql([
            1,
            undefined,
            3,
            4,
        ])
        expect(exportValue(new Chain(source, testContext), [], testContext)).to.eql([1, , 3])
    })

    it("interprets constructor bounds relative to the logical source", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = [1, 2, 3]
        const original = new arrayViews.ArrayView(source, testContext)
        const tail = new arrayViews.ArrayView(original, testContext, 1, 3)
        const last = new arrayViews.ArrayView(tail, testContext, 1, 2)
        const throughAttachment = new arrayViews.ArrayView(source, testContext, 1, 3)
        const extended = run(new Chain(original, testContext), [], "unshift", [0], testContext, { repair: false })

        expect([...logicalArrayValues(tail, testContext)]).to.eql([2, 3])
        expect([...logicalArrayValues(last, testContext)]).to.eql([3])
        expect([...logicalArrayValues(throughAttachment, testContext)]).to.eql([
            2, 3,
        ])
        expect([...logicalArrayValues(extended, testContext)]).to.eql([
            0, 1, 2, 3,
        ])
        expect([...logicalArrayValues(original, testContext)]).to.eql([1, 2, 3])
        expect([...logicalArrayValues(tail, testContext)]).to.eql([2, 3])
        expect([...logicalArrayValues(throughAttachment, testContext)]).to.eql([
            2, 3,
        ])
    })

    it("forks retained Promise versions for each derived value", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const source = [pending.promise, 2]
        new Chain(source, testContext)
        propertyVersions.getPropertyPlacement(source, "0", testContext).ensureCaptured()
        const sourceVersion = propertyVersions.getPromiseVersion(source, "0", testContext)
        const pushed = run(new Chain(source, testContext), [], "push", [3], testContext, { repair: false })
        const grownChain = new Chain(pushed, testContext)
        assignPath(grownChain, ["4"], 5, testContext)
        const grown = grownChain._state.value
        const prepended = run(new Chain(pushed, testContext), [], "unshift", [0], testContext, { repair: false })
        const shifted = run(new Chain(prepended, testContext), [], "shift", [], testContext, { repair: false })
        const popped = run(new Chain(shifted, testContext), [], "pop", [], testContext, { repair: false })

        expect(arrayViews.isArrayView(pushed, testContext)).to.be(true)
        const versions = [
            sourceVersion,
            propertyVersions.getPromiseVersion(pushed, "0", testContext),
            propertyVersions.getPromiseVersion(grown, "0", testContext),
            propertyVersions.getPromiseVersion(prepended, "1", testContext),
            propertyVersions.getPromiseVersion(shifted, "0", testContext),
            propertyVersions.getPromiseVersion(popped, "0", testContext),
        ]
        expect(versions.every(Boolean)).to.be(true)
        expect(new Set(versions).size).to.be(versions.length)

        const arrays = [source, pushed, grown, prepended, shifted, popped]
        for (const array of arrays) buildRefIndex(array, testContext)
        pending.resolve(1)
        expect(await exportValue(new Chain(source, testContext), [], testContext)).to.eql([1, 2])
        expect(exportValue(new Chain(pushed, testContext), [], testContext)).to.eql([1, 2, 3])
        expect(exportValue(grownChain, [], testContext)).to.eql([1, 2, 3, , 5])
        expect(exportValue(new Chain(prepended, testContext), [], testContext)).to.eql([0, 1, 2, 3])
        expect(exportValue(new Chain(shifted, testContext), [], testContext)).to.eql([1, 2, 3])
        expect(exportValue(new Chain(popped, testContext), [], testContext)).to.eql([1, 2])
        verifyRefCounts(testContext, ...arrays)
    })

    it("cuts a retained Promise that resolves to its indexed view", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const view = run(
            new Chain([pending.promise], testContext),
            [],
            "push",
            [2],
            testContext,
            { repair: false },
        )
        const retained = new Chain(view, testContext)
        buildRefIndex(view, testContext)

        pending.resolve(view)
        await flushMicrotasks()

        expect(hasCycleCut(view, "0", testContext)).to.be(true)
        expect(logicalProperty(view, "0", testContext)).to.be(view)
        verifyRefCounts(testContext, view)
    })

    for (const rejected of [false, true]) {
        it(`retains pending view placements without writing shared slots, rejected=${rejected}`, async () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const pending = deferred()
            let writes = 0
            const source = new Proxy([1, pending.promise, , 3], {
                set(target, key, value) {
                    if (key === "1") writes++
                    return Reflect.set(target, key, value)
                },
            })
            const chain = new Chain(source, testContext)
            const sliced = run(chain, [], "slice", [1, 4], testContext, { repair: false })
            const extended = run(new Chain(sliced, testContext), [], "concat", [[4]], testContext, { repair: false })
            expect(arrayViews.isArrayView(sliced, testContext)).to.be(true)
            expect(arrayViews.isArrayView(extended, testContext)).to.be(true)
            expect(writes).to.be(0)
            for (const value of [source, sliced, extended]) buildRefIndex(value, testContext)

            const cause = new Error("retained rejection")
            if (rejected) pending.reject(cause)
            else pending.resolve(2)
            await flushMicrotasks()

            // Only the source may publish into its physical slot. Views retain
            // independent logical versions, including through shifted bounds.
            expect(writes <= 1).to.be(true)
            const context = testContext
            const value = propertyVersions.getPlacementVersion(source, "1", context).value
            if (rejected) expect(errorCause(value)).to.be(cause)
            else expect(value).to.be(2)
            expect(logicalProperty(sliced, "0", context)).to.be(value)
            expect([...logicalArrayValues(sliced, context)]).to.eql([value, undefined, 3])
            expect([...logicalArrayValues(extended, context)]).to.eql([value, undefined, 3, 4])
            expect(logicalKeys(sliced, context)).to.eql(["0", "2"])
            expect(logicalKeys(extended, context)).to.eql(["0", "2", "3"])
            verifyRefCounts(testContext, source, sliced, extended)
        })
    }

    it("forks versions when endpoint extension adds no values", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const chain = new Chain([pending.promise], testContext)
        const derived = run(chain, [], "push", [], testContext, { repair: false })

        expect(
            propertyVersions.getPromiseVersion(chain._state.value, "0", testContext) ===
                propertyVersions.getPromiseVersion(derived, "0", testContext),
        ).to.be(false)
        assignPath(chain, ["0"], 9, testContext)
        pending.resolve(1)

        expect(await exportValue(new Chain(derived, testContext), [], testContext)).to.eql([1])
        expect(exportValue(chain, [], testContext)).to.eql([9])
    })

    it("shares traversable values retained by another view", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const retained = { value: 1 }
        const first = run(new Chain([0], testContext), [], "push", [], testContext, { repair: false })
        const extendedChain = new Chain(first, testContext)
        assignPath(extendedChain, ["1"], retained, testContext)
        const extended = extendedChain._state.value

        expect(requiresCopyOnWrite(retained, testContext)).not.to.be(true)
        const second = run(new Chain(extended, testContext), [], "push", [2], testContext, { repair: false })

        expect(requiresCopyOnWrite(retained, testContext)).to.be(true)
        const changed = new Chain(retained, testContext)
        assignPath(changed, ["value"], 3, testContext)
        expect(changed._state.value).not.to.be(retained)
        expect(logicalProperty(extended, "1", testContext)).to.be(retained)
        expect(logicalProperty(second, "1", testContext)).to.be(retained)
        expect(retained.value).to.be(1)
    })

    it("projects error queries and export through a view", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const error = new Error("view error")
        const source = [{ error }, pending.promise]
        const view = run(new Chain(source, testContext), [], "push", [3], testContext, { repair: false })
        const chain = new Chain(view, testContext)

        expect(hasError(chain, [], testContext)).to.be(true)
        const errors = getErrors(chain, [], testContext)
        const exported = exportValue(chain, [], testContext)

        pending.resolve({ ready: true })
        expect(errorCause(await errors)).to.be(error)
        const outcome = await exported
        expect(outcome instanceof Error).to.be(true)
        expect(errorCause(outcome)).to.be(error)
        verifyRefCounts(testContext, view, source)
    })

    it("orders view forks between earlier and later mutations", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const sourceChain = new Chain([pending.promise], testContext)

        assignPath(sourceChain, ["0", "before"], 1, testContext)
        const view = run(sourceChain, [], "push", [2], testContext, { repair: false })
        const changed = new Chain(view, testContext)
        assignPath(changed, ["0", "after"], 2, testContext)

        pending.resolve({})
        expect(await exportValue(sourceChain, [], testContext)).to.eql([
            { before: 1 },
        ])
        expect(await exportValue(new Chain(view, testContext), [], testContext)).to.eql([
            { before: 1 },
            2,
        ])
        expect(await exportValue(changed, [], testContext)).to.eql([
            { before: 1, after: 2 },
            2,
        ])
        verifyRefCounts(testContext, sourceChain._state.value, view, changed._state.value)
    })

    it("forks a Promise first retained after source attachment", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const source = [pending.promise, 1]

        run(new Chain(source, testContext), [], "shift", [], testContext, { repair: false })
        const retained = run(new Chain(source, testContext), [], "push", [2], testContext, { repair: false })
        const sourceVersion = propertyVersions.getPromiseVersion(source, "0", testContext)
        const retainedVersion = propertyVersions.getPromiseVersion(retained, "0", testContext)

        expect(sourceVersion).to.be.ok()
        expect(retainedVersion).to.be.ok()
        expect(retainedVersion).not.to.be(sourceVersion)
        buildRefIndex(source, testContext)
        buildRefIndex(retained, testContext)

        pending.resolve(0)
        expect(await exportValue(new Chain(source, testContext), [], testContext)).to.eql([0, 1])
        expect(exportValue(new Chain(retained, testContext), [], testContext)).to.eql([0, 1, 2])
        verifyRefCounts(testContext, source, retained)
    })

    it("allows an endpoint Promise that belongs only to one identity", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const source = [1]
        const extended = run(
            new Chain(source, testContext),
            [],
            "push",
            [pending.promise],
            testContext,
            { repair: false },
        )
        const contracted = run(
            new Chain(extended, testContext),
            [],
            "pop",
            [],
            testContext,
            { repair: false },
        )

        expect(arrayViews.isArrayView(extended, testContext)).to.be(true)
        expect([...logicalArrayValues(contracted, testContext)]).to.eql([1])
        pending.resolve(2)
        expect(await exportValue(new Chain(extended, testContext), [], testContext)).to.eql([1, 2])
        expect(exportValue(new Chain(contracted, testContext), [], testContext)).to.eql([1])
        verifyRefCounts(testContext, extended)
        verifyRefCounts(testContext, contracted)
    })

    it("keeps a retained Promise fork after source contraction", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const original = run(
            new Chain([1], testContext),
            [],
            "push",
            [pending.promise],
            testContext,
            { repair: false },
        )
        const retained = run(new Chain(original, testContext), [], "push", [3], testContext, { repair: false })
        const changed = new Chain(original, testContext)

        assignPath(changed, ["length"], 1, testContext)
        pending.resolve(2)

        expect(await exportValue(changed, [], testContext)).to.eql([1])
        expect(await exportValue(new Chain(retained, testContext), [], testContext)).to.eql([1, 2, 3])
        verifyRefCounts(testContext, changed._state.value, retained)
    })

    it("materializes imported non-extensible physical extensions", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = Object.preventExtensions([1, 2])
        importValue(source, { ...testContext, errorContext: "non-extensible extension" })
        const result = run(new Chain(source, testContext), [], "push", [3], testContext, { repair: false })

        expect(Array.isArray(result)).to.be(true)
        expect(result).to.eql([1, 2, 3])
        expect(metaOf(source, testContext).arrayRange).to.be(undefined)
        expect(source).to.eql([1, 2])
    })

    it("does not attach a view to imported backing", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = importValue([1, 2], { ...testContext, errorContext: "view backing" })
        const ownKeys = Reflect.ownKeys(source)

        expect(arrayViews.ArrayView.tryShareStorage(source, testContext)).to.be(false)
        expect(metaOf(source, testContext).arrayRange).to.be(undefined)
        expect(Reflect.ownKeys(source)).to.eql(ownKeys)

    })

    it("preserves hidden indexes when materializing prepend", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = []
        Object.defineProperty(source, "0", {
            value: 7,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        const result = run(new Chain(source, testContext), [], "unshift", [0], testContext, { repair: false })

        expect(Array.isArray(result)).to.be(true)
        expect(result.length).to.be(2)
        expect(Object.keys(result)).to.eql(["0"])
        expect(result[0]).to.be(0)
        expect(source.length).to.be(1)
        expect(Object.getOwnPropertyDescriptor(
            source,
            "0",
        ).enumerable).to.be(false)
        expect(source[0]).to.be(7)
    })

    it("materializes an imported frozen contraction", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = Object.freeze([1, 2])
        importValue(source, { ...testContext, errorContext: "frozen contraction" })
        const result = run(new Chain(source, testContext), [], "pop", [], testContext, { repair: false })

        expect(Array.isArray(result)).to.be(true)
        expect(arrayViews.isArrayView(result, testContext)).to.be(false)
        expect(result).to.eql([1])
        expect(source).to.eql([1, 2])
    })

    it("derives an empty extension without writing the backing length", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = [1]
        const view = run(new Chain(source, testContext), [], "push", [2], testContext, { repair: false })
        Object.defineProperty(source, "length", { writable: false })

        const result = run(new Chain(view, testContext), [], "push", [], testContext, { repair: false })

        expect(arrayViews.isArrayView(result, testContext)).to.be(true)
        expect([...logicalArrayValues(result, testContext)]).to.eql([1, 2])
    })

    it("returns an Error when observational endpoint growth fails", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("view length write failed")
        const backing = new Proxy([1], {
            set(target, key, value, receiver) {
                if (key === "length") throw failure
                return Reflect.set(target, key, value, receiver)
            },
        })
        const source = new Chain(backing, testContext)

        const result = run(source, [], "push", [2], testContext, { repair: false })

        expect(errorCause(result)).to.be(failure)
        expect(exportValue(source, [], testContext)).to.eql([1])
    })

    it("poisons mutation when an endpoint placement fails", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("view element write failed")
        let failPlacement = false
        const backing = new Proxy([1], {
            defineProperty(target, key, descriptor) {
                if (failPlacement && key === "2") throw failure
                return Reflect.defineProperty(target, key, descriptor)
            },
        })
        const source = new Chain(backing, testContext)
        const view = run(source, [], "push", [2], testContext, { repair: false })
        const chain = new Chain(view, testContext)
        failPlacement = true

        const result = run(chain, [], "push", [3], testContext, { repair: false, mutationScopeDepth: 0 })

        expect(errorCause(result)).to.be(failure)
        expect(chain._state.value).to.be(result)
        expect([...logicalArrayValues(view, testContext)]).to.eql([1, 2])
        expect(exportValue(source, [], testContext)).to.eql([1])
    })

    it("extends at the physical end through indexed assignment", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = [1, 2]
        const sourceChain = new Chain(source, testContext)
        const view = run(sourceChain, [], "push", [3], testContext, { repair: false })
        const chain = new Chain(view, testContext)

        expect(assignPath(chain, ["5"], 6, testContext)).to.be(undefined)
        const grown = chain._state.value

        expect(arrayViews.isArrayView(grown, testContext)).to.be(true)
        expect(arrayViews.ArrayView.minimumLength(grown, testContext)).to.be(6)
        expect([...logicalArrayValues(grown, testContext)]).to.eql([
            1,
            2,
            3,
            undefined,
            undefined,
            6,
        ])
        expect(logicalKeys(grown, testContext)).to.eql(["0", "1", "2", "5"])
        expect([...logicalArrayValues(view, testContext)]).to.eql([1, 2, 3])
        expect(exportValue(sourceChain, [], testContext)).to.eql([1, 2])
    })

    it("materializes indexed growth away from the physical end", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = [1, 2]
        const sourceChain = new Chain(source, testContext)
        const extended = run(sourceChain, [], "push", [3], testContext, { repair: false })
        const retained = new Chain(extended, testContext)
        const changed = new Chain(source, testContext)

        expect(assignPath(changed, ["2"], 9, testContext)).to.be(undefined)

        expect(Array.isArray(changed._state.value)).to.be(true)
        expect(changed._state.value).to.eql([1, 2, 9])
        expect([...logicalArrayValues(extended, testContext)]).to.eql([1, 2, 3])
        expect(exportValue(sourceChain, [], testContext)).to.eql([1, 2])
    })

    it("installs a Promise version when indexed growth adds a Promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const view = run(new Chain([1], testContext), [], "push", [2], testContext, { repair: false })
        const chain = new Chain(view, testContext)

        expect(assignPath(chain, ["2"], pending.promise, testContext)).to.be(undefined)
        expect(arrayViews.isArrayView(chain._state.value, testContext)).to.be(true)

        pending.resolve(3)
        expect(await exportValue(chain, [], testContext)).to.eql([1, 2, 3])
        expect([...logicalArrayValues(view, testContext)]).to.eql([1, 2])
        verifyRefCounts(testContext, chain._state.value)
    })

    it("keeps delayed indexed growth in FIFO order", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const view = run(new Chain([1], testContext), [], "push", [2], testContext, { repair: false })
        const chain = new Chain({ list: pending.promise }, testContext)

        assignPath(chain, ["list", "2"], 3, testContext)
        assignPath(chain, ["list", "0"], 9, testContext)
        pending.resolve(view)
        await flushMicrotasks()

        expect(exportValue(chain, ["list"], testContext)).to.eql([9, 2, 3])
        expect([...logicalArrayValues(view, testContext)]).to.eql([1, 2])
        verifyRefCounts(testContext, chain._state.value)
    })
})
