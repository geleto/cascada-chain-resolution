import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { TREE_NODE } from "../../src/external-mutation-tree.js"
import { createRandom, randomInteger } from "../native-equivalence-support.js"
import { OrderedThenable } from "../ordered-thenable.js"
import { verifyRefCounts } from "../verify-refcounts.js"
import { ExternalErrorOracle } from "../external-error-oracle.js"

// Seeded programs over registered external resources beside managed data. Context A holds
// `api` with registered child scopes `db` and `config`. A program may add an independent
// context B with its own resources, a competing context that registers A's `db` or `api`
// again, an unselected alias of `db` in A's root, and an unregistered observation-only
// identity `ext`. Commands call native methods, read and write native accessor properties,
// fail and poison scopes, pass rejected arguments, select registered scopes through dynamic
// keys, repair, query Errors, and run inside mutable, read-only, nested, and mixed entries.
//
// The sequential model applies each command at issuance and an entry's contained commands at
// the entry's position. Every native call logs its model sequence number: calls on
// overlapping scopes of one context where at least one mutates must run in that order, and
// exactly the model's unblocked calls must run. Results compare values and exact Error
// identities and attribution, and every entry callback must run once. At quiescence no
// reservation remains and poison summaries match. Compare observed, verified-without-extra-
// reads, and uninstrumented runs; reads inside entries remain part of the scenario.

const CHILDREN = ["db", "config"]
const BINDING = 0 // Model id of the competing registration's permanent binding Error.

function createHost(log, context, errors) {
    const scope = name => context === "A" ? name : `${context}:${name}`
    const child = name => r.externalState({
        items: [],
        stored: 0,
        add(value, seq) { log.push({ seq, scope: scope(name), op: "add", mutation: true }); this.items.push(value) },
        fail(seq) { log.push({ seq, scope: scope(name), op: "fail", mutation: true }); throw errors.failure(seq, `${name} failed`) },
        read(seq) { log.push({ seq, scope: scope(name), op: "read", mutation: false }); return this.items.join(",") },
        get value() { return this.stored },
        set value(record) {
            log.push({ seq: record.seq, scope: scope(name), op: "set", mutation: true })
            if (record.v === 13) throw errors.failure(record.seq, `${name} setter refused`)
            this.stored = record.v
        },
    })
    const db = child("db"), config = child("config")
    // A parent method may change descendant state while preserving registered identities.
    const api = r.externalState({
        db,
        config,
        reset(seq) { log.push({ seq, scope: scope("api"), op: "reset", mutation: true }); db.items.length = 0; config.items.length = 0 },
        fail(seq) { log.push({ seq, scope: scope("api"), op: "fail", mutation: true }); throw errors.failure(seq, "api failed") },
        snapshot(seq) { log.push({ seq, scope: scope("api"), op: "snapshot", mutation: false }); return `${db.items.join(",")}|${config.items.join(",")}` },
    })
    return { api, db, config }
}

function contextState(competing) {
    return {
        items: { db: [], config: [] },
        stored: { db: 0, config: 0 },
        own: { api: null, db: null, config: null },
        conflict: { api: competing === "api" ? BINDING : null, db: competing === "db" ? BINDING : null, config: null },
        root: null, // Poison of the context's root placement.
        data: {},
    }
}

// Sequential model. Results are "u", "v:<value>", "null", "E:<poison ids>" for exact known
// Errors, or "L:<kind>" for a new local Error; a list accepts any of its results. A command
// that creates poison records the Error kind it must create.
class Model {
    constructor(variant) {
        this.contexts = { A: contextState(variant.competing), B: contextState(false) }
        this.alias = null // Poison of A's alias placement.
        this.ext = null // Poison of A's placement holding the observation-only identity.
        this.seq = 0
        this.effects = []
    }

    errors(ids) {
        return ids.length ? `E:${[...new Set(ids)].sort((a, b) => a - b).join(",")}` : "null"
    }

    // A scope's own binding conflict comes first, then a strict ancestor's binding conflict or
    // own poison; whole-parent work consumes the subtree union. Root placement poison blocks
    // everything below it.
    blockers(state, scope) {
        if (state.root !== null) return [state.root]
        if (state.conflict[scope] !== null) return [state.conflict[scope]]
        if (scope === "api") return this.subtree(state)
        const ancestor = state.conflict.api ?? state.own.api
        if (ancestor !== null) return [ancestor]
        return state.own[scope] !== null ? [state.own[scope]] : []
    }

