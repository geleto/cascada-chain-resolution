// Run 02 scratch differential: many Array owners sharing backing, pending
// payloads in structural methods, derived views/results, element writes,
// length changes, scope poison and repair. Independent native-semantics model.
import * as r from "../../src/index.js"
import { inspect } from "node:util"
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

const ERROR = { error: true }
const VALUES = [0, 1, 2, undefined, NaN, "x", 7, -0]
const NESTED = [[5, 6], [5, [6]], [], [, 3]]
const INITIAL = [[0, 1, 2], [0, , 2, undefined], [NaN, 1, 1, 0], [7], [], [[5, 6], 1, [5, [6]]]]
const INDEXES = [undefined, 0, 1, 2, 3, 5, -1, -2, -4, Infinity, -Infinity, 9, 1.5, "2", null, true]

const clone = value => {
    if (!Array.isArray(value)) return value
    const result = new Array(value.length)
    for (const key of Object.keys(value)) result[key] = clone(value[key])
    return result
}
const containsError = value => value === ERROR || value?.prefix === true || Array.isArray(value) && Object.values(value).some(containsError)
function display(value) {
    if (containsError(value)) return "ERR"
    if (value === undefined) return "u"
    if (Array.isArray(value))
        return `[${value.length}:${[...Array(value.length).keys()].map(i => i in value ? display(value[i]) : "_").join(",")}]`
    if (typeof value === "string") return JSON.stringify(value)
    if (Object.is(value, -0)) return "-0"
    return String(value)
}

const comparatorKey = v => typeof v === "number" ? (Number.isNaN(v) ? 50 : v) : Array.isArray(v) ? 200 : 100
// Native sort consumes elements only when two defined candidates exist.
const sortFails = slots => {
    const defined = Object.values(slots).filter(value => value !== undefined)
    return defined.length >= 2 && defined.some(containsError)
}
let afterFatal = false, lateCallbacks = 0
const comparator = (a, b) => { if (afterFatal) lateCallbacks++; return comparatorKey(a) - comparatorKey(b) }

