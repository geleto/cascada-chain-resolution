import assert from "node:assert/strict"
import * as runtime from "../src/index.js"
import { LengthState } from "../src/array-length.js"
import { metaOf } from "../src/meta.js"
import { readLanguageProperty } from "../src/language-properties.js"
import { OperationOwner } from "../src/operation-lifecycle.js"
import { testOperationContext, flushMicrotasks } from "./support.js"
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
            const reads = countLinkReads(metaOf(owned, context).arrayLength)
            for (let turn = 0; turn < count; turn++) {
                const index = reverse ? count - turn - 1 : turn
                holds[index].resolve()
                await entries[index]
            }
            assert.deepEqual(await runtime.export(chain, [], context), Array.from({ length: count }, (_, index) => index))
            assert(reads() < count * 64, `Entry completion used ${reads()} link reads`)
        })
    }

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
        state.release()
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
                state.release()
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
            state.release()
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
