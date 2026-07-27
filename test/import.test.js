import {
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
    exportValue,
    importValue,
    countPromiseRegistrations,
    deferred,
    flushMicrotasks,
    expectCounts,
} from "./support.js"
import { hasCycleCut } from "../src/import.js"

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

    it("writes resolved Promises to imported and runtime-owned holders", async () => {
        const externalPending = deferred()
        const runtimePending = deferred()
        const external = { pending: externalPending.promise }
        const runtimeOwned = { pending: runtimePending.promise }

        lookupPath(new Chain(runtimeOwned), [])
        importValue(external, "external holder")
        importValue(runtimeOwned, "runtime holder")

        externalPending.resolve("external")
        runtimePending.resolve("runtime")
        await flushMicrotasks()

        expect(external.pending).to.be("external")
        expect(runtimeOwned.pending).to.be("runtime")
        expect(lookupPath(new Chain(external), ["pending"], false)).to.be("external")
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
        expect(metaOf(child).mirrors.value).not.to.be(undefined)
        expect(child.value).to.be(outer.promise)

        buildRefIndex(root)
        expect(metaOf(child).shared).to.be(undefined)
        expect(metaOf(child).importBoundary).to.be(undefined)

        const resolved = { leaf, inner: inner.promise }
        outer.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved).importBoundary.root).to.be(resolved)
        expect(metaOf(leaf).shared).to.be(undefined)

        const nested = { done: true }
        inner.resolve(nested)
        await flushMicrotasks()

        expect(metaOf(nested).importBoundary.root).to.be(nested)
        expect(root.child.value).to.be(resolved)
        expect(resolved.inner).to.be(nested)
    })

    it("marks a repeated synchronous imported identity shared", () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const shared = { pending: pending.promise }

        importValue({ left: shared, right: shared }, "synchronous alias")

        expect(registrations()).to.be(1)
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

        expect(registrations()).to.be(1)
        expect(metaOf(shared).shared).to.be(true)
        expect(metaOf(shared).importBoundary.root).to.be(shared)

        const leaf = { done: true }
        nested.resolve(leaf)
        await flushMicrotasks()
        expect(metaOf(leaf).importBoundary.root).to.be(leaf)
    })

    it("eagerly registers one first resolver per promise placement", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const root = {
            left: pending.promise,
            right: pending.promise,
        }

        importValue(root, "repeated promise")
        expect(registrations()).to.be(2)
        buildRefIndex(root)
        expect(registrations()).to.be(2)

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
        expect(lookupPath(chain, ["branch"], false)).not.to.be(firstValue)
    })

    it("prepares a settled value before a later FIFO mutation", async () => {
        const pending = deferred()
        const root = { value: pending.promise }
        const chain = new Chain(root)

        importValue(root, "FIFO import continuation")
        assignPath(chain, ["value", "added"], true)
        buildRefIndex(root)

        pending.resolve({ clean: true })
        await flushMicrotasks()

        expect(root.value).to.eql({ clean: true })
        expect(chain._state.value.value).to.eql({ clean: true, added: true })
        expect(metaOf(chain._state.value.value)?.importBoundary).to.be(undefined)
        expect(metaOf(root).mirrors.value).not.to.be(undefined)
        expect(hasCycleCut(root, "value")).to.be(false)
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
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

        expect(hasError(new Chain(root), [])).to.be(false)
        expect(hasCycleCut(shared, "pending")).to.be(true)
        expect(metaOf(bridge).cycleCuts).to.be(undefined)
        expect(getErrors(new Chain(root), [])).to.eql([])
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

        expect(hasCycleCut(ancestor, "pending")).to.be(true)
        expect(metaOf(tail).cycleCuts).to.be(undefined)
        expect(getErrors(new Chain(root), [])).to.eql([])
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

        expect(metaOf(internal).cycleCuts.has("self")).to.be(true)
        expect(metaOf(resolved).cycleCuts).to.be(undefined)
        expect(hasCycleCut(ancestor, "pending")).to.be(true)
        expect(metaOf(unique).shared).to.be(undefined)
        expect(getErrors(new Chain(root), [])).to.eql([])
        verifyRefCounts(root)
    })

    it("prepares cyclic imports before counting indexes the branch", () => {
        const root = {}
        root.self = root

        const imported = importValue(root, "cycle import")
        expect(metaOf(root).cycleCuts.has("self")).to.be(true)
        expect(getRefCounter(root)).to.be(undefined)
        const indexed = buildRefIndex(root)

        expect(imported).to.be(root)
        expect(indexed).to.be(root)
        expect(getRefCounter(root).errorCount).to.be(0)
        expect(getRefCounter(root).cycleCutCount).to.be(1)
        expect(root.self).to.be(root)
    })

    it("uses the import root for eager cycle placement", () => {
        const root = {}
        const branch = { back: root }
        root.branch = branch
        importValue(root, "rooted preparation")

        expect(metaOf(branch).cycleCuts.has("back")).to.be(true)
        expect(hasError(new Chain(root), ["branch"])).to.be(false)

        expect(metaOf(root).cycleCuts).to.be(undefined)
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

        expect(hasError(chain, ["branch"])).to.be(false)
        expect(metaOf(branch).importBoundary.root).to.be(branch)
        expect(metaOf(branch).cycleCuts.has("back")).to.be(true)
        expect(metaOf(root).cycleCuts).to.be(undefined)
        verifyRefCounts(root, branch)
    })

    it("marks stable first-repeat edges from the import root", () => {
        const left = {}
        const right = {}
        left.right = right
        right.left = left
        right.self = right
        importValue(left, "interlocking cycles")

        expect(hasError(new Chain(left), [])).to.be(false)
        expect(metaOf(left).cycleCuts).to.be(undefined)
        expect(metaOf(right).cycleCuts.has("left")).to.be(true)
        expect(metaOf(right).cycleCuts.has("self")).to.be(true)
        expect(getErrors(new Chain(right), [])).to.eql([])
        const wrapper = importValue({ branch: left }, "marked reuse")
        buildRefIndex(wrapper)
        expect(metaOf(right).cycleCuts.has("left")).to.be(true)
        expectCounts(left, 0, 0, 2)
        expectCounts(right, 0, 0, 2)
        expectCounts(wrapper, 0, 0, 2)
        verifyRefCounts(wrapper, left, right)
    })

    it("reuses cuts inside a cycle and cuts an alternate route", () => {
        const b = {}
        const c = {}
        const x = {}
        const d = {}
        b.c = c
        b.alternate = x
        c.x = x
        x.d = d
        d.b = b

        importValue(x, "covered cycle")
        expect(metaOf(c).cycleCuts.has("x")).to.be(true)
        expect(metaOf(b).cycleCuts.has("alternate")).to.be(true)
        expect(metaOf(d).cycleCuts).to.be(undefined)

        importValue(b, "re-rooted covered cycle")
        buildRefIndex(b)

        expect(metaOf(d).cycleCuts).to.be(undefined)
        expectCounts(b, 0, 0, 2)
        expect(hasError(new Chain(b), [])).to.be(false)
        expect(getErrors(new Chain(b), [])).to.eql([])
        verifyRefCounts(b, x)
    })

    it("keeps observations and counts coherent from different imported roots", async () => {
        const leftPending = deferred()
        const rightPending = deferred()
        const leftError = new Error("left")
        const rightError = new Error("right")
        const left = { error: leftError, pending: leftPending.promise }
        const right = { error: rightError, pending: rightPending.promise }
        left.right = right
        right.left = left

        importValue(left, "left cycle root")
        importValue(right, "right cycle root")
        buildRefIndex(left)
        buildRefIndex(right)

        expectCounts(left, 2, 2, 1)
        expectCounts(right, 1, 1, 1)
        expect(hasError(new Chain(left), [])).to.be(true)
        expect(hasError(new Chain(right), [])).to.be(true)

        const leftResult = getErrors(new Chain(left), [])
        const rightResult = getErrors(new Chain(right), [])
        const leftResolvedError = new Error("left resolved")
        const rightResolvedError = new Error("right resolved")
        leftPending.resolve({ error: leftResolvedError })
        rightPending.resolve({ error: rightResolvedError })

        const expectedErrors = [
            leftError,
            rightError,
            leftResolvedError,
            rightResolvedError,
        ]
        for (const errors of [await leftResult, await rightResult]) {
            expect(errors.length).to.be(expectedErrors.length)
            for (const error of expectedErrors) {
                expect(errors.includes(error)).to.be(true)
            }
        }
        expectCounts(left, 0, 4, 1)
        expectCounts(right, 0, 2, 1)
        verifyRefCounts(left, right)
    })

    it("keeps a cycle cut when lookup re-roots a node inside the cycle", () => {
        const first = { name: "first" }
        const second = { name: "second" }
        first.next = second
        second.next = first
        importValue(first, "cycle lookup")

        const extracted = lookupPath(new Chain(first), ["next"], false)

        expect(extracted).to.be(second)
        expect(lookupPath(
            new Chain(extracted),
            ["next", "next", "name"],
            false,
        )).to.be("second")
        expect(getErrors(new Chain(extracted), [])).to.eql([])
        expect(metaOf(second).cycleCuts.has("next")).to.be(true)
    })

    it("marks the imported property that closes a discovered cycle", () => {
        const batchParent = {}
        const batchChild = { back: batchParent }
        batchParent.child = batchChild
        importValue(batchParent, "batch cycle")
        buildRefIndex(batchParent)

        expect(metaOf(batchParent).cycleCuts).to.be(undefined)
        expect(metaOf(batchChild).cycleCuts.has("back")).to.be(true)
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

        expect(registrations()).to.be(1)

        assignPath(chain, ["child"], child)
        expect(registrations()).to.be(1)

        const resolved = { nested: nested.promise }
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved).shared).to.be(true)
        expect(nestedRegistrations()).to.be(1)

        nested.resolve({ clean: true })
        await flushMicrotasks()

        expect(hasError(chain, [])).to.be(false)
        verifyRefCounts(chain._state.value)
    })

    it("cuts a nested imported Promise after its wrapper is attached", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const imported = importValue(
            { pending: pending.promise },
            "nested imported attachment",
        )
        const wrapper = { imported }
        const extracted = lookupPath(new Chain(wrapper), [])
        const chain = new Chain(importValue(
            { slot: null },
            "wrapper destination",
        ))

        expect(registrations()).to.be(1)
        assignPath(chain, ["slot"], extracted)
        const destination = chain._state.value
        expect(registrations()).to.be(1)

        pending.resolve(destination)
        await flushMicrotasks()

        expect(hasCycleCut(imported, "pending")).to.be(true)
        expect(hasError(chain, [])).to.be(false)
        expect(getErrors(chain, [])).to.eql([])

        const exported = exportValue(chain, [])
        expect(exported.slot.imported.pending).to.be(exported)
        verifyRefCounts(destination, wrapper, imported)
    })

    it("cuts an imported Promise root inside an attached wrapper", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const imported = importValue(
            pending.promise,
            "nested imported Promise root",
        )
        const wrapper = { imported }
        const extracted = lookupPath(new Chain(wrapper), [])
        const chain = new Chain(importValue(
            { slot: null },
            "Promise-root wrapper destination",
        ))

        expect(registrations()).to.be(1)
        assignPath(chain, ["slot"], extracted)
        const destination = chain._state.value
        expect(registrations()).to.be(1)

        pending.resolve(destination)
        await flushMicrotasks()

        expect(hasCycleCut(wrapper, "imported")).to.be(true)
        expect(hasError(chain, [])).to.be(false)
        expect(getErrors(chain, [])).to.eql([])

        const exported = exportValue(chain, [])
        expect(exported.slot.imported).to.be(exported)
        verifyRefCounts(destination, wrapper)
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

        expect(await hasErrorResult).to.be(false)
        expect(await getErrorsResult).to.eql([])
        expect(hasCycleCut(incoming, "pending")).to.be(true)
        expect(metaOf(destination).cycleCuts).to.be(undefined)
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

        expect(hasCycleCut(incoming, "pending")).to.be(true)
        expect(metaOf(destination).cycleCuts).to.be(undefined)
        expect(hasError(chain, [])).to.be(false)
        expect(getErrors(chain, [])).to.eql([])
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

        expect(await result).to.be(false)
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

        expect(await result).to.be(false)
        expect(hasError(chain, [])).to.be(false)
    })

    it("keeps intrinsic cycle cuts after an attachment is replaced", async () => {
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            "intrinsic detached attachment",
        )
        const chain = new Chain(importValue({ value: null }, "destination"))
        const cyclic = {}
        cyclic.self = cyclic

        assignPath(chain, ["value"], incoming)
        assignPath(chain, ["value"], null)
        pending.resolve(cyclic)
        await flushMicrotasks()

        expect(metaOf(cyclic).cycleCuts.has("self")).to.be(true)
        expect(getErrors(new Chain(incoming), [])).to.eql([])
    })

    it("stores cycle cuts for frozen imports in both metadata modes", () => {
        const frozen = {}
        frozen.self = frozen
        Object.freeze(frozen)
        importValue(frozen, "frozen cycle")

        buildRefIndex(frozen)

        expect(metaOf(frozen).cycleCuts.has("self")).to.be(true)
        expectCounts(frozen, 0, 0, 1)
        const exported = exportValue(new Chain(frozen), [])
        expect(exported).not.to.be(frozen)
        expect(exported.self).to.be(exported)
        verifyRefCounts(frozen)
    })

    it("propagates descendant cycle cuts through frozen imports", () => {
        const child = {}
        child.self = child
        const root = Object.freeze({ child })
        const chain = new Chain(importValue(root, "nested frozen cycle"))

        expect(hasError(chain, [])).to.be(false)
        expect(getErrors(chain, [])).to.eql([])
        const copy = exportValue(chain, [])
        expect(copy).not.to.be(root)
        expect(copy.child.self).to.be(copy.child)
        expectCounts(root, 0, 0, 1)
        expectCounts(child, 0, 0, 1)
        verifyRefCounts(root)
    })

    it("keeps the first import boundary attribution", () => {
        const root = {}
        root.self = root

        importValue(root, "first import")
        importValue(root, "second import")
        buildRefIndex(root)
        expect(metaOf(root).importBoundary.errorContext).to.be("first import")
        expect(metaOf(root).cycleCuts.has("self")).to.be(true)
    })

    it("uses the nearest nested import boundary", () => {
        const child = {}
        child.self = child
        importValue(child, "child import")
        const root = importValue({ child }, "parent import")

        buildRefIndex(root)
        expect(metaOf(child).importBoundary.errorContext).to.be("child import")
        expect(metaOf(child).cycleCuts.has("self")).to.be(true)
        expect(getRefCounter(root).errorCount).to.be(0)
        expect(getRefCounter(root).cycleCutCount).to.be(1)
        expect(getRefCounter(child).errorCount).to.be(0)
        expect(getRefCounter(child).cycleCutCount).to.be(1)
    })

    it("checks an existing imported identity against new ancestry", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const child = importValue(
            { pending: pending.promise },
            "child import",
        )

        expect(registrations()).to.be(1)
        importValue({ child }, "wrapper import")
        expect(registrations()).to.be(1)

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

        expect(metaOf(child).cycleCuts.has("back")).to.be(true)
        expectCounts(parent, 0, 0, 1)
        expectCounts(child, 0, 0, 1)
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
        expect(getErrors(new Chain(cyclic), [])).to.eql([])
        expect(metaOf(cyclic).importBoundary.errorContext).to.be("first async import")
        expect(metaOf(cyclic).cycleCuts.has("self")).to.be(true)
    })

    it("recovers from a cycle after a COW repair", () => {
        const root = {}
        root.self = root
        importValue(root, "repairable import")
        const chain = new Chain(root)

        expect(hasError(chain, [])).to.be(false)
        expect(getRefCounter(root).errorCount).to.be(0)
        expect(getRefCounter(root).cycleCutCount).to.be(1)

        deletePath(chain, ["self"])
        const repaired = chain._state.value

        expect(repaired).not.to.be(root)
        expect(repaired).to.eql({})
        expect(root.self).to.be(root)
        expect(exportValue(chain, [])).to.eql(repaired)
        expect(hasError(chain, [])).to.be(false)
        verifyRefCounts(repaired)
    })

    it("supports sealed Promise properties and rejects frozen ones", async () => {
        const promise = Promise.resolve(1)
        const error = new Error("bad")
        const sealedPromise = Object.seal({ pending: promise })
        const frozenError = Object.preventExtensions({ error })
        const frozenPromise = Object.freeze({ pending: Promise.resolve(2) })
        let caught

        expect(importValue(sealedPromise, "sealed promise")).to.be(sealedPromise)
        expect(importValue(frozenError, "frozen error")).to.be(frozenError)
        try {
            importValue(frozenPromise, "frozen promise")
        } catch (error) {
            caught = error
        }

        expect(caught.message).to.be(
            "Cannot assign to non-writable property (imported at: frozen promise)",
        )
        expect(buildRefIndex(sealedPromise)).to.be(sealedPromise)
        expect(buildRefIndex(frozenError)).to.be(frozenError)
        expectCounts(sealedPromise, 1, 0)
        expectCounts(frozenError, 0, 1)

        await flushMicrotasks()

        expect(sealedPromise.pending).to.be(1)
        expect(lookupPath(new Chain(sealedPromise), ["pending"], false)).to.be(1)
        expect(getErrors(new Chain(frozenError), [])[0]).to.be(error)
        expectCounts(sealedPromise, 0, 0)
        verifyRefCounts(sealedPromise, frozenError)
    })

    it("exports pending elements in a sealed array", async () => {
        const first = deferred()
        const second = deferred()
        const nested = Object.seal({ pending: second.promise })
        const array = Object.seal([first.promise, nested])

        importValue(array, "sealed array")
        const exported = exportValue(new Chain(array), [])

        expect(getRefCounter(array)).to.be(undefined)
        expect(getRefCounter(nested)).to.be(undefined)

        first.resolve({ x: 1 })
        second.resolve(2)
        const copy = await exported

        expect(copy).to.eql([{ x: 1 }, { pending: 2 }])
        expect(array[0]).to.eql({ x: 1 })
        expect(nested.pending).to.be(2)
        expect(hasError(new Chain(array), [])).to.be(false)
        expect(getErrors(new Chain(array), [])).to.eql([])
        expectCounts(array, 0, 0)
        verifyRefCounts(array)
    })

    it("indexes and observes cyclic arrays", async () => {
        const pending = deferred()
        const directError = new Error("array direct")
        const array = []
        array[0] = array
        array[1] = directError
        array[2] = pending.promise

        importValue(array, "cyclic array")
        buildRefIndex(array)

        expect(metaOf(array).cycleCuts.has("0")).to.be(true)
        expectCounts(array, 1, 1, 1)
        expect(hasError(new Chain(array), [])).to.be(true)

        const result = getErrors(new Chain(array), [])
        const resolvedError = new Error("array resolved")
        pending.resolve({ error: resolvedError })

        const errors = await result
        expect(errors.length).to.be(2)
        expect(errors.includes(directError)).to.be(true)
        expect(errors.includes(resolvedError)).to.be(true)
        expectCounts(array, 0, 2, 1)
        verifyRefCounts(array)
    })

    it("counts rejection Errors behind sealed promise properties", async () => {
        const pending = deferred()
        const error = new Error("rejected sealed value")
        const root = Object.seal({ pending: pending.promise })

        importValue(root, "sealed rejection")
        const errors = getErrors(new Chain(root), [])
        expectCounts(root, 1, 0)

        pending.reject(error)
        const result = await errors

        expect(result).to.eql([error])
        expect(root.pending).to.be(error)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("indexes sealed enumerable __proto__ regardless of Promise order", async () => {
        function sealedValue(protoFirst) {
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
            return Object.seal(value)
        }

        for (const value of [sealedValue(true), sealedValue(false)]) {
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
        const first = Object.seal({ clean: 1, pending: firstPromise })
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
        expect(first.pending).to.be(1)
        expect(second.bad).to.be(secondError)
        expect(hasError(chain, ["first", "clean"])).to.be(false)
        expect(exportValue(chain, ["first", "clean"])).to.be(1)

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
        expect(metaOf(root).cycleCuts.has("__proto__")).to.be(true)
        expect(hasError(new Chain(root), [])).to.be(false)
        expect(getErrors(new Chain(root), [])).to.eql([])
        const exported = exportValue(new Chain(root), [])
        expect(exported).not.to.be(root)
        expect(Object.getOwnPropertyDescriptor(exported, "__proto__").value).to.be(
            exported,
        )
        expect(root.__proto__).to.be(root)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
        expectCounts(root, 0, 0, 1)
        verifyRefCounts(root)
    })

    it("indexes enumerable __proto__ data reached through a promise", async () => {
        const pending = deferred()
        const root = {
            value: importValue(pending.promise, "pending proto import"),
        }
        const chain = new Chain(root)
        const found = hasError(chain, ["value"])
        const collected = getErrors(chain, ["value"])
        const exported = exportValue(chain, ["value"])
        buildRefIndex(root)
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
        const exportedValue = await exported
        expect(exportedValue).not.to.be(resolved)
        expect(exportedValue.clean).to.be(true)
        expect(Object.getOwnPropertyDescriptor(
            exportedValue,
            "__proto__",
        ).value).to.be("hidden")
        expect(hasCycleCut(root, "value")).to.be(false)
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
        const exported = await exportValue(chain, [])

        expect(copy).not.to.be(external)
        expect(Object.getOwnPropertyDescriptor(external, "__proto__").value).to.be(
            "hidden",
        )
        expect(Object.getOwnPropertyDescriptor(copy, "__proto__").value).to.be("hidden")
        expect(Object.getPrototypeOf(copy)).to.be(Object.prototype)
        expect(await hasError(chain, [])).to.be(false)
        expect(errors).to.eql([])
        expect(Object.getOwnPropertyDescriptor(exported, "__proto__").value).to.be("hidden")
        expect(Object.getPrototypeOf(exported)).to.be(Object.prototype)
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
        const root = importValue({ child }, "late import boundary")

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

        importValue(root, "COW import boundary")
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

        importValue(root, "Promise COW import boundary")
        const chain = new Chain(root)
        assignPath(chain, ["path", "added"], 2)
        const next = chain._state.value
        const mirrors = metaOf(next).mirrors

        expect(metaOf(next).importBoundary).to.be(undefined)
        expect(mirrors.path.importBoundary).to.be(undefined)
        expect(mirrors.retained.importBoundary.root).to.be(root)

        pathValue.resolve({ kept: true })
        retainedValue.resolve({ sibling: true })
        await flushMicrotasks()

        expect(root.path).to.eql({ kept: true })
        expect(root.retained).to.eql({ sibling: true })
        expect(next.path).to.eql({ kept: true, added: 2 })
        expect(metaOf(next.path)?.importBoundary).to.be(undefined)
        expect(next.retained).to.eql({ sibling: true })
    })

    it("retains Promise import boundaries across repeated pending COW forks", async () => {
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

        pending.resolve(resolved)
        await flushMicrotasks()

        expect(second.pending).to.be(resolved)
        expect(lookupPath(chain, ["pending"], false)).to.be(resolved)
        expect(metaOf(resolved).importBoundary.root).to.be(resolved)
        expect(metaOf(resolved).importBoundary.errorContext).to.be(
            "repeated Promise COW",
        )
    })

    it("samples Promise import attribution at the fork's FIFO position", async () => {
        const pending = deferred()
        const root = { pending: pending.promise, sibling: 0 }

        importValue(root, "FIFO Promise attribution")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        assignPath(chain, ["pending", "first"], 1)

        // Force a later COW while the earlier path mutation is suspended. Its
        // The off-path fork must observe that the earlier mutation consumed
        // attribution.
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

    it("retains a resolved import boundary when COW drops its mirror", async () => {
        const pending = deferred()
        const resolved = { value: true }
        const root = {
            pending: pending.promise,
            left: 0,
            right: 0,
        }

        importValue(root, "resolved Promise COW")
        const chain = new Chain(root)
        assignPath(chain, ["left"], 1)
        const first = chain._state.value

        pending.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(first).mirrors.pending.importBoundary).to.be(undefined)
        expect(metaOf(resolved).importBoundary.root).to.be(resolved)

        lookupPath(chain, [])
        assignPath(chain, ["right"], 2)
        const second = chain._state.value

        expect(metaOf(second)?.mirrors?.pending).to.be(undefined)
        expect(second.pending).to.be(resolved)
        expect(metaOf(resolved).importBoundary.root).to.be(resolved)
        expect(metaOf(resolved).importBoundary.errorContext).to.be(
            "resolved Promise COW",
        )
    })

    it("clears Promise attribution when an off-path fork becomes the COW path", async () => {
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
        expect(metaOf(owned)?.importBoundary).to.be(undefined)
        expect(owned).to.eql({ original: true, first: 1 })

        assignPath(chain, ["pending", "second"], 2)
        expect(lookupPath(chain, ["pending"], false)).to.be(owned)
        expect(owned.second).to.be(2)
    })

    it("consumes a resolved Promise mirror on the COW path", async () => {
        const pending = deferred()
        const retained = {}
        const root = { pending: pending.promise, sibling: 0 }

        importValue(root, "resolved Promise path")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        const parentCopy = chain._state.value
        const mirror = metaOf(parentCopy).mirrors.pending

        pending.resolve({ retained, value: 0 })
        await flushMicrotasks()

        expect(mirror.importBoundary).to.be(undefined)
        assignPath(chain, ["pending", "value"], 1)
        const owned = lookupPath(chain, ["pending"], false)

        expect(metaOf(parentCopy).mirrors?.pending).to.be(undefined)
        expect(metaOf(owned)?.importBoundary).to.be(undefined)
        expect(metaOf(retained).importBoundary.root).to.be(retained)
        expect(metaOf(retained).importBoundary.errorContext).to.be(
            "resolved Promise path",
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
        expect(hasError(new Chain(next.branch), [])).to.be(false)
    })

    it("discovers imported promise keys before the branch is counted", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        importValue(root, "promise key import")
        expect(metaOf(root).mirrors.value).not.to.be(undefined)
        expect(root.value).to.be(deferredValue.promise)
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
        expect(root.value).to.be(oldValue)
        expect(next).not.to.be(root)
        expect(next.value).not.to.be(oldValue)
        expect(oldValue.x).to.be(1)
        expect(next.value.x).to.be(2)
        expectCounts(root, 0, 0)
        verifyRefCounts(root, next)
    })

    it("indexes sealed values exposed by imported Promise resolution", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, "sealed resolution")
        buildRefIndex(root)
        expectCounts(root, 1, 0)

        deferredValue.resolve(Object.seal({ pending: Promise.resolve(1) }))
        await flushMicrotasks()

        expect(root.nested.value.pending).to.be(1)
        expect(await getErrors(new Chain(root), [])).to.eql([])
        expect(lookupPath(new Chain(root), ["nested", "value", "pending"], false)).to.be(1)
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("indexes private non-extensible values from detached mirrors", async () => {
        const pending = deferred()
        const errorValue = Object.freeze({ bad: new Error("bad") })
        const root = { value: pending.promise }
        const chain = new Chain(root)

        importValue(errorValue, "detached resolution")
        buildRefIndex(root)
        const mirror = metaOf(root).mirrors.value
        assignPath(chain, ["value"], "fixed")

        pending.resolve(errorValue)
        await flushMicrotasks()

        expect(root.value).to.be("fixed")
        expect(mirror.detachedValue).to.be(errorValue)
        expectCounts(errorValue, 0, 1)
        expect(getErrors(new Chain(errorValue), [])[0]).to.be(errorValue.bad)
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("marks imported Promise values that reach their target", async () => {
        const deferredValue = deferred()
        const pendingSibling = deferred()
        const root = {
            nested: {
                pending: pendingSibling.promise,
                value: deferredValue.promise,
            },
        }

        importValue(root, "resolved back-edge")
        buildRefIndex(root)
        expectCounts(root, 2, 0)

        deferredValue.resolve(root)
        await flushMicrotasks()

        expect(root.nested.value).to.be(root)
        expect(hasCycleCut(root.nested, "value")).to.be(true)
        expectCounts(root, 1, 0, 1)
        verifyRefCounts(root)

        pendingSibling.resolve("done")
        await flushMicrotasks()

        expectCounts(root, 0, 0, 1)
        verifyRefCounts(root)
    })

    it("marks imported Promise values that contain their target", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }
        const resolved = { target: root.nested }

        importValue(root, "containing back-edge")
        buildRefIndex(root)

        deferredValue.resolve(resolved)
        await flushMicrotasks()

        expect(root.nested.value).to.be(resolved)
        expect(getErrors(new Chain(root), [])).to.eql([])
        expect(metaOf(resolved).cycleCuts).to.be(undefined)
        expect(hasCycleCut(root.nested, "value")).to.be(true)
        expect(metaOf(resolved).shared).to.be(true)
        expect(metaOf(resolved).importBoundary.root).to.be(resolved)
        expectCounts(root, 0, 0, 1)
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

        expect(hasCycleCut(next, "self")).to.be(true)
        expect(next.self).to.be(next)
        expect(lookupPath(chain, ["self"], false)).to.be(next)
        expect(hasError(chain, [])).to.be(false)
        expect(getErrors(chain, [])).to.eql([])
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
        pending.resolve(copy)
        await flushMicrotasks()

        expect(hasCycleCut(root, "pending")).to.be(false)
        expect(hasCycleCut(copy, "pending")).to.be(true)
        expect(root.pending).to.be(copy)
        expect(copy.pending).to.be(copy)
        expect(hasError(chain, [])).to.be(false)
        expect(getErrors(chain, [])).to.eql([])
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
        expectCounts(copy, 1, 0)
        pending.resolve(copy)
        await flushMicrotasks()

        expectCounts(copy, 0, 0, 1)
        expect(hasCycleCut(copy, "pending")).to.be(true)
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
        pending.resolve(root)
        await flushMicrotasks()

        expect(hasCycleCut(root, "pending")).to.be(true)
        expect(hasCycleCut(copy, "pending")).to.be(false)
        expect(root.pending).to.be(root)
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
        pending.resolve(copy)
        await flushMicrotasks()

        expect(hasCycleCut(copy.branch, "pending")).to.be(true)
        expect(copy.branch.pending).to.be(copy)
        expect(hasError(chain, [])).to.be(false)
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
        pending.resolve(copy.branch)
        await flushMicrotasks()

        expect(hasCycleCut(copy, "pending")).to.be(false)
        expect(copy.pending).to.be(copy.branch)
        expect(hasError(chain, [])).to.be(false)
        verifyRefCounts(root, copy)
    })

    it("keeps a detached fork query on its captured COW destination", async () => {
        const pending = deferred()
        const root = {
            pending: pending.promise,
            sibling: 0,
        }

        importValue(root, "detached fork destination")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        const captured = chain._state.value
        const result = hasError(chain, ["pending"])
        assignPath(chain, ["pending"], null)

        pending.resolve(captured)

        expect(await result).to.be(false)
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

        expect(hasCycleCut(root.nested, "value")).to.be(true)
        expect(getRefCounter(root)).to.be(undefined)
        const indexed = buildRefIndex(root)

        expect(root.nested.value).to.be(root.nested)
        expect(lookupPath(new Chain(root), ["nested", "value"], false)).to.be(root.nested)
        expect(indexed).to.be(root)
        expect(hasError(new Chain(root), [])).to.be(false)
    })

    it("prepares cyclic imported promise roots before returning them", async () => {
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, "promise root")
        const cyclic = {}
        cyclic.self = cyclic

        deferredValue.resolve(cyclic)
        const value = await imported
        expect(metaOf(value).cycleCuts.has("self")).to.be(true)
        expect(getRefCounter(value)).to.be(undefined)
        const indexed = buildRefIndex(value)

        expect(value).to.be(cyclic)
        expect(indexed).to.be(cyclic)
        expect(hasError(new Chain(value), [])).to.be(false)
    })

    it("keeps the import boundary when promise roots resolve to sealed values", async () => {
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, "sealed promise root")
        const sealed = Object.seal({ pending: Promise.resolve(1) })

        deferredValue.resolve(sealed)
        const value = await imported
        const indexed = buildRefIndex(value)

        expect(value).to.be(sealed)
        expect(indexed).to.be(sealed)
        expect(metaOf(sealed).importBoundary.root).to.be(sealed)
        expect(metaOf(sealed).importBoundary.errorContext).to.be("sealed promise root")
        expectCounts(sealed, 0, 0)

        await flushMicrotasks()

        expect(sealed.pending).to.be(1)
        expect(lookupPath(new Chain(sealed), ["pending"], false)).to.be(1)
        expectCounts(sealed, 0, 0)
        verifyRefCounts(sealed)
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
