import { publishPromiseVersion, getPromiseVersion } from "../src/property-versions.js"
import {
    Chain,
    assignPath,
    deletePath,
    hasError,
    lookupPath,
    run,
    export as exportValue,
    import as importValue,
    Execution,
} from "../src/index.js"
import { failExecution as submitFatal, ERROR_KIND } from "../src/error.js"
import { consumeValue, continueOperation, runInternalStep } from "../src/internal-step.js"
import { buildRefIndex, getRefCounter } from "../src/refcounts.js"
import { hasCycleCut } from "./support.js"
import { metaOf } from "../src/meta.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import * as path from "path"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function failsClassification(failure) {
    return new Proxy({}, {
        getPrototypeOf() {
            throw failure
        },
    })
}

import {
    expect,
    readPath,
    countPromiseRegistrations,
    deferred,
    flushMicrotasks,
    expectCounts,
    errorCause,
    thrownBy,
} from "./support.js"

describe("promise helpers", () => {
    it("keeps source reactions in registration order", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const order = []

        consumeValue(pending.promise, testContext, ERROR_KIND.OperationInputFailed, () => order.push("value 1"))
        continueOperation(pending.promise, testContext, () => order.push("later"), () => order.push("later"))
        consumeValue(pending.promise, testContext, ERROR_KIND.OperationInputFailed, () => order.push("value 2"))

        pending.resolve("done")
        await flushMicrotasks()

        expect(order).to.eql(["value 1", "later", "value 2"])
    })

    it("does not inspect a non-Error rejection reason", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        let inspections = 0
        const reason = new Proxy({}, {
            get() {
                inspections++
                throw new Error("rejection reason was read")
            },
            getPrototypeOf() {
                inspections++
                throw new Error("rejection reason was classified")
            },
        })
        const chain = new Chain({ branch: pending.promise }, testContext)
        const first = lookupPath(chain, ["branch"], testContext)
        const second = lookupPath(chain, ["branch"], testContext)

        pending.reject(reason)
        const [firstValue, secondValue] = await Promise.all([first, second])

        expect(inspections).to.be(0)
        expect(firstValue).to.be(secondValue)
        expect(firstValue.cause).to.be(reason)
        expect(chain._state.value.branch).to.be(firstValue)
    })

    it("passes rejected data promises to continuations as Error values", async () => {
        const value = await consumeValue(
            Promise.reject("data boom"),
            { execution: new Execution(), errorContext: "test operation" },
            ERROR_KIND.OperationInputFailed,
            value => value,
        )

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("data boom")
    })

    it("leaves returned Promises to their owning async boundary", () => {
        const promise = Promise.resolve("ready")

        expect(runInternalStep({ execution: new Execution(), errorContext: "test operation" }, () => promise)).to.be(promise)
    })

    it("does not convert continuation throws into language Error values", async () => {
        let testContext
        const fatal = new TypeError("runtime bug")
        let reported
        let caught

        testContext = { execution: new Execution(error => {
            reported = error
        }), errorContext: "test operation" }
        try {
            await consumeValue(Promise.resolve("ok"), testContext, ERROR_KIND.OperationInputFailed, () => {
                throw fatal
            })
        } catch (error) {
            caught = error
        }

        expect(errorCause(caught)).to.be(fatal)
        expect(reported).to.be(caught)
    })

    it("reports once while a later internal wrapper stops", async () => {
        let testContext
        const fatal = new TypeError("nested runtime bug")
        let reportCount = 0
        let caught

        testContext = { execution: new Execution(() => {
            reportCount++
        }), errorContext: "test operation" }
        try {
            await continueOperation(
                consumeValue(Promise.resolve("ok"), testContext, ERROR_KIND.OperationInputFailed, () => submitFatal(testContext, fatal)),
                testContext,
                value => value,
            )
        } catch (error) {
            caught = error
        }

        expect(reportCount).to.be(1)
        expect(caught).to.be(undefined)
    })

    it("reports internal promise rejections as fatal errors", async () => {
        let testContext
        const fatal = new TypeError("runtime bug")
        let reported
        let caught

        testContext = { execution: new Execution(error => {
            reported = error
        }), errorContext: "test operation" }
        try {
            await continueOperation(Promise.reject(fatal), testContext, () => "ignored")
        } catch (error) {
            caught = error
        }

        expect(errorCause(caught)).to.be(fatal)
        expect(reported).to.be(caught)
    })

    it("throws the original fatal error when the fatal reporter throws", () => {
        let testContext
        const fatal = new TypeError("runtime bug")
        const reporterBug = new Error("reporter bug")
        let reported
        let caught

        testContext = { execution: new Execution(error => {
            reported = error
            throw reporterBug
        }), errorContext: "test operation" }
        try {
            runInternalStep(testContext, () => {
                throw fatal
            })
        } catch (error) {
            caught = error
        }

        expect(errorCause(caught)).to.be(fatal)
        expect(reported).to.be(caught)
    })

    it("reports losing internal race rejections after the race has settled", async () => {
        let testContext
        const cleanWait = deferred()
        const fatal = new Error("late internal failure")
        let reported

        testContext = { execution: new Execution(error => {
            reported = error
        }), errorContext: "test operation" }
        const race = Promise.race([
            Promise.resolve(true),
            continueOperation(cleanWait.promise, testContext, () => false),
        ])

        expect(await race).to.be(true)
        cleanWait.reject(fatal)
        await flushMicrotasks()

        expect(errorCause(reported)).to.be(fatal)
    })

    it("materializes suspended descriptor-restricted mutations", () => {
        const fixture = path.join(__dirname, "fixtures", "suspended-mutator-fatal.js")
        const child = spawnSync(process.execPath, [fixture], { encoding: "utf8" })

        expect(child.status).to.be(0)
        expect(JSON.parse(child.stdout)).to.eql({
            returnsUndefined: true,
            reportCount: 0,
            unhandledCount: 0,
            messages: [],
            valuesUnchanged: true,
        })
    })

})

