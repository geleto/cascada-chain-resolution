// Selected Phase 3/4 contract, exercised against the unmodified public runtime.
// Failures remain explicit deferred debt; do not change expectations to match it.
import assert from "node:assert/strict"
import * as r from "../../src/index.js"
import { OrderedThenable, ready } from "../ordered-thenable.js"

const context = () => ({ execution: new r.Execution(), errorContext: "write-based identity" })
const value = (chain, ctx) => r.lookupPath(chain, [], ctx)
const write = (path, replacement, scope = path.length) => (chain, ctx) =>
    r.assignPath(chain, path, replacement, ctx, scope)
const call = (method, args) => (chain, ctx) =>
    r.run(chain, [], method, args, ctx, { mutationScopeDepth: 0 })

const retain = (chain, ctx) => new r.Chain(value(chain, ctx), ctx)

// Issue consumers before releasing producers. Expected partitions come from
// the commands in each test, not runtime tokens or physical representations.
function observeVersions(chains, ctx, groups, expected) {
    const captured = chains.map(chain => value(chain, ctx))
    const output = r.export(new r.Chain(captured, ctx), [], ctx)
    const searches = []
    for (let i = 0; i < chains.length; i++)
    for (let j = i + 1; j < chains.length; j++) {
        const list = new r.Chain([captured[j]], ctx)
        for (const method of ["includes", "indexOf", "lastIndexOf"])
            searches.push({ i, j, method,
                answer: r.run(list, [], method, [captured[i]], ctx, {}) })
    }
    return async () => {
        const exported = await output
        assert.deepEqual(exported, expected, "Each capture keeps its issued prefix")
        const actual = await Promise.all(searches.map(async ({ i, j, method, answer }) => ({
            i, j, method, answer: await answer, alias: exported[i] === exported[j],
        })))
        assert.deepEqual(actual, searches.map(({ i, j, method }) => ({
            i, j, method,
            answer: method === "includes" ? groups[i] === groups[j] : groups[i] === groups[j] ? 0 : -1,
            alias: groups[i] === groups[j],
        })), "Search and export follow the ordered publication partition")
        return exported
    }
}

