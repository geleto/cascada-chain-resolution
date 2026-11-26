import assert from "node:assert/strict"
import * as r from "../src/index.js"
import { ready } from "./ordered-thenable.js"

const mutation = { mutationScopeDepth: 0 }
const modes = Object.values(r.CHAIN_MODE)

describe("generated Array failure histories", () => {
    for (const mode of modes) it(`publishes and repairs structural controls against a slot model in mode ${mode}`, async () => {
        for (const delivery of ["ready", "sync", "control first", "payload first"])
        for (const operation of ["insert", "delete count", "fill", "copyWithin"]) {
            const ctx = { execution: new r.Execution(), errorContext: operation }
            const failure = r.validationError("control", ctx, r.ERROR_KIND.OperationInputFailed)
            const a = Promise.withResolvers(), b = Promise.withResolvers()
            const input = (v, d) => delivery === "ready" ? v : delivery === "sync" ? ready(v) : d.promise
            const bad = input(failure, a), replacement = input("X", b)
            const chain = new r.Chain(["A", "B"], ctx, mode), before = r.capturePath(chain, [], ctx)
            const method = operation === "insert" || operation === "delete count" ? "splice" : operation
            const args = operation === "insert" ? [bad, 0, replacement] : operation === "delete count" ? [1, bad, replacement] :
                operation === "fill" ? [replacement, 1, bad] : [1, 0, bad]
            const direct = r.run(chain, [], method, args, ctx, mutation)
            const captured = r.capturePath(chain, [], ctx, modes[(modes.indexOf(mode) + 1) % modes.length])
            const root = r.isPoisoned(captured, [], ctx), deep = r.hasError(captured, [], ctx)
            const values = [0, 1, 2].map(i => r.lookupPath(captured, [i], ctx))
            r.repairPath(chain, [], ctx)
            for (let i = 0; i < 3; i++) r.repairPath(chain, [i], ctx)
            if (delivery === "payload first") { b.resolve("X"); a.resolve(failure) }
            else if (delivery === "control first") { a.reject(failure); b.resolve("X") }

            const complete = mode === r.CHAIN_MODE.Complete, ordered = mode === r.CHAIN_MODE.Sequential
            const inserted = ["A", "B", "X"]
            const stream = operation === "insert" ? inserted : operation === "delete count" ? ["A", "X", failure] : ["A", failure]
            const visible = complete ? [failure, failure, failure] : ordered && operation === "insert" ? inserted.map(() => failure) : stream
            assert.equal(await direct, failure)
            assert.equal(await root, complete)
            assert.equal(await deep, complete || ordered || operation !== "insert")
            assert.deepEqual(await Promise.all(values), Array.from({ length: 3 }, (_, i) => visible[i]))
            const repaired = complete ? ["A", "B"] : stream
            assert.equal(await r.lookupPath(chain, ["length"], ctx), repaired.length)
            for (const [i, slot] of repaired.entries()) assert.equal(await r.lookupPath(chain, [i], ctx), slot)
            assert.deepEqual(await r.export(before, [], ctx), ["A", "B"])
        }
    })

    for (const mode of modes) it(`orders nested append, missing output and explicit repair in mode ${mode}`, async () => {
        for (const earlier of ["empty", "push", "missing"]) for (const closeFirst of [false, true]) {
            const ctx = { execution: new r.Execution(), errorContext: earlier }
            const missing = r.validationError("missing", ctx, r.ERROR_KIND.OperationInputFailed)
            const guard = r.validationError("guard", ctx, r.ERROR_KIND.OperationInputFailed)
            const chain = new r.Chain([], ctx, mode), hold = Promise.withResolvers()
            const blocked = mode === r.CHAIN_MODE.Complete && earlier === "missing"
            const access = { mayPoisonScope: blocked, maximumCount: 1 }
            let inside
            const entry = r.enter(chain, [], ctx, access, outer =>
                r.enter(outer, [], ctx, access, inner => { inside = inner; return hold.promise }))
            function close() {
                if (earlier === "missing") r.appendMissingOutput(inside, missing, ctx)
                if (earlier === "push") r.run(inside, [], "push", ["A"], ctx, mutation)
                hold.resolve()
            }
            if (closeFirst) { close(); await entry }
            const length = r.run(chain, [], "push", ["B"], ctx, mutation)
            const before = r.capturePath(chain, [], ctx)
            r.repairPath(chain, [], ctx)
            r.poisonPath(chain, [], guard, ctx)
            const guarded = r.lookupPath(chain, [], ctx)
            r.repairPath(chain, [], ctx)
            if (!closeFirst) { close(); await entry }
            const slots = blocked ? [] : earlier === "empty" ? ["B"] : [earlier === "missing" ? missing : "A", "B"]
            assert.equal(await length, blocked ? missing : slots.length)
            assert.equal(await guarded, guard)
            if (blocked) assert.equal(await r.lookupPath(before, [], ctx), missing)
            for (const owner of blocked ? [chain] : [chain, before]) {
                assert.equal(await r.lookupPath(owner, ["length"], ctx), slots.length)
                for (const [i, slot] of slots.entries()) assert.equal(await r.lookupPath(owner, [i], ctx), slot)
                assert.equal(await r.getErrors(owner, [], ctx), slots.includes(missing) ? missing : null)
            }
        }
    })
})
