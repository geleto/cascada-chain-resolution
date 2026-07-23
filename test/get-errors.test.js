import {
    Chain,
    assignPath,
    buildRefIndex,
    countPromiseRegistrations,
    deferred,
    deletePath,
    expect,
    flushMicrotasks,
    getErrors,
    getRefCounter,
    hasError,
    importValue,
    metaOf,
    exportValue,
    thrownBy,
    verifyRefCounts,
} from "./support.js"
import { collectRawErrors } from "../src/raw-walk.js"

function expectErrors(actual, expected) {
    expect(actual.length).to.be(expected.length)
    for (const error of expected) {
        expect(actual.includes(error)).to.be(true)
    }
}

describe("getErrors", () => {
    it("reports a missing indexed promise mirror as fatal", () => {
        for (const query of [hasError, getErrors]) {
            const pending = deferred()
            const root = { pending: pending.promise }
            buildRefIndex(root)
            delete metaOf(root).mirrors.pending

            const failure = thrownBy(() => query(new Chain(root), []))

            expect(failure instanceof Error).to.be(true)
            expect(failure.message).to.be(
                "Indexed promise property has no matching mirror",
            )
        }
    })

    it("continues through cycle cuts while collecting ordinary Errors", () => {
        const siblingError = new Error("sibling")
        const hiddenError = new Error("hidden")
        const left = { siblingError }
        const right = { hiddenError }
        left.right = right
        right.left = left
        importValue(left, "error cut")
        const chain = new Chain(left)

        const errors = getErrors(chain, [])
        const cycleError = metaOf(right).cycleErrors.left

        expect(cycleError instanceof Error).to.be(true)
        expectErrors(errors, [siblingError, hiddenError, cycleError])
        expect(hasError(chain, [])).to.be(true)
        expectErrors(
            getErrors(chain, ["right"]),
            [siblingError, hiddenError, cycleError],
        )
        expectErrors(
            getErrors(new Chain(right), []),
            [siblingError, hiddenError, cycleError],
        )
    })

    it("waits for errors reachable only behind a cycle cut", async () => {
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
        importValue(first, "raw error collection")
        const chain = new Chain(second)
        const cycleError = metaOf(second).cycleErrors.back

        expect(hasError(chain, [])).to.be(true)
        const result = getErrors(chain, [])
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
            [hiddenError, promisedError, visibleError, cycleError],
        )
    })

    it("collects behind a private mid-branch mirror cut", async () => {
        const pending = deferred()
        const hiddenError = new Error("outside queried branch")
        const root = {
            hiddenError,
            branch: { pending: pending.promise },
        }
        importValue(root, "private mid-branch cycle")
        const chain = new Chain(root)

        const result = getErrors(chain, ["branch"])
        pending.resolve(root)

        const errors = await result
        const cycleError = metaOf(root.branch).mirrors.pending.cycleError
        expectErrors(errors, [hiddenError, cycleError])
        expect(cycleError.message).to.be(
            'Cyclic property "pending" (imported at: private mid-branch cycle)',
        )
        verifyRefCounts(root)
    })

    it("walks non-extensible values behind a cycle cut", async () => {
        const pending = deferred()
        const directError = new Error("frozen direct")
        const promisedError = new Error("frozen promised")
        const frozen = Object.freeze({
            directError,
            pending: pending.promise,
        })
        const first = { frozen }
        const second = { back: first }
        first.next = second
        importValue(first, "frozen raw cycle")

        const result = getErrors(new Chain(second), [])
        pending.resolve({ promisedError })

        expectErrors(
            await result,
            [directError, promisedError, metaOf(second).cycleErrors.back],
        )
        expect(frozen.pending).to.be(pending.promise)
        verifyRefCounts(second)
    })

    it("visits a pending island once across counted and raw paths", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const rejection = new Error("shared pending island")
        const island = { pending: pending.promise }
        const first = { island }
        const second = { back: first, island }
        first.next = second
        importValue(first, "counted and raw dedup")
        const registrationsBeforeQuery = registrations()

        const result = getErrors(new Chain(second), [])

        expect(registrations()).to.be(registrationsBeforeQuery + 1)
        pending.reject(rejection)
        expectErrors(
            await result,
            [rejection, metaOf(second).cycleErrors.back],
        )
        verifyRefCounts(second)
    })

    it("returns immediate path results synchronously", () => {
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

        expectErrors(getErrors(new Chain(root), ["branch"]), [nestedError])
        expectErrors(getErrors(new Chain(root), ["blocked", "x"]), [pathError])
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
            expect(getErrors(new Chain(root), path)).to.eql([])
        }
        for (const path of [
            ["missing", "x"],
            ["primitive", "x"],
            ["hidden", "x"],
            ["__proto__", "x"],
        ]) {
            const errors = getErrors(new Chain(root), path)
            expect(errors.length).to.be(1)
            expect(errors[0].message).to.be(
                "Cannot access property through missing or primitive value",
            )
        }
        expectErrors(getErrors(new Chain(rootError), []), [rootError])
        expect(getErrors(new Chain(7), [])).to.eql([])
    })

    it("deduplicates Error identities through arrays and DAGs", () => {
        const repeated = new Error("repeated")
        const distinct = new Error("distinct")
        const shared = { repeated, distinct }
        const branch = {
            repeated,
            array: [repeated],
            left: shared,
            right: shared,
        }

        const errors = getErrors(new Chain({ branch }), ["branch"])

        expectErrors(errors, [repeated, distinct])
        verifyRefCounts(branch)
    })

    it("prunes clean frozen children by their counters", () => {
        const error = new Error("bad")
        const frozen = Object.freeze({ nested: Object.freeze({ clean: true }) })
        const branch = { frozen, error }

        expectErrors(getErrors(new Chain({ branch }), ["branch"]), [error])
        expect(getRefCounter(frozen).errorCount).to.be(0)
        expect(getRefCounter(frozen.nested).errorCount).to.be(0)
        verifyRefCounts(branch)
    })

    it("returns cycle diagnostics and preserves Errors in frozen data", () => {
        const cyclic = {}
        cyclic.self = cyclic
        importValue(cyclic, "cyclic getErrors")

        const frozenError = new Error("bad")
        const frozen = Object.freeze({ bad: frozenError })
        importValue(frozen, "frozen getErrors")

        const cyclicErrors = getErrors(new Chain(cyclic), [])
        const frozenErrors = getErrors(new Chain(frozen), [])

        expect(cyclicErrors.length).to.be(1)
        expect(cyclicErrors[0].message).to.be(
            'Cyclic property "self" (imported at: cyclic getErrors)',
        )
        expect(frozenErrors.length).to.be(1)
        expect(frozenErrors[0]).to.be(frozenError)
    })

    it("collects errors through every promise barrier before returning", async () => {
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

        const result = getErrors(new Chain({ branch }), ["branch"])
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

        expect(errors.includes(synchronous)).to.be(true)
        expect(errors.includes(nested)).to.be(true)
        expect(errors.filter(error => error.message === "rejected").length).to.be(1)
        expect(errors.length).to.be(3)
        verifyRefCounts(branch)
    })

    it("reuses imported identities across promise barriers", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const child = { pending: pending.promise }
        const delayed = deferred()
        const branch = { direct: child, delayed: delayed.promise }
        const root = importValue({ branch }, "shared path branch")

        const result = getErrors(new Chain(root), ["branch"])
        // Writeback, imported-path continuation, then the query wait.
        expect(registrations()).to.be(3)
        expect(metaOf(branch).shared).to.be(undefined)
        expect(metaOf(child).shared).to.be(undefined)

        delayed.resolve({ repeated: child })
        await flushMicrotasks()
        // The repeated child adds one fixed-path continuation but no second
        // query wait.
        expect(registrations()).to.be(4)
        expect(metaOf(child).shared).to.be(true)

        pending.reject("bad")
        const errors = await result
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be("bad")
        verifyRefCounts(root)
    })

    it("walks imported DAG identities once instead of once per path", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const leaf = { pending: pending.promise }
        let branch = leaf
        for (let i = 0; i < 10; i++) {
            branch = { left: branch, right: branch }
        }

        const root = importValue(branch, "imported diamond")
        const result = getErrors(new Chain(root), [])

        // One writeback, one imported-path continuation, and one query wait.
        expect(registrations()).to.be(3)
        expect(metaOf(leaf).shared).to.be(true)

        pending.reject("diamond failure")
        const errors = await result
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be("diamond failure")
        verifyRefCounts(root)
    })

    it("waits when a known Error shares a branch with an unresolved promise", async () => {
        const pending = deferred()
        const error = new Error("known")
        const branch = { error, pending: pending.promise }
        let settled = false

        const result = getErrors(new Chain(branch), [])
        result.then(() => {
            settled = true
        })

        await flushMicrotasks()
        expect(settled).to.be(false)

        pending.resolve("clean")
        expectErrors(await result, [error])
    })

    it("does not mark or create an export settlement wait", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }

        const result = getErrors(new Chain({ branch }), ["branch"])
        const meta = metaOf(branch)

        expect(meta.shared).to.be(undefined)
        expect(meta.settlementPromise).to.be(undefined)

        pending.resolve("clean")
        expect(await result).to.eql([])
        expect(meta.shared).to.be(undefined)
        expect(meta.settlementPromise).to.be(undefined)
    })

    it("keeps concurrent error-query state independent", async () => {
        const initial = deferred()
        const later = deferred()
        const laterError = new Error("later")
        const chain = new Chain({ branch: { initial: initial.promise } })

        const collectedBefore = getErrors(chain, ["branch"])
        assignPath(chain, ["branch", "later"], later.promise)
        const foundAfter = hasError(chain, ["branch"])

        initial.resolve("clean")
        expect(await collectedBefore).to.eql([])

        later.reject(laterError)
        expect(await foundAfter).to.be(true)
        verifyRefCounts(chain._state.value)
    })

    it("indexes imported promise values between preparation consumers", async () => {
        for (const query of [hasError, getErrors]) {
            const late = deferred()
            const bridge = deferred()
            const error = new Error("late imported error")
            const shared = { late: late.promise }
            const root = importValue(
                { shared, bridge: bridge.promise },
                "interleaved import preparation",
            )
            const result = query(new Chain(root), [])

            // Revisiting shared through bridge registers another preparation
            // consumer after the query has already registered on late.
            bridge.resolve(shared)
            await flushMicrotasks()
            late.resolve({ bad: error })

            const answer = await result
            if (query === hasError) {
                expect(answer).to.be(true)
            } else {
                expectErrors(answer, [error])
            }
            verifyRefCounts(root)
        }
    })

    it("coexists with export on the same pinned branch", async () => {
        const bad = deferred()
        const slow = deferred()
        const error = new Error("bad")
        const branch = { bad: bad.promise, slow: slow.promise }
        const chain = new Chain({ branch })
        let exportSettled = false
        let getErrorsSettled = false

        const exported = exportValue(chain, ["branch"])
        const settlementPromise = metaOf(branch).settlementPromise
        exported.then(() => {
            exportSettled = true
        })

        const collected = getErrors(chain, ["branch"])
        collected.then(() => {
            getErrorsSettled = true
        })

        expect(metaOf(branch).settlementPromise).to.be(settlementPromise)
        bad.reject(error)
        await flushMicrotasks()

        expect(exportSettled).to.be(false)
        expect(getErrorsSettled).to.be(false)

        slow.resolve("clean")
        const [exportedValue, errors] = await Promise.all([exported, collected])

        expect(exportedValue instanceof Error).to.be(true)
        expectErrors(errors, [error])
        expect(metaOf(branch).settlementPromise).to.be(undefined)
        verifyRefCounts(chain._state.value)
    })

    it("observes earlier suspended writes and ignores later ones", async () => {
        const earlier = deferred()
        const earlierError = new Error("earlier")
        const earlierChain = new Chain({ pending: earlier.promise })

        assignPath(earlierChain, ["pending", "bad"], earlierError)
        const earlierResult = getErrors(earlierChain, [])
        earlier.resolve({})

        expectErrors(await earlierResult, [earlierError])

        const later = deferred()
        const laterError = new Error("later")
        const laterChain = new Chain({ pending: later.promise })

        const laterResult = getErrors(laterChain, [])
        assignPath(laterChain, ["pending", "bad"], laterError)
        later.resolve({})

        expect(await laterResult).to.eql([])
        expect(hasError(laterChain, [])).to.be(true)
    })

    it("orders suspended Error replacements around the query", async () => {
        const fixedBefore = deferred()
        const transient = new Error("transient")
        const beforeChain = new Chain({ pending: fixedBefore.promise })

        assignPath(beforeChain, ["pending", "bad"], "fixed")
        const afterEarlierReplacement = getErrors(beforeChain, [])
        fixedBefore.resolve({ bad: transient })

        expect(await afterEarlierReplacement).to.eql([])
        expect(beforeChain._state.value.pending).to.eql({ bad: "fixed" })

        const fixedAfter = deferred()
        const current = new Error("current")
        const afterChain = new Chain({ pending: fixedAfter.promise })

        const beforeLaterReplacement = getErrors(afterChain, [])
        assignPath(afterChain, ["pending", "bad"], "fixed")
        fixedAfter.resolve({ bad: current })

        expectErrors(await beforeLaterReplacement, [current])
        expect(afterChain._state.value.pending).to.eql({ bad: "fixed" })
    })

    it("ignores later errors outside its captured promise frontier", async () => {
        const pending = deferred()
        const future = new Error("future")
        const chain = new Chain({ branch: { pending: pending.promise, stable: {} } })

        const result = getErrors(chain, ["branch"])
        assignPath(chain, ["branch", "stable", "bad"], future)
        pending.resolve("clean")

        expect(await result).to.eql([])
        expect(hasError(chain, ["branch"])).to.be(true)
    })

    it("collects private results from overwritten and deleted mirrors", async () => {
        const overwritten = deferred()
        const deleted = deferred()
        const nested = deferred()
        const overwrittenError = new Error("overwritten")
        const nestedError = new Error("nested")
        const branch = {
            overwritten: overwritten.promise,
            deleted: deleted.promise,
        }
        const chain = new Chain({ branch })

        const result = getErrors(chain, ["branch"])
        assignPath(chain, ["branch", "overwritten"], "replacement")
        deletePath(chain, ["branch", "deleted"])

        const privateBranch = {
            bad: overwrittenError,
            nested: nested.promise,
        }
        overwritten.resolve(privateBranch)
        deleted.reject("deleted")
        nested.resolve({ bad: nestedError })

        const errors = await result
        expect(errors.includes(overwrittenError)).to.be(true)
        expect(errors.includes(nestedError)).to.be(true)
        expect(errors.filter(error => error.message === "deleted").length).to.be(1)
        expect(errors.length).to.be(3)
        expect(chain._state.value.branch).to.eql({ overwritten: "replacement" })
        verifyRefCounts(chain._state.value, privateBranch)
    })

    it("collects an imported cycle captured before a COW overwrite", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        importValue(branch, "captured getErrors cycle")
        const chain = new Chain(branch)

        const result = getErrors(chain, [])
        assignPath(chain, ["pending"], "replacement")
        pending.resolve(branch)

        const errors = await result
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be(
            'Cyclic property "pending" (imported at: captured getErrors cycle)',
        )
        expect(chain._state.value.pending).to.be("replacement")
        expect(branch.pending).to.be(pending.promise)
    })

    it("collects a private terminal cycle after a COW overwrite", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        importValue(branch, "private terminal cycle")
        const chain = new Chain(branch)

        const result = getErrors(chain, ["pending"])
        assignPath(chain, ["pending"], "replacement")
        pending.resolve(branch)

        const errors = await result
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be(
            'Cyclic property "pending" (imported at: private terminal cycle)',
        )
        expect(chain._state.value.pending).to.be("replacement")
    })

    it("collects raw cycle errors without requiring counters", () => {
        const hidden = new Error("hidden raw error")
        const first = { hidden }
        const second = { back: first }
        first.next = second
        importValue(first, "counterless raw cycle")

        const errors = new Set()
        const readiness = collectRawErrors(
            first,
            metaOf(first).importBoundary,
            metaOf(second).cycleErrors.back,
            errors,
            new WeakSet(),
        )

        expect(readiness).to.be(undefined)
        expectErrors(
            [...errors],
            [hidden, metaOf(second).cycleErrors.back],
        )
        expect(getRefCounter(first)).to.be(undefined)
        expect(getRefCounter(second)).to.be(undefined)
    })

    it("collects a committed terminal cut through the public API", () => {
        const hidden = new Error("public counterless raw error")
        const first = { hidden }
        const second = { back: first }
        first.next = second
        importValue(first, "public counterless cycle")

        const errors = getErrors(new Chain(second), ["back"])

        expectErrors(
            errors,
            [hidden, metaOf(second).cycleErrors.back],
        )
        expect(getRefCounter(first)).to.be(undefined)
    })

    it("resolves promised paths and root promises", async () => {
        const parent = deferred()
        const root = deferred()
        const parentError = new Error("parent path")
        const rootError = new Error("root promise")

        const parentResult = getErrors(new Chain({ parent: parent.promise }), ["parent", "branch"])
        const rootResult = getErrors(new Chain(root.promise), ["branch"])

        parent.resolve({ branch: { bad: parentError } })
        root.resolve({ branch: { bad: rootError } })

        expectErrors(await parentResult, [parentError])
        expectErrors(await rootResult, [rootError])
    })

    it("collects a path Error exposed after a promise barrier", async () => {
        const pending = deferred()
        const result = getErrors(
            new Chain({ parent: pending.promise }),
            ["parent", "missing", "value"],
        )

        pending.resolve({})
        const errors = await result

        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be(
            "Cannot access property through missing or primitive value",
        )
    })

    it("continues through a root promise overwritten after capture", async () => {
        const pending = deferred()
        const error = new Error("captured root")
        const chain = new Chain(pending.promise)

        const result = getErrors(chain, ["branch"])
        assignPath(chain, [], { clean: true })
        pending.resolve({ branch: { bad: error } })

        expectErrors(await result, [error])
        expect(chain._state.value).to.eql({ clean: true })
    })

    it("reads terminal promises on frozen parents through mirrors", async () => {
        const pending = deferred()
        const frozen = Object.freeze({ pending: pending.promise })

        const result = getErrors(new Chain(frozen), ["pending"])
        pending.reject("frozen terminal")

        const errors = await result
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be("frozen terminal")
        expect(frozen.pending).to.be(pending.promise)
        expect(metaOf(frozen).mirrors.pending.pendingConsumerCount).to.be(0)
        expect(getRefCounter(frozen)).to.be(undefined)
    })

    it("agrees with hasError synchronously on their shared path domain", () => {
        const error = new Error("bad")
        const chain = new Chain({ bad: error, clean: {} })

        expect(hasError(chain, ["bad"])).to.be(getErrors(chain, ["bad"]).length > 0)
        expect(hasError(chain, ["clean"])).to.be(getErrors(chain, ["clean"]).length > 0)
        expect(hasError(chain, ["bad", "x"])).to.be(
            getErrors(chain, ["bad", "x"]).length > 0,
        )
        expect(hasError(chain, ["missing", "x"])).to.be(
            getErrors(chain, ["missing", "x"]).length > 0,
        )
    })

    it("agrees with hasError behind settling promise barriers", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: { outer: outer.promise } })

        const foundError = hasError(chain, ["branch"])
        const collectedErrors = getErrors(chain, ["branch"])

        outer.resolve({ inner: inner.promise })
        inner.reject("bad")

        const [found, errors] = await Promise.all([foundError, collectedErrors])
        expect(found).to.be(errors.length > 0)
    })
})
