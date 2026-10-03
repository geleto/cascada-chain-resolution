import assert from "node:assert/strict"
import { registerHooks } from "node:module"

// Observe every admitted identity, including private copies and backing records.
// Weak references neither protect values nor install optional runtime indexes.
let admitted = []
globalThis.recordOwnershipAdmission = value => admitted.push(new WeakRef(value))
const metaURL = new URL("../../src/meta.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== metaURL) return result
    const source = String(result.source), marker = "metadata.set(value, meta)"
    assert(source.includes(marker), "Missing admission observation site")
    return { ...result, source: source.replace(marker, `${marker}; globalThis.recordOwnershipAdmission(value)`) }
} })

const r = await import("../../src/index.js")
const { metaOf } = await import("../../src/meta.js")
const { verifyLiveness } = await import("../verify-parents.js")
const { verifyRefCounts } = await import("../verify-refcounts.js")
const { OrderedThenable } = await import("../ordered-thenable.js")

async function releaseAndVerify(context, holders) {
    for (const holder of holders) r.assignPath(holder, [], null, context)
    await new Promise(setImmediate)
    // Empty public holders remain live; no graph value or private holder does.
    const expectedLive = new Set(holders.map(holder => holder._state))
    const published = []
    for (const ref of admitted) {
        const value = ref.deref()
        if (!value) continue
        const meta = metaOf(value, context)
        if (meta.placementsInitialized) published.push(value)
        else assert(!meta.relationshipsActive, "Unpublished construction remained active")
        if (meta.backingOwners) assert.equal(meta.backingOwners.size, 0)
    }
    verifyLiveness(context, published, expectedLive)
    verifyRefCounts(context, ...published)
    assert.equal(context.execution.fatalError, null)
}

async function mutationCase(details) {
    const { shape, timing, indexed, entered, later, earlyClear } = details
    const context = { execution: new r.Execution(), errorContext: details }
    const holders = []
    const hold = value => {
        const holder = new r.Chain(value, context)
        holders.push(holder)
        return holder
    }
    const child = { k: 1 }
    const signal = timing === "ordered" ? new OrderedThenable() : Promise.withResolvers()
    const pending = timing === "ready" ? child : timing === "ordered" ? signal : signal.promise
    let source
    if (shape === "record") source = hold({ x: pending, y: { k: 0 } })
    else if (shape === "array") source = hold([pending, { k: 0 }])
    else {
        const backing = hold([99, pending, { k: 0 }])
        source = hold(r.run(backing, [], "slice", [1], context, {}))
        r.assignPath(backing, [], null, context)
    }
    const key = shape === "record" ? "x" : 0
    if (indexed) r.hasError(source, [], context)
    const earlier = hold(r.lookupPath(source, [key], context))
    const work = [entered
        ? r.enter(source, [key], context, true, inner => r.assignPath(inner, ["k"], 2, context))
        : r.assignPath(source, [key, "k"], 2, context)]
    if (later === "replace") work.push(r.assignPath(source, [key], { k: 3 }, context))
    if (later === "delete") work.push(r.deletePath(source, [key], context))
    if (later === "repair") {
        work.push(r.assignPath(source, [key, "absent", "v"], 9, context, 1))
        work.push(r.repairPath(source, [key], context))
    }
    // Capture at issuance, before clearing the owner or delivering pending data.
    const output = r.export(source, [], context)
    if (earlyClear) r.assignPath(source, [], null, context)
    if (timing !== "ready") {
        signal.resolve(child)
        if (timing === "ordered") signal.flush()
    }
    await Promise.all(work)
    const changed = { k: later === "replace" ? 3 : 2 }
    const expected = shape === "record" ? { x: changed, y: { k: 0 } } : [changed, { k: 0 }]
    if (later === "delete") delete expected[key]
    assert.deepEqual(await output, expected)
    assert.deepEqual(await r.export(earlier, [], context), { k: 1 })
    await releaseAndVerify(context, holders)
}