// This table specifies logical command writes, independently of storage, COW,
// comparison machinery, and equal final contents. Each test gets fresh data.
const cases = [
    { name: "no command", initial: {}, after: {}, effective: false, apply() {} },
    { name: "equal scalar assignment", initial: { k: 1 }, after: { k: 1 }, effective: true,
        apply: write(["k"], 1) },
    { name: "change then restore", initial: { k: 1 }, after: { k: 1 }, effective: true,
        apply(chain, ctx) { write(["k"], 2)(chain, ctx); return write(["k"], 1)(chain, ctx) } },
    { name: "same managed reference assignment", initial: { k: { n: 1 } }, after: { k: { n: 1 } }, effective: true,
        apply(chain, ctx) { return r.assignPath(chain, ["k"], r.lookupPath(chain, ["k"], ctx), ctx) } },
    { name: "absent deletion", initial: { k: 1 }, after: { k: 1 }, effective: false,
        apply(chain, ctx) { return r.deletePath(chain, ["missing"], ctx) } },
    { name: "nested absent deletion", initial: { child: { k: 1 } }, after: { child: { k: 1 } }, effective: false,
        apply(chain, ctx) { return r.deletePath(chain, ["child", "missing"], ctx) } },
    { name: "present undefined deletion", initial: { k: undefined }, after: {}, effective: true,
        apply(chain, ctx) { return r.deletePath(chain, ["k"], ctx) } },
    { name: "healthy repair", initial: { k: 1 }, after: { k: 1 }, effective: false,
        apply(chain, ctx) { return r.repairPath(chain, ["k"], ctx) } },
    { name: "nested healthy repair", initial: { child: { k: 1 } }, after: { child: { k: 1 } }, effective: false,
        apply(chain, ctx) { return r.repairPath(chain, ["child", "k"], ctx) } },
    { name: "hole deletion", initial: [, 2], after: [, 2], effective: false,
        apply(chain, ctx) { return r.deletePath(chain, [0], ctx) } },
    { name: "hole filled with undefined", initial: [, 2], after: [undefined, 2], effective: true,
        apply: write([0], undefined) },
    { name: "equal length assignment", initial: [1, 2], after: [1, 2], effective: true,
        apply: write(["length"], 2) },
    { name: "empty fill range", initial: [1, 2], after: [1, 2], effective: false,
        apply: call("fill", [1, 1, 1]) },
    { name: "equal value fill", initial: [1, 1], after: [1, 1], effective: true,
        apply: call("fill", [1]) },
    { name: "singleton reverse", initial: [1], after: [1], effective: false,
        apply: call("reverse", []) },
    { name: "equal elements reverse", initial: [1, 1], after: [1, 1], effective: true,
        apply: call("reverse", []) },
    { name: "zero count copyWithin", initial: [1, 2], after: [1, 2], effective: false,
        apply: call("copyWithin", [0, 1, 1]) },
    { name: "same positions copyWithin", initial: [1, 2], after: [1, 2], effective: true,
        apply: call("copyWithin", [0, 0]) },
    { name: "already sorted", initial: [1, 2], after: [1, 2], effective: true,
        apply: call("sort", []) },
    { name: "singleton sort writes its position", initial: [1], after: [1], effective: true,
        apply: call("sort", []) },
    { name: "empty sort", initial: [], after: [], effective: false,
        apply: call("sort", []) },
    { name: "hole-only sort", initial: new Array(4), after: new Array(4), effective: false,
        apply: call("sort", []) },
    { name: "hole-only reverse", initial: new Array(4), after: new Array(4), effective: false,
        apply: call("reverse", []) },
    { name: "hole-only copyWithin", initial: new Array(4), after: new Array(4), effective: false,
        apply: call("copyWithin", [0, 1]) },
    ...["push", "unshift", "pop", "shift", "splice"].map(method => ({
        name: `empty ${method} writes length`, initial: [], after: [], effective: true,
        apply: call(method, []),
    })),
    ...[0, 1, 2].map(scope => ({ name: `equal nested write scope ${scope}`,
        initial: { child: { k: 1 } }, after: { child: { k: 1 } }, effective: true,
        apply: write(["child", "k"], 1, scope) })),
]

