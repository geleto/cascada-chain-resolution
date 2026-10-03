import * as runtime from "../src/index.js"
import { Chain, assignPath, import as importValue, lookupPath, managedStateClass, Execution } from "../src/index.js"
import { buildRefIndex } from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { runInNewContext } from "node:vm"

import { deferred, errorCause, expect, flushMicrotasks, readPath, thrownBy } from "./support.js"

describe("managed class copy-on-write", () => {
    it("declares only the exact prototype without modifying it", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Base {
            constructor() {
                this.value = 1
            }
        }
        class Child extends Base {}
        const keys = Reflect.ownKeys(Base.prototype)

        managedStateClass(Base)

        expect(Reflect.ownKeys(Base.prototype)).to.eql(keys)
        const base = importValue(new Base(), { ...testContext, errorContext: "managed base" })
        const baseChain = new Chain(base, testContext)
        assignPath(baseChain, ["value"], 2, testContext)
        expect(baseChain._state.value.value).to.be(2)
        expect(base.value).to.be(1)

        const child = importValue(new Child(), { ...testContext, errorContext: "external child" })
        const childChain = new Chain(child, testContext)
        assignPath(childChain, ["value"], 2, testContext)
        expect(childChain._state.value instanceof Error).to.be(true)
        expect(child.value).to.be(1)
    })

    it("preserves independently declared inheritance and methods", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Vec2 {
            constructor(x, y) {
                this.x = x
                this.y = y
            }

            dimensions() {
                return 2
            }
        }
        class Vec3 extends Vec2 {
            constructor(x, y, z) {
                super(x, y)
                this.z = z
            }

            dimensions() {
                return super.dimensions() + 1
            }
        }
        class FVec3 extends Vec3 {
            constructor(x, y, z) {
                super(x, y, z)
                this.precision = "float"
            }

            volume() {
                return this.x * this.y * this.z
            }
        }
        managedStateClass(Vec2)
        managedStateClass(Vec3)
        managedStateClass(FVec3)
        const source = importValue(new FVec3(2, 3, 4), { ...testContext, errorContext: "fvec import" })
        const chain = new Chain(source, testContext)

        assignPath(chain, ["x"], 5, testContext)
        const copy = chain._state.value

        expect(copy).not.to.be(source)
        expect(copy instanceof FVec3).to.be(true)
        expect(copy instanceof Vec3).to.be(true)
        expect(copy instanceof Vec2).to.be(true)
        expect(Object.getPrototypeOf(copy)).to.be(FVec3.prototype)
        expect(copy.dimensions()).to.be(3)
        expect(copy.volume()).to.be(60)
        expect(copy.precision).to.be("float")
        expect(source.x).to.be(2)
        expect(copy.x).to.be(5)
    })

    it("copies only the nested class path and preserves ordinary siblings", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Point {
            constructor(x, y) {
                this.x = x
                this.y = y
            }
        }
        managedStateClass(Point)
        const point = new Point(1, 2)
        const sibling = { stable: true }
        const root = importValue({ point, sibling }, { ...testContext, errorContext: "nested class" })
        const chain = new Chain(root, testContext)

        assignPath(chain, ["point", "x"], 3, testContext)
        const copy = chain._state.value

        expect(copy).not.to.be(root)
        expect(copy.point).not.to.be(point)
        expect(copy.point instanceof Point).to.be(true)
        expect(copy.sibling).to.be(sibling)
        expect(point.x).to.be(1)
        expect(copy.point.x).to.be(3)
    })

    it("supports repeated copy-on-write through a runtime-created class copy", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Point {
            constructor(x) {
                this.x = x
            }
        }
        managedStateClass(Point)
        const source = importValue(new Point(1), { ...testContext, errorContext: "repeated class" })
        const chain = new Chain(source, testContext)

        assignPath(chain, ["x"], 2, testContext)
        const first = chain._state.value
        const retained = new Chain(lookupPath(chain, [], testContext), testContext)
        assignPath(chain, ["x"], 3, testContext)
        const second = chain._state.value

        expect(first instanceof Point).to.be(true)
        expect(second instanceof Point).to.be(true)
        expect(source.x).to.be(1)
        expect(first.x).to.be(2)
        expect(retained._state.value).to.be(first)
        expect(second.x).to.be(3)
    })

    it("forks Promise fields through the unchanged Promise version pipeline", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class PendingPoint {
            constructor(pending) {
                this.pending = pending
                this.x = 1
            }
        }
        managedStateClass(PendingPoint)
        const pending = deferred()
        const source = importValue(
            new PendingPoint(pending.promise),
            { ...testContext, errorContext: "class Promise" },
        )
        const chain = new Chain(source, testContext)

        assignPath(chain, ["x"], 2, testContext)
        const copy = chain._state.value
        pending.resolve({ done: true })
        await flushMicrotasks()

        expect(copy instanceof PendingPoint).to.be(true)
        const sourceValue = readPath(new Chain(source, testContext), ["pending"], testContext)
        const copyValue = readPath(new Chain(copy, testContext), ["pending"], testContext)
        expect(source.pending).to.be(pending.promise)
        expect(copy.pending).to.be(sourceValue)
        expect(sourceValue).to.eql({ done: true })
        expect(copyValue).to.be(sourceValue)

        assignPath(chain, ["pending", "done"], false, testContext)

        expect(sourceValue.done).to.be(true)
        expect(chain._state.value.pending.done).to.be(false)
        expect(sourceValue).not.to.be(chain._state.value.pending)
        verifyRefCounts(testContext, source, copy)
    })

    it("gives a reassigned same-Promise field a fresh fork on later COW", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class PendingPoint {
            constructor(pending) {
                this.pending = pending
                this.x = 1
            }
        }
        managedStateClass(PendingPoint)
        const pending = deferred()
        const source = importValue(
            new PendingPoint(pending.promise),
            { ...testContext, errorContext: "same Promise class" },
        )
        const chain = new Chain(source, testContext)

        assignPath(chain, ["pending"], pending.promise, testContext)
        const reassigned = chain._state.value
        lookupPath(chain, [], testContext)
        assignPath(chain, ["x"], 2, testContext)
        const fork = chain._state.value

        pending.resolve({ done: true })
        await flushMicrotasks()

        expect(readPath(new Chain(source, testContext), ["pending", "done"], testContext)).to.be(
            true,
        )
        expect(reassigned.pending.done).to.be(true)
        expect(readPath(new Chain(fork, testContext), ["pending", "done"], testContext)).to.be(
            true,
        )

        assignPath(chain, ["pending", "done"], false, testContext)

        expect(readPath(new Chain(source, testContext), ["pending", "done"], testContext)).to.be(
            true,
        )
        expect(reassigned.pending.done).to.be(true)
        expect(chain._state.value.pending.done).to.be(false)
        verifyRefCounts(testContext, source, reassigned, fork, chain._state.value)
    })

    it("preserves Errors and index consistency on a class copy", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Result {
            constructor() {
                this.error = new Error("bad")
                this.value = 1
            }
        }
        managedStateClass(Result)
        const source = importValue(new Result(), { ...testContext, errorContext: "class Error" })
        buildRefIndex(source, testContext)
        const chain = new Chain(source, testContext)

        assignPath(chain, ["value"], 2, testContext)
        const copy = chain._state.value

        expect(copy instanceof Result).to.be(true)
        expect(errorCause(copy.error)).to.be(source.error)
        verifyRefCounts(testContext, source, copy)
    })

    it("preserves path-copy cycle semantics for managed classes", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Cyclic {
            constructor() {
                this.value = 1
                this.self = this
            }
        }
        managedStateClass(Cyclic)
        const source = importValue(new Cyclic(), { ...testContext, errorContext: "class cycle" })
        const chain = new Chain(source, testContext)

        assignPath(chain, ["value"], 2, testContext)
        const copy = chain._state.value

        expect(copy instanceof Cyclic).to.be(true)
        expect(copy.self).to.be(source)
        expect(source.value).to.be(1)
        expect(copy.value).to.be(2)
        verifyRefCounts(testContext, source, copy)
    })

    it("preserves aliases while copying only the mutated class path", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Point {
            constructor(x) {
                this.x = x
            }
        }
        managedStateClass(Point)
        const point = new Point(1)
        const root = importValue(
            { left: point, right: point },
            { ...testContext, errorContext: "class alias" },
        )
        const chain = new Chain(root, testContext)

        assignPath(chain, ["left", "x"], 2, testContext)
        const copy = chain._state.value

        expect(copy.left).not.to.be(point)
        expect(copy.left instanceof Point).to.be(true)
        expect(copy.left.x).to.be(2)
        expect(copy.right).to.be(point)
        expect(copy.right.x).to.be(1)
        verifyRefCounts(testContext, root, copy)
    })

    it("copies enumerable special-name fields as ordinary data", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class SpecialFields {
            constructor() {
                Object.defineProperty(this, "__proto__", {
                    value: "data prototype",
                    enumerable: true,
                    writable: true,
                    configurable: true,
                })
                this.constructor = "data constructor"
                this.method = "data method"
                this.value = 1
            }
        }
        managedStateClass(SpecialFields)
        const source = importValue(
            new SpecialFields(),
            { ...testContext, errorContext: "special fields" },
        )
        const chain = new Chain(source, testContext)

        assignPath(chain, ["value"], 2, testContext)
        const copy = chain._state.value

        expect(Object.getPrototypeOf(copy)).to.be(SpecialFields.prototype)
        expect(copy.__proto__).to.be("data prototype")
        expect(copy.constructor).to.be("data constructor")
        expect(copy.method).to.be("data method")
        expect(copy.value).to.be(2)
    })

    it("preserves a record's admitted null prototype", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = Object.create(null)
        source.value = 1
        new Chain(source, testContext)
        importValue(source, { ...testContext, errorContext: "null prototype" })
        const chain = new Chain(source, testContext)

        assignPath(chain, ["value"], 2, testContext)
        const copy = chain._state.value

        expect(copy).not.to.be(source)
        expect(Object.getPrototypeOf(copy)).to.be(null)
        expect(Object.getPrototypeOf(source)).to.be(null)
        expect(source.value).to.be(1)
        expect(copy.value).to.be(2)
    })

    it("leaves base and sparse arrays on the existing array path", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = new Array(3)
        source[1] = { value: 1 }
        importValue(source, { ...testContext, errorContext: "base array" })
        const chain = new Chain(source, testContext)

        assignPath(chain, ["1", "value"], 2, testContext)
        const copy = chain._state.value

        expect(Array.isArray(copy)).to.be(true)
        expect(Object.getPrototypeOf(copy)).to.be(Array.prototype)
        expect(copy.length).to.be(3)
        expect(0 in copy).to.be(false)
        expect(source[1].value).to.be(1)
        expect(copy[1].value).to.be(2)
    })

    it("preserves cross-realm record prototypes and base-array support", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const foreignObject = runInNewContext("({ value: 1 })")
        const foreignPrototype = Object.getPrototypeOf(foreignObject)
        const objectChain = new Chain(importValue(
            foreignObject,
            { ...testContext, errorContext: "foreign object" },
        ), testContext)

        assignPath(objectChain, ["value"], 2, testContext)

        expect(objectChain._state.value).to.eql({ value: 2 })
        expect(Object.getPrototypeOf(objectChain._state.value)).to.be(
            foreignPrototype,
        )
        expect(foreignObject.value).to.be(1)

        const foreignArray = runInNewContext("[{ value: 1 }]")
        const arrayChain = new Chain(importValue(
            foreignArray,
            { ...testContext, errorContext: "foreign array" },
        ), testContext)

        assignPath(arrayChain, ["0", "value"], 2, testContext)

        expect(Array.isArray(arrayChain._state.value)).to.be(true)
        expect(Object.getPrototypeOf(arrayChain._state.value)).to.be(
            Array.prototype,
        )
        expect(arrayChain._state.value[0].value).to.be(2)
        expect(foreignArray[0].value).to.be(1)
    })

    it("treats an external root as a graph leaf", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class External {
            constructor() {
                this.value = 1
            }
        }
        const source = importValue(new External(), { ...testContext, errorContext: "external root" })
        const chain = new Chain(source, testContext)

        assignPath(chain, ["value"], 2, testContext)
        const failure = chain._state.value

        expect(failure instanceof Error).to.be(true)
        expect(failure.kind).to.be(runtime.ERROR_KIND.ExternalLocationConflict)
        expect(source.value).to.be(1)
    })

    it("treats a nested external instance as a graph leaf", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class External {
            constructor() {
                this.value = 1
            }
        }
        const source = new External()
        const root = importValue(
            { branch: source, sibling: true },
            { ...testContext, errorContext: "nested external" },
        )
        buildRefIndex(root, testContext)
        const chain = new Chain(root, testContext)

        assignPath(chain, ["branch", "value"], 2, testContext)
        const copy = chain._state.value

        expect(copy).not.to.be(root)
        expect(copy.branch instanceof Error).to.be(true)
        expect(copy.branch.kind).to.be(runtime.ERROR_KIND.ExternalLocationConflict)
        expect(copy.sibling).to.be(true)
        expect(source.value).to.be(1)
        verifyRefCounts(testContext, root, copy)
    })

    it("treats an external instance behind a Promise as a graph leaf", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class External {
            constructor() {
                this.value = 1
            }
        }
        const pending = deferred()
        const root = importValue(
            { branch: pending.promise },
            { ...testContext, errorContext: "external Promise" },
        )
        const chain = new Chain(root, testContext)

        assignPath(chain, ["branch", "value"], 2, testContext)
        const source = new External()
        pending.resolve(source)
        await flushMicrotasks()
        const failure = chain._state.value.branch

        expect(failure instanceof Error).to.be(true)
        expect(failure.kind).to.be(runtime.ERROR_KIND.ExternalLocationConflict)
        expect(source.value).to.be(1)
    })

    it("does not emulate internal slots for a managed subclass", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class FalseDate extends Date {}
        managedStateClass(FalseDate)
        const source = new FalseDate(0)
        source.value = 1
        const chain = new Chain(importValue(
            source,
            { ...testContext, errorContext: "managed Date subclass" },
        ), testContext)

        assignPath(chain, ["value"], 2, testContext)
        const copy = chain._state.value

        expect(copy instanceof FalseDate).to.be(true)
        expect(copy.value).to.be(2)
        expect(thrownBy(() => copy.getTime()) instanceof TypeError).to.be(
            true,
        )
    })

    it("normalizes managed and external array subclasses", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class ExternalList extends Array {}
        class ManagedList extends Array {}
        managedStateClass(ManagedList)

        for (const List of [ExternalList, ManagedList]) {
            const source = importValue(
                new List({ value: 1 }),
                { ...testContext, errorContext: "array subclass" },
            )
            const chain = new Chain(source, testContext)

            assignPath(chain, ["0", "value"], 2, testContext)

            expect(Array.isArray(chain._state.value)).to.be(true)
            expect(Object.getPrototypeOf(chain._state.value)).to.be(
                Array.prototype,
            )
            expect(chain._state.value instanceof List).to.be(false)
            expect(chain._state.value[0].value).to.be(2)
            expect(source[0].value).to.be(1)
        }
    })

    it("does not traverse a shared external class", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Unsupported {
            constructor() {
                this.value = 1
            }
        }
        const source = new Unsupported()
        const chain = new Chain(source, testContext)
        lookupPath(chain, [], testContext)

        assignPath(chain, ["value"], 2, testContext)
        const failure = chain._state.value

        expect(failure instanceof Error).to.be(true)
        expect(failure.kind).to.be(runtime.ERROR_KIND.ExternalLocationConflict)
        expect(source.value).to.be(1)
    })

    it("imports a value with uninspectable type as external", () => {
        const source = new Proxy({ value: 1 }, {
            getPrototypeOf() {
                throw new Error("reflection trap")
            },
        })
        const result = importValue(source, { execution: new Execution(), errorContext: "proxy prototype" })

        expect(result).to.be(source)
        expect(source.value).to.be(1)
    })
})
