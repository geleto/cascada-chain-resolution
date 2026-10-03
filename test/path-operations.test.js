import * as arrayViews from "../src/array-view.js"
import {
    Chain,
    assignPath,
    deletePath,
    export as exportValue,
    lookupPath,
    managedStateClass,
    import as importValue,
    hasError,
    run,
    Execution,
} from "../src/index.js"
import { failExecution as submitFatal } from "../src/error.js"
import { getPromiseVersion } from "../src/property-versions.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { logicalArrayValues, expect, errorCause, readPath, deferred, flushMicrotasks, thrownBy } from "./support.js"

describe("path assignment", () => {
    it("replaces the root for an empty assignment path", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { old: true }
        const replacement = { next: true }
        const chain = new Chain(root, testContext)

        const result = assignPath(chain, [], replacement, { ...testContext, errorContext: "test assignment" })

        expect(result).to.be(undefined)
        expect(chain._state.value).to.be(replacement)
        expect(root).to.eql({ old: true })
    })

    it("mutates an owned branch in place", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const pos = root.pos
        const delta = root.delta

        const result = assignPath(new Chain(root, testContext), ["pos", "x"], 2, { ...testContext, errorContext: "test assignment" })

        expect(result).to.be(undefined)
        expect(root.pos).to.be(pos)
        expect(root.delta).to.be(delta)
        expect(root.pos.x).to.be(2)
    })

    it("creates and deletes missing __proto__ data without touching prototypes", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        const value = { safe: true }
        const chain = new Chain(root, testContext)

        expect(assignPath(chain, ["__proto__"], value, { ...testContext, errorContext: "test assignment" })).to.be(undefined)

        const descriptor = Object.getOwnPropertyDescriptor(root, "__proto__")
        expect(descriptor.value).to.be(value)
        expect(descriptor.enumerable).to.be(true)
        expect(descriptor.writable).to.be(true)
        expect(descriptor.configurable).to.be(true)
        expect(readPath(chain, ["__proto__"], testContext)).to.be(value)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)

        expect(deletePath(chain, ["__proto__"], { ...testContext, errorContext: "test deletion" })).to.be(undefined)
        expect(deletePath(chain, ["__proto__"], { ...testContext, errorContext: "test deletion" })).to.be(undefined)
        expect(Object.hasOwn(root, "__proto__")).to.be(false)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
    })

    it("stores a path-access Error at a missing intermediate __proto__", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { safe: {} }
        const chain = new Chain(root, testContext)

        assignPath(chain, ["safe", "__proto__", "polluted"], true, { ...testContext, errorContext: "test assignment" })

        const failure = readPath(chain, ["safe", "__proto__"], testContext)
        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(Object.getPrototypeOf(root.safe)).to.be(Object.prototype)
        expect({}.polluted).to.be(undefined)
    })

    it("safely resolves a promise assigned to missing __proto__", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const resolved = { safe: true }
        const root = {}
        const chain = new Chain(root, testContext)

        assignPath(chain, ["__proto__"], pending.promise, { ...testContext, errorContext: "test assignment" })
        const pendingDescriptor = Object.getOwnPropertyDescriptor(root, "__proto__")
        expect(pendingDescriptor.value).to.be(pending.promise)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)

        pending.resolve(resolved)
        await flushMicrotasks()

        const settledDescriptor = Object.getOwnPropertyDescriptor(root, "__proto__")
        expect(settledDescriptor.value).to.be(resolved)
        expect(readPath(chain, ["__proto__"], testContext)).to.be(resolved)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
    })

    it("shadows own non-enumerable __proto__ in a materialized copy", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const hidden = { safe: true }
        const root = {}
        Object.defineProperty(root, "__proto__", {
            value: hidden,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        const replacement = { replacement: true }
        const chain = new Chain(root, testContext)

        expect(assignPath(chain, ["__proto__"], replacement, { ...testContext, errorContext: "test assignment" })).to.be(undefined)
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
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { other: { x: 1 } }
        const protoValue = { safe: true }
        Object.defineProperty(root, "__proto__", {
            value: protoValue,
            enumerable: true,
            writable: true,
            configurable: true,
        })

        importValue(root, { ...testContext, errorContext: "copy proto import" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["other", "x"], 2, { ...testContext, errorContext: "test assignment" })
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
        expect(lookupPath(new Chain(next, testContext), ["__proto__"], testContext)).to.be(protoValue)
        expect({}.safe).to.be(undefined)
    })

    it("preserves promise-valued __proto__ data safely during COW", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const resolved = { safe: true }
        const root = { other: { x: 1 } }
        Object.defineProperty(root, "__proto__", {
            value: deferredValue.promise,
            enumerable: true,
            writable: true,
            configurable: true,
        })

        importValue(root, { ...testContext, errorContext: "copy proto promise import" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["other", "x"], 2, { ...testContext, errorContext: "test assignment" })
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
        expect(lookupPath(new Chain(next, testContext), ["__proto__"], testContext)).to.be(resolved)
        expect({}.safe).to.be(undefined)
    })

    it("marks a shared promise-valued __proto__ result", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const resolved = { x: 1 }
        const root = { other: { x: 1 } }
        Object.defineProperty(root, "__proto__", {
            value: deferredValue.promise,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        const chain = new Chain(root, testContext)

        lookupPath(chain, [], testContext)
        assignPath(chain, ["other", "x"], 2, { ...testContext, errorContext: "test assignment" })
        deferredValue.resolve(resolved)
        await flushMicrotasks()

        const resolvedChain = new Chain(resolved, testContext)
        assignPath(resolvedChain, ["x"], 3, { ...testContext, errorContext: "test assignment" })

        expect(resolved.x).to.be(1)
        expect(resolvedChain._state.value).not.to.be(resolved)
        expect(resolvedChain._state.value.x).to.be(3)
        expect(Object.getOwnPropertyDescriptor(chain._state.value, "__proto__").value).to.be(resolved)
    })

    it("mutates and deletes an existing own enumerable __proto__ property", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        const initial = { x: 1 }
        const replacement = { x: 2 }
        Object.defineProperty(root, "__proto__", {
            value: initial,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        const chain = new Chain(root, testContext)

        assignPath(chain, ["__proto__", "x"], 3, { ...testContext, errorContext: "test assignment" })
        assignPath(chain, ["__proto__"], replacement, { ...testContext, errorContext: "test assignment" })

        expect(initial.x).to.be(3)
        expect(lookupPath(chain, ["__proto__"], testContext)).to.be(replacement)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)

        deletePath(chain, ["__proto__"], { ...testContext, errorContext: "test deletion" })
        expect(Object.prototype.hasOwnProperty.call(root, "__proto__")).to.be(false)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
    })

    it("copy-on-writes through imported enumerable __proto__ data", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        const protoValue = { x: 1 }
        Object.defineProperty(root, "__proto__", {
            value: protoValue,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        importValue(root, { ...testContext, errorContext: "proto path COW" })
        const chain = new Chain(root, testContext)

        assignPath(chain, ["__proto__", "x"], 2, { ...testContext, errorContext: "test assignment" })
        const copy = chain._state.value
        const copiedProtoValue = readPath(chain, ["__proto__"], testContext)

        expect(copy).not.to.be(root)
        expect(copiedProtoValue).not.to.be(protoValue)
        expect(protoValue.x).to.be(1)
        expect(copiedProtoValue.x).to.be(2)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
        expect(Object.getPrototypeOf(copy)).to.be(Object.prototype)
    })

    it("treats non-enumerable properties as absent graph placements", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const hidden = { x: 1 }
        const root = {}
        Object.defineProperty(root, "hidden", {
            value: hidden,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        const assignedChain = new Chain(root, testContext)
        const nestedChain = new Chain(root, testContext)
        const deletedChain = new Chain(root, testContext)
        const assigned = assignPath(assignedChain, ["hidden"], 2, { ...testContext, errorContext: "test assignment" })
        const nestedAssigned = assignPath(nestedChain, ["hidden", "x"], 2, { ...testContext, errorContext: "test assignment" })
        const deleted = deletePath(deletedChain, ["hidden"], { ...testContext, errorContext: "test deletion" })

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
        const arrayChain = new Chain(array, testContext)
        const arrayAssigned = assignPath(arrayChain, ["hidden"], 2, { ...testContext, errorContext: "test assignment" })
        expect(arrayAssigned.message).to.be(
            "Arrays support only indexes and length",
        )
        expect(arrayChain._state.value).to.be(arrayAssigned)
        expect(array.hidden).to.be(1)
    })

    it("materializes own accessors but safely shadows inherited blockers", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
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
        managedStateClass(InheritedState)
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

        const accessorChain = new Chain(accessor, testContext)
        expect(assignPath(accessorChain, ["value"], 2, { ...testContext, errorContext: "test assignment" })).to.be(undefined)
        const inheritedChain = new Chain(inherited, testContext)
        assignPath(inheritedChain, ["locked"], 2, { ...testContext, errorContext: "test assignment" })
        assignPath(inheritedChain, ["hook"], 3, { ...testContext, errorContext: "test assignment" })

        expect(accessorChain._state.value).not.to.be(accessor)
        expect(accessorChain._state.value.value).to.be(2)
        expect(ownSetterCalls).to.be(0)
        expect(inheritedSetterCalls).to.be(0)
        expect(Object.getOwnPropertyDescriptor(inherited, "locked").value).to.be(2)
        expect(Object.getOwnPropertyDescriptor(inherited, "hook").value).to.be(3)
        expect(prototype.locked).to.be(1)
    })

    it("shadows non-enumerable properties after COW", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const hidden = { x: 1 }
        const root = {}
        Object.defineProperty(root, "hidden", {
            value: hidden,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        importValue(root, { ...testContext, errorContext: "hidden import" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["hidden"], 2, { ...testContext, errorContext: "test assignment" })
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(root.hidden).to.be(hidden)
        expect(Object.prototype.propertyIsEnumerable.call(root, "hidden")).to.be(false)
        expect(next.hidden).to.be(2)
        expect(Object.prototype.propertyIsEnumerable.call(next, "hidden")).to.be(true)
    })

    it("exposes Array length and applies ArraySetLength semantics", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = [1, 2, 3]
        const chain = new Chain(root, testContext)

        expect(lookupPath(chain, ["length"], testContext)).to.be(3)

        expect(assignPath(chain, ["length"], 1, { ...testContext, errorContext: "test assignment" })).to.be(undefined)
        const deleted = deletePath(chain, ["length"], { ...testContext, errorContext: "test deletion" })

        expect(deleted instanceof Error).to.be(true)
        expect(chain._state.value).to.be(deleted)
        expect(root).to.eql([1, 2, 3])
    })

    it("treats Array length reflection failures as language Errors", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("length reflection failed")
        const target = [1, 2]
        const array = new Proxy(target, {
            get(value, key, receiver) {
                if (key === "length") throw failure
                return Reflect.get(value, key, receiver)
            },
        })
        let observed
        let mutation
        let chain
        observed = lookupPath(new Chain(array, testContext), ["length"], testContext)
        chain = new Chain(array, testContext)
        mutation = assignPath(chain, ["length"], 1, { ...testContext, errorContext: "test assignment" })

        expect(errorCause(observed)).to.be(failure)
        expect(errorCause(mutation)).to.be(failure)
        expect(chain._state.value).to.be(mutation)
        expect(target).to.eql([1, 2])
    })

    it("turns physical property traps into mutation poison", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cases = [
            {
                target: { value: 1 },
                handler: {
                    set() {
                        throw new Error("set failed")
                    },
                },
                mutate: chain => assignPath(chain, ["value"], 2, { ...testContext, errorContext: "test assignment" }),
                message: "set failed",
            },
            {
                target: {},
                handler: {
                    defineProperty() {
                        throw new Error("definition failed")
                    },
                },
                mutate: chain => assignPath(chain, ["value"], 2, { ...testContext, errorContext: "test assignment" }),
                message: "definition failed",
            },
            {
                target: { value: 1 },
                handler: {
                    deleteProperty() {
                        throw new Error("deletion failed")
                    },
                },
                mutate: chain => deletePath(chain, ["value"], { ...testContext, errorContext: "test deletion" }),
                message: "deletion failed",
            },
        ]

        for (const { target, handler, mutate, message } of cases) {
            const chain = new Chain(new Proxy(target, handler), testContext)
            const result = mutate(chain)

            expect(result.message).to.be(message)
            expect(lookupPath(chain, ["value"], testContext)).to.be(result)
        }
    })

    it("copies an Array before applying a length write", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("length write failed")
        const target = [1, 2]
        const array = new Proxy(target, {
            set(value, key, next, receiver) {
                if (key === "length") throw failure
                return Reflect.set(value, key, next, receiver)
            },
        })
        const chain = new Chain(array, testContext)

        const result = assignPath(chain, ["length"], 1, { ...testContext, errorContext: "test assignment" })

        expect(result).to.be(undefined)
        expect(exportValue(chain, [], testContext)).to.eql([1])
        expect(target).to.eql([1, 2])
    })

    it("attributes intrinsic errors to an imported receiver", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = importValue([1], { ...testContext, errorContext: "intrinsic receiver" })

        const deletion = deletePath(new Chain(source, testContext), ["length"], { ...testContext, errorContext: "test deletion" })
        const mutation = run(
            new Chain(source, testContext),
            ["length"],
            "push",
            [2],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 1 },
        )

        expect(deletion.message).to.be("Cannot delete length")
        expect(deletion.errorContext).to.be("test deletion")
        expect(mutation.message).to.be(
            "run cannot use an Array or String length property as a mutation receiver",
        )
        expect(mutation.errorContext).to.be("test run")
        expect(source).to.eql([1])
    })

    it("poisons intrinsic targets without changing imported data", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = importValue({
            values: [1, 2],
            text: "abc",
        }, { ...testContext, errorContext: "nested intrinsic" })
        const operations = [
            chain => deletePath(chain, ["values", "length"], { ...testContext, errorContext: "test deletion" }),
            chain => run(
                chain,
                ["values", "length"],
                "push",
                [3],
                { ...testContext, errorContext: "test run" },
                { repair: false, mutationScopeDepth: 2 },
            ),
            chain => assignPath(chain, ["text", "length"], 1, { ...testContext, errorContext: "test assignment" }),
            chain => assignPath(chain, ["values", "name"], 1, { ...testContext, errorContext: "test assignment" }),
        ]

        for (const operation of operations) {
            const chain = new Chain(source, testContext)

            expect(operation(chain)).to.be.an(Error)
            expect(readPath(chain, [], testContext)).not.to.be(source)
            expect(hasError(chain, [], testContext)).to.be(true)
            expect(source.values).to.eql([1, 2])
            expect(source.text).to.be("abc")
        }
    })

    it("treats intermediate Array length as a primitive path", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { values: [1, 2] }
        const chain = new Chain(root, testContext)

        const failure = thrownBy(() => {
            assignPath(chain, ["values", "length", "x"], 1, { ...testContext, errorContext: "test assignment" })
        })

        expect(failure).to.be(undefined)
        expect(chain._state.value).to.be(root)
        expect(root.values instanceof Error).to.be(true)
        const observed = lookupPath(chain, ["values", "length", "x"], testContext)
        expect(observed instanceof Error).to.be(true)
        expect(observed.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("grows Array length with holes and poisons invalid lengths", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = [1]
        const chain = new Chain(root, testContext)

        expect(assignPath(chain, ["length"], 3, { ...testContext, errorContext: "test assignment" })).to.be(undefined)
        expect(root.length).to.be(1)
        expect(Object.keys(exportValue(chain, [], testContext))).to.eql(["0"])
        expect(lookupPath(chain, ["length"], testContext)).to.be(3)

        const error = assignPath(chain, ["length"], 1.5, { ...testContext, errorContext: "test assignment" })
        expect(error instanceof Error).to.be(true)
        expect(chain._state.value).to.be(error)
        expect(root.length).to.be(1)
    })

    it("materializes before a restricted Array shrink", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = [0, 1, 2]
        Object.defineProperty(root, "1", {
            value: 1,
            enumerable: true,
            writable: true,
            configurable: false,
        })
        const chain = new Chain(root, testContext)

        const result = assignPath(chain, ["length"], 0, { ...testContext, errorContext: "test assignment" })

        expect(result).to.be(undefined)
        expect(chain._state.value).to.eql([])
        expect(chain._state.value).not.to.be(root)
        expect(root).to.eql([0, 1, 2])
        verifyRefCounts(testContext, chain._state.value)
    })

    it("materializes a non-writable native Array length", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = [1, 2]
        Object.defineProperty(root, "length", { writable: false })
        const chain = new Chain(root, testContext)

        const result = assignPath(chain, ["length"], 1, { ...testContext, errorContext: "test assignment" })

        expect(result).to.be(undefined)
        expect(chain._state.value).to.eql([1])
        expect(chain._state.value).not.to.be(root)
        expect(root).to.eql([1, 2])
    })

    it("gates a Promise-converted Array length before later mutations", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const length = deferred()
        const chain = new Chain([1, 2, 3], testContext)

        expect(assignPath(chain, ["length"], length.promise, { ...testContext, errorContext: "test assignment" })).to.be(undefined)
        expect(readPath(chain, [], testContext) instanceof Promise).to.be(true)
        assignPath(chain, ["0"], 9, { ...testContext, errorContext: "test assignment" })

        length.resolve(1)
        await flushMicrotasks()

        expect(await exportValue(chain, [], testContext)).to.eql([9])
        verifyRefCounts(testContext, chain._state.value)
    })

    it("abandons late Array-length conversion after a fatal branch", async () => {
        let testContext
        let reported
        testContext = { execution: new Execution(error => {
            reported ??= error
        }), errorContext: "test operation" }
        const failing = deferred()
        const late = deferred()
        let fail = false
        const broken = new Proxy([1], {
            getOwnPropertyDescriptor(target, key) {
                if (fail) submitFatal(testContext, new Error("conversion failed"))
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        importValue(broken, { ...testContext, errorContext: "prepared fatal conversion value" })
        fail = true
        const chain = new Chain([1, 2, 3], testContext)
        const input = [failing.promise, late.promise]
        assignPath(chain, ["length"], input, { ...testContext, errorContext: "test assignment" })
        failing.resolve(broken)
        await flushMicrotasks()

        let reflected = false
        const lateValue = new Proxy([1], {
            getOwnPropertyDescriptor(target, key) {
                reflected = true
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        late.resolve(lateValue)
        await flushMicrotasks()

        expect(reported?.message).to.be("conversion failed")
        expect(reflected).to.be(false)
        expect(getPromiseVersion(input, "1", testContext).value).to.be(late.promise)
    })

    it("keeps deferred Array length on its captured receiver version", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const receiver = deferred()
        const root = { values: receiver.promise }
        const chain = new Chain(root, testContext)

        assignPath(chain, ["values", "length"], 1, { ...testContext, errorContext: "test assignment" })
        const replacement = [9, 8, 7]
        assignPath(chain, ["values"], replacement, { ...testContext, errorContext: "test assignment" })

        receiver.resolve([1, 2, 3])
        await flushMicrotasks()

        expect(root.values).to.be(replacement)
        expect(replacement).to.eql([9, 8, 7])
        verifyRefCounts(testContext, root)
    })

    it("copy-on-writes a Promise-converted imported Array length", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const length = deferred()
        const source = importValue({ values: [1, 2, 3] }, { ...testContext, errorContext: "imported length" })
        const chain = new Chain(source, testContext)

        expect(assignPath(
            chain,
            ["values", "length"],
            length.promise,
            { ...testContext, errorContext: "test assignment" },
        )).to.be(undefined)
        expect(chain._state.value).not.to.be(source)
        expect(readPath(chain, ["values"], testContext) instanceof Promise).to.be(true)
        expect(source).to.eql({ values: [1, 2, 3] })

        length.resolve(1)
        await flushMicrotasks()

        expect(source).to.eql({ values: [1, 2, 3] })
        expect(exportValue(chain, [], testContext)).to.eql({ values: [1] })
        verifyRefCounts(testContext, source, chain._state.value)
    })

    it("retains a Promise assigned to an ordinary length property", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const length = deferred()
        const root = { length: 0 }
        const chain = new Chain(root, testContext)

        expect(assignPath(chain, ["length"], length.promise, { ...testContext, errorContext: "test assignment" })).to.be(undefined)
        expect(chain._state.value).to.be(root)
        expect(root.length).to.be(length.promise)

        length.resolve(3)
        await flushMicrotasks()

        expect(chain._state.value).to.be(root)
        expect(root.length).to.be(3)
    })

    it("retains a Promise length payload after its object receiver resolves", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const receiver = deferred()
        const length = deferred()
        const root = { target: receiver.promise }
        const chain = new Chain(root, testContext)

        expect(assignPath(
            chain,
            ["target", "length"],
            length.promise,
            { ...testContext, errorContext: "test assignment" },
        )).to.be(undefined)

        const target = { length: 0 }
        receiver.resolve(target)
        await flushMicrotasks()

        const assigned = await readPath(chain, ["target"], testContext)
        expect(assigned.length).to.be(length.promise)

        length.resolve(4)
        await flushMicrotasks()
        expect(assigned.length).to.be(4)
        expect(target.length).to.be(4)
    })

    it("rejects String length assignment without waiting for its payload", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const length = deferred()
        const chain = new Chain("abc", testContext)

        const result = assignPath(chain, ["length"], length.promise, { ...testContext, errorContext: "test assignment" })

        expect(result instanceof Error).to.be(true)
        expect(chain._state.value).to.be(result)
        length.resolve(1)
    })

    it("shrinks ArrayView bounds and materializes before regrowth", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const sourceChain = new Chain([1, 2, 3], testContext)
        const view = run(sourceChain, [], "push", [4], { ...testContext, errorContext: "test run" }, { repair: false })
        const viewChain = new Chain(view, testContext)

        assignPath(viewChain, ["length"], 2, { ...testContext, errorContext: "test assignment" })
        expect(exportValue(viewChain, [], testContext)).to.eql([1, 2])
        expect(exportValue(sourceChain, [], testContext)).to.eql([1, 2, 3])

        assignPath(viewChain, ["length"], 4, { ...testContext, errorContext: "test assignment" })
        const grown = exportValue(viewChain, [], testContext)
        expect(grown.length).to.be(4)
        expect(Object.keys(grown)).to.eql(["0", "1"])
        expect(exportValue(sourceChain, [], testContext)).to.eql([1, 2, 3])
        verifyRefCounts(testContext, viewChain._state.value)
    })

    it("materializes a restricted ArrayView shrink", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = [0, 1, 2]
        Object.defineProperty(source, "1", {
            value: 1,
            enumerable: true,
            writable: true,
            configurable: false,
        })
        const sourceChain = new Chain(source, testContext)
        const view = run(sourceChain, [], "push", [3], { ...testContext, errorContext: "test run" }, { repair: false })
        const chain = new Chain(view, testContext)

        const result = assignPath(chain, ["length"], 0, { ...testContext, errorContext: "test assignment" })

        expect(result).to.be(undefined)
        expect(chain._state.value).not.to.be(view)
        expect(exportValue(chain, [], testContext)).to.eql([])
        expect(arrayViews.ArrayView.minimumLength(view, testContext)).to.be(4)
        expect([...logicalArrayValues(view, testContext)]).to.eql([0, 1, 2, 3])
        expect(exportValue(sourceChain, [], testContext)).to.eql([0, 1, 2])
        verifyRefCounts(testContext, view, source)
    })

    it("exposes read-only String length", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const chain = new Chain("abc", testContext)

        expect(lookupPath(chain, ["length"], testContext)).to.be(3)
        const assigned = assignPath(chain, ["length"], 1, { ...testContext, errorContext: "test assignment" })
        expect(assigned instanceof Error).to.be(true)
        expect(chain._state.value).to.be(assigned)

        const deletedChain = new Chain("abc", testContext)
        const deleted = deletePath(deletedChain, ["length"], { ...testContext, errorContext: "test deletion" })
        expect(deleted instanceof Error).to.be(true)
        expect(deletedChain._state.value).to.be(deleted)
    })

    it("can shadow inherited properties", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}

        assignPath(new Chain(root, testContext), ["constructor"], 2, { ...testContext, errorContext: "test assignment" })

        expect(root.constructor).to.be(2)
        expect(Object.prototype.propertyIsEnumerable.call(root, "constructor")).to.be(true)
    })

    it("copies only an escaped branch", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const rootChain = new Chain(root, testContext)
        const oldPos = lookupPath(rootChain, ["pos"], testContext)
        const retained = new Chain(oldPos, testContext)
        const oldDelta = root.delta

        assignPath(rootChain, ["pos", "x"], 2, { ...testContext, errorContext: "test assignment" })
        assignPath(rootChain, ["delta", "x"], 5, { ...testContext, errorContext: "test assignment" })

        expect(root.pos).not.to.be(oldPos)
        expect(oldPos.x).to.be(1)
        expect(root.pos.x).to.be(2)
        expect(root.delta).to.be(oldDelta)
        expect(root.delta.x).to.be(5)
    })

    it("can read a branch without sharing ownership", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const rootChain = new Chain(root, testContext)
        const observed = readPath(rootChain, ["pos"], testContext)
        const delta = root.delta

        assignPath(rootChain, ["pos", "x"], 2, { ...testContext, errorContext: "test assignment" })

        expect(root.pos).to.be(observed)
        expect(root.pos.x).to.be(2)
        expect(root.delta).to.be(delta)
    })

    it("can read the root without sharing ownership", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { pos: { x: 1 } }
        const rootChain = new Chain(root, testContext)
        const observed = readPath(rootChain, [], testContext)
        const pos = root.pos

        assignPath(rootChain, ["pos", "x"], 2, { ...testContext, errorContext: "test assignment" })

        expect(observed).to.be(root)
        expect(root.pos).to.be(pos)
        expect(root.pos.x).to.be(2)
    })

    it("copies a shared root and marks copied children as shared", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const oldPos = root.pos
        const oldDelta = root.delta
        importValue(root, testContext)
        const chain = new Chain(root, testContext)

        assignPath(chain, ["pos", "x"], 2, { ...testContext, errorContext: "test assignment" })
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(next.pos).not.to.be(oldPos)
        expect(next.delta).to.be(oldDelta)
        expect(root.pos.x).to.be(1)
        expect(next.pos.x).to.be(2)

        assignPath(chain, ["delta", "x"], 5, { ...testContext, errorContext: "test assignment" })
        expect(chain._state.value).to.be(next)
        expect(next.delta).not.to.be(oldDelta)
        expect(oldDelta.x).to.be(3)
        expect(next.delta.x).to.be(5)
    })

    it("splits an imported DAG only along the mutated path", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = { x: 1 }
        const root = importValue({ left: child, right: child }, { ...testContext, errorContext: "DAG import" })
        const chain = new Chain(root, testContext)

        assignPath(chain, ["left", "x"], 2, { ...testContext, errorContext: "test assignment" })
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(next.left).not.to.be(child)
        expect(next.right).to.be(child)
        expect(next.left.x).to.be(2)
        expect(child.x).to.be(1)
    })

    it("tracks inherited shared state along the mutated path", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {
            b: { x: 1 },
            c: { x: 2 },
        }
        const oldB = root.b
        const oldC = root.c
        importValue(root, testContext)
        const chain = new Chain(root, testContext)

        assignPath(chain, ["b", "x"], 5, { ...testContext, errorContext: "test assignment" })
        const next = chain._state.value
        const ownedB = next.b

        expect(next.b).not.to.be(oldB)
        expect(next.c).to.be(oldC)
        expect(root.b.x).to.be(1)
        expect(next.b.x).to.be(5)

        assignPath(chain, ["b", "y"], 6, { ...testContext, errorContext: "test assignment" })
        expect(next.b).to.be(ownedB)
        expect(next.b.y).to.be(6)

        assignPath(chain, ["c", "x"], 7, { ...testContext, errorContext: "test assignment" })
        expect(next.c).not.to.be(oldC)
        expect(oldC.x).to.be(2)
        expect(next.c.x).to.be(7)
    })

    it("marks reused children while keeping the replaced path owned", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {
            a: { x: 1 },
            b: { x: 2 },
            c: { x: 3 },
        }
        importValue(root, testContext)
        const chain = new Chain(root, testContext)

        assignPath(chain, ["b"], { y: 4 }, { ...testContext, errorContext: "test assignment" })
        const next = chain._state.value
        const oldA = next.a
        const oldC = next.c
        const ownedB = next.b

        assignPath(chain, ["b", "y"], 5, { ...testContext, errorContext: "test assignment" })

        expect(next.b).to.be(ownedB)
        expect(next.b.y).to.be(5)
        expect(root.b).to.eql({ x: 2 })

        assignPath(chain, ["a", "x"], 9, { ...testContext, errorContext: "test assignment" })

        expect(next.a).not.to.be(oldA)
        expect(next.c).to.be(oldC)
        expect(oldA.x).to.be(1)
        expect(next.a.x).to.be(9)
    })

    it("does not clear the mark from an assigned shared object", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const value = importValue({ x: 1 }, testContext)
        const root = {}

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["value"], value, { ...testContext, errorContext: "test assignment" })
        assignPath(rootChain, ["value", "x"], 2, { ...testContext, errorContext: "test assignment" })

        expect(root.value).not.to.be(value)
        expect(value.x).to.be(1)
        expect(root.value.x).to.be(2)
    })

    it("copies sparse arrays without materializing holes", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = []
        root.length = 3
        root[1] = "one"
        importValue(root, testContext)
        const chain = new Chain(root, testContext)

        assignPath(chain, [2], "two", { ...testContext, errorContext: "test assignment" })
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(next.length).to.be(3)
        expect(0 in next).to.be(false)
        expect(next[1]).to.be("one")
        expect(next[2]).to.be("two")
    })

    it("uses canonical string indexes and rejects named Array keys", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = []
        const chain = new Chain(root, testContext)

        expect(assignPath(chain, ["0"], "zero", { ...testContext, errorContext: "test assignment" })).to.be(undefined)
        expect(assignPath(chain, [2], "two", { ...testContext, errorContext: "test assignment" })).to.be(undefined)
        expect(chain._state.value.length).to.be(3)
        expect(chain._state.value["0"]).to.be("zero")
        expect(1 in chain._state.value).to.be(false)
        expect(chain._state.value[2]).to.be("two")

        expect(assignPath(chain, [-0], "numeric minus zero", { ...testContext, errorContext: "test assignment" })).to.be(undefined)
        expect(chain._state.value[0]).to.be("numeric minus zero")

        for (const key of [
            "01",
            "1.0",
            "1e0",
            "-0",
            "4294967295",
            "name",
        ]) {
            const assignedChain = new Chain([], testContext)
            const deletedChain = new Chain([], testContext)
            const assigned = assignPath(assignedChain, [key], key, { ...testContext, errorContext: "test assignment" })
            const deleted = deletePath(deletedChain, [key], { ...testContext, errorContext: "test deletion" })

            expect(assigned instanceof Error).to.be(true)
            expect(deleted instanceof Error).to.be(true)
            expect(assignedChain._state.value).to.be(assigned)
            expect(deletedChain._state.value).to.be(deleted)
        }

        const hostArray = []
        hostArray.name = "host-only"
        const hostChain = new Chain(hostArray, testContext)
        const hostFailure = assignPath(hostChain, ["name"], "changed", { ...testContext, errorContext: "test assignment" })
        expect(hostFailure instanceof Error).to.be(true)
        expect(hostChain._state.value).to.be(hostFailure)
        expect(hostArray.name).to.be("host-only")

        const imported = importValue([], { ...testContext, errorContext: "indexed growth" })
        const invalidImportedChain = new Chain(imported, testContext)
        const invalid = assignPath(
            invalidImportedChain,
            ["name"],
            "value",
            { ...testContext, errorContext: "test assignment" },
        )
        expect(invalid.message).to.be("Arrays support only indexes and length")
        expect(invalid.errorContext).to.be("test assignment")
        const importedChain = new Chain(imported, testContext)
        expect(assignPath(importedChain, ["2"], "value", { ...testContext, errorContext: "test assignment" })).to.be(undefined)
        expect(importedChain._state.value).not.to.be(imported)
        expect(imported.length).to.be(0)
        expect(importedChain._state.value.length).to.be(3)
        expect(1 in importedChain._state.value).to.be(false)
        expect(importedChain._state.value[2]).to.be("value")
    })

    it("copies frozen arrays before mutating nested values", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = { x: 1 }
        const root = Object.freeze([child])
        importValue(root, { ...testContext, errorContext: "frozen nested mutation" })
        const chain = new Chain(root, testContext)

        assignPath(chain, [0, "x"], 2, { ...testContext, errorContext: "test assignment" })
        const next = chain._state.value

        expect(Array.isArray(next)).to.be(true)
        expect(next).not.to.be(root)
        expect(next[0]).not.to.be(child)
        expect(next[0].x).to.be(2)
        expect(child.x).to.be(1)
    })

    it("can replace an Error at the target key", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { value: new Error("old") }

        assignPath(new Chain(root, testContext), ["value"], 42, { ...testContext, errorContext: "test assignment" })

        expect(root.value).to.be(42)
    })

    it("turns every missing or primitive intermediate into Error", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { old: 7, nothing: null, unset: undefined }

        const rootChain = new Chain(root, testContext)
        const missingResult = assignPath(
            rootChain,
            ["new", "value"],
            1,
            { ...testContext, errorContext: "test assignment" },
        )
        assignPath(rootChain, ["old", "value"], 2, { ...testContext, errorContext: "test assignment" })
        assignPath(rootChain, ["nothing", "value"], 3, { ...testContext, errorContext: "test assignment" })
        assignPath(rootChain, ["unset", "value"], 4, { ...testContext, errorContext: "test assignment" })

        for (const value of [root.new, root.old, root.nothing, root.unset]) {
            expect(value instanceof Error).to.be(true)
            expect(value.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
        expect(missingResult).to.be(root.new)
    })

    it("copies a shared branch before installing a path Error", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = importValue({ keep: true }, { ...testContext, errorContext: "shared broken path" })
        const chain = new Chain(root, testContext)

        assignPath(chain, ["missing", "value"], 1, { ...testContext, errorContext: "test assignment" })

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
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const nullChain = new Chain(null, testContext)
        const undefinedChain = new Chain(undefined, testContext)
        const numberChain = new Chain(7, testContext)
        const stringChain = new Chain("text", testContext)

        assignPath(nullChain, ["value"], 1, { ...testContext, errorContext: "test assignment" })
        assignPath(undefinedChain, ["value"], 1, { ...testContext, errorContext: "test assignment" })
        assignPath(numberChain, ["value"], 1, { ...testContext, errorContext: "test assignment" })
        assignPath(stringChain, ["value"], 1, { ...testContext, errorContext: "test assignment" })

        for (const chain of [nullChain, undefinedChain, numberChain, stringChain]) {
            expect(chain._state.value instanceof Error).to.be(true)
            expect(chain._state.value.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
    })

    it("is a no-op when assigning through an Error root or Error branch", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const errorRoot = new Error("root")
        const root = { branch: new Error("branch") }
        const chain = new Chain(errorRoot, testContext)

        const rootResult = assignPath(chain, ["value"], 1, { ...testContext, errorContext: "test assignment" })
        const branchResult = assignPath(
            new Chain(root, testContext),
            ["branch", "value"],
            1,
            { ...testContext, errorContext: "test assignment" },
        )

        expect(errorCause(rootResult)).to.be(errorRoot)
        expect(errorCause(branchResult)).to.be(root.branch)
        expect(chain._state.value).to.be(rootResult)
        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("branch")
    })
})

