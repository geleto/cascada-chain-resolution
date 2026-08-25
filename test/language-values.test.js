import * as languageValues from "../src/language-values.js"
import * as metadata from "../src/meta.js"
import { ArrayView } from "../src/array-view.js"
import { resolveInitialValueOrPoison } from "../src/resolution.js"
import {
    Chain,
    assignPath,
    deferred,
    expect,
    importValue,
    lookupPath,
    managedStateClass,
    setFatalErrorReporter,
    thrownBy,
} from "./support.js"

describe("value admission", () => {
    it("uses distinct named numeric categories", () => {
        const types = [
            languageValues.TYPE_ERROR,
            languageValues.TYPE_ARRAY,
            languageValues.TYPE_FUNCTION,
            languageValues.TYPE_STRING,
            languageValues.TYPE_PRIMITIVE,
            languageValues.TYPE_RECORD,
            languageValues.TYPE_MANAGED_CLASS,
            languageValues.TYPE_EXTERNAL,
        ]
        expect(types.every(Number.isInteger)).to.be(true)
        expect(new Set(types).size).to.be(types.length)
    })

    it("classifies every available value category", () => {
        class Managed {}
        class External {}
        managedStateClass(Managed)

        const cases = [
            [new Error("error"), languageValues.TYPE_ERROR],
            [[], languageValues.TYPE_ARRAY],
            [new ArrayView([1]), languageValues.TYPE_ARRAY],
            [() => {}, languageValues.TYPE_FUNCTION],
            [{ push() {} }, languageValues.TYPE_RECORD],
            [Object.create(null), languageValues.TYPE_RECORD],
            [new Managed(), languageValues.TYPE_MANAGED_CLASS],
            [new External(), languageValues.TYPE_EXTERNAL],
        ]
        for (const [value, type] of cases) {
            new Chain(value)
            expect(languageValues.typeOf(value)).to.be(type)
        }
        for (const value of [undefined, null, true, 1, 1n, Symbol()]) {
            expect(languageValues.typeOf(value)).to.be(
                languageValues.TYPE_PRIMITIVE,
            )
        }
        expect(languageValues.typeOf("text")).to.be(
            languageValues.TYPE_STRING,
        )
    })

    it("resolves Promise subclasses before admitting their values", async () => {
        class ManagedPromise extends Promise {}
        managedStateClass(ManagedPromise)
        const promise = ManagedPromise.resolve([1, 2])
        const chain = new Chain(promise)

        const value = await lookupPath(chain, [])

        expect(metadata.metaOf(promise)?.type).to.be(undefined)
        expect(languageValues.typeOf(value)).to.be(languageValues.TYPE_ARRAY)
    })

    it("leaves Promise identities pending instead of admitting them", () => {
        const promise = Promise.resolve(1)

        languageValues.admitValue(promise)
        expect(metadata.metaOf(promise)?.type).to.be(undefined)
        expect(languageValues.isPromise(promise)).to.be(true)
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

        expect(languageValues.isPromise(error)).to.be(false)
        languageValues.admitValue(error)

        expect(languageValues.typeOf(error)).to.be(
            languageValues.TYPE_ERROR,
        )
        expect(reads).to.be(0)
    })

    it("samples thenability once before admitting an available value", () => {
        let reads = 0
        const value = Object.defineProperty({}, "then", {
            get() {
                reads++
                return reads === 1 ? undefined : () => {}
            },
        })

        expect(resolveInitialValueOrPoison(value)).to.be(value)
        expect(reads).to.be(1)
        expect(languageValues.typeOf(value)).to.be(
            languageValues.TYPE_RECORD,
        )
    })

    it("captures a callable then once at a root property version", async () => {
        let reads = 0
        const value = Promise.resolve("settled")
        Object.defineProperty(value, "then", {
            get() {
                reads++
                if (reads > 1) throw new Error("then was read twice")
                return Promise.prototype.then
            },
        })
        const chain = new Chain(value)

        expect(await lookupPath(chain, [])).to.be("settled")
        expect(reads).to.be(1)
    })

    it("captures a callable then once at a nested property version", async () => {
        let reads = 0
        const value = Object.defineProperty({}, "then", {
            get() {
                reads++
                if (reads > 1) throw new Error("then was read twice")
                return resolve => resolve("settled")
            },
        })
        const chain = new Chain({ value })

        expect(await lookupPath(chain, ["value"])).to.be("settled")
        expect(reads).to.be(1)
    })

    it("turns an incompatible intrinsic then receiver into ready poison", () => {
        const value = new Proxy(Promise.resolve("settled"), {
            getPrototypeOf() {
                throw new Error("Promise continuation reflected on its source")
            },
        })

        const result = lookupPath(new Chain(value), [])

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

        expect(languageValues.typeOf(value)).to.be(languageValues.TYPE_ARRAY)
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
        new Chain(error)
        new Chain(early)
        new Chain(managed)

        managedStateClass(Early)
        Object.setPrototypeOf(error, null)
        Object.setPrototypeOf(early, Managed.prototype)
        Object.setPrototypeOf(managed, null)
        error.then = () => {}
        early.then = () => {}

        expect(languageValues.isError(error)).to.be(true)
        expect(languageValues.isPromise(error)).to.be(false)
        expect(languageValues.typeOf(error)).to.be(languageValues.TYPE_ERROR)
        expect(languageValues.typeOf(early)).to.be(languageValues.TYPE_EXTERNAL)
        expect(languageValues.isPromise(early)).to.be(false)
        expect(languageValues.typeOf(managed)).to.be(
            languageValues.TYPE_MANAGED_CLASS,
        )
        importValue(managed, "changed managed-class prototype")
        const managedChain = new Chain(managed)
        assignPath(managedChain, ["value"], 2)
        expect(Object.getPrototypeOf(managedChain._state.value)).to.be(
            Managed.prototype,
        )
        const late = new Chain(new Early())._state.value
        expect(languageValues.typeOf(late)).to.be(languageValues.TYPE_MANAGED_CLASS)
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
        expect(languageValues.typeOf(value)).to.be(languageValues.TYPE_EXTERNAL)
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
            languageValues.TYPE_EXTERNAL,
        )
    })

    it("captures synchronous then acquisition failure as rejection", async () => {
        const failure = new Error("thenability failed")
        const value = new Proxy({}, {
            get(target, key, receiver) {
                if (key === "then") throw failure
                return Reflect.get(target, key, receiver)
            },
        })

        const chain = new Chain(value)
        const result = lookupPath(chain, [])

        expect(chain._state.value).to.be(value)
        expect(metadata.metaOf(value)).to.be(undefined)
        expect(await result).to.be(failure)
        expect(chain._state.value).to.be(failure)
        expect(languageValues.typeOf(failure)).to.be(
            languageValues.TYPE_ERROR,
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

        expect(await lookupPath(chain, [])).to.be(failure)
        expect(chain._state.value).to.be(failure)
        expect(metadata.metaOf(value)).to.be(undefined)
    })

    it("declares a class without admitting its prototype", () => {
        class Managed {}
        managedStateClass(Managed)

        expect(metadata.metaOf(Managed.prototype)).to.be(undefined)

        new Chain(Managed.prototype)
        expect(metadata.metaOf(Managed.prototype).type).to.be(
            languageValues.TYPE_RECORD,
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
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })

        const failure = managedStateClass(() => {})

        expect(failure).to.be.a(TypeError)
        expect(reported).to.be(undefined)
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
        metadata.incrementReadLease(value)
        metadata.decrementReadLease(value)

        expect(ownKeyReads).to.be(0)
        expect(metadata.metaOf(value).shared).to.be(undefined)
        expect(metadata.importBoundaryOf(value)).to.be(undefined)
    })
})
