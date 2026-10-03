import * as runtime from "../src/index.js"
import { requiresCopyOnWrite, metaOf } from "../src/meta.js"
import {
    Chain,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    import as importValue,
    export as exportValue,
    Execution,
} from "../src/index.js"
import { buildRefIndex, getRefCounter, hasCycleCut } from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"

import { countPromiseRegistrations, deferred, errorCause, expect, flushMicrotasks, readPath } from "./support.js"

function expectErrors(actual, expected) {
    if (expected.length === 0) {
        expect(actual).to.be(null)
        return
    }
    expect(actual instanceof Error).to.be(true)
    const leaves = actual.errors ?? [actual]
    expect(leaves.length).to.be(expected.length)
    for (const error of expected) {
        expect(leaves.some(value => value === error || value.cause === error))
            .to.be(true)
    }
}

describe("getErrors", () => {
    for (const pending of [false, true]) {
        it(`returns null, an unchanged leaf, or a frozen flat compound, pending=${pending}`, async () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const ctx = testContext
            const first = runtime.createPoisonError(new Error("first"), ctx, runtime.ERROR_KIND.InvocationFailed)
            const second = runtime.createPoisonError(new Error("second"), ctx, runtime.ERROR_KIND.QueryReflectionFailed)
            const nested = runtime.combineErrors([first, second], "nested")
            for (const errors of [[], [first], [first, second]]) {
                const branch = errors.length === 2 ? { first, nested } : { errors }
                branch.self = branch
                const chain = new Chain(pending ? Promise.resolve(branch) : branch, testContext)
                const result = getErrors(chain, [], testContext)
                expect(result instanceof Promise).to.be(pending)
                const value = await result
                if (errors.length === 0) expect(value).to.be(null)
                else if (errors.length === 1) expect(value).to.be(first)
                else {
                    expect(value).to.be.a(runtime.CompoundPoisonError)
                    expect(Object.isFrozen(value)).to.be(true)
                    expect(Object.isFrozen(value.errors)).to.be(true)
                    expectErrors(value, [first, second])
                    expect(value.errors.every(error => error.errors === undefined)).to.be(true)
                }
                verifyRefCounts(testContext, chain._state.value)
            }
        })
    }

    it("keeps optional storage synchronization failure out of Error queries", async () => {
        let testContext
        for (const query of [hasError, getErrors]) {
            const pending = deferred()
            const failure = new Error("Promise writeback failed")
            let failWrite = false
            const value = new Proxy({ pending: pending.promise }, {
                set(target, key, nextValue, receiver) {
                    if (failWrite && key === "pending") throw failure
                    return Reflect.set(target, key, nextValue, receiver)
                },
            })
            let reported
            testContext = { execution: new Execution(error => {
                reported = error
            }), errorContext: "test operation" }

            const result = query(new Chain(value, testContext), [], testContext)
            failWrite = true
            pending.resolve({ clean: true })
            const answer = await result

            expect(answer).to.be(query === hasError ? false : null)
            expect(reported).to.be(undefined)
            expect(readPath(new Chain(value, testContext), ["pending"], testContext))
                .to.eql({ clean: true })
            verifyRefCounts(testContext, value)
        }
    })

    it("returns query-only reflection failures as poison", () => {
        let testContext
        for (const query of [hasError, getErrors]) {
            const failure = new Error("query reflection failed")
            let fail = false
            const value = new Proxy({}, {
                ownKeys(target) {
                    if (fail) throw failure
                    return Reflect.ownKeys(target)
                },
            })
            let reported
            testContext = { execution: new Execution(error => {
                reported = error
            }), errorContext: "test operation" }

            const chain = new Chain(value, testContext)
            fail = true
            const thrown = query(chain, [], testContext)
            expect(errorCause(thrown)).to.be(failure)
            expect(reported).to.be(undefined)
        }
    })

    it("closes the query after reflection failure while shared settlement continues", async () => {
        let testContext
        for (const query of [hasError, getErrors]) {
            const outer = deferred()
            const inner = deferred()
            const failure = new Error("delayed query reflection failed")
            const target = { inner: inner.promise }
            let scans = 0
            const value = new Proxy(target, {
                ownKeys(target) {
                    scans++
                    if (scans === 3) throw failure
                    return Reflect.ownKeys(target)
                },
            })
            let reported
            testContext = { execution: new Execution(error => {
                reported = error
            }), errorContext: "test operation" }

            const result = query(new Chain({ outer: outer.promise }, testContext), [], testContext)
            outer.resolve(value)

            const failureResult = await result
            expect(errorCause(failureResult)).to.be(failure)
            expect(reported).to.be(undefined)
            expect(scans).to.be(3)

            inner.resolve({ ready: true })
            await flushMicrotasks()

            expect(scans).to.be(3)
            expect(metaOf(value, testContext).placementVersions.inner.value)
                .to.eql({
                ready: true,
            })
        }
    })

    it("closes on delayed path-reflection failure", async () => {
        let testContext
        for (const query of [hasError, getErrors]) {
            const pending = deferred()
            const failure = new Error("query path reflection failed")
            const value = new Proxy({}, {
                getOwnPropertyDescriptor() {
                    throw failure
                },
            })
            let reported
            testContext = { execution: new Execution(error => {
                reported = error
            }), errorContext: "test operation" }

            const result = query(
                new Chain({ pending: pending.promise }, testContext),
                ["pending", "value"], testContext,
            )
            pending.resolve(value)

            const failureResult = await result
            expect(errorCause(failureResult)).to.be(failure)
            expect(reported).to.be(undefined)
        }
    })

    it("closes on reflection failure after several pending path segments", async () => {
        let testContext
        for (const query of [hasError, getErrors]) {
            const first = deferred()
            const second = deferred()
            const failure = new Error("deep query path reflection failed")
            const value = new Proxy({}, {
                getOwnPropertyDescriptor() {
                    throw failure
                },
            })
            let reported
            testContext = { execution: new Execution(error => {
                reported = error
            }), errorContext: "test operation" }

            const result = query(
                new Chain({ first: first.promise }, testContext),
                ["first", "second", "value"], testContext,
            )
            first.resolve({ second: second.promise })
            await flushMicrotasks()
            second.resolve(value)

            const failureResult = await result
            expect(errorCause(failureResult)).to.be(failure)
            expect(reported).to.be(undefined)
        }
    })

    it("keeps concurrent query lifetimes independent", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = deferred()
        const second = deferred()
        const firstError = new Error("first")
        const secondError = new Error("second")
        const chain = new Chain({
            first: first.promise,
            second: second.promise,
        }, testContext)

        const found = hasError(chain, [], testContext)
        const collected = getErrors(chain, [], testContext)
        let collectionFinished = false
        collected.then(() => {
            collectionFinished = true
        })

        first.resolve(firstError)
        expect(await found).to.be(true)
        await flushMicrotasks()
        expect(collectionFinished).to.be(false)

        second.resolve(secondError)
        expectErrors(await collected, [firstError, secondError])
    })

    it("continues through cycle cuts while collecting ordinary Errors", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const siblingError = new Error("sibling")
        const hiddenError = new Error("hidden")
        const left = { siblingError }
        const right = { hiddenError }
        left.right = right
        right.left = left
        importValue(left, { ...testContext, errorContext: "error cut" })
        const chain = new Chain(left, testContext)

        const errors = getErrors(chain, [], testContext)
        expect(metaOf(right, testContext).cycleCuts.has("left")).to.be(true)
        expectErrors(errors, [siblingError, hiddenError])
        expect(hasError(chain, [], testContext)).to.be(true)
        expectErrors(
            getErrors(chain, ["right"], testContext),
            [siblingError, hiddenError],
        )
        expectErrors(
            getErrors(new Chain(right, testContext), [], testContext),
            [siblingError, hiddenError],
        )
    })

    it("uses cycle-cut counts to fence clean siblings", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        let cleanReads = 0
        const clean = {}
        Object.defineProperty(clean, "value", {
            enumerable: true,
            get() {
                cleanReads++
                return 1
            },
        })
        const cyclic = {}
        cyclic.self = cyclic
        const root = { cyclic, clean }
        importValue(root, { ...testContext, errorContext: "cut-fenced query" })
        buildRefIndex(root, testContext)
        cleanReads = 0

        const rootChain = new Chain(root, testContext)
        expect(getErrors(rootChain, [], testContext)).to.be(null)
        expect(hasError(rootChain, [], testContext)).to.be(false)

        expect(cleanReads).to.be(0)
        verifyRefCounts(testContext, root)
    })

    it("resumes fenced traversal at an indexed cycle-cut target", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        let cleanReads = 0
        const clean = {}
        Object.defineProperty(clean, "value", {
            enumerable: true,
            get() {
                cleanReads++
                return 1
            },
        })
        const first = { clean }
        const second = { back: first }
        first.next = second
        importValue(first, { ...testContext, errorContext: "indexed cut target" })
        buildRefIndex(first, testContext)
        cleanReads = 0

        expect(getErrors(new Chain(second, testContext), [], testContext)).to.be(null)
        expect(hasError(new Chain(second, testContext), [], testContext)).to.be(false)
        expect(getErrors(new Chain(second, testContext), ["back"], testContext)).to.be(null)
        expect(hasError(new Chain(second, testContext), ["back"], testContext)).to.be(false)

        expect(cleanReads).to.be(0)
        verifyRefCounts(testContext, first, second)
    })

    it("waits for errors reachable only behind a cycle cut", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const visible = deferred()
        const hiddenError = new Error("hidden")
        const promisedError = new Error("promised")
        const visibleError = new Error("visible")
        const first = {
            hiddenError,
            pending: pending.promise,
        }
        const second = {
            back: first,
            visible: visible.promise,
        }
        first.next = second
        importValue(first, { ...testContext, errorContext: "cycle error collection" })
        const chain = new Chain(second, testContext)
        expect(hasError(chain, [], testContext)).to.be(true)
        const result = getErrors(chain, [], testContext)
        let settled = false
        result.then(() => {
            settled = true
        })

        await flushMicrotasks()
        expect(settled).to.be(false)

        pending.resolve({ promisedError })
        visible.resolve({ visibleError })
        expectErrors(
            await result,
            [hiddenError, promisedError, visibleError],
        )
    })

    it("answers hasError immediately but exhausts a hidden cycle Promise frontier", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const visibleError = new Error("visible")
        const hiddenError = new Error("hidden")
        const first = { pending: pending.promise }
        const second = { visibleError, back: first }
        first.next = second
        importValue(first, { ...testContext, errorContext: "mixed cycle errors" })
        const chain = new Chain(second, testContext)

        expect(hasError(chain, [], testContext)).to.be(true)
        const result = getErrors(chain, [], testContext)
        let settled = false
        result.then(() => {
            settled = true
        })
        await flushMicrotasks()
        expect(settled).to.be(false)

        pending.resolve({ hiddenError })
        expectErrors(await result, [visibleError, hiddenError])
        verifyRefCounts(testContext, first, second)
    })

    it("collects through a Promise placement that becomes a cycle cut", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const hiddenError = new Error("outside queried branch")
        const root = {
            hiddenError,
            branch: { pending: pending.promise },
        }
        importValue(root, { ...testContext, errorContext: "promised mid-branch cycle" })
        const chain = new Chain(root, testContext)

        const result = getErrors(chain, ["branch"], testContext)
        pending.resolve(root)

        const errors = await result
        expectErrors(errors, [hiddenError])
        expect(hasCycleCut(root.branch, "pending", testContext)).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("walks sealed values behind a cycle cut", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const directError = new Error("frozen direct")
        const promisedError = new Error("frozen promised")
        const sealed = Object.seal({
            directError,
            pending: pending.promise,
        })
        const first = { sealed }
        const second = { back: first }
        first.next = second
        importValue(first, { ...testContext, errorContext: "sealed cycle" })

        const result = getErrors(new Chain(second, testContext), [], testContext)
        pending.resolve({ promisedError })

        expectErrors(
            await result,
            [directError, promisedError],
        )
        expect(sealed.pending).to.be(pending.promise)
        expect(readPath(new Chain(sealed, testContext), ["pending"], testContext)).to.eql({
            promisedError,
        })
        verifyRefCounts(testContext, second)
    })

    it("visits a pending island once across indexed cycle paths", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const rejection = new Error("shared pending island")
        const island = { pending: pending.promise }
        const first = { island }
        const second = { back: first, island }
        first.next = second
        importValue(first, { ...testContext, errorContext: "indexed cycle dedup" })
        const registrationsBeforeQuery = registrations()

        const result = getErrors(new Chain(second, testContext), [], testContext)

        expect(registrations()).to.be(registrationsBeforeQuery + 1)
        pending.reject(rejection)
        expectErrors(
            await result,
            [rejection],
        )
        verifyRefCounts(testContext, second)
    })

    it("returns immediate path results synchronously", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const nestedError = new Error("nested")
        const pathError = new Error("path")
        const hiddenError = new Error("hidden")
        const rootError = new Error("root")
        const root = {
            branch: { nested: { bad: nestedError } },
            blocked: pathError,
            primitive: 1,
            nullValue: null,
            undefinedValue: undefined,
            clean: { ok: true },
            frozen: Object.freeze({ ok: true }),
        }
        Object.defineProperty(root, "hidden", {
            value: hiddenError,
            enumerable: false,
        })
        importValue(root.frozen, { ...testContext, errorContext: "frozen immediate path" })

        const rootChain = new Chain(root, testContext)
        expectErrors(getErrors(rootChain, ["branch"], testContext), [nestedError])
        expectErrors(getErrors(rootChain, ["blocked", "x"], testContext), [pathError])
        for (const path of [
            ["missing"],
            ["primitive"],
            ["nullValue"],
            ["undefinedValue"],
            ["clean"],
            ["frozen"],
            ["hidden"],
            ["__proto__"],
        ]) {
            expect(getErrors(rootChain, path, testContext)).to.be(null)
        }
        for (const path of [
            ["missing", "x"],
            ["primitive", "x"],
            ["hidden", "x"],
            ["__proto__", "x"],
        ]) {
            const errors = getErrors(rootChain, path, testContext)
            expect(errors.errors).to.be(undefined)
            expect(errors.message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
        expectErrors(getErrors(new Chain(rootError, testContext), [], testContext), [rootError])
        expect(getErrors(new Chain(7, testContext), [], testContext)).to.be(null)
    })

    it("deduplicates Error identities through arrays and DAGs", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const repeated = new Error("repeated")
        const distinct = new Error("distinct")
        const shared = { repeated, distinct }
        const branch = {
            repeated,
            array: [repeated],
            left: shared,
            right: shared,
        }

        const errors = getErrors(new Chain({ branch }, testContext), ["branch"], testContext)

        expectErrors(errors, [repeated, distinct])
        verifyRefCounts(testContext, branch)
    })

    it("prunes clean frozen children by their counters", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const error = new Error("bad")
        const frozen = Object.freeze({ nested: Object.freeze({ clean: true }) })
        const branch = { frozen, error }
        importValue(frozen, { ...testContext, errorContext: "frozen clean branch" })

        expectErrors(getErrors(new Chain({ branch }, testContext), ["branch"], testContext), [error])
        expect(getRefCounter(frozen, testContext).errorCount).to.be(0)
        expect(getRefCounter(frozen.nested, testContext).errorCount).to.be(0)
        verifyRefCounts(testContext, branch)
    })

    it("treats cycles as data and preserves Errors in frozen data", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cyclic = {}
        cyclic.self = cyclic
        importValue(cyclic, { ...testContext, errorContext: "cyclic getErrors" })

        const frozenError = new Error("bad")
        const frozen = Object.freeze({ bad: frozenError })
        importValue(frozen, { ...testContext, errorContext: "frozen getErrors" })

        const cyclicErrors = getErrors(new Chain(cyclic, testContext), [], testContext)
        const frozenErrors = getErrors(new Chain(frozen, testContext), [], testContext)

        expect(cyclicErrors).to.be(null)
        expect(frozenErrors.errors).to.be(undefined)
        expect(errorCause(frozenErrors)).to.be(frozenError)
    })

    it("collects errors through every promise barrier before returning", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const slow = deferred()
        const synchronous = new Error("synchronous")
        const nested = new Error("nested")
        const branch = {
            synchronous,
            outer: outer.promise,
            slow: slow.promise,
        }
        let settled = false

        const result = getErrors(new Chain({ branch }, testContext), ["branch"], testContext)
        result.then(() => {
            settled = true
        })

        outer.resolve({ nested, inner: inner.promise })
        await flushMicrotasks()
        expect(settled).to.be(false)

        inner.reject("rejected")
        await flushMicrotasks()
        expect(settled).to.be(false)

        slow.resolve({ repeated: synchronous })
        const errors = await result

        expect(errors.errors.some(error => error.cause === synchronous)).to.be(true)
        expect(errors.errors.some(error => error.cause === nested)).to.be(true)
        expect(errors.errors.filter(error => error.message === "rejected").length).to.be(1)
        expect(errors.errors.length).to.be(3)
        verifyRefCounts(testContext, branch)
    })

    it("reuses imported identities across promise barriers", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const child = { pending: pending.promise }
        const delayed = deferred()
        const branch = { direct: child, delayed: delayed.promise }
        const root = importValue({ branch }, { ...testContext, errorContext: "shared path branch" })

        const branchMeta = metaOf(branch, testContext)
        const childMeta = metaOf(child, testContext)
        const result = getErrors(new Chain(root, testContext), ["branch"], testContext)
        expect(registrations()).to.be(2)
        expect(branchMeta.imported).to.be(true)
        expect(childMeta.imported).to.be(true)

        delayed.resolve({ repeated: child })
        await flushMicrotasks()
        expect(registrations()).to.be(2)
        expect(metaOf(child, testContext)).to.be(childMeta)

        pending.reject("bad")
        const errors = await result
        expect(errors.errors).to.be(undefined)
        expect(errors.message).to.be("bad")
        verifyRefCounts(testContext, root)
    })

    it("walks imported DAG identities once instead of once per path", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const leaf = { pending: pending.promise }
        let branch = leaf
        for (let i = 0; i < 10; i++) {
            branch = { left: branch, right: branch }
        }

        const root = importValue(branch, { ...testContext, errorContext: "imported diamond" })
        const result = getErrors(new Chain(root, testContext), [], testContext)

        expect(registrations()).to.be(2)
        expect(requiresCopyOnWrite(leaf, testContext)).to.be(true)

        pending.reject("diamond failure")
        const errors = await result
        expect(errors.errors).to.be(undefined)
        expect(errors.message).to.be("diamond failure")
        verifyRefCounts(testContext, root)
    })

    it("waits when a known Error shares a branch with an unresolved promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const error = new Error("known")
        const branch = { error, pending: pending.promise }
        let settled = false

        const result = getErrors(new Chain(branch, testContext), [], testContext)
        result.then(() => {
            settled = true
        })

        await flushMicrotasks()
        expect(settled).to.be(false)

        pending.resolve("clean")
        expectErrors(await result, [error])
    })

    it("does not mark the queried branch as shared", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const branch = { pending: pending.promise }

        const result = getErrors(new Chain({ branch }, testContext), ["branch"], testContext)
        const meta = metaOf(branch, testContext)

        expect(meta.imported).to.be(undefined)

        pending.resolve("clean")
        expect(await result).to.be(null)
        expect(meta.imported).to.be(undefined)
    })

    it("keeps concurrent error-query state independent", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const initial = deferred()
        const later = deferred()
        const laterError = new Error("later")
        const chain = new Chain({ branch: { initial: initial.promise } }, testContext)

        const collectedBefore = getErrors(chain, ["branch"], testContext)
        assignPath(chain, ["branch", "later"], later.promise, testContext)
        const foundAfter = hasError(chain, ["branch"], testContext)

        initial.resolve("clean")
        expect(await collectedBefore).to.be(null)

        later.reject(laterError)
        expect(await foundAfter).to.be(true)
        verifyRefCounts(testContext, chain._state.value)
    })

    it("keeps imported alias frontiers indexed across settlement", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        for (const query of [hasError, getErrors]) {
            const late = deferred()
            const bridge = deferred()
            const error = new Error("late imported error")
            const shared = { late: late.promise }
            const root = importValue(
                { shared, bridge: bridge.promise },
                { ...testContext, errorContext: "interleaved imported aliases" },
            )
            const result = query(new Chain(root, testContext), [], testContext)

            // The bridge exposes an identity already visited by the query.
            // Its existing Promise placement remains the only one to settle.
            bridge.resolve(shared)
            await flushMicrotasks()
            late.resolve({ bad: error })

            const answer = await result
            if (query === hasError) {
                expect(answer).to.be(true)
            } else {
                expectErrors(answer, [error])
            }
            verifyRefCounts(testContext, root)
        }
    })

    it("coexists with an independent export of the same branch", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const bad = deferred()
        const slow = deferred()
        const error = new Error("bad")
        const branch = { bad: bad.promise, slow: slow.promise }
        const chain = new Chain({ branch }, testContext)
        let exportSettled = false
        let getErrorsSettled = false

        const exported = exportValue(chain, ["branch"], testContext)
        exported.then(
            () => {
                exportSettled = true
            },
            () => {
                exportSettled = true
            },
        )

        const collected = getErrors(chain, ["branch"], testContext)
        collected.then(() => {
            getErrorsSettled = true
        })

        bad.reject(error)
        await flushMicrotasks()

        expect(exportSettled).to.be(false)
        expect(getErrorsSettled).to.be(false)

        slow.resolve("clean")
        const [exportedValue, errors] = await Promise.all([
            exported,
            collected,
        ])

        expect(errorCause(exportedValue)).to.be(error)
        expectErrors(errors, [error])
        verifyRefCounts(testContext, chain._state.value)
    })

    it("observes earlier suspended writes and ignores later ones", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const earlier = deferred()
        const earlierError = new Error("earlier")
        const earlierChain = new Chain({ pending: earlier.promise }, testContext)

        assignPath(earlierChain, ["pending", "bad"], earlierError, testContext)
        const earlierResult = getErrors(earlierChain, [], testContext)
        earlier.resolve({})

        expectErrors(await earlierResult, [earlierError])

        const later = deferred()
        const laterError = new Error("later")
        const laterChain = new Chain({ pending: later.promise }, testContext)

        const laterResult = getErrors(laterChain, [], testContext)
        assignPath(laterChain, ["pending", "bad"], laterError, testContext)
        later.resolve({})

        expect(await laterResult).to.be(null)
        expect(hasError(laterChain, [], testContext)).to.be(true)
    })

    it("orders suspended Error replacements around the query", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const fixedBefore = deferred()
        const transient = new Error("transient")
        const beforeChain = new Chain({ pending: fixedBefore.promise }, testContext)

        assignPath(beforeChain, ["pending", "bad"], "fixed", testContext)
        const afterEarlierReplacement = getErrors(beforeChain, [], testContext)
        fixedBefore.resolve({ bad: transient })

        expect(await afterEarlierReplacement).to.be(null)
        expect(beforeChain._state.value.pending).to.eql({ bad: "fixed" })

        const fixedAfter = deferred()
        const current = new Error("current")
        const afterChain = new Chain({ pending: fixedAfter.promise }, testContext)

        const beforeLaterReplacement = getErrors(afterChain, [], testContext)
        assignPath(afterChain, ["pending", "bad"], "fixed", testContext)
        fixedAfter.resolve({ bad: current })

        expectErrors(await beforeLaterReplacement, [current])
        expect(afterChain._state.value.pending).to.eql({ bad: "fixed" })
    })

    it("ignores later errors outside its captured promise frontier", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const future = new Error("future")
        const chain = new Chain({ branch: { pending: pending.promise, stable: {} } }, testContext)

        const result = getErrors(chain, ["branch"], testContext)
        assignPath(chain, ["branch", "stable", "bad"], future, testContext)
        pending.resolve("clean")

        expect(await result).to.be(null)
        expect(hasError(chain, ["branch"], testContext)).to.be(true)
    })

    it("collects private results from overwritten and deleted versions", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const overwritten = deferred()
        const deleted = deferred()
        const nested = deferred()
        const overwrittenError = new Error("overwritten")
        const nestedError = new Error("nested")
        const branch = {
            overwritten: overwritten.promise,
            deleted: deleted.promise,
        }
        const chain = new Chain({ branch }, testContext)

        const result = getErrors(chain, ["branch"], testContext)
        assignPath(chain, ["branch", "overwritten"], "replacement", testContext)
        deletePath(chain, ["branch", "deleted"], testContext)

        const privateBranch = {
            bad: overwrittenError,
            nested: nested.promise,
        }
        overwritten.resolve(privateBranch)
        deleted.reject("deleted")
        nested.resolve({ bad: nestedError })

        const errors = await result
        expect(errors.errors.some(error => error.cause === overwrittenError)).to.be(
            true,
        )
        expect(errors.errors.some(error => error.cause === nestedError)).to.be(true)
        expect(errors.errors.filter(error => error.message === "deleted").length).to.be(1)
        expect(errors.errors.length).to.be(3)
        expect(chain._state.value.branch).to.eql({ overwritten: "replacement" })
        verifyRefCounts(testContext, chain._state.value, privateBranch)
    })

    it("does not report an imported cycle captured before a COW overwrite", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const branch = { pending: pending.promise }
        importValue(branch, { ...testContext, errorContext: "captured getErrors cycle" })
        const chain = new Chain(branch, testContext)

        const result = getErrors(chain, [], testContext)
        assignPath(chain, ["pending"], "replacement", testContext)
        pending.resolve(branch)

        const errors = await result
        expect(errors).to.be(null)
        expect(chain._state.value.pending).to.be("replacement")
        expect(branch.pending).to.be(pending.promise)
        expect(readPath(new Chain(branch, testContext), ["pending"], testContext)).to.be(branch)
    })

    it("does not report a detached terminal cycle after a COW overwrite", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const branch = { pending: pending.promise }
        importValue(branch, { ...testContext, errorContext: "detached terminal cycle" })
        const chain = new Chain(branch, testContext)

        const result = getErrors(chain, ["pending"], testContext)
        assignPath(chain, ["pending"], "replacement", testContext)
        pending.resolve(branch)

        const errors = await result
        expect(errors).to.be(null)
        expect(chain._state.value.pending).to.be("replacement")
    })

    it("indexes and collects a committed terminal cut", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const hidden = new Error("public terminal cycle error")
        const first = { hidden }
        const second = { back: first }
        first.next = second
        importValue(first, { ...testContext, errorContext: "public terminal cycle" })

        const errors = getErrors(new Chain(second, testContext), ["back"], testContext)

        expectErrors(errors, [hidden])
        expect(getRefCounter(first, testContext)).not.to.be(undefined)
        expect(getRefCounter(second, testContext)).not.to.be(undefined)
        verifyRefCounts(testContext, first, second)
    })

    it("resolves promised paths and root promises", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const parent = deferred()
        const root = deferred()
        const parentError = new Error("parent path")
        const rootError = new Error("root promise")

        const parentResult = getErrors(new Chain({ parent: parent.promise }, testContext), ["parent", "branch"], testContext)
        const rootResult = getErrors(new Chain(root.promise, testContext), ["branch"], testContext)

        parent.resolve({ branch: { bad: parentError } })
        root.resolve({ branch: { bad: rootError } })

        expectErrors(await parentResult, [parentError])
        expectErrors(await rootResult, [rootError])
    })

    it("collects a path Error exposed after a promise barrier", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const result = getErrors(
            new Chain({ parent: pending.promise }, testContext),
            ["parent", "missing", "value"],
            testContext,
        )

        pending.resolve({})
        const errors = await result

        expect(errors.errors).to.be(undefined)
        expect(errors.message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("continues through a root promise overwritten after capture", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const error = new Error("captured root")
        const chain = new Chain(pending.promise, testContext)

        const result = getErrors(chain, ["branch"], testContext)
        assignPath(chain, [], { clean: true }, testContext)
        pending.resolve({ branch: { bad: error } })

        expectErrors(await result, [error])
        expect(chain._state.value).to.eql({ clean: true })
    })

    it("reads terminal promises on sealed parents through versions", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const sealed = Object.seal({ pending: pending.promise })
        importValue(sealed, { ...testContext, errorContext: "sealed terminal" })

        const result = getErrors(new Chain(sealed, testContext), ["pending"], testContext)
        pending.reject("sealed terminal")

        const errors = await result
        expect(errors.errors).to.be(undefined)
        expect(errors.message).to.be("sealed terminal")
        expect(sealed.pending).to.be(pending.promise)
        expect(readPath(new Chain(sealed, testContext), ["pending"], testContext)).to.be(
            errors,
        )
        expect(metaOf(sealed, testContext).placementVersions.pending).not.to.be(undefined)
        expect(getRefCounter(sealed, testContext)).to.be(undefined)
    })

    it("agrees with hasError synchronously on their shared path domain", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const error = new Error("bad")
        const chain = new Chain({ bad: error, clean: {} }, testContext)

        expect(hasError(chain, ["bad"], testContext)).to.be(getErrors(chain, ["bad"], testContext) !== null)
        expect(hasError(chain, ["clean"], testContext)).to.be(getErrors(chain, ["clean"], testContext) !== null)
        expect(hasError(chain, ["bad", "x"], testContext)).to.be(
            getErrors(chain, ["bad", "x"], testContext) !== null,
        )
        expect(hasError(chain, ["missing", "x"], testContext)).to.be(
            getErrors(chain, ["missing", "x"], testContext) !== null,
        )
    })

    it("agrees with hasError behind settling promise barriers", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: { outer: outer.promise } }, testContext)

        const foundError = hasError(chain, ["branch"], testContext)
        const collectedErrors = getErrors(chain, ["branch"], testContext)

        outer.resolve({ inner: inner.promise })
        inner.reject("bad")

        const [found, errors] = await Promise.all([foundError, collectedErrors])
        expect(found).to.be(errors !== null)
    })
})
