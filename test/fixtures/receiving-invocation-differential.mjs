import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import * as r from "../../src/index.js"
import { assertGraph } from "../graph-oracle.js"
import { ready, rejected, OrderedThenable } from "../ordered-thenable.js"
import { createRandom } from "../native-equivalence-support.js"
import { runGeneratedCases, reportGeneratedStage } from "../generated-runner.js"

export const routes = ["import", "method-result", "host-result", "observation", "snapshot", "managed-result"]
export const deliveries = ["ready", "synchronous", "native", "ordered", "reversed"]
const turn = () => new Promise(setImmediate)

// Generate scalar choices, shape, and writes before creating any execution.
// Every replay has five input containers, at most two pending graph leaves and
// one root signal, one native mutation, one to three generated path writes, and
// three to five graph observations. More seeds sample this bounded vocabulary.
export function receivingPrograms(seeds = 8) {
    return Array.from({ length: seeds }, (_, seed) => {
        const random = createRandom(seed + 1)
        const writes = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
            target: random() < 0.5 ? "left" : "right", value: 2000 + Math.floor(random() * 1000),
        }))
        return { seed, value: Math.floor(random() * 1000), delta: 1 + Math.floor(random() * 17),
            changed: writes[0].value, writes, sparse: !!(seed & 1), prepared: !!(seed & 2),
            availability: seed & 4 ? "root" : "nested" }
    })
}

function context(execution, errorContext) { return { execution, errorContext } }
function pendingDelivery(delivery) { return !["ready", "synchronous"].includes(delivery) }
function source(delivery, value, failed = false) {
    if (!pendingDelivery(delivery)) return {
        value: failed ? rejected(value) : delivery === "ready" ? value : ready(value),
        settle() {},
    }
    const signal = delivery === "native" ? Promise.withResolvers() : new OrderedThenable()
    return { value: signal.promise ?? signal, settle() { signal[failed ? "reject" : "resolve"](value) } }
}

function graph(program, first, second, healthy, bump) {
    const child = { k: program.value }; child.self = child
    const distinct = { k: program.value }
    const items = program.sparse ? [child, , distinct, child] : [child, distinct, child]
    const root = { left: child, right: child, distinct, items, total: program.value,
        first, second, healthy, bump }
    root.self = root
    return root
}

function cloneGraph(value, seen = new Map()) {
    if (!value || typeof value !== "object" || Error.isError(value)) return value
    if (seen.has(value)) return seen.get(value)
    const copy = Array.isArray(value) ? new Array(value.length) : {}
    seen.set(value, copy)
    for (const key of Object.keys(value)) copy[key] = cloneGraph(value[key], seen)
    return copy
}

function receive(route, value, ctx, change = () => {}) {
    if (route === "import") return { value: r.import(value, ctx) }
    if (route === "method-result") return { value: r.importMethodResult(value, ctx) }
    const host = { object: value, give() { return value }, change }
    if (route === "managed-result") return { value: r.run(new r.Chain({ give: host.give }, ctx), [], "give", [], ctx, {}) }
    r.externalState(host)
    if (route === "snapshot") {
        const chain = new r.ContextChain({ host }, ctx, { host: {} })
        return { value: r.lookupPath(chain, ["host", "object"], ctx), chain, host }
    }
    const chain = new r.Chain(host, ctx)
    return { value: route === "host-result" ? r.run(chain, [], "give", [], ctx, {})
        : r.lookupPath(chain, ["object"], ctx), chain, host }
}

