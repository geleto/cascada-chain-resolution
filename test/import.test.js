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
const {
    getOrCreatePromiseMirror,
    onPromiseMirrorResolve,
    setPromiseMirrorValue,
} = require("../src/promise-mirrors")

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

    it("derives physical Promise ownership from the holder", async () => {
        const externalPending = deferred()
        const runtimePending = deferred()
        const external = { pending: externalPending.promise }
        const runtimeOwned = { pending: runtimePending.promise }

        // Existing META identifies a value that was already inside the runtime.
        lookupPath(new Chain(runtimeOwned), [])
        importValue(external, "external holder")
        importValue(runtimeOwned, "runtime holder")

        expect(metaOf(external).importedOriginal).to.be(true)
        expect(metaOf(runtimeOwned).importedOriginal).to.be(undefined)

        externalPending.resolve("external")
        runtimePending.resolve("runtime")
        await flushMicrotasks()

        expect(external.pending).to.be(externalPending.promise)
        expect(runtimeOwned.pending).to.be("runtime")
        expect(lookupPath(new Chain(external), ["pending"], false)).to.be(
            "external",
        )
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

    it("does not allocate metadata merely to share a clean non-extensible value", () => {
        const value = Object.freeze({ x: 1 })

        expect(lookupPath(new Chain(value), [])).to.be(value)
        expect(metaOf(value)).to.be(undefined)
    })

    it("prepares imported descendants and promises eagerly", async () => {
        const outer = deferred()
        const inner = deferred()
        const leaf = { x: 1 }
        const child = { value: outer.promise }
        const root = { child }

        const imported = importValue(root, "recursive import")

        expect(imported).to.be(root)
        expect(metaOf(root).importBoundary.root).to.be(root)
        expect(metaOf(root).importBoundary.errorContext).to.be("recursive import")
        expect(metaOf(child).shared).to.be(undefined)
        expect(metaOf(child).importBoundary).to.be(undefined)
        expect(metaOf(child).mirrors.value.promise).to.be(outer.promise)

        buildRefIndex(root)
        expect(metaOf(child).shared).to.be(undefined)
        expect(metaOf(child).importBoundary).to.be(undefined)

        const resolved = { leaf, inner: inner.promise }
        outer.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved)?.shared).to.be(undefined)
        expect(metaOf(resolved).importBoundary).to.be(undefined)
        expect(metaOf(leaf).shared).to.be(undefined)

        const nested = { done: true }
        inner.resolve(nested)
        await flushMicrotasks()

        expect(metaOf(nested).shared).to.be(undefined)
        expect(metaOf(nested).importBoundary).to.be(undefined)
        // External holders keep their original Promise; mirrors carry the value.
        expect(root.child.value).to.be(outer.promise)
    })

    it("marks a repeated synchronous imported identity shared", () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const shared = { pending: pending.promise }

        importValue({ left: shared, right: shared }, "synchronous alias")

        // One mandatory writeback and one full-preparation consumer.
        expect(registrations()).to.be(2)
        expect(metaOf(shared).shared).to.be(true)
    })

    it("detects repeated imported identities across import calls", () => {
        const shared = { value: 1 }

        importValue({ first: shared }, "first owner")
        expect(metaOf(shared).shared).to.be(undefined)

        importValue({ second: shared }, "second owner")
        expect(metaOf(shared).shared).to.be(true)
    })

    it("checks one imported promise under each captured ancestry", async () => {
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

        // Mandatory writeback, original preparation, and the later path check.
        expect(registrations()).to.be(3)
        expect(metaOf(shared).shared).to.be(true)
        expect(metaOf(shared).importBoundary).to.be(undefined)

        const leaf = { done: true }
        nested.resolve(leaf)
        await flushMicrotasks()
        expect(metaOf(leaf).shared).to.be(undefined)
    })

    it("eagerly registers one writeback and preparation per promise placement", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const root = {
            left: pending.promise,
            right: pending.promise,
        }

        importValue(root, "repeated promise")
        expect(registrations()).to.be(4)
        buildRefIndex(root)
        expect(registrations()).to.be(4)

        const resolved = { nested: {} }
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved).shared).to.be(true)
        expect(metaOf(resolved.nested).shared).to.be(undefined)
    })

    it("keeps import preparation on its mirror when the same promise is reassigned", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }
        const chain = new Chain(root)

        importValue(root, "same promise import")
        const firstMirror = metaOf(root).mirrors.branch
        const firstRead = lookupPath(chain, ["branch"])

        assignPath(chain, ["branch"], pending.promise)
        const next = chain._state.value
        const secondMirror = metaOf(next).mirrors.branch
        assignPath(chain, ["branch", "x"], 1)

        expect(secondMirror).not.to.be(firstMirror)

        pending.resolve({})
        const firstValue = await firstRead
        await flushMicrotasks()

        expect(firstValue).to.eql({})
        expect(lookupPath(chain, ["branch"], false)).to.eql({ x: 1 })
        expect(firstMirror.currentValue).not.to.be(secondMirror.currentValue)
    })

    it("walks settled promise values at its FIFO position", async () => {
        const pending = deferred()
        const replacement = { clean: true }
        const root = { value: pending.promise }

        importValue(root, "FIFO import continuation")
        const importBoundary = metaOf(root).importBoundary
        const mirror = getOrCreatePromiseMirror(
            root,
            "value",
            pending.promise,
            importBoundary,
        )
        onPromiseMirrorResolve(mirror, () => {
            setPromiseMirrorValue(mirror, replacement)
        })
        buildRefIndex(root)

        pending.resolve(root)
        await flushMicrotasks()

        expect(mirror.currentValue).to.be(replacement)
        expect(mirror.cycleError).to.be(undefined)
        expectCounts(root, 0, 0)
        verifyRefCounts(root, replacement)
    })

    it("uses a Promise's captured path when it joins visited branches", async () => {
        const pending = deferred()
        const shared = { pending: pending.promise }
        const bridge = { back: shared }
        const root = { shared, bridge }

        importValue(root, "asynchronous bridge")
        buildRefIndex(root)

        pending.resolve(bridge)
        await flushMicrotasks()

        expect(hasError(new Chain(root), [])).to.be(true)
        const cycleError = metaOf(shared).mirrors.pending.cycleError
        expect(cycleError.message).to.be(
            'Cyclic property "pending" (imported at: asynchronous bridge)',
        )
        expect(metaOf(bridge).cycleErrors).to.be(undefined)
        expect(getErrors(new Chain(root), [])).to.eql([cycleError])
        verifyRefCounts(root, shared, bridge)
    })

    it("checks a visited subtree against a Promise's captured path", async () => {
        const pending = deferred()
        const ancestor = { pending: pending.promise }
        const tail = { back: ancestor }
        const bridge = { tail }
        const root = { ancestor, bridge }

        importValue(root, "asynchronous subtree bridge")
        buildRefIndex(root)

        pending.resolve(bridge)
        await flushMicrotasks()

        const cycleError = metaOf(ancestor).mirrors.pending.cycleError
        expect(cycleError.message).to.be(
            'Cyclic property "pending" (imported at: asynchronous subtree bridge)',
        )
        expect(metaOf(tail).cycleErrors).to.be(undefined)
        expect(getErrors(new Chain(root), [])).to.eql([cycleError])
        verifyRefCounts(root, ancestor, bridge, tail)
    })

    it("resumes detached preparation with a copied Promise path", async () => {
        const pending = deferred()
        const ancestor = { pending: pending.promise }
        const root = { ancestor }
        importValue(root, "split preparation")

        const internal = {}
        internal.self = internal
        const unique = { ok: true }
        const resolved = { internal, unique, back: ancestor }

        pending.resolve(resolved)
        await flushMicrotasks()

        const promiseMirror = metaOf(ancestor).mirrors.pending
        const internalError = metaOf(internal).cycleErrors.self
        const ancestorError = metaOf(resolved).cycleErrors.back

        expect(internalError.message).to.be(
            'Cyclic property "self" (imported at: split preparation)',
        )
        expect(ancestorError.message).to.be(
            'Cyclic property "back" (imported at: split preparation)',
        )
        expect(promiseMirror.cycleError).to.be(undefined)
        expect(metaOf(unique).shared).to.be(undefined)

        const errors = getErrors(new Chain(root), [])
        expect(errors.length).to.be(2)
        expect(errors.includes(internalError)).to.be(true)
        expect(errors.includes(ancestorError)).to.be(true)
        verifyRefCounts(root)
    })

    it("prepares cyclic imports before counting indexes the branch", () => {
        const root = {}
        root.self = root

        const imported = importValue(root, "cycle import")
        expect(metaOf(root).cycleErrors.self instanceof Error).to.be(true)
        expect(getRefCounter(root)).to.be(undefined)
        const indexed = buildRefIndex(root)

        expect(imported).to.be(root)
        expect(indexed).to.be(root)
        expect(getRefCounter(root).errorCount).to.be(1)
        expect(root.self).to.be(root)
    })

    it("uses the import root for eager cycle placement", () => {
        const root = {}
        const branch = { back: root }
        root.branch = branch
        importValue(root, "rooted preparation")

        expect(metaOf(branch).cycleErrors.back instanceof Error).to.be(true)
        expect(hasError(new Chain(root), ["branch"])).to.be(true)

        expect(metaOf(root).cycleErrors).to.be(undefined)
        expect(metaOf(branch).cycleErrors.back.message).to.be(
            'Cyclic property "back" (imported at: rooted preparation)',
        )
        expect(metaOf(branch).importBoundary).to.be(undefined)
        verifyRefCounts(root, branch)
    })

    it("keeps an eager cycle cut when an extracted branch becomes a root", () => {
        const root = {}
        const branch = { back: root }
        root.branch = branch
        importValue(root, "rerooted branch")

        const extracted = lookupPath(new Chain(root), ["branch"], false)
        const chain = new Chain({})
        assignPath(chain, ["branch"], extracted)

        expect(hasError(chain, ["branch"])).to.be(true)
        expect(metaOf(branch).importBoundary.root).to.be(branch)
        expect(metaOf(branch).cycleErrors.back.message).to.be(
            'Cyclic property "back" (imported at: rerooted branch)',
        )
        expect(metaOf(root).cycleErrors).to.be(undefined)
        verifyRefCounts(root, branch)
    })

    it("marks stable first-repeat edges from the import root", () => {
        const left = {}
        const right = {}
        left.right = right
        right.left = left
        right.self = right
        importValue(left, "interlocking cycles")

        expect(hasError(new Chain(left), [])).to.be(true)

        const rightError = metaOf(right).cycleErrors.left
        const selfError = metaOf(right).cycleErrors.self
        expect(metaOf(left).cycleErrors).to.be(undefined)
        expect(rightError.message).to.be(
            'Cyclic property "left" (imported at: interlocking cycles)',
        )
        expect(selfError).not.to.be(rightError)
        expect(getErrors(new Chain(right), []).includes(rightError)).to.be(true)
        expect(metaOf(right).cycleErrors.left).to.be(rightError)
        const wrapper = importValue({ branch: left }, "marked reuse")
        buildRefIndex(wrapper)
        expect(metaOf(right).cycleErrors.left).to.be(rightError)
        expectCounts(left, 0, 2)
        expectCounts(right, 0, 2)
        expectCounts(wrapper, 0, 2)
        verifyRefCounts(wrapper, left, right)
    })

    it("keeps a cycle cut when lookup re-roots a node inside the cycle", () => {
        const first = { name: "first" }
        const second = { name: "second" }
        first.next = second
        second.next = first
        importValue(first, "cycle lookup")

        const errors = getErrors(new Chain(first), [])
        const extracted = lookupPath(new Chain(first), ["next"], false)

        expect(extracted).to.be(second)
        expect(lookupPath(
            new Chain(extracted),
            ["next", "next", "name"],
            false,
        )).to.be("second")
        expect(getErrors(new Chain(extracted), [])).to.eql(errors)
        expect(metaOf(second).cycleErrors.next).to.be(errors[0])
    })

    it("marks the imported property that closes a discovered cycle", () => {
        const batchParent = {}
        const batchChild = { back: batchParent }
        batchParent.child = batchChild
        importValue(batchParent, "batch cycle")
        buildRefIndex(batchParent)

        expect(metaOf(batchParent).cycleErrors).to.be(undefined)
        expect(metaOf(batchChild).cycleErrors.back instanceof Error).to.be(true)
    })

    it("COWs before attaching imported data that references an escaped owner", () => {
        const owner = {}
        const chain = new Chain(owner)
        const escaped = lookupPath(chain, [])
        const child = importValue({ back: escaped }, "returned owner")

        assignPath(chain, ["child"], child)
        const next = chain._state.value

        expect(next).not.to.be(owner)
        expect(next.child).to.be(child)
        expect(child.back).to.be(owner)
        expect(hasError(chain, [])).to.be(false)
        verifyRefCounts(next, child, owner)
    })

    it("keeps detached preparation and imported attachment separate", async () => {
        const pending = deferred()
        const nested = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const nestedRegistrations = countPromiseRegistrations(nested.promise)
        const child = importValue({ pending: pending.promise }, "attached child")
        const chain = new Chain(importValue({}, "attachment destination"))

        // Mandatory writeback plus detached preparation.
        expect(registrations()).to.be(2)

        assignPath(chain, ["child"], child)
        // The real imported-to-imported placement adds one fixed-path walk.
        expect(registrations()).to.be(3)

        const resolved = { nested: nested.promise }
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved)?.shared).to.be(undefined)
        // Mandatory writeback plus exactly one continuation from each walk.
        expect(nestedRegistrations()).to.be(3)

        nested.resolve({ clean: true })
        await flushMicrotasks()

        expect(hasError(chain, [])).to.be(false)
        verifyRefCounts(chain._state.value)
    })

    it("pins an asynchronous attachment for issue-time queries", async () => {
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            "captured attachment",
        )
        const chain = new Chain(importValue({ value: null }, "destination"))

        assignPath(chain, ["value"], incoming)
        const destination = chain._state.value
        const hasErrorResult = hasError(chain, [])
        const getErrorsResult = getErrors(chain, [])
        assignPath(chain, ["value"], null)

        expect(chain._state.value).not.to.be(destination)
        expect(chain._state.value.value).to.be(null)
        expect(destination.value).to.be(incoming)

        pending.resolve(destination)

        expect(await hasErrorResult).to.be(true)
        const cycleError = metaOf(incoming).mirrors.pending.cycleError
        expect(await getErrorsResult).to.eql([cycleError])
        expect(metaOf(destination).cycleErrors?.value).to.be(undefined)
        expect(hasError(chain, [])).to.be(false)
        verifyRefCounts(destination, incoming)
    })

    it("cuts an attached Promise cycle only at its Promise placement", async () => {
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            "attached Promise cycle",
        )
        const chain = new Chain(importValue(
            { value: null },
            "attachment destination",
        ))

        assignPath(chain, ["value"], incoming)
        const destination = chain._state.value
        pending.resolve(destination)
        await flushMicrotasks()

        const cycleError = metaOf(incoming).mirrors.pending.cycleError
        expect(cycleError.message).to.be(
            'Cyclic property "pending" (imported at: attached Promise cycle)',
        )
        expect(metaOf(destination).cycleErrors?.value).to.be(undefined)
        expect(hasError(chain, [])).to.be(true)
        expect(getErrors(chain, [])).to.eql([cycleError])
        verifyRefCounts(destination, incoming)

        assignPath(chain, ["value"], null)
        expect(chain._state.value).not.to.be(destination)
        expect(hasError(chain, [])).to.be(false)
        verifyRefCounts(chain._state.value, destination, incoming)
    })

    it("preserves a pinned attachment path across ancestor replacement", async () => {
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            "captured ancestor path",
        )
        const chain = new Chain(importValue(
            { slot: {} },
            "attachment destination",
        ))

        assignPath(chain, ["slot", "incoming"], incoming)
        const destination = chain._state.value
        const attachedSlot = destination.slot
        const result = hasError(chain, [])
        assignPath(chain, ["slot"], {})

        expect(chain._state.value).not.to.be(destination)
        expect(destination.slot).to.be(attachedSlot)
        expect(attachedSlot.incoming).to.be(incoming)

        pending.resolve(destination)

        expect(await result).to.be(true)
        expect(hasError(chain, [])).to.be(false)
    })

    it("pins attachment paths reached through promised ancestors", async () => {
        const ancestor = deferred()
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            "promised attachment path",
        )
        const chain = new Chain(importValue(
            { slot: ancestor.promise },
            "attachment destination",
        ))

        assignPath(chain, ["slot", "incoming"], incoming)
        const destination = chain._state.value
        ancestor.resolve({})
        await flushMicrotasks()
        expect(destination.slot.incoming).to.be(incoming)

        const result = hasError(chain, [])
        assignPath(chain, ["slot"], {})
        expect(chain._state.value).not.to.be(destination)

        pending.resolve(destination)

        expect(await result).to.be(true)
        expect(hasError(chain, [])).to.be(false)
    })

    it("keeps intrinsic cycle cuts after an attachment is replaced", async () => {
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            "intrinsic revoked attachment",
        )
        const chain = new Chain(importValue({ value: null }, "destination"))
        const cyclic = {}
        cyclic.self = cyclic

        assignPath(chain, ["value"], incoming)
        assignPath(chain, ["value"], null)
        pending.resolve(cyclic)
        await flushMicrotasks()

        const cycleError = metaOf(cyclic).cycleErrors.self
        expect(cycleError instanceof Error).to.be(true)
        expect(getErrors(new Chain(incoming), [])).to.eql([cycleError])
    })

    it("stores cycle metadata for frozen imports in both metadata modes", () => {
        const frozen = {}
        frozen.self = frozen
        Object.freeze(frozen)
        importValue(frozen, "frozen cycle")

        buildRefIndex(frozen)

        expect(metaOf(frozen).cycleErrors.self.message).to.be(
            'Cyclic property "self" (imported at: frozen cycle)',
        )
        expectCounts(frozen, 0, 1)
        const normalized = normalize(new Chain(frozen), [])
        expect(normalized).not.to.be(frozen)
        expect(normalized.self).to.be(normalized)
        verifyRefCounts(frozen)
    })

    it("propagates descendant cycle Errors through frozen imports", () => {
        const child = {}
        child.self = child
        const root = Object.freeze({ child })
        const chain = new Chain(importValue(root, "nested frozen cycle"))

        expect(hasError(chain, [])).to.be(true)
        expect(getErrors(chain, []).length).to.be(1)
        const copy = normalize(chain, [])
        expect(copy).not.to.be(root)
        expect(copy.child.self).to.be(copy.child)
        expectCounts(root, 0, 1)
        expectCounts(child, 0, 1)
        verifyRefCounts(root)
    })

    it("keeps the first import boundary attribution", () => {
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

    it("uses the nearest nested import boundary", () => {
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

    it("checks an existing imported identity against new ancestry", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const child = importValue(
            { pending: pending.promise },
            "child import",
        )

        // Mandatory capture, then the detached-import preparation.
        expect(registrations()).to.be(2)
        importValue({ child }, "wrapper import")
        // The repeated identity adds its own fixed-path scan.
        expect(registrations()).to.be(3)

        pending.resolve({ done: true })
        await flushMicrotasks()

        expect(lookupPath(new Chain(child), ["pending", "done"], false)).to.be(true)
    })

    it("detects cycles crossing direct import boundaries", () => {
        const parent = {}
        const child = { back: parent }
        parent.child = child
        importValue(parent, "parent import")
        importValue(child, "child import")

        buildRefIndex(parent)

        expect(metaOf(child).cycleErrors.back.message).to.be(
            'Cyclic property "back" (imported at: parent import)',
        )
        expectCounts(parent, 0, 1)
        expectCounts(child, 0, 1)
        verifyRefCounts(parent, child)
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

    it("recovers from a cycle after a COW repair", () => {
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
        expect(normalize(chain, [])).to.eql(repaired)
        expect(hasError(chain, [])).to.be(false)
        verifyRefCounts(repaired)
    })

    it("indexes promises and Errors inside non-extensible imports", async () => {
        const firstPromise = Promise.resolve(1)
        const nestedPromise = Promise.resolve(2)
        const error = new Error("bad")
        const frozenPromise = Object.freeze({ pending: firstPromise })
        const nestedFrozenPromise = Object.freeze({
            nested: Object.seal({ pending: nestedPromise }),
        })
        const frozenError = Object.preventExtensions({ error })

        expect(importValue(frozenPromise, "frozen promise")).to.be(frozenPromise)
        expect(importValue(nestedFrozenPromise, "nested frozen promise")).to.be(nestedFrozenPromise)
        expect(importValue(frozenError, "frozen error")).to.be(frozenError)

        expect(buildRefIndex(frozenPromise)).to.be(frozenPromise)
        expect(buildRefIndex(nestedFrozenPromise)).to.be(nestedFrozenPromise)
        expect(buildRefIndex(frozenError)).to.be(frozenError)

        expectCounts(frozenPromise, 1, 0)
        expectCounts(nestedFrozenPromise, 1, 0)
        expectCounts(nestedFrozenPromise.nested, 1, 0)
        expectCounts(frozenError, 0, 1)
        expect(metaOf(frozenPromise).mirrors.pending).not.to.be(undefined)
        expect(metaOf(frozenPromise).importBoundary.root).to.be(frozenPromise)
        expect(metaOf(frozenPromise).importBoundary.errorContext).to.be("frozen promise")

        await flushMicrotasks()

        expect(frozenPromise.pending).to.be(firstPromise)
        expect(nestedFrozenPromise.nested.pending).to.be(nestedPromise)
        expect(lookupPath(new Chain(frozenPromise), ["pending"], false)).to.be(1)
        expect(lookupPath(new Chain(nestedFrozenPromise), ["nested", "pending"], false)).to.be(2)
        expect(getErrors(new Chain(frozenError), [])[0]).to.be(error)
        expectCounts(frozenPromise, 0, 0)
        expectCounts(nestedFrozenPromise, 0, 0)
        verifyRefCounts(frozenPromise, nestedFrozenPromise, frozenError)
    })

    it("normalizes pending elements in a non-extensible array", async () => {
        const first = deferred()
        const second = deferred()
        const nested = Object.seal({ pending: second.promise })
        const array = Object.freeze([first.promise, nested])

        importValue(array, "frozen array")
        const normalized = normalize(new Chain(array), [])

        expectCounts(array, 2, 0)
        expectCounts(nested, 1, 0)

        first.resolve({ x: 1 })
        second.resolve(2)
        const copy = await normalized

        expect(copy).to.eql([{ x: 1 }, { pending: 2 }])
        expect(array[0]).to.be(first.promise)
        expect(nested.pending).to.be(second.promise)
        expect(hasError(new Chain(array), [])).to.be(false)
        expect(getErrors(new Chain(array), [])).to.eql([])
        expectCounts(array, 0, 0)
        verifyRefCounts(array)
    })

    it("counts rejection Errors behind frozen promise properties", async () => {
        const pending = deferred()
        const error = new Error("rejected frozen value")
        const root = Object.freeze({ pending: pending.promise })

        importValue(root, "frozen rejection")
        const errors = getErrors(new Chain(root), [])
        expectCounts(root, 1, 0)

        pending.reject(error)
        const result = await errors

        expect(result).to.eql([error])
        expect(root.pending).to.be(pending.promise)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("indexes own enumerable __proto__ regardless of neighboring Promise order", async () => {
        function frozenValue(protoFirst) {
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

        for (const value of [frozenValue(true), frozenValue(false)]) {
            importValue(value, "property order")
            const indexed = buildRefIndex(value)

            expect(indexed).to.be(value)
            expect(lookupPath(new Chain(value), ["__proto__", "unsafe"], false)).to.be(true)
            expectCounts(value, 1, 0)
            await flushMicrotasks()
            expectCounts(value, 0, 0)
            verifyRefCounts(value)
        }
    })

    it("keeps non-extensible imported siblings independent", async () => {
        const firstPromise = Promise.resolve(1)
        const secondError = new Error("bad")
        const first = Object.freeze({ clean: 1, pending: firstPromise })
        const second = Object.freeze({ bad: secondError })
        importValue(first, "first frozen sibling")
        importValue(second, "second frozen sibling")
        const wrapper = { keep: true, first, second }
        const chain = new Chain(wrapper)

        const errors = await getErrors(chain, [])

        expect(errors.length).to.be(1)
        expect(errors[0]).to.be(secondError)
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

    it("counts imported own enumerable __proto__ data", () => {
        const root = {}
        const protoValue = { safe: true }
        Object.defineProperty(root, "__proto__", {
            value: protoValue,
            enumerable: true,
            writable: true,
            configurable: true,
        })

        expect(importValue(root, "proto import")).to.be(root)

        const indexed = buildRefIndex(root)

        expect(indexed).to.be(root)
        expect(lookupPath(new Chain(root), ["__proto__", "safe"], false)).to.be(true)
        expectCounts(root, 0, 0)
        expect(getRefCounter(protoValue)).not.to.be(undefined)
        verifyRefCounts(root, protoValue)
    })

    it("detects cycles through imported enumerable __proto__ data", () => {
        const root = {}
        Object.defineProperty(root, "__proto__", {
            value: root,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        importValue(root, "proto cycle")

        buildRefIndex(root)
        const cycleError = metaOf(root).cycleErrors.__proto__

        expect(cycleError.message).to.be(
            'Cyclic property "__proto__" (imported at: proto cycle)',
        )
        expect(hasError(new Chain(root), [])).to.be(true)
        expect(getErrors(new Chain(root), [])).to.eql([cycleError])
        const normalized = normalize(new Chain(root), [])
        expect(normalized).not.to.be(root)
        expect(Object.getOwnPropertyDescriptor(normalized, "__proto__").value).to.be(
            normalized,
        )
        expect(root.__proto__).to.be(root)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("indexes enumerable __proto__ data reached through a draining promise", async () => {
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
        const resolved = { clean: true }
        Object.defineProperty(resolved, "__proto__", {
            value: Promise.resolve("hidden"),
            enumerable: true,
            writable: true,
            configurable: true,
        })

        pending.resolve(resolved)

        expect(await found).to.be(false)
        expect(await collected).to.eql([])
        const normalizedValue = await normalized
        expect(normalizedValue).not.to.be(resolved)
        expect(normalizedValue.clean).to.be(true)
        expect(Object.getOwnPropertyDescriptor(
            normalizedValue,
            "__proto__",
        ).value).to.be("hidden")
        expect(mirror.cycleError).to.be(undefined)
        expect(lookupPath(new Chain(resolved), ["__proto__"], false)).to.be("hidden")
        expectCounts(root, 0, 0)
        verifyRefCounts(root, resolved)
    })

    it("preserves and resolves imported enumerable __proto__ data through COW", async () => {
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
        const errors = await getErrors(chain, [])
        const normalized = await normalize(chain, [])

        expect(copy).not.to.be(external)
        expect(Object.getOwnPropertyDescriptor(external, "__proto__").value).to.be(hidden)
        expect(Object.getOwnPropertyDescriptor(copy, "__proto__").value).to.be("hidden")
        expect(Object.getPrototypeOf(copy)).to.be(Object.prototype)
        expect(await hasError(chain, [])).to.be(false)
        expect(errors).to.eql([])
        expect(Object.getOwnPropertyDescriptor(normalized, "__proto__").value).to.be("hidden")
        expect(Object.getPrototypeOf(normalized)).to.be(Object.prototype)
        expect(external.branch.value).to.be(1)
        expect(copy.branch.value).to.be(2)
        verifyRefCounts(copy)
    })

    it("marks a metadata-bearing runtime identity reached through import", () => {
        const child = {}
        Object.defineProperty(child, "__proto__", {
            value: { unsafe: true },
            enumerable: true,
            writable: true,
            configurable: true,
        })
        buildRefIndex(child)
        const root = importValue({ child }, "late imported provenance")

        const indexed = buildRefIndex(root)

        expect(indexed).to.be(root)
        expect(getRefCounter(child)).not.to.be(undefined)
        expect(getRefCounter(root)).not.to.be(undefined)
        expect(metaOf(child).shared).to.be(true)
        expect(lookupPath(new Chain(root), ["child", "__proto__", "unsafe"], false)).to.be(true)
        verifyRefCounts(root, child)
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
        expect(metaOf(branch).importBoundary.root).to.be(branch)
        expect(metaOf(branch).importBoundary.errorContext).to.be("extract import")
        expect(next).not.to.be(branch)
        expect(branch.x).to.be(1)
        expect(next.x).to.be(2)
    })

    it("keeps COW path copies owned while marking their source children imported", () => {
        const rootSibling = {}
        const branchSibling = {}
        const leafSibling = {}
        const leaf = { sibling: leafSibling }
        const branch = { leaf, sibling: branchSibling }
        const root = { branch, sibling: rootSibling }

        importValue(root, "COW provenance")
        const chain = new Chain(root)
        assignPath(chain, ["branch", "leaf", "added"], 2)
        const next = chain._state.value

        expect(metaOf(next)?.importBoundary).to.be(undefined)
        expect(metaOf(next.branch)?.importBoundary).to.be(undefined)
        expect(metaOf(next.branch.leaf)?.importBoundary).to.be(undefined)
        expect(metaOf(branch).importBoundary.root).to.be(branch)
        expect(metaOf(leaf).importBoundary.root).to.be(leaf)
        expect(metaOf(rootSibling).importBoundary.root).to.be(rootSibling)
        expect(metaOf(branchSibling).importBoundary.root).to.be(branchSibling)
        expect(metaOf(leafSibling).importBoundary.root).to.be(leafSibling)
    })

    it("keeps import boundaries only on retained Promise forks during COW", async () => {
        const pathValue = deferred()
        const retainedValue = deferred()
        const root = {
            path: pathValue.promise,
            retained: retainedValue.promise,
        }

        importValue(root, "Promise COW provenance")
        const chain = new Chain(root)
        assignPath(chain, ["path", "added"], 2)
        const next = chain._state.value
        const mirrors = metaOf(next).mirrors

        expect(metaOf(next).importBoundary).to.be(undefined)
        expect(mirrors.path.importBoundary).to.be(undefined)
        expect(mirrors.retained.importBoundary.root).to.be(root)
        expect(metaOf(next).importedOriginal).to.be(undefined)
        expect(metaOf(root).importedOriginal).to.be(true)

        pathValue.resolve({ kept: true })
        retainedValue.resolve({ sibling: true })
        await flushMicrotasks()

        expect(root.path).to.be(pathValue.promise)
        expect(root.retained).to.be(retainedValue.promise)
        expect(next.path).to.eql({ kept: true, added: 2 })
        expect(metaOf(next.path)?.importBoundary).to.be(undefined)
        expect(next.retained).to.eql({ sibling: true })
    })

    it("retains Promise provenance across repeated pending COW forks", async () => {
        const pending = deferred()
        const resolved = { value: true }
        const root = {
            pending: pending.promise,
            left: 0,
            right: 0,
        }

        importValue(root, "repeated Promise COW")
        const chain = new Chain(root)
        assignPath(chain, ["left"], 1)
        const first = chain._state.value
        lookupPath(chain, [])
        assignPath(chain, ["right"], 2)
        const second = chain._state.value
        const firstMirror = metaOf(first).mirrors.pending
        const secondMirror = metaOf(second).mirrors.pending

        expect(secondMirror.importBoundary).to.be(firstMirror.importBoundary)
        expect(secondMirror.importBoundary.root).to.be(root)
        expect(metaOf(second).importedOriginal).to.be(undefined)

        pending.resolve(resolved)
        await flushMicrotasks()

        expect(second.pending).to.be(resolved)
        expect(lookupPath(chain, ["pending"], false)).to.be(resolved)
        expect(metaOf(resolved).importBoundary.root).to.be(resolved)
        expect(metaOf(resolved).importBoundary.errorContext).to.be(
            "repeated Promise COW",
        )
    })

    it("samples Promise provenance at the fork's FIFO position", async () => {
        const pending = deferred()
        const root = { pending: pending.promise, sibling: 0 }

        importValue(root, "FIFO Promise provenance")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        assignPath(chain, ["pending", "first"], 1)

        // Force a later COW while the earlier path mutation is suspended. Its
        // off-path fork must observe that earlier mutation consume provenance.
        lookupPath(chain, [])
        assignPath(chain, ["sibling"], 2)
        const copy = chain._state.value
        const mirror = metaOf(copy).mirrors.pending
        const observed = lookupPath(chain, ["pending"], false)

        expect(mirror.importBoundary.root).to.be(root)
        pending.resolve({ original: true })
        const owned = await observed

        expect(mirror.importBoundary).to.be(undefined)
        expect(metaOf(owned)?.importBoundary).to.be(undefined)
        expect(owned).to.eql({ original: true, first: 1 })
    })

    it("transfers a drained Promise boundary when COW drops its mirror", async () => {
        const pending = deferred()
        const resolved = { value: true }
        const root = {
            pending: pending.promise,
            left: 0,
            right: 0,
        }

        importValue(root, "drained Promise COW")
        const chain = new Chain(root)
        assignPath(chain, ["left"], 1)
        const first = chain._state.value

        pending.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(first).mirrors.pending.importBoundary.root).to.be(root)
        expect(metaOf(resolved).importBoundary).to.be(undefined)

        lookupPath(chain, [])
        assignPath(chain, ["right"], 2)
        const second = chain._state.value

        expect(metaOf(second)?.mirrors?.pending).to.be(undefined)
        expect(second.pending).to.be(resolved)
        expect(metaOf(resolved).importBoundary.root).to.be(resolved)
        expect(metaOf(resolved).importBoundary.errorContext).to.be(
            "drained Promise COW",
        )
    })

    it("clears Promise provenance when an off-path fork becomes the COW path", async () => {
        const pending = deferred()
        const root = { pending: pending.promise, sibling: 0 }

        importValue(root, "promoted Promise path")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        const copy = chain._state.value
        const mirror = metaOf(copy).mirrors.pending

        expect(mirror.importBoundary.root).to.be(root)
        assignPath(chain, ["pending", "first"], 1)

        pending.resolve({ original: true })
        await flushMicrotasks()

        const owned = lookupPath(chain, ["pending"], false)
        expect(mirror.importBoundary).to.be(undefined)
        expect(metaOf(copy).importedOriginal).to.be(undefined)
        expect(metaOf(owned)?.importBoundary).to.be(undefined)
        expect(owned).to.eql({ original: true, first: 1 })

        assignPath(chain, ["pending", "second"], 2)
        expect(lookupPath(chain, ["pending"], false)).to.be(owned)
        expect(owned.second).to.be(2)
    })

    it("consumes a drained Promise boundary on the COW path", async () => {
        const pending = deferred()
        const retained = {}
        const root = { pending: pending.promise, sibling: 0 }

        importValue(root, "drained Promise path")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        const parentCopy = chain._state.value
        const mirror = metaOf(parentCopy).mirrors.pending

        pending.resolve({ retained, value: 0 })
        await flushMicrotasks()

        expect(mirror.importBoundary.root).to.be(root)
        assignPath(chain, ["pending", "value"], 1)
        const owned = lookupPath(chain, ["pending"], false)

        expect(metaOf(parentCopy).mirrors?.pending).to.be(undefined)
        expect(metaOf(owned)?.importBoundary).to.be(undefined)
        expect(metaOf(retained).importBoundary.root).to.be(retained)
        expect(metaOf(retained).importBoundary.errorContext).to.be(
            "drained Promise path",
        )
        expect(owned.value).to.be(1)
    })

    it("preserves imported cycle cuts behind an owned copied path", () => {
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

    it("discovers imported promise keys before the branch is counted", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        importValue(root, "promise key import")
        expect(metaOf(root).mirrors.value.promise).to.be(deferredValue.promise)
        expect(getRefCounter(root)).to.be(undefined)
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

    it("reads frozen promise keys through mirrors without physical writeback", async () => {
        const deferredValue = deferred()
        const root = Object.freeze({ value: deferredValue.promise })

        importValue(root, "frozen read")
        const read = lookupPath(new Chain(root), ["value"])
        deferredValue.resolve({ x: 1 })
        const value = await read

        expect(value).to.eql({ x: 1 })
        expect(root.value).to.be(deferredValue.promise)
        expect(metaOf(root).mirrors.value.pendingConsumerCount).to.be(0)

        const chain = new Chain(value)
        assignPath(chain, ["x"], 2)
        const next = chain._state.value
        expect(next).not.to.be(value)
        expect(value.x).to.be(1)
        expect(next.x).to.be(2)
    })

    it("keeps a captured frozen promise query independent of later COW deletion", async () => {
        const pending = deferred()
        const frozen = Object.freeze({
            keep: true,
            invalid: pending.promise,
        })
        importValue(frozen, "repair frozen import")
        const chain = new Chain(frozen)

        const captured = hasError(chain, [])
        deletePath(chain, ["invalid"])
        const repaired = chain._state.value

        expect(repaired).not.to.be(frozen)
        expect(repaired).to.eql({ keep: true })
        expect(hasError(chain, [])).to.be(false)

        pending.reject("detached")
        expect(await captured).to.be(true)

        expect(repaired).to.eql({ keep: true })
        expect(frozen.invalid).to.be(pending.promise)
        verifyRefCounts(repaired)
    })

    it("forks frozen promise keys into mutable mirrors", async () => {
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
        expect(await getErrors(new Chain(next), [])).to.eql([])
        expect(lookupPath(new Chain(next), ["value", "pending"], false)).to.be(1)
        expectCounts(next, 0, 0)
        verifyRefCounts(next)
    })

    it("indexes non-extensible values exposed by imported writebacks", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, "frozen writeback")
        buildRefIndex(root)
        expectCounts(root, 1, 0)

        deferredValue.resolve(Object.freeze({ pending: Promise.resolve(1) }))
        await flushMicrotasks()

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(await getErrors(new Chain(root), [])).to.eql([])
        expect(lookupPath(new Chain(root), ["nested", "value", "pending"], false)).to.be(1)
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("indexes private non-extensible values from revoked mirrors", async () => {
        const pending = deferred()
        const errorValue = Object.freeze({ bad: new Error("bad") })
        const root = { value: pending.promise }
        const chain = new Chain(root)

        importValue(errorValue, "revoked writeback")
        buildRefIndex(root)
        const mirror = metaOf(root).mirrors.value
        assignPath(chain, ["value"], "fixed")

        pending.resolve(errorValue)
        await flushMicrotasks()

        expect(root.value).to.be("fixed")
        expect(mirror.currentValue).to.be(errorValue)
        expect(mirror.cycleError).to.be(undefined)
        expectCounts(errorValue, 0, 1)
        expect(getErrors(new Chain(errorValue), [])[0]).to.be(errorValue.bad)
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
        expect(metaOf(root.nested).mirrors.value.cycleError.message).to.be(
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
        buildRefIndex(root)

        deferredValue.resolve(resolved)
        await flushMicrotasks()

        expect(root.nested.value).to.be(deferredValue.promise)
        const cycleError = getErrors(new Chain(root), [])[0]
        expect(cycleError.message).to.be(
            'Cyclic property "target" (imported at: containing back-edge)',
        )
        expect(metaOf(resolved).cycleErrors.target).to.be(cycleError)
        expect(metaOf(root.nested).mirrors.value.cycleError).to.be(undefined)
        expect(metaOf(resolved).shared).to.be(undefined)
        expect(metaOf(resolved).importBoundary).to.be(undefined)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("COWs before an imported promise can resolve to its escaped owner", async () => {
        const deferredValue = deferred()
        const root = { nested: {} }
        const chain = new Chain(root)
        const escaped = lookupPath(chain, [])

        assignPath(
            chain,
            ["nested", "value"],
            importValue(deferredValue.promise, "assigned promise"),
        )
        const next = chain._state.value
        expect(next).not.to.be(root)

        deferredValue.resolve(escaped)
        await flushMicrotasks()

        expect(next.nested.value).to.be(escaped)
        expect(hasError(chain, [])).to.be(false)
        expect(getErrors(chain, [])).to.eql([])
        verifyRefCounts(next, escaped)
    })

    it("classifies an imported promise that resolves to its COW destination", async () => {
        const deferredValue = deferred()
        const root = importValue({}, "destination root")
        const chain = new Chain(root)
        const importedPromise = importValue(
            deferredValue.promise,
            "assigned destination",
        )

        assignPath(chain, ["self"], importedPromise)
        const next = chain._state.value
        deferredValue.resolve(next)
        await flushMicrotasks()

        const cycleError = metaOf(next).mirrors.self.cycleError
        expect(cycleError.message).to.be(
            'Cyclic property "self" (imported at: assigned destination)',
        )
        expect(next.self).to.be(next)
        expect(lookupPath(chain, ["self"], false)).to.be(next)
        expect(hasError(chain, [])).to.be(true)
        expect(getErrors(chain, [])).to.eql([cycleError])
        verifyRefCounts(next)
    })

    it("cuts a retained Promise fork that resolves to its COW owner", async () => {
        const pending = deferred()
        const root = {
            pending: pending.promise,
            sibling: 0,
        }

        importValue(root, "fork destination")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        const copy = chain._state.value
        const sourceMirror = metaOf(root).mirrors.pending
        const forkMirror = metaOf(copy).mirrors.pending

        pending.resolve(copy)
        await flushMicrotasks()

        expect(sourceMirror.cycleError).to.be(undefined)
        expect(forkMirror.cycleError.message).to.be(
            'Cyclic property "pending" (imported at: fork destination)',
        )
        expect(root.pending).to.be(pending.promise)
        expect(copy.pending).to.be(copy)
        expect(hasError(chain, [])).to.be(true)
        expect(getErrors(chain, [])).to.eql([forkMirror.cycleError])
        verifyRefCounts(root, copy)
    })

    it("commits an indexed Promise fork directly from pending to a cycle cut", async () => {
        const pending = deferred()
        const root = {
            pending: pending.promise,
            sibling: 0,
        }

        importValue(root, "indexed fork destination")
        buildRefIndex(root)
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        const copy = chain._state.value
        const forkMirror = metaOf(copy).mirrors.pending

        expectCounts(copy, 1, 0)
        pending.resolve(copy)
        await flushMicrotasks()

        expectCounts(copy, 0, 1)
        expect(forkMirror.cycleError instanceof Error).to.be(true)
        expect(copy.pending).to.be(copy)
        verifyRefCounts(root, copy)
    })

    it("does not cut a fork when only its imported source placement cycles", async () => {
        const pending = deferred()
        const root = {
            pending: pending.promise,
            sibling: 0,
        }

        importValue(root, "source-only fork cycle")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        const copy = chain._state.value
        const sourceMirror = metaOf(root).mirrors.pending
        const forkMirror = metaOf(copy).mirrors.pending

        pending.resolve(root)
        await flushMicrotasks()

        expect(sourceMirror.cycleError instanceof Error).to.be(true)
        expect(forkMirror.cycleError).to.be(undefined)
        expect(root.pending).to.be(pending.promise)
        expect(copy.pending).to.be(root)
        verifyRefCounts(root, copy)
    })

    it("checks a nested fork against every copied ancestor", async () => {
        const pending = deferred()
        const root = {
            branch: {
                pending: pending.promise,
                value: 0,
            },
        }

        importValue(root, "nested fork ancestor")
        const chain = new Chain(root)
        assignPath(chain, ["branch", "value"], 1)
        const copy = chain._state.value
        const forkMirror = metaOf(copy.branch).mirrors.pending

        pending.resolve(copy)
        await flushMicrotasks()

        expect(forkMirror.cycleError.message).to.be(
            'Cyclic property "pending" (imported at: nested fork ancestor)',
        )
        expect(copy.branch.pending).to.be(copy)
        expect(hasError(chain, [])).to.be(true)
        verifyRefCounts(root, copy)
    })

    it("does not mistake a later copied descendant for a fork ancestor", async () => {
        const pending = deferred()
        const root = {
            pending: pending.promise,
            branch: { value: 0 },
        }

        importValue(root, "fork descendant")
        const chain = new Chain(root)
        assignPath(chain, ["branch", "value"], 1)
        const copy = chain._state.value
        const forkMirror = metaOf(copy).mirrors.pending

        pending.resolve(copy.branch)
        await flushMicrotasks()

        expect(forkMirror.cycleError).to.be(undefined)
        expect(copy.pending).to.be(copy.branch)
        expect(hasError(chain, [])).to.be(false)
        verifyRefCounts(root, copy)
    })

    it("keeps a revoked fork query on its captured COW destination", async () => {
        const pending = deferred()
        const root = {
            pending: pending.promise,
            sibling: 0,
        }

        importValue(root, "revoked fork destination")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        const captured = chain._state.value
        const result = hasError(chain, ["pending"])
        assignPath(chain, ["pending"], null)

        pending.resolve(captured)

        expect(await result).to.be(true)
        expect(hasError(chain, [])).to.be(false)
        expect(chain._state.value.pending).to.be(null)
    })

    it("prepares non-indexed Promise back-edges before counting", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, "floating back-edge")
        lookupPath(new Chain(root), ["nested", "value"])
        deferredValue.resolve(root.nested)
        await flushMicrotasks()

        expect(metaOf(root.nested).mirrors.value.cycleError instanceof Error).to.be(true)
        expect(getRefCounter(root)).to.be(undefined)
        const indexed = buildRefIndex(root)

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(lookupPath(new Chain(root), ["nested", "value"], false)).to.be(root.nested)
        expect(indexed).to.be(root)
        expect(hasError(new Chain(root), [])).to.be(true)
    })

    it("prepares cyclic imported promise roots before returning them", async () => {
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, "promise root")
        const cyclic = {}
        cyclic.self = cyclic

        deferredValue.resolve(cyclic)
        const value = await imported
        expect(metaOf(value).cycleErrors.self instanceof Error).to.be(true)
        expect(getRefCounter(value)).to.be(undefined)
        const indexed = buildRefIndex(value)

        expect(value).to.be(cyclic)
        expect(indexed).to.be(cyclic)
        expect(hasError(new Chain(value), [])).to.be(true)
    })

    it("keeps the import boundary when promise roots resolve to frozen values", async () => {
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, "frozen promise root")
        const frozen = Object.freeze({ pending: Promise.resolve(1) })

        deferredValue.resolve(frozen)
        const value = await imported
        const indexed = buildRefIndex(value)

        expect(value).to.be(frozen)
        expect(indexed).to.be(frozen)
        expect(metaOf(frozen).importBoundary.root).to.be(frozen)
        expect(metaOf(frozen).importBoundary.errorContext).to.be("frozen promise root")
        expectCounts(frozen, 0, 0)

        await flushMicrotasks()

        expect(frozen.pending instanceof Promise).to.be(true)
        expect(lookupPath(new Chain(frozen), ["pending"], false)).to.be(1)
        expectCounts(frozen, 0, 0)
        verifyRefCounts(frozen)
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
