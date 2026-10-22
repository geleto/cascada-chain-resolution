import { historyCases, historyKey, runBoundaryHistory } from "./fixtures/boundary-histories.js"

// Exercise re-entry while cached method-result properties remain pending.
describe("pending cached boundary histories", () => {
    for (const spec of historyCases(Number(process.env.CASCADA_SEQUENCE_SEEDS ?? 4), true))
        it(`preserves cached graph history ${historyKey(spec)}`, async () => {
            await runBoundaryHistory(spec)
        })
})
