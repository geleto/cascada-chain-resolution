import * as runtime from "../src/index.js"
import { requiresCopyOnWrite, metaOf } from "../src/meta.js"
import {
    Chain,
    Execution,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    lookupPath,
    export as exportValue,
    import as importValue,
} from "../src/index.js"

import { expect, readPath, deferred, errorCause, flushMicrotasks } from "./support.js"

describe("Chain root state", () => {
    it("preserves the initial value's ownership and import status", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const value = { meaning: 42 }
        const chain = new Chain(value, testContext)

        expect(chain._state.value).to.be(value)
        expect(requiresCopyOnWrite(value, testContext)).to.be(false)
        expect(metaOf(value, testContext).imported).to.be(undefined)
    })

    it("uses the supplied execution", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const execution = testContext.execution
        const chain = new Chain({ value: 1 }, { execution, errorContext: "test Chain initialization" })
        expect(assignPath(chain, ["value"], 2, testContext)).to.be(undefined)
        expect(readPath(chain, ["value"], testContext)).to.be(2)
        expect(chain.close).to.be(undefined)
    })

    it("keeps execution state outside the language root", () => {
        const chain = new Chain({}, { execution: new Execution(), errorContext: "test operation" })

        expect(Object.keys(chain._state)).to.eql(["value"])
    })

    it("keeps host fields outside the language graph", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const chain = new Chain({ clean: true }, testContext)
        chain._hostError = new Error("host error")

        expect(hasError(chain, [], testContext)).to.be(false)
        expect(exportValue(chain, [], testContext)).to.eql({ clean: true })
        expect(metaOf(chain, testContext)).to.be(undefined)
    })

    it("returns reflection failures as language Errors", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const operations = [
            value => importValue(value, { ...testContext, errorContext: "fatal import" }),
            value => lookupPath(new Chain(value, testContext), ["key"], testContext),
            value => exportValue(new Chain(value, testContext), [], testContext),
            value => assignPath(new Chain(value, testContext), ["key"], 1, testContext),
            value => deletePath(new Chain(value, testContext), ["key"], testContext),
        ]

        for (const operation of operations) {
            const failure = new Error("host trap failed")
            const value = new Proxy({}, {
                getOwnPropertyDescriptor() {
                    throw failure
                },
                ownKeys() {
                    throw failure
                },
            })
            expect(errorCause(operation(value))).to.be(failure)
        }
    })

    it("treats an uninspectable mutation receiver as external", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const value = new Proxy({}, {
            getPrototypeOf() {
                throw new Error("prototype failed")
            },
        })
        const chain = new Chain(value, testContext)

        expect(chain._state.value).to.be(value)
        const outcome = assignPath(chain, ["key"], 1, testContext)
        expect(outcome).to.be.a(Error)
        expect(outcome.kind).to.be(runtime.ERROR_KIND.ExternalLocationConflict)
        expect(chain._state.value).to.be(outcome)
    })

    it("handles number and string roots across every operation", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        for (const primitive of [7, "text"]) {
            expect(lookupPath(new Chain(primitive, testContext), [], testContext)).to.be(primitive)
            expect(exportValue(new Chain(primitive, testContext), [], testContext)).to.be(primitive)
            expect(hasError(new Chain(primitive, testContext), [], testContext)).to.be(false)
            expect(getErrors(new Chain(primitive, testContext), [], testContext)).to.be(null)

            const lookupError = lookupPath(new Chain(primitive, testContext), ["child"], testContext)
            const exportError = exportValue(new Chain(primitive, testContext), ["child"], testContext)
            const errors = getErrors(new Chain(primitive, testContext), ["child"], testContext)
            for (const error of [
                lookupError,
                exportError,
                errors,
            ]) {
                expect(error instanceof Error).to.be(true)
                expect(error.message).to.be(
                    "Cannot access property through missing or primitive value",
                )
            }
            expect(errors.errors).to.be(undefined)
            expect(hasError(new Chain(primitive, testContext), ["child"], testContext)).to.be(true)

            const assignedRoot = new Chain(primitive, testContext)
            const replacement = { primitive }
            assignPath(assignedRoot, [], replacement, testContext)
            expect(assignedRoot._state.value).to.be(replacement)

            const deletedRoot = new Chain(primitive, testContext)
            deletePath(deletedRoot, [], testContext)
            expect(deletedRoot._state.value).to.be(null)

            const assignedChild = new Chain(primitive, testContext)
            assignPath(assignedChild, ["child"], 1, testContext)
            expect(assignedChild._state.value instanceof Error).to.be(true)

            const deletedChild = new Chain(primitive, testContext)
            deletePath(deletedChild, ["child"], testContext)
            expect(deletedChild._state.value instanceof Error).to.be(true)
        }
    })

    it("treats an array root as traversable language data", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = { value: 1 }
        const root = [child]
        const chain = new Chain(root, testContext)

        expect(readPath(chain, [], testContext)).to.be(root)
        expect(readPath(chain, [0, "value"], testContext)).to.be(1)
        expect(hasError(chain, [], testContext)).to.be(false)
        expect(getErrors(chain, [], testContext)).to.be(null)

        const exported = exportValue(chain, [], testContext)
        expect(Array.isArray(exported)).to.be(true)
        expect(exported).to.eql([{ value: 1 }])
        expect(exported).not.to.be(root)
        expect(exported[0]).not.to.be(child)

        assignPath(chain, [0, "value"], 2, testContext)
        expect(root[0].value).to.be(2)

        deletePath(chain, [0], testContext)
        expect(root.length).to.be(1)
        expect(0 in root).to.be(false)
    })

    it("orders root promise operations through the state holder", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pendingRoot = deferred()
        const chain = new Chain(pendingRoot.promise, testContext)
        const root = { branch: { x: 1 } }

        const read = lookupPath(chain, ["branch"], testContext)
        assignPath(chain, ["branch", "x"], 2, testContext)

        pendingRoot.resolve(root)
        const oldBranch = await read
        await flushMicrotasks()

        expect(oldBranch).to.eql({ x: 1 })
        expect(chain._state.value.branch).to.eql({ x: 2 })
        expect(chain._state.value.branch).not.to.be(oldBranch)
    })

    it("detaches a pending root resolver when the root is replaced", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pendingRoot = deferred()
        const chain = new Chain(pendingRoot.promise, testContext)

        assignPath(chain, ["x"], 1, testContext)
        assignPath(chain, [], { replacement: true }, testContext)

        pendingRoot.resolve({})
        await flushMicrotasks()

        expect(chain._state.value).to.eql({ replacement: true })
    })

    it("writes back a promise assigned as the whole root", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pendingRoot = deferred()
        const chain = new Chain({ old: true }, testContext)

        assignPath(chain, [], pendingRoot.promise, testContext)

        expect(chain._state.value).to.be(pendingRoot.promise)
        pendingRoot.resolve({ next: true })
        await flushMicrotasks()

        expect(chain._state.value).to.eql({ next: true })
    })

    it("keeps pending root observations on their issue-time state", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const lookupRoot = deferred()
        const lookupChain = new Chain(lookupRoot.promise, testContext)
        const read = lookupPath(lookupChain, [], testContext)

        lookupRoot.resolve({ observed: true })
        assignPath(lookupChain, [], { replacement: "lookup" }, testContext)

        expect(await read).to.eql({ observed: true })
        expect(lookupChain._state.value).to.eql({ replacement: "lookup" })

        const exportRoot = deferred()
        const exportChain = new Chain(exportRoot.promise, testContext)
        const exported = exportValue(exportChain, [], testContext)

        exportRoot.resolve({ exported: true })
        assignPath(exportChain, [], { replacement: "export" }, testContext)

        expect(await exported).to.eql({ exported: true })
        expect(exportChain._state.value).to.eql({ replacement: "export" })
    })

    it("captures observation paths before a pending root settles", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const lookupRoot = deferred()
        const lookupSegments = ["before"]
        const read = lookupPath(new Chain(lookupRoot.promise, testContext), lookupSegments, testContext)
        lookupSegments[0] = "after"
        lookupRoot.resolve({ before: 1, after: 2 })

        const exportRoot = deferred()
        const exportSegments = ["before"]
        const exported = exportValue(new Chain(exportRoot.promise, testContext), exportSegments, testContext)
        exportSegments[0] = "after"
        exportRoot.resolve({ before: { selected: true }, after: { selected: false } })

        const errorRoot = deferred()
        const errorSegments = ["before"]
        const foundError = hasError(new Chain(errorRoot.promise, testContext), errorSegments, testContext)
        errorSegments[0] = "after"
        errorRoot.resolve({ before: new Error("selected"), after: { clean: true } })

        expect(await read).to.be(1)
        expect(await exported).to.eql({ selected: true })
        expect(await foundError).to.be(true)
    })
})