// --- program generation (all randomness here) ---
function generate(random) {
    const int = n => Math.floor(random() * n)
    const pick = list => list[int(list.length)]
    const payload = () => {
        const roll = random()
        const value = roll < 0.15 ? clone(pick(NESTED)) : pick(VALUES)
        const state = random() < 0.45 ? "pending" : random() < 0.1 ? "rejected" : "ready"
        return { value, state }
    }
    const numeric = () => {
        const value = pick(INDEXES)
        const state = random() < 0.15 ? "pending" : random() < 0.04 ? "rejected" : "ready"
        return { value, state }
    }
    const steps = []
    const count = 20 + int(26)
    let owners = 1 + int(2)
    for (let i = 0; i < count; i++) {
        const owner = int(owners)
        const roll = int(42)
        let step
        if (roll < 8) {
            const method = pick(["push", "push", "push", "unshift", "splice", "splice", "fill", "pop", "shift", "reverse", "copyWithin", "sort"])
            let args
            if (method === "push" || method === "unshift") args = Array.from({ length: 1 + int(2) }, payload)
            else if (method === "splice") args = [numeric(), numeric(), ...Array.from({ length: int(3) }, payload)]
            else if (method === "fill") args = [payload(), ...(random() < 0.6 ? [numeric()] : []), ...(random() < 0.4 ? [numeric()] : [])]
            else if (method === "copyWithin") args = [numeric(), numeric(), ...(random() < 0.5 ? [numeric()] : [])]
            else if (method === "sort") args = random() < 0.5 ? [] : [{ value: "cmp", state: "ready" }]
            else args = []
            step = { kind: "mutate", method, args, route: pick(["direct", "direct", "entry", "delayed-entry"]), rootScope: random() < 0.3 }
        } else if (roll < 13) {
            step = { kind: "element", effect: pick(["set", "set", "delete", "prefix", "repair"]), index: int(7), value: payload() }
        } else if (roll < 15) {
            step = { kind: "length", length: int(7) }
        } else if (roll < 16) {
            step = { kind: "repair" }
        } else if (roll < 18) {
            step = { kind: "entry-element", effect: pick(["set", "set", "delete"]), index: int(7), value: payload(), delayed: random() < 0.6 }
        } else if (roll < 19) {
            step = { kind: "nested", index: int(5), value: payload() }
        } else if (roll < 25) {
            const method = pick(["at", "includes", "indexOf", "lastIndexOf", "join", "toString", "slice", "with",
                "concat", "flat", "toSorted", "toReversed", "toSpliced"])
            let args
            if (method === "at") args = [numeric()]
            else if (["includes", "indexOf", "lastIndexOf"].includes(method))
                args = [{ value: pick(VALUES), state: random() < 0.2 ? "pending" : "ready" }, ...(random() < 0.5 ? [numeric()] : [])]
            else if (method === "join") args = random() < 0.5 ? [] : [{ value: pick(["-", "", undefined, 1]), state: random() < 0.3 ? "pending" : "ready" }]
            else if (method === "slice") args = random() < 0.3 ? [] : [numeric(), ...(random() < 0.5 ? [numeric()] : [])]
            else if (method === "with") args = [numeric(), payload()]
            else if (method === "concat") args = Array.from({ length: int(3) }, () =>
                random() < 0.4 ? { value: clone(pick(NESTED)), state: random() < 0.5 ? "pending" : "ready" } : payload())
            else if (method === "flat") args = random() < 0.5 ? [] : [{ value: pick([0, 1, 2, Infinity]), state: "ready" }]
            else if (method === "toSorted") args = random() < 0.5 ? [] : [{ value: "cmp", state: "ready" }]
            else if (method === "toSpliced") args = [numeric(), numeric(), ...Array.from({ length: int(2) }, payload)]
            else args = []
            step = { kind: "observe", method, args, route: pick(["direct", "direct", "entry", "delayed-entry"]),
                derive: ["slice", "with", "concat", "flat", "toSorted", "toReversed", "toSpliced"].includes(method) && random() < 0.5 }
        } else if (roll < 30) {
            step = { kind: "read", index: int(6) }
        } else if (roll < 34) {
            step = { kind: "view", wrap: random() < 0.5 }
        } else if (roll < 36) {
            step = { kind: "export" }
        } else if (roll < 37) {
            step = random() < 0.5 ? { kind: "settle" } : { kind: "query", which: random() < 0.5 ? "hasError" : "getErrors", index: random() < 0.4 ? int(5) : undefined }
        } else {
            step = { kind: "derive-slice", args: random() < 0.5 ? [] : [numeric(), numeric()], wrap: random() < 0.5 }
        }
        step.owner = owner
        step.release = int(3)
        step.turns = int(3)
        if (step.kind === "view" || step.kind === "derive-slice" || step.derive) step.newOwner = owners++
        steps.push(step)
    }
    return { initial: clone(pick(INITIAL)), wrap: random() < 0.7, steps, fatalAt: int(steps.length + 1), fatalPending: random() < 0.5 }
}

// --- model ---
function resolveArg(arg) { return arg.state === "rejected" ? ERROR : arg.value === "cmp" ? comparator : clone(arg.value) }

function toNumberLike(v) { return v } // native coercion applies to primitives only

function modelMutate(state, method, args, depth) {
    // An Error consumed inside a healthy wider scope poisons that scope.
    if (state.poisoned && depth < state.poisoned.depth) state.poisoned = { depth, inner: state.poisoned }
    if (state.dead || state.poisoned) return { result: "ERR" }
    const vals = args.map(resolveArg)
    const numericPositions = { __proto__: null, splice: [0, 1], fill: [1, 2], copyWithin: [0, 1, 2] }[method] ?? []
    const failedNumeric = numericPositions.some(i => i < args.length && args[i].state === "rejected")
    if (failedNumeric || method === "sort" && sortFails(state.slots)) {
        state.poisoned = { baseline: state.slots, depth }
        state.slots = undefined
        return { result: "ERR" }
    }
    const slots = state.slots
    const result = Array.prototype[method].apply(slots, vals.map(toNumberLike))
    if (["push", "unshift"].includes(method)) return { result: String(result) }
    if (["reverse", "fill", "copyWithin", "sort"].includes(method)) return { result: display(slots) }
    return { result: display(result) }
}

