import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import * as r from "../../src/index.js"
import { assertGraph } from "../graph-oracle.js"
import { OrderedThenable, ready } from "../ordered-thenable.js"
import { verifyRefCounts } from "../verify-refcounts.js"
import { verifyLiveness } from "../verify-parents.js"

export const boundaries = ["import", "assignment", "method-result", "host-call"]
export const deliveries = ["ready", "synchronous", "native", "ordered"]
export const releases = ["before-delivery", "after-delivery"]
const turn = () => new Promise(setImmediate)
const assertVoid = actual => assert.equal(actual, undefined)

// A known identity failure must not conceal a different failing consumer or
// final postcondition in the same history. Observe every issued result, then
// report all failures with stable labels for the deferred-conformance gate.
async function finishChecks(checks, postconditions) {
    const settled = await Promise.allSettled(checks.map(({ check }) => check))
    const failures = []
    settled.forEach((outcome, index) => {
        if (outcome.status === "rejected") failures.push(`${checks[index].name}: ${outcome.reason.message}`)
    })
    for (const [name, check] of postconditions) {
        try { check() }
        catch (error) { failures.push(`${name}: ${error.message}`) }
    }
    if (failures.length) assert.fail(failures.join("\n\n"))
}

// The payload values vary by seed: each four-seed cycle deliberately
// covers both shapes and mutation routes. The product dimensions are actual
// histories, rather than counters independently claiming their ingredients.
export function historyCases(seeds = 16, deferred = false) {
    const cases = []
    for (let seed = 0; seed < seeds; seed++) for (const boundary of boundaries)
    for (const delivery of deliveries) for (const release of releases) {
        const pending = delivery === "native" || delivery === "ordered"
        const validationCopy = boundary === "method-result" || boundary === "host-call"
        if (deferred && !(pending && validationCopy)) continue
        cases.push({ seed, boundary, delivery, release,
            route: seed % 2 ? "entry" : "direct",
            shape: Math.floor(seed / 2) % 2 ? "sparse" : "dense",
            settledBeforeReentry: !deferred && pending && validationCopy })
    }
    return cases
}

export function historyKey({ boundary, delivery, release, route, shape, settledBeforeReentry }) {
    return [boundary, delivery, release, route, shape,
        settledBeforeReentry ? "settled-reentry" : "immediate-reentry"].join(":")
}

function graph(value, pending, sparse) {
    const child = { k: value }; child.self = child
    const items = sparse ? [child, , child] : [child, child]
    const root = { items, p: pending }; root.self = root
    return root
}

// This model performs the semantic path write on its own graph. A path mutation
// changes one occurrence; untouched self edges still name the captured original.
function changedGraph(original, value) {
    const items = original.items.slice()
    items[0] = { ...original.items[0], k: value }
    return { ...original, items }
}

