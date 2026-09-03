import {
    Chain,
    Execution,
    expect,
    metaOf,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    lookupPath,
    readPath,
    exportValue,
    importValue,
    setFatalErrorReporter,
    deferred,
    errorCause,
    flushMicrotasks,
} from "./support.js"

describe("Chain root state", () => {
    it("preserves the initial value's ownership and import status", () => {
        const value = { meaning: 42 }
        const chain = new Chain(value)

        expect(chain._state.value).to.be(value)
        expect(metaOf(value).shared).to.be(undefined)
        expect(metaOf(value).imported).to.be(undefined)
    })

    it("uses the supplied execution", () => {
        const execution = new Execution()
        const chain = new Chain({ value: 1 }, execution)
        expect(assignPath(chain, ["value"], 2)).to.be(undefined)
        expect(readPath(chain, ["value"])).to.be(2)
        expect(chain.close).to.be(undefined)
    })

    it("keeps execution state outside the language root", () => {
        const chain = new Chain({})

        expect(Object.keys(chain._state)).to.eql(["value"])
    })

    it("keeps host fields outside the language graph", () => {
        const chain = new Chain({ clean: true })
        chain._hostError = new Error("host error")

        expect(hasError(chain, [])).to.be(false)
        expect(exportValue(chain, [])).to.eql({ clean: true })
        expect(metaOf(chain)).to.be(undefined)
    })

    it("returns reflection failures as language Errors", () => {
        const operations = [
            value => importValue(value, "fatal import"),
            value => lookupPath(new Chain(value), ["key"]),
            value => exportValue(new Chain(value), []),
            value => assignPath(new Chain(value), ["key"], 1),
            value => deletePath(new Chain(value), ["key"]),
        ]

        for (const operation of operations) {
            const failure = new Error("host trap failed")
            const value = new Proxy({}, {
                getOwnPropertyDescriptor() {
                    throw failure
                },
                ownKeys() {
                    throw failure
                },
            })
            let reported
            setFatalErrorReporter(error => {
                reported = error
            })

            expect(errorCause(operation(value))).to.be(failure)
            expect(reported).to.be(undefined)
        }
    })

    it("treats an uninspectable mutation receiver as external", () => {
        const value = new Proxy({}, {
            getPrototypeOf() {
                throw new Error("prototype failed")
            },
        })
        const chain = new Chain(value)

        expect(chain._state.value).to.be(value)
        const outcome = assignPath(chain, ["key"], 1)
        expect(outcome).to.be.a(Error)
        expect(outcome.message).to.be(
            "Cannot access property through missing or primitive value",
        )
        expect(chain._state.value).to.be(outcome)
    })

    it("handles number and string roots across every operation", () => {
        for (const primitive of [7, "text"]) {
            expect(lookupPath(new Chain(primitive), [])).to.be(primitive)
            expect(exportValue(new Chain(primitive), [])).to.be(primitive)
            expect(hasError(new Chain(primitive), [])).to.be(false)
            expect(getErrors(new Chain(primitive), [])).to.eql([])

            const lookupError = lookupPath(new Chain(primitive), ["child"])
            const exportError = exportValue(new Chain(primitive), ["child"])
            const errors = getErrors(new Chain(primitive), ["child"])
            for (const error of [
                lookupError,
                exportError,
                ...errors,
            ]) {
                expect(error instanceof Error).to.be(true)
                expect(error.message).to.be(
                    "Cannot access property through missing or primitive value",
                )
            }
            expect(errors.length).to.be(1)
            expect(hasError(new Chain(primitive), ["child"])).to.be(true)

            const assignedRoot = new Chain(primitive)
            const replacement = { primitive }
            assignPath(assignedRoot, [], replacement)
            expect(assignedRoot._state.value).to.be(replacement)

            const deletedRoot = new Chain(primitive)
            deletePath(deletedRoot, [])
            expect(deletedRoot._state.value).to.be(null)

            const assignedChild = new Chain(primitive)
            assignPath(assignedChild, ["child"], 1)
            expect(assignedChild._state.value instanceof Error).to.be(true)

            const deletedChild = new Chain(primitive)
            deletePath(deletedChild, ["child"])
            expect(deletedChild._state.value instanceof Error).to.be(true)
        }
    })

    it("treats an array root as traversable language data", () => {
        const child = { value: 1 }
        const root = [child]
        const chain = new Chain(root)

        expect(readPath(chain, [])).to.be(root)
        expect(readPath(chain, [0, "value"])).to.be(1)
        expect(hasError(chain, [])).to.be(false)
        expect(getErrors(chain, [])).to.eql([])

        const exported = exportValue(chain, [])
        expect(Array.isArray(exported)).to.be(true)
        expect(exported).to.eql([{ value: 1 }])
        expect(exported).not.to.be(root)
        expect(exported[0]).not.to.be(child)

        assignPath(chain, [0, "value"], 2)
        expect(root[0].value).to.be(2)

        deletePath(chain, [0])
        expect(root.length).to.be(1)
        expect(0 in root).to.be(false)
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

    it("detaches a pending root resolver when the root is replaced", async () => {
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
