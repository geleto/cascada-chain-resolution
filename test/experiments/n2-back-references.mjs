// Investigation witness, outside the default suite and existing N2 baseline.
// Run: node test/experiments/n2-back-references.mjs
// --plain runs the same public operations without loader instrumentation.
// --limit=256 increases the diagnostic preparation-segment budget.
// --trace includes the bounded event trace for each instrumented case.
// A budget stop or timeout is a failure, never passing conformance coverage.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"

const plain = process.argv.includes("--plain")
const trace = process.argv.includes("--trace")
const limit = Number(process.argv.find(arg => arg.startsWith("--limit="))?.slice(8) ?? 128)
const worker = process.argv.find(arg => arg.startsWith("--worker="))

if (!worker) {
    let passed = 0, failed = 0
    for (const boundary of ["import", "method-result", "host-call"])
    for (const reference of ["source", "copy", "cached-copy"])
    for (const delivery of ["ready", "synchronous", "native", "ordered", "chained"]) {
        // A validation copy exists only after reception. Ready controls use the
        // cached host wrapper, which never needs direct access to that copy.
        if ((delivery === "ready" || delivery === "synchronous") && reference !== "cached-copy") continue
        const spec = { boundary, reference, delivery }
        const result = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict",
            fileURLToPath(import.meta.url), `--worker=${JSON.stringify(spec)}`,
            `--limit=${limit}`, ...(plain ? ["--plain"] : [])],
        { encoding: "utf8", timeout: plain ? 1500 : 5000, maxBuffer: 1024 * 1024 })
        if (result.status === 0) passed++
        else failed++
        if (result.stdout.trim()) {
            const report = JSON.parse(result.stdout)
            if (!trace) delete report.events
            console.log(JSON.stringify(report))
        }
        if (result.error || result.stderr || !result.stdout.trim())
            console.log(JSON.stringify({ ...spec, status: "failed", exit: result.status,
                error: result.error?.code, stderr: result.stderr.trim() }))
    }
    console.log(JSON.stringify({ passed, failed, instrumented: !plain, limit: plain ? undefined : limit }))
    if (failed) process.exitCode = 1
} else {
    const spec = JSON.parse(worker.slice(9))
    const counts = { segments: 0, copies: 0, deliveries: 0 }
    const events = [], ids = new WeakMap(), versions = new WeakMap()
    let nextIdentity = 0
    const id = value => value !== null && (typeof value === "object" || typeof value === "function")
        ? ids.get(value) ?? (ids.set(value, ++nextIdentity), nextIdentity) : value
    const event = data => { if (events.length < 32) events.push(data) }
    const report = status => ({ ...spec, status, counts, events })
    if (!plain) {
        globalThis.n2BackReferenceProbe = {
            segment(root, methodResult) {
                if (++counts.segments > limit) {
                    writeFileSync(1, `${JSON.stringify(report("segment-budget-exceeded"))}\n`)
                    process.exit(75)
                }
                event({ kind: "segment", segment: counts.segments, root: id(root), methodResult: !!methodResult })
                return counts.segments
            },
            copy(segment, source, target) {
                counts.copies++
                event({ kind: "copy", segment, source: id(source), target: id(target) })
            },
            placement(segment, owner, key, version, sourceVersion, borrowed) {
                versions.set(version, { segment, owner: id(owner), key })
                if (sourceVersion && borrowed) event({ kind: "borrow", segment, owner: id(owner), key,
                    from: versions.get(sourceVersion) })
            },
            delivery(segment, owner, key, value) {
                counts.deliveries++
                event({ kind: "delivery", segment, owner: id(owner), key, value: id(value) })
            },
            published(segment, owner, key, value) {
                event({ kind: "published", segment, owner: id(owner), key, value: id(value) })
            },
        }
        const inputURL = new URL("../../src/input-preparations.js", import.meta.url).href
        registerHooks({ load(url, context, next) {
            const result = next(url, context)
            if (url !== inputURL) return result
            let source = String(result.source)
            for (const [marker, replacement] of [
                ["    if (errorUtils.isFatalError(root)) throw root",
                    "    const probeSegment = globalThis.n2BackReferenceProbe.segment(root, policy.methodResult)\n    if (errorUtils.isFatalError(root)) throw root"],
                ["        container.target = createEmptyContainer(source, operationContext)",
                    "        container.target = createEmptyContainer(source, operationContext)\n        globalThis.n2BackReferenceProbe.copy(probeSegment, source, container.target)"],
                ["                const staged = { version, original: child, placement }",
                    "                globalThis.n2BackReferenceProbe.placement(probeSegment, value, key, version, sourceVersion, borrowed)\n                const staged = { version, original: child, placement }"],
                ["                            const prepared = prepareInput(validated, operationContext, policy)",
                    "                            globalThis.n2BackReferenceProbe.delivery(probeSegment, container.owner, key, validated)\n                            const prepared = prepareInput(validated, operationContext, policy)"],
                ["                                operationContext, !metadata.isImported(container.owner, operationContext))",
                    "                                operationContext, !metadata.isImported(container.owner, operationContext))\n                            globalThis.n2BackReferenceProbe.published(probeSegment, container.owner, key, version.value)"],
            ]) {
                assert.equal(source.split(marker).length, 2, "N2 instrumentation marker must occur once")
                source = source.replace(marker, replacement)
            }
            return { ...result, source }
        } })
    }
    const r = await import("../../src/index.js")
    const { OrderedThenable, ChainedThenable, ready } = await import("../ordered-thenable.js")
    const ctx = { execution: new r.Execution(), errorContext: "N2 back-reference investigation" }
    const pending = spec.delivery === "native" ? Promise.withResolvers()
        : spec.delivery === "ordered" ? new OrderedThenable()
            : spec.delivery === "chained" ? new ChainedThenable() : undefined
    const input = {}
    const wrapper = { child: input }
    const hostPlacement = input.p = pending?.promise ?? pending ??
        (spec.delivery === "synchronous" ? ready(wrapper) : wrapper)
    const source = new r.Chain(r.import(input, ctx), ctx)
    const returned = spec.reference === "cached-copy" ? wrapper : input
    const service = new r.Chain(r.externalState({ get() { return returned } }), ctx)
    const received = spec.boundary === "import" ? r.import(returned, ctx)
        : spec.boundary === "method-result" ? r.importMethodResult(returned, ctx)
            : r.run(service, [], "get", [], ctx, {})
    const result = new r.Chain(received, ctx)
    const target = r.lookupPath(result, spec.reference === "cached-copy" ? ["child"] : [], ctx)
    if (pending && spec.boundary !== "import") assert.notEqual(target, input)
    pending?.resolve(spec.reference === "source" ? input : spec.reference === "copy" ? target : wrapper)
    await new Promise(setImmediate)
    const output = await r.export(result, [], ctx)
    assert(!r.isPoisonError(output))
    if (spec.reference === "cached-copy") assert.equal(output.child.p.child.p, output.child.p)
    else assert.equal(output.p.p, output.p)
    assert.equal(r.lookupPath(source, ["p"], ctx),
        spec.reference === "source" ? input : spec.reference === "copy" ? target : wrapper)
    assert.equal(ctx.execution.fatalError, null)
    assert.equal(input.p, hostPlacement)
    assert.equal(wrapper.child, input)
    // Check finite data progress only. Source/copy identity remains the separate
    // strict N2 requirement; this probe does not relax those existing witnesses.
    writeFileSync(1, `${JSON.stringify(report("completed"))}\n`)
}
