import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { concatFromInterior } from "./native-equivalence-support.js"
import { OrderedThenable, ready } from "./ordered-thenable.js"

const modes = Object.values(r.CHAIN_MODE)
const deliveryModes = ["ready", "synchronous", "deferred"]
const wholeArray = { mutationScopeDepth: 0 }

function* orders(inputs) {
    if (!inputs.length) yield []
    for (const input of inputs)
        for (const suffix of orders(inputs.filter(other => other !== input))) yield [input, ...suffix]
}

function deliver(value, timing) {
    if (timing === "ready") return { input: value }
    if (timing === "synchronous") return { input: ready(value) }
    const input = new OrderedThenable()
    return { input, release: () => input.resolve(value) }
}

async function settled(result, operation) {
    const blocked = Symbol()
    let checkpoint
    try {
        const value = await Promise.race([result, new Promise(resolve => {
            checkpoint = setImmediate(() => resolve(blocked))
        })])
        assert.notEqual(value, blocked, operation)
        return value
    } finally {
        clearImmediate(checkpoint)
    }
}

async function checkSpliceCopy(sourceMode, destinationMode, combined, observer, timings, order, beforeCopy, beforeObserve) {
    const label = JSON.stringify({ sourceMode, destinationMode, combined, observer, timings, order, beforeCopy, beforeObserve })
    const execution = new r.Execution()
    const [produce, copy, observe, later] = ["producer", "copy", "observer", "later"].map(errorContext => ({ execution, errorContext }))
    const initial = ["A", "B", "C"]
    // Independent all-ready model: the first splice retains A, and the
    // dense copy replaces that sole position with X.
    const expected = initial.slice()
    const removed = expected.splice(1, 2)
    const expectedCopy = expected.toSpliced(-1, 1, "X")
    const source = new r.Chain(combined ? concatFromInterior(initial, produce) : initial, produce, sourceMode)
    const old = r.capturePath(source, [], observe, destinationMode)
    const controls = [2, -1, 1].map((value, index) => deliver(value, timings[index]))
    let delivered = 0
    const advance = async end => {
        while (delivered < end) {
            controls[order[delivered++]].release()
            await new Promise(setImmediate)
        }
    }
    const removedHolder = new r.Chain(r.run(source, [], "splice", [1, controls[0].input], produce, wholeArray), observe)
    if (beforeCopy) await advance(beforeCopy)
    const output = new r.Chain(r.run(source, [], "toSpliced", [controls[1].input, controls[2].input, "X"], copy, {}),
        copy, destinationMode)
    if (beforeObserve > delivered) await advance(beforeObserve)
    const early = r.export(output, [], observe)
    let excluded
    if (observer === "lookup") excluded = r.lookupPath(output, [3], observe)
    if (observer === "at") excluded = r.run(output, [], "at", [3], observe, {})
    if (observer === "query") excluded = r.hasError(output, [3], observe)
    const historical = r.export(old, [], observe)
    assert.equal(r.isPending(historical, observe), false, "earlier capture waits for a later splice")
    assert.deepEqual(historical, initial)
    const held = r.capturePath(output, [], observe, destinationMode)
    r.assignPath(source, [], ["replacement"], later)
    if (order.length > delivered) await advance(order.length)
    const finish = (result, operation) => settled(result, `${operation} stayed pending: ${label}`)
    assert.equal(await finish(excluded, observer), observer === "query" ? false : undefined, label)
    for (const snapshot of [await finish(early, "earlier export"), await finish(r.export(output, [], observe), "later export"),
        await finish(r.export(held, [], observe), "captured export")]) {
        assert.deepEqual(snapshot, expectedCopy, label)
        assert.equal(Object.hasOwn(snapshot, 3), false, label)
    }
    assert.deepEqual(await finish(r.export(removedHolder, [], observe), "removed export"), removed, label)
    assert.deepEqual(await finish(r.export(source, [], later), "replacement export"), ["replacement"], label)
}

