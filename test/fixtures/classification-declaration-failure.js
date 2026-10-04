// Inject implementation defects without changing supported input or primordials.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

let armed
globalThis.injectClassificationDeclarationFailure = site => {
    if (armed?.site !== site) return
    const { cause } = armed
    armed = undefined
    throw cause
}

const edits = new Map([
    [new URL("../../src/meta.js", import.meta.url).href, [
        ["const admittedPrototype = reflect(() => Object.getPrototypeOf(value))", "classification"],
        ["function isPlainObjectPrototype(prototype, reflect) {", "plain prototype"],
        ["function setIdentityDeclaration(value, declaration) {", "identity registration"],
        ["function addManagedPrototype(prototype) {", "class registration"],
    ]],
    [new URL("../../src/data-declarations.js", import.meta.url).href, [
        ["visited.add(identity)", "declaration traversal"],
        ["function validateManagedPrototype(prototype, reflect) {", "prototype validation"],
    ]],
    [new URL("../../src/error.js", import.meta.url).href, [
        ["function createPoisonError(reason, operationContext, kind) {", "poison contextualization"],
    ]],
    [new URL("../../src/external-snapshot.js", import.meta.url).href, [
        ["function collect(failure) {", "snapshot failure effect"],
    ]],
])
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    const replacements = edits.get(url)
    if (!replacements) return result
    let source = String(result.source)
    for (const [marker, site] of replacements) {
        assert(source.includes(marker), marker)
        const hook = `globalThis.injectClassificationDeclarationFailure(${JSON.stringify(site)})`
        source = source.replace(marker, marker + `\n    ${hook}`)
    }
    return { ...result, source }
} })

const r = await import("../../src/index.js")
const metadata = await import("../../src/meta.js")

// A structural fallback must consume the host-failure marker without constructing
// graph poison. Contextualization remains a separate owning-boundary decision.
{
    const source = new Proxy({}, { getPrototypeOf() { throw new Error("opaque host") } })
    const ctx = { execution: new r.Execution(), errorContext: "opaque admission" }
    const poisonFault = armed = { site: "poison contextualization", cause: new Error("unexpected poison construction") }
    assert.equal(r.import(source, ctx), source)
    assert.equal(armed, poisonFault)
    assert.equal(ctx.execution.fatalError, null)
    armed = undefined
}

for (const site of ["classification", "plain prototype"]) {
    for (const pending of [false, true]) {
        const reports = [], source = { site, pending }
        const ctx = { execution: new r.Execution(error => reports.push(error)), errorContext: source }
        const sibling = r.import(new Promise(() => {}), ctx)
        const siblingOutcome = sibling.then(() => assert.fail("Sibling succeeded"), error => error)
        const cause = new Error(`Internal ${site} defect`)
        let failed
        if (pending) {
            const signal = Promise.withResolvers()
            const result = r.import(signal.promise, ctx)
            const outcome = result.then(() => assert.fail("Import succeeded"), error => error)
            armed = { site, cause }
            signal.resolve({ value: 1 })
            failed = await outcome
        } else {
            armed = { site, cause }
            try { r.import({ value: 1 }, ctx) }
            catch (error) { failed = error }
        }
        assert.equal(armed, undefined, `${site}: injection was unused`)
        assert(r.isFatalError(failed), `${site}, pending=${pending}`)
        assert.equal(failed.cause, cause)
        assert.equal(failed.errorContext, source)
        assert.equal(ctx.execution.fatalError, failed)
        assert.equal(await siblingOutcome, failed)
        assert.deepEqual(reports, [failed])
        assert.throws(() => r.import(1, ctx), error => error === failed)
    }
}

for (const site of ["poison contextualization", "snapshot failure effect"]) {
    for (const pending of [false, true]) {
        const reports = [], source = { site, pending }
        const ctx = { execution: new r.Execution(error => reports.push(error)), errorContext: source }
        const hostCause = new Error("supported host failure")
        const signal = pending ? Promise.withResolvers() : undefined
        const snapshotSource = new Proxy({}, { getPrototypeOf() { throw hostCause } })
        const chain = site === "poison contextualization"
            ? new r.Chain(r.externalState({ read() { throw hostCause } }), ctx)
            : new r.ContextChain({ api: r.externalState({ source: signal?.promise ?? snapshotSource }) }, ctx, { api: {} })
        const invoke = site === "poison contextualization"
            ? () => r.run(chain, [], "read", [signal?.promise ?? 1], ctx, {})
            : () => r.lookupPath(chain, ["api", "source"], ctx)
        const sibling = r.import(new Promise(() => {}), ctx)
        const siblingOutcome = sibling.then(() => assert.fail("Sibling succeeded"), error => error)
        const cause = new Error(`Internal ${site} defect`)
        let failed
        if (pending) {
            const result = invoke()
            const outcome = result.then(() => assert.fail("Boundary succeeded"), error => error)
            armed = { site, cause }
            signal.resolve(site === "snapshot failure effect" ? snapshotSource : 1)
            failed = await outcome
        } else {
            armed = { site, cause }
            try { invoke() }
            catch (error) { failed = error }
        }
        assert.equal(armed, undefined, `${site}: injection was unused`)
        assert(r.isFatalError(failed), `${site}, pending=${pending}`)
        assert.equal(failed.cause, cause)
        assert.equal(failed.errorContext, source)
        assert.equal(ctx.execution.fatalError, failed)
        assert.equal(await siblingOutcome, failed)
        assert.deepEqual(reports, [failed])
    }
}

for (const [api, site] of [
    ["managedState", "classification"],
    ["managedState", "plain prototype"],
    ["managedState", "declaration traversal"],
    ["managedState", "prototype validation"],
    ["managedState", "identity registration"],
    ["externalState", "identity registration"],
    ["managedStateClass", "prototype validation"],
    ["managedStateClass", "plain prototype"],
    ["managedStateClass", "class registration"],
]) {
    class Candidate { constructor() { this.value = 1 } }
    const instance = new Candidate()
    const input = api === "managedStateClass" ? Candidate : instance
    const cause = new Error(`Internal ${api} ${site} defect`)
    armed = { site, cause }
    assert.throws(() => r[api](input), error => error === cause, `${api}: ${site}`)
    assert.equal(armed, undefined, `${api}: injection was unused`)
    const ctx = { execution: new r.Execution(), errorContext: "after failed declaration" }
    r.import(instance, ctx)
    assert.equal(metadata.metaOf(instance, ctx).type, metadata.TYPE.External)
    assert.equal(metadata.identityDeclarationOf(instance), undefined)
    assert.equal(ctx.execution.fatalError, null)
}
