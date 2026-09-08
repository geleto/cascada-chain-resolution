import assert from "node:assert/strict"
import {
    OperationOwner,
    close,
    releaseOnClose,
} from "../src/operation-lifecycle.js"
import {
    collectInputs,
    continueOperation,
} from "../src/internal-step.js"
import { createPoisonError, ERROR_KIND } from "../src/error.js"
import { returnOperationResult, isFatalError } from "cascada-chain-resolution"
import { testOperationContext, deferred, flushMicrotasks } from "./support.js"

describe("operation lifecycle", () => {
    it("treats rejection of a normalized input as an internal failure", async () => {
        const ctx = testOperationContext()
        const source = deferred()
        const error = createPoisonError(new Error("unexpected rejection"), ctx, ERROR_KIND.OperationInputFailed)
        const result = returnOperationResult(ctx, collectInputs(
            [source.promise], ctx, () => assert.fail("rejection is not a collected value"),
        ))
        source.reject(error)
        await assert.rejects(result, failure => isFatalError(failure) && failure.cause === error)
    })
    it("closes operation resources and registered releases through either entry once", () => {
        const released = []
        class Owner extends OperationOwner {
            release() {
                released.push("resources")
            }
        }
        const owner = new Owner(testOperationContext())
        const unregister = releaseOnClose(owner, () => released.push("removed"))
        releaseOnClose(owner, () => released.push("registered"))
        unregister()
        owner.close()
        close(owner)
        releaseOnClose(owner, () => released.push("late"))
        assert.deepEqual(released, ["resources", "registered", "late"])
        assert.equal(owner.open, false)
        assert.equal(owner.releases, undefined)
    })

    it("stops closed operation work before its continuation reads state", async () => {
        const owner = new OperationOwner(testOperationContext())
        const source = deferred()
        let calls = 0
        const work = continueOperation(
            source.promise,
            owner.operationContext,
            () => calls++,
            undefined,
            owner,
        )
        owner.close()
        source.resolve(1)
        await work
        assert.equal(calls, 0)
    })

    it("collects all required poison outcomes before completing and releases captures", async () => {
        const ctx = testOperationContext()
        const owner = new OperationOwner(ctx)
        const source = deferred()
        const first = createPoisonError(
            new Error("first"),
            ctx,
            ERROR_KIND.OperationInputFailed,
        )
        const second = createPoisonError(
            new Error("second"),
            ctx,
            ERROR_KIND.OperationInputFailed,
        )
        let done = false
        const result = collectInputs(
            [first, source.promise],
            ctx,
            values => {
                done = true
                owner.close()
                return values
            },
            owner,
        )
        await flushMicrotasks()
        assert.equal(done, false)
        source.resolve(second)
        assert.deepEqual(await result, [first, second])
        assert.equal(owner.releases, undefined)
    })
})
