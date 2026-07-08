const expect = require("expect.js")
const { spawnSync } = require("child_process")

const runtime = require("../src")
const { onResolve } = require("../src/helpers")
const {
    getRefCounter,
    getRefCounts,
    refIndexBranch,
} = require("../src/refcounts")
const { verifyRefCounts } = require("../src/verify-refcounts")

const {
    assignPath,
    deletePath,
    lookupPath,
} = runtime
const importValue = runtime.import

function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

async function flushMicrotasks(count = 8) {
    for (let i = 0; i < count; i++) {
        await Promise.resolve()
    }
}

function expectCounts(value, promiseCount, errorCount) {
    expect(getRefCounts(value)).to.eql([promiseCount, errorCount])
}

describe("promise helpers", () => {
    it("passes rejected data promises to continuations as Error values", async () => {
        const value = await onResolve(Promise.reject("data boom"), value => value)

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("data boom")
    })

    it("does not convert continuation throws into language Error values", async () => {
        const fatal = new TypeError("runtime bug")
        let caught

        try {
            await onResolve(Promise.resolve("ok"), () => {
                throw fatal
            })
        } catch (error) {
            caught = error
        }

        expect(caught).to.be(fatal)
    })
})

describe("import", () => {
    it("marks external roots as shared", () => {
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const oldPos = root.pos
        const oldDelta = root.delta

        const imported = importValue(root)
        const next = assignPath(imported, ["pos", "x"], 2)

        expect(imported).to.be(root)
        expect(next).not.to.be(root)
        expect(next.pos).not.to.be(oldPos)
        expect(next.delta).to.be(oldDelta)
        expect(root.pos.x).to.be(1)
        expect(next.pos.x).to.be(2)

        assignPath(next, ["delta", "x"], 5)

        expect(next.delta).not.to.be(oldDelta)
        expect(oldDelta.x).to.be(3)
        expect(next.delta.x).to.be(5)
    })

    it("marks resolved promise roots before returning them", async () => {
        const deferredRoot = deferred()
        const imported = importValue(deferredRoot.promise)

        deferredRoot.resolve({ branch: { x: 1 } })
        const root = await imported
        const oldBranch = root.branch
        const next = assignPath(root, ["branch", "x"], 2)

        expect(next).not.to.be(root)
        expect(next.branch).not.to.be(oldBranch)
        expect(oldBranch.x).to.be(1)
        expect(next.branch.x).to.be(2)
    })

    it("treats frozen resolved promise roots as shared for COW", async () => {
        const deferredRoot = deferred()
        const root = Object.freeze({ branch: { x: 1 } })
        const imported = importValue(deferredRoot.promise)

        deferredRoot.resolve(root)
        const value = await imported
        const next = assignPath(value, ["branch", "x"], 2)

        expect(value).to.be(root)
        expect(next).not.to.be(root)
        expect(root.branch.x).to.be(1)
        expect(next.branch.x).to.be(2)
    })

    it("treats frozen imported objects without promises as shared for COW", () => {
        const root = Object.freeze({ branch: { x: 1 } })
        const oldBranch = root.branch

        importValue(root)
        const next = assignPath(root, ["branch", "x"], 2)

        expect(next).not.to.be(root)
        expect(next.branch).not.to.be(oldBranch)
        expect(root.branch.x).to.be(1)
        expect(next.branch.x).to.be(2)
    })

    it("rescans imported objects for promise keys", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        importValue(root)
        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        const oldValue = root.value
        const next = assignPath(root, ["value", "x"], 2)

        expect(oldValue).to.eql({ x: 1 })
        expect(next).not.to.be(root)
        expect(next.value).not.to.be(oldValue)
        expect(oldValue.x).to.be(1)
        expect(next.value.x).to.be(2)
    })

    it("recursively rescans imported objects for nested promise keys", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root)
        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        const oldValue = root.nested.value
        const next = assignPath(root, ["nested", "value", "x"], 2)

        expect(oldValue).to.eql({ x: 1 })
        expect(next).not.to.be(root)
        expect(next.nested.value).not.to.be(oldValue)
        expect(oldValue.x).to.be(1)
        expect(next.nested.value.x).to.be(2)
    })

    it("can skip promise rescan", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, false)
        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        expect(root.nested.value).to.be(deferredValue.promise)

        const value = await lookupPath(root, ["nested", "value"])

        expect(value).to.eql({ x: 1 })
        expect(root.nested.value).to.be(value)
    })

    it("turns an imported rejecting promise into an Error", async () => {
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise)

        deferredValue.reject("external boom")
        const value = await imported

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("external boom")
    })

    it("turns an already-rejected imported promise into an Error", async () => {
        const value = await importValue(Promise.reject("already external boom"))

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("already external boom")
    })
})

