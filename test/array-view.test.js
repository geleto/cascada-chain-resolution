import * as arrayViews from "../src/array-view.js"
import {
    Chain,
    deferred,
    expect,
    exportValue,
    run,
    verifyRefCounts,
} from "./support.js"

describe("ArrayView", () => {
    it("keeps representation fields outside the language surface", () => {
        const source = [1, 2]
        Object.defineProperty(source, "hidden", {
            value: 3,
            enumerable: false,
            writable: true,
            configurable: true,
        })
        const view = run(new Chain(source), [], "push", false, 3)

        expect(arrayViews.isArrayView(view)).to.be(true)
        expect(Object.getOwnPropertyNames(view)).to.eql([
            "_array",
            "_start",
            "_end",
        ])
        for (const key of Object.getOwnPropertyNames(view)) {
            expect(Object.getOwnPropertyDescriptor(
                view,
                key,
            ).enumerable).to.be(false)
        }
        expect(view.keys()).to.eql([
            "0",
            "1",
            "2",
        ])
        expect(view.has("hidden")).to.be(false)
        expect(view.descriptor("hidden").enumerable).to.be(false)
        expect([...view]).to.eql([1, 2, 3])
    })

    it("uses an attached projection when iterating the source identity", () => {
        const source = [1, , 3]
        const view = run(new Chain(source), [], "push", false, 4)

        expect(arrayViews.isArrayView(
            arrayViews.projectionOf(source),
        )).to.be(true)
        expect([
            ...arrayViews.projectionOf(source),
        ]).to.eql([1, undefined, 3])
        expect([...view]).to.eql([1, undefined, 3, 4])
        expect(exportValue(new Chain(source), [])).to.eql([1, , 3])
    })

    it("falls back without attaching when retained Promises overlap", () => {
        const pending = deferred()
        const source = [pending.promise, 2]
        const result = run(new Chain(source), [], "push", false, 3)

        expect(Array.isArray(result)).to.be(true)
        expect(arrayViews.projectionOf(source)).to.be(source)
        pending.resolve(1)
    })

    it("allows an endpoint Promise that belongs only to one identity", async () => {
        const pending = deferred()
        const source = [1]
        const extended = run(
            new Chain(source),
            [],
            "push",
            false,
            pending.promise,
        )
        const contracted = run(
            new Chain(extended),
            [],
            "pop",
            false,
        )

        expect(arrayViews.isArrayView(extended)).to.be(true)
        expect([...contracted]).to.eql([1])
        pending.resolve(2)
        expect(await exportValue(new Chain(extended), [])).to.eql([1, 2])
        expect(exportValue(new Chain(contracted), [])).to.eql([1])
        verifyRefCounts(extended)
        verifyRefCounts(contracted)
    })

    it("materializes non-extensible sources", () => {
        const source = Object.preventExtensions([1, 2])
        const result = run(new Chain(source), [], "push", false, 3)

        expect(Array.isArray(result)).to.be(true)
        expect(result).to.eql([1, 2, 3])
        expect(arrayViews.projectionOf(source)).to.be(source)
        expect(source).to.eql([1, 2])
    })
})
