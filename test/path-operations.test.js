const {
    expect,
    setFatalErrorReporter,
    assignPath,
    deletePath,
    lookupPath,
    importValue,
    deferred,
    flushMicrotasks,
    thrownBy,
} = require("./support")

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

    it("throws on __proto__ mutation paths without touching prototypes", () => {
        const root = {}
        const nested = { safe: {} }
        const reported = []
        let assigned
        let nestedAssigned
        let lookedUp
        let deleted

        setFatalErrorReporter(error => {
            reported.push(error)
        })
        try {
            assigned = thrownBy(() => assignPath(root, ["__proto__", "polluted"], true))
            nestedAssigned = thrownBy(() => {
                assignPath(nested, ["safe", "__proto__", "polluted"], true)
            })
            lookedUp = lookupPath(root, ["__proto__"])
            deleted = thrownBy(() => deletePath(root, ["__proto__"]))
        } finally {
            setFatalErrorReporter()
        }

        expect(assigned instanceof Error).to.be(true)
        expect(nestedAssigned instanceof Error).to.be(true)
        expect(deleted instanceof Error).to.be(true)
        expect(reported.length).to.be(3)
        expect(reported[0]).to.be(assigned)
        expect(reported[1]).to.be(nestedAssigned)
        expect(reported[2]).to.be(deleted)
        expect(assigned.message).to.be("Cannot use __proto__ as a key")
        expect(nestedAssigned.message).to.be("Cannot use __proto__ as a key")
        expect(deleted.message).to.be("Cannot use __proto__ as a key")
        expect(lookedUp).to.be(undefined)
        expect({}.polluted).to.be(undefined)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
        expect(Object.prototype.hasOwnProperty.call(root, "__proto__")).to.be(false)
        expect(nested).to.eql({ safe: {} })
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
        const next = assignPath(root, ["other", "x"], 2)
        const descriptor = Object.getOwnPropertyDescriptor(next, "__proto__")

        expect(root.other.x).to.be(1)
        expect(next.other.x).to.be(2)
        expect(descriptor.enumerable).to.be(true)
        expect(descriptor.writable).to.be(true)
        expect(descriptor.configurable).to.be(true)
        expect(descriptor.value).to.be(protoValue)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
        expect(Object.getPrototypeOf(next)).to.be(Object.prototype)
        expect(lookupPath(next, ["__proto__"])).to.be(undefined)
        expect({}.safe).to.be(undefined)
    })

    it("preserves promise-valued __proto__ data during COW without writeback", async () => {
        const deferredValue = deferred()
        const root = { other: { x: 1 } }
        Object.defineProperty(root, "__proto__", {
            value: deferredValue.promise,
            enumerable: true,
            writable: true,
            configurable: true,
        })

        importValue(root, "copy proto promise import")
        const next = assignPath(root, ["other", "x"], 2)
        deferredValue.resolve({ safe: true })
        await flushMicrotasks()

        expect(Object.getOwnPropertyDescriptor(next, "__proto__").value).to.be(deferredValue.promise)
        expect(Object.getPrototypeOf(next)).to.be(Object.prototype)
        expect(lookupPath(next, ["__proto__"])).to.be(undefined)
        expect({}.safe).to.be(undefined)
    })

    it("throws on non-enumerable mutation paths", () => {
        const hidden = { x: 1 }
        const root = {}
        Object.defineProperty(root, "hidden", {
            value: hidden,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        const assigned = thrownBy(() => assignPath(root, ["hidden"], 2))
        const nestedAssigned = thrownBy(() => assignPath(root, ["hidden", "x"], 2))
        const deleted = thrownBy(() => deletePath(root, ["hidden"]))

        expect(assigned instanceof Error).to.be(true)
        expect(nestedAssigned instanceof Error).to.be(true)
        expect(deleted instanceof Error).to.be(true)
        expect(assigned.message).to.be("Cannot mutate non-enumerable property")
        expect(nestedAssigned.message).to.be("Cannot mutate non-enumerable property")
        expect(deleted.message).to.be("Cannot mutate non-enumerable property")
        expect(root.hidden).to.be(hidden)
        expect(Object.prototype.propertyIsEnumerable.call(root, "hidden")).to.be(false)
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
        const next = assignPath(root, ["hidden"], 2)

        expect(next).not.to.be(root)
        expect(root.hidden).to.be(hidden)
        expect(Object.prototype.propertyIsEnumerable.call(root, "hidden")).to.be(false)
        expect(next.hidden).to.be(2)
        expect(Object.prototype.propertyIsEnumerable.call(next, "hidden")).to.be(true)
    })

    it("can shadow inherited properties", () => {
        const root = {}

        assignPath(root, ["constructor"], 2)

        expect(root.constructor).to.be(2)
        expect(Object.prototype.propertyIsEnumerable.call(root, "constructor")).to.be(true)
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

    it("does not read __proto__ or own non-enumerable properties", () => {
        const root = {}
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

        expect(lookupPath(root, ["__proto__"])).to.be(undefined)
        expect(lookupPath(root, ["__proto__", "unsafe"])).to.be(undefined)
        expect(lookupPath(root, ["hidden"])).to.be(undefined)
        expect(lookupPath(root, ["hidden", "x"])).to.be(undefined)
    })

    it("supports primitive roots for empty lookup paths", () => {
        expect(lookupPath(7, [])).to.be(7)
        expect(lookupPath("text", [])).to.be("text")
        expect(lookupPath(null, [])).to.be(null)
        expect(lookupPath(undefined, [])).to.be(undefined)
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