    subtree(state) {
        return ["api", ...CHILDREN].flatMap(name => [state.conflict[name], state.own[name]]).filter(id => id !== null)
    }

    poison(command, state, scope, kind) {
        state.own[scope] = command.seq
        command.creates = kind
    }

    effect(command, scope, op) {
        this.effects.push({ seq: command.seq, scope: command.context === "A" ? scope : `${command.context}:${scope}`, op })
    }

    apply(command) {
        command.seq = ++this.seq
        const { kind, scope, seq } = command
        const state = this.contexts[command.context]
        if (kind === "entry") {
            // Poison never suppresses the callback; contained access meets the blockers instead.
            command.expected = command.contained.map(contained => this.apply(Object.assign(contained, { context: command.context })))
            return "u"
        }
        if (kind === "managed-set") {
            // An assignment returns at issuance and may report a blocker only when ready.
            if (state.root !== null) return [this.errors([state.root]), "u"]
            state.data[command.key] = command.value
            return "u"
        }
        if (kind === "managed-get") {
            if (state.root !== null) return this.errors([state.root])
            return command.key in state.data ? `v:${state.data[command.key]}` : "u"
        }
        if (kind === "repair") {
            // Root repair restores the root placement and clears covered external poison; it
            // leaves other managed placements and binding conflicts unchanged.
            if (scope === "root") {
                state.root = null
                for (const name of ["api", ...CHILDREN]) state.own[name] = null
                return "u"
            }
            if (state.root !== null) return this.errors([state.root])
            const blocker = state.conflict[scope] ?? (scope === "api" ? null : state.conflict.api ?? state.own.api)
            if (blocker !== null) return this.errors([blocker])
            for (const name of scope === "api" ? ["api", ...CHILDREN] : [scope]) state.own[name] = null
            return "u"
        }
        if (kind === "errors") {
            if (scope !== "root") return this.errors(this.blockers(state, scope))
            if (state.root !== null) return this.errors([state.root])
            const managed = command.context === "A" ? [this.alias, this.ext].filter(id => id !== null) : []
            return this.errors([...this.subtree(state), ...managed])
        }
        if (kind.startsWith("alias-")) return this.applyAlias(command, state)
        if (kind.startsWith("ext-")) return this.applyExternalOnly(command, state)
        if (kind === "competing-call") return this.errors([BINDING])
        if (kind === "dynamic-peek") {
            if (command.dynamicFrom === 2) return this.applyCall({ ...command, kind: "peek" }, state)
            if (state.root !== null) return this.errors([state.root])
            // The read reaches only its static prefix before the forbidden key: `api` when the
            // key follows it, nothing registered when the key selects `api` itself. An Error on
            // that prefix comes first; the dynamically selected child is never reached.
            const prefix = command.dynamicFrom === 1 ? state.conflict.api ?? state.own.api : null
            if (prefix === null) return "L:ExternalLocationConflict"
            command.prefixPoisoned = true
            return this.errors([prefix])
        }
        if (kind === "dynamic-mutate") {
            // An invalid dynamic selection fails its mutation at the static prefix: the root
            // placement, or the registered `api` scope with its subtree blockers.
            if (command.dynamicFrom === 0) {
                if (state.root !== null) return this.errors([state.root])
                state.root = seq
                command.creates = "ExternalLocationConflict"
                return this.errors([seq])
            }
            const blockers = this.blockers(state, "api")
            if (blockers.length) return this.errors(blockers)
            this.poison(command, state, "api", "ExternalLocationConflict")
            return this.errors([seq])
        }
        if (kind === "set-value") return this.applyWrite(command, state)
        return this.applyCall(command, state)
    }

