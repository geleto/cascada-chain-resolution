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
    advancePromiseVersion,
    Chain,
    expect,
    reportFatalError,
    setFatalErrorReporter,
    resolveInitialValueOrPoison,
    onLaterPromiseReady,
    continueInternalPromiseOrFatal,
    runFatal,
    buildRefIndex,
    getRefCounts,
    getPromiseMirror,
    hasCycleCut,
    metaOf,
    markShared,
    verifyRefCounts,
    assignPath,
    deletePath,
    hasError,
    lookupPath,
    readPath,
    run,
    exportValue,
    importValue,
    countPromiseRegistrations,
    deferred,
    flushMicrotasks,
    expectCounts,
    errorCause,
    thrownBy,
} from "./support.js"

describe("promise helpers", () => {
    it("keeps source reactions in registration order", async () => {
        const pending = deferred()
        const order = []

        resolveInitialValueOrPoison(
            pending.promise,
            () => order.push("value 1"),
        )
        onLaterPromiseReady(
            pending.promise,
            () => order.push("later"),
        )
        resolveInitialValueOrPoison(
            pending.promise,
            () => order.push("value 2"),
        )

        pending.resolve("done")
        await flushMicrotasks()

        expect(order).to.eql(["value 1", "later", "value 2"])
    })

    it("canonicalizes callable thenables onto one FIFO reaction queue", async () => {
        let registrations = 0
        const thenable = {
            then(resolve) {
                registrations++
                if (registrations === 1) {
                    queueMicrotask(() => resolve({}))
                } else {
                    resolve({})
                }
            },
        }
        const chain = new Chain({ branch: thenable })

        assignPath(chain, ["branch", "x"], 1)
        const observed = lookupPath(chain, ["branch", "x"])

        expect(await observed).to.be(1)
        expect(chain._state.value.branch).to.eql({ x: 1 })
        expect(registrations).to.be(1)
    })

    it("keeps native Promise hooks inside the user-code boundary", () => {
        const pending = deferred()
        const observed = new Chain({ value: 1 })
        pending.promise.constructor = {
            get [Symbol.species]() {
                lookupPath(observed, ["value"])
                return Promise
            },
        }
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })
        try {
            const failure = thrownBy(() => {
                return lookupPath(new Chain(pending.promise), [])
            })

            expect(failure?.message).to.be(
                "Cascada cannot be re-entered from supported user code",
            )
            expect(reported).to.be(failure)
        } finally {
            setFatalErrorReporter()
        }
    })

    it("does not inspect a non-Error rejection reason", async () => {
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
        const chain = new Chain({ branch: pending.promise })
        const first = lookupPath(chain, ["branch"])
        const second = lookupPath(chain, ["branch"])

        pending.reject(reason)
        const [firstValue, secondValue] = await Promise.all([first, second])

        expect(inspections).to.be(0)
        expect(firstValue).to.be(secondValue)
        expect(firstValue.cause).to.be(reason)
        expect(chain._state.value.branch).to.be(firstValue)
    })

    it("passes rejected data promises to continuations as Error values", async () => {
        const value = await resolveInitialValueOrPoison(
            Promise.reject("data boom"),
            value => value,
        )

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("data boom")
    })

    it("leaves returned Promises to their owning async boundary", () => {
        const promise = Promise.resolve("ready")

        expect(runFatal(() => promise)).to.be(promise)
    })

    it("does not convert continuation throws into language Error values", async () => {
        const fatal = new TypeError("runtime bug")
        let reported
        let caught

        setFatalErrorReporter(error => {
            reported = error
        })
        try {
            await resolveInitialValueOrPoison(Promise.resolve("ok"), () => {
                throw fatal
            })
        } catch (error) {
            caught = error
        } finally {
            setFatalErrorReporter()
        }

        expect(errorCause(caught)).to.be(fatal)
        expect(reported).to.be(caught)
    })

    it("reports each fatal only once across nested wrapper layers", async () => {
        const fatal = new TypeError("nested runtime bug")
        let reportCount = 0
        let caught

        setFatalErrorReporter(() => {
            reportCount++
        })
        try {
            await continueInternalPromiseOrFatal(
                resolveInitialValueOrPoison(
                    Promise.resolve("ok"),
                    () => reportFatalError(fatal),
                ),
                value => value,
            )
        } catch (error) {
            caught = error
        } finally {
            setFatalErrorReporter()
        }

        expect(reportCount).to.be(1)
        expect(errorCause(caught)).to.be(fatal)
    })

    it("reports internal promise rejections as fatal errors", async () => {
        const fatal = new TypeError("runtime bug")
        let reported
        let caught

        setFatalErrorReporter(error => {
            reported = error
        })
        try {
            await continueInternalPromiseOrFatal(
                Promise.reject(fatal),
                () => "ignored",
            )
        } catch (error) {
            caught = error
        } finally {
            setFatalErrorReporter()
        }

        expect(errorCause(caught)).to.be(fatal)
        expect(reported).to.be(caught)
    })

    it("throws the original fatal error when the fatal reporter throws", () => {
        const fatal = new TypeError("runtime bug")
        const reporterBug = new Error("reporter bug")
        let reported
        let caught

        setFatalErrorReporter(error => {
            reported = error
            throw reporterBug
        })
        try {
            reportFatalError(fatal)
        } catch (error) {
            caught = error
        } finally {
            setFatalErrorReporter()
        }

        expect(errorCause(caught)).to.be(fatal)
        expect(reported).to.be(caught)
    })

    it("reports losing internal race rejections after the race has settled", async () => {
        const cleanWait = deferred()
        const fatal = new Error("late internal failure")
        let reported

        setFatalErrorReporter(error => {
            reported = error
        })
        const race = Promise.race([
            Promise.resolve(true),
            continueInternalPromiseOrFatal(cleanWait.promise, () => false),
        ])

        expect(await race).to.be(true)
        cleanWait.reject(fatal)
        try {
            await flushMicrotasks()
        } finally {
            setFatalErrorReporter()
        }

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
            sameErrors: true,
            messages: [],
            valuesUnchanged: true,
        })
    })

    it("rejects host descriptor changes before live Promise publication", () => {
        const fixture = path.join(
            __dirname,
            "fixtures",
            "promise-property-fatal.js",
        )
        const child = spawnSync(process.execPath, [fixture], { encoding: "utf8" })

        expect(child.status).to.be(0)
        expect(JSON.parse(child.stdout)).to.eql({
            reportCount: 5,
            unhandledCount: 5,
            sameErrors: true,
            messages: [
                "Cannot resolve missing Promise property",
                "Cannot mutate non-enumerable property",
                "Cannot assign to accessor property",
                "Cannot assign to non-writable property",
                "Cannot assign to non-writable property",
            ],
        })
    })
})

