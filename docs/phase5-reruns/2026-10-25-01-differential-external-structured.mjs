// Run 02 scratch differential: structured snapshots of mutable external state,
// exported arguments retained by host code, native nested writes, and later
// Chain-side mutation of snapshots/sources. Sequential native model.
import * as r from "../../src/index.js"
import { OrderedThenable } from "../../test/ordered-thenable.js"
import { verifyRefCounts } from "../../test/verify-refcounts.js"

function createRandom(seed) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const deep = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const show = value => value === undefined ? "u" : JSON.stringify(value)

function generate(random) {
    const int = n => Math.floor(random() * n)
    const pick = list => list[int(list.length)]
    const steps = []
    const snapshots = []
    const count = 15 + int(25)
    for (let i = 0; i < count; i++) {
        const roll = int(30)
        const delivery = random() < 0.4 ? "pending" : random() < 0.08 ? "rejected" : "ready"
        let step
        if (roll < 4) step = { kind: "add", arg: pick(["prim", "prim", "list", "obj", "record"]), value: int(20), delivery }
        else if (roll < 6) step = { kind: "setMeta", arg: pick(["obj", "record"]), value: int(20), delivery }
        else if (roll < 7) step = { kind: "bump", route: pick(["direct", "entry", "delayed-entry"]) }
        else if (roll < 10) step = { kind: "snap", path: pick([["items"], ["meta"], ["counter"], ["items", 0]]) }
        else if (roll < 12) {
            const target = pick([["counter"], ["meta", "x"], ["meta"]])
            step = { kind: "write", target, arg: target.length === 1 && target[0] === "meta" ? pick(["obj", "record"]) : pick(["prim", "obj", "list"]), value: int(20), delivery }
        }
        else if (roll < 15) step = { kind: "managed", op: pick(["push", "set", "nested"]), value: int(20), delivery: delivery === "rejected" ? "ready" : delivery }
        else if (roll < 18) step = { kind: "mutate-snap", which: int(8), value: int(20) }
        else if (roll < 20) step = { kind: "read", target: pick([["counter"], ["meta", "x"], ["items", "length"]]) }
        else if (roll < 21) step = { kind: "fail" }
        else if (roll < 22) step = { kind: "repair" }
        else if (roll < 23) step = { kind: "query" }
        else if (roll < 25) step = { kind: "readonly-entry", target: pick([["items"], ["counter"]]) }
        else if (roll < 26) step = { kind: "settle" }
        else step = { kind: "export", which: pick(["items", "store", "data"]) }
        step.release = int(3)
        step.turns = int(3)
        steps.push(step)
    }
    return { steps, wrap: random() < 0.5 }
}

function freshHost() {
    return { items: [1, 2], meta: { x: 0 }, counter: 0 }
}

