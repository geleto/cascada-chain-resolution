import { runInNewContext } from "node:vm"

import {
    Chain,
    PROPERTY_STATE_CLASS,
    assignPath,
    buildRefIndex,
    deferred,
    expect,
    expectCounts,
    flushMicrotasks,
    importValue,
    lookupPath,
    thrownBy,
    verifyRefCounts,
} from "./support.js"

function certify(prototype, value) {
    Object.defineProperty(prototype, PROPERTY_STATE_CLASS, {
        value: arguments.length === 1 ? true : value,
        configurable: true,
    })
}

describe("property-state class copy-on-write", () => {
    it("preserves independently certified inheritance and methods", () => {
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
        certify(Vec2.prototype)
        certify(Vec3.prototype)
        certify(FVec3.prototype)
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
        certify(Point.prototype)
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
        certify(Point.prototype)
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
        certify(PendingPoint.prototype)
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
        expect(source.pending).to.eql({ done: true })
        expect(copy.pending).to.eql({ done: true })
        expect(source.pending).to.be(copy.pending)

        assignPath(chain, ["pending", "done"], false)

        expect(source.pending.done).to.be(true)
        expect(chain._state.value.pending.done).to.be(false)
        expect(source.pending).not.to.be(chain._state.value.pending)
        verifyRefCounts(source, copy)
    })

    it("gives a reassigned same-Promise field a fresh fork on later COW", async () => {
        class PendingPoint {
            constructor(pending) {
                this.pending = pending
                this.x = 1
            }
        }
        certify(PendingPoint.prototype)
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

        expect(source.pending.done).to.be(true)
        expect(reassigned.pending.done).to.be(true)
        expect(fork.pending.done).to.be(true)

        assignPath(chain, ["pending", "done"], false)

        expect(source.pending.done).to.be(true)
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
        certify(Result.prototype)
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

    it("preserves path-copy cycle semantics for certified classes", () => {
        class Cyclic {
            constructor() {
                this.value = 1
                this.self = this
            }
        }
        certify(Cyclic.prototype)
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
        certify(Point.prototype)
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
        certify(SpecialFields.prototype)
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

    it("preserves null-prototype records", () => {
        const source = Object.create(null)
        source.value = 1
        importValue(source, "null prototype")
        const chain = new Chain(source)

        assignPath(chain, ["value"], 2)
        const copy = chain._state.value

        expect(copy).not.to.be(source)
        expect(Object.getPrototypeOf(copy)).to.be(null)
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

    it("preserves cross-realm plain-object and base-array support", () => {
        const foreignObject = runInNewContext("({ value: 1 })")
        const objectChain = new Chain(importValue(
            foreignObject,
            "foreign object",
        ))

        assignPath(objectChain, ["value"], 2)

        expect(objectChain._state.value).to.eql({ value: 2 })
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

    it("places an attributed Error at an unsupported root", () => {
        class Unmarked {
            constructor() {
                this.value = 1
            }
        }
        const source = importValue(new Unmarked(), "unsupported root")
        const chain = new Chain(source)

        assignPath(chain, ["value"], 2)
        const failure = chain._state.value

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Cannot copy unsupported object during copy-on-write " +
            "(imported at: unsupported root)",
        )
        expect(source.value).to.be(1)
    })

    it("places an attributed Error at an unsupported nested placement", () => {
        class Unmarked {
            constructor() {
                this.value = 1
            }
        }
        const source = new Unmarked()
        const root = importValue(
            { branch: source, sibling: true },
            "unsupported nested",
        )
        buildRefIndex(root)
        const chain = new Chain(root)

        assignPath(chain, ["branch", "value"], 2)
        const copy = chain._state.value

        expect(copy).not.to.be(root)
        expect(copy.branch instanceof Error).to.be(true)
        expect(copy.branch.message).to.be(
            "Cannot copy unsupported object during copy-on-write " +
            "(imported at: unsupported nested)",
        )
        expect(copy.sibling).to.be(true)
        expect(source.value).to.be(1)
        expectCounts(root, 0, 0)
        expectCounts(copy, 0, 1)
        verifyRefCounts(root, copy)
    })

    it("places an attributed Error when unsupported COW resumes behind a Promise", async () => {
        class Unmarked {
            constructor() {
                this.value = 1
            }
        }
        const pending = deferred()
        const root = importValue(
            { branch: pending.promise },
            "unsupported Promise",
        )
        const chain = new Chain(root)

        assignPath(chain, ["branch", "value"], 2)
        const source = new Unmarked()
        pending.resolve(source)
        await flushMicrotasks()
        const failure = chain._state.value.branch

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be(
            "Cannot copy unsupported object during copy-on-write " +
            "(imported at: unsupported Promise)",
        )
        expect(source.value).to.be(1)
    })

    it("treats every non-true certification shape as unsupported", () => {
        for (const marker of [false, undefined, "true", 1]) {
            class Invalid {
                constructor() {
                    this.value = 1
                }
            }
            certify(Invalid.prototype, marker)
            const source = importValue(
                new Invalid(),
                `marker ${String(marker)}`,
            )
            const chain = new Chain(source)

            assignPath(chain, ["value"], 2)

            expect(chain._state.value instanceof Error).to.be(true)
            expect(source.value).to.be(1)
        }

        class AccessorMarker {
            constructor() {
                this.value = 1
            }
        }
        Object.defineProperty(
            AccessorMarker.prototype,
            PROPERTY_STATE_CLASS,
            { get: () => true },
        )
        const source = importValue(
            new AccessorMarker(),
            "accessor marker",
        )
        const chain = new Chain(source)

        assignPath(chain, ["value"], 2)

        expect(chain._state.value instanceof Error).to.be(true)
        expect(source.value).to.be(1)
    })

    it("reclassifies certification when COW is later required", () => {
        class MutableCertification {
            constructor() {
                this.value = 1
            }
        }
        certify(MutableCertification.prototype)
        const source = importValue(
            new MutableCertification(),
            "changed certification",
        )
        const chain = new Chain(source)
        delete MutableCertification.prototype[PROPERTY_STATE_CLASS]

        assignPath(chain, ["value"], 2)

        expect(chain._state.value instanceof Error).to.be(true)
        expect(source.value).to.be(1)
    })

    it("does not pretend to detect falsely certified internal slots", () => {
        const previous = Object.getOwnPropertyDescriptor(
            Date.prototype,
            PROPERTY_STATE_CLASS,
        )
        certify(Date.prototype)
        try {
            const source = new Date(0)
            source.value = 1
            const chain = new Chain(importValue(
                source,
                "false Date certification",
            ))

            assignPath(chain, ["value"], 2)
            const copy = chain._state.value

            expect(copy instanceof Date).to.be(true)
            expect(copy.value).to.be(2)
            expect(thrownBy(() => copy.getTime()) instanceof TypeError).to.be(
                true,
            )
        } finally {
            if (previous) {
                Object.defineProperty(
                    Date.prototype,
                    PROPERTY_STATE_CLASS,
                    previous,
                )
            } else {
                delete Date.prototype[PROPERTY_STATE_CLASS]
            }
        }
    })

    it("normalizes marked and unmarked array subclasses to arrays", () => {
        class List extends Array {}

        for (const marked of [false, true]) {
            if (marked) certify(List.prototype)
            else delete List.prototype[PROPERTY_STATE_CLASS]
            const source = importValue(
                new List({ value: 1 }),
                `array subclass ${marked}`,
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

    it("places an unattributed Error for an unsupported shared class", () => {
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
            "Cannot copy unsupported object during copy-on-write",
        )
        expect(source.value).to.be(1)
    })

    it("reports reflection traps as fatal", () => {
        const prototype = new Proxy({}, {
            getOwnPropertyDescriptor() {
                throw new Error("reflection trap")
            },
        })
        const source = Object.create(prototype)
        source.value = 1
        const chain = new Chain(importValue(source, "proxy prototype"))

        const failure = thrownBy(() => {
            assignPath(chain, ["value"], 2)
        })

        expect(failure.message).to.be("reflection trap")
        expect(chain._state.value).to.be(source)
        expect(source.value).to.be(1)
    })
})
