import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as r from "../src/index.js"
import { continueGraphTransition, runInternalStep } from "../src/internal-step.js"
import { ready, OrderedThenable, ChainedThenable } from "./ordered-thenable.js"
import { createRandom, randomInteger } from "./native-equivalence-support.js"
import { ReservationKernel } from "./experiments/phase6-reservations.mjs"

// Dependency prototype only. Public construction supplies a valid canonical
// tree; simulated selection and effects exercise the candidate kernel. These
// are not evidence that public Promise-valued paths or managed gates work.
function setup() {
    const ctx = { execution: new r.Execution(), errorContext: {} }
    const external = () => r.externalState({})
    const chain = new r.ContextChain({
        api: r.externalState({ child: external() }),
        other: external(), group: { db: external(), config: external() },
    }, ctx, { api: { child: {} }, other: {}, group: { db: {}, config: {} } })
    const tree = chain._externalMutationTree
    const kernel = new ReservationKernel(tree, ctx)
    const events = []
    const action = (work, name, body = () => {}) => continueGraphTransition(work.readiness, ctx, () => {
        events.push(name)
        return continueGraphTransition(body(), ctx, result => {
            work.complete()
            return result
        })
    })
    return { ctx, tree, kernel, events, action }
}

const turn = () => new Promise(setImmediate)

function input(mode, value) {
    if (mode === "ready") return { value, release() {} }
    if (mode === "synchronous") return { value: ready(value), release() {} }
    if (mode === "native") {
        const pending = Promise.withResolvers()
        return { value: pending.promise, release() { pending.resolve(value) } }
    }
    const pending = mode === "ordered" ? new OrderedThenable() : new ChainedThenable()
    return { value: pending, release() { pending.resolve(value) } }
}

function selectOn(selection, key, ctx, choose) {
    return continueGraphTransition(key, ctx, value => selection.select(choose(value)))
}

