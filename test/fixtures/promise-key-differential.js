import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { ready as syncReady, rejected as syncRejected, OrderedThenable } from "../ordered-thenable.js"
import { createRandom } from "../native-equivalence-support.js"
import { reportGeneratedStage, runGeneratedCases } from "../generated-runner.js"

// Compare one program with identical provenance under ready, synchronous and
// randomly delivered native/ordered keys. This supplements the independent
// models; focused semantic tests establish the expected recovery/precedence.
const OPS = 10

// Static shape used only to generate meaningful paths.
const NUM = { kids: {} }
const S = {}
S.harr = { kids: { 0: NUM, 1: NUM, length: NUM }, obs: ["join", "includes", "at"], mut: ["push", "pop"] }
S.hdata = { kids: { v: NUM, arr: S.harr } }
S.child = { kids: { n: NUM, data: S.hdata }, obs: ["read"], mut: ["inc", "fail", "tick"] }
S.api = { kids: { n: NUM, data: S.hdata, child: S.child }, obs: ["read"], mut: ["inc", "fail", "tick"] }
S.svc = { kids: { n: NUM, data: S.hdata }, obs: ["read"], mut: ["inc", "fail", "tick"] }
S.pext = { kids: { n: NUM, data: S.hdata }, obs: ["read"], mut: ["inc"] }
S.list = { kids: { 0: NUM, 1: NUM, 2: NUM, length: NUM }, obs: ["join", "includes", "at"], mut: ["push", "pop", "reverse"] }
S.Po = { kids: { q: NUM } }
S.Pa = { kids: { x: NUM, list: S.list, o: S.Po }, obs: ["get"], mut: ["bump"] }
S.Pb = { kids: { y: NUM } }
S.Pm = { kids: { z: NUM } }
S.Pg = { kids: { svc: S.svc, m: S.Pm } }
S.P = { kids: { a: S.Pa, b: S.Pb, g: S.Pg, ext: S.pext } }
S.root = { kids: { api: S.api, P: S.P } }

function world(ctx) {
    const logs = {}
    const log = (name, what) => (logs[name] ??= []).push(what)
    const ext = name => r.externalState({
        n: 0, data: { v: 1, arr: [4, 5] },
        read() { log(name, "read"); return this.n },
        inc() { log(name, "inc"); return ++this.n },
        fail() { log(name, "fail"); throw new Error(name + ":fail") },
        tick() { log(name, "tick"); return Promise.resolve(++this.n) },
    })
    const child = ext("child"), svc = ext("svc"), pext = ext("pext")
    const api = ext("api"); api.child = child
    const names = new Map([[api, "api"], [child, "child"], [svc, "svc"], [pext, "pext"]])
    const root = { api, P: { a: { x: 1, list: [1, 2, 3], o: { q: 1 }, get() { return this.x }, bump() { this.x++; return this.x } },
        b: { y: 2 }, g: { svc, m: { z: 3 } }, ext: pext } }
    const chain = new r.ContextChain(root, ctx, { api: { child: {} }, P: { g: { svc: {} } } })
    return { chain, names, logs, hosts: { api, child, svc, pext } }
}

function genPath(rand, shape, maxDepth) {
    const path = []
    let node = shape
    const depth = Math.floor(rand() * (maxDepth + 1))
    for (let i = 0; i < depth; i++) {
        const keys = Object.keys(node.kids)
        const x = rand()
        if (x < 0.06) { path.push({ key: "zz" }); node = NUM; break }
        if (x < 0.08) { path.push({ key: { bad: 1 } }); node = NUM; break }
        if (!keys.length) break
        const key = keys[Math.floor(rand() * keys.length)]
        path.push({ key: /^\d+$/.test(key) && rand() < 0.5 ? Number(key) : key })
        node = node.kids[key]
    }
    return { path, node }
}

function genKeys(rand, path) {
    // Provenance boundary d: keys at >= d may be delayed in delayed modes; d is passed in every mode.
    const d = rand() < 0.35 ? path.length : Math.floor(rand() * (path.length + 1))
    for (let i = 0; i < path.length; i++) {
        const k = path[i]
        k.delayed = i >= d && rand() < 0.75
        k.delivery = ["native", "ordered", "sync"][Math.floor(rand() * 3)]
        k.reject = k.delayed && rand() < 0.04
    }
    return d
}

