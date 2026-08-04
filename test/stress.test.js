import {
    Chain,
    expect,
    buildRefIndex,
    getRefCounter,
    verifyRefCounts,
    assignPath,
    deletePath,
    hasError,
    lookupPath,
    exportValue,
    importValue,
    deferred,
    flushMicrotasks,
    expectCounts,
} from "./support.js"

describe("bounded stress", () => {
    it("indexes, probes, settles, and copies a deep branch", async () => {
        const depth = 256
        const pending = deferred()
        let root = { pending: pending.promise }
        for (let i = 0; i < depth; i++) {
            root = { next: root }
        }
        importValue(root, "deep import")
        const chain = new Chain(root)

        const foundError = hasError(chain, [])
        const exported = exportValue(chain, [])

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
        expect(lookupPath(chain, [
            ...Array.from({ length: depth }, () => "next"),
            "pending",
        ], false)).to.be("done")
        expect(copiedNode.pending).to.be("done")
        verifyRefCounts(root)
    })

    it("propagates through a wide aliased fanout", async () => {
        const width = 128
        const pending = deferred()
        const child = { pending: pending.promise }
        const root = {}
        for (let i = 0; i < width; i++) {
            root[`key${i}`] = child
        }
        const chain = new Chain(root)

        buildRefIndex(root)
        expectCounts(root, width, 0)
        expect(getRefCounter(child).parents.get(root)).to.be(width)

        for (let i = 0; i < width; i += 2) {
            deletePath(chain, [`key${i}`])
        }
        expectCounts(root, width / 2, 0)
        expect(getRefCounter(child).parents.get(root)).to.be(width / 2)
        verifyRefCounts(root)

        pending.resolve("done")
        await flushMicrotasks()

        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("settles a long recursively exposed promise chain", async () => {
        const depth = 48
        const pending = Array.from({ length: depth }, () => deferred())
        const root = { value: pending[0].promise }
        const chain = new Chain(root)

        const foundError = hasError(chain, [])
        const exported = exportValue(chain, [])

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
        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("copy-on-writes a deep imported mutation path", () => {
        const depth = 128
        const path = []
        let leaf = { value: 0 }
        for (let i = 0; i < depth; i++) {
            leaf = { next: leaf }
            path.push("next")
        }
        const root = importValue(leaf, "deep COW import")
        const chain = new Chain(root)

        assignPath(chain, [...path, "value"], 1)
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
