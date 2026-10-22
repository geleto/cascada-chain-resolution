// Finite graphs must finish preparation even when later deliveries point back
// into earlier results. Each child has a wall-clock limit against microtask loops.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"

const plain = process.argv.includes("--plain")
const worker = process.argv.find(arg => arg.startsWith("--worker="))
if (!worker) {
    let passed = 0
    for (const boundary of ["import", "method-result", "host-call"])
    for (const reference of ["source", "result", "cached-wrapper"])
    for (const delivery of ["ready", "synchronous", "native", "ordered", "chained"]) {
        // A returned reference is available only after reception. Ready controls
        // instead use the host's cached wrapper to construct the cycle.
        if ((delivery === "ready" || delivery === "synchronous") && reference !== "cached-wrapper") continue
        const spec = { boundary, reference, delivery }
        const result = spawnSync(process.execPath, [...process.execArgv, "--unhandled-rejections=strict",
            fileURLToPath(import.meta.url), `--worker=${JSON.stringify(spec)}`, ...(plain ? ["--plain"] : [])],
        { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 })
        assert.equal(result.error, undefined, `${JSON.stringify(spec)}: ${result.error}`)
        assert.equal(result.status, 0, `${JSON.stringify(spec)}\n${result.stdout}${result.stderr}`)
        passed++
    }
    assert.equal(passed, 33)
    console.log(JSON.stringify({ passed, instrumented: !plain }))
} else {
    let segments = 0, loads = 0
    if (!plain) {
        globalThis.preparationSegment = () => assert(++segments <= 128, "Finite graph exceeded its preparation budget")
        const inputPath = fileURLToPath(new URL("../../src/input-preparations.js", import.meta.url)).toLowerCase()
        registerHooks({ load(url, context, next) {
            const result = next(url, context)
            if (!url.startsWith("file:") || fileURLToPath(url).toLowerCase() !== inputPath) return result
            loads++
            const marker = "    if (errorUtils.isFatalError(root)) throw root"
            const source = String(result.source)
            assert.equal(source.split(marker).length, 2, "Preparation instrumentation must match exactly once")
            return { ...result, source: source.replace(marker, "    globalThis.preparationSegment()\n" + marker) }
        } })
    }
    const r = await import("../../src/index.js")
    const { OrderedThenable, ChainedThenable, ready } = await import("../ordered-thenable.js")
    const spec = JSON.parse(worker.slice(9))
    const ctx = { execution: new r.Execution(), errorContext: "preparation back-reference" }
    const pending = spec.delivery === "native" ? Promise.withResolvers()
        : spec.delivery === "ordered" ? new OrderedThenable()
            : spec.delivery === "chained" ? new ChainedThenable() : undefined
    const input = {}, wrapper = { child: input }
    const hostPlacement = input.p = pending?.promise ?? pending ??
        (spec.delivery === "synchronous" ? ready(wrapper) : wrapper)
    const source = new r.Chain(r.import(input, ctx), ctx)
    const returned = spec.reference === "cached-wrapper" ? wrapper : input
    const service = new r.Chain(r.externalState({ get() { return returned } }), ctx)
    const received = spec.boundary === "import" ? r.import(returned, ctx)
        : spec.boundary === "method-result" ? r.importMethodResult(returned, ctx)
            : r.run(service, [], "get", [], ctx, {})
    const result = new r.Chain(received, ctx)
    const target = r.lookupPath(result, spec.reference === "cached-wrapper" ? ["child"] : [], ctx)
    assert.equal(target, input, "Prepared references preserve the captured identity")
    pending?.resolve(spec.reference === "source" ? input : spec.reference === "result" ? target : wrapper)
    await new Promise(setImmediate)
    const output = await r.export(result, [], ctx)
    assert(!r.isPoisonError(output))
    if (spec.reference === "cached-wrapper") assert.equal(output.child.p.child.p, output.child.p)
    else assert.equal(output.p.p, output.p)
    assert.equal(r.lookupPath(source, ["p"], ctx),
        spec.reference === "source" ? input : spec.reference === "result" ? target : wrapper)
    assert.equal(ctx.execution.fatalError, null)
    assert.equal(input.p, hostPlacement)
    assert.equal(wrapper.child, input)
    if (!plain) {
        assert.equal(loads, 1, "Required preparation instrumentation must load")
        assert(segments > 0, "Required preparation instrumentation must execute")
    }
    console.log(JSON.stringify({ ...spec, segments }))
}