    // A write returns at issuance: it reports its blocker or failure only when ready.
    applyWrite(command, state) {
        const { scope, seq } = command
        if (command.dynamicFrom === 1) {
            const blockers = this.blockers(state, "api")
            if (blockers.length) return [this.errors(blockers), "u"]
            this.poison(command, state, "api", "ExternalLocationConflict")
            return [this.errors([seq]), "u"]
        }
        const selected = command.widened ? "api" : scope
        const blockers = this.blockers(state, selected)
        if (blockers.length) return [this.errors(blockers), "u"]
        if (command.rhs === "rejected") {
            this.poison(command, state, selected, "OperationInputFailed")
            return [this.errors([seq]), "u"]
        }
        this.effect(command, scope, "set")
        if (command.value !== 13) {
            state.stored[scope] = command.value
            return "u"
        }
        this.poison(command, state, selected, "ExternalPropertyWriteFailed")
        return [this.errors([seq]), "u"]
    }

    applyCall(command, state) {
        const { kind, scope, seq } = command
        const blockers = this.blockers(state, scope)
        if (blockers.length) return this.errors(blockers)
        if (kind === "peek") return `v:${state.items[scope].length}`
        if (kind === "get-value") return `v:${state.stored[scope]}`
        const { method } = command
        if (command.rejected) {
            // A rejected observation argument affects only its result.
            if (method === "read" || method === "snapshot") return "L:OperationInputFailed"
            this.poison(command, state, scope, "OperationInputFailed")
            return this.errors([seq])
        }
        this.effect(command, scope, method)
        if (method === "add") { state.items[scope].push(command.value); return "u" }
        if (method === "reset") { state.items.db.length = 0; state.items.config.length = 0; return "u" }
        if (method === "fail") { this.poison(command, state, scope, "InvocationFailed"); return this.errors([seq]) }
        if (method === "read") return `v:${state.items[scope].join(",")}`
        return `v:${state.items.db.join(",")}|${state.items.config.join(",")}` // snapshot
    }

    // A read through an unselected alias reaches the registered identity itself and fails
    // locally, reporting the identity's permanent binding Error when competing registrations
    // invalidated it: an existing Error comes before a new one. A mutation fails earlier, when
    // it selects the managed alias placement as the scope of a native effect, and poisons that
    // placement, which then blocks every alias access.
    applyAlias(command, state) {
        const { kind, seq } = command
        const result = id => kind === "alias-assign" ? [this.errors([id]), "u"] : this.errors([id])
        if (state.root !== null) return result(state.root)
        if (kind === "alias-repair") { this.alias = null; return "u" }
        if (this.alias !== null) return result(this.alias)
        if (kind === "alias-peek" || kind === "alias-call") {
            return state.conflict.db === null ? "L:ExternalLocationConflict" : this.errors([state.conflict.db])
        }
        this.alias = seq
        command.creates = "ExternalLocationConflict"
        return result(seq)
    }

    // An unregistered external identity supports observation only. A mutation attempt
    // poisons the managed placement holding it.
    applyExternalOnly(command, state) {
        const { kind, seq } = command
        if (state.root !== null) return this.errors([state.root])
        if (kind === "ext-repair") { this.ext = null; return "u" }
        if (this.ext !== null) return this.errors([this.ext])
        if (kind === "ext-peek") return "v:2"
        if (kind === "ext-call") {
            this.effects.push({ seq, scope: "ext", op: "read" })
            return "v:1,2"
        }
        this.ext = seq
        command.creates = "ExternalLocationConflict"
        return this.errors([seq])
    }
}

const OBSERVATIONS = new Set(["peek", "get-value", "errors", "managed-get", "dynamic-peek", "alias-peek", "alias-call", "ext-call", "ext-peek"])
const isObservation = command => OBSERVATIONS.has(command.kind) ||
    command.kind === "call" && (command.method === "read" || command.method === "snapshot")

// Program-level commands that address fixed absolute paths, so they run outside entries.
function generateSpecial(random, variant) {
    const pick = list => list[randomInteger(random, list.length)]
    const families = [["dynamic-peek", "dynamic-mutate", "dynamic-set", "repair-root", "errors-root"]]
    if (variant.alias) families.push(["alias-peek", "alias-call", "alias-mutate", "alias-assign", "alias-repair"])
    if (variant.observationOnly) families.push(["ext-call", "ext-peek", "ext-mutate", "ext-repair"])
    if (variant.competing) families.push(["competing-call"])
    const kind = pick(pick(families))
    const scope = pick(CHILDREN), value = randomInteger(random, 50)
    if (kind === "repair-root") return { kind: "repair", scope: "root" }
    if (kind === "errors-root") return { kind: "errors", scope: "root" }
    if (kind === "dynamic-peek") return { kind, scope, dynamicFrom: randomInteger(random, 3) }
    if (kind === "dynamic-mutate") return { kind, scope, value, dynamicFrom: random() < 0.3 ? 0 : 1 }
    if (kind === "dynamic-set") {
        // A dynamic native suffix is ordinary; a dynamic registered selection is a conflict.
        const dynamicFrom = random() < 0.5 ? 1 : 2
        return { kind: "set-value", scope, dynamicFrom, widened: false, value: dynamicFrom === 2 && random() < 0.2 ? 13 : value,
            rhs: dynamicFrom === 2 ? pick(["ready", "pending", "rejected"]) : "ready" }
    }
    return { kind, value }
}

