const {
    Chain,
    expect,
    runtime,
    setFatalErrorReporter,
    getRefCounter,
    buildRefIndex,
    metaOf,
    STORE_META_IN_WEAKMAP,
    verifyRefCounts,
    assignPath,
    lookupPath,
    importValue,
    deferred,
    flushMicrotasks,
    expectCounts,
} = require("./support")

describe("import", () => {
    it("requires an error context", () => {
        const root = {}
        let reported
        let caught

        setFatalErrorReporter(error => {
            reported = error
        })
        try {
            runtime.import(root)
        } catch (error) {
            caught = error
        } finally {
            setFatalErrorReporter()
        }

        expect(reported).to.be(caught)
        expect(caught instanceof Error).to.be(true)
        expect(caught.message).to.be("import requires an error context")
        expect(metaOf(root)).to.be(undefined)
    })

    it("marks external roots as shared", () => {
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const oldPos = root.pos
        const oldDelta = root.delta

        const imported = importValue(root)
        const chain = new Chain(imported)
        assignPath(chain, ["pos", "x"], 2)
        const next = chain._state.value

        expect(imported).to.be(root)
        expect(next).not.to.be(root)
        expect(next.pos).not.to.be(oldPos)
        expect(next.delta).to.be(oldDelta)
        expect(root.pos.x).to.be(1)
        expect(next.pos.x).to.be(2)

        assignPath(chain, ["delta", "x"], 5)

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
        const chain = new Chain(root)
        assignPath(chain, ["branch", "x"], 2)
        const next = chain._state.value

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
        const chain = new Chain(value)
        assignPath(chain, ["branch", "x"], 2)
        const next = chain._state.value

        expect(value).to.be(root)
        expect(next).not.to.be(root)
        expect(root.branch.x).to.be(1)
        expect(next.branch.x).to.be(2)
    })

    it("treats frozen imported objects without promises as shared for COW", () => {
        const root = Object.freeze({ branch: { x: 1 } })
        const oldBranch = root.branch

        importValue(root)
        const chain = new Chain(root)
        assignPath(chain, ["branch", "x"], 2)
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(next.branch).not.to.be(oldBranch)
        expect(root.branch.x).to.be(1)
        expect(next.branch.x).to.be(2)
    })

    it("marks only the imported root and does not scan children", async () => {
        const deferredValue = deferred()
        const child = { value: deferredValue.promise }
        const root = { child }

        const imported = importValue(root)
        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        expect(imported).to.be(root)
        expect(metaOf(root).importContext).to.be("test import")
        expect(metaOf(child)).to.be(undefined)
        expect(root.child.value).to.be(deferredValue.promise)
    })

    it("accepts cyclic imports until counting needs the branch", () => {
        const root = {}
        root.self = root

        const imported = importValue(root, "cycle import")
        const failure = buildRefIndex(root)

        expect(imported).to.be(root)
        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Value cannot be cyclic (imported at: cycle import)")
        expect(getRefCounter(root)).to.be(undefined)
    })

    it("keeps the first import context", () => {
        const root = {}
        root.self = root

        importValue(root, "first import")
        importValue(root, "second import")
        const failure = buildRefIndex(root)

        expect(failure.message).to.be("Value cannot be cyclic (imported at: first import)")
    })

    it("rejects frozen imported subtrees only when counting", () => {
        const frozenPromise = Object.freeze({ pending: Promise.resolve(1) })
        const nestedFrozenPromise = Object.freeze({ nested: { pending: Promise.resolve(1) } })
        const frozenError = Object.freeze({ error: new Error("bad") })

        expect(importValue(frozenPromise, "frozen promise")).to.be(frozenPromise)
        expect(importValue(nestedFrozenPromise, "nested frozen promise")).to.be(nestedFrozenPromise)
        expect(importValue(frozenError, "frozen error")).to.be(frozenError)

        const promiseFailure = buildRefIndex(frozenPromise)
        const nestedPromiseFailure = buildRefIndex(nestedFrozenPromise)
        const errorFailure = buildRefIndex(frozenError)

        expect(promiseFailure instanceof Error).to.be(true)
        expect(nestedPromiseFailure instanceof Error).to.be(true)
        expect(errorFailure instanceof Error).to.be(true)
        expect(promiseFailure.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: frozen promise)",
        )
        expect(nestedPromiseFailure.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: nested frozen promise)",
        )
        expect(errorFailure.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: frozen error)",
        )
        if (STORE_META_IN_WEAKMAP) {
            expect(metaOf(frozenPromise).importContext).to.be("frozen promise")
            expect(getRefCounter(frozenPromise)).to.be(undefined)
        } else {
            expect(metaOf(frozenPromise)).to.be(undefined)
        }
    })

    it("rejects imported own __proto__ keys when counting", () => {
        const root = {}
        Object.defineProperty(root, "__proto__", {
            value: { unsafe: true },
            enumerable: true,
            writable: true,
            configurable: true,
        })

        expect(importValue(root, "proto import")).to.be(root)

        const failure = buildRefIndex(root)

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Cannot use __proto__ as a key (imported at: proto import)")
    })

    it("marks extracted imported values even when ownership is ceded", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        importValue(root, "extract import")
        const extracted = lookupPath(new Chain(root), ["branch"], false)
        const chain = new Chain(extracted)
        assignPath(chain, ["x"], 2)
        const next = chain._state.value

        expect(extracted).to.be(branch)
        expect(metaOf(branch).importContext).to.be("extract import")
        expect(next).not.to.be(branch)
        expect(branch.x).to.be(1)
        expect(next.x).to.be(2)
    })

    it("preserves import context on copied path-key children", () => {
        const branch = {}
        branch.self = branch
        const root = {
            branch,
            sibling: { x: 1 },
        }

        importValue(root, "path child import")
        const chain = new Chain(root)
        assignPath(chain, ["branch", "added"], 2)
        const next = chain._state.value
        const failure = buildRefIndex(next.branch)

        expect(next).not.to.be(root)
        expect(next.branch).not.to.be(branch)
        expect(next.branch.self).to.be(branch)
        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Value cannot be cyclic (imported at: path child import)")
    })

    it("discovers imported promise keys when the branch is counted", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        importValue(root, "promise key import")
        buildRefIndex(root)
        expectCounts(root, 1, 0)

        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        const oldValue = root.value
        const chain = new Chain(root)
        assignPath(chain, ["value", "x"], 2)
        const next = chain._state.value

        expect(oldValue).to.eql({ x: 1 })
        expect(next).not.to.be(root)
        expect(next.value).not.to.be(oldValue)
        expect(oldValue.x).to.be(1)
        expect(next.value.x).to.be(2)
        expectCounts(root, 0, 0)
        verifyRefCounts(root, next)
    })

    it("reads frozen promise keys without mirrors or writeback", async () => {
        const deferredValue = deferred()
        const root = Object.freeze({ value: deferredValue.promise })

        importValue(root, "frozen read")
        const read = lookupPath(new Chain(root), ["value"])
        deferredValue.resolve({ x: 1 })
        const value = await read

        expect(value).to.eql({ x: 1 })
        expect(root.value).to.be(deferredValue.promise)

        const chain = new Chain(value)
        assignPath(chain, ["x"], 2)
        const next = chain._state.value
        expect(next).not.to.be(value)
        expect(value.x).to.be(1)
        expect(next.x).to.be(2)
    })

    it("copies frozen promise keys into mutable imported mirrors", async () => {
        const deferredValue = deferred()
        const root = Object.freeze({
            value: deferredValue.promise,
            sibling: { x: 1 },
        })

        importValue(root, "frozen fork")
        const chain = new Chain(root)
        assignPath(chain, ["sibling", "x"], 2)
        const next = chain._state.value

        deferredValue.resolve(Object.freeze({ pending: Promise.resolve(1) }))
        await flushMicrotasks()

        const failure = buildRefIndex(next)

        expect(next).not.to.be(root)
        expect(root.value).to.be(deferredValue.promise)
        expect(typeof next.value.pending.then).to.be("function")
        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: frozen fork)",
        )
    })

    it("turns invalid imported promise writebacks into counted Error values", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, "invalid writeback")
        buildRefIndex(root)
        expectCounts(root, 1, 0)

        deferredValue.resolve(Object.freeze({ pending: Promise.resolve(1) }))
        await flushMicrotasks()

        expect(root.nested.value instanceof Error).to.be(true)
        expect(root.nested.value.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: invalid writeback)",
        )
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("turns imported promise writebacks that reach their target into Error values", async () => {
        const deferredValue = deferred()
        const pendingSibling = deferred()
        const root = {
            nested: {
                pending: pendingSibling.promise,
                value: deferredValue.promise,
            },
        }

        importValue(root, "writeback back-edge")
        buildRefIndex(root)
        expectCounts(root, 2, 0)

        deferredValue.resolve(root)
        await flushMicrotasks()

        expect(root.nested.value instanceof Error).to.be(true)
        expect(root.nested.value.message).to.be(
            "Value cannot reach its write target (imported at: writeback back-edge)",
        )
        expectCounts(root, 1, 1)
        verifyRefCounts(root)

        pendingSibling.resolve("done")
        await flushMicrotasks()

        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("turns imported promise writebacks that contain their target into Error values", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }
        const resolved = { target: root.nested }

        importValue(root, "containing back-edge")
        buildRefIndex(root)

        deferredValue.resolve(resolved)
        await flushMicrotasks()

        expect(root.nested.value instanceof Error).to.be(true)
        expect(root.nested.value.message).to.be(
            "Value cannot reach its write target (imported at: containing back-edge)",
        )
        expect(metaOf(resolved).importContext).to.be("containing back-edge")
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("turns imported promise assignments that reach their target into Error values", async () => {
        const deferredValue = deferred()
        const root = { nested: {} }

        buildRefIndex(root)
        assignPath(new Chain(root), ["nested", "value"], importValue(deferredValue.promise, "assigned promise"))
        expectCounts(root, 1, 0)

        deferredValue.resolve(root)
        await flushMicrotasks()

        expect(root.nested.value instanceof Error).to.be(true)
        expect(root.nested.value.message).to.be(
            "Value cannot reach its write target (imported at: assigned promise)",
        )
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("lets non-ref-indexed back-edges float until counting", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, "floating back-edge")
        lookupPath(new Chain(root), ["nested", "value"])
        deferredValue.resolve(root.nested)
        await flushMicrotasks()

        const failure = buildRefIndex(root)

        expect(root.nested.value).to.be(root.nested)
        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Value cannot be cyclic (imported at: floating back-edge)")
    })

    it("lets invalid imported promise roots fail later at counting time", async () => {
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, "promise root")
        const cyclic = {}
        cyclic.self = cyclic

        deferredValue.resolve(cyclic)
        const value = await imported
        const failure = buildRefIndex(value)

        expect(value).to.be(cyclic)
        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Value cannot be cyclic (imported at: promise root)")
    })

    it("keeps import context when promise roots resolve to frozen invalid values", async () => {
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, "frozen promise root")
        const frozen = Object.freeze({ pending: Promise.resolve(1) })

        deferredValue.resolve(frozen)
        const value = await imported
        const failure = buildRefIndex(value)

        expect(value).to.be(frozen)
        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: frozen promise root)",
        )
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