function modelObserve(state, method, args) {
    if (state.dead || state.poisoned) return { result: "ERR", failed: true }
    const slots = state.slots
    const vals = args.map(resolveArg)
    const isSearch = ["includes", "indexOf", "lastIndexOf"].includes(method)
    if (isSearch) {
        if (args[0].state === "rejected") return { result: "ERR", failed: true }
        if (slots.length !== 0 && args[1]?.state === "rejected") return { result: "ERR", failed: true }
        if (slots.length === 0) return { result: display(method === "includes" ? false : -1) }
    }
    const numericPositions = { __proto__: null, at: [0], slice: [0, 1], with: [0], toSpliced: [0, 1], join: [0] }[method] ?? []
    if (numericPositions.some(i => i < args.length && args[i].state === "rejected")) return { result: "ERR", failed: true }
    if (method === "concat" && args.some(a => a.state === "rejected")) return { result: "ERR", failed: true }
    if (["join", "toString"].includes(method) && Object.values(slots).some(containsError)) return { result: "ERR", failed: true }
    if (method === "toSorted" && sortFails(slots)) return { result: "ERR", failed: true }
    let value
    try {
        value = Array.prototype[method].apply(cloneSlots(slots), vals)
    } catch {
        return { result: "ERR", failed: true }
    }
    return { result: display(value), value }
}

