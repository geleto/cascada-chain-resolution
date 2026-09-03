import {
    Chain,
    ContextChain,
    Execution,
    assignPath,
    deferred,
    enter,
    errorCause,
    expect,
    externalState,
    flushMicrotasks,
    importValue,
    lookupPath,
    metaOf,
    readPath,
    run,
} from "./support.js"
function external(value = {}) {
    expect(externalState(value)).to.be(value)
    return value
}

describe("context external foundations", () => {
    it("imports context data and discovers only supplied mutation paths", () => {
        const execution = new Execution()
        const selected = external({ name: "selected" })
        const ignored = external({ name: "ignored" })
        const root = {
            apis: { selected, ignored },
            other: external(),
        }
        const chain = new ContextChain(
            root,
            "context root",
            execution,
            [["apis", "selected"]],
        )

        expect(chain instanceof Chain).to.be(true)
        expect(readPath(chain, [])).to.be(root)
        expect(chain._externalMutationTree.findExactBoundary(["apis", "selected"])
            .identity)
            .to.be(selected)
        expect(chain._externalMutationTree.findBoundary([
            "apis",
            "selected",
            "name",
        ]).identity)
            .to.be(selected)
        expect(chain._externalMutationTree.findBoundary(["apis", "ignored"]))
            .to.be(undefined)
        expect(chain._externalMutationTree.findBoundary(["other"]))
            .to.be(undefined)
        expect(execution._externalIdentities.get(selected)).to.be.an(Object)
        expect(execution._externalIdentities.get(ignored)).to.be(undefined)
    })

    it("distinguishes scope paths from property target paths", () => {
        const oldTarget = external({ value: 1 })
        const nestedTarget = external({ value: 2 })
        const root = { oldTarget, nested: { target: nestedTarget } }
        const chain = new ContextChain(
            root,
            "property paths",
            new Execution(),
            [],
            [
                ["oldTarget"],
                ["nested", "target", "value"],
                [],
            ],
        )

        expect(chain._externalMutationTree.findBoundary(["oldTarget"]))
            .to.be(undefined)
        expect(chain._externalMutationTree.findExactBoundary([
            "nested",
            "target",
        ])
            .identity)
            .to.be(nestedTarget)

        const externalRoot = external({ status: 1 })
        const rootChain = new ContextChain(
            externalRoot,
            "external root",
            new Execution(),
            [],
            [["status"]],
        )
        expect(rootChain._externalMutationTree.findExactBoundary([]).identity)
            .to.be(externalRoot)
    })

    it("does not index an external root replaced by an empty property path", () => {
        const root = external()
        const execution = new Execution()
        const chain = new ContextChain(
            root,
            "root replacement",
            execution,
            [],
            [[]],
        )

        expect(chain._externalMutationTree).to.be(undefined)
        expect(execution._externalIdentities.get(root)).to.be(undefined)
    })

    it("merges overlaps while preserving finite alias paths", () => {
        const service = external()
        const root = { left: service, right: service }
        root.self = root
        const chain = new ContextChain(
            root,
            "aliases",
            new Execution(),
            [[], ["left"], ["left"]],
        )

        const boundaryPaths = chain._externalMutationTree
            .findDescendantBoundaries([])
            .map(boundary => boundary.path.join("."))
            .sort()
        expect(boundaryPaths).to.eql(["left", "right"])
        const left = chain._externalMutationTree.findExactBoundary(["left"])
        const right = chain._externalMutationTree.findExactBoundary(["right"])
        expect(left.entry).to.be(right.entry)
        expect(left.location).not.to.be(right.location)
        expect(Object.isFrozen(left)).to.be(true)
        expect(Object.isFrozen(left.path)).to.be(true)
    })

    it("treats numeric and string property paths alike", () => {
        const service = external()
        const chain = new ContextChain(
            { values: [service] },
            "numeric path",
            new Execution(),
            [["values", 0]],
        )

        expect(chain._externalMutationTree.findExactBoundary(["values", "0"])
            .identity)
            .to.be(service)
        expect(chain._externalMutationTree.findExactBoundary(["values", 0])
            .identity)
            .to.be(service)
    })

    it("does not discover Promise branches or later graph changes", async () => {
        const pending = deferred()
        const late = external()
        const chain = new ContextChain(
            { pending: pending.promise, current: {} },
            "static tree",
            new Execution(),
            [[], ["pending"]],
        )

        expect(chain._externalMutationTree).to.be(undefined)
        pending.resolve(late)
        await flushMicrotasks()
        assignPath(chain, ["current", "late"], late)

        expect(chain._externalMutationTree).to.be(undefined)
    })

    it("discovers through already admitted managed data", () => {
        const service = external()
        const root = importValue({ nested: { service } }, "first import")
        const chain = new ContextChain(
            root,
            "context import",
            new Execution(),
            [["nested"]],
        )

        expect(chain._externalMutationTree.findExactBoundary([
            "nested",
            "service",
        ]).identity)
            .to.be(service)
    })

    it("commits neither tree nor execution entries after import failure", () => {
        const execution = new Execution()
        const service = external()
        const broken = new Proxy({}, {
            ownKeys() {
                throw new Error("cannot inspect context")
            },
        })
        const chain = new ContextChain(
            { service, broken },
            "broken context",
            execution,
            [[]],
        )

        expect(readPath(chain, [])).to.be.an(Error)
        expect(chain._externalMutationTree).to.be(undefined)
        expect(execution._externalIdentities.get(service)).to.be(undefined)
    })

    it("rolls back import when the tree-discovery pass fails", () => {
        const execution = new Execution()
        const service = external()
        const failure = new Error("cannot discover context tree")
        let keyReads = 0
        const root = new Proxy({ service }, {
            ownKeys(target) {
                keyReads++
                if (keyReads === 2) throw failure
                return Reflect.ownKeys(target)
            },
        })
        const chain = new ContextChain(
            root,
            "tree discovery",
            execution,
            [[]],
        )

        expect(errorCause(readPath(chain, []))).to.be(failure)
        expect(chain._externalMutationTree).to.be(undefined)
        expect(execution._externalIdentities.get(service)).to.be(undefined)
        expect(metaOf(root)).to.be(undefined)
        expect(metaOf(service)).to.be(undefined)
    })

    it("shares entries within one execution but not between executions", () => {
        const service = external()
        const execution = new Execution()
        const first = new ContextChain(
            { service },
            "first",
            execution,
            [["service"]],
        )
        const second = new ContextChain(
            { service },
            "second",
            execution,
            [["service"]],
        )
        const isolated = new ContextChain(
            { service },
            "isolated",
            new Execution(),
            [["service"]],
        )

        const firstBoundary = first._externalMutationTree
            .findExactBoundary(["service"])
        const secondBoundary = second._externalMutationTree
            .findExactBoundary(["service"])
        const isolatedBoundary = isolated._externalMutationTree
            .findExactBoundary(["service"])
        expect(firstBoundary.entry).to.be(secondBoundary.entry)
        expect(firstBoundary.entry).not.to.be(isolatedBoundary.entry)
        expect(firstBoundary.location).not.to.be(secondBoundary.location)
        expect(firstBoundary.location).not.to.be(isolatedBoundary.location)
    })

    it("gives nested contextual entries their mutation-tree branches", () => {
        const service = external()
        const execution = new Execution()
        const chain = new ContextChain(
            { apis: { group: { service } } },
            "entered context",
            execution,
            [["apis"]],
        )
        const rootLocation = chain._externalMutationTree.findExactBoundary([
            "apis",
            "group",
            "service",
        ]).location
        let boundary
        let enteredExecution

        enter(chain, ["apis"], false, entered => {
            expect(entered instanceof ContextChain).to.be(false)
            const enteredBoundary = entered._externalMutationTree
                .findExactBoundary([
                "group",
                "service",
            ])
            expect(enteredBoundary.identity).to.be(service)
            expect(enteredBoundary.location).to.be(rootLocation)
            enter(entered, ["group"], false, nested => {
                expect(nested instanceof ContextChain).to.be(false)
                boundary = nested._externalMutationTree
                    .findExactBoundary(["service"])
                enteredExecution = nested._execution
            })
        })

        expect(boundary.identity).to.be(service)
        expect(boundary.location).to.be(rootLocation)
        expect(enteredExecution).to.be(execution)
    })

    it("anchors mutating entries to the original external location", async () => {
        const service = external()
        const chain = new ContextChain(
            { apis: { service, value: 1 } },
            "mutating entered context",
            new Execution(),
            [["apis"]],
        )
        const rootBoundary = chain._externalMutationTree
            .findExactBoundary(["apis", "service"])
        let enteredBoundary

        enter(chain, ["apis"], true, entered => {
            enteredBoundary = entered._externalMutationTree
                .findExactBoundary(["service"])
            assignPath(entered, ["value"], 2)
        })

        expect(enteredBoundary.location).to.be(rootBoundary.location)
        expect(enteredBoundary.path).to.be(rootBoundary.path)
        expect(await readPath(chain, ["apis", "value"])).to.be(2)
    })

    it("clamps tree branches and descendant queries below a boundary", () => {
        const service = external({ client: { name: "primary" } })
        const chain = new ContextChain(
            { apis: { service } },
            "external suffix",
            new Execution(),
            [["apis", "service"]],
        )
        const rootBoundary = chain._externalMutationTree
            .findExactBoundary(["apis", "service"])
        const enteredTree = chain._externalMutationTree.findBranch([
            "apis",
            "service",
            "client",
        ])
        const enteredBoundary = enteredTree.findBoundary([])

        const descendants = chain._externalMutationTree.findDescendantBoundaries([
            "apis",
            "service",
            "client",
        ])
        expect(enteredBoundary.location).to.be(rootBoundary.location)
        expect(descendants).to.eql([rootBoundary])
    })

    it("does not discover external state hidden behind Functions or Errors", () => {
        const hiddenByFunction = external()
        const hiddenByError = external()
        const visible = external()
        const callable = () => {}
        callable.service = hiddenByFunction
        const failure = new Error("hidden")
        failure.service = hiddenByError

        const chain = new ContextChain(
            { callable, failure, visible },
            "terminal context values",
            new Execution(),
            [[]],
        )
        const boundaries = chain._externalMutationTree.findDescendantBoundaries([])

        expect(boundaries.map(boundary => boundary.identity)).to.eql([
            visible,
        ])
    })

    it("keeps the dormant tree stable through managed COW and Array remapping", () => {
        const firstService = external()
        const objectChain = new ContextChain(
            { branch: { firstService, value: 1 } },
            "managed COW",
            new Execution(),
            [["branch"]],
        )
        const objectBoundary = objectChain._externalMutationTree
            .findExactBoundary(["branch", "firstService"])
        const retainedBranch = lookupPath(objectChain, ["branch"])

        assignPath(objectChain, ["branch", "value"], 2)

        expect(readPath(objectChain, ["branch", "value"])).to.be(2)
        expect(retainedBranch.value).to.be(1)
        expect(objectChain._externalMutationTree.findExactBoundary([
            "branch",
            "firstService",
        ])).to.be(objectBoundary)

        const secondService = external()
        const arrayChain = new ContextChain(
            { values: [secondService] },
            "Array remap",
            new Execution(),
            [["values"]],
        )
        const arrayBoundary = arrayChain._externalMutationTree
            .findExactBoundary(["values", "0"])

        run(
            arrayChain,
            ["values"],
            "push",
            [1],
            { mutationScopeDepth: 1 },
        )

        expect(arrayChain._externalMutationTree.findExactBoundary([
            "values",
            "0",
        ])).to.be(arrayBoundary)
    })

    it("keeps ordinary import and Chain construction authority-free", () => {
        const service = external()
        const imported = importValue({ service })
        const ordinary = new Chain(imported)
        const context = new ContextChain(
            { service },
            "empty context",
        )

        expect(ordinary._externalMutationTree).to.be(undefined)
        expect(context._externalMutationTree).to.be(undefined)

        enter(context, [], false, entered => {
            expect(entered instanceof Chain).to.be(true)
            expect(entered instanceof ContextChain).to.be(false)
            expect(entered._externalMutationTree).to.be(undefined)
        })
    })

    it("validates language path segments when consumed", () => {
        const chain = new Chain({ value: 1, read() { return this.value } })
        const invalidLookup = readPath(chain, [{}])
        expect(invalidLookup).to.be.an(Error)
        expect(invalidLookup.message).to.be(
            "Path segments must be Strings or Numbers",
        )

        let coercions = 0
        const invalid = {
            toString() {
                coercions++
                return "length"
            },
        }
        const stringLookup = readPath(new Chain("value"), [invalid])
        expect(stringLookup).to.be.an(Error)

        const service = external()
        const context = new ContextChain(
            { service },
            "invalid entered path",
            new Execution(),
            [["service"]],
        )
        let entered = false
        const invalidEntry = enter(context, [invalid], false, () => {
            entered = true
        })
        expect(invalidEntry).to.be.an(Error)
        expect(entered).to.be(false)
        expect(coercions).to.be(0)
    })

    it("captures run paths and argument Arrays at issuance", async () => {
        const argument = deferred()
        const chain = new Chain(importValue({
            before: {
                value: 1,
                add(amount) {
                    return this.value + amount
                },
            },
            after: {
                value: 100,
                add(amount) {
                    return this.value + amount
                },
            },
        }))
        const path = ["before"]
        const args = [argument.promise]
        const result = run(chain, path, "add", args, {})

        path[0] = "after"
        args[0] = 50
        argument.resolve(2)

        expect(await result).to.be(3)
    })
})
