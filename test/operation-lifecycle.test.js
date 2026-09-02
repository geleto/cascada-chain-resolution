import { expect, testOperationContext } from "./support.js"
import * as operationLifecycle from "../src/operation-lifecycle.js"

describe("operation lifecycle", () => {
    it("releases only resources still registered when the owner closes", () => {
        const owner = new operationLifecycle.OperationOwner(
            testOperationContext(),
        )
        const released = []
        const unregister = operationLifecycle.registerRelease(
            owner,
            () => released.push("unregistered"),
        )
        operationLifecycle.registerRelease(
            owner,
            () => released.push("first"),
        )
        operationLifecycle.registerRelease(
            owner,
            () => released.push("second"),
        )

        unregister()
        operationLifecycle.close(owner)
        operationLifecycle.close(owner)
        operationLifecycle.registerRelease(
            owner,
            () => released.push("late"),
        )

        expect(released).to.eql(["first", "second", "late"])
        expect(owner.open).to.be(false)
    })
})
