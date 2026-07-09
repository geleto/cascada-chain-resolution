const {
    expect,
    metaOf,
    getRefCounter,
    verifyRefCounts,
    assignPath,
    normalize,
    importValue,
    deferred,
    flushMicrotasks,
} = require("./support")

describe("normalize", () => {
    it("returns direct values until a real wait is needed", () => {
        const root = { branch: { x: 1 }, primitive: 2 }
        const pending = deferred()

        const branch = normalize(root, ["branch"])
        const primitive = normalize(root, ["primitive"])
        const missing = normalize(root, ["missing"])
        const copy = normalize(root, ["branch"], true, true)
        const waiting = normalize({ branch: { pending: pending.promise } }, ["branch"])

        expect(branch).to.be(root.branch)
        expect(primitive).to.be(2)
        expect(missing).to.be(undefined)
        expect(copy).to.eql({ x: 1 })
        expect(typeof waiting.then).to.be("function")
    })

    it("returns settled clean branches synchronously and marks returned branches", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        const value = normalize(root, ["branch"])
        assignPath(root, ["branch", "x"], 2)

        expect(value).to.be(branch)
        expect(root.branch).not.to.be(branch)
        expect(branch.x).to.be(1)
        expect(root.branch.x).to.be(2)
    })

    it("protects fast-path results from already-issued suspended writes", async () => {
        const pendingRoot = deferred()
        const root = { branch: { x: 1 } }
        const branch = root.branch

        assignPath(pendingRoot.promise, ["branch", "x"], 2)
        const value = normalize(root, ["branch"])

        expect(value).to.be(branch)
        expect(value).to.eql({ x: 1 })

        pendingRoot.resolve(root)
        await flushMicrotasks()

        expect(value).to.be(branch)
        expect(value).to.eql({ x: 1 })
        expect(root.branch).not.to.be(branch)
        expect(root.branch).to.eql({ x: 2 })
        verifyRefCounts(branch, root.branch)
    })

    it("can return settled branches without sharing ownership", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        const value = normalize(root, ["branch"], false)
        assignPath(root, ["branch", "x"], 2)

        expect(value).to.be(branch)
        expect(root.branch).to.be(branch)
        expect(branch.x).to.be(2)
    })

    it("returns plain copies without marking the original branch", () => {
        const child = { x: 1 }
        const branch = { left: child, right: child }
        const root = { branch }

        const copy = normalize(root, ["branch"], true, true)
        assignPath(root, ["branch", "left", "x"], 2)

        expect(copy).not.to.be(branch)
        expect(copy.left).to.be(copy.right)
        expect(copy.left).not.to.be(child)
        expect(copy.left.x).to.be(1)
        expect(root.branch).to.be(branch)
        expect(child.x).to.be(2)
        expect(metaOf(copy)).to.be(undefined)
    })

    it("returns a single Error for settled error branches without marking them", () => {
        const child = { x: 1 }
        const branch = { error: new Error("bad"), child }
        const root = { branch }

        const value = normalize(root, ["branch"])
        assignPath(root, ["branch", "child", "x"], 2)

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("normalize: branch contains errors")
        expect(root.branch).to.be(branch)
        expect(child.x).to.be(2)
    })

    it("pins pending branches so later writes COW away from the result", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        const branch = root.branch

        const result = normalize(root, ["branch"])
        assignPath(root, ["branch", "later"], 2)

        pending.resolve("done")
        const value = await result

        expect(value).to.be(branch)
        expect(value).to.eql({ pending: "done" })
        expect(root.branch).not.to.be(branch)
        expect(root.branch).to.eql({ pending: "done", later: 2 })
        verifyRefCounts(branch, root.branch)
    })

    it("pins pending branches even without shared ownership", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        const branch = root.branch

        const result = normalize(root, ["branch"], false)
        assignPath(root, ["branch", "later"], 2)

        pending.resolve("done")
        const value = await result

        expect(value).to.be(branch)
        expect(value).to.eql({ pending: "done" })
        expect(root.branch).not.to.be(branch)
        expect(root.branch).to.eql({ pending: "done", later: 2 })
    })

    it("shares one settlement wait between pending callers", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const root = { branch }

        const first = normalize(root, ["branch"])
        const promise = metaOf(branch).settlementPromise
        const second = normalize(root, ["branch"])

        expect(promise).to.be.ok()
        expect(metaOf(branch).settlementPromise).to.be(promise)

        pending.resolve("done")
        const values = await Promise.all([first, second])

        expect(values).to.eql([branch, branch])
        expect(metaOf(branch).settlementPromise).to.be(undefined)
        expect(metaOf(branch).settlementResolve).to.be(undefined)
    })

    it("includes earlier suspended writes at their program position", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }

        assignPath(root, ["branch", "x"], 1)
        const result = normalize(root, ["branch"])

        pending.resolve({})
        const value = await result

        expect(value).to.be(root.branch)
        expect(value).to.eql({ x: 1 })
        verifyRefCounts(root)
    })

    it("keeps later suspended writes out of a normalized pending path", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }

        const result = normalize(root, ["branch"])
        assignPath(root, ["branch", "x"], 1)

        pending.resolve({})
        const value = await result

        expect(value).to.eql({})
        expect(root.branch).to.eql({ x: 1 })
        expect(root.branch).not.to.be(value)
        verifyRefCounts(root, value)
    })

    it("waits for promises exposed by resolved promise values", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }
        let settled = false

        const result = normalize(root, ["branch"])
        result.then(() => {
            settled = true
        })

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expect(settled).to.be(false)

        inner.resolve("done")
        const value = await result

        expect(settled).to.be(true)
        expect(value).to.eql({ outer: { inner: "done" } })
        verifyRefCounts(root)
    })

    it("does not settle at a transient zero before same-promise continuations run", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }
        let settled = false

        assignPath(root, ["branch", "outer", "inner"], inner.promise)
        const result = normalize(root, ["branch"])
        result.then(() => {
            settled = true
        })

        outer.resolve({})
        await flushMicrotasks()

        expect(settled).to.be(false)
        expect(root.branch).to.eql({ outer: { inner: inner.promise } })

        inner.resolve("done")
        const value = await result

        expect(settled).to.be(true)
        expect(value).to.eql({ outer: { inner: "done" } })
        verifyRefCounts(root)
    })

    it("settles on a second zero-crossing while a recheck is pending", async () => {
        const outer = deferred()
        const root = { branch: { outer: outer.promise } }

        // An already-settled promise re-arms the transient zero, then zeroes
        // the count again while the first recheck may still be queued. Either
        // interleaving must settle exactly once; plainCopy exposes a premature
        // fire, because the copy is taken at settlement time.
        assignPath(root, ["branch", "outer", "later"], Promise.resolve("late"))
        const result = normalize(root, ["branch"], true, true)

        outer.resolve({})
        const value = await result

        expect(value).to.eql({ outer: { later: "late" } })
        verifyRefCounts(root)
    })

    it("does not wait for promises added by later-issued writes", async () => {
        const first = deferred()
        const later1 = deferred()
        const later2 = deferred()
        const root = { branch: { pending: first.promise } }   // Op1: count = 1
        const branch = root.branch
        let settled = false

        const result = normalize(root, ["branch"])            // Op2: pins, waits
        result.then(() => {
            settled = true
        })

        // Later-issued writes COW away from the pin: their promises land in a
        // fresh copy with its own counter, never re-arming the watched one.
        assignPath(root, ["branch", "a"], later1.promise)
        assignPath(root, ["branch", "b"], later2.promise)

        expect(root.branch).not.to.be(branch)
        expect(getRefCounter(branch).promiseCount).to.be(1)
        expect(getRefCounter(root.branch).promiseCount).to.be(3)

        first.resolve("done")
        await flushMicrotasks()

        // The watched counter zeroed independently of the copy world's.
        expect(settled).to.be(true)
        const value = await result
        expect(value).to.be(branch)
        expect(value).to.eql({ pending: "done" })
        expect(getRefCounter(root.branch).promiseCount).to.be(2)

        later1.resolve(1)
        later2.resolve(2)
        await flushMicrotasks()

        expect(root.branch).to.eql({ pending: "done", a: 1, b: 2 })
        verifyRefCounts(root, branch)
    })

    it("attributes validation failures without marking failed branches", () => {
        const branch = {}
        branch.self = branch
        const root = { branch }

        importValue(root, "normalize import")
        const value = normalize(root, ["branch"])

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("Value cannot be cyclic (imported at: normalize import)")
        expect(metaOf(branch)).to.be(undefined)
    })

    it("validates frozen branches without attaching counter metadata", () => {
        const valid = Object.freeze({ x: 1 })
        const invalid = Object.freeze({ pending: Promise.resolve(1) })

        importValue(invalid, "frozen normalize")
        const copied = normalize(valid, [], true, true)
        const failure = normalize(invalid, [])

        expect(copied).to.eql({ x: 1 })
        expect(copied).not.to.be(valid)
        expect(metaOf(valid)).to.be(undefined)
        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: frozen normalize)",
        )
        expect(metaOf(invalid)).to.be(undefined)
    })

    it("normalizes through a root promise", async () => {
        const pending = deferred()
        const result = normalize(pending.promise, ["branch"])

        pending.resolve({ branch: { x: 1 } })
        const value = await result

        expect(value).to.eql({ x: 1 })
    })
})
