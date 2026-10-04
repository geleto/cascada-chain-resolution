import * as runtime from "../src/index.js"
import { requiresCopyOnWrite, metaOf } from "../src/meta.js"
import {
    Chain,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    lookupPath,
    export as exportValue,
    import as importValue,
    Execution,
} from "../src/index.js"
import { getRefCounter, buildRefIndex } from "../src/refcounts.js"
import { hasCycleCut } from "./support.js"
import { verifyRefCounts } from "./verify-refcounts.js"

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
    expect,
    errorCause,
    readPath,
    countPromiseRegistrations,
    deferred,
    flushMicrotasks,
    expectCounts,
} from "./support.js"

describe("import", () => {
    it("releases an imported ancestor while preserving its retained child and pending publication", () => {
        const child = spawnSync(process.execPath, ["--expose-gc", "--unhandled-rejections=strict",
            fileURLToPath(new URL("./fixtures/import-retention.js", import.meta.url))], {
            encoding: "utf8", timeout: 10000,
        })
        assert.equal(child.status, 0, child.error?.message ?? child.stderr)
    })

    it("protects imported managed roots", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { pos: { x: 1 }, delta: { x: 3 } }
        const oldPos = root.pos
        const oldDelta = root.delta

        const imported = importValue(root, testContext)
        const chain = new Chain(imported, testContext)
        assignPath(chain, ["pos", "x"], 2, testContext)
        const next = chain._state.value

        expect(imported).to.be(root)
        expect(next).not.to.be(root)
        expect(next.pos).not.to.be(oldPos)
        expect(next.delta).to.be(oldDelta)
        expect(root.pos.x).to.be(1)
        expect(next.pos.x).to.be(2)

        assignPath(chain, ["delta", "x"], 5, testContext)

        expect(next.delta).not.to.be(oldDelta)
        expect(oldDelta.x).to.be(3)
        expect(next.delta.x).to.be(5)
    })

    it("preserves imported descendants used as independent roots", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = { value: 1 }
        const sealed = Object.seal({ value: 1 })
        importValue({ child, sealed }, { ...testContext, errorContext: "independent descendants" })

        for (const source of [child, sealed]) {
            expect(metaOf(source, testContext).imported).to.be(true)
            const chain = new Chain(source, testContext)
            assignPath(chain, ["value"], 2, testContext)

            expect(chain._state.value).not.to.be(source)
            expect(chain._state.value.value).to.be(2)
            expect(source.value).to.be(1)
        }
    })

    it("stores imported graph metadata without modifying host objects", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = { child }
        const rootKeys = Reflect.ownKeys(root)
        const childKeys = Reflect.ownKeys(child)

        importValue(root, { ...testContext, errorContext: "external metadata" })
        buildRefIndex(root, testContext)

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
        expect(readPath(new Chain(child, testContext), ["pending"], testContext)).to.be(resolved)
    })

    it("does not re-import an already admitted root", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const root = { pending: pending.promise }
        const originalKeys = Reflect.ownKeys(root)
        const rootChain = new Chain(root, testContext)
        const earlierRead = readPath(rootChain, ["pending"], testContext)
        expect(registrations()).to.be(2)

        expect(Reflect.ownKeys(root)).to.eql(originalKeys)

        importValue(root, { ...testContext, errorContext: "already admitted root" })

        expect(Reflect.ownKeys(root)).to.eql(originalKeys)
        expect(metaOf(root, testContext).imported).to.be(undefined)
        expect(requiresCopyOnWrite(root, testContext)).to.be(true)
        expect(registrations()).to.be(2)

        const resolved = { done: true }
        pending.resolve(resolved)
        expect(await earlierRead).to.be(resolved)
        await flushMicrotasks()

        expect(root.pending).to.be(resolved)
        expect(readPath(rootChain, ["pending"], testContext)).to.be(resolved)
    })

    it("imports an already-advanced runtime property version", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { pending: pending.promise }
        readPath(new Chain(root, testContext), ["pending"], testContext)

        const resolved = { value: 1 }
        pending.resolve(resolved)
        await flushMicrotasks()
        expect(root.pending).to.be(resolved)

        importValue(root, { ...testContext, errorContext: "advanced runtime version" })
        buildRefIndex(root, testContext)
        verifyRefCounts(testContext, root)

        const chain = new Chain(root, testContext)
        assignPath(chain, ["pending", "value"], 2, testContext)
        expect(chain._state.value.pending.value).to.be(2)
        expect(root.pending).to.be(resolved)
        expect(resolved.value).to.be(1)
    })

    it("preserves imported Promises and writes runtime-owned results", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const externalPending = deferred()
        const runtimePending = deferred()
        const external = { pending: externalPending.promise }
        const runtimeOwned = { pending: runtimePending.promise }

        new Chain(runtimeOwned, testContext)
        buildRefIndex(runtimeOwned, testContext)
        importValue(external, { ...testContext, errorContext: "external holder" })

        externalPending.resolve("external")
        runtimePending.resolve("runtime")
        await flushMicrotasks()

        expect(external.pending).to.be(externalPending.promise)
        expect(runtimeOwned.pending).to.be("runtime")
        expect(readPath(new Chain(external, testContext), ["pending"], testContext)).to.be("external")
        const promiseVersion = metaOf(external, testContext).placementVersions.pending
        expect(metaOf(external, testContext).imported).to.be(true)
        expect(Object.hasOwn(promiseVersion, "importPolicy")).to.be(false)
    })

    it("publishes a nested then rejection without changing imported data", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("then failed")
        let reads = 0
        const value = Object.defineProperty({}, "then", {
            get() {
                reads++
                if (reads === 1) throw failure
                return undefined
            },
        })
        const external = { value }

        expect(importValue(external, { ...testContext, errorContext: "throwing then" })).to.be(external)
        const chain = new Chain(external, testContext)
        const first = readPath(chain, ["value"], testContext)

        expect(external.value).to.be(value)
        expect(errorCause(await first)).to.be(failure)
        expect(errorCause(readPath(chain, ["value"], testContext))).to.be(failure)
        expect(external.value).to.be(value)
        expect(reads).to.be(1)
        buildRefIndex(external, testContext)
        expectCounts(testContext, external, 0, 1)
        verifyRefCounts(testContext, external)
    })

    it("reuses prepared runtime identity inside a host root", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }
        lookupPath(new Chain(child, testContext), [], testContext)

        importValue({ child }, { ...testContext, errorContext: "admitted child" })
        expect(metaOf(child, testContext).imported).to.be(undefined)

        const resolved = { done: true }
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(child.pending).to.be(resolved)
        expect(metaOf(resolved, testContext)?.imported).to.be(undefined)
        expect(await readPath(new Chain(child, testContext), ["pending"], testContext)).to.be(resolved)
    })

    it("does not scan overlapping admitted identities", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        let scans = 0
        const nested = new Proxy({}, {
            ownKeys(target) {
                scans++
                return Reflect.ownKeys(target)
            },
        })
        const outer = { nested }
        lookupPath(new Chain(outer, testContext), [], testContext)
        lookupPath(new Chain(nested, testContext), [], testContext)
        scans = 0

        importValue({ outer, nested }, { ...testContext, errorContext: "overlapping islands" })
        expect(scans).to.be(0)

        importValue({ outer, nested }, { ...testContext, errorContext: "later frontier" })

        expect(scans).to.be(0)
        expect(metaOf(nested, testContext).placementVersions).to.be(undefined)
    })

    it("preserves prepared runtime ownership through a new imported alias in either property order", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        for (const admittedFirst of [true, false]) {
            const pending = deferred()
            const child = { pending: pending.promise }
            const runtimeOwned = { child }
            lookupPath(new Chain(runtimeOwned, testContext), [], testContext)
            const external = admittedFirst
                ? { runtimeOwned, direct: child }
                : { direct: child, runtimeOwned }
            const errorContext = admittedFirst
                ? "admitted alias first"
                : "direct alias first"

            importValue(external, { ...testContext, errorContext: errorContext })
            expect(metaOf(child, testContext).imported).to.be(undefined)

            const resolved = { done: true }
            pending.resolve(resolved)
            await flushMicrotasks()

            expect(child.pending).to.be(resolved)
            expect(readPath(new Chain(child, testContext), ["pending"], testContext)).to.be(
                resolved,
            )
        }
    })

    it("reuses one runtime Promise version across imported wrappers", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const child = { pending: pending.promise }
        const observed = readPath(new Chain(child, testContext), ["pending"], testContext)
        const first = importValue({ child }, { ...testContext, errorContext: "first wrapper" })
        const second = importValue({ child }, { ...testContext, errorContext: "second wrapper" })

        expect(registrations()).to.be(2)

        pending.resolve(second)
        expect(await observed).to.be(second)
        await flushMicrotasks()

        expect(registrations()).to.be(2)
        expect(child.pending).to.be(second)
        buildRefIndex(second, testContext)
        expect(hasCycleCut(child, "pending", testContext)).to.be(true)
        new Chain(first, testContext)
        buildRefIndex(first, testContext)
        verifyRefCounts(testContext, first, second, child)
    })

    it("preserves an imported undefined result", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const external = { pending: pending.promise }
        importValue(external, { ...testContext, errorContext: "undefined result" })

        pending.resolve(undefined)
        await flushMicrotasks()

        expect(external.pending).to.be(pending.promise)
        expect(readPath(new Chain(external, testContext), ["pending"], testContext)).to.be(undefined)
    })

    it("passes primitives through and wraps a root Error", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const error = new Error("language error")

        expect(importValue(null, { ...testContext, errorContext: "null import" })).to.be(null)
        expect(importValue(undefined, { ...testContext, errorContext: "undefined import" })).to.be(undefined)
        expect(importValue(7, { ...testContext, errorContext: "number import" })).to.be(7)
        expect(importValue("text", { ...testContext, errorContext: "string import" })).to.be("text")
        expect(errorCause(importValue(error, { ...testContext, errorContext: "error import" }))).to.be(error)
        expect(metaOf(error, testContext)).to.be(undefined)
    })

    it("marks resolved promise roots before returning them", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredRoot = deferred()
        const imported = importValue(deferredRoot.promise, testContext)

        deferredRoot.resolve({ branch: { x: 1 } })
        const root = await imported
        const oldBranch = root.branch
        const chain = new Chain(root, testContext)
        assignPath(chain, ["branch", "x"], 2, testContext)
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(next.branch).not.to.be(oldBranch)
        expect(oldBranch.x).to.be(1)
        expect(next.branch.x).to.be(2)
    })

    it("treats frozen resolved promise roots as shared for COW", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredRoot = deferred()
        const root = Object.freeze({ branch: { x: 1 } })
        const imported = importValue(deferredRoot.promise, testContext)

        deferredRoot.resolve(root)
        const value = await imported
        const chain = new Chain(value, testContext)
        assignPath(chain, ["branch", "x"], 2, testContext)
        const next = chain._state.value

        expect(value).to.be(root)
        expect(next).not.to.be(root)
        expect(root.branch.x).to.be(1)
        expect(next.branch.x).to.be(2)
    })

    it("treats frozen imported objects without promises as shared for COW", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = Object.freeze({ branch: { x: 1 } })
        const oldBranch = root.branch

        importValue(root, testContext)
        const chain = new Chain(root, testContext)
        assignPath(chain, ["branch", "x"], 2, testContext)
        const next = chain._state.value

        expect(next).not.to.be(root)
        expect(next.branch).not.to.be(oldBranch)
        expect(root.branch.x).to.be(1)
        expect(next.branch.x).to.be(2)
    })

    it("classifies imported descendants and discovers promises eagerly", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const leaf = { x: 1 }
        const child = { value: outer.promise }
        const root = { child }

        const imported = importValue(root, { ...testContext, errorContext: "recursive import" })
        expect(imported).to.be(root)
        expect(metaOf(root, testContext).imported).to.be(true)
        expect(Object.hasOwn(metaOf(root, testContext), "importPolicy")).to.be(false)
        expect(requiresCopyOnWrite(child, testContext)).to.be(true)
        expect(metaOf(child, testContext).imported).to.be(true)
        expect(metaOf(child, testContext).placementVersions.value).not.to.be(undefined)
        expect(child.value).to.be(outer.promise)

        buildRefIndex(root, testContext)
        expect(requiresCopyOnWrite(child, testContext)).to.be(true)
        expect(metaOf(child, testContext).imported).to.be(true)

        const resolved = { leaf, inner: inner.promise }
        outer.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved, testContext).imported).to.be(true)
        expect(requiresCopyOnWrite(leaf, testContext)).to.be(true)
        expect(metaOf(leaf, testContext).imported).to.be(true)

        const nested = { done: true }
        inner.resolve(nested)
        await flushMicrotasks()

        expect(metaOf(nested, testContext).imported).to.be(true)
        expect(child.value).to.be(outer.promise)
        expect(resolved.inner).to.be(inner.promise)
        expect(readPath(new Chain(root, testContext), ["child", "value"], testContext)).to.be(
            resolved,
        )
        expect(readPath(new Chain(resolved, testContext), ["inner"], testContext)).to.be(nested)
    })

    it("marks a repeated synchronous imported identity shared", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const shared = { pending: pending.promise }

        importValue({ left: shared, right: shared }, { ...testContext, errorContext: "synchronous alias" })

        expect(registrations()).to.be(1)
        expect(requiresCopyOnWrite(shared, testContext)).to.be(true)
    })

    it("reuses imported identities across import calls", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const shared = { value: 1 }

        importValue({ first: shared }, { ...testContext, errorContext: "first owner" })
        const meta = metaOf(shared, testContext)
        expect(meta.imported).to.be(true)

        importValue({ second: shared }, { ...testContext, errorContext: "second owner" })
        expect(metaOf(shared, testContext)).to.be(meta)
    })

    it("reuses one nested Promise version across asynchronous aliases", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = deferred()
        const second = deferred()
        const nested = deferred()
        const registrations = countPromiseRegistrations(nested.promise)
        const shared = { nested: nested.promise }
        const root = {
            first: first.promise,
            second: second.promise,
        }

        importValue(root, { ...testContext, errorContext: "async aliases" })
        buildRefIndex(root, testContext)
        first.resolve({ shared })
        second.resolve(shared)
        await flushMicrotasks()

        expect(registrations()).to.be(1)
        expect(requiresCopyOnWrite(shared, testContext)).to.be(true)
        expect(metaOf(shared, testContext).imported).to.be(true)

        const leaf = { done: true }
        nested.resolve(leaf)
        await flushMicrotasks()
        expect(metaOf(leaf, testContext).imported).to.be(true)
    })

    it("subscribes at each placement of one Promise identity", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const root = {
            left: pending.promise,
            right: pending.promise,
        }

        importValue(root, { ...testContext, errorContext: "repeated promise" })
        expect(registrations()).to.be(2)
        buildRefIndex(root, testContext)
        expect(registrations()).to.be(2)

        const resolved = { nested: {} }
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(requiresCopyOnWrite(resolved, testContext)).to.be(true)
        expect(requiresCopyOnWrite(resolved.nested, testContext)).to.be(true)
    })

    it("indexes a Promise result that closes a cycle through an alias", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const shared = { pending: pending.promise }
        const bridge = { back: shared }
        const root = { shared, bridge }

        importValue(root, { ...testContext, errorContext: "asynchronous bridge" })
        const rootChain = new Chain(root, testContext)
        buildRefIndex(root, testContext)

        pending.resolve(bridge)
        await flushMicrotasks()

        expect(hasError(rootChain, [], testContext)).to.be(false)
        expect(hasCycleCut(shared, "pending", testContext)).to.be(true)
        expect(metaOf(bridge, testContext).cycleCuts).to.be(undefined)
        expect(getErrors(rootChain, [], testContext)).to.be(null)
        verifyRefCounts(testContext, root, shared, bridge)
    })

    it("indexes a Promise result that closes a nested alias cycle", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const ancestor = { pending: pending.promise }
        const tail = { back: ancestor }
        const bridge = { tail }
        const root = { ancestor, bridge }

        importValue(root, { ...testContext, errorContext: "asynchronous subtree bridge" })
        const rootChain = new Chain(root, testContext)
        buildRefIndex(root, testContext)

        pending.resolve(bridge)
        await flushMicrotasks()

        expect(hasCycleCut(ancestor, "pending", testContext)).to.be(true)
        expect(metaOf(tail, testContext).cycleCuts).to.be(undefined)
        expect(getErrors(rootChain, [], testContext)).to.be(null)
        verifyRefCounts(testContext, root, ancestor, bridge, tail)
    })

    it("indexes cycles exposed by an imported Promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const ancestor = { pending: pending.promise }
        const root = { ancestor }
        importValue(root, { ...testContext, errorContext: "split cycle" })

        const internal = {}
        internal.self = internal
        const unique = { ok: true }
        const resolved = { internal, unique, back: ancestor }

        pending.resolve(resolved)
        await flushMicrotasks()
        new Chain(root, testContext)
        buildRefIndex(root, testContext)

        expect(metaOf(internal, testContext).cycleCuts.has("self")).to.be(true)
        expect(hasCycleCut(resolved, "back", testContext)).to.be(true)
        expect(requiresCopyOnWrite(unique, testContext)).to.be(true)
        expect(getErrors(new Chain(root, testContext), [], testContext)).to.be(null)
        verifyRefCounts(testContext, root)
    })

    it("defers imported cycle cuts until indexing", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        root.self = root

        const imported = importValue(root, { ...testContext, errorContext: "cycle import" })
        expect(metaOf(root, testContext).cycleCuts).to.be(undefined)
        expect(getRefCounter(root, testContext)).to.be(undefined)
        const indexed = buildRefIndex(root, testContext)

        expect(imported).to.be(root)
        expect(indexed).to.be(root)
        expect(getRefCounter(root, testContext).errorCount).to.be(0)
        expect(getRefCounter(root, testContext).frontierCount).to.be(1)
        expect(metaOf(root, testContext).cycleCuts.has("self")).to.be(true)
        expect(root.self).to.be(root)
    })

    it("indexes an imported cycle from its root", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        const branch = { back: root }
        root.branch = branch
        importValue(root, { ...testContext, errorContext: "rooted cycle" })
        buildRefIndex(root, testContext)

        expect(metaOf(branch, testContext).cycleCuts.has("back")).to.be(true)
        expect(hasError(new Chain(root, testContext), ["branch"], testContext)).to.be(false)

        expect(metaOf(root, testContext).cycleCuts).to.be(undefined)
        expect(metaOf(branch, testContext).imported).to.be(true)
        verifyRefCounts(testContext, root, branch)
    })

    it("keeps an indexed cycle cut when a branch is extracted", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        const branch = { back: root }
        root.branch = branch
        importValue(root, { ...testContext, errorContext: "rerooted branch" })
        buildRefIndex(root, testContext)

        const extracted = readPath(new Chain(root, testContext), ["branch"], testContext)
        const chain = new Chain({}, testContext)
        assignPath(chain, ["branch"], extracted, testContext)

        expect(hasError(chain, ["branch"], testContext)).to.be(false)
        expect(metaOf(branch, testContext).imported).to.be(true)
        expect(metaOf(branch, testContext).cycleCuts.has("back")).to.be(true)
        expect(metaOf(root, testContext).cycleCuts).to.be(undefined)
        verifyRefCounts(testContext, root, branch)
    })

    it("cuts deterministic DFS back edges", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const left = {}
        const right = {}
        left.right = right
        right.left = left
        right.self = right
        importValue(left, { ...testContext, errorContext: "interlocking cycles" })

        expect(hasError(new Chain(left, testContext), [], testContext)).to.be(false)
        expect(metaOf(left, testContext).cycleCuts).to.be(undefined)
        expect(metaOf(right, testContext).cycleCuts.has("left")).to.be(true)
        expect(metaOf(right, testContext).cycleCuts.has("self")).to.be(true)
        expect(getErrors(new Chain(right, testContext), [], testContext)).to.be(null)
        const wrapper = importValue({ branch: left }, { ...testContext, errorContext: "marked reuse" })
        buildRefIndex(wrapper, testContext)
        expect(metaOf(right, testContext).cycleCuts.has("left")).to.be(true)
        expectCounts(testContext, left, 1, 0)
        expectCounts(testContext, right, 2, 0)
        expectCounts(testContext, wrapper, 1, 0)
        verifyRefCounts(testContext, wrapper, left, right)
    })

    it("reuses cuts inside a cycle and cuts an alternate route", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const b = {}
        const c = {}
        const x = {}
        const d = {}
        b.c = c
        b.alternate = x
        c.x = x
        x.d = d
        d.b = b

        importValue(x, { ...testContext, errorContext: "covered cycle" })
        buildRefIndex(x, testContext)
        expect(metaOf(c, testContext).cycleCuts.has("x")).to.be(true)
        expect(metaOf(b, testContext).cycleCuts.has("alternate")).to.be(true)
        expect(metaOf(d, testContext).cycleCuts).to.be(undefined)

        importValue(b, { ...testContext, errorContext: "re-rooted covered cycle" })
        buildRefIndex(b, testContext)

        expect(metaOf(d, testContext).cycleCuts).to.be(undefined)
        expectCounts(testContext, b, 2, 0)
        expect(hasError(new Chain(b, testContext), [], testContext)).to.be(false)
        expect(getErrors(new Chain(b, testContext), [], testContext)).to.be(null)
        verifyRefCounts(testContext, b, x)
    })

    it("keeps observations and counts coherent from different imported roots", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const leftPending = deferred()
        const rightPending = deferred()
        const leftError = new Error("left")
        const rightError = new Error("right")
        const left = { error: leftError, pending: leftPending.promise }
        const right = { error: rightError, pending: rightPending.promise }
        left.right = right
        right.left = left

        importValue(left, { ...testContext, errorContext: "left cycle root" })
        importValue(right, { ...testContext, errorContext: "right cycle root" })
        buildRefIndex(left, testContext)
        buildRefIndex(right, testContext)

        verifyRefCounts(testContext, left, right)
        expect(hasError(new Chain(left, testContext), [], testContext)).to.be(true)
        expect(hasError(new Chain(right, testContext), [], testContext)).to.be(true)

        const leftResult = getErrors(new Chain(left, testContext), [], testContext)
        const rightResult = getErrors(new Chain(right, testContext), [], testContext)
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
            expect(errors.errors.length).to.be(expectedErrors.length)
            for (const error of expectedErrors) {
                expect(errors.errors.some(value => errorCause(value) === error))
                    .to.be(true)
            }
        }
        verifyRefCounts(testContext, left, right)
    })

    it("keeps a cycle cut when lookup re-roots a node inside the cycle", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = { name: "first" }
        const second = { name: "second" }
        first.next = second
        second.next = first
        importValue(first, { ...testContext, errorContext: "cycle lookup" })
        buildRefIndex(first, testContext)

        const extracted = readPath(new Chain(first, testContext), ["next"], testContext)

        expect(extracted).to.be(second)
        expect(lookupPath(
            new Chain(extracted, testContext),
            ["next", "next", "name"],
            testContext,
            false,
        )).to.be("second")
        expect(getErrors(new Chain(extracted, testContext), [], testContext)).to.be(null)
        expect(metaOf(second, testContext).cycleCuts.has("next")).to.be(true)
    })

    it("cuts the DFS back edge when indexing imported data", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const batchParent = {}
        const batchChild = { back: batchParent }
        batchParent.child = batchChild
        importValue(batchParent, { ...testContext, errorContext: "batch cycle" })
        buildRefIndex(batchParent, testContext)

        expect(metaOf(batchParent, testContext).cycleCuts).to.be(undefined)
        expect(metaOf(batchChild, testContext).cycleCuts.has("back")).to.be(true)
    })

    it("COWs before attaching imported data that references an escaped owner", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const owner = {}
        const chain = new Chain(owner, testContext)
        const escaped = lookupPath(chain, [], testContext)
        const child = importValue({ back: escaped }, { ...testContext, errorContext: "returned owner" })

        assignPath(chain, ["child"], child, testContext)
        const next = chain._state.value

        expect(next).not.to.be(owner)
        expect(next.child).to.be(child)
        expect(child.back).to.be(owner)
        expect(hasError(chain, [], testContext)).to.be(false)
        verifyRefCounts(testContext, next, child, owner)
    })

    it("keeps detached settlement and attached ownership separate", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const nested = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const nestedRegistrations = countPromiseRegistrations(nested.promise)
        const child = importValue({ pending: pending.promise }, { ...testContext, errorContext: "attached child" })
        const chain = new Chain(importValue({}, { ...testContext, errorContext: "attachment destination" }), testContext)

        expect(registrations()).to.be(1)

        assignPath(chain, ["child"], child, testContext)
        expect(registrations()).to.be(1)

        const resolved = { nested: nested.promise }
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(requiresCopyOnWrite(resolved, testContext)).to.be(true)
        expect(nestedRegistrations()).to.be(1)

        nested.resolve({ clean: true })
        await flushMicrotasks()

        expect(hasError(chain, [], testContext)).to.be(false)
        verifyRefCounts(testContext, chain._state.value)
    })

    it("cuts a nested imported Promise after its wrapper is attached", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const imported = importValue(
            { pending: pending.promise },
            { ...testContext, errorContext: "nested imported attachment" },
        )
        const wrapper = { imported }
        const extracted = lookupPath(new Chain(wrapper, testContext), [], testContext)
        const chain = new Chain(importValue(
            { slot: null },
            { ...testContext, errorContext: "wrapper destination" },
        ), testContext)

        expect(registrations()).to.be(1)
        assignPath(chain, ["slot"], extracted, testContext)
        const destination = chain._state.value
        expect(registrations()).to.be(1)

        pending.resolve(destination)
        await flushMicrotasks()

        buildRefIndex(destination, testContext)
        expectCounts(testContext, destination, 1, 0)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(getErrors(chain, [], testContext)).to.be(null)

        const exported = exportValue(chain, [], testContext)
        expect(exported.slot.imported.pending).to.be(exported)
        verifyRefCounts(testContext, destination, wrapper, imported)
    })

    it("cuts an imported Promise root inside an attached wrapper", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const imported = importValue(
            pending.promise,
            { ...testContext, errorContext: "nested imported Promise root" },
        )
        const wrapper = { imported }
        const extracted = lookupPath(new Chain(wrapper, testContext), [], testContext)
        const chain = new Chain(importValue(
            { slot: null },
            { ...testContext, errorContext: "Promise-root wrapper destination" },
        ), testContext)

        expect(registrations()).to.be(1)
        assignPath(chain, ["slot"], extracted, testContext)
        const destination = chain._state.value
        expect(registrations()).to.be(1)

        pending.resolve(destination)
        await imported
        await flushMicrotasks()

        buildRefIndex(destination, testContext)
        await flushMicrotasks()
        expectCounts(testContext, destination, 1, 0)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(getErrors(chain, [], testContext)).to.be(null)

        const exported = exportValue(chain, [], testContext)
        expect(exported.slot.imported).to.be(exported)
        verifyRefCounts(testContext, destination, wrapper)
    })

    it("pins an asynchronous attachment for issue-time queries", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            { ...testContext, errorContext: "captured attachment" },
        )
        const chain = new Chain(importValue({ value: null }, { ...testContext, errorContext: "destination" }), testContext)

        assignPath(chain, ["value"], incoming, testContext)
        const destination = chain._state.value
        const retained = new Chain(destination, testContext)
        const hasErrorResult = hasError(chain, [], testContext)
        const getErrorsResult = getErrors(chain, [], testContext)
        assignPath(chain, ["value"], null, testContext)

        expect(chain._state.value).not.to.be(destination)
        expect(chain._state.value.value).to.be(null)
        expect(destination.value).to.be(incoming)

        pending.resolve(destination)

        expect(await hasErrorResult).to.be(false)
        expect(await getErrorsResult).to.be(null)
        expect(hasCycleCut(incoming, "pending", testContext)).to.be(true)
        expect(metaOf(destination, testContext).cycleCuts).to.be(undefined)
        expect(hasError(chain, [], testContext)).to.be(false)
        verifyRefCounts(testContext, destination, incoming)
    })

    it("cuts an attached Promise cycle only at its Promise placement", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            { ...testContext, errorContext: "attached Promise cycle" },
        )
        const chain = new Chain(importValue(
            { value: null },
            { ...testContext, errorContext: "attachment destination" },
        ), testContext)

        assignPath(chain, ["value"], incoming, testContext)
        const destination = chain._state.value
        pending.resolve(destination)
        await flushMicrotasks()

        buildRefIndex(destination, testContext)
        expect(hasCycleCut(incoming, "pending", testContext)).to.be(true)
        expect(metaOf(destination, testContext).cycleCuts).to.be(undefined)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(getErrors(chain, [], testContext)).to.be(null)
        verifyRefCounts(testContext, destination, incoming)

        assignPath(chain, ["value"], null, testContext)
        expect(chain._state.value).not.to.be(destination)
        expect(hasError(chain, [], testContext)).to.be(false)
        verifyRefCounts(testContext, chain._state.value, destination, incoming)
    })

    it("preserves a pinned COW root across ancestor replacement", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            { ...testContext, errorContext: "captured ancestor path" },
        )
        const chain = new Chain(importValue(
            { slot: {} },
            { ...testContext, errorContext: "attachment destination" },
        ), testContext)

        assignPath(chain, ["slot", "incoming"], incoming, testContext)
        const destination = chain._state.value
        const retained = new Chain(destination, testContext)
        const attachedSlot = destination.slot
        const result = hasError(chain, [], testContext)
        assignPath(chain, ["slot"], {}, testContext)

        expect(chain._state.value).not.to.be(destination)
        expect(destination.slot).to.be(attachedSlot)
        expect(attachedSlot.incoming).to.be(incoming)

        pending.resolve(destination)

        expect(await result).to.be(false)
        expect(hasError(chain, [], testContext)).to.be(false)
    })

    it("pins COW roots reached through promised ancestors", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const ancestor = deferred()
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            { ...testContext, errorContext: "promised attachment path" },
        )
        const chain = new Chain(importValue(
            { slot: ancestor.promise },
            { ...testContext, errorContext: "attachment destination" },
        ), testContext)

        assignPath(chain, ["slot", "incoming"], incoming, testContext)
        const destination = chain._state.value
        const retained = new Chain(destination, testContext)
        ancestor.resolve({})
        await flushMicrotasks()
        expect(destination.slot.incoming).to.be(incoming)

        const result = hasError(chain, [], testContext)
        assignPath(chain, ["slot"], {}, testContext)
        expect(chain._state.value).not.to.be(destination)

        pending.resolve(destination)

        expect(await result).to.be(false)
        expect(hasError(chain, [], testContext)).to.be(false)
    })

    it("keeps intrinsic cycle cuts after an attachment is replaced", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const incoming = importValue(
            { pending: pending.promise },
            { ...testContext, errorContext: "intrinsic detached attachment" },
        )
        const chain = new Chain(importValue({ value: null }, { ...testContext, errorContext: "destination" }), testContext)
        const cyclic = {}
        cyclic.self = cyclic

        assignPath(chain, ["value"], incoming, testContext)
        assignPath(chain, ["value"], null, testContext)
        pending.resolve(cyclic)
        await flushMicrotasks()

        new Chain(cyclic, testContext)
        buildRefIndex(cyclic, testContext)
        expect(metaOf(cyclic, testContext).cycleCuts.has("self")).to.be(true)
        expect(getErrors(new Chain(incoming, testContext), [], testContext)).to.be(null)
    })

    it("stores cycle cuts for frozen imports", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const frozen = {}
        frozen.self = frozen
        Object.freeze(frozen)
        importValue(frozen, { ...testContext, errorContext: "frozen cycle" })

        buildRefIndex(frozen, testContext)

        expect(metaOf(frozen, testContext).cycleCuts.has("self")).to.be(true)
        expectCounts(testContext, frozen, 1, 0)
        const exported = exportValue(new Chain(frozen, testContext), [], testContext)
        expect(exported).not.to.be(frozen)
        expect(exported.self).to.be(exported)
        verifyRefCounts(testContext, frozen)
    })

    it("propagates descendant cycle cuts through frozen imports", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = {}
        child.self = child
        const root = Object.freeze({ child })
        const chain = new Chain(importValue(root, { ...testContext, errorContext: "nested frozen cycle" }), testContext)

        expect(hasError(chain, [], testContext)).to.be(false)
        expect(getErrors(chain, [], testContext)).to.be(null)
        const copy = exportValue(chain, [], testContext)
        expect(copy).not.to.be(root)
        expect(copy.child.self).to.be(copy.child)
        expectCounts(testContext, root, 1, 0)
        expectCounts(testContext, child, 1, 0)
        verifyRefCounts(testContext, root)
    })

    it("keeps imported storage marked across repeated import", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        root.self = root

        importValue(root, { ...testContext, errorContext: "first import" })
        importValue(root, { ...testContext, errorContext: "second import" })
        buildRefIndex(root, testContext)
        expect(metaOf(root, testContext).imported).to.be(true)
        expect(metaOf(root, testContext).cycleCuts.has("self")).to.be(true)
    })

    it("preserves separately imported child cycle indexing", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = {}
        child.self = child
        importValue(child, { ...testContext, errorContext: "child import" })
        const root = importValue({ child }, { ...testContext, errorContext: "parent import" })

        buildRefIndex(root, testContext)
        expect(metaOf(root, testContext).imported).to.be(true)
        expect(metaOf(child, testContext).imported).to.be(true)
        expect(metaOf(child, testContext).cycleCuts.has("self")).to.be(true)
        expect(getRefCounter(root, testContext).errorCount).to.be(0)
        expect(getRefCounter(root, testContext).frontierCount).to.be(1)
        expect(getRefCounter(child, testContext).errorCount).to.be(0)
        expect(getRefCounter(child, testContext).frontierCount).to.be(1)
    })

    it("reuses an existing imported identity without another resolver", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const child = importValue(
            { pending: pending.promise },
            { ...testContext, errorContext: "child import" },
        )

        expect(registrations()).to.be(1)
        importValue({ child }, { ...testContext, errorContext: "wrapper import" })
        expect(registrations()).to.be(1)

        pending.resolve({ done: true })
        await flushMicrotasks()

        expect(readPath(new Chain(child, testContext), ["pending", "done"], testContext)).to.be(true)
    })

    it("detects cycles crossing direct import boundaries", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const parent = {}
        const child = { back: parent }
        parent.child = child
        importValue(parent, { ...testContext, errorContext: "parent import" })
        importValue(child, { ...testContext, errorContext: "child import" })

        buildRefIndex(parent, testContext)

        expect(metaOf(child, testContext).cycleCuts.has("back")).to.be(true)
        expectCounts(testContext, parent, 1, 0)
        expectCounts(testContext, child, 1, 0)
        verifyRefCounts(testContext, parent, child)
    })

    it("keeps the first operation context across asynchronous imports", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const first = importValue(pending.promise, { ...testContext, errorContext: "first async import" })
        const second = importValue(pending.promise, { ...testContext, errorContext: "second async import" })
        const cyclic = {}
        cyclic.self = cyclic

        pending.resolve(cyclic)
        expect(await first).to.be(cyclic)
        expect(await second).to.be(cyclic)

        buildRefIndex(cyclic, testContext)
        expect(getErrors(new Chain(cyclic, testContext), [], testContext)).to.be(null)
        expect(metaOf(cyclic, testContext).imported).to.be(true)
        expect(metaOf(cyclic, testContext).cycleCuts.has("self")).to.be(true)
    })

    it("recovers from a cycle after a COW repair", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        root.self = root
        importValue(root, { ...testContext, errorContext: "repairable import" })
        const chain = new Chain(root, testContext)

        expect(hasError(chain, [], testContext)).to.be(false)
        expect(getRefCounter(root, testContext).errorCount).to.be(0)
        expect(getRefCounter(root, testContext).frontierCount).to.be(1)

        deletePath(chain, ["self"], testContext)
        const repaired = chain._state.value

        expect(repaired).not.to.be(root)
        expect(repaired).to.eql({})
        expect(root.self).to.be(root)
        expect(exportValue(chain, [], testContext)).to.eql(repaired)
        expect(hasError(chain, [], testContext)).to.be(false)
        verifyRefCounts(testContext, repaired)
    })

    it("preserves Promise properties on sealed and frozen imports", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const sealedPending = Promise.resolve(1)
        const frozenPending = Promise.resolve(2)
        const error = new Error("bad")
        const sealed = Object.seal({ pending: sealedPending })
        const frozen = Object.freeze({ pending: frozenPending })
        const nonExtensibleError = Object.preventExtensions({ error })

        expect(importValue(sealed, { ...testContext, errorContext: "sealed promise" })).to.be(sealed)
        expect(importValue(frozen, { ...testContext, errorContext: "frozen promise" })).to.be(frozen)
        expect(importValue(nonExtensibleError, { ...testContext, errorContext: "frozen error" })).to.be(
            nonExtensibleError,
        )
        new Chain(sealed, testContext)
        expect(buildRefIndex(sealed, testContext)).to.be(sealed)
        new Chain(frozen, testContext)
        expect(buildRefIndex(frozen, testContext)).to.be(frozen)
        new Chain(nonExtensibleError, testContext)
        expect(buildRefIndex(nonExtensibleError, testContext)).to.be(nonExtensibleError)
        expectCounts(testContext, sealed, 1, 0)
        expectCounts(testContext, frozen, 1, 0)
        expectCounts(testContext, nonExtensibleError, 0, 1)

        await flushMicrotasks()

        expect(sealed.pending).to.be(sealedPending)
        expect(frozen.pending).to.be(frozenPending)
        expect(readPath(new Chain(sealed, testContext), ["pending"], testContext)).to.be(1)
        expect(readPath(new Chain(frozen, testContext), ["pending"], testContext)).to.be(2)
        expect(errorCause(getErrors(new Chain(nonExtensibleError, testContext), [], testContext)))
            .to.be(error)
        verifyRefCounts(testContext, sealed, frozen, nonExtensibleError)
    })

    it("ignores imported accessor properties", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
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
        expect(importValue(external, { ...testContext, errorContext: "accessor promise" })).to.be(external)
        expect(readPath(new Chain(external, testContext), ["pending"], testContext)).to.be(undefined)
        expect(reads).to.be(0)
    })

    it("exports pending elements in a sealed array", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = deferred()
        const second = deferred()
        const nested = Object.seal({ pending: second.promise })
        const array = Object.seal([first.promise, nested])

        importValue(array, { ...testContext, errorContext: "sealed array" })
        const exported = exportValue(new Chain(array, testContext), [], testContext)

        expect(getRefCounter(array, testContext)).to.be(undefined)
        expect(getRefCounter(nested, testContext)).to.be(undefined)

        first.resolve({ x: 1 })
        second.resolve(2)
        const copy = await exported

        expect(copy).to.eql([{ x: 1 }, { pending: 2 }])
        expect(array[0]).to.be(first.promise)
        expect(nested.pending).to.be(second.promise)
        expect(readPath(new Chain(array, testContext), ["0"], testContext)).to.eql({ x: 1 })
        expect(readPath(new Chain(nested, testContext), ["pending"], testContext)).to.be(2)
        expect(hasError(new Chain(array, testContext), [], testContext)).to.be(false)
        expect(getErrors(new Chain(array, testContext), [], testContext)).to.be(null)
        verifyRefCounts(testContext, array)
    })

    it("indexes and observes cyclic arrays", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const directError = new Error("array direct")
        const array = []
        array[0] = array
        array[1] = directError
        array[2] = pending.promise

        importValue(array, { ...testContext, errorContext: "cyclic array" })
        buildRefIndex(array, testContext)

        expect(metaOf(array, testContext).cycleCuts.has("0")).to.be(true)
        expectCounts(testContext, array, 2, 1)
        expect(hasError(new Chain(array, testContext), [], testContext)).to.be(true)

        const result = getErrors(new Chain(array, testContext), [], testContext)
        const resolvedError = new Error("array resolved")
        pending.resolve({ error: resolvedError })

        const errors = await result
        expect(errors.errors.length).to.be(2)
        expect(errors.errors.map(errorCause)).to.contain(directError)
        expect(errors.errors.map(errorCause)).to.contain(resolvedError)
        verifyRefCounts(testContext, array)
    })

    it("counts rejection Errors behind sealed promise properties", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const error = new Error("rejected sealed value")
        const root = Object.seal({ pending: pending.promise })

        importValue(root, { ...testContext, errorContext: "sealed rejection" })
        const rootChain = new Chain(root, testContext)
        const errors = getErrors(rootChain, [], testContext)
        expectCounts(testContext, root, 1, 0)

        pending.reject(error)
        const result = await errors

        expect(result.errors).to.be(undefined)
        expect(errorCause(result)).to.be(error)
        expect(root.pending).to.be(pending.promise)
        expect(errorCause(readPath(rootChain, ["pending"], testContext))).to.be(error)
        verifyRefCounts(testContext, root)
    })

    it("indexes sealed enumerable __proto__ regardless of Promise order", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
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
            importValue(value, { ...testContext, errorContext: "property order" })
            const indexed = buildRefIndex(value, testContext)

            expect(indexed).to.be(value)
            expect(readPath(new Chain(value, testContext), ["__proto__", "unsafe"], testContext)).to.be(true)
            expectCounts(testContext, value, 1, 0)
            await flushMicrotasks()
            expectCounts(testContext, value, 0, 0)
            verifyRefCounts(testContext, value)
        }
    })

    it("keeps non-extensible imported siblings independent", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const firstPromise = Promise.resolve(1)
        const secondError = new Error("bad")
        const first = Object.seal({ clean: 1, pending: firstPromise })
        const second = Object.freeze({ bad: secondError })
        importValue(first, { ...testContext, errorContext: "first frozen sibling" })
        importValue(second, { ...testContext, errorContext: "second frozen sibling" })
        const wrapper = { keep: true, first, second }
        const chain = new Chain(wrapper, testContext)

        const errors = await getErrors(chain, [], testContext)

        expect(errors.errors).to.be(undefined)
        expect(errorCause(errors)).to.be(secondError)
        expect(wrapper.keep).to.be(true)
        expect(wrapper.first).to.be(first)
        expect(wrapper.second).to.be(second)
        expect(first.pending).to.be(firstPromise)
        expect(readPath(new Chain(first, testContext), ["pending"], testContext)).to.be(1)
        expect(second.bad).to.be(secondError)
        expect(hasError(chain, ["first", "clean"], testContext)).to.be(false)
        expect(exportValue(chain, ["first", "clean"], testContext)).to.be(1)

        assignPath(chain, ["first", "clean"], 2, testContext)
        expect(chain._state.value.first.clean).to.be(2)
        expect(first.clean).to.be(1)
        expect((await getErrors(chain, [], testContext)).cause).to.be(secondError)
        verifyRefCounts(testContext, chain._state.value)
    })

    it("counts imported own enumerable __proto__ data", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        const protoValue = { safe: true }
        Object.defineProperty(root, "__proto__", {
            value: protoValue,
            enumerable: true,
            writable: true,
            configurable: true,
        })

        expect(importValue(root, { ...testContext, errorContext: "proto import" })).to.be(root)

        const indexed = buildRefIndex(root, testContext)

        expect(indexed).to.be(root)
        expect(readPath(new Chain(root, testContext), ["__proto__", "safe"], testContext)).to.be(true)
        expectCounts(testContext, root, 0, 0)
        expect(getRefCounter(protoValue, testContext)).not.to.be(undefined)
        verifyRefCounts(testContext, root, protoValue)
    })

    it("detects cycles through imported enumerable __proto__ data", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        Object.defineProperty(root, "__proto__", {
            value: root,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        importValue(root, { ...testContext, errorContext: "proto cycle" })

        buildRefIndex(root, testContext)
        expect(metaOf(root, testContext).cycleCuts.has("__proto__")).to.be(true)
        const rootChain = new Chain(root, testContext)
        expect(hasError(rootChain, [], testContext)).to.be(false)
        expect(getErrors(rootChain, [], testContext)).to.be(null)
        const exported = exportValue(rootChain, [], testContext)
        expect(exported).not.to.be(root)
        expect(Object.getOwnPropertyDescriptor(exported, "__proto__").value).to.be(
            exported,
        )
        expect(root.__proto__).to.be(root)
        expect(Object.getPrototypeOf(root)).to.be(Object.prototype)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)
    })

    it("indexes enumerable __proto__ data reached through a promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {
            value: importValue(pending.promise, { ...testContext, errorContext: "pending proto import" }),
        }
        const chain = new Chain(root, testContext)
        const found = hasError(chain, ["value"], testContext)
        const collected = getErrors(chain, ["value"], testContext)
        const exported = exportValue(chain, ["value"], testContext)
        buildRefIndex(root, testContext)
        const resolved = { clean: true }
        Object.defineProperty(resolved, "__proto__", {
            value: Promise.resolve("hidden"),
            enumerable: true,
            writable: true,
            configurable: true,
        })

        pending.resolve(resolved)

        expect(await found).to.be(false)
        expect(await collected).to.be(null)
        const exportedValue = await exported
        expect(exportedValue).not.to.be(resolved)
        expect(exportedValue.clean).to.be(true)
        expect(Object.getOwnPropertyDescriptor(
            exportedValue,
            "__proto__",
        ).value).to.be("hidden")
        expect(hasCycleCut(root, "value", testContext)).to.be(false)
        expect(readPath(new Chain(resolved, testContext), ["__proto__"], testContext)).to.be("hidden")
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root, resolved)
    })

    it("preserves and resolves imported enumerable __proto__ data through COW", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const hidden = Promise.resolve("hidden")
        const external = { branch: { value: 1 } }
        Object.defineProperty(external, "__proto__", {
            value: hidden,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        importValue(external, { ...testContext, errorContext: "COW proto import" })
        const chain = new Chain(external, testContext)

        assignPath(chain, ["branch", "value"], 2, testContext)
        const copy = chain._state.value
        const errors = await getErrors(chain, [], testContext)
        const exported = await exportValue(chain, [], testContext)

        expect(copy).not.to.be(external)
        expect(Object.getOwnPropertyDescriptor(external, "__proto__").value).to.be(
            hidden,
        )
        expect(Object.getOwnPropertyDescriptor(copy, "__proto__").value).to.be(
            "hidden",
        )
        expect(readPath(new Chain(copy, testContext), ["__proto__"], testContext)).to.be("hidden")
        expect(Object.getPrototypeOf(copy)).to.be(Object.prototype)
        expect(await hasError(chain, [], testContext)).to.be(false)
        expect(errors).to.be(null)
        expect(Object.getOwnPropertyDescriptor(exported, "__proto__").value).to.be("hidden")
        expect(Object.getPrototypeOf(exported)).to.be(Object.prototype)
        expect(external.branch.value).to.be(1)
        expect(copy.branch.value).to.be(2)
        verifyRefCounts(testContext, copy)
    })

    it("marks a metadata-bearing runtime identity reached through import", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = {}
        Object.defineProperty(child, "__proto__", {
            value: { unsafe: true },
            enumerable: true,
            writable: true,
            configurable: true,
        })
        new Chain(child, testContext)
        buildRefIndex(child, testContext)
        const root = importValue({ child }, { ...testContext, errorContext: "late import boundary" })

        const indexed = buildRefIndex(root, testContext)

        expect(indexed).to.be(root)
        expect(getRefCounter(child, testContext)).not.to.be(undefined)
        expect(getRefCounter(root, testContext)).not.to.be(undefined)
        expect(requiresCopyOnWrite(child, testContext)).to.be(true)
        expect(readPath(new Chain(root, testContext), ["child", "__proto__", "unsafe"], testContext)).to.be(true)
        verifyRefCounts(testContext, root, child)
    })

    it("marks extracted imported values even when ownership is ceded", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { branch: { x: 1 } }
        const branch = root.branch

        importValue(root, { ...testContext, errorContext: "extract import" })
        const extracted = readPath(new Chain(root, testContext), ["branch"], testContext)
        const chain = new Chain(extracted, testContext)
        assignPath(chain, ["x"], 2, testContext)
        const next = chain._state.value

        expect(extracted).to.be(branch)
        expect(metaOf(branch, testContext).imported).to.be(true)
        expect(next).not.to.be(branch)
        expect(branch.x).to.be(1)
        expect(next.x).to.be(2)
    })

    it("keeps COW path copies owned while marking their source children imported", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const rootSibling = {}
        const branchSibling = {}
        const leafSibling = {}
        const leaf = { sibling: leafSibling }
        const branch = { leaf, sibling: branchSibling }
        const root = { branch, sibling: rootSibling }

        importValue(root, { ...testContext, errorContext: "COW import boundary" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["branch", "leaf", "added"], 2, testContext)
        const next = chain._state.value

        expect(metaOf(next, testContext)?.imported).to.be(undefined)
        expect(metaOf(next.branch, testContext)?.imported).to.be(undefined)
        expect(metaOf(next.branch.leaf, testContext)?.imported).to.be(undefined)
        expect(metaOf(branch, testContext).imported).to.be(true)
        expect(metaOf(leaf, testContext).imported).to.be(true)
        expect(metaOf(rootSibling, testContext).imported).to.be(true)
        expect(metaOf(branchSibling, testContext).imported).to.be(true)
        expect(metaOf(leafSibling, testContext).imported).to.be(true)
    })

    it("keeps Promise forks outside the import boundary during COW", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pathValue = deferred()
        const retainedValue = deferred()
        const root = {
            path: pathValue.promise,
            retained: retainedValue.promise,
        }

        importValue(root, { ...testContext, errorContext: "Promise COW import boundary" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["path", "added"], 2, testContext)
        const next = chain._state.value

        expect(metaOf(next, testContext).imported).to.be(undefined)

        pathValue.resolve({ kept: true })
        retainedValue.resolve({ sibling: true })
        await flushMicrotasks()

        expect(root.path).to.be(pathValue.promise)
        expect(root.retained).to.be(retainedValue.promise)
        expect(readPath(new Chain(root, testContext), ["path"], testContext)).to.eql({ kept: true })
        expect(readPath(new Chain(root, testContext), ["retained"], testContext)).to.eql({
            sibling: true,
        })
        expect(next.path).to.eql({ kept: true, added: 2 })
        expect(metaOf(next.path, testContext)?.imported).to.be(undefined)
        expect(next.retained).to.eql({
            sibling: true,
        })
    })

    it("cuts a runtime-owned Promise result that reaches its copied path", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const chain = new Chain({ pending: pending.promise, other: 1 }, testContext)
        lookupPath(chain, [], testContext)
        assignPath(chain, ["other"], 2, testContext)
        const copy = chain._state.value

        pending.resolve(copy)
        await flushMicrotasks()

        expect(copy.pending).to.be(copy)
        buildRefIndex(copy, testContext)
        expect(hasCycleCut(copy, "pending", testContext)).to.be(true)
        const exported = exportValue(chain, [], testContext)
        expect(exported.pending).to.be(exported)
        verifyRefCounts(testContext, copy)
    })

    it("keeps repeated pending COW forks runtime-owned", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const resolved = { value: true }
        const root = {
            pending: pending.promise,
            left: 0,
            right: 0,
        }

        importValue(root, { ...testContext, errorContext: "repeated Promise COW" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["left"], 1, testContext)
        lookupPath(chain, [], testContext)
        assignPath(chain, ["right"], 2, testContext)
        const second = chain._state.value

        pending.resolve(resolved)
        await flushMicrotasks()

        expect(second.pending).to.be(resolved)
        expect(readPath(chain, ["pending"], testContext)).to.be(resolved)
        expect(metaOf(resolved, testContext).imported).to.be(true)
    })

    it("samples Promise import attribution at the fork's FIFO position", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { pending: pending.promise, sibling: 0 }

        importValue(root, { ...testContext, errorContext: "FIFO Promise attribution" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["sibling"], 1, testContext)
        assignPath(chain, ["pending", "first"], 1, testContext)

        // Force a later COW while the earlier path mutation is suspended. The
        // off-path fork must observe that the earlier mutation consumed the
        // imported attribution.
        lookupPath(chain, [], testContext)
        assignPath(chain, ["sibling"], 2, testContext)
        const copy = chain._state.value
        const observed = readPath(chain, ["pending"], testContext)

        pending.resolve({ original: true })
        const owned = await observed

        expect(metaOf(owned, testContext)?.imported).to.be(undefined)
        expect(owned).to.eql({ original: true, first: 1 })
        expect(copy.pending).to.be(owned)
    })

    it("retains imported status when COW drops a resolved Promise version", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const resolved = { value: true }
        const root = {
            pending: pending.promise,
            left: 0,
            right: 0,
        }

        importValue(root, { ...testContext, errorContext: "resolved Promise COW" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["left"], 1, testContext)
        const first = chain._state.value

        pending.resolve(resolved)
        await flushMicrotasks()

        expect(metaOf(resolved, testContext).imported).to.be(true)

        const retained = new Chain(lookupPath(chain, [], testContext), testContext)
        assignPath(chain, ["right"], 2, testContext)
        const second = chain._state.value

        expect(metaOf(second, testContext)?.placementVersions?.pending).to.be(undefined)
        expect(second.pending).to.be(resolved)
        expect(metaOf(resolved, testContext).imported).to.be(true)
    })

    it("keeps an off-path fork runtime-owned when it becomes the COW path", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { pending: pending.promise, sibling: 0 }

        importValue(root, { ...testContext, errorContext: "imported Promise path" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["sibling"], 1, testContext)

        assignPath(chain, ["pending", "first"], 1, testContext)

        pending.resolve({ original: true })
        await flushMicrotasks()

        const owned = readPath(chain, ["pending"], testContext)
        expect(metaOf(owned, testContext)?.imported).to.be(undefined)
        expect(owned).to.eql({ original: true, first: 1 })

        assignPath(chain, ["pending", "second"], 2, testContext)
        expect(readPath(chain, ["pending"], testContext)).to.be(owned)
        expect(owned.second).to.be(2)
    })

    it("consumes a resolved Promise version on the COW path", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const retained = {}
        const root = { pending: pending.promise, sibling: 0 }

        importValue(root, { ...testContext, errorContext: "resolved Promise path" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["sibling"], 1, testContext)
        const parentCopy = chain._state.value

        pending.resolve({ retained, value: 0 })
        await flushMicrotasks()

        assignPath(chain, ["pending", "value"], 1, testContext)
        const owned = readPath(chain, ["pending"], testContext)

        expect(metaOf(parentCopy, testContext).placementVersions?.pending).to.be(undefined)
        expect(metaOf(owned, testContext)?.imported).to.be(undefined)
        expect(metaOf(retained, testContext).imported).to.be(true)
        expect(owned.value).to.be(1)
    })

    it("preserves imported cycle cuts behind an owned copied path", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const branch = {}
        branch.self = branch
        const root = {
            branch,
            sibling: { x: 1 },
        }

        importValue(root, { ...testContext, errorContext: "path child import" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["branch", "added"], 2, testContext)
        const next = chain._state.value
        const indexed = buildRefIndex(next.branch, testContext)

        expect(next).not.to.be(root)
        expect(next.branch).not.to.be(branch)
        expect(next.branch.self).to.be(branch)
        expect(indexed).to.be(next.branch)
        expect(hasError(new Chain(next.branch, testContext), [], testContext)).to.be(false)
    })

    it("discovers imported promise keys before the branch is counted", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        importValue(root, { ...testContext, errorContext: "promise key import" })
        expect(metaOf(root, testContext).placementVersions.value).not.to.be(undefined)
        expect(root.value).to.be(deferredValue.promise)
        expect(getRefCounter(root, testContext)).to.be(undefined)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 0)

        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        const oldValue = readPath(new Chain(root, testContext), ["value"], testContext)
        const chain = new Chain(root, testContext)
        assignPath(chain, ["value", "x"], 2, testContext)
        const next = chain._state.value

        expect(oldValue).to.eql({ x: 1 })
        expect(root.value).to.be(deferredValue.promise)
        expect(next).not.to.be(root)
        expect(next.value).not.to.be(oldValue)
        expect(oldValue.x).to.be(1)
        expect(next.value.x).to.be(2)
        verifyRefCounts(testContext, root, next)
    })

    it("indexes sealed values exposed by imported Promise resolution", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, { ...testContext, errorContext: "sealed resolution" })
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 0)

        const nestedPending = Promise.resolve(1)
        const resolved = Object.seal({ pending: nestedPending })
        deferredValue.resolve(resolved)
        await flushMicrotasks()

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(resolved.pending).to.be(nestedPending)
        const rootChain = new Chain(root, testContext)
        expect(await getErrors(rootChain, [], testContext)).to.be(null)
        expect(readPath(rootChain, ["nested", "value", "pending"], testContext)).to.be(1)
        verifyRefCounts(testContext, root)
    })

    it("collects private non-extensible values from detached versions", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const errorValue = Object.freeze({ bad: new Error("bad") })
        const root = { value: pending.promise }
        const chain = new Chain(root, testContext)

        importValue(errorValue, { ...testContext, errorContext: "detached resolution" })
        buildRefIndex(root, testContext)
        const errors = getErrors(chain, ["value"], testContext)
        assignPath(chain, ["value"], "fixed", testContext)

        pending.resolve(errorValue)

        expect(errorCause(await errors)).to.be(errorValue.bad)
        expect(root.value).to.be("fixed")
        verifyRefCounts(testContext, root, errorValue)
    })

    it("marks imported Promise values that reach their target", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const pendingSibling = deferred()
        const root = {
            nested: {
                pending: pendingSibling.promise,
                value: deferredValue.promise,
            },
        }

        importValue(root, { ...testContext, errorContext: "resolved back-edge" })
        const rootChain = new Chain(root, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 1, 0)
        expectCounts(testContext, root.nested, 2, 0)

        deferredValue.resolve(root)
        await flushMicrotasks()

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(readPath(new Chain(root, testContext), ["nested", "value"], testContext)).to.be(root)
        expect(hasCycleCut(root.nested, "value", testContext)).to.be(true)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)

        pendingSibling.resolve("done")
        await flushMicrotasks()

        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)
    })

    it("marks imported Promise values that contain their target", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }
        const resolved = { target: root.nested }

        importValue(root, { ...testContext, errorContext: "containing back-edge" })
        const rootChain = new Chain(root, testContext)
        buildRefIndex(root, testContext)

        deferredValue.resolve(resolved)
        await flushMicrotasks()

        expect(root.nested.value).to.be(deferredValue.promise)
        expect(readPath(rootChain, ["nested", "value"], testContext)).to.be(
            resolved,
        )
        expect(getErrors(rootChain, [], testContext)).to.be(null)
        expect(metaOf(resolved, testContext).cycleCuts).to.be(undefined)
        expect(hasCycleCut(root.nested, "value", testContext)).to.be(true)
        expect(requiresCopyOnWrite(resolved, testContext)).to.be(true)
        expect(metaOf(resolved, testContext).imported).to.be(true)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)
    })

    it("reuses an existing runtime Promise version reached through import", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const child = { pending: pending.promise }
        const earlierRead = lookupPath(
            new Chain(child, testContext),
            ["pending"],
            testContext,
            false,
        )
        expect(registrations()).to.be(2)
        const root = { child }

        importValue(root, { ...testContext, errorContext: "runtime Promise version back-edge" })
        expect(registrations()).to.be(2)
        pending.resolve(root)
        expect(await earlierRead).to.be(root)
        await flushMicrotasks()

        expect(child.pending).to.be(root)
        buildRefIndex(root, testContext)
        expect(hasCycleCut(child, "pending", testContext)).to.be(true)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)
    })

    it("settles an indexed runtime Promise version reached through import", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }
        const hiddenError = new Error("indexed sibling")
        new Chain(child, testContext)
        buildRefIndex(child, testContext)
        const root = { child, hiddenError }

        importValue(root, { ...testContext, errorContext: "indexed runtime Promise version back-edge" })
        pending.resolve(root)
        await flushMicrotasks()

        expect(child.pending).to.be(root)
        expect(hasCycleCut(child, "pending", testContext)).to.be(true)
        expectCounts(testContext, root, 1, 1)
        verifyRefCounts(testContext, root)
    })

    it("COWs before an imported promise can resolve to its escaped owner", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { nested: {} }
        const chain = new Chain(root, testContext)
        const escaped = lookupPath(chain, [], testContext)
        const retained = new Chain(escaped, testContext)

        assignPath(
            chain,
            ["nested", "value"],
            importValue(deferredValue.promise, { ...testContext, errorContext: "assigned promise" }),
            testContext,
        )
        const next = chain._state.value
        expect(next).not.to.be(root)

        deferredValue.resolve(escaped)
        await flushMicrotasks()

        expect(next.nested.value).to.be(escaped)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(getErrors(chain, [], testContext)).to.be(null)
        verifyRefCounts(testContext, next, escaped)
    })

    it("classifies an imported promise that resolves to its COW destination", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = importValue({}, { ...testContext, errorContext: "destination root" })
        const chain = new Chain(root, testContext)
        const importedPromise = importValue(
            deferredValue.promise,
            { ...testContext, errorContext: "assigned destination" },
        )

        assignPath(chain, ["self"], importedPromise, testContext)
        const next = chain._state.value
        deferredValue.resolve(next)
        await importedPromise
        await flushMicrotasks()

        buildRefIndex(next, testContext)
        expect(hasCycleCut(next, "self", testContext)).to.be(true)
        expect(next.self).to.be(next)
        expect(readPath(chain, ["self"], testContext)).to.be(next)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(getErrors(chain, [], testContext)).to.be(null)
        verifyRefCounts(testContext, next)
    })

    it("cuts a retained Promise fork that resolves to its COW owner", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const root = {
            pending: pending.promise,
            sibling: 0,
        }

        importValue(root, { ...testContext, errorContext: "fork destination" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["sibling"], 1, testContext)
        const copy = chain._state.value
        expect(registrations()).to.be(2)
        pending.resolve(copy)
        await flushMicrotasks()

        expect(registrations()).to.be(2)
        buildRefIndex(copy, testContext)
        expect(hasCycleCut(root, "pending", testContext)).to.be(false)
        expect(hasCycleCut(copy, "pending", testContext)).to.be(true)
        expect(root.pending).to.be(pending.promise)
        expect(copy.pending).to.be(copy)
        expect(readPath(chain, ["pending"], testContext)).to.be(copy)
        expect(readPath(new Chain(copy, testContext), ["pending"], testContext)).to.be(copy)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(getErrors(chain, [], testContext)).to.be(null)
        verifyRefCounts(testContext, root, copy)
    })

    it("commits an indexed Promise fork directly from pending to a cycle cut", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {
            pending: pending.promise,
            sibling: 0,
        }

        importValue(root, { ...testContext, errorContext: "indexed fork destination" })
        buildRefIndex(root, testContext)
        const chain = new Chain(root, testContext)
        assignPath(chain, ["sibling"], 1, testContext)
        const copy = chain._state.value
        expectCounts(testContext, copy, 1, 0)
        pending.resolve(copy)
        await flushMicrotasks()

        expectCounts(testContext, copy, 1, 0)
        expect(hasCycleCut(copy, "pending", testContext)).to.be(true)
        expect(copy.pending).to.be(copy)
        expect(readPath(new Chain(copy, testContext), ["pending"], testContext)).to.be(copy)
        verifyRefCounts(testContext, root, copy)
    })

    it("does not cut a fork when only its imported source placement cycles", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {
            pending: pending.promise,
            sibling: 0,
        }

        importValue(root, { ...testContext, errorContext: "source-only fork cycle" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["sibling"], 1, testContext)
        const copy = chain._state.value
        pending.resolve(root)
        await flushMicrotasks()

        buildRefIndex(root, testContext)
        buildRefIndex(copy, testContext)
        expect(hasCycleCut(root, "pending", testContext)).to.be(true)
        expect(hasCycleCut(copy, "pending", testContext)).to.be(false)
        expect(root.pending).to.be(pending.promise)
        expect(copy.pending).to.be(root)
        expect(readPath(chain, ["pending"], testContext)).to.be(root)
        expect(readPath(new Chain(copy, testContext), ["pending"], testContext)).to.be(root)
        verifyRefCounts(testContext, root, copy)
    })

    it("indexes a nested fork cycle after copy-on-write", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {
            branch: {
                pending: pending.promise,
                value: 0,
            },
        }

        importValue(root, { ...testContext, errorContext: "nested fork ancestor" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["branch", "value"], 1, testContext)
        const copy = chain._state.value
        pending.resolve(copy)
        await flushMicrotasks()

        buildRefIndex(copy, testContext)
        expect(hasCycleCut(copy.branch, "pending", testContext)).to.be(true)
        expect(copy.branch.pending).to.be(copy)
        expect(readPath(new Chain(copy, testContext), ["branch", "pending"], testContext)).to.be(
            copy,
        )
        expect(hasError(chain, [], testContext)).to.be(false)
        verifyRefCounts(testContext, root, copy)
    })

    it("does not mistake a later copied descendant for a fork ancestor", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {
            pending: pending.promise,
            branch: { value: 0 },
        }

        importValue(root, { ...testContext, errorContext: "fork descendant" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["branch", "value"], 1, testContext)
        const copy = chain._state.value
        pending.resolve(copy.branch)
        await flushMicrotasks()

        expect(hasCycleCut(copy, "pending", testContext)).to.be(false)
        expect(copy.pending).to.be(copy.branch)
        expect(readPath(new Chain(copy, testContext), ["pending"], testContext)).to.be(copy.branch)
        expect(hasError(chain, [], testContext)).to.be(false)
        verifyRefCounts(testContext, root, copy)
    })

    it("keeps a detached fork query on its captured COW destination", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {
            pending: pending.promise,
            sibling: 0,
        }

        importValue(root, { ...testContext, errorContext: "detached fork destination" })
        const chain = new Chain(root, testContext)
        assignPath(chain, ["sibling"], 1, testContext)
        const captured = chain._state.value
        const result = hasError(chain, ["pending"], testContext)
        assignPath(chain, ["pending"], null, testContext)

        pending.resolve(captured)

        expect(await result).to.be(false)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(chain._state.value.pending).to.be(null)
    })

    it("defers non-indexed Promise back-edge cuts until counting", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { nested: { value: deferredValue.promise } }

        importValue(root, { ...testContext, errorContext: "floating back-edge" })
        const rootChain = new Chain(root, testContext)
        lookupPath(rootChain, ["nested", "value"], testContext)
        deferredValue.resolve(root.nested)
        await flushMicrotasks()

        expect(hasCycleCut(root.nested, "value", testContext)).to.be(false)
        expect(getRefCounter(root, testContext)).to.be(undefined)
        const indexed = buildRefIndex(root, testContext)

        expect(hasCycleCut(root.nested, "value", testContext)).to.be(true)
        expect(root.nested.value).to.be(deferredValue.promise)
        expect(readPath(rootChain, ["nested", "value"], testContext)).to.be(root.nested)
        expect(indexed).to.be(root)
        expect(hasError(rootChain, [], testContext)).to.be(false)
    })

    it("leaves cyclic imported Promise roots unindexed until counting", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, { ...testContext, errorContext: "promise root" })
        const cyclic = {}
        cyclic.self = cyclic

        deferredValue.resolve(cyclic)
        const value = await imported
        expect(metaOf(value, testContext).cycleCuts).to.be(undefined)
        expect(getRefCounter(value, testContext)).to.be(undefined)
        const indexed = buildRefIndex(value, testContext)

        expect(metaOf(value, testContext).cycleCuts.has("self")).to.be(true)
        expect(value).to.be(cyclic)
        expect(indexed).to.be(cyclic)
        expect(hasError(new Chain(value, testContext), [], testContext)).to.be(false)
    })

    it("keeps the import boundary when promise roots resolve to sealed values", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, { ...testContext, errorContext: "sealed promise root" })
        const sealed = Object.seal({ pending: Promise.resolve(1) })

        deferredValue.resolve(sealed)
        const value = await imported
        const indexed = buildRefIndex(value, testContext)

        expect(value).to.be(sealed)
        expect(indexed).to.be(sealed)
        expect(metaOf(sealed, testContext).imported).to.be(true)
        expectCounts(testContext, sealed, 0, 0)

        await flushMicrotasks()

        expect(sealed.pending instanceof Promise).to.be(true)
        expect(readPath(new Chain(sealed, testContext), ["pending"], testContext)).to.be(1)
        verifyRefCounts(testContext, sealed)
    })

    it("preserves an imported Promise rejection", async () => {
        const deferredValue = deferred()
        const imported = importValue(deferredValue.promise, { execution: new Execution(), errorContext: "test operation" })

        deferredValue.reject("external boom")
        const rejection = await imported
        expect(rejection.cause).to.be("external boom")
    })

    it("completes direct-Promise admission before fulfillment", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const failure = new Error("root ownKeys failed")
        const value = new Proxy({}, {
            ownKeys() {
                throw failure
            },
        })
        const imported = importValue(pending.promise, { ...testContext, errorContext: "promised root" })

        pending.resolve(value)

        expect(errorCause(await imported)).to.be(failure)
        expect(metaOf(value, testContext)).to.be(undefined)
    })

    it("publishes reflection failure when an imported Promise resolves", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = importValue(
            { value: pending.promise },
            { ...testContext, errorContext: "resolved reflection" },
        )
        const chain = new Chain(root, testContext)
        const read = lookupPath(chain, ["value"], testContext)
        const failure = new Error("resolved ownKeys failed")

        pending.resolve(new Proxy({}, {
            ownKeys() {
                throw failure
            },
        }))

        expect(errorCause(await read)).to.be(failure)
        expect(errorCause(lookupPath(chain, ["value"], testContext))).to.be(failure)
        expect(root.value).to.be(pending.promise)
    })

    it("retries an imported identity after reflection fails", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
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

        expect(errorCause(importValue(root, { ...testContext, errorContext: "failed import" }))).to.be(failure)
        expect(metaOf(root, testContext)).to.be(undefined)
        expect(metaOf(child, testContext)).to.be(undefined)
        expect(importValue(root, { ...testContext, errorContext: "retried import" })).to.be(root)
        expect(ownKeysCalls).to.be(2)

        pending.resolve(7)
        await flushMicrotasks()

        expect(childTarget.pending).to.be(pending.promise)
        expect(readPath(new Chain(root, testContext), ["child", "pending"], testContext)).to.be(7)
        verifyRefCounts(testContext, root)
    })

    it("preserves an already-rejected imported Promise", async () => {
        const rejection = await importValue(Promise.reject("already external boom"), { execution: new Execution(), errorContext: "test operation" })
        expect(rejection.cause).to.be("already external boom")
    })
})