async function runProgram(program, delivery, seed, verify) {
    const random = createRandom(seed ^ 0x77)
    const ctx = { execution: new r.Execution(error => { throw error }), errorContext: "ext" }
    const host = r.externalState({
        ...freshHost(),
        add(x) { this.items.push(x); return this.items.length },
        setMeta(v) { this.meta = v; return 0 },
        bump() { this.counter++; return this.counter },
        fail() { this.counter = -100; throw new Error("api failed") },
    })
    const api = host
    const root = new r.ContextChain({ api, data: { list: [1], obj: { k: 1 } } }, ctx, { api: {} })
    // Model
    const model = { host: freshHost(), data: { list: [1], obj: { k: 1 } }, poisoned: false }
    const holds = [], checks = [], roots = [root], snaps = []
    const source = (value, mode, thunk) => {
        if (mode === "ready") return thunk ? thunk() : value
        if (thunk) {
            // Deliver a lookup of the issuance-time holder at delivery time.
            if (mode === "rejected") return source(undefined, mode)
            if (delivery === "ready" || delivery === "sync") return { then: f => f(thunk()) }
            if (delivery === "native") {
                const held = Promise.withResolvers()
                holds.push(() => held.resolve(thunk()))
                return held.promise
            }
            const t = new OrderedThenable()
            holds.push(() => t.resolve(thunk()))
            return t
        }
        const failure = () => new Error("rejected input")
        if (mode === "rejected" && delivery === "ready") return { then: (_f, reject) => reject(failure()) }
        if (delivery === "ready" || delivery === "sync")
            return mode === "rejected" ? { then: (_f, reject) => reject(failure()) } : { then: f => f(value) }
        if (delivery === "native") {
            const held = Promise.withResolvers()
            held.promise.catch(() => {})
            holds.push(() => mode === "rejected" ? held.reject(failure()) : held.resolve(value))
            return held.promise
        }
        const t = new OrderedThenable()
        holds.push(() => mode === "rejected" ? t.reject(failure()) : t.resolve(value))
        return t
    }
    const gate = () => {
        if (delivery === "ready" || delivery === "sync") return undefined
        const held = Promise.withResolvers()
        holds.push(() => held.resolve())
        return held.promise
    }
    const keep = value => { const holder = new r.Chain(value, ctx); roots.push(holder); return holder }
    const check = (value, expected, label) => checks.push({ value, expected, label })
    const releaseOne = () => { if (holds.length) holds.splice(Math.floor(random() * holds.length), 1)[0]() }
    const doVerify = () => { if (verify) verifyRefCounts(ctx, ...roots.map(x => x._state)) }
    const settle = async () => {
        for (let g = 0; g < 100; g++) {
            while (holds.length) { releaseOne(); await Promise.resolve() }
            for (let t = 0; t < 4; t++) await new Promise(setImmediate)
            if (!holds.length) return
        }
    }
    // Argument factories: managed lookups export a detached copy; literals are fresh.
    const argument = (step) => {
        if (step.arg === "prim") return { runtime: source(step.value, step.delivery), model: step.value }
        if (step.arg === "record") return { runtime: source({ v: step.value }, step.delivery), model: { v: step.value } }
        const path = step.arg === "list" ? ["data", "list"] : ["data", "obj"]
        const current = deep(step.arg === "list" ? model.data.list : model.data.obj)
        const holder = keep(r.lookupPath(root, path, ctx))
        return { runtime: source(undefined, step.delivery, () => r.lookupPath(holder, [], ctx)), model: current }
    }
    for (const [index, step] of program.steps.entries()) {
        const label = `#${index} ${step.kind}`
        const M = { mutationScopeDepth: 1 }
        if (step.kind === "add" || step.kind === "setMeta") {
            const arg = argument(step)
            const rejected = step.delivery === "rejected"
            let expected
            if (model.poisoned) expected = "ERR"
            else if (rejected) { expected = "ERR"; model.poisoned = true }
            else if (step.kind === "add") { model.host.items.push(deep(arg.model)); expected = show(model.host.items.length) }
            else { model.host.meta = deep(arg.model); expected = show(0) }
            check(keep(r.run(root, ["api"], step.kind, [arg.runtime], ctx, M)), expected, label)
        } else if (step.kind === "bump") {
            let expected
            if (model.poisoned) expected = "ERR"
            else { model.host.counter++; expected = show(model.host.counter) }
            if (step.route === "direct") check(keep(r.run(root, ["api"], "bump", [], ctx, M)), expected, label)
            else {
                const delay = step.route === "delayed-entry" ? gate() : undefined
                const act = inside => r.run(inside, [], "bump", [], ctx, { mutationScopeDepth: 0 })
                check(keep(r.enter(root, ["api"], ctx, true, inside => delay ? delay.then(() => act(inside)) : act(inside))), expected, label)
            }
        } else if (step.kind === "snap") {
            const path = ["api", ...step.path]
            let value = model.host
            for (const key of step.path) value = value?.[key]
            const expected = model.poisoned ? undefined : deep(value)
            const holder = keep(r.lookupPath(root, path, ctx))
            snaps.push({ holder, model: expected, failed: model.poisoned, array: Array.isArray(value) })
            check({ raw: r.export(holder, [], ctx) }, model.poisoned ? "ERR" : show(expected), label + ` ${path.join(".")}`)
        } else if (step.kind === "write") {
            const arg = argument(step)
            const target = ["api", ...step.target]
            if (!model.poisoned) {
                if (step.delivery === "rejected") model.poisoned = true
                else if (step.target.length === 1) model.host[step.target[0]] = deep(arg.model)
                else model.poisoned = true // native write crossing managed host data is unsupported
            }
            r.assignPath(root, target, arg.runtime, ctx)
        } else if (step.kind === "managed") {
            const mode = step.delivery
            if (step.op === "push") { model.data.list.push(step.value); r.run(root, ["data", "list"], "push", [source(step.value, mode)], ctx, { mutationScopeDepth: 2 }) }
            else if (step.op === "set") { model.data.obj.k = step.value; r.assignPath(root, ["data", "obj", "k"], source(step.value, mode), ctx) }
            else { model.data.obj.n = [step.value]; r.assignPath(root, ["data", "obj", "n"], [source(step.value, mode)], ctx) }
        } else if (step.kind === "mutate-snap") {
            const snap = snaps[step.which % Math.max(snaps.length, 1)]
            if (!snap || snap.failed || snap.model === undefined || snap.model === null || typeof snap.model !== "object") continue
            if (Array.isArray(snap.model)) {
                snap.model.push(step.value)
                r.run(snap.holder, [], "push", [step.value], ctx, { mutationScopeDepth: 0 })
            } else {
                snap.model.z = step.value
                r.assignPath(snap.holder, ["z"], step.value, ctx)
            }
        } else if (step.kind === "read") {
            let value = model.host
            for (const key of step.target) value = value?.[key]
            const expected = model.poisoned ? "ERR" : value === undefined ? "u" : show(value)
            check(keep(r.lookupPath(root, ["api", ...step.target], ctx)), expected, label + ` ${step.target.join(".")}`)
        } else if (step.kind === "fail") {
            if (!model.poisoned) { model.host.counter = -100; model.poisoned = true }
            check(keep(r.run(root, ["api"], "fail", [], ctx, M)), "ERR", label)
        } else if (step.kind === "repair") {
            model.poisoned = false
            r.repairPath(root, ["api"], ctx)
        } else if (step.kind === "query") {
            const result = r.hasError(root, ["api"], ctx)
            check({ raw: result }, show(model.poisoned), label)
        } else if (step.kind === "readonly-entry") {
            let value = model.host
            for (const key of step.target) value = value?.[key]
            const expected = model.poisoned ? "ERR" : show(deep(value))
            const delay = gate()
            const act = inside => r.lookupPath(inside, [...step.target], ctx)
            const result = r.enter(root, ["api"], ctx, false, inside => delay ? delay.then(() => { act(inside) }) : act(inside))
            // Callback results that are Chains are not language values; keep it simple: only the ready route here.
            if (!delay) check(keep(result), expected, label)
            else keep(result)
        } else if (step.kind === "export") {
            const path = step.which === "items" ? ["api", "items"] : step.which === "store" ? ["api", "meta"] : ["data"]
            const expected = step.which === "data" ? show(deep(model.data)) : model.poisoned ? "ERR"
                : show(deep(step.which === "items" ? model.host.items : model.host.meta))
            check({ raw: r.export(root, path, ctx) }, expected, label + ` ${step.which}`)
        } else if (step.kind === "settle") await settle()
        doVerify()
        for (let i = 0; i < step.release; i++) releaseOne()
        for (let t = 0; t < step.turns; t++) { await Promise.resolve(); doVerify() }
    }
    await settle()
    // Snapshots keep their captured values plus their own later mutations.
    for (const [i, snap] of snaps.entries())
        if (!snap.failed) check({ raw: r.export(snap.holder, [], ctx) }, show(snap.model), `final snapshot ${i}`)
    check({ raw: r.export(root, ["data"], ctx) }, show(deep(model.data)), "final data")
    await settle()
    const errors = []
    for (const { value, expected, label } of checks) {
        let actual
        try {
            const raw = value instanceof r.Chain ? r.export(value, [], ctx) : value.raw
            const settled = await within(raw)
            actual = settled === BLOCKED ? "BLOCKED" : Error.isError(settled) ? "ERR" : show(settled)
        } catch (error) {
            actual = r.isPoisonError(error) ? "ERR" : `THREW:${error?.message}`
        }
        if (actual !== expected) errors.push(`${label}: got ${actual} want ${expected}`)
    }
    const hostData = { items: host.items, meta: host.meta, counter: host.counter }
    if (show(hostData) !== show(model.host)) errors.push(`host store: got ${show(hostData)} want ${show(model.host)}`)
    doVerify()
    if (ctx.execution.fatalError) errors.push(`fatal ${ctx.execution.fatalError.cause?.stack}`)
    return { errors }
}

