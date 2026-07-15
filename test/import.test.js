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
    deletePath,
    getErrors,
    hasError,
    lookupPath,
    normalize,
    importValue,
    countPromiseRegistrations,
    deferred,
    flushMicrotasks,
    expectCounts,
} = require("./support")
const { onPromiseMirrorResolve } = require("../src/promise-mirrors")
const {
    commitEdgeTransition,
    deleteEdge,
    prepareEdgeTransition,
} = require("../src/refcounts")

describe("import", () => {
    it("requires a truthy error context", () => {
        for (const context of [undefined, null, "", 0, false]) {
            const root = {}
            let reported
            let caught

            setFatalErrorReporter(error => {
                reported = error
            })
            try {
                runtime.import(root, context)
            } catch (error) {
                caught = error
            } finally {
                setFatalErrorReporter()
            }

            expect(reported).to.be(caught)
            expect(caught instanceof Error).to.be(true)
            expect(caught.message).to.be("import requires an error context")
            expect(metaOf(root)).to.be(undefined)
        }
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

    it("passes primitive and Error imports through unchanged", () => {
        const error = new Error("language error")

        expect(importValue(null, "null import")).to.be(null)
        expect(importValue(undefined, "undefined import")).to.be(undefined)
        expect(importValue(7, "number import")).to.be(7)
        expect(importValue("text", "string import")).to.be("text")
        expect(importValue(error, "error import")).to.be(error)
        expect(metaOf(error)).to.be(undefined)
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

    it("marks only the boundary until counting prepares descendants", async () => {
        const outer = deferred()
        const inner = deferred()
        const leaf = { x: 1 }
        const child = { value: outer.promise }
        const root = { child }

        const imported = importValue(root, "recursive import")

        expect(imported).to.be(root)
        expect(metaOf(root).importContext).to.be("recursive import")
        expect(metaOf(child)).to.be(undefined)

        buildRefIndex(root)
        expect(metaOf(child).shared).to.be(true)
        expect(metaOf(child).importContext).to.be(undefined)

        const resolved = { leaf, inner: inner.promise }
        outer.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved).shared).to.be(true)
        expect(metaOf(resolved).importContext).to.be(undefined)
        expect(metaOf(leaf).shared).to.be(true)

        const nested = { done: true }
        inner.resolve(nested)
        await flushMicrotasks()

        expect(metaOf(nested).shared).to.be(true)
        // External holders keep their original Promise; mirrors carry the value.
        expect(root.child.value).to.be(outer.promise)
    })

    it("shares one import walk across aliased promise branches", async () => {
        const first = deferred()
        const second = deferred()
        const nested = deferred()
        const registrations = countPromiseRegistrations(nested.promise)
        const shared = { nested: nested.promise }
        const root = {
            first: first.promise,
            second: second.promise,
        }

        importValue(root, "async aliases")
        buildRefIndex(root)
        first.resolve({ shared })
        second.resolve(shared)
        await flushMicrotasks()

        expect(registrations()).to.be(1)
        expect(metaOf(shared).shared).to.be(true)
        expect(metaOf(shared).importContext).to.be(undefined)

        const leaf = { done: true }
        nested.resolve(leaf)
        await flushMicrotasks()
        expect(metaOf(leaf).shared).to.be(true)
    })

    it("creates one mirror consumer per imported promise placement", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const root = {
            left: pending.promise,
            right: pending.promise,
        }

        importValue(root, "repeated promise")
        expect(registrations()).to.be(0)
        buildRefIndex(root)
        expect(registrations()).to.be(2)

        const resolved = { nested: {} }
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved).shared).to.be(true)
        expect(metaOf(resolved.nested).shared).to.be(true)
    })

    it("accepts cyclic imports until counting needs the branch", () => {
        const root = {}
        root.self = root

        const imported = importValue(root, "cycle import")
        const indexed = buildRefIndex(root)

        expect(imported).to.be(root)
        expect(indexed).to.be(root)
        expect(getRefCounter(root).errorCount).to.be(1)
        expect(root.self).to.be(root)
    })

    it("marks every intra-SCC property with a stable distinct Error", () => {
        const left = {}
        const right = {}
        left.right = right
        right.left = left
        right.self = right
        importValue(left, "interlocking SCC")

        expect(hasError(new Chain(left), [])).to.be(true)

        const leftError = metaOf(left).edgeMarks.right.error
        const rightError = metaOf(right).edgeMarks.left.error
        const selfError = metaOf(right).edgeMarks.self.error
        expect(leftError.message).to.be(
            'Cyclic property "right" (imported at: interlocking SCC)',
        )
        expect(rightError).not.to.be(leftError)
        expect(selfError).not.to.be(leftError)
        expect(selfError).not.to.be(rightError)
        expect(getErrors(new Chain(right), []).includes(rightError)).to.be(true)
        expect(metaOf(left).edgeMarks.right.error).to.be(leftError)
        const wrapper = importValue({ branch: left }, "marked reuse")
        buildRefIndex(wrapper)
        expect(metaOf(left).edgeMarks.right.error).to.be(leftError)
        expectCounts(left, 0, 1)
        expectCounts(right, 0, 2)
        expectCounts(wrapper, 0, 1)
        verifyRefCounts(wrapper, left, right)
    })

    it("distinguishes batch SCC marking from an incremental closing edge", () => {
        const batchParent = {}
        const batchChild = { back: batchParent }
        batchParent.child = batchChild
        importValue(batchParent, "batch cycle")
        buildRefIndex(batchParent)

        expect(metaOf(batchParent).edgeMarks.child.kind).to.be("cycle")
        expect(metaOf(batchChild).edgeMarks.back.kind).to.be("cycle")

        const incrementalParent = {}
        const incrementalChild = importValue(
            { back: incrementalParent },
            "incremental cycle",
        )
        buildRefIndex(incrementalParent)
        assignPath(new Chain(incrementalParent), ["child"], incrementalChild)

        expect(metaOf(incrementalParent).edgeMarks.child.kind).to.be("cycle")
        expect(metaOf(incrementalChild).edgeMarks).to.be(null)
        expect(incrementalParent.child).to.be(incrementalChild)
        expect(incrementalChild.back).to.be(incrementalParent)
        expectCounts(incrementalParent, 0, 1)
        verifyRefCounts(incrementalParent, incrementalChild)
    })

    it("commits edge-mark kind changes, clearing, and deletion exactly once", () => {
        const owner = {}
        const ancestor = { left: owner, right: owner }
        const cyclic = importValue({ back: owner }, "mark transition cycle")
        const invalid = importValue(
            Object.freeze({ bad: new Error("bad") }),
            "mark transition invalid",
        )
        const clean = { clean: true }
        buildRefIndex(ancestor)
        const replace = value => commitEdgeTransition(
            owner,
            "value",
            null,
            prepareEdgeTransition(owner, "value", null, value),
        )

        replace(cyclic)
        expect(metaOf(owner).edgeMarks.value.kind).to.be("cycle")
        expectCounts(owner, 0, 1)
        expectCounts(ancestor, 0, 2)
        verifyRefCounts(ancestor, owner, cyclic)

        replace(invalid)
        expect(metaOf(owner).edgeMarks.value.kind).to.be("invalid")
        expectCounts(owner, 0, 1)
        expectCounts(ancestor, 0, 2)
        verifyRefCounts(ancestor, owner, cyclic)

        replace(cyclic)
        expect(metaOf(owner).edgeMarks.value.kind).to.be("cycle")
        expectCounts(owner, 0, 1)
        expectCounts(ancestor, 0, 2)
        verifyRefCounts(ancestor, owner, cyclic)

        replace(clean)
        expect(metaOf(owner).edgeMarks.value).to.be(undefined)
        expectCounts(owner, 0, 0)
        expectCounts(ancestor, 0, 0)
        expect(getRefCounter(clean).parents.get(owner)).to.be(1)
        verifyRefCounts(ancestor, owner, cyclic, clean)

        replace(cyclic)
        expect(metaOf(owner).edgeMarks.value.kind).to.be("cycle")
        expectCounts(owner, 0, 1)
        expectCounts(ancestor, 0, 2)
        expect(getRefCounter(clean).parents.has(owner)).to.be(false)
        verifyRefCounts(ancestor, owner, cyclic, clean)

        deleteEdge(owner, "value")
        expect(metaOf(owner).edgeMarks.value).to.be(undefined)
        expectCounts(owner, 0, 0)
        expectCounts(ancestor, 0, 0)
        verifyRefCounts(ancestor, owner, cyclic, clean)
    })

    it("stores cycle metadata for frozen imports in both metadata modes", () => {
        const frozen = {}
        frozen.self = frozen
        Object.freeze(frozen)
        importValue(frozen, "frozen cycle")

        buildRefIndex(frozen)

        expect(metaOf(frozen).edgeMarks.self.error.message).to.be(
            'Cyclic property "self" (imported at: frozen cycle)',
        )
        expectCounts(frozen, 0, 1)
        expect(normalize(new Chain(frozen), [])).to.be(frozen)
        verifyRefCounts(frozen)
    })

    it("propagates descendant cycle markers through frozen imports", () => {
        const child = {}
        child.self = child
        const root = Object.freeze({ child })
        const chain = new Chain(importValue(root, "nested frozen cycle"))

        expect(hasError(chain, [])).to.be(true)
        expect(getErrors(chain, []).length).to.be(1)
        expect(normalize(chain, [])).to.be(root)
        const copy = normalize(chain, [], true, true)
        expect(copy.child.self).to.be(copy.child)
        expectCounts(root, 0, 1)
        expectCounts(child, 0, 1)
        verifyRefCounts(root)
    })

    it("keeps the first import context", () => {
        const root = {}
        root.self = root

        importValue(root, "first import")
        importValue(root, "second import")
        buildRefIndex(root)
        const errors = getErrors(new Chain(root), [])

        expect(errors[0].message).to.be(
            'Cyclic property "self" (imported at: first import)',
        )
    })

    it("uses the nearest nested import context", () => {
        const child = {}
        child.self = child
        importValue(child, "child import")
        const root = importValue({ child }, "parent import")

        buildRefIndex(root)
        const errors = getErrors(new Chain(root), [])

        expect(errors[0].message).to.be(
            'Cyclic property "self" (imported at: child import)',
        )
        expect(getRefCounter(root).errorCount).to.be(1)
        expect(getRefCounter(child).errorCount).to.be(1)
    })

    it("keeps the first context across asynchronous imports", async () => {
        const pending = deferred()
        const first = importValue(pending.promise, "first async import")
        const second = importValue(pending.promise, "second async import")
        const cyclic = {}
        cyclic.self = cyclic

        pending.resolve(cyclic)
        expect(await first).to.be(cyclic)
        expect(await second).to.be(cyclic)

        buildRefIndex(cyclic)
        const errors = getErrors(new Chain(cyclic), [])
        expect(errors[0].message).to.be(
            'Cyclic property "self" (imported at: first async import)',
        )
    })

    it("recovers from failed validation after a COW repair", () => {
        const root = {}
        root.self = root
        importValue(root, "repairable import")
        const chain = new Chain(root)

        expect(hasError(chain, [])).to.be(true)
        expect(getRefCounter(root).errorCount).to.be(1)

        deletePath(chain, ["self"])
        const repaired = chain._state.value

        expect(repaired).not.to.be(root)
        expect(repaired).to.eql({})
        expect(root.self).to.be(root)
        expect(normalize(chain, [])).to.be(repaired)
        expect(hasError(chain, [])).to.be(false)
        verifyRefCounts(repaired)
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
        expect(metaOf(frozenPromise).importContext).to.be("frozen promise")
        expect(getRefCounter(frozenPromise)).to.be(undefined)
    })

    it("preserves the first imported validation failure", () => {
        function invalidFrozenValue(protoFirst) {
            const value = {}
            const addProto = () => Object.defineProperty(value, "__proto__", {
                value: { unsafe: true },
                enumerable: true,
                writable: true,
                configurable: true,
            })
            const addPromise = () => { value.pending = Promise.resolve(1) }
            const additions = protoFirst
                ? [addProto, addPromise]
                : [addPromise, addProto]
            for (const add of additions) add()
            return Object.freeze(value)
        }

        for (const value of [invalidFrozenValue(true), invalidFrozenValue(false)]) {
            importValue(value, "validation order")
            const failure = buildRefIndex(value)

            expect(failure.message).to.be(
                "Cannot use __proto__ as a key (imported at: validation order)",
            )
        }
    })

    it("keeps invalid imported siblings as separate logical overlays", async () => {
        const firstPromise = Promise.resolve(1)
        const secondError = new Error("bad")
        const first = Object.freeze({ clean: 1, pending: firstPromise })
        const second = Object.freeze({ bad: secondError })
        importValue(first, "first invalid sibling")
        importValue(second, "second invalid sibling")
        const wrapper = { keep: true, first, second }
        const chain = new Chain(wrapper)

        const errors = getErrors(chain, [])

        expect(errors.length).to.be(2)
        expect(wrapper.keep).to.be(true)
        expect(wrapper.first).to.be(first)
        expect(wrapper.second).to.be(second)
        expect(first.pending).to.be(firstPromise)
        expect(second.bad).to.be(secondError)
        expect(hasError(chain, ["first", "clean"])).to.be(false)
        expect(normalize(chain, ["first", "clean"])).to.be(1)

        assignPath(chain, ["first", "clean"], 2)
        expect(chain._state.value.first.clean).to.be(2)
        expect(first.clean).to.be(1)
        expect((await getErrors(chain, [])).length).to.be(1)
        verifyRefCounts(chain._state.value)
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

    it("exposes a prohibited value reached through a draining promise", async () => {
        const pending = deferred()
        const root = {
            value: importValue(pending.promise, "pending proto import"),
        }
        const chain = new Chain(root)
        const found = hasError(chain, ["value"])
        const collected = getErrors(chain, ["value"])
        const normalized = normalize(chain, ["value"])
        const mirror = metaOf(root).mirrors.value
        onPromiseMirrorResolve(mirror, () => buildRefIndex(root))
        const invalid = { clean: true }
        Object.defineProperty(invalid, "__proto__", {
            value: Promise.resolve("hidden"),
            enumerable: true,
            writable: true,
            configurable: true,
        })

        pending.resolve(invalid)

        expect(await found).to.be(true)
        const errors = await collected
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be(
            "Cannot use __proto__ as a key (imported at: pending proto import)",
        )
        expect(await normalized).to.be(errors[0])
        expect(mirror.edgeMark.kind).to.be("invalid")
        expect(mirror.edgeMark.error).to.be(errors[0])
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("preserves a prohibited imported property and its Error through COW", () => {
        const hidden = Promise.resolve("hidden")
        const external = { branch: { value: 1 } }
        Object.defineProperty(external, "__proto__", {
            value: hidden,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        importValue(external, "COW proto import")
        const chain = new Chain(external)

        assignPath(chain, ["branch", "value"], 2)
        const copy = chain._state.value
        const errors = getErrors(chain, [])
        const normalized = normalize(chain, [], true, true)

        expect(copy).not.to.be(external)
        expect(Object.getOwnPropertyDescriptor(copy, "__proto__").value).to.be(hidden)
        expect(Object.getPrototypeOf(copy)).to.be(Object.prototype)
        expect(hasError(chain, [])).to.be(true)
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be(
            "Cannot use __proto__ as a key (imported at: COW proto import)",
        )
        expect(normalized instanceof Error).to.be(true)
        expect(external.branch.value).to.be(1)
        expect(copy.branch.value).to.be(2)
        verifyRefCounts(copy)
    })

    it("rechecks a trusted indexed node reached later through import", () => {
        const child = {}
        Object.defineProperty(child, "__proto__", {
            value: { unsafe: true },
            enumerable: true,
            writable: true,
            configurable: true,
        })
        buildRefIndex(child)
        const root = importValue({ child }, "late imported provenance")

        const failure = buildRefIndex(root)

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Cannot use __proto__ as a key (imported at: late imported provenance)",
        )
        expect(getRefCounter(child)).not.to.be(undefined)
        expect(getRefCounter(root)).to.be(undefined)
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
        const indexed = buildRefIndex(next.branch)

        expect(next).not.to.be(root)
        expect(next.branch).not.to.be(branch)
        expect(next.branch.self).to.be(branch)
        expect(indexed).to.be(next.branch)
        expect(hasError(new Chain(next.branch), [])).to.be(true)
    })

    it("discovers imported promise keys when the branch is counted", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        importValue(root, "promise key import")
        buildRefIndex(root)
        expectCounts(root, 1, 0)

        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        const oldValue = lookupPath(new Chain(root), ["value"], false)
        const chain = new Chain(root)
        assignPath(chain, ["value", "x"], 2)
        const next = chain._state.value

        expect(oldValue).to.eql({ x: 1 })
        expect(root.value).to.be(deferredValue.promise)
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

    it("repairs an invalid frozen import through COW deletion", async () => {
        const pending = deferred()
        const frozen = Object.freeze({
            keep: true,
            invalid: pending.promise,
        })
        importValue(frozen, "repair frozen import")
        const chain = new Chain(frozen)

        expect(hasError(chain, [])).to.be(true)
        deletePath(chain, ["invalid"])
        const repaired = chain._state.value

        expect(repaired).not.to.be(frozen)
        expect(repaired).to.eql({ keep: true })
        expect(normalize(chain, [])).to.be(repaired)
        expect(hasError(chain, [])).to.be(false)

        pending.reject("detached")
        await flushMicrotasks()

        expect(repaired).to.eql({ keep: true })
        expect(frozen.invalid).to.be(pending.promise)
        verifyRefCounts(repaired)
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

        buildRefIndex(next)

        expect(next).not.to.be(root)
        expect(root.value).to.be(deferredValue.promise)
        expect(typeof next.value.pending.then).to.be("function")
        const errors = getErrors(new Chain(next), [])
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be(
            "Frozen object cannot contain promises or errors (imported at: frozen fork)",
        )
    })

    it("represents invalid imported writebacks as counted edge Errors", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, "invalid writeback")
        buildRefIndex(root)
        expectCounts(root, 1, 0)

        deferredValue.resolve(Object.freeze({ pending: Promise.resolve(1) }))
        await flushMicrotasks()

        expect(root.nested.value).to.be(deferredValue.promise)
        const errors = getErrors(new Chain(root), [])
        expect(errors[0].message).to.be(
            "Frozen object cannot contain promises or errors (imported at: invalid writeback)",
        )
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("attributes invalid private values from revoked indexed mirrors", async () => {
        const pending = deferred()
        const invalid = Object.freeze({ bad: new Error("bad") })
        const root = { value: pending.promise }
        const chain = new Chain(root)

        importValue(invalid, "revoked writeback")
        buildRefIndex(root)
        const mirror = metaOf(root).mirrors.value
        assignPath(chain, ["value"], "fixed")

        pending.resolve(invalid)
        await flushMicrotasks()

        expect(root.value).to.be("fixed")
        expect(mirror.currentValue).to.be(invalid)
        expect(mirror.edgeMark.kind).to.be("invalid")
        expect(mirror.edgeMark.error.message).to.be(
            "Frozen object cannot contain promises or errors (imported at: revoked writeback)",
        )
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("marks imported writebacks that reach their target without replacing them", async () => {
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

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(metaOf(root.nested).mirrors.value.edgeMark.kind).to.be("cycle")
        expect(metaOf(root.nested).mirrors.value.edgeMark.error.message).to.be(
            'Cyclic property "value" (imported at: writeback back-edge)',
        )
        expectCounts(root, 1, 1)
        verifyRefCounts(root)

        pendingSibling.resolve("done")
        await flushMicrotasks()

        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("marks imported writebacks that contain their target without replacing them", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }
        const resolved = { target: root.nested }

        importValue(root, "containing back-edge")
        buildRefIndex(resolved) // the target must not hide behind this indexed island
        buildRefIndex(root)

        deferredValue.resolve(resolved)
        await flushMicrotasks()

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(getErrors(new Chain(root), [])[0].message).to.be(
            'Cyclic property "value" (imported at: containing back-edge)',
        )
        expect(metaOf(resolved).shared).to.be(true)
        expect(metaOf(resolved).importContext).to.be(undefined)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("marks imported promise assignments that reach their target", async () => {
        const deferredValue = deferred()
        const root = { nested: {} }

        buildRefIndex(root)
        assignPath(new Chain(root), ["nested", "value"], importValue(deferredValue.promise, "assigned promise"))
        expectCounts(root, 1, 0)

        deferredValue.resolve(root)
        await flushMicrotasks()

        expect(root.nested.value).to.be(root)
        expect(getErrors(new Chain(root), [])[0].message).to.be(
            'Cyclic property "value" (imported at: assigned promise)',
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

        const indexed = buildRefIndex(root)

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(lookupPath(new Chain(root), ["nested", "value"], false)).to.be(root.nested)
        expect(indexed).to.be(root)
        expect(hasError(new Chain(root), [])).to.be(true)
    })

    it("lets invalid imported promise roots fail later at counting time", async () => {
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, "promise root")
        const cyclic = {}
        cyclic.self = cyclic

        deferredValue.resolve(cyclic)
        const value = await imported
        const indexed = buildRefIndex(value)

        expect(value).to.be(cyclic)
        expect(indexed).to.be(cyclic)
        expect(hasError(new Chain(value), [])).to.be(true)
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
