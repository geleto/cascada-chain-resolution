import {
    Chain,
    expect,
    runtime,
    setFatalErrorReporter,
    getRefCounter,
    buildRefIndex,
    metaOf,
    verifyRefCounts,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    lookupPath,
    readPath,
    exportValue,
    importValue,
    countPromiseRegistrations,
    deferred,
    flushMicrotasks,
    expectCounts,
} from "./support.js"
import { hasCycleCut } from "../src/refcounts.js"

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

    it("preserves imported descendants used as independent roots", () => {
        const child = { value: 1 }
        const sealed = Object.seal({ value: 1 })
        importValue({ child, sealed }, "independent descendants")

        for (const source of [child, sealed]) {
            expect(metaOf(source).importBoundary).not.to.be(undefined)
            const chain = new Chain(source)
            assignPath(chain, ["value"], 2)

            expect(chain._state.value).not.to.be(source)
            expect(chain._state.value.value).to.be(2)
            expect(source.value).to.be(1)
        }
    })

    it("stores imported graph metadata without modifying host objects", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = { child }
        const rootKeys = Reflect.ownKeys(root)
        const childKeys = Reflect.ownKeys(child)

        importValue(root, "external metadata")
        buildRefIndex(root)

        expect(Reflect.ownKeys(root)).to.eql(rootKeys)
        expect(Reflect.ownKeys(child)).to.eql(childKeys)

        const resolved = { done: true }
        const resolvedKeys = Reflect.ownKeys(resolved)
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(child.pending).to.be(pending.promise)
        expect(Reflect.ownKeys(root)).to.eql(rootKeys)
        expect(Reflect.ownKeys(child)).to.eql(childKeys)
        expect(Reflect.ownKeys(resolved)).to.eql(resolvedKeys)
        expect(readPath(new Chain(child), ["pending"])).to.be(resolved)
    })

    it("keeps runtime metadata external when its owner is imported", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const root = { pending: pending.promise }
        const originalKeys = Reflect.ownKeys(root)
        const earlierRead = readPath(new Chain(root), ["pending"])
        expect(registrations()).to.be(2)

        expect(Reflect.ownKeys(root)).to.eql(originalKeys)

        importValue(root, "promoted runtime owner")

        expect(Reflect.ownKeys(root)).to.eql(originalKeys)
        expect(metaOf(root).importBoundary).not.to.be(undefined)
        expect(registrations()).to.be(3)

        const resolved = { done: true }
        pending.resolve(resolved)
        expect(await earlierRead).to.be(resolved)
        await flushMicrotasks()

        expect(root.pending).to.be(pending.promise)
        expect(readPath(new Chain(root), ["pending"])).to.be(resolved)
    })

    it("imports an already-advanced runtime property version", async () => {
        const pending = deferred()
        const root = { pending: pending.promise }
        readPath(new Chain(root), ["pending"])

        const resolved = { value: 1 }
        pending.resolve(resolved)
        await flushMicrotasks()
        expect(root.pending).to.be(resolved)

        importValue(root, "advanced runtime version")
        buildRefIndex(root)
        verifyRefCounts(root)

        const chain = new Chain(root)
        assignPath(chain, ["pending", "value"], 2)
        expect(chain._state.value.pending.value).to.be(2)
        expect(root.pending).to.be(resolved)
        expect(resolved.value).to.be(1)
    })

    it("preserves imported Promises and writes runtime-owned results", async () => {
        const externalPending = deferred()
        const runtimePending = deferred()
        const external = { pending: externalPending.promise }
        const runtimeOwned = { pending: runtimePending.promise }

        buildRefIndex(runtimeOwned)
        importValue(external, "external holder")

        externalPending.resolve("external")
        runtimePending.resolve("runtime")
        await flushMicrotasks()

        expect(external.pending).to.be(externalPending.promise)
        expect(runtimeOwned.pending).to.be("runtime")
        expect(readPath(new Chain(external), ["pending"])).to.be("external")
        const mirror = metaOf(external).mirrors.pending
        expect(metaOf(external).importBoundary).not.to.be(undefined)
        expect(Object.hasOwn(mirror, "importBoundary")).to.be(false)
    })

    it("writes through Promise properties of runtime islands", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }
        lookupPath(new Chain(child), [])

        importValue({ child }, "runtime island")
        expect(metaOf(child).importBoundary).to.be(undefined)

        const resolved = { done: true }
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(child.pending).to.be(resolved)
        expect(metaOf(resolved)?.importBoundary).to.be(undefined)
    })

    it("scans overlapping runtime islands once per import", () => {
        let scans = 0
        const nested = new Proxy({}, {
            ownKeys(target) {
                scans++
                return Reflect.ownKeys(target)
            },
        })
        const outer = { nested }
        lookupPath(new Chain(outer), [])
        lookupPath(new Chain(nested), [])

        importValue({ outer, nested }, "overlapping islands")
        expect(scans).to.be(1)

        const pending = deferred()
        nested.pending = pending.promise
        importValue({ outer, nested }, "later frontier")

        expect(scans).to.be(2)
        expect(metaOf(nested).mirrors.pending.value).to.be(pending.promise)
    })

    it("imports a direct alias regardless of runtime-island scan order", async () => {
        for (const runtimeFirst of [true, false]) {
            const pending = deferred()
            const child = { pending: pending.promise }
            const runtimeOwned = { child }
            lookupPath(new Chain(runtimeOwned), [])
            const external = runtimeFirst
                ? { runtimeOwned, direct: child }
                : { direct: child, runtimeOwned }
            const errorContext = runtimeFirst
                ? "runtime island first"
                : "direct alias first"

            importValue(external, errorContext)
            expect(metaOf(child).importBoundary.errorContext).to.be(
                errorContext,
            )

            const resolved = { done: true }
            pending.resolve(resolved)
            await flushMicrotasks()

            expect(child.pending).to.be(pending.promise)
            expect(readPath(new Chain(child), ["pending"])).to.be(
                resolved,
            )
        }
    })

    it("reuses one runtime mirror across imported wrappers", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const child = { pending: pending.promise }
        const observed = readPath(new Chain(child), ["pending"])
        const first = importValue({ child }, "first wrapper")
        const second = importValue({ child }, "second wrapper")

        expect(registrations()).to.be(2)

        pending.resolve(second)
        expect(await observed).to.be(second)
        await flushMicrotasks()

        expect(registrations()).to.be(2)
        expect(child.pending).to.be(second)
        buildRefIndex(second)
        expect(hasCycleCut(child, "pending")).to.be(true)
        buildRefIndex(first)
        verifyRefCounts(first, second, child)
    })

    it("preserves an imported undefined result", async () => {
        const pending = deferred()
        const external = { pending: pending.promise }
        importValue(external, "undefined result")

        pending.resolve(undefined)
        await flushMicrotasks()

        expect(external.pending).to.be(pending.promise)
        expect(readPath(new Chain(external), ["pending"])).to.be(undefined)
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

    it("classifies imported descendants and discovers promises eagerly", async () => {
        const outer = deferred()
        const inner = deferred()
        const leaf = { x: 1 }
        const child = { value: outer.promise }
        const root = { child }

        const imported = importValue(root, "recursive import")
        const importBoundary = metaOf(root).importBoundary

        expect(imported).to.be(root)
        expect(importBoundary).to.eql({ errorContext: "recursive import" })
        expect(metaOf(child).shared).to.be(true)
        expect(metaOf(child).importBoundary).to.be(importBoundary)
        expect(metaOf(child).mirrors.value).not.to.be(undefined)
        expect(child.value).to.be(outer.promise)

        buildRefIndex(root)
        expect(metaOf(child).shared).to.be(true)
        expect(metaOf(child).importBoundary).to.be(importBoundary)

        const resolved = { leaf, inner: inner.promise }
        outer.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved).importBoundary).to.be(importBoundary)
        expect(metaOf(leaf).shared).to.be(true)
        expect(metaOf(leaf).importBoundary).to.be(importBoundary)

        const nested = { done: true }
        inner.resolve(nested)
        await flushMicrotasks()

        expect(metaOf(nested).importBoundary).to.be(importBoundary)
        expect(child.value).to.be(outer.promise)
        expect(resolved.inner).to.be(inner.promise)
        expect(readPath(new Chain(root), ["child", "value"])).to.be(
            resolved,
        )
        expect(readPath(new Chain(resolved), ["inner"])).to.be(nested)
    })

    it("marks a repeated synchronous imported identity shared", () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const shared = { pending: pending.promise }

        importValue({ left: shared, right: shared }, "synchronous alias")

        expect(registrations()).to.be(1)
        expect(metaOf(shared).shared).to.be(true)
    })

    it("reuses imported identities across import calls", () => {
        const shared = { value: 1 }

        importValue({ first: shared }, "first owner")
        const meta = metaOf(shared)
        expect(meta.shared).to.be(true)

        importValue({ second: shared }, "second owner")
        expect(metaOf(shared)).to.be(meta)
    })

    it("reuses one nested Promise mirror across asynchronous aliases", async () => {
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
        expect(metaOf(shared).importBoundary).not.to.be(undefined)

        const leaf = { done: true }
        nested.resolve(leaf)
        await flushMicrotasks()
        expect(metaOf(leaf).importBoundary).not.to.be(undefined)
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
        expect(metaOf(resolved.nested).shared).to.be(true)
    })

    it("keeps import classification with the original Promise version", async () => {
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
        expect(readPath(chain, ["branch"])).to.eql({ x: 1 })
        expect(readPath(chain, ["branch"])).not.to.be(firstValue)
    })

    it("classifies a settled value before a later FIFO mutation", async () => {
        const pending = deferred()
        const root = { value: pending.promise }
        const chain = new Chain(root)

        importValue(root, "FIFO import continuation")
        assignPath(chain, ["value", "added"], true)
        buildRefIndex(root)

        pending.resolve({ clean: true })
        await flushMicrotasks()

        expect(root.value).to.be(pending.promise)
        expect(readPath(new Chain(root), ["value"])).to.eql({
            clean: true,
        })
        expect(chain._state.value.value).to.eql({ clean: true, added: true })
        expect(metaOf(chain._state.value.value)?.importBoundary).to.be(undefined)
        expect(metaOf(root).mirrors.value).not.to.be(undefined)
        expect(hasCycleCut(root, "value")).to.be(false)
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("indexes a Promise result that closes a cycle through an alias", async () => {
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

    it("indexes a Promise result that closes a nested alias cycle", async () => {
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

    it("indexes cycles exposed by an imported Promise", async () => {
        const pending = deferred()
        const ancestor = { pending: pending.promise }
        const root = { ancestor }
        importValue(root, "split cycle")

        const internal = {}
        internal.self = internal
        const unique = { ok: true }
        const resolved = { internal, unique, back: ancestor }

        pending.resolve(resolved)
        await flushMicrotasks()
        buildRefIndex(root)

        expect(metaOf(internal).cycleCuts.has("self")).to.be(true)
        expect(hasCycleCut(resolved, "back")).to.be(true)
        expect(metaOf(unique).shared).to.be(true)
        expect(getErrors(new Chain(root), [])).to.eql([])
        verifyRefCounts(root)
    })

    it("defers imported cycle cuts until indexing", () => {
        const root = {}
        root.self = root

        const imported = importValue(root, "cycle import")
        expect(metaOf(root).cycleCuts).to.be(undefined)
        expect(getRefCounter(root)).to.be(undefined)
        const indexed = buildRefIndex(root)

        expect(imported).to.be(root)
        expect(indexed).to.be(root)
        expect(getRefCounter(root).errorCount).to.be(0)
        expect(getRefCounter(root).cycleCutCount).to.be(1)
        expect(metaOf(root).cycleCuts.has("self")).to.be(true)
        expect(root.self).to.be(root)
    })

    it("indexes an imported cycle from its root", () => {
        const root = {}
        const branch = { back: root }
        root.branch = branch
        importValue(root, "rooted cycle")
        buildRefIndex(root)

        expect(metaOf(branch).cycleCuts.has("back")).to.be(true)
        expect(hasError(new Chain(root), ["branch"])).to.be(false)

        expect(metaOf(root).cycleCuts).to.be(undefined)
        expect(metaOf(branch).importBoundary).not.to.be(undefined)
        verifyRefCounts(root, branch)
    })

    it("keeps an indexed cycle cut when a branch is extracted", () => {
        const root = {}
        const branch = { back: root }
        root.branch = branch
        importValue(root, "rerooted branch")
        buildRefIndex(root)

        const extracted = readPath(new Chain(root), ["branch"])
        const chain = new Chain({})
        assignPath(chain, ["branch"], extracted)

        expect(hasError(chain, ["branch"])).to.be(false)
        expect(metaOf(branch).importBoundary).not.to.be(undefined)
        expect(metaOf(branch).cycleCuts.has("back")).to.be(true)
        expect(metaOf(root).cycleCuts).to.be(undefined)
        verifyRefCounts(root, branch)
    })

    it("cuts deterministic DFS back edges", () => {
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
        buildRefIndex(x)
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
        buildRefIndex(first)

        const extracted = readPath(new Chain(first), ["next"])

        expect(extracted).to.be(second)
        expect(lookupPath(
            new Chain(extracted),
            ["next", "next", "name"],
            false,
        )).to.be("second")
        expect(getErrors(new Chain(extracted), [])).to.eql([])
        expect(metaOf(second).cycleCuts.has("next")).to.be(true)
    })

    it("cuts the DFS back edge when indexing imported data", () => {
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

    it("keeps detached settlement and attached ownership separate", async () => {
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

        buildRefIndex(destination)
        expectCounts(destination, 0, 0, 1)
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

        buildRefIndex(destination)
        expectCounts(destination, 0, 0, 1)
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

        buildRefIndex(destination)
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

    it("preserves a pinned COW root across ancestor replacement", async () => {
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

    it("pins COW roots reached through promised ancestors", async () => {
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

        buildRefIndex(cyclic)
        expect(metaOf(cyclic).cycleCuts.has("self")).to.be(true)
        expect(getErrors(new Chain(incoming), [])).to.eql([])
    })

    it("stores cycle cuts for frozen imports", () => {
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

    it("reuses an existing imported identity without another resolver", async () => {
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

        expect(readPath(new Chain(child), ["pending", "done"])).to.be(true)
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

    it("preserves Promise properties on sealed and frozen imports", async () => {
        const sealedPending = Promise.resolve(1)
        const frozenPending = Promise.resolve(2)
        const error = new Error("bad")
        const sealed = Object.seal({ pending: sealedPending })
        const frozen = Object.freeze({ pending: frozenPending })
        const nonExtensibleError = Object.preventExtensions({ error })

        expect(importValue(sealed, "sealed promise")).to.be(sealed)
        expect(importValue(frozen, "frozen promise")).to.be(frozen)
        expect(importValue(nonExtensibleError, "frozen error")).to.be(
            nonExtensibleError,
        )
        expect(buildRefIndex(sealed)).to.be(sealed)
        expect(buildRefIndex(frozen)).to.be(frozen)
        expect(buildRefIndex(nonExtensibleError)).to.be(nonExtensibleError)
        expectCounts(sealed, 1, 0)
        expectCounts(frozen, 1, 0)
        expectCounts(nonExtensibleError, 0, 1)

        await flushMicrotasks()

        expect(sealed.pending).to.be(sealedPending)
        expect(frozen.pending).to.be(frozenPending)
        expect(readPath(new Chain(sealed), ["pending"])).to.be(1)
        expect(readPath(new Chain(frozen), ["pending"])).to.be(2)
        expect(getErrors(new Chain(nonExtensibleError), [])[0]).to.be(error)
        expectCounts(sealed, 0, 0)
        expectCounts(frozen, 0, 0)
        verifyRefCounts(sealed, frozen, nonExtensibleError)
    })

    it("ignores imported accessor properties", () => {
        const pending = deferred()
        const external = {}
        let reads = 0
        Object.defineProperty(external, "pending", {
            get() {
                reads++
                return pending.promise
            },
            enumerable: true,
        })
        expect(importValue(external, "accessor promise")).to.be(external)
        expect(readPath(new Chain(external), ["pending"])).to.be(undefined)
        expect(reads).to.be(0)
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
        expect(array[0]).to.be(first.promise)
        expect(nested.pending).to.be(second.promise)
        expect(readPath(new Chain(array), ["0"])).to.eql({ x: 1 })
        expect(readPath(new Chain(nested), ["pending"])).to.be(2)
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
        expect(root.pending).to.be(pending.promise)
        expect(readPath(new Chain(root), ["pending"])).to.be(error)
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
            expect(readPath(new Chain(value), ["__proto__", "unsafe"])).to.be(true)
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
        expect(first.pending).to.be(firstPromise)
        expect(readPath(new Chain(first), ["pending"])).to.be(1)
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
        expect(readPath(new Chain(root), ["__proto__", "safe"])).to.be(true)
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
        expect(readPath(new Chain(resolved), ["__proto__"])).to.be("hidden")
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
            hidden,
        )
        expect(Object.getOwnPropertyDescriptor(copy, "__proto__").value).to.be(
            "hidden",
        )
        expect(readPath(new Chain(copy), ["__proto__"])).to.be("hidden")
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
        expect(readPath(new Chain(root), ["child", "__proto__", "unsafe"])).to.be(true)
        verifyRefCounts(root, child)
    })

    it("marks extracted imported values even when ownership is ceded", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        importValue(root, "extract import")
        const extracted = readPath(new Chain(root), ["branch"])
        const chain = new Chain(extracted)
        assignPath(chain, ["x"], 2)
        const next = chain._state.value

        expect(extracted).to.be(branch)
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
        const importBoundary = metaOf(branch).importBoundary
        expect(metaOf(leaf).importBoundary).to.be(importBoundary)
        expect(metaOf(rootSibling).importBoundary).to.be(importBoundary)
        expect(metaOf(branchSibling).importBoundary).to.be(importBoundary)
        expect(metaOf(leafSibling).importBoundary).to.be(importBoundary)
    })

    it("keeps Promise forks outside the import boundary during COW", async () => {
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

        expect(metaOf(next).importBoundary).to.be(undefined)

        pathValue.resolve({ kept: true })
        retainedValue.resolve({ sibling: true })
        await flushMicrotasks()

        expect(root.path).to.be(pathValue.promise)
        expect(root.retained).to.be(retainedValue.promise)
        expect(readPath(new Chain(root), ["path"])).to.eql({ kept: true })
        expect(readPath(new Chain(root), ["retained"])).to.eql({
            sibling: true,
        })
        expect(next.path).to.eql({ kept: true, added: 2 })
        expect(metaOf(next.path)?.importBoundary).to.be(undefined)
        expect(next.retained).to.eql({
            sibling: true,
        })
    })

    it("cuts a runtime-owned Promise result that reaches its copied path", async () => {
        const pending = deferred()
        const chain = new Chain({ pending: pending.promise, other: 1 })
        lookupPath(chain, [])
        assignPath(chain, ["other"], 2)
        const copy = chain._state.value

        pending.resolve(copy)
        await flushMicrotasks()

        expect(copy.pending).to.be(copy)
        buildRefIndex(copy)
        expect(hasCycleCut(copy, "pending")).to.be(true)
        const exported = exportValue(chain, [])
        expect(exported.pending).to.be(exported)
        verifyRefCounts(copy)
    })

    it("keeps repeated pending COW forks runtime-owned", async () => {
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
        lookupPath(chain, [])
        assignPath(chain, ["right"], 2)
        const second = chain._state.value

        pending.resolve(resolved)
        await flushMicrotasks()

        expect(second.pending).to.be(resolved)
        expect(readPath(chain, ["pending"])).to.be(resolved)
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

        // Force a later COW while the earlier path mutation is suspended. The
        // off-path fork must observe that the earlier mutation consumed the
        // imported attribution.
        lookupPath(chain, [])
        assignPath(chain, ["sibling"], 2)
        const copy = chain._state.value
        const observed = readPath(chain, ["pending"])

        pending.resolve({ original: true })
        const owned = await observed

        expect(metaOf(owned)?.importBoundary).to.be(undefined)
        expect(owned).to.eql({ original: true, first: 1 })
        expect(copy.pending).to.be(owned)
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

        expect(metaOf(resolved).importBoundary).not.to.be(undefined)

        lookupPath(chain, [])
        assignPath(chain, ["right"], 2)
        const second = chain._state.value

        expect(metaOf(second)?.mirrors?.pending).to.be(undefined)
        expect(second.pending).to.be(resolved)
        expect(metaOf(resolved).importBoundary.errorContext).to.be(
            "resolved Promise COW",
        )
    })

    it("keeps an off-path fork runtime-owned when it becomes the COW path", async () => {
        const pending = deferred()
        const root = { pending: pending.promise, sibling: 0 }

        importValue(root, "promoted Promise path")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)

        assignPath(chain, ["pending", "first"], 1)

        pending.resolve({ original: true })
        await flushMicrotasks()

        const owned = readPath(chain, ["pending"])
        expect(metaOf(owned)?.importBoundary).to.be(undefined)
        expect(owned).to.eql({ original: true, first: 1 })

        assignPath(chain, ["pending", "second"], 2)
        expect(readPath(chain, ["pending"])).to.be(owned)
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

        pending.resolve({ retained, value: 0 })
        await flushMicrotasks()

        assignPath(chain, ["pending", "value"], 1)
        const owned = readPath(chain, ["pending"])

        expect(metaOf(parentCopy).mirrors?.pending).to.be(undefined)
        expect(metaOf(owned)?.importBoundary).to.be(undefined)
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

        const oldValue = readPath(new Chain(root), ["value"])
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

    it("indexes sealed values exposed by imported Promise resolution", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, "sealed resolution")
        buildRefIndex(root)
        expectCounts(root, 1, 0)

        const nestedPending = Promise.resolve(1)
        const resolved = Object.seal({ pending: nestedPending })
        deferredValue.resolve(resolved)
        await flushMicrotasks()

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(resolved.pending).to.be(nestedPending)
        expect(await getErrors(new Chain(root), [])).to.eql([])
        expect(readPath(new Chain(root), ["nested", "value", "pending"])).to.be(1)
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("collects private non-extensible values from detached mirrors", async () => {
        const pending = deferred()
        const errorValue = Object.freeze({ bad: new Error("bad") })
        const root = { value: pending.promise }
        const chain = new Chain(root)

        importValue(errorValue, "detached resolution")
        buildRefIndex(root)
        const errors = getErrors(chain, ["value"])
        assignPath(chain, ["value"], "fixed")

        pending.resolve(errorValue)

        expect((await errors)[0]).to.be(errorValue.bad)
        expect(root.value).to.be("fixed")
        expectCounts(root, 0, 0)
        verifyRefCounts(root, errorValue)
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

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(readPath(new Chain(root), ["nested", "value"])).to.be(root)
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

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(readPath(new Chain(root), ["nested", "value"])).to.be(
            resolved,
        )
        expect(getErrors(new Chain(root), [])).to.eql([])
        expect(metaOf(resolved).cycleCuts).to.be(undefined)
        expect(hasCycleCut(root.nested, "value")).to.be(true)
        expect(metaOf(resolved).shared).to.be(true)
        expect(metaOf(resolved).importBoundary).not.to.be(undefined)
        expectCounts(root, 0, 0, 1)
        verifyRefCounts(root)
    })

    it("reuses an existing runtime mirror reached through import", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const child = { pending: pending.promise }
        const earlierRead = lookupPath(
            new Chain(child),
            ["pending"],
            false,
        )
        expect(registrations()).to.be(2)
        const root = { child }

        importValue(root, "runtime mirror back-edge")
        expect(registrations()).to.be(2)
        pending.resolve(root)
        expect(await earlierRead).to.be(root)
        await flushMicrotasks()

        expect(child.pending).to.be(root)
        buildRefIndex(root)
        expect(hasCycleCut(child, "pending")).to.be(true)
        expectCounts(root, 0, 0, 1)
        verifyRefCounts(root)
    })

    it("settles an indexed runtime mirror reached through import", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }
        const hiddenError = new Error("indexed sibling")
        buildRefIndex(child)
        const root = { child, hiddenError }

        importValue(root, "indexed runtime mirror back-edge")
        pending.resolve(root)
        await flushMicrotasks()

        expect(child.pending).to.be(root)
        expect(hasCycleCut(child, "pending")).to.be(true)
        expectCounts(root, 0, 1, 1)
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

        buildRefIndex(next)
        expect(hasCycleCut(next, "self")).to.be(true)
        expect(next.self).to.be(importedPromise)
        expect(readPath(chain, ["self"])).to.be(next)
        expect(hasError(chain, [])).to.be(false)
        expect(getErrors(chain, [])).to.eql([])
        verifyRefCounts(next)
    })

    it("cuts a retained Promise fork that resolves to its COW owner", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const root = {
            pending: pending.promise,
            sibling: 0,
        }

        importValue(root, "fork destination")
        const chain = new Chain(root)
        assignPath(chain, ["sibling"], 1)
        const copy = chain._state.value
        expect(registrations()).to.be(2)
        pending.resolve(copy)
        await flushMicrotasks()

        expect(registrations()).to.be(2)
        buildRefIndex(copy)
        expect(hasCycleCut(root, "pending")).to.be(false)
        expect(hasCycleCut(copy, "pending")).to.be(true)
        expect(root.pending).to.be(pending.promise)
        expect(copy.pending).to.be(copy)
        expect(readPath(new Chain(root), ["pending"])).to.be(copy)
        expect(readPath(new Chain(copy), ["pending"])).to.be(copy)
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
        expect(readPath(new Chain(copy), ["pending"])).to.be(copy)
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

        buildRefIndex(root)
        buildRefIndex(copy)
        expect(hasCycleCut(root, "pending")).to.be(true)
        expect(hasCycleCut(copy, "pending")).to.be(false)
        expect(root.pending).to.be(pending.promise)
        expect(copy.pending).to.be(root)
        expect(readPath(new Chain(root), ["pending"])).to.be(root)
        expect(readPath(new Chain(copy), ["pending"])).to.be(root)
        verifyRefCounts(root, copy)
    })

    it("indexes a nested fork cycle after copy-on-write", async () => {
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

        buildRefIndex(copy)
        expect(hasCycleCut(copy.branch, "pending")).to.be(true)
        expect(copy.branch.pending).to.be(copy)
        expect(readPath(new Chain(copy), ["branch", "pending"])).to.be(
            copy,
        )
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
        expect(readPath(new Chain(copy), ["pending"])).to.be(copy.branch)
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

    it("defers non-indexed Promise back-edge cuts until counting", async () => {
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, "floating back-edge")
        lookupPath(new Chain(root), ["nested", "value"])
        deferredValue.resolve(root.nested)
        await flushMicrotasks()

        expect(hasCycleCut(root.nested, "value")).to.be(false)
        expect(getRefCounter(root)).to.be(undefined)
        const indexed = buildRefIndex(root)

        expect(hasCycleCut(root.nested, "value")).to.be(true)
        expect(root.nested.value).to.be(deferredValue.promise)
        expect(readPath(new Chain(root), ["nested", "value"])).to.be(root.nested)
        expect(indexed).to.be(root)
        expect(hasError(new Chain(root), [])).to.be(false)
    })

    it("leaves cyclic imported Promise roots unindexed until counting", async () => {
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, "promise root")
        const cyclic = {}
        cyclic.self = cyclic

        deferredValue.resolve(cyclic)
        const value = await imported
        expect(metaOf(value).cycleCuts).to.be(undefined)
        expect(getRefCounter(value)).to.be(undefined)
        const indexed = buildRefIndex(value)

        expect(metaOf(value).cycleCuts.has("self")).to.be(true)
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
        expect(metaOf(sealed).importBoundary.errorContext).to.be("sealed promise root")
        expectCounts(sealed, 0, 0)

        await flushMicrotasks()

        expect(sealed.pending instanceof Promise).to.be(true)
        expect(readPath(new Chain(sealed), ["pending"])).to.be(1)
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

    it("publishes reflection failure when an imported Promise resolves", async () => {
        const pending = deferred()
        const root = importValue(
            { value: pending.promise },
            "resolved reflection",
        )
        const chain = new Chain(root)
        const read = lookupPath(chain, ["value"])
        const failure = new Error("resolved ownKeys failed")

        pending.resolve(new Proxy({}, {
            ownKeys() {
                throw failure
            },
        }))

        expect(await read).to.be(failure)
        expect(lookupPath(chain, ["value"])).to.be(failure)
        expect(root.value).to.be(pending.promise)
    })

    it("retries an imported identity after reflection fails", async () => {
        const pending = deferred()
        const failure = new Error("child ownKeys failed")
        let ownKeysCalls = 0
        const childTarget = { pending: pending.promise }
        const child = new Proxy(childTarget, {
            ownKeys(target) {
                ownKeysCalls++
                if (ownKeysCalls === 1) throw failure
                return Reflect.ownKeys(target)
            },
        })
        const root = { child }

        expect(importValue(root, "failed import")).to.be(failure)
        expect(importValue(root, "retried import")).to.be(root)
        expect(ownKeysCalls).to.be(2)

        pending.resolve(7)
        await flushMicrotasks()

        expect(childTarget.pending).to.be(pending.promise)
        expect(readPath(new Chain(root), ["child", "pending"])).to.be(7)
        verifyRefCounts(root)
    })

    it("turns an already-rejected imported promise into an Error", async () => {
        const value = await importValue(
            Promise.reject("already external boom"),
        )

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("already external boom")
    })
})
