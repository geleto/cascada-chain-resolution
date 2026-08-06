import {
    Chain,
    expect,
    runtime,
    metaOf,
    buildRefIndex,
    getRefCounter,
    setFatalErrorReporter,
    thrownBy,
    verifyRefCounts,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    lookupPath,
    readPath,
    exportValue,
    importValue,
    deferred,
    flushMicrotasks,
} from "./support.js"
import * as packageRuntime from "cascada-chain-resolution"
import { export as packageExport } from "cascada-chain-resolution"
import { hasCycleCut } from "../src/refcounts.js"
import {
    createRawWalkState,
    walkRawBranch,
} from "../src/raw-walk.js"

function expectExportErrors(outcome, expected) {
    expect(outcome instanceof Error).to.be(true)
    expect(outcome.message).to.be("export: branch contains errors")
    expect(outcome.errors.length).to.be(expected.length)
    for (const error of expected) {
        expect(outcome.errors.includes(error)).to.be(true)
    }
}

describe("export", () => {
    it("exposes the native ESM package API", () => {
        expect(Object.keys(packageRuntime).sort()).to.eql([
            "Chain",
            "assignPath",
            "deletePath",
            "export",
            "getErrors",
            "hasError",
            "import",
            "lookupPath",
            "readPath",
            "registerDataClass",
            "run",
        ])
        expect(packageExport).to.be(packageRuntime.export)
        expect(packageRuntime.export).to.be(exportValue)
        expect(runtime.export).to.be(exportValue)
        expect(runtime.normalize).to.be(undefined)
    })

    it("uses a non-thenable Error outcome with exact Error identities", () => {
        const repeated = new Error("repeated")
        const distinct = new Error("distinct")
        const outcome = exportValue(
            new Chain([repeated, { repeated, distinct }]),
            [],
        )

        expectExportErrors(outcome, [repeated, distinct])
        expect(outcome.then).to.be(undefined)
        expect(exportValue(new Chain([1, 2]), [])).to.eql([1, 2])
    })

    it("switches the raw export walker to collection-only mode", () => {
        const error = new Error("stop copying")
        const later = { value: 1 }
        const root = { error, later }
        const state = createRawWalkState()

        const readiness = walkRawBranch(root, state)

        expect(readiness).to.be(undefined)
        expect(state.copying).to.be(false)
        expect(state.copies).to.be(undefined)
        expect(state.visited.has(root)).to.be(true)
        expect(state.visited.has(later)).to.be(true)
        expect([...state.errors]).to.eql([error])
    })

    it("keeps later Promise continuations in collection-only mode", async () => {
        const first = deferred()
        const second = deferred()
        const root = {
            first: first.promise,
            second: second.promise,
        }
        let output
        const state = createRawWalkState(() => {
            output = undefined
        })
        const readiness = walkRawBranch(root, state)
        output = state.copies.get(root)
        const abandonedCopy = output
        const error = new Error("stop async copying")

        first.resolve(error)
        await flushMicrotasks()

        expect(state.copying).to.be(false)
        expect(state.copies).to.be(undefined)
        expect(output).to.be(undefined)

        const later = { value: 1 }
        second.resolve(later)
        await readiness

        expect(state.visited.has(later)).to.be(true)
        expect([...state.errors]).to.eql([error])
        expect(Object.keys(abandonedCopy)).to.eql(["first", "second"])
        expect(abandonedCopy.first).to.be(undefined)
        expect(abandonedCopy.second).to.be(undefined)
    })

    it("abandons earlier output when the last key is an Error", async () => {
        const pending = deferred()
        const error = new Error("last key")
        const root = {
            copied: { value: 1 },
            pending: pending.promise,
            error,
        }
        let output
        const state = createRawWalkState(() => {
            output = undefined
        })
        const readiness = walkRawBranch(root, state)

        expect(state.copying).to.be(false)
        expect(state.copies).to.be(undefined)
        expect(output).to.be(undefined)

        pending.resolve({ late: true })
        await readiness

        expect(state.copies).to.be(undefined)
        expect([...state.errors]).to.eql([error])
    })

    it("reuses one output identity across synchronous and promised aliases", async () => {
        const pending = deferred()
        const shared = { value: 1 }
        const root = { direct: shared, pending: pending.promise }

        const result = exportValue(new Chain(root), [])
        pending.resolve(shared)
        const copy = await result

        expect(copy.direct).to.be(copy.pending)
        expect(copy.direct).not.to.be(shared)
    })

    it("keeps a promised source stable across a later shared-alias mutation", async () => {
        const pending = deferred()
        const shared = { value: 1 }
        const root = {
            alias: shared,
            pending: pending.promise,
        }
        importValue(root, "shared alias export")
        const chain = new Chain(root)

        const result = exportValue(chain, ["pending"])
        assignPath(chain, ["alias", "value"], 2)
        pending.resolve(shared)
        const copy = await result

        expect(copy).to.eql({ value: 1 })
        expect(shared.value).to.be(1)
        expect(chain._state.value.alias).to.eql({ value: 2 })
        expect(chain._state.value.alias).not.to.be(shared)
    })

    it("reports a missing indexed Promise mirror as fatal", () => {
        const pending = deferred()
        const root = { pending: pending.promise }
        buildRefIndex(root)
        delete metaOf(root).mirrors.pending
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })

        const failure = thrownBy(() => exportValue(new Chain(root), []))

        expect(failure).to.be(reported)
        expect(failure.message).to.be(
            "Indexed promise property has no mirror",
        )
    })

    it("reports synchronous raw traversal failures as fatal", () => {
        const failure = new Error("ownKeys failed")
        const root = new Proxy({}, {
            ownKeys() {
                throw failure
            },
        })
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })

        expect(thrownBy(() => exportValue(new Chain(root), []))).to.be(failure)
        expect(reported).to.be(failure)
    })

    it("reports asynchronous raw traversal failures as fatal", async () => {
        const pending = deferred()
        const failure = new Error("getter failed")
        const value = {}
        Object.defineProperty(value, "bad", {
            enumerable: true,
            get() {
                throw failure
            },
        })
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })

        const result = exportValue(
            new Chain({ pending: pending.promise }),
            [],
        )
        pending.resolve(value)

        let rejected
        try {
            await result
        } catch (error) {
            rejected = error
        }
        expect(rejected).to.be(failure)
        expect(reported).to.be(failure)
    })

    it("indexes a mirror discovered by export if its owner is indexed later", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const result = exportValue(new Chain(branch), [])

        expect(getRefCounter(branch)).to.be(undefined)
        buildRefIndex(branch)
        expect(getRefCounter(branch).promiseCount).to.be(1)

        pending.resolve({ done: true })
        expect(await result).to.eql({ pending: { done: true } })
        expect(getRefCounter(branch).promiseCount).to.be(0)
        verifyRefCounts(branch)
    })

    it("keeps a live mirror when cyclic export re-enters it", async () => {
        const pending = deferred()
        const root = { value: pending.promise }
        importValue(root, "re-entrant cycle")
        const chain = new Chain(root)
        const exported = exportValue(chain, ["value"])
        const mirror = metaOf(root).mirrors.value
        const resolved = { back: root }

        pending.resolve(resolved)
        const copy = await exported

        expect(copy.back.value).to.be(copy)
        expect(metaOf(root).mirrors.value).to.be(mirror)
        expect(root.value).to.be(pending.promise)
        expect(readPath(new Chain(root), ["value"])).to.be(resolved)
        buildRefIndex(root)
        expect(hasCycleCut(resolved, "back")).to.be(true)
        verifyRefCounts(root)
    })

    it("preserves cycle and DAG topology in a metadata-free copy", () => {
        const shared = { leaf: true }
        const root = { left: shared, right: shared }
        root.self = root
        importValue(root, "export topology")
        const chain = new Chain(root)

        const copy = exportValue(chain, [])

        expect(copy).not.to.be(root)
        expect(copy.self).to.be(copy)
        expect(copy.left).to.be(copy.right)
        expect(copy.left).not.to.be(shared)
        expect(metaOf(copy)).to.be(undefined)
        expect(metaOf(copy.left)).to.be(undefined)
        expect(hasError(chain, [])).to.be(false)
        expect(getErrors(chain, [])).to.eql([])
        verifyRefCounts(root)
    })

    it("waits for promises hidden behind cycle cuts", async () => {
        const pending = deferred()
        const left = {}
        const right = { pending: pending.promise }
        left.right = right
        right.left = left
        importValue(left, "hidden cycle wait")
        const chain = new Chain(left)

        const result = exportValue(chain, [])
        let settled = false
        result.then(() => {
            settled = true
        })
        await flushMicrotasks()
        expect(settled).to.be(false)

        pending.resolve({ done: true })
        const copy = await result
        expect(copy).not.to.be(left)
        expect(copy.right.left).to.be(copy)
        expect(copy.right.pending).to.eql({ done: true })
        expect(right.pending).to.be(pending.promise)
        expect(readPath(chain, ["right", "pending"])).to.eql({
            done: true,
        })
        expect(readPath(chain, ["right", "pending", "done"])).to.be(true)
        verifyRefCounts(left, right)
    })

    it("detects an Error resolved behind a cycle cut", async () => {
        const pending = deferred()
        const error = new Error("hidden behind Promise")
        const first = { pending: pending.promise }
        const second = { back: first }
        first.next = second
        importValue(first, "hidden promised Error")

        const result = exportValue(new Chain(second), [])
        pending.resolve({ error })

        const exported = await result
        expectExportErrors(exported, [error])
        verifyRefCounts(first, second)
    })

    it("lets an ordinary Error behind a cycle cut poison export", () => {
        const left = {}
        const right = { bad: new Error("hidden") }
        left.right = right
        right.left = left
        importValue(left, "hidden cycle Error")

        const result = exportValue(new Chain(left), [])

        expectExportErrors(result, [right.bad])
    })

    it("collects the complete raw Error frontier despite indexed fast paths", async () => {
        const pending = deferred()
        const known = new Error("known")
        const hidden = new Error("hidden")
        const branch = { bad: known }
        const root = { branch, pending: pending.promise }
        branch.back = root
        importValue(root, "terminal cycle Error")
        buildRefIndex(root)

        const result = exportValue(new Chain(root), ["branch"])

        expect(metaOf(branch).cycleCuts.has("back")).to.be(true)
        expect(getRefCounter(branch)).not.to.be(undefined)
        expect(typeof result.then).to.be("function")

        pending.resolve(hidden)
        expectExportErrors(await result, [known, hidden])
        verifyRefCounts(root, branch)
    })

    it("agrees with Error queries on stable sync and promised data", async () => {
        const pending = deferred()
        const known = new Error("known")
        const hidden = new Error("hidden")
        const chain = new Chain({
            known,
            pending: pending.promise,
        })

        const exported = exportValue(chain, [])
        const errorsResult = getErrors(chain, [])

        expect(hasError(chain, [])).to.be(true)
        pending.resolve({ known, hidden })

        const [outcome, errors] = await Promise.all([exported, errorsResult])
        expectExportErrors(outcome, [known, hidden])
        expect(errors.length).to.be(2)
        expect(errors.includes(known)).to.be(true)
        expect(errors.includes(hidden)).to.be(true)
    })

    it("exports a clean subpath through a cyclic import normally", () => {
        const root = { child: { clean: { x: 1 } } }
        root.child.back = root
        importValue(root, "clean cyclic subpath")
        const chain = new Chain(root)

        const clean = exportValue(chain, ["child", "clean"])

        expect(clean).to.eql(root.child.clean)
        expect(clean).not.to.be(root.child.clean)
        expect(hasError(chain, [])).to.be(false)
        expect(hasError(chain, ["child", "clean"])).to.be(false)
    })

    it("returns direct values until a real wait is needed", () => {
        const opaque = new Date()
        const root = {
            branch: { x: 1, opaque },
            opaque,
            primitive: 2,
        }
        const pending = deferred()

        const branch = exportValue(new Chain(root), ["branch"])
        const primitive = exportValue(new Chain(root), ["primitive"])
        const opaqueResult = exportValue(new Chain(root), ["opaque"])
        const missing = exportValue(new Chain(root), ["missing"])
        const broken = exportValue(new Chain(root), ["missing", "value"])
        const waiting = exportValue(new Chain({ branch: { pending: pending.promise } }), ["branch"])

        expect(branch).to.eql(root.branch)
        expect(branch).not.to.be(root.branch)
        expect(primitive).to.be(2)
        expect(opaqueResult).to.be(opaque)
        expect(branch.opaque).to.be(opaque)
        expect(missing).to.be(undefined)
        expect(broken instanceof Error).to.be(true)
        expect(broken.errors.length).to.be(1)
        expect(broken.errors[0].message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(typeof waiting.then).to.be("function")
    })

    it("returns settled clean branches synchronously as independent copies", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        const value = exportValue(new Chain(root), ["branch"])
        assignPath(new Chain(root), ["branch", "x"], 2)

        expect(value).not.to.be(branch)
        expect(metaOf(value)).to.be(undefined)
        expect(root.branch).to.be(branch)
        expect(branch.x).to.be(2)
        expect(root.branch.x).to.be(2)
        expect(value.x).to.be(1)
    })

    it("reads a resolved live mirror synchronously without registering again", async () => {
        const pending = deferred()
        const root = { pending: pending.promise }
        const chain = new Chain(root)
        const observed = readPath(chain, ["pending"])

        pending.resolve({ value: 1 })
        await observed

        const mirror = metaOf(root).mirrors.pending
        expect(metaOf(root).mirrors.pending).to.be(mirror)

        const exported = exportValue(chain, [])

        expect(exported.then).to.be(undefined)
        expect(exported).to.eql({ pending: { value: 1 } })
        expect(metaOf(root).mirrors.pending).to.be(mirror)
    })

    it("does not expose imported metadata", () => {
        const root = { branch: { x: 1 } }
        const branch = root.branch

        importValue(root, "valid export import")
        const value = exportValue(new Chain(root), ["branch"])

        expect(value).to.eql(branch)
        expect(value).not.to.be(branch)
        expect(metaOf(value)).to.be(undefined)
        expect(metaOf(root).importBoundary.errorContext).to.be("valid export import")
    })

    it("protects fast-path results from already-issued suspended writes", async () => {
        const pendingRoot = deferred()
        const root = { branch: { x: 1 } }
        const branch = root.branch

        assignPath(new Chain(pendingRoot.promise), ["branch", "x"], 2)
        const value = exportValue(new Chain(root), ["branch"])

        expect(value).not.to.be(branch)
        expect(value).to.eql({ x: 1 })

        pendingRoot.resolve(root)
        await flushMicrotasks()

        expect(value).not.to.be(branch)
        expect(value).to.eql({ x: 1 })
        expect(root.branch).to.be(branch)
        expect(root.branch).to.eql({ x: 2 })
        verifyRefCounts(branch, root.branch)
    })

    it("protects the source from native mutations of exported output", () => {
        const child = { x: 1 }
        const branch = { left: child, right: child }
        const root = { branch }

        const copy = exportValue(new Chain(root), ["branch"])
        copy.left.x = 2

        expect(copy).not.to.be(branch)
        expect(copy.left).to.be(copy.right)
        expect(copy.left).not.to.be(child)
        expect(copy.left.x).to.be(2)
        expect(root.branch).to.be(branch)
        expect(child.x).to.be(1)
        expect(metaOf(copy)).to.be(undefined)
        expect(metaOf(copy.left)).to.be(undefined)
    })

    it("reimports native-mutated output as fresh external data", () => {
        const output = exportValue(new Chain({ value: { x: 1 } }), [])
        output.value.back = output

        importValue(output, "exported round trip")

        expect(getErrors(new Chain(output), [])).to.eql([])
        expect(metaOf(output.value).cycleCuts.has("back")).to.be(true)
    })

    it("copies sparse indexes and omits named Array properties", () => {
        const child = { x: 1 }
        const ignoredSymbol = Symbol("ignored")
        const root = new Array(4)
        root[1] = child
        root[3] = child
        root.extra = child
        root[ignoredSymbol] = "symbol value"
        Object.defineProperty(root, "hidden", {
            value: "hidden value",
            enumerable: false,
        })

        const copy = exportValue(new Chain(root), [])

        expect(Array.isArray(copy)).to.be(true)
        expect(copy.length).to.be(4)
        expect(0 in copy).to.be(false)
        expect(1 in copy).to.be(true)
        expect(copy[1]).to.be(copy[3])
        expect(copy[1]).not.to.be(child)
        expect(Object.hasOwn(copy, "extra")).to.be(false)
        expect(Object.prototype.hasOwnProperty.call(copy, "hidden")).to.be(false)
        expect(Object.getOwnPropertySymbols(copy)).to.eql([])
        expect(metaOf(copy)).to.be(undefined)
        expect(metaOf(copy[1])).to.be(undefined)
    })

    it("preserves own-key order across Promise settlement", async () => {
        const objectPending = deferred()
        const arrayPending = deferred()
        const object = {
            first: objectPending.promise,
            second: 2,
        }
        const array = ["zero"]
        array.first = arrayPending.promise
        array.second = 2

        const objectResult = exportValue(new Chain(object), [])
        const arrayResult = exportValue(new Chain(array), [])
        objectPending.resolve(1)
        arrayPending.resolve(1)

        const [objectCopy, arrayCopy] = await Promise.all([
            objectResult,
            arrayResult,
        ])
        expect(Object.keys(objectCopy)).to.eql(["first", "second"])
        expect(Object.keys(arrayCopy)).to.eql(["0"])
    })

    it("copies own enumerable __proto__ as data", () => {
        const child = { value: 1 }
        const root = { child }
        Object.defineProperty(root, "__proto__", {
            value: child,
            enumerable: true,
            writable: true,
            configurable: true,
        })

        const copy = exportValue(new Chain(root), [])

        expect(Object.getPrototypeOf(copy)).to.be(Object.prototype)
        expect(Object.prototype.hasOwnProperty.call(copy, "__proto__")).to.be(true)
        expect(copy.__proto__).to.be(copy.child)
        expect(copy.child).not.to.be(child)
    })

    it("returns a single Error for settled error branches without marking them", () => {
        const child = { x: 1 }
        const branch = { error: new Error("bad"), child }
        const root = { branch }

        const value = exportValue(new Chain(root), ["branch"])
        assignPath(new Chain(root), ["branch", "child", "x"], 2)

        expectExportErrors(value, [branch.error])
        expect(root.branch).to.be(branch)
        expect(child.x).to.be(2)
    })

    it("captures keys before later writes without pinning the source", async () => {
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        const branch = root.branch

        const result = exportValue(new Chain(root), ["branch"])
        assignPath(new Chain(root), ["branch", "later"], 2)

        pending.resolve("done")
        const value = await result

        expect(value).not.to.be(branch)
        expect(value).to.eql({ pending: "done" })
        expect(root.branch).to.be(branch)
        expect(root.branch).to.eql({ pending: "done", later: 2 })
        expect(metaOf(branch).shared).to.be(undefined)
        expect(getRefCounter(branch)).to.be(undefined)
    })

    it("keeps concurrent export readiness and output independent", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const root = { branch }

        const first = exportValue(new Chain(root), ["branch"])
        const second = exportValue(new Chain(root), ["branch"])

        pending.resolve("done")
        const values = await Promise.all([first, second])

        expect(values).to.eql([
            { pending: "done" },
            { pending: "done" },
        ])
        expect(values[0]).not.to.be(branch)
        expect(values[1]).not.to.be(branch)
        expect(values[0]).not.to.be(values[1])
        expect(metaOf(branch).shared).to.be(undefined)
        expect(getRefCounter(branch)).to.be(undefined)
    })

    it("keeps concurrent export Error state independent", async () => {
        const pending = deferred()
        const known = new Error("known")
        const hidden = new Error("hidden")
        const chain = new Chain({
            known,
            pending: pending.promise,
        })

        const first = exportValue(chain, [])
        const second = exportValue(chain, [])
        pending.resolve({ known, hidden })
        const outcomes = await Promise.all([first, second])

        expectExportErrors(outcomes[0], [known, hidden])
        expectExportErrors(outcomes[1], [known, hidden])
        expect(outcomes[0]).not.to.be(outcomes[1])
        expect(outcomes[0].errors).not.to.be(outcomes[1].errors)
    })

    it("gives concurrent callers independent nested copies", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const chain = new Chain({ branch })

        const firstResult = exportValue(chain, ["branch"])
        const secondResult = exportValue(chain, ["branch"])

        pending.resolve({ done: true })

        const first = await firstResult
        const second = await secondResult
        expect(first).not.to.be(branch)
        expect(second).not.to.be(branch)
        expect(first).not.to.be(second)
        expect(first).to.eql({ pending: { done: true } })
        expect(second).to.eql(first)
        expect(metaOf(first)).to.be(undefined)
        expect(metaOf(first.pending)).to.be(undefined)
        expect(getRefCounter(branch)).to.be(undefined)
    })

    it("keeps overlapping ancestor and child exports independent", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = { child }
        const chain = new Chain(root)

        const childResult = exportValue(chain, ["child"])
        const rootResult = exportValue(chain, [])

        pending.resolve({ done: true })
        const childValue = await childResult
        const rootValue = await rootResult

        expect(childValue).to.eql({ pending: { done: true } })
        expect(childValue).not.to.be(child)
        expect(rootValue).to.eql({ child: { pending: { done: true } } })
        expect(rootValue).not.to.be(root)
        expect(rootValue.child).not.to.be(childValue)
        expect(getRefCounter(root)).to.be(undefined)
        expect(getRefCounter(child)).to.be(undefined)
    })

    it("includes earlier suspended writes at their program position", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }

        assignPath(new Chain(root), ["branch", "x"], 1)
        const result = exportValue(new Chain(root), ["branch"])

        pending.resolve({})
        const value = await result

        expect(value).not.to.be(root.branch)
        expect(value).to.eql({ x: 1 })
        verifyRefCounts(root)
    })

    it("includes an earlier suspended delete at its program position", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }
        const chain = new Chain(root)

        deletePath(chain, ["branch", "remove"])
        const result = exportValue(chain, ["branch"])

        pending.resolve({ keep: true, remove: true })
        const value = await result

        expect(value).not.to.be(root.branch)
        expect(value).to.eql({ keep: true })
        verifyRefCounts(root)
    })

    it("keeps later suspended writes out of an exported pending path", async () => {
        const pending = deferred()
        const root = { branch: pending.promise }

        const result = exportValue(new Chain(root), ["branch"])
        assignPath(new Chain(root), ["branch", "x"], 1)

        pending.resolve({})
        const value = await result

        expect(value).to.eql({})
        expect(root.branch).to.eql({ x: 1 })
        expect(root.branch).not.to.be(value)
        verifyRefCounts(root, value)
    })

    it("keeps a settled value when a later overwrite overtakes its continuation", async () => {
        const pending = deferred()
        const chain = new Chain({ branch: pending.promise })
        const result = exportValue(chain, ["branch"])

        pending.resolve({ observed: true })
        assignPath(chain, ["branch"], { replacement: true })

        expect(await result).to.eql({ observed: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("continues a nested path wait after a later ancestor replacement", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise })
        const result = exportValue(chain, ["branch", "inner"])

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()
        assignPath(chain, ["branch"], { replacement: true })
        inner.resolve({ observed: true })

        expect(await result).to.eql({ observed: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("settles promises exposed by a path mirror detached before resolution", async () => {
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise })
        const result = exportValue(chain, ["branch"])
        let settled = false
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["branch"], { replacement: true })
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expect(settled).to.be(false)

        inner.resolve({ observed: true })

        expect(await result).to.eql({ inner: { observed: true } })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("keeps a raw property mirror captured before deletion", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const chain = new Chain({ branch })
        const result = exportValue(chain, ["branch"])

        deletePath(chain, ["branch", "pending"])
        pending.resolve({ observed: true })

        expect(await result).to.eql({ pending: { observed: true } })
        expect(Object.keys(branch)).to.eql([])
    })

    it("does not transfer a pending export to a replacement promise", async () => {
        const observed = deferred()
        const replacement = deferred()
        const chain = new Chain({ branch: observed.promise })

        const result = exportValue(chain, ["branch"])
        assignPath(chain, ["branch"], replacement.promise)
        observed.resolve({ observed: true })

        expect(await result).to.eql({ observed: true })
        expect(chain._state.value.branch).to.be(replacement.promise)

        replacement.resolve({ replacement: true })
        await flushMicrotasks()

        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("waits for promises exposed by resolved promise values", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }
        let settled = false

        const result = exportValue(new Chain(root), ["branch"])
        result.then(() => {
            settled = true
        })

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expect(settled).to.be(false)

        inner.resolve("done")
        const value = await result

        expect(settled).to.be(true)
        expect(value).to.eql({ outer: { inner: "done" } })
        verifyRefCounts(root)
    })

    it("collapses to Error when a pending branch promise rejects", async () => {
        const pending = deferred()
        const error = new Error("bad")
        const root = { branch: { pending: pending.promise } }

        const result = exportValue(new Chain(root), ["branch"])
        pending.reject(error)
        const value = await result

        expectExportErrors(value, [error])
        expect(root.branch.pending instanceof Error).to.be(true)
        verifyRefCounts(root)
    })

    it("collapses to Error when a resolved promise value contains an Error", async () => {
        const pending = deferred()
        const error = new Error("bad")
        const root = { branch: { pending: pending.promise } }

        const result = exportValue(new Chain(root), ["branch"])
        pending.resolve({ failed: error })
        const value = await result

        expectExportErrors(value, [error])
        expect(root.branch.pending.failed instanceof Error).to.be(true)
        verifyRefCounts(root)
    })

    it("does not settle at a transient zero before same-promise continuations run", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }
        let settled = false

        assignPath(new Chain(root), ["branch", "outer", "inner"], inner.promise)
        const result = exportValue(new Chain(root), ["branch"])
        result.then(() => {
            settled = true
        })

        outer.resolve({})
        await flushMicrotasks()

        expect(settled).to.be(false)
        expect(root.branch).to.eql({ outer: { inner: inner.promise } })

        inner.resolve("done")
        const value = await result

        expect(settled).to.be(true)
        expect(value).to.eql({ outer: { inner: "done" } })
        verifyRefCounts(root)
    })

    it("does not collapse to Error until queued earlier operations finish", async () => {
        const pending = deferred()
        const root = { branch: { inner: pending.promise } }

        assignPath(new Chain(root), ["branch", "inner", "e"], "fixed")
        const result = exportValue(new Chain(root), ["branch"])

        pending.resolve({ e: new Error("transient") })
        const value = await result

        expect(value).not.to.be(root.branch)
        expect(value).to.eql({ inner: { e: "fixed" } })
        verifyRefCounts(root)
    })

    it("creates no counter or settlement state while waiting", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const result = exportValue(new Chain({ branch }), ["branch"])

        expect(getRefCounter(branch)).to.be(undefined)
        expect(metaOf(branch).shared).to.be(undefined)
        pending.resolve("done")
        await result

        expect(getRefCounter(branch)).to.be(undefined)
        expect(branch).to.eql({ pending: "done" })
    })

    it("does not wait for promises added by later-issued writes", async () => {
        const first = deferred()
        const later1 = deferred()
        const later2 = deferred()
        const root = { branch: { pending: first.promise } }
        const branch = root.branch
        let settled = false

        const result = exportValue(new Chain(root), ["branch"])
        result.then(() => {
            settled = true
        })

        // Export already captured the branch's enumerable key frontier.
        assignPath(new Chain(root), ["branch", "a"], later1.promise)
        assignPath(new Chain(root), ["branch", "b"], later2.promise)

        expect(root.branch).to.be(branch)
        expect(getRefCounter(branch)).to.be(undefined)

        first.resolve("done")
        await flushMicrotasks()

        expect(settled).to.be(true)
        const value = await result
        expect(value).not.to.be(branch)
        expect(value).to.eql({ pending: "done" })

        later1.resolve(1)
        later2.resolve(2)
        await flushMicrotasks()

        expect(root.branch).to.eql({ pending: "done", a: 1, b: 2 })
        expect(value).to.eql({ pending: "done" })
    })

    it("exports a later state independently without forcing COW", async () => {
        const first = deferred()
        const second = deferred()
        const original = { first: first.promise }
        const chain = new Chain({ branch: original })

        const originalResult = exportValue(chain, ["branch"])
        assignPath(chain, ["branch", "second"], second.promise)
        const current = chain._state.value.branch

        expect(current).to.be(original)
        first.resolve("first done")
        const originalOutput = await originalResult
        expect(originalOutput).not.to.be(original)
        expect(originalOutput).to.eql({ first: "first done" })
        expect(original).to.eql({
            first: "first done",
            second: second.promise,
        })
        expect(getRefCounter(current)).to.be(undefined)

        const currentResult = exportValue(chain, ["branch"])
        second.resolve("second done")
        const currentOutput = await currentResult
        expect(currentOutput).not.to.be(current)
        expect(currentOutput).to.eql({
            first: "first done",
            second: "second done",
        })
        expect(current).to.eql({ first: "first done", second: "second done" })
        expect(getRefCounter(current)).to.be(undefined)
    })

    it("preserves cyclic imports without exposing cycle diagnostics", () => {
        const cyclic = {}
        cyclic.self = cyclic
        const branch = { cyclic }
        const root = { branch }

        importValue(root, "export import")
        const branchMeta = metaOf(branch)
        expect(branchMeta.shared).to.be(true)
        expect(branchMeta.importBoundary).not.to.be(undefined)
        const value = exportValue(new Chain(root), ["branch"])

        expect(value).not.to.be(branch)
        expect(value.cyclic.self).to.be(value.cyclic)
        expect(hasError(new Chain(root), ["branch"])).to.be(false)
        expect(metaOf(branch)).to.be(branchMeta)
        expect(branchMeta.importBoundary).not.to.be(undefined)
        expect(getRefCounter(branch).errorCount).to.be(0)
        expect(getRefCounter(branch).cycleCutCount).to.be(1)
    })

    it("does not pin a synchronous Error found in a cyclic import", () => {
        const error = new Error("hidden")
        const cyclic = { bad: error }
        cyclic.self = cyclic
        const branch = { cyclic }
        const root = { branch }

        importValue(root, "synchronous cyclic Error")
        const branchMeta = metaOf(branch)
        const result = exportValue(new Chain(root), ["branch"])

        expectExportErrors(result, [error])
        expect(metaOf(branch)).to.be(branchMeta)
        expect(branchMeta.shared).to.be(true)
        expect(branchMeta.importBoundary).not.to.be(undefined)
    })

    it("waits on imported branches without pinning or re-rooting them", async () => {
        const pending = deferred()
        const branch = { pending: pending.promise }
        const root = { branch }

        importValue(root, "pending export")
        const branchMeta = metaOf(branch)
        const result = exportValue(new Chain(root), ["branch"])

        expect(branchMeta.shared).to.be(true)
        expect(branchMeta.importBoundary).not.to.be(undefined)
        expect(getRefCounter(branch)).to.be(undefined)

        pending.resolve("done")
        expect(await result).to.eql({ pending: "done" })
        expect(metaOf(branch)).to.be(branchMeta)
        expect(branchMeta.importBoundary).not.to.be(undefined)
    })

    it("exports promises inside sealed branches through mirrors", async () => {
        const valid = Object.freeze({ x: 1 })
        const promise = Promise.resolve(1)
        const pending = Object.seal({ pending: promise })

        importValue(pending, "sealed export")
        const copied = exportValue(new Chain(valid), [])
        const exported = exportValue(new Chain(pending), [])

        expect(copied).to.eql({ x: 1 })
        expect(copied).not.to.be(valid)
        expect(await exported).to.eql({ pending: 1 })
        expect(pending.pending).to.be(promise)
        expect(readPath(new Chain(pending), ["pending"])).to.be(1)
        expect(getRefCounter(valid)).to.be(undefined)
        expect(getRefCounter(pending)).to.be(undefined)
    })

    it("resolves an indexed sealed holder with exact counter updates", async () => {
        const pending = deferred()
        const promise = pending.promise
        const sealed = Object.seal({ pending: promise })

        importValue(sealed, "indexed sealed export")
        buildRefIndex(sealed)
        expect(getRefCounter(sealed).promiseCount).to.be(1)

        const exported = exportValue(new Chain(sealed), [])
        pending.resolve({ done: true })

        expect(await exported).to.eql({ pending: { done: true } })
        expect(sealed.pending).to.be(promise)
        expect(readPath(new Chain(sealed), ["pending"])).to.eql({
            done: true,
        })
        expect(getRefCounter(sealed).promiseCount).to.be(0)
        verifyRefCounts(sealed)
    })

    it("returns clean frozen branches synchronously as copies", () => {
        const frozen = Object.freeze({ nested: { value: 1 } })
        importValue(frozen, "clean frozen export")

        const value = exportValue(new Chain(frozen), [])

        expect(value).to.eql({ nested: { value: 1 } })
        expect(value).not.to.be(frozen)
        expect(value.nested).not.to.be(frozen.nested)
        expect(getRefCounter(frozen)).to.be(undefined)
        expect(getRefCounter(frozen.nested)).to.be(undefined)
    })

    it("waits for a trusted indexed child beneath a frozen ancestor", async () => {
        const pending = deferred()
        const child = { pending: pending.promise }

        expect(buildRefIndex(child)).to.be(child)

        const frozen = Object.freeze({ child })
        importValue(frozen, "frozen indexed export")
        const exported = exportValue(new Chain(frozen), [])

        expect(getRefCounter(frozen)).to.be(undefined)
        expect(getRefCounter(child).promiseCount).to.be(1)
        pending.resolve("done")
        expect(await exported).to.eql({ child: { pending: "done" } })
        // Existing META makes child a trusted runtime island rather than a
        // newly imported host holder.
        expect(child.pending).to.be("done")
        expect(readPath(new Chain(frozen), ["child", "pending"])).to.be("done")
        verifyRefCounts(child)
    })

    it("exports through a root promise", async () => {
        const pending = deferred()
        const chain = new Chain(pending.promise)
        const result = exportValue(chain, ["branch"])

        pending.resolve({ branch: { x: 1 } })
        const value = await result

        expect(value).to.eql({ x: 1 })
    })
})
