const expect = require("expect.js")

const runtime = require("../index")

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

describe("import", () => {
    it("marks external roots as immutable", () => {
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

    it("copies an immutable root and marks copied children as immutable", () => {
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

    it("tracks inherited immutable state along the mutated path", () => {
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

    it("does not clear the mark from an assigned immutable object", () => {
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

    it("copies through a promised path key under an immutable root", async () => {
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

})


