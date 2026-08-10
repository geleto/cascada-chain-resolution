import {
    Chain,
    expect,
    assignPath,
    deletePath,
    exportValue,
    lookupPath,
    readPath,
    registerDataClass,
    importValue,
    deferred,
    flushMicrotasks,
    hasError,
    run,
    setFatalErrorReporter,
    thrownBy,
    verifyRefCounts,
} from "./support.js"

describe("path assignment", () => {
    it("replaces the root for an empty assignment path", () => {
        const root = { old: true }
        const replacement = { next: true }
        const chain = new Chain(root)

        const result = assignPath(chain, [], replacement)

        expect(result).to.be(undefined)
        expect(chain._state.value).to.be(replacement)
        expect(root).to.eql({ old: true })
    })

    it("mutates an owned branch in place", () => {
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const pos = root.pos
        const delta = root.delta

        const result = assignPath(new Chain(root), ["pos", "x"], 2)

        expect(result).to.be(undefined)
        expect(root.pos).to.be(pos)
        expect(root.delta).to.be(delta)
        expect(root.pos.x).to.be(2)
    })

    it("creates and deletes missing __proto__ data without touching prototypes", () => {
        const root = {}
        const value = { safe: true }
        const chain = new Chain(root)

        expect(assignPath(chain, ["__proto__"], value)).to.be(undefined)

        const descriptor = Object.getOwnPropertyDescriptor(root, "__proto__")
        expect(descriptor.value).to.be(value)
        expect(descriptor.enumerable).to.be(true)
        expect(descriptor.writable).to.be(true)
        expect(descriptor.configurable).to.be(true)
        expect(readPath(chain, ["__proto__"])).to.be(value)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)

        expect(deletePath(chain, ["__proto__"])).to.be(undefined)
        expect(deletePath(chain, ["__proto__"])).to.be(undefined)
        expect(Object.hasOwn(root, "__proto__")).to.be(false)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
    })

    it("stores a path-access Error at a missing intermediate __proto__", () => {
        const root = { safe: {} }
        const chain = new Chain(root)

        assignPath(chain, ["safe", "__proto__", "polluted"], true)

        const failure = readPath(chain, ["safe", "__proto__"])
        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(Object.getPrototypeOf(root.safe)).to.be(Object.prototype)
        expect({}.polluted).to.be(undefined)
    })

    it("safely resolves a promise assigned to missing __proto__", async () => {
        const pending = deferred()
        const resolved = { safe: true }
        const root = {}
        const chain = new Chain(root)

        assignPath(chain, ["__proto__"], pending.promise)
        const pendingDescriptor = Object.getOwnPropertyDescriptor(root, "__proto__")
        expect(pendingDescriptor.value).to.be(pending.promise)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)

        pending.resolve(resolved)
        await flushMicrotasks()

        const settledDescriptor = Object.getOwnPropertyDescriptor(root, "__proto__")
        expect(settledDescriptor.value).to.be(resolved)
        expect(readPath(chain, ["__proto__"])).to.be(resolved)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
    })

    it("shadows own non-enumerable __proto__ in a materialized copy", () => {
        const hidden = { safe: true }
        const root = {}
        Object.defineProperty(root, "__proto__", {
            value: hidden,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        const replacement = { replacement: true }
        const chain = new Chain(root)

        expect(assignPath(chain, ["__proto__"], replacement)).to.be(undefined)
        expect(chain._state.value).not.to.be(root)
        expect(Object.getOwnPropertyDescriptor(root, "__proto__").value).to.be(hidden)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
        const descriptor = Object.getOwnPropertyDescriptor(
            chain._state.value,
            "__proto__",
        )
        expect(descriptor.value).to.be(replacement)
        expect(descriptor.enumerable).to.be(true)
    })

    it("preserves own __proto__ data during COW without touching prototypes", () => {
        const root = { other: { x: 1 } }
        const protoValue = { safe: true }
        Object.defineProperty(root, "__proto__", {
            value: protoValue,
            enumerable: true,
            writable: true,
            configurable: true,
        })

        importValue(root, "copy proto import")
        const chain = new Chain(root)
        assignPath(chain, ["other", "x"], 2)
        const next = chain._state.value
        const descriptor = Object.getOwnPropertyDescriptor(next, "__proto__")

        expect(root.other.x).to.be(1)
        expect(next.other.x).to.be(2)
        expect(descriptor.enumerable).to.be(true)
        expect(descriptor.writable).to.be(true)
        expect(descriptor.configurable).to.be(true)
        expect(descriptor.value).to.be(protoValue)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
        expect(Object.getPrototypeOf(next)).to.be(Object.prototype)
        expect(lookupPath(new Chain(next), ["__proto__"])).to.be(protoValue)
        expect({}.safe).to.be(undefined)
    })

    it("preserves promise-valued __proto__ data safely during COW", async () => {
        const deferredValue = deferred()
        const resolved = { safe: true }
        const root = { other: { x: 1 } }
        Object.defineProperty(root, "__proto__", {
            value: deferredValue.promise,
            enumerable: true,
            writable: true,
            configurable: true,
        })

        importValue(root, "copy proto promise import")
        const chain = new Chain(root)
        assignPath(chain, ["other", "x"], 2)
        const next = chain._state.value
        deferredValue.resolve(resolved)
        await flushMicrotasks()

        expect(Object.getOwnPropertyDescriptor(root, "__proto__").value).to.be(
            deferredValue.promise,
        )
        expect(Object.getOwnPropertyDescriptor(next, "__proto__").value).to.be(
            resolved,
        )
        expect(Object.getPrototypeOf(next)).to.be(Object.prototype)
        expect(lookupPath(new Chain(next), ["__proto__"])).to.be(resolved)
        expect({}.safe).to.be(undefined)
    })

    it("marks a shared promise-valued __proto__ result", async () => {
        const deferredValue = deferred()
        const resolved = { x: 1 }
        const root = { other: { x: 1 } }
        Object.defineProperty(root, "__proto__", {
            value: deferredValue.promise,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        const chain = new Chain(root)

        lookupPath(chain, [])
        assignPath(chain, ["other", "x"], 2)
        deferredValue.resolve(resolved)
        await flushMicrotasks()

        const resolvedChain = new Chain(resolved)
        assignPath(resolvedChain, ["x"], 3)

        expect(resolved.x).to.be(1)
        expect(resolvedChain._state.value).not.to.be(resolved)
        expect(resolvedChain._state.value.x).to.be(3)
        expect(Object.getOwnPropertyDescriptor(chain._state.value, "__proto__").value).to.be(resolved)
    })

    it("mutates and deletes an existing own enumerable __proto__ property", () => {
        const root = {}
        const initial = { x: 1 }
        const replacement = { x: 2 }
        Object.defineProperty(root, "__proto__", {
            value: initial,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        const chain = new Chain(root)

        assignPath(chain, ["__proto__", "x"], 3)
        assignPath(chain, ["__proto__"], replacement)

        expect(initial.x).to.be(3)
        expect(lookupPath(chain, ["__proto__"])).to.be(replacement)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)

        deletePath(chain, ["__proto__"])
        expect(Object.prototype.hasOwnProperty.call(root, "__proto__")).to.be(false)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
    })

    it("copy-on-writes through imported enumerable __proto__ data", () => {
        const root = {}
        const protoValue = { x: 1 }
        Object.defineProperty(root, "__proto__", {
            value: protoValue,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        importValue(root, "proto path COW")
        const chain = new Chain(root)

        assignPath(chain, ["__proto__", "x"], 2)
        const copy = chain._state.value
        const copiedProtoValue = readPath(chain, ["__proto__"])

        expect(copy).not.to.be(root)
        expect(copiedProtoValue).not.to.be(protoValue)
        expect(protoValue.x).to.be(1)
        expect(copiedProtoValue.x).to.be(2)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
        expect(Object.getPrototypeOf(copy)).to.be(Object.prototype)
    })

    it("treats non-enumerable properties as absent graph placements", () => {
        const hidden = { x: 1 }
        const root = {}
        Object.defineProperty(root, "hidden", {
            value: hidden,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        const assignedChain = new Chain(root)
        const nestedChain = new Chain(root)
        const deletedChain = new Chain(root)
        const assigned = assignPath(assignedChain, ["hidden"], 2)
        const nestedAssigned = assignPath(nestedChain, ["hidden", "x"], 2)
        const deleted = deletePath(deletedChain, ["hidden"])

        expect(assigned).to.be(undefined)
        expect(assignedChain._state.value.hidden).to.be(2)
        expect(nestedAssigned instanceof Error).to.be(true)
        expect(nestedChain._state.value.hidden).to.be(nestedAssigned)
        expect(deleted).to.be(undefined)
        expect(deletedChain._state.value).to.be(root)
        expect(root.hidden).to.be(hidden)
        expect(Object.prototype.propertyIsEnumerable.call(root, "hidden")).to.be(false)

        const array = []
        Object.defineProperty(array, "hidden", {
            value: 1,
            enumerable: false,
            writable: true,
            configurable: true,
        })
        const arrayChain = new Chain(array)
        const arrayAssigned = assignPath(arrayChain, ["hidden"], 2)
        expect(arrayAssigned.message).to.be(
            "Arrays support only indexes and length",
        )
        expect(arrayChain._state.value).to.be(arrayAssigned)
        expect(array.hidden).to.be(1)
    })

    it("materializes own accessors but safely shadows inherited blockers", () => {
        let ownSetterCalls = 0
        let inheritedSetterCalls = 0
        const accessor = {}
        Object.defineProperty(accessor, "value", {
            get() {
                return 1
            },
            set() {
                ownSetterCalls++
            },
            enumerable: true,
            configurable: true,
        })
        class InheritedState {}
        registerDataClass(InheritedState)
        const prototype = InheritedState.prototype
        Object.defineProperty(prototype, "locked", {
            value: 1,
            enumerable: true,
            writable: false,
            configurable: true,
        })
        Object.defineProperty(prototype, "hook", {
            get() {
                return 1
            },
            set() {
                inheritedSetterCalls++
            },
            enumerable: true,
            configurable: true,
        })
        const inherited = new InheritedState()

        const accessorChain = new Chain(accessor)
        expect(assignPath(accessorChain, ["value"], 2)).to.be(undefined)
        assignPath(new Chain(inherited), ["locked"], 2)
        assignPath(new Chain(inherited), ["hook"], 3)

        expect(accessorChain._state.value).not.to.be(accessor)
        expect(accessorChain._state.value.value).to.be(2)
        expect(ownSetterCalls).to.be(0)
        expect(inheritedSetterCalls).to.be(0)
        expect(Object.getOwnPropertyDescriptor(inherited, "locked").value).to.be(2)
        expect(Object.getOwnPropertyDescriptor(inherited, "hook").value).to.be(3)
        expect(prototype.locked).to.be(1)
    })

    it("shadows non-enumerable properties after COW", () => {
        const hidden = { x: 1 }
        const root = {}
        Object.defineProperty(root, "hidden", {
            value: hidden,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        importValue(root, "hidden import")
        const chain = new Chain(root)
        assignPath(chain, ["hidden"], 2)
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(root.hidden).to.be(hidden)
        expect(Object.prototype.propertyIsEnumerable.call(root, "hidden")).to.be(false)
        expect(next.hidden).to.be(2)
        expect(Object.prototype.propertyIsEnumerable.call(next, "hidden")).to.be(true)
    })

    it("exposes Array length and applies ArraySetLength semantics", () => {
        const root = [1, 2, 3]
        const chain = new Chain(root)

        expect(lookupPath(chain, ["length"])).to.be(3)

        expect(assignPath(chain, ["length"], 1)).to.be(undefined)
        const deleted = deletePath(chain, ["length"])

        expect(deleted instanceof Error).to.be(true)
        expect(chain._state.value).to.be(deleted)
        expect(root).to.eql([1])
    })

    it("treats Array length reflection failures as language Errors", () => {
        const failure = new Error("length reflection failed")
        const target = [1, 2]
        const array = new Proxy(target, {
            get(value, key, receiver) {
                if (key === "length") throw failure
                return Reflect.get(value, key, receiver)
            },
        })
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })
        let observed
        let mutation
        let chain
        try {
            observed = lookupPath(new Chain(array), ["length"])
            chain = new Chain(array)
            mutation = assignPath(chain, ["length"], 1)
        } finally {
            setFatalErrorReporter()
        }

        expect(observed).to.be(failure)
        expect(mutation).to.be(failure)
        expect(chain._state.value).to.be(failure)
        expect(target).to.eql([1, 2])
        expect(reported).to.be(undefined)
    })

    it("turns physical property traps into mutation poison", () => {
        const cases = [
            {
                target: { value: 1 },
                handler: {
                    set() {
                        throw new Error("set failed")
                    },
                },
                mutate: chain => assignPath(chain, ["value"], 2),
                message: "set failed",
            },
            {
                target: {},
                handler: {
                    defineProperty() {
                        throw new Error("definition failed")
                    },
                },
                mutate: chain => assignPath(chain, ["value"], 2),
                message: "definition failed",
            },
            {
                target: { value: 1 },
                handler: {
                    deleteProperty() {
                        throw new Error("deletion failed")
                    },
                },
                mutate: chain => deletePath(chain, ["value"]),
                message: "deletion failed",
            },
        ]

        for (const { target, handler, mutate, message } of cases) {
            const chain = new Chain(new Proxy(target, handler))
            const result = mutate(chain)

            expect(result.message).to.be(message)
            expect(chain._state.value).to.be(result)
        }
    })

    it("turns an Array length write trap into mutation poison", () => {
        const failure = new Error("length write failed")
        const target = [1, 2]
        const array = new Proxy(target, {
            set(value, key, next, receiver) {
                if (key === "length") throw failure
                return Reflect.set(value, key, next, receiver)
            },
        })
        const chain = new Chain(array)

        const result = assignPath(chain, ["length"], 1)

        expect(result).to.be(failure)
        expect(chain._state.value).to.be(failure)
    })

    it("attributes intrinsic errors to an imported receiver", () => {
        const source = importValue([1], "intrinsic receiver")

        const deletion = deletePath(new Chain(source), ["length"])
        const mutation = run(
            new Chain(source),
            ["length"],
            "push",
            true,
            2,
        )

        expect(deletion.message).to.be(
            "Cannot delete length (imported at: intrinsic receiver)",
        )
        expect(mutation.message).to.be(
            "Array mutation receiver is not an Array " +
            "(imported at: intrinsic receiver)",
        )
        expect(source).to.eql([1])
    })

    it("poisons intrinsic targets without changing imported data", () => {
        const source = importValue({
            values: [1, 2],
            text: "abc",
        }, "nested intrinsic")
        const operations = [
            chain => deletePath(chain, ["values", "length"]),
            chain => run(
                chain,
                ["values", "length"],
                "push",
                true,
                3,
            ),
            chain => assignPath(chain, ["text", "length"], 1),
            chain => assignPath(chain, ["values", "name"], 1),
        ]

        for (const operation of operations) {
            const chain = new Chain(source)

            expect(operation(chain)).to.be.an(Error)
            expect(readPath(chain, [])).not.to.be(source)
            expect(hasError(chain, [])).to.be(true)
            expect(source.values).to.eql([1, 2])
            expect(source.text).to.be("abc")
        }
    })

    it("treats intermediate Array length as a primitive path", () => {
        const root = { values: [1, 2] }
        const chain = new Chain(root)

        const failure = thrownBy(() => {
            assignPath(chain, ["values", "length", "x"], 1)
        })

        expect(failure).to.be(undefined)
        expect(chain._state.value).to.be(root)
        expect(root.values).to.eql([1, 2])
        const observed = lookupPath(chain, ["values", "length", "x"])
        expect(observed instanceof Error).to.be(true)
        expect(observed.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("grows Array length with holes and poisons invalid lengths", () => {
        const root = [1]
        const chain = new Chain(root)

        expect(assignPath(chain, ["length"], 3)).to.be(undefined)
        expect(root.length).to.be(3)
        expect(Object.keys(root)).to.eql(["0"])

        const error = assignPath(chain, ["length"], 1.5)
        expect(error instanceof Error).to.be(true)
        expect(chain._state.value).to.be(error)
        expect(root.length).to.be(3)
    })

    it("materializes before a restricted Array shrink", () => {
        const root = [0, 1, 2]
        Object.defineProperty(root, "1", {
            value: 1,
            enumerable: true,
            writable: true,
            configurable: false,
        })
        const chain = new Chain(root)

        const result = assignPath(chain, ["length"], 0)

        expect(result).to.be(undefined)
        expect(chain._state.value).to.eql([])
        expect(chain._state.value).not.to.be(root)
        expect(root).to.eql([0, 1, 2])
        verifyRefCounts(chain._state.value)
    })

    it("materializes a non-writable native Array length", () => {
        const root = [1, 2]
        Object.defineProperty(root, "length", { writable: false })
        const chain = new Chain(root)

        const result = assignPath(chain, ["length"], 1)

        expect(result).to.be(undefined)
        expect(chain._state.value).to.eql([1])
        expect(chain._state.value).not.to.be(root)
        expect(root).to.eql([1, 2])
    })

    it("gates a Promise-converted Array length before later mutations", async () => {
        const length = deferred()
        const chain = new Chain([1, 2, 3])

        expect(assignPath(chain, ["length"], length.promise)).to.be(undefined)
        expect(chain._state.value instanceof Promise).to.be(true)
        assignPath(chain, ["0"], 9)

        length.resolve(1)
        await flushMicrotasks()

        expect(await exportValue(chain, [])).to.eql([9])
        verifyRefCounts(chain._state.value)
    })

    it("keeps deferred Array length on its captured receiver version", async () => {
        const receiver = deferred()
        const root = { values: receiver.promise }
        const chain = new Chain(root)

        assignPath(chain, ["values", "length"], 1)
        const replacement = [9, 8, 7]
        assignPath(chain, ["values"], replacement)

        receiver.resolve([1, 2, 3])
        await flushMicrotasks()

        expect(root.values).to.be(replacement)
        expect(replacement).to.eql([9, 8, 7])
        verifyRefCounts(root)
    })

    it("copy-on-writes a Promise-converted imported Array length", async () => {
        const length = deferred()
        const source = importValue({ values: [1, 2, 3] }, "imported length")
        const chain = new Chain(source)

        expect(assignPath(
            chain,
            ["values", "length"],
            length.promise,
        )).to.be(undefined)
        expect(chain._state.value).not.to.be(source)
        expect(chain._state.value.values instanceof Promise).to.be(true)
        expect(source).to.eql({ values: [1, 2, 3] })

        length.resolve(1)
        await flushMicrotasks()

        expect(source).to.eql({ values: [1, 2, 3] })
        expect(exportValue(chain, [])).to.eql({ values: [1] })
        verifyRefCounts(source, chain._state.value)
    })

    it("retains a Promise assigned to an ordinary length property", async () => {
        const length = deferred()
        const root = { length: 0 }
        const chain = new Chain(root)

        expect(assignPath(chain, ["length"], length.promise)).to.be(undefined)
        expect(chain._state.value).to.be(root)
        expect(root.length).to.be(length.promise)

        length.resolve(3)
        await flushMicrotasks()

        expect(chain._state.value).to.be(root)
        expect(root.length).to.be(3)
    })

    it("retains a Promise length payload after its object receiver resolves", async () => {
        const receiver = deferred()
        const length = deferred()
        const root = { target: receiver.promise }
        const chain = new Chain(root)

        expect(assignPath(
            chain,
            ["target", "length"],
            length.promise,
        )).to.be(undefined)

        const target = { length: 0 }
        receiver.resolve(target)
        await flushMicrotasks()

        expect(await readPath(chain, ["target"])).to.be(target)
        expect(target.length).to.be(length.promise)

        length.resolve(4)
        await flushMicrotasks()
        expect(target.length).to.be(4)
    })

    it("rejects String length assignment without waiting for its payload", () => {
        const length = deferred()
        const chain = new Chain("abc")

        const result = assignPath(chain, ["length"], length.promise)

        expect(result instanceof Error).to.be(true)
        expect(chain._state.value).to.be(result)
        length.resolve(1)
    })

    it("shrinks ArrayView bounds and materializes before regrowth", () => {
        const sourceChain = new Chain([1, 2, 3])
        const view = run(sourceChain, [], "push", false, 4)
        const viewChain = new Chain(view)

        assignPath(viewChain, ["length"], 2)
        expect(exportValue(viewChain, [])).to.eql([1, 2])
        expect(exportValue(sourceChain, [])).to.eql([1, 2, 3])

        assignPath(viewChain, ["length"], 4)
        const grown = exportValue(viewChain, [])
        expect(grown.length).to.be(4)
        expect(Object.keys(grown)).to.eql(["0", "1"])
        expect(exportValue(sourceChain, [])).to.eql([1, 2, 3])
        verifyRefCounts(viewChain._state.value)
    })

    it("materializes a restricted ArrayView shrink", () => {
        const source = [0, 1, 2]
        Object.defineProperty(source, "1", {
            value: 1,
            enumerable: true,
            writable: true,
            configurable: false,
        })
        const sourceChain = new Chain(source)
        const view = run(sourceChain, [], "push", false, 3)
        const chain = new Chain(view)

        const result = assignPath(chain, ["length"], 0)

        expect(result).to.be(undefined)
        expect(chain._state.value).not.to.be(view)
        expect(exportValue(chain, [])).to.eql([])
        expect(view.length).to.be(4)
        expect([...view]).to.eql([0, 1, 2, 3])
        expect(exportValue(sourceChain, [])).to.eql([0, 1, 2])
        verifyRefCounts(view, source)
    })

    it("exposes read-only String length", () => {
        const chain = new Chain("abc")

        expect(lookupPath(chain, ["length"])).to.be(3)
        const assigned = assignPath(chain, ["length"], 1)
        expect(assigned instanceof Error).to.be(true)
        expect(chain._state.value).to.be(assigned)

        const deletedChain = new Chain("abc")
        const deleted = deletePath(deletedChain, ["length"])
        expect(deleted instanceof Error).to.be(true)
        expect(deletedChain._state.value).to.be(deleted)
    })

    it("can shadow inherited properties", () => {
        const root = {}

        assignPath(new Chain(root), ["constructor"], 2)

        expect(root.constructor).to.be(2)
        expect(Object.prototype.propertyIsEnumerable.call(root, "constructor")).to.be(true)
    })

    it("copies only an escaped branch", () => {
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const oldPos = lookupPath(new Chain(root), ["pos"])
        const oldDelta = root.delta

        assignPath(new Chain(root), ["pos", "x"], 2)
        assignPath(new Chain(root), ["delta", "x"], 5)

        expect(root.pos).not.to.be(oldPos)
        expect(oldPos.x).to.be(1)
        expect(root.pos.x).to.be(2)
        expect(root.delta).to.be(oldDelta)
        expect(root.delta.x).to.be(5)
    })

    it("can read a branch without sharing ownership", () => {
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const observed = readPath(new Chain(root), ["pos"])
        const delta = root.delta

        assignPath(new Chain(root), ["pos", "x"], 2)

        expect(root.pos).to.be(observed)
        expect(root.pos.x).to.be(2)
        expect(root.delta).to.be(delta)
    })

    it("can read the root without sharing ownership", () => {
        const root = { pos: { x: 1 } }
        const observed = readPath(new Chain(root), [])
        const pos = root.pos

        assignPath(new Chain(root), ["pos", "x"], 2)

        expect(observed).to.be(root)
        expect(root.pos).to.be(pos)
        expect(root.pos.x).to.be(2)
    })

    it("copies a shared root and marks copied children as shared", () => {
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const oldPos = root.pos
        const oldDelta = root.delta
        importValue(root)
        const chain = new Chain(root)

        assignPath(chain, ["pos", "x"], 2)
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(next.pos).not.to.be(oldPos)
        expect(next.delta).to.be(oldDelta)
        expect(root.pos.x).to.be(1)
        expect(next.pos.x).to.be(2)

        assignPath(chain, ["delta", "x"], 5)
        expect(chain._state.value).to.be(next)
        expect(next.delta).not.to.be(oldDelta)
        expect(oldDelta.x).to.be(3)
        expect(next.delta.x).to.be(5)
    })

    it("splits an imported DAG only along the mutated path", () => {
        const child = { x: 1 }
        const root = importValue({ left: child, right: child }, "DAG import")
        const chain = new Chain(root)

        assignPath(chain, ["left", "x"], 2)
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(next.left).not.to.be(child)
        expect(next.right).to.be(child)
        expect(next.left.x).to.be(2)
        expect(child.x).to.be(1)
    })

    it("tracks inherited shared state along the mutated path", () => {
        const root = {
            b: { x: 1 },
            c: { x: 2 },
        }
        const oldB = root.b
        const oldC = root.c
        importValue(root)
        const chain = new Chain(root)

        assignPath(chain, ["b", "x"], 5)
        const next = chain._state.value
        const ownedB = next.b

        expect(next.b).not.to.be(oldB)
        expect(next.c).to.be(oldC)
        expect(root.b.x).to.be(1)
        expect(next.b.x).to.be(5)

        assignPath(chain, ["b", "y"], 6)
        expect(next.b).to.be(ownedB)
        expect(next.b.y).to.be(6)

        assignPath(chain, ["c", "x"], 7)
        expect(next.c).not.to.be(oldC)
        expect(oldC.x).to.be(2)
        expect(next.c.x).to.be(7)
    })

    it("marks reused children while keeping the replaced path owned", () => {
        const root = {
            a: { x: 1 },
            b: { x: 2 },
            c: { x: 3 },
        }
        importValue(root)
        const chain = new Chain(root)

        assignPath(chain, ["b"], { y: 4 })
        const next = chain._state.value
        const oldA = next.a
        const oldC = next.c
        const ownedB = next.b

        assignPath(chain, ["b", "y"], 5)

        expect(next.b).to.be(ownedB)
        expect(next.b.y).to.be(5)
        expect(root.b).to.eql({ x: 2 })

        assignPath(chain, ["a", "x"], 9)

        expect(next.a).not.to.be(oldA)
        expect(next.c).to.be(oldC)
        expect(oldA.x).to.be(1)
        expect(next.a.x).to.be(9)
    })

    it("does not clear the mark from an assigned shared object", () => {
        const value = importValue({ x: 1 })
        const root = {}

        assignPath(new Chain(root), ["value"], value)
        assignPath(new Chain(root), ["value", "x"], 2)

        expect(root.value).not.to.be(value)
        expect(value.x).to.be(1)
        expect(root.value.x).to.be(2)
    })

    it("copies sparse arrays without materializing holes", () => {
        const root = []
        root.length = 3
        root[1] = "one"
        importValue(root)
        const chain = new Chain(root)

        assignPath(chain, [2], "two")
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(next.length).to.be(3)
        expect(0 in next).to.be(false)
        expect(next[1]).to.be("one")
        expect(next[2]).to.be("two")
    })

    it("uses canonical string indexes and rejects named Array keys", () => {
        const root = []
        const chain = new Chain(root)

        expect(assignPath(chain, ["0"], "zero")).to.be(undefined)
        expect(assignPath(chain, [2], "two")).to.be(undefined)
        expect(root.length).to.be(3)
        expect(root["0"]).to.be("zero")
        expect(1 in root).to.be(false)
        expect(root[2]).to.be("two")

        expect(assignPath(chain, [-0], "numeric minus zero")).to.be(undefined)
        expect(root[0]).to.be("numeric minus zero")

        for (const key of [
            "01",
            "1.0",
            "1e0",
            "-0",
            "4294967295",
            "name",
        ]) {
            const assignedChain = new Chain([])
            const deletedChain = new Chain([])
            const assigned = assignPath(assignedChain, [key], key)
            const deleted = deletePath(deletedChain, [key])

            expect(assigned instanceof Error).to.be(true)
            expect(deleted instanceof Error).to.be(true)
            expect(assignedChain._state.value).to.be(assigned)
            expect(deletedChain._state.value).to.be(deleted)
        }

        const hostArray = []
        hostArray.name = "host-only"
        const hostChain = new Chain(hostArray)
        const hostFailure = assignPath(hostChain, ["name"], "changed")
        expect(hostFailure instanceof Error).to.be(true)
        expect(hostChain._state.value).to.be(hostFailure)
        expect(hostArray.name).to.be("host-only")

        const imported = importValue([], "indexed growth")
        const invalidImportedChain = new Chain(imported)
        expect(assignPath(
            invalidImportedChain,
            ["name"],
            "value",
        ).message).to.be(
            "Arrays support only indexes and length " +
            "(imported at: indexed growth)",
        )
        const importedChain = new Chain(imported)
        expect(assignPath(importedChain, ["2"], "value")).to.be(undefined)
        expect(importedChain._state.value).not.to.be(imported)
        expect(imported.length).to.be(0)
        expect(importedChain._state.value.length).to.be(3)
        expect(1 in importedChain._state.value).to.be(false)
        expect(importedChain._state.value[2]).to.be("value")
    })

    it("copies frozen arrays before mutating nested values", () => {
        const child = { x: 1 }
        const root = Object.freeze([child])
        importValue(root, "frozen nested mutation")
        const chain = new Chain(root)

        assignPath(chain, [0, "x"], 2)
        const next = chain._state.value

        expect(Array.isArray(next)).to.be(true)
        expect(next).not.to.be(root)
        expect(next[0]).not.to.be(child)
        expect(next[0].x).to.be(2)
        expect(child.x).to.be(1)
    })

    it("can replace an Error at the target key", () => {
        const root = { value: new Error("old") }

        assignPath(new Chain(root), ["value"], 42)

        expect(root.value).to.be(42)
    })

    it("turns every missing or primitive intermediate into Error", () => {
        const root = { old: 7, nothing: null, unset: undefined }

        const missingResult = assignPath(
            new Chain(root),
            ["new", "value"],
            1,
        )
        assignPath(new Chain(root), ["old", "value"], 2)
        assignPath(new Chain(root), ["nothing", "value"], 3)
        assignPath(new Chain(root), ["unset", "value"], 4)

        for (const value of [root.new, root.old, root.nothing, root.unset]) {
            expect(value instanceof Error).to.be(true)
            expect(value.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
        expect(missingResult).to.be(root.new)
    })

    it("copies a shared branch before installing a path Error", () => {
        const root = importValue({ keep: true }, "shared broken path")
        const chain = new Chain(root)

        assignPath(chain, ["missing", "value"], 1)

        const next = chain._state.value
        expect(next).not.to.be(root)
        expect(root).to.eql({ keep: true })
        expect(next.keep).to.be(true)
        expect(next.missing instanceof Error).to.be(true)
        expect(next.missing.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("turns assignment through missing or primitive roots into Error", () => {
        const nullChain = new Chain(null)
        const undefinedChain = new Chain(undefined)
        const numberChain = new Chain(7)
        const stringChain = new Chain("text")

        assignPath(nullChain, ["value"], 1)
        assignPath(undefinedChain, ["value"], 1)
        assignPath(numberChain, ["value"], 1)
        assignPath(stringChain, ["value"], 1)

        for (const chain of [nullChain, undefinedChain, numberChain, stringChain]) {
            expect(chain._state.value instanceof Error).to.be(true)
            expect(chain._state.value.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
    })

    it("is a no-op when assigning through an Error root or Error branch", () => {
        const errorRoot = new Error("root")
        const root = { branch: new Error("branch") }
        const chain = new Chain(errorRoot)

        const rootResult = assignPath(chain, ["value"], 1)
        const branchResult = assignPath(
            new Chain(root),
            ["branch", "value"],
            1,
        )

        expect(rootResult).to.be(errorRoot)
        expect(branchResult).to.be(root.branch)
        expect(chain._state.value).to.be(errorRoot)
        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("branch")
    })

})

describe("lookupPath", () => {
    it("marks the root as shared by default", () => {
        const root = { pos: { x: 1 } }
        const oldPos = root.pos

        const value = lookupPath(new Chain(root), [])
        const chain = new Chain(root)
        assignPath(chain, ["pos", "x"], 2)
        const next = chain._state.value

        expect(value).to.be(root)
        expect(next).not.to.be(root)
        expect(next.pos).not.to.be(oldPos)
        expect(root.pos.x).to.be(1)
        expect(next.pos.x).to.be(2)
    })

    it("returns Error roots and Error branches", () => {
        const errorRoot = new Error("root")
        const branchError = new Error("branch")
        const root = { branch: branchError }

        expect(lookupPath(new Chain(errorRoot), ["value"])).to.be(errorRoot)
        expect(lookupPath(new Chain(root), ["branch", "value"])).to.be(branchError)
    })

    it("allows missing targets but returns Error for broken paths", () => {
        const root = { branch: {} }

        for (const value of [7, null, undefined]) {
            const result = lookupPath(new Chain(value), ["value"])
            expect(result instanceof Error).to.be(true)
            expect(result.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
        expect(lookupPath(new Chain(root), ["branch", "missing"])).to.be(undefined)
        const broken = lookupPath(new Chain(root), ["branch", "missing", "value"])
        expect(broken instanceof Error).to.be(true)
        expect(broken.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(lookupPath(new Chain({ value: undefined }), ["value"])).to.be(undefined)
    })

    it("does not read inherited object properties", () => {
        expect(lookupPath(new Chain({}), ["constructor"])).to.be(undefined)
        const broken = lookupPath(new Chain({}), ["constructor", "name"])
        expect(broken instanceof Error).to.be(true)
        expect(broken.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("reads only own enumerable data properties", () => {
        const root = {}
        let getterCalls = 0
        Object.defineProperty(root, "__proto__", {
            value: { unsafe: true },
            enumerable: true,
            writable: true,
            configurable: true,
        })
        Object.defineProperty(root, "hidden", {
            value: { x: 1 },
            enumerable: false,
            writable: true,
            configurable: true,
        })
        Object.defineProperty(root, "accessor", {
            enumerable: true,
            get() {
                getterCalls++
                return { x: 1 }
            },
        })

        expect(lookupPath(new Chain(root), ["__proto__"])).to.be(root.__proto__)
        expect(lookupPath(new Chain(root), ["__proto__", "unsafe"])).to.be(true)
        expect(lookupPath(new Chain({}), ["__proto__"])).to.be(undefined)
        expect(lookupPath(new Chain(root), ["hidden"])).to.be(undefined)
        expect(lookupPath(new Chain(root), ["accessor"])).to.be(undefined)
        expect(getterCalls).to.be(0)
        for (const path of [["hidden", "x"], ["accessor", "x"]]) {
            const result = lookupPath(new Chain(root), path)
            expect(result instanceof Error).to.be(true)
            expect(result.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
        expect(getterCalls).to.be(0)
    })

    it("supports primitive roots for empty lookup paths", () => {
        expect(lookupPath(new Chain(7), [])).to.be(7)
        expect(lookupPath(new Chain("text"), [])).to.be("text")
        expect(lookupPath(new Chain(null), [])).to.be(null)
        expect(lookupPath(new Chain(undefined), [])).to.be(undefined)
    })

})

describe("deletePath", () => {
    it("replaces the root with null and returns nothing for an empty path", () => {
        const root = { value: 1 }
        const chain = new Chain(root)

        const result = deletePath(chain, [])

        expect(result).to.be(undefined)
        expect(chain._state.value).to.be(null)
        expect(root).to.eql({ value: 1 })
    })

    it("turns deletion through missing or primitive roots into Error", () => {
        const values = [null, undefined, 7, "text"]
        for (const value of values) {
            const chain = new Chain(value)
            const result = deletePath(chain, ["value"])
            expect(result instanceof Error).to.be(true)
            expect(chain._state.value).to.be(result)
            expect(chain._state.value instanceof Error).to.be(true)
            expect(chain._state.value.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
    })

    it("allows deletion of a missing target property", () => {
        const root = { keep: true }

        deletePath(new Chain(root), ["missing"])

        expect(root).to.eql({ keep: true })
    })

    it("deletes from a copied branch without changing the escaped branch", () => {
        const root = { config: { keep: true, remove: true } }
        const oldConfig = lookupPath(new Chain(root), ["config"])

        deletePath(new Chain(root), ["config", "remove"])

        expect(oldConfig).to.eql({ keep: true, remove: true })
        expect(root.config).to.eql({ keep: true })
        expect(root.config).not.to.be(oldConfig)
    })

    it("treats deletion of a non-enumerable property as a no-op", () => {
        const hidden = { x: 1 }
        const root = { keep: true }
        Object.defineProperty(root, "hidden", {
            value: hidden,
            enumerable: false,
            writable: true,
            configurable: true,
        })
        importValue(root, "hidden delete import")
        const chain = new Chain(root)

        deletePath(chain, ["hidden"])
        const next = chain._state.value

        expect(next).to.be(root)
        expect(root.hidden).to.be(hidden)
        expect(Object.prototype.propertyIsEnumerable.call(root, "hidden")).to.be(false)
    })

    it("ignores a hidden property during a suspended imported delete", async () => {
        const pending = deferred()
        const external = { keep: true }
        Object.defineProperty(external, "hidden", {
            value: { x: 1 },
            enumerable: false,
            writable: true,
            configurable: true,
        })
        const chain = new Chain({})

        assignPath(chain, ["branch"], importValue(pending.promise, "hidden async delete"))
        const result = deletePath(chain, ["branch", "hidden"])

        expect(result).to.be(undefined)
        pending.resolve(external)
        await flushMicrotasks()

        expect(chain._state.value.branch).to.be(external)
        expect(external.hidden).to.eql({ x: 1 })
    })

    it("can delete an Error at the target key", () => {
        const root = { value: new Error("old") }

        deletePath(new Chain(root), ["value"])

        expect(root).to.eql({})
    })

    it("is a no-op when deleting through an Error root or Error branch", () => {
        const errorRoot = new Error("root")
        const branchError = new Error("branch")
        const root = { branch: branchError }
        const chain = new Chain(errorRoot)

        deletePath(chain, ["value"])
        deletePath(new Chain(root), ["branch", "value"])

        expect(chain._state.value).to.be(errorRoot)
        expect(root.branch).to.be(branchError)
    })

    it("deletes an ordinary object length property", () => {
        const root = { length: 2, keep: true }

        expect(deletePath(new Chain(root), ["length"])).to.be(undefined)
        expect(root).to.eql({ keep: true })
    })

    it("does not delete ArrayView length", () => {
        const source = new Chain([1, 2])
        const view = run(source, [], "push", false, 3)
        const chain = new Chain(view)

        const result = deletePath(chain, ["length"])

        expect(result instanceof Error).to.be(true)
        expect(chain._state.value).to.be(result)
        expect(exportValue(source, [])).to.eql([1, 2])
    })

    it("does not delete length from delayed Array or String receivers", async () => {
        for (const value of [[1, 2], "abc"]) {
            const receiver = deferred()
            const root = { value: receiver.promise }
            const length = value.length

            expect(deletePath(
                new Chain(root),
                ["value", "length"],
            )).to.be(undefined)
            receiver.resolve(value)
            await flushMicrotasks()

            expect(root.value instanceof Error).to.be(true)
            expect(value.length).to.be(length)
        }
    })

    it("deletes array elements without changing length", async () => {
        const arrayRoot = [1, 2, 3]
        const root = { list: [1, 2, 3] }
        const list = root.list
        const deferredList = deferred()
        const pendingRoot = { list: deferredList.promise }

        deletePath(new Chain(arrayRoot), [1])
        deletePath(new Chain(root), ["list", 1])
        deletePath(new Chain(pendingRoot), ["list", 1])

        deferredList.resolve([1, 2, 3])
        await flushMicrotasks()

        expect(arrayRoot.length).to.be(3)
        expect(arrayRoot[1]).to.be(undefined)
        expect(1 in arrayRoot).to.be(false)
        expect(root.list.length).to.be(3)
        expect(root.list[1]).to.be(undefined)
        expect(1 in root.list).to.be(false)
        expect(root.list).to.be(list)
        expect(pendingRoot.list.length).to.be(3)
        expect(pendingRoot.list[1]).to.be(undefined)
        expect(1 in pendingRoot.list).to.be(false)
    })

    it("detaches pending resolution when deleting a promise key", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(new Chain(root), ["value"], deferredValue.promise)
        deletePath(new Chain(root), ["value"])

        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        expect(root).to.eql({})
    })

    it("returns immediately when assign and delete suspend", async () => {
        const assigned = deferred()
        const deleted = deferred()
        const assignChain = new Chain({ branch: assigned.promise })
        const deleteChain = new Chain({ branch: deleted.promise })

        const assignResult = assignPath(assignChain, ["branch", "x"], 1)
        const deleteResult = deletePath(deleteChain, ["branch", "x"])

        expect(assignResult).to.be(undefined)
        expect(deleteResult).to.be(undefined)

        assigned.resolve({})
        deleted.resolve({ x: 1 })
        await flushMicrotasks()

        expect(assignChain._state.value.branch).to.eql({ x: 1 })
        expect(deleteChain._state.value.branch).to.eql({})
    })

    it("captures mutation paths before a pending root settles", async () => {
        const assignedRoot = deferred()
        const assignedChain = new Chain(assignedRoot.promise)
        const assignSegments = ["assigned"]

        assignPath(assignedChain, assignSegments, true)
        assignSegments[0] = "changed"
        assignedRoot.resolve({})

        const deletedRoot = deferred()
        const deletedChain = new Chain(deletedRoot.promise)
        const deleteSegments = ["deleted"]

        deletePath(deletedChain, deleteSegments)
        deleteSegments.length = 0
        deletedRoot.resolve({ keep: true, deleted: true })

        const clearedRoot = deferred()
        const clearedChain = new Chain(clearedRoot.promise)
        const clearSegments = []

        deletePath(clearedChain, clearSegments)
        clearSegments.push("changed")
        clearedRoot.resolve({ keep: true })

        await flushMicrotasks()

        expect(assignedChain._state.value).to.eql({ assigned: true })
        expect(deletedChain._state.value).to.eql({ keep: true })
        expect(clearedChain._state.value).to.be(null)
    })

    it("turns synchronous and promised primitive intermediates into Error", async () => {
        const deferredBranch = deferred()
        const root = { branch: 7 }
        const pendingRoot = { branch: deferredBranch.promise }

        deletePath(new Chain(root), ["branch", "x"])
        deletePath(new Chain(pendingRoot), ["branch", "x"])

        deferredBranch.resolve(7)
        await flushMicrotasks()

        for (const value of [root.branch, pendingRoot.branch]) {
            expect(value instanceof Error).to.be(true)
            expect(value.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
    })

    it("is a no-op when deleting through a rejected intermediate promise", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        deletePath(new Chain(root), ["branch", "value"])

        deferredBranch.reject("delete blocked")
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("delete blocked")
    })

})
