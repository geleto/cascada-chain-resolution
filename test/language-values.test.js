import * as languageValues from "../src/language-values.js"
import * as metadata from "../src/meta.js"
import { ArrayView } from "../src/array-view.js"
import { Chain, assignPath, import as importValue, lookupPath, managedStateClass, Execution } from "../src/index.js"
import { consumeValue } from "../src/internal-step.js"
import { ERROR_KIND } from "../src/error.js"
import * as runtime from "../src/index.js"
import { deferred, expect, thrownBy } from "./support.js"
import * as errorUtils from "../src/error.js"
import * as internalSteps from "../src/internal-step.js"

describe("value admission", () => {
    it("uses distinct named numeric categories", () => {
        expect(languageValues.TYPE).to.be(metadata.TYPE)
        expect(Object.isFrozen(languageValues.TYPE)).to.be(true)
        const types = [
            languageValues.TYPE.Error,
            languageValues.TYPE.Array,
            languageValues.TYPE.Function,
            languageValues.TYPE.String,
            languageValues.TYPE.Primitive,
            languageValues.TYPE.Record,
            languageValues.TYPE.ManagedClass,
            languageValues.TYPE.External,
        ]
        expect(types.every(Number.isInteger)).to.be(true)
        expect(new Set(types).size).to.be(types.length)
    })

    it("classifies every available value category", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Managed {}
        class External {}
        managedStateClass(Managed)

        const cases = [
            [
                errorUtils.validationError(
                    "error",
                    testContext,
                    errorUtils.ERROR_KIND.OperationInputFailed,
                ),
                languageValues.TYPE.Error,
            ],
            [[], languageValues.TYPE.Array],
            [new ArrayView([1], testContext), languageValues.TYPE.Array],
            [() => {}, languageValues.TYPE.Function],
            [{ push() {} }, languageValues.TYPE.Record],
            [Object.create(null), languageValues.TYPE.Record],
            [new Managed(), languageValues.TYPE.ManagedClass],
            [new External(), languageValues.TYPE.External],
        ]
        for (const [value, type] of cases) {
            languageValues.admitReadyValue(value, testContext)
            expect(languageValues.typeOf(value, testContext)).to.be(type)
        }
        for (const value of [undefined, null, true, 1, 1n, Symbol()]) {
            expect(languageValues.typeOf(value, testContext)).to.be(
                languageValues.TYPE.Primitive,
            )
        }
        expect(languageValues.typeOf("text", testContext)).to.be(
            languageValues.TYPE.String,
        )
    })

    it("resolves Promise subclasses before admitting their values", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class ManagedPromise extends Promise {}
        managedStateClass(ManagedPromise)
        const promise = ManagedPromise.resolve([1, 2])
        const chain = new Chain(promise, testContext)

        const value = await lookupPath(chain, [], testContext)

        expect(metadata.metaOf(promise, testContext)?.type).to.be(undefined)
        expect(languageValues.typeOf(value, testContext)).to.be(languageValues.TYPE.Array)
    })

    it("leaves Promise identities pending instead of admitting them", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const promise = Promise.resolve(1)

        consumeValue(promise, testContext, ERROR_KIND.OperationInputFailed)
        expect(metadata.metaOf(promise, testContext)?.type).to.be(undefined)
        expect(languageValues.isPending(promise, testContext)).to.be(true)
    })

    it("admits Errors before sampling thenability", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const error = new Error("failure")
        let reads = 0
        Object.defineProperty(error, "then", {
            get() {
                reads++
                return () => {}
            },
        })

        expect(languageValues.isPending(error, testContext)).to.be(false)
        const poison = consumeValue(error, testContext, ERROR_KIND.OperationInputFailed)

        expect(languageValues.typeOf(poison, testContext)).to.be(languageValues.TYPE.Error)
        expect(reads).to.be(0)
    })

    it("recognizes a ready value at its consuming boundary", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        let reads = 0
        const value = Object.defineProperty({}, "then", {
            get() {
                reads++
                return undefined
            },
        })

        expect(consumeValue(value, testContext, ERROR_KIND.OperationInputFailed)).to.be(value)
        expect(reads).to.be(1)
        expect(languageValues.typeOf(value, testContext)).to.be(
            languageValues.TYPE.Record,
        )
    })

    it("turns an incompatible intrinsic then receiver into ready poison", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const value = new Proxy(Promise.resolve("settled"), {
            getPrototypeOf() {
                throw new Error("Promise continuation reflected on its source")
            },
        })

        const result = await lookupPath(new Chain(value, testContext), [], testContext)

        expect(result).to.be.a(Error)
    })

    it("admits an assigned graph before discovering nested Promises", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const pending = deferred()
        const chain = new Chain({ branch: {} }, testContext)
        lookupPath(chain, ["branch"], testContext)

        assignPath(chain, ["branch", "payload"], {
            nested: { pending: pending.promise },
        }, testContext)
        const protectedBranch = chain._state.value.branch
        const retained = new Chain(lookupPath(chain, ["branch"], testContext), testContext)
        assignPath(chain, ["branch", "next"], 1, testContext)

        expect(chain._state.value.branch).not.to.be(protectedBranch)
        expect(protectedBranch.next).to.be(undefined)
    })

    it("gives Array semantics precedence over class declaration", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class ManagedArray extends Array {}
        managedStateClass(ManagedArray)
        const value = new ManagedArray(1, 2)

        new Chain(value, testContext)

        expect(languageValues.typeOf(value, testContext)).to.be(languageValues.TYPE.Array)
    })

    it("keeps type and class definition fixed after admission", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Early {}
        class Managed {
            constructor() {
                this.value = 1
            }
        }
        managedStateClass(Managed)
        const error = new Error("fixed")
        const early = new Early()
        const managed = new Managed()
        const poison = consumeValue(error, testContext, ERROR_KIND.OperationInputFailed)
        new Chain(early, testContext)
        new Chain(managed, testContext)

        managedStateClass(Early)

        expect(errorUtils.isPoisonError(poison)).to.be(true)
        expect(languageValues.isPending(error, testContext)).to.be(false)
        expect(languageValues.typeOf(poison, testContext)).to.be(languageValues.TYPE.Error)
        expect(languageValues.typeOf(early, testContext)).to.be(languageValues.TYPE.External)
        expect(languageValues.isPending(early, testContext)).to.be(false)
        expect(languageValues.typeOf(managed, testContext)).to.be(
            languageValues.TYPE.ManagedClass,
        )
        importValue(managed, { ...testContext, errorContext: "managed class" })
        const managedChain = new Chain(managed, testContext)
        assignPath(managedChain, ["value"], 2, testContext)
        expect(Object.getPrototypeOf(managedChain._state.value)).to.be(
            Managed.prototype,
        )
        const late = new Chain(new Early(), testContext)._state.value
        expect(languageValues.typeOf(late, testContext)).to.be(languageValues.TYPE.ManagedClass)
    })

    it("does not reflect again after admission", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class External {}
        let prototypeReads = 0
        const target = new External()
        const value = new Proxy(target, {
            getPrototypeOf() {
                prototypeReads++
                return Reflect.getPrototypeOf(target)
            },
        })
        new Chain(value, testContext)
        const readsAtAdmission = prototypeReads

        expect(languageValues.typeOf(value, testContext)).to.be(languageValues.TYPE.External)
        expect(languageValues.isTraversable(value, testContext)).to.be(false)
        expect(prototypeReads).to.be(readsAtAdmission)
    })

    it("admits a value with uninspectable type as external", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const value = new Proxy({}, {
            getPrototypeOf() {
                throw new Error("classification failed")
            },
        })

        const chain = new Chain(value, testContext)

        expect(chain._state.value).to.be(value)
        expect(languageValues.typeOf(value, testContext)).to.be(
            languageValues.TYPE.External,
        )
    })

    it("returns synchronous then acquisition failure directly", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("thenability failed")
        const value = new Proxy({}, {
            get(target, key, receiver) {
                if (key === "then") throw failure
                return Reflect.get(target, key, receiver)
            },
        })

        const chain = new Chain(value, testContext)
        const result = lookupPath(chain, [], testContext)

        expect(chain._state.value instanceof Promise).to.be(false)
        expect(metadata.metaOf(value, testContext)).to.be(undefined)
        const attributed = await result
        expect(attributed.cause).to.be(failure)
        expect(chain._state.value).to.be(attributed)
        expect(languageValues.typeOf(attributed, testContext)).to.be(
            languageValues.TYPE.Error,
        )
    })

    it("captures synchronous then invocation failure as rejection", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("then invocation failed")
        const value = {
            then() {
                throw failure
            },
        }
        const chain = new Chain(value, testContext)

        const attributed = await lookupPath(chain, [], testContext)
        expect(attributed.cause).to.be(failure)
        expect(chain._state.value).to.be(attributed)
        expect(metadata.metaOf(value, testContext)).to.be(undefined)
    })

    it("reports a FatalError fulfilled by initial resolution", async () => {
        let testContext
        const pending = deferred()
        const failure = thrownBy(() =>
            internalSteps.runInternalStep(
                {
                    execution: new runtime.Execution(),
                    errorContext: "fatal fixture",
                },
                () => {
                    throw new Error("fatal fulfillment")
                },
            ),
        )
        let reported
        testContext = { execution: new Execution(error => {
            reported = error
        }), errorContext: "test operation" }
        const result = consumeValue(pending.promise, testContext, ERROR_KIND.OperationInputFailed)
        pending.resolve(failure)
        const caught = await result.catch(error => error)

        expect(caught).to.be(failure)
        expect(reported).to.be(failure)
    })

    it("rejects a FatalError fulfilled through a causal boundary", async () => {
        let testContext
        const failure = thrownBy(() =>
            internalSteps.runInternalStep(
                {
                    execution: new runtime.Execution(),
                    errorContext: "fatal fixture",
                },
                () => {
                    throw new Error("fatal boundary fulfillment")
                },
            ),
        )
        let reported
        testContext = { execution: new Execution(error => {
            reported = error
        }), errorContext: "test operation" }
        const operationContext = { ...testContext, errorContext: "causal boundary" }

        const result = internalSteps.consumeValue(
            Promise.resolve(failure),
            operationContext,
            errorUtils.ERROR_KIND.ChainValueFailed,
        )

        expect(await result.catch(error => error)).to.be(failure)
        expect(reported).to.be(failure)
    })

    it("declares a class without admitting its prototype", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Managed {}
        managedStateClass(Managed)

        expect(metadata.metaOf(Managed.prototype, testContext)).to.be(undefined)

        new Chain(Managed.prototype, testContext)
        expect(metadata.metaOf(Managed.prototype, testContext).type).to.be(
            languageValues.TYPE.Record,
        )
    })

    it("keeps an admitted subclass prototype as a managed-class definition", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Base {}
        class Child extends Base {
            childMethod() {
                return true
            }
        }
        managedStateClass(Base)
        managedStateClass(Child)
        new Chain(Child.prototype, testContext)

        const source = importValue(
            Object.assign(new Child(), { value: 1 }),
            { ...testContext, errorContext: "managed child" },
        )
        const chain = new Chain(source, testContext)
        assignPath(chain, ["value"], 2, testContext)
        const copy = chain._state.value

        expect(copy).not.to.be(source)
        expect(Object.getPrototypeOf(copy)).to.be(Child.prototype)
        expect(copy.childMethod()).to.be(true)
    })

    it("returns invalid managed-class declaration as an Error", () => {
        const failure = managedStateClass(() => {})

        expect(failure).to.be.a(TypeError)
    })

    it("records external facts without traversing external state", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class External {}
        let ownKeyReads = 0
        const value = new Proxy(new External(), {
            ownKeys() {
                ownKeyReads++
                throw new Error("external state was traversed")
            },
        })

        const chain = new Chain({ value }, testContext)
        expect(metadata.metaOf(value, testContext).type).to.be(languageValues.TYPE.External)
        expect(lookupPath(chain, ["value"], testContext)).to.be(value)
        importValue(value, { ...testContext, errorContext: "external import" })
        expect(metadata.incrementReadLease(value, testContext)).to.be(false)

        expect(ownKeyReads).to.be(0)
        expect(metadata.metaOf(value, testContext).imported).to.be(undefined)
        expect(metadata.isImported(value, testContext)).to.be(false)
    })
})
