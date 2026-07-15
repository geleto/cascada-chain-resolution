const {
    Chain,
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
            assigned = thrownBy(() => assignPath(new Chain(root), ["__proto__", "polluted"], true))
            nestedAssigned = thrownBy(() => {
                assignPath(new Chain(nested), ["safe", "__proto__", "polluted"], true)
            })
            lookedUp = lookupPath(new Chain(root), ["__proto__"])
            deleted = thrownBy(() => deletePath(new Chain(root), ["__proto__"]))
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
        expect(lookupPath(new Chain(next), ["__proto__"])).to.be(undefined)
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
        const chain = new Chain(root)
        assignPath(chain, ["other", "x"], 2)
        const next = chain._state.value
        deferredValue.resolve({ safe: true })
        await flushMicrotasks()

        expect(Object.getOwnPropertyDescriptor(next, "__proto__").value).to.be(deferredValue.promise)
        expect(Object.getPrototypeOf(next)).to.be(Object.prototype)
        expect(lookupPath(new Chain(next), ["__proto__"])).to.be(undefined)
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
        expect(Object.getOwnPropertyDescriptor(chain._state.value, "__proto__").value).to.be(
            deferredValue.promise,
        )
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

        const assigned = thrownBy(() => assignPath(new Chain(root), ["hidden"], 2))
        const nestedAssigned = thrownBy(() => assignPath(new Chain(root), ["hidden", "x"], 2))
        const deleted = thrownBy(() => deletePath(new Chain(root), ["hidden"]))

        expect(assigned instanceof Error).to.be(true)
        expect(nestedAssigned instanceof Error).to.be(true)
        expect(deleted instanceof Error).to.be(true)
        expect(assigned.message).to.be("Cannot mutate non-enumerable property")
        expect(nestedAssigned.message).to.be("Cannot mutate non-enumerable property")
        expect(deleted.message).to.be("Cannot mutate non-enumerable property")
        expect(root.hidden).to.be(hidden)
        expect(Object.prototype.propertyIsEnumerable.call(root, "hidden")).to.be(false)
    })

    it("throws before invoking accessor or inherited assignment blockers", () => {
        let setterCalls = 0
        const accessor = {}
        Object.defineProperty(accessor, "value", {
            get() {
                return 1
            },
            set() {
                setterCalls++
            },
            enumerable: true,
            configurable: true,
        })
        const prototype = {}
        Object.defineProperty(prototype, "locked", {
            value: 1,
            enumerable: true,
            writable: false,
            configurable: true,
        })
        const inherited = Object.create(prototype)

        const accessorFailure = thrownBy(() => {
            assignPath(new Chain(accessor), ["value"], 2)
        })
        const inheritedFailure = thrownBy(() => {
            assignPath(new Chain(inherited), ["locked"], 2)
        })

        expect(accessorFailure.message).to.be("Cannot assign to accessor property")
        expect(inheritedFailure.message).to.be("Cannot assign to non-writable property")
        expect(setterCalls).to.be(0)
        expect(Object.prototype.hasOwnProperty.call(inherited, "locked")).to.be(false)
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

    it("treats array length as a non-language mutation property", () => {
        const root = [1, 2, 3]
        const chain = new Chain(root)

        expect(lookupPath(chain, ["length"])).to.be(undefined)

        const assigned = thrownBy(() => assignPath(chain, ["length"], 1))
        const deleted = thrownBy(() => deletePath(chain, ["length"]))

        expect(assigned instanceof Error).to.be(true)
        expect(deleted instanceof Error).to.be(true)
        expect(assigned.message).to.be("Cannot mutate non-enumerable property")
        expect(deleted.message).to.be("Cannot mutate non-enumerable property")
        expect(root).to.eql([1, 2, 3])
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
        const observed = lookupPath(new Chain(root), ["pos"], false)
        const delta = root.delta

        assignPath(new Chain(root), ["pos", "x"], 2)

        expect(root.pos).to.be(observed)
        expect(root.pos.x).to.be(2)
        expect(root.delta).to.be(delta)
    })

    it("can read the root without sharing ownership", () => {
        const root = { pos: { x: 1 } }
        const observed = lookupPath(new Chain(root), [], false)
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

    it("copies frozen arrays before mutating nested values", () => {
        const child = { x: 1 }
        const root = Object.freeze([child])
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

        assignPath(new Chain(root), ["new", "value"], 1)
        assignPath(new Chain(root), ["old", "value"], 2)
        assignPath(new Chain(root), ["nothing", "value"], 3)
        assignPath(new Chain(root), ["unset", "value"], 4)

        for (const value of [root.new, root.old, root.nothing, root.unset]) {
            expect(value instanceof Error).to.be(true)
            expect(value.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
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

        assignPath(chain, ["value"], 1)
        assignPath(new Chain(root), ["branch", "value"], 1)

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

        expect(lookupPath(new Chain(root), ["__proto__"])).to.be(undefined)
        expect(lookupPath(new Chain(root), ["hidden"])).to.be(undefined)
        for (const path of [["__proto__", "unsafe"], ["hidden", "x"]]) {
            const result = lookupPath(new Chain(root), path)
            expect(result instanceof Error).to.be(true)
            expect(result.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
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
            expect(deletePath(chain, ["value"])).to.be(undefined)
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

    it("drops a non-enumerable property when deleting through COW", () => {
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

        expect(next).not.to.be(root)
        expect(next).to.eql({ keep: true })
        expect(root.hidden).to.be(hidden)
        expect(Object.prototype.propertyIsEnumerable.call(root, "hidden")).to.be(false)
    })

    it("shadows a hidden property during a suspended imported delete", async () => {
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

        expect(chain._state.value.branch).not.to.be(external)
        expect(chain._state.value.branch).to.eql({ keep: true })
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

    it("revokes pending writeback when deleting a promise key", async () => {
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
