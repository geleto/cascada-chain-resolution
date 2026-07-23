const {
    Chain,
    expect,
    buildRefIndex,
    getRefCounter,
    verifyRefCounts,
    assignPath,
    deletePath,
    hasError,
    importValue,
    metaOf,
    normalize,
    lookupPath,
    countPromiseRegistrations,
    deferred,
    flushMicrotasks,
} = require("./support")

describe("hasError", () => {
    it("answers immediate path cases synchronously", () => {
        const root = {
            branch: {
                clean: { x: 1 },
                bad: new Error("bad"),
            },
        }

        expect(hasError(new Chain(root), [])).to.be(true)
        expect(hasError(new Chain(root), ["branch"])).to.be(true)
        expect(hasError(new Chain(root), ["branch", "bad"])).to.be(true)
        expect(hasError(new Chain(root), ["branch", "clean"])).to.be(false)
        expect(hasError(new Chain(root), ["branch", "missing"])).to.be(false)
        expect(hasError(new Chain(root), ["missing", "x"])).to.be(true)
        expect(hasError(new Chain(new Error("root")), [])).to.be(true)
        expect(hasError(new Chain(7), [])).to.be(false)
        expect(hasError(new Chain(7), ["x"])).to.be(true)
    })

    it("reads own enumerable __proto__ data but hides non-enumerable properties", () => {
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

        expect(hasError(new Chain(root), ["__proto__"])).to.be(true)
        expect(hasError(new Chain(root), ["hidden"])).to.be(false)
        expect(hasError(new Chain(root), ["__proto__", "x"])).to.be(true)
        expect(hasError(new Chain(root), ["hidden", "x"])).to.be(true)
    })

    it("does not mark clean queried branches as shared", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        expect(hasError(new Chain(root), ["branch"])).to.be(false)
        assignPath(new Chain(root), ["branch", "x"], 2)

        expect(root.branch).to.be(branch)
        expect(branch.x).to.be(2)
        verifyRefCounts(root)
    })

    it("indexes cyclic imports without replacing their raw branch", () => {
        const branch = {}
        branch.self = branch
        const root = { branch }

        importValue(root, "hasError import")

        expect(hasError(new Chain(root), ["branch"])).to.be(true)
        expect(getRefCounter(branch).errorCount).to.be(1)
        expect(branch.self).to.be(branch)
    })

    it("indexes non-extensible branches uniformly", async () => {
        const clean = Object.freeze({ nested: { value: 1 } })
        const pending = Object.preventExtensions({ pending: Promise.resolve(1) })
        const error = new Error("bad")
        const bad = Object.seal({ nested: { bad: error } })

        importValue(pending, "pending frozen probe")
        importValue(bad, "error frozen probe")

        expect(hasError(new Chain(clean), [])).to.be(false)
        const pendingResult = hasError(new Chain(pending), [])
        expect(hasError(new Chain(bad), [])).to.be(true)

        expect(getRefCounter(clean).errorCount).to.be(0)
        expect(getRefCounter(clean.nested).errorCount).to.be(0)
        expect(getRefCounter(pending).promiseCount).to.be(1)
        expect(getRefCounter(bad).errorCount).to.be(1)
        expect(getRefCounter(bad.nested).errorCount).to.be(1)
        expect(await pendingResult).to.be(false)
        expect(getRefCounter(pending).promiseCount).to.be(0)
        expect(pending.pending instanceof Promise).to.be(true)
        verifyRefCounts(clean, pending, bad)
    })

    it("probes terminal promises on frozen parents through mirrors without writeback", async () => {
        const cleanPending = deferred()
        const badPending = deferred()
        const cleanRoot = Object.freeze({ pending: cleanPending.promise })
        const badRoot = Object.freeze({ pending: badPending.promise })

        const cleanResult = hasError(new Chain(cleanRoot), ["pending"])
        const badResult = hasError(new Chain(badRoot), ["pending"])

        cleanPending.resolve(undefined)
        badPending.reject("frozen failure")

        expect(await cleanResult).to.be(false)
        expect(await badResult).to.be(true)
        expect(cleanRoot.pending).to.be(cleanPending.promise)
        expect(badRoot.pending).to.be(badPending.promise)
        expect(metaOf(cleanRoot).mirrors.pending.pendingConsumerCount).to.be(0)
        expect(metaOf(badRoot).mirrors.pending.pendingConsumerCount).to.be(0)
        expect(getRefCounter(cleanRoot)).to.be(undefined)
        expect(getRefCounter(badRoot)).to.be(undefined)
    })

    it("distinguishes promised missing terminals from broken paths", async () => {
        const pending = deferred()
        const chain = new Chain({ parent: pending.promise })

        const missingTerminal = hasError(chain, ["parent", "missing"])
        const brokenPath = hasError(chain, ["parent", "missing", "child"])

        pending.resolve({})

        expect(await missingTerminal).to.be(false)
        expect(await brokenPath).to.be(true)
        verifyRefCounts(chain._state.value)
    })

    it("reuses indexed descendants under a non-extensible branch", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }

        expect(buildRefIndex(child)).to.be(child)

        const wrapper = Object.preventExtensions({ child })
        importValue(wrapper, "indexed frozen probe")

        const result = hasError(new Chain(wrapper), [])

        expect(getRefCounter(wrapper).promiseCount).to.be(1)
        expect(getRefCounter(child).promiseCount).to.be(1)

        pending.resolve("done")

        expect(await result).to.be(false)
        expect(getRefCounter(wrapper).promiseCount).to.be(0)
        expect(child.pending).to.be("done")
        expect(lookupPath(new Chain(child), ["pending"], false)).to.be("done")
        verifyRefCounts(wrapper)
    })

    it("returns true on indexed sync errors", () => {
        const before = { x: 1 }
        const after = { y: 2 }
        const root = {
            before,
            bad: new Error("bad"),
            after,
        }

        expect(hasError(new Chain(root), [])).to.be(true)

        expect(getRefCounter(root).promiseCount).to.be(0)
        expect(getRefCounter(root).errorCount).to.be(1)
        expect(getRefCounter(before).errorCount).to.be(0)
        expect(getRefCounter(after).errorCount).to.be(0)
        verifyRefCounts(root)
    })

    it("answers true from errorCount while leaving normal promise writeback live", async () => {
        const pending = deferred()
        const root = {
            pending: pending.promise,
            bad: new Error("bad"),
        }

        expect(hasError(new Chain(root), [])).to.be(true)
        expect(getRefCounter(root).promiseCount).to.be(1)
        expect(getRefCounter(root).errorCount).to.be(1)

        pending.resolve({ ok: true })
        await flushMicrotasks()

        expect(root.pending).to.eql({ ok: true })
        expect(getRefCounter(root).promiseCount).to.be(0)
        expect(getRefCounter(root).errorCount).to.be(1)
        verifyRefCounts(root)
    })

    it("waits for clean pending branches and then answers false", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }

        const result = hasError(new Chain(root), ["branch"])

        expect(typeof result.then).to.be("function")

        pending.resolve({ ok: true })

        expect(await result).to.be(false)
        expect(root.branch).to.eql({ pending: { ok: true } })
        verifyRefCounts(root)
    })

    it("answers true as soon as a watched promise exposes an Error", async () => {
        const bad = deferred()
        const slow = deferred()
        const root = {
            branch: {
                bad: bad.promise,
                slow: slow.promise,
            },
        }

        const result = hasError(new Chain(root), ["branch"])

        bad.reject("bad")

        expect(await result).to.be(true)
        verifyRefCounts(root)
    })

    it("fully indexes resolved promise branches before answering true", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }

        const result = hasError(new Chain(root), ["branch"])

        outer.resolve({
            nested: { bad: new Error("bad") },
            inner: inner.promise,
        })

        expect(await result).to.be(true)

        const resolved = root.branch.outer
        expect(getRefCounter(root.branch).promiseCount).to.be(1)
        expect(getRefCounter(root.branch).errorCount).to.be(1)
        expect(getRefCounter(resolved).promiseCount).to.be(1)
        expect(getRefCounter(resolved).errorCount).to.be(1)
        expect(getRefCounter(resolved.nested).errorCount).to.be(1)
        verifyRefCounts(root, resolved)
    })

    it("answers true behind several promise barriers while others still pend", async () => {
        const outer = deferred()
        const inner = deferred()
        const slow = deferred()
        const root = { branch: { outer: outer.promise, slow: slow.promise } }

        const result = hasError(new Chain(root), ["branch"])

        // First barrier exposes only a deeper pending; the next generation waits it.
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        // Second barrier commits the error; the answer fires at THIS settlement
        // because the resolved branch is indexed while `slow` is still pending.
        inner.resolve({ deep: { bad: new Error("bad") } })

        expect(await result).to.be(true)
        verifyRefCounts(root)
    })

    it("can wait a raw promise again when a later continuation reintroduces it", async () => {
        const first = deferred()
        const second = deferred()
        const root = {
            branch: {
                first: first.promise,
                second: second.promise,
            },
        }

        const result = hasError(new Chain(root), ["branch"])
        first.resolve("done")
        await flushMicrotasks()

        assignPath(new Chain(root), ["branch", "second", "again"], first.promise)
        second.resolve({})

        const outcome = await Promise.race([
            result,
            flushMicrotasks().then(() => "pending"),
        ])

        expect(outcome).to.be(false)
        verifyRefCounts(root)
    })

    it("waits for promises exposed by resolved values", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }
        let settled = false

        const result = hasError(new Chain(root), ["branch"])
        result.then(() => {
            settled = true
        })

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expect(settled).to.be(false)

        inner.resolve("done")

        expect(await result).to.be(false)
        verifyRefCounts(root)
    })

    it("does not wait for later promises outside the original indexed frontier", async () => {
        const first = deferred()
        const later = deferred()
        const root = {
            branch: {
                pending: first.promise,
                clean: { stable: true },
            },
        }
        let settled = false

        const result = hasError(new Chain(root), ["branch"])
        result.then(() => {
            settled = true
        })

        assignPath(new Chain(root), ["branch", "clean", "later"], later.promise)
        await flushMicrotasks()

        expect(settled).to.be(false)

        first.resolve("done")

        const outcome = await Promise.race([
            result,
            flushMicrotasks().then(() => "pending"),
        ])

        expect(outcome).to.be(false)
        expect(settled).to.be(true)
        expect(getRefCounter(root.branch).promiseCount).to.be(1)
        expect(root.branch.clean.later).to.be(later.promise)

        later.resolve({ ok: true })
        await flushMicrotasks()

        expect(root.branch.clean.later).to.eql({ ok: true })
        verifyRefCounts(root)
    })

    it("ignores later Errors outside the original pending frontier", async () => {
        const pending = deferred()
        const root = {
            branch: {
                pending: pending.promise,
                stable: {},
            },
        }
        const chain = new Chain(root)

        const result = hasError(chain, ["branch"])
        assignPath(chain, ["branch", "stable", "later"], new Error("future"))

        pending.resolve("done")

        expect(await result).to.be(false)
        expect(hasError(chain, ["branch"])).to.be(true)
        verifyRefCounts(root)
    })

    it("continues through pending parent paths", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }

        const result = hasError(new Chain(root), ["branch", "bad"])

        pending.resolve({ bad: new Error("bad") })

        expect(await result).to.be(true)
        verifyRefCounts(root)
    })

    it("sees errors installed by earlier-issued suspended writes", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }

        // Issued before hasError, suspended on the same promise: its remainder
        // runs first at settlement (FIFO), installs the Error into the counted
        // resolved value, and hasError's wait continuation must observe it.
        assignPath(new Chain(root), ["branch", "pending", "bad"], new Error("bad"))
        const result = hasError(new Chain(root), ["branch"])

        pending.resolve({})

        expect(await result).to.be(true)
        verifyRefCounts(root)
    })

    it("sees an earlier suspended write remove a transient Error", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }

        assignPath(new Chain(root), ["branch", "pending", "bad"], "fixed")
        const result = hasError(new Chain(root), ["branch"])

        pending.resolve({ bad: new Error("transient") })

        expect(await result).to.be(false)
        expect(root.branch.pending).to.eql({ bad: "fixed" })
        verifyRefCounts(root)
    })

    it("ignores an Error installed by a later suspended write", async () => {
        const pending = deferred()
        const chain = new Chain({ branch: pending.promise })

        const result = hasError(chain, ["branch"])
        assignPath(chain, ["branch", "bad"], new Error("future"))
        pending.resolve({})

        expect(await result).to.be(false)
        expect(chain._state.value.branch.bad.message).to.be("future")
        verifyRefCounts(chain._state.value)
    })

    it("coexists with normalize on the same pending branch", async () => {
        const bad = deferred()
        const slow = deferred()
        const root = { branch: { bad: bad.promise, slow: slow.promise } }
        let normalized = false

        const normalizedBranch = normalize(new Chain(root), ["branch"])
        normalizedBranch.then(() => {
            normalized = true
        })
        const branchHasError = hasError(new Chain(root), ["branch"])

        bad.reject("bad")

        expect(await branchHasError).to.be(true)
        expect(normalized).to.be(false)

        slow.resolve("done")

        const normalizedValue = await normalizedBranch
        expect(normalizedValue instanceof Error).to.be(true)
        expect(normalized).to.be(true)
        verifyRefCounts(root)
    })

    it("coexists with ancestor normalization when hasError is issued first", async () => {
        const bad = deferred()
        const slow = deferred()
        const child = { bad: bad.promise }
        const root = { child, slow: slow.promise }
        const chain = new Chain(root)

        const childHasError = hasError(chain, ["child"])
        const rootHasError = hasError(chain, [])
        const normalizedRoot = normalize(chain, [])

        bad.reject("bad")

        expect(await childHasError).to.be(true)
        expect(await rootHasError).to.be(true)

        slow.resolve("done")
        const normalized = await normalizedRoot
        expect(normalized instanceof Error).to.be(true)
        verifyRefCounts(root)
    })

    it("handles a pending child shared across indexed paths", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = importValue({ left: child, right: child }, "shared child probe")
        const chain = new Chain(root)

        const result = hasError(chain, [])
        pending.reject("shared failure")

        expect(await result).to.be(true)
        expect(getRefCounter(child).errorCount).to.be(1)
        expect(getRefCounter(root).errorCount).to.be(2)
        verifyRefCounts(root)
    })

    it("reuses a node visit across promise barriers", async () => {
        const pending = deferred()
        const registrations = countPromiseRegistrations(pending.promise)
        const shared = { pending: pending.promise }
        lookupPath(new Chain({ shared }), ["shared"])

        const delayed = deferred()
        const root = { direct: shared, delayed: delayed.promise }
        const result = hasError(new Chain(root), [])

        expect(registrations()).to.be(2) // mirror writeback plus one query wait
        delayed.resolve(shared)
        await flushMicrotasks()
        expect(registrations()).to.be(2)

        pending.reject("bad")
        expect(await result).to.be(true)
        verifyRefCounts(root)
    })

    it("keeps concurrent hasError wait trees independent", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }

        const first = hasError(new Chain(root), ["branch"])
        const second = hasError(new Chain(root), ["branch"])

        pending.reject("bad")

        expect(await first).to.be(true)
        expect(await second).to.be(true)
        verifyRefCounts(root)
    })

    it("still observes a pending rejection after a later overwrite", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        let settled = false

        const result = hasError(new Chain(root), ["branch"])
        result.then(() => {
            settled = true
        })

        assignPath(new Chain(root), ["branch", "pending"], "fixed")
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.reject("late")

        expect(await result).to.be(true)
        expect(root.branch.pending).to.be("fixed")
        verifyRefCounts(root)
    })

    it("still observes a rejection settled before a later overwrite", async () => {
        const pending = deferred()
        const chain = new Chain({ pending: pending.promise })

        const result = hasError(chain, ["pending"])
        pending.reject("already queued")
        assignPath(chain, ["pending"], "fixed")

        expect(await result).to.be(true)
        expect(chain._state.value.pending).to.be("fixed")
        verifyRefCounts(chain._state.value)
    })

    it("does not transfer its wait to a replacement promise", async () => {
        const observed = deferred()
        const replacement = deferred()
        const chain = new Chain({ branch: { pending: observed.promise } })

        const result = hasError(chain, ["branch"])
        assignPath(chain, ["branch", "pending"], replacement.promise)
        observed.resolve("clean")

        expect(await result).to.be(false)
        expect(chain._state.value.branch.pending).to.be(replacement.promise)

        replacement.reject("future error")
        await flushMicrotasks()

        expect(chain._state.value.branch.pending.message).to.be("future error")
        verifyRefCounts(chain._state.value)
    })

    it("still observes a pending root rejection after a root overwrite", async () => {
        const pending = deferred()
        const chain = new Chain(pending.promise)
        let settled = false

        const result = hasError(chain, [])
        result.then(() => {
            settled = true
        })

        assignPath(chain, [], { clean: true })
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.reject("late root")

        expect(await result).to.be(true)
        expect(chain._state.value).to.eql({ clean: true })
    })

    it("still observes a pending terminal rejection after a terminal overwrite", async () => {
        const pending = deferred()
        const root = { pending: pending.promise }
        const chain = new Chain(root)
        let settled = false

        const result = hasError(chain, ["pending"])
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["pending"], "fixed")
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.reject("late terminal")

        expect(await result).to.be(true)
        expect(root.pending).to.be("fixed")
        verifyRefCounts(root)
    })

    it("still probes a pending resolved branch after a later overwrite", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        const chain = new Chain(root)
        let settled = false

        const result = hasError(chain, ["branch"])
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["branch", "pending"], "fixed")
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.resolve({ nested: { bad: new Error("bad") } })

        expect(await result).to.be(true)
        expect(root.branch.pending).to.be("fixed")
        verifyRefCounts(root)
    })

    it("observes an imported promise cycle captured before a COW overwrite", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        importValue(branch, "captured hasError cycle")
        const root = { branch }
        const chain = new Chain(root)

        const result = hasError(chain, ["branch"])
        assignPath(chain, ["branch", "pending"], "fixed")
        pending.resolve(branch)

        expect(await result).to.be(true)
        expect(chain._state.value.branch.pending).to.be("fixed")
        expect(branch.pending).to.be(pending.promise)
        verifyRefCounts(root, chain._state.value)
    })

    it("follows promises exposed by a mirror revoked before resolution", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: { outer: outer.promise } })
        let settled = false

        const result = hasError(chain, ["branch"])
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["branch", "outer"], "fixed")
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expect(settled).to.be(false)

        inner.reject("private nested error")

        expect(await result).to.be(true)
        expect(chain._state.value.branch.outer).to.be("fixed")
        verifyRefCounts(chain._state.value)
    })

    it("still probes a nested promise detached after it was discovered", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: { outer: outer.promise } })

        const result = hasError(chain, ["branch"])
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        assignPath(chain, ["branch", "outer", "inner"], "fixed")
        inner.reject("detached error")

        expect(await result).to.be(true)
        expect(chain._state.value.branch.outer.inner).to.be("fixed")
        verifyRefCounts(chain._state.value)
    })

    it("still observes a pending parent rejection after a parent-path overwrite", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }
        const chain = new Chain(root)
        let settled = false

        const result = hasError(chain, ["branch", "bad"])
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["branch"], { clean: true })
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.reject("late parent")

        expect(await result).to.be(true)
        expect(root.branch).to.eql({ clean: true })
        verifyRefCounts(root)
    })

    it("waits for a revoked promise to settle before answering false", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        let settled = false

        const result = hasError(new Chain(root), ["branch"])
        result.then(() => {
            settled = true
        })

        deletePath(new Chain(root), ["branch", "pending"])
        await flushMicrotasks()

        expect(settled).to.be(false)

        pending.resolve("ignored")

        expect(await result).to.be(false)
        expect(root.branch).to.eql({})
        verifyRefCounts(root)
    })
})