describe("Promise versions and lookupPath", () => {
    it("rejects a Promise before advancing a property version", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {}
        assignPath(new Chain(root, testContext), ["value"], pending.promise, testContext)
        const promiseVersion = getPromiseVersion(root, "value", testContext)

        const error = thrownBy(() => {
            publishPromiseVersion(
                root,
                "value",
                promiseVersion,
                { value: Promise.resolve("replacement"), present: true },
                testContext,
            )
        })

        expect(error.message).to.be(
            "A Promise requires a fresh property version",
        )
        expect(root.value).to.be(pending.promise)
        expect(promiseVersion.value).to.be(pending.promise)

        pending.resolve("settled")
        await flushMicrotasks()
        expect(root.value).to.be("settled")
    })

    it("keeps one authoritative value before and after detachment", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const livePending = deferred()
        const liveRoot = {}
        assignPath(new Chain(liveRoot, testContext), ["value"], livePending.promise, testContext)
        const liveVersion = metaOf(liveRoot, testContext).placementVersions.value

        expect(getPromiseVersion(liveRoot, "value", testContext)).to.be(liveVersion)
        expect(liveVersion.value).to.be(livePending.promise)

        livePending.resolve("live")
        await flushMicrotasks()

        expect(getPromiseVersion(liveRoot, "value", testContext)).to.be(liveVersion)
        expect(liveRoot.value).to.be("live")
        expect(liveVersion.value).to.be("live")

        const detachedPending = deferred()
        const detachedRoot = {}
        const detachedChain = new Chain(detachedRoot, testContext)
        assignPath(detachedChain, ["value"], detachedPending.promise, testContext)
        const detachedVersion = metaOf(detachedRoot, testContext).placementVersions.value
        assignPath(detachedChain, ["value"], "replacement", testContext)

        expect(getPromiseVersion(detachedRoot, "value", testContext)).to.be(undefined)
        expect(detachedVersion.value).to.be(detachedPending.promise)

        detachedPending.resolve("detached")
        await flushMicrotasks()

        expect(getPromiseVersion(detachedRoot, "value", testContext)).to.be(undefined)
        expect(detachedVersion.value).to.be("detached")
        expect(detachedRoot.value).to.be("replacement")
    })

    it("publishes uninspectable settled values as external", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const failure = new Error("settled value reflection failed")
        const settled = failsClassification(failure)
        const chain = new Chain([], testContext)

        expect(run(chain, [], "push", [pending.promise], testContext, { repair: false, mutationScopeDepth: 0 })).to.be(1)
        pending.resolve(settled)
        await flushMicrotasks()

        expect(readPath(chain, ["0"], testContext)).to.be(settled)
        verifyRefCounts(testContext, chain._state.value)
    })

    it("counts settlement reflection failures in indexed values", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const failure = new Error("indexed value reflection failed")
        const root = { value: pending.promise }
        const chain = new Chain(root, testContext)
        buildRefIndex(root, testContext)

        pending.resolve(new Proxy({}, {
            ownKeys() {
                throw failure
            },
        }))
        await flushMicrotasks()

        expect(errorCause(root.value)).to.be(failure)
        expect(errorCause(readPath(chain, ["value"], testContext))).to.be(failure)
        verifyRefCounts(testContext, root)
    })

    it("keeps the settled value when optional writeback preflight fails", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const failure = new Error("publication reflection failed")
        let failReflection = false
        const physical = { value: pending.promise }
        const root = new Proxy(physical, {
            getOwnPropertyDescriptor(target, key) {
                if (failReflection && key === "value") throw failure
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const chain = new Chain(root, testContext)
        const observed = lookupPath(chain, ["value"], testContext)

        failReflection = true
        pending.resolve("resolved")

        const outcome = await observed
        failReflection = false
        expect(outcome).to.be("resolved")
        expect(physical.value).to.be(pending.promise)
        expect(readPath(chain, ["value"], testContext)).to.be("resolved")
        verifyRefCounts(testContext, root)
    })

    it("keeps the settled value when optional writeback fails", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const failure = new Error("Promise writeback failed")
        const physical = { value: pending.promise }
        const root = new Proxy(physical, {
            set() {
                throw failure
            },
        })
        const chain = new Chain(root, testContext)
        buildRefIndex(root, testContext)
        const observed = lookupPath(chain, ["value"], testContext)

        pending.resolve("resolved")

        expect(await observed).to.be("resolved")
        expect(physical.value).to.be(pending.promise)
        expect(readPath(chain, ["value"], testContext)).to.be("resolved")
        verifyRefCounts(testContext, root)
    })

    it("keeps uninspectable settled values on detached versions", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const failure = new Error("detached value reflection failed")
        const settled = failsClassification(failure)
        const root = { value: pending.promise }
        const chain = new Chain(root, testContext)
        const observed = lookupPath(chain, ["value"], testContext)

        assignPath(chain, ["value"], "replacement", testContext)
        pending.resolve(settled)

        expect(await observed).to.be(settled)
        expect(root.value).to.be("replacement")
        verifyRefCounts(testContext, root)
    })

    it("writes through existing writable properties on sealed holders", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const error = new Error("settled")
        const value = { error }
        const root = {}

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["value"], pending.promise, testContext)
        buildRefIndex(root, testContext)
        const observed = lookupPath(rootChain, ["value"], testContext)

        Object.seal(root)
        expectCounts(testContext, root, 1, 0)

        pending.resolve(value)
        expect(await observed).to.be(value)
        await flushMicrotasks()

        expect(root.value).to.be(value)
        expect(hasError(rootChain, [], testContext)).to.be(true)
        expect(errorCause(exportValue(rootChain, [], testContext))).to.be(error)
        verifyRefCounts(testContext, root)
    })

    it("prepares a resolved value when its owner becomes indexed first", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const nested = deferred()
        const root = {}

        assignPath(new Chain(root, testContext), ["value"], pending.promise, testContext)
        continueOperation(pending.promise, testContext, () => buildRefIndex(root, testContext), () => buildRefIndex(root, testContext))

        pending.resolve({ bad: new Error("bad"), nested: nested.promise })
        await flushMicrotasks()

        expectCounts(testContext, root, 1, 1)
        expectCounts(testContext, root.value, 1, 1)
        verifyRefCounts(testContext, root)

        nested.resolve("done")
        await flushMicrotasks()

        expectCounts(testContext, root, 0, 1)
        verifyRefCounts(testContext, root)
    })

    it("publishes a resolved value and its cycle cut atomically", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { value: pending.promise }
        new Chain(importValue(root, { ...testContext, errorContext: "atomic cycle cut" }), testContext)
        buildRefIndex(root, testContext)
        let publishedCycleCut
        let countsAfterPublication

        continueOperation(pending.promise, testContext, () => {
            publishedCycleCut = hasCycleCut(root, "value", testContext)
            const { frontierCount, errorCount } = getRefCounter(root, testContext)
            countsAfterPublication = { frontierCount, errorCount }
        }, () => {
            publishedCycleCut = hasCycleCut(root, "value", testContext)
            const { frontierCount, errorCount } = getRefCounter(root, testContext)
            countsAfterPublication = { frontierCount, errorCount }
        })

        pending.resolve(root)
        await flushMicrotasks()

        expect(root.value).to.be(pending.promise)
        expect(readPath(new Chain(root, testContext), ["value"], testContext)).to.be(root)
        expect(publishedCycleCut).to.be(true)
        expect(countsAfterPublication).to.eql({
            frontierCount: 1,
            errorCount: 0,
        })
        expect(hasCycleCut(root, "value", testContext)).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("does not copy a committed cycle cut into a replacement Promise version", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const owner = {}
        owner.value = owner
        importValue(owner, { ...testContext, errorContext: "marked Promise version replacement" })
        const pending = deferred()
        const retained = new Chain(owner, testContext)
        const chain = new Chain(owner, testContext)

        buildRefIndex(owner, testContext)
        expect(metaOf(owner, testContext).cycleCuts.has("value")).to.be(true)

        assignPath(chain, ["value"], pending.promise, testContext)
        const copy = chain._state.value
        const promiseVersion = metaOf(copy, testContext).placementVersions.value

        expect(copy).not.to.be(owner)
        expect(metaOf(copy, testContext).placementVersions.value).to.be(promiseVersion)
        expect(copy.value).to.be(pending.promise)
        expect(metaOf(copy, testContext).cycleCuts).to.be(undefined)
        expect(metaOf(owner, testContext).cycleCuts.has("value")).to.be(true)
        expectCounts(testContext, copy, 1, 0)
        verifyRefCounts(testContext, owner, copy)
    })

    it("keeps owned promise results mutable until they escape", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = {}

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["value"], deferredValue.promise, testContext)
        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        const value = root.value
        assignPath(rootChain, ["value", "x"], 2, testContext)

        expect(root.value).to.be(value)
        expect(value.x).to.be(2)
    })

    it("writes a resolved promise back to its key", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = {}

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["value"], deferredValue.promise, testContext)
        const read = lookupPath(rootChain, ["value"], testContext)

        expect(root.value).to.be(deferredValue.promise)
        expect(typeof read.then).to.be("function")

        deferredValue.resolve({ x: 1 })
        const value = await read

        expect(root.value).to.be(value)
        expect(value).to.eql({ x: 1 })

        const wrapper = { value }
        assignPath(new Chain(wrapper, testContext), ["value", "x"], 2, testContext)

        expect(wrapper.value).not.to.be(value)
        expect(value.x).to.be(1)
        expect(wrapper.value.x).to.be(2)
    })

    it("can read a promised value without sharing ownership", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = {}

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["value"], deferredValue.promise, testContext)
        const read = readPath(rootChain, ["value"], testContext)

        deferredValue.resolve({ x: 1 })
        const value = await read

        assignPath(rootChain, ["value", "x"], 2, testContext)

        expect(root.value).to.be(value)
        expect(value.x).to.be(2)
    })

    it("preserves promises that resolve to undefined", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const registrations = countPromiseRegistrations(deferredValue.promise)
        const root = {}

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["value"], deferredValue.promise, testContext)
        const read = lookupPath(rootChain, ["value"], testContext)

        deferredValue.resolve(undefined)
        const value = await read
        await flushMicrotasks()

        expect(value).to.be(undefined)
        expect(root.value).to.be(undefined)
        const before = registrations()
        expect(lookupPath(rootChain, ["value"], testContext)).to.be(undefined)
        expect(registrations()).to.be(before)
    })

    it("applies writes to an already-settled assigned promise in FIFO order", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        const promise = Promise.resolve({})

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch"], promise, testContext)
        assignPath(rootChain, ["branch", "x"], 1, testContext)
        await flushMicrotasks()

        expect(root.branch).to.eql({ x: 1 })
    })

    it("applies pending intermediate writes in program order", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch", "a"], 1, testContext)
        assignPath(rootChain, ["branch", "b"], 2, testContext)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root.branch).to.eql({ a: 1, b: 2 })
    })

    it("orders writes through two nested pending promises", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const root = { branch: outer.promise }

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch", "inner", "x"], 1, testContext)
        assignPath(rootChain, ["branch", "inner", "x"], 2, testContext)

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()
        inner.resolve({})
        await flushMicrotasks()

        expect(root.branch.inner).to.eql({ x: 2 })
    })

    it("makes a suspended lookupPath observe its own program position", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const rootChain = new Chain(root, testContext)
        const read = lookupPath(rootChain, ["branch"], testContext)
        assignPath(rootChain, ["branch", "x"], 1, testContext)

        deferredBranch.resolve({})
        const readValue = await read
        await flushMicrotasks()

        expect(readValue).to.eql({})
        expect(root.branch).to.eql({ x: 1 })
        expect(root.branch).not.to.be(readValue)
    })

    it("continues lookupPath through a pending intermediate promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const read = lookupPath(new Chain(root, testContext), ["branch", "value"], testContext)

        deferredBranch.resolve({ value: { x: 1 } })
        const value = await read

        expect(value).to.eql({ x: 1 })

        const wrapper = { value }
        assignPath(new Chain(wrapper, testContext), ["value", "x"], 2, testContext)

        expect(wrapper.value).not.to.be(value)
        expect(value.x).to.be(1)
        expect(wrapper.value.x).to.be(2)
    })

    it("returns Error when a promise exposes a missing intermediate", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const result = lookupPath(
            new Chain({ parent: pending.promise }, testContext),
            ["parent", "missing", "value"],
            testContext,
        )

        pending.resolve({})
        const value = await result

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("marks shared lookup results before later writes resume", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const rootChain = new Chain(root, testContext)
        const read = lookupPath(rootChain, ["branch", "value"], testContext)
        assignPath(rootChain, ["branch", "value", "x"], 2, testContext)

        deferredBranch.resolve({ value: { x: 1 } })
        const value = await read
        await flushMicrotasks()

        expect(value).to.eql({ x: 1 })
        expect(root.branch.value).to.eql({ x: 2 })
        expect(root.branch.value).not.to.be(value)
    })

    it("marks shared nested promise lookups before later nested writes resume", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const deferredValue = deferred()
        const root = { branch: deferredBranch.promise }

        const rootChain = new Chain(root, testContext)
        const read = lookupPath(rootChain, ["branch", "value"], testContext)
        assignPath(rootChain, ["branch", "value", "x"], 2, testContext)

        deferredBranch.resolve({ value: deferredValue.promise })
        await flushMicrotasks()
        deferredValue.resolve({ x: 1 })
        const value = await read
        await flushMicrotasks()

        expect(value).to.eql({ x: 1 })
        expect(root.branch.value).to.eql({ x: 2 })
        expect(root.branch.value).not.to.be(value)
    })

    it("continues a nested lookup after a later ancestor replacement", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise }, testContext)

        const read = lookupPath(chain, ["branch", "inner", "value"], testContext)
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        assignPath(chain, ["branch"], { replacement: true }, testContext)
        inner.resolve({ value: { observed: true } })

        expect(await read).to.eql({ observed: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("continues through promises exposed after its first Promise version is detached", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise }, testContext)

        const read = lookupPath(chain, ["branch", "inner", "value"], testContext)
        assignPath(chain, ["branch"], { replacement: true }, testContext)
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        inner.resolve({ value: { observed: true } })

        expect(await read).to.eql({ observed: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("does not transfer a pending lookup to a replacement promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const observed = deferred()
        const replacement = deferred()
        const chain = new Chain({ branch: observed.promise }, testContext)

        const read = lookupPath(chain, ["branch"], testContext)
        assignPath(chain, ["branch"], replacement.promise, testContext)
        observed.resolve({ observed: true })

        expect(await read).to.eql({ observed: true })
        expect(chain._state.value.branch).to.be(replacement.promise)

        replacement.resolve({ replacement: true })
        await flushMicrotasks()

        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("can read through a pending intermediate promise without sharing ownership", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const rootChain = new Chain(root, testContext)
        const read = readPath(rootChain, ["branch", "value"], testContext)

        deferredBranch.resolve({ value: { x: 1 } })
        const value = await read

        assignPath(rootChain, ["branch", "value", "x"], 2, testContext)

        expect(root.branch.value).to.be(value)
        expect(value.x).to.be(2)
    })

    it("shadows non-enumerable imported properties when a suspended mutation resumes", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const externalBranch = {}
        const root = {}
        Object.defineProperty(externalBranch, "x", {
            value: 1,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch"], importValue(deferredBranch.promise, { ...testContext, errorContext: "hidden resume" }), testContext)
        assignPath(rootChain, ["branch", "x"], 2, testContext)

        deferredBranch.resolve(externalBranch)
        await flushMicrotasks()

        expect(root.branch).not.to.be(externalBranch)
        expect(externalBranch.x).to.be(1)
        expect(Object.prototype.propertyIsEnumerable.call(externalBranch, "x")).to.be(false)
        expect(root.branch.x).to.be(2)
        expect(Object.prototype.propertyIsEnumerable.call(root.branch, "x")).to.be(true)
    })

    it("forks Promise versions when a pending key is shallow-copied", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root, testContext), ["branch", "before"], 1, testContext)
        importValue(root, testContext)

        const leftChain = new Chain(root, testContext)
        const rightChain = new Chain(root, testContext)
        assignPath(leftChain, ["left"], true, testContext)
        assignPath(rightChain, ["right"], true, testContext)
        const left = leftChain._state.value
        const right = rightChain._state.value

        assignPath(leftChain, ["branch", "leftOnly"], 2, testContext)
        assignPath(rightChain, ["branch", "rightOnly"], 3, testContext)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(left.branch).to.eql({ before: 1, leftOnly: 2 })
        expect(right.branch).to.eql({ before: 1, rightOnly: 3 })
        expect(left.branch).not.to.be(right.branch)
    })

    it("turns a rejected forked pending key into Error values in both worlds", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root, testContext), ["branch", "before"], 1, testContext)
        importValue(root, testContext)

        const leftChain = new Chain(root, testContext)
        const rightChain = new Chain(root, testContext)
        assignPath(leftChain, ["left"], true, testContext)
        assignPath(rightChain, ["right"], true, testContext)
        const left = leftChain._state.value
        const right = rightChain._state.value

        assignPath(leftChain, ["branch", "leftOnly"], 2, testContext)
        assignPath(rightChain, ["branch", "rightOnly"], 3, testContext)

        deferredBranch.reject("fork boom")
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        const rootError = readPath(new Chain(root, testContext), ["branch"], testContext)
        expect(rootError instanceof Error).to.be(true)
        expect(rootError.message).to.be("fork boom")
        expect(left.branch instanceof Error).to.be(true)
        expect(left.branch.message).to.be("fork boom")
        expect(right.branch instanceof Error).to.be(true)
        expect(right.branch.message).to.be("fork boom")
    })

    it("keeps a replaced pending branch independent of its retained source", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        lookupPath(new Chain(root, testContext), [], testContext)
        const chain = new Chain(root, testContext)
        assignPath(chain, ["branch"], { replacement: true }, testContext)
        const next = chain._state.value

        deferredBranch.resolve({ x: 1 })
        await flushMicrotasks()

        const oldBranch = await lookupPath(new Chain(root, testContext), ["branch"], testContext)
        const oldBranchChain = new Chain(oldBranch, testContext)
        assignPath(oldBranchChain, ["x"], 2, testContext)

        expect(next.branch).to.eql({ replacement: true })
        expect(oldBranchChain._state.value).to.eql({ x: 2 })
        expect(oldBranch.x).to.be(1)
    })

    it("copies through a promised path key under a shared root", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        lookupPath(new Chain(root, testContext), [], testContext)
        const chain = new Chain(root, testContext)
        assignPath(chain, ["branch", "x"], 1, testContext)
        const next = chain._state.value

        deferredBranch.resolve({ y: 2 })
        await flushMicrotasks()

        const oldBranch = await readPath(new Chain(root, testContext), ["branch"], testContext)

        expect(oldBranch).to.eql({ y: 2 })
        expect(next.branch).to.eql({ y: 2, x: 1 })
        expect(next.branch).not.to.be(oldBranch)
    })

    it("turns a rejected promise into an Error value", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        const read = lookupPath(new Chain(root, testContext), ["value"], testContext)
        deferredValue.reject("boom")

        const value = await read

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("boom")
        expect(root.value).to.be(value)
    })

    it("turns an assigned rejected promise into an Error value", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredValue = deferred()
        const root = {}

        assignPath(new Chain(root, testContext), ["value"], deferredValue.promise, testContext)
        deferredValue.reject("assigned boom")
        await flushMicrotasks()

        expect(root.value instanceof Error).to.be(true)
        expect(root.value.message).to.be("assigned boom")
    })

    it("turns an already-rejected assigned promise into an Error value", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}

        assignPath(new Chain(root, testContext), ["value"], Promise.reject("already rejected"), testContext)
        await flushMicrotasks()

        expect(root.value instanceof Error).to.be(true)
        expect(root.value.message).to.be("already rejected")
    })

    it("stops at a rejected intermediate promise instead of autovivifying", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root, testContext), ["branch", "x"], 1, testContext)
        deferredBranch.reject("nope")
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("nope")
    })

    it("turns a promised primitive intermediate into Error", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root, testContext), ["branch", "x"], 1, testContext)
        deferredBranch.resolve(7)
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("turns a promised null intermediate into Error", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root, testContext), ["branch", "x"], 1, testContext)
        deferredBranch.resolve(null)
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("keeps two keys holding the same imported promise independent", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const importedBranch = importValue(deferredBranch.promise, testContext)
        const root = {
            left: importedBranch,
            right: importedBranch,
        }

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["left", "x"], 1, testContext)
        assignPath(rootChain, ["right", "y"], 2, testContext)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root.left).to.eql({ x: 1 })
        expect(root.right).to.eql({ y: 2 })
        expect(root.left).not.to.be(root.right)
    })

    it("treats re-placing the same promise as a fresh Promise version", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = {}

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch"], deferredBranch.promise, testContext)
        const firstRead = lookupPath(rootChain, ["branch"], testContext)

        assignPath(rootChain, ["branch"], deferredBranch.promise, testContext)
        assignPath(rootChain, ["branch", "x"], 1, testContext)

        deferredBranch.resolve({})
        const firstValue = await firstRead
        await flushMicrotasks()

        expect(firstValue).to.eql({})
        expect(root.branch).to.eql({ x: 1 })
        expect(root.branch).not.to.be(firstValue)
    })

    it("treats replacing one pending promise with another as a fresh Promise version", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = deferred()
        const second = deferred()
        const root = {}

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch"], first.promise, testContext)
        assignPath(rootChain, ["branch"], second.promise, testContext)

        first.resolve({ stale: true })
        await flushMicrotasks()
        expect(root.branch).to.be(second.promise)

        second.resolve({ fresh: true })
        await flushMicrotasks()
        expect(root.branch).to.eql({ fresh: true })
    })

    it("forks a settled-but-unreplaced promise key", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = {}
        const promise = Promise.resolve({})

        assignPath(new Chain(root, testContext), ["branch"], promise, testContext)
        importValue(root, testContext)

        const chain = new Chain(root, testContext)
        assignPath(chain, ["added"], true, testContext)
        const next = chain._state.value
        assignPath(chain, ["branch", "x"], 1, testContext)

        await flushMicrotasks()

        expect(root.branch).to.eql({})
        expect(next.branch).to.eql({ x: 1 })
        expect(next.branch).not.to.be(root.branch)
    })

    it("does not recreate a deleted path when a suspended write resumes", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch", "x"], 1, testContext)
        deletePath(rootChain, ["branch"], testContext)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root).to.eql({})
    })

    it("does not overwrite a later reassignment when a suspended write resumes", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch", "x"], 1, testContext)
        assignPath(rootChain, ["branch"], { replacement: true }, testContext)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root.branch).to.eql({ replacement: true })
    })

    it("confines a nested suspended write after an ancestor is replaced", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise }, testContext)

        assignPath(chain, ["branch", "inner", "x"], 1, testContext)
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        const discardedBranch = chain._state.value.branch
        assignPath(chain, ["branch"], { replacement: true }, testContext)
        inner.resolve({})
        await flushMicrotasks()

        expect(discardedBranch.inner).to.eql({ x: 1 })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("continues a suspended write through a Promise version detached before settlement", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise }, testContext)
        const discardedBranch = { inner: inner.promise }

        assignPath(chain, ["branch", "inner", "x"], 1, testContext)
        const retained = new Chain(lookupPath(chain, ["branch"], testContext), testContext)
        assignPath(chain, ["branch"], { replacement: true }, testContext)
        outer.resolve(discardedBranch)
        await flushMicrotasks()

        inner.resolve({})
        await flushMicrotasks()

        expect(await exportValue(retained, [], testContext)).to.eql({ inner: { x: 1 } })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("deletes through a pending branch once it resolves", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        deletePath(new Chain(root, testContext), ["branch", "x"], testContext)

        deferredBranch.resolve({ x: 1, y: 2 })
        await flushMicrotasks()

        expect(root.branch).to.eql({ y: 2 })
    })

    it("confines a nested suspended delete after an ancestor is replaced", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise }, testContext)

        deletePath(chain, ["branch", "inner", "remove"], testContext)
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        const discardedBranch = chain._state.value.branch
        assignPath(chain, ["branch"], { replacement: true }, testContext)
        inner.resolve({ keep: true, remove: true })
        await flushMicrotasks()

        expect(discardedBranch.inner).to.eql({ keep: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("orders assignment before delete through the same pending branch", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch", "x"], 2, testContext)
        deletePath(rootChain, ["branch", "x"], testContext)

        deferredBranch.resolve({ x: 1, y: 3 })
        await flushMicrotasks()

        expect(root.branch).to.eql({ y: 3 })
    })

    it("orders delete before assignment through the same pending branch", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const rootChain = new Chain(root, testContext)
        deletePath(rootChain, ["branch", "x"], testContext)
        assignPath(rootChain, ["branch", "x"], 2, testContext)

        deferredBranch.resolve({ x: 1, y: 3 })
        await flushMicrotasks()

        expect(root.branch).to.eql({ y: 3, x: 2 })
    })

    describe("sequential operation schedules", () => {
        it("makes a read between two writes observe only the first write", async () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const pending = deferred()
            const chain = new Chain({ branch: pending.promise }, testContext)

            assignPath(chain, ["branch", "x"], 1, testContext)
            const observed = lookupPath(chain, ["branch"], testContext)
            assignPath(chain, ["branch", "x"], 2, testContext)

            pending.resolve({})
            const value = await observed
            await flushMicrotasks()

            expect(value).to.eql({ x: 1 })
            expect(chain._state.value.branch).to.eql({ x: 2 })
            expect(chain._state.value.branch).not.to.be(value)
        })

        it("orders delete, read, and write through one pending branch", async () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const pending = deferred()
            const chain = new Chain({ branch: pending.promise }, testContext)

            deletePath(chain, ["branch", "x"], testContext)
            const observed = lookupPath(chain, ["branch", "x"], testContext)
            assignPath(chain, ["branch", "x"], 2, testContext)

            pending.resolve({ x: 1 })

            expect(await observed).to.be(undefined)
            await flushMicrotasks()
            expect(chain._state.value.branch).to.eql({ x: 2 })
        })

        it("preserves a read position through two promise barriers", async () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const outer = deferred()
            const inner = deferred()
            const chain = new Chain({ branch: outer.promise }, testContext)

            assignPath(chain, ["branch", "inner", "x"], 1, testContext)
            const observed = lookupPath(chain, ["branch", "inner"], testContext)
            assignPath(chain, ["branch", "inner", "x"], 2, testContext)

            outer.resolve({ inner: inner.promise })
            await flushMicrotasks()
            inner.resolve({})

            const value = await observed
            await flushMicrotasks()
            expect(value).to.eql({ x: 1 })
            expect(chain._state.value.branch.inner).to.eql({ x: 2 })
            expect(chain._state.value.branch.inner).not.to.be(value)
        })

        it("preserves a root read position between root writes", async () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const pending = deferred()
            const chain = new Chain(pending.promise, testContext)

            assignPath(chain, ["x"], 1, testContext)
            const observed = lookupPath(chain, [], testContext)
            assignPath(chain, ["x"], 2, testContext)

            pending.resolve({})

            const value = await observed
            await flushMicrotasks()
            expect(value).to.eql({ x: 1 })
            expect(chain._state.value).to.eql({ x: 2 })
            expect(chain._state.value).not.to.be(value)
        })
    })

    it("keeps indexed keys sharing one imported promise independent", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const imported = importValue(pending.promise, { ...testContext, errorContext: "shared promise" })
        const root = { left: imported, right: imported }
        const chain = new Chain(root, testContext)

        buildRefIndex(root, testContext)
        assignPath(chain, ["left", "x"], 1, testContext)
        assignPath(chain, ["right", "y"], 2, testContext)
        const exported = exportValue(chain, [], testContext)
        const foundError = hasError(chain, [], testContext)

        expectCounts(testContext, root, 2, 0)
        pending.resolve({})

        expect(await foundError).to.be(false)
        const exportedValue = await exported
        expect(exportedValue).not.to.be(root)
        expect(exportedValue).to.eql({
            left: { x: 1 },
            right: { y: 2 },
        })
        expect(root.left).to.eql({ x: 1 })
        expect(root.right).to.eql({ y: 2 })
        expect(root.left).not.to.be(root.right)
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("marks a promise exposed beneath its own result without replacing it", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = {
            value: importValue(pending.promise, { ...testContext, errorContext: "self promise" }),
        }
        const chain = new Chain(root, testContext)
        const exported = exportValue(chain, [], testContext)
        const foundError = hasError(chain, [], testContext)
        const resolved = { again: pending.promise }

        pending.resolve(resolved)

        const exportedValue = await exported
        expect(exportedValue).not.to.be(root)
        expect(exportedValue.value.again).to.be(exportedValue.value)
        expect(await foundError).to.be(false)
        expect(resolved.again).to.be(pending.promise)
        expect(readPath(new Chain(resolved, testContext), ["again"], testContext)).to.be(resolved)
        expect(hasCycleCut(resolved, "again", testContext)).to.be(true)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)
    })

    it("cuts a cycle closed by a second promise without replacing it", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = deferred()
        const second = deferred()
        const root = {
            value: importValue(first.promise, { ...testContext, errorContext: "two-promise cycle" }),
        }
        const chain = new Chain(root, testContext)
        const exported = exportValue(chain, [], testContext)
        const foundError = hasError(chain, [], testContext)
        const firstValue = { next: second.promise }
        const secondValue = { back: firstValue }

        first.resolve(firstValue)
        second.resolve(secondValue)

        const exportedValue = await exported
        expect(exportedValue).not.to.be(root)
        expect(exportedValue.value.next.back).to.be(exportedValue.value)
        expect(await foundError).to.be(false)
        expect(firstValue.next).to.be(second.promise)
        expect(readPath(new Chain(firstValue, testContext), ["next"], testContext)).to.be(
            secondValue,
        )
        expect(
            hasCycleCut(firstValue, "next", testContext) ||
            hasCycleCut(secondValue, "back", testContext),
        ).to.be(true)
        expectCounts(testContext, root, 1, 0)
        verifyRefCounts(testContext, root)
    })
})

