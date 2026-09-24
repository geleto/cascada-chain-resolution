import assert from "node:assert/strict"
import * as runtime from "../src/index.js"
import { LengthState } from "../src/array-length.js"
import { ArrayView } from "../src/array-view.js"
import { metaOf } from "../src/meta.js"
import { readLanguageProperty } from "../src/language-properties.js"
import { OperationOwner } from "../src/operation-lifecycle.js"
import { arrayBacking, testOperationContext, flushMicrotasks } from "./support.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { createRandom, randomInteger } from "./native-equivalence-support.js"

// Count traversal work instead of relying on machine-dependent timings. This
// instruments the existing list without adding a production profiling hook.
function countLinkReads(state) {
    let reads = 0
    for (let node = state.head; node; node = node.next) {
        for (const key of ["previous", "next"]) {
            let value = node[key]
            Object.defineProperty(node, key, {
                get() { reads++; return value },
                set(next) { value = next },
            })
        }
    }
    return () => reads
}

describe("captured Array length knowledge", () => {
    for (const created of [false, true]) {
        it(`keeps possible growth logical and preserves earlier questions, created=${created}`, async () => {
            const context = testOperationContext("possible growth"), storage = [1, 2]
            const chain = new runtime.Chain(storage, context), hold = Promise.withResolvers()
            const entry = runtime.enter(chain, [5], context, true, inside => hold.promise.then(() => {
                if (created) runtime.assignPath(inside, [], 5, context)
            }))
            const view = ArrayView.projectionOf(chain._state.value, context)
            assert.equal(ArrayView.minimumLength(view, context), 2)
            assert.equal(ArrayView.readyLength(view, context), undefined)
            assert.equal(storage.length, 2)
            assert.equal(Object.hasOwn(storage, 5), false)
            const earlier = runtime.lookupPath(chain, ["length"], context)
            runtime.assignPath(chain, [7], 7, context)
            assert.equal(runtime.lookupPath(chain, ["length"], context), 8)
            // Derivation can share the now-known range while the older question
            // still waits for its own prefix. Later writes must preserve the shared backing.
            const appended = runtime.run(chain, [], "concat", [[9]], context, {})
            assert.equal(arrayBacking(appended, context), storage)
            hold.resolve()
            await entry
            assert.equal(await earlier, created ? 6 : 2)
            const expected = [1, 2]
            expected.length = 8
            if (created) expected[5] = 5
            expected[7] = 7
            assert.deepEqual(await runtime.export(new runtime.Chain(appended, context), [], context), expected.concat(9))
            assert.deepEqual(await runtime.export(chain, [], context), expected)
            assert.equal(storage.length, 9)
        })
    }

    it("reuses unchanged backing after a no-op entry", async () => {
        const context = testOperationContext("no-op backing reuse"), storage = [1, 2]
        const chain = new runtime.Chain(storage, context), hold = Promise.withResolvers()
        const entry = runtime.enter(chain, [9], context, true, () => hold.promise)
        assert.equal(storage.length, 2)
        hold.resolve()
        await entry
        assert.equal(runtime.lookupPath(chain, ["length"], context), 2)
        const appended = runtime.run(chain, [], "concat", [[3]], context, {})
        assert.equal(arrayBacking(appended, context), storage)
        assert.deepEqual(storage, [1, 2, 3])
        assert.deepEqual(runtime.export(chain, [], context), [1, 2])
        assert.deepEqual(runtime.export(new runtime.Chain(appended, context), [], context), [1, 2, 3])
    })

    it("starts new length history without retargeting earlier questions", async () => {
        const context = testOperationContext("successive length histories"), chain = new runtime.Chain([], context)
        const first = Promise.withResolvers(), second = Promise.withResolvers()
        const earlierEntry = runtime.enter(chain, [5], context, true, () => first.promise)
        const earlierLength = runtime.lookupPath(chain, ["length"], context)
        runtime.assignPath(chain, [7], 7, context)
        assert.equal(runtime.lookupPath(chain, ["length"], context), 8)
        const laterEntry = runtime.enter(chain, [9], context, true, inside => second.promise.then(() =>
            runtime.assignPath(inside, [], 9, context)))
        const laterLength = runtime.lookupPath(chain, ["length"], context)
        second.resolve()
        await laterEntry
        assert.equal(await laterLength, 10)
        first.resolve()
        await earlierEntry
        assert.equal(await earlierLength, 0)
        assert.equal(runtime.lookupPath(chain, ["length"], context), 10)
    })

    it("copies before entering storage shared with another view", async () => {
        const context = testOperationContext("occupied tail"), storage = [1, 2]
        const chain = new runtime.Chain(storage, context)
        const longer = runtime.run(chain, [], "concat", [[3]], context, {})
        const hold = Promise.withResolvers()
        const entry = runtime.enter(chain, [5], context, true, inside => hold.promise.then(() =>
            runtime.assignPath(inside, [], 6, context)))
        const owned = readLanguageProperty(chain._state, "value", context)
        assert.notEqual(arrayBacking(owned, context), storage)
        assert.equal(arrayBacking(owned, context).length, 2)
        assert.deepEqual(storage, [1, 2, 3])
        hold.resolve()
        await entry
        assert.deepEqual(runtime.export(chain, [], context), [1, 2, , , , 6])
        assert.deepEqual(runtime.export(new runtime.Chain(longer, context), [], context), [1, 2, 3])
    })

    for (const projected of [false, true]) {
        it(`preserves shared backing without a physical tail, projected=${projected}`, () => {
            const context = testOperationContext("shared equal bounds"), storage = [1, 2]
            const chain = new runtime.Chain(storage, context)
            if (projected) runtime.enter(chain, [5], context, true, () => undefined)
            const retained = runtime.run(chain, [], "slice", [], context, {})
            assert.equal(arrayBacking(retained, context), storage)
            assert.equal(storage.length, 2)
            runtime.assignPath(chain, [0], 9, context)
            assert.notEqual(arrayBacking(chain._state.value, context), storage)
            assert.deepEqual(runtime.export(chain, [], context), [9, 2])
            assert.deepEqual(runtime.export(new runtime.Chain(retained, context), [], context), [1, 2])
        })
    }

    it("keeps truncated values absent after indexed mutation and later growth", () => {
        const context = testOperationContext("shrink then grow"), storage = [1, 2, 3]
        const chain = new runtime.Chain(storage, context)
        runtime.enter(chain, [5], context, true, () => undefined)
        runtime.assignPath(chain, ["length"], 1, context)
        assert.equal(storage.length, 3)
        runtime.assignPath(chain, [0], 9, context)
        assert.notEqual(arrayBacking(chain._state.value, context), storage)
        runtime.assignPath(chain, ["length"], 3, context)
        assert.deepEqual(runtime.export(chain, [], context), [9, , ,])
    })

    for (const shared of [false, true]) {
        it(`copies only the retained range for length assignment, shared=${shared}`, () => {
            const context = testOperationContext("bounded resize copy")
            let discardedReads = 0, subscriptions = 0
            const storage = [1, 2, 3, 4, { then(resolve) { subscriptions++; resolve(5) } }]
            if (!shared) Object.defineProperty(storage, "length", { writable: false })
            const source = new Proxy(storage, {
                getOwnPropertyDescriptor(target, key) {
                    if (/^[1-4]$/.test(key)) discardedReads++
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const chain = new runtime.Chain(source, context)
            if (shared) runtime.lookupPath(chain, [], context)
            discardedReads = 0

            assert.equal(runtime.assignPath(chain, ["length"], 1, context), undefined)
            assert.equal(discardedReads, 0, "copying must not inspect discarded elements")
            assert.equal(subscriptions, 0, "copying must not consume discarded payloads")
            assert.deepEqual(runtime.export(chain, [], context), [1])
            assert.equal(storage.length, 5)
            verifyRefCounts(context, chain._state)
        })
    }
    it("preserves independent backing and length after COW", async () => {
        const context = testOperationContext("copied length"), storage = [1, 2]
        const chain = new runtime.Chain(storage, context), hold = Promise.withResolvers()
        const entry = runtime.enter(chain, [9], context, true, () => hold.promise)
        const earlier = new runtime.Chain(runtime.lookupPath(chain, [], context), context)
        runtime.assignPath(chain, [0], 8, context)
        const copiedBacking = arrayBacking(chain._state.value, context)
        assert.notEqual(copiedBacking, storage)
        assert.equal(copiedBacking.length, 2)
        hold.resolve()
        await entry
        await flushMicrotasks()
        const first = runtime.run(earlier, [], "concat", [[3]], context, {})
        const second = runtime.run(chain, [], "concat", [[4]], context, {})
        assert.equal(arrayBacking(first, context), storage)
        assert.equal(arrayBacking(second, context), copiedBacking)
        assert.deepEqual(storage, [1, 2, 3])
        assert.deepEqual(copiedBacking, [8, 2, 4])
    })

    it("prepares native receiver length after no-growth completion", async () => {
        const context = testOperationContext("native receiver length")
        const chain = new runtime.Chain({ items: [1, 2], size() { return this.items.length } }, context)
        const hold = Promise.withResolvers()
        const entry = runtime.enter(chain, ["items", 9], context, true, () => hold.promise)
        const size = runtime.run(chain, [], "size", [], context, {})
        hold.resolve()
        await entry
        assert.equal(await size, 2)
    })

    it("protects imported storage through entry and resize", async () => {
        const context = testOperationContext("imported tail"), original = [1, 2]
        let writes = 0
        const source = new Proxy(original, {
            set() { writes++; throw new Error("imported storage was written") },
            defineProperty() { writes++; throw new Error("imported storage was written") },
        })
        const chain = new runtime.ContextChain(source, context), hold = Promise.withResolvers()
        const entry = runtime.enter(chain, [7], context, true, () => hold.promise)
        assert.equal(writes, 0)
        assert.deepEqual(original, [1, 2])
        hold.resolve()
        await entry
        runtime.run(chain, [], "push", [3], context, { mutationScopeDepth: 0 })
        assert.deepEqual(runtime.export(chain, [], context), [1, 2, 3])
        assert.deepEqual(original, [1, 2])
        assert.equal(writes, 0)
    })

    it("keeps sparse traversal bounded beside possible growth", async () => {
        const context = testOperationContext("sparse pending growth")
        const storage = new Array(100000)
        storage[0] = 1
        let descriptors = 0
        const source = new Proxy(storage, {
            getOwnPropertyDescriptor(target, key) { descriptors++; return Reflect.getOwnPropertyDescriptor(target, key) },
        })
        const chain = new runtime.Chain(source, context), hold = Promise.withResolvers()
        const entry = runtime.enter(chain, [200000], context, true, () => hold.promise)
        descriptors = 0
        const error = runtime.hasError(chain, [], context)
        assert(descriptors < 20, `Sparse traversal read ${descriptors} descriptors`)
        hold.resolve()
        await entry
        assert.equal(await error, false)
    })

    it("commits index growth without a fallible length read after the write", () => {
        const context = testOperationContext("atomic Array growth")
        let written = false
        const chain = new runtime.ContextChain({
            make() {
                this.items = new Proxy([1], {
                    get(target, key, receiver) {
                        if (key === "length" && written) throw new Error("post-write length read")
                        return Reflect.get(target, key, receiver)
                    },
                    defineProperty(target, key, descriptor) {
                        const result = Reflect.defineProperty(target, key, descriptor)
                        if (key === "2") written = true
                        return result
                    },
                })
            },
        }, context)
        runtime.run(chain, [], "make", [], context, { mutationScopeDepth: 0 })
        const result = runtime.assignPath(chain, ["items", 2], 3, context)
        written = false
        assert.equal(result, undefined)
        assert.deepEqual(runtime.export(chain, ["items"], context), [1, , 3])
    })

    for (const reverse of [false, true]) {
        it(`issues independent element entries without copying or multiplying length work, reverse=${reverse}`, async () => {
            const count = 256, context = testOperationContext("independent element entries")
            const chain = new runtime.Chain([], context)
            const holds = Array.from({ length: count }, () => Promise.withResolvers())
            let owned
            const entries = holds.map((hold, index) => {
                const entry = runtime.enter(chain, [index], context, true,
                    inside => hold.promise.then(() => runtime.assignPath(inside, [], index, context)))
                const current = readLanguageProperty(chain._state, "value", context)
                owned ??= current
                assert.equal(current, owned)
                return entry
            })
            const reads = countLinkReads(metaOf(owned, context).arrayView._lengthState)
            for (let turn = 0; turn < count; turn++) {
                const index = reverse ? count - turn - 1 : turn
                holds[index].resolve()
                await entries[index]
            }
            assert.deepEqual(await runtime.export(chain, [], context), Array.from({ length: count }, (_, index) => index))
            assert(reads() < count * 64, `Entry completion used ${reads()} link reads`)
        })
    }

    it("captures many reads without copying or subscribing length histories", () => {
        const count = 256, state = new LengthState(0)
        const sources = Array.from({ length: count }, (_, index) => state.add(index + 1))
        const reads = countLinkReads(state)
        const captures = Array.from({ length: count }, () => state.capture())
        assert(sources.every(source => source.nodes.size === 0))
        assert(reads() < count * 16, `Captures used ${reads()} link reads`)
        state.grow(count + 1) // Earlier markers must exclude later growth.
        for (const source of sources) source.complete(false)
        for (const capture of captures) assert.equal(capture.read(), 0)
        assert.equal(state.minimum, count + 1)
        assert.equal(state.head, undefined)
    })

    it("releases passive captures independently from live length questions", async () => {
        const state = new LengthState(0), source = state.add(6)
        const owner = new OperationOwner(testOperationContext("passive capture lifetime"))
        const discarded = state.capture(owner), retained = state.capture()
        const pending = state.resolve(owner, value => value)
        owner.close()
        discarded.release()
        assert.equal(source.nodes.size, 0)
        source.complete(true)
        assert.equal(retained.read(), 6)
        assert.equal(state.head, undefined)
        // Closing the owner releases its question; it does not settle its wait.
        assert(pending instanceof Promise)
    })

    it("matches an independent model for passive captures across forks and closure", async () => {
        const random = createRandom(0x9fc319)
        const pick = n => randomInteger(random, n)
        const bounds = facts => [Math.max(0, ...facts.map(fact => fact.value ?? 0)),
            Math.max(0, ...facts.map(fact => fact.value ?? fact.bound))]
        for (let run = 0; run < 160; run++) {
            const states = [{ state: new LengthState(0), facts: [] }], sources = [], captures = [], questions = []
            for (let turn = 0; turn < 50; turn++) {
                const { state, facts } = states[pick(states.length)], action = pick(8)
                if (action === 0) {
                    const fact = { bound: pick(30) + 1 }
                    facts.push(fact)
                    sources.push({ fact, source: state.add(fact.bound) })
                } else if (action === 1) {
                    const value = pick(35)
                    facts.push({ bound: value, value })
                    state.grow(value)
                } else if (action === 2 && sources.length) {
                    const { fact, source } = sources[pick(sources.length)]
                    if (fact.value === undefined) {
                        fact.value = pick(2) ? fact.bound : 0
                        source?.complete(fact.value !== 0)
                    }
                } else if (action === 3) captures.push({ length: state.capture(), facts: facts.slice() })
                else if (action === 4) {
                    const copy = state.fork()
                    states.push({ state: typeof copy === "number" ? new LengthState(copy) : copy, facts: facts.slice() })
                } else if (action === 5) {
                    const work = new OperationOwner(testOperationContext("mixed length questions"))
                    const question = { work, index: pick(2) ? pick(35) : undefined, facts: facts.slice() }
                    state.resolve(work, value => { question.answer = value }, question.index)
                    questions.push(question)
                } else if (action === 6 && captures.length) captures.splice(pick(captures.length), 1)[0].length.release?.()
                else if (action === 7 && questions.length) questions[pick(questions.length)].work.close()
                await flushMicrotasks()
                // Leave most captures unread, so later reads exercise lazy refresh.
                if (captures.length) {
                    const index = pick(captures.length), capture = captures[index], [low, high] = bounds(capture.facts)
                    if (low === high) {
                        assert.equal(typeof capture.length === "number" ? capture.length : capture.length.read(), low)
                        captures.splice(index, 1)
                    }
                }
                for (const question of questions) {
                    if (!question.work.open) continue
                    const [low, high] = bounds(question.facts)
                    question.expected ??= question.index === undefined ? low === high ? low : undefined :
                        question.index < low ? true : question.index >= high ? false : undefined
                    assert.equal(question.answer, question.expected)
                }
            }
            for (const { fact, source } of sources) if (fact.value === undefined) {
                fact.value = 0
                source?.complete(false)
            }
            for (const { length, facts } of captures)
                assert.equal(typeof length === "number" ? length : length.read(), bounds(facts)[0])
            for (const question of questions) question.work.close()
        }
    })

    for (const largestFirst of [false, true]) {
        it(`reclaims dominated growth before repeated ready reads, largest first=${largestFirst}`, () => {
            const count = 1000, state = new LengthState(0)
            const largest = largestFirst ? state.add(count + 1) : undefined
            const sources = Array.from({ length: count }, (_, index) => state.add(index + 1))
            const last = largest ?? state.add(count + 1)
            const work = new OperationOwner(testOperationContext("dominated growth"))
            const reads = countLinkReads(state)
            last.complete(true)
            assert.equal(state.resolve(work, value => value), count + 1)
            assert(!state.head, "Dominated contributions were not reclaimed")
            for (let index = count - 1; index >= 0; index--) {
                sources[index].complete(index % 2 === 0)
                assert.equal(state.resolve(work, value => value), count + 1)
                assert.equal(state.resolve(work, value => value, count), true)
                assert.equal(state.resolve(work, value => value, count + 1), false)
            }
            assert(reads() < count * 64, `Ready reads used ${reads()} link reads`)
            assert(sources.every(source => source.nodes.size === 0))
            work.close()
        })
    }

    for (const created of [false, true]) {
        it(`settles backwards without rescanning an unaffected prefix, created=${created}`, async () => {
            const count = 1000, state = new LengthState(0)
            const sources = Array.from({ length: count }, (_, index) => state.add(count - index))
            const work = new OperationOwner(testOperationContext("incremental length settlement"))
            const pending = state.resolve(work, value => value)
            const reads = countLinkReads(state)
            for (let index = count - 1; index >= 0; index--) sources[index].complete(created)
            assert.equal(await pending, created ? count : 0)
            assert(reads() < count * 64, `Settlement used ${reads()} link reads`)
            assert.equal(state.head, undefined)
            assert(sources.every(source => source.nodes.size === 0))
            work.close()
        })
    }

    it("updates subscriptions only where the last pending question changes", () => {
        const count = 1000, state = new LengthState(0)
        const sources = Array.from({ length: count }, (_, index) => state.add(index + 1))
        const reads = countLinkReads(state)
        const work = Array.from({ length: count }, () => {
            const owner = new OperationOwner(testOperationContext("incremental length subscriptions"))
            state.resolve(owner, value => value)
            return owner
        })
        for (let index = count - 1; index >= 0; index--) work[index].close()
        assert(reads() < count * 32, `Subscription changes used ${reads()} link reads`)
        assert(sources.every(source => source.nodes.size === 0))
    })

    it("refreshes an unobserved tail without adding its growth to earlier questions", async () => {
        const state = new LengthState(0), earlier = state.add(6), later = state.add(9)
        const work = new OperationOwner(testOperationContext("partly observed length"))
        const exact = state.resolve(work, value => value)
        const range = state.resolve(work, value => value, 5)
        const copy = state.fork(), tail = state.add(12)
        tail.complete(true)
        assert.equal(tail.nodes.size, 0)
        later.complete(false) // Starts after the still-pending earlier source.
        assert.equal(state.minimum, 12)
        assert.equal(state.maximum, 12)
        assert.equal(copy.minimum, 0)
        assert.equal(copy.maximum, 6)
        earlier.complete(false)
        assert.equal(await exact, 0)
        assert.equal(await range, false)
        assert.equal(copy.minimum, 0)
        assert.equal(copy.maximum, 0)
        assert.equal(state.minimum, 12)
        work.close()
    })

    it("agrees with a branching oracle across active and lazy captures", async () => {
        let seed = 0x913adc
        const random = n => Math.floor(((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32) * n)
        const bounds = facts => [Math.max(0, ...facts.map(source => source.value ?? 0)),
            Math.max(0, ...facts.map(source => source.value ?? source.bound))]
        for (let run = 0; run < 600; run++) {
            const startSeed = seed, context = testOperationContext("branching length oracle")
            const states = [{ state: new LengthState(0), facts: [] }], sources = [], questions = [], trace = []
            for (let turn = 0; turn < 55; turn++) {
                const branch = random(states.length), { state, facts } = states[branch], action = random(6)
                const command = { branch, action }
                trace.push(command)
                if (action === 0) {
                    const bound = command.bound = random(30) + 1, fact = { bound }
                    sources.push({ source: state.add(bound), fact })
                    facts.push(fact)
                } else if (action === 1) {
                    const value = command.value = random(35)
                    state.grow(value)
                    facts.push({ value })
                } else if (action === 2 && sources.length) {
                    const { source, fact } = sources[command.source = random(sources.length)]
                    if (fact.value === undefined) {
                        fact.value = command.value = random(2) ? fact.bound : 0
                        source?.complete(fact.value !== 0)
                    }
                } else if (action === 3) {
                    const copy = state.fork()
                    states.push({ state: typeof copy === "number" ? new LengthState(copy) : copy, facts: facts.slice() })
                } else if (action === 4) {
                    const index = command.index = random(2) ? random(35) : undefined
                    const work = new OperationOwner(context), question = { facts: facts.slice(), index, work }
                    questions.push(question)
                    state.resolve(work, value => question.answer = value, index)
                } else if (action === 5 && questions.length) {
                    questions[command.question = random(questions.length)].work.close()
                }
                await flushMicrotasks()
                const message = `seed=${startSeed}, turn=${turn}: ${JSON.stringify(trace)}`
                for (const question of questions) {
                    if (!question.work.open) continue
                    const [minimum, maximum] = bounds(question.facts)
                    question.expected ??= question.index === undefined
                        ? minimum === maximum ? minimum : undefined
                        : question.index < minimum ? true : question.index >= maximum ? false : undefined
                    assert.equal(question.answer, question.expected, message)
                }
                // Vary which inactive copies get read; inspecting every copy
                // on every turn would hide stale state in incremental updates.
                const inspected = states[random(states.length)]
                assert.deepEqual([inspected.state.minimum, inspected.state.maximum], bounds(inspected.facts), message)
            }
            for (const { state, facts } of states) {
                assert.deepEqual([state.minimum, state.maximum], bounds(facts))
            }
            for (const question of questions) question.work.close()
        }
    })

    it("agrees with an independent prefix oracle across settlement and capture orders", async () => {
        const generator = createRandom(9)
        const random = n => randomInteger(generator, n)
        const coverage = new Set()
        for (let schedule = 0; schedule < 1000; schedule++) {
            const state = new LengthState(random(3))
            const baseline = state.baseline
            const sources = []
            const questions = []
            const work = new OperationOwner(testOperationContext("length oracle"))
            function ask(index) {
                const question = { index, prefix: [...sources] }
                questions.push(question)
                const answer = state.resolve(work, value => { question.answer = value; return value }, index)
                coverage.add(`${index === undefined ? "length" : index % 2 ? "odd" : "even"}:${answer instanceof Promise ? "pending" : "ready"}`)
                if (!(answer instanceof Promise)) assert.notEqual(question.answer, undefined)
            }
            for (let turn = 0; turn < 12; turn++) {
                const action = random(4)
                if (action === 0 || sources.length === 0) {
                    const bound = random(9) + 1
                    sources.push({ bound, source: state.add(bound) })
                } else if (action === 1) {
                    const source = sources[random(sources.length)]
                    if (source.value === undefined) {
                        source.value = random(2) ? source.bound : 0
                        source.source?.complete(source.value !== 0)
                    }
                } else if (action === 2) {
                    const value = random(10)
                    sources.push({ bound: value, value })
                    state.grow(value)
                } else ask(random(2) ? random(10) : undefined)
                await flushMicrotasks()
                for (const question of questions) {
                    if (question.expected !== undefined) continue
                    const minimum = Math.max(baseline, ...question.prefix.map(source => source.value ?? 0))
                    const maximum = Math.max(minimum, ...question.prefix.map(source => source.value ?? source.bound))
                    question.expected = question.index === undefined
                        ? minimum === maximum ? minimum : undefined
                        : question.index < minimum ? true : question.index >= maximum ? false : undefined
                    assert.equal(question.answer, question.expected, `schedule ${schedule}, turn ${turn}`)
                }
            }
            work.close()
        }
        for (const kind of ["length", "even", "odd"]) for (const readiness of ["ready", "pending"])
            assert(coverage.has(`${kind}:${readiness}`), `missing ${kind} ${readiness} question`)
    })

    it("answers later dominated captures without crossing an earlier watcher", async () => {
        const state = new LengthState(0)
        const work = new OperationOwner(testOperationContext("length boundaries"))
        const source = state.add(6)
        let first
        const pending = state.resolve(work, value => first = value)
        const inRange = state.resolve(work, value => value, 5)
        const copy = state.fork()
        state.grow(8)
        assert.equal(state.resolve(work, value => value), 8)
        assert.equal(first, undefined)
        source.complete(false)
        await pending
        assert.equal(first, 0)
        assert.equal(await inRange, false)
        assert.equal(copy.resolve(work, value => value), 0)
        assert.equal(state.minimum, 8)
        assert.equal(state.head, undefined)
        work.close()
    })

    it("coalesces settled history behind an unresolved head and releases closed watchers", () => {
        const state = new LengthState(0)
        const work = new OperationOwner(testOperationContext("length reclamation"))
        const source = state.add(100000)
        state.resolve(work, value => value)
        for (let length = 1; length <= 10000; length++) state.grow(length)
        let count = 0
        for (let node = state.head; node; node = node.next) count++
        assert.equal(count, 3)
        work.close()
        assert.equal(state.head.next, state.tail)
        source.complete(false)
        assert.equal(state.minimum, 10000)
        assert.equal(state.head, undefined)
    })

    it("subscribes captured sequences only while a question needs delivery", async () => {
        const state = new LengthState(0), source = state.add(6)
        const copies = Array.from({ length: 1000 }, () => state.fork())
        assert.equal(source.nodes.size, 0)
        const work = new OperationOwner(testOperationContext("fork subscriptions"))
        const pending = copies[0].resolve(work, value => value)
        assert.equal(source.nodes.size, 1)
        state.grow(8)
        assert.equal(state.minimum, 8)
        source.complete(true)
        assert.equal(await pending, 6)
        assert.equal(source.nodes.size, 0)
        for (const copy of copies) {
            assert.equal(copy.minimum, 6)
            assert.equal(copy.maximum, 6)
            assert.equal(copy.head, undefined)
        }
        assert.equal(state.minimum, 8)
        work.close()
    })

    it("drops a fork's subscriptions on closure without changing its captured outcomes", () => {
        const state = new LengthState(0), earlier = state.add(3), later = state.add(6)
        const copy = state.fork(), work = new OperationOwner(testOperationContext("closed fork"))
        copy.resolve(work, value => value)
        assert.equal(earlier.nodes.size, 1)
        assert.equal(later.nodes.size, 1)
        work.close()
        assert.equal(earlier.nodes.size, 0)
        assert.equal(later.nodes.size, 0)
        earlier.complete(true)
        assert.equal(copy.minimum, 3)
        assert.equal(copy.maximum, 6)
        later.complete(false)
        assert.equal(copy.minimum, 3)
        assert.equal(copy.maximum, 3)
    })
})
