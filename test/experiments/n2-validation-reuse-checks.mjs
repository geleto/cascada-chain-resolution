// Design probes for the opt-in loader, not production N2 conformance tests.
// node --import ./test/experiments/n2-validation-reuse.mjs test/experiments/n2-validation-reuse-checks.mjs
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"

const worker = process.argv.find(arg => arg.startsWith("--worker="))
if (!worker) {
    const cases = [
        ...[2, 4, 8, 16, 32].map(size => ({ kind: "frontier", size })),
        ...[2, 4, 8, 16].map(size => ({ kind: "composition", size })),
        ...["first", "second"].map(rejectedBy => ({ kind: "restrictions", rejectedBy })),
        { kind: "replacement" },
        { kind: "publication-fallback" },
    ]
    let failed = 0
    for (const spec of cases) {
        const result = spawnSync(process.execPath, [...process.execArgv,
            "--unhandled-rejections=strict", fileURLToPath(import.meta.url),
            `--worker=${JSON.stringify(spec)}`], { encoding: "utf8", timeout: 5000 })
        if (result.status !== 0) failed++
        console.log(JSON.stringify({ ...spec, exit: result.status,
            error: result.error?.code, output: result.stdout.trim(), stderr: result.stderr.trim() }))
    }
    console.log(JSON.stringify({ passed: cases.length - failed, failed }))
    if (failed) process.exitCode = 1
} else {
    const spec = JSON.parse(worker.slice(9))
    const counts = { segments: 0, copies: 0 }
    globalThis.n2ReuseProbe = {
        segment() { assert(++counts.segments <= 2048, "finite preparation budget exceeded") },
        copy() { counts.copies++ },
    }
    const inputURL = new URL("../../src/input-preparations.js", import.meta.url).href
    const versionsURL = new URL("../../src/property-versions.js", import.meta.url).href
    registerHooks({ load(url, context, next) {
        const result = next(url, context)
        if (url === versionsURL && spec.kind === "publication-fallback") {
            const marker = "    return preparePropertyCommit(owner, key, placement, operationContext, structure, writeBack, storageAbsent => {"
            const source = String(result.source)
            assert.equal(source.split(marker).length, 2)
            return { ...result, source: source.replace(marker,
                "    errorUtils.runExternalAction(operationContext, () => globalThis.n2ReusePublicationFault?.(owner, key, placement))\n" + marker) }
        }
        if (url !== inputURL) return result
        let source = String(result.source)
        for (const [marker, addition] of [
            ["    if (errorUtils.isFatalError(root)) throw root", "    globalThis.n2ReuseProbe.segment()\n"],
            ["        container.target = createEmptyContainer(source, operationContext)", "        globalThis.n2ReuseProbe.copy()\n"],
        ]) {
            assert.equal(source.split(marker).length, 2)
            source = source.replace(marker, addition + marker)
        }
        return { ...result, source }
    } })
    const r = await import("../../src/index.js")
    const { importReadyMethodResult } = await import("../../src/import.js")
    const { metaOf } = await import("../../src/meta.js")
    const ctx = { execution: new r.Execution(), errorContext: "N2 reuse design probe" }
    const root = chain => r.lookupPath(chain, [], ctx)
    const turn = () => new Promise(setImmediate)
    if (spec.kind === "frontier") {
        const pending = Array.from({ length: spec.size }, () => Promise.withResolvers())
        const raw = Object.fromEntries(pending.map((p, i) => [i, p.promise]))
        const original = new r.Chain(r.import(raw, ctx), ctx)
        const result = new r.Chain(r.importMethodResult(raw, ctx), ctx)
        for (const p of pending) { p.resolve(raw); await turn() }
        const output = await r.export(result, [], ctx)
        assert(!r.isPoisonError(output))
        assert.equal(Object.keys(output).length, spec.size)
        assert.equal(root(original), raw)
        assert(counts.copies <= spec.size, "copy growth must follow produced versions, not double")
    } else if (spec.kind === "composition") {
        const pending = Promise.withResolvers(), raw = { p: pending.promise }
        const chains = [new r.Chain(r.import(raw, ctx), ctx)]
        for (let i = 0; i < spec.size; i++)
            chains.push(new r.Chain(r.importMethodResult(root(chains.at(-1)), ctx), ctx))
        pending.resolve(root(chains.at(-1)))
        await turn()
        for (const chain of chains) {
            const output = await r.export(chain, [], ctx)
            assert(!r.isPoisonError(output))
            assert.equal(output.p.p, output.p)
        }
        assert(counts.copies <= spec.size, "composed output must not restart previous validation")
    } else if (spec.kind === "restrictions") {
        const first = r.externalState({}), second = r.externalState({})
        const pending = Promise.withResolvers(), raw = { p: pending.promise }
        const original = new r.Chain(r.import(raw, ctx), ctx)
        const a = new r.Chain(importReadyMethodResult(raw, ctx, undefined, first), ctx)
        const b = new r.Chain(importReadyMethodResult(root(a), ctx, undefined, second), ctx)
        pending.resolve(spec.rejectedBy === "first" ? first : second)
        await turn()
        const av = await r.lookupPath(a, ["p"], ctx), bv = await r.lookupPath(b, ["p"], ctx)
        assert.equal(bv.kind, r.ERROR_KIND.ExternalCapabilityEscape)
        if (spec.rejectedBy === "first") assert.equal(av, bv)
        else assert.equal(av, second)
        assert.equal(root(original), raw)
    } else if (spec.kind === "replacement") {
        const p = Promise.withResolvers(), q = Promise.withResolvers(), next = Promise.withResolvers()
        const resource = r.externalState({})
        const authority = new r.ContextChain({ resource }, ctx, { resource: {} })
        const raw = { p: p.promise, q: q.promise }
        const original = new r.Chain(r.import(raw, ctx), ctx)
        const a = new r.Chain(r.importMethodResult(raw, ctx), ctx)
        const assignment = r.assignPath(a, ["p"], next.promise, ctx)
        q.resolve(root(a))
        p.resolve(1)
        await turn()
        next.resolve(resource)
        await assignment
        await turn()
        assert.equal((await r.lookupPath(a, ["q", "p"], ctx)).kind, r.ERROR_KIND.ExternalCapabilityEscape)
        assert.equal(root(original), raw)
        assert(authority)
        assert.equal(metaOf(root(a), ctx).placementVersions.p.n2ValidationCoverage, undefined)
    } else if (spec.kind === "publication-fallback") {
        const p = Promise.withResolvers(), q = Promise.withResolvers()
        const raw = { p: p.promise, q: q.promise }
        const original = new r.Chain(r.import(raw, ctx), ctx)
        const a = new r.Chain(r.importMethodResult(raw, ctx), ctx)
        p.resolve(raw)
        await turn()
        const first = root(a), second = await r.lookupPath(a, ["p"], ctx)
        assert.notEqual(first, second)
        let failures = 0
        globalThis.n2ReusePublicationFault = (owner, key, placement) => {
            if (owner === first && key === "q" && placement.value === 42) {
                failures++
                throw new Error("Injected destination publication failure")
            }
        }
        q.resolve(42)
        await turn()
        assert.equal(failures, 1)
        assert.equal((await r.lookupPath(a, ["q"], ctx)).kind, r.ERROR_KIND.PropertyMutationFailed)
        assert.equal(await r.lookupPath(a, ["p", "q"], ctx), 42)
        assert.equal(root(original), raw)
    }
    assert.equal(ctx.execution.fatalError, null)
    console.log(JSON.stringify(counts))
}