describe("root promises", () => {
    it("chains root-level assignments through the Chain state slot", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredRoot = deferred()
        const chain = new Chain(deferredRoot.promise, testContext)

        assignPath(chain, ["a"], 1, testContext)
        assignPath(chain, ["b"], 2, testContext)

        expect(chain._state.value).to.be.a(Promise)

        deferredRoot.resolve({})
        await flushMicrotasks()

        expect(chain._state.value).to.eql({ a: 1, b: 2 })
    })

    it("looks up through a root promise with shared ownership", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredRoot = deferred()
        const chain = new Chain(deferredRoot.promise, testContext)
        const root = { branch: { x: 1 } }
        const oldBranch = root.branch

        const read = lookupPath(chain, ["branch"], testContext)
        deferredRoot.resolve(root)
        const value = await read
        assignPath(chain, ["branch", "x"], 2, testContext)

        expect(value).to.be(oldBranch)
        expect(root.branch).not.to.be(oldBranch)
        expect(oldBranch.x).to.be(1)
        expect(root.branch.x).to.be(2)
    })

    it("looks up through a root promise without sharing ownership", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredRoot = deferred()
        const chain = new Chain(deferredRoot.promise, testContext)
        const root = { branch: { x: 1 } }
        const oldBranch = root.branch

        const read = readPath(chain, ["branch"], testContext)
        deferredRoot.resolve(root)
        const value = await read
        assignPath(chain, ["branch", "x"], 2, testContext)

        expect(value).to.be(oldBranch)
        expect(root.branch).to.be(oldBranch)
        expect(oldBranch.x).to.be(2)
    })

    it("deletes through a root promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const deferredRoot = deferred()
        const chain = new Chain(deferredRoot.promise, testContext)

        deletePath(chain, ["remove"], testContext)
        deferredRoot.resolve({ keep: true, remove: true })
        await flushMicrotasks()

        expect(chain._state.value).to.eql({ keep: true })
    })

    it("turns rejected root promises into Error results", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const assignRoot = deferred()
        const lookupRoot = deferred()
        const deleteRoot = deferred()
        const assignChain = new Chain(assignRoot.promise, testContext)
        const lookupChain = new Chain(lookupRoot.promise, testContext)
        const deleteChain = new Chain(deleteRoot.promise, testContext)

        assignPath(assignChain, ["value"], 1, testContext)
        const lookedUp = lookupPath(lookupChain, ["value"], testContext)
        deletePath(deleteChain, ["value"], testContext)

        assignRoot.reject("assign root")
        lookupRoot.reject("lookup root")
        deleteRoot.reject("delete root")

        const lookedUpValue = await lookedUp
        await flushMicrotasks()

        const assignedValue = assignChain._state.value
        const deletedValue = deleteChain._state.value
        expect(assignedValue instanceof Error).to.be(true)
        expect(assignedValue.message).to.be("assign root")
        expect(lookedUpValue instanceof Error).to.be(true)
        expect(lookedUpValue.message).to.be("lookup root")
        expect(deletedValue instanceof Error).to.be(true)
        expect(deletedValue.message).to.be("delete root")
    })
})