describe("path assignment", () => {
    it("replaces the root for an empty assignment path", () => {
        const root = { old: true }
        const replacement = { next: true }

        const next = assignPath(root, [], replacement)

        expect(next).to.be(replacement)
        expect(root).to.eql({ old: true })
    })

    it("mutates an owned branch in place", () => {
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const pos = root.pos
        const delta = root.delta

        const next = assignPath(root, ["pos", "x"], 2)

        expect(next).to.be(root)
        expect(root.pos).to.be(pos)
        expect(root.delta).to.be(delta)
        expect(root.pos.x).to.be(2)
    })

    it("rejects __proto__ path segments without touching prototypes", () => {
        const root = {}
        const nested = { safe: {} }

        const assigned = assignPath(root, ["__proto__", "polluted"], true)
        const nestedAssigned = assignPath(nested, ["safe", "__proto__", "polluted"], true)
        const lookedUp = lookupPath(root, ["__proto__"])
        const deleted = deletePath(root, ["__proto__"])

        expect(assigned instanceof Error).to.be(true)
        expect(nestedAssigned instanceof Error).to.be(true)
        expect(lookedUp instanceof Error).to.be(true)
        expect(deleted instanceof Error).to.be(true)
        expect(assigned.message).to.be("Cannot use __proto__ as a path segment")
        expect({}.polluted).to.be(undefined)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
        expect(Object.prototype.hasOwnProperty.call(root, "__proto__")).to.be(false)
        expect(nested).to.eql({ safe: {} })
    })

    it("copies only an escaped branch", () => {
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const oldPos = lookupPath(root, ["pos"])
        const oldDelta = root.delta

        assignPath(root, ["pos", "x"], 2)
        assignPath(root, ["delta", "x"], 5)

        expect(root.pos).not.to.be(oldPos)
        expect(oldPos.x).to.be(1)
        expect(root.pos.x).to.be(2)
        expect(root.delta).to.be(oldDelta)
        expect(root.delta.x).to.be(5)
    })

    it("can read a branch without sharing ownership", () => {
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const observed = lookupPath(root, ["pos"], false)
        const delta = root.delta

        const next = assignPath(root, ["pos", "x"], 2)

        expect(next).to.be(root)
        expect(root.pos).to.be(observed)
        expect(root.pos.x).to.be(2)
        expect(root.delta).to.be(delta)
    })

    it("can read the root without sharing ownership", () => {
        const root = { pos: { x: 1 } }
        const observed = lookupPath(root, [], false)
        const pos = root.pos

        const next = assignPath(root, ["pos", "x"], 2)

        expect(observed).to.be(root)
        expect(next).to.be(root)
        expect(root.pos).to.be(pos)
        expect(root.pos.x).to.be(2)
    })

    it("copies a shared root and marks copied children as shared", () => {
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const oldPos = root.pos
        const oldDelta = root.delta
        importValue(root)

        const next = assignPath(root, ["pos", "x"], 2)

        expect(next).not.to.be(root)
        expect(next.pos).not.to.be(oldPos)
        expect(next.delta).to.be(oldDelta)
        expect(root.pos.x).to.be(1)
        expect(next.pos.x).to.be(2)

        const afterDelta = assignPath(next, ["delta", "x"], 5)
        expect(afterDelta).to.be(next)
        expect(next.delta).not.to.be(oldDelta)
        expect(oldDelta.x).to.be(3)
        expect(next.delta.x).to.be(5)
    })

    it("tracks inherited shared state along the mutated path", () => {
        const root = {
            b: { x: 1 },
            c: { x: 2 },
        }
        const oldB = root.b
        const oldC = root.c
        importValue(root)

        const next = assignPath(root, ["b", "x"], 5)
        const ownedB = next.b

        expect(next.b).not.to.be(oldB)
        expect(next.c).to.be(oldC)
        expect(root.b.x).to.be(1)
        expect(next.b.x).to.be(5)

        assignPath(next, ["b", "y"], 6)
        expect(next.b).to.be(ownedB)
        expect(next.b.y).to.be(6)

        assignPath(next, ["c", "x"], 7)
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

        const next = assignPath(root, ["b"], { y: 4 })
        const oldA = next.a
        const oldC = next.c
        const ownedB = next.b

        assignPath(next, ["b", "y"], 5)

        expect(next.b).to.be(ownedB)
        expect(next.b.y).to.be(5)
        expect(root.b).to.eql({ x: 2 })

        assignPath(next, ["a", "x"], 9)

        expect(next.a).not.to.be(oldA)
        expect(next.c).to.be(oldC)
        expect(oldA.x).to.be(1)
        expect(next.a.x).to.be(9)
    })

    it("does not clear the mark from an assigned shared object", () => {
        const value = importValue({ x: 1 })
        const root = {}

        assignPath(root, ["value"], value)
        assignPath(root, ["value", "x"], 2)

        expect(root.value).not.to.be(value)
        expect(value.x).to.be(1)
        expect(root.value.x).to.be(2)
    })

    it("copies sparse arrays without materializing holes", () => {
        const root = []
        root.length = 3
        root[1] = "one"
        importValue(root)

        const next = assignPath(root, [2], "two")

        expect(next).not.to.be(root)
        expect(next.length).to.be(3)
        expect(0 in next).to.be(false)
        expect(next[1]).to.be("one")
        expect(next[2]).to.be("two")
    })

    it("can replace an Error at the target key", () => {
        const root = { value: new Error("old") }

        assignPath(root, ["value"], 42)

        expect(root.value).to.be(42)
    })

    it("creates missing/null/undefined intermediates but turns primitive intermediates into Error", () => {
        const root = { old: 7, nothing: null, unset: undefined }

        assignPath(root, ["new", "value"], 1)
        assignPath(root, ["old", "value"], 2)
        assignPath(root, ["nothing", "value"], 3)
        assignPath(root, ["unset", "value"], 4)

        expect(root.new).to.eql({ value: 1 })
        expect(root.old instanceof Error).to.be(true)
        expect(root.old.message).to.be("Cannot assign into primitive value")
        expect(root.nothing).to.eql({ value: 3 })
        expect(root.unset).to.eql({ value: 4 })
    })

    it("creates an object when assigning through null or undefined roots", () => {
        const fromNull = assignPath(null, ["value"], 1)
        const fromUndefined = assignPath(undefined, ["value"], 1)

        expect(fromNull).to.eql({ value: 1 })
        expect(fromUndefined).to.eql({ value: 1 })
    })

    it("turns assignment through primitive roots into Error", () => {
        const fromNumber = assignPath(7, ["value"], 1)
        const fromString = assignPath("text", ["value"], 1)

        expect(fromNumber instanceof Error).to.be(true)
        expect(fromNumber.message).to.be("Cannot assign into primitive value")
        expect(fromString instanceof Error).to.be(true)
        expect(fromString.message).to.be("Cannot assign into primitive value")
    })

    it("is a no-op when assigning through an Error root or Error branch", () => {
        const errorRoot = new Error("root")
        const root = { branch: new Error("branch") }

        const next = assignPath(errorRoot, ["value"], 1)
        assignPath(root, ["branch", "value"], 1)

        expect(next).to.be(errorRoot)
        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("branch")
    })

})

