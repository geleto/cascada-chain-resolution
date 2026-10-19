// Production identity work and last-use checks. Public cases cover producers;
// this fixture isolates history-sized forwarding from ordinary graph traversal.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

let counts
const reset = () => { counts = { links: 0, moves: 0, deliveries: 0, captures: 0, waits: 0 } }
globalThis.countIdentityWork = key => { counts[key]++ }
const identityURL = new URL("../../src/captured-identity.js", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url !== identityURL) return result
    let source = String(result.source)
    for (const [marker, replacement] of [
        ["function captureIdentity(value, operationContext) {",
            "function captureIdentity(value, operationContext) { globalThis.countIdentityWork('captures');"],
        ["function waitIdentities(left, right, owner) {",
            "function waitIdentities(left, right, owner) { globalThis.countIdentityWork('waits');"],
        ["while (root.state === FORWARD) root = root.into",
            "while (root.state === FORWARD) { globalThis.countIdentityWork('links'); root = root.into }"],
        ["for (const query of moving ?? []) {",
            "for (const query of moving ?? []) { globalThis.countIdentityWork('moves');"],
        ["query.resume()", "globalThis.countIdentityWork('deliveries'); query.resume()"],
    ]) {
        assert(source.includes(marker), "Identity work instrumentation needs updating")
        source = source.replaceAll(marker, replacement)
    }
    return { ...result, source }
} })
reset()
const r = await import("../../src/index.js")
const { captureIdentity, inheritIdentity, IdentityPublication, compareIdentities,
    resolveCapturedIdentities } = await import("../../src/captured-identity.js")
const { OperationOwner } = await import("../../src/operation-lifecycle.js")
const context = () => ({ execution: new r.Execution(), errorContext: "identity work" })
const turn = () => new Promise(setImmediate)
const samples = []
const partitions = []

// Representation-only remaps need placements, not search identity keys.
{
    const ctx = context(), source = new r.Chain(Array.from({ length: 100 }, (_, k) => ({ k })), ctx)
    reset()
    const reversed = r.run(source, [], "toReversed", [], ctx, {})
    assert.equal(counts.captures, 0, "Ordinary remaps do not capture unused search identities")
    assert.deepEqual(r.export(new r.Chain(reversed, ctx), [], ctx).map(value => value.k),
        Array.from({ length: 100 }, (_, k) => 99 - k))
}

for (const size of [128, 512, 2048, 8192]) for (const order of ["reverse", "balanced"]) {
    const ctx = context(), owner = new OperationOwner(ctx), publications = [], results = []
    let previous = new r.Chain({}, ctx)
    const original = captureIdentity(previous._state.value, ctx)
    reset()
    for (let index = 0; index < size; index++) {
        const next = new r.Chain({}, ctx)
        inheritIdentity(previous._state.value, next._state.value, ctx)
        const publication = new IdentityPublication(ctx)
        publication.capture(next._state.value)
        publication.suspend()
        publications.push(publication)
        results.push(compareIdentities(captureIdentity(next._state.value, ctx), original, owner))
        r.assignPath(previous, [], null, ctx)
        previous = next
    }
    r.assignPath(previous, [], null, ctx)
    if (order === "reverse") {
        for (let index = size - 1; index >= 0; index--) publications[index].finish(false)
    } else {
        for (let span = 1; span < size; span *= 2)
            for (let index = span; index < size; index += span * 2) publications[index].finish(false)
        publications[0].finish(false)
    }
    assert((await Promise.all(results)).every(Boolean))
    assert.equal(owner.releases, undefined, "Settled queries release their registrations")
    assert(counts.moves <= size * Math.log2(size), JSON.stringify({ size, order, ...counts }))
    assert(counts.links <= 12 * size * Math.log2(size), JSON.stringify({ size, order, ...counts }))
    assert(counts.deliveries <= 2 * size, JSON.stringify({ size, order, ...counts }))
    samples.push({ size, order, ...counts })
}

// Many old capture keys can already forward to one non-anchor representative.
// Compare that representative once, whether it eventually merges or stays distinct.
for (const published of [false, true]) {
    const ctx = context(), owner = new OperationOwner(ctx)
    const source = new r.Chain({}, ctx), successor = new r.Chain({}, ctx)
    const nodes = [{ identity: captureIdentity(source._state.value, ctx) }]
    inheritIdentity(source._state.value, successor._state.value, ctx)
    const publication = new IdentityPublication(ctx)
    publication.capture(successor._state.value); publication.suspend()
    for (let index = 0; index < 1024; index++) {
        const copy = new r.Chain({}, ctx)
        inheritIdentity(successor._state.value, copy._state.value, ctx)
        const noOp = new IdentityPublication(ctx)
        noOp.capture(copy._state.value); noOp.suspend()
        nodes.push({ identity: captureIdentity(copy._state.value, ctx) })
        noOp.finish(false)
        r.assignPath(copy, [], null, ctx)
    }
    reset()
    const result = resolveCapturedIdentities(nodes, owner)
    assert.equal(counts.waits, 1, "Shared non-anchor representatives need only one comparison wait")
    publication.finish(published)
    const canonical = await result
    assert.equal(canonical.size, published ? 2 : 1)
    assert.equal(new Set(nodes.slice(1).map(node => node.identity)).size, 1)
    assert.equal(nodes[0].identity === nodes[1].identity, !published)
    assert.equal(owner.releases, undefined, "Completed partition comparisons release their registrations")
    partitions.push({ representations: nodes.length, published, waits: counts.waits, groups: canonical.size })
    owner.close()
}