function generateCommand(random, scopes, { readonly = false, managed = false, nested = false, top = false, variant = {} } = {}) {
    const pick = list => list[randomInteger(random, list.length)]
    const scope = pick(scopes)
    const child = scope === "api" ? pick(CHILDREN) : scope
    const roll = randomInteger(random, 20)
    if (managed && roll < 3) return { kind: pick(["managed-set", "managed-set", "managed-get"]), key: pick(["k", "m"]), value: randomInteger(random, 50) }
    if (top && roll >= 16) return generateSpecial(random, variant)
    if (roll < 5 || readonly && roll < 12) {
        if (random() < 0.3) return { kind: pick(["peek", "get-value"]), scope: child }
        return { kind: "call", scope, method: scope === "api" ? "snapshot" : "read", rejected: random() < 0.15 }
    }
    if (roll < 7) return { kind: "errors", scope }
    if (readonly) return { kind: "call", scope, method: scope === "api" ? "snapshot" : "read" }
    if (roll < 9) return { kind: "repair", scope }
    if (nested && roll < 10) {
        const target = pick(CHILDREN)
        return { kind: "entry", scope: target, mutable: true, delayed: random() < 0.5, contained: [generateCommand(random, [target])] }
    }
    if (roll < 13) {
        // Widening the scope to `api` needs `api` on the path, so only top-level writes widen.
        return { kind: "set-value", scope: child, value: random() < 0.15 ? 13 : randomInteger(random, 50),
            rhs: pick(["ready", "ready", "pending", "rejected"]), widened: top && random() < 0.3 }
    }
    const method = pick(scope === "api" ? ["reset", "reset", "fail"] : ["add", "add", "add", "fail"])
    return { kind: "call", scope, method, value: randomInteger(random, 50), pending: method === "add" && random() < 0.4,
        rejected: method === "add" && random() < 0.15 }
}

function generate(random) {
    const pick = list => list[randomInteger(random, list.length)]
    // A competing context registers A's `db`, or its boundary identity `api`, again.
    const variant = { alias: random() < 0.35, observationOnly: random() < 0.35, second: random() < 0.35,
        competing: random() < 0.25 && pick(["db", "db", "api"]) }
    const steps = []
    for (let index = 0; index < 14; index++) {
        // Context B has no alias, observation-only identity, or competing registration.
        const context = variant.second && random() < 0.35 ? "B" : "A"
        const options = { variant: context === "A" ? variant : {} }
        if (random() < 0.06) {
            // A dynamic read right after its static prefix fails, possibly while that failure
            // still waits behind an entry: the read must report the prefix Error at its turn.
            const hold = { kind: "entry", scope: "api", mutable: true, delayed: random() < 0.5, contained: [] }
            const failure = { kind: "call", scope: "api", method: "fail", value: 0, pending: false, rejected: false }
            const read = { kind: "dynamic-peek", scope: pick(CHILDREN), dynamicFrom: 1, afterPendingFailure: hold.delayed }
            for (const step of [hold, failure]) Object.assign(step, { context, release: false, turns: 0, macrotask: false })
            Object.assign(read, { context, release: random() < 0.5, turns: randomInteger(random, 4), macrotask: random() < 0.25 })
            steps.push(hold, failure, read)
            continue
        }
        let step
        if (randomInteger(random, 10) < 6) step = generateCommand(random, ["api", "db", "config"], { ...options, managed: true, top: true })
        else {
            const scope = pick(["api", "db", "config", "root"])
            const mutable = scope === "root" || random() < 0.7
            const scopes = scope === "root" || scope === "api" ? ["api", "db", "config"] : [scope]
            const contained = Array.from({ length: 1 + randomInteger(random, 2) }, () =>
                generateCommand(random, scopes, { readonly: !mutable, managed: scope === "root", nested: scope === "api" && mutable }))
            step = { kind: "entry", scope, mutable, delayed: random() < 0.5, contained }
        }
        Object.assign(step, { context, release: random() < 0.5, turns: randomInteger(random, 4), macrotask: random() < 0.25 })
        steps.push(step)
    }
    return { variant, delivery: pick(["native", "ordered"]), steps }
}

