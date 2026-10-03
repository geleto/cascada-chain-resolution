import {
    Chain,
    getErrors,
    managedStateClass,
    assignPath,
    deletePath,
    hasError,
    lookupPath,
    import as importValue,
    Execution,
} from "../src/index.js"
import { buildRefIndex, getRefCounter, hasCycleCut } from "../src/refcounts.js"
import { metaOf } from "../src/meta.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { errorCause, expect, readPath, deferred, flushMicrotasks, expectCounts, thrownBy } from "./support.js"
import { addParent } from "../src/parent-placements.js"

function keyScanProbe(target) {
    let count = 0
    return {
        value: new Proxy(target, {
            ownKeys(target) {
                count++
                return Reflect.ownKeys(target)
            },
        }),
        count: () => count,
        reset: () => {
            count = 0
        },
    }
}

function assignThroughCopiedRoot(testContext, value) {
    const chain = new Chain(importValue({ value: null }, testContext), testContext)
    assignPath(chain, ["value"], value, testContext)
    return chain
}

describe("graph presence summaries", () => {
    it("keeps non-ref-indexed writes on the normal mutation path", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { nested: {} }
        const cyclic = {}
        cyclic.self = cyclic

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["pending"], deferredValue.promise, testContext)
        assignPath(rootChain, ["nested", "error"], new Error("bad"), testContext)
        assignPath(rootChain, ["cycle"], cyclic, testContext)

        expect(root.pending).to.be(deferredValue.promise)
        expect(root.nested.error instanceof Error).to.be(true)
        expect(root.cycle).to.be(cyclic)
        expect(getRefCounter(root, testContext)).to.be(undefined)
        expect(getRefCounter(root.nested, testContext)).to.be(undefined)
        verifyRefCounts(testContext, root)
    })

    it("does not let ref indexing change path-local alias isolation", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cyclic = { value: 1 }
        cyclic.self = cyclic
        const aliased = { value: 1 }
        const diamond = { left: aliased, right: aliased }

        for (const [root, path] of [
            [cyclic, ["value"]],
            [diamond, ["left", "value"]],
        ]) {
            const chain = new Chain(root, testContext)

            expect(hasError(chain, [], testContext)).to.be(false)
            assignPath(chain, path, 2, testContext)

            expect(readPath(chain, path, testContext)).to.be(2)
            verifyRefCounts(testContext, root)
        }
        expect(cyclic.self).to.be(cyclic)
        expect(diamond.left).not.to.be(diamond.right)
        expect(diamond.right.value).to.be(1)
    })

    it("does not enumerate prepared children when attaching them", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const clean = keyScanProbe({ nested: { value: 1 } })
        const delayed = keyScanProbe({ value: pending.promise })
        new Chain(clean.value, testContext)
        buildRefIndex(clean.value, testContext)
        new Chain(delayed.value, testContext)
        buildRefIndex(delayed.value, testContext)
        clean.reset()
        delayed.reset()

        const cleanChain = assignThroughCopiedRoot(testContext, clean.value)
        const ownedCleanRoot = cleanChain._state.value
        assignPath(cleanChain, ["other"], true, testContext)

        const delayedChain = assignThroughCopiedRoot(testContext, delayed.value)
        const sharedDelayedRoot = delayedChain._state.value
        assignPath(delayedChain, ["other"], true, testContext)

        expect(clean.count()).to.be(0)
        expect(delayed.count()).to.be(0)
        expect(cleanChain._state.value).to.be(ownedCleanRoot)
        expect(delayedChain._state.value).to.be(sharedDelayedRoot)
    })

    it("does not search cycles for Promises when attaching a prepared child", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const rootTarget = {}
        const root = keyScanProbe(rootTarget)
        const child = keyScanProbe({
            back: root.value,
            alias: root.value,
        })
        rootTarget.child = child.value
        new Chain(root.value, testContext)
        buildRefIndex(root.value, testContext)
        root.reset()
        child.reset()

        const cleanChain = assignThroughCopiedRoot(testContext, child.value)
        const ownedCleanRoot = cleanChain._state.value
        assignPath(cleanChain, ["other"], true, testContext)

        expect(root.count()).to.be(0)
        expect(child.count()).to.be(0)
        expect(cleanChain._state.value).to.be(ownedCleanRoot)

        const pending = deferred()
        const pendingRootTarget = { pending: pending.promise }
        const pendingRoot = keyScanProbe(pendingRootTarget)
        const pendingChild = keyScanProbe({ back: pendingRoot.value })
        pendingRootTarget.child = pendingChild.value
        new Chain(pendingRoot.value, testContext)
        buildRefIndex(pendingRoot.value, testContext)
        pendingRoot.reset()
        pendingChild.reset()

        assignThroughCopiedRoot(testContext, pendingChild.value)

        expect(pendingRoot.count()).to.be(0)
        expect(pendingChild.count()).to.be(0)
    })

    for (const indexed of [false, true]) {
        it("links the captured assignment value without creating a cycle, indexed=" + indexed, () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const original = {}, chain = new Chain(original, testContext)
            if (indexed) buildRefIndex(original, testContext)
            assignPath(chain, ["self"], original, testContext)
            const successor = chain._state.value
            expect(successor).not.to.be(original)
            expect(successor.self).to.be(original)
            expect(original.self).to.be(undefined)
            buildRefIndex(successor, testContext)
            expect(hasCycleCut(successor, "self", testContext)).to.be(false)
            expectCounts(testContext, successor, 0, 0, 0)
            expectCounts(testContext, original, 0, 0, 0)
            verifyRefCounts(testContext, chain._state)
        })
    }

    it("indexes cycles exposed by discovered and assigned Promises", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const discovered = deferred()
        const discoveredRoot = { value: discovered.promise }
        const observed = lookupPath(
            new Chain(discoveredRoot, testContext),
            ["value"],
            testContext,
            false,
        )
        const assigned = deferred()
        const assignedRoot = {}
        assignPath(new Chain(assignedRoot, testContext), ["value"], assigned.promise, testContext)

        discovered.resolve(discoveredRoot)
        assigned.resolve(assignedRoot)
        expect(await observed).to.be(discoveredRoot)
        await flushMicrotasks()

        for (const root of [discoveredRoot, assignedRoot]) {
            expect(hasCycleCut(root, "value", testContext)).to.be(false)
            buildRefIndex(root, testContext)
            expect(hasCycleCut(root, "value", testContext)).to.be(true)
            expectCounts(testContext, root, 0, 0, 1)
            verifyRefCounts(testContext, root)
        }
    })

    it("cuts a cycle when an indexed Promise publishes its value", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { value: pending.promise }
        new Chain(root, testContext)
        buildRefIndex(root, testContext)

        pending.resolve(root)
        await flushMicrotasks()

        expect(root.value).to.be(root)
        expect(hasCycleCut(root, "value", testContext)).to.be(true)
        expectCounts(testContext, root, 0, 0, 1)
        expect(getRefCounter(root, testContext).parents.size).to.be(0)
        verifyRefCounts(testContext, root)
    })

    it("keeps history-dependent cycle projections valid", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const publishedError = new Error("published")
        const publishedRoot = { value: pending.promise }
        new Chain(publishedRoot, testContext)
        buildRefIndex(publishedRoot, testContext)
        const publishedValue = {
            nested: { bad: publishedError },
            back: publishedRoot,
        }

        pending.resolve(publishedValue)
        await flushMicrotasks()

        const indexedError = new Error("indexed")
        const indexedRoot = {}
        const indexedValue = {
            nested: { bad: indexedError },
            back: indexedRoot,
        }
        indexedRoot.value = indexedValue
        new Chain(indexedRoot, testContext)
        buildRefIndex(indexedRoot, testContext)

        expect(hasCycleCut(publishedRoot, "value", testContext)).to.be(true)
        expectCounts(testContext, publishedRoot, 0, 0, 1)
        expect(hasCycleCut(indexedValue, "back", testContext)).to.be(true)
        expectCounts(testContext, indexedRoot, 0, 1, 1)
        expect(errorCause(getErrors(new Chain(publishedRoot, testContext), [], testContext))).to.be(publishedError)
        expect(errorCause(getErrors(new Chain(indexedRoot, testContext), [], testContext))).to.be(indexedError)

        deletePath(new Chain(publishedRoot, testContext), ["value", "back"], testContext)

        expect(hasCycleCut(publishedRoot, "value", testContext)).to.be(true)
        expectCounts(testContext, publishedRoot, 0, 0, 1)
        expect(errorCause(getErrors(new Chain(publishedRoot, testContext), [], testContext))).to.be(publishedError)
        verifyRefCounts(testContext, publishedRoot, indexedRoot)
    })

    it("materializes indexed state before a restricted assignment", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { value: "original" }
        new Chain(root, testContext)
        buildRefIndex(root, testContext)
        Object.defineProperty(root, "value", {
            value: "original",
            enumerable: true,
            writable: false,
            configurable: true,
        })
        const replacement = importValue({ clean: true }, { ...testContext, errorContext: "blocked assignment" })

        const chain = new Chain(root, testContext)
        const result = assignPath(chain, ["value"], replacement, testContext)
        const next = chain._state.value

        expect(result).to.be(undefined)
        expect(next).not.to.be(root)
        expect(next.value).to.be(replacement)
        expect(root.value).to.be("original")
        expect(metaOf(root, testContext).placementVersions).to.be(undefined)
        expectCounts(testContext, root, 0, 0)
        expectCounts(testContext, next, 0, 0)
        verifyRefCounts(testContext, root, next)
    })

    it("materializes indexed state before a restricted deletion", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = { bad: new Error("bad") }
        const root = {}
        Object.defineProperty(root, "value", {
            value: child,
            enumerable: true,
            writable: true,
            configurable: false,
        })
        new Chain(root, testContext)
        buildRefIndex(root, testContext)

        const chain = new Chain(root, testContext)
        const result = deletePath(chain, ["value"], testContext)
        const next = chain._state.value

        expect(result).to.be(undefined)
        expect(next).not.to.be(root)
        expect(next).to.eql({})
        expect(root.value).to.be(child)
        expect(getRefCounter(child, testContext).parents.get(root)).to.be(1)
        expectCounts(testContext, root, 0, 1)
        expectCounts(testContext, next, 0, 0)
        verifyRefCounts(testContext, root, next, child)
    })

    it("counts path Errors installed by broken mutations", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const assigned = {}
        const deleted = {}
        const assignedChain = new Chain(assigned, testContext)
        const deletedChain = new Chain(deleted, testContext)
        buildRefIndex(assigned, testContext)
        buildRefIndex(deleted, testContext)

        assignPath(assignedChain, ["missing", "value"], 1, testContext)
        deletePath(deletedChain, ["missing", "value"], testContext)

        expect(assigned.missing instanceof Error).to.be(true)
        expect(deleted.missing instanceof Error).to.be(true)
        expectCounts(testContext, assigned, 0, 1)
        expectCounts(testContext, deleted, 0, 1)

        assignPath(assignedChain, ["missing"], {}, testContext)
        deletePath(deletedChain, ["missing"], testContext)

        expectCounts(testContext, assigned, 0, 0)
        expectCounts(testContext, deleted, 0, 0)
        verifyRefCounts(testContext, assigned, deleted)
    })

    it("uses one metadata record per ownership world", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { pending: deferredValue.promise, child: { x: 1 } }

        importValue(root, testContext)
        buildRefIndex(root, testContext)

        const rootSymbols = Object.getOwnPropertySymbols(root)
        const rootMeta = metaOf(root, testContext)

        expect(rootSymbols.length).to.be(0)
        expect(getRefCounter(root, testContext)).to.be(rootMeta)
        expect(rootMeta.promiseCount).to.be(1)

        const chain = new Chain(root, testContext)
        assignPath(chain, ["added"], true, testContext)
        const next = chain._state.value
        const nextMeta = metaOf(next, testContext)
        const nextSymbols = Object.getOwnPropertySymbols(next)

        expect(nextSymbols.length).to.be(0)
        expect(nextMeta).not.to.be(rootMeta)
        expect(getRefCounter(next, testContext)).to.be(nextMeta)
        verifyRefCounts(testContext, root, next)
    })

    it("does not inherit metadata through object prototypes", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        class Data {}
        managedStateClass(Data)
        const prototype = Data.prototype
        const child = new Data()
        child.pending = pending.promise
        const root = { prototype, child }

        new Chain(root, testContext)
        buildRefIndex(root, testContext)

        expectCounts(testContext, prototype, 0, 0)
        expectCounts(testContext, child, 1, 0)
        expectCounts(testContext, root, 1, 0)
        expect(metaOf(child, testContext)).not.to.be(metaOf(prototype, testContext))
        verifyRefCounts(testContext, root)
    })

    it("indexes non-extensible graphs", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const frozen = Object.freeze({ nested: { value: 1 } })
        const sharedChild = { value: 2 }
        const frozenDAG = Object.freeze({ left: sharedChild, right: sharedChild })

        new Chain(importValue(frozen, { ...testContext, errorContext: "frozen counter root" }), testContext)
        new Chain(importValue(frozenDAG, { ...testContext, errorContext: "frozen DAG counter root" }), testContext)
        expect(buildRefIndex(frozen, testContext)).to.be(frozen)
        expect(buildRefIndex(frozenDAG, testContext)).to.be(frozenDAG)
        expectCounts(testContext, frozen, 0, 0)
        expectCounts(testContext, frozen.nested, 0, 0)
        expectCounts(testContext, frozenDAG, 0, 0)
        expectCounts(testContext, sharedChild, 0, 0)
        expect(getRefCounter(sharedChild, testContext).parents.get(frozenDAG)).to.be(2)
        verifyRefCounts(testContext, frozen, frozenDAG)
    })

    it("indexes descendants beneath non-extensible ancestors", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }

        new Chain(child, testContext)
        expect(buildRefIndex(child, testContext)).to.be(child)

        const wrapper = Object.preventExtensions({ child })
        importValue(wrapper, { ...testContext, errorContext: "frozen indexed child" })
        const indexed = buildRefIndex(wrapper, testContext)

        expect(indexed).to.be(wrapper)
        expectCounts(testContext, wrapper, 1, 0)
        expect(getRefCounter(child, testContext).parents.get(wrapper)).to.be(1)
        verifyRefCounts(testContext, wrapper)
    })

    it("counts a DAG child reached through a non-extensible ancestor", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }
        const wrapper = Object.preventExtensions({ child })
        const root = { plain: child, frozen: wrapper }
        importValue(wrapper, { ...testContext, errorContext: "frozen DAG child" })

        new Chain(root, testContext)
        const indexed = buildRefIndex(root, testContext)

        expect(indexed).to.be(root)
        expectCounts(testContext, root, 2, 0)
        expectCounts(testContext, wrapper, 1, 0)
        expect(getRefCounter(child, testContext).parents.get(root)).to.be(1)
        expect(getRefCounter(child, testContext).parents.get(wrapper)).to.be(1)
        verifyRefCounts(testContext, root)
    })

    it("indexes enumerable __proto__ data with neighboring promises", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const earlier = { pending: pending.promise }
        const protoValue = { safe: true }
        const root = { earlier }
        Object.defineProperty(root, "__proto__", {
            value: protoValue,
            enumerable: true,
            writable: true,
            configurable: true,
        })

        importValue(root, { ...testContext, errorContext: "transactional index" })
        const indexed = buildRefIndex(root, testContext)

        expect(indexed).to.be(root)
        expectCounts(testContext, root, 1, 0)
        expectCounts(testContext, earlier, 1, 0)
        expectCounts(testContext, protoValue, 0, 0)
        const rootChain = new Chain(root, testContext)
        expect(readPath(rootChain, ["__proto__", "safe"], testContext)).to.be(true)
        verifyRefCounts(testContext, root, earlier, protoValue)

        pending.resolve("done")
        await flushMicrotasks()

        expect(earlier.pending).to.be(pending.promise)
        expect(readPath(rootChain, ["earlier", "pending"], testContext)).to.be("done")
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root, earlier, protoValue)
    })

    it("indexes a cyclic imported branch without replacing its data", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cycle = {}
        const imported = { child: cycle, keep: true }
        const root = {}
        cycle.next = { back: cycle }

        importValue(imported, { ...testContext, errorContext: "nested cycle" })
        const rootChain = new Chain(root, testContext)
        buildRefIndex(root, testContext)
        assignPath(rootChain, ["branch"], imported, testContext)

        expect(root.branch).to.be(imported)
        expect(imported.child).to.be(cycle)
        expect(cycle.next.back).to.be(cycle)
        expectCounts(testContext, root, 0, 0, 1)
        expect(getRefCounter(imported, testContext).errorCount).to.be(0)
        expect(getRefCounter(imported, testContext).cycleCutCount).to.be(1)
        verifyRefCounts(testContext, root)
    })

    it("indexes only the reached branch inside an imported boundary", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const reached = { bad: new Error("bad") }
        const sibling = { clean: true }
        const root = importValue({ reached, sibling }, { ...testContext, errorContext: "branch-local index" })

        expect(hasError(new Chain(root, testContext), ["reached"], testContext)).to.be(true)

        expectCounts(testContext, reached, 0, 1)
        expect(getRefCounter(root, testContext)).to.be(undefined)
        expect(getRefCounter(sibling, testContext)).to.be(undefined)
        verifyRefCounts(testContext, reached)
    })

    it("indexes cut targets as independent counter components", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const first = { pending: pending.promise }
        const second = { back: first }
        first.next = second
        importValue(first, { ...testContext, errorContext: "complete cut indexing" })

        buildRefIndex(second, testContext)

        expectCounts(testContext, second, 1, 0, 1)
        expectCounts(testContext, first, 1, 0, 1)
        expect(getRefCounter(first, testContext).parents.get(second)).to.be(1)
        expect(getRefCounter(second, testContext).parents.size).to.be(0)
        verifyRefCounts(testContext, first, second)
    })

    it("indexes cut targets that expose further cut targets", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = {}
        const second = {}
        const third = {}
        third.second = second
        second.first = first
        second.toThird = third
        first.toSecond = second
        importValue(third, { ...testContext, errorContext: "two-hop cut indexing" })

        buildRefIndex(first, testContext)

        expectCounts(testContext, first, 0, 0, 1)
        expectCounts(testContext, second, 0, 0, 2)
        expectCounts(testContext, third, 0, 0, 1)
        expect(getRefCounter(first, testContext).parents.size).to.be(0)
        expect(getRefCounter(second, testContext).parents.get(first)).to.be(1)
        expect(getRefCounter(third, testContext).parents.get(second)).to.be(1)
        verifyRefCounts(testContext, first, second, third)
    })

    it("indexes a Promise cut target before later observers", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const destination = importValue(
            { slot: pending.promise },
            { ...testContext, errorContext: "Promise cut destination" },
        )
        const target = importValue(
            { back: destination },
            { ...testContext, errorContext: "Promise cut target" },
        )
        const retained = new Chain(destination, testContext)
        buildRefIndex(destination, testContext)

        expect(getRefCounter(target, testContext)).to.be(undefined)
        pending.resolve(target)
        await flushMicrotasks()

        expect(hasCycleCut(destination, "slot", testContext)).to.be(true)
        expectCounts(testContext, destination, 0, 0, 1)
        expectCounts(testContext, target, 0, 0, 1)
        expect(getErrors(new Chain(destination, testContext), [], testContext)).to.be(null)
        verifyRefCounts(testContext, destination, target)
    })

    it("propagates cycle-cut multiplicity through aliases", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cyclic = {}
        cyclic.self = cyclic
        const root = { left: cyclic, right: cyclic }
        importValue(root, { ...testContext, errorContext: "aliased cycle" })

        buildRefIndex(root, testContext)

        expectCounts(testContext, cyclic, 0, 0, 1)
        expectCounts(testContext, root, 0, 0, 2)
        expect(getRefCounter(cyclic, testContext).parents.get(root)).to.be(2)
        expect(hasError(new Chain(root, testContext), [], testContext)).to.be(false)
        verifyRefCounts(testContext, root)
    })

    it("cuts an imported child back-reference during indexing", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const wrapper = { pending: pending.promise }
        const child = { back: wrapper }
        wrapper.child = child
        new Chain(importValue(wrapper, { ...testContext, errorContext: "nested imported back-reference" }), testContext)

        buildRefIndex(wrapper, testContext)

        expect(metaOf(child, testContext).cycleCuts.has("back")).to.be(true)
        expect(metaOf(wrapper, testContext).cycleCuts).to.be(undefined)
        expectCounts(testContext, wrapper, 1, 0, 1)
        verifyRefCounts(testContext, wrapper, child)

        pending.resolve("done")
        await flushMicrotasks()

        expectCounts(testContext, wrapper, 0, 0, 1)
        verifyRefCounts(testContext, wrapper, child)
    })

    it("propagates a cut-to-Promise transition through indexed ancestors", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cyclic = {}
        cyclic.self = cyclic
        const imported = { branch: cyclic }
        importValue(imported, { ...testContext, errorContext: "cut-to-Promise transition" })
        const retained = new Chain(imported, testContext)
        const chain = new Chain(imported, testContext)
        buildRefIndex(chain._state, testContext)

        expectCounts(testContext, cyclic, 0, 0, 1)
        expectCounts(testContext, imported, 0, 0, 1)
        expectCounts(testContext, chain._state, 0, 0, 1)

        const pending = deferred()
        assignPath(chain, ["branch", "self"], pending.promise, testContext)
        const next = chain._state.value

        expect(next).not.to.be(imported)
        expect(next.branch).not.to.be(cyclic)
        expectCounts(testContext, next.branch, 1, 0, 0)
        expectCounts(testContext, next, 1, 0, 0)
        expectCounts(testContext, chain._state, 1, 0, 0)
        expectCounts(testContext, imported, 0, 0, 1)
        verifyRefCounts(testContext, chain._state, imported)

        pending.resolve("settled")
        await flushMicrotasks()

        expectCounts(testContext, next.branch, 0, 0, 0)
        expectCounts(testContext, next, 0, 0, 0)
        expectCounts(testContext, chain._state, 0, 0, 0)
        expectCounts(testContext, imported, 0, 0, 1)
        verifyRefCounts(testContext, chain._state, imported)
    })

    it("verifies indexed islands reached through unindexed wrappers", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = { clean: true }
        const wrapper = { child }

        new Chain(wrapper, testContext)
        buildRefIndex(child, testContext)
        getRefCounter(child, testContext).errorCount = 1

        const failure = thrownBy(() => verifyRefCounts(testContext, wrapper))

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Counter totals are inconsistent")
    })

    it("detects invalid cycle cuts and cut counts", () => {
        let testContext = { execution: new Execution(), errorContext: "test operation" }
        const wrongCount = {}
        wrongCount.self = wrongCount
        importValue(wrongCount, { ...testContext, errorContext: "wrong cut count" })
        buildRefIndex(wrongCount, testContext)
        getRefCounter(wrongCount, testContext).cycleCutCount = 0
        expect(thrownBy(() => verifyRefCounts(testContext, wrongCount)).message).to.be(
            "Counter totals are inconsistent",
        )
        testContext = { execution: new Execution(), errorContext: "test operation" }

        const missing = {}
        missing.self = missing
        importValue(missing, { ...testContext, errorContext: "missing cut property" })
        buildRefIndex(missing, testContext)
        delete missing.self
        expect(thrownBy(() => verifyRefCounts(testContext, missing)).message).to.be(
            "Incoming parent placement does not hold its child",
        )
        testContext = { execution: new Execution(), errorContext: "test operation" }

        const primitive = {}
        primitive.self = primitive
        importValue(primitive, { ...testContext, errorContext: "primitive cut value" })
        buildRefIndex(primitive, testContext)
        primitive.self = 1
        expect(thrownBy(() => verifyRefCounts(testContext, primitive)).message).to.be(
            "Incoming parent placement does not hold its child",
        )
        testContext = { execution: new Execution(), errorContext: "test operation" }

        const nonStringKey = { 1: {} }
        new Chain(nonStringKey, testContext)
        buildRefIndex(nonStringKey, testContext)
        metaOf(nonStringKey, testContext).cycleCuts = new Set([1])
        expect(thrownBy(() => verifyRefCounts(testContext, nonStringKey)).message).to.be(
            "Cycle cut keys must be strings",
        )
        testContext = { execution: new Execution(), errorContext: "test operation" }

        const pending = deferred()
        const versioned = { pending: pending.promise }
        new Chain(versioned, testContext)
        buildRefIndex(versioned, testContext)
        metaOf(versioned, testContext).cycleCuts = new Set(["pending"])
        expect(thrownBy(() => verifyRefCounts(testContext, versioned)).message).to.be(
            "Pending Promise property also has a cycle cut",
        )

        testContext = { execution: new Execution(), errorContext: "test operation" }
        const overlaid = { pending: deferred().promise }
        new Chain(overlaid, testContext)
        buildRefIndex(overlaid, testContext)
        const unindexed = new Chain({}, testContext)._state.value
        metaOf(overlaid, testContext).placementVersions.pending.value = unindexed
        expect(thrownBy(() => verifyRefCounts(testContext, overlaid)).message).to.be(
            "Missing incoming parent placement",
        )
    })

    it("detects every parent-edge consistency failure", () => {
        let testContext = { execution: new Execution(), errorContext: "test operation" }
        const missingChildIndexRoot = {}
        new Chain(missingChildIndexRoot, testContext)
        buildRefIndex(missingChildIndexRoot, testContext)
        missingChildIndexRoot.child = new Chain({}, testContext)._state.value
        addParent(missingChildIndexRoot.child, missingChildIndexRoot, "child", testContext)
        expect(thrownBy(() => verifyRefCounts(testContext, missingChildIndexRoot)).message).to.be(
            "Ref-indexed parent contains non-ref-indexed child",
        )
        testContext = { execution: new Execution(), errorContext: "test operation" }

        const cutTarget = {}
        const cutMiddle = {}
        const cutOwner = { back: cutTarget }
        cutTarget.next = cutMiddle
        cutMiddle.next = cutOwner
        importValue(cutTarget, { ...testContext, errorContext: "missing cut target index" })
        buildRefIndex(cutOwner, testContext)
        delete metaOf(cutTarget, testContext).parents
        expect(thrownBy(() => verifyRefCounts(testContext, cutOwner)).message).to.be(
            "Counter parent projection omits a complete incoming placement",
        )
        testContext = { execution: new Execution(), errorContext: "test operation" }

        const missingReverseChild = {}
        const missingReverseRoot = { child: missingReverseChild }
        new Chain(missingReverseRoot, testContext)
        buildRefIndex(missingReverseRoot, testContext)
        getRefCounter(missingReverseChild, testContext).parents.delete(missingReverseRoot)
        expect(thrownBy(() => verifyRefCounts(testContext, missingReverseRoot)).message).to.be(
            "Counter parent projection omits a complete incoming placement",
        )
        testContext = { execution: new Execution(), errorContext: "test operation" }

        const primitiveParentChild = {}
        new Chain(primitiveParentChild, testContext)
        buildRefIndex(primitiveParentChild, testContext)
        getRefCounter(primitiveParentChild, testContext).parents.set(7, 1)
        expect(thrownBy(() => verifyRefCounts(testContext, primitiveParentChild)).message).to.be(
            "Counter parent projection omits a complete incoming placement",
        )
        testContext = { execution: new Execution(), errorContext: "test operation" }

        const unindexedParentChild = {}
        const unindexedParent = { child: unindexedParentChild }
        new Chain(unindexedParent, testContext)
        buildRefIndex(unindexedParentChild, testContext)
        getRefCounter(unindexedParentChild, testContext).parents.set(unindexedParent, 1)
        expect(thrownBy(() => verifyRefCounts(testContext, unindexedParentChild)).message).to.be(
            "Counter parent projection omits a complete incoming placement",
        )
        testContext = { execution: new Execution(), errorContext: "test operation" }

        const detachedChild = {}
        const detachedParent = { child: detachedChild }
        new Chain(detachedParent, testContext)
        buildRefIndex(detachedParent, testContext)
        delete detachedParent.child
        expect(thrownBy(() => verifyRefCounts(testContext, detachedChild)).message).to.be(
            "Incoming parent placement does not hold its child",
        )
    })

    it("reports a committed parent-graph cycle fatally", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const left = {}
        const right = {}
        new Chain(left, testContext)
        buildRefIndex(left, testContext)
        new Chain(right, testContext)
        buildRefIndex(right, testContext)

        left.right = right
        right.left = left
        getRefCounter(left, testContext).parents.set(right, 1)
        getRefCounter(right, testContext).parents.set(left, 1)
        getRefCounter(left, testContext).counterChildren = new Set([getRefCounter(right, testContext).parents])
        getRefCounter(right, testContext).counterChildren = new Set([getRefCounter(left, testContext).parents])
        addParent(left, right, "left", testContext)
        addParent(right, left, "right", testContext)

        const failure = thrownBy(() => verifyRefCounts(testContext, left))
        expect(failure.message).to.be("Ref-count parent graph contains a cycle")

        const publicationFailure = thrownBy(() => {
            assignPath(new Chain(left, testContext), ["error"], new Error("bad"), testContext)
        })
        expect(publicationFailure.message).to.be(
            "Ref-count parent graph contains a cycle",
        )
    })

    it("bookkeeps traversable branches after ref-indexing", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const nestedPromise = deferred()
        const root = {
            pending: deferredValue.promise,
            nested: { error: new Error("bad") },
        }

        const rootChain = new Chain(root, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 1)
        verifyRefCounts(testContext, root)

        assignPath(rootChain, ["nested", "pending"], nestedPromise.promise, testContext)
        expectCounts(testContext, root, 2, 1)
        verifyRefCounts(testContext, root)
    })

    it("lets hasError signal errors and return the clean wait tree", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const clean = { x: 1 }
        const currentError = { bad: new Error("bad") }
        const pendingClean = deferred()
        const pendingBad = deferred()
        const cleanRoot = { value: pendingClean.promise }
        const badRoot = { value: pendingBad.promise }

        expect(hasError(new Chain(clean, testContext), [], testContext)).to.be(false)
        expect(hasError(new Chain(currentError, testContext), [], testContext)).to.be(true)
        expect(getRefCounter(currentError, testContext).errorCount).to.be(1)

        const pendingCleanProbe = hasError(new Chain(cleanRoot, testContext), [], testContext)
        const pendingBadProbe = hasError(new Chain(badRoot, testContext), [], testContext)

        expect(typeof pendingCleanProbe.then).to.be("function")
        expect(typeof pendingBadProbe.then).to.be("function")

        expect(hasError(new Chain(clean, testContext), [], testContext)).to.be(false)

        pendingClean.resolve({ ok: true })
        pendingBad.reject("bad")

        expect(await pendingCleanProbe).to.be(false)
        expect(await pendingBadProbe).to.be(true)
        verifyRefCounts(testContext, cleanRoot, badRoot)
    })

    it("keeps counts exact through writes, deletes, and promise settlement", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = deferred()
        const second = deferred()
        const root = {
            pending: first.promise,
            error: new Error("old"),
            nested: {},
        }

        const rootChain = new Chain(root, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 1)
        verifyRefCounts(testContext, root)

        assignPath(rootChain, ["nested", "pending"], second.promise, testContext)
        expectCounts(testContext, root, 2, 1)
        verifyRefCounts(testContext, root)

        deletePath(rootChain, ["error"], testContext)
        expectCounts(testContext, root, 2, 0)
        verifyRefCounts(testContext, root)

        first.resolve({ failed: new Error("resolved") })
        await flushMicrotasks()
        expectCounts(testContext, root, 1, 1)
        verifyRefCounts(testContext, root)

        second.resolve(42)
        await flushMicrotasks()
        expectCounts(testContext, root, 0, 1)
        verifyRefCounts(testContext, root)
    })

    it("decrements counts when a pending promise is overwritten and ignores its later resolution", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = {}

        const rootChain = new Chain(root, testContext)
        buildRefIndex(root, testContext)
        assignPath(rootChain, ["value"], deferredValue.promise, testContext)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)

        assignPath(rootChain, ["value"], 7, testContext)
        expect(root.value).to.be(7)
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)

        deferredValue.resolve(new Error("late"))
        await flushMicrotasks()

        expect(root.value).to.be(7)
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("prepares detached version delivery without starting a query traversal", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        let reflections = 0
        const resolved = new Proxy({}, {
            ownKeys(target) {
                reflections++
                return Reflect.ownKeys(target)
            },
        })
        const root = { value: outer.promise }
        const chain = new Chain(root, testContext)

        buildRefIndex(root, testContext)
        const promiseVersion = metaOf(root, testContext).placementVersions.value
        assignPath(chain, ["value"], "fixed", testContext)

        outer.resolve(resolved)
        await flushMicrotasks()

        expect(root.value).to.be("fixed")
        expect(promiseVersion.value).to.be(resolved)
        expect(reflections).to.be(1)
        expect(metaOf(resolved, testContext).placementsInitialized).to.be(true)
        expect(getRefCounter(resolved, testContext)).to.be(undefined)
        verifyRefCounts(testContext, root)
    })

    it("keeps one count when the same promise is assigned again", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {}
        const chain = new Chain(root, testContext)

        buildRefIndex(root, testContext)
        assignPath(chain, ["value"], pending.promise, testContext)
        const firstRead = lookupPath(chain, ["value"], testContext)
        assignPath(chain, ["value"], pending.promise, testContext)
        assignPath(chain, ["value", "x"], 1, testContext)

        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)

        pending.resolve({})
        const firstValue = await firstRead
        await flushMicrotasks()

        expect(firstValue).to.eql({})
        expect(root.value).to.eql({ x: 1 })
        expect(root.value).not.to.be(firstValue)
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("keeps counting promises exposed by resolved promise values", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const root = { value: outer.promise }

        new Chain(root, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expectCounts(testContext, root, 1, 0)
        expectCounts(testContext, root.value, 1, 0)
        verifyRefCounts(testContext, root)

        inner.resolve("done")
        await flushMicrotasks()

        expect(root.value.inner).to.be("done")
        expectCounts(testContext, root, 0, 0)
        expectCounts(testContext, root.value, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("turns rejected promises into counted Error values", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        new Chain(root, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)

        deferredValue.reject("bad")
        await flushMicrotasks()

        expect(root.value instanceof Error).to.be(true)
        expectCounts(testContext, root, 0, 1)
        verifyRefCounts(testContext, root)
    })

    it("discovers already-settled promise keys during ref-indexing", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { value: Promise.resolve("done") }

        new Chain(root, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)

        await flushMicrotasks()

        expect(root.value).to.be("done")
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("connects an already-ref-indexed child when an ancestor is ref-indexed", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const child = { pending: deferredValue.promise }
        const root = { child }

        new Chain(child, testContext)
        buildRefIndex(child, testContext)
        expectCounts(testContext, child, 1, 0)

        new Chain(root, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)

        deferredValue.resolve("done")
        await flushMicrotasks()

        expectCounts(testContext, child, 0, 0)
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("bookkeeps continuations registered before ref-indexing when they commit after ref-indexing", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const branch = deferred()
        const nested = deferred()
        const root = { branch: branch.promise }

        assignPath(new Chain(root, testContext), ["branch", "nested"], nested.promise, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)

        branch.resolve({})
        await flushMicrotasks()

        expectCounts(testContext, root, 1, 0)
        expectCounts(testContext, root.branch, 1, 0)
        verifyRefCounts(testContext, root)

        nested.resolve("done")
        await flushMicrotasks()

        expect(root.branch.nested).to.be("done")
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("keeps Promise version advances aligned with cycle detection", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { pending: pending.promise }
        const chain = new Chain(root, testContext)
        const cyclic = {}
        cyclic.self = cyclic

        importValue(cyclic, { ...testContext, errorContext: "Promise version cycle replacement" })
        buildRefIndex(root, testContext)
        const observed = lookupPath(chain, ["pending"], testContext)

        pending.resolve(cyclic)
        const value = await observed

        expect(root.pending).to.be(cyclic)
        expect(value).to.be(root.pending)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(cyclic.self).to.be(cyclic)
        verifyRefCounts(testContext, root)
    })

    it("counts shared child references with parent-edge multiplicity", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const child = { pending: deferredValue.promise }
        const root = { left: child, right: child }

        new Chain(root, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, child, 1, 0)
        expectCounts(testContext, root, 2, 0)
        verifyRefCounts(testContext, root)

        deferredValue.resolve("done")
        await flushMicrotasks()

        expectCounts(testContext, child, 0, 0)
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("decrements one edge without detaching an aliased child", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = { left: child, right: child }
        const chain = new Chain(root, testContext)

        buildRefIndex(root, testContext)
        deletePath(chain, ["left"], testContext)

        expectCounts(testContext, child, 1, 0)
        expectCounts(testContext, root, 1, 0)
        expect(getRefCounter(child, testContext).parents.get(root)).to.be(1)
        verifyRefCounts(testContext, root, child)

        pending.resolve("done")
        await flushMicrotasks()

        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root, child)
    })

    it("detaches a shared child from only the replaced parent", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }
        const left = { child }
        const right = { child }
        const root = { left, right }
        const chain = new Chain(root, testContext)

        buildRefIndex(root, testContext)
        deletePath(chain, ["left", "child"], testContext)

        expectCounts(testContext, left, 0, 0)
        expectCounts(testContext, right, 1, 0)
        expectCounts(testContext, root, 1, 0)
        expect(getRefCounter(child, testContext).parents.has(left)).to.be(false)
        expect(getRefCounter(child, testContext).parents.get(right)).to.be(1)
        verifyRefCounts(testContext, root, child)

        pending.resolve("done")
        await flushMicrotasks()

        expectCounts(testContext, right, 0, 0)
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root, child)
    })

    it("swaps counted subtrees and isolates their later settlements", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const oldPending = deferred()
        const firstNewPending = deferred()
        const secondNewPending = deferred()
        const oldChild = { pending: oldPending.promise }
        const newChild = {
            first: firstNewPending.promise,
            second: secondNewPending.promise,
        }
        const root = { child: oldChild }
        const chain = new Chain(root, testContext)

        buildRefIndex(root, testContext)
        assignPath(chain, ["child"], newChild, testContext)

        expectCounts(testContext, root, 1, 0)
        expectCounts(testContext, newChild, 2, 0)
        expect(getRefCounter(oldChild, testContext)).to.be(undefined)
        expect(getRefCounter(newChild, testContext).parents.get(root)).to.be(1)
        verifyRefCounts(testContext, root, oldChild)

        oldPending.resolve(new Error("detached"))
        await flushMicrotasks()

        expect(getRefCounter(oldChild, testContext)).to.be(undefined)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root, oldChild)

        firstNewPending.resolve("done")
        await flushMicrotasks()
        expectCounts(testContext, root, 1, 0)

        secondNewPending.reject("bad")
        await flushMicrotasks()
        expectCounts(testContext, root, 0, 1)
        verifyRefCounts(testContext, root, oldChild)
    })

    it("recovers indexed counters when an Error is replaced", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        const chain = new Chain(root, testContext)

        buildRefIndex(root, testContext)
        assignPath(chain, ["value"], new Error("bad"), testContext)
        expectCounts(testContext, root, 0, 1)
        verifyRefCounts(testContext, root)

        assignPath(chain, ["value"], { clean: true }, testContext)
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("preserves parent-edge multiplicity across COW worlds", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const child = { pending: deferredValue.promise }
        const root = { left: child, right: child }

        new Chain(root, testContext)
        buildRefIndex(root, testContext)
        lookupPath(new Chain(root, testContext), [], testContext)
        const chain = new Chain(root, testContext)
        assignPath(chain, ["added"], true, testContext)
        const next = chain._state.value

        expectCounts(testContext, child, 1, 0)
        expectCounts(testContext, root, 2, 0)
        expectCounts(testContext, next, 2, 0)
        verifyRefCounts(testContext, root, next)

        deferredValue.resolve("done")
        await flushMicrotasks()

        expectCounts(testContext, child, 0, 0)
        expectCounts(testContext, root, 0, 0)
        expectCounts(testContext, next, 0, 0)
        verifyRefCounts(testContext, root, next)
    })

    it("decrements a deleted pending promise and ignores its later resolution", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        const rootChain = new Chain(root, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)

        deletePath(rootChain, ["value"], testContext)
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)

        deferredValue.resolve(new Error("late"))
        await flushMicrotasks()

        expect(root).to.eql({})
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("keeps COW of non-ref-indexed branches countable afterward", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { branch: { x: 1 } }

        lookupPath(new Chain(root, testContext), [], testContext)
        const chain = new Chain(root, testContext)
        assignPath(chain, ["added"], true, testContext)
        const next = chain._state.value
        assignPath(chain, ["branch", "pending"], deferredValue.promise, testContext)

        buildRefIndex(root, testContext)
        buildRefIndex(next, testContext)
        expectCounts(testContext, root, 0, 0)
        expectCounts(testContext, next, 1, 0)
        verifyRefCounts(testContext, root, next)
    })

    it("copies counters for COW worlds and lets them diverge", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = {
            branch: deferredBranch.promise,
            sibling: { error: new Error("old") },
        }

        new Chain(root, testContext)
        buildRefIndex(root, testContext)
        lookupPath(new Chain(root, testContext), [], testContext)
        const chain = new Chain(root, testContext)

        assignPath(chain, ["added"], true, testContext)
        const next = chain._state.value
        expectCounts(testContext, root, 1, 1)
        expectCounts(testContext, next, 1, 1)
        verifyRefCounts(testContext, root, next)

        assignPath(chain, ["sibling", "error"], "fixed", testContext)
        expectCounts(testContext, root, 1, 1)
        expectCounts(testContext, next, 1, 0)
        verifyRefCounts(testContext, root, next)

        deferredBranch.resolve({ ok: true })
        await flushMicrotasks()

        expectCounts(testContext, root, 0, 1)
        expectCounts(testContext, next, 0, 0)
        verifyRefCounts(testContext, root, next)
    })
})