describe("lookupPath", () => {
    it("marks the root as shared by default", () => {
        const root = { pos: { x: 1 } }
        const oldPos = root.pos

        const value = lookupPath(root, [])
        const next = assignPath(root, ["pos", "x"], 2)

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

        expect(lookupPath(errorRoot, ["value"])).to.be(errorRoot)
        expect(lookupPath(root, ["branch", "value"])).to.be(branchError)
    })

    it("returns undefined for primitive roots and missing paths", () => {
        const root = { branch: {} }

        expect(lookupPath(7, ["value"])).to.be(undefined)
        expect(lookupPath(null, ["value"])).to.be(undefined)
        expect(lookupPath(undefined, ["value"])).to.be(undefined)
        expect(lookupPath(root, ["branch", "missing"])).to.be(undefined)
        expect(lookupPath(root, ["branch", "missing", "value"])).to.be(undefined)
        expect(lookupPath({ value: undefined }, ["value"])).to.be(undefined)
    })

    it("does not read inherited object properties", () => {
        expect(lookupPath({}, ["constructor"])).to.be(undefined)
    })

    it("supports primitive roots for empty lookup paths", () => {
        expect(lookupPath(7, [])).to.be(7)
        expect(lookupPath("text", [])).to.be("text")
        expect(lookupPath(null, [])).to.be(null)
        expect(lookupPath(undefined, [])).to.be(undefined)
    })

})

