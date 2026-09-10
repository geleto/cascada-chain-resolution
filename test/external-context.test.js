import * as externalTree from "../src/external-mutation-tree.js"
import { EXTERNAL_BOUNDARY } from "../src/external-mutation-tree.js"
import assert from "node:assert/strict"
import * as runtime from "cascada-chain-resolution"
import { OrderedThenable } from "./ordered-thenable.js"
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
            { apis: { selected: {} } },
        )

        expect(chain instanceof Chain).to.be(true)
        expect(readPath(chain, [])).to.be(root)
        expect(externalTree.findExactBoundary(chain._externalMutationTree, ["apis", "selected"])
            [EXTERNAL_BOUNDARY])
            .to.be(chain._execution._externalIdentities.get(selected))
        expect(externalTree.findBoundary(chain._externalMutationTree, [
            "apis",
            "selected",
            "name",
        ])[EXTERNAL_BOUNDARY])
            .to.be(chain._execution._externalIdentities.get(selected))
        expect(externalTree.findBoundary(chain._externalMutationTree, ["apis", "ignored"]))
            .to.be(undefined)
        expect(externalTree.findBoundary(chain._externalMutationTree, ["other"]))
            .to.be(undefined)
        expect(execution._externalIdentities.get(selected)).to.be.an(Object)
        expect(execution._externalIdentities.get(ignored)).to.be(undefined)
    })

    it("uses containing routes for property writes, without selecting the old final target", () => {
        const oldTarget = external({ value: 1 })
        const nestedTarget = external({ value: 2 })
        const root = { oldTarget, nested: { target: nestedTarget } }
        const chain = new ContextChain(
            root,
            "property paths",
            new Execution(),
            { nested: { target: {} } },
        )

        expect(externalTree.findBoundary(chain._externalMutationTree, ["oldTarget"]))
            .to.be(undefined)
        expect(externalTree.findExactBoundary(chain._externalMutationTree, [
            "nested",
            "target",
        ])
            [EXTERNAL_BOUNDARY])
            .to.be(chain._execution._externalIdentities.get(nestedTarget))

        const externalRoot = external({ status: 1 })
        const rootChain = new ContextChain(
            externalRoot,
            "external root",
            new Execution(),
            {},
        )
        expect(externalTree.findExactBoundary(rootChain._externalMutationTree, [])[EXTERNAL_BOUNDARY])
            .to.be(rootChain._execution._externalIdentities.get(externalRoot))
    })

    it("does not index an external root replaced by an empty property path", () => {
        const root = external()
        const execution = new Execution()
        const chain = new ContextChain(
            root,
            "root replacement",
            execution,
            undefined,
        )

        expect(chain._externalMutationTree).to.be(undefined)
        expect(execution._externalIdentities.get(root)).to.be(undefined)
    })

    it("keeps one boundary for merged prefixes and native suffixes", () => {
        const service = external()
        const root = { left: service }
        root.self = root
        const chain = new ContextChain(
            root,
            "aliases",
            new Execution(),
            { left: { child: {}, other: {} } },
        )

        const boundaryPaths = externalTree.findDescendantBoundaries(chain._externalMutationTree, [])
            .map(boundary => boundary.path.join("."))
            .sort()
        expect(boundaryPaths).to.eql(["left"])
        const left = externalTree.findExactBoundary(chain._externalMutationTree, ["left"])
        expect(left[EXTERNAL_BOUNDARY].binding).to.be(left)
        expect(Object.isFrozen(left)).to.be(true)
        expect(Object.isFrozen(left.path)).to.be(true)
    })

    it("treats numeric and string property paths alike", () => {
        const service = external()
        const chain = new ContextChain(
            { values: [service] },
            "numeric path",
            new Execution(),
            { values: { 0: {} } },
        )

        expect(externalTree.findExactBoundary(chain._externalMutationTree, ["values", "0"])
            [EXTERNAL_BOUNDARY])
            .to.be(chain._execution._externalIdentities.get(service))
        expect(externalTree.findExactBoundary(chain._externalMutationTree, ["values", 0])
            [EXTERNAL_BOUNDARY])
            .to.be(chain._execution._externalIdentities.get(service))
    })

    it("does not discover Promise branches or later graph changes", async () => {
        const pending = deferred()
        const late = external()
        const chain = new ContextChain(
            { pending: pending.promise, current: {} },
            "static tree",
            new Execution(),
            { pending: {}, current: {} },
        )

        expect(chain._externalMutationTree).to.be(undefined)
        pending.resolve(late)
        await flushMicrotasks()
        assignPath(chain, ["current", "late"], late)

        expect(chain._externalMutationTree).to.be(undefined)
    })

    it("discovers through already admitted managed data", () => {
        const execution = new Execution()
        const service = external()
        const root = runtime.import({ nested: { service } }, { execution, errorContext: "first import" })
        const chain = new ContextChain(
            root,
            "context import",
            execution,
            { nested: { service: {} } },
        )

        expect(externalTree.findExactBoundary(chain._externalMutationTree, [
            "nested",
            "service",
        ])[EXTERNAL_BOUNDARY])
            .to.be(chain._execution._externalIdentities.get(service))
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
            { service: {} },
        )

        expect(readPath(chain, [])).to.be.an(Error)
        expect(chain._externalMutationTree).to.be(undefined)
        expect(execution._externalIdentities.get(service)).to.be(undefined)
    })

    it("rolls back discovery reflection failure without invalidating a prior binding", () => {
        const execution = new Execution()
        const existing = external()
        const original = new ContextChain({ existing }, "original context", execution, { existing: {} })
        const existingEntry = execution._externalIdentities.get(existing)
        const originalBinding = externalTree.findExactBoundary(original._externalMutationTree, ["existing"])
        const service = external()
        const failure = new Error("cannot discover context tree")
        let placementReads = 0
        const root = new Proxy({ existing, service }, {
            getOwnPropertyDescriptor(target, key) {
                if (key === "service" && ++placementReads === 2) throw failure
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const chain = new ContextChain(
            root,
            "tree discovery",
            execution,
            { existing: {}, service: {} },
        )

        const result = readPath(chain, [])
        expect(errorCause(result)).to.be(failure)
        expect(result.kind).to.be(runtime.ERROR_KIND.ImportReflectionFailed)
        expect(result.errorContext).to.be("tree discovery")
        expect(chain._externalMutationTree).to.be(undefined)
        expect(execution._externalIdentities.get(service)).to.be(undefined)
        expect(execution._metadata.has(root)).to.be(false)
        expect(execution._metadata.has(service)).to.be(false)
        expect(execution._externalIdentities.get(existing)).to.be(existingEntry)
        expect(existingEntry.binding).to.be(originalBinding)
    })

    it("shares entries within one execution but not between executions", () => {
        const service = external()
        const execution = new Execution()
        const first = new ContextChain(
            { service },
            "first",
            execution,
            { service: {} },
        )
        const second = new ContextChain(
            { service },
            "second",
            execution,
            { service: {} },
        )
        const isolated = new ContextChain(
            { service },
            "isolated",
            new Execution(),
            { service: {} },
        )

        const firstBoundary = externalTree.findExactBoundary(first._externalMutationTree, ["service"])
        const secondBoundary = externalTree.findExactBoundary(second._externalMutationTree, ["service"])
        const isolatedBoundary = externalTree.findExactBoundary(isolated._externalMutationTree, ["service"])
        expect(firstBoundary[EXTERNAL_BOUNDARY]).to.be(secondBoundary[EXTERNAL_BOUNDARY])
        expect(firstBoundary[EXTERNAL_BOUNDARY]).not.to.be(isolatedBoundary[EXTERNAL_BOUNDARY])
        expect(firstBoundary).not.to.be(secondBoundary)
        expect(firstBoundary).not.to.be(isolatedBoundary)
    })

    it("gives nested contextual entries their mutation-tree branches", () => {
        const service = external()
        const execution = new Execution()
        const chain = new ContextChain(
            { apis: { group: { service } } },
            "entered context",
            execution,
            { apis: { group: { service: {} } } },
        )
        const rootLocation = externalTree.findExactBoundary(chain._externalMutationTree, [
            "apis",
            "group",
            "service",
        ])
        let boundary
        let enteredExecution

        enter(chain, ["apis"], false, entered => {
            expect(entered instanceof ContextChain).to.be(false)
            const enteredBoundary = externalTree.findExactBoundary(entered._externalMutationTree, [
                "group",
                "service",
            ])
            expect(enteredBoundary[EXTERNAL_BOUNDARY]).to.be(chain._execution._externalIdentities.get(service))
            expect(enteredBoundary).to.be(rootLocation)
            enter(entered, ["group"], false, nested => {
                expect(nested instanceof ContextChain).to.be(false)
                boundary = externalTree.findExactBoundary(nested._externalMutationTree, ["service"])
                enteredExecution = nested._execution
            })
        })

        expect(boundary[EXTERNAL_BOUNDARY]).to.be(chain._execution._externalIdentities.get(service))
        expect(boundary).to.be(rootLocation)
        expect(boundary.context).to.be(chain)
        expect(boundary.path).to.eql(["apis", "group", "service"])
        expect(enteredExecution).to.be(execution)
    })

    it("anchors mutating entries to the original external location", async () => {
        const service = external()
        const chain = new ContextChain(
            { apis: { service, value: 1 } },
            "mutating entered context",
            new Execution(),
            { apis: { service: {} } },
        )
        const rootBoundary = externalTree.findExactBoundary(chain._externalMutationTree, ["apis", "service"])
        let enteredBoundary

        enter(chain, ["apis"], true, entered => {
            enteredBoundary = externalTree.findExactBoundary(entered._externalMutationTree, ["service"])
            assignPath(entered, ["value"], 2)
        })

        expect(enteredBoundary).to.be(rootBoundary)
        expect(enteredBoundary.context).to.be(chain)
        expect(enteredBoundary.path).to.be(rootBoundary.path)
        expect(await readPath(chain, ["apis", "value"])).to.be(2)
    })

    it("keeps entry branches exact while boundary and descendant queries clamp native suffixes", () => {
        const service = external({ client: { name: "primary" } })
        const chain = new ContextChain(
            { apis: { service } },
            "external suffix",
            new Execution(),
            { apis: { service: {} } },
        )
        const rootBoundary = externalTree.findExactBoundary(chain._externalMutationTree, ["apis", "service"])
        const enteredTree = externalTree.findBranch(chain._externalMutationTree, [
            "apis",
            "service",
            "client",
        ])

        const descendants = externalTree.findDescendantBoundaries(chain._externalMutationTree, [
            "apis",
            "service",
            "client",
        ])
        expect(enteredTree).to.be(undefined)
        expect(externalTree.findBranch(chain._externalMutationTree, ["apis", "service"]))
            .to.be(rootBoundary)
        expect(externalTree.findBoundary(chain._externalMutationTree, ["apis", "service", "client"]))
            .to.be(rootBoundary)
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
            { callable: { service: {} }, failure: { service: {} }, visible: {} },
        )
        const boundaries = externalTree.findDescendantBoundaries(chain._externalMutationTree, [])

        expect(boundaries.map(boundary => boundary.path)).to.eql([["visible"]])
    })

    it("keeps the static tree stable through managed COW and Array remapping", () => {
        const firstService = external()
        const objectChain = new ContextChain(
            { branch: { firstService, value: 1 } },
            "managed COW",
            new Execution(),
            { branch: { firstService: {} } },
        )
        const objectBoundary = externalTree.findExactBoundary(objectChain._externalMutationTree, ["branch", "firstService"])
        const retainedBranch = lookupPath(objectChain, ["branch"])

        assignPath(objectChain, ["branch", "value"], 2)

        expect(readPath(objectChain, ["branch", "value"])).to.be(2)
        expect(retainedBranch.value).to.be(1)
        expect(externalTree.findExactBoundary(objectChain._externalMutationTree, [
            "branch",
            "firstService",
        ])).to.be(objectBoundary)

        const secondService = external()
        const arrayChain = new ContextChain(
            { values: [secondService] },
            "Array remap",
            new Execution(),
            { values: { 0: {} } },
        )
        const arrayBoundary = externalTree.findExactBoundary(arrayChain._externalMutationTree, ["values", "0"])

        const result = run(
            arrayChain,
            ["values"],
            "push",
            [1],
            { mutationScopeDepth: 1 },
        )

        expect(result).to.be(2)
        expect(readPath(arrayChain, ["values", "length"])).to.be(2)
        expect(readPath(arrayChain, ["values", "0"])).to.be(secondService)
        expect(readPath(arrayChain, ["values", "1"])).to.be(1)
        expect(externalTree.findExactBoundary(arrayChain._externalMutationTree, [
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
            { service: {} },
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


const sourceKinds = ["pending Promise", "fulfilled Promise", "pending thenable", "ready thenable"]

function sourceFor(kind, value) {
    if (kind.endsWith("Promise")) {
        const source = Promise.withResolvers()
        if (kind === "fulfilled Promise") source.resolve(value)
        return { value: source.promise, resolve: () => source.resolve(value) }
    }
    const source = new OrderedThenable()
    if (kind === "ready thenable") source.resolve(value)
    return { value: source, resolve: () => {
        if (!source.outcome) source.resolve(value)
    } }
}

describe("direct context authority discovery", () => {
    for (const kind of sourceKinds) {
        for (const position of ["root", "intermediate", "terminal"]) {
            it(`skips ${kind} at the ${position} without changing ordinary import`, async () => {
                const ctx = { execution: new runtime.Execution(), errorContext: kind + position }
                const resource = external()
                const direct = external()
                const delivered = position === "terminal" ? resource : { resource, count: 7 }
                const source = sourceFor(kind, delivered)
                const root = position === "root" ? source.value : { indirect: source.value, direct }
                const request = position === "root" ? { resource: {} }
                    : { indirect: position === "terminal" ? {} : { resource: {} }, direct: {} }
                const chain = new runtime.ContextChain(root, ctx, request)
                const tree = chain._externalMutationTree
                assert.deepEqual(externalTree.findDescendantBoundaries(tree, []).map(record => record.path),
                    position === "root" ? [] : [["direct"]])
                assert.equal(ctx.execution._externalIdentities.has(resource), false)
                if (kind.endsWith("thenable")) assert.equal(source.value.subscriptions, 1)
                source.resolve()
                assert.equal(await runtime.lookupPath(chain, position === "root" ? [] : ["indirect"], ctx), delivered)
                assert.equal(chain._externalMutationTree, tree)
                assert.equal(ctx.execution._externalIdentities.has(resource), false)
                assert.equal(ctx.execution.fatalError, null)
                if (position !== "root") assert.equal(root.indirect, source.value)
            })
        }

        for (const reverse of [false, true]) {
            for (const alreadyImported of [false, true]) {
                it(`does not count a ${kind} alias as a second location: reverse=${reverse}, imported=${alreadyImported}`, async () => {
                    const ctx = { execution: new runtime.Execution(), errorContext: "alias discovery" }
                    const resource = external()
                    const delivered = { resource }
                    const source = sourceFor(kind, delivered)
                    const entries = [["indirect", source.value], ["direct", delivered]]
                    if (reverse) entries.reverse()
                    const root = Object.fromEntries(entries)
                    if (alreadyImported) {
                        runtime.import(root, ctx)
                        source.resolve()
                        await flushMicrotasks()
                        assert.equal(ctx.execution._metadata.get(root).placementVersions.indirect.value, delivered)
                    }
                    const subscriptions = source.value.subscriptions
                    const request = Object.fromEntries(entries.map(([key]) => [key, { resource: {} }]))
                    const chain = new runtime.ContextChain(root, ctx, request)
                    assert.deepEqual(externalTree.findDescendantBoundaries(chain._externalMutationTree, []).map(record => record.path),
                        [["direct", "resource"]])
                    if (kind.endsWith("thenable"))
                        assert.equal(source.value.subscriptions, alreadyImported ? subscriptions : 1)
                    source.resolve()
                    assert.equal(await runtime.lookupPath(chain, ["indirect"], ctx), delivered)
                    assert.equal(root.indirect, source.value)
                    assert.equal(ctx.execution._externalIdentities.get(resource).binding,
                        externalTree.findExactBoundary(chain._externalMutationTree, ["direct", "resource"]))
                })
            }
        }
    }

    for (const reject of [false, true]) {
        it(`preserves ordinary thenable failure and direct sibling discovery: reject=${reject}`, async () => {
            const ctx = { execution: new runtime.Execution(), errorContext: "source failure" }
            const cause = new Error("source failed")
            const source = new OrderedThenable()
            const direct = external()
            const root = { source, direct }
            if (!reject) source.reject(cause)
            const chain = new runtime.ContextChain(root, ctx, { source: {}, direct: {} })
            assert.equal(source.subscriptions, 1)
            if (reject) source.reject(cause)
            const failure = await runtime.lookupPath(chain, ["source"], ctx)
            assert.equal(failure.cause, cause)
            assert.equal(failure.errorContext, ctx.errorContext)
            assert.deepEqual(externalTree.findDescendantBoundaries(chain._externalMutationTree, []).map(record => record.path), [["direct"]])
        })
    }

    it("uses admission facts without re-probing the source then getter", () => {
        const ctx = { execution: new runtime.Execution(), errorContext: "single protocol probe" }
        const resource = external()
        let probes = 0, subscriptions = 0
        const source = {
            get then() {
                probes++
                return onReady => { subscriptions++; return onReady(resource) }
            },
        }
        const root = { indirect: source, direct: resource }
        const chain = new runtime.ContextChain(root, ctx, { indirect: {}, direct: {} })
        assert.equal(probes, 1)
        assert.equal(subscriptions, 1)
        assert.deepEqual(externalTree.findDescendantBoundaries(chain._externalMutationTree, []).map(record => record.path), [["direct"]])
    })

    it("does not search descendants of a managed endpoint", () => {
        const ctx = { execution: new runtime.Execution(), errorContext: "computed selection" }
        const root = { api: { db: external(), other: external() } }
        const chain = new runtime.ContextChain(root, ctx, { api: {} })
        assert.equal(chain._externalMutationTree, undefined)
        assert.equal(ctx.execution._externalIdentities.has(root.api.db), false)
        assert.equal(ctx.execution._externalIdentities.has(root.api.other), false)
    })

    it("prunes managed and thenable prefixes beside selected resources", () => {
        const ctx = { execution: new runtime.Execution(), errorContext: "mixed paths" }
        const db = external(), ignored = external(), nested = external()
        const root = { api: { db, ignored, managed: { nested } }, pending: new OrderedThenable() }
        const chain = new runtime.ContextChain(root, ctx, { api: { db: {}, managed: {} }, pending: {} })
        assert.deepEqual(externalTree.findDescendantBoundaries(chain._externalMutationTree, []).map(record => record.path), [["api", "db"]])
        assert.equal(ctx.execution._externalIdentities.has(ignored), false)
        assert.equal(ctx.execution._externalIdentities.has(nested), false)
    })

    it("discovers only explicit receiver routes beneath a managed scope", () => {
        const ctx = { execution: new runtime.Execution(), errorContext: "explicit routes" }
        const root = { api: { first: external(), group: { second: external() }, managed: { n: 1 } } }
        const chain = new runtime.ContextChain(root, ctx, { api: { first: {}, group: { second: {} }, managed: {} } })
        assert.deepEqual(externalTree.findDescendantBoundaries(chain._externalMutationTree, []).map(record => record.path), [
            ["api", "first"], ["api", "group", "second"],
        ])
        assert.equal(externalTree.findBranch(chain._externalMutationTree, ["api", "managed"]), undefined)
    })

})
