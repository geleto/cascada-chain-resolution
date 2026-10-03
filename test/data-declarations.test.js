import * as languageValues from "../src/language-values.js"
import * as metadata from "../src/meta.js"
import {
    Chain,
    externalState,
    import as importValue,
    lookupPath,
    managedState,
    managedStateClass,
    Execution,
} from "../src/index.js"
import { deferred, expect } from "./support.js"

describe("data declarations", () => {
    it("uses managed records and Arrays and external classes by default", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {}
        const record = {}
        const array = []
        const instance = new Value()

        new Chain(record, testContext)
        new Chain(array, testContext)
        new Chain(instance, testContext)

        expect(metadata.metaOf(record, testContext).type).to.be(languageValues.TYPE.Record)
        expect(metadata.metaOf(array, testContext).type).to.be(languageValues.TYPE.Array)
        expect(metadata.metaOf(instance, testContext).type).to.be(
            languageValues.TYPE.External,
        )
    })

    it("declares exact records and Arrays external without walking them", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const child = {}
        const record = { child }
        const array = [child]

        expect(externalState(record)).to.be(record)
        expect(externalState(array)).to.be(array)
        expect(metadata.metaOf(record, testContext)).to.be(undefined)
        expect(metadata.metaOf(array, testContext)).to.be(undefined)
        expect(metadata.metaOf(child, testContext)).to.be(undefined)

        new Chain(record, testContext)
        new Chain(array, testContext)
        new Chain(child, testContext)
        expect(metadata.metaOf(record, testContext).type).to.be(
            languageValues.TYPE.External,
        )
        expect(metadata.metaOf(array, testContext).type).to.be(
            languageValues.TYPE.External,
        )
        expect(metadata.metaOf(child, testContext).type).to.be(languageValues.TYPE.Record)
        expect(metadata.identityDeclarationOf(record)).to.be(
            metadata.DECLARATION_EXTERNAL,
        )
        expect(metadata.identityDeclarationOf(array)).to.be(
            metadata.DECLARATION_EXTERNAL,
        )
    })

    it("declares every currently reachable class instance managed", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Vec {
            constructor(x) {
                this.x = x
            }
        }
        class Line {
            constructor(start, end) {
                this.start = start
                this.end = end
                this.self = this
            }
        }
        const point = new Vec(1)
        const line = new Line(point, point)

        expect(managedState(line)).to.be(line)
        expect(metadata.metaOf(line, testContext)).to.be(undefined)
        expect(metadata.metaOf(point, testContext)).to.be(undefined)

        const chain = new Chain(line, testContext)
        expect(metadata.metaOf(line, testContext).type).to.be(
            languageValues.TYPE.ManagedClass,
        )
        expect(lookupPath(chain, ["start"], testContext)).to.be(point)
        expect(metadata.metaOf(point, testContext).type).to.be(
            languageValues.TYPE.ManagedClass,
        )
        expect(metadata.identityDeclarationOf(line)).to.be(
            metadata.DECLARATION_MANAGED,
        )
        expect(metadata.identityDeclarationOf(point)).to.be(
            metadata.DECLARATION_MANAGED,
        )

        const laterPoint = new Vec(2)
        new Chain(laterPoint, testContext)
        expect(metadata.metaOf(laterPoint, testContext).type).to.be(
            languageValues.TYPE.External,
        )
    })

    it("uses records and Arrays only as managed declaration roots", () => {
        const record = {}
        const array = []

        expect(managedState(record)).to.be(record)
        expect(managedState(array)).to.be(array)
        expect(externalState(record)).to.be(record)
        expect(externalState(array)).to.be(array)
    })

    it("lets an identity declaration override its managed class", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {}
        expect(managedStateClass(Value)).to.be(undefined)

        const managed = new Value()
        const external = new Value()
        externalState(external)
        new Chain(managed, testContext)
        new Chain(external, testContext)

        expect(metadata.metaOf(managed, testContext).type).to.be(
            languageValues.TYPE.ManagedClass,
        )
        expect(metadata.metaOf(external, testContext).type).to.be(
            languageValues.TYPE.External,
        )
    })

    it("uses the prototype present when a declared identity is admitted", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Original {}
        class Replacement {}
        const value = new Original()

        managedState(value)
        Object.setPrototypeOf(value, Replacement.prototype)
        new Chain(value, testContext)

        expect(metadata.metaOf(value, testContext).type).to.be(
            languageValues.TYPE.ManagedClass,
        )
        expect(metadata.metaOf(value, testContext).admittedPrototype).to.be(
            Replacement.prototype,
        )
    })

    it("makes import honor declarations and stop at external state", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Managed {
            constructor(declaredExternal, admittedExternal) {
                this.child = {}
                this.declaredExternal = declaredExternal
                this.admittedExternal = admittedExternal
            }
        }
        class External {}
        const hidden = {}
        const declaredExternal = externalState({ hidden })
        const admittedExternal = new External()
        new Chain(admittedExternal, testContext)
        const managed = managedState(new Managed(
            declaredExternal,
            admittedExternal,
        ))

        importValue({ managed }, testContext)

        expect(metadata.metaOf(declaredExternal, testContext).type).to.be(
            languageValues.TYPE.External,
        )
        expect(metadata.metaOf(admittedExternal, testContext).type).to.be(
            languageValues.TYPE.External,
        )
        expect(metadata.metaOf(hidden, testContext)).to.be(undefined)
        expect(metadata.metaOf(managed, testContext).type).to.be(
            languageValues.TYPE.ManagedClass,
        )
        expect(metadata.metaOf(managed.child, testContext).type).to.be(
            languageValues.TYPE.Record,
        )
    })

    it("stops at nested uninspectable state", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const opaque = new Proxy({}, {
            getPrototypeOf() {
                throw new Error("uninspectable")
            },
        })
        const root = { opaque }

        expect(managedState(root)).to.be(root)
        expect(managedState(opaque).message).to.be(
            "managedState cannot inspect this prototype",
        )

        new Chain(opaque, testContext)
        expect(metadata.metaOf(opaque, testContext).type).to.be(
            languageValues.TYPE.External,
        )
    })

    it("does not let later declarations reclassify admitted identities", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Late {}
        const instance = new Late()
        new Chain(instance, testContext)
        managedStateClass(Late)

        expect(metadata.metaOf(instance, testContext).type).to.be(
            languageValues.TYPE.External,
        )
        expect(managedState(instance)).to.be(instance)

        const record = {}
        new Chain(record, testContext)
        expect(externalState(record)).to.be(record)
        expect(metadata.metaOf(record, testContext).type).to.be(languageValues.TYPE.Record)
    })

    it("walks declarations independently of execution admission", () => {
        let testContext = { execution: new Execution(), errorContext: "test operation" }
        class Candidate {}
        class ExistingExternal {}
        const candidate = new Candidate()
        const external = new ExistingExternal()
        const root = { candidate, external }

        new Chain(root, testContext)
        new Chain(external, testContext)
        expect(managedState(root)).to.be(root)

        new Chain(candidate, testContext)
        expect(metadata.metaOf(candidate, testContext).type).to.be(languageValues.TYPE.External)
        testContext = { execution: new Execution(), errorContext: "test operation" }
        new Chain(candidate, testContext)
        expect(metadata.metaOf(candidate, testContext).type).to.be(
            languageValues.TYPE.ManagedClass,
        )
    })

    it("returns declaration conflicts without changing either declaration", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class ManagedFirst {}
        class ExternalFirst {}
        const managed = new ManagedFirst()
        const external = new ExternalFirst()

        managedState(managed)
        expect(externalState(managed).message).to.be(
            "externalState cannot declare this value external because it is already managed",
        )
        externalState(external)
        expect(managedState(external).message).to.be(
            "managedState cannot declare this value managed because it is already external",
        )

        new Chain(managed, testContext)
        new Chain(external, testContext)
        expect(metadata.metaOf(managed, testContext).type).to.be(
            languageValues.TYPE.ManagedClass,
        )
        expect(metadata.metaOf(external, testContext).type).to.be(
            languageValues.TYPE.External,
        )
    })

    it("validates a managed declaration atomically", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Child {}
        const pending = deferred()
        const thenable = { then() {} }
        const child = new Child()
        const root = { child, pending: pending.promise }

        expect(managedState(root)).to.be.an(Error)
        expect(managedState({ thenable })).to.be.an(Error)
        new Chain(child, testContext)
        expect(metadata.metaOf(child, testContext).type).to.be(
            languageValues.TYPE.External,
        )
    })

    it("samples thenability independently for declaration and admission", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Managed {}
        const value = new Managed()
        let reads = 0
        Object.defineProperty(value, "then", {
            enumerable: true,
            get() {
                reads++
                return reads === 1 ? undefined : () => {}
            },
        })

        expect(managedState(value)).to.be(value)
        new Chain(value, testContext)

        expect(reads).to.be(2)
        expect(metadata.metaOf(value, testContext)).to.be(undefined)
        expect(metadata.identityDeclarationOf(value)).to.be(
            metadata.DECLARATION_MANAGED,
        )
    })

    it("preserves Errors and stops at nested Errors and Functions", () => {
        const failure = new Error("failure")
        expect(externalState(failure)).to.be(failure)
        expect(managedState(failure)).to.be(failure)

        const root = { failure, callback() {} }
        expect(managedState(root)).to.be(root)
        expect(managedState(root.callback)).to.be.an(Error)
    })

    it("validates all managed classes before changing the registry", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class First {}
        class Invalid {
            then() {}
        }
        class Last {}

        expect(managedStateClass(First, Invalid, Last)).to.be.a(TypeError)

        const first = new First()
        const last = new Last()
        new Chain(first, testContext)
        new Chain(last, testContext)
        expect(metadata.metaOf(first, testContext).type).to.be(
            languageValues.TYPE.External,
        )
        expect(metadata.metaOf(last, testContext).type).to.be(
            languageValues.TYPE.External,
        )
    })

    it("rejects unsafe then properties on managed prototype chains", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Base {
            then(resolve) {
                resolve("assimilated")
            }
        }
        class Registered extends Base {}
        class Declared extends Base {}
        const registered = new Registered()
        const declared = new Declared()
        declared.then = undefined

        expect(managedStateClass(Registered)).to.be.a(TypeError)
        expect(managedState(declared)).to.be.a(TypeError)

        new Chain(registered, testContext)
        new Chain(declared, testContext)
        expect(metadata.metaOf(registered, testContext)).to.be(undefined)
        expect(metadata.metaOf(declared, testContext).type).to.be(
            languageValues.TYPE.External,
        )

        let reads = 0
        class WithThenAccessor {
            get then() {
                reads++
                return undefined
            }
        }
        expect(managedStateClass(WithThenAccessor)).to.be.a(TypeError)
        expect(reads).to.be(0)
    })

    it("samples a managed class prototype once", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Managed {}
        let prototypeReads = 0
        const ManagedProxy = new Proxy(Managed, {
            get(target, key, receiver) {
                if (key === "prototype") prototypeReads++
                return Reflect.get(target, key, receiver)
            },
        })

        expect(managedStateClass(ManagedProxy)).to.be(undefined)
        expect(prototypeReads).to.be(1)

        const value = new Managed()
        new Chain(value, testContext)
        expect(metadata.metaOf(value, testContext).type).to.be(
            languageValues.TYPE.ManagedClass,
        )
    })

    it("returns validation Errors for unsupported declaration inputs", () => {
        const pending = deferred()
        for (const value of [null, 1, () => {}, pending.promise]) {
            expect(externalState(value)).to.be.an(Error)
        }
        expect(managedState(pending.promise)).to.be.an(Error)
        expect(managedStateClass({})).to.be.an(Error)
    })
})