// --- runtime ---
async function runProgram(program, delivery, seed, verify) {
    const random = createRandom(seed ^ 0x51ed27)
    const reports = []
    const ctx = { execution: new r.Execution(error => reports.push(error)), errorContext: "run02" }
    afterFatal = false; lateCallbacks = 0
    const raws = []
    const track = raw => {
        const rec = { pendingAtFatal: undefined }
        raws.push(rec)
        if (raw !== null && (typeof raw === "object" || typeof raw === "function") && typeof raw.then === "function" && raw instanceof Promise) {
            rec.promise = true
            rec.raw = raw
            raw.then(v => { rec.v = true; rec.after = afterFatal }, e => { rec.e = e; rec.after = afterFatal })
        }
        return raw
    }
    const holds = []
    const checks = []
    const roots = []
    const source = arg => {
        if (arg.value === "cmp") return comparator
        const value = clone(arg.value)
        const failure = () => new Error("rejected payload")
        if (arg.state === "ready") return value
        if (arg.state === "rejected" && delivery === "ready")
            return { then: (_resolve, reject) => reject(failure()) }
        if (delivery === "ready" || delivery === "sync")
            return arg.state === "rejected" ? { then: (_resolve, reject) => reject(failure()) } : { then: resolve => resolve(value) }
        if (delivery === "native") {
            const held = Promise.withResolvers()
            held.promise.catch(() => {})
            holds.push(() => arg.state === "rejected" ? held.reject(failure()) : held.resolve(value))
            return held.promise
        }
        const thenable = new OrderedThenable()
        holds.push(() => arg.state === "rejected" ? thenable.reject(failure()) : thenable.resolve(value))
        return thenable
    }
    const gate = () => {
        if (delivery === "ready" || delivery === "sync") return undefined
        const held = Promise.withResolvers()
        holds.push(() => held.resolve())
        return held.promise
    }
    const keep = value => {
        track(value)
        const holder = new r.Chain(value, ctx)
        roots.push(holder)
        return holder
    }
    const check = (holder, expected, label) => checks.push({ holder, expected, label })
    const initialValue = clone(program.initial)
    const first = program.wrap ? { chain: keep({ a: initialValue }), path: ["a"] } : { chain: keep(initialValue), path: [] }
    const owners = [{ ...first, state: { slots: clone(program.initial) } }]
    // Second initial owner shares backing via a lookup view.
    owners.push({ chain: keep({ a: r.lookupPath(first.chain, first.path, ctx) }), path: ["a"], state: { slots: clone(program.initial) } })
    const ensureOwner = index => owners[index]
    const releaseOne = () => {
        if (!holds.length) return
        const [release] = holds.splice(Math.floor(random() * holds.length), 1)
        release()
    }
    const doVerify = () => { if (verify) verifyRefCounts(ctx, ...roots.map(root => root._state)) }
    const settle = async () => {
        for (let guard = 0; guard < 200; guard++) {
            while (holds.length) {
                releaseOne()
                await Promise.resolve()
                doVerify()
            }
            for (let t = 0; t < 4; t++) { await new Promise(setImmediate); doVerify() }
            if (!holds.length) return
        }
    }
    const log = []
    let fatal
    const injectFatal = () => {
        for (const rec of raws) rec.pendingAtFatal = rec.promise && inspect(rec.raw, { depth: 0 }).startsWith("Promise { <pending>")
        const cause = new Error("injected fatal")
        try { r.runInternalStep({ execution: ctx.execution, errorContext: "fatal-site" }, () => { throw cause }) } catch (error) { fatal = error }
        afterFatal = true
        for (const rec of raws) if (rec.pendingAtFatal && !inspect(rec.raw, { depth: 0 }).startsWith("Promise { <rejected>")) rec.notSyncRejected = true
    }
    for (const [stepIndex, step] of program.steps.entries()) {
        if (stepIndex === program.fatalAt) { if (program.fatalPending) { injectFatal(); break } }
        if (stepIndex === program.fatalAt && !program.fatalPending) { await settle(); injectFatal(); break }
        const owner = ensureOwner(step.owner)
        const { chain, path, state } = owner
        const label = `#${stepIndex} o${step.owner} ${step.kind} ${step.method ?? step.effect ?? ""}`
        log.push(label)
        if (step.kind === "mutate") {
            const depth = step.rootScope && step.route === "direct" ? 0 : path.length
            const expected = modelMutate(state, step.method, step.args, depth).result
            const call = (target, targetPath, d) => r.run(target, targetPath, step.method, step.args.map(source), ctx, { mutationScopeDepth: d })
            let result
            if (step.route === "direct") result = call(chain, path, depth)
            else {
                const delay = step.route === "delayed-entry" ? gate() : undefined
                result = r.enter(chain, path, ctx, true, inside => delay ? delay.then(() => call(inside, [], 0)) : call(inside, [], 0))
            }
            check(keep(result), expected, label)
        } else if (step.kind === "element") {
            const target = [...path, step.index]
            if (step.effect === "set") {
                if (!state.dead && !state.poisoned) {
                    state.slots[step.index] = resolveArg(step.value)
                }
                track(r.assignPath(chain, target, source(step.value), ctx))
            } else if (step.effect === "delete") {
                if (!state.dead && !state.poisoned) delete state.slots[step.index]
                track(r.deletePath(chain, target, ctx))
            } else if (step.effect === "prefix") {
                const current = state.slots?.[step.index]
                if (Array.isArray(current) || current === ERROR || current?.prefix) continue
                if (!state.dead && !state.poisoned) {
                    const present = state.slots && step.index in state.slots
                    state.slots[step.index] = { prefix: true, baseline: current, absent: !present }
                }
                track(r.assignPath(chain, [...target, "x"], 1, ctx))
            } else if (step.effect === "repair") {
                if (!state.dead && !state.poisoned) {
                    const current = state.slots[step.index]
                    if (current?.prefix) {
                        if (current.absent) delete state.slots[step.index]
                        else state.slots[step.index] = current.baseline
                    }
                }
                track(r.repairPath(chain, target, ctx))
            }
        } else if (step.kind === "entry-element") {
            if (!state.dead && !state.poisoned) {
                if (step.effect === "set") state.slots[step.index] = resolveArg(step.value)
                else delete state.slots[step.index]
            }
            const delay = step.delayed ? gate() : undefined
            const act = inside => step.effect === "set" ? r.assignPath(inside, [step.index], source(step.value), ctx)
                : r.deletePath(inside, [step.index], ctx)
            keep(r.enter(chain, path, ctx, true, inside => delay ? delay.then(() => act(inside)) : act(inside)))
        } else if (step.kind === "nested") {
            const current = !state.dead && !state.poisoned ? state.slots[step.index] : undefined
            if (!Array.isArray(current)) continue
            const copy = state.slots[step.index] = clone(current)
            copy.push(resolveArg(step.value))
            check(keep(r.run(chain, [...path, step.index], "push", [source(step.value)], ctx,
                { mutationScopeDepth: path.length + 1 })), String(copy.length), label + "nested push")
        } else if (step.kind === "length") {
            if (!state.dead && !state.poisoned) state.slots.length = step.length
            track(r.assignPath(chain, [...path, "length"], step.length, ctx))
        } else if (step.kind === "repair") {
            const repairPath = path.slice(0, state.poisoned?.depth ?? path.length)
            if (state.poisoned?.inner) state.poisoned = state.poisoned.inner
            else if (state.poisoned) { state.slots = state.poisoned.baseline; state.poisoned = null }
            track(r.repairPath(chain, repairPath, ctx))
        } else if (step.kind === "observe") {
            const { result: expected, value, failed } = modelObserve(state, step.method, step.args)
            const call = (target, targetPath) => r.run(target, targetPath, step.method, step.args.map(source), ctx, {})
            let result
            if (step.route === "direct") result = call(chain, path)
            else {
                const delay = step.route === "delayed-entry" ? gate() : undefined
                result = r.enter(chain, path, ctx, false, inside => delay ? delay.then(() => call(inside, [])) : call(inside, []))
            }
            const holder = keep(result)
            check(holder, expected, label)
            if (step.derive) {
                owners[step.newOwner] = { chain: keep(r.lookupPath(holder, [], ctx)), path: [],
                    state: !failed && Array.isArray(value) ? { slots: cloneSlots(value) } : { dead: true } }
            }
        } else if (step.kind === "read") {
            const slots = state.slots
            const expected = state.dead || state.poisoned ? "ERR"
                : display(slots[step.index]?.prefix ? ERROR : slots[step.index])
            check(keep(r.lookupPath(chain, [...path, step.index], ctx)), expected, label + `[${step.index}]`)
            check(keep(r.lookupPath(chain, [...path, "length"], ctx)), state.dead || state.poisoned ? "ERR" : String(slots.length), label + ".length")
        } else if (step.kind === "view") {
            const view = r.lookupPath(chain, path, ctx)
            const holder = step.wrap ? keep({ a: view }) : keep(view)
            owners[step.newOwner] = { chain: holder, path: step.wrap ? ["a"] : [],
                state: state.dead || state.poisoned ? { dead: true } : { slots: cloneSlots(state.slots) } }
        } else if (step.kind === "derive-slice") {
            const { value, failed } = modelObserve(state, "slice", step.args)
            const result = r.run(chain, path, "slice", step.args.map(source), ctx, {})
            const holder = step.wrap ? keep({ a: result }) : keep(result)
            owners[step.newOwner] = { chain: holder, path: step.wrap ? ["a"] : [],
                state: !failed && Array.isArray(value) ? { slots: cloneSlots(value) } : { dead: true } }
        } else if (step.kind === "export") {
            check({ exported: track(r.export(chain, path, ctx)) },
                state.dead || state.poisoned ? "ERR" : displaySlots(state.slots), label)
        } else if (step.kind === "query") {
            const target = step.index === undefined ? path : [...path, step.index]
            let failed
            if (state.dead || state.poisoned) failed = true
            else if (step.index === undefined) failed = Object.values(state.slots).some(containsError)
            else failed = containsError(state.slots[step.index])
            const result = track(r[step.which](chain, target, ctx))
            const mapped = Promise.resolve(result).then(v => step.which === "hasError" ? v : v === null ? false : Error.isError(v) ? true : `odd:${v}`)
            mapped.catch(() => {})
            check({ exported: mapped },
                String(failed), label + " " + step.which)
        } else if (step.kind === "settle") {
            await settle()
        }
        doVerify()
        for (let i = 0; i < step.release; i++) releaseOne()
        for (let t = 0; t < step.turns; t++) { await Promise.resolve(); doVerify() }
    }
    if (fatal || program.fatalAt === program.steps.length) {
        if (!fatal) injectFatal()
        // Release everything; nothing may resume successfully.
        for (let g = 0; g < 50 && holds.length; g++) { releaseOne(); await Promise.resolve() }
        for (let t = 0; t < 30; t++) await new Promise(setImmediate)
        const errors = []
        if (!r.isFatalError(fatal)) errors.push(`fatal not FatalError: ${fatal}`)
        if (fatal?.cause?.message !== "injected fatal") errors.push(`wrong fatal cause ${fatal?.cause?.stack}`)
        if (reports.length !== 1 || reports[0] !== fatal) errors.push(`reports=${reports.length}`)
        if (ctx.execution.fatalError !== fatal) errors.push("execution fatal differs")
        if (lateCallbacks) errors.push(`late comparator callbacks ${lateCallbacks}`)
        let stillPending = 0
        for (const rec of raws) {
            if (!rec.promise) continue
            if (rec.v === undefined && rec.e === undefined) { stillPending++; continue }
            if (rec.pendingAtFatal && rec.v) errors.push("result pending at fatal later fulfilled")
            if (rec.notSyncRejected) errors.push("pending result not rejected synchronously at fatal commit")
            if (rec.pendingAtFatal && rec.e !== fatal) errors.push(`pending-at-fatal result not rejected with fatal: ${rec.v ? "fulfilled" : rec.e?.message}`)
        }
        if (stillPending) errors.push(`${stillPending} results never settled`)
        try { r.lookupPath(owners[0].chain, [], ctx); errors.push("lookup after fatal did not throw") } catch (error) { if (error !== fatal) errors.push("post-fatal entry threw other") }
        globalThis.__stats ??= { checks: 0, kinds: {}, nonErr: 0 }
        globalThis.__stats.fatalRuns = (globalThis.__stats.fatalRuns ?? 0) + 1
        globalThis.__stats.pendingAtFatal = (globalThis.__stats.pendingAtFatal ?? 0) + raws.filter(x => x.pendingAtFatal).length
        return { errors, log, kinds: [] }
    }
    await settle()
    for (const [index, owner] of owners.entries()) {
        if (!owner) continue
        check({ exported: r.export(owner.chain, owner.path, ctx) },
            owner.state.dead || owner.state.poisoned ? "ERR" : displaySlots(owner.state.slots), `final o${index}`)
    }
    await settle()
    const errors = [], kinds = []
    globalThis.__stats ??= { checks: 0, kinds: {}, nonErr: 0 }
    for (const step of program.steps) globalThis.__stats.kinds[step.kind] = (globalThis.__stats.kinds[step.kind] ?? 0) + 1
    for (const { holder, expected, label } of checks) {
        globalThis.__stats.checks++
        if (expected !== "ERR") globalThis.__stats.nonErr++
        let actual
        try {
            const exported = holder.exported !== undefined || "exported" in holder ? holder.exported : r.export(holder, [], ctx)
            const value = await settleWithin(exported)
            actual = value === BLOCKED ? "BLOCKED" : Error.isError(value) ? "ERR" : display(value)
            if (actual === "ERR") kinds.push(`${label}=${kindsOf(value)}`)
        } catch (error) {
            actual = error?.name === "PoisonError" || error?.name === "CompoundPoisonError" ? "ERR" : `THREW:${error?.message}`
            if (actual === "ERR") kinds.push(`${label}=${kindsOf(error)}`)
        }
        if (actual !== expected) errors.push(`${label}: got ${actual} want ${expected}`)
    }
    doVerify()
    if (ctx.execution.fatalError) errors.push(`fatal: ${ctx.execution.fatalError.cause?.stack ?? ctx.execution.fatalError}`)
    return { errors, log, kinds }
}
function kindsOf(error) {
    const leaves = error?.errors ?? [error]
    return [...new Set(leaves.map(leaf => leaf?.kind ?? "?"))].sort().join("+")
}