// The all-ready oracle is constructed without runtime metadata. A native ! call
// adopts a complete detached receiver; a subsequent path write changes one
// occurrence while the old self edge continues to name its captured generation.
async function healthyHistory(program, route, delivery, fault) {
    const execution = new r.Execution(), ctx = context(execution, "receive")
    const healthy = new Error("healthy native Error data")
    const bump = function (amount) { this.total += amount; return this.total }
    const snapshot = route === "snapshot"
    const rootAvailability = snapshot || program.availability === "root"
    const first = source(rootAvailability ? "ready" : delivery, program.value + 1)
    const second = source(rootAvailability ? "ready" : delivery, program.value + 2)
    const hostGraph = graph(program, snapshot ? program.value + 1 : first.value,
        snapshot ? program.value + 2 : second.value, healthy, bump)
    const original = graph(program, program.value + 1, program.value + 2, healthy, bump)
    const mutated = cloneGraph(original); mutated.total += program.delta
    const root = rootAvailability ? source(delivery, hostGraph) : undefined
    // A mutable snapshot is a new capture domain, never a re-import of its host.
    const prepared = program.prepared && !snapshot
        ? new r.Chain(r.import(hostGraph, context(execution, "prepare")), ctx) : undefined
    const received = receive(route, rootAvailability ? root.value : hostGraph, ctx, () => { hostGraph.total += 10000 })
    assert.equal(r.isPending(received.value, ctx), rootAvailability && pendingDelivery(delivery),
        "selected receiving route actually crosses the promised root availability")
    const chain = new r.Chain(received.value, ctx)
    const before = r.export(chain, [], context(execution, "before native mutation"))
    const called = r.run(chain, [], "bump", [program.delta], context(execution, "native mutation"), { mutationScopeDepth: 0 })
    const afterNative = r.export(chain, [], context(execution, "after native mutation"))
    const assignments = [], afterWrites = [], expectedWrites = []
    let changed = mutated
    for (const write of program.writes) {
        assignments.push(r.assignPath(chain, [write.target, "k"], write.value, context(execution, "path write")))
        afterWrites.push(r.export(chain, [], context(execution, "after path write")))
        changed = { ...changed, [write.target]: { ...changed[write.target], k: write.value } }
        expectedWrites.push(changed)
    }
    const pending = pendingDelivery(delivery)
    assert.equal(r.isPending(before, ctx), fault === "completion" ? !pending : pending,
        "export completion includes captured graph availability")
    assert.equal(r.isPending(called, ctx), pending, "native mutation completion includes receiver preparation")
    // Assignment is an issuance acknowledgement; afterWrite is the publication
    // witness. Never infer publication completion merely from assigned's value.
    if (!pending) for (const acknowledgement of assignments) assert.equal(acknowledgement, undefined)
    let hostMutation
    if (snapshot) {
        hostMutation = r.run(received.chain, ["host"], "change", [], context(execution, "later host mutation"), { mutationScopeDepth: 1 })
        if (pending) assert.equal(hostGraph.total, program.value, "earlier snapshot reserves mutable host data")
    }
    const order = delivery === "reversed" ? [second, first] : [first, second]
    if (rootAvailability) root.settle()
    else for (const signal of order) signal.settle()
    const [oldOutput, callResult, nativeOutput, acknowledgements, outputs] = await Promise.all([
        before, called, afterNative, Promise.all(assignments), Promise.all(afterWrites),
    ])
    const output = outputs.at(-1)
    await hostMutation
    for (const acknowledgement of acknowledgements) assert.equal(acknowledgement, undefined)
    assert.equal(callResult, fault === "effect" ? program.value : program.value + program.delta,
        "completed ! call returns the value after its effect")
    if (fault === "value") output.left.k++
    if (fault === "alias") oldOutput.right = { ...oldOutput.right }
    assertGraph(oldOutput, original)
    assertGraph(nativeOutput, mutated)
    for (const [index, actual] of outputs.entries()) assertGraph(actual, expectedWrites[index])
    assert.equal(oldOutput.healthy, healthy, "healthy Error retains exact identity")
    assert.equal(await r.hasError(chain, [], ctx), false)
    assert.equal(await r.getErrors(chain, [], ctx), null)
    // The source keeps its exact pending storage and original topology. Snapshot
    // host mutation is explicitly authorized and must finish after its capture.
    const hostExpected = graph(program, snapshot ? program.value + 1 : first.value,
        snapshot ? program.value + 2 : second.value, healthy, bump)
    if (snapshot) hostExpected.total += 10000
    assertGraph(hostGraph, hostExpected)
    if (prepared) assertGraph(await r.export(prepared, [], ctx), original)
    assert.equal(execution.fatalError, null)
    return [callResult, output.left.k, output.right.k, output.items.length,
        output.left === output.right, output.right === output.items[0], output.self.total]
}