describe("Array interaction audit", function () {
    this.timeout(120000)

    for (const [sourceName, sourceMode] of Object.entries(r.CHAIN_MODE))
        it(`keeps an excluded index absent across all observers and receiving modes from ${sourceName}`, async () => {
            let checked = 0
            for (const destinationMode of modes)
                for (const combined of [false, true]) for (const observer of ["none", "lookup", "at", "query"])
                    for (const width of deliveryModes) for (const start of deliveryModes) for (const count of deliveryModes) {
                        const timings = [width, start, count]
                        const deferred = [0, 1, 2].filter(index => timings[index] === "deferred")
                        for (const order of orders(deferred))
                            for (let beforeCopy = 0; beforeCopy <= order.length; beforeCopy++)
                                for (let beforeObserve = beforeCopy; beforeObserve <= order.length; beforeObserve++) {
                                    await checkSpliceCopy(sourceMode, destinationMode, combined, observer, timings, order,
                                        beforeCopy, beforeObserve)
                                    checked++
                                }
                    }
            assert.equal(checked, 4224)
        })

    for (const [name, sourceMode] of Object.entries(r.CHAIN_MODE))
        it(`distinguishes historical, blocked and surviving writes after a splice from ${name}`, async () => {
            const complete = sourceMode === r.CHAIN_MODE.Complete
            for (const destinationMode of modes) for (const timing of deliveryModes) for (const fails of [false, true]) {
                const finish = (value, operation) => settled(value, `${operation} stayed pending for ${name}/${destinationMode}/${timing}/${fails}`)
                const ctx = { execution: new r.Execution(), errorContext: "splice width" }
                const siblingContext = { execution: ctx.execution, errorContext: "sibling write" }
                const failure = r.validationError("width", ctx, r.ERROR_KIND.OperationInputFailed)
                const input = deliver(fails ? failure : 2, timing)
                const initial = ["A", , "B"]
                const root = new r.Chain({ a: initial, tag: 0 }, ctx, sourceMode)
                const old = r.capturePath(root, ["a"], ctx, destinationMode)
                const result = new r.Chain(r.run(root, ["a"], "splice", [1, input.input], ctx, { mutationScopeDepth: 1 }), ctx)
                const historical = r.capturePath(root, ["a"], ctx, destinationMode)
                const first = r.lookupPath(historical, [0], ctx)
                const second = r.lookupPath(historical, [1], ctx)
                const deep = r.getErrors(historical, [], ctx)
                const exportBefore = r.export(historical, [], ctx)
                r.assignPath(root, ["a", 1], "X", ctx)
                r.assignPath(root, ["tag"], 9, siblingContext)
                const tag = r.lookupPath(root, ["tag"], siblingContext)
                const oldExport = r.export(old, [], ctx)
                const repaired = r.repairPath(root, ["a"], ctx)
                const current = r.capturePath(root, ["a"], ctx, destinationMode)
                const currentSecond = r.lookupPath(current, [1], ctx)
                if (input.release) {
                    assert.equal(r.isPending(first, ctx), complete)
                    assert(r.isPending(second, ctx))
                    assert(r.isPending(exportBefore, ctx))
                    assert.equal(r.isPending(currentSecond, ctx), complete)
                    if (!complete) assert.equal(currentSecond, "X")
                    assert.equal(await settled(tag, "disjoint sibling waits for the splice"), 9)
                    assert.deepEqual(await settled(oldExport, "historical capture waits for the splice"), initial)
                    input.release()
                }
                assert.equal(await finish(first, "first historical slot"), fails && complete ? failure : "A")
                assert.equal(await finish(second, "second historical slot"), fails ? failure : undefined)
                assert.equal(await finish(deep, "historical collection"), fails ? failure : null)
                assert.equal(await finish(tag, "disjoint tag"), 9)
                assert.deepEqual(await finish(oldExport, "predecessor export"), initial)
                await finish(repaired, "repair")
                const after = await finish(r.export(current, [], ctx), "successor export")
                const direct = await finish(r.export(result, [], ctx), "direct splice result")
                if (fails) {
                    assert.equal(await finish(exportBefore, "historical export"), failure)
                    assert.equal(direct, failure)
                    assert.equal(await finish(currentSecond, "successor second slot"), complete ? undefined : "X")
                    if (complete) assert.deepEqual(after, initial)
                    else {
                        assert.equal(after, failure)
                        assert.equal(await finish(r.lookupPath(current, [2], ctx), "structural slot"), failure)
                        await finish(r.repairPath(current, [2], ctx), "repair of structural slot")
                        assert.equal(await finish(r.lookupPath(current, [2], ctx), "structural slot after repair"), failure)
                    }
                    assert.equal(await finish(r.getErrors(historical, [], ctx), "collection after repair"), failure)
                } else {
                    assert.deepEqual(await finish(exportBefore, "historical export"), ["A"])
                    assert.deepEqual(direct, [, "B"])
                    assert.equal(await finish(currentSecond, "successor second slot"), "X")
                    assert.deepEqual(after, ["A", "X"])
                }
            }
        })

    for (const sourceMode of [r.CHAIN_MODE.Sequential, r.CHAIN_MODE.Unordered])
        it(`collects distinct regional causes and restores only the reported hole in mode ${sourceMode}`, async () => {
            const execution = new r.Execution()
            const ctx = { execution, errorContext: "read and repair" }
            const flag = r.validationError("bad hole", { execution, errorContext: "flag" }, r.ERROR_KIND.OperationInputFailed)
            const width = r.validationError("bad width", { execution, errorContext: "width" }, r.ERROR_KIND.OperationInputFailed)
            for (const flagTiming of deliveryModes) for (const widthTiming of deliveryModes) {
                const deferred = [flagTiming, widthTiming].flatMap((timing, index) =>
                    timing === "deferred" ? [index] : [])
                for (const order of orders(deferred)) {
                    // Each order requires fresh controls and captures.
                    const inputs = [deliver(flag, flagTiming), deliver(width, widthTiming)]
                    const [local, regional] = inputs
                    const chain = new r.Chain([, "B", "C"], ctx, sourceMode)
                    r.poisonPath(chain, [0], local.input, ctx)
                    const splice = r.run(chain, [], "splice", [1, regional.input], ctx, wholeArray)
                    const history = r.capturePath(chain, [], ctx, r.CHAIN_MODE.Complete)
                    const failuresBefore = r.getErrors(history, [], ctx)
                    const repaired = r.repairPath(chain, [0], ctx)
                    const first = r.lookupPath(chain, [0], ctx)
                    const failuresAfter = r.getErrors(chain, [], ctx)
                    const firstOnly = new r.Chain(r.run(chain, [], "slice", [0, 1], ctx, {}), ctx, sourceMode)
                    assert.equal(await settled(first, "exact repair waits for unrelated causes"), undefined)
                    for (const input of order) {
                        inputs[input].release()
                        await new Promise(setImmediate)
                    }
                    assert.equal(await splice, width)
                    await repaired
                    const collected = await failuresBefore
                    assert(collected instanceof r.CompoundPoisonError)
                    assert.deepEqual(new Set(collected.errors), new Set([flag, width]))
                    assert.equal(await failuresAfter, width)
                    assert.equal(await r.lookupPath(history, [0], ctx), flag)
                    assert.deepEqual(await r.export(firstOnly, [], ctx), [,])
                }
            }
        })

    it("keeps captured aliases while a later indexed write separates only its selected occurrence", async () => {
        for (const mode of modes) for (const timing of deliveryModes) for (const combined of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: "alias and indexed write" }
            const shared = { n: 1 }, initial = [shared, , shared]
            const source = new r.Chain(combined ? concatFromInterior(initial, ctx) : initial, ctx, mode)
            const old = r.capturePath(source, [], ctx)
            const width = deliver(1, timing)
            const removed = new r.Chain(r.run(source, [], "splice", [1, width.input], ctx, wholeArray), ctx, mode)
            const between = r.capturePath(source, [], ctx)
            const earlierExport = r.export(between, [], ctx)
            r.assignPath(source, [0, "n"], 9, ctx)
            const laterFirst = r.lookupPath(source, [0, "n"], ctx)
            if (width.release) {
                assert.equal(r.isPending(earlierExport, ctx), true)
                assert.equal(r.isPending(laterFirst, ctx), mode === r.CHAIN_MODE.Complete)
                if (mode !== r.CHAIN_MODE.Complete) assert.equal(laterFirst, 9)
                width.release()
            }
            assert.equal(await settled(laterFirst, "later indexed write"), 9)
            const original = await settled(r.export(old, [], ctx), "original export")
            const beforeWrite = await settled(earlierExport, "captured splice")
            const live = await settled(r.export(source, [], ctx), "live export")
            assert.deepEqual(original, [{ n: 1 }, , { n: 1 }])
            assert.equal(original[0], original[2])
            assert.deepEqual(beforeWrite, [{ n: 1 }, { n: 1 }])
            assert.equal(beforeWrite[0], beforeWrite[1])
            assert.deepEqual(live, [{ n: 9 }, { n: 1 }])
            assert.notEqual(live[0], live[1])
            assert.deepEqual(await settled(r.export(removed, [], ctx), "removed sparse slot"), [,])
            assert.equal(shared.n, 1)
        }
    })
})