export async function runBoundaryHistory(spec) {
    const { seed, boundary, delivery, release, route, shape, settledBeforeReentry } = spec
    const ctx = { execution: new r.Execution(), errorContext: `boundary history ${historyKey(spec)} seed=${seed}` }
    const value = 11 + seed * 17, resolved = value + 1, changedValue = value + 2
    const pending = delivery === "native" ? Promise.withResolvers()
        : delivery === "ordered" ? new OrderedThenable() : undefined
    const input = pending?.promise ?? pending ?? (delivery === "synchronous" ? ready(resolved) : resolved)
    const cached = graph(value, input, shape === "sparse")
    const original = graph(value, resolved, shape === "sparse")
    const changed = changedGraph(original, changedValue)
    const service = new r.Chain(r.externalState({ get() { return cached } }), ctx)
    const holders = [service], checks = [], observations = {}
    const keep = (name, result, verify) => {
        const check = Promise.resolve(result).then(actual => { verify(actual); observations[name] = actual })
        check.catch(() => {})
        checks.push({ name, check })
    }
    const hold = value => { const chain = new r.Chain(value, ctx); holders.push(chain); return chain }
    const receive = () => {
        if (boundary === "assignment") {
            const chain = hold(null)
            keep(`assignment-${holders.length}`, r.assignPath(chain, [], r.import(cached, ctx), ctx), assertVoid)
            return chain
        }
        return hold(boundary === "import" ? r.import(cached, ctx)
            : boundary === "method-result" ? r.importMethodResult(cached, ctx)
            : r.run(service, [], "get", [], ctx, {}))
    }
    const first = receive()
    const list = hold([r.lookupPath(first, [], ctx), r.lookupPath(first, [], ctx)])
    const other = hold(r.lookupPath(first, [], ctx))
    keep("mutation", route === "entry"
        ? r.enter(other, ["items", 0], ctx, true, inside => r.assignPath(inside, ["k"], changedValue, ctx))
        : r.assignPath(other, ["items", 0, "k"], changedValue, ctx), assertVoid)
    const changedHolder = hold(r.lookupPath(other, [], ctx))
    const capture = hold({ original: r.lookupPath(first, [], ctx), changed: r.lookupPath(changedHolder, [], ctx) })
    keep("captured", r.export(capture, [], ctx), actual => assertGraph(actual, { original, changed }))
    // Remove source owners before re-entry. Explicit holders and captured work
    // provide the retained values; the cached host graph itself is never mutated.
    for (const chain of [first, other, capture]) keep(`release-source-${holders.indexOf(chain)}`,
        r.assignPath(chain, [], null, ctx), assertVoid)
    if (settledBeforeReentry) { pending.resolve(resolved); await turn() }
    const second = receive()
    const oldValue = r.lookupPath(list, [0], ctx), secondValue = r.lookupPath(second, [], ctx)
    for (const method of ["includes", "indexOf", "lastIndexOf"]) {
        keep(`search-${method}`, r.run(list, [], method, [secondValue], ctx, {}),
            actual => assert.equal(actual, [original, original][method](original)))
        keep(`changed-${method}`, r.run(list, [], method, [r.lookupPath(changedHolder, [], ctx)], ctx, {}),
            actual => assert.equal(actual, [original, original][method](changed)))
    }
    const combined = hold({ first: oldValue, second: secondValue, changed: r.lookupPath(changedHolder, [], ctx) })
    keep("combined", r.export(combined, [], ctx), actual => assertGraph(actual, { first: original, second: original, changed }))
    const receiver = hold({ first: oldValue, second: secondValue,
        same() { return this.first === this.second && this.first.self === this.first && this.second.self === this.first } })
    keep("receiver", r.run(receiver, [], "same", [], ctx, {}), actual => assert.equal(actual, true))
    const effects = []
    const resource = r.externalState({
        compare(seq, a, b) {
            effects.push({ seq, same: a === b, cycles: a.self === a && b.self === b, k: a.items[0].k })
            return a === b
        },
        mark(seq) { effects.push({ seq }) },
    })
    const context = new r.ContextChain({ resource }, ctx, { resource: {} })
    keep("native-batch", r.run(context, ["resource"], "compare", [1, oldValue, secondValue], ctx,
        { mutationScopeDepth: 1 }), actual => assert.equal(actual, true))
    keep("later-effect", r.run(context, ["resource"], "mark", [2], ctx,
        { mutationScopeDepth: 1 }), assertVoid)
    const releaseAll = () => { for (const chain of holders) keep(`release-${holders.indexOf(chain)}`,
        r.assignPath(chain, [], null, ctx), assertVoid) }
    if (release === "before-delivery") releaseAll()
    if (!settledBeforeReentry) pending?.resolve(resolved)
    await Promise.allSettled(checks.map(({ check }) => check))
    if (release === "after-delivery") releaseAll()
    await turn()
    // Host storage stays host-owned even after cached re-entry and logical
    // Promise settlement. Compare its topology with an independent host graph.
    await finishChecks(checks, [
        ["ordered-effects", () => assert.deepEqual(effects,
            [{ seq: 1, same: true, cycles: true, k: value }, { seq: 2 }], "pending batch precedes later ready external effect")],
        ...holders.map((chain, index) => [`cleared-holder-${index}`, () => assert.equal(r.lookupPath(chain, [], ctx), null)]),
        ["parents-and-counts", () => verifyRefCounts(ctx, ...holders.map(holder => holder._state), context._state)],
        ["execution", () => assert.equal(ctx.execution.fatalError, null)],
        ["host-topology", () => assertGraph(cached, graph(value, input, shape === "sparse"))],
        ["host-Promise-identity", () => assert.equal(cached.p, input, "host Promise storage retains its exact identity")],
    ])
    return { key: historyKey(spec), effects,
        searches: ["includes", "indexOf", "lastIndexOf"].map(method => observations[`search-${method}`]) }
}

