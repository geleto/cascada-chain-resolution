import {
    logicalArrayValues,
    logicalProperty,
    logicalKeys,
    Chain,
    assignPath,
    buildRefIndex,
    deferred,
    errorCause,
    expect,
    exportValue,
    flushMicrotasks,
    getErrors,
    hasError,
    importValue,
    metaOf,
    run,
    verifyRefCounts,
    arrayViews,
    testOperationContext,
    propertyVersions,
    hasCycleCut,
    lookupPath,
    enter,
} from "./support.js"

describe("ArrayView", () => {
    for (const method of ["push", "pop"]) for (const protection of ["shared", "leased"]) {
        it(`bounds repeated ${method} storage work with ${protection} backing`, async () => {
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
                const chain = new Chain(backing)
                // The first derivation establishes backing ownership once.
                run(chain, [], "push", [], { mutationScopeDepth: 0 })
                const before = chain._state.value
                const hold = deferred()
                const reader = protection === "leased"
                    ? enter(chain, [], false, () => hold.promise)
                    : lookupPath(chain, [])
                counts.keys = counts.descriptors = 0
                for (let i = 0; i < 3; i++) {
                    const result = run(chain, [], method, method === "push" ? [i] : [], { mutationScopeDepth: 0 })
                    expect(result).to.be(method === "push" ? size + i + 1 : size - i - 1)
                    expect(arrayViews.backingOf(chain._state.value)).to.be(backing)
                }
                measurements.push({ ...counts })
                hold.resolve()
                await reader
                expect(exportValue(new Chain(before), [])).to.eql(Array.from({ length: size }, (_, i) => i))
                expect(exportValue(chain, [])).to.eql(method === "push"
                    ? [...Array.from({ length: size }, (_, i) => i), 0, 1, 2]
                    : Array.from({ length: size - 3 }, (_, i) => i))
                verifyRefCounts(before, chain._state.value)
            }
            expect(measurements[0]).to.eql(measurements[1])
            expect(measurements[0].keys).to.be(0)
        })
    }

    it("retains newly assigned suffix children through offset derivations", () => {
        const view = run(new Chain([0, 1]), [], "push", [], {})
        const chain = new Chain(view)
        const child = { n: 1 }
        assignPath(chain, ["3"], child)
        expect(metaOf(child).shared).not.to.be(true)
        const tail = run(chain, [], "slice", [2], {})
        const next = run(new Chain(tail), [], "push", [4], {})
        const changed = new Chain(child)
        assignPath(changed, ["n"], 2)

        expect(exportValue(chain, [])).to.eql([0, 1, , { n: 1 }])
        expect(exportValue(new Chain(tail), [])).to.eql([, { n: 1 }])
        expect(exportValue(new Chain(next), [])).to.eql([, { n: 1 }, 4])
        expect(exportValue(changed, [])).to.eql({ n: 2 })
        verifyRefCounts(chain._state.value, tail, next, changed._state.value)
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
        const source = [1, 2]
        Object.defineProperty(source, "hidden", {
            value: 3,
            enumerable: false,
            writable: true,
            configurable: true,
        })
        const view = run(new Chain(source), [], "push", [3], {})

        expect(arrayViews.isArrayView(view)).to.be(true)
        expect(Object.keys(view)).to.eql([])
        expect(logicalKeys(view, testOperationContext())).to.eql([
            "0",
            "1",
            "2",
        ])
        expect(view.descriptor("hidden", testOperationContext())).to.be(
            undefined,
        )
        expect([...logicalArrayValues(view, testOperationContext())]).to.eql([1, 2, 3])
    })

    it("recognizes views by identity without reflecting on wrappers", () => {
        const view = arrayViews.ArrayView.tryAttachTo([1])
        const wrapper = new Proxy(view, {
            getPrototypeOf() {
                throw new Error("view wrapper was reflected")
            },
        })

        expect(arrayViews.isArrayView(view)).to.be(true)
        expect(arrayViews.isArrayView(wrapper)).to.be(false)
    })

    it("uses an attached projection when iterating the source identity", () => {
        const source = [1, , 3]
        const view = run(new Chain(source), [], "push", [4], {})

        expect(arrayViews.isArrayView(
            arrayViews.projectionOf(source),
        )).to.be(true)
        expect([
            ...logicalArrayValues(source, testOperationContext()),
        ]).to.eql([1, undefined, 3])
        expect([...logicalArrayValues(view, testOperationContext())]).to.eql([
            1,
            undefined,
            3,
            4,
        ])
        expect(exportValue(new Chain(source), [])).to.eql([1, , 3])
    })

    it("interprets constructor bounds relative to the logical source", () => {
        const source = [1, 2, 3]
        const original = arrayViews.ArrayView.tryAttachTo(source)
        const tail = new arrayViews.ArrayView(original, 1, 3)
        const last = new arrayViews.ArrayView(tail, 1, 2)
        const throughAttachment = new arrayViews.ArrayView(source, 1, 3)
        const extended = run(new Chain(original), [], "unshift", [0], {})

        expect([...logicalArrayValues(tail, testOperationContext())]).to.eql([2, 3])
        expect([...logicalArrayValues(last, testOperationContext())]).to.eql([3])
        expect([...logicalArrayValues(throughAttachment, testOperationContext())]).to.eql([
            2, 3,
        ])
        expect([...logicalArrayValues(extended, testOperationContext())]).to.eql([
            0, 1, 2, 3,
        ])
        expect([...logicalArrayValues(original, testOperationContext())]).to.eql([1, 2, 3])
        expect([...logicalArrayValues(tail, testOperationContext())]).to.eql([2, 3])
        expect([...logicalArrayValues(throughAttachment, testOperationContext())]).to.eql([
            2, 3,
        ])
    })

    it("forks retained Promise versions for each derived value", async () => {
        const pending = deferred()
        const source = [pending.promise, 2]
        new Chain(source)
        propertyVersions.getPropertyPlacement(source, "0").ensureCaptured()
        const sourceVersion = propertyVersions.getPromiseVersion(source, "0")
        const pushed = run(new Chain(source), [], "push", [3], {})
        const grownChain = new Chain(pushed)
        assignPath(grownChain, ["4"], 5)
        const grown = grownChain._state.value
        const prepended = run(new Chain(pushed), [], "unshift", [0], {})
        const shifted = run(new Chain(prepended), [], "shift", [], {})
        const popped = run(new Chain(shifted), [], "pop", [], {})

        expect(arrayViews.isArrayView(pushed)).to.be(true)
        const versions = [
            sourceVersion,
            propertyVersions.getPromiseVersion(pushed, "0"),
            propertyVersions.getPromiseVersion(grown, "0"),
            propertyVersions.getPromiseVersion(prepended, "1"),
            propertyVersions.getPromiseVersion(shifted, "0"),
            propertyVersions.getPromiseVersion(popped, "0"),
        ]
        expect(versions.every(Boolean)).to.be(true)
        expect(new Set(versions).size).to.be(versions.length)

        const arrays = [source, pushed, grown, prepended, shifted, popped]
        for (const array of arrays) buildRefIndex(array)
        pending.resolve(1)
        expect(await exportValue(new Chain(source), [])).to.eql([1, 2])
        expect(exportValue(new Chain(pushed), [])).to.eql([1, 2, 3])
        expect(exportValue(grownChain, [])).to.eql([1, 2, 3, , 5])
        expect(exportValue(new Chain(prepended), [])).to.eql([0, 1, 2, 3])
        expect(exportValue(new Chain(shifted), [])).to.eql([1, 2, 3])
        expect(exportValue(new Chain(popped), [])).to.eql([1, 2])
        verifyRefCounts(...arrays)
    })

    it("cuts a retained Promise that resolves to its indexed view", async () => {
        const pending = deferred()
        const view = run(
            new Chain([pending.promise]),
            [],
            "push",
            [2],
            {},
        )
        buildRefIndex(view)

        pending.resolve(view)
        await flushMicrotasks()

        expect(hasCycleCut(view, "0")).to.be(true)
        expect(logicalProperty(view, "0", testOperationContext())).to.be(view)
        verifyRefCounts(view)
    })

    for (const rejected of [false, true]) {
        it(`retains pending view placements without writing shared slots, rejected=${rejected}`, async () => {
            const pending = deferred()
            let writes = 0
            const source = new Proxy([1, pending.promise, , 3], {
                set(target, key, value) {
                    if (key === "1") writes++
                    return Reflect.set(target, key, value)
                },
            })
            const chain = new Chain(source)
            const sliced = run(chain, [], "slice", [1, 4], {})
            const extended = run(new Chain(sliced), [], "concat", [[4]], {})
            expect(arrayViews.isArrayView(sliced)).to.be(true)
            expect(arrayViews.isArrayView(extended)).to.be(true)
            expect(writes).to.be(0)
            for (const value of [source, sliced, extended]) buildRefIndex(value)

            const cause = new Error("retained rejection")
            if (rejected) pending.reject(cause)
            else pending.resolve(2)
            await flushMicrotasks()

            // Only the source may publish into its physical slot. Views retain
            // independent logical versions, including through shifted bounds.
            expect(writes <= 1).to.be(true)
            const context = testOperationContext()
            const value = propertyVersions.getPlacementVersion(source, "1", context).value
            if (rejected) expect(errorCause(value)).to.be(cause)
            else expect(value).to.be(2)
            expect(logicalProperty(sliced, "0", context)).to.be(value)
            expect([...logicalArrayValues(sliced, context)]).to.eql([value, undefined, 3])
            expect([...logicalArrayValues(extended, context)]).to.eql([value, undefined, 3, 4])
            expect(logicalKeys(sliced, context)).to.eql(["0", "2"])
            expect(logicalKeys(extended, context)).to.eql(["0", "2", "3"])
            verifyRefCounts(source, sliced, extended)
        })
    }

    it("forks versions when endpoint extension adds no values", async () => {
        const pending = deferred()
        const chain = new Chain([pending.promise])
        const derived = run(chain, [], "push", [], {})

        expect(
            propertyVersions.getPromiseVersion(chain._state.value, "0") ===
                propertyVersions.getPromiseVersion(derived, "0"),
        ).to.be(false)
        assignPath(chain, ["0"], 9)
        pending.resolve(1)

        expect(await exportValue(new Chain(derived), [])).to.eql([1])
        expect(exportValue(chain, [])).to.eql([9])
    })

    it("shares traversable values retained by another view", () => {
        const retained = { value: 1 }
        const first = run(new Chain([0]), [], "push", [], {})
        const extendedChain = new Chain(first)
        assignPath(extendedChain, ["1"], retained)
        const extended = extendedChain._state.value

        expect(metaOf(retained)?.shared).not.to.be(true)
        const second = run(new Chain(extended), [], "push", [2], {})

        expect(metaOf(retained).shared).to.be(true)
        const changed = new Chain(retained)
        assignPath(changed, ["value"], 3)
        expect(changed._state.value).not.to.be(retained)
        expect(logicalProperty(extended, "1", testOperationContext())).to.be(retained)
        expect(logicalProperty(second, "1", testOperationContext())).to.be(retained)
        expect(retained.value).to.be(1)
    })

    it("projects error queries and export through a view", async () => {
        const pending = deferred()
        const error = new Error("view error")
        const source = [{ error }, pending.promise]
        const view = run(new Chain(source), [], "push", [3], {})
        const chain = new Chain(view)

        expect(hasError(chain, [])).to.be(true)
        const errors = getErrors(chain, [])
        const exported = exportValue(chain, [])

        pending.resolve({ ready: true })
        expect(errorCause(await errors)).to.be(error)
        const outcome = await exported
        expect(outcome instanceof Error).to.be(true)
        expect(errorCause(outcome)).to.be(error)
        verifyRefCounts(view, source)
    })

    it("orders view forks between earlier and later mutations", async () => {
        const pending = deferred()
        const sourceChain = new Chain([pending.promise])

        assignPath(sourceChain, ["0", "before"], 1)
        const view = run(sourceChain, [], "push", [2], {})
        const changed = new Chain(view)
        assignPath(changed, ["0", "after"], 2)

        pending.resolve({})
        expect(await exportValue(sourceChain, [])).to.eql([
            { before: 1 },
        ])
        expect(await exportValue(new Chain(view), [])).to.eql([
            { before: 1 },
            2,
        ])
        expect(await exportValue(changed, [])).to.eql([
            { before: 1, after: 2 },
            2,
        ])
        verifyRefCounts(sourceChain._state.value, view, changed._state.value)
    })

    it("forks a Promise first retained after source attachment", async () => {
        const pending = deferred()
        const source = [pending.promise, 1]

        run(new Chain(source), [], "shift", [], {})
        const retained = run(new Chain(source), [], "push", [2], {})
        const sourceVersion = propertyVersions.getPromiseVersion(source, "0")
        const retainedVersion = propertyVersions.getPromiseVersion(retained, "0")

        expect(sourceVersion).to.be.ok()
        expect(retainedVersion).to.be.ok()
        expect(retainedVersion).not.to.be(sourceVersion)
        buildRefIndex(source)
        buildRefIndex(retained)

        pending.resolve(0)
        expect(await exportValue(new Chain(source), [])).to.eql([0, 1])
        expect(exportValue(new Chain(retained), [])).to.eql([0, 1, 2])
        verifyRefCounts(source, retained)
    })

    it("allows an endpoint Promise that belongs only to one identity", async () => {
        const pending = deferred()
        const source = [1]
        const extended = run(
            new Chain(source),
            [],
            "push",
            [pending.promise],
            {},
        )
        const contracted = run(
            new Chain(extended),
            [],
            "pop",
            [],
            {},
        )

        expect(arrayViews.isArrayView(extended)).to.be(true)
        expect([...logicalArrayValues(contracted, testOperationContext())]).to.eql([1])
        pending.resolve(2)
        expect(await exportValue(new Chain(extended), [])).to.eql([1, 2])
        expect(exportValue(new Chain(contracted), [])).to.eql([1])
        verifyRefCounts(extended)
        verifyRefCounts(contracted)
    })

    it("keeps a retained Promise fork after source contraction", async () => {
        const pending = deferred()
        const original = run(
            new Chain([1]),
            [],
            "push",
            [pending.promise],
            {},
        )
        const retained = run(new Chain(original), [], "push", [3], {})
        const changed = new Chain(original)

        assignPath(changed, ["length"], 1)
        pending.resolve(2)

        expect(await exportValue(changed, [])).to.eql([1])
        expect(await exportValue(new Chain(retained), [])).to.eql([1, 2, 3])
        verifyRefCounts(changed._state.value, retained)
    })

    it("materializes imported non-extensible physical extensions", () => {
        const source = Object.preventExtensions([1, 2])
        importValue(source, "non-extensible extension")
        const result = run(new Chain(source), [], "push", [3], {})

        expect(Array.isArray(result)).to.be(true)
        expect(result).to.eql([1, 2, 3])
        expect(arrayViews.projectionOf(source)).to.be(source)
        expect(source).to.eql([1, 2])
    })

    it("does not attach a view to imported backing", () => {
        const source = importValue([1, 2], "view backing")
        const ownKeys = Reflect.ownKeys(source)

        expect(arrayViews.ArrayView.tryAttachTo(source)).to.be(undefined)
        expect(arrayViews.projectionOf(source)).to.be(source)
        expect(Reflect.ownKeys(source)).to.eql(ownKeys)

    })

    it("preserves hidden indexes when materializing prepend", () => {
        const source = []
        Object.defineProperty(source, "0", {
            value: 7,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        const result = run(new Chain(source), [], "unshift", [0], {})

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
        const source = Object.freeze([1, 2])
        importValue(source, "frozen contraction")
        const result = run(new Chain(source), [], "pop", [], {})

        expect(Array.isArray(result)).to.be(true)
        expect(arrayViews.isArrayView(result)).to.be(false)
        expect(result).to.eql([1])
        expect(source).to.eql([1, 2])
    })

    it("derives an empty extension without writing the backing length", () => {
        const source = [1]
        const view = run(new Chain(source), [], "push", [2], {})
        Object.defineProperty(source, "length", { writable: false })

        const result = run(new Chain(view), [], "push", [], {})

        expect(arrayViews.isArrayView(result)).to.be(true)
        expect([...logicalArrayValues(result, testOperationContext())]).to.eql([1, 2])
    })

    it("returns an Error when observational endpoint growth fails", () => {
        const failure = new Error("view length write failed")
        const backing = new Proxy([1], {
            set(target, key, value, receiver) {
                if (key === "length") throw failure
                return Reflect.set(target, key, value, receiver)
            },
        })
        const source = new Chain(backing)

        const result = run(source, [], "push", [2], {})

        expect(errorCause(result)).to.be(failure)
        expect(exportValue(source, [])).to.eql([1])
    })

    it("poisons mutation when an endpoint placement fails", () => {
        const failure = new Error("view element write failed")
        let failPlacement = false
        const backing = new Proxy([1], {
            defineProperty(target, key, descriptor) {
                if (failPlacement && key === "2") throw failure
                return Reflect.defineProperty(target, key, descriptor)
            },
        })
        const source = new Chain(backing)
        const view = run(source, [], "push", [2], {})
        const chain = new Chain(view)
        failPlacement = true

        const result = run(chain, [], "push", [3], { mutationScopeDepth: 0 })

        expect(errorCause(result)).to.be(failure)
        expect(chain._state.value).to.be(result)
        expect([...logicalArrayValues(view, testOperationContext())]).to.eql([1, 2])
        expect(exportValue(source, [])).to.eql([1])
    })

    it("extends at the physical end through indexed assignment", () => {
        const source = [1, 2]
        const sourceChain = new Chain(source)
        const view = run(sourceChain, [], "push", [3], {})
        const chain = new Chain(view)

        expect(assignPath(chain, ["5"], 6)).to.be(undefined)
        const grown = chain._state.value

        expect(arrayViews.isArrayView(grown)).to.be(true)
        expect(grown.length).to.be(6)
        expect([...logicalArrayValues(grown, testOperationContext())]).to.eql([
            1,
            2,
            3,
            undefined,
            undefined,
            6,
        ])
        expect(logicalKeys(grown, testOperationContext())).to.eql(["0", "1", "2", "5"])
        expect([...logicalArrayValues(view, testOperationContext())]).to.eql([1, 2, 3])
        expect(exportValue(sourceChain, [])).to.eql([1, 2])
    })

    it("materializes indexed growth away from the physical end", () => {
        const source = [1, 2]
        const sourceChain = new Chain(source)
        const extended = run(sourceChain, [], "push", [3], {})
        const changed = new Chain(source)

        expect(assignPath(changed, ["2"], 9)).to.be(undefined)

        expect(Array.isArray(changed._state.value)).to.be(true)
        expect(changed._state.value).to.eql([1, 2, 9])
        expect([...logicalArrayValues(extended, testOperationContext())]).to.eql([1, 2, 3])
        expect(exportValue(sourceChain, [])).to.eql([1, 2])
    })

    it("installs a Promise version when indexed growth adds a Promise", async () => {
        const pending = deferred()
        const view = run(new Chain([1]), [], "push", [2], {})
        const chain = new Chain(view)

        expect(assignPath(chain, ["2"], pending.promise)).to.be(undefined)
        expect(arrayViews.isArrayView(chain._state.value)).to.be(true)

        pending.resolve(3)
        expect(await exportValue(chain, [])).to.eql([1, 2, 3])
        expect([...logicalArrayValues(view, testOperationContext())]).to.eql([1, 2])
        verifyRefCounts(chain._state.value)
    })

    it("keeps delayed indexed growth in FIFO order", async () => {
        const pending = deferred()
        const view = run(new Chain([1]), [], "push", [2], {})
        const chain = new Chain({ list: pending.promise })

        assignPath(chain, ["list", "2"], 3)
        assignPath(chain, ["list", "0"], 9)
        pending.resolve(view)
        await flushMicrotasks()

        expect(exportValue(chain, ["list"])).to.eql([9, 2, 3])
        expect([...logicalArrayValues(view, testOperationContext())]).to.eql([1, 2])
        verifyRefCounts(chain._state.value)
    })
})