const BLOCKED = Symbol("blocked")
async function settleWithin(value) {
    let settled
    Promise.resolve(value).then(v => { settled = { v } }, e => { settled = { e } })
    for (let t = 0; t < 60 && !settled; t++) await new Promise(setImmediate)
    if (!settled) return BLOCKED
    if (settled.e) throw settled.e
    return settled.v
}

function cloneSlots(slots) {
    const result = new Array(slots.length)
    for (const key of Object.keys(slots)) result[key] = slots[key]?.prefix ? { ...slots[key] } : clone(slots[key])
    return result
}
function displaySlots(slots) {
    const values = new Array(slots.length)
    for (const key of Object.keys(slots)) values[key] = slots[key]?.prefix ? ERROR : slots[key]
    return display(values)
}

// --- reduction support ---
const reviver = (k, v) => v === "Infinity" ? Infinity : v === "-Infinity" ? -Infinity : v === "NaN" ? NaN : v
const replacer = (k, v) => typeof v === "number" && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? "-0" : v
async function fails(program, deliveries, seed) {
    for (const delivery of deliveries) {
        let outcome
        try { outcome = await runProgram(JSON.parse(JSON.stringify(program, replacer), reviver2), delivery, seed, process.env.VERIFY === "1") }
        catch (error) { outcome = { errors: [`threw: ${error?.stack ?? error}`] } }
        if (outcome.errors.length) return outcome.errors
    }
}
function reviver2(k, v) { return v === "-0" ? -0 : reviver(k, v) }
function withoutStep(program, index) {
    const removed = new Set()
    const steps = []
    for (const [i, step] of program.steps.entries()) {
        if (i === index || removed.has(step.owner)) { if (step.newOwner !== undefined) removed.add(step.newOwner); continue }
        steps.push(step)
    }
    return { ...program, steps }
}
if (process.env.REDUCE) {
    const index = Number(process.env.REDUCE)
    const seed = (0x1234567 + Math.imul(index, 0x9e3779b9)) >>> 0
    let program = generate(createRandom(seed))
    const ds = (process.env.DELIVERIES ?? "ready,sync,native,ordered").split(",")
    let errors = await fails(program, ds, seed)
    if (!errors) { console.log("does not fail"); process.exit(0) }
    let changed = true
    while (changed) {
        changed = false
        for (let i = program.steps.length - 1; i >= 0; i--) {
            const candidate = withoutStep(program, i)
            const e = await fails(candidate, ds, seed)
            if (e) { program = candidate; errors = e; changed = true }
        }
        // simplify fields
        for (const step of program.steps) for (const field of ["release", "turns"]) if (step[field]) {
            const old = step[field]; step[field] = 0
            if (!(await fails(program, ds, seed))) step[field] = old
        }
    }
    console.log(JSON.stringify(program, replacer, 1))
    console.log(errors.join(" | "))
    process.exit(0)
}