const VALUES = [() => 5, () => "s", () => ({ k: 1 }), () => [1, 2], () => null]
const OBSERVE = ["lookup", "expr", "export", "call", "hasError", "getErrors"]
function genOp(rand, inside = undefined, readonly = false) {
    const kinds = ["lookup", "lookup", "expr", "export", "assign", "assign", "delete", "call", "mutate", "mutate", "hasError", "getErrors", "getErrors", "repair", "repaircall", "enter"]
    const pool = readonly ? OBSERVE : inside ? kinds.slice(0, -1) : kinds
    const kind = pool[Math.floor(rand() * pool.length)]
    const base = inside ?? S.root
    const { path, node } = genPath(rand, base, inside ? 3 : 5)
    const op = { kind, path }
    if (kind === "call" || kind === "mutate" || kind === "repaircall") {
        const list = kind === "call" ? node.obs : node.mut
        op.method = list?.length && rand() < 0.9 ? list[Math.floor(rand() * list.length)] : "nope"
        op.args = op.method === "includes" ? [2] : op.method === "join" ? [","] : op.method === "at" ? [0] : op.method === "push" ? [7] : []
        op.scope = path.length && rand() < 0.3 ? 1 + Math.floor(rand() * path.length) : path.length
    }
    if (kind === "assign" || kind === "delete") op.scope = path.length && rand() < 0.2 ? 1 + Math.floor(rand() * path.length) : path.length
    if (kind === "assign") op.value = Math.floor(rand() * VALUES.length)
    if (kind === "enter") { op.mutable = rand() < 0.6; op.inner = genOp(rand, node, !op.mutable) }
    op.d = genKeys(rand, path)
    return op
}

function genProgram(seed) {
    const rand = createRandom(seed)
    const ops = []
    for (let i = 0; i < OPS; i++) ops.push(genOp(rand))
    // Resolution slots for delayed keys: after op slot..OPS (inclusive = end).
    const all = []
    const visit = op => { for (const k of op.path) if (k.delayed) all.push(k); if (op.inner) visit(op.inner) }
    for (const op of ops) visit(op)
    for (const k of all) k.when = k.delivery === "sync" ? -1 : Math.floor(rand() * (OPS + 1))
    const order = all.map(k => ({ k, rank: rand() }))
    order.sort((a, b) => a.rank - b.rank)
    order.forEach(({ k }, i) => { k.order = i })
    return ops
}

const turn = () => new Promise(setImmediate)
function normalize(v, names, seen = new Set()) {
    if (r.isPoisonError(v)) return "ERR[" + (v.errors ?? [v]).map(e => e.kind + "@" + e.errorContext + ":" + (e.cause?.message ?? e.message)).sort().join("|") + "]"
    if (names.has(v)) return "ext:" + names.get(v)
    if (typeof v === "function") return "fn"
    if (typeof v === "bigint") return v + "n"
    if (v === undefined) return "undef"
    if (v === null || typeof v !== "object") return JSON.stringify(v)
    if (seen.has(v)) return "cycle"
    seen.add(v)
    const out = Array.isArray(v) ? "[" + Array.from({ length: v.length }, (_, i) => i in v ? normalize(v[i], names, seen) : "hole").join(",") + "]"
        : "{" + Object.keys(v).map(k => k + ":" + normalize(v[k], names, seen)).join(",") + "}"
    seen.delete(v)
    return out
}
async function settle(value, names) {
    let timer
    try {
        return await Promise.race([
            Promise.resolve(value).then(v => normalize(v, names), e => {
                assert(r.isPoisonError(e), `unexpected rejection: ${e?.stack ?? e}`)
                return "REJ[" + normalize(e, names) + "]"
            }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("result did not settle")), 1000) }),
        ])
    } finally { clearTimeout(timer) }
}