describe("promise mirrors and lookupPath", () => {
    it("rejects a Promise at the synchronous sharing boundary", () => {
        const error = thrownBy(() => markShared(Promise.resolve("value")))
        expect(error.message).to.be(
            "Value metadata requires prior admission",
        )
    })

    it("rejects a Promise before advancing a property version", async () => {
        const pending = deferred()
        const root = {}
        assignPath(new Chain(root), ["value"], pending.promise)
        const mirror = getPromiseMirror(root, "value")

        const error = thrownBy(() => {
            advancePromiseVersion(
                root,
                "value",
                mirror,
                Promise.resolve("replacement"),
            )
        })

        expect(error.message).to.be(
            "A Promise requires a fresh property version",
        )
        expect(root.value).to.be(pending.promise)
        expect(mirror.value).to.be(pending.promise)

        pending.resolve("settled")
        await flushMicrotasks()
        expect(root.value).to.be("settled")
    })

    it("keeps one authoritative value before and after detachment", async () => {
        const livePending = deferred()
        const liveRoot = {}
        assignPath(new Chain(liveRoot), ["value"], livePending.promise)
        const liveMirror = metaOf(liveRoot).placementVersions.value

        expect(getPromiseMirror(liveRoot, "value")).to.be(liveMirror)
        expect(liveMirror.value).to.be(livePending.promise)
        expect(Object.keys(liveMirror)).to.eql(["promise", "value"])

        livePending.resolve("live")
        await flushMicrotasks()

        expect(getPromiseMirror(liveRoot, "value")).to.be(liveMirror)
        expect(liveRoot.value).to.be("live")
        expect(liveMirror.value).to.be("live")
        expect(Object.keys(liveMirror)).to.eql(["promise", "value"])

        const detachedPending = deferred()
        const detachedRoot = {}
        const detachedChain = new Chain(detachedRoot)
        assignPath(detachedChain, ["value"], detachedPending.promise)
        const detachedMirror = metaOf(detachedRoot).placementVersions.value
        assignPath(detachedChain, ["value"], "replacement")

        expect(getPromiseMirror(detachedRoot, "value")).to.be(undefined)
        expect(detachedMirror.value).to.be(detachedPending.promise)

        detachedPending.resolve("detached")
        await flushMicrotasks()

        expect(getPromiseMirror(detachedRoot, "value")).to.be(undefined)
        expect(detachedMirror.value).to.be("detached")
        expect(Object.keys(detachedMirror)).to.eql(["promise", "value"])
        expect(detachedRoot.value).to.be("replacement")
    })

    it("publishes uninspectable settled values as external", async () => {
        const pending = deferred()
        const failure = new Error("settled value reflection failed")
        const settled = failsClassification(failure)
        const chain = new Chain([])

        expect(run(chain, [], "push", [pending.promise], { mutationScopeDepth: 0 })).to.be(1)
        pending.resolve(settled)
        await flushMicrotasks()

        expect(chain._state.value[0]).to.be(settled)
        expect(readPath(chain, ["0"])).to.be(settled)
        verifyRefCounts(chain._state.value)
    })

    it("counts settlement reflection failures in indexed values", async () => {
        const pending = deferred()
        const failure = new Error("indexed value reflection failed")
        const root = { value: pending.promise }
        const chain = new Chain(root)
        buildRefIndex(root)

        pending.resolve(new Proxy({}, {
            ownKeys() {
                throw failure
            },
        }))
        await flushMicrotasks()

        expect(errorCause(root.value)).to.be(failure)
        expect(errorCause(readPath(chain, ["value"]))).to.be(failure)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("keeps publication reflection failures in the mirror", async () => {
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
        const chain = new Chain(root)
        const observed = lookupPath(chain, ["value"])

        failReflection = true
        pending.resolve("resolved")

        const outcome = await observed
        failReflection = false
        expect(errorCause(outcome)).to.be(failure)
        expect(physical.value).to.be(pending.promise)
        expect(errorCause(readPath(chain, ["value"]))).to.be(failure)
        verifyRefCounts(root)
    })

    it("keeps Promise writeback failures in the mirror", async () => {
        const pending = deferred()
        const failure = new Error("Promise writeback failed")
        const physical = { value: pending.promise }
        const root = new Proxy(physical, {
            set() {
                throw failure
            },
        })
        const chain = new Chain(root)
        buildRefIndex(root)
        const observed = lookupPath(chain, ["value"])

        pending.resolve("resolved")

        expect(errorCause(await observed)).to.be(failure)
        expect(physical.value).to.be(pending.promise)
        expect(errorCause(readPath(chain, ["value"]))).to.be(failure)
        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("keeps uninspectable settled values on detached versions", async () => {
        const pending = deferred()
        const failure = new Error("detached value reflection failed")
        const settled = failsClassification(failure)
        const root = { value: pending.promise }
        const chain = new Chain(root)
        const observed = lookupPath(chain, ["value"])

        assignPath(chain, ["value"], "replacement")
        pending.resolve(settled)

        expect(await observed).to.be(settled)
        expect(root.value).to.be("replacement")
        verifyRefCounts(root)
    })

    it("writes through existing writable properties on sealed holders", async () => {
        const pending = deferred()
        const error = new Error("settled")
        const value = { error }
        const root = {}

        assignPath(new Chain(root), ["value"], pending.promise)
        buildRefIndex(root)
        const observed = lookupPath(new Chain(root), ["value"])

        Object.seal(root)
        expectCounts(root, 1, 0)

        pending.resolve(value)
        expect(await observed).to.be(value)
        await flushMicrotasks()

        expect(root.value).to.be(value)
        expectCounts(root, 0, 1)
        expect(hasError(new Chain(root), [])).to.be(true)
        expect(errorCause(exportValue(new Chain(root), []))).to.be(error)
        verifyRefCounts(root)
    })

    it("prepares a resolved value when its owner becomes indexed first", async () => {
        const pending = deferred()
        const nested = deferred()
        const root = {}

        assignPath(new Chain(root), ["value"], pending.promise)
        onLaterPromiseReady(pending.promise, () => buildRefIndex(root))

        pending.resolve({ bad: new Error("bad"), nested: nested.promise })
        await flushMicrotasks()

        expectCounts(root, 1, 1)
        expectCounts(root.value, 1, 1)
        verifyRefCounts(root)

        nested.resolve("done")
        await flushMicrotasks()

        expectCounts(root, 0, 1)
        verifyRefCounts(root)
    })

    it("publishes a resolved value and its cycle cut atomically", async () => {
        const pending = deferred()
        const root = { value: pending.promise }
        importValue(root, "atomic cycle cut")
        buildRefIndex(root)
        let publishedCycleCut
        let countsAfterPublication

        onLaterPromiseReady(pending.promise, () => {
            publishedCycleCut = hasCycleCut(root, "value")
            countsAfterPublication = getRefCounts(root)
        })

        pending.resolve(root)
        await flushMicrotasks()

        expect(root.value).to.be(pending.promise)
        expect(readPath(new Chain(root), ["value"])).to.be(root)
        expect(publishedCycleCut).to.be(true)
        expect(countsAfterPublication).to.eql({
            promiseCount: 0,
            errorCount: 0,
            cycleCutCount: 1,
        })
        expect(hasCycleCut(root, "value")).to.be(true)
        expectCounts(root, 0, 0, 1)
        verifyRefCounts(root)
    })

    it("does not copy a committed cycle cut into a replacement mirror", () => {
        const owner = {}
        owner.value = owner
        importValue(owner, "marked mirror replacement")
        const pending = deferred()
        const chain = new Chain(owner)

        buildRefIndex(owner)
        expect(metaOf(owner).cycleCuts.has("value")).to.be(true)

        assignPath(chain, ["value"], pending.promise)
        const copy = chain._state.value
        const mirror = metaOf(copy).placementVersions.value

        expect(copy).not.to.be(owner)
        expect(metaOf(copy).placementVersions.value).to.be(mirror)
        expect(copy.value).to.be(pending.promise)
        expect(metaOf(copy).cycleCuts).to.be(undefined)
        expect(metaOf(owner).cycleCuts.has("value")).to.be(true)
        expectCounts(copy, 1, 0)
        verifyRefCounts(owner, copy)
    })

    it("keeps owned promise results mutable until they escape", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(new Chain(root), ["value"], deferredValue.promise)
        deferredValue.resolve({ x: 1 })
        await flushMicrotasks()

        const value = root.value
        assignPath(new Chain(root), ["value", "x"], 2)

        expect(root.value).to.be(value)
        expect(value.x).to.be(2)
    })

    it("writes a resolved promise back to its key", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(new Chain(root), ["value"], deferredValue.promise)
        const read = lookupPath(new Chain(root), ["value"])

        expect(root.value).to.be(deferredValue.promise)
        expect(typeof read.then).to.be("function")

        deferredValue.resolve({ x: 1 })
        const value = await read

        expect(root.value).to.be(value)
        expect(value).to.eql({ x: 1 })

        const wrapper = { value }
        assignPath(new Chain(wrapper), ["value", "x"], 2)

        expect(wrapper.value).not.to.be(value)
        expect(value.x).to.be(1)
        expect(wrapper.value.x).to.be(2)
    })

    it("can read a promised value without sharing ownership", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(new Chain(root), ["value"], deferredValue.promise)
        const read = readPath(new Chain(root), ["value"])

        deferredValue.resolve({ x: 1 })
        const value = await read

        assignPath(new Chain(root), ["value", "x"], 2)

        expect(root.value).to.be(value)
        expect(value.x).to.be(2)
    })

    it("preserves promises that resolve to undefined", async () => {
        const deferredValue = deferred()
        const registrations = countPromiseRegistrations(deferredValue.promise)
        const root = {}

        assignPath(new Chain(root), ["value"], deferredValue.promise)
        const read = lookupPath(new Chain(root), ["value"])

        deferredValue.resolve(undefined)
        const value = await read
        await flushMicrotasks()

        expect(value).to.be(undefined)
        expect(root.value).to.be(undefined)
        const before = registrations()
        expect(lookupPath(new Chain(root), ["value"])).to.be(undefined)
        expect(registrations()).to.be(before)
    })

    it("applies writes to an already-settled assigned promise in FIFO order", async () => {
        const root = {}
        const promise = Promise.resolve({})

        assignPath(new Chain(root), ["branch"], promise)
        assignPath(new Chain(root), ["branch", "x"], 1)
        await flushMicrotasks()

        expect(root.branch).to.eql({ x: 1 })
    })

    it("applies pending intermediate writes in program order", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root), ["branch", "a"], 1)
        assignPath(new Chain(root), ["branch", "b"], 2)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root.branch).to.eql({ a: 1, b: 2 })
    })

    it("orders writes through two nested pending promises", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { branch: outer.promise }

        assignPath(new Chain(root), ["branch", "inner", "x"], 1)
        assignPath(new Chain(root), ["branch", "inner", "x"], 2)

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()
        inner.resolve({})
        await flushMicrotasks()

        expect(root.branch.inner).to.eql({ x: 2 })
    })

    it("makes a suspended lookupPath observe its own program position", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const read = lookupPath(new Chain(root), ["branch"])
        assignPath(new Chain(root), ["branch", "x"], 1)

        deferredBranch.resolve({})
        const readValue = await read
        await flushMicrotasks()

        expect(readValue).to.eql({})
        expect(root.branch).to.eql({ x: 1 })
        expect(root.branch).not.to.be(readValue)
    })

    it("continues lookupPath through a pending intermediate promise", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const read = lookupPath(new Chain(root), ["branch", "value"])

        deferredBranch.resolve({ value: { x: 1 } })
        const value = await read

        expect(value).to.eql({ x: 1 })

        const wrapper = { value }
        assignPath(new Chain(wrapper), ["value", "x"], 2)

        expect(wrapper.value).not.to.be(value)
        expect(value.x).to.be(1)
        expect(wrapper.value.x).to.be(2)
    })

    it("returns Error when a promise exposes a missing intermediate", async () => {
        const pending = deferred()
        const result = lookupPath(
            new Chain({ parent: pending.promise }),
            ["parent", "missing", "value"],
        )

        pending.resolve({})
        const value = await result

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("marks shared lookup results before later writes resume", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const read = lookupPath(new Chain(root), ["branch", "value"])
        assignPath(new Chain(root), ["branch", "value", "x"], 2)

        deferredBranch.resolve({ value: { x: 1 } })
        const value = await read
        await flushMicrotasks()

        expect(value).to.eql({ x: 1 })
        expect(root.branch.value).to.eql({ x: 2 })
        expect(root.branch.value).not.to.be(value)
    })

    it("marks shared nested promise lookups before later nested writes resume", async () => {
        const deferredBranch = deferred()
        const deferredValue = deferred()
        const root = { branch: deferredBranch.promise }

        const read = lookupPath(new Chain(root), ["branch", "value"])
        assignPath(new Chain(root), ["branch", "value", "x"], 2)

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
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise })

        const read = lookupPath(chain, ["branch", "inner", "value"])
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        assignPath(chain, ["branch"], { replacement: true })
        inner.resolve({ value: { observed: true } })

        expect(await read).to.eql({ observed: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("continues through promises exposed after its first mirror is detached", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise })

        const read = lookupPath(chain, ["branch", "inner", "value"])
        assignPath(chain, ["branch"], { replacement: true })
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        inner.resolve({ value: { observed: true } })

        expect(await read).to.eql({ observed: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("does not transfer a pending lookup to a replacement promise", async () => {
        const observed = deferred()
        const replacement = deferred()
        const chain = new Chain({ branch: observed.promise })

        const read = lookupPath(chain, ["branch"])
        assignPath(chain, ["branch"], replacement.promise)
        observed.resolve({ observed: true })

        expect(await read).to.eql({ observed: true })
        expect(chain._state.value.branch).to.be(replacement.promise)

        replacement.resolve({ replacement: true })
        await flushMicrotasks()

        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("can read through a pending intermediate promise without sharing ownership", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        const read = readPath(new Chain(root), ["branch", "value"])

        deferredBranch.resolve({ value: { x: 1 } })
        const value = await read

        assignPath(new Chain(root), ["branch", "value", "x"], 2)

        expect(root.branch.value).to.be(value)
        expect(value.x).to.be(2)
    })

    it("shadows non-enumerable imported properties when a suspended mutation resumes", async () => {
        const deferredBranch = deferred()
        const externalBranch = {}
        const root = {}
        Object.defineProperty(externalBranch, "x", {
            value: 1,
            enumerable: false,
            writable: true,
            configurable: true,
        })

        assignPath(new Chain(root), ["branch"], importValue(deferredBranch.promise, "hidden resume"))
        assignPath(new Chain(root), ["branch", "x"], 2)

        deferredBranch.resolve(externalBranch)
        await flushMicrotasks()

        expect(root.branch).not.to.be(externalBranch)
        expect(externalBranch.x).to.be(1)
        expect(Object.prototype.propertyIsEnumerable.call(externalBranch, "x")).to.be(false)
        expect(root.branch.x).to.be(2)
        expect(Object.prototype.propertyIsEnumerable.call(root.branch, "x")).to.be(true)
    })

    it("forks promise mirrors when a pending key is shallow-copied", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root), ["branch", "before"], 1)
        importValue(root)

        const leftChain = new Chain(root)
        const rightChain = new Chain(root)
        assignPath(leftChain, ["left"], true)
        assignPath(rightChain, ["right"], true)
        const left = leftChain._state.value
        const right = rightChain._state.value

        assignPath(leftChain, ["branch", "leftOnly"], 2)
        assignPath(rightChain, ["branch", "rightOnly"], 3)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(left.branch).to.eql({ before: 1, leftOnly: 2 })
        expect(right.branch).to.eql({ before: 1, rightOnly: 3 })
        expect(left.branch).not.to.be(right.branch)
    })

    it("turns a rejected forked pending key into Error values in both worlds", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root), ["branch", "before"], 1)
        importValue(root)

        const leftChain = new Chain(root)
        const rightChain = new Chain(root)
        assignPath(leftChain, ["left"], true)
        assignPath(rightChain, ["right"], true)
        const left = leftChain._state.value
        const right = rightChain._state.value

        assignPath(leftChain, ["branch", "leftOnly"], 2)
        assignPath(rightChain, ["branch", "rightOnly"], 3)

        deferredBranch.reject("fork boom")
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        const rootError = readPath(new Chain(root), ["branch"])
        expect(rootError instanceof Error).to.be(true)
        expect(rootError.message).to.be("fork boom")
        expect(left.branch instanceof Error).to.be(true)
        expect(left.branch.message).to.be("fork boom")
        expect(right.branch instanceof Error).to.be(true)
        expect(right.branch.message).to.be("fork boom")
    })

    it("does not mark a final promise key replaced after a root copy", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        lookupPath(new Chain(root), [])
        const chain = new Chain(root)
        assignPath(chain, ["branch"], { replacement: true })
        const next = chain._state.value

        deferredBranch.resolve({ x: 1 })
        await flushMicrotasks()

        const oldBranch = await readPath(new Chain(root), ["branch"])
        const oldBranchChain = new Chain(oldBranch)
        assignPath(oldBranchChain, ["x"], 2)

        expect(next.branch).to.eql({ replacement: true })
        expect(oldBranchChain._state.value).to.be(oldBranch)
        expect(oldBranch.x).to.be(2)
    })

    it("copies through a promised path key under a shared root", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        lookupPath(new Chain(root), [])
        const chain = new Chain(root)
        assignPath(chain, ["branch", "x"], 1)
        const next = chain._state.value

        deferredBranch.resolve({ y: 2 })
        await flushMicrotasks()

        const oldBranch = await readPath(new Chain(root), ["branch"])

        expect(oldBranch).to.eql({ y: 2 })
        expect(next.branch).to.eql({ y: 2, x: 1 })
        expect(next.branch).not.to.be(oldBranch)
    })

    it("turns a rejected promise into an Error value", async () => {
        const deferredValue = deferred()
        const root = { value: deferredValue.promise }

        const read = lookupPath(new Chain(root), ["value"])
        deferredValue.reject("boom")

        const value = await read

        expect(value instanceof Error).to.be(true)
        expect(value.message).to.be("boom")
        expect(root.value).to.be(value)
    })

    it("turns an assigned rejected promise into an Error value", async () => {
        const deferredValue = deferred()
        const root = {}

        assignPath(new Chain(root), ["value"], deferredValue.promise)
        deferredValue.reject("assigned boom")
        await flushMicrotasks()

        expect(root.value instanceof Error).to.be(true)
        expect(root.value.message).to.be("assigned boom")
    })

    it("turns an already-rejected assigned promise into an Error value", async () => {
        const root = {}

        assignPath(new Chain(root), ["value"], Promise.reject("already rejected"))
        await flushMicrotasks()

        expect(root.value instanceof Error).to.be(true)
        expect(root.value.message).to.be("already rejected")
    })

    it("stops at a rejected intermediate promise instead of autovivifying", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root), ["branch", "x"], 1)
        deferredBranch.reject("nope")
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be("nope")
    })

    it("turns a promised primitive intermediate into Error", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root), ["branch", "x"], 1)
        deferredBranch.resolve(7)
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("turns a promised null intermediate into Error", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root), ["branch", "x"], 1)
        deferredBranch.resolve(null)
        await flushMicrotasks()

        expect(root.branch instanceof Error).to.be(true)
        expect(root.branch.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("keeps two keys holding the same imported promise independent", async () => {
        const deferredBranch = deferred()
        const importedBranch = importValue(deferredBranch.promise)
        const root = {
            left: importedBranch,
            right: importedBranch,
        }

        assignPath(new Chain(root), ["left", "x"], 1)
        assignPath(new Chain(root), ["right", "y"], 2)

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root.left).to.eql({ x: 1 })
        expect(root.right).to.eql({ y: 2 })
        expect(root.left).not.to.be(root.right)
    })

    it("treats re-placing the same promise as a fresh mirror", async () => {
        const deferredBranch = deferred()
        const root = {}

        assignPath(new Chain(root), ["branch"], deferredBranch.promise)
        const firstRead = lookupPath(new Chain(root), ["branch"])

        assignPath(new Chain(root), ["branch"], deferredBranch.promise)
        assignPath(new Chain(root), ["branch", "x"], 1)

        deferredBranch.resolve({})
        const firstValue = await firstRead
        await flushMicrotasks()

        expect(firstValue).to.eql({})
        expect(root.branch).to.eql({ x: 1 })
        expect(root.branch).not.to.be(firstValue)
    })

    it("treats replacing one pending promise with another as a fresh mirror", async () => {
        const first = deferred()
        const second = deferred()
        const root = {}

        assignPath(new Chain(root), ["branch"], first.promise)
        assignPath(new Chain(root), ["branch"], second.promise)

        first.resolve({ stale: true })
        await flushMicrotasks()
        expect(root.branch).to.be(second.promise)

        second.resolve({ fresh: true })
        await flushMicrotasks()
        expect(root.branch).to.eql({ fresh: true })
    })

    it("forks a settled-but-unreplaced promise key", async () => {
        const root = {}
        const promise = Promise.resolve({})

        assignPath(new Chain(root), ["branch"], promise)
        importValue(root)

        const chain = new Chain(root)
        assignPath(chain, ["added"], true)
        const next = chain._state.value
        assignPath(chain, ["branch", "x"], 1)

        await flushMicrotasks()

        expect(root.branch).to.eql({})
        expect(next.branch).to.eql({ x: 1 })
        expect(next.branch).not.to.be(root.branch)
    })

    it("does not recreate a deleted path when a suspended write resumes", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root), ["branch", "x"], 1)
        deletePath(new Chain(root), ["branch"])

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root).to.eql({})
    })

    it("does not overwrite a later reassignment when a suspended write resumes", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root), ["branch", "x"], 1)
        assignPath(new Chain(root), ["branch"], { replacement: true })

        deferredBranch.resolve({})
        await flushMicrotasks()

        expect(root.branch).to.eql({ replacement: true })
    })

    it("confines a nested suspended write after an ancestor is replaced", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise })

        assignPath(chain, ["branch", "inner", "x"], 1)
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        const discardedBranch = chain._state.value.branch
        assignPath(chain, ["branch"], { replacement: true })
        inner.resolve({})
        await flushMicrotasks()

        expect(discardedBranch.inner).to.eql({ x: 1 })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("continues a suspended write through a mirror detached before settlement", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise })
        const discardedBranch = { inner: inner.promise }

        assignPath(chain, ["branch", "inner", "x"], 1)
        assignPath(chain, ["branch"], { replacement: true })
        outer.resolve(discardedBranch)
        await flushMicrotasks()

        inner.resolve({})
        await flushMicrotasks()

        expect(discardedBranch.inner).to.eql({ x: 1 })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("deletes through a pending branch once it resolves", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        deletePath(new Chain(root), ["branch", "x"])

        deferredBranch.resolve({ x: 1, y: 2 })
        await flushMicrotasks()

        expect(root.branch).to.eql({ y: 2 })
    })

    it("confines a nested suspended delete after an ancestor is replaced", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise })

        deletePath(chain, ["branch", "inner", "remove"])
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        const discardedBranch = chain._state.value.branch
        assignPath(chain, ["branch"], { replacement: true })
        inner.resolve({ keep: true, remove: true })
        await flushMicrotasks()

        expect(discardedBranch.inner).to.eql({ keep: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("orders assignment before delete through the same pending branch", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        assignPath(new Chain(root), ["branch", "x"], 2)
        deletePath(new Chain(root), ["branch", "x"])

        deferredBranch.resolve({ x: 1, y: 3 })
        await flushMicrotasks()

        expect(root.branch).to.eql({ y: 3 })
    })

    it("orders delete before assignment through the same pending branch", async () => {
        const deferredBranch = deferred()
        const root = { branch: deferredBranch.promise }

        deletePath(new Chain(root), ["branch", "x"])
        assignPath(new Chain(root), ["branch", "x"], 2)

        deferredBranch.resolve({ x: 1, y: 3 })
        await flushMicrotasks()

        expect(root.branch).to.eql({ y: 3, x: 2 })
    })

    describe("sequential operation schedules", () => {
        it("makes a read between two writes observe only the first write", async () => {
            const pending = deferred()
            const chain = new Chain({ branch: pending.promise })

            assignPath(chain, ["branch", "x"], 1)
            const observed = lookupPath(chain, ["branch"])
            assignPath(chain, ["branch", "x"], 2)

            pending.resolve({})
            const value = await observed
            await flushMicrotasks()

            expect(value).to.eql({ x: 1 })
            expect(chain._state.value.branch).to.eql({ x: 2 })
            expect(chain._state.value.branch).not.to.be(value)
        })

        it("orders delete, read, and write through one pending branch", async () => {
            const pending = deferred()
            const chain = new Chain({ branch: pending.promise })

            deletePath(chain, ["branch", "x"])
            const observed = lookupPath(chain, ["branch", "x"])
            assignPath(chain, ["branch", "x"], 2)

            pending.resolve({ x: 1 })

            expect(await observed).to.be(undefined)
            await flushMicrotasks()
            expect(chain._state.value.branch).to.eql({ x: 2 })
        })

        it("preserves a read position through two promise barriers", async () => {
            const outer = deferred()
            const inner = deferred()
            const chain = new Chain({ branch: outer.promise })

            assignPath(chain, ["branch", "inner", "x"], 1)
            const observed = lookupPath(chain, ["branch", "inner"])
            assignPath(chain, ["branch", "inner", "x"], 2)

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
            const pending = deferred()
            const chain = new Chain(pending.promise)

            assignPath(chain, ["x"], 1)
            const observed = lookupPath(chain, [])
            assignPath(chain, ["x"], 2)

            pending.resolve({})

            const value = await observed
            await flushMicrotasks()
            expect(value).to.eql({ x: 1 })
            expect(chain._state.value).to.eql({ x: 2 })
            expect(chain._state.value).not.to.be(value)
        })
    })

    it("keeps indexed keys sharing one imported promise independent", async () => {
        const pending = deferred()
        const imported = importValue(pending.promise, "shared promise")
        const root = { left: imported, right: imported }
        const chain = new Chain(root)

        buildRefIndex(root)
        assignPath(chain, ["left", "x"], 1)
        assignPath(chain, ["right", "y"], 2)
        const exported = exportValue(chain, [])
        const foundError = hasError(chain, [])

        expectCounts(root, 2, 0)
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
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("marks a promise exposed beneath its own result without replacing it", async () => {
        const pending = deferred()
        const root = {
            value: importValue(pending.promise, "self promise"),
        }
        const chain = new Chain(root)
        const exported = exportValue(chain, [])
        const foundError = hasError(chain, [])
        const resolved = { again: pending.promise }

        pending.resolve(resolved)

        const exportedValue = await exported
        expect(exportedValue).not.to.be(root)
        expect(exportedValue.value.again).to.be(exportedValue.value)
        expect(await foundError).to.be(false)
        expect(resolved.again).to.be(pending.promise)
        expect(readPath(new Chain(resolved), ["again"])).to.be(resolved)
        expect(hasCycleCut(resolved, "again")).to.be(true)
        expectCounts(root, 0, 0, 1)
        verifyRefCounts(root)
    })

    it("cuts a cycle closed by a second promise without replacing it", async () => {
        const first = deferred()
        const second = deferred()
        const root = {
            value: importValue(first.promise, "two-promise cycle"),
        }
        const chain = new Chain(root)
        const exported = exportValue(chain, [])
        const foundError = hasError(chain, [])
        const firstValue = { next: second.promise }
        const secondValue = { back: firstValue }

        first.resolve(firstValue)
        second.resolve(secondValue)

        const exportedValue = await exported
        expect(exportedValue).not.to.be(root)
        expect(exportedValue.value.next.back).to.be(exportedValue.value)
        expect(await foundError).to.be(false)
        expect(firstValue.next).to.be(second.promise)
        expect(readPath(new Chain(firstValue), ["next"])).to.be(
            secondValue,
        )
        expect(
            hasCycleCut(firstValue, "next") ||
            hasCycleCut(secondValue, "back"),
        ).to.be(true)
        expectCounts(root, 0, 0, 1)
        verifyRefCounts(root)
    })
})

describe("root promises", () => {
    it("chains root-level assignments through the Chain state slot", async () => {
        const deferredRoot = deferred()
        const chain = new Chain(deferredRoot.promise)

        assignPath(chain, ["a"], 1)
        assignPath(chain, ["b"], 2)

        expect(chain._state.value).to.be.a(Promise)

        deferredRoot.resolve({})
        await flushMicrotasks()

        expect(chain._state.value).to.eql({ a: 1, b: 2 })
    })

    it("looks up through a root promise with shared ownership", async () => {
        const deferredRoot = deferred()
        const chain = new Chain(deferredRoot.promise)
        const root = { branch: { x: 1 } }
        const oldBranch = root.branch

        const read = lookupPath(chain, ["branch"])
        deferredRoot.resolve(root)
        const value = await read
        assignPath(new Chain(root), ["branch", "x"], 2)

        expect(value).to.be(oldBranch)
        expect(root.branch).not.to.be(oldBranch)
        expect(oldBranch.x).to.be(1)
        expect(root.branch.x).to.be(2)
    })

    it("looks up through a root promise without sharing ownership", async () => {
        const deferredRoot = deferred()
        const chain = new Chain(deferredRoot.promise)
        const root = { branch: { x: 1 } }
        const oldBranch = root.branch

        const read = readPath(chain, ["branch"])
        deferredRoot.resolve(root)
        const value = await read
        assignPath(new Chain(root), ["branch", "x"], 2)

        expect(value).to.be(oldBranch)
        expect(root.branch).to.be(oldBranch)
        expect(oldBranch.x).to.be(2)
    })

    it("deletes through a root promise", async () => {
        const deferredRoot = deferred()
        const chain = new Chain(deferredRoot.promise)

        deletePath(chain, ["remove"])
        deferredRoot.resolve({ keep: true, remove: true })
        await flushMicrotasks()

        expect(chain._state.value).to.eql({ keep: true })
    })

    it("turns rejected root promises into Error results", async () => {
        const assignRoot = deferred()
        const lookupRoot = deferred()
        const deleteRoot = deferred()
        const assignChain = new Chain(assignRoot.promise)
        const lookupChain = new Chain(lookupRoot.promise)
        const deleteChain = new Chain(deleteRoot.promise)

        assignPath(assignChain, ["value"], 1)
        const lookedUp = lookupPath(lookupChain, ["value"])
        deletePath(deleteChain, ["value"])

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
