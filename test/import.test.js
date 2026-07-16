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

    it("keeps unique imported descendants unmarked", async () => {
        const outer = deferred()
        const inner = deferred()
        const leaf = { x: 1 }
        const child = { value: outer.promise }
        const root = { child }

        const imported = importValue(root, "recursive import")

        expect(imported).to.be(root)
        expect(metaOf(root).importBoundary.root).to.be(root)
        expect(metaOf(root).importBoundary.errorContext).to.be("recursive import")
        expect(metaOf(child)).to.be(undefined)

        buildRefIndex(root)
        expect(metaOf(child).shared).to.be(undefined)
        expect(metaOf(child).importBoundary).to.be(undefined)

        const resolved = { leaf, inner: inner.promise }
        outer.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved).shared).to.be(true)
        expect(metaOf(resolved).importBoundary.root).to.be(resolved)
        expect(metaOf(resolved).importBoundary.errorContext).to.be("recursive import")
        expect(metaOf(leaf).shared).to.be(undefined)

        const nested = { done: true }
        inner.resolve(nested)
        await flushMicrotasks()

        expect(metaOf(nested).shared).to.be(true)
        // External holders keep their original Promise; mirrors carry the value.
        expect(root.child.value).to.be(outer.promise)
    })

    it("coalesces imported promise paths with no new ancestors", async () => {
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

        // The second path is a subset of the first, so it cannot expose a new
        // cycle and does not need another import continuation.
        expect(registrations()).to.be(3)
        expect(metaOf(shared).shared).to.be(true)
        expect(metaOf(shared).importBoundary.root).to.be(shared)
        expect(metaOf(shared).importBoundary.errorContext).to.be("async aliases")

        const leaf = { done: true }
        nested.resolve(leaf)
        await flushMicrotasks()
        expect(metaOf(leaf).shared).to.be(true)
    })

    it("registers one writeback and path continuation per promise placement", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const root = {
            left: pending.promise,
            right: pending.promise,
        }

        importValue(root, "repeated promise")
        expect(registrations()).to.be(0)
        buildRefIndex(root)
        expect(registrations()).to.be(4)

        const resolved = { nested: {} }
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved).shared).to.be(true)
        expect(metaOf(resolved.nested).shared).to.be(undefined)
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
        expect(metaOf(bridge).cycleErrors.back.message).to.be(
            'Cyclic property "back" (imported at: asynchronous bridge)',
        )
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

        expect(metaOf(tail).cycleErrors.back.message).to.be(
            'Cyclic property "back" (imported at: asynchronous subtree bridge)',
        )
        verifyRefCounts(root, ancestor, bridge, tail)
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

    it("prepares from the import root when a nested branch is queried first", () => {
        const root = {}
        const branch = { back: root }
        root.branch = branch
        importValue(root, "rooted preparation")

        expect(hasError(new Chain(root), ["branch"])).to.be(true)

        expect(metaOf(root).cycleErrors).to.be(undefined)
        expect(metaOf(branch).cycleErrors.back.message).to.be(
            'Cyclic property "back" (imported at: rooted preparation)',
        )
        expect(metaOf(branch).importBoundary).to.be(undefined)
        verifyRefCounts(root, branch)
    })

    it("uses an extracted and assigned branch as a new import root", () => {
        const root = {}
        const branch = { back: root }
        root.branch = branch
        importValue(root, "rerooted branch")

        const extracted = lookupPath(new Chain(root), ["branch"], false)
        const chain = new Chain({})
        assignPath(chain, ["branch"], extracted)

        expect(hasError(chain, ["branch"])).to.be(true)
        expect(metaOf(branch).importBoundary.root).to.be(branch)
        expect(metaOf(branch).cycleErrors).to.be(undefined)
        expect(metaOf(root).cycleErrors.branch.message).to.be(
            'Cyclic property "branch" (imported at: rerooted branch)',
        )
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
        expect(normalize(new Chain(frozen), [])).to.be(frozen)
        verifyRefCounts(frozen)
    })

    it("propagates descendant cycle Errors through frozen imports", () => {
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
        expect(normalize(chain, [])).to.be(repaired)
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
        const normalized = normalize(new Chain(array), [], false, true)

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
        expect(normalize(new Chain(root), [])).to.be(root)
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
        expect(await normalized).to.be(resolved)
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
        const normalized = await normalize(chain, [], true, true)

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

    it("prepares a trusted indexed node reached later through import", () => {
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
        expect(metaOf(child).shared).to.be(undefined)
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

    it("preserves the import boundary on copied path-key children", () => {
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
        buildRefIndex(resolved) // the target must not hide behind this indexed island
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
        expect(metaOf(resolved).shared).to.be(true)
        expect(metaOf(resolved).importBoundary.root).to.be(resolved)
        expect(metaOf(resolved).importBoundary.errorContext).to.be("containing back-edge")
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

    it("detects cyclic imported promise roots later at counting time", async () => {
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
        expectCounts(frozen, 1, 0)

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