async function runProgram(ops, mode) {
    const execution = new r.Execution()
    const ctx = { execution, errorContext: "initial" }
    const w = world(ctx)
    const holders = new r.Chain({}, ctx)
    const pending = []
    const keyOf = k => {
        if (!k.delayed || mode === "ready") return k.reject ? syncRejected(new Error("keyfail")) : k.key
        const delivery = mode === "sync" ? "sync" : k.delivery
        if (delivery === "sync") return k.reject ? syncRejected(new Error("keyfail")) : syncReady(k.key)
        if (delivery === "native") {
            const p = Promise.withResolvers(); p.promise.catch(() => {})
            pending.push({ k, settle() { if (this.done) return; this.done = true; k.reject ? p.reject(new Error("keyfail")) : p.resolve(k.key) } })
            return p.promise
        }
        const t = new OrderedThenable()
        pending.push({ k, settle() { if (this.done) return; this.done = true; k.reject ? t.reject(new Error("keyfail")) : t.resolve(k.key) } })
        return t
    }
    const results = []
    const issue = (op, chain, slot) => {
        const ctx = { execution, errorContext: "op:" + slot }
        const path = op.path.map(keyOf), d = op.d
        switch (op.kind) {
            case "lookup": {
                const v = r.lookupPath(chain, path, ctx, d)
                r.assignPath(holders, ["r" + slot], v, ctx)
                return undefined
            }
            case "expr": return r.lookupPathForExpression(chain, path, ctx, d)
            case "export": return r.export(chain, path, ctx, d)
            case "assign": { r.assignPath(chain, path, VALUES[op.value](), ctx, op.scope, d); return undefined }
            case "delete": { r.deletePath(chain, path, ctx, op.scope, d); return undefined }
            case "call": return r.run(chain, path, op.method, op.args, ctx, { firstDynamicSegment: d })
            case "mutate": return r.run(chain, path, op.method, op.args, ctx, { mutationScopeDepth: op.scope, firstDynamicSegment: d })
            case "repaircall": return r.run(chain, path, op.method, op.args, ctx, { mutationScopeDepth: op.scope, repair: true, firstDynamicSegment: d })
            case "hasError": return r.hasError(chain, path, ctx, d)
            case "getErrors": return r.getErrors(chain, path, ctx, d)
            case "repair": return r.repairPath(chain, path, ctx, d)
            case "enter": {
                let inner, ran = false
                const entered = r.enter(chain, path, ctx, op.mutable, inside => { ran = true; inner = issue(op.inner, inside, slot + "i"); if (inner && typeof inner.then === "function") Promise.resolve(inner).catch(() => {}); return undefined }, d)
                if (entered && typeof entered.then === "function") Promise.resolve(entered).catch(() => {})
                return { entered, get inner() { return inner }, get ran() { return ran } }
            }
        }
    }
    for (let i = 0; i < ops.length; i++) {
        const res = issue(ops[i], w.chain, i)
        results.push(res)
        if (res && typeof res.then === "function") Promise.resolve(res).catch(() => {})
        assert.equal(execution.fatalError, null)
        if (mode === "mixed") {
            for (const p of pending.filter(p => p.k.when <= i && !p.done).sort((a, b) => a.k.order - b.k.order)) p.settle()
            await turn()
        }
    }
    if (mode === "mixed") {
        for (;;) {
            const open = pending.filter(p => !p.done).sort((a, b) => a.k.order - b.k.order)
            if (!open.length) break
            for (const p of open) { p.settle(); if (p.k.order % 2) await turn() }
            await turn()
        }
    }
    const out = []
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i], res = results[i]
        if (op.kind === "enter") out.push("enter=" + await settle(res.entered, w.names) + " inner=" + (res.ran ? "" : "NOT-RUN ") + (op.inner.kind === "lookup" ? "-" :
            ["assign", "delete"].includes(op.inner.kind) ? "-" : await settle(res.inner, w.names)))
        else if (["assign", "delete", "lookup"].includes(op.kind)) out.push("-")
        else out.push(await settle(res, w.names))
    }
    // Assignment/deletion return issuance acknowledgements. Compare their
    // published effects and retained lookups after all supplied keys settle.
    const fin = []
    for (let i = 0; i < ops.length; i++) {
        if (ops[i].kind === "lookup") fin.push("r" + i + "=" + await settle(r.export(holders, ["r" + i], ctx), w.names))
        if (ops[i].kind === "enter" && ops[i].inner.kind === "lookup") fin.push("r" + i + "i=" + await settle(r.export(holders, ["r" + i + "i"], ctx), w.names))
    }
    for (const p of [["P", "a"], ["P", "b"], ["P", "g", "m"], ["P", "a", "list"]]) fin.push(p.join(".") + "=" + await settle(r.export(w.chain, p, ctx), w.names))
    for (const p of [[], ["api"], ["api", "child"], ["P"], ["P", "g", "svc"], ["P", "ext"], ["P", "a"]]) fin.push("E(" + p.join(".") + ")=" + await settle(r.getErrors(w.chain, p, ctx), w.names))
    for (const [name, host] of Object.entries(w.hosts)) fin.push(name + ":n=" + host.n + ",data=" + normalize(host.data, w.names) + ",log=" + (w.logs[name] ?? []).join(","))
    assert.equal(execution.fatalError, null)
    return { out, fin }
}

