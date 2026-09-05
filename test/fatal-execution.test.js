import * as runtime from "../src/index.js"
import {
    runContextlessFatal,
    runInternalStep,
    failExecution,
} from "../src/error.js"
import { continueInternalResultOrFatal } from "../src/resolution.js"
import {
    deferred,
    expect,
    flushMicrotasks,
    thrownBy,
} from "./support.js"

function operationContext(execution, errorContext = "fatal test") {
    return { execution, errorContext }
}

function failedBy(operationContext, reason) {
    return thrownBy(() => failExecution(operationContext, reason))
}

describe("fatal execution", () => {
    it("constructs immutable, branded, non-thenable FatalErrors", async () => {
        const cause = new Error("contextless failure")
        const failure = thrownBy(() => runContextlessFatal(() => {
            throw cause
        }))

        expect(failure).to.be.a(runtime.FatalError)
        expect(failure instanceof runtime.CascadaError).to.be(false)
        expect(runtime.isFatalError(failure)).to.be(true)
        expect(runtime.isFatalError(Object.create(runtime.FatalError.prototype)))
            .to.be(false)
        expect(failure.cause).to.be(cause)
        expect(Object.isFrozen(failure)).to.be(true)
        expect(Object.isFrozen(runtime.FatalError.prototype)).to.be(true)
        expect(Object.hasOwn(runtime.FatalError.prototype, "then")).to.be(true)
        expect(failure.then).to.be(undefined)
        expect(thrownBy(() => new runtime.FatalError()))
            .to.be.a(TypeError)

        const oldThen = Object.getOwnPropertyDescriptor(Error.prototype, "then")
        Object.defineProperty(Error.prototype, "then", {
            configurable: true,
            value(resolve) {
                resolve("assimilated")
            },
        })
        try {
            expect(await Promise.resolve(failure)).to.be(failure)
        } finally {
            if (oldThen) Object.defineProperty(Error.prototype, "then", oldThen)
            else delete Error.prototype.then
        }

        const spoof = new Error("not fatal")
        Object.setPrototypeOf(spoof, runtime.FatalError.prototype)
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        expect(runtime.import(spoof, context)).to.be.a(runtime.PoisonError)
        expect(execution.fatalError).to.be(null)
    })

    it("keeps and reports one authoritative failure per execution", () => {
        const firstReports = []
        const secondReports = []
        const firstExecution = new runtime.Execution(error => {
            firstReports.push(error)
        })
        const secondExecution = new runtime.Execution(error => {
            secondReports.push(error)
        })
        const firstContext = operationContext(firstExecution, "first source")
        const secondContext = operationContext(secondExecution, "second source")

        const first = failedBy(firstContext, new Error("first"))
        const later = failedBy(firstContext, new Error("later"))
        const received = failedBy(secondContext, first)

        expect(later).to.be(first)
        expect(received).to.be(first)
        expect(firstExecution.fatalError).to.be(first)
        expect(secondExecution.fatalError).to.be(first)
        expect(firstReports).to.eql([first])
        expect(secondReports).to.eql([first])
        expect(thrownBy(() => {
            firstExecution.fatalError = null
        })).to.be.a(TypeError)
    })

    it("commits before best-effort reporting and ignores reporter results", () => {
        expect(thrownBy(() => new runtime.Execution(null))).to.be.a(TypeError)
        let operation
        let reentered
        let thenRead = false
        const execution = new runtime.Execution(error => {
            reentered = thrownBy(operation)
            expect(execution.fatalError).to.be(error)
            return Object.defineProperty({}, "then", {
                get() {
                    thenRead = true
                    throw new Error("reporter result was inspected")
                },
            })
        })
        const context = operationContext(execution)
        const chain = new runtime.Chain({ value: 1 }, context)
        operation = () => runtime.lookupPath(chain, ["value"], context)

        const failure = failedBy(context, new Error("failed"))

        expect(reentered).to.be(failure)
        expect(thenRead).to.be(false)

        const throwingExecution = new runtime.Execution(() => {
            throw new Error("reporter bug")
        })
        const throwingContext = operationContext(throwingExecution)
        const preserved = failedBy(throwingContext, new Error("preserved"))
        expect(throwingExecution.fatalError).to.be(preserved)
    })

    it("does not expose private execution state as the reporter receiver", () => {
        let reporterThis
        const execution = new runtime.Execution(function () {
            reporterThis = this
            if (this) this.fatalError = null
        })
        const context = operationContext(execution)

        const failure = failedBy(context, new Error("failed"))

        expect(reporterThis).to.be(undefined)
        expect(execution.fatalError).to.be(failure)
        expect(thrownBy(() => runtime.import(1, context))).to.be(failure)
    })

    it("discards a host result when caught nested work failed the execution", () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        const observed = new runtime.Chain({ value: 1 }, context)
        let nestedFailure
        const input = new Proxy({}, {
            ownKeys() {
                nestedFailure = thrownBy(() => runtime.lookupPath(
                    observed,
                    ["value"],
                    context,
                ))
                return []
            },
        })

        const failure = thrownBy(() => runtime.import(input, context))

        expect(failure).to.be(nestedFailure)
        expect(execution.fatalError).to.be(failure)
        expect(execution._metadata.has(input)).to.be(false)
    })

    it("does not admit a value after its classification hook catches fatality", () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        const observed = new runtime.Chain({ value: 1 }, context)
        let nestedFailure
        const input = new Proxy({}, {
            getPrototypeOf() {
                nestedFailure = thrownBy(() => runtime.lookupPath(
                    observed,
                    ["value"],
                    context,
                ))
                return Object.prototype
            },
        })

        const failure = thrownBy(() => new runtime.Chain(input, context))

        expect(failure).to.be(nestedFailure)
        expect(execution.fatalError).to.be(failure)
        expect(execution._metadata.has(input)).to.be(false)
    })

    it("makes failures during asynchronous Error contextualization fatal", async () => {
        async function verify(start) {
            const execution = new runtime.Execution()
            const context = operationContext(execution)
            const contextualizationFailure = new Error("contextualization failed")
            const reason = new Error("host failure")
            Object.setPrototypeOf(reason, new Proxy(Error.prototype, {
                getPrototypeOf() {
                    throw contextualizationFailure
                },
            }))

            const result = start(reason, context)
            const failure = await result.catch(error => error)

            expect(failure).to.be.a(runtime.FatalError)
            expect(failure.cause).to.be(contextualizationFailure)
            expect(execution.fatalError).to.be(failure)
        }

        await verify((reason, context) => runtime.import(
            Promise.reject(reason),
            context,
        ))
        await verify((reason, context) => {
            const chain = new runtime.Chain(Promise.resolve(reason), context)
            return runtime.lookupPath(chain, [], context)
        })
        await verify((reason, context) => {
            const chain = new runtime.Chain({
                change() {
                    return Promise.reject(reason)
                },
            }, context)
            return runtime.run(
                chain,
                [],
                "change",
                [],
                context,
                { mutationScopeDepth: 0 },
            )
        })
        await verify((reason, context) => {
            runtime.import({ pending: Promise.reject(reason) }, context)
            const pending = new Promise(() => {})
            return runtime.import(pending, context)
        })
    })

    it("rejects every pending operation result without waiting for its source", async () => {
        const reports = []
        const execution = new runtime.Execution(error => reports.push(error))
        const context = operationContext(execution)
        const never = new Promise(() => {})
        let entered = false

        const pendingResults = [
            runtime.import(never, context),
            runtime.lookupPath(
                new runtime.Chain({ pending: never }, context),
                ["pending"],
                context,
            ),
            runtime.export(
                new runtime.Chain({ pending: never }, context),
                [],
                context,
            ),
            runtime.hasError(
                new runtime.Chain({ pending: never }, context),
                [],
                context,
            ),
            runtime.getErrors(
                new runtime.Chain({ pending: never }, context),
                [],
                context,
            ),
            runtime.run(
                new runtime.Chain({ pending: never }, context),
                ["pending"],
                "toString",
                [],
                context,
                {},
            ),
            runtime.enter(
                new runtime.Chain({ pending: never }, context),
                ["pending"],
                context,
                false,
                () => { entered = true },
            ),
        ]
        for (const result of pendingResults) {
            expect(result).to.be.a(Promise)
            expect(result).not.to.be(never)
        }
        const caughtResults = pendingResults.map(result => result.catch(error => error))

        const assignment = runtime.assignPath(
            new runtime.Chain({ pending: never }, context),
            ["pending", "value"],
            1,
            context,
        )
        const deletion = runtime.deletePath(
            new runtime.Chain({ pending: never }, context),
            ["pending", "value"],
            context,
        )
        expect(assignment).to.be(undefined)
        expect(deletion).to.be(undefined)

        const failure = failedBy(context, new Error("execution failed"))
        const outcomes = await Promise.all(caughtResults)

        expect(outcomes).to.eql(outcomes.map(() => failure))
        expect(reports).to.eql([failure])
        expect(entered).to.be(false)
    })

    it("lets fatality win until outward result settlement runs", async () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        const source = deferred()
        const result = runtime.import(source.promise, context)

        // Source settlement only queues boundary processing. The outward
        // result remains pending throughout this synchronous turn.
        source.resolve(42)
        const failure = failedBy(context, new Error("failed before exposure"))

        expect(await result.catch(error => error)).to.be(failure)
    })

    it("covers a directly constructed operation-result Promise", async () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        const pending = deferred()
        const result = runtime.run(
            new runtime.Chain([pending.promise], context),
            [],
            "includes",
            [1],
            context,
            {},
        )

        expect(result).to.be.a(Promise)
        const failure = failedBy(context, new Error("failed search"))
        pending.resolve(1)

        expect(await result.catch(error => error)).to.be(failure)
    })

    it("keeps every ready operation result direct", () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        const imported = runtime.import({ value: 1 }, context)
        const observed = new runtime.Chain(imported, context)
        const callable = new runtime.Chain({ read() { return 1 } }, context)
        const mutable = new runtime.Chain({ value: 1, removed: true }, context)
        const results = [
            imported,
            runtime.lookupPath(observed, ["value"], context),
            runtime.export(observed, [], context),
            runtime.hasError(observed, [], context),
            runtime.getErrors(observed, [], context),
            runtime.run(callable, [], "read", [], context, {}),
            runtime.enter(observed, [], context, false, () => "entered"),
            runtime.assignPath(mutable, ["value"], 2, context),
            runtime.deletePath(mutable, ["removed"], context),
        ]

        expect(results.some(result => result instanceof Promise)).to.be(false)
        expect(execution.fatalError).to.be(null)
    })

    it("rejects callable then properties before result transport", async () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        const pending = deferred()
        const then = () => {
            throw new Error("language data was invoked as a Promise")
        }
        const chain = new runtime.Chain({ pending: pending.promise }, context)

        const assignment = runtime.assignPath(chain, ["then"], then, context)
        const result = runtime.export(chain, [], context)
        pending.resolve("ready")

        expect(assignment).to.be.a(runtime.PoisonError)
        expect(assignment.kind).to.be(runtime.ERROR_KIND.PropertyValidation)
        expect(await result).to.be(assignment)
        expect(execution.fatalError).to.be(null)

        const deferredThen = deferred()
        const deferredChain = new runtime.Chain({}, context)
        expect(runtime.assignPath(
            deferredChain,
            ["then"],
            deferredThen.promise,
            context,
        )).to.be(undefined)
        deferredThen.resolve(then)
        await flushMicrotasks()

        const deferredFailure = runtime.lookupPath(
            deferredChain,
            ["then"],
            context,
        )
        expect(deferredFailure).to.be.a(runtime.PoisonError)
        expect(deferredFailure.kind).to.be(runtime.ERROR_KIND.PropertyValidation)
        expect(execution.fatalError).to.be(null)
    })

    it("does not publish an entered mutation after caught nested fatality", async () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        const chain = new runtime.Chain({ value: 1 }, context)
        let nestedFailure

        const failure = thrownBy(() => runtime.enter(
            chain,
            [],
            context,
            true,
            entered => {
                runtime.assignPath(entered, ["value"], 2, context)
                nestedFailure = thrownBy(() => failExecution(
                    context,
                    new Error("nested fatal"),
                ))
                return "ignored"
            },
        ))

        expect(failure).to.be(nestedFailure)
        const gate = chain._state.value
        expect(gate).to.be.a(Promise)
        let settled = false
        gate.then(() => { settled = true })
        await flushMicrotasks()

        expect(settled).to.be(false)
        expect(execution.fatalError).to.be(failure)
    })

    it("ignores custom-thenable settlement after fatal delivery", async () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        const pending = deferred()
        const thenable = { then: (resolve, reject) => pending.promise.then(resolve, reject) }
        const result = runtime.import(thenable, context)
        const caught = result.catch(error => error)
        const failure = failedBy(context, new Error("failed before settlement"))
        const lateValue = {}

        pending.resolve(lateValue)
        expect(await caught).to.be(failure)
        await flushMicrotasks()

        expect(execution._metadata.has(lateValue)).to.be(false)
    })

    it("leaves completed operation results complete and stops later resumptions", async () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        const waves = []
        for (let index = 0; index < 20; index++) {
            const input = deferred()
            const result = runtime.import(input.promise, context)
            input.resolve(index)
            waves.push(result)
        }
        expect(await Promise.all(waves)).to.eql(
            Array.from({ length: 20 }, (_value, index) => index),
        )

        const source = deferred()
        const target = { pending: source.promise }
        const chain = new runtime.Chain(target, context)
        expect(runtime.assignPath(
            chain,
            ["pending", "changed"],
            true,
            context,
        )).to.be(undefined)
        const gate = target.pending

        const failure = failedBy(context, new Error("late failure"))
        source.resolve({ changed: false })
        await flushMicrotasks()

        expect(target.pending).to.be(gate)
        expect(execution.fatalError).to.be(failure)
        expect(thrownBy(() => new runtime.Chain({}, context))).to.be(failure)
        expect(thrownBy(() => runtime.lookupPath(chain, [], context))).to.be(failure)
    })

    it("records a late fire-and-register failure after its ready result", async () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        const pending = deferred()
        const root = {}
        const chain = new runtime.Chain(root, context)

        expect(runtime.assignPath(
            chain,
            ["value"],
            pending.promise,
            context,
        )).to.be(undefined)
        delete root.value
        pending.resolve(1)
        await flushMicrotasks()

        expect(execution.fatalError).to.be.a(runtime.FatalError)
        expect(execution.fatalError.message).to.be(
            "Cannot resolve missing Promise property",
        )
    })

    it("distinguishes a consumed poison outcome from a fatal-on-escape transition", async () => {
        const languageExecution = new runtime.Execution()
        const languageContext = operationContext(languageExecution, "language outcome")
        const poison = new runtime.PoisonError(
            "expected",
            "poison source",
            runtime.ERROR_KIND.OperationInputRejected,
        )
        const languageResult = runtime.import(Promise.reject(poison), languageContext)

        expect(await languageResult.catch(error => error)).to.be(poison)
        expect(languageExecution.fatalError).to.be(null)

        const fatalExecution = new runtime.Execution()
        const fatalContext = operationContext(fatalExecution, "fatal-on-escape")
        const escaped = await continueInternalResultOrFatal(
            Promise.reject(poison),
            fatalContext,
            value => value,
        ).catch(error => error)

        expect(escaped).to.be.a(runtime.FatalError)
        expect(escaped.cause).to.be(poison)
        expect(fatalExecution.fatalError).to.be(escaped)

        const callbackExecution = new runtime.Execution()
        const callbackContext = operationContext(
            callbackExecution,
            "callback without Error outcome",
        )
        const callbackFailure = thrownBy(() => runtime.enter(
            new runtime.Chain({}, callbackContext),
            [],
            callbackContext,
            false,
            () => { throw poison },
        ))

        expect(callbackFailure).to.be.a(runtime.FatalError)
        expect(callbackFailure.cause).to.be(poison)
        expect(callbackExecution.fatalError).to.be(callbackFailure)
    })

    it("submits an existing FatalError rejected at a public boundary", async () => {
        const failure = thrownBy(() => runContextlessFatal(() => {
            throw new Error("existing fatal")
        }))
        let reported
        const execution = new runtime.Execution(error => {
            reported = error
        })
        const context = operationContext(execution)
        const result = runtime.import(Promise.reject(failure), context)

        expect(await result.catch(error => error)).to.be(failure)
        expect(execution.fatalError).to.be(failure)
        expect(reported).to.be(failure)
    })

    it("keeps contextless configuration independent of execution fatality", () => {
        const execution = new runtime.Execution()
        const context = operationContext(execution)
        failedBy(context, new Error("failed execution"))

        class Managed {}
        const external = {}
        expect(thrownBy(() => runtime.managedStateClass(Managed)))
            .to.be(undefined)
        expect(thrownBy(() => runtime.externalState(external)))
            .to.be(undefined)
        expect(thrownBy(() => runInternalStep(context, () => true)))
            .to.be(execution.fatalError)
    })
})
