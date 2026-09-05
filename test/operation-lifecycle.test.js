import {
    expect,
    flushMicrotasks,
    runtime,
    testOperationContext,
} from "./support.js"
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
        expect(owner.releases).to.be(undefined)
    })

    it("closes and releases every live result form", async () => {
        const poison = new runtime.PoisonError(
            "expected",
            "lifecycle test",
            runtime.ERROR_KIND.OperationInputRejected,
        )

        for (const value of ["ready", poison]) {
            const { owner, released } = trackedOwner()
            expect(operationLifecycle.closeWhenDone(owner, value)).to.be(value)
            expectClosedAndReleased(owner, released)
        }

        const fulfilled = trackedOwner()
        const fulfillment = Promise.resolve("fulfilled")
        const completed = operationLifecycle.closeWhenDone(fulfilled.owner, fulfillment)
        expect(await completed).to.be("fulfilled")
        await flushMicrotasks()
        expectClosedAndReleased(fulfilled.owner, fulfilled.released)

        const rejected = trackedOwner()
        const rejection = Promise.reject(poison)
        const failed = operationLifecycle.closeWhenDone(rejected.owner, rejection)
        expect(await failed.catch(error => error)).to.be(poison)
        await flushMicrotasks()
        expectClosedAndReleased(rejected.owner, rejected.released)
    })

    function trackedOwner() {
        const owner = new operationLifecycle.OperationOwner(
            testOperationContext(),
        )
        const released = []
        operationLifecycle.registerRelease(owner, () => released.push(true))
        return { owner, released }
    }

    function expectClosedAndReleased(owner, released) {
        expect(owner.open).to.be(false)
        expect(owner.releases).to.be(undefined)
        expect(released).to.eql([true])
    }
})
