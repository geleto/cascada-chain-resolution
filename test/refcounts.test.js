const {
    Chain,
    expect,
    buildRefIndex,
    getRefCounter,
    getRefCounts,
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
    thrownBy,
} = require("./support")

describe("subtree counters", () => {
    it("keeps inline metadata visible after a node becomes non-extensible", () => {
        const root = { bad: new Error("bad") }

        buildRefIndex(root)
        const counter = getRefCounter(root)
        Object.preventExtensions(root)

        expect(getRefCounter(root)).to.be(counter)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("keeps non-ref-indexed writes on the normal mutation path", () => {
        const deferredValue = deferred()
        const root = { nested: {} }
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

    it("preserves an indexed mirror when its property cannot be assigned", () => {
        const pending = deferred()
        const root = {}
        Object.defineProperty(root, "value", {
            value: pending.promise,
            enumerable: true,
            writable: false,
            configurable: true,
        })
        buildRefIndex(root)
        const mirror = metaOf(root).mirrors.value
        const replacement = importValue({ clean: true }, "blocked assignment")

        const failure = thrownBy(() => {
            assignPath(new Chain(root), ["value"], replacement)
        })

        expect(failure.message).to.be("Cannot assign to non-writable property")
        expect(root.value).to.be(pending.promise)
        expect(metaOf(root).mirrors.value).to.be(mirror)
        expect(metaOf(replacement).importPrepared).to.be(false)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)
    })

    it("preserves indexed counts and parents when a property cannot be deleted", () => {
        const child = { bad: new Error("bad") }
        const root = {}
        Object.defineProperty(root, "value", {
            value: child,
            enumerable: true,
            writable: true,
            configurable: false,
        })
        buildRefIndex(root)

        const failure = thrownBy(() => {
            deletePath(new Chain(root), ["value"])
        })

        expect(failure.message).to.be("Cannot delete non-configurable property")
        expect(root.value).to.be(child)
        expect(getRefCounter(child).parents.get(root)).to.be(1)
        expectCounts(root, 0, 1)
        verifyRefCounts(root, child)
    })

    it("counts path Errors installed by broken mutations", () => {
        const assigned = {}
        const deleted = {}
        buildRefIndex(assigned)
        buildRefIndex(deleted)

        assignPath(new Chain(assigned), ["missing", "value"], 1)
        deletePath(new Chain(deleted), ["missing", "value"])

        expect(assigned.missing instanceof Error).to.be(true)
        expect(deleted.missing instanceof Error).to.be(true)
        expectCounts(assigned, 0, 1)
        expectCounts(deleted, 0, 1)

        assignPath(new Chain(assigned), ["missing"], {})
        deletePath(new Chain(deleted), ["missing"])

        expectCounts(assigned, 0, 0)
        expectCounts(deleted, 0, 0)
        verifyRefCounts(assigned, deleted)
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

        const chain = new Chain(root)
        assignPath(chain, ["added"], true)
        const next = chain._state.value
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

    it("does not inherit metadata through object prototypes", () => {
        const pending = deferred()
        const prototype = {}
        const child = Object.create(prototype)
        child.pending = pending.promise
        const root = { prototype, child }

        buildRefIndex(root)

        expectCounts(prototype, 0, 0)
        expectCounts(child, 1, 0)
        expectCounts(root, 1, 0)
        expect(metaOf(child)).not.to.be(metaOf(prototype))
        verifyRefCounts(root)
    })

    it("counts primitive, promise, Error, and valid frozen values", () => {
        const frozen = Object.freeze({ nested: { value: 1 } })
        const sharedChild = { value: 2 }
        const frozenDAG = Object.freeze({ left: sharedChild, right: sharedChild })

        expectCounts(7, 0, 0)
        expectCounts(null, 0, 0)
        expectCounts(Promise.resolve(1), 1, 0)
        expectCounts(new Error("bad"), 0, 1)

        expect(buildRefIndex(frozen)).to.be(frozen)
        expect(buildRefIndex(frozenDAG)).to.be(frozenDAG)
        expectCounts(frozen, 0, 0)
        expectCounts(frozenDAG, 0, 0)
        verifyRefCounts(frozen, frozenDAG)
    })

    it("rejects count reads from non-ref-indexed tracked values", () => {
        const failure = thrownBy(() => getRefCounts({ value: 1 }))

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Ref counts require a ref-indexed value")
    })

    it("revalidates indexed descendants beneath non-extensible ancestors", () => {
        const pending = deferred()
        const child = { pending: pending.promise }

        expect(buildRefIndex(child)).to.be(child)

        const wrapper = Object.preventExtensions({ child })
        importValue(wrapper, "frozen indexed child")
        const failure = buildRefIndex(wrapper)

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: frozen indexed child)",
        )
        expect(getRefCounter(wrapper)).to.be(undefined)
    })

    it("revalidates a DAG child reached later through a non-extensible ancestor", () => {
        const pending = deferred()
        const child = { pending: pending.promise }
        const wrapper = Object.preventExtensions({ child })
        const root = { plain: child, frozen: wrapper }
        importValue(wrapper, "frozen DAG child")

        const indexed = buildRefIndex(root)

        expect(indexed).to.be(root)
        expectCounts(root, 1, 1)
        expect(getRefCounter(child)).not.to.be(undefined)
    })

    it("leaves no counters or mirrors when validation fails before commit", async () => {
        const pending = deferred()
        const earlier = { pending: pending.promise }
        const invalid = Object.freeze({ bad: new Error("bad") })
        const root = { earlier, invalid }

        importValue(root, "transactional index")
        const failure = buildRefIndex(root)

        expect(failure instanceof Error).to.be(true)
        expect(getRefCounter(root)).to.be(undefined)
        expect(getRefCounter(earlier)).to.be(undefined)
        expect(metaOf(root).mirrors).to.be(null)
        expect(metaOf(earlier)).to.be(undefined)

        root.invalid = { clean: true }
        expect(buildRefIndex(root)).to.be(root)
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        pending.resolve("done")
        await flushMicrotasks()

        expect(earlier.pending).to.be(pending.promise)
        expect(lookupPath(new Chain(root), ["earlier", "pending"], false)).to.be("done")
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("indexes a cyclic imported branch without replacing its data", () => {
        const cycle = {}
        const imported = { child: cycle, keep: true }
        const root = {}
        cycle.next = { back: cycle }

        importValue(imported, "nested cycle")
        buildRefIndex(root)
        assignPath(new Chain(root), ["branch"], imported)

        expect(root.branch).to.be(imported)
        expect(imported.child).to.be(cycle)
        expect(cycle.next.back).to.be(cycle)
        expectCounts(root, 0, 1)
        expect(getRefCounter(imported).errorCount).to.be(1)
        verifyRefCounts(root)
    })

    it("cuts an imported child back-reference without re-indexing its owner", async () => {
        const pending = deferred()
        const wrapper = { pending: pending.promise }
        const child = importValue({ back: wrapper }, "nested imported back-reference")
        wrapper.child = child

        buildRefIndex(wrapper)

        expect(metaOf(wrapper).edgeMarks.child.error.message).to.be(
            'Cyclic property "child" (imported at: nested imported back-reference)',
        )
        expect(metaOf(child).edgeMarks).to.be(null)
        expectCounts(wrapper, 1, 1)
        verifyRefCounts(wrapper, child)

        pending.resolve("done")
        await flushMicrotasks()

        expectCounts(wrapper, 0, 1)
        verifyRefCounts(wrapper, child)
    })

    it("verifies indexed islands reached through unindexed wrappers", () => {
        const child = { clean: true }
        const wrapper = { child }

        buildRefIndex(child)
        getRefCounter(child).errorCount = 1

        const failure = thrownBy(() => verifyRefCounts(wrapper))

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Counter totals are inconsistent")
    })

    it("detects every parent-edge consistency failure", () => {
        const missingChildIndexRoot = {}
        buildRefIndex(missingChildIndexRoot)
        missingChildIndexRoot.child = {}
        expect(thrownBy(() => verifyRefCounts(missingChildIndexRoot)).message).to.be(
            "Ref-indexed parent contains non-ref-indexed child",
        )

        const missingReverseChild = {}
        const missingReverseRoot = { child: missingReverseChild }
        buildRefIndex(missingReverseRoot)
        getRefCounter(missingReverseChild).parents.delete(missingReverseRoot)
        expect(thrownBy(() => verifyRefCounts(missingReverseRoot)).message).to.be(
            "Parent edge count is inconsistent",
        )

        const primitiveParentChild = {}
        buildRefIndex(primitiveParentChild)
        getRefCounter(primitiveParentChild).parents.set(7, 1)
        expect(thrownBy(() => verifyRefCounts(primitiveParentChild)).message).to.be(
            "Parent edge points to untracked parent",
        )

        const unindexedParentChild = {}
        const unindexedParent = { child: unindexedParentChild }
        buildRefIndex(unindexedParentChild)
        getRefCounter(unindexedParentChild).parents.set(unindexedParent, 1)
        expect(thrownBy(() => verifyRefCounts(unindexedParentChild)).message).to.be(
            "Parent edge points to non-ref-indexed parent",
        )

        const detachedChild = {}
        const detachedParent = { child: detachedChild }
        buildRefIndex(detachedParent)
        delete detachedParent.child
        expect(thrownBy(() => verifyRefCounts(detachedChild)).message).to.be(
            "Parent edge count is inconsistent",
        )
    })

    it("reports a committed parent-graph cycle fatally", () => {
        const left = {}
        const right = {}
        buildRefIndex(left)
        buildRefIndex(right)

        left.right = right
        right.left = left
        getRefCounter(left).parents.set(right, 1)
        getRefCounter(right).parents.set(left, 1)

        const failure = thrownBy(() => verifyRefCounts(left))
        expect(failure.message).to.be("Ref-count parent graph contains a cycle")
    })

    it("bookkeeps tracked branches after ref-indexing", () => {
        const deferredValue = deferred()
        const nestedPromise = deferred()
        const root = {
            pending: deferredValue.promise,
            nested: { error: new Error("bad") },
        }

        buildRefIndex(root)
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

    it("ref-indexes a revoked mirror's private resolved branch", async () => {
        const outer = deferred()
        const inner = deferred()
        const resolved = {
            bad: new Error("bad"),
            nested: { pending: inner.promise },
        }
        const root = { value: outer.promise }
        const chain = new Chain(root)

        buildRefIndex(root)
        const mirror = metaOf(root).mirrors.value
        assignPath(chain, ["value"], "fixed")

        outer.resolve(resolved)
        await flushMicrotasks()

        const counter = getRefCounter(resolved)
        expect(root.value).to.be("fixed")
        expect(mirror.currentValue).to.be(resolved)
        expect(counter).not.to.be(undefined)
        expect(counter.promiseCount).to.be(1)
        expect(counter.errorCount).to.be(1)
        expect(counter.parents.size).to.be(0)
        verifyRefCounts(root, resolved)

        inner.resolve("done")
        await flushMicrotasks()

        expect(getRefCounter(resolved).promiseCount).to.be(0)
        verifyRefCounts(root, resolved)
    })

    it("validates a revoked mirror value as a child of its indexed parent", async () => {
        const pending = deferred()
        const root = {
            value: importValue(pending.promise, "revoked back-edge"),
        }
        const chain = new Chain(root)

        buildRefIndex(root)
        const mirror = metaOf(root).mirrors.value
        assignPath(chain, ["value"], "fixed")

        pending.resolve(root)
        await flushMicrotasks()

        expect(root.value).to.be("fixed")
        expect(mirror.currentValue).to.be(root)
        expect(mirror.edgeMark.kind).to.be("cycle")
        expect(mirror.edgeMark.error.message).to.be(
            'Cyclic property "value" (imported at: revoked back-edge)',
        )
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("keeps one count when the same promise is assigned again", async () => {
        const pending = deferred()
        const root = {}
        const chain = new Chain(root)

        buildRefIndex(root)
        assignPath(chain, ["value"], pending.promise)
        const firstRead = lookupPath(chain, ["value"])
        assignPath(chain, ["value"], pending.promise)
        assignPath(chain, ["value", "x"], 1)

        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        pending.resolve({})
        const firstValue = await firstRead
        await flushMicrotasks()

        expect(firstValue).to.eql({})
        expect(root.value).to.eql({ x: 1 })
        expect(root.value).not.to.be(firstValue)
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

    it("keeps mirror advances aligned with validation replacements", async () => {
        const pending = deferred()
        const root = { pending: pending.promise }
        const chain = new Chain(root)
        const cyclic = {}
        cyclic.self = cyclic

        importValue(cyclic, "mirror validation replacement")
        buildRefIndex(root)
        const observed = lookupPath(chain, ["pending"])

        pending.resolve(cyclic)
        const value = await observed

        expect(root.pending).to.be(cyclic)
        expect(value).to.be(root.pending)
        expect(hasError(new Chain(root), [])).to.be(true)
        expect(cyclic.self).to.be(cyclic)
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

    it("decrements one edge without detaching an aliased child", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = { left: child, right: child }
        const chain = new Chain(root)

        buildRefIndex(root)
        deletePath(chain, ["left"])

        expectCounts(child, 1, 0)
        expectCounts(root, 1, 0)
        expect(getRefCounter(child).parents.get(root)).to.be(1)
        verifyRefCounts(root, child)

        pending.resolve("done")
        await flushMicrotasks()

        expectCounts(root, 0, 0)
        verifyRefCounts(root, child)
    })

    it("detaches a shared child from only the replaced parent", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }
        const left = { child }
        const right = { child }
        const root = { left, right }
        const chain = new Chain(root)

        buildRefIndex(root)
        deletePath(chain, ["left", "child"])

        expectCounts(left, 0, 0)
        expectCounts(right, 1, 0)
        expectCounts(root, 1, 0)
        expect(getRefCounter(child).parents.has(left)).to.be(false)
        expect(getRefCounter(child).parents.get(right)).to.be(1)
        verifyRefCounts(root, child)

        pending.resolve("done")
        await flushMicrotasks()

        expectCounts(right, 0, 0)
        expectCounts(root, 0, 0)
        verifyRefCounts(root, child)
    })

    it("swaps counted subtrees and isolates their later settlements", async () => {
        const oldPending = deferred()
        const firstNewPending = deferred()
        const secondNewPending = deferred()
        const oldChild = { pending: oldPending.promise }
        const newChild = {
            first: firstNewPending.promise,
            second: secondNewPending.promise,
        }
        const root = { child: oldChild }
        const chain = new Chain(root)

        buildRefIndex(root)
        assignPath(chain, ["child"], newChild)

        expectCounts(root, 2, 0)
        expect(getRefCounter(oldChild).parents.has(root)).to.be(false)
        expect(getRefCounter(newChild).parents.get(root)).to.be(1)
        verifyRefCounts(root, oldChild)

        oldPending.resolve(new Error("detached"))
        await flushMicrotasks()

        expectCounts(oldChild, 0, 1)
        expectCounts(root, 2, 0)
        verifyRefCounts(root, oldChild)

        firstNewPending.resolve("done")
        await flushMicrotasks()
        expectCounts(root, 1, 0)

        secondNewPending.reject("bad")
        await flushMicrotasks()
        expectCounts(root, 0, 1)
        verifyRefCounts(root, oldChild)
    })

    it("recovers indexed counters when an Error is replaced", () => {
        const root = {}
        const chain = new Chain(root)

        buildRefIndex(root)
        assignPath(chain, ["value"], new Error("bad"))
        expectCounts(root, 0, 1)
        verifyRefCounts(root)

        assignPath(chain, ["value"], { clean: true })
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("preserves parent-edge multiplicity across COW worlds", async () => {
        const deferredValue = deferred()
        const child = { pending: deferredValue.promise }
        const root = { left: child, right: child }

        buildRefIndex(root)
        lookupPath(new Chain(root), [])
        const chain = new Chain(root)
        assignPath(chain, ["added"], true)
        const next = chain._state.value

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
        const chain = new Chain(root)
        assignPath(chain, ["added"], true)
        const next = chain._state.value
        assignPath(chain, ["branch", "pending"], deferredValue.promise)

        buildRefIndex(root)
        buildRefIndex(next)
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
        const chain = new Chain(root)

        assignPath(chain, ["added"], true)
        const next = chain._state.value
        expectCounts(root, 1, 1)
        expectCounts(next, 1, 1)
        verifyRefCounts(root, next)

        assignPath(chain, ["sibling", "error"], "fixed")
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
