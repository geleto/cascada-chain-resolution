const {
    Chain,
    expect,
    metaOf,
    buildRefIndex,
    getRefCounter,
    verifyRefCounts,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    lookupPath,
    normalize,
    onInternalResolve,
    importValue,
    deferred,
    flushMicrotasks,
    expectCounts,
} = require("./support")

describe("normalize", () => {
    it("keeps a mirror pending when cycle normalization re-enters it", async () => {
        const pending = deferred()
        const root = { value: pending.promise }
        importValue(root, "re-entrant cycle")
        const chain = new Chain(root)
        const normalized = normalize(chain, ["value"])
        const mirror = metaOf(root).mirrors.value
        const resolved = { back: root }

        pending.resolve(resolved)
        const copy = await normalized

        expect(copy.back.value).to.be(copy)
        expect(mirror.pendingConsumerCount).to.be(0)
        expect(mirror.cycleError).to.be(undefined)
        expect(metaOf(resolved).cycleErrors.back instanceof Error).to.be(true)
        verifyRefCounts(root)
    })

    it("preserves cycle and DAG topology in a metadata-free copy", () => {
        const shared = { leaf: true }
        const root = { left: shared, right: shared }
        root.self = root
        importValue(root, "normalize topology")
        const chain = new Chain(root)

        const copy = normalize(chain, [])

        expect(copy).not.to.be(root)
        expect(copy.self).to.be(copy)
        expect(copy.left).to.be(copy.right)
        expect(copy.left).not.to.be(shared)
        expect(metaOf(copy)).to.be(undefined)
        expect(metaOf(copy.left)).to.be(undefined)
        expect(hasError(chain, [])).to.be(true)
        expect(getErrors(chain, []).length).to.be(1)
        verifyRefCounts(root)
    })

    it("waits for promises hidden behind cycle cuts", async () => {
        const pending = deferred()
        const left = {}
        const right = { pending: pending.promise }
        left.right = right
        right.left = left
        importValue(left, "hidden cycle wait")
        const chain = new Chain(left)

        const result = normalize(chain, [])
        let settled = false
        result.then(() => {
            settled = true
        })
        await flushMicrotasks()
        expect(settled).to.be(false)

        pending.resolve({ done: true })
        const copy = await result
        expect(copy).not.to.be(left)
        expect(copy.right.left).to.be(copy)
        expect(copy.right.pending).to.eql({ done: true })
        expect(right.pending).to.be(pending.promise)
        expect(lookupPath(chain, ["right", "pending", "done"], false)).to.be(true)
        verifyRefCounts(left, right)
    })

    it("lets an ordinary Error behind a cycle cut poison normalize", () => {
        const left = {}
        const right = { bad: new Error("hidden") }
        left.right = right
        right.left = left
        importValue(left, "hidden cycle Error")

        const result = normalize(new Chain(left), [])

        expect(result instanceof Error).to.be(true)
        expect(result.message).to.be("normalize: branch contains errors")
    })

    it("returns counted terminal-cycle Errors without waiting for the raw frontier", async () => {
        const pending = deferred()
        const branch = { bad: new Error("known") }
        const root = { branch, pending: pending.promise }
        branch.back = root
        importValue(root, "terminal cycle Error")
        buildRefIndex(root)

        const result = normalize(new Chain(root), ["branch"])

        expect(metaOf(branch).cycleErrors.back instanceof Error).to.be(true)
        expect(getRefCounter(branch)).not.to.be(undefined)
        expect(result instanceof Error).to.be(true)
        expect(result.message).to.be("normalize: branch contains errors")

        pending.resolve("done")
        await flushMicrotasks()
        verifyRefCounts(root, branch)
    })

    it("normalizes a clean subpath through a cyclic import normally", () => {
        const root = { child: { clean: { x: 1 } } }
        root.child.back = root
        importValue(root, "clean cyclic subpath")
        const chain = new Chain(root)

        const clean = normalize(chain, ["child", "clean"])

        expect(clean).to.eql(root.child.clean)
        expect(clean).not.to.be(root.child.clean)
        expect(hasError(chain, [])).to.be(true)
        expect(hasError(chain, ["child", "clean"])).to.be(false)
    })

    it("returns direct values until a real wait is needed", () => {
        const root = { branch: { x: 1 }, primitive: 2 }
        const pending = deferred()

        const branch = normalize(new Chain(root), ["branch"])
        const primitive = normalize(new Chain(root), ["primitive"])
        const missing = normalize(new Chain(root), ["missing"])
        const broken = normalize(new Chain(root), ["missing", "value"])
        const waiting = normalize(new Chain({ branch: { pending: pending.promise } }), ["branch"])

        expect(branch).to.eql(root.branch)
        expect(branch).not.to.be(root.branch)
        expect(primitive).to.be(2)
        expect(missing).to.be(undefined)
        expect(broken instanceof Error).to.be(true)
        expect(broken.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(typeof waiting.then).to.be("function")
    })

    it("returns settled clean branches synchronously as independent copies", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        const value = normalize(new Chain(root), ["branch"])
        assignPath(new Chain(root), ["branch", "x"], 2)

        expect(value).not.to.be(branch)
        expect(metaOf(value)).to.be(undefined)
        expect(root.branch).to.be(branch)
        expect(branch.x).to.be(2)
        expect(root.branch.x).to.be(2)
        expect(value.x).to.be(1)
    })

    it("does not expose imported metadata", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        importValue(root, "valid normalize import")
        const value = normalize(new Chain(root), ["branch"])

        expect(value).to.eql(branch)
        expect(value).not.to.be(branch)
        expect(metaOf(value)).to.be(undefined)
        expect(metaOf(root).importBoundary.root).to.be(root)
        expect(metaOf(root).importBoundary.errorContext).to.be("valid normalize import")
    })

    it("protects fast-path results from already-issued suspended writes", async () => {
        const pendingRoot = deferred()
        const root = { branch: { x: 1 } }
        const branch = root.branch

        assignPath(new Chain(pendingRoot.promise), ["branch", "x"], 2)
        const value = normalize(new Chain(root), ["branch"])

        expect(value).not.to.be(branch)
        expect(value).to.eql({ x: 1 })

        pendingRoot.resolve(root)
        await flushMicrotasks()

        expect(value).not.to.be(branch)
        expect(value).to.eql({ x: 1 })
        expect(root.branch).to.be(branch)
        expect(root.branch).to.eql({ x: 2 })
        verifyRefCounts(branch, root.branch)
    })

    it("protects the source from native mutations of normalized output", () => {
        const child = { x: 1 }
        const branch = { left: child, right: child }
        const root = { branch }

        const copy = normalize(new Chain(root), ["branch"])
        copy.left.x = 2

        expect(copy).not.to.be(branch)
        expect(copy.left).to.be(copy.right)
        expect(copy.left).not.to.be(child)
        expect(copy.left.x).to.be(2)
        expect(root.branch).to.be(branch)
        expect(child.x).to.be(1)
        expect(metaOf(copy)).to.be(undefined)
        expect(metaOf(copy.left)).to.be(undefined)
    })

    it("reimports native-mutated output as fresh external data", () => {
        const output = normalize(new Chain({ value: { x: 1 } }), [])
        output.value.back = output

        importValue(output, "normalized round trip")

        const errors = getErrors(new Chain(output), [])
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be(
            'Cyclic property "back" (imported at: normalized round trip)',
        )
    })

    it("copies sparse arrays and preserves DAG identity", () => {
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

        const copy = normalize(new Chain(root), [])

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

        expect(value).not.to.be(branch)
        expect(value).to.eql({ pending: "done" })
        expect(root.branch).not.to.be(branch)
        expect(root.branch).to.eql({ pending: "done", later: 2 })
        verifyRefCounts(branch, root.branch)
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

        expect(values).to.eql([
            { pending: "done" },
            { pending: "done" },
        ])
        expect(values[0]).not.to.be(branch)
        expect(values[1]).not.to.be(branch)
        expect(values[0]).not.to.be(values[1])
        expect(metaOf(branch).settlementPromise).to.be(undefined)
        expect(metaOf(branch).settlementResolve).to.be(undefined)
    })

    it("gives callers independent copies from one settlement wait", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const chain = new Chain({ branch })

        const firstResult = normalize(chain, ["branch"])
        const settlementPromise = metaOf(branch).settlementPromise
        const secondResult = normalize(chain, ["branch"])

        expect(metaOf(branch).settlementPromise).to.be(settlementPromise)
        pending.resolve({ done: true })

        const first = await firstResult
        const second = await secondResult
        expect(first).not.to.be(branch)
        expect(second).not.to.be(branch)
        expect(first).not.to.be(second)
        expect(first).to.eql({ pending: { done: true } })
        expect(second).to.eql(first)
        expect(metaOf(first)).to.be(undefined)
        expect(metaOf(first.pending)).to.be(undefined)
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

        expect(childSettlement).to.be.ok()
        expect(rootSettlement).to.be.ok()
        expect(rootSettlement).not.to.be(childSettlement)
        expect(metaOf(root).settlementPromise).to.be(rootSettlement)

        pending.resolve({ done: true })
        const childValue = await childResult
        const rootValue = await rootResult

        expect(childValue).to.eql({ pending: { done: true } })
        expect(childValue).not.to.be(child)
        expect(rootValue).to.eql({ child: { pending: { done: true } } })
        expect(rootValue).not.to.be(root)
        verifyRefCounts(root)
    })

    it("includes earlier suspended writes at their program position", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }

        assignPath(new Chain(root), ["branch", "x"], 1)
        const result = normalize(new Chain(root), ["branch"])

        pending.resolve({})
        const value = await result

        expect(value).not.to.be(root.branch)
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

        expect(value).not.to.be(root.branch)
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

        expect(value).not.to.be(root.branch)
        expect(value).to.eql({ inner: { e: "fixed" } })
        verifyRefCounts(root)
    })

    it("clears the settlement generation at the drained zero-crossing", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const result = normalize(new Chain({ branch }), ["branch"])
        let settlementAtLaterReaction

        const laterReaction = onInternalResolve(pending.promise, () => {
            settlementAtLaterReaction = metaOf(branch).settlementPromise
        })
        pending.resolve("done")
        await Promise.all([result, laterReaction])

        expect(settlementAtLaterReaction).to.be(undefined)
        expect(branch).to.eql({ pending: "done" })
        verifyRefCounts(branch)
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
        expect(value).not.to.be(branch)
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
        const originalOutput = await originalResult
        expect(originalOutput).not.to.be(original)
        expect(originalOutput).to.eql({ first: "first done" })
        expect(original).to.eql({ first: "first done" })
        expectCounts(current, 1, 0)

        const currentResult = normalize(chain, ["branch"])
        second.resolve("second done")
        const currentOutput = await currentResult
        expect(currentOutput).not.to.be(current)
        expect(currentOutput).to.eql({
            first: "first done",
            second: "second done",
        })
        expect(current).to.eql({ first: "first done", second: "second done" })
        verifyRefCounts(original, current)
    })

    it("preserves cyclic imports while exposing their diagnostics separately", () => {
        const cyclic = {}
        cyclic.self = cyclic
        const branch = { cyclic }
        const root = { branch }

        importValue(root, "normalize import")
        expect(metaOf(branch).shared).to.be(undefined)
        expect(metaOf(branch).importBoundary).to.be(undefined)
        const value = normalize(new Chain(root), ["branch"])

        expect(value).not.to.be(branch)
        expect(value.cyclic.self).to.be(value.cyclic)
        expect(hasError(new Chain(root), ["branch"])).to.be(true)
        expect(metaOf(branch).shared).to.be(undefined)
        expect(metaOf(branch).importBoundary).to.be(undefined)
        expect(getRefCounter(branch).errorCount).to.be(1)
    })

    it("does not pin synchronous imported cycle failures", () => {
        const cyclic = { bad: new Error("hidden") }
        cyclic.self = cyclic
        const branch = { cyclic }
        const root = { branch }

        importValue(root, "synchronous cycle failure")
        const result = normalize(new Chain(root), ["branch"])

        expect(result instanceof Error).to.be(true)
        expect(metaOf(branch).shared).to.be(undefined)
        expect(metaOf(branch).importBoundary).to.be(undefined)
    })

    it("pins pending imported branches without making them import roots", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const root = { branch }

        importValue(root, "pending normalize pin")
        const result = normalize(new Chain(root), ["branch"])

        expect(metaOf(branch).shared).to.be(true)
        expect(metaOf(branch).importBoundary).to.be(undefined)

        pending.resolve("done")
        expect(await result).to.eql({ pending: "done" })
        expect(metaOf(branch).importBoundary).to.be(undefined)
    })

    it("normalizes promises inside frozen branches through mirrors", async () => {
        const valid = Object.freeze({ x: 1 })
        const promise = Promise.resolve(1)
        const pending = Object.freeze({ pending: promise })

        importValue(pending, "frozen normalize")
        const copied = normalize(new Chain(valid), [])
        const normalized = normalize(new Chain(pending), [])

        expect(copied).to.eql({ x: 1 })
        expect(copied).not.to.be(valid)
        expect(await normalized).to.eql({ pending: 1 })
        expect(pending.pending).to.be(promise)
        expect(lookupPath(new Chain(pending), ["pending"], false)).to.be(1)
        expect(getRefCounter(valid)).not.to.be(undefined)
        expect(getRefCounter(pending).promiseCount).to.be(0)
        verifyRefCounts(valid, pending)
    })

    it("returns clean frozen branches synchronously as copies", () => {
        const frozen = Object.freeze({ nested: { value: 1 } })
        importValue(frozen, "clean frozen normalize")

        const value = normalize(new Chain(frozen), [])

        expect(value).to.eql({ nested: { value: 1 } })
        expect(value).not.to.be(frozen)
        expect(value.nested).not.to.be(frozen.nested)
        expect(getRefCounter(frozen)).not.to.be(undefined)
        expect(getRefCounter(frozen.nested)).not.to.be(undefined)
        verifyRefCounts(frozen)
    })

    it("waits for a trusted indexed child beneath a frozen ancestor", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }

        expect(buildRefIndex(child)).to.be(child)

        const frozen = Object.freeze({ child })
        importValue(frozen, "frozen indexed normalize")
        const normalized = normalize(new Chain(frozen), [])

        expect(getRefCounter(frozen).promiseCount).to.be(1)
        pending.resolve("done")
        expect(await normalized).to.eql({ child: { pending: "done" } })
        // Existing META makes child a trusted runtime island rather than a
        // newly imported original holder.
        expect(child.pending).to.be("done")
        expect(lookupPath(new Chain(frozen), ["child", "pending"], false)).to.be("done")
        verifyRefCounts(frozen)
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