function assertPoison(actual, expected, fault) {
    assert(r.isPoisonError(actual), "required failure is poison")
    const leaves = actual.errors ?? [actual]
    const observed = leaves.map(leaf => {
        const index = expected.findIndex(entry => entry.cause === leaf.cause)
        assert(index >= 0, "poison has an exact expected native cause")
        assert.equal(leaf.kind, expected[index].kind, "causal kind")
        assert.equal(leaf.errorContext, expected[index].source, "causal source")
        return index
    }).sort()
    assert.deepEqual(fault === "poison" ? observed.slice(1) : observed,
        expected.map((_, index) => index), "complete exact poison membership")
}

async function poisonHistory(program, route, delivery, fault) {
    const execution = new r.Execution(), ctx = context(execution, "receive failures")
    const causes = [new Error(`first ${program.value}`), new Error(`second ${program.changed}`)]
    const producer = context(execution, program.prepared && route !== "snapshot" ? "prepare failures" : ctx.errorContext)
    const expected = causes.map(cause => ({ cause, kind: r.ERROR_KIND.OperationInputFailed, source: producer.errorContext }))
    // Snapshot data is ready-only. Its equivalent poison control is already
    // contextualized poison; other routes reject at their actual consuming edge.
    const rootAvailability = route === "snapshot" || program.availability === "root"
    const leaves = route === "snapshot" ? undefined : causes.map(cause => source(rootAvailability ? "ready" : delivery, cause, true))
    const healthy = new Error("healthy sibling")
    const graph = { safe: program.value, first: route === "snapshot" ? r.createPoisonError(causes[0], producer, r.ERROR_KIND.OperationInputFailed) : leaves[0].value,
        second: route === "snapshot" ? r.createPoisonError(causes[1], producer, r.ERROR_KIND.OperationInputFailed) : leaves[1].value, healthy }
    graph.self = graph
    const prepared = program.prepared && route !== "snapshot" ? new r.Chain(r.import(graph, producer), ctx) : undefined
    const root = rootAvailability ? source(delivery, graph) : undefined
    const received = receive(route, rootAvailability ? root.value : graph, ctx)
    assert.equal(r.isPending(received.value, ctx), rootAvailability && pendingDelivery(delivery),
        "failed receiving route actually crosses the promised root availability")
    const chain = new r.Chain(received.value, ctx)
    const collection = r.getErrors(chain, [], context(execution, "collect failures"))
    const exported = r.export(chain, [], context(execution, "export failures"))
    if (pendingDelivery(delivery)) {
        assert(r.isPending(collection, ctx), "complete collection waits for required failures")
        assert(r.isPending(exported, ctx), "failed export still finishes required collection")
    }
    if (rootAvailability) root.settle()
    else {
        const order = delivery === "reversed" ? [1, 0] : [0, 1]
        leaves[order[0]].settle()
        if (pendingDelivery(delivery)) {
            await turn()
            assert.equal(await r.hasError(chain, [], ctx), true, "hasError closes on the first available poison")
            let complete = false
            Promise.resolve(collection).then(() => { complete = true })
            await turn()
            assert.equal(complete, false, "getErrors remains pending for the other causal failure")
        }
        leaves[order[1]].settle()
    }
    assertPoison(await collection, expected, fault)
    assertPoison(await exported, expected)
    assert.equal(await r.hasError(chain, [], ctx), true)
    if (route !== "snapshot") {
        assert.equal(await r.lookupPath(chain, ["safe"], ctx), program.value)
        assert.equal(await r.lookupPath(chain, ["healthy"], ctx), healthy)
    }
    if (prepared) assertPoison(await r.getErrors(prepared, [], ctx), expected)
    assert.equal(execution.fatalError, null)
    return expected.map(({ kind, source }, index) => [index, kind, source])
}

