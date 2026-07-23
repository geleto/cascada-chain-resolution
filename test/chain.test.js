import {
    Chain,
    expect,
    metaOf,
    assignPath,
    hasError,
    lookupPath,
    exportValue,
    deferred,
    flushMicrotasks,
} from "./support.js"

describe("Chain root state", () => {
    it("keeps host fields outside the language graph", () => {
        const chain = new Chain({ clean: true })
        chain._commands.push(new Error("host error"))

        expect(hasError(chain, [])).to.be(false)
        expect(exportValue(chain, [])).to.eql({ clean: true })
        expect(metaOf(chain)).to.be(undefined)
    })

    it("orders root promise operations through the state holder", async () => {
        const pendingRoot = deferred()
        const chain = new Chain(pendingRoot.promise)
        const root = { branch: { x: 1 } }

        const read = lookupPath(chain, ["branch"])
        assignPath(chain, ["branch", "x"], 2)

        pendingRoot.resolve(root)
        const oldBranch = await read
        await flushMicrotasks()

        expect(oldBranch).to.eql({ x: 1 })
        expect(chain._state.value).to.be(root)
        expect(chain._state.value.branch).to.eql({ x: 2 })
        expect(chain._state.value.branch).not.to.be(oldBranch)
    })

    it("revokes pending root writeback when the root is replaced", async () => {
        const pendingRoot = deferred()
        const chain = new Chain(pendingRoot.promise)

        assignPath(chain, ["x"], 1)
        assignPath(chain, [], { replacement: true })

        pendingRoot.resolve({})
        await flushMicrotasks()

        expect(chain._state.value).to.eql({ replacement: true })
    })

    it("writes back a promise assigned as the whole root", async () => {
        const pendingRoot = deferred()
        const chain = new Chain({ old: true })

        assignPath(chain, [], pendingRoot.promise)

        expect(chain._state.value).to.be(pendingRoot.promise)
        pendingRoot.resolve({ next: true })
        await flushMicrotasks()

        expect(chain._state.value).to.eql({ next: true })
    })

    it("keeps pending root observations on their issue-time state", async () => {
        const lookupRoot = deferred()
        const lookupChain = new Chain(lookupRoot.promise)
        const read = lookupPath(lookupChain, [])

        lookupRoot.resolve({ observed: true })
        assignPath(lookupChain, [], { replacement: "lookup" })

        expect(await read).to.eql({ observed: true })
        expect(lookupChain._state.value).to.eql({ replacement: "lookup" })

        const exportRoot = deferred()
        const exportChain = new Chain(exportRoot.promise)
        const exported = exportValue(exportChain, [])

        exportRoot.resolve({ exported: true })
        assignPath(exportChain, [], { replacement: "export" })

        expect(await exported).to.eql({ exported: true })
        expect(exportChain._state.value).to.eql({ replacement: "export" })
    })

    it("captures observation paths before a pending root settles", async () => {
        const lookupRoot = deferred()
        const lookupSegments = ["before"]
        const read = lookupPath(new Chain(lookupRoot.promise), lookupSegments)
        lookupSegments[0] = "after"
        lookupRoot.resolve({ before: 1, after: 2 })

        const exportRoot = deferred()
        const exportSegments = ["before"]
        const exported = exportValue(new Chain(exportRoot.promise), exportSegments)
        exportSegments[0] = "after"
        exportRoot.resolve({ before: { selected: true }, after: { selected: false } })

        const errorRoot = deferred()
        const errorSegments = ["before"]
        const foundError = hasError(new Chain(errorRoot.promise), errorSegments)
        errorSegments[0] = "after"
        errorRoot.resolve({ before: new Error("selected"), after: { clean: true } })

        expect(await read).to.be(1)
        expect(await exported).to.eql({ selected: true })
        expect(await foundError).to.be(true)
    })
})
