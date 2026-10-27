// Adversarial release order: many mutations share the same earlier read set.
// Removing pairwise storage must not merely move its cost into repeated waits.
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import * as r from "../../src/index.js"

const withoutSharing = process.argv.includes("--without-sharing")
const candidate = new URL("./phase6-reservations.mjs", import.meta.url).href
let faultApplied = false
if (withoutSharing) registerHooks({ load(url, context, next) {
    const loaded = next(url, context)
    if (url.toLowerCase() !== candidate.toLowerCase()) return loaded
    const source = String(loaded.source)
    const anchor = "const cached = waits?.get(limit)"
    assert.equal(source.split(anchor).length - 1, 1, "shared-wait fault anchor")
    faultApplied = true
    return { ...loaded, source: source.replace(anchor, "const cached = undefined") }
} })
const { ReservationKernel } = await import(candidate)
assert.equal(faultApplied, withoutSharing)

const samples = []
// Size 256 already separates the broken mechanism from the bound. Keep the
// fault control short; the healthy candidate also exercises the larger scale.
const sizes = withoutSharing ? [16, 64, 256] : [16, 64, 256, 1024]
for (const scenario of ["same-cutoff", "spent-tail", "pending-tail"]) for (const size of sizes) {
    const ctx = { execution: new r.Execution(), errorContext: {} }
    const chain = new r.ContextChain({ api: r.externalState({}) }, ctx, { api: {} })
    const kernel = new ReservationKernel(chain._externalMutationTree, ctx)
    const reads = Array.from({ length: size }, () => kernel.selection(kernel.root, false))
    const delayed = []
    for (const read of reads) read.select(kernel.root.api)
    for (let index = 0; index < size; index++) {
        if (scenario !== "same-cutoff") {
            const unused = kernel.selection(kernel.root, false)
            if (scenario === "pending-tail") delayed.push(unused)
            else unused.select(undefined)
        }
        const write = kernel.selection(kernel.root, true)
        write.select(kernel.root.api)
        write.complete()
    }
    const pending = kernel.pending()
    for (let index = delayed.length - 1; index >= 0; index--) delayed[index].select(undefined)
    await new Promise(setImmediate)
    const peakWaits = kernel.counts.peakWaits
    const before = kernel.counts.indexSteps
    for (let index = size - 1; index >= 0; index--) {
        reads[index].complete()
        await new Promise(setImmediate)
    }
    await pending
    assert.equal(kernel.pending(), undefined)
    assert.equal(kernel.counts.liveWaits, 0)
    assert(peakWaits <= size * 3, "shared wait storage must stay linear")
    const steps = kernel.counts.indexSteps - before
    samples.push({ scenario, size, steps, peakWaits, sharedHits: kernel.counts.sharedHits, bound: size * Math.log2(size) * 64 })
}
console.log(JSON.stringify({ faultApplied, samples }))
assert(samples.every(({ steps, bound }) => steps < bound),
    "identical captured read dependencies must not be re-walked by every mutation")
