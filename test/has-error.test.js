import {
    Chain,
    assignPath,
    deletePath,
    hasError,
    import as importValue,
    export as exportValue,
    lookupPath,
    Execution,
} from "../src/index.js"
import { buildRefIndex, getRefCounter } from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { metaOf } from "../src/meta.js"
import { expect, readPath, countPromiseRegistrations, deferred, flushMicrotasks } from "./support.js"

describe("hasError", () => {
    it("answers immediate path cases synchronously", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {
            branch: {
                clean: { x: 1 },
                bad: new Error("bad"),
            },
        }

        const rootChain = new Chain(root, testContext)
        expect(hasError(rootChain, [], testContext)).to.be(true)
        expect(hasError(rootChain, ["branch"], testContext)).to.be(true)
        expect(hasError(rootChain, ["branch", "bad"], testContext)).to.be(true)
        expect(hasError(rootChain, ["branch", "clean"], testContext)).to.be(false)
        expect(hasError(rootChain, ["branch", "missing"], testContext)).to.be(false)
        expect(hasError(rootChain, ["missing", "x"], testContext)).to.be(true)
        expect(hasError(new Chain(new Error("root"), testContext), [], testContext)).to.be(true)
        expect(hasError(new Chain(7, testContext), [], testContext)).to.be(false)
        expect(hasError(new Chain(7, testContext), ["x"], testContext)).to.be(true)
    })

    it("reads own enumerable __proto__ data but hides non-enumerable properties", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        Object.defineProperty(root, "__proto__", {
            value: new Error("hidden proto"),
            enumerable: true,
            writable: true,
            configurable: true,
        })
        Object.defineProperty(root, "hidden", {
            value: new Error("hidden"),
            enumerable: false,
            writable: true,
            configurable: true,
        })

        const rootChain = new Chain(root, testContext)
        expect(hasError(rootChain, ["__proto__"], testContext)).to.be(true)
        expect(hasError(rootChain, ["hidden"], testContext)).to.be(false)
        expect(hasError(rootChain, ["__proto__", "x"], testContext)).to.be(true)
        expect(hasError(rootChain, ["hidden", "x"], testContext)).to.be(true)
    })

    it("does not mark clean queried branches as shared", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { branch: { x: 1 } }
        const branch = root.branch

        const rootChain = new Chain(root, testContext)
        expect(hasError(rootChain, ["branch"], testContext)).to.be(false)
        assignPath(rootChain, ["branch", "x"], 2, testContext)

        expect(root.branch).to.be(branch)
        expect(branch.x).to.be(2)
        verifyRefCounts(testContext, root)
    })

    it("indexes cyclic imports without replacing their raw branch", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const branch = {}
        branch.self = branch
        const root = { branch }

        importValue(root, { ...testContext, errorContext: "hasError import" })

        expect(hasError(new Chain(root, testContext), ["branch"], testContext)).to.be(false)
        expect(getRefCounter(branch, testContext).errorCount).to.be(0)
        expect(getRefCounter(branch, testContext).cycleCutCount).to.be(1)
        expect(branch.self).to.be(branch)
    })

    it("stops a terminal-cycle search at the first Error", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const root = {}
        root.self = root
        root.bad = new Error("found")
        root.pending = pending.promise
        importValue(root, { ...testContext, errorContext: "cycle first Error" })
        const beforeQuery = registrations()

        expect(hasError(new Chain(root, testContext), ["self"], testContext)).to.be(true)
        expect(registrations()).to.be(beforeQuery)

        pending.resolve("done")
        await flushMicrotasks()
        verifyRefCounts(testContext, root)
    })

    it("creates no abandoned aggregate after a synchronous Error proof", async () => {
        let testContext
        let reported
        testContext = { execution: new Execution(error => {
            reported = error
        }), errorContext: "test operation" }
        const pending = deferred()
        const failure = new Error("late query continuation failure")
        const ancestor = { bad: new Error("found") }
        const branch = { pending: pending.promise, back: ancestor }
        ancestor.branch = branch
        importValue(ancestor, { ...testContext, errorContext: "abandoned Error query" })
        buildRefIndex(ancestor, testContext)

        const counter = getRefCounter(branch, testContext)
        expect(counter.errorCount).to.be(0)
        expect(counter.promiseCount).to.be(1)
        expect(counter.cycleCutCount).to.be(1)

        const promiseVersion = metaOf(branch, testContext).placementVersions.pending
        let versionValue = promiseVersion.value
        // Fault after shared publication but before the query continuation.
        pending.promise.then(() => {
            versionValue = promiseVersion.value
            Object.defineProperty(promiseVersion, "value", {
                enumerable: true,
                configurable: true,
                get() {
                    throw failure
                },
                set(value) {
                    versionValue = value
                },
            })
        })
        expect(hasError(new Chain(branch, testContext), [], testContext)).to.be(true)
        pending.resolve({ clean: true })
        await flushMicrotasks()

        expect(reported).to.be(undefined)
        Object.defineProperty(promiseVersion, "value", {
            value: versionValue,
            enumerable: true,
            writable: true,
            configurable: true,
        })
        verifyRefCounts(testContext, ancestor)
    })

    it("indexes non-extensible branches uniformly", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const clean = Object.freeze({ nested: { value: 1 } })
        const pending = Object.preventExtensions({ pending: Promise.resolve(1) })
        const error = new Error("bad")
        const bad = Object.seal({ nested: { bad: error } })

        importValue(clean, { ...testContext, errorContext: "clean frozen probe" })
        importValue(pending, { ...testContext, errorContext: "pending frozen probe" })
        importValue(bad, { ...testContext, errorContext: "error frozen probe" })

        expect(hasError(new Chain(clean, testContext), [], testContext)).to.be(false)
        const pendingResult = hasError(new Chain(pending, testContext), [], testContext)
        expect(hasError(new Chain(bad, testContext), [], testContext)).to.be(true)

        expect(getRefCounter(pending, testContext).promiseCount).to.be(1)
        expect(await pendingResult).to.be(false)
        expect(getRefCounter(pending, testContext).promiseCount).to.be(0)
        expect(pending.pending instanceof Promise).to.be(true)
        expect(readPath(new Chain(pending, testContext), ["pending"], testContext)).to.be(1)
        verifyRefCounts(testContext, clean, pending, bad)
    })

    it("probes terminal promises on sealed parents through versions", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cleanPending = deferred()
        const badPending = deferred()
        const cleanRoot = Object.seal({ pending: cleanPending.promise })
        const badRoot = Object.seal({ pending: badPending.promise })
        importValue(cleanRoot, { ...testContext, errorContext: "clean sealed terminal" })
        importValue(badRoot, { ...testContext, errorContext: "bad sealed terminal" })

        const cleanResult = hasError(new Chain(cleanRoot, testContext), ["pending"], testContext)
        const badResult = hasError(new Chain(badRoot, testContext), ["pending"], testContext)

        cleanPending.resolve(undefined)
        badPending.reject("sealed failure")

        expect(await cleanResult).to.be(false)
        expect(await badResult).to.be(true)
        expect(cleanRoot.pending).to.be(cleanPending.promise)
        expect(badRoot.pending).to.be(badPending.promise)
        expect(metaOf(cleanRoot, testContext).placementVersions.pending).not.to.be(undefined)
        expect(metaOf(badRoot, testContext).placementVersions.pending).not.to.be(undefined)
        expect(getRefCounter(cleanRoot, testContext)).to.be(undefined)
        expect(getRefCounter(badRoot, testContext)).to.be(undefined)
    })

    it("distinguishes promised missing terminals from broken paths", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const chain = new Chain({ parent: pending.promise }, testContext)

        const missingTerminal = hasError(chain, ["parent", "missing"], testContext)
        const brokenPath = hasError(chain, ["parent", "missing", "child"], testContext)

        pending.resolve({})

        expect(await missingTerminal).to.be(false)
        expect(await brokenPath).to.be(true)
        verifyRefCounts(testContext, chain._state.value)
    })

    it("reuses indexed descendants under a non-extensible branch", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }

        new Chain(child, testContext)
        expect(buildRefIndex(child, testContext)).to.be(child)

        const wrapper = Object.preventExtensions({ child })
        importValue(wrapper, { ...testContext, errorContext: "indexed frozen probe" })

        const result = hasError(new Chain(wrapper, testContext), [], testContext)

        expect(getRefCounter(wrapper, testContext).promiseCount).to.be(1)
        expect(getRefCounter(child, testContext).promiseCount).to.be(1)

        pending.resolve("done")

        expect(await result).to.be(false)
        expect(getRefCounter(wrapper, testContext).promiseCount).to.be(0)
        expect(child.pending).to.be("done")
        expect(readPath(new Chain(child, testContext), ["pending"], testContext)).to.be("done")
        verifyRefCounts(testContext, wrapper)
    })

    it("returns true on indexed sync errors", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const before = { x: 1 }
        const after = { y: 2 }
        const root = {
            before,
            bad: new Error("bad"),
            after,
        }

        expect(hasError(new Chain(root, testContext), [], testContext)).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("answers true from errorCount while leaving normal promise resolution live", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {
            pending: pending.promise,
            bad: new Error("bad"),
        }

        expect(hasError(new Chain(root, testContext), [], testContext)).to.be(true)
        expect(getRefCounter(root, testContext).promiseCount).to.be(1)
        expect(getRefCounter(root, testContext).errorCount).to.be(1)

        pending.resolve({ ok: true })
        await flushMicrotasks()

        expect(root.pending).to.eql({ ok: true })
        expect(getRefCounter(root, testContext).promiseCount).to.be(0)
        expect(getRefCounter(root, testContext).errorCount).to.be(1)
        verifyRefCounts(testContext, root)
    })

    it("waits for clean pending branches and then answers false", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }

        const result = hasError(new Chain(root, testContext), ["branch"], testContext)

        expect(typeof result.then).to.be("function")

        pending.resolve({ ok: true })

        expect(await result).to.be(false)
        expect(root.branch).to.eql({ pending: { ok: true } })
        verifyRefCounts(testContext, root)
    })

    it("answers true as soon as a watched promise exposes an Error", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const bad = deferred()
        const slow = deferred()
        const root = {
            branch: {
                bad: bad.promise,
                slow: slow.promise,
            },
        }

        const result = hasError(new Chain(root, testContext), ["branch"], testContext)

        bad.reject("bad")

        expect(await result).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("does no query walk when another pending branch settles after true", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const bad = deferred()
        const later = deferred()
        const nested = deferred()
        const target = { nested: nested.promise }
        let scans = 0
        const value = new Proxy(target, {
            ownKeys(target) {
                scans++
                return Reflect.ownKeys(target)
            },
        })
        const root = {
            bad: bad.promise,
            later: later.promise,
        }
        const result = hasError(new Chain(root, testContext), [], testContext)

        bad.resolve(new Error("found"))
        expect(await result).to.be(true)

        later.resolve(value)
        await flushMicrotasks()

        // Reception prepares the graph and shared publication indexes it.
        // The closed query performs no additional traversal.
        expect(scans).to.be(2)

        nested.resolve("done")
        await flushMicrotasks()
        expect(readPath(new Chain(value, testContext), ["nested"], testContext)).to.be("done")
    })

    it("fully indexes resolved promise branches before answering true", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }

        const result = hasError(new Chain(root, testContext), ["branch"], testContext)

        outer.resolve({
            nested: { bad: new Error("bad") },
            inner: inner.promise,
        })

        expect(await result).to.be(true)

        const resolved = root.branch.outer
        expect(getRefCounter(root.branch, testContext).promiseCount).to.be(1)
        expect(getRefCounter(root.branch, testContext).errorCount).to.be(1)
        expect(getRefCounter(resolved, testContext).promiseCount).to.be(1)
        expect(getRefCounter(resolved, testContext).errorCount).to.be(1)
        expect(getRefCounter(resolved.nested, testContext).errorCount).to.be(1)
        verifyRefCounts(testContext, root, resolved)
    })

    it("answers true behind several promise barriers while others still pend", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const slow = deferred()
        const root = { branch: { outer: outer.promise, slow: slow.promise } }

        const result = hasError(new Chain(root, testContext), ["branch"], testContext)

        // First barrier exposes only a deeper pending; the next generation waits it.
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        // Second barrier commits the error; the answer fires at THIS settlement
        // because the resolved branch is indexed while `slow` is still pending.
        inner.resolve({ deep: { bad: new Error("bad") } })

        expect(await result).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("can revisit a cycle Promise exposed by a later continuation", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = deferred()
        const second = deferred()
        const root = {
            branch: {
                first: first.promise,
                second: second.promise,
            },
        }

        const rootChain = new Chain(root, testContext)
        const result = hasError(rootChain, ["branch"], testContext)
        first.resolve("done")
        await flushMicrotasks()

        assignPath(rootChain, ["branch", "second", "again"], first.promise, testContext)
        second.resolve({})

        const outcome = await Promise.race([
            result,
            flushMicrotasks().then(() => "pending"),
        ])

        expect(outcome).to.be(false)
        verifyRefCounts(testContext, root)
    })

    it("waits for promises exposed by resolved values", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }
        let settled = false

        const result = hasError(new Chain(root, testContext), ["branch"], testContext)
        result.then(() => {
            settled = true
        })

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expect(settled).to.be(false)

        inner.resolve("done")

        expect(await result).to.be(false)
        verifyRefCounts(testContext, root)
    })

    it("does not wait for later promises outside the original indexed frontier", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = deferred()
        const later = deferred()
        const root = {
            branch: {
                pending: first.promise,
                clean: { stable: true },
            },
        }
        let settled = false

        const rootChain = new Chain(root, testContext)
        const result = hasError(rootChain, ["branch"], testContext)
        result.then(() => {
            settled = true
        })

        assignPath(rootChain, ["branch", "clean", "later"], later.promise, testContext)
        await flushMicrotasks()

        expect(settled).to.be(false)

        first.resolve("done")

        const outcome = await Promise.race([
            result,
            flushMicrotasks().then(() => "pending"),
        ])

        expect(outcome).to.be(false)
        expect(settled).to.be(true)
        expect(getRefCounter(root.branch, testContext).promiseCount).to.be(1)
        expect(root.branch.clean.later).to.be(later.promise)

        later.resolve({ ok: true })
        await flushMicrotasks()

        expect(root.branch.clean.later).to.eql({ ok: true })
        verifyRefCounts(testContext, root)
    })

    it("ignores later Errors outside the original pending frontier", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {
            branch: {
                pending: pending.promise,
                stable: {},
            },
        }
        const chain = new Chain(root, testContext)

        const result = hasError(chain, ["branch"], testContext)
        assignPath(chain, ["branch", "stable", "later"], new Error("future"), testContext)

        pending.resolve("done")

        expect(await result).to.be(false)
        expect(hasError(chain, ["branch"], testContext)).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("continues through pending parent paths", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: pending.promise }

        const result = hasError(new Chain(root, testContext), ["branch", "bad"], testContext)

        pending.resolve({ bad: new Error("bad") })

        expect(await result).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("sees errors installed by earlier-issued suspended writes", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }

        // Issued before hasError, suspended on the same promise: its remainder
        // runs first at settlement (FIFO), installs the Error into the counted
        // resolved value, and hasError's wait continuation must observe it.
        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch", "pending", "bad"], new Error("bad"), testContext)
        const result = hasError(rootChain, ["branch"], testContext)

        pending.resolve({})

        expect(await result).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("sees an earlier suspended write remove a transient Error", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch", "pending", "bad"], "fixed", testContext)
        const result = hasError(rootChain, ["branch"], testContext)

        pending.resolve({ bad: new Error("transient") })

        expect(await result).to.be(false)
        expect(root.branch.pending).to.eql({ bad: "fixed" })
        verifyRefCounts(testContext, root)
    })

    it("ignores an Error installed by a later suspended write", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const chain = new Chain({ branch: pending.promise }, testContext)

        const result = hasError(chain, ["branch"], testContext)
        assignPath(chain, ["branch", "bad"], new Error("future"), testContext)
        pending.resolve({})

        expect(await result).to.be(false)
        expect(chain._state.value.branch.bad.message).to.be("future")
        verifyRefCounts(testContext, chain._state.value)
    })

    it("coexists with export on the same pending branch", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const bad = deferred()
        const slow = deferred()
        const root = { branch: { bad: bad.promise, slow: slow.promise } }
        let exported = false

        const rootChain = new Chain(root, testContext)
        const exportedBranch = exportValue(rootChain, ["branch"], testContext)
        exportedBranch.then(
            () => {
                exported = true
            },
            () => {
                exported = true
            },
        )
        const branchHasError = hasError(rootChain, ["branch"], testContext)

        bad.reject("bad")

        expect(await branchHasError).to.be(true)
        expect(exported).to.be(false)

        slow.resolve("done")

        const exportedValue = await exportedBranch
        expect(exportedValue instanceof Error).to.be(true)
        expect(exported).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("coexists with ancestor export when hasError is issued first", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const bad = deferred()
        const slow = deferred()
        const child = { bad: bad.promise }
        const root = { child, slow: slow.promise }
        const chain = new Chain(root, testContext)

        const childHasError = hasError(chain, ["child"], testContext)
        const rootHasError = hasError(chain, [], testContext)
        const exportedRoot = exportValue(chain, [], testContext)

        bad.reject("bad")

        expect(await childHasError).to.be(true)
        expect(await rootHasError).to.be(true)

        slow.resolve("done")
        const exported = await exportedRoot
        expect(exported instanceof Error).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("handles a pending child shared across indexed paths", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = importValue({ left: child, right: child }, { ...testContext, errorContext: "shared child probe" })
        const chain = new Chain(root, testContext)

        const result = hasError(chain, [], testContext)
        pending.reject("shared failure")

        expect(await result).to.be(true)
        expect(getRefCounter(child, testContext).errorCount).to.be(1)
        expect(getRefCounter(root, testContext).errorCount).to.be(2)
        verifyRefCounts(testContext, root)
    })

    it("reuses a node visit across promise barriers", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const shared = { pending: pending.promise }
        lookupPath(new Chain({ shared }, testContext), ["shared"], testContext)

        const delayed = deferred()
        const root = { direct: shared, delayed: delayed.promise }
        const result = hasError(new Chain(root, testContext), [], testContext)

        expect(registrations()).to.be(2)
        delayed.resolve(shared)
        await flushMicrotasks()
        expect(registrations()).to.be(2)

        pending.reject("bad")
        expect(await result).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("keeps concurrent hasError wait trees independent", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }

        const rootChain = new Chain(root, testContext)
        const first = hasError(rootChain, ["branch"], testContext)
        const second = hasError(rootChain, ["branch"], testContext)

        pending.reject("bad")

        expect(await first).to.be(true)
        expect(await second).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("still observes a pending rejection after a later overwrite", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        let settled = false

        const rootChain = new Chain(root, testContext)
        const result = hasError(rootChain, ["branch"], testContext)
        result.then(() => {
            settled = true
        })

        assignPath(rootChain, ["branch", "pending"], "fixed", testContext)
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.reject("late")

        expect(await result).to.be(true)
        expect(root.branch.pending).to.be("fixed")
        verifyRefCounts(testContext, root)
    })

    it("still observes a rejection settled before a later overwrite", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const chain = new Chain({ pending: pending.promise }, testContext)

        const result = hasError(chain, ["pending"], testContext)
        pending.reject("already queued")
        assignPath(chain, ["pending"], "fixed", testContext)

        expect(await result).to.be(true)
        expect(chain._state.value.pending).to.be("fixed")
        verifyRefCounts(testContext, chain._state.value)
    })

    it("does not transfer its wait to a replacement promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const observed = deferred()
        const replacement = deferred()
        const chain = new Chain({ branch: { pending: observed.promise } }, testContext)

        const result = hasError(chain, ["branch"], testContext)
        assignPath(chain, ["branch", "pending"], replacement.promise, testContext)
        observed.resolve("clean")

        expect(await result).to.be(false)
        expect(chain._state.value.branch.pending).to.be(replacement.promise)

        replacement.reject("future error")
        await flushMicrotasks()

        expect(chain._state.value.branch.pending.message).to.be("future error")
        verifyRefCounts(testContext, chain._state.value)
    })

    it("still observes a pending root rejection after a root overwrite", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const chain = new Chain(pending.promise, testContext)
        let settled = false

        const result = hasError(chain, [], testContext)
        result.then(() => {
            settled = true
        })

        assignPath(chain, [], { clean: true }, testContext)
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.reject("late root")

        expect(await result).to.be(true)
        expect(chain._state.value).to.eql({ clean: true })
    })

    it("still observes a pending terminal rejection after a terminal overwrite", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { pending: pending.promise }
        const chain = new Chain(root, testContext)
        let settled = false

        const result = hasError(chain, ["pending"], testContext)
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["pending"], "fixed", testContext)
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.reject("late terminal")

        expect(await result).to.be(true)
        expect(root.pending).to.be("fixed")
        verifyRefCounts(testContext, root)
    })

    it("still probes a pending resolved branch after a later overwrite", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        const chain = new Chain(root, testContext)
        let settled = false

        const result = hasError(chain, ["branch"], testContext)
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["branch", "pending"], "fixed", testContext)
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.resolve({ nested: { bad: new Error("bad") } })

        expect(await result).to.be(true)
        expect(root.branch.pending).to.be("fixed")
        verifyRefCounts(testContext, root)
    })

    it("does not report an imported promise cycle captured before a COW overwrite", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const branch = { pending: pending.promise }
        importValue(branch, { ...testContext, errorContext: "captured hasError cycle" })
        const root = { branch }
        const chain = new Chain(root, testContext)

        const result = hasError(chain, ["branch"], testContext)
        assignPath(chain, ["branch", "pending"], "fixed", testContext)
        pending.resolve(branch)

        expect(await result).to.be(false)
        expect(chain._state.value.branch.pending).to.be("fixed")
        expect(branch.pending).to.be(pending.promise)
        expect(readPath(new Chain(branch, testContext), ["pending"], testContext)).to.be(branch)
        verifyRefCounts(testContext, root, chain._state.value)
    })

    it("follows promises exposed by a Promise version detached before resolution", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: { outer: outer.promise } }, testContext)
        let settled = false

        const result = hasError(chain, ["branch"], testContext)
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["branch", "outer"], "fixed", testContext)
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expect(settled).to.be(false)

        inner.reject("private nested error")

        expect(await result).to.be(true)
        expect(chain._state.value.branch.outer).to.be("fixed")
        verifyRefCounts(testContext, chain._state.value)
    })

    it("still probes a nested promise detached after it was discovered", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: { outer: outer.promise } }, testContext)

        const result = hasError(chain, ["branch"], testContext)
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        assignPath(chain, ["branch", "outer", "inner"], "fixed", testContext)
        inner.reject("detached error")

        expect(await result).to.be(true)
        expect(chain._state.value.branch.outer.inner).to.be("fixed")
        verifyRefCounts(testContext, chain._state.value)
    })

    it("still observes a pending parent rejection after a parent-path overwrite", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: pending.promise }
        const chain = new Chain(root, testContext)
        let settled = false

        const result = hasError(chain, ["branch", "bad"], testContext)
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["branch"], { clean: true }, testContext)
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.reject("late parent")

        expect(await result).to.be(true)
        expect(root.branch).to.eql({ clean: true })
        verifyRefCounts(testContext, root)
    })

    it("waits for a detached promise to settle before answering false", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        let settled = false

        const rootChain = new Chain(root, testContext)
        const result = hasError(rootChain, ["branch"], testContext)
        result.then(() => {
            settled = true
        })

        deletePath(rootChain, ["branch", "pending"], testContext)
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.resolve("ignored")

        expect(await result).to.be(false)
        expect(root.branch).to.eql({})
        verifyRefCounts(testContext, root)
    })
})
