import { spawnSync } from "child_process"
import { fileURLToPath } from "url"
import * as packageRuntime from "../src/index.js"
import * as errorUtils from "../src/error.js"
import * as internalSteps from "../src/internal-step.js"
import { Chain as InternalChain } from "../src/chain.js"
import {
    Chain,
    assignPath,
    buildRefIndex,
    deletePath,
    decrementReadLease,
    deferred,
    enter,
    errorCause,
    expect,
    exportValue,
    flushMicrotasks,
    getErrors,
    expectCounts,
    hasError,
    importValue,
    incrementReadLease,
    lookupPath,
    readPath,
    metaOf,
    useTestExecution,
    thrownBy,
    testOperationContext,
    verifyRefCounts,
} from "./support.js"

function expectClosed(chain) {
    expect(chain._closed).to.be(true)
}

describe("enter", () => {
    it("rejects a read lease underflow", () => {
        const value = {}
        new Chain(value)
        incrementReadLease(value)
        decrementReadLease(value)
        const failure = thrownBy(() => decrementReadLease(value))

        expect(failure instanceof Error).to.be(true)
        expect(failure.message).to.be("Read lease underflow")
    })

    it("initializes when imported without the package facade", () => {
        const fixture = fileURLToPath(new URL(
            "./fixtures/enter-direct-import.js",
            import.meta.url,
        ))
        const child = spawnSync(
            process.execPath,
            [fixture],
            { encoding: "utf8" },
        )

        expect(child.status).to.be(0)
        expect(JSON.parse(child.stdout)).to.eql({
            callbackCount: 1,
            gateWasPromise: true,
            placementPublished: true,
            result: "done",
        })
    })

    it("uses the package Chain identity for entered Chains", () => {
        expect(packageRuntime.Chain).to.be(InternalChain)
        let entered

        enter(
            new packageRuntime.Chain(
                { target: {} },
                testOperationContext("package Chain initialization"),
            ),
            ["target"],
            false,
            privateChain => {
                entered = privateChain
            },
        )

        expect(entered instanceof packageRuntime.Chain).to.be(true)
    })

    it("gates a direct mutation and forwards its result", async () => {
        const position = { x: 1 }
        const root = { position }
        const chain = new Chain(root)
        let entered

        const result = enter(chain, ["position"], true, privateChain => {
            entered = privateChain
            expect(readPath(chain, ["position"]) instanceof Promise).to.be(true)
            assignPath(privateChain, ["x"], 2)
            return "updated"
        })

        expect(result).to.be("updated")
        expect(root.position).to.be(position)
        expect(root.position.x).to.be(2)
    })

    it("keeps a read entry active across callback delay", async () => {
        const branch = { value: 1 }
        const root = { branch }
        const chain = new Chain(root)
        const completion = deferred()
        let entered

        const result = enter(chain, ["branch"], false, privateChain => {
            entered = privateChain
            return completion.promise
        })

        expect(metaOf(branch).readLeaseCount).to.be(1)
        expect(readPath(entered, ["value"])).to.be(1)
        assignPath(chain, ["branch", "value"], 2)
        expect(root.branch).not.to.be(branch)
        expect(root.branch.value).to.be(2)
        expect(branch.value).to.be(1)

        completion.resolve("observed")
        expect(await result).to.be("observed")
        expect(metaOf(branch).readLeaseCount).to.be(undefined)
        expectClosed(entered)
    })

    it("counts overlapping read entries independently", async () => {
        const branch = {}
        const chain = new Chain({ branch })
        const first = deferred()
        const second = deferred()

        const firstResult = enter(
            chain,
            ["branch"],
            false,
            () => first.promise,
        )
        const secondResult = enter(
            chain,
            ["branch"],
            false,
            () => second.promise,
        )

        expect(metaOf(branch).readLeaseCount).to.be(2)
        first.resolve("first")
        expect(await firstResult).to.be("first")
        expect(metaOf(branch).readLeaseCount).to.be(1)
        second.resolve("second")
        expect(await secondResult).to.be("second")
        expect(metaOf(branch).readLeaseCount).to.be(undefined)
    })

    it("allows inspection of direct and promised Errors at an entry target", async () => {
        const directError = new Error("direct")
        let directCalls = 0
        const directResult = enter(
            new Chain({ target: directError }),
            ["target"],
            false,
            entered => {
                directCalls++
                return lookupPath(entered, [])
            },
        )

        const pending = deferred()
        let pendingCalls = 0
        const pendingResult = enter(
            new Chain({ target: pending.promise }),
            ["target"],
            false,
            entered => {
                pendingCalls++
                return lookupPath(entered, [])
            },
        )
        const rejected = new Error("rejected")
        pending.reject(rejected)

        expect(errorCause(directResult)).to.be(directError)
        expect(directCalls).to.be(1)
        expect(errorCause(await pendingResult)).to.be(rejected)
        expect(pendingCalls).to.be(1)
    })

    it("waits for the preceding target transition before activating entry", async () => {
        const target = deferred()
        const root = { target: target.promise }
        const chain = new Chain(root)

        buildRefIndex(root)
        assignPath(chain, ["target", "before"], 1)
        let callbackStarted = false
        const result = enter(chain, ["target"], true, entered => {
            callbackStarted = true
            expect(root.target instanceof Promise).to.be(true)
            expect(readPath(chain, ["target"])).not.to.be(target.promise)
            assignPath(entered, ["inside"], 2)
            return "issued"
        })

        expect(result).to.be.a(Promise)
        expect(callbackStarted).to.be(false)
        expect(root.target instanceof Promise).to.be(true)
        verifyRefCounts(root)

        target.resolve({})
        expect(await result).to.be("issued")
        await flushMicrotasks()
        expect(readPath(chain, ["target"])).to.eql({ before: 1, inside: 2 })
        verifyRefCounts(root)
    })

    it("publishes an immediate private replacement without waiting for the old target", async () => {
        const target = deferred()
        const root = { target: target.promise }
        const chain = new Chain(root)
        const replacement = { replacement: true }

        const result = enter(chain, ["target"], true, entered => {
            assignPath(entered, [], replacement)
            return "replaced"
        })

        expect(result).to.be("replaced")
        await flushMicrotasks()
        expect(root.target).to.be(replacement)

        target.resolve({ old: true })
        await flushMicrotasks()
        expect(root.target).to.be(replacement)
    })

    it("publishes a Promise assigned as the private root", async () => {
        const next = deferred()
        const root = { target: { old: true } }
        const chain = new Chain(root)

        const result = enter(chain, ["target"], true, entered => {
            assignPath(entered, [], next.promise)
            return "assigned"
        })

        expect(result).to.be("assigned")
        expect(root.target instanceof Promise).to.be(true)
        next.resolve({ next: true })
        await flushMicrotasks()
        expect(root.target).to.eql({ next: true })
    })

    it("rebases at a pending ancestor without delaying the callback", async () => {
        const outer = deferred()
        const root = { outer: outer.promise }
        const chain = new Chain(root)
        let callbackStarted = false

        const result = enter(chain, ["outer", "target"], true, entered => {
            callbackStarted = true
            assignPath(entered, ["entered"], 1)
            return "ready"
        })
        assignPath(chain, ["outer", "target", "later"], 2)

        expect(result).to.be("ready")
        expect(callbackStarted).to.be(true)

        outer.resolve({ target: {} })
        expect(await result).to.be("ready")
        expect(callbackStarted).to.be(true)
        await flushMicrotasks()
        expect(root.outer.target).to.eql({ entered: 1, later: 2 })
    })

    it("retains an unavailable suffix through several pending ancestors", async () => {
        const outer = deferred()
        const inner = deferred()
        const root = { outer: outer.promise }
        const chain = new Chain(root)
        let calls = 0

        const result = enter(
            chain,
            ["outer", "inner", "target"],
            true,
            entered => {
                calls++
                assignPath(entered, ["value"], 1)
                return "entered"
            },
        )

        outer.resolve({ inner: inner.promise })
        await flushMicrotasks()
        expect(calls).to.be(1)

        inner.resolve({ target: {} })
        expect(await result).to.be("entered")
        expect(calls).to.be(1)
        await flushMicrotasks()
        expect(root.outer.inner.target).to.eql({ value: 1 })
    })

    it("preserves earlier and later positions around a pending ancestor", async () => {
        const outer = deferred()
        const root = {
            outer: outer.promise,
            sibling: "available",
        }
        const chain = new Chain(root)

        const before = lookupPath(
            chain,
            ["outer", "target", "value"],
            false,
        )
        const entry = enter(
            chain,
            ["outer", "target"],
            true,
            entered => {
                assignPath(entered, ["value"], 2)
                return "entered"
            },
        )
        const after = lookupPath(
            chain,
            ["outer", "target", "value"],
            false,
        )

        expect(readPath(chain, ["sibling"])).to.be("available")
        outer.resolve({ target: { value: 1 } })

        expect(await before).to.be(1)
        expect(await entry).to.be("entered")
        expect(await after).to.be(2)
    })

    it("keeps the Chain active until an asynchronous callback fulfills", async () => {
        const completion = deferred()
        const root = { target: { value: 1 } }
        const chain = new Chain(root)
        let entered

        const result = enter(chain, ["target"], true, privateChain => {
            entered = privateChain
            return completion.promise
        })

        expect(result).not.to.be(completion.promise)
        assignPath(entered, ["value"], 2)
        completion.resolve("done")
        expect(await result).to.be("done")
        expectClosed(entered)
        await flushMicrotasks()
        expect(root.target.value).to.be(2)
    })

    it("closes capabilities without cancelling already-issued work", async () => {
        const pending = deferred()
        const root = { target: { pending: pending.promise } }
        const chain = new Chain(root)
        let readChain
        let issued

        const result = enter(chain, ["target"], false, entered => {
            readChain = entered
            issued = lookupPath(
                entered,
                ["pending", "value"],
                false,
            )
            return "closed"
        })

        expect(result).to.be("closed")
        expectClosed(readChain)

        pending.resolve({ value: 3 })
        expect(await issued).to.be(3)

        let mutationFailure
        enter(chain, ["target"], true, entered => {
            mutationFailure = thrownBy(() => {
                assignPath(entered, ["allowed"], true)
            })
        })
        expect(mutationFailure).to.be(undefined)
    })

    it("activates a successor after its predecessor publishes", async () => {
        const firstCompletion = deferred()
        const root = { target: {} }
        const chain = new Chain(root)
        let secondStarted = false

        const firstResult = enter(chain, ["target"], true, entered => {
            assignPath(entered, ["first"], 1)
            return firstCompletion.promise
        })
        const secondResult = enter(chain, ["target"], true, entered => {
            secondStarted = true
            assignPath(entered, ["second"], 2)
            return "second"
        })

        expect(secondResult).to.be.a(Promise)
        expect(secondStarted).to.be(false)
        firstCompletion.resolve("first")
        expect(await firstResult).to.be("first")
        expect(await secondResult).to.be("second")
        await flushMicrotasks()
        expect(root.target).to.eql({ first: 1, second: 2 })
    })

    it("makes a pending read protect its value before a later mutation", async () => {
        const target = deferred()
        const readCompletion = deferred()
        const root = { target: target.promise }
        const chain = new Chain(root)
        let readChain

        const readResult = enter(chain, ["target"], false, entered => {
            readChain = entered
            return readCompletion.promise
        })
        enter(chain, ["target"], true, entered => {
            assignPath(entered, ["value"], 2)
        })

        const resolved = { value: 1 }
        target.resolve(resolved)
        await flushMicrotasks()

        expect(readChain._state.value).to.be(resolved)
        expect(readChain._state.value.value).to.be(1)
        expect(root.target).not.to.be(resolved)
        expect(root.target.value).to.be(2)
        expect(metaOf(resolved).shared).to.be(true)

        readCompletion.resolve("read")
        expect(await readResult).to.be("read")
        expect(metaOf(resolved).readLeaseCount).to.be(undefined)
    })

    it("copies beneath a read-entered ancestor before mutating", async () => {
        const target = { value: 1 }
        const ancestor = { target }
        const root = { ancestor }
        const chain = new Chain(root)
        const completion = deferred()
        let readChain

        const readResult = enter(
            chain,
            ["ancestor"],
            false,
            entered => {
                readChain = entered
                return completion.promise
            },
        )
        enter(chain, ["ancestor", "target"], true, entered => {
            assignPath(entered, ["value"], 2)
        })
        await flushMicrotasks()

        expect(readChain._state.value).to.be(ancestor)
        expect(readChain._state.value.target).to.be(target)
        expect(readChain._state.value.target.value).to.be(1)
        expect(readPath(chain, ["ancestor"])).not.to.be(ancestor)
        expect(readPath(chain, ["ancestor", "target"])).not.to.be(target)
        expect(readPath(chain, ["ancestor", "target", "value"])).to.be(2)
        expect(metaOf(ancestor).readLeaseCount).to.be(1)

        completion.resolve("read")
        expect(await readResult).to.be("read")
        expect(metaOf(ancestor).readLeaseCount).to.be(undefined)
    })

    it("preserves permanent alias sharing after a read entry releases", async () => {
        const shared = { value: 1 }
        const root = { left: shared, right: shared }
        const chain = new Chain(root)
        const completion = deferred()

        lookupPath(chain, ["left"])
        const result = enter(
            chain,
            ["left"],
            false,
            () => completion.promise,
        )

        assignPath(chain, ["right", "value"], 2)
        expect(root.left).to.be(shared)
        expect(root.left.value).to.be(1)
        expect(root.right).not.to.be(shared)
        expect(root.right.value).to.be(2)

        completion.resolve("read")
        expect(await result).to.be("read")
        expect(metaOf(shared).readLeaseCount).to.be(undefined)
        expect(metaOf(shared).shared).to.be(true)
    })

    it("preserves an export captured before in-place entered mutation", async () => {
        const pending = deferred()
        const target = {
            value: 1,
            pending: pending.promise,
        }
        const root = { target }
        const chain = new Chain(root)

        const snapshot = exportValue(chain, ["target"])
        enter(chain, ["target"], true, entered => {
            assignPath(entered, ["value"], 2)
        })

        expect(metaOf(target).shared).not.to.be(true)
        pending.resolve("ready")
        expect(await snapshot).to.eql({
            value: 1,
            pending: "ready",
        })
        await flushMicrotasks()
        expect(root.target).to.be(target)
        expect(root.target.value).to.be(2)
    })

    it("protects a target retained by owning-path copy-on-write", async () => {
        const target = { value: 1 }
        const originalRoot = { target }
        const chain = new Chain(originalRoot)
        lookupPath(chain, [])

        enter(chain, ["target"], true, entered => {
            assignPath(entered, ["value"], 2)
        })
        await flushMicrotasks()

        expect(originalRoot.target).to.be(target)
        expect(originalRoot.target.value).to.be(1)
        expect(readPath(chain, [])).not.to.be(originalRoot)
        expect(readPath(chain, ["target"])).not.to.be(target)
        expect(readPath(chain, ["target"]).value).to.be(2)
    })

    it("keeps an imported Promise target isolated through transfer", async () => {
        const pending = deferred()
        const external = { target: pending.promise }
        const chain = new Chain(importValue(external, "entered target"))

        enter(chain, ["target"], true, entered => {
            assignPath(entered, ["value"], 2)
        })
        const resolved = { value: 1 }
        pending.resolve(resolved)
        await flushMicrotasks()

        expect(external.target).to.be(pending.promise)
        expect(readPath(new Chain(external), ["target"])).to.be(resolved)
        expect(resolved.value).to.be(1)
        expect(readPath(chain, [])).not.to.be(external)
        expect(readPath(chain, ["target"])).not.to.be(resolved)
        expect(readPath(chain, ["target"]).value).to.be(2)
        verifyRefCounts(chain._state.value, external)
    })

    it("writes a transferred imported result into private state", async () => {
        const pending = deferred()
        const external = { target: pending.promise }
        const chain = new Chain(importValue(external, "transferred target"))
        let entered

        expect(enter(chain, ["target"], true, privateChain => {
            entered = privateChain
            return "done"
        })).to.be("done")
        const published = readPath(chain, ["target"])
        const resolved = { value: 1 }
        pending.resolve(resolved)

        expect(await published).to.be(resolved)
        expect(entered._state.value).to.be(resolved)
        expect(external.target).to.be(pending.promise)
    })

    it("preserves imported storage through read-only entry", () => {
        const child = { value: 1 }
        const target = { child }
        const external = { target }
        const chain = new Chain(importValue(external, "read target"))
        let extracted

        expect(metaOf(target).imported).to.be(true)
        const result = enter(chain, ["target"], false, entered => {
            extracted = lookupPath(entered, ["child"])
            return "read"
        })

        expect(result).to.be("read")
        expect(extracted).to.be(child)
        expect(metaOf(child).imported).to.be(true)
        expect(Object.hasOwn(metaOf(target), "importPolicy")).to.be(false)
        expect(metaOf(target).readLeaseCount).to.be(undefined)
    })

    it("does not lease Function or external read-only targets", () => {
        class External {}
        const values = [() => {}, new External()]

        for (const value of values) {
            expect(enter(new Chain(value), [], false, entered => {
                expect(readPath(entered, [])).to.be(value)
                expect(metaOf(value).readLeaseCount).to.be(undefined)
                return "done"
            })).to.be("done")
            expect(metaOf(value).readLeaseCount).to.be(undefined)
        }
    })

    it("preserves imported cycles through Promise-target transfer", async () => {
        const pending = deferred()
        const external = { target: pending.promise }
        const chain = new Chain(importValue(external, "entered cycle"))

        enter(chain, ["target"], true, entered => {
            assignPath(entered, ["changed"], true)
        })

        const cycle = {}
        cycle.self = cycle
        pending.resolve(cycle)
        await flushMicrotasks()

        const published = readPath(chain, ["target"])
        expect(external.target).to.be(pending.promise)
        expect(readPath(new Chain(external), ["target"])).to.be(cycle)
        expect(cycle.changed).to.be(undefined)
        expect(published).not.to.be(cycle)
        expect(published.changed).to.be(true)
        expect(published.self).to.be(cycle)
        verifyRefCounts(chain._state.value, external)
    })

    it("transfers a rejected Promise target as the same Error value", async () => {
        const pending = deferred()
        const root = { target: pending.promise }
        const error = new Error("target rejected")
        let calls = 0

        enter(new Chain(root), ["target"], true, () => {
            calls++
        })
        pending.reject(error)
        await flushMicrotasks()

        expect(calls).to.be(1)
        expect(errorCause(root.target)).to.be(error)
    })

    it("publishes an exact later replacement after a pending gate", async () => {
        const completion = deferred()
        const root = { target: { old: true } }
        const chain = new Chain(root)

        const result = enter(
            chain,
            ["target"],
            true,
            () => completion.promise,
        )
        const replacement = { replacement: true }
        assignPath(chain, ["target"], replacement)

        completion.resolve("done")
        expect(await result).to.be("done")
        await flushMicrotasks()
        expect(root.target).to.be(replacement)
    })

    it("orders deletion after a pending gate", async () => {
        const completion = deferred()
        const target = { old: true }
        const root = { target }
        const chain = new Chain(root)

        const result = enter(
            chain,
            ["target"],
            true,
            () => completion.promise,
        )
        const gate = root.target
        deletePath(chain, ["target"])
        let observed = false
        const deleted = Promise.resolve(readPath(chain, ["target"])).then(value => {
            observed = true
            return value
        })

        await flushMicrotasks()
        expect(observed).to.be(false)
        completion.resolve("done")
        expect(await result).to.be("done")
        expect(await gate).to.be(target)
        expect(await deleted).to.be(undefined)
        expect(Object.hasOwn(root, "target")).to.be(false)
    })

    it("makes ancestor observations wait for gate publication", async () => {
        const completion = deferred()
        const root = {
            container: {
                target: { value: 1 },
                sibling: "ready",
            },
        }
        const chain = new Chain(root)

        const operation = enter(
            chain,
            ["container", "target"],
            true,
            entered => {
                assignPath(entered, ["value"], 2)
                return completion.promise
            },
        )
        const snapshot = exportValue(chain, ["container"])
        const containsError = hasError(chain, ["container"])
        const errors = getErrors(chain, ["container"])

        expect(snapshot instanceof Promise).to.be(true)
        expect(containsError instanceof Promise).to.be(true)
        expect(errors instanceof Promise).to.be(true)

        completion.resolve("done")
        expect(await operation).to.be("done")
        expect(await snapshot).to.eql({
            target: { value: 2 },
            sibling: "ready",
        })
        expect(await containsError).to.be(false)
        expect(await errors).to.be(null)
    })

    it("keeps indexed counters exact across gate publication", async () => {
        const completion = deferred()
        const root = { target: {} }
        const chain = new Chain(root)
        expect(hasError(chain, [])).to.be(false)

        const result = enter(
            chain,
            ["target"],
            true,
            () => completion.promise,
        )
        expectCounts(root, 1, 0)
        verifyRefCounts(root)

        completion.resolve("done")
        expect(await result).to.be("done")
        await flushMicrotasks()

        expectCounts(root, 0, 0)
        verifyRefCounts(root)
    })

    it("leaves an unused missing suffix unchanged", () => {
        const root = {}
        let calls = 0
        const result = enter(
            new Chain(root),
            ["missing", "child"],
            true,
            () => {
                calls++
            },
        )

        expect(result).to.be(undefined)
        expect(Object.hasOwn(root, "missing")).to.be(false)
        expect(calls).to.be(1)
    })

    it("does not consume an unused intrinsic length reference", () => {
        for (const receiver of [[1, 2], "ab"]) {
            const chain = new Chain(receiver)
            let calls = 0

            const result = enter(chain, ["length"], true, () => {
                calls++
            })

            expect(result).to.be(undefined)
            expect(readPath(chain, [])).to.be(receiver)
            expect(calls).to.be(1)
        }
    })

    it("does not await an unused pending intrinsic length reference", async () => {
        for (const value of [[1, 2], "ab"]) {
            const receiver = deferred()
            const root = { target: receiver.promise }
            const chain = new Chain(root)
            let calls = 0
            const result = enter(
                chain,
                ["target", "length"],
                true,
                () => {
                    calls++
                },
            )

            receiver.resolve(value)
            const error = await result

            expect(error).to.be(undefined)
            expect(calls).to.be(1)
            expect(await lookupPath(chain, ["target"])).to.be(value)
        }
    })

    it("does not validate a missing suffix after a no-op callback closes", async () => {
        const outer = deferred()
        const root = { outer: outer.promise }
        let calls = 0
        const result = enter(
            new Chain(root),
            ["outer", "missing", "child"],
            true,
            () => {
                calls++
            },
        )

        outer.resolve({})
        const error = await result

        expect(error).to.be(undefined)
        expect(root.outer.missing).to.be(undefined)
        expect(calls).to.be(1)
    })

    it("handles root, primitive, missing, and Error targets uniformly", async () => {
        const primitive = new Chain(1)
        expect(enter(primitive, [], true, entered => {
            expect(readPath(entered, [])).to.be(1)
            assignPath(entered, [], 2)
            return "root"
        })).to.be("root")

        const error = new Error("data")
        const root = { error }
        const chain = new Chain(root)
        let missingReadCalls = 0
        expect(enter(chain, ["missing"], false, entered => {
            missingReadCalls++
            return readPath(entered, [])
        })).to.be(undefined)
        expect(missingReadCalls).to.be(1)

        let errorMutationCalls = 0
        expect(enter(chain, ["error"], true, entered => {
            errorMutationCalls++
            expect(errorCause(readPath(entered, []))).to.be(error)
            return "error"
        })).to.be("error")

        await flushMicrotasks()
        expect(primitive._state.value).to.be(2)
        expect(errorCause(root.error)).to.be(error)
        expect(errorMutationCalls).to.be(1)
    })

    it("composes nested mutating entries without a cleanup stack", async () => {
        const root = {
            outer: {
                inner: { value: 1 },
            },
        }

        const result = enter(
            new Chain(root),
            ["outer"],
            true,
            outer => enter(
                outer,
                ["inner"],
                true,
                inner => {
                    assignPath(inner, ["value"], 2)
                    return "nested"
                },
            ),
        )

        expect(result).to.be("nested")
        await flushMicrotasks()
        expect(root.outer.inner.value).to.be(2)
    })

    it("composes a nested entry that gates the private root", async () => {
        const root = { target: { value: 1 } }
        let outerChain

        const result = enter(
            new Chain(root),
            ["target"],
            true,
            outer => {
                outerChain = outer
                const innerResult = enter(outer, [], true, inner => {
                    expect(readPath(outer, []) instanceof Promise).to.be(true)
                    assignPath(inner, ["value"], 2)
                    return "nested root"
                })
                expect(outer._state.value).to.eql({ value: 2 })
                return innerResult
            },
        )

        expect(result).to.be("nested root")
        expect(outerChain._state.value).to.eql({ value: 2 })
        expect(root.target).to.eql({ value: 2 })
    })

    it("publishes pending descendants before their earlier work settles", async () => {
        const descendant = deferred()
        const root = {
            target: {
                descendant: descendant.promise,
                sibling: 3,
            },
        }

        const chain = new Chain(root)
        enter(chain, ["target"], true, entered => {
            assignPath(entered, ["descendant", "value"], 2)
        })
        await flushMicrotasks()

        expect(lookupPath(chain, ["target", "sibling"])).to.be(3)
        const observed = lookupPath(chain, ["target", "descendant", "value"])
        expect(observed instanceof Promise).to.be(true)
        descendant.resolve({ value: 1 })
        expect(await observed).to.be(2)
    })

    it("orders mutate-read-mutate through a predecessor gate", async () => {
        const firstCompletion = deferred()
        const readCompletion = deferred()
        const root = { target: {} }
        const chain = new Chain(root)
        let readChain
        let secondStarted = false

        const firstResult = enter(
            chain,
            ["target"],
            true,
            entered => {
                assignPath(entered, ["first"], 1)
                return firstCompletion.promise
            },
        )
        const readResult = enter(
            chain,
            ["target"],
            false,
            entered => {
                readChain = entered
                return readCompletion.promise
            },
        )
        enter(chain, ["target"], true, entered => {
            secondStarted = true
            assignPath(entered, ["second"], 2)
        })

        expect(secondStarted).to.be(false)
        expect(readChain).to.be(undefined)

        firstCompletion.resolve("first")
        expect(await firstResult).to.be("first")
        await flushMicrotasks()

        expect(readChain._state.value).to.eql({ first: 1 })
        expect(root.target).to.eql({ first: 1, second: 2 })

        readCompletion.resolve("read")
        expect(await readResult).to.be("read")
    })

    it("does not clean up a read entry after a fatal callback throw", () => {
        let reported
        useTestExecution(error => {
            reported = error
        })
        const branch = {}
        const chain = new Chain({ branch })
        const failure = new Error("callback failed")
        let entered
        const caught = thrownBy(() => enter(
            chain,
            ["branch"],
            false,
            privateChain => {
                entered = privateChain
                throw failure
            },
        ))

        expect(errorCause(caught)).to.be(failure)
        expect(caught).to.be.a(packageRuntime.FatalError)
        expect(caught.errorContext).to.be("test enter")
        expect(reported).to.be(caught)
        expect(metaOf(branch).readLeaseCount).to.be(1)
        expect(entered._closed).not.to.be(true)
    })

    it("abandons a delayed mutating entry after a fatal callback throw", async () => {
        let reported
        useTestExecution(error => {
            reported = error
        })
        const ancestor = deferred()
        const root = { ancestor: ancestor.promise }
        const chain = new Chain(root)
        const failure = new Error("delayed callback failed")
        let entered
        let gate
        const result = enter(
            chain,
            ["ancestor", "target"],
            true,
            privateChain => {
                entered = privateChain
                gate = metaOf(root).placementVersions.ancestor.value
                return ancestor.promise.then(() => { throw failure })
            },
        )
        ancestor.resolve({ target: { value: 1 } })

        let caught
        try {
            await result
        } catch (error) {
            caught = error
        }

        expect(errorCause(caught)).to.be(failure)
        expect(caught).to.be.a(packageRuntime.FatalError)
        expect(caught.errorContext).to.be("test enter")
        expect(reported).to.be(caught)
        expect(entered._closed).not.to.be(true)
        let gateSettled = false
        gate.then(() => {
            gateSettled = true
        })
        await flushMicrotasks()
        expect(gateSettled).to.be(false)
        expect(metaOf(root).placementVersions.ancestor.value).to.be(gate)
    })

    it("does not clean up a read entry after fatal callback rejection", async () => {
        let reported
        useTestExecution(error => {
            reported = error
        })
        const branch = {}
        const chain = new Chain({ branch })
        const completion = deferred()
        const failure = new Error("callback rejected")
        let entered
        const result = enter(chain, ["branch"], false, privateChain => {
            entered = privateChain
            return completion.promise
        })
        completion.reject(failure)

        let caught
        try {
            await result
        } catch (error) {
            caught = error
        }

        expect(errorCause(caught)).to.be(failure)
        expect(caught).to.be.a(packageRuntime.FatalError)
        expect(caught.errorContext).to.be("test enter")
        expect(reported).to.be(caught)
        expect(metaOf(branch).readLeaseCount).to.be(1)
        expect(entered._closed).not.to.be(true)
    })

    it("completes a read entry after an admitted poison rejection", async () => {
        const execution = useTestExecution()
        const branch = {}
        const completion = deferred()
        const poison = errorUtils.validationError(
            "expected",
            testOperationContext("callback source"),
            packageRuntime.ERROR_KIND.OperationInputFailed,
        )
        let entered
        const result = enter(
            new Chain({ branch }),
            ["branch"],
            false,
            privateChain => {
                entered = privateChain
                return completion.promise
            },
        )

        completion.reject(poison)

        expect(await result).to.be(poison)
        expect(execution.fatalError).to.be(null)
        expect(metaOf(branch).readLeaseCount).to.be(undefined)
        expectClosed(entered)
    })

    it("publishes a mutation after an admitted poison rejection", async () => {
        const execution = useTestExecution()
        const root = { target: { value: 1 } }
        const completion = deferred()
        const poison = errorUtils.validationError(
            "expected",
            testOperationContext("callback source"),
            packageRuntime.ERROR_KIND.OperationInputFailed,
        )
        let entered
        const result = enter(
            new Chain(root),
            ["target"],
            true,
            privateChain => {
                entered = privateChain
                assignPath(privateChain, ["value"], 2)
                return completion.promise
            },
        )

        completion.reject(poison)

        expect(await result).to.be(poison)
        expect(execution.fatalError).to.be(null)
        expectClosed(entered)
        await flushMicrotasks()
        expect(root.target).to.eql({ value: 2 })
    })

    it("submits a FatalError callback result without cleanup", () => {
        const branch = {}
        const failure = thrownBy(() =>
            internalSteps.runInternalStep(
                {
                    execution: new packageRuntime.Execution(),
                    errorContext: "fatal fixture",
                },
                () => {
                    throw new Error("fatal callback result")
                },
            ),
        )
        let entered
        let reported
        useTestExecution(error => {
            reported = error
        })
        const caught = thrownBy(() => enter(
            new Chain({ branch }),
            ["branch"],
            false,
            privateChain => {
                entered = privateChain
                return failure
            },
        ))

        expect(caught).to.be(failure)
        expect(reported).to.be(failure)
        expect(metaOf(branch).readLeaseCount).to.be(1)
        expect(entered._closed).not.to.be(true)
    })

    it("submits a fulfilled FatalError without cleanup", async () => {
        const branch = {}
        const failure = thrownBy(() =>
            internalSteps.runInternalStep(
                {
                    execution: new packageRuntime.Execution(),
                    errorContext: "fatal fixture",
                },
                () => {
                    throw new Error("fatal callback fulfillment")
                },
            ),
        )
        let entered
        let reported
        useTestExecution(error => {
            reported = error
        })
        const result = enter(
            new Chain({ branch }),
            ["branch"],
            false,
            privateChain => {
                entered = privateChain
                return Promise.resolve(failure)
            },
        )
        const caught = await result.catch(error => error)

        expect(caught).to.be(failure)
        expect(reported).to.be(failure)
        expect(metaOf(branch).readLeaseCount).to.be(1)
        expect(entered._closed).not.to.be(true)
    })

    it("abandons a fatally failed mutating entry without publication", async () => {
        const root = { target: { value: 1 } }
        const chain = new Chain(root)
        const failure = new Error("mutation failed")
        let entered

        const failureResult = thrownBy(() => enter(
            chain,
            ["target"],
            true,
            privateChain => {
                entered = privateChain
                assignPath(privateChain, ["value"], 2)
                throw failure
            },
        ))
        expect(errorCause(failureResult)).to.be(failure)

        const gate = metaOf(root).placementVersions.target.value
        expect(gate instanceof Promise).to.be(true)
        expect(entered._closed).not.to.be(true)
        await flushMicrotasks()
        expect(metaOf(root).placementVersions.target.value).to.be(gate)
    })

    it("abandons a rejected asynchronous mutation without publication", async () => {
        const root = { target: { value: 1 } }
        const completion = deferred()
        const failure = new Error("mutation rejected")
        let entered

        const result = enter(new Chain(root), ["target"], true, privateChain => {
            entered = privateChain
            assignPath(privateChain, ["value"], 2)
            return completion.promise
        })
        const gate = root.target
        completion.reject(failure)

        let caught
        try {
            await result
        } catch (error) {
            caught = error
        }

        expect(errorCause(caught)).to.be(failure)
        expect(entered._closed).not.to.be(true)
        await flushMicrotasks()
        expect(root.target).to.be(gate)
    })

})
