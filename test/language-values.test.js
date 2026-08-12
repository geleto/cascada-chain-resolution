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
    registerDataClass,
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
            languageValues.TYPE_REGISTERED,
            languageValues.TYPE_OPAQUE,
        ]
        expect(types.every(Number.isInteger)).to.be(true)
        expect(new Set(types).size).to.be(types.length)
    })

    it("classifies every available value category", () => {
        class Registered {}
        class Opaque {}
        registerDataClass(Registered)

        const cases = [
            [new Error("error"), languageValues.TYPE_ERROR],
            [[], languageValues.TYPE_ARRAY],
            [new ArrayView([1]), languageValues.TYPE_ARRAY],
            [() => {}, languageValues.TYPE_FUNCTION],
            [{ push() {} }, languageValues.TYPE_RECORD],
            [Object.create(null), languageValues.TYPE_RECORD],
            [new Registered(), languageValues.TYPE_REGISTERED],
            [new Opaque(), languageValues.TYPE_OPAQUE],
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
        class RegisteredPromise extends Promise {}
        registerDataClass(RegisteredPromise)
        const promise = RegisteredPromise.resolve([1, 2])
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

    it("gives Array semantics precedence over registration", () => {
        class RegisteredArray extends Array {}
        registerDataClass(RegisteredArray)
        const value = new RegisteredArray(1, 2)

        new Chain(value)

        expect(languageValues.typeOf(value)).to.be(languageValues.TYPE_ARRAY)
    })

    it("keeps type and class definition fixed after admission", () => {
        class Early {}
        class Registered {
            constructor() {
                this.value = 1
            }
        }
        registerDataClass(Registered)
        const error = new Error("fixed")
        const early = new Early()
        const registered = new Registered()
        new Chain(error)
        new Chain(early)
        new Chain(registered)

        registerDataClass(Early)
        Object.setPrototypeOf(error, null)
        Object.setPrototypeOf(early, Registered.prototype)
        Object.setPrototypeOf(registered, null)
        error.then = () => {}
        early.then = () => {}

        expect(languageValues.isError(error)).to.be(true)
        expect(languageValues.isPromise(error)).to.be(false)
        expect(languageValues.typeOf(error)).to.be(languageValues.TYPE_ERROR)
        expect(languageValues.typeOf(early)).to.be(languageValues.TYPE_OPAQUE)
        expect(languageValues.isPromise(early)).to.be(false)
        expect(languageValues.typeOf(registered)).to.be(
            languageValues.TYPE_REGISTERED,
        )
        importValue(registered, "changed registered prototype")
        const registeredChain = new Chain(registered)
        assignPath(registeredChain, ["value"], 2)
        expect(Object.getPrototypeOf(registeredChain._state.value)).to.be(
            Registered.prototype,
        )
        const late = new Chain(new Early())._state.value
        expect(languageValues.typeOf(late)).to.be(languageValues.TYPE_REGISTERED)
    })

    it("does not reflect again after admission", () => {
        class Opaque {}
        let prototypeReads = 0
        const target = new Opaque()
        const value = new Proxy(target, {
            getPrototypeOf() {
                prototypeReads++
                return Reflect.getPrototypeOf(target)
            },
        })
        new Chain(value)
        const readsAtAdmission = prototypeReads

        Object.setPrototypeOf(target, Object.prototype)
        expect(languageValues.typeOf(value)).to.be(languageValues.TYPE_OPAQUE)
        expect(languageValues.isTraversable(value)).to.be(false)
        expect(prototypeReads).to.be(readsAtAdmission)
    })

    it("admits a value with uninspectable type as opaque", () => {
        const value = new Proxy({}, {
            getPrototypeOf() {
                throw new Error("classification failed")
            },
        })

        const chain = new Chain(value)

        expect(chain._state.value).to.be(value)
        expect(languageValues.typeOf(value)).to.be(
            languageValues.TYPE_OPAQUE,
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

    it("registers a class without admitting its prototype", () => {
        class Registered {}
        registerDataClass(Registered)

        expect(metadata.metaOf(Registered.prototype)).to.be(undefined)

        new Chain(Registered.prototype)
        expect(metadata.metaOf(Registered.prototype).type).to.be(
            languageValues.TYPE_RECORD,
        )
    })

    it("keeps an admitted subclass prototype registered as a definition", () => {
        class Base {}
        class Child extends Base {
            childMethod() {
                return true
            }
        }
        registerDataClass(Base)
        registerDataClass(Child)
        new Chain(Child.prototype)

        const source = importValue(
            Object.assign(new Child(), { value: 1 }),
            "registered child",
        )
        const chain = new Chain(source)
        assignPath(chain, ["value"], 2)
        const copy = chain._state.value

        expect(copy).not.to.be(source)
        expect(Object.getPrototypeOf(copy)).to.be(Child.prototype)
        expect(copy.childMethod()).to.be(true)
    })

    it("reports invalid class registration as fatal", () => {
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })

        const failure = thrownBy(() => registerDataClass(() => {}))

        expect(failure).to.be.a(TypeError)
        expect(reported).to.be(failure)
    })

    it("records opaque facts without traversing opaque state", () => {
        class Opaque {}
        let ownKeyReads = 0
        const value = new Proxy(new Opaque(), {
            ownKeys() {
                ownKeyReads++
                throw new Error("opaque state was traversed")
            },
        })

        const chain = new Chain({ value })
        expect(metadata.metaOf(value)).to.be(undefined)
        expect(lookupPath(chain, ["value"])).to.be(value)
        importValue(value, "opaque import")
        const release = metadata.acquireReadLease(value)
        release()

        expect(ownKeyReads).to.be(0)
        expect(metadata.metaOf(value).shared).to.be(true)
        expect(metadata.importBoundaryOf(value).errorContext).to.be(
            "opaque import",
        )
    })
})