// Keep both discovered families in every run, even with a small seed budget.
function witness(name) {
    if (name === "recovery") {
        const ops = []
        for (const kind of ["assign", "delete"])
        for (const reject of [false, true])
        for (const delivery of ["native", "ordered"]) {
            // All three following commands are issued before this key settles.
            // Query both sides of repair, then start the next failure healthy.
            const key = { key: reject ? "x" : {}, reject, delayed: true, delivery, when: ops.length + 3, order: 0 }
            const prefix = [{ key: "P" }, { key: "a" }]
            ops.push(
                { kind, path: [...prefix, key, { key: "y" }], d: 2, scope: 4, value: 0 },
                { kind: "getErrors", path: prefix, d: 2 },
                { kind: "repair", path: prefix, d: 2 },
                { kind: "getErrors", path: prefix, d: 2 },
            )
        }
        return ops
    }
    const key = { key: "svc", delayed: true, delivery: "native", when: OPS, order: 0 }
    return [{ kind: "mutate", path: [{ key: "P" }, { key: "g" }, key], d: 2, scope: 1, method: "fail", args: [] }]
}

// Derive joint coverage from the commands and their release schedule, rather
// than declaring it from the witness name or independent dimension counters.
function coverFailureFollowups(ops, coverage) {
    for (const [index, op] of ops.entries()) {
        if (op.kind !== "assign" && op.kind !== "delete") continue
        const failed = op.path.findIndex(key => key.reject || !["string", "number"].includes(typeof key.key))
        if (failed < 0 || op.scope <= failed) continue
        const key = op.path[failed]
        if (!key.delayed || !["native", "ordered"].includes(key.delivery)) continue
        for (let next = index + 1; next < Math.min(ops.length, index + 3); next++) {
            const followup = ops[next]
            if (key.when < next || !["getErrors", "repair"].includes(followup.kind) ||
                followup.path.length !== failed || followup.path.some((part, i) => part.delayed || part.key !== op.path[i].key)) break
            coverage.add(`failed-key:${op.kind}:${key.reject ? "rejected" : "invalid"}:${key.delivery}:${followup.kind}`)
        }
    }
}

const programs = Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16) * 6
const start = Number(process.env.CASCADA_SEQUENCE_START ?? 0)
const coverage = new Set()
let runs = 0
const totals = await runGeneratedCases({
    moduleURL: import.meta.url,
    cases: [ ...["recovery", "scope"].map(witness => ({ witness })),
        ...Array.from({ length: programs - start }, (_, offset) => ({ seed: start + offset + 1 })) ],
    async runCase(spec) {
        const ops = spec.witness ? witness(spec.witness) : genProgram(spec.seed)
        const coverage = new Set()
        const visit = op => {
            coverage.add("operation:" + op.kind)
            for (const key of op.path) {
                if (key.delayed) coverage.add("delivery:" + key.delivery)
                if (key.reject) coverage.add("key:rejected")
                if (typeof key.key === "object") coverage.add("key:invalid")
            }
            if (op.d < op.path.length) coverage.add("provenance:dynamic")
            if (op.inner) visit(op.inner)
        }
        ops.forEach(visit)
        coverFailureFollowups(ops, coverage)
        const modes = ["ready", "sync", "mixed"]
        let baseline
        for (const [index, mode] of modes.entries()) {
            reportGeneratedStage({ ...spec, delivery: mode, remainingReplays: modes.slice(index + 1) })
            try {
                const result = await runProgram(ops, mode)
                if (index === 0) baseline = result
                else assert.deepEqual(result, baseline, "key availability changed the program outcome")
            } catch (error) {
                throw new Error(`${JSON.stringify(spec)}, delivery=${mode}, program=${JSON.stringify(ops)}`, { cause: error })
            }
        }
        return { runs: modes.length, coverage: [...coverage] }
    },
    onPass(result) {
        runs += result.runs
        for (const key of result.coverage) coverage.add(key)
    },
})
console.log(JSON.stringify({ programs: totals.passed, witnesses: 2, runs, coverage: [...coverage].sort(), ...totals }))
