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
    managedStateClass,
    Execution,
} from "../src/index.js"
import { buildRefIndex, getRefCounter, hasCycleCut } from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"

import { expect, errorCause, readPath, deferred, flushMicrotasks } from "./support.js"
import * as packageRuntime from "cascada-chain-resolution"
import { export as packageExport } from "cascada-chain-resolution"
import { exportManyValues } from "../src/export.js"
import * as operationLifecycle from "../src/operation-lifecycle.js"

function expectExportErrors(outcome, expected) {
    expect(outcome instanceof Error).to.be(true)
    if (expected.length === 1) {
        expect(outcome === expected[0] || outcome.cause === expected[0]).to.be(true)
        return
    }
    expect(outcome.message).to.be("Operation received multiple Errors")
    expect(outcome.errors.length).to.be(expected.length)
    for (const error of expected) {
        expect(outcome.errors.some(value => {
            return value === error || value.cause === error
        })).to.be(true)
    }
}

describe("exact successful outputs", () => {
    for (const kind of ["Function", "external identity"]) {
        it("preserves a supported " + kind + " through ready and pending lookup and export", async () => {
            const ctx = { execution: new Execution(), errorContext: "test operation" }
            const value = kind === "Function" ? function result() {} : new Date(0)
            Object.defineProperty(value, "then", { value: 42 })
            const direct = new packageRuntime.Chain({ value }, ctx)
            const pending = new packageRuntime.Chain(Promise.resolve({ value }), ctx)
            expect(packageRuntime.lookupPath(direct, ["value"], ctx)).to.be(value)
            expect(packageRuntime.export(direct, ["value"], ctx)).to.be(value)
            const lookup = packageRuntime.lookupPath(pending, ["value"], ctx)
            const exported = packageRuntime.export(pending, ["value"], ctx)
            const exportedRoot = packageRuntime.export(pending, [], ctx)
            expect(await lookup).to.be(value)
            expect(await exported).to.be(value)
            expect((await exportedRoot).value).to.be(value)
            expect(ctx.execution.fatalError).to.be(null)
        })
    }
})

