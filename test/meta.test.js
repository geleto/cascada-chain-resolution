import { metaOf } from "../src/meta.js"
import { Execution } from "../src/index.js"
import { expect } from "./support.js"

describe("metadata", () => {
    it("looks up metadata without reflecting on the value", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("metadata lookup reflected")
        const value = new Proxy({}, {
            getOwnPropertyDescriptor() {
                throw failure
            },
            getPrototypeOf() {
                throw failure
            },
        })

        expect(metaOf(value, testContext)).to.be(undefined)
        for (const primitive of [
            null,
            undefined,
            1,
            "x",
            true,
            1n,
            Symbol("x"),
        ]) {
            expect(metaOf(primitive, testContext)).to.be(undefined)
        }
    })
})