describe("phase 6 reservation selection prototype", () => {
    it("keeps fixed ready operations synchronous", () => {
        const { kernel, tree, action, events } = setup()
        assert.equal(action(kernel.reserve(tree.api, true), "write", () => 3), 3)
        assert.equal(action(kernel.reserve(tree.api, false), "read", () => 4), 4)
        assert.deepEqual(events, ["write", "read"])
        assert.equal(kernel.pending(), undefined)
        assert.equal(kernel.counts.waitsCreated, 0)
    })

    it("shares identical waits and releases their records while another scope stays pending", async () => {
        const { kernel, tree, action, events } = setup()
        const api = kernel.selection(tree, true)
        const other = kernel.selection(tree, true)
        const group = api.group
        api.select(tree.api)
        other.select(tree.other)
        const first = action(kernel.reserve(tree.api, false), "first")
        const second = action(kernel.reserve(tree.api, false), "second")
        const sibling = action(kernel.reserve(tree.other, false), "sibling")
        assert.equal(kernel.counts.sharedHits, 1)
        assert.equal(kernel.counts.liveWaits, 2)
        api.complete()
        await Promise.all([first, second])
        assert.deepEqual(events, ["first", "second"])
        assert.equal(group.scopedWaits.get(tree.api), undefined)
        assert.equal(group.scopedWaits.get(tree.other).subtree.size, 1)
        assert.equal(kernel.counts.liveWaits, 1)
        other.complete()
        await sibling
        assert.equal(group.scopedWaits, undefined)
        assert.equal(kernel.counts.liveWaits, 0)
    })

    it("keeps prefix-only validation independent of a cached subtree wait", async () => {
        const { kernel, tree, action, events } = setup()
        const child = kernel.selection(tree, true)
        child.select(tree.api.child)
        const subtree = action(kernel.reserve(tree.api, false), "subtree")
        assert.equal(kernel.counts.liveWaits, 1)
        assert.equal(action(kernel.reserve(tree.api, false, false), "prefix", () => 7), 7)
        assert.deepEqual(events, ["prefix"])
        assert.equal(kernel.counts.liveWaits, 1)
        child.complete()
        await subtree
        assert.equal(kernel.counts.liveWaits, 0)
    })

    it("does not make ready work await the cleanup of a previously cached Promise", async () => {
        const { kernel, tree, action } = setup()
        const api = kernel.selection(tree, true)
        const other = kernel.selection(tree, true)
        api.select(tree.api)
        other.select(tree.other)
        const first = kernel.selection(tree, false)
        const second = kernel.selection(tree, false)
        first.select(tree.api)
        const firstResult = action(first, "first")
        assert.equal(kernel.counts.liveWaits, 1)
        api.complete()
        // Completion removed the actual dependency synchronously. The shared
        // wait's ordinary Promise callback has not yet deleted its cache entry.
        assert.equal(second.select(tree.api), undefined)
        assert.equal(action(second, "second", () => 42), 42)
        await firstResult
        assert.equal(kernel.counts.liveWaits, 0)
        other.complete()
        assert.equal(kernel.pending(), undefined)
    })

    for (const selected of ["api", "other"]) {
        it(`keeps a later unknown member outside an older shared wait, target=${selected}`, async () => {
            const { kernel, tree, action, events } = setup()
            const first = kernel.selection(tree, false)
            first.select(tree.api)
            const earlier = kernel.selection(tree, true)
            earlier.select(tree.api)
            const earlierResult = action(earlier, "earlier")
            const unknown = kernel.selection(tree, false)
            const later = kernel.selection(tree, true)
            later.select(tree.api)
            const laterResult = action(later, "later")
            first.complete()
            await earlierResult
            await turn()
            assert.deepEqual(events, ["earlier"], "the older cutoff must not absorb the unknown key")
            const hold = Promise.withResolvers()
            unknown.select(tree[selected])
            const unknownResult = action(unknown, "unknown", () => hold.promise)
            await turn()
            assert.equal(events.includes("later"), selected === "other")
            hold.resolve()
            await Promise.all([unknownResult, laterResult])
            assert.equal(kernel.pending(), undefined)
            assert.equal(kernel.counts.liveWaits, 0)
        })
    }

    for (const mode of ["ready", "synchronous", "native", "ordered", "chained"]) {
        it(`releases unrelated waiters while keeping original predecessors: ${mode}`, async () => {
            const { kernel, tree, ctx, action, events } = setup()
            const apiHold = Promise.withResolvers(), selectedHold = Promise.withResolvers()
            const first = action(kernel.reserve(tree.api, true), "first", () => apiHold.promise)
            const selection = kernel.selection(tree, true)
            const key = input(mode, "group")
            const selected = continueGraphTransition(selectOn(selection, key.value, ctx, key => tree[key]), ctx,
                () => action(selection, "selected", () => selectedHold.promise))
            const same = action(kernel.reserve(tree.api, true), "same")
            const other = action(kernel.reserve(tree.other, true), "other")
            const ancestor = action(kernel.reserve(tree, false), "ancestor")
            key.release()
            await turn()
            assert(events.includes("selected"))
            assert(events.includes("other"))
            assert(!events.includes("same"))
            assert(!events.includes("ancestor"))
            selectedHold.resolve()
            await selected
            await turn()
            assert(!events.includes("ancestor"), "ancestor still owes the earlier api mutation")
            apiHold.resolve()
            await Promise.all([first, same, other, ancestor])
            assert(events.indexOf("same") < events.indexOf("ancestor"))
            assert.equal(kernel.pending(), undefined)
        })
    }

    it("drops all external dependencies when selection consumes no metadata", async () => {
        const { kernel, tree, action, events } = setup()
        const hold = Promise.withResolvers()
        const first = action(kernel.reserve(tree.api, true), "first", () => hold.promise)
        const selection = kernel.selection(tree, true)
        const other = action(kernel.reserve(tree.other, true), "other")
        const same = action(kernel.reserve(tree.api, false), "same")
        assert.equal(selection.select(undefined), undefined)
        await other
        assert(!events.includes("same"))
        hold.resolve()
        await Promise.all([first, same])
        assert.equal(kernel.pending(), undefined)
    })

    for (const mutation of [false, true]) {
        it(`captures or repairs only selected metadata, mutation=${mutation}`, async () => {
            const { kernel, tree, action, events } = setup()
            const earlier = Promise.withResolvers(), unrelated = Promise.withResolvers()
            const oldError = new Error("earlier"), laterError = new Error("later")
            let poison, captured
            const first = action(kernel.reserve(tree.group.db, true), "earlier", () => earlier.promise.then(() => { poison = oldError }))
            const outside = action(kernel.reserve(tree.api, true), "unrelated", () => unrelated.promise)
            const selection = kernel.selection(tree, mutation)
            const later = action(kernel.reserve(tree.group.db, true), "later", () => { poison = laterError })
            const sibling = action(kernel.reserve(tree.other, true), "sibling")
            const ancestor = action(kernel.reserve(tree, false), "ancestor")
            selection.select(tree.group)
            const selected = action(selection, "selected", () => {
                captured = poison
                if (mutation) poison = undefined
            })
            await sibling
            assert(!events.includes("selected"))
            assert(!events.includes("later"))
            earlier.resolve()
            await Promise.all([first, selected, later])
            assert.equal(captured, oldError)
            assert.equal(poison, laterError)
            assert(events.indexOf("selected") < events.indexOf("later"))
            assert(!events.includes("ancestor"))
            unrelated.resolve()
            await Promise.all([outside, ancestor])
            assert.equal(captured, oldError)
            assert.equal(kernel.pending(), undefined)
        })
    }

    it("narrows forbidden observation to prefix validation without child waits", async () => {
        const { kernel, tree, action, events } = setup()
        const hold = Promise.withResolvers()
        const first = action(kernel.reserve(tree.api.child, true), "child", () => hold.promise)
        const selection = kernel.selection(tree.api, false)
        const child = action(kernel.reserve(tree.api.child, false), "child-read")
        const parent = action(kernel.reserve(tree.api, true), "parent")
        assert.equal(selection.select(tree.api, false), undefined)
        assert.equal(action(selection, "validation", () => "local failure"), "local failure")
        await turn()
        assert(!events.includes("parent"))
        assert(!events.includes("child-read"), "the child read retains its real predecessor")
        hold.resolve()
        await Promise.all([first, child, parent])
        assert.equal(kernel.pending(), undefined)
    })

    it("lets later child writes outlive prefix-only validation", async () => {
        const { kernel, tree, action, events } = setup()
        const hold = Promise.withResolvers()
        const selection = kernel.selection(tree.api, false)
        const child = action(kernel.reserve(tree.api.child, true), "child")
        selection.select(tree.api, false)
        const selected = action(selection, "validation", () => hold.promise)
        await child
        assert.deepEqual(events, ["validation", "child"])
        hold.resolve()
        await selected
        assert.equal(kernel.pending(), undefined)
    })

    it("retains selected effects through entry closure and later replacement", async () => {
        const { kernel: outside, tree, ctx, action, events } = setup()
        const entry = outside.reserve(tree, true)
        const inside = new ReservationKernel(tree, ctx)
        const selectedHold = Promise.withResolvers()
        const selection = inside.selection(tree, true)
        const later = action(inside.reserve(tree.group, true), "inside-later")
        // Closing the callback snapshots only the ordinary root frontier.
        const closed = continueGraphTransition(inside.pending(), ctx, () => entry.complete())
        const following = action(outside.reserve(tree.other, true), "outside")
        selection.select(tree.group)
        const selected = action(selection, "selected", () => selectedHold.promise)
        await turn()
        assert.deepEqual(events, ["selected"])
        selectedHold.resolve()
        await Promise.all([selected, later, closed, following])
        assert.deepEqual(events, ["selected", "inside-later", "outside"])
        assert.equal(inside.pending(), undefined)
        assert.equal(outside.pending(), undefined)
    })

    it("does not recapture a later ancestor when selections settle in reverse order", async () => {
        const { kernel, tree, action, events } = setup()
        const first = kernel.selection(tree, true)
        const second = kernel.selection(tree, true)
        const ancestor = action(kernel.reserve(tree, true), "ancestor")
        second.select(tree.other)
        const secondResult = action(second, "second")
        await turn()
        assert.deepEqual(events, [])
        first.select(tree.group)
        const firstResult = action(first, "first")
        await Promise.all([firstResult, secondResult, ancestor])
        assert.deepEqual(events, ["first", "second", "ancestor"])
        assert.equal(kernel.pending(), undefined)
    })

    it("excludes later members of a shared group from an earlier capture", async () => {
        const { kernel, tree, action, events } = setup()
        const first = kernel.selection(tree, true)
        const reader = kernel.reserve(tree.api, false)
        const later = kernel.selection(tree, true)
        const hold = Promise.withResolvers()
        later.select(tree.api)
        const laterResult = action(later, "later", () => hold.promise)
        first.select(undefined)
        await action(reader, "reader")
        await turn()
        assert.deepEqual(events, ["reader", "later"])
        hold.resolve()
        await laterResult
        assert.equal(kernel.pending(), undefined)
    })

    it("filters an unrelated unresolved group after the target is selected", () => {
        const { kernel, tree, action, events } = setup()
        const earlier = kernel.selection(tree.api, true)
        const selected = kernel.selection(tree, true)
        assert.equal(selected.select(tree.other), undefined)
        assert.equal(action(selected, "selected", () => 42), 42)
        assert.deepEqual(events, ["selected"])
        earlier.select(undefined)
        assert.equal(kernel.pending(), undefined)
    })

    it("keeps early completion behind the selected operation's real predecessors", async () => {
        const { kernel, tree, action, events } = setup()
        const hold = Promise.withResolvers()
        const first = action(kernel.reserve(tree.group.db, true), "first", () => hold.promise)
        const selection = kernel.selection(tree, true)
        const later = action(kernel.reserve(tree.group, true), "later")
        selection.select(tree.group)
        selection.complete()
        selection.complete()
        await turn()
        assert.deepEqual(events, ["first"])
        hold.resolve()
        await Promise.all([first, later])
        assert.equal(kernel.pending(), undefined)
    })

    it("skips selection and effects after execution fatality", async () => {
        const { kernel, tree, ctx, action, events } = setup()
        const key = Promise.withResolvers()
        const selection = kernel.selection(tree, true)
        const selected = continueGraphTransition(selectOn(selection, key.promise, ctx, key => tree[key]), ctx,
            () => action(selection, "selected"))
        const cause = new Error("runtime defect")
        assert.throws(() => runInternalStep(ctx, () => { throw cause }), r.FatalError)
        key.resolve("group")
        await selected
        assert.deepEqual(events, [])
    })

    it("matches a flat issuance-order oracle across independent selection and completion schedules", async () => {
        const paths = [[], ["api"], ["api", "child"], ["other"], ["group"], ["group", "db"], ["group", "config"]]
        const prefix = (left, right) => left.length <= right.length && left.every((key, i) => right[i] === key)
        const overlap = (left, right) => left.path !== undefined && right.path !== undefined &&
            (left.mutation || right.mutation) &&
            (left.path.length === right.path.length && prefix(left.path, right.path) ||
                left.subtree && prefix(left.path, right.path) || right.subtree && prefix(right.path, left.path))
        for (let seed = 0; seed < 256; seed++) {
            const { kernel, tree, action, events } = setup()
            const random = createRandom(seed + 0x51ec710)
            const at = path => path?.reduce((node, key) => node[key], tree)
            const operations = []
            const releases = []
            const results = []
            const expected = () => {
                // This oracle knows only issued operations and their chosen
                // scopes. It has no tree frontiers, domination or promises.
                for (let index = 0; index < operations.length; index++) {
                    const operation = operations[index]
                    if (!operation.selected || operation.complete) continue
                    const blocked = operations.slice(0, index).some(earlier => !earlier.complete &&
                        overlap(operation, earlier.selected ? earlier : {
                            path: earlier.prefix, mutation: earlier.mutation, subtree: true,
                        }))
                    if (!blocked) {
                        operation.started = true
                        if (operation.done) operation.complete = true
                    }
                }
                return operations.flatMap((operation, index) => operation.started ? [index] : [])
            }
            const check = async label => {
                await turn()
                assert.deepEqual([...events].sort((a, b) => a - b), expected(), `seed=${seed}, ${label}`)
            }
            for (let index = 0; index < 24; index++) {
                const selecting = random() < 0.6
                const mutation = random() < 0.5
                const path = selecting && random() < 0.15 ? undefined : paths[randomInteger(random, paths.length)]
                const prefix = path?.slice(0, randomInteger(random, path.length + 1)) ?? []
                const subtree = mutation || random() < 0.8
                const operation = { path, prefix, mutation, subtree, selected: !selecting, started: false, complete: false, done: false }
                const hold = Promise.withResolvers()
                const work = selecting ? kernel.selection(at(prefix), mutation) : kernel.reserve(at(path), mutation, subtree)
                operations.push(operation)
                if (selecting) releases.push(() => {
                    operation.selected = true
                    work.select(at(path), subtree)
                    results.push(action(work, index, () => hold.promise))
                })
                else results.push(action(work, index, () => hold.promise))
                releases.push(() => { operation.done = true; hold.resolve() })
                // Half the seeds interleave fresh issuance with key/effect
                // delivery; the other half capture the complete pending batch.
                if (seed % 2) while (releases.length && random() < 0.65) {
                    releases.splice(randomInteger(random, releases.length), 1)[0]()
                    await check(`issued=${index + 1}, remaining=${releases.length}`)
                }
            }
            await check("issuance")
            while (releases.length) {
                releases.splice(randomInteger(random, releases.length), 1)[0]()
                await check(`remaining=${releases.length}`)
            }
            await Promise.all(results)
            assert.equal(kernel.pending(), undefined, `seed=${seed}`)
        }
    })

    for (const size of [16, 64, 256]) {
        it(`bounds frontier inspection after many selections narrow behind one writer, size=${size}`, async () => {
            const { kernel, tree, action } = setup()
            const selections = Array.from({ length: size }, () => kernel.selection(tree, false))
            const hold = Promise.withResolvers()
            const writer = action(kernel.reserve(tree.group, true), "writer", () => hold.promise)
            for (const selection of selections) selection.select(tree.group)
            const before = kernel.counts.inspected
            const reads = Array.from({ length: size }, () => action(kernel.reserve(tree.group, false), "read"))
            assert(kernel.counts.inspected - before <= size * 2,
                "later reads must not rediscover all selections subsumed by the writer")
            for (const selection of selections) selection.complete()
            await turn()
            hold.resolve()
            await Promise.all([writer, ...reads])
            assert.equal(kernel.pending(), undefined)
        })
    }

    it("bounds captured storage, live indexes and completion work in the compact-history controls", function () {
        this.timeout(15000)
        const fixture = fileURLToPath(new URL("./experiments/phase6-selection-work.mjs", import.meta.url))
        const result = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict", fixture],
            { encoding: "utf8", timeout: 10000 })
        assert.equal(result.error, undefined, String(result.error))
        assert.equal(result.status, 0, result.stderr || result.stdout)
        assert.equal(JSON.parse(result.stdout).accepted, true)
    })

    for (const fault of [false, true]) {
        it(fault ? "detects repeated traversal when shared waits are disabled" :
            "bounds repeated scoped waits, including different cutoffs with the same remaining effects", function () {
            this.timeout(20000)
            const fixture = fileURLToPath(new URL("./experiments/phase6-repeated-waits.mjs", import.meta.url))
            const result = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict", fixture,
                ...(fault ? ["--without-sharing"] : [])], { encoding: "utf8", timeout: 15000 })
            assert.equal(result.error, undefined, String(result.error))
            assert.equal(result.status, fault ? 1 : 0, result.stderr || result.stdout)
            assert.equal(JSON.parse(result.stdout).faultApplied, fault)
            if (fault) assert.match(result.stderr, /identical captured read dependencies must not be re-walked/)
        })
    }
})