describe("export", () => {
    it("exposes the native ESM package API", () => {
        expect(packageExport).to.be(packageRuntime.export)
        expect(runtime.export).to.be(packageRuntime.export)
        expect(runtime.normalize).to.be(undefined)
    })

    it("uses a non-thenable Error outcome with exact Error identities", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const repeated = new Error("repeated")
        const distinct = new Error("distinct")
        const outcome = exportValue(
            new Chain([repeated, { repeated, distinct }], testContext),
            [],
            testContext,
        )

        expectExportErrors(outcome, [repeated, distinct])
        expect(outcome.then).to.be(undefined)
        expect(exportValue(new Chain([1, 2], testContext), [], testContext)).to.eql([1, 2])
    })

    it("abandons a nested export when its containing operation closes", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        let reflected = false
        const late = importValue(new Proxy({}, {
            ownKeys() {
                reflected = true
                return []
            },
        }), { ...testContext, errorContext: "prepared abandoned export value" })
        reflected = false
        const source = importValue(
            { pending: pending.promise },
            { ...testContext, errorContext: "abandoned nested export" },
        )
        const operation = new operationLifecycle.OperationOwner({ ...testContext, errorContext: "abandoned nested export" })
        const result = exportManyValues([source], operation)
        operation.close()
        pending.resolve(late)

        expect(await result).to.be(undefined)
        expect(reflected).to.be(false)
        expect(readPath(new Chain(source, testContext), ["pending"], testContext)).to.be(late)
        verifyRefCounts(testContext, source)
    })

    it("reuses one output identity across synchronous and promised aliases", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const shared = { value: 1 }
        const root = { direct: shared, pending: pending.promise }

        const result = exportValue(new Chain(root, testContext), [], testContext)
        pending.resolve(shared)
        const copy = await result

        expect(copy.direct).to.be(copy.pending)
        expect(copy.direct).not.to.be(shared)
    })

    it("keeps a promised source stable across a later shared-alias mutation", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const shared = { value: 1 }
        const root = {
            alias: shared,
            pending: pending.promise,
        }
        importValue(root, { ...testContext, errorContext: "shared alias export" })
        const chain = new Chain(root, testContext)

        const result = exportValue(chain, ["pending"], testContext)
        assignPath(chain, ["alias", "value"], 2, testContext)
        pending.resolve(shared)
        const copy = await result

        expect(copy).to.eql({ value: 1 })
        expect(shared.value).to.be(1)
        expect(chain._state.value.alias).to.eql({ value: 2 })
        expect(chain._state.value.alias).not.to.be(shared)
    })

    it("returns synchronous reflection failures as language Errors", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("ownKeys failed")
        const root = new Proxy({}, {
            ownKeys() {
                throw failure
            },
        })
        expect(errorCause(exportValue(new Chain(root, testContext), [], testContext))).to.be(failure)
    })

    it("does not invoke accessors exposed after a Promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        let reads = 0
        const value = {}
        Object.defineProperty(value, "bad", {
            enumerable: true,
            get() {
                reads++
                throw new Error("getter failed")
            },
        })

        const result = exportValue(
            new Chain({ pending: pending.promise }, testContext),
            [],
            testContext,
        )
        pending.resolve(value)

        expect(await result).to.eql({ pending: {} })
        expect(reads).to.be(0)
    })

    it("indexes a Promise version discovered by export if its owner is indexed later", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const branch = { pending: pending.promise }
        const result = exportValue(new Chain(branch, testContext), [], testContext)

        expect(getRefCounter(branch, testContext)).to.be(undefined)
        buildRefIndex(branch, testContext)
        expect(getRefCounter(branch, testContext).promiseCount).to.be(1)

        pending.resolve({ done: true })
        expect(await result).to.eql({ pending: { done: true } })
        expect(getRefCounter(branch, testContext).promiseCount).to.be(0)
        verifyRefCounts(testContext, branch)
    })

    it("keeps a live Promise version when cyclic export re-enters it", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { value: pending.promise }
        importValue(root, { ...testContext, errorContext: "re-entrant cycle" })
        const chain = new Chain(root, testContext)
        const exported = exportValue(chain, ["value"], testContext)
        const promiseVersion = metaOf(root, testContext).placementVersions.value
        const resolved = { back: root }

        pending.resolve(resolved)
        const copy = await exported

        expect(copy.back.value).to.be(copy)
        expect(metaOf(root, testContext).placementVersions.value).to.be(promiseVersion)
        expect(root.value).to.be(pending.promise)
        expect(readPath(chain, ["value"], testContext)).to.be(resolved)
        buildRefIndex(root, testContext)
        expect(hasCycleCut(resolved, "back", testContext)).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("preserves cycle and DAG topology in a metadata-free copy", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const shared = { leaf: true }
        const root = { left: shared, right: shared }
        root.self = root
        importValue(root, { ...testContext, errorContext: "export topology" })
        const chain = new Chain(root, testContext)

        const copy = exportValue(chain, [], testContext)

        expect(copy).not.to.be(root)
        expect(copy.self).to.be(copy)
        expect(copy.left).to.be(copy.right)
        expect(copy.left).not.to.be(shared)
        expect(metaOf(copy, testContext)).to.be(undefined)
        expect(metaOf(copy.left, testContext)).to.be(undefined)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(getErrors(chain, [], testContext)).to.be(null)
        verifyRefCounts(testContext, root)
    })

    it("waits for promises hidden behind cycle cuts", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const left = {}
        const right = { pending: pending.promise }
        left.right = right
        right.left = left
        importValue(left, { ...testContext, errorContext: "hidden cycle wait" })
        const chain = new Chain(left, testContext)

        const result = exportValue(chain, [], testContext)
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
        expect(readPath(chain, ["right", "pending"], testContext)).to.eql({
            done: true,
        })
        expect(readPath(chain, ["right", "pending", "done"], testContext)).to.be(true)
        verifyRefCounts(testContext, left, right)
    })

    it("detects an Error resolved behind a cycle cut", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const error = new Error("hidden behind Promise")
        const first = { pending: pending.promise }
        const second = { back: first }
        first.next = second
        importValue(first, { ...testContext, errorContext: "hidden promised Error" })

        const result = exportValue(new Chain(second, testContext), [], testContext)
        pending.resolve({ error })

        const exported = await result
        expectExportErrors(exported, [error])
        verifyRefCounts(testContext, first, second)
    })

    it("lets an ordinary Error behind a cycle cut poison export", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const left = {}
        const right = { bad: new Error("hidden") }
        left.right = right
        right.left = left
        importValue(left, { ...testContext, errorContext: "hidden cycle Error" })

        const result = exportValue(new Chain(left, testContext), [], testContext)

        expectExportErrors(result, [right.bad])
    })

    it("collects the complete raw Error frontier despite indexed fast paths", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const known = new Error("known")
        const hidden = new Error("hidden")
        const branch = { bad: known }
        const root = { branch, pending: pending.promise }
        branch.back = root
        importValue(root, { ...testContext, errorContext: "terminal cycle Error" })
        buildRefIndex(root, testContext)

        const result = exportValue(new Chain(root, testContext), ["branch"], testContext)

        expect(metaOf(branch, testContext).cycleCuts.has("back")).to.be(true)
        expect(getRefCounter(branch, testContext)).not.to.be(undefined)
        expect(typeof result.then).to.be("function")

        pending.resolve(hidden)
        expectExportErrors(await result, [known, hidden])
        verifyRefCounts(testContext, root, branch)
    })

    it("keeps captured waits after a synchronous reflection Error", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const reflection = new Error("reflection failed")
        const hidden = new Error("revealed later")
        let fail = false
        const broken = new Proxy({}, {
            ownKeys(target) {
                if (fail) throw reflection
                return Reflect.ownKeys(target)
            },
        })
        const chain = new Chain({
            pending: pending.promise,
            broken,
        }, testContext)
        fail = true
        const result = exportValue(chain, [], testContext)

        expect(result instanceof Promise).to.be(true)
        pending.resolve({ hidden })
        expectExportErrors(await result, [reflection, hidden])
    })

    it("keeps nested waits after a delayed reflection Error", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const reflection = new Error("delayed reflection failed")
        const hidden = new Error("nested later")
        let fail = false
        const broken = new Proxy({}, {
            ownKeys(target) {
                if (fail) throw reflection
                return Reflect.ownKeys(target)
            },
        })
        const branch = { inner: inner.promise, broken }
        new Chain(branch, testContext)
        fail = true
        const result = exportValue(
            new Chain({ branch: outer.promise }, testContext),
            [],
            testContext,
        )

        outer.resolve(branch)
        await flushMicrotasks()
        inner.resolve({ hidden })

        expectExportErrors(await result, [reflection, hidden])
    })

    it("continues the Error scan when output allocation fails", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const reflection = new Error("Array length failed")
        const nested = new Error("inside Array")
        let lengthReads = 0
        let fail = false
        const array = new Proxy([nested], {
            get(target, key, receiver) {
                if (fail && key === "length" && lengthReads++ === 0) {
                    throw reflection
                }
                return Reflect.get(target, key, receiver)
            },
        })

        const chain = new Chain({ array }, testContext)
        fail = true
        expectExportErrors(
            exportValue(chain, [], testContext),
            [reflection, nested],
        )
    })

    it("continues the Error scan after a property-read failure", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const reflection = new Error("property read failed")
        const nested = new Error("later property")
        let reads = 0
        const branch = new Proxy({ broken: 1, nested }, {
            getOwnPropertyDescriptor(target, key) {
                if (key === "broken" && reads++ === 1) throw reflection
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })

        expectExportErrors(
            exportValue(new Chain({ branch }, testContext), [], testContext),
            [reflection, nested],
        )
    })

    it("continues the Error scan after thenable recognition fails", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const reflection = new Error("then access failed")
        const nested = new Error("after thenable")
        const broken = Object.defineProperty({}, "then", {
            get() { throw reflection },
        })
        expectExportErrors(exportValue(new Chain({ broken, nested }, testContext), [], testContext), [reflection, nested])
    })

    it("agrees with Error queries on stable sync and promised data", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const known = new Error("known")
        const hidden = new Error("hidden")
        const chain = new Chain({
            known,
            pending: pending.promise,
        }, testContext)

        const exported = exportValue(chain, [], testContext)
        const errorsResult = getErrors(chain, [], testContext)

        expect(hasError(chain, [], testContext)).to.be(true)
        pending.resolve({ known, hidden })

        const [outcome, errors] = await Promise.all([
            exported,
            errorsResult,
        ])
        expectExportErrors(outcome, [known, hidden])
        expect(errors.errors.length).to.be(2)
        expect(errors.errors.some(error => error.cause === known)).to.be(true)
        expect(errors.errors.some(error => error.cause === hidden)).to.be(true)
    })

    it("exports a clean subpath through a cyclic import normally", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { child: { clean: { x: 1 } } }
        root.child.back = root
        importValue(root, { ...testContext, errorContext: "clean cyclic subpath" })
        const chain = new Chain(root, testContext)

        const clean = exportValue(chain, ["child", "clean"], testContext)

        expect(clean).to.eql(root.child.clean)
        expect(clean).not.to.be(root.child.clean)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(hasError(chain, ["child", "clean"], testContext)).to.be(false)
    })

    it("returns direct values until a real wait is needed", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const external = new Date()
        const root = {
            branch: { x: 1, external },
            external,
            primitive: 2,
        }
        const pending = deferred()

        const rootChain = new Chain(root, testContext)
        const branch = exportValue(rootChain, ["branch"], testContext)
        const primitive = exportValue(rootChain, ["primitive"], testContext)
        const externalResult = exportValue(rootChain, ["external"], testContext)
        const missing = exportValue(rootChain, ["missing"], testContext)
        const broken = exportValue(rootChain, ["missing", "value"], testContext)
        const waiting = exportValue(new Chain({ branch: { pending: pending.promise } }, testContext), ["branch"], testContext)

        expect(branch).to.eql(root.branch)
        expect(branch).not.to.be(root.branch)
        expect(primitive).to.be(2)
        expect(externalResult).to.be(external)
        expect(branch.external).to.be(external)
        expect(missing).to.be(undefined)
        expect(broken instanceof Error).to.be(true)
        expect(broken.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(typeof waiting.then).to.be("function")
    })

    it("returns settled clean branches synchronously as independent copies", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { branch: { x: 1 } }
        const branch = root.branch

        const rootChain = new Chain(root, testContext)
        const value = exportValue(rootChain, ["branch"], testContext)
        assignPath(rootChain, ["branch", "x"], 2, testContext)

        expect(value).not.to.be(branch)
        expect(metaOf(value, testContext)).to.be(undefined)
        expect(root.branch).to.be(branch)
        expect(branch.x).to.be(2)
        expect(root.branch.x).to.be(2)
        expect(value.x).to.be(1)
    })

    it("reads a resolved live Promise version synchronously without registering again", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { pending: pending.promise }
        const chain = new Chain(root, testContext)
        const observed = readPath(chain, ["pending"], testContext)

        pending.resolve({ value: 1 })
        await observed

        const promiseVersion = metaOf(root, testContext).placementVersions.pending
        expect(metaOf(root, testContext).placementVersions.pending).to.be(promiseVersion)

        const exported = exportValue(chain, [], testContext)

        expect(exported.then).to.be(undefined)
        expect(exported).to.eql({ pending: { value: 1 } })
        expect(metaOf(root, testContext).placementVersions.pending).to.be(promiseVersion)
    })

    it("does not expose imported metadata", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const root = { branch: { x: 1 } }
        const branch = root.branch

        importValue(root, { ...testContext, errorContext: "valid export import" })
        const value = exportValue(new Chain(root, testContext), ["branch"], testContext)

        expect(value).to.eql(branch)
        expect(value).not.to.be(branch)
        expect(metaOf(value, testContext)).to.be(undefined)
        expect(metaOf(root, testContext).imported).to.be(true)
        expect(Object.hasOwn(metaOf(root, testContext), "importPolicy")).to.be(false)
    })

    it("protects fast-path results from already-issued suspended writes", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pendingRoot = deferred()
        const root = { branch: { x: 1 } }
        const branch = root.branch

        const pendingChain = new Chain(pendingRoot.promise, testContext)
        assignPath(pendingChain, ["branch", "x"], 2, testContext)
        const value = exportValue(new Chain(root, testContext), ["branch"], testContext)

        expect(value).not.to.be(branch)
        expect(value).to.eql({ x: 1 })

        pendingRoot.resolve(root)
        await flushMicrotasks()

        expect(value).not.to.be(branch)
        expect(value).to.eql({ x: 1 })
        expect(root.branch).to.be(branch)
        expect(root.branch).to.eql({ x: 1 })
        expect(await exportValue(pendingChain, ["branch"], testContext)).to.eql({ x: 2 })
        verifyRefCounts(testContext, branch, root.branch)
    })

    it("protects the source from native mutations of exported output", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = { x: 1 }
        const branch = { left: child, right: child }
        const root = { branch }

        const copy = exportValue(new Chain(root, testContext), ["branch"], testContext)
        copy.left.x = 2

        expect(copy).not.to.be(branch)
        expect(copy.left).to.be(copy.right)
        expect(copy.left).not.to.be(child)
        expect(copy.left.x).to.be(2)
        expect(root.branch).to.be(branch)
        expect(child.x).to.be(1)
        expect(metaOf(copy, testContext)).to.be(undefined)
        expect(metaOf(copy.left, testContext)).to.be(undefined)
    })

    it("preserves managed class prototypes without running constructors", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        let constructions = 0
        class Point {
            constructor(x, y) {
                constructions++
                this.x = x
                this.y = y
            }

            sum() {
                return this.x + this.y
            }
        }
        managedStateClass(Point)
        const source = new Point(2, 3)
        constructions = 0

        const copy = exportValue(new Chain(source, testContext), [], testContext)

        expect(copy).not.to.be(source)
        expect(Object.getPrototypeOf(copy)).to.be(Point.prototype)
        expect(copy.sum()).to.be(5)
        expect(constructions).to.be(0)
        expect(metaOf(copy, testContext)).to.be(undefined)
    })

    it("reimports native-mutated output as fresh external data", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const output = exportValue(new Chain({ value: { x: 1 } }, testContext), [], testContext)
        output.value.back = output

        importValue(output, { ...testContext, errorContext: "exported round trip" })

        expect(getErrors(new Chain(output, testContext), [], testContext)).to.be(null)
        expect(metaOf(output.value, testContext).cycleCuts.has("back")).to.be(true)
    })

    it("copies sparse indexes and omits named Array properties", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
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

        const copy = exportValue(new Chain(root, testContext), [], testContext)

        expect(Array.isArray(copy)).to.be(true)
        expect(copy.length).to.be(4)
        expect(0 in copy).to.be(false)
        expect(1 in copy).to.be(true)
        expect(copy[1]).to.be(copy[3])
        expect(copy[1]).not.to.be(child)
        expect(Object.hasOwn(copy, "extra")).to.be(false)
        expect(Object.prototype.hasOwnProperty.call(copy, "hidden")).to.be(false)
        expect(Object.getOwnPropertySymbols(copy)).to.eql([])
        expect(metaOf(copy, testContext)).to.be(undefined)
        expect(metaOf(copy[1], testContext)).to.be(undefined)
    })

    it("preserves own-key order across Promise settlement", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const objectPending = deferred()
        const arrayPending = deferred()
        const object = {
            first: objectPending.promise,
            second: 2,
        }
        const array = ["zero"]
        array.first = arrayPending.promise
        array.second = 2

        const objectResult = exportValue(new Chain(object, testContext), [], testContext)
        const arrayResult = exportValue(new Chain(array, testContext), [], testContext)
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
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = { value: 1 }
        const root = { child }
        Object.defineProperty(root, "__proto__", {
            value: child,
            enumerable: true,
            writable: true,
            configurable: true,
        })

        const copy = exportValue(new Chain(root, testContext), [], testContext)

        expect(Object.getPrototypeOf(copy)).to.be(Object.prototype)
        expect(Object.prototype.hasOwnProperty.call(copy, "__proto__")).to.be(true)
        expect(copy.__proto__).to.be(copy.child)
        expect(copy.child).not.to.be(child)
    })

    it("returns a single Error for settled error branches without marking them", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = { x: 1 }
        const branch = { error: new Error("bad"), child }
        const root = { branch }

        const rootChain = new Chain(root, testContext)
        const value = exportValue(rootChain, ["branch"], testContext)
        assignPath(rootChain, ["branch", "child", "x"], 2, testContext)

        expectExportErrors(value, [branch.error])
        expect(root.branch).to.be(branch)
        expect(child.x).to.be(2)
    })

    it("captures keys before later writes without pinning the source", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: { pending: pending.promise } }
        const branch = root.branch

        const rootChain = new Chain(root, testContext)
        const result = exportValue(rootChain, ["branch"], testContext)
        assignPath(rootChain, ["branch", "later"], 2, testContext)

        pending.resolve("done")
        const value = await result

        expect(value).not.to.be(branch)
        expect(value).to.eql({ pending: "done" })
        expect(root.branch).to.be(branch)
        expect(root.branch).to.eql({ pending: "done", later: 2 })
        expect(requiresCopyOnWrite(branch, testContext)).to.be(false)
        expect(getRefCounter(branch, testContext)).to.be(undefined)
    })

    it("keeps concurrent export readiness and output independent", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const branch = { pending: pending.promise }
        const root = { branch }

        const rootChain = new Chain(root, testContext)
        const first = exportValue(rootChain, ["branch"], testContext)
        const second = exportValue(rootChain, ["branch"], testContext)

        pending.resolve("done")
        const values = await Promise.all([first, second])

        expect(values).to.eql([
            { pending: "done" },
            { pending: "done" },
        ])
        expect(values[0]).not.to.be(branch)
        expect(values[1]).not.to.be(branch)
        expect(values[0]).not.to.be(values[1])
        expect(requiresCopyOnWrite(branch, testContext)).to.be(false)
        expect(getRefCounter(branch, testContext)).to.be(undefined)
    })

    it("keeps concurrent export Error state independent", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const known = new Error("known")
        const hidden = new Error("hidden")
        const chain = new Chain({
            known,
            pending: pending.promise,
        }, testContext)

        const first = exportValue(chain, [], testContext)
        const second = exportValue(chain, [], testContext)
        pending.resolve({ known, hidden })
        const outcomes = await Promise.all([
            first,
            second,
        ])

        expectExportErrors(outcomes[0], [known, hidden])
        expectExportErrors(outcomes[1], [known, hidden])
        expect(outcomes[0]).not.to.be(outcomes[1])
        expect(outcomes[0].errors).not.to.be(outcomes[1].errors)
    })

    it("gives concurrent callers independent nested copies", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const branch = { pending: pending.promise }
        const chain = new Chain({ branch }, testContext)

        const firstResult = exportValue(chain, ["branch"], testContext)
        const secondResult = exportValue(chain, ["branch"], testContext)

        pending.resolve({ done: true })

        const first = await firstResult
        const second = await secondResult
        expect(first).not.to.be(branch)
        expect(second).not.to.be(branch)
        expect(first).not.to.be(second)
        expect(first).to.eql({ pending: { done: true } })
        expect(second).to.eql(first)
        expect(metaOf(first, testContext)).to.be(undefined)
        expect(metaOf(first.pending, testContext)).to.be(undefined)
        expect(getRefCounter(branch, testContext)).to.be(undefined)
    })

    it("keeps overlapping ancestor and child exports independent", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = { child }
        const chain = new Chain(root, testContext)

        const childResult = exportValue(chain, ["child"], testContext)
        const rootResult = exportValue(chain, [], testContext)

        pending.resolve({ done: true })
        const childValue = await childResult
        const rootValue = await rootResult

        expect(childValue).to.eql({ pending: { done: true } })
        expect(childValue).not.to.be(child)
        expect(rootValue).to.eql({ child: { pending: { done: true } } })
        expect(rootValue).not.to.be(root)
        expect(rootValue.child).not.to.be(childValue)
        expect(getRefCounter(root, testContext)).to.be(undefined)
        expect(getRefCounter(child, testContext)).to.be(undefined)
    })

    it("includes earlier suspended writes at their program position", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: pending.promise }

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch", "x"], 1, testContext)
        const result = exportValue(rootChain, ["branch"], testContext)

        pending.resolve({})
        const value = await result

        expect(value).not.to.be(root.branch)
        expect(value).to.eql({ x: 1 })
        verifyRefCounts(testContext, root)
    })

    it("includes an earlier suspended delete at its program position", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: pending.promise }
        const chain = new Chain(root, testContext)

        deletePath(chain, ["branch", "remove"], testContext)
        const result = exportValue(chain, ["branch"], testContext)

        pending.resolve({ keep: true, remove: true })
        const value = await result

        expect(value).not.to.be(root.branch)
        expect(value).to.eql({ keep: true })
        verifyRefCounts(testContext, root)
    })

    it("keeps later suspended writes out of an exported pending path", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: pending.promise }

        const rootChain = new Chain(root, testContext)
        const result = exportValue(rootChain, ["branch"], testContext)
        assignPath(rootChain, ["branch", "x"], 1, testContext)

        pending.resolve({})
        const value = await result

        expect(value).to.eql({})
        expect(root.branch).to.eql({ x: 1 })
        expect(root.branch).not.to.be(value)
        verifyRefCounts(testContext, root, value)
    })

    it("keeps a settled value when a later overwrite overtakes its continuation", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const chain = new Chain({ branch: pending.promise }, testContext)
        const result = exportValue(chain, ["branch"], testContext)

        pending.resolve({ observed: true })
        assignPath(chain, ["branch"], { replacement: true }, testContext)

        expect(await result).to.eql({ observed: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("continues a nested path wait after a later ancestor replacement", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise }, testContext)
        const result = exportValue(chain, ["branch", "inner"], testContext)

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()
        assignPath(chain, ["branch"], { replacement: true }, testContext)
        inner.resolve({ observed: true })

        expect(await result).to.eql({ observed: true })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("settles promises exposed by a path Promise version detached before resolution", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const chain = new Chain({ branch: outer.promise }, testContext)
        const result = exportValue(chain, ["branch"], testContext)
        let settled = false
        result.then(() => {
            settled = true
        })

        assignPath(chain, ["branch"], { replacement: true }, testContext)
        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()

        expect(settled).to.be(false)

        inner.resolve({ observed: true })

        expect(await result).to.eql({ inner: { observed: true } })
        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("keeps a raw property Promise version captured before deletion", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const branch = { pending: pending.promise }
        const chain = new Chain({ branch }, testContext)
        const result = exportValue(chain, ["branch"], testContext)

        deletePath(chain, ["branch", "pending"], testContext)
        pending.resolve({ observed: true })

        expect(await result).to.eql({ pending: { observed: true } })
        expect(Object.keys(branch)).to.eql([])
    })

    it("does not transfer a pending export to a replacement promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const observed = deferred()
        const replacement = deferred()
        const chain = new Chain({ branch: observed.promise }, testContext)

        const result = exportValue(chain, ["branch"], testContext)
        assignPath(chain, ["branch"], replacement.promise, testContext)
        observed.resolve({ observed: true })

        expect(await result).to.eql({ observed: true })
        expect(chain._state.value.branch).to.be(replacement.promise)

        replacement.resolve({ replacement: true })
        await flushMicrotasks()

        expect(chain._state.value.branch).to.eql({ replacement: true })
    })

    it("waits for promises exposed by resolved promise values", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }
        let settled = false

        const result = exportValue(new Chain(root, testContext), ["branch"], testContext)
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
        verifyRefCounts(testContext, root)
    })

    it("collapses to Error when a pending branch promise rejects", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const error = new Error("bad")
        const root = { branch: { pending: pending.promise } }

        const result = exportValue(new Chain(root, testContext), ["branch"], testContext)
        pending.reject(error)
        const value = await result

        expectExportErrors(value, [error])
        expect(root.branch.pending instanceof Error).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("collapses to Error when a resolved promise value contains an Error", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const error = new Error("bad")
        const root = { branch: { pending: pending.promise } }

        const result = exportValue(new Chain(root, testContext), ["branch"], testContext)
        pending.resolve({ failed: error })
        const value = await result

        expectExportErrors(value, [error])
        expect(root.branch.pending.failed instanceof Error).to.be(true)
        verifyRefCounts(testContext, root)
    })

    it("does not settle at a transient zero before same-promise continuations run", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const outer = deferred()
        const inner = deferred()
        const root = { branch: { outer: outer.promise } }
        let settled = false

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch", "outer", "inner"], inner.promise, testContext)
        const result = exportValue(rootChain, ["branch"], testContext)
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
        verifyRefCounts(testContext, root)
    })

    it("does not collapse to Error until queued earlier operations finish", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const root = { branch: { inner: pending.promise } }

        const rootChain = new Chain(root, testContext)
        assignPath(rootChain, ["branch", "inner", "e"], "fixed", testContext)
        const result = exportValue(rootChain, ["branch"], testContext)

        pending.resolve({ e: new Error("transient") })
        const value = await result

        expect(value).not.to.be(root.branch)
        expect(value).to.eql({ inner: { e: "fixed" } })
        verifyRefCounts(testContext, root)
    })

    it("creates no counter or settlement state while waiting", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const branch = { pending: pending.promise }
        const result = exportValue(new Chain({ branch }, testContext), ["branch"], testContext)

        expect(getRefCounter(branch, testContext)).to.be(undefined)
        expect(requiresCopyOnWrite(branch, testContext)).to.be(false)
        pending.resolve("done")
        await result

        expect(getRefCounter(branch, testContext)).to.be(undefined)
        expect(branch).to.eql({ pending: "done" })
    })

    it("does not wait for promises added by later-issued writes", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = deferred()
        const later1 = deferred()
        const later2 = deferred()
        const root = { branch: { pending: first.promise } }
        const branch = root.branch
        let settled = false

        const rootChain = new Chain(root, testContext)
        const result = exportValue(rootChain, ["branch"], testContext)
        result.then(() => {
            settled = true
        })

        // Export already captured the branch's enumerable key frontier.
        assignPath(rootChain, ["branch", "a"], later1.promise, testContext)
        assignPath(rootChain, ["branch", "b"], later2.promise, testContext)

        expect(root.branch).to.be(branch)
        expect(getRefCounter(branch, testContext)).to.be(undefined)

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
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const first = deferred()
        const second = deferred()
        const original = { first: first.promise }
        const chain = new Chain({ branch: original }, testContext)

        const originalResult = exportValue(chain, ["branch"], testContext)
        assignPath(chain, ["branch", "second"], second.promise, testContext)
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
        expect(getRefCounter(current, testContext)).to.be(undefined)

        const currentResult = exportValue(chain, ["branch"], testContext)
        second.resolve("second done")
        const currentOutput = await currentResult
        expect(currentOutput).not.to.be(current)
        expect(currentOutput).to.eql({
            first: "first done",
            second: "second done",
        })
        expect(current).to.eql({ first: "first done", second: "second done" })
        expect(getRefCounter(current, testContext)).to.be(undefined)
    })

    it("preserves cyclic imports without exposing cycle diagnostics", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cyclic = {}
        cyclic.self = cyclic
        const branch = { cyclic }
        const root = { branch }

        importValue(root, { ...testContext, errorContext: "export import" })
        const branchMeta = metaOf(branch, testContext)
        expect(branchMeta.imported).to.be(true)
        expect(branchMeta.imported).to.be(true)
        const rootChain = new Chain(root, testContext)
        const value = exportValue(rootChain, ["branch"], testContext)

        expect(value).not.to.be(branch)
        expect(value.cyclic.self).to.be(value.cyclic)
        expect(hasError(rootChain, ["branch"], testContext)).to.be(false)
        expect(metaOf(branch, testContext)).to.be(branchMeta)
        expect(branchMeta.imported).to.be(true)
        expect(getRefCounter(branch, testContext).errorCount).to.be(0)
        expect(getRefCounter(branch, testContext).cycleCutCount).to.be(1)
    })

    it("does not pin a synchronous Error found in a cyclic import", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const error = new Error("hidden")
        const cyclic = { bad: error }
        cyclic.self = cyclic
        const branch = { cyclic }
        const root = { branch }

        importValue(root, { ...testContext, errorContext: "synchronous cyclic Error" })
        const branchMeta = metaOf(branch, testContext)
        const result = exportValue(new Chain(root, testContext), ["branch"], testContext)

        expectExportErrors(result, [error])
        expect(metaOf(branch, testContext)).to.be(branchMeta)
        expect(branchMeta.imported).to.be(true)
        expect(branchMeta.imported).to.be(true)
    })

    it("waits on imported branches without pinning or re-rooting them", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const branch = { pending: pending.promise }
        const root = { branch }

        importValue(root, { ...testContext, errorContext: "pending export" })
        const branchMeta = metaOf(branch, testContext)
        const result = exportValue(new Chain(root, testContext), ["branch"], testContext)

        expect(branchMeta.imported).to.be(true)
        expect(branchMeta.imported).to.be(true)
        expect(getRefCounter(branch, testContext)).to.be(undefined)

        pending.resolve("done")
        expect(await result).to.eql({ pending: "done" })
        expect(metaOf(branch, testContext)).to.be(branchMeta)
        expect(branchMeta.imported).to.be(true)
    })

    it("exports promises inside sealed branches through versions", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const valid = Object.freeze({ x: 1 })
        const promise = Promise.resolve(1)
        const pending = Object.seal({ pending: promise })

        importValue(pending, { ...testContext, errorContext: "sealed export" })
        const copied = exportValue(new Chain(valid, testContext), [], testContext)
        const exported = exportValue(new Chain(pending, testContext), [], testContext)

        expect(copied).to.eql({ x: 1 })
        expect(copied).not.to.be(valid)
        expect(await exported).to.eql({ pending: 1 })
        expect(pending.pending).to.be(promise)
        expect(readPath(new Chain(pending, testContext), ["pending"], testContext)).to.be(1)
        expect(getRefCounter(valid, testContext)).to.be(undefined)
        expect(getRefCounter(pending, testContext)).to.be(undefined)
    })

    it("resolves an indexed sealed holder with exact counter updates", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const promise = pending.promise
        const sealed = Object.seal({ pending: promise })

        importValue(sealed, { ...testContext, errorContext: "indexed sealed export" })
        buildRefIndex(sealed, testContext)
        expect(getRefCounter(sealed, testContext).promiseCount).to.be(1)

        const exported = exportValue(new Chain(sealed, testContext), [], testContext)
        pending.resolve({ done: true })

        expect(await exported).to.eql({ pending: { done: true } })
        expect(sealed.pending).to.be(promise)
        expect(readPath(new Chain(sealed, testContext), ["pending"], testContext)).to.eql({
            done: true,
        })
        expect(getRefCounter(sealed, testContext).promiseCount).to.be(0)
        verifyRefCounts(testContext, sealed)
    })

    it("returns clean frozen branches synchronously as copies", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const frozen = Object.freeze({ nested: { value: 1 } })
        importValue(frozen, { ...testContext, errorContext: "clean frozen export" })

        const value = exportValue(new Chain(frozen, testContext), [], testContext)

        expect(value).to.eql({ nested: { value: 1 } })
        expect(value).not.to.be(frozen)
        expect(value.nested).not.to.be(frozen.nested)
        expect(getRefCounter(frozen, testContext)).to.be(undefined)
        expect(getRefCounter(frozen.nested, testContext)).to.be(undefined)
    })

    it("waits for a trusted indexed child beneath a frozen ancestor", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const child = { pending: pending.promise }

        new Chain(child, testContext)
        expect(buildRefIndex(child, testContext)).to.be(child)

        const frozen = Object.freeze({ child })
        importValue(frozen, { ...testContext, errorContext: "frozen indexed export" })
        const exported = exportValue(new Chain(frozen, testContext), [], testContext)

        expect(getRefCounter(frozen, testContext)).to.be(undefined)
        expect(getRefCounter(child, testContext).promiseCount).to.be(1)
        pending.resolve("done")
        expect(await exported).to.eql({ child: { pending: "done" } })
        // Existing admission keeps child runtime-owned rather than importing it.
        expect(child.pending).to.be("done")
        expect(readPath(new Chain(frozen, testContext), ["child", "pending"], testContext)).to.be("done")
        verifyRefCounts(testContext, child)
    })

    it("exports through a root promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const chain = new Chain(pending.promise, testContext)
        const result = exportValue(chain, ["branch"], testContext)

        pending.resolve({ branch: { x: 1 } })
        const value = await result

        expect(value).to.eql({ x: 1 })
    })
})
