const {
    Chain,
    expect,
    metaOf,
    STORE_META_IN_WEAKMAP,
    buildRefIndex,
    getRefCounter,
    verifyRefCounts,
    assignPath,
    deletePath,
    normalize,
    importValue,
    deferred,
    flushMicrotasks,
    expectCounts,
} = require("./support")

describe("normalize", () => {
    it("returns direct values until a real wait is needed", () => {
        const root = { branch: { x: 1 }, primitive: 2 }
        const pending = deferred()

        const branch = normalize(new Chain(root), ["branch"])
        const primitive = normalize(new Chain(root), ["primitive"])
        const missing = normalize(new Chain(root), ["missing"])
        const copy = normalize(new Chain(root), ["branch"], true, true)
        const waiting = normalize(new Chain({ branch: { pending: pending.promise } }), ["branch"])

        expect(branch).to.be(root.branch)
        expect(primitive).to.be(2)
        expect(missing).to.be(undefined)
        expect(copy).to.eql({ x: 1 })
        expect(typeof waiting.then).to.be("function")
    })

    it("returns settled clean branches synchronously and marks returned branches", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        const value = normalize(new Chain(root), ["branch"])
        assignPath(new Chain(root), ["branch", "x"], 2)

        expect(value).to.be(branch)
        expect(root.branch).not.to.be(branch)
        expect(branch.x).to.be(1)
        expect(root.branch.x).to.be(2)
    })

    it("marks valid imported branches even when shared ownership is ceded", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        importValue(root, "valid normalize import")
        const value = normalize(new Chain(root), ["branch"], false)

        expect(value).to.be(branch)
        expect(metaOf(branch).importContext).to.be("valid normalize import")
    })

    it("protects fast-path results from already-issued suspended writes", async () => {
        const pendingRoot = deferred()
        const root = { branch: { x: 1 } }
        const branch = root.branch

        assignPath(new Chain(pendingRoot.promise), ["branch", "x"], 2)
        const value = normalize(new Chain(root), ["branch"])

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

        const value = normalize(new Chain(root), ["branch"], false)
        assignPath(new Chain(root), ["branch", "x"], 2)

        expect(value).to.be(branch)
        expect(root.branch).to.be(branch)
        expect(branch.x).to.be(2)
    })

    it("returns plain copies without marking the original branch", () => {
        const child = { x: 1 }
        const branch = { left: child, right: child }
        const root = { branch }

        const copy = normalize(new Chain(root), ["branch"], true, true)
        assignPath(new Chain(root), ["branch", "left", "x"], 2)

        expect(copy).not.to.be(branch)
        expect(copy.left).to.be(copy.right)
        expect(copy.left).not.to.be(child)
        expect(copy.left.x).to.be(1)
        expect(root.branch).to.be(branch)
        expect(child.x).to.be(2)
        expect(metaOf(copy)).to.be(undefined)
    })

    it("plain-copies sparse arrays and preserves DAG identity", () => {
        const child = { x: 1 }
        const ignoredSymbol = Symbol("ignored")
        const root = new Array(4)
        root[1] = child
        root.extra = child
        root[ignoredSymbol] = "symbol value"
        Object.defineProperty(root, "hidden", {
            value: "hidden value",
            enumerable: false,
        })

        const copy = normalize(new Chain(root), [], true, true)

        expect(Array.isArray(copy)).to.be(true)
        expect(copy.length).to.be(4)
        expect(0 in copy).to.be(false)
        expect(1 in copy).to.be(true)
        expect(copy[1]).to.be(copy.extra)
        expect(copy[1]).not.to.be(child)
        expect(Object.prototype.hasOwnProperty.call(copy, "hidden")).to.be(false)
        expect(Object.getOwnPropertySymbols(copy)).to.eql([])
        expect(metaOf(copy)).to.be(undefined)
        expect(metaOf(copy[1])).to.be(undefined)
    })

    it("returns a single Error for settled error branches without marking them", () => {
        const child = { x: 1 }
        const branch = { error: new Error("bad"), child }
        const root = { branch }

        const value = normalize(new Chain(root), ["branch"])
        assignPath(new Chain(root), ["branch", "child", "x"], 2)

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("normalize: branch contains errors")
        expect(root.branch).to.be(branch)
        expect(child.x).to.be(2)
    })

    it("pins pending branches so later writes COW away from the result", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        const branch = root.branch

        const result = normalize(new Chain(root), ["branch"])
        assignPath(new Chain(root), ["branch", "later"], 2)

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

        const result = normalize(new Chain(root), ["branch"], false)
        assignPath(new Chain(root), ["branch", "later"], 2)

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

        const first = normalize(new Chain(root), ["branch"])
        const promise = metaOf(branch).settlementPromise
        const second = normalize(new Chain(root), ["branch"])

        expect(promise).to.be.ok()
        expect(metaOf(branch).settlementPromise).to.be(promise)

        pending.resolve("done")
        const values = await Promise.all([first, second])

        expect(values).to.eql([branch, branch])
        expect(metaOf(branch).settlementPromise).to.be(undefined)
        expect(metaOf(branch).settlementResolve).to.be(undefined)
    })

    it("keeps caller return modes independent on one settlement wait", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const chain = new Chain({ branch })

        const directResult = normalize(chain, ["branch"])
        const settlementPromise = metaOf(branch).settlementPromise
        const plainResult = normalize(chain, ["branch"], true, true)

        expect(metaOf(branch).settlementPromise).to.be(settlementPromise)
        pending.resolve({ done: true })

        const direct = await directResult
        const plain = await plainResult
        expect(direct).to.be(branch)
        expect(plain).not.to.be(branch)
        expect(plain).to.eql({ pending: { done: true } })
        expect(metaOf(plain)).to.be(undefined)
        expect(metaOf(plain.pending)).to.be(undefined)
        verifyRefCounts(branch)
    })

    it("settles overlapping ancestor and child normalizations", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = { child }
        const chain = new Chain(root)

        const childResult = normalize(chain, ["child"])
        const childSettlement = metaOf(child).settlementPromise
        const rootResult = normalize(chain, [])
        const rootSettlement = metaOf(root).settlementPromise
        const plainRootResult = normalize(chain, [], true, true)

        expect(childSettlement).to.be.ok()
        expect(rootSettlement).to.be.ok()
        expect(rootSettlement).not.to.be(childSettlement)
        expect(metaOf(root).settlementPromise).to.be(rootSettlement)

        pending.resolve({ done: true })
        const childValue = await childResult
        const rootValue = await rootResult
        const plainRoot = await plainRootResult

        expect(childValue).to.be(child)
        expect(rootValue).to.be(root)
        expect(plainRoot).to.eql({ child: { pending: { done: true } } })
        expect(plainRoot).not.to.be(root)
        verifyRefCounts(root)
    })

    it("includes earlier suspended writes at their program position", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }

        assignPath(new Chain(root), ["branch", "x"], 1)
        const result = normalize(new Chain(root), ["branch"])

        pending.resolve({})
        const value = await result

        expect(value).to.be(root.branch)
        expect(value).to.eql({ x: 1 })
        verifyRefCounts(root)
    })

    it("includes an earlier suspended delete at its program position", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }
        const chain = new Chain(root)

        deletePath(chain, ["branch", "remove"])
        const result = normalize(chain, ["branch"])

        pending.resolve({ keep: true, remove: true })
        const value = await result

        expect(value).to.be(root.branch)
        expect(value).to.eql({ keep: true })
        verifyRefCounts(root)
    })

    it("keeps later suspended writes out of a normalized pending path", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }

        const result = normalize(new Chain(root), ["branch"])
        assignPath(new Chain(root), ["branch", "x"], 1)

        pending.resolve({})
        const value = await result

        expect(value).to.eql({})
        expect(root.branch).to.eql({ x: 1 })
        expect(root.branch).not.to.be(value)
        verifyRefCounts(root, value)
    })

    it("keeps a settled value when a later overwrite overtakes its continuation", async () => {
        const pending = deferred()
        const chain = new Chain({ branch: pending.promise })
        const result = normalize(chain, ["branch"])

        pending.resolve({ observed: true })
        assignPath(chain, ["branch"], { replacement: true })

        expect(await result).to.eql({ observed: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("continues a nested path wait after a later ancestor replacement", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise })
        const result = normalize(chain, ["branch", "inner"])

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()
        assignPath(chain, ["branch"], { replacement: true })
        inner.resolve({ observed: true })

        expect(await result).to.eql({ observed: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("settles promises exposed by a path mirror revoked before resolution", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise })
        const result = normalize(chain, ["branch"])
        let settled = false
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["branch"], { replacement: true })
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expect(settled).to.be(false)

        inner.resolve({ observed: true })

        expect(await result).to.eql({ inner: { observed: true } })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("does not transfer a pending normalization to a replacement promise", async () => {
        const observed = deferred()
        const replacement = deferred()
        const chain = new Chain({ branch: observed.promise })

        const result = normalize(chain, ["branch"])
        assignPath(chain, ["branch"], replacement.promise)
        observed.resolve({ observed: true })

        expect(await result).to.eql({ observed: true })
        expect(chain._state.value.branch).to.be(replacement.promise)

        replacement.resolve({ replacement: true })
        await flushMicrotasks()

        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("waits for promises exposed by resolved promise values", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }
        let settled = false

        const result = normalize(new Chain(root), ["branch"])
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

    it("collapses to Error when a pending branch promise rejects", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }

        const result = normalize(new Chain(root), ["branch"])
        pending.reject(new Error("bad"))
        const value = await result

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("normalize: branch contains errors")
        expect(root.branch.pending instanceof Error).to.be(true)
        verifyRefCounts(root)
    })

    it("collapses to Error when a resolved promise value contains an Error", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }

        const result = normalize(new Chain(root), ["branch"])
        pending.resolve({ failed: new Error("bad") })
        const value = await result

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("normalize: branch contains errors")
        expect(root.branch.pending.failed instanceof Error).to.be(true)
        verifyRefCounts(root)
    })

    it("does not settle at a transient zero before same-promise continuations run", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }
        let settled = false

        assignPath(new Chain(root), ["branch", "outer", "inner"], inner.promise)
        const result = normalize(new Chain(root), ["branch"])
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

    it("does not collapse to Error until queued earlier operations finish", async () => {
        const pending = deferred()
        const root = { branch: { inner: pending.promise } }

        assignPath(new Chain(root), ["branch", "inner", "e"], "fixed")
        const result = normalize(new Chain(root), ["branch"])

        pending.resolve({ e: new Error("transient") })
        const value = await result

        expect(value).to.be(root.branch)
        expect(value).to.eql({ inner: { e: "fixed" } })
        verifyRefCounts(root)
    })

    it("settles on a second zero-crossing while a recheck is pending", async () => {
        const outer = deferred()
        const root = { branch: { outer: outer.promise } }

        // An already-settled promise re-arms the transient zero, then zeroes
        // the count again while the first recheck may still be queued. Either
        // interleaving must settle exactly once; plainCopy exposes a premature
        // fire, because the copy is taken at settlement time.
        assignPath(new Chain(root), ["branch", "outer", "later"], Promise.resolve("late"))
        const result = normalize(new Chain(root), ["branch"], true, true)

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

        const result = normalize(new Chain(root), ["branch"])            // Op2: pins, waits
        result.then(() => {
            settled = true
        })

        // Later-issued writes COW away from the pin: their promises land in a
        // fresh copy with its own counter, never re-arming the watched one.
        assignPath(new Chain(root), ["branch", "a"], later1.promise)
        assignPath(new Chain(root), ["branch", "b"], later2.promise)

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

    it("normalizes a later COW counter world independently", async () => {
        const first = deferred()
        const second = deferred()
        const original = { first: first.promise }
        const chain = new Chain({ branch: original })

        const originalResult = normalize(chain, ["branch"])
        assignPath(chain, ["branch", "second"], second.promise)
        const current = chain._state.value.branch

        expect(current).not.to.be(original)
        first.resolve("first done")
        expect(await originalResult).to.be(original)
        expect(original).to.eql({ first: "first done" })
        expectCounts(current, 1, 0)

        const currentResult = normalize(chain, ["branch"])
        second.resolve("second done")
        expect(await currentResult).to.be(current)
        expect(current).to.eql({ first: "first done", second: "second done" })
        verifyRefCounts(original, current)
    })

    it("attributes validation failures without marking failed branches", () => {
        const branch = {}
        branch.self = branch
        const root = { branch }

        importValue(root, "normalize import")
        const value = normalize(new Chain(root), ["branch"])

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("Value cannot be cyclic (imported at: normalize import)")
        expect(metaOf(branch)).to.be(undefined)
    })

    it("validates frozen branches without attaching counter metadata", () => {
        const valid = Object.freeze({ x: 1 })
        const invalid = Object.freeze({ pending: Promise.resolve(1) })

        importValue(invalid, "frozen normalize")
        const copied = normalize(new Chain(valid), [], true, true)
        const failure = normalize(new Chain(invalid), [])

        expect(copied).to.eql({ x: 1 })
        expect(copied).not.to.be(valid)
        expect(metaOf(valid)).to.be(undefined)
        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: frozen normalize)",
        )
        if (STORE_META_IN_WEAKMAP) {
            expect(metaOf(invalid).importContext).to.be("frozen normalize")
            expect(getRefCounter(invalid)).to.be(undefined)
        } else {
            expect(metaOf(invalid)).to.be(undefined)
        }
    })

    it("returns valid frozen branches synchronously without copying", () => {
        const frozen = Object.freeze({ nested: { value: 1 } })
        importValue(frozen, "valid frozen normalize")

        const value = normalize(new Chain(frozen), [], false)

        expect(value).to.be(frozen)
        expect(getRefCounter(frozen)).to.be(undefined)
        expect(getRefCounter(frozen.nested)).to.be(undefined)
    })

    it("revalidates an indexed child when a frozen ancestor makes its promises invalid", () => {
        const pending = deferred()
        const child = { pending: pending.promise }

        expect(buildRefIndex(child)).to.be(child)

        const frozen = Object.freeze({ child })
        importValue(frozen, "frozen indexed normalize")
        const failure = normalize(new Chain(frozen), [])

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: frozen indexed normalize)",
        )
    })

    it("normalizes through a root promise", async () => {
        const pending = deferred()
        const chain = new Chain(pending.promise)
        const result = normalize(chain, ["branch"])

        pending.resolve({ branch: { x: 1 } })
        const value = await result

        expect(value).to.eql({ x: 1 })
    })
})
