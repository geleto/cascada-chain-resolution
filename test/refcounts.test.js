const {
    Chain,
    expect,
    buildRefIndex,
    getRefCounter,
    metaOf,
    STORE_META_IN_WEAKMAP,
    verifyRefCounts,
    assignPath,
    deletePath,
    hasError,
    lookupPath,
    importValue,
    deferred,
    flushMicrotasks,
    expectCounts,
} = require("./support")

describe("subtree counters", () => {
    it("keeps non-ref-indexed writes on the normal mutation path", () => {
        const deferredValue = deferred()
        const root = {}
        const cyclic = {}
        cyclic.self = cyclic

        assignPath(new Chain(root), ["pending"], deferredValue.promise)
        assignPath(new Chain(root), ["nested", "error"], new Error("bad"))
        assignPath(new Chain(root), ["cycle"], cyclic)

        expect(root.pending).to.be(deferredValue.promise)
        expect(root.nested.error instanceof Error).to.be(true)
        expect(root.cycle).to.be(cyclic)
        expect(getRefCounter(root)).to.be(undefined)
        expect(getRefCounter(root.nested)).to.be(undefined)
        verifyRefCounts(root)
    })

    it("uses one fresh metadata record for shared marks, mirrors, and counters", () => {
        const deferredValue = deferred()
        const root = { pending: deferredValue.promise, child: { x: 1 } }

        importValue(root)
        buildRefIndex(root)

        const rootSymbols = Object.getOwnPropertySymbols(root)
        const rootMeta = metaOf(root)

        if (STORE_META_IN_WEAKMAP) {
            expect(rootSymbols.length).to.be(0)
        } else {
            expect(rootSymbols.length).to.be(1)
            expect(root[rootSymbols[0]]).to.be(rootMeta)
            expect(Object.getOwnPropertyDescriptor(root, rootSymbols[0]).enumerable).to.be(false)
        }
        expect(getRefCounter(root)).to.be(rootMeta)
        expect(rootMeta.promiseCount).to.be(1)

        const next = assignPath(new Chain(root), ["added"], true)
        const nextMeta = metaOf(next)
        const nextSymbols = Object.getOwnPropertySymbols(next)

        if (STORE_META_IN_WEAKMAP) {
            expect(nextSymbols.length).to.be(0)
        } else {
            expect(nextSymbols).to.eql(rootSymbols)
            expect(next[nextSymbols[0]]).to.be(nextMeta)
        }
        expect(nextMeta).not.to.be(rootMeta)
        expect(getRefCounter(next)).to.be(nextMeta)
        verifyRefCounts(root, next)
    })

    it("counts primitive, promise, Error, and valid frozen values", () => {
        const frozen = Object.freeze({ nested: { value: 1 } })

        expectCounts(7, 0, 0)
        expectCounts(null, 0, 0)
        expectCounts(Promise.resolve(1), 1, 0)
        expectCounts(new Error("bad"), 0, 1)

        expect(buildRefIndex(frozen)).to.be(frozen)
        expectCounts(frozen, 0, 0)
        verifyRefCounts(frozen)
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

        assignPath(new Chain(root), ["nested", "pending"], nestedPromise.promise)
        expectCounts(root, 2, 1)
        verifyRefCounts(root)
    })

    it("lets hasError signal errors and return the clean wait tree", async () => {
        const clean = { x: 1 }
        const currentError = { bad: new Error("bad") }
        const pendingClean = deferred()
        const pendingBad = deferred()
        const cleanRoot = { value: pendingClean.promise }
        const badRoot = { value: pendingBad.promise }

        expect(hasError(new Chain(clean), [])).to.be(false)
        expect(hasError(new Chain(currentError), [])).to.be(true)
        expect(getRefCounter(currentError).errorCount).to.be(1)

        const pendingCleanProbe = hasError(new Chain(cleanRoot), [])
        const pendingBadProbe = hasError(new Chain(badRoot), [])

        expect(typeof pendingCleanProbe.then).to.be("function")
        expect(typeof pendingBadProbe.then).to.be("function")

        expect(hasError(new Chain(clean), [])).to.be(false)

        pendingClean.resolve({ ok: true })
        pendingBad.reject("bad")

        expect(await pendingCleanProbe).to.be(false)
        expect(await pendingBadProbe).to.be(true)
        verifyRefCounts(cleanRoot, badRoot)
    })

    it("keeps counts exact through writes, deletes, and promise settlement", async () => {
        const first = deferred()
        const second = deferred()
        const root = {
            pending: first.promise,
            error: new Error("old"),
            nested: {},
        }

        buildRefIndex(root)
        expectCounts(root, 1, 1)
        verifyRefCounts(root)

        assignPath(new Chain(root), ["nested", "pending"], second.promise)
        expectCounts(root, 2, 1)
        verifyRefCounts(root)

        deletePath(new Chain(root), ["error"])
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

        buildRefIndex(root)
        assignPath(new Chain(root), ["value"], deferredValue.promise)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        assignPath(new Chain(root), ["value"], 7)
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

        buildRefIndex(root)
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

        buildRefIndex(root)
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

        buildRefIndex(root)
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

        buildRefIndex(child)
        expectCounts(child, 1, 0)

        buildRefIndex(root)
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

        assignPath(new Chain(root), ["branch", "nested"], nested.promise)
        buildRefIndex(root)
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

        buildRefIndex(root)
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

        buildRefIndex(root)
        lookupPath(new Chain(root), [])
        const next = assignPath(new Chain(root), ["added"], true)

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

        buildRefIndex(root)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        deletePath(new Chain(root), ["value"])
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

        lookupPath(new Chain(root), [])
        const next = assignPath(new Chain(root), ["added"], true)
        assignPath(new Chain(next), ["branch", "pending"], deferredValue.promise)

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

        buildRefIndex(root)
        lookupPath(new Chain(root), [])

        const next = assignPath(new Chain(root), ["added"], true)
        expectCounts(root, 1, 1)
        expectCounts(next, 1, 1)
        verifyRefCounts(root, next)

        assignPath(new Chain(next), ["sibling", "error"], "fixed")
        expectCounts(root, 1, 1)
        expectCounts(next, 1, 0)
        verifyRefCounts(root, next)

        deferredBranch.resolve({ ok: true })
        await flushMicrotasks()

        expectCounts(root, 0, 1)
        expectCounts(next, 0, 0)
        verifyRefCounts(root, next)
    })

})
