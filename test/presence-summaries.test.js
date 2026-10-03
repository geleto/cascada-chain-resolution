import * as runtime from "../src/index.js"
import { Chain, assignPath, deletePath, getErrors, hasError, Execution } from "../src/index.js"
import { getRefCounter } from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import assert from "node:assert/strict"
import { deferred, flushMicrotasks } from "./support.js"

function poison(testContext, message) {
    return runtime.validationError(message, testContext, runtime.ERROR_KIND.PropertyValidation)
}

// Only eleven records, but descendant-path totals exceed Number's exact range.
function aliasedBranch(leaf) {
    for (let depth = 0; depth < 11; depth++)
        leaf = Object.fromEntries(Array.from({ length: 32 }, (_, key) => [key, leaf]))
    return leaf
}

function orderedRoot(branch, survivor, reverse) {
    return reverse ? { survivor, branch } : { branch, survivor }
}

describe("bounded presence propagation", () => {
    for (const reverse of [false, true]) {
        it(`retains an independent Error after removing aliased contributions, reverse=${reverse}`, () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const branchError = poison(testContext, "branch")
            const survivor = poison(testContext, "survivor")
            const branch = aliasedBranch(branchError)
            const root = orderedRoot(branch, survivor, reverse)
            const chain = new Chain(root, testContext)
            assert.equal(hasError(chain, [], testContext), true)
            assert.equal(getRefCounter(root, testContext).errorCount, 2)
            verifyRefCounts(testContext, root)
            for (let iteration = 0; iteration < 3; iteration++) {
                assignPath(chain, ["branch"], null, testContext)
                assert.equal(hasError(chain, [], testContext), true)
                assert.equal(getErrors(chain, [], testContext), survivor)
                verifyRefCounts(testContext, root, branch)
                assignPath(chain, ["branch"], branch, testContext)
                assert.deepEqual(new Set(getErrors(chain, [], testContext).errors), new Set([branchError, survivor]))
                assert.equal(getRefCounter(root, testContext).errorCount, 2)
                verifyRefCounts(testContext, root, branch)
            }
        })

        it(`retains an independent pending frontier after aliased removal, reverse=${reverse}`, async () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const large = deferred()
            const remaining = deferred()
            const branch = aliasedBranch(large.promise)
            const root = orderedRoot(branch, remaining.promise, reverse)
            const chain = new Chain(root, testContext)
            const captured = getErrors(chain, [], testContext)
            assert.equal(getRefCounter(root, testContext).promiseCount, 2)
            for (let iteration = 0; iteration < 3; iteration++) {
                deletePath(chain, ["branch"], testContext)
                assert.equal(getRefCounter(root, testContext).promiseCount, 1)
                verifyRefCounts(testContext, root, branch)
                assignPath(chain, ["branch"], branch, testContext)
                assert.equal(getRefCounter(root, testContext).promiseCount, 2)
                verifyRefCounts(testContext, root, branch)
            }
            deletePath(chain, ["branch"], testContext)
            const has = hasError(chain, [], testContext)
            const collected = getErrors(chain, [], testContext)
            assert(has instanceof Promise)
            assert(collected instanceof Promise)
            const survivor = poison(testContext, "late survivor")
            remaining.reject(survivor)
            assert.equal(await has, true)
            assert.equal(await collected, survivor)
            large.resolve(null)
            assert.equal(await captured, survivor)
            verifyRefCounts(testContext, root, branch)
        })

        it(`retains an independent cycle-cut frontier after aliased removal, reverse=${reverse}`, () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const survivor = poison(testContext, "behind cut")
            const back = {}
            const target = { back, error: survivor }
            back.target = target
            // The survivor is reachable from back only through its cut.
            assert.equal(hasError(new Chain(target, testContext), [], testContext), true)
            assert.equal(getRefCounter(back, testContext).errorCount, 0)
            const cyclic = {}
            cyclic.self = cyclic
            const branch = aliasedBranch(cyclic)
            const root = orderedRoot(branch, back, reverse)
            const chain = new Chain(root, testContext)
            assert.equal(getErrors(chain, [], testContext), survivor)
            assert.equal(getRefCounter(root, testContext).cycleCutCount, 2)
            for (let iteration = 0; iteration < 3; iteration++) {
                deletePath(chain, ["branch"], testContext)
                assert.equal(hasError(chain, [], testContext), true)
                assert.equal(getErrors(chain, [], testContext), survivor)
                verifyRefCounts(testContext, root, branch)
                assignPath(chain, ["branch"], branch, testContext)
                assert.equal(getRefCounter(root, testContext).cycleCutCount, 2)
                verifyRefCounts(testContext, root, branch)
            }
        })
    }

    it("combines reconverging Promise publication without disturbing other categories", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const one = deferred(), two = deferred(), pending = deferred()
        const first = poison(testContext, "first"), second = poison(testContext, "second")
        const leaf = { one: one.promise, two: two.promise, pending: pending.promise }
        const left = { a: leaf, b: leaf }, right = { child: leaf }, root = { left, right }
        const chain = new Chain(root, testContext)
        const collected = getErrors(chain, [], testContext)
        assert.equal(getRefCounter(root, testContext).promiseCount, 2)
        one.reject(first)
        await flushMicrotasks()
        assert.equal(getRefCounter(left, testContext).errorCount, 2)
        assert.equal(getRefCounter(root, testContext).errorCount, 2)
        assert.equal(getRefCounter(root, testContext).promiseCount, 2)
        two.reject(second)
        pending.resolve(0)
        assert.deepEqual(new Set((await collected).errors), new Set([first, second]))
        assert.equal(getRefCounter(root, testContext).promiseCount, 0)
        verifyRefCounts(testContext, root)
        deletePath(chain, ["left", "a"], testContext)
        assert.equal(getRefCounter(left, testContext).errorCount, 1)
        deletePath(chain, ["left", "b"], testContext)
        assert.equal(getRefCounter(root, testContext).errorCount, 1)
        deletePath(chain, ["right"], testContext)
        assert.equal(hasError(chain, [], testContext), false)
        verifyRefCounts(testContext, root)
    })

    for (const reverse of [false, true]) {
        it(`keeps cyclic diamond observations independent of insertion history, reverse=${reverse}`, async () => {
            const testContext = { execution: new Execution(), errorContext: "test operation" }
            const first = poison(testContext, "left")
            const second = poison(testContext, "right")
            const left = { value: first }
            const right = { value: second }
            const join = { back: left }
            left.join = right.join = join
            const root = reverse ? { right, left } : { left, right }
            const chain = new Chain(root, testContext)
            assert.deepEqual(new Set(getErrors(chain, [], testContext).errors), new Set([first, second]))
            verifyRefCounts(testContext, root)
            for (const [arm, error, other] of [[left, first, second], [right, second, first]]) {
                const armChain = new Chain(arm, testContext)
                deletePath(armChain, ["value"], testContext)
                assert.deepEqual(new Set(getErrors(chain, [], testContext).errors), new Set([first, second]))
                verifyRefCounts(testContext, root)
                const pending = deferred()
                assignPath(armChain, ["value"], pending.promise, testContext)
                const collected = getErrors(armChain, [], testContext)
                assert(collected instanceof Promise)
                verifyRefCounts(testContext, root)
                pending.reject(error)
                const errors = await collected
                assert.deepEqual(new Set(errors.errors ?? [errors]), new Set(arm === left ? [first] : [first, second]))
                verifyRefCounts(testContext, root)
            }
            // Replacing each arm's contribution to the cycle updates cut presence too.
            for (const arm of [left, right]) {
                const armChain = new Chain(arm, testContext)
                const pending = deferred()
                assignPath(armChain, ["join"], pending.promise, testContext)
                verifyRefCounts(testContext, root)
                pending.resolve(join)
                await flushMicrotasks()
                assert.deepEqual(new Set(getErrors(chain, [], testContext).errors), new Set([first, second]))
                verifyRefCounts(testContext, root)
            }
        })
    }
})