// --- main ---
const count = Number(process.env.PROGRAMS ?? 200)
const start = Number(process.env.START ?? 0)
const deliveries = (process.env.DELIVERIES ?? "ready,sync,native,ordered").split(",")
const verify = process.env.VERIFY === "1"
let failures = 0
for (let index = start; index < start + count; index++) {
    const seed = (0x1234567 + Math.imul(index, 0x9e3779b9)) >>> 0
    const program = generate(createRandom(seed))
    let reference
    for (const delivery of deliveries) {
        let outcome
        try {
            outcome = await runProgram(program, delivery, seed, verify)
        } catch (error) {
            outcome = { errors: [`threw: ${error?.stack ?? error}`], log: [] }
        }
        if (!outcome.errors.length && outcome.kinds) {
            if (!reference) reference = { delivery, kinds: outcome.kinds }
            else for (let i = 0; i < Math.max(reference.kinds.length, outcome.kinds.length); i++)
                if (reference.kinds[i] !== outcome.kinds[i]) {
                    outcome.errors.push(`kind differs: ${reference.delivery} ${reference.kinds[i]} vs ${delivery} ${outcome.kinds[i]}`)
                    break
                }
        }
        if (outcome.errors.length) {
            failures++
            console.log(`FAIL program ${index} delivery=${delivery}`)
            for (const error of outcome.errors.slice(0, 8)) console.log("   ", error)
            if (process.env.SHOW) console.log(JSON.stringify(program, (k, v) => typeof v === "number" && !Number.isFinite(v) ? String(v) : v))
            break
        }
    }
    if (failures >= Number(process.env.MAXFAIL ?? 5)) break
}
console.log(`done: failures=${failures}`, JSON.stringify(globalThis.__stats))