describe("promise mirrors and lookupPath", () => {
    it("keeps owned promise results mutable until they escape", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(root, ["value"], deferredValue.promise)
        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        const value = root.value
        assignPath(root, ["value", "x"], 2)

        expect(root.value).to.be(value)
        expect(value.x).to.be(2)
    })

    it("writes a resolved promise back to its key", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(root, ["value"], deferredValue.promise)
        const read = lookupPath(root, ["value"])

        expect(root.value).to.be(deferredValue.promise)
        expect(typeof read.then).to.be("function")

        deferredValue.resolve({ x: 1 })
        const value = await read

        expect(root.value).to.be(value)
        expect(value).to.eql({ x: 1 })

        const wrapper = { value }
        assignPath(wrapper, ["value", "x"], 2)

        expect(wrapper.value).not.to.be(value)
        expect(value.x).to.be(1)
        expect(wrapper.value.x).to.be(2)
    })

    it("can read a promised value without sharing ownership", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(root, ["value"], deferredValue.promise)
        const read = lookupPath(root, ["value"], false)

        deferredValue.resolve({ x: 1 })
        const value = await read

        assignPath(root, ["value", "x"], 2)

        expect(root.value).to.be(value)
        expect(value.x).to.be(2)
    })

    it("preserves promises that resolve to undefined", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(root, ["value"], deferredValue.promise)
        const read = lookupPath(root, ["value"])

        deferredValue.resolve(undefined)
        const value = await read
        await flushMicrotasks()

        expect(value).to.be(undefined)
        expect(root.value).to.be(undefined)
    })

    it("applies writes to an already-settled assigned promise before writeback", async () => {
        const root = {}
        const promise = Promise.resolve({})

        assignPath(root, ["branch"], promise)
        assignPath(root, ["branch", "x"], 1)
        await flushMicrotasks()

        expect(root.branch).to.eql({ x: 1 })
    })

    it("applies pending intermediate writes in program order", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(root, ["branch", "a"], 1)
        assignPath(root, ["branch", "b"], 2)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root.branch).to.eql({ a: 1, b: 2 })
    })

    it("orders writes through two nested pending promises", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { branch: outer.promise }

        assignPath(root, ["branch", "inner", "x"], 1)
        assignPath(root, ["branch", "inner", "x"], 2)

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()
        inner.resolve({})
        await flushMicrotasks()

        expect(root.branch.inner).to.eql({ x: 2 })
    })

    it("makes a suspended lookupPath observe its own program position", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const read = lookupPath(root, ["branch"])
        assignPath(root, ["branch", "x"], 1)

        deferredBranch.resolve({})
        const readValue = await read
        await flushMicrotasks()

        expect(readValue).to.eql({})
        expect(root.branch).to.eql({ x: 1 })
        expect(root.branch).not.to.be(readValue)
    })

    it("continues lookupPath through a pending intermediate promise", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const read = lookupPath(root, ["branch", "value"])

        deferredBranch.resolve({ value: { x: 1 } })
        const value = await read

        expect(value).to.eql({ x: 1 })

        const wrapper = { value }
        assignPath(wrapper, ["value", "x"], 2)

        expect(wrapper.value).not.to.be(value)
        expect(value.x).to.be(1)
        expect(wrapper.value.x).to.be(2)
    })

    it("marks shared lookup results before later writes resume", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const read = lookupPath(root, ["branch", "value"])
        assignPath(root, ["branch", "value", "x"], 2)

        deferredBranch.resolve({ value: { x: 1 } })
        const value = await read
        await flushMicrotasks()

        expect(value).to.eql({ x: 1 })
        expect(root.branch.value).to.eql({ x: 2 })
        expect(root.branch.value).not.to.be(value)
    })

    it("marks shared nested promise lookups before later nested writes resume", async () => {
        const deferredBranch = deferred()
        const deferredValue = deferred()
        const root = { branch: deferredBranch.promise }

        const read = lookupPath(root, ["branch", "value"])
        assignPath(root, ["branch", "value", "x"], 2)

        deferredBranch.resolve({ value: deferredValue.promise })
        await flushMicrotasks()
        deferredValue.resolve({ x: 1 })
        const value = await read
        await flushMicrotasks()

        expect(value).to.eql({ x: 1 })
        expect(root.branch.value).to.eql({ x: 2 })
        expect(root.branch.value).not.to.be(value)
    })

    it("can read through a pending intermediate promise without sharing ownership", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const read = lookupPath(root, ["branch", "value"], false)

        deferredBranch.resolve({ value: { x: 1 } })
        const value = await read

        assignPath(root, ["branch", "value", "x"], 2)

        expect(root.branch.value).to.be(value)
        expect(value.x).to.be(2)
    })

    it("forks promise mirrors when a pending key is shallow-copied", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(root, ["branch", "before"], 1)
        importValue(root)

        const left = assignPath(root, ["left"], true)
        const right = assignPath(root, ["right"], true)

        assignPath(left, ["branch", "leftOnly"], 2)
        assignPath(right, ["branch", "rightOnly"], 3)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(left.branch).to.eql({ before: 1, leftOnly: 2 })
        expect(right.branch).to.eql({ before: 1, rightOnly: 3 })
        expect(left.branch).not.to.be(right.branch)
    })

    it("turns a rejected forked pending key into Error values in both worlds", async () => {
        const unhandledRejections = []
        const onUnhandledRejection = reason => {
            unhandledRejections.push(reason)
        }
        process.on("unhandledRejection", onUnhandledRejection)

        try {
            const deferredBranch = deferred()
            const root = { branch: deferredBranch.promise }

            assignPath(root, ["branch", "before"], 1)
            importValue(root)

            const left = assignPath(root, ["left"], true)
            const right = assignPath(root, ["right"], true)

            assignPath(left, ["branch", "leftOnly"], 2)
            assignPath(right, ["branch", "rightOnly"], 3)

            deferredBranch.reject("fork boom")
            await flushMicrotasks()
            await new Promise(resolve => setImmediate(resolve))

            expect(root.branch instanceof Error).to.be(true)
            expect(root.branch.message).to.be("fork boom")
            expect(left.branch instanceof Error).to.be(true)
            expect(left.branch.message).to.be("fork boom")
            expect(right.branch instanceof Error).to.be(true)
            expect(right.branch.message).to.be("fork boom")
            expect(unhandledRejections).to.eql([])
        } finally {
            process.removeListener("unhandledRejection", onUnhandledRejection)
        }
    })

    it("does not mark a final promise key replaced after a root copy", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        lookupPath(root, [])
        const next = assignPath(root, ["branch"], { replacement: true })

        deferredBranch.resolve({ x: 1 })
        await flushMicrotasks()

        const oldBranch = await lookupPath(root, ["branch"], false)
        const mutated = assignPath(oldBranch, ["x"], 2)

        expect(next.branch).to.eql({ replacement: true })
        expect(mutated).to.be(oldBranch)
        expect(oldBranch.x).to.be(2)
    })

    it("copies through a promised path key under a shared root", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        lookupPath(root, [])
        const next = assignPath(root, ["branch", "x"], 1)

        deferredBranch.resolve({ y: 2 })
        await flushMicrotasks()

        const oldBranch = await lookupPath(root, ["branch"], false)

        expect(oldBranch).to.eql({ y: 2 })
        expect(next.branch).to.eql({ y: 2, x: 1 })
        expect(next.branch).not.to.be(oldBranch)
    })

    it("turns a rejected promise into an Error value", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        const read = lookupPath(root, ["value"])
        deferredValue.reject("boom")

        const value = await read

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("boom")
        expect(root.value).to.be(value)
    })

    it("turns an assigned rejected promise into an Error value", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(root, ["value"], deferredValue.promise)
        deferredValue.reject("assigned boom")
        await flushMicrotasks()

        expect(root.value instanceof Error).to.be(true)
        expect(root.value.message).to.be("assigned boom")
    })

    it("turns an already-rejected assigned promise into an Error value", async () => {
        const root = {}

        assignPath(root, ["value"], Promise.reject("already rejected"))
        await flushMicrotasks()

        expect(root.value instanceof Error).to.be(true)
        expect(root.value.message).to.be("already rejected")
    })

    it("stops at a rejected intermediate promise instead of autovivifying", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(root, ["branch", "x"], 1)
        deferredBranch.reject("nope")
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("nope")
    })

    it("turns a promised primitive intermediate into Error", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(root, ["branch", "x"], 1)
        deferredBranch.resolve(7)
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("Cannot assign into primitive value")
    })

    it("creates an intermediate when a promise resolves to null", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(root, ["branch", "x"], 1)
        deferredBranch.resolve(null)
        await flushMicrotasks()

        expect(root.branch).to.eql({ x: 1 })
    })

    it("keeps two keys holding the same imported promise independent", async () => {
        const deferredBranch = deferred()
        const importedBranch = importValue(deferredBranch.promise)
        const root = {
            left: importedBranch,
            right: importedBranch,
        }

        assignPath(root, ["left", "x"], 1)
        assignPath(root, ["right", "y"], 2)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root.left).to.eql({ x: 1 })
        expect(root.right).to.eql({ y: 2 })
        expect(root.left).not.to.be(root.right)
    })

    it("treats re-placing the same promise as a fresh mirror", async () => {
        const deferredBranch = deferred()
        const root = {}

        assignPath(root, ["branch"], deferredBranch.promise)
        const firstRead = lookupPath(root, ["branch"])

        assignPath(root, ["branch"], deferredBranch.promise)
        assignPath(root, ["branch", "x"], 1)

        deferredBranch.resolve({})
        const firstValue = await firstRead
        await flushMicrotasks()

        expect(firstValue).to.eql({})
        expect(root.branch).to.eql({ x: 1 })
        expect(root.branch).not.to.be(firstValue)
    })

    it("treats replacing one pending promise with another as a fresh mirror", async () => {
        const first = deferred()
        const second = deferred()
        const root = {}

        assignPath(root, ["branch"], first.promise)
        assignPath(root, ["branch"], second.promise)

        first.resolve({ stale: true })
        await flushMicrotasks()
        expect(root.branch).to.be(second.promise)

        second.resolve({ fresh: true })
        await flushMicrotasks()
        expect(root.branch).to.eql({ fresh: true })
    })

    it("forks a settled-but-unreplaced promise key", async () => {
        const root = {}
        const promise = Promise.resolve({})

        assignPath(root, ["branch"], promise)
        importValue(root)

        const next = assignPath(root, ["added"], true)
        assignPath(next, ["branch", "x"], 1)

        await flushMicrotasks()

        expect(root.branch).to.eql({})
        expect(next.branch).to.eql({ x: 1 })
        expect(next.branch).not.to.be(root.branch)
    })

    it("does not recreate a deleted path when a suspended write resumes", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(root, ["branch", "x"], 1)
        deletePath(root, ["branch"])

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root).to.eql({})
    })

    it("does not overwrite a later reassignment when a suspended write resumes", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(root, ["branch", "x"], 1)
        assignPath(root, ["branch"], { replacement: true })

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root.branch).to.eql({ replacement: true })
    })

    it("deletes through a pending branch once it resolves", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        deletePath(root, ["branch", "x"])

        deferredBranch.resolve({ x: 1, y: 2 })
        await flushMicrotasks()

        expect(root.branch).to.eql({ y: 2 })
    })

    it("orders assignment before delete through the same pending branch", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(root, ["branch", "x"], 2)
        deletePath(root, ["branch", "x"])

        deferredBranch.resolve({ x: 1, y: 3 })
        await flushMicrotasks()

        expect(root.branch).to.eql({ y: 3 })
    })

    it("orders delete before assignment through the same pending branch", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        deletePath(root, ["branch", "x"])
        assignPath(root, ["branch", "x"], 2)

        deferredBranch.resolve({ x: 1, y: 3 })
        await flushMicrotasks()

        expect(root.branch).to.eql({ y: 3, x: 2 })
    })
})

