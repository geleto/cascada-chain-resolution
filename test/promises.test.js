const {
    expect,
    onResolve,
    assignPath,
    deletePath,
    lookupPath,
    importValue,
    deferred,
    flushMicrotasks,
} = require("./support")

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

    it("shadows non-enumerable imported properties when a suspended mutation resumes", async () => {
        const deferredBranch = deferred()
        const externalBranch = {}
        const root = {}
        Object.defineProperty(externalBranch, "x", {
            value: 1,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        assignPath(root, ["branch"], importValue(deferredBranch.promise, "hidden resume"))
        assignPath(root, ["branch", "x"], 2)

        deferredBranch.resolve(externalBranch)
        await flushMicrotasks()

        expect(root.branch).not.to.be(externalBranch)
        expect(externalBranch.x).to.be(1)
        expect(Object.prototype.propertyIsEnumerable.call(externalBranch, "x")).to.be(false)
        expect(root.branch.x).to.be(2)
        expect(Object.prototype.propertyIsEnumerable.call(root.branch, "x")).to.be(true)
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

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("fork boom")
        expect(left.branch instanceof Error).to.be(true)
        expect(left.branch.message).to.be("fork boom")
        expect(right.branch instanceof Error).to.be(true)
        expect(right.branch.message).to.be("fork boom")
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