async function invocationResultFailure(program, delivery) {
    const execution = new r.Execution(), ctx = context(execution, "independent result")
    const cause = new Error("independent method result rejection")
    const signal = source(delivery, cause, true)
    const receiver = new r.Chain({ value: program.value, change() {
        this.value += program.delta
        return { bad: signal.value }
    } }, ctx)
    const result = r.run(receiver, [], "change", [], ctx, { mutationScopeDepth: 0 })
    const resultHolder = new r.Chain(result, ctx)
    // A nested independent output does not extend native access or postpone the
    // successful receiver effect, even though its own complete export waits.
    assert.equal(r.lookupPath(receiver, ["value"], ctx), program.value + program.delta)
    const errors = r.getErrors(resultHolder, [], ctx)
    assert.equal(r.isPending(errors, ctx), pendingDelivery(delivery))
    signal.settle()
    assertPoison(await errors, [{ cause, kind: r.ERROR_KIND.OperationInputFailed, source: ctx.errorContext }])
    assert.equal(await r.hasError(receiver, [], ctx), false)
    assert.equal(execution.fatalError, null)
}

async function directReceivingFailure(route, delivery) {
    const execution = new r.Execution(), ctx = context(execution, "direct receiving failure")
    const cause = new Error("direct boundary rejection"), signal = source(delivery, cause, true)
    const received = receive(route, signal.value, ctx)
    assert.equal(r.isPending(received.value, ctx), pendingDelivery(delivery), "direct rejection remains pending until its own outcome")
    const chain = new r.Chain(received.value, ctx)
    const collection = r.getErrors(chain, [], context(execution, "later consumer"))
    signal.settle()
    const kind = route === "import" ? r.ERROR_KIND.ContextValueFailed
        : route === "observation" || route === "snapshot" ? r.ERROR_KIND.ExternalPropertyReadFailed
            : r.ERROR_KIND.InvocationFailed
    assertPoison(await collection, [{ cause, kind, source: ctx.errorContext }])
    assert.equal(execution.fatalError, null)
}

function snapshotAndQueryControls(program) {
    const execution = new r.Execution(), ctx = context(execution, "snapshot negative control")
    let subscriptions = 0, reads = 0
    const api = r.externalState({ data: { pending: { then(resolve) { subscriptions++; resolve(program.value) } } },
        get throwing() { reads++; throw new Error("query must not read scope metadata") } })
    const chain = new r.ContextChain({ api }, ctx, { api: {} })
    const result = r.lookupPath(chain, ["api", "data"], ctx)
    assert.equal(result.kind, r.ERROR_KIND.InvalidExternalSnapshot)
    assert.equal(result.errorContext, ctx.errorContext)
    assert.equal(subscriptions, 0, "mutable snapshot never subscribes to nested thenables")
    assert.equal(r.getErrors(chain, ["api", "throwing"], ctx), null)
    assert.equal(r.hasError(chain, ["api"], ctx), false)
    assert.equal(reads, 0, "registered scope queries are metadata-only")
    const cause = new Error("selected observation failure")
    const observed = new r.Chain(r.externalState({ get selected() { throw cause } }), ctx)
    assert.equal(r.getErrors(observed, [], ctx), null, "external root is opaque")
    assertPoison(r.getErrors(observed, ["selected"], ctx), [
        { cause, kind: r.ERROR_KIND.ExternalPropertyReadFailed, source: ctx.errorContext },
    ])
    assert.equal(execution.fatalError, null)
}

