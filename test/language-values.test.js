import * as runtime from "../src/index.js"
import {
    ArrayView,
    Chain,
    assignPath,
    deferred,
    expect,
    importValue,
    lookupPath,
    languageValues,
    managedStateClass,
    metadata,
    consumeValue,
    useTestExecution,
    testOperationContext,
    thrownBy,
} from "./support.js"
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
        class Managed {}
        class External {}
        managedStateClass(Managed)

        const cases = [
            [
                errorUtils.validationError(
                    "error",
                    testOperationContext(),
                    errorUtils.ERROR_KIND.OperationInputFailed,
                ),
                languageValues.TYPE.Error,
            ],
            [[], languageValues.TYPE.Array],
            [new ArrayView([1]), languageValues.TYPE.Array],
            [() => {}, languageValues.TYPE.Function],
            [{ push() {} }, languageValues.TYPE.Record],
            [Object.create(null), languageValues.TYPE.Record],
            [new Managed(), languageValues.TYPE.ManagedClass],
            [new External(), languageValues.TYPE.External],
        ]
        for (const [value, type] of cases) {
            languageValues.admitReadyValue(value)
            expect(languageValues.typeOf(value)).to.be(type)
        }
        for (const value of [undefined, null, true, 1, 1n, Symbol()]) {
            expect(languageValues.typeOf(value)).to.be(
                languageValues.TYPE.Primitive,
            )
        }
        expect(languageValues.typeOf("text")).to.be(
            languageValues.TYPE.String,
        )
    })

    it("resolves Promise subclasses before admitting their values", async () => {
        class ManagedPromise extends Promise {}
        managedStateClass(ManagedPromise)
        const promise = ManagedPromise.resolve([1, 2])
        const chain = new Chain(promise)

        const value = await lookupPath(chain, [])

        expect(metadata.metaOf(promise)?.type).to.be(undefined)
        expect(languageValues.typeOf(value)).to.be(languageValues.TYPE.Array)
    })

    it("leaves Promise identities pending instead of admitting them", () => {
        const promise = Promise.resolve(1)

        consumeValue(promise)
        expect(metadata.metaOf(promise)?.type).to.be(undefined)
        expect(languageValues.isPending(promise)).to.be(true)
    })

    it("admits Errors before sampling thenability", () => {
        const error = new Error("failure")
        let reads = 0
        Object.defineProperty(error, "then", {
            get() {
                reads++
                return () => {}
            },
        })

        expect(languageValues.isPending(error)).to.be(false)
        const poison = consumeValue(error)

        expect(languageValues.typeOf(poison)).to.be(languageValues.TYPE.Error)
        expect(reads).to.be(0)
    })

    it("recognizes a ready value at its consuming boundary", () => {
        let reads = 0
        const value = Object.defineProperty({}, "then", {
            get() {
                reads++
                return undefined
            },
        })

        expect(consumeValue(value)).to.be(value)
        expect(reads).to.be(1)
        expect(languageValues.typeOf(value)).to.be(
            languageValues.TYPE.Record,
        )
    })

    it("turns an incompatible intrinsic then receiver into ready poison", async () => {
        const value = new Proxy(Promise.resolve("settled"), {
            getPrototypeOf() {
                throw new Error("Promise continuation reflected on its source")
            },
        })

        const result = await lookupPath(new Chain(value), [])

        expect(result).to.be.a(Error)
    })

    it("admits an assigned graph before discovering nested Promises", () => {
        const pending = deferred()
        const chain = new Chain({ branch: {} })
        lookupPath(chain, ["branch"])

        assignPath(chain, ["branch", "payload"], {
            nested: { pending: pending.promise },
        })
        const protectedBranch = chain._state.value.branch
        assignPath(chain, ["branch", "next"], 1)

        expect(chain._state.value.branch).not.to.be(protectedBranch)
        expect(protectedBranch.next).to.be(undefined)
    })

    it("gives Array semantics precedence over class declaration", () => {
        class ManagedArray extends Array {}
        managedStateClass(ManagedArray)
        const value = new ManagedArray(1, 2)

        new Chain(value)

        expect(languageValues.typeOf(value)).to.be(languageValues.TYPE.Array)
    })

    it("keeps type and class definition fixed after admission", () => {
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
        const poison = consumeValue(error)
        new Chain(early)
        new Chain(managed)

        managedStateClass(Early)
        Object.setPrototypeOf(error, null)
        Object.setPrototypeOf(early, Managed.prototype)
        Object.setPrototypeOf(managed, null)
        error.then = () => {}
        early.then = () => {}

        expect(errorUtils.isPoisonError(poison)).to.be(true)
        expect(languageValues.isPending(error)).to.be(false)
        expect(languageValues.typeOf(poison)).to.be(languageValues.TYPE.Error)
        expect(languageValues.typeOf(early)).to.be(languageValues.TYPE.External)
        expect(languageValues.isPending(early)).to.be(false)
        expect(languageValues.typeOf(managed)).to.be(
            languageValues.TYPE.ManagedClass,
        )
        importValue(managed, "changed managed-class prototype")
        const managedChain = new Chain(managed)
        assignPath(managedChain, ["value"], 2)
        expect(Object.getPrototypeOf(managedChain._state.value)).to.be(
            Managed.prototype,
        )
        const late = new Chain(new Early())._state.value
        expect(languageValues.typeOf(late)).to.be(languageValues.TYPE.ManagedClass)
    })

    it("does not reflect again after admission", () => {
        class External {}
        let prototypeReads = 0
        const target = new External()
        const value = new Proxy(target, {
            getPrototypeOf() {
                prototypeReads++
                return Reflect.getPrototypeOf(target)
            },
        })
        new Chain(value)
        const readsAtAdmission = prototypeReads

        Object.setPrototypeOf(target, Object.prototype)
        expect(languageValues.typeOf(value)).to.be(languageValues.TYPE.External)
        expect(languageValues.isTraversable(value)).to.be(false)
        expect(prototypeReads).to.be(readsAtAdmission)
    })

    it("admits a value with uninspectable type as external", () => {
        const value = new Proxy({}, {
            getPrototypeOf() {
                throw new Error("classification failed")
            },
        })

        const chain = new Chain(value)

        expect(chain._state.value).to.be(value)
        expect(languageValues.typeOf(value)).to.be(
            languageValues.TYPE.External,
        )
    })

    it("returns synchronous then acquisition failure directly", async () => {
        const failure = new Error("thenability failed")
        const value = new Proxy({}, {
            get(target, key, receiver) {
                if (key === "then") throw failure
                return Reflect.get(target, key, receiver)
            },
        })

        const chain = new Chain(value)
        const result = lookupPath(chain, [])

        expect(chain._state.value instanceof Promise).to.be(false)
        expect(metadata.metaOf(value)).to.be(undefined)
        const attributed = await result
        expect(attributed.cause).to.be(failure)
        expect(chain._state.value).to.be(attributed)
        expect(languageValues.typeOf(attributed)).to.be(
            languageValues.TYPE.Error,
        )
    })

    it("captures synchronous then invocation failure as rejection", async () => {
        const failure = new Error("then invocation failed")
        const value = {
            then() {
                throw failure
            },
        }
        const chain = new Chain(value)

        const attributed = await lookupPath(chain, [])
        expect(attributed.cause).to.be(failure)
        expect(chain._state.value).to.be(attributed)
        expect(metadata.metaOf(value)).to.be(undefined)
    })

    it("reports a FatalError fulfilled by initial resolution", async () => {
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
        useTestExecution(error => {
            reported = error
        })
        const result = consumeValue(pending.promise)
        pending.resolve(failure)
        const caught = await result.catch(error => error)

        expect(caught).to.be(failure)
        expect(reported).to.be(failure)
    })

    it("rejects a FatalError fulfilled through a causal boundary", async () => {
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
        useTestExecution(error => {
            reported = error
        })
        const operationContext = testOperationContext("causal boundary")

        const result = internalSteps.consumeValue(
            Promise.resolve(failure),
            operationContext,
            errorUtils.ERROR_KIND.ChainValueFailed,
        )

        expect(await result.catch(error => error)).to.be(failure)
        expect(reported).to.be(failure)
    })

    it("declares a class without admitting its prototype", () => {
        class Managed {}
        managedStateClass(Managed)

        expect(metadata.metaOf(Managed.prototype)).to.be(undefined)

        new Chain(Managed.prototype)
        expect(metadata.metaOf(Managed.prototype).type).to.be(
            languageValues.TYPE.Record,
        )
    })

    it("keeps an admitted subclass prototype as a managed-class definition", () => {
        class Base {}
        class Child extends Base {
            childMethod() {
                return true
            }
        }
        managedStateClass(Base)
        managedStateClass(Child)
        new Chain(Child.prototype)

        const source = importValue(
            Object.assign(new Child(), { value: 1 }),
            "managed child",
        )
        const chain = new Chain(source)
        assignPath(chain, ["value"], 2)
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
        class External {}
        let ownKeyReads = 0
        const value = new Proxy(new External(), {
            ownKeys() {
                ownKeyReads++
                throw new Error("external state was traversed")
            },
        })

        const chain = new Chain({ value })
        expect(metadata.metaOf(value)).to.be(undefined)
        expect(lookupPath(chain, ["value"])).to.be(value)
        importValue(value, "external import")
        expect(metadata.incrementReadLease(value)).to.be(false)

        expect(ownKeyReads).to.be(0)
        expect(metadata.metaOf(value).shared).to.be(undefined)
        expect(metadata.isImported(value)).to.be(false)
    })
})
