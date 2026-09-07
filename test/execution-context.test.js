import * as metadata from "../src/meta.js"
import { ArrayView, projectionOf } from "../src/array-view.js"
import * as propertyVersions from "../src/property-versions.js"
import * as refcounts from "../src/refcounts.js"
import * as runtime from "../src/index.js"
import { readPath } from "../src/observations.js"
import { runInternalStep } from "../src/error.js"
import {
    expect,
    flushMicrotasks,
    thrownBy,
} from "./support.js"

function operationContext(execution, errorContext) {
    return { execution, errorContext }
}

function expectFatal(work) {
    const failure = thrownBy(work)
    expect(failure).to.be.a(runtime.FatalError)
    return failure
}

describe("operation context", () => {
    it("requires an operation context at every production boundary", () => {
        expectFatal(() => new runtime.Chain({}))
        expectFatal(() => new runtime.ContextChain({}))
        expectFatal(() => runtime.import({}))

        const execution = new runtime.Execution()
        const initialization = operationContext(execution, "initialization")
        const chain = new runtime.Chain({ value: 1 }, initialization)
        const operations = [
            () => runtime.lookupPath(chain, []),
            () => readPath(chain, []),
            () => runtime.export(chain, []),
            () => runtime.hasError(chain, []),
            () => runtime.getErrors(chain, []),
            () => runtime.assignPath(chain, ["value"], 2),
            () => runtime.deletePath(chain, ["value"]),
            () => runtime.run(chain, [], "toString", []),
            () => runtime.enter(chain, [], undefined, false, () => {}),
        ]
        for (const operation of operations) expectFatal(operation)
        expect(chain._state.value).to.eql({ value: 1 })
    })

    for (const [name, operation] of [
        ["lookupPath", (chain, ctx) => runtime.lookupPath(chain, ["count"], ctx)],
        ["readPath", (chain, ctx) => readPath(chain, ["count"], ctx)],
        ["export", (chain, ctx) => runtime.export(chain, [], ctx)],
        ["hasError", (chain, ctx) => runtime.hasError(chain, [], ctx)],
        ["getErrors", (chain, ctx) => runtime.getErrors(chain, [], ctx)],
        ["assignPath", (chain, ctx) => runtime.assignPath(chain, ["count"], 2, ctx)],
        ["deletePath", (chain, ctx) => runtime.deletePath(chain, ["count"], ctx)],
        ["run", (chain, ctx) => runtime.run(chain, [], "read", [], ctx, {})],
        ["enter", (chain, ctx, effect) => runtime.enter(chain, ["service"], ctx, false, effect)],
    ]) {
        it(name + " rejects another execution before touching its graph state", () => {
            const first = new runtime.Execution()
            const reports = []
            const second = new runtime.Execution(error => reports.push(error))
            const firstContext = operationContext(first, "source initialization")
            const secondContext = operationContext(second, name)
            let effects = 0
            const effect = () => { effects++ }
            class Service {}
            const service = new Service()
            const value = { count: 1, service, read: effect }
            const chain = new runtime.ContextChain(value, firstContext, [["service"]])
            const externalMutationTree = chain._externalMutationTree
            let externalTreeRead = false
            Object.defineProperty(chain, "_externalMutationTree", {
                get() {
                    externalTreeRead = true
                    return externalMutationTree
                },
            })

            expect(second.fatalError).to.be(null)
            const failure = expectFatal(() => operation(chain, secondContext, effect))
            expect(failure).to.be(second.fatalError)
            expect(failure.cause.message).to.be("Operation context execution does not match Chain")
            expect(failure.errorContext).to.be(secondContext.errorContext)
            expect(reports).to.eql([failure])
            expect(first.fatalError).to.be(null)
            expect(value.count).to.be(1)
            expect(effects).to.be(0)
            expect(externalTreeRead).to.be(false)
            expect(metadata.metaOf(value, secondContext)).to.be(undefined)
            expect(second._externalIdentities.get(service)).to.be(undefined)
        })

        it(name + " rejects a failed execution with a correctly bound Chain", () => {
            const execution = new runtime.Execution()
            const ctx = operationContext(execution, name)
            let effects = 0
            const effect = () => { effects++ }
            const value = { count: 1, service: {}, read: effect }
            const chain = new runtime.Chain(value, ctx)
            const failure = expectFatal(() => runInternalStep(ctx, () => {
                throw new Error("execution already failed")
            }))

            expect(expectFatal(() => operation(chain, ctx, effect))).to.be(failure)
            expect(value.count).to.be(1)
            expect(effects).to.be(0)
        })
    }

    it("isolates imported mutation state by execution", () => {
        const first = new runtime.Execution()
        const second = new runtime.Execution()
        const firstOperationContext = operationContext(first, "first")
        const secondOperationContext = operationContext(second, "second")
        const source = { branch: { value: 1 } }
        const firstChain = new runtime.Chain(
            runtime.import(source, firstOperationContext),
            firstOperationContext,
        )
        const secondChain = new runtime.Chain(
            runtime.import(source, secondOperationContext),
            secondOperationContext,
        )

        runtime.assignPath(
            firstChain,
            ["branch", "value"],
            2,
            firstOperationContext,
        )
        runtime.assignPath(
            secondChain,
            ["branch", "value"],
            3,
            secondOperationContext,
        )

        expect(runtime.export(firstChain, [], firstOperationContext)).to.eql({
            branch: { value: 2 },
        })
        expect(runtime.export(secondChain, [], secondOperationContext)).to.eql({
            branch: { value: 3 },
        })
        expect(source).to.eql({ branch: { value: 1 } })
    })

    it("isolates graph metadata and Promise mirrors by execution", async () => {
        const first = new runtime.Execution()
        const second = new runtime.Execution()
        const pending = Promise.resolve({ ready: true })
        const value = { pending }
        const firstOperationContext = operationContext(first, "first import")
        const secondOperationContext = operationContext(second, "second import")

        runtime.import(value, firstOperationContext)
        runtime.import(value, secondOperationContext)

        const firstMeta = metadata.metaOf(value, firstOperationContext)
        const secondMeta = metadata.metaOf(value, secondOperationContext)
        expect(firstMeta).not.to.be(secondMeta)
        expect(firstMeta.imported).to.be(true)
        expect(secondMeta.imported).to.be(true)
        expect(Object.hasOwn(firstMeta, "importPolicy")).to.be(false)
        expect(Object.hasOwn(secondMeta, "importPolicy")).to.be(false)
        expect(propertyVersions.getPromiseMirror(
            value,
            "pending",
            firstOperationContext,
        )).not.to.be(propertyVersions.getPromiseMirror(
            value,
            "pending",
            secondOperationContext,
        ))

        await flushMicrotasks()
        expect(firstMeta.placementVersions.pending.value).to.eql({ ready: true })
        expect(secondMeta.placementVersions.pending.value).to.eql({ ready: true })
    })

    it("isolates ownership and Array projections by execution", () => {
        const first = new runtime.Execution()
        const second = new runtime.Execution()
        const firstOperationContext = operationContext(first, "first Array")
        const secondOperationContext = operationContext(second, "second Array")
        const value = [1, 2]
        new runtime.Chain(value, firstOperationContext)
        new runtime.Chain(value, secondOperationContext)

        expect(metadata.incrementReadLease(value, firstOperationContext)).to.be(true)
        expect(metadata.hasReadLease(value, firstOperationContext)).to.be(true)
        expect(metadata.hasReadLease(value, secondOperationContext)).to.be(false)
        metadata.decrementReadLease(value, firstOperationContext)

        metadata.markShared(value, firstOperationContext)
        const view = ArrayView.tryAttachTo(value, firstOperationContext)

        expect(metadata.requiresCopyOnWrite(value, firstOperationContext)).to.be(true)
        expect(metadata.requiresCopyOnWrite(value, secondOperationContext)).to.be(false)
        expect(projectionOf(value, firstOperationContext)).to.be(view)
        expect(projectionOf(value, secondOperationContext)).to.be(value)
    })

    it("shares graph facts only between Chains in one execution", () => {
        const execution = new runtime.Execution()
        const firstOperationContext = operationContext(execution, "first Chain")
        const secondOperationContext = operationContext(execution, "second Chain")
        const value = {}

        new runtime.Chain(value, firstOperationContext)
        const admitted = metadata.metaOf(value, firstOperationContext)
        new runtime.Chain(value, secondOperationContext)

        expect(metadata.metaOf(value, secondOperationContext)).to.be(admitted)
    })

    it("attributes later failures to the operation that causes them", () => {
        const execution = new runtime.Execution()
        const firstOperationContext = operationContext(execution, "first source")
        const secondOperationContext = operationContext(execution, "second source")
        const first = runtime.import(Object.freeze([1]), firstOperationContext)
        const second = runtime.import(Object.freeze([2]), secondOperationContext)
        const deleteOperationContext = operationContext(
            execution,
            "delete operation",
        )

        const firstFailure = runtime.deletePath(
            new runtime.Chain(first, deleteOperationContext),
            ["length"],
            deleteOperationContext,
        )
        const secondFailure = runtime.deletePath(
            new runtime.Chain(second, deleteOperationContext),
            ["length"],
            deleteOperationContext,
        )

        expect(firstFailure.errorContext).to.be("delete operation")
        expect(secondFailure.errorContext).to.be("delete operation")
    })

    it("preserves a falsey operation source in diagnostics", () => {
        const execution = new runtime.Execution()
        const importOperationContext = operationContext(execution, 0)
        const imported = runtime.import(
            Object.freeze([1]),
            importOperationContext,
        )
        const failure = runtime.deletePath(
            new runtime.Chain(imported, importOperationContext),
            ["length"],
            importOperationContext,
        )

        expect(failure.errorContext).to.be(0)
    })

    it("subscribes independently without execution-local thenability state", async () => {
        let samples = 0
        let invocations = 0
        const resolved = {}
        const thenable = Object.defineProperty({}, "then", {
            get() {
                samples++
                return resolve => {
                    invocations++
                    return resolve(resolved)
                }
            },
        })
        const first = new runtime.Execution()
        const second = new runtime.Execution()
        const firstOperationContext = operationContext(first, "first thenable")
        const secondOperationContext = operationContext(second, "second thenable")

        const firstChain = new runtime.Chain(thenable, firstOperationContext)
        const sibling = new runtime.Chain(thenable, firstOperationContext)
        const secondChain = new runtime.Chain(thenable, secondOperationContext)
        await flushMicrotasks()

        expect(samples).to.be(3)
        expect(invocations).to.be(3)
        expect(readPath(firstChain, [], firstOperationContext)).to.be(resolved)
        expect(readPath(sibling, [], firstOperationContext)).to.be(resolved)
        expect(readPath(secondChain, [], secondOperationContext)).to.be(resolved)
    })

    it("attributes then access and invocation failures to their operation contexts", async () => {
        const acquisitionExecution = new runtime.Execution()
        const acquisitionOperationContext = operationContext(
            acquisitionExecution,
            "then acquisition",
        )
        const acquisitionFailure = Object.defineProperty({}, "then", {
            get() {
                throw new Error("acquisition failed")
            },
        })
        const acquisitionChain = new runtime.Chain(
            acquisitionFailure,
            acquisitionOperationContext,
        )
        const acquisitionError = await readPath(
            acquisitionChain,
            [],
            operationContext(acquisitionExecution, "later acquisition"),
        )
        expect(acquisitionError.errorContext).to.be("then acquisition")
        expect(acquisitionError.kind).to.be("ThenAccessFailed")

        const invocationExecution = new runtime.Execution()
        const invocationOperationContext = operationContext(
            invocationExecution,
            "then invocation",
        )
        const invocationFailure = {
            then() {
                throw new Error("invocation failed")
            },
        }
        const invocationChain = new runtime.Chain(
            invocationFailure,
            invocationOperationContext,
        )
        const invocationError = await readPath(
            invocationChain,
            [],
            operationContext(invocationExecution, "later invocation"),
        )
        expect(invocationError.errorContext).to.be("then invocation")
        expect(invocationError.kind).to.be("ThenInvocationFailed")
    })

    it("applies current declarations independently at first admission", () => {
        class Value {}
        const value = new Value()
        const first = new runtime.Execution()
        const second = new runtime.Execution()
        const firstOperationContext = operationContext(first, "before registration")
        const secondOperationContext = operationContext(second, "after registration")
        new runtime.Chain(value, firstOperationContext)

        runtime.managedStateClass(Value)
        new runtime.Chain(value, secondOperationContext)

        expect(metadata.metaOf(value, firstOperationContext).type).to.be(
            metadata.TYPE_EXTERNAL,
        )
        expect(metadata.metaOf(value, secondOperationContext).type).to.be(
            metadata.TYPE_MANAGED_CLASS,
        )
    })

    it("keeps refcount indexes inside their selected execution", () => {
        const first = new runtime.Execution()
        const second = new runtime.Execution()
        const firstOperationContext = operationContext(first, "first index")
        const secondOperationContext = operationContext(second, "second index")
        const value = { child: {} }
        new runtime.Chain(value, firstOperationContext)
        new runtime.Chain(value, secondOperationContext)

        refcounts.buildRefIndex(value, firstOperationContext)

        expect(refcounts.getRefCounter(value, firstOperationContext)).not.to.be(undefined)
        expect(refcounts.getRefCounter(value, secondOperationContext)).to.be(undefined)
    })
})