describe("lookupPath", () => {
    it("marks the root as shared by default", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { pos: { x: 1 } }
        const oldPos = root.pos

        const value = lookupPath(new Chain(root, testContext), [], testContext)
        const chain = new Chain(root, testContext)
        assignPath(chain, ["pos", "x"], 2, { ...testContext, errorContext: "test assignment" })
        const next = chain._state.value

        expect(value).to.be(root)
        expect(next).not.to.be(root)
        expect(next.pos).not.to.be(oldPos)
        expect(root.pos.x).to.be(1)
        expect(next.pos.x).to.be(2)
    })

    it("returns Error roots and Error branches", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const errorRoot = new Error("root")
        const branchError = new Error("branch")
        const root = { branch: branchError }

        expect(errorCause(lookupPath(new Chain(errorRoot, testContext), ["value"], testContext)))
            .to.be(errorRoot)
        expect(errorCause(lookupPath(new Chain(root, testContext), ["branch", "value"], testContext)))
            .to.be(branchError)
    })

    it("allows missing targets but returns Error for broken paths", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { branch: {} }

        for (const value of [7, null, undefined]) {
            const result = lookupPath(new Chain(value, testContext), ["value"], testContext)
            expect(result instanceof Error).to.be(true)
            expect(result.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
        const rootChain = new Chain(root, testContext)
        expect(lookupPath(rootChain, ["branch", "missing"], testContext)).to.be(undefined)
        const broken = lookupPath(rootChain, ["branch", "missing", "value"], testContext)
        expect(broken instanceof Error).to.be(true)
        expect(broken.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(lookupPath(new Chain({ value: undefined }, testContext), ["value"], testContext)).to.be(undefined)
    })

    it("does not read inherited object properties", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        expect(lookupPath(new Chain({}, testContext), ["constructor"], testContext)).to.be(undefined)
        const broken = lookupPath(new Chain({}, testContext), ["constructor", "name"], testContext)
        expect(broken instanceof Error).to.be(true)
        expect(broken.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("reads only own enumerable data properties", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
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

        const rootChain = new Chain(root, testContext)
        expect(lookupPath(rootChain, ["__proto__"], testContext)).to.be(root.__proto__)
        expect(lookupPath(rootChain, ["__proto__", "unsafe"], testContext)).to.be(true)
        expect(lookupPath(new Chain({}, testContext), ["__proto__"], testContext)).to.be(undefined)
        expect(lookupPath(rootChain, ["hidden"], testContext)).to.be(undefined)
        expect(lookupPath(rootChain, ["accessor"], testContext)).to.be(undefined)
        expect(getterCalls).to.be(0)
        for (const path of [["hidden", "x"], ["accessor", "x"]]) {
            const result = lookupPath(rootChain, path, testContext)
            expect(result instanceof Error).to.be(true)
            expect(result.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
        expect(getterCalls).to.be(0)
    })

    it("supports primitive roots for empty lookup paths", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        expect(lookupPath(new Chain(7, testContext), [], testContext)).to.be(7)
        expect(lookupPath(new Chain("text", testContext), [], testContext)).to.be("text")
        expect(lookupPath(new Chain(null, testContext), [], testContext)).to.be(null)
        expect(lookupPath(new Chain(undefined, testContext), [], testContext)).to.be(undefined)
    })

})

describe("deletePath", () => {
    it("replaces the root with null and returns nothing for an empty path", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { value: 1 }
        const chain = new Chain(root, testContext)

        const result = deletePath(chain, [], { ...testContext, errorContext: "test deletion" })

        expect(result).to.be(undefined)
        expect(chain._state.value).to.be(null)
        expect(root).to.eql({ value: 1 })
    })

    it("turns deletion through missing or primitive roots into Error", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const values = [null, undefined, 7, "text"]
        for (const value of values) {
            const chain = new Chain(value, testContext)
            const result = deletePath(chain, ["value"], { ...testContext, errorContext: "test deletion" })
            expect(result instanceof Error).to.be(true)
            expect(chain._state.value).to.be(result)
            expect(chain._state.value instanceof Error).to.be(true)
            expect(chain._state.value.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
    })

    it("allows deletion of a missing target property", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { keep: true }

        deletePath(new Chain(root, testContext), ["missing"], { ...testContext, errorContext: "test deletion" })

        expect(root).to.eql({ keep: true })
    })

    it("deletes from a copied branch without changing the escaped branch", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { config: { keep: true, remove: true } }
        const rootChain = new Chain(root, testContext)
        const oldConfig = lookupPath(rootChain, ["config"], testContext)
        const retained = new Chain(oldConfig, testContext)

        deletePath(rootChain, ["config", "remove"], { ...testContext, errorContext: "test deletion" })

        expect(oldConfig).to.eql({ keep: true, remove: true })
        expect(root.config).to.eql({ keep: true })
        expect(root.config).not.to.be(oldConfig)
    })

    it("treats deletion of a non-enumerable property as a no-op", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const hidden = { x: 1 }
        const root = { keep: true }
        Object.defineProperty(root, "hidden", {
            value: hidden,
            enumerable: false,
            writable: true,
            configurable: true,
        })
        importValue(root, { ...testContext, errorContext: "hidden delete import" })
        const chain = new Chain(root, testContext)

        deletePath(chain, ["hidden"], { ...testContext, errorContext: "test deletion" })
        const next = chain._state.value

        expect(next).to.be(root)
        expect(root.hidden).to.be(hidden)
        expect(Object.prototype.propertyIsEnumerable.call(root, "hidden")).to.be(false)
    })

    it("ignores a hidden property during a suspended imported delete", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const external = { keep: true }
        Object.defineProperty(external, "hidden", {
            value: { x: 1 },
            enumerable: false,
            writable: true,
            configurable: true,
        })
        const chain = new Chain({}, testContext)

        assignPath(
            chain,
            ["branch"],
            importValue(pending.promise, { ...testContext, errorContext: "hidden async delete" }),
            { ...testContext, errorContext: "test assignment" },
        )
        const result = deletePath(chain, ["branch", "hidden"], { ...testContext, errorContext: "test deletion" })

        expect(result).to.be(undefined)
        pending.resolve(external)
        await flushMicrotasks()

        expect(chain._state.value.branch).to.be(external)
        expect(external.hidden).to.eql({ x: 1 })
    })

    it("can delete an Error at the target key", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { value: new Error("old") }

        deletePath(new Chain(root, testContext), ["value"], { ...testContext, errorContext: "test deletion" })

        expect(root).to.eql({})
    })

    it("is a no-op when deleting through an Error root or Error branch", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const errorRoot = new Error("root")
        const branchError = new Error("branch")
        const root = { branch: branchError }
        const chain = new Chain(errorRoot, testContext)

        deletePath(chain, ["value"], { ...testContext, errorContext: "test deletion" })
        deletePath(new Chain(root, testContext), ["branch", "value"], { ...testContext, errorContext: "test deletion" })

        expect(errorCause(chain._state.value)).to.be(errorRoot)
        expect(root.branch).to.be(branchError)
    })

    it("deletes an ordinary object length property", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { length: 2, keep: true }

        expect(deletePath(new Chain(root, testContext), ["length"], { ...testContext, errorContext: "test deletion" })).to.be(undefined)
        expect(root).to.eql({ keep: true })
    })

    it("does not delete ArrayView length", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = new Chain([1, 2], testContext)
        const view = run(source, [], "push", [3], { ...testContext, errorContext: "test run" }, { repair: false })
        const chain = new Chain(view, testContext)

        const result = deletePath(chain, ["length"], { ...testContext, errorContext: "test deletion" })

        expect(result instanceof Error).to.be(true)
        expect(chain._state.value).to.be(result)
        expect(exportValue(source, [], testContext)).to.eql([1, 2])
    })

    it("does not delete length from delayed Array or String receivers", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        for (const value of [[1, 2], "abc"]) {
            const receiver = deferred()
            const root = { value: receiver.promise }
            const length = value.length

            expect(deletePath(
                new Chain(root, testContext),
                ["value", "length"],
                { ...testContext, errorContext: "test deletion" },
            )).to.be(undefined)
            receiver.resolve(value)
            await flushMicrotasks()

            expect(root.value instanceof Error).to.be(true)
            expect(value.length).to.be(length)
        }
    })

    it("deletes array elements without changing length", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const arrayRoot = [1, 2, 3]
        const root = { list: [1, 2, 3] }
        const list = root.list
        const deferredList = deferred()
        const pendingRoot = { list: deferredList.promise }

        deletePath(new Chain(arrayRoot, testContext), [1], { ...testContext, errorContext: "test deletion" })
        deletePath(new Chain(root, testContext), ["list", 1], { ...testContext, errorContext: "test deletion" })
        deletePath(new Chain(pendingRoot, testContext), ["list", 1], { ...testContext, errorContext: "test deletion" })

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
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = {}

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["value"], deferredValue.promise, { ...testContext, errorContext: "test assignment" })
        deletePath(rootChain, ["value"], { ...testContext, errorContext: "test deletion" })

        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        expect(root).to.eql({})
    })

    it("returns immediately when assign and delete suspend", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const assigned = deferred()
        const deleted = deferred()
        const failedAssignment = deferred()
        const failedDeletion = deferred()
        const assignChain = new Chain({ branch: assigned.promise }, testContext)
        const deleteChain = new Chain({ branch: deleted.promise }, testContext)
        const failedAssignChain = new Chain({ branch: failedAssignment.promise }, testContext)
        const failedDeleteChain = new Chain({ branch: failedDeletion.promise }, testContext)

        const assignResult = assignPath(assignChain, ["branch", "x"], 1, { ...testContext, errorContext: "test assignment" })
        const deleteResult = deletePath(deleteChain, ["branch", "x"], { ...testContext, errorContext: "test deletion" })
        const failedAssignResult = assignPath(
            failedAssignChain,
            ["branch", "x"],
            1,
            { ...testContext, errorContext: "test assignment" },
        )
        const failedDeleteResult = deletePath(
            failedDeleteChain,
            ["branch", "x"],
            { ...testContext, errorContext: "test deletion" },
        )

        expect(assignResult).to.be(undefined)
        expect(deleteResult).to.be(undefined)
        expect(failedAssignResult).to.be(undefined)
        expect(failedDeleteResult).to.be(undefined)

        assigned.resolve({})
        deleted.resolve({ x: 1 })
        failedAssignment.reject("assignment failed")
        failedDeletion.reject("deletion failed")
        await flushMicrotasks()

        expect(assignChain._state.value.branch).to.eql({ x: 1 })
        expect(deleteChain._state.value.branch).to.eql({})
        expect(failedAssignChain._state.value.branch.message).to.be(
            "assignment failed",
        )
        expect(failedDeleteChain._state.value.branch.message).to.be(
            "deletion failed",
        )
    })

    it("captures mutation paths before a pending root settles", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const assignedRoot = deferred()
        const assignedChain = new Chain(assignedRoot.promise, testContext)
        const assignSegments = ["assigned"]

        assignPath(assignedChain, assignSegments, true, { ...testContext, errorContext: "test assignment" })
        assignSegments[0] = "changed"
        assignedRoot.resolve({})

        const deletedRoot = deferred()
        const deletedChain = new Chain(deletedRoot.promise, testContext)
        const deleteSegments = ["deleted"]

        deletePath(deletedChain, deleteSegments, { ...testContext, errorContext: "test deletion" })
        deleteSegments.length = 0
        deletedRoot.resolve({ keep: true, deleted: true })

        const clearedRoot = deferred()
        const clearedChain = new Chain(clearedRoot.promise, testContext)
        const clearSegments = []

        deletePath(clearedChain, clearSegments, { ...testContext, errorContext: "test deletion" })
        clearSegments.push("changed")
        clearedRoot.resolve({ keep: true })

        await flushMicrotasks()

        expect(assignedChain._state.value).to.eql({ assigned: true })
        expect(deletedChain._state.value).to.eql({ keep: true })
        expect(clearedChain._state.value).to.be(null)
    })

    it("turns synchronous and promised primitive intermediates into Error", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: 7 }
        const pendingRoot = { branch: deferredBranch.promise }

        deletePath(new Chain(root, testContext), ["branch", "x"], { ...testContext, errorContext: "test deletion" })
        deletePath(new Chain(pendingRoot, testContext), ["branch", "x"], { ...testContext, errorContext: "test deletion" })

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
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        deletePath(new Chain(root, testContext), ["branch", "value"], { ...testContext, errorContext: "test deletion" })

        deferredBranch.reject("delete blocked")
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("delete blocked")
    })

})