const BLOCKED = Symbol()
async function within(value) {
    let s
    Promise.resolve(value).then(v => { s = { v } }, e => { s = { e } })
    for (let t = 0; t < 60 && !s; t++) await new Promise(setImmediate)
    if (!s) return BLOCKED
    if (s.e) throw s.e
    return s.v
}

const count = Number(process.env.PROGRAMS ?? 200), start = Number(process.env.START ?? 0)
const deliveries = (process.env.DELIVERIES ?? "ready,sync,native,ordered").split(",")
let failures = 0
for (let index = start; index < start + count; index++) {
    const seed = (0x5eed + Math.imul(index, 0x9e3779b9)) >>> 0
    const program = generate(createRandom(seed))
    for (const delivery of deliveries) {
        let outcome
        try { outcome = await runProgram(program, delivery, seed, process.env.VERIFY === "1") }
        catch (error) { outcome = { errors: [`threw ${error?.stack}`] } }
        if (outcome.errors.length) {
            failures++
            console.log(`FAIL program ${index} delivery=${delivery}`)
            for (const e of outcome.errors.slice(0, 6)) console.log("   ", e)
            if (process.env.SHOW) console.log(JSON.stringify(program))
            break
        }
    }
    if (failures >= Number(process.env.MAXFAIL ?? 5)) break
}
console.log(`done failures=${failures}`)