describe("write-based identity conformance", () => {
    for (const timing of ["ready", "synchronous", "native", "ordered"])
    for (const entered of [false, true])
    for (const spec of cases) {
        it(`${spec.name}: ${timing}, entered=${entered}`, async () => {
            const ctx = context(), initial = structuredClone(spec.initial)
            const pending = timing === "native" ? Promise.withResolvers()
                : timing === "ordered" ? new OrderedThenable() : undefined
            const source = new r.Chain(timing === "synchronous" ? ready(initial)
                : pending?.promise ?? pending ?? initial, ctx)
            const retained = new r.Chain(value(source, ctx), ctx)
            const action = entered
                ? r.enter(source, [], ctx, true, inside => spec.apply(inside, ctx))
                : spec.apply(source, ctx)
            const list = new r.Chain([value(source, ctx)], ctx)
            const searches = ["includes", "indexOf", "lastIndexOf"].map(method =>
                r.run(list, [], method, [value(retained, ctx)], ctx, {}))
            const pair = new r.Chain({ before: value(retained, ctx), after: value(source, ctx) }, ctx)
            const exported = r.export(pair, [], ctx)
            pending?.resolve(initial)
            await action
            const [output, ...answers] = await Promise.all([exported, ...searches])
            assert.deepEqual(output.before, spec.initial, "Earlier retained data stays immutable")
            assert.deepEqual(output.after, spec.after, "Logical command result")
            assert.deepEqual({ searches: answers, alias: output.before === output.after }, {
                searches: spec.effective ? [false, -1, -1] : [true, 0, 0],
                alias: !spec.effective,
            }, "Search and export must follow actual publication")
        })
    }

    for (const outcome of ["equal", "different", "reject", "never"])
    it(`overwritten pending assignment remains effective: ${outcome}`, async () => {
        const ctx = context(), pending = Promise.withResolvers()
        const source = new r.Chain({ k: 1 }, ctx)
        const retained = new r.Chain(value(source, ctx), ctx)
        r.assignPath(source, ["k"], pending.promise, ctx)
        r.assignPath(source, ["k"], 1, ctx)
        const list = new r.Chain([value(source, ctx)], ctx)
        // Compare before settlement, including a permanently pending RHS.
        for (const method of ["includes", "indexOf", "lastIndexOf"])
            assert.equal(r.run(list, [], method, [value(retained, ctx)], ctx, {}),
                method === "includes" ? false : -1)
        const pair = new r.Chain({ before: value(retained, ctx), after: value(source, ctx) }, ctx)
        const output = r.export(pair, [], ctx)
        assert.equal(output instanceof Promise, false, "No identity-only wait for overwritten data")
        assert.deepEqual(output, { before: { k: 1 }, after: { k: 1 } })
        assert.notEqual(output.before, output.after)
        if (outcome === "reject") pending.reject(new Error("discarded input"))
        else if (outcome !== "never") pending.resolve(outcome === "equal" ? 1 : 2)
        await new Promise(setImmediate)
        assert.deepEqual(await r.export(source, [], ctx), { k: 1 })
    })

    for (const publish of [false, true])
    it(`delayed entry settles actual publication: publish=${publish}`, async () => {
        const ctx = context(), gate = Promise.withResolvers()
        const source = new r.Chain({ item: { k: 1 }, sibling: 7 }, ctx)
        const retained = new r.Chain(r.lookupPath(source, ["item"], ctx), ctx)
        const entry = r.enter(source, ["item", "k"], ctx, true, inside =>
            gate.promise.then(() => publish ? r.assignPath(inside, [], 1, ctx) : undefined))
        const list = new r.Chain([r.lookupPath(source, ["item"], ctx)], ctx)
        const comparison = r.run(list, [], "includes", [value(retained, ctx)], ctx, {})
        assert.equal(r.lookupPath(source, ["sibling"], ctx), 7, "Independent sibling remains available")
        // The callback can still publish. No early true or false is justified.
        let settled = false
        const answer = Promise.resolve(comparison).then(result => { settled = true; return result })
        await new Promise(setImmediate)
        const settledEarly = settled
        gate.resolve()
        await entry
        const actual = await answer
        assert.deepEqual({ settledEarly, actual }, { settledEarly: false, actual: !publish })
    })

    it("assignment separates its owner without separating the stored reference", async () => {
        const ctx = context(), source = new r.Chain({ child: { k: 1 } }, ctx)
        const retained = new r.Chain(value(source, ctx), ctx)
        const child = r.lookupPath(source, ["child"], ctx)
        r.assignPath(source, ["child"], child, ctx)
        const pair = new r.Chain({ before: value(retained, ctx), after: value(source, ctx) }, ctx)
        const output = await r.export(pair, [], ctx)
        assert.notEqual(output.before, output.after)
        assert.equal(output.before.child, output.after.child)
    })

    for (const publish of [false, true])
    it(`entry forwards the identity captured inside its final prefix: publish=${publish}`, async () => {
        const ctx = context(), source = new r.Chain({ item: { k: 1 } }, ctx)
        let insideResult
        await r.enter(source, ["item"], ctx, true, inside => {
            if (publish) r.assignPath(inside, ["k"], 1, ctx)
            insideResult = new r.Chain(value(inside, ctx), ctx)
        })
        const after = r.lookupPath(source, ["item"], ctx)
        const list = new r.Chain([after], ctx)
        const found = await r.run(list, [], "includes", [value(insideResult, ctx)], ctx, {})
        const pair = new r.Chain({ inside: value(insideResult, ctx), after }, ctx)
        const output = await r.export(pair, [], ctx)
        assert.equal(found, true)
        assert.equal(output.inside, output.after, "Entry adds no extra write after contained publication")
    })

    for (const leftWrites of [false, true])
    for (const rightWrites of [false, true])
    for (const first of ["left", "right"])
    it(`sibling entries preserve ordered captures: left=${leftWrites}, right=${rightWrites}, first=${first}`, async () => {
        const ctx = context(), source = new r.Chain({ left: { k: 1 }, right: { k: 1 } }, ctx)
        const before = retain(source, ctx)
        const left = Promise.withResolvers(), right = Promise.withResolvers()
        const a = r.enter(source, ["left", "k"], ctx, true, inside =>
            left.promise.then(() => leftWrites ? r.assignPath(inside, [], 2, ctx) : undefined))
        const between = retain(source, ctx)
        const b = r.enter(source, ["right", "k"], ctx, true, inside =>
            right.promise.then(() => rightWrites ? r.assignPath(inside, [], 2, ctx) : undefined))
        const after = retain(source, ctx)
        const verify = observeVersions([before, between, after], ctx,
            [0, +leftWrites, +leftWrites + +rightWrites], [
                { left: { k: 1 }, right: { k: 1 } },
                { left: { k: leftWrites ? 2 : 1 }, right: { k: 1 } },
                { left: { k: leftWrites ? 2 : 1 }, right: { k: rightWrites ? 2 : 1 } },
            ])
        const release = { left, right }, entries = { left: a, right: b }
        release[first].resolve()
        await entries[first]
        release[first === "left" ? "right" : "left"].resolve()
        await Promise.all([a, b])
        const output = await verify()
        assert.equal(output[0].left === output[1].left, !leftWrites)
        assert.equal(output[1].left, output[2].left)
        assert.equal(output[0].right, output[1].right)
        assert.equal(output[1].right === output[2].right, !rightWrites)
    })

    for (const publish of [false, true])
    it(`ready sibling write cannot be overwritten by earlier identity completion: publish=${publish}`, async () => {
        const ctx = context(), gate = Promise.withResolvers()
        const source = new r.Chain({ child: { k: 1 }, sibling: 7 }, ctx)
        const before = retain(source, ctx)
        const entry = r.enter(source, ["child", "k"], ctx, true, inside =>
            gate.promise.then(() => publish ? r.assignPath(inside, [], 2, ctx) : undefined))
        const during = retain(source, ctx)
        r.assignPath(source, ["sibling"], 8, ctx)
        assert.equal(r.lookupPath(source, ["sibling"], ctx), 8)
        const after = retain(source, ctx)
        const verify = observeVersions([before, during, after], ctx, [0, +publish, 2], [
            { child: { k: 1 }, sibling: 7 },
            { child: { k: publish ? 2 : 1 }, sibling: 7 },
            { child: { k: publish ? 2 : 1 }, sibling: 8 },
        ])
        gate.resolve()
        await entry
        const output = await verify()
        assert.equal(output[1].child, output[2].child)
    })

    for (const publish of [false, true])
    it(`nested entry forwards only inner publication: publish=${publish}`, async () => {
        const ctx = context(), gate = Promise.withResolvers()
        const source = new r.Chain({ k: 1 }, ctx), before = retain(source, ctx)
        let privateBefore, privateAfter
        const outer = r.enter(source, [], ctx, true, inside => {
            privateBefore = retain(inside, ctx)
            const inner = r.enter(inside, ["k"], ctx, true, child =>
                gate.promise.then(() => publish ? r.assignPath(child, [], 2, ctx) : undefined))
            privateAfter = retain(inside, ctx)
            return inner
        })
        const verify = observeVersions([before, privateBefore, privateAfter, retain(source, ctx)],
            ctx, [0, 0, +publish, +publish],
            [{ k: 1 }, { k: 1 }, { k: publish ? 2 : 1 }, { k: publish ? 2 : 1 }])
        gate.resolve()
        await outer
        await verify()
    })

    for (const create of [false, true])
    it(`deletion decides presence after earlier gate: create=${create}`, async () => {
        const ctx = context(), gate = Promise.withResolvers()
        const source = new r.Chain({}, ctx), before = retain(source, ctx)
        const entry = r.enter(source, ["missing"], ctx, true, inside =>
            gate.promise.then(() => create ? r.assignPath(inside, [], 1, ctx) : undefined))
        const during = retain(source, ctx)
        const deletion = r.deletePath(source, ["missing"], ctx)
        const verify = observeVersions([before, during, retain(source, ctx)], ctx,
            [0, create ? 1 : 0, create ? 2 : 0], [{}, create ? { missing: 1 } : {}, {}])
        gate.resolve()
        await Promise.all([entry, deletion])
        await verify()
    })

    for (const start of [0, 2])
    it(`controlled fill waits for argument before classifying writes: start=${start}`, async () => {
        const ctx = context(), argument = Promise.withResolvers()
        const source = new r.Chain([1, 1], ctx), before = retain(source, ctx)
        const action = call("fill", [1, argument.promise])(source, ctx)
        const after = retain(source, ctx)
        const verify = observeVersions([before, after], ctx, [0, start === 0 ? 1 : 0], [[1, 1], [1, 1]])
        const found = r.run(new r.Chain([value(after, ctx)], ctx), [], "includes", [value(before, ctx)], ctx, {})
        let settled = false
        const answer = Promise.resolve(found).then(result => { settled = true; return result })
        await new Promise(setImmediate)
        const settledEarly = settled
        argument.resolve(start)
        await action
        const actual = await answer
        assert.deepEqual({ settledEarly, actual }, { settledEarly: false, actual: start === 2 })
        await verify()
    })

    for (const publish of [false, true])
    it(`protection copy inherits an already pending identity: publish=${publish}`, async () => {
        const ctx = context(), gate = Promise.withResolvers()
        const source = new r.Chain({ child: { k: 1 }, other: {} }, ctx)
        const before = retain(source, ctx)
        const entry = r.enter(source, ["child", "k"], ctx, true, inside =>
            gate.promise.then(() => publish ? r.assignPath(inside, [], 2, ctx) : undefined))
        const pending = retain(source, ctx)
        // Retaining pending forces ancestor protection while the missing suffix
        // is discovered. That copy must share the existing pending reference.
        r.deletePath(source, ["other", "missing"], ctx)
        const copied = retain(source, ctx)
        const sameBeforeSettlement = r.run(new r.Chain([value(copied, ctx)], ctx), [],
            "includes", [value(pending, ctx)], ctx, {})
        const verify = observeVersions([before, pending, copied], ctx, [0, +publish, +publish], [
            { child: { k: 1 }, other: {} },
            { child: { k: publish ? 2 : 1 }, other: {} },
            { child: { k: publish ? 2 : 1 }, other: {} },
        ])
        gate.resolve()
        await entry
        assert.equal(sameBeforeSettlement, true, "Shared pending identity compares synchronously")
        await verify()
    })

    for (const writes of [false, true])
    for (const pending of [false, true])
    it(`native publication covers receiver descendants and path ancestors: writes=${writes}, pending=${pending}`, async () => {
        const ctx = context(), gate = Promise.withResolvers()
        const receiver = { child: { k: 1 }, untouched: {}, mutate() {
            const finish = () => { if (writes) this.child.k = 2 }
            return pending ? gate.promise.then(finish) : finish()
        } }
        const source = new r.Chain({ receiver, sibling: {} }, ctx), before = retain(source, ctx)
        const action = r.run(source, ["receiver"], "mutate", [], ctx, { mutationScopeDepth: 1 })
        const after = retain(source, ctx)
        const exported = r.export(new r.Chain([value(before, ctx), value(after, ctx)], ctx), [], ctx)
        gate.resolve()
        await action
        const [a, b] = await exported
        assert.notEqual(a, b)
        assert.notEqual(a.receiver, b.receiver)
        assert.notEqual(a.receiver.child, b.receiver.child)
        assert.notEqual(a.receiver.untouched, b.receiver.untouched)
        assert.equal(a.sibling, b.sibling)
        assert.equal(a.receiver.child.k, 1)
        assert.equal(b.receiver.child.k, writes ? 2 : 1)
        for (const path of [[], ["receiver"], ["receiver", "child"], ["receiver", "untouched"], ["sibling"]]) {
            const list = new r.Chain([r.lookupPath(after, path, ctx)], ctx)
            for (const method of ["includes", "indexOf", "lastIndexOf"])
                assert.equal(await r.run(list, [], method, [r.lookupPath(before, path, ctx)], ctx, {}),
                    method === "includes" ? path[0] === "sibling" : path[0] === "sibling" ? 0 : -1)
        }
    })

    for (const publish of [false, true])
    it(`shared entry identity completes after a search short-circuits: publish=${publish}`, async () => {
        const ctx = context(), gate = Promise.withResolvers()
        const source = new r.Chain({ k: 1 }, ctx), before = retain(source, ctx)
        const entry = r.enter(source, ["k"], ctx, true, inside =>
            gate.promise.then(() => publish ? r.assignPath(inside, [], 2, ctx) : undefined))
        const after = retain(source, ctx)
        const list = new r.Chain([value(after, ctx), value(before, ctx)], ctx)
        const found = r.run(list, [], "includes", [value(before, ctx)], ctx, {})
        // The second candidate proves the result and closes the search owner;
        // shared publication must still finish for later consumers.
        assert.equal(found, true)
        gate.resolve()
        await entry
        await observeVersions([before, after], ctx, [0, +publish], [{ k: 1 }, { k: publish ? 2 : 1 }])()
    })

    it("ordinary Promise settlement completes a captured version without a new write", async () => {
        const ctx = context(), pending = Promise.withResolvers()
        const source = new r.Chain({ k: pending.promise }, ctx)
        const retained = new r.Chain(value(source, ctx), ctx)
        pending.resolve(1)
        await new Promise(setImmediate)
        const pair = new r.Chain({ before: value(retained, ctx), after: value(source, ctx) }, ctx)
        const output = await r.export(pair, [], ctx)
        assert.equal(output.before, output.after)
        assert.deepEqual(output.after, { k: 1 })
    })

    for (const gated of [false, true])
    it(`failed repair with no publication preserves identity: gated=${gated}`, async () => {
        const ctx = context(), cause = new Error("refused repair")
        let refuse = false
        const storage = new Proxy({ then: 1 }, {
            set(target, key, next) {
                if (refuse && key === "then" && next === 1) throw cause
                return Reflect.set(target, key, next)
            },
        })
        const source = new r.Chain(storage, ctx)
        const poison = r.assignPath(source, ["then"], () => {}, ctx)
        assert(r.isPoisonError(poison))
        const release = Promise.withResolvers()
        const entry = gated ? r.enter(source, ["then"], ctx, true, () => release.promise) : undefined
        // Capture only comparison identity. A second value holder would force
        // COW and avoid the supported storage failure under examination.
        const candidate = Promise.withResolvers(), list = new r.Chain([candidate.promise], ctx)
        const same = r.run(list, [], "includes", [value(source, ctx)], ctx, {})
        refuse = true
        const repair = r.repairPath(source, ["then"], ctx)
        release.resolve()
        await entry
        const failed = await repair
        assert(r.isPoisonError(failed))
        assert.equal(failed.cause, cause)
        assert.equal(r.lookupPath(source, ["then"], ctx), poison, "Original poison remains installed")
        candidate.resolve(value(source, ctx))
        assert.equal(await same, true, "An independent Error result is not a publication")
    })

    it("successful repair publishes even when it restores pre-failure contents", async () => {
        const ctx = context(), source = new r.Chain({ then: 1 }, ctx)
        const original = new r.Chain(value(source, ctx), ctx)
        assert(r.isPoisonError(r.assignPath(source, ["then"], () => {}, ctx)))
        const poisoned = new r.Chain(value(source, ctx), ctx)
        r.repairPath(source, ["then"], ctx)
        const list = new r.Chain([value(source, ctx)], ctx)
        assert.equal(await r.run(list, [], "includes", [value(poisoned, ctx)], ctx, {}), false)
        assert.equal(await r.run(list, [], "includes", [value(original, ctx)], ctx, {}), false)
        assert.deepEqual(await r.export(source, [], ctx), { then: 1 })
    })

    it("failed equal assignment that publishes poison is effective", async () => {
        const ctx = context(), cause = new Error("refused assignment")
        let refuse = false
        const storage = new Proxy({ k: 1 }, {
            set(target, key, next) {
                if (refuse && key === "k") throw cause
                return Reflect.set(target, key, next)
            },
        })
        const source = new r.Chain(storage, ctx), candidate = Promise.withResolvers()
        const list = new r.Chain([candidate.promise], ctx)
        const same = r.run(list, [], "includes", [value(source, ctx)], ctx, {})
        refuse = true
        const failure = r.assignPath(source, ["k"], 1, ctx)
        assert(r.isPoisonError(failure))
        assert.equal(failure.cause, cause)
        assert.equal(await r.hasError(source, [], ctx), true)
        candidate.resolve(value(source, ctx))
        assert.equal(await same, false)
    })
})
