import assert from "node:assert/strict"
import {
    Chain, assignPath, deferred, deletePath, flushMicrotasks,
    getErrors, getRefCounter, hasError, runtime, testOperationContext, verifyRefCounts,
} from "./support.js"

function poison(message) {
    return runtime.validationError(message, testOperationContext(), runtime.ERROR_KIND.PropertyValidation)
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
            const branchError = poison("branch")
            const survivor = poison("survivor")
            const branch = aliasedBranch(branchError)
            const root = orderedRoot(branch, survivor, reverse)
            const chain = new Chain(root)
            assert.equal(hasError(chain, []), true)
            assert.equal(getRefCounter(root).errorCount, 2)
            verifyRefCounts(root)
            for (let iteration = 0; iteration < 3; iteration++) {
                assignPath(chain, ["branch"], null)
                assert.equal(hasError(chain, []), true)
                assert.equal(getErrors(chain, []), survivor)
                verifyRefCounts(root, branch)
                assignPath(chain, ["branch"], branch)
                assert.deepEqual(new Set(getErrors(chain, []).errors), new Set([branchError, survivor]))
                assert.equal(getRefCounter(root).errorCount, 2)
                verifyRefCounts(root, branch)
            }
        })

        it(`retains an independent pending frontier after aliased removal, reverse=${reverse}`, async () => {
            const large = deferred()
            const remaining = deferred()
            const branch = aliasedBranch(large.promise)
            const root = orderedRoot(branch, remaining.promise, reverse)
            const chain = new Chain(root)
            const captured = getErrors(chain, [])
            assert.equal(getRefCounter(root).promiseCount, 2)
            for (let iteration = 0; iteration < 3; iteration++) {
                deletePath(chain, ["branch"])
                assert.equal(getRefCounter(root).promiseCount, 1)
                verifyRefCounts(root, branch)
                assignPath(chain, ["branch"], branch)
                assert.equal(getRefCounter(root).promiseCount, 2)
                verifyRefCounts(root, branch)
            }
            deletePath(chain, ["branch"])
            const has = hasError(chain, [])
            const collected = getErrors(chain, [])
            assert(has instanceof Promise)
            assert(collected instanceof Promise)
            const survivor = poison("late survivor")
            remaining.reject(survivor)
            assert.equal(await has, true)
            assert.equal(await collected, survivor)
            large.resolve(null)
            assert.equal(await captured, survivor)
            verifyRefCounts(root, branch)
        })

        it(`retains an independent cycle-cut frontier after aliased removal, reverse=${reverse}`, () => {
            const survivor = poison("behind cut")
            const back = {}
            const target = { back, error: survivor }
            back.target = target
            // The survivor is reachable from back only through its cut.
            assert.equal(hasError(new Chain(target), []), true)
            assert.equal(getRefCounter(back).errorCount, 0)
            const cyclic = {}
            cyclic.self = cyclic
            const branch = aliasedBranch(cyclic)
            const root = orderedRoot(branch, back, reverse)
            const chain = new Chain(root)
            assert.equal(getErrors(chain, []), survivor)
            assert.equal(getRefCounter(root).cycleCutCount, 2)
            for (let iteration = 0; iteration < 3; iteration++) {
                deletePath(chain, ["branch"])
                assert.equal(hasError(chain, []), true)
                assert.equal(getErrors(chain, []), survivor)
                verifyRefCounts(root, branch)
                assignPath(chain, ["branch"], branch)
                assert.equal(getRefCounter(root).cycleCutCount, 2)
                verifyRefCounts(root, branch)
            }
        })
    }

    it("combines reconverging presence changes without disturbing other categories", async () => {
        const pending = deferred()
        const first = poison("first")
        const second = poison("second")
        const leaf = { first, second, pending: pending.promise }
        const left = { a: leaf, b: leaf }
        const right = { child: leaf }
        const root = { left, right }
        const chain = new Chain(root)
        assert.equal(hasError(chain, []), true)
        const leafChain = new Chain(leaf)
        deletePath(leafChain, ["first"])
        assert.equal(getErrors(leafChain, ["second"]), second)
        assert.equal(getRefCounter(left).errorCount, 2)
        assert.equal(getRefCounter(root).errorCount, 2)
        verifyRefCounts(root)
        deletePath(leafChain, ["second"])
        assert.equal(getRefCounter(root).errorCount, 0)
        assert.equal(getRefCounter(root).promiseCount, 2)
        verifyRefCounts(root)
        pending.reject(first)
        assert.equal(await getErrors(chain, []), first)
        assert.equal(getRefCounter(root).promiseCount, 0)
        assert.equal(getRefCounter(root).errorCount, 2)
        verifyRefCounts(root)
        deletePath(leafChain, ["pending"])
        assert.equal(hasError(chain, []), false)
        verifyRefCounts(root)
    })

    for (const reverse of [false, true]) {
        it(`keeps cyclic diamond observations independent of insertion history, reverse=${reverse}`, async () => {
            const first = poison("left")
            const second = poison("right")
            const left = { value: first }
            const right = { value: second }
            const join = { back: left }
            left.join = right.join = join
            const root = reverse ? { right, left } : { left, right }
            const chain = new Chain(root)
            assert.deepEqual(new Set(getErrors(chain, []).errors), new Set([first, second]))
            verifyRefCounts(root)
            for (const [arm, error, other] of [[left, first, second], [right, second, first]]) {
                const armChain = new Chain(arm)
                deletePath(armChain, ["value"])
                assert.equal(getErrors(chain, []), other)
                verifyRefCounts(root)
                const pending = deferred()
                assignPath(armChain, ["value"], pending.promise)
                const collected = getErrors(chain, [])
                assert(collected instanceof Promise)
                verifyRefCounts(root)
                pending.reject(error)
                assert.deepEqual(new Set((await collected).errors), new Set([first, second]))
                verifyRefCounts(root)
            }
            // Replacing each arm's contribution to the cycle updates cut presence too.
            for (const arm of [left, right]) {
                const armChain = new Chain(arm)
                const pending = deferred()
                assignPath(armChain, ["join"], pending.promise)
                verifyRefCounts(root)
                pending.resolve(join)
                await flushMicrotasks()
                assert.deepEqual(new Set(getErrors(chain, []).errors), new Set([first, second]))
                verifyRefCounts(root)
            }
        })
    }
})
