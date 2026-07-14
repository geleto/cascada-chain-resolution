const {
    Chain,
    assignPath,
    countPromiseRegistrations,
    deferred,
    deletePath,
    expect,
    flushMicrotasks,
    getErrors,
    hasError,
    importValue,
    metaOf,
    normalize,
    verifyRefCounts,
} = require("./support")

function expectErrors(actual, expected) {
    expect(actual.length).to.be(expected.length)
    for (const error of expected) {
        expect(actual.includes(error)).to.be(true)
    }
}

describe("getErrors", () => {
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

    it("skips valid frozen children before reading counters", () => {
        const error = new Error("bad")
        const frozen = Object.freeze({ nested: Object.freeze({ clean: true }) })
        const branch = { frozen, error }

        expectErrors(getErrors(new Chain({ branch }), ["branch"]), [error])
        verifyRefCounts(branch)
    })

    it("returns attributed validation failures", () => {
        const cyclic = {}
        cyclic.self = cyclic
        importValue(cyclic, "cyclic getErrors")

        const frozen = Object.freeze({ bad: new Error("bad") })
        importValue(frozen, "frozen getErrors")

        const cyclicErrors = getErrors(new Chain(cyclic), [])
        const frozenErrors = getErrors(new Chain(frozen), [])

        expect(cyclicErrors.length).to.be(1)
        expect(cyclicErrors[0].message).to.be(
            "Value cannot be cyclic (imported at: cyclic getErrors)",
        )
        expect(frozenErrors.length).to.be(1)
        expect(frozenErrors[0].message).to.be(
            "Frozen object cannot contain promises or errors (imported at: frozen getErrors)",
        )
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

    it("reuses recursively marked imported descendants across promise barriers", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const child = { pending: pending.promise }
        const delayed = deferred()
        const branch = { direct: child, delayed: delayed.promise }
        const root = importValue({ branch }, "shared path branch")

        const result = getErrors(new Chain(root), ["branch"])
        // Import, mirror writeback, and the query each register once.
        expect(registrations()).to.be(3)
        expect(metaOf(branch).shared).to.be(true)
        expect(metaOf(child).shared).to.be(true)

        delayed.resolve(child)
        await flushMicrotasks()
        expect(registrations()).to.be(3)

        pending.reject("bad")
        const errors = await result
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be("bad")
        verifyRefCounts(root)
    })

    it("walks imported DAG identities once instead of once per path", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        let branch = { pending: pending.promise }
        for (let i = 0; i < 10; i++) {
            branch = { left: branch, right: branch }
        }

        const root = importValue(branch, "imported diamond")
        const result = getErrors(new Chain(root), [])

        // One import registration, one mirror, and one error-query wait.
        expect(registrations()).to.be(3)

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

    it("does not mark or create a normalize settlement wait", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }

        const result = getErrors(new Chain({ branch }), ["branch"])
        const meta = metaOf(branch)

        expect(meta.shared).to.be(false)
        expect(meta.settlementPromise).to.be(undefined)

        pending.resolve("clean")
        expect(await result).to.eql([])
        expect(meta.shared).to.be(false)
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

    it("coexists with normalize on the same pinned branch", async () => {
        const bad = deferred()
        const slow = deferred()
        const error = new Error("bad")
        const branch = { bad: bad.promise, slow: slow.promise }
        const chain = new Chain({ branch })
        let normalizeSettled = false
        let getErrorsSettled = false

        const normalized = normalize(chain, ["branch"])
        const settlementPromise = metaOf(branch).settlementPromise
        normalized.then(() => {
            normalizeSettled = true
        })

        const collected = getErrors(chain, ["branch"])
        collected.then(() => {
            getErrorsSettled = true
        })

        expect(metaOf(branch).settlementPromise).to.be(settlementPromise)
        bad.reject(error)
        await flushMicrotasks()

        expect(normalizeSettled).to.be(false)
        expect(getErrorsSettled).to.be(false)

        slow.resolve("clean")
        const [normalizedValue, errors] = await Promise.all([normalized, collected])

        expect(normalizedValue instanceof Error).to.be(true)
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

    it("collects attributed validation failures from revoked mirrors", async () => {
        const pending = deferred()
        const branch = {}
        branch.pending = importValue(pending.promise, "revoked getErrors")
        const chain = new Chain(branch)

        const result = getErrors(chain, [])
        assignPath(chain, ["pending"], "replacement")
        pending.resolve(branch)

        const errors = await result
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be(
            "Value cannot reach its write target (imported at: revoked getErrors)",
        )
        expect(chain._state.value.pending).to.be("replacement")
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

    it("reads terminal promises on frozen parents without indexing the parent", async () => {
        const pending = deferred()
        const frozen = Object.freeze({ pending: pending.promise })

        const result = getErrors(new Chain(frozen), ["pending"])
        pending.reject("frozen terminal")

        const errors = await result
        expect(errors.length).to.be(1)
        expect(errors[0].message).to.be("frozen terminal")
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
