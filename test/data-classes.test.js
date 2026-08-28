import { runInNewContext } from "node:vm"

import {
    Chain,
    assignPath,
    buildRefIndex,
    deferred,
    expect,
    expectCounts,
    flushMicrotasks,
    importValue,
    lookupPath,
    readPath,
    managedStateClass,
    thrownBy,
    verifyRefCounts,
} from "./support.js"

describe("managed class copy-on-write", () => {
    it("declares only the exact prototype without modifying it", () => {
        class Base {
            constructor() {
                this.value = 1
            }
        }
        class Child extends Base {}
        const keys = Reflect.ownKeys(Base.prototype)

        managedStateClass(Base)

        expect(Reflect.ownKeys(Base.prototype)).to.eql(keys)
        const base = importValue(new Base(), "managed base")
        const baseChain = new Chain(base)
        assignPath(baseChain, ["value"], 2)
        expect(baseChain._state.value.value).to.be(2)
        expect(base.value).to.be(1)

        const child = importValue(new Child(), "external child")
        const childChain = new Chain(child)
        assignPath(childChain, ["value"], 2)
        expect(childChain._state.value instanceof Error).to.be(true)
        expect(child.value).to.be(1)
    })

    it("preserves independently declared inheritance and methods", () => {
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
        const source = importValue(new FVec3(2, 3, 4), "fvec import")
        const chain = new Chain(source)

        assignPath(chain, ["x"], 5)
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
        class Point {
            constructor(x, y) {
                this.x = x
                this.y = y
            }
        }
        managedStateClass(Point)
        const point = new Point(1, 2)
        const sibling = { stable: true }
        const root = importValue({ point, sibling }, "nested class")
        const chain = new Chain(root)

        assignPath(chain, ["point", "x"], 3)
        const copy = chain._state.value

        expect(copy).not.to.be(root)
        expect(copy.point).not.to.be(point)
        expect(copy.point instanceof Point).to.be(true)
        expect(copy.sibling).to.be(sibling)
        expect(point.x).to.be(1)
        expect(copy.point.x).to.be(3)
    })

    it("supports repeated copy-on-write through a runtime-created class copy", () => {
        class Point {
            constructor(x) {
                this.x = x
            }
        }
        managedStateClass(Point)
        const source = importValue(new Point(1), "repeated class")
        const chain = new Chain(source)

        assignPath(chain, ["x"], 2)
        const first = chain._state.value
        lookupPath(chain, [])
        assignPath(chain, ["x"], 3)
        const second = chain._state.value

        expect(first instanceof Point).to.be(true)
        expect(second instanceof Point).to.be(true)
        expect(source.x).to.be(1)
        expect(first.x).to.be(2)
        expect(second.x).to.be(3)
    })

    it("forks Promise fields through the unchanged mirror pipeline", async () => {
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
            "class Promise",
        )
        const chain = new Chain(source)

        assignPath(chain, ["x"], 2)
        const copy = chain._state.value
        pending.resolve({ done: true })
        await flushMicrotasks()

        expect(copy instanceof PendingPoint).to.be(true)
        const sourceValue = readPath(new Chain(source), ["pending"])
        const copyValue = readPath(new Chain(copy), ["pending"])
        expect(source.pending).to.be(pending.promise)
        expect(copy.pending).to.be(sourceValue)
        expect(sourceValue).to.eql({ done: true })
        expect(copyValue).to.be(sourceValue)

        assignPath(chain, ["pending", "done"], false)

        expect(sourceValue.done).to.be(true)
        expect(chain._state.value.pending.done).to.be(false)
        expect(sourceValue).not.to.be(chain._state.value.pending)
        verifyRefCounts(source, copy)
    })

    it("gives a reassigned same-Promise field a fresh fork on later COW", async () => {
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
            "same Promise class",
        )
        const chain = new Chain(source)

        assignPath(chain, ["pending"], pending.promise)
        const reassigned = chain._state.value
        lookupPath(chain, [])
        assignPath(chain, ["x"], 2)
        const fork = chain._state.value

        pending.resolve({ done: true })
        await flushMicrotasks()

        expect(readPath(new Chain(source), ["pending", "done"])).to.be(
            true,
        )
        expect(reassigned.pending.done).to.be(true)
        expect(readPath(new Chain(fork), ["pending", "done"])).to.be(
            true,
        )

        assignPath(chain, ["pending", "done"], false)

        expect(readPath(new Chain(source), ["pending", "done"])).to.be(
            true,
        )
        expect(reassigned.pending.done).to.be(true)
        expect(chain._state.value.pending.done).to.be(false)
        verifyRefCounts(source, reassigned, fork, chain._state.value)
    })

    it("preserves Error counts and verification on a class copy", () => {
        class Result {
            constructor() {
                this.error = new Error("bad")
                this.value = 1
            }
        }
        managedStateClass(Result)
        const source = importValue(new Result(), "class Error")
        buildRefIndex(source)
        const chain = new Chain(source)

        assignPath(chain, ["value"], 2)
        const copy = chain._state.value

        expect(copy instanceof Result).to.be(true)
        expect(copy.error).to.be(source.error)
        expectCounts(source, 0, 1)
        expectCounts(copy, 0, 1)
        verifyRefCounts(source, copy)
    })

    it("preserves path-copy cycle semantics for managed classes", () => {
        class Cyclic {
            constructor() {
                this.value = 1
                this.self = this
            }
        }
        managedStateClass(Cyclic)
        const source = importValue(new Cyclic(), "class cycle")
        const chain = new Chain(source)

        assignPath(chain, ["value"], 2)
        const copy = chain._state.value

        expect(copy instanceof Cyclic).to.be(true)
        expect(copy.self).to.be(source)
        expect(source.value).to.be(1)
        expect(copy.value).to.be(2)
        verifyRefCounts(source, copy)
    })

    it("preserves aliases while copying only the mutated class path", () => {
        class Point {
            constructor(x) {
                this.x = x
            }
        }
        managedStateClass(Point)
        const point = new Point(1)
        const root = importValue(
            { left: point, right: point },
            "class alias",
        )
        const chain = new Chain(root)

        assignPath(chain, ["left", "x"], 2)
        const copy = chain._state.value

        expect(copy.left).not.to.be(point)
        expect(copy.left instanceof Point).to.be(true)
        expect(copy.left.x).to.be(2)
        expect(copy.right).to.be(point)
        expect(copy.right.x).to.be(1)
        verifyRefCounts(root, copy)
    })

    it("copies enumerable special-name fields as ordinary data", () => {
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
            "special fields",
        )
        const chain = new Chain(source)

        assignPath(chain, ["value"], 2)
        const copy = chain._state.value

        expect(Object.getPrototypeOf(copy)).to.be(SpecialFields.prototype)
        expect(copy.__proto__).to.be("data prototype")
        expect(copy.constructor).to.be("data constructor")
        expect(copy.method).to.be("data method")
        expect(copy.value).to.be(2)
    })

    it("preserves a record's admitted null prototype", () => {
        const source = Object.create(null)
        source.value = 1
        new Chain(source)
        Object.setPrototypeOf(source, Object.prototype)
        importValue(source, "null prototype")
        const chain = new Chain(source)

        assignPath(chain, ["value"], 2)
        const copy = chain._state.value

        expect(copy).not.to.be(source)
        expect(Object.getPrototypeOf(copy)).to.be(null)
        expect(Object.getPrototypeOf(source)).to.be(Object.prototype)
        expect(source.value).to.be(1)
        expect(copy.value).to.be(2)
    })

    it("leaves base and sparse arrays on the existing array path", () => {
        const source = new Array(3)
        source[1] = { value: 1 }
        importValue(source, "base array")
        const chain = new Chain(source)

        assignPath(chain, ["1", "value"], 2)
        const copy = chain._state.value

        expect(Array.isArray(copy)).to.be(true)
        expect(Object.getPrototypeOf(copy)).to.be(Array.prototype)
        expect(copy.length).to.be(3)
        expect(0 in copy).to.be(false)
        expect(source[1].value).to.be(1)
        expect(copy[1].value).to.be(2)
    })

    it("preserves cross-realm record prototypes and base-array support", () => {
        const foreignObject = runInNewContext("({ value: 1 })")
        const foreignPrototype = Object.getPrototypeOf(foreignObject)
        const objectChain = new Chain(importValue(
            foreignObject,
            "foreign object",
        ))

        assignPath(objectChain, ["value"], 2)

        expect(objectChain._state.value).to.eql({ value: 2 })
        expect(Object.getPrototypeOf(objectChain._state.value)).to.be(
            foreignPrototype,
        )
        expect(foreignObject.value).to.be(1)

        const foreignArray = runInNewContext("[{ value: 1 }]")
        const arrayChain = new Chain(importValue(
            foreignArray,
            "foreign array",
        ))

        assignPath(arrayChain, ["0", "value"], 2)

        expect(Array.isArray(arrayChain._state.value)).to.be(true)
        expect(Object.getPrototypeOf(arrayChain._state.value)).to.be(
            Array.prototype,
        )
        expect(arrayChain._state.value[0].value).to.be(2)
        expect(foreignArray[0].value).to.be(1)
    })

    it("treats an external root as a graph leaf", () => {
        class External {
            constructor() {
                this.value = 1
            }
        }
        const source = importValue(new External(), "external root")
        const chain = new Chain(source)

        assignPath(chain, ["value"], 2)
        const failure = chain._state.value

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(source.value).to.be(1)
    })

    it("treats a nested external instance as a graph leaf", () => {
        class External {
            constructor() {
                this.value = 1
            }
        }
        const source = new External()
        const root = importValue(
            { branch: source, sibling: true },
            "nested external",
        )
        buildRefIndex(root)
        const chain = new Chain(root)

        assignPath(chain, ["branch", "value"], 2)
        const copy = chain._state.value

        expect(copy).not.to.be(root)
        expect(copy.branch instanceof Error).to.be(true)
        expect(copy.branch.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(copy.sibling).to.be(true)
        expect(source.value).to.be(1)
        expectCounts(root, 0, 0)
        expectCounts(copy, 0, 1)
        verifyRefCounts(root, copy)
    })

    it("treats an external instance behind a Promise as a graph leaf", async () => {
        class External {
            constructor() {
                this.value = 1
            }
        }
        const pending = deferred()
        const root = importValue(
            { branch: pending.promise },
            "external Promise",
        )
        const chain = new Chain(root)

        assignPath(chain, ["branch", "value"], 2)
        const source = new External()
        pending.resolve(source)
        await flushMicrotasks()
        const failure = chain._state.value.branch

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(source.value).to.be(1)
    })

    it("does not emulate internal slots for a managed subclass", () => {
        class FalseDate extends Date {}
        managedStateClass(FalseDate)
        const source = new FalseDate(0)
        source.value = 1
        const chain = new Chain(importValue(
            source,
            "managed Date subclass",
        ))

        assignPath(chain, ["value"], 2)
        const copy = chain._state.value

        expect(copy instanceof FalseDate).to.be(true)
        expect(copy.value).to.be(2)
        expect(thrownBy(() => copy.getTime()) instanceof TypeError).to.be(
            true,
        )
    })

    it("normalizes managed and external array subclasses", () => {
        class ExternalList extends Array {}
        class ManagedList extends Array {}
        managedStateClass(ManagedList)

        for (const List of [ExternalList, ManagedList]) {
            const source = importValue(
                new List({ value: 1 }),
                "array subclass",
            )
            const chain = new Chain(source)

            assignPath(chain, ["0", "value"], 2)

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
        class Unsupported {
            constructor() {
                this.value = 1
            }
        }
        const source = new Unsupported()
        const chain = new Chain(source)
        lookupPath(chain, [])

        assignPath(chain, ["value"], 2)
        const failure = chain._state.value

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(source.value).to.be(1)
    })

    it("imports a value with uninspectable type as external", () => {
        const source = new Proxy({ value: 1 }, {
            getPrototypeOf() {
                throw new Error("reflection trap")
            },
        })
        const result = importValue(source, "proxy prototype")

        expect(result).to.be(source)
        expect(source.value).to.be(1)
    })
})