describe("subtree counters", () => {
    it("keeps non-ref-indexed writes on the normal mutation path", () => {
        const deferredValue = deferred()
        const root = {}
        const cyclic = {}
        cyclic.self = cyclic

        assignPath(root, ["pending"], deferredValue.promise)
        assignPath(root, ["nested", "error"], new Error("bad"))
        assignPath(root, ["cycle"], cyclic)

        expect(root.pending).to.be(deferredValue.promise)
        expect(root.nested.error instanceof Error).to.be(true)
        expect(root.cycle).to.be(cyclic)
        expect(getRefCounter(root)).to.be(undefined)
        expect(getRefCounter(root.nested)).to.be(undefined)
        verifyRefCounts(root)
    })

    it("counts primitive, promise, Error, and valid frozen values", () => {
        const frozen = Object.freeze({ nested: { value: 1 } })

        expectCounts(7, 0, 0)
        expectCounts(null, 0, 0)
        expectCounts(Promise.resolve(1), 1, 0)
        expectCounts(new Error("bad"), 0, 1)

        expect(refIndexBranch(frozen)).to.be(frozen)
        expectCounts(frozen, 0, 0)
        verifyRefCounts(frozen)
    })

    it("throws if promise ref-indexing runs before initRef", () => {
        const script = `
            const { refIndexBranch } = require("./src/refcounts")
            try {
                refIndexBranch({ value: Promise.resolve("done") })
                process.exit(1)
            } catch (error) {
                if (error.message !== "initRef must be called before ref-indexing promises") {
                    process.stderr.write(error.stack)
                    process.exit(1)
                }
            }
        `

        const result = spawnSync(process.execPath, ["-e", script], {
            cwd: process.cwd(),
            encoding: "utf8",
        })

        expect(result.status).to.be(0)
    })

    it("throws when getRefCounts finds invalid owned data", () => {
        const cyclic = {}
        cyclic.self = cyclic
        let thrown

        try {
            getRefCounts(cyclic)
        } catch (error) {
            thrown = error
        }

        expect(thrown instanceof Error).to.be(true)
        expect(thrown.message).to.be("Cannot ref-index cyclic value")
    })

    it("bookkeeps tracked branches after first count", () => {
        const deferredValue = deferred()
        const nestedPromise = deferred()
        const root = {
            pending: deferredValue.promise,
            nested: { error: new Error("bad") },
        }

        expectCounts(root, 1, 1)
        verifyRefCounts(root)

        assignPath(root, ["nested", "pending"], nestedPromise.promise)
        expectCounts(root, 2, 1)
        verifyRefCounts(root)
    })

    it("keeps counts exact through writes, deletes, and promise settlement", async () => {
        const first = deferred()
        const second = deferred()
        const root = {
            pending: first.promise,
            error: new Error("old"),
            nested: {},
        }

        refIndexBranch(root)
        expectCounts(root, 1, 1)
        verifyRefCounts(root)

        assignPath(root, ["nested", "pending"], second.promise)
        expectCounts(root, 2, 1)
        verifyRefCounts(root)

        deletePath(root, ["error"])
        expectCounts(root, 2, 0)
        verifyRefCounts(root)

        first.resolve({ failed: new Error("resolved") })
        await flushMicrotasks()
        expectCounts(root, 1, 1)
        verifyRefCounts(root)

        second.resolve(42)
        await flushMicrotasks()
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("decrements counts when a pending promise is overwritten and ignores its later writeback", async () => {
        const deferredValue = deferred()
        const root = {}

        refIndexBranch(root)
        assignPath(root, ["value"], deferredValue.promise)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        assignPath(root, ["value"], 7)
        expect(root.value).to.be(7)
        expectCounts(root, 0, 0)
        verifyRefCounts(root)

        deferredValue.resolve(new Error("late"))
        await flushMicrotasks()

        expect(root.value).to.be(7)
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("keeps counting promises exposed by resolved promise values", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { value: outer.promise }

        refIndexBranch(root)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expectCounts(root, 1, 0)
        expectCounts(root.value, 1, 0)
        verifyRefCounts(root)

        inner.resolve("done")
        await flushMicrotasks()

        expect(root.value.inner).to.be("done")
        expectCounts(root, 0, 0)
        expectCounts(root.value, 0, 0)
        verifyRefCounts(root)
    })

    it("turns rejected promises into counted Error values", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        refIndexBranch(root)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        deferredValue.reject("bad")
        await flushMicrotasks()

        expect(root.value instanceof Error).to.be(true)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("discovers already-settled promise keys during ref-indexing", async () => {
        const root = { value: Promise.resolve("done") }

        refIndexBranch(root)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        await flushMicrotasks()

        expect(root.value).to.be("done")
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("connects an already-ref-indexed child when an ancestor is ref-indexed", async () => {
        const deferredValue = deferred()
        const child = { pending: deferredValue.promise }
        const root = { child }

        refIndexBranch(child)
        expectCounts(child, 1, 0)

        refIndexBranch(root)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        deferredValue.resolve("done")
        await flushMicrotasks()

        expectCounts(child, 0, 0)
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("bookkeeps continuations registered before ref-indexing when they commit after ref-indexing", async () => {
        const branch = deferred()
        const nested = deferred()
        const root = { branch: branch.promise }

        assignPath(root, ["branch", "nested"], nested.promise)
        refIndexBranch(root)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        branch.resolve({})
        await flushMicrotasks()

        expectCounts(root, 1, 0)
        expectCounts(root.branch, 1, 0)
        verifyRefCounts(root)

        nested.resolve("done")
        await flushMicrotasks()

        expect(root.branch.nested).to.be("done")
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("counts shared child references with parent-edge multiplicity", async () => {
        const deferredValue = deferred()
        const child = { pending: deferredValue.promise }
        const root = { left: child, right: child }

        refIndexBranch(root)
        expectCounts(child, 1, 0)
        expectCounts(root, 2, 0)
        verifyRefCounts(root)

        deferredValue.resolve("done")
        await flushMicrotasks()

        expectCounts(child, 0, 0)
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("preserves parent-edge multiplicity across COW worlds", async () => {
        const deferredValue = deferred()
        const child = { pending: deferredValue.promise }
        const root = { left: child, right: child }

        refIndexBranch(root)
        lookupPath(root, [])
        const next = assignPath(root, ["added"], true)

        expectCounts(child, 1, 0)
        expectCounts(root, 2, 0)
        expectCounts(next, 2, 0)
        verifyRefCounts(root, next)

        deferredValue.resolve("done")
        await flushMicrotasks()

        expectCounts(child, 0, 0)
        expectCounts(root, 0, 0)
        expectCounts(next, 0, 0)
        verifyRefCounts(root, next)
    })

    it("decrements a deleted pending promise and ignores its later writeback", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        refIndexBranch(root)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        deletePath(root, ["value"])
        expectCounts(root, 0, 0)
        verifyRefCounts(root)

        deferredValue.resolve(new Error("late"))
        await flushMicrotasks()

        expect(root).to.eql({})
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("keeps COW of non-ref-indexed branches countable afterward", () => {
        const deferredValue = deferred()
        const root = { branch: { x: 1 } }

        lookupPath(root, [])
        const next = assignPath(root, ["added"], true)
        assignPath(next, ["branch", "pending"], deferredValue.promise)

        expectCounts(root, 0, 0)
        expectCounts(next, 1, 0)
        verifyRefCounts(root, next)
    })

    it("copies counters for COW worlds and lets them diverge", async () => {
        const deferredBranch = deferred()
        const root = {
            branch: deferredBranch.promise,
            sibling: { error: new Error("old") },
        }

        refIndexBranch(root)
        lookupPath(root, [])

        const next = assignPath(root, ["added"], true)
        expectCounts(root, 1, 1)
        expectCounts(next, 1, 1)
        verifyRefCounts(root, next)

        assignPath(next, ["sibling", "error"], "fixed")
        expectCounts(root, 1, 1)
        expectCounts(next, 1, 0)
        verifyRefCounts(root, next)

        deferredBranch.resolve({ ok: true })
        await flushMicrotasks()

        expectCounts(root, 0, 1)
        expectCounts(next, 0, 0)
        verifyRefCounts(root, next)
    })

    it("rejects frozen ref-indexed subtrees that contain promises or errors", () => {
        const frozenPromise = Object.freeze({ pending: Promise.resolve(1) })
        const nestedFrozenPromise = Object.freeze({ nested: { pending: Promise.resolve(1) } })
        const frozenError = Object.freeze({ error: new Error("bad") })
        const root = {}

        const promiseFailure = refIndexBranch(frozenPromise)
        const nestedPromiseFailure = refIndexBranch(nestedFrozenPromise)
        const errorFailure = refIndexBranch(frozenError)

        expect(promiseFailure instanceof Error).to.be(true)
        expect(nestedPromiseFailure instanceof Error).to.be(true)
        expect(errorFailure instanceof Error).to.be(true)

        refIndexBranch(root)
        assignPath(root, ["value"], frozenPromise)

        expect(root.value instanceof Error).to.be(true)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("rejects frozen promise descendants regardless of key order", () => {
        function makeRoot(frozenFirst) {
            const shared = { pending: Promise.resolve(1) }
            const frozen = Object.freeze({ shared })
            return frozenFirst ? { frozen, shared } : { shared, frozen }
        }

        const frozenFirstFailure = refIndexBranch(makeRoot(true))
        const sharedFirstFailure = refIndexBranch(makeRoot(false))

        expect(frozenFirstFailure instanceof Error).to.be(true)
        expect(sharedFirstFailure instanceof Error).to.be(true)
    })

    it("turns frozen-violating resolved values into Error values", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        refIndexBranch(root)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        deferredValue.resolve(Object.freeze({ pending: Promise.resolve(1) }))
        await flushMicrotasks()

        expect(root.value instanceof Error).to.be(true)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("turns ref-indexed writes that would create cycles into Error values", () => {
        const root = {}
        const cyclic = {}
        cyclic.self = cyclic

        refIndexBranch(root)
        assignPath(root, ["self"], root)

        expect(root.self instanceof Error).to.be(true)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)

        assignPath(root, ["value"], cyclic)

        expect(root.value instanceof Error).to.be(true)
        expect(cyclic.self).to.be(cyclic)
        expectCounts(root, 0, 2)
        verifyRefCounts(root)
    })

    it("turns async back-edges into Error values", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        refIndexBranch(root)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        deferredValue.resolve(root)
        await flushMicrotasks()

        expect(root.value instanceof Error).to.be(true)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("does not leave counter edges behind when entering-value validation fails", () => {
        const sharedPromise = deferred()
        const root = {}
        const shared = { pending: sharedPromise.promise }
        const incoming = { shared, cycle: {} }
        incoming.cycle.back = incoming

        refIndexBranch(shared)
        refIndexBranch(root)
        expectCounts(shared, 1, 0)

        assignPath(root, ["value"], incoming)

        expect(root.value instanceof Error).to.be(true)
        expect(incoming.cycle.back).to.be(incoming)
        expectCounts(shared, 1, 0)
        expectCounts(root, 0, 1)
        verifyRefCounts(root, shared)
    })
})

describe("root promises", () => {
    it("chains root-level assignments through returned promises", async () => {
        const deferredRoot = deferred()
        let root = deferredRoot.promise

        root = assignPath(root, ["a"], 1)
        root = assignPath(root, ["b"], 2)

        deferredRoot.resolve({})
        const value = await root

        expect(value).to.eql({ a: 1, b: 2 })
    })

    it("looks up through a root promise with shared ownership", async () => {
        const deferredRoot = deferred()
        const root = { branch: { x: 1 } }
        const oldBranch = root.branch

        const read = lookupPath(deferredRoot.promise, ["branch"])
        deferredRoot.resolve(root)
        const value = await read
        assignPath(root, ["branch", "x"], 2)

        expect(value).to.be(oldBranch)
        expect(root.branch).not.to.be(oldBranch)
        expect(oldBranch.x).to.be(1)
        expect(root.branch.x).to.be(2)
    })

    it("looks up through a root promise without sharing ownership", async () => {
        const deferredRoot = deferred()
        const root = { branch: { x: 1 } }
        const oldBranch = root.branch

        const read = lookupPath(deferredRoot.promise, ["branch"], false)
        deferredRoot.resolve(root)
        const value = await read
        assignPath(root, ["branch", "x"], 2)

        expect(value).to.be(oldBranch)
        expect(root.branch).to.be(oldBranch)
        expect(oldBranch.x).to.be(2)
    })

    it("deletes through a root promise", async () => {
        const deferredRoot = deferred()

        const result = deletePath(deferredRoot.promise, ["remove"])
        deferredRoot.resolve({ keep: true, remove: true })
        const value = await result

        expect(value).to.eql({ keep: true })
    })

    it("turns rejected root promises into Error results", async () => {
        const assignRoot = deferred()
        const lookupRoot = deferred()
        const deleteRoot = deferred()

        const assigned = assignPath(assignRoot.promise, ["value"], 1)
        const lookedUp = lookupPath(lookupRoot.promise, ["value"])
        const deleted = deletePath(deleteRoot.promise, ["value"])

        assignRoot.reject("assign root")
        lookupRoot.reject("lookup root")
        deleteRoot.reject("delete root")

        const assignedValue = await assigned
        const lookedUpValue = await lookedUp
        const deletedValue = await deleted

        expect(assignedValue instanceof Error).to.be(true)
        expect(assignedValue.message).to.be("assign root")
        expect(lookedUpValue instanceof Error).to.be(true)
        expect(lookedUpValue.message).to.be("lookup root")
        expect(deletedValue instanceof Error).to.be(true)
        expect(deletedValue.message).to.be("delete root")
    })
})

describe("deletePath", () => {
    it("returns null for an empty delete path", () => {
        const root = { value: 1 }

        const next = deletePath(root, [])

        expect(next).to.be(null)
        expect(root).to.eql({ value: 1 })
    })

    it("supports null and primitive roots", () => {
        expect(deletePath(null, ["value"])).to.be(null)
        expect(deletePath(undefined, ["value"])).to.be(undefined)
        expect(deletePath(7, ["value"])).to.be(7)
        expect(deletePath("text", ["value"])).to.be("text")
    })

    it("deletes from a copied branch without changing the escaped branch", () => {
        const root = { config: { keep: true, remove: true } }
        const oldConfig = lookupPath(root, ["config"])

        deletePath(root, ["config", "remove"])

        expect(oldConfig).to.eql({ keep: true, remove: true })
        expect(root.config).to.eql({ keep: true })
        expect(root.config).not.to.be(oldConfig)
    })

    it("can delete an Error at the target key", () => {
        const root = { value: new Error("old") }

        deletePath(root, ["value"])

        expect(root).to.eql({})
    })

    it("is a no-op when deleting through an Error root or Error branch", () => {
        const errorRoot = new Error("root")
        const branchError = new Error("branch")
        const root = { branch: branchError }

        const next = deletePath(errorRoot, ["value"])
        deletePath(root, ["branch", "value"])

        expect(next).to.be(errorRoot)
        expect(root.branch).to.be(branchError)
    })

    it("treats array element deletion as a no-op", async () => {
        const arrayRoot = [1, 2, 3]
        const root = { list: [1, 2, 3] }
        const list = root.list
        const deferredList = deferred()
        const pendingRoot = { list: deferredList.promise }

        const nextArrayRoot = deletePath(arrayRoot, [1])
        deletePath(root, ["list", 1])
        deletePath(pendingRoot, ["list", 1])

        deferredList.resolve([1, 2, 3])
        await flushMicrotasks()

        expect(nextArrayRoot).to.be(arrayRoot)
        expect(arrayRoot).to.eql([1, 2, 3])
        expect(root.list).to.eql([1, 2, 3])
        expect(root.list).to.be(list)
        expect(pendingRoot.list).to.eql([1, 2, 3])
    })

    it("revokes pending writeback when deleting a promise key", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(root, ["value"], deferredValue.promise)
        deletePath(root, ["value"])

        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        expect(root).to.eql({})
    })

    it("does not create through primitive intermediates", async () => {
        const deferredBranch = deferred()
        const root = { branch: 7 }
        const pendingRoot = { branch: deferredBranch.promise }

        deletePath(root, ["branch", "x"])
        deletePath(pendingRoot, ["branch", "x"])

        deferredBranch.resolve(7)
        await flushMicrotasks()

        expect(root.branch).to.be(7)
        expect(pendingRoot.branch).to.be(7)
    })

    it("is a no-op when deleting through a rejected intermediate promise", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        deletePath(root, ["branch", "value"])

        deferredBranch.reject("delete blocked")
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("delete blocked")
    })

})


