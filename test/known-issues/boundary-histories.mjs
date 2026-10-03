import { historyCases, historyKey, runBoundaryHistory } from "../fixtures/boundary-histories.js"

// These are strict additional N2 histories, not passing acceptance tests. Run
// explicitly with Mocha while pending cached method-result identity is deferred.
// They share the same semantic oracle as the passing readiness/import controls.
describe("deferred cached boundary histories", () => {
    for (const spec of historyCases(4, true))
        it(`N2 preserves cached graph history ${historyKey(spec)}`, async () => {
            await runBoundaryHistory(spec)
        })
})