export async function runBoundaryHistories(seeds = 16) {
    const coverage = new Set(), replay = new Map()
    let programs = 0
    for (const spec of historyCases(seeds)) {
        let result
        try { result = await runBoundaryHistory(spec) }
        catch (cause) { throw new Error(`boundary history ${historyKey(spec)} seed=${spec.seed}`, { cause }) }
        const replayKey = [spec.seed, spec.boundary, spec.release, spec.route, spec.shape].join(":")
        if (replay.has(replayKey)) assert.deepEqual(result.effects, replay.get(replayKey), "readiness replay preserves effects")
        else replay.set(replayKey, result.effects)
        coverage.add(result.key)
        programs++
    }
    const retirementCoverage = new Set()
    let retirementPrograms = 0
    for (const spec of historyCases(4)) {
        const retired = { ...spec, settledBeforeReentry: false }
        try { await runRetiredBoundaryHistory(retired) }
        catch (cause) { throw new Error(`retired boundary history ${historyKey(retired)} seed=${retired.seed}`, { cause }) }
        retirementCoverage.add(historyKey(retired))
        retirementPrograms++
    }
    return { programs, coverage: [...coverage].sort(), retirementPrograms,
        retirementCoverage: [...retirementCoverage].sort() }
}

// A separate bounded history proves re-entry after actual retirement. Holding a
// root (as above) tests active reception; holding only its child cannot keep the
// root alive. The expected live set comes from this forward model, never from
// runtime parents, lease counts, or the retirement predicate.
async function runRetiredBoundaryHistory(spec) {
    const { seed, boundary, delivery, release, route, shape } = spec
    const ctx = { execution: new r.Execution(), errorContext: `retired boundary history ${historyKey(spec)}` }
    const value = seed + 71, settled = value + 1, mutation = value + 2
    const pending = delivery === "native" ? Promise.withResolvers()
        : delivery === "ordered" ? new OrderedThenable() : undefined
    const input = pending?.promise ?? pending ?? (delivery === "synchronous" ? ready(settled) : settled)
    const cached = graph(value, input, shape === "sparse")
    const original = graph(value, settled, shape === "sparse"), changed = changedGraph(original, mutation)
    const service = new r.Chain(r.externalState({ get() { return cached } }), ctx)
    const checks = [], holders = [service]
    const keep = (name, value, verify = assertVoid) => {
        const check = Promise.resolve(value).then(verify); check.catch(() => {}); checks.push({ name, check })
    }
    const hold = value => { const chain = new r.Chain(value, ctx); holders.push(chain); return chain }
    const receive = () => {
        if (boundary === "assignment") {
            const chain = hold(null); keep(`assignment-${holders.length}`, r.assignPath(chain, [], r.import(cached, ctx), ctx)); return chain
        }
        return hold(boundary === "import" ? r.import(cached, ctx)
            : boundary === "method-result" ? r.importMethodResult(cached, ctx)
            : r.run(service, [], "get", [], ctx, {}))
    }
    const first = receive(), firstRoot = r.lookupPath(first, [], ctx)
    const retained = hold(r.lookupPath(first, ["items", 0], ctx))
    const other = hold(r.lookupPath(first, [], ctx))
    keep("mutation", route === "entry"
        ? r.enter(other, ["items", 0], ctx, true, inside => r.assignPath(inside, ["k"], mutation, ctx))
        : r.assignPath(other, ["items", 0, "k"], mutation, ctx))
    const changedChild = hold(r.lookupPath(other, ["items", 0], ctx))
    keep("original-export", r.export(first, [], ctx), actual => assertGraph(actual, original))
    keep("changed-export", r.export(other, [], ctx), actual => assertGraph(actual, changed))
    if (release === "after-delivery") { pending?.resolve(settled); await Promise.allSettled(checks.map(({ check }) => check)) }
    for (const chain of [first, other]) keep(`release-source-${holders.indexOf(chain)}`, r.assignPath(chain, [], null, ctx))
    verifyLiveness(ctx, [cached, firstRoot, cached.items[0]], new Set([cached.items[0]]))
    const reentered = receive()
    const receivedRoot = r.lookupPath(reentered, [], ctx)
    // Method-result validation can materialize a pending root copy (N2). This
    // history retains no old root identity, so it checks the published root's
    // liveness and unchanged retained-child identity without blessing that copy.
    verifyLiveness(ctx, [receivedRoot, cached.items[0]], new Set([receivedRoot, cached.items[0]]))
    const child = r.lookupPath(retained, [], ctx), newChild = r.lookupPath(reentered, ["items", 0], ctx)
    const items = hold(r.lookupPath(reentered, ["items"], ctx))
    for (const method of ["includes", "indexOf", "lastIndexOf"]) {
        keep(`search-${method}`, r.run(items, [], method, [child], ctx, {}), actual => assert.equal(actual, original.items[method](original.items[0])))
        keep(`changed-${method}`, r.run(items, [], method, [r.lookupPath(changedChild, [], ctx)], ctx, {}),
            actual => assert.equal(actual, original.items[method](changed.items[0])))
    }
    const combined = hold({ child, reentered: r.lookupPath(reentered, [], ctx), changed: r.lookupPath(changedChild, [], ctx) })
    keep("combined", r.export(combined, [], ctx), actual => assertGraph(actual,
        { child: original.items[0], reentered: original, changed: changed.items[0] }))
    const effects = [], resource = r.externalState({
        compare(seq, a, b) { effects.push({ seq, same: a === b, cycles: a.self === a && b.self === b }); return a === b },
        mark(seq) { effects.push({ seq }) },
    })
    const context = new r.ContextChain({ resource }, ctx, { resource: {} })
    keep("native-batch", r.run(context, ["resource"], "compare", [1, child, newChild], ctx, { mutationScopeDepth: 1 }),
        actual => assert.equal(actual, true))
    keep("later-effect", r.run(context, ["resource"], "mark", [2], ctx, { mutationScopeDepth: 1 }))
    for (const chain of holders) keep(`release-${holders.indexOf(chain)}`, r.assignPath(chain, [], null, ctx))
    if (release === "before-delivery") pending?.resolve(settled)
    await finishChecks(checks, [
        ["ordered-effects", () => assert.deepEqual(effects, [{ seq: 1, same: true, cycles: true }, { seq: 2 }])],
        ["retirement", () => verifyLiveness(ctx, [cached, firstRoot, receivedRoot, cached.items[0]], new Set())],
        ["parents-and-counts", () => verifyRefCounts(ctx, ...holders.map(holder => holder._state), context._state)],
        ["host-Promise-identity", () => assert.equal(cached.p, input)],
        ["host-topology", () => assertGraph(cached, graph(value, input, shape === "sparse"))],
        ["execution", () => assert.equal(ctx.execution.fatalError, null)],
    ])
}

if (process.argv[1] === fileURLToPath(import.meta.url))
    console.log(JSON.stringify(await runBoundaryHistories(Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16))))
