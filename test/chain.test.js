const {
    Chain,
    expect,
    metaOf,
    assignPath,
    hasError,
    lookupPath,
    normalize,
    deferred,
    flushMicrotasks,
} = require("./support")

describe("Chain root state", () => {
    it("keeps host fields outside the language graph", () => {
        const chain = new Chain({ clean: true })
        chain._commands.push(new Error("host error"))

        expect(hasError(chain, [])).to.be(false)
        expect(normalize(chain, [])).to.eql({ clean: true })
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
})