export async function runReceivingProgram(program) {
    const coverage = [], healthyReplay = new Map(), poisonReplay = new Map()
    const stages = routes.flatMap(route => deliveries.flatMap(delivery =>
        ["healthy", "poison", "direct-rejection"].map(outcome => ({ route, delivery, outcome }))))
        .concat(deliveries.map(delivery => ({ route: "independent-result", delivery })), [{ route: "snapshot-query-controls" }])
    let stageIndex = 0
    const stage = () => reportGeneratedStage({ seed: program.seed, availability: program.availability,
        ...stages[stageIndex++], remainingReplays: stages.slice(stageIndex) })
    for (const route of routes) for (const delivery of deliveries) {
        let outcome = "healthy"
        try {
            stage()
            const healthy = await healthyHistory(program, route, delivery)
            if (healthyReplay.has(route)) assert.deepEqual(healthy, healthyReplay.get(route), "ready/deferred values, aliases and effects agree")
            else healthyReplay.set(route, healthy)
            assert.deepEqual(healthy, healthyReplay.get("import"), "equivalent receiving routes preserve values, aliases and effects")
            outcome = "poison"
            stage()
            const poison = await poisonHistory(program, route, delivery)
            if (poisonReplay.has(route)) assert.deepEqual(poison, poisonReplay.get(route), "ready/deferred cause labels, kind and source agree")
            else poisonReplay.set(route, poison)
            outcome = "direct-rejection"
            stage()
            await directReceivingFailure(route, delivery)
        } catch (cause) {
            throw new Error(`receiving program seed=${program.seed} route=${route} delivery=${delivery} outcome=${outcome}`, { cause })
        }
        const availability = route === "snapshot" ? "root" : program.availability
        coverage.push(`${route}:${delivery}:healthy:${program.prepared && route !== "snapshot" ? "prepared" : "fresh"}:${availability}`,
            `${route}:${delivery}:poison:${program.prepared && route !== "snapshot" ? "prepared" : "fresh"}:${availability}`,
            `${route}:${delivery}:direct-rejection:fresh:root`)
    }
    for (const delivery of deliveries) {
        stage()
        try { await invocationResultFailure(program, delivery) }
        catch (cause) { throw new Error(`receiving program seed=${program.seed} route=independent-result delivery=${delivery}`, { cause }) }
    }
    stage()
    snapshotAndQueryControls(program)
    return { coverage, histories: routes.length * deliveries.length * 3 + deliveries.length,
        controls: ["ready-only-snapshot", "scope-query", "healthy-Error", "independent-result-effect"] }
}

export async function runSensitivity() {
    const program = receivingPrograms(1)[0], detected = []
    // Corrupt only detached observations or the explicit independent expectation,
    // never internal runtime controls. Each case must reach its intended assertion.
    for (const [fault, pattern] of [["value", /exact leaf/], ["alias", /preserve aliases/],
        ["effect", /completed ! call/], ["completion", /export completion/], ["poison", /complete exact poison membership/]]) {
        await assert.rejects(() => fault === "poison" ? poisonHistory(program, "import", "ready", fault)
            : healthyHistory(program, "import", "ready", fault), pattern)
        detected.push(fault)
    }
    return detected
}

export async function runReceivingDifferential(seeds = 8) {
    const coverage = new Set(), controls = new Set()
    let histories = 0
    const totals = await runGeneratedCases({ moduleURL: import.meta.url, cases: receivingPrograms(seeds),
        runCase: runReceivingProgram, onPass(result) {
            histories += result.histories
            for (const key of result.coverage) coverage.add(key)
            for (const key of result.controls) controls.add(key)
        } })
    return { programs: totals.passed, histories, coverage: [...coverage].sort(), controls: [...controls].sort(), ...totals }
}

export async function runProductionWitness(name) {
    const program = receivingPrograms(1)[0]
    if (name === "poison") await poisonHistory(program, "import", "ready")
    else await healthyHistory(program, "import", name === "completion" ? "ordered" : "ready")
    return { witness: name, passed: true }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
    console.log(JSON.stringify(process.env.CASCADA_RECEIVING_WITNESS
        ? await runProductionWitness(process.env.CASCADA_RECEIVING_WITNESS)
        : await runReceivingDifferential(Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 8))))
