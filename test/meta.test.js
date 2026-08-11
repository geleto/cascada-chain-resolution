import {
    expect,
    metaOf,
} from "./support.js"

describe("metadata", () => {
    it("looks up metadata without reflecting on the value", () => {
        const failure = new Error("metadata lookup reflected")
        const value = new Proxy({}, {
            getOwnPropertyDescriptor() {
                throw failure
            },
            getPrototypeOf() {
                throw failure
            },
        })

        expect(metaOf(value)).to.be(undefined)
        for (const primitive of [
            null,
            undefined,
            1,
            "x",
            true,
            1n,
            Symbol("x"),
        ]) {
            expect(metaOf(primitive)).to.be(undefined)
        }
    })
})