// Closing consumers removes interests without cancelling shared publication.
{
    const ctx = context(), value = new r.Chain({}, ctx), owner = new OperationOwner(ctx)
    const before = captureIdentity(value._state.value, ctx)
    const publication = new IdentityPublication(ctx)
    publication.capture(value._state.value)
    publication.suspend()
    const after = captureIdentity(value._state.value, ctx)
    for (let index = 0; index < 1024; index++) compareIdentities(before, after, owner)
    owner.close()
    reset()
    publication.finish(false)
    assert.equal(counts.deliveries, 0, "Closed comparisons do not resume")
    assert.equal(compareIdentities(before, after, new OperationOwner(ctx)), true)
}

// Closing a comparison detaches both unresolved endpoints.
{
    const ctx = context(), owner = new OperationOwner(ctx)
    const left = new r.Chain({}, ctx), right = new r.Chain({}, ctx)
    inheritIdentity(left._state.value, right._state.value, ctx)
    const publications = [left, right].map(chain => {
        const publication = new IdentityPublication(ctx)
        publication.capture(chain._state.value); publication.suspend()
        return publication
    })
    const keys = [left, right].map(chain => captureIdentity(chain._state.value, ctx))
    for (let index = 0; index < 1024; index++) compareIdentities(keys[0], keys[1], owner)
    owner.close()
    assert.deepEqual(keys.map(key => key.queries?.size ?? 0), [0, 0], "Both pending endpoints detach")
    reset()
    publications.forEach(publication => publication.finish(false))
    assert.equal(counts.deliveries, 0)
}

// A pending identity comparison retains keys, not its old source container.
assert(global.gc, "Run with --expose-gc")
{
    const ctx = context(), gate = Promise.withResolvers()
    function issue() {
        const original = { k: 1, sibling: {} }, source = new r.Chain(original, ctx)
        const before = new r.Chain(r.lookupPath(source, [], ctx), ctx)
        const entry = r.enter(source, ["k"], ctx, true, () => gate.promise)
        const list = new r.Chain([r.lookupPath(source, [], ctx)], ctx)
        const result = r.run(list, [], "includes", [r.lookupPath(before, [], ctx)], ctx, {})
        r.assignPath(before, [], null, ctx)
        r.assignPath(source, [], null, ctx)
        r.assignPath(list, [], null, ctx)
        return { result, entry, source: new WeakRef(original) }
    }
    const pending = issue()
    for (let index = 0; index < 20; index++) { await turn(); global.gc() }
    assert.equal(pending.source.deref(), undefined)
    gate.resolve()
    await pending.entry
    assert.equal(await pending.result, true)
}
// Nested completion drains in one transition, even for history-sized nesting.
{
    const ctx = context(), source = new r.Chain({}, ctx), owner = new OperationOwner(ctx)
    const before = captureIdentity(source._state.value, ctx)
    const root = new IdentityPublication(ctx)
    root.capture(source._state.value)
    root.suspend()
    const result = compareIdentities(before, captureIdentity(source._state.value, ctx), owner)
    const publications = [root]
    for (let index = 0; index < 8192; index++) publications.push(new IdentityPublication(ctx, publications.at(-1)))
    for (const publication of publications.slice(0, -1)) publication.finish(false)
    publications.at(-1).finish(true)
    assert.equal(compareIdentities(before, captureIdentity(source._state.value, ctx), owner), false)
    assert.equal(await result, false)
}

// An unfinished contribution cannot retain a history of completed siblings.
{
    const ctx = context(), enclosing = new IdentityPublication(ctx)
    const unfinished = new IdentityPublication(ctx, enclosing)
    function completedChild() {
        const child = new IdentityPublication(ctx, enclosing)
        child.finish(false)
        return new WeakRef(child)
    }
    const completed = Array.from({ length: 1024 }, completedChild)
    enclosing.finish()
    const destination = new IdentityPublication(ctx)
    destination.record(enclosing.outcome())
    destination.finish()
    for (let index = 0; index < 20; index++) { await turn(); global.gc() }
    assert(completed.every(ref => ref.deref() === undefined))
    unfinished.finish(false)
    assert.equal(destination.outcome(), false)
}

// Committed private outcomes use the same dependency and release path.
for (const published of [false, true]) {
    const ctx = context(), source = new r.Chain({}, ctx), owner = new OperationOwner(ctx)
    const before = captureIdentity(source._state.value, ctx)
    const destination = new IdentityPublication(ctx)
    destination.capture(source._state.value); destination.suspend()
    const privatePublication = new IdentityPublication(ctx)
    const child = new IdentityPublication(ctx, privatePublication)
    privatePublication.finish()
    const outcome = privatePublication.outcome()
    child.finish(published) // Completion can precede destination adoption.
    destination.record(outcome)
    destination.finish()
    assert.equal(compareIdentities(before, captureIdentity(source._state.value, ctx), owner), !published)
}

// Committed private outcomes use the same dependency and release path.
{
    const ctx = context(), destination = new IdentityPublication(ctx)
    function adopt() {
        const publication = new IdentityPublication(ctx)
        const child = new IdentityPublication(ctx, publication)
        publication.finish()
        destination.record(publication.outcome())
        return { child, publication: new WeakRef(publication) }
    }
    const unfinished = adopt()
    const completed = Array.from({ length: 1024 }, () => {
        const { child, publication } = adopt()
        child.finish(false)
        return publication
    })
    destination.finish()
    for (let index = 0; index < 20; index++) { await turn(); global.gc() }
    assert(completed.every(ref => ref.deref() === undefined))
    unfinished.child.finish(true)
    assert.equal(destination.outcome(), true)
}

console.log(JSON.stringify({ samples, partitions, closedComparisons: 1024, sourceCollected: true,
    nestedCompletion: 8192, completedSiblingsCollected: 1024, adoptedSiblingsCollected: 1024 }))