async function inspectionCase(details) {
    const { route, indexed, cyclic, failureAt } = details
    const context = { execution: new r.Execution(), errorContext: details }
    let armed = false, inspections = 0, failed = false, effects = 0
    const cause = new Error("inspection failed")
    const proxy = value => new Proxy(value, {
        ownKeys(target) {
            if (armed && ++inspections === failureAt) {
                failed = true
                throw cause
            }
            return Reflect.ownKeys(target)
        },
    })
    const child = proxy({ k: 1 })
    const raw = proxy({
        left: child, right: child,
        read() { effects++; return this.left.k },
        mutate() { effects++; this.left.k = 2; return this },
    })
    if (cyclic) raw.self = raw
    const source = new r.Chain(r.import(raw, context), context)
    const retained = new r.Chain(r.lookupPath(source, [], context), context)
    if (indexed) assert.equal(r.hasError(source, [], context), false)

    // Inject only into the operation under test, not admission or verification.
    armed = true
    let outcome
    switch (route) {
        case "export": outcome = r.export(source, [], context); break
        case "hasError": outcome = r.hasError(source, [], context); break
        case "getErrors": outcome = r.getErrors(source, [], context); break
        case "assign": outcome = r.assignPath(source, ["left", "k"], 2, context); break
        case "entry": outcome = r.enter(source, ["left"], context, true,
            inner => r.assignPath(inner, ["k"], 2, context)); break
        case "observe": outcome = r.run(source, [], "read", [], context, {}); break
        case "mutate": outcome = r.run(source, [], "mutate", [], context, { mutationScopeDepth: 0 }); break
    }
    armed = false
    if (indexed && !cyclic && (route === "hasError" || route === "getErrors")) {
        // A complete acyclic summary answers these queries without reflection.
        assert.equal(inspections, 0)
        assert.equal(outcome, route === "hasError" ? false : null)
    }
    const delivered = new r.Chain(outcome, context)
    await r.export(delivered, [], context)
    assert.equal(context.execution.fatalError, null)
    if (failed) {
        // Failed optional entry discovery captures the enclosing reference.
        // The contained command then performs its own successful inspection.
        if (route === "entry" && failureAt === 1)
            assert.equal(r.lookupPath(source, ["left", "k"], context), 2)
        else assert(r.isPoisonError(await outcome), "Required inspection failure must produce poison")
        assert.equal(effects, 0, "Failed preparation must not execute the method")
    }
    assert.equal(r.lookupPath(retained, ["left", "k"], context), 1)
    assert.equal(raw.left.k, 1, "Host input must stay unchanged")
    verifyRefCounts(context, source._state, retained._state, delivered._state)
    await releaseAndVerify(context, [source, retained, delivered])
    return failed
}

let mutationCases = 0, inspectionCases = 0, injectedFailures = 0, currentCase
const failureCoverage = new Set()
try {
    for (const shape of ["record", "array", "view"])
    for (const timing of ["ready", "native", "ordered"])
    for (const indexed of [false, true])
    for (const entered of [false, true])
    for (const later of ["keep", "replace", "delete", "repair"])
    for (const earlyClear of [false, true]) {
        admitted = []
        currentCase = { shape, timing, indexed, entered, later, earlyClear }
        await mutationCase(currentCase)
        mutationCases++
    }

    for (const route of ["export", "hasError", "getErrors", "assign", "entry", "observe", "mutate"])
    for (const indexed of [false, true])
    for (const cyclic of [false, true])
    for (const failureAt of [1, 2, 3, 4]) {
        admitted = []
        currentCase = { route, indexed, cyclic, failureAt }
        if (await inspectionCase(currentCase)) {
            injectedFailures++
            failureCoverage.add(`${route}:${indexed}:${cyclic}`)
        }
        inspectionCases++
    }
} catch (error) {
    console.error("Ownership lifecycle case:", JSON.stringify(currentCase))
    throw error
}
console.log(JSON.stringify({ mutationCases, inspectionCases, injectedFailures, failureCoverage: [...failureCoverage] }))
