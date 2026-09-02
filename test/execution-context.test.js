import * as metadata from "../src/meta.js"
import { ArrayView, projectionOf } from "../src/array-view.js"
import * as propertyVersions from "../src/property-versions.js"
import * as refcounts from "../src/refcounts.js"
import * as runtime from "../src/index.js"
import { readPath } from "../src/observations.js"
import {
    expect,
    flushMicrotasks,
    setFatalErrorReporter,
    thrownBy,
} from "./support.js"

function operationContext(execution, errorContext) {
    return { execution, errorContext }
}

function expectFatal(work) {
    let reported
    setFatalErrorReporter(error => {
        reported = error
    })
    const failure = thrownBy(work)
    setFatalErrorReporter()
    expect(failure instanceof Error).to.be(true)
    expect(reported).to.be(failure)
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

    it("rejects another execution before touching its graph state", () => {
        const first = new runtime.Execution()
        const second = new runtime.Execution()
        const firstOperationContext = operationContext(first, "first")
        const secondOperationContext = operationContext(second, "second")
        class Service {}
        const service = new Service()
        const value = { count: 1, service }
        const chain = new runtime.ContextChain(
            value,
            firstOperationContext,
            [["service"]],
        )
        const externalMutationTree = chain._externalMutationTree
        let externalTreeRead = false
        Object.defineProperty(chain, "_externalMutationTree", {
            get() {
                externalTreeRead = true
                return externalMutationTree
            },
        })
        let entered = false
        const operations = [
            () => runtime.lookupPath(chain, ["count"], secondOperationContext),
            () => readPath(chain, ["count"], secondOperationContext),
            () => runtime.export(chain, [], secondOperationContext),
            () => runtime.hasError(chain, [], secondOperationContext),
            () => runtime.getErrors(chain, [], secondOperationContext),
            () => runtime.assignPath(
                chain,
                ["count"],
                2,
                secondOperationContext,
            ),
            () => runtime.deletePath(chain, ["count"], secondOperationContext),
            () => runtime.run(
                chain,
                [],
                "toString",
                [],
                secondOperationContext,
                {},
            ),
            () => runtime.enter(
                chain,
                ["service"],
                secondOperationContext,
                false,
                () => { entered = true },
            ),
        ]
        for (const operation of operations) expectFatal(operation)

        expect(value.count).to.be(1)
        expect(entered).to.be(false)
        expect(externalTreeRead).to.be(false)
        expect(metadata.metaOf(value, secondOperationContext)).to.be(undefined)
        expect(second._externalIdentities.get(service)).to.be(undefined)
    })

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
        expect(firstMeta.importBoundary.errorContext).to.be("first import")
        expect(secondMeta.importBoundary.errorContext).to.be("second import")
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
        expect(firstMeta.mirrors.pending.value).to.eql({ ready: true })
        expect(secondMeta.mirrors.pending.value).to.eql({ ready: true })
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

    it("keeps each import source in later diagnostics", () => {
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

        expect(firstFailure.message).to.contain("first source")
        expect(secondFailure.message).to.contain("second source")
    })

    it("preserves a falsey import source in diagnostics", () => {
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

        expect(failure.message).to.contain("(imported at: 0)")
    })

    it("samples and canonicalizes thenables independently per execution", async () => {
        let samples = 0
        let invocations = 0
        const resolved = {}
        const thenable = Object.defineProperty({}, "then", {
            get() {
                samples++
                return resolve => {
                    invocations++
                    resolve(resolved)
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

        expect(samples).to.be(2)
        expect(invocations).to.be(2)
        expect(readPath(firstChain, [], firstOperationContext)).to.be(resolved)
        expect(readPath(sibling, [], firstOperationContext)).to.be(resolved)
        expect(readPath(secondChain, [], secondOperationContext)).to.be(resolved)
    })

    it("retains the contexts that first sample and invoke a thenable", () => {
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
        new runtime.Chain(acquisitionFailure, acquisitionOperationContext)
        expect(
            acquisitionExecution._thenables.get(acquisitionFailure)
                .acquisitionOperationContext,
        ).to.be(acquisitionOperationContext)

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
        new runtime.Chain(invocationFailure, invocationOperationContext)
        expect(
            invocationExecution._thenables.get(invocationFailure)
                .invocationOperationContext,
        ).to.be(invocationOperationContext)
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

        propertyVersions.buildRefIndex(value, firstOperationContext)

        expect(refcounts.getRefCounter(value, firstOperationContext)).not.to.be(undefined)
        expect(refcounts.getRefCounter(value, secondOperationContext)).to.be(undefined)
    })
})