async function outcome(value) {
    let settled
    Promise.resolve(value).then(result => { settled = { result } }, error => { settled = { error } })
    for (let turn = 0; turn < 40 && !settled; turn++) await new Promise(setImmediate)
    return settled ?? { blocked: true }
}

function coverageKey(step) {
    if (step.kind === "entry") return `entry:${step.scope}:${step.mutable ? "mutable" : "readonly"}:${step.delayed ? "delayed" : "ready"}`
    if (step.kind === "call") return `call:${step.scope}:${step.method}${step.pending ? ":pending" : ""}${step.rejected ? ":rejected" : ""}`
    if (step.kind === "set-value") {
        const route = step.dynamicFrom === 1 ? "dynamic-prefix" : step.dynamicFrom === 2 ? "dynamic-suffix" : step.widened ? "widened" : "direct"
        return `set-value:${route}:${step.rhs}${step.value === 13 ? ":throws" : ""}`
    }
    if (step.kind.startsWith("dynamic-")) return `${step.kind}:${step.dynamicFrom}`
    return step.scope ? `${step.kind}:${step.scope}` : step.key ? `${step.kind}:data` : step.kind
}

async function runProgram({ variant, delivery, steps }, seed, mode, coverage) {
    const observed = mode === "observed", instrumented = mode !== "bare"
    coverage.add(`harness:${mode}`)
    const random = createRandom(seed ^ 0x165667b1)
    const log = []
    const ctx = { execution: new r.Execution(), errorContext: {} }
    const errorOracle = new ExternalErrorOracle()
    const tree = { api: { db: {}, config: {} } }
    const hosts = { A: createHost(log, "A", errorOracle) }
    const rootA = { api: hosts.A.api, data: {} }
    if (variant.alias) rootA.alias = hosts.A.db
    if (variant.observationOnly) {
        rootA.ext = r.externalState({
            items: [1, 2],
            read(seq) { log.push({ seq, scope: "ext", op: "read", mutation: false }); return this.items.join(",") },
            add(value, seq) { log.push({ seq, scope: "ext", op: "add", mutation: true }); this.items.push(value) },
        })
    }
    const chains = { A: new r.ContextChain(rootA, ctx, tree) }
    if (variant.second) {
        hosts.B = createHost(log, "B", errorOracle)
        chains.B = new r.ContextChain({ api: hosts.B.api, data: {} }, ctx, tree)
    }
    let competing
    if (variant.competing) {
        const bindingContext = errorOracle.context(ctx.execution, { seq: BINDING, creates: "ExternalLocationConflict" })
        competing = new r.ContextChain({ other: hosts.A[variant.competing] }, bindingContext, { other: {} })
    }
    if (instrumented) for (const chain of Object.values(chains)) r.hasError(chain, [], ctx)
    const model = new Model(variant)
    const holds = [], checks = []
    const hold = () => {
        const held = Promise.withResolvers()
        holds.push(() => held.resolve())
        return held.promise
    }
    const input = (value, rejection) => {
        if (delivery === "native") {
            const held = Promise.withResolvers()
            held.promise.catch(() => {})
            holds.push(() => rejection ? held.reject(rejection) : held.resolve(value))
            return held.promise
        }
        const source = new OrderedThenable()
        holds.push(() => rejection ? source.reject(rejection) : source.resolve(value))
        return source
    }
    const keep = (value, command, want) => {
        if (value instanceof Promise) value.catch(() => {})
        checks.push({ got: value, command, want })
    }
    const issue = (command, owner, base, want) => {
        const operationContext = errorOracle.context(ctx.execution, command)
        const relative = path => path.slice(base.length)
        const registered = name => relative(name === "api" ? ["api"] : ["api", name])
        const { kind, seq } = command
        let result
        if (kind === "call") {
            const path = registered(command.scope)
            if (command.method === "read" || command.method === "snapshot") {
                const args = command.rejected ? [seq, input(undefined, errorOracle.failure(seq, "observation argument rejected"))] : [seq]
                result = r.run(owner, path, command.method, args, operationContext, {})
            } else {
                const value = command.rejected ? input(undefined, errorOracle.failure(seq, "argument rejected"))
                    : command.pending ? input(command.value) : command.value
                const args = command.method === "add" ? [value, seq] : [seq]
                result = r.run(owner, path, command.method, args, operationContext, { mutationScopeDepth: path.length })
            }
        } else if (kind === "peek") result = r.lookupPath(owner, [...registered(command.scope), "items", "length"], operationContext)
        else if (kind === "get-value") result = r.lookupPath(owner, [...registered(command.scope), "value"], operationContext)
        else if (kind === "set-value") {
            const record = { v: command.value, seq }
            const value = command.rhs === "pending" ? input(record)
                : command.rhs === "rejected" ? input(undefined, errorOracle.failure(seq, "value rejected")) : record
            const path = [...registered(command.scope), "value"]
            const depth = command.widened ? path.length - 2 : path.length - 1
            result = r.assignPath(owner, path, value, operationContext, depth, command.dynamicFrom ?? path.length)
        } else if (kind === "repair") result = r.repairPath(owner, command.scope === "root" ? [] : registered(command.scope), operationContext)
        else if (kind === "errors") result = r.getErrors(owner, command.scope === "root" ? [] : registered(command.scope), operationContext)
        else if (kind === "managed-set") result = r.assignPath(owner, relative(["data", command.key]), command.value, operationContext)
        else if (kind === "managed-get") result = r.lookupPath(owner, relative(["data", command.key]), operationContext)
        else if (kind === "dynamic-peek") result = r.lookupPath(owner, ["api", command.scope, "items", "length"], operationContext, command.dynamicFrom)
        else if (kind === "dynamic-mutate") {
            result = r.run(owner, ["api", command.scope], "add", [command.value, seq], operationContext,
                { mutationScopeDepth: 2, firstDynamicSegment: command.dynamicFrom })
        } else if (kind === "alias-peek") result = r.lookupPath(owner, ["alias", "items", "length"], operationContext)
        else if (kind === "alias-call") result = r.run(owner, ["alias"], "read", [seq], operationContext, {})
        else if (kind === "alias-mutate") result = r.run(owner, ["alias"], "add", [command.value, seq], operationContext, { mutationScopeDepth: 1 })
        else if (kind === "alias-assign") result = r.assignPath(owner, ["alias", "value"], { v: command.value, seq }, operationContext)
        else if (kind === "alias-repair") result = r.repairPath(owner, ["alias"], operationContext)
        else if (kind === "ext-call") result = r.run(owner, ["ext"], "read", [seq], operationContext, {})
        else if (kind === "ext-peek") result = r.lookupPath(owner, ["ext", "items", "length"], operationContext)
        else if (kind === "ext-mutate") result = r.run(owner, ["ext"], "add", [command.value, seq], operationContext, { mutationScopeDepth: 1 })
        else if (kind === "ext-repair") result = r.repairPath(owner, ["ext"], operationContext)
        else if (kind === "competing-call") {
            const args = variant.competing === "db" ? ["add", [command.value, seq]] : ["reset", [seq]]
            result = r.run(competing, ["other"], ...args, operationContext, { mutationScopeDepth: 1 })
        } else {
            const absolute = command.scope === "root" ? [] : command.scope === "api" ? ["api"] : ["api", command.scope]
            const body = inner => command.contained.forEach((contained, index) => issue(contained, inner, absolute, command.expected[index]))
            result = r.enter(owner, relative(absolute), operationContext, command.mutable, command.delayed ? inner => hold().then(() => body(inner)) : body)
        }
        keep(result, command, want)
    }
    const roots = () => [...Object.values(chains), competing].filter(Boolean).map(chain => chain._state)
    const verify = () => { if (instrumented) verifyRefCounts(ctx, ...roots()) }
    let phase = "before-release"
    for (const step of steps) {
        if (!observed && isObservation(step)) continue
        const rootPoisoned = model.contexts[step.context].root !== null
        const want = model.apply(step)
        coverage.add(coverageKey(step))
        coverage.add(`context:${step.context}`)
        for (const contained of step.contained ?? []) coverage.add(`contained:${contained.kind}${contained.kind === "call" ? `:${contained.method}` : ""}`)
        if ((Array.isArray(want) ? want[0] : want).startsWith("E:")) coverage.add(`blocked-or-failed:${step.kind}`)
        if (rootPoisoned) coverage.add(`under-root-poison:${step.kind}`)
        if (step.prefixPoisoned) coverage.add(`dynamic-peek:1:prefix-poisoned${step.afterPendingFailure === undefined ? ""
            : step.afterPendingFailure ? ":after-pending-failure" : ":after-ready-failure"}`)
        coverage.add(`phase:${phase}`)
        issue(step, chains[step.context], [], want)
        verify()
        if (step.release && holds.length) {
            holds.splice(randomInteger(random, holds.length), 1)[0]()
            if (phase === "before-release") phase = "after-release"
        }
        for (let turn = 0; turn < step.turns; turn++) {
            await Promise.resolve()
            verify()
        }
        if (step.macrotask) {
            await new Promise(setImmediate)
            verify()
        }
    }
    for (const [name, enabled] of Object.entries(variant)) if (enabled) coverage.add(`variant:${name}${enabled === true ? "" : `:${enabled}`}`)
    coverage.add(`delivery:${delivery}`)
    do {
        while (holds.length) {
            holds.splice(randomInteger(random, holds.length), 1)[0]()
            for (let turn = 0; turn < 3; turn++) {
                await Promise.resolve()
                verify()
            }
            await new Promise(setImmediate)
            verify()
        }
        for (let turn = 0; turn < 3; turn++) {
            await new Promise(setImmediate)
            verify()
        }
    } while (holds.length)

    const errors = []
    const describe = async (value, command) => {
        const { result, error, blocked } = await outcome(value)
        if (blocked) return "BLOCKED"
        if (error) return `REJECTED:${error.message}`
        if (result === undefined) return "u"
        if (result === null) return "null"
        if (!Error.isError(result)) return `v:${result}`
        if (!Array.isArray(result.errors)) return errorOracle.identify(result, command)
        const labels = result.errors.map(error => errorOracle.identify(error, command))
        assert(labels.every(label => label.startsWith("E:")), "A collection contains an unexpected local Error")
        return `E:${labels.map(label => Number(label.slice(2))).sort((a, b) => a - b).join(",")}`
    }
    for (const { got, command, want } of checks) {
        const wants = Array.isArray(want) ? want : [want]
        const actual = await describe(got, command)
        if (!wants.includes(actual)) {
            errors.push(`${command.context} ${coverageKey(command)} #${command.seq}: got ${actual} want ${wants.join(" or ")}`)
        }
    }
    // Every applied command was issued exactly once, so every entry callback ran once, even when
    // poison or a binding conflict blocks everything inside it.
    const issued = checks.map(check => check.command.seq)
    if (issued.length !== model.seq || new Set(issued).size !== model.seq) {
        const missing = Array.from({ length: model.seq }, (_, index) => index + 1).filter(seq => !issued.includes(seq))
        errors.push(`issued ${issued.length} commands, want ${model.seq}; never issued: [${missing}]`)
    }
    // Overlapping calls of one context with at least one mutation run in sequence order.
    const split = scope => scope.includes(":") ? scope.split(":") : ["A", scope]
    const overlaps = (a, b) => {
        const [contextA, scopeA] = split(a), [contextB, scopeB] = split(b)
        return a !== "ext" && b !== "ext" && contextA === contextB && (scopeA === scopeB || scopeA === "api" || scopeB === "api")
    }
    for (let later = 0; later < log.length; later++) for (let earlier = 0; earlier < later; earlier++) {
        const a = log[earlier], b = log[later]
        if ((a.mutation || b.mutation) && overlaps(a.scope, b.scope) && a.seq > b.seq)
            errors.push(`order: ${a.scope}.${a.op} #${a.seq} ran before ${b.scope}.${b.op} #${b.seq}`)
    }
    const ran = log.map(event => `${event.seq}:${event.scope}:${event.op}`).sort().join(" ")
    const expected = model.effects.map(event => `${event.seq}:${event.scope}:${event.op}`).sort().join(" ")
    if (ran !== expected) errors.push(`calls: ran [${ran}] want [${expected}]`)
    for (const [context, host] of Object.entries(hosts)) {
        const state = model.contexts[context]
        for (const name of CHILDREN) {
            if (host[name].items.join(",") !== state.items[name].join(",")) errors.push(`${context} ${name} items ${host[name].items} want ${state.items[name]}`)
            if (host[name].stored !== state.stored[name]) errors.push(`${context} ${name} value ${host[name].stored} want ${state.stored[name]}`)
        }
        const data = await outcome(r.export(chains[context], ["data"], ctx))
        const gotData = Error.isError(data.result) ? errorOracle.identify(data.result) : JSON.stringify(data.result)
        const wantData = state.root !== null ? `E:${state.root}` : JSON.stringify(state.data)
        if (gotData !== wantData) errors.push(`${context} data ${gotData} want ${wantData}`)
        // At quiescence own poison and summaries match the model.
        const treeRoot = chains[context]._externalMutationTree
        const nodes = { api: treeRoot.api, db: treeRoot.api.db, config: treeRoot.api.config }
        for (const name of ["api", ...CHILDREN]) {
            const own = nodes[name][TREE_NODE].ownPoison
            const actual = own ? errorOracle.identify(own) : null
            if (actual !== (state.own[name] === null ? null : `E:${state.own[name]}`)) errors.push(`${context} ${name} own poison ${actual} want ${state.own[name]}`)
        }
        const poisoned = name => state.own[name] !== null || state.conflict[name] !== null
        const summaries = (treeRoot[TREE_NODE].poisonedChildren?.has(nodes.api) ?? false) === (poisoned("api") || CHILDREN.some(poisoned)) &&
            CHILDREN.every(name => (nodes.api[TREE_NODE].poisonedChildren?.has(nodes[name]) ?? false) === poisoned(name))
        if (!summaries) errors.push(`${context}: poison summaries disagree with own poison`)
    }
    // At quiescence no reservation remains in any tree.
    const treeNodes = node => [node, ...Object.values(node).filter(child => child?.[TREE_NODE]).flatMap(treeNodes)]
    for (const chain of [...Object.values(chains), competing].filter(Boolean)) {
        for (const node of treeNodes(chain._externalMutationTree)) {
            const frontier = node[TREE_NODE].frontier
            if (frontier && Object.values(frontier).some(set => set.size)) errors.push("a reservation remains at quiescence")
        }
    }
    verify()
    assert.equal(ctx.execution.fatalError, null)
    // Sequence numbers differ between the paired runs, so compare only which scopes are poisoned.
    const final = Object.entries(hosts).map(([context, host]) => {
        const state = model.contexts[context]
        const poisoned = Object.keys(state.own).filter(name => state.own[name] !== null).join(",")
        return `${context}:${host.db.items}|${host.config.items}|${host.db.stored}|${host.config.stored}|${poisoned}|${state.root !== null}|${JSON.stringify(state.data)}`
    }).join(" ") + ` alias=${model.alias !== null} ext=${model.ext !== null}`
    return { errors, final }
}

const programs = Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 16) * 6
const start = Number(process.env.CASCADA_SEQUENCE_START ?? 0)
const coverage = new Set()
let runs = 0
for (let index = start; index < programs; index++) {
    const seed = (0x3c6ef372 + Math.imul(index, 0x9e3779b9)) >>> 0
    const program = generate(createRandom(seed))
    const finals = []
    for (const mode of ["observed", "verified", "bare"]) {
        let result
        try {
            result = await runProgram(structuredClone(program), seed, mode, coverage)
        } catch (error) {
            result = { errors: [`threw ${error?.stack ?? error}`] }
        }
        runs++
        if (result.errors.length) {
            throw new Error(`program ${index} (seed ${seed}, harness=${mode}) failed:\n  ${result.errors.join("\n  ")}\n` +
                `program: ${JSON.stringify(program)}`)
        }
        finals.push(result.final)
    }
    if (new Set(finals).size !== 1) throw new Error(`program ${index} (seed ${seed}): harness modes disagree: ${JSON.stringify(finals)}`)
}
console.log(JSON.stringify({ programs: programs - start, runs, coverage: [...coverage].sort() }))
