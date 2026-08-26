import * as languageValues from "../src/language-values.js"
import * as metadata from "../src/meta.js"
import {
    Chain,
    deferred,
    expect,
    externalState,
    importValue,
    lookupPath,
    managedState,
    managedStateClass,
} from "./support.js"

describe("state declarations", () => {
    it("uses managed records and Arrays and external classes by default", () => {
        class Value {}
        const record = {}
        const array = []
        const instance = new Value()

        new Chain(record)
        new Chain(array)
        new Chain(instance)

        expect(metadata.metaOf(record).type).to.be(languageValues.TYPE_RECORD)
        expect(metadata.metaOf(array).type).to.be(languageValues.TYPE_ARRAY)
        expect(metadata.metaOf(instance).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
    })

    it("declares exact records and Arrays external without walking them", () => {
        const child = {}
        const record = { child }
        const array = [child]

        expect(externalState(record)).to.be(record)
        expect(externalState(array)).to.be(array)
        expect(metadata.metaOf(record)).to.be(undefined)
        expect(metadata.metaOf(array)).to.be(undefined)
        expect(metadata.metaOf(child)).to.be(undefined)

        new Chain(record)
        new Chain(array)
        new Chain(child)
        expect(metadata.metaOf(record).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
        expect(metadata.metaOf(array).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
        expect(metadata.metaOf(child).type).to.be(languageValues.TYPE_RECORD)
        expect(metadata.identityDeclarationOf(record)).to.be(undefined)
        expect(metadata.identityDeclarationOf(array)).to.be(undefined)
    })

    it("declares every currently reachable class instance managed", () => {
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
        expect(metadata.metaOf(line)).to.be(undefined)
        expect(metadata.metaOf(point)).to.be(undefined)

        const chain = new Chain(line)
        expect(metadata.metaOf(line).type).to.be(
            languageValues.TYPE_MANAGED_CLASS,
        )
        expect(lookupPath(chain, ["start"])).to.be(point)
        expect(metadata.metaOf(point).type).to.be(
            languageValues.TYPE_MANAGED_CLASS,
        )
        expect(metadata.identityDeclarationOf(line)).to.be(undefined)
        expect(metadata.identityDeclarationOf(point)).to.be(undefined)

        const laterPoint = new Vec(2)
        new Chain(laterPoint)
        expect(metadata.metaOf(laterPoint).type).to.be(
            languageValues.TYPE_EXTERNAL,
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
        class Value {}
        expect(managedStateClass(Value)).to.be(undefined)

        const managed = new Value()
        const external = new Value()
        externalState(external)
        new Chain(managed)
        new Chain(external)

        expect(metadata.metaOf(managed).type).to.be(
            languageValues.TYPE_MANAGED_CLASS,
        )
        expect(metadata.metaOf(external).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
    })

    it("uses the prototype present when a declared identity is admitted", () => {
        class Original {}
        class Replacement {}
        const value = new Original()

        managedState(value)
        Object.setPrototypeOf(value, Replacement.prototype)
        new Chain(value)

        expect(metadata.metaOf(value).type).to.be(
            languageValues.TYPE_MANAGED_CLASS,
        )
        expect(metadata.metaOf(value).admittedPrototype).to.be(
            Replacement.prototype,
        )
    })

    it("makes import honor declarations and stop at external state", () => {
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
        new Chain(admittedExternal)
        const managed = managedState(new Managed(
            declaredExternal,
            admittedExternal,
        ))

        importValue({ managed })

        expect(metadata.metaOf(declaredExternal).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
        expect(metadata.metaOf(admittedExternal).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
        expect(metadata.metaOf(hidden)).to.be(undefined)
        expect(metadata.metaOf(managed).type).to.be(
            languageValues.TYPE_MANAGED_CLASS,
        )
        expect(metadata.metaOf(managed.child).type).to.be(
            languageValues.TYPE_RECORD,
        )
    })

    it("stops at nested uninspectable state", () => {
        const opaque = new Proxy({}, {
            getPrototypeOf() {
                throw new Error("uninspectable")
            },
        })
        const root = { opaque }

        expect(managedState(root)).to.be(root)
        expect(managedState(opaque).message).to.be(
            "managedState cannot declare this value managed because its " +
            "prototype could not be inspected",
        )

        new Chain(opaque)
        expect(metadata.metaOf(opaque).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
    })

    it("never reclassifies an admitted identity", () => {
        class Late {}
        const instance = new Late()
        new Chain(instance)
        managedStateClass(Late)

        expect(metadata.metaOf(instance).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
        expect(managedState(instance)).to.be.an(Error)

        const record = {}
        new Chain(record)
        expect(externalState(record)).to.be.an(Error)
        expect(metadata.metaOf(record).type).to.be(languageValues.TYPE_RECORD)
    })

    it("does not rescan an already admitted managed container", () => {
        class Candidate {}
        class ExistingExternal {}
        const candidate = new Candidate()
        const external = new ExistingExternal()
        const root = { candidate, external }

        new Chain(root)
        new Chain(external)
        expect(managedState(root)).to.be(root)

        new Chain(candidate)
        expect(metadata.metaOf(candidate).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
    })

    it("returns declaration conflicts without changing either declaration", () => {
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

        new Chain(managed)
        new Chain(external)
        expect(metadata.metaOf(managed).type).to.be(
            languageValues.TYPE_MANAGED_CLASS,
        )
        expect(metadata.metaOf(external).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
    })

    it("validates a managed declaration atomically", () => {
        class Child {}
        const pending = deferred()
        const thenable = { then() {} }
        const child = new Child()
        const root = { child, pending: pending.promise }

        expect(managedState(root)).to.be.an(Error)
        expect(managedState({ thenable })).to.be.an(Error)
        new Chain(child)
        expect(metadata.metaOf(child).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
    })

    it("samples thenability once before managed admission", () => {
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
        new Chain(value)

        expect(reads).to.be(1)
        expect(metadata.metaOf(value).type).to.be(
            languageValues.TYPE_MANAGED_CLASS,
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
        class First {}
        class Invalid {
            get value() {
                return 1
            }
        }
        class Last {}

        expect(managedStateClass(First, Invalid, Last)).to.be.a(TypeError)

        const first = new First()
        const last = new Last()
        new Chain(first)
        new Chain(last)
        expect(metadata.metaOf(first).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
        expect(metadata.metaOf(last).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
    })

    it("rejects callable non-constructors as managed classes", () => {
        const prototype = {}
        let prototypeReads = 0
        const NonConstructor = new Proxy(() => {}, {
            get(target, key, receiver) {
                if (key === "prototype") prototypeReads++
                return key === "prototype"
                    ? prototype
                    : Reflect.get(target, key, receiver)
            },
        })

        expect(managedStateClass(NonConstructor)).to.be.an(Error)
        expect(prototypeReads).to.be(0)

        const value = Object.create(prototype)
        new Chain(value)
        expect(metadata.metaOf(value).type).to.be(
            languageValues.TYPE_EXTERNAL,
        )
    })

    it("samples a managed class prototype once", () => {
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
        new Chain(value)
        expect(metadata.metaOf(value).type).to.be(
            languageValues.TYPE_MANAGED_CLASS,
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
