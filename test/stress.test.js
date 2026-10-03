import {
    Chain,
    assignPath,
    deletePath,
    hasError,
    lookupPath,
    export as exportValue,
    import as importValue,
    Execution,
} from "../src/index.js"
import { buildRefIndex, getRefCounter } from "../src/refcounts.js"
import { verifyRefCounts } from "./verify-refcounts.js"
import { expect, readPath, deferred, flushMicrotasks, expectCounts } from "./support.js"

describe("bounded stress", () => {
    it("indexes, probes, settles, and copies a deep branch", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const depth = 256
        const pending = deferred()
        let root = { pending: pending.promise }
        for (let i = 0; i < depth; i++) {
            root = { next: root }
        }
        importValue(root, { ...testContext, errorContext: "deep import" })
        const chain = new Chain(root, testContext)

        const foundError = hasError(chain, [], testContext)
        const exported = exportValue(chain, [], testContext)

        pending.resolve("done")

        expect(await foundError).to.be(false)
        const copy = await exported
        expect(copy).not.to.be(root)

        let sourceNode = root
        let copiedNode = copy
        for (let i = 0; i < depth; i++) {
            expect(copiedNode).not.to.be(sourceNode)
            sourceNode = sourceNode.next
            copiedNode = copiedNode.next
        }
        expect(sourceNode.pending).to.be(pending.promise)
        expect(readPath(chain, [
            ...Array.from({ length: depth }, () => "next"),
            "pending",
        ], testContext)).to.be("done")
        expect(copiedNode.pending).to.be("done")
        verifyRefCounts(testContext, root)
    })

    it("propagates through a wide aliased fanout", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const width = 128
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = {}
        for (let i = 0; i < width; i++) {
            root[`key${i}`] = child
        }
        const chain = new Chain(root, testContext)

        buildRefIndex(root, testContext)
        expectCounts(testContext, root, width, 0)
        expect(getRefCounter(child, testContext).parents.get(root)).to.be(width)

        for (let i = 0; i < width; i += 2) {
            deletePath(chain, [`key${i}`], testContext)
        }
        expectCounts(testContext, root, width / 2, 0)
        expect(getRefCounter(child, testContext).parents.get(root)).to.be(width / 2)
        verifyRefCounts(testContext, root)

        pending.resolve("done")
        await flushMicrotasks()

        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("propagates local presence through stacked diamonds", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const layers = 22
        const pending = deferred()
        let root = { pending: pending.promise }
        for (let i = 0; i < layers; i++) {
            root = {
                left: { child: root },
                right: { child: root },
            }
        }

        new Chain(root, testContext)
        buildRefIndex(root, testContext)
        expectCounts(testContext, root, 2, 0)

        pending.reject("bad")
        await flushMicrotasks()

        expectCounts(testContext, root, 0, 2)
        verifyRefCounts(testContext, root)
    })

    it("settles a long recursively exposed promise chain", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const depth = 48
        const pending = Array.from({ length: depth }, () => deferred())
        const root = { value: pending[0].promise }
        const chain = new Chain(root, testContext)

        const foundError = hasError(chain, [], testContext)
        const exported = exportValue(chain, [], testContext)

        for (let i = 0; i < depth - 1; i++) {
            pending[i].resolve({ next: pending[i + 1].promise })
        }
        pending[depth - 1].resolve({ done: true })

        expect(await foundError).to.be(false)
        const exportedValue = await exported
        expect(exportedValue).not.to.be(root)

        let node = exportedValue.value
        for (let i = 0; i < depth - 1; i++) {
            node = node.next
        }
        expect(node).to.eql({ done: true })
        expectCounts(testContext, root, 0, 0)
        verifyRefCounts(testContext, root)
    })

    it("copy-on-writes a deep imported mutation path", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const depth = 128
        const path = []
        let leaf = { value: 0 }
        for (let i = 0; i < depth; i++) {
            leaf = { next: leaf }
            path.push("next")
        }
        const root = importValue(leaf, { ...testContext, errorContext: "deep COW import" })
        const chain = new Chain(root, testContext)

        assignPath(chain, [...path, "value"], 1, testContext)
        const copy = chain._state.value

        let sourceNode = root
        let copiedNode = copy
        for (let i = 0; i < depth; i++) {
            expect(copiedNode).not.to.be(sourceNode)
            sourceNode = sourceNode.next
            copiedNode = copiedNode.next
        }
        expect(sourceNode.value).to.be(0)
        expect(copiedNode.value).to.be(1)
    })
})
