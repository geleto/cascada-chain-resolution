import * as runtime from "../src/index.js"
import { requiresCopyOnWrite, metaOf } from "../src/meta.js"
import {
    assignPath,
    Chain,
    export as exportValue,
    import as importValue,
    lookupPath,
    managedStateClass,
    run,
    Execution,
} from "../src/index.js"
import { buildRefIndex } from "../src/refcounts.js"
import { failExecution as submitFatal } from "../src/error.js"
import { verifyRefCounts } from "./verify-refcounts.js"

import { runInNewContext } from "node:vm"
import assert from "node:assert/strict"

import { deferred, errorCause, expect, flushMicrotasks, readPath, thrownBy } from "./support.js"

describe("managed invocation", () => {
    for (const pending of [false, true]) {
        it(`retains result graph Errors when receiver validation fails, pending=${pending}`, async () => {
            const ctx = { execution: new runtime.Execution(), errorContext: {} }, hold = Promise.withResolvers()
            const receiverError = new Error("receiver"), first = new Error("first result"), second = new Error("second result")
            const never = new Promise(() => {})
            const chain = new runtime.Chain(runtime.import({ n: 1, change() {
                const complete = () => {
                    this.n = receiverError
                    return { first, nested: [first, second], independent: never }
                }
                return pending ? hold.promise.then(complete) : complete()
            } }, ctx), ctx)
            const result = runtime.run(chain, [], "change", [], ctx, { mutationScopeDepth: 0 })
            assert.equal(result instanceof Promise, pending)
            hold.resolve()
            const failure = await result
            assert.equal(failure.kind, runtime.ERROR_KIND.Multiple)
            assert.deepEqual(new Set(failure.errors.map(error => error.cause)), new Set([receiverError, first, second]))
            const scope = runtime.getErrors(chain, [], ctx)
            assert.equal(scope.kind, runtime.ERROR_KIND.InvalidManagedReceiver)
            assert.equal(scope.cause, receiverError)
            assert.equal(runtime.repairPath(chain, [], ctx), undefined)
            assert.equal(runtime.lookupPath(chain, ["n"], ctx), 1)
            assert.equal(ctx.execution.fatalError, null)
        })
    }

    it("uses the same managed boundary for record methods", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const value = {
            count: 1,
            increaseBy(amount) {
                this.count += amount
            },
            increment() {
                this.increaseBy(1)
                return this.count
            },
        }
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })

        expect(run(chain, [], "increment", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })).to.be(2)
        expect(chain._state.value).not.to.be(value)
        expect(chain._state.value.count).to.be(2)
        expect(value.count).to.be(1)
    })

    it("isolates a protected record mutation", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = importValue({
            count: 1,
            increaseBy(amount) {
                this.count += amount
                return this.count
            },
        }, { ...testContext, errorContext: "managed record receiver" })
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })

        expect(run(chain, [], "increaseBy", [2], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })).to.be(3)
        expect(chain._state.value).not.to.be(source)
        expect(chain._state.value.count).to.be(3)
        expect(source.count).to.be(1)
    })

    it("uses an own record placement instead of an inherited method", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const value = {
            toString() {
                return "managed record"
            },
        }

        expect(run(
            new Chain(value, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "toString",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )).to.be(
            "managed record",
        )
    })

    it("rejects an own record constructor placement", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        let called = false
        const value = {
            constructor() {
                called = true
            },
        }

        expect(run(
            new Chain(value, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "constructor",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        ).message).to.be("Method is not callable: constructor")
        expect(called).to.be(false)
    })

    it("resolves a Promise-backed record method placement", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const method = deferred()
        const value = { count: 2, read: method.promise }
        const result = run(
            new Chain(value, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [3],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        method.resolve(function (amount) {
            return this.count + amount
        })

        expect(await result).to.be(5)
    })

    it("protects a fulfilled argument root while receiver selection waits", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const receiver = deferred()
        const argument = deferred()
        const source = { value: 1 }
        const sourceChain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })
        const result = run(
            new Chain(receiver.promise, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [argument.promise],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        argument.resolve(source)
        await flushMicrotasks()
        expect(metaOf(source, testContext).readLeaseCount).to.be(1)
        assignPath(sourceChain, ["value"], 2, testContext)
        receiver.resolve({
            read(value) {
                return value.value
            },
        })

        expect(await result).to.be(1)
        expect(source.value).to.be(1)
        expect(sourceChain._state.value.value).to.be(2)
        expect(metaOf(source, testContext).readLeaseCount).to.be(undefined)
    })

    it("ignores a primitive fulfillment while receiver selection waits", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const receiver = deferred()
        const argument = deferred()
        const result = run(
            new Chain(receiver.promise, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [argument.promise],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        argument.resolve(3)
        await flushMicrotasks()
        receiver.resolve({ read: value => value })

        expect(await result).to.be(3)
    })

    it("releases a fulfilled argument when pending selection fails", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const receiver = deferred()
        const argument = deferred()
        const source = { value: 1 }
        const result = run(
            new Chain(receiver.promise, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "missing",
            [argument.promise],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        argument.resolve(source)
        await flushMicrotasks()
        expect(metaOf(source, testContext).readLeaseCount).to.be(1)
        receiver.resolve({})

        expect((await result).message).to.be("Method is not callable: missing")
        expect(metaOf(source, testContext).readLeaseCount).to.be(undefined)
    })

    it("ignores prototype accessors and excludes Object.prototype methods", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        let getterCalls = 0
        class WithAccessor {
            get value() {
                getterCalls++
                return 1
            }

            read() {
                return 2
            }
        }
        expect(managedStateClass(WithAccessor)).to.be(undefined)
        const chain = new Chain(new WithAccessor(), { ...testContext, errorContext: "test Chain initialization" })
        expect(run(chain, [], "read", [], { ...testContext, errorContext: "test run" }, { repair: false })).to.be(2)
        expect(run(chain, [], "value", [], { ...testContext, errorContext: "test run" }, { repair: false }).kind).to.be(
            runtime.ERROR_KIND.InvalidManagedReceiver,
        )
        expect(getterCalls).to.be(0)

        class Value {}
        managedStateClass(Value)
        expect(run(
            new Chain(new Value(), { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "toString",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        ) instanceof Error).to.be(true)
    })

    it("ends foreign class lookup before its Object prototype", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const { Foreign, value } = runInNewContext(`
            class Foreign {
                read() { return this.value }
            }
            ({ Foreign, value: Object.assign(new Foreign(), { value: 3 }) })
        `)
        managedStateClass(Foreign)

        expect(run(
            new Chain(value, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )).to.be(3)
        expect(run(
            new Chain(value, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "toString",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        ) instanceof Error).to.be(true)
    })

    it("prepares receiver state before reporting a missing method", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {}
        managedStateClass(Value)
        const pending = deferred()
        const value = new Value()
        value.pending = pending.promise

        const result = run(
            new Chain(value, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "missing",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        expect(result instanceof Promise).to.be(true)
        pending.resolve(1)
        expect((await result).message).to.be("Method is not callable: missing")
    })

    it("rejects a language property that shadows a managed-class method", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            read() {
                return 1
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.read = () => 2

        expect(run(
            new Chain(value, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        ).message).to.be(
            "Cannot call read because an own data property with that name " +
            "hides the method",
        )
    })

    it("ignores an own non-placement during method selection", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        let accessed = false
        class Value {
            read() {
                return 1
            }
        }
        managedStateClass(Value)
        const value = new Value()
        Object.defineProperty(value, "read", {
            get() {
                accessed = true
                return () => 2
            },
        })

        expect(run(
            new Chain(value, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )).to.be(1)
        expect(accessed).to.be(false)
    })

    it("resolves a method only after clean preparation and before isolation", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const reflections = []
        const prototype = new Proxy({
            change() {
                this.value++
            },
        }, {
            getOwnPropertyDescriptor(target, key) {
                if (key === "change") reflections.push("method")
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        function Value() {
            this.value = 1
        }
        Value.prototype = prototype
        managedStateClass(Value)

        const failure = new Error("invalid argument")
        const failed = new Chain(new Value(), { ...testContext, errorContext: "test Chain initialization" })
        reflections.length = 0
        const argumentFailure = run(
            failed,
            [],
            "change",
            [failure],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        )
        expect(errorCause(argumentFailure)).to.be(failure)
        expect(reflections).to.eql([])

        const receiverFailure = new Error("invalid receiver")
        const invalid = new Value()
        invalid.failure = receiverFailure
        const invalidChain = new Chain(invalid, { ...testContext, errorContext: "test Chain initialization" })
        reflections.length = 0
        expect(errorCause(run(
            invalidChain,
            [],
            "change",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        ))).to.be(receiverFailure)
        expect(reflections).to.eql([])

        const value = new Proxy(new Value(), {
            ownKeys(target) {
                reflections.push("receiver")
                return Reflect.ownKeys(target)
            },
        })
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })
        lookupPath(chain, [], testContext)
        reflections.length = 0

        run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        // Isolation assembles from the prepared capture without rereading storage.
        expect(reflections).to.eql(["receiver", "method"])
        expect(chain._state.value).not.to.be(value)
        expect(chain._state.value.value).to.be(2)
        expect(value.value).to.be(1)
    })

    it("rejects a prototype accessor detected before invocation", () => {
        let testContext
        let reported
        testContext = { execution: new Execution(error => {
            reported = error
        }), errorContext: "test operation" }
        class Value {
            read() {
                return 1
            }
        }
        managedStateClass(Value)
        Object.defineProperty(Value.prototype, "read", {
            get() {
                return () => 2
            },
        })
        const failure = run(
            new Chain(new Value(), { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )
        expect(failure.message).to.be(
            "Managed class methods must be data properties",
        )
        expect(reported).to.be(undefined)
    })

    it("rejects synchronous same-execution reentry from a managed-class method", () => {
        let testContext
        let reported
        testContext = { execution: new Execution(error => {
            reported = error
        }), errorContext: "test operation" }
        const observed = new Chain({ value: 1 }, { ...testContext, errorContext: "test Chain initialization" })
        class Value {
            read() {
                return readPath(observed, [], testContext)
            }
        }
        managedStateClass(Value)
        const failure = thrownBy(() => run(
            new Chain(new Value(), { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        ))
        expect(failure.message).to.be(
            "Cascada execution cannot be re-entered from external code",
        )
        expect(reported).to.be(failure)
    })

    it("prepares the complete observed receiver under a lease", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Line {
            length() {
                return this.start.x + this.start.y
            }
        }
        managedStateClass(Line)
        const pending = deferred()
        const line = new Line()
        line.start = { x: pending.promise, y: 2 }
        const chain = new Chain(line, { ...testContext, errorContext: "test Chain initialization" })

        const result = run(chain, [], "length", [], { ...testContext, errorContext: "test run" }, { repair: false })
        assignPath(chain, ["start", "y"], 5, testContext)
        pending.resolve(1)

        expect(await result).to.be(3)
        expect(line.start.y).to.be(2)
        expect(chain._state.value.start.y).to.be(5)
    })

    it("returns a nested receiver Error without invoking an observation", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("invalid receiver")
        let invoked = false
        class Value {
            read() {
                invoked = true
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.nested = { failure }

        expect(errorCause(run(
            new Chain(value, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )))
            .to.be(failure)
        expect(invoked).to.be(false)
    })

    it("exposes settled logical values without changing imported storage", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Vec {
            value() {
                return this.x
            }
        }
        managedStateClass(Vec)
        const pending = deferred()
        const source = new Vec()
        source.x = pending.promise
        importValue(source, { ...testContext, errorContext: "managed-class Promise state" })
        const result = run(
            new Chain(source, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "value",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        pending.resolve(4)

        expect(await result).to.be(4)
        expect(source.x).to.be(pending.promise)
    })

    it("mutates an owned receiver and returns the published receiver", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Vec {
            add(value) {
                this.x += value
                return this
            }
        }
        managedStateClass(Vec)
        const source = new Vec()
        source.x = 1
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })

        const result = run(chain, [], "add", [2], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(chain._state.value).not.to.be(source)
        expect(result).to.be(chain._state.value)
        expect(result.x).to.be(3)
        expect(source.x).to.be(1)
        expect(requiresCopyOnWrite(result, testContext)).to.be(true)
    })

    it("copies a protected receiver before direct class mutation", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Vec {
            add(value) {
                this.x += value
                return this.x
            }
        }
        managedStateClass(Vec)
        const source = importValue(new Vec(), { ...testContext, errorContext: "shared managed-class receiver" })
        source.x = 1
        importValue(source, { ...testContext, errorContext: "shared managed-class receiver" })
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })

        expect(run(chain, [], "add", [2], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })).to.be(3)
        expect(chain._state.value).not.to.be(source)
        expect(chain._state.value instanceof Vec).to.be(true)
        expect(chain._state.value.x).to.be(3)
        expect(source.x).to.be(1)
    })

    it("returns the published copy when a protected mutation returns this", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Vec {
            add(value) {
                this.x += value
                return this
            }
        }
        managedStateClass(Vec)
        const source = new Vec()
        source.x = 1
        lookupPath(new Chain(source, { ...testContext, errorContext: "test Chain initialization" }), [], testContext)
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })

        const result = run(chain, [], "add", [2], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(result).to.be(chain._state.value)
        expect(result).not.to.be(source)
        expect(result.x).to.be(3)
        expect(source.x).to.be(1)
        expect(requiresCopyOnWrite(result, testContext)).to.be(true)
    })

    it("isolates the complete receiver including protected descendants", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Line {
            move() {
                this.start.x++
            }
        }
        managedStateClass(Line)
        const start = { x: 1 }
        lookupPath(new Chain(start, { ...testContext, errorContext: "test Chain initialization" }), [], testContext)
        const line = new Line()
        line.start = start
        const chain = new Chain(line, { ...testContext, errorContext: "test Chain initialization" })

        run(chain, [], "move", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(chain._state.value).not.to.be(line)
        expect(chain._state.value.start).not.to.be(start)
        expect(chain._state.value.start.x).to.be(2)
        expect(start.x).to.be(1)
    })

    it("isolates a managed-class mutation beneath a shared ancestor", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            change() {
                return ++this.x
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.x = 1
        const source = { value }
        lookupPath(new Chain(source, { ...testContext, errorContext: "test Chain initialization" }), [], testContext)
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })

        expect(run(chain, ["value"], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 1 })).to.be(2)
        expect(chain._state.value).not.to.be(source)
        expect(chain._state.value.value).not.to.be(value)
        expect(chain._state.value.value.x).to.be(2)
        expect(source.value).to.be(value)
        expect(value.x).to.be(1)
    })

    it("exports managed arguments independently", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Line {
            setStart(options) {
                this.start = options.point
            }
        }
        managedStateClass(Line)
        const point = { x: 1 }
        const options = { point }
        const line = new Line()
        const chain = new Chain(line, { ...testContext, errorContext: "test Chain initialization" })

        run(chain, [], "setStart", [options], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(chain._state.value.start).not.to.be(point)
        expect(chain._state.value.start).to.eql(point)
        expect(metaOf(point, testContext).readLeaseCount).to.be(undefined)
    })

    it("isolates an argument retained by a later managed-class mutation", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Line {
            setStart(start) {
                this.start = start
            }

            move() {
                this.start.x++
            }
        }
        managedStateClass(Line)
        const start = { x: 1 }
        const line = new Line()
        const chain = new Chain(line, { ...testContext, errorContext: "test Chain initialization" })

        run(chain, [], "setStart", [start], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
        run(chain, [], "move", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(chain._state.value.start).not.to.be(start)
        expect(chain._state.value.start.x).to.be(2)
        expect(start.x).to.be(1)
    })

    it("stores a private logical copy of a materialized argument", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Holder {
            setValue(value) {
                this.value = value
            }
        }
        managedStateClass(Holder)
        const pending = deferred()
        const argument = { value: pending.promise }
        importValue(argument, { ...testContext, errorContext: "managed-class argument" })
        const holder = new Holder()
        const chain = new Chain(holder, { ...testContext, errorContext: "test Chain initialization" })

        const result = run(chain, [], "setValue", [argument], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
        pending.resolve(3)
        await result

        expect(chain._state.value.value).not.to.be(argument)
        expect(chain._state.value.value.value).to.be(3)
        expect(argument.value).to.be(pending.promise)
    })

    it("does not cross-remap receiver and argument identities", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Line {
            move(options) {
                this.same = this.start === options.point
                this.start.x++
            }
        }
        managedStateClass(Line)
        const point = { x: 1 }
        const options = { point }
        const line = new Line()
        line.start = point
        const chain = new Chain(line, { ...testContext, errorContext: "test Chain initialization" })

        run(chain, [], "move", [options], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(chain._state.value.same).to.be(false)
        expect(chain._state.value.start).not.to.be(point)
        expect(chain._state.value.start.x).to.be(2)
        expect(point.x).to.be(1)
        expect(options.point).to.be(point)
    })

    it("poisons the complete mutation receiver for a nested Error", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            read() {
                return 1
            }

            change() {
                this.changed = true
            }
        }
        managedStateClass(Value)
        const failure = new Error("nested failure")
        const source = new Value()
        source.child = { failure }

        expect(errorCause(run(
            new Chain(source, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )))
            .to.be(failure)
        expect(metaOf(source, testContext).readLeaseCount).to.be(undefined)
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })
        const mutationFailure = run(
            chain,
            [],
            "change",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        )
        expect(errorCause(mutationFailure)).to.be(failure)
        expect(chain._state.value).to.be(mutationFailure)
        expect(source.changed).to.be(undefined)
        expect(metaOf(source, testContext).readLeaseCount).to.be(undefined)
    })

    it("combines every original input Error once", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            read() {
                throw new Error("must not invoke")
            }
        }
        managedStateClass(Value)
        const receiverErrors = [
            new Error("receiver one"),
            new Error("receiver two"),
        ]
        const argumentError = new Error("argument")
        const source = new Value()
        source.first = receiverErrors[0]
        source.second = receiverErrors[1]

        const result = run(
            new Chain(source, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [{ error: argumentError }],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        expect(result.errors).to.have.length(3)
        assert.deepEqual(new Set(result.errors.map(errorCause)), new Set([
            ...receiverErrors,
            argumentError,
        ]))
        for (const error of result.errors) {
            const argument = errorCause(error) === argumentError
            assert.equal(error.errorContext, argument ? "test run" : "test Chain initialization")
            assert.equal(error.kind, argument ? runtime.ERROR_KIND.OperationInputFailed : runtime.ERROR_KIND.ChainValueFailed)
        }
    })

    it("collects pending receiver and argument Errors regardless of settlement order", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const receiverFailure = new Error("receiver")
        const argumentFailure = new Error("argument")
        const receiverValue = deferred()
        const argumentValue = deferred()
        const source = {
            failure: receiverValue.promise,
            read() {},
        }
        const result = run(
            new Chain(source, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [{ failure: argumentValue.promise }],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        argumentValue.resolve(argumentFailure)
        receiverValue.resolve(receiverFailure)

        const errors = (await result).errors
        expect(errors).to.have.length(2)
        assert.deepEqual(new Set(errors.map(errorCause)), new Set([
            receiverFailure,
            argumentFailure,
        ]))
        for (const error of errors) {
            const argument = errorCause(error) === argumentFailure
            assert.equal(error.errorContext, argument ? "test run" : "test Chain initialization")
            assert.equal(error.kind, argument ? runtime.ERROR_KIND.OperationInputFailed : runtime.ERROR_KIND.ChainValueFailed)
        }
    })

    it("rejects invalid completed state and awaits a direct result Promise", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            leavePromise() {
                this.value = Promise.resolve(1)
            }

            returnPromise() {
                this.value++
                return Promise.resolve(this.value)
            }
        }
        managedStateClass(Value)

        const invalid = new Value()
        const invalidChain = new Chain(invalid, { ...testContext, errorContext: "test Chain initialization" })
        expect(run(
            invalidChain,
            [],
            "leavePromise",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        ) instanceof Error).to.be(true)
        expect(invalidChain._state.value instanceof Error).to.be(true)

        const valid = new Value()
        valid.value = 1
        const validChain = new Chain(valid, { ...testContext, errorContext: "test Chain initialization" })
        const result = run(
            validChain,
            [],
            "returnPromise",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        )
        expect(result instanceof Promise).to.be(true)
        expect(readPath(validChain, [], testContext) instanceof Promise).to.be(true)
        expect(await result).to.be(2)
        expect(validChain._state.value).not.to.be(valid)
        expect(validChain._state.value.value).to.be(2)
    })

    it("poisons a mutation receiver when its method returns an Error", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const resultError = new Error("method result")
        class Value {
            change() {
                this.value++
                return resultError
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.value = 1
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })

        expect(errorCause(run(
            chain,
            [],
            "change",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        ))).to.be(resultError)
        expect(chain._state.value.cause).to.be(resultError)
        expect(value.value).to.be(1)
    })

    it("attributes an Error added inside an admitted mutation result", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cause = new Error("detached result failure")
        class Value {
            constructor() {
                this.result = { value: 1 }
            }

            detachResult() {
                const result = this.result
                delete this.result
                result.failure = cause
                return result
            }
        }
        managedStateClass(Value)
        const value = new Value()
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })

        const result = run(
            chain,
            [],
            "detachResult",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        )
        const failure = lookupPath(new Chain(result, { ...testContext, errorContext: "test Chain initialization" }), ["failure"], testContext)

        expect(failure.cause).to.be(cause)
        expect(failure.errorContext).to.be("test run")
        expect(failure.kind).to.be(runtime.ERROR_KIND.InvocationFailed)
        expect(chain._state.value).not.to.be(value)
        expect(Object.hasOwn(chain._state.value, "result")).to.be(false)
    })

    it("keeps a direct mutation Promise private through fulfillment", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const completion = deferred()
        const resultError = new Error("result")
        const value = {
            count: 1,
            change(start) {
                this.count++
                return start()
            },
        }
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })

        const result = run(
            chain,
            [],
            "change",
            [() => completion.promise],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        )
        expect(readPath(chain, [], testContext) instanceof Promise).to.be(true)
        completion.resolve(resultError)

        expect(errorCause(await result)).to.be(resultError)
        expect(chain._state.value.cause).to.be(resultError)
        expect(value.count).to.be(1)
    })

    it("poisons a direct mutation Promise rejection without making it fatal", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const completion = deferred()
        const argument = deferred()
        const failure = new Error("rejected mutation")
        const value = {
            change(_argument, start) {
                this.changed = true
                return start()
            },
        }
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })
        const result = run(
            chain,
            [],
            "change",
            [
                argument.promise,
                () => completion.promise,
            ],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        )
        argument.resolve("ready")
        await flushMicrotasks()
        completion.reject(failure)
        const rejection = await result.catch(error => error)
        expect(errorCause(rejection)).to.be(failure)
        expect(chain._state.value).to.be(rejection)
    })

    it("protects an observation receiver through direct rejection", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const completion = deferred()
        const failure = new Error("observation rejected")
        const value = {
            child: { value: 1 },
            read(start) {
                return start().then(() => this.child.value)
            },
        }
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })
        const result = run(
            chain,
            [],
            "read",
            [() => completion.promise],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        expect(metaOf(value, testContext).readLeaseCount).to.be(1)
        assignPath(chain, ["child", "value"], 2, testContext)
        completion.reject(failure)

        expect(errorCause(await result.catch(error => error))).to.be(failure)
        expect(value.child.value).to.be(1)
        expect(chain._state.value.child.value).to.be(2)
        expect(metaOf(value, testContext).readLeaseCount).to.be(undefined)
        expect(metaOf(value.child, testContext).readLeaseCount).to.be(undefined)
    })

    it("publishes direct receiver results before a following mutation", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const completion = deferred()
        class Value {
            change(start) {
                this.value++
                return start().then(() => this)
            }

            add(amount) {
                this.value += amount
                return this.value
            }
        }
        managedStateClass(Value)
        const source = new Value()
        source.value = 1
        lookupPath(new Chain(source, { ...testContext, errorContext: "test Chain initialization" }), [], testContext)
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })

        const first = run(
            chain,
            [],
            "change",
            [() => completion.promise],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        )
        const second = run(chain, [], "add", [10], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
        completion.resolve()

        const firstReceiver = await first
        expect(firstReceiver.value).to.be(2)
        expect(firstReceiver).not.to.be(source)
        expect(await second).to.be(12)
        expect(chain._state.value).not.to.be(firstReceiver)
        expect(chain._state.value.value).to.be(12)
        expect(source.value).to.be(1)
    })

    it("publishes receiver validation failure after direct completion", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const completion = deferred()
        const value = {
            change(start) {
                this.invalid = Promise.resolve(1)
                return start()
            },
        }
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })

        const result = run(
            chain,
            [],
            "change",
            [() => completion.promise],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        )
        completion.resolve("done")
        const failure = await result

        expect(failure instanceof Error).to.be(true)
        expect(chain._state.value).to.be(failure)
    })

    for (const shape of ["root", "existing child", "new child", "stored Promise"]) {
        for (const pending of [false, true]) {
            it("rejects " + shape + " then after " + (pending ? "pending" : "ready") + " managed completion", async () => {
                let testContext
                const execution = (testContext = { execution: new Execution(), errorContext: "test operation" }).execution
                let calls = 0
                const then = resolve => { calls++; return resolve(99) }
                const value = {
                    child: {},
                    change() {
                        const mutate = () => {
                            if (shape === "stored Promise") this.child = Promise.resolve(99)
                            else if (shape === "new child") this.child = { then }
                            else if (shape === "existing child") this.child.then = then
                            else this.then = then
                            return !pending && shape === "root" ? this : "done"
                        }
                        return pending ? Promise.resolve().then(mutate) : mutate()
                    },
                }
                const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })
                const result = run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
                const failure = pending ? await result : result
                expect(failure).to.be.a(runtime.PoisonError)
                expect(failure.kind).to.be(runtime.ERROR_KIND.InvalidManagedReceiver)
                expect(chain._state.value).to.be(failure)
                expect(calls).to.be(0)
                expect(execution.fatalError).to.be(null)
            })
        }
    }

    it("keeps other receiver Errors alongside a callable then placement", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const cause = new Error("stored failure")
        const value = {
            change() {
                this.then = resolve => resolve(1)
                this.bad = cause
            },
        }
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })
        const failure = run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
        expect(failure).to.be.a(runtime.CompoundPoisonError)
        expect(failure.errors.some(error => error.cause === cause)).to.be(true)
        expect(failure.errors.some(error => error.kind === runtime.ERROR_KIND.InvalidManagedReceiver)).to.be(true)
        expect(chain._state.value).to.be(failure)
    })

    it("preserves non-callable then placements through mutation and export", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const value = {
            child: {},
            change() {
                this.child.then = 12
                this.then = 42
                return Promise.resolve("done")
            },
        }
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })
        expect(await run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })).to.be("done")
        expect(await lookupPath(chain, ["child"], testContext)).to.eql({ then: 12 })
        const exported = await exportValue(chain, [], testContext)
        expect(exported.then).to.be(42)
        expect(exported.child.then).to.be(12)
        verifyRefCounts(testContext, chain._state)
    })

    it("recognizes a new stored thenable through a stable getter without subscribing", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        let reads = 0, calls = 0
        const then = resolve => { calls++; return resolve(1) }
        const chain = new Chain({ change() {
            this.child = { get then() { reads++; return then } }
        } }, { ...testContext, errorContext: "test Chain initialization" })
        const failure = run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
        expect(failure.kind).to.be(runtime.ERROR_KIND.InvalidManagedReceiver)
        expect(chain._state.value).to.be(failure)
        expect(reads).to.be(1)
        expect(calls).to.be(0)
    })

    it("reuses admitted prototype safety during managed receiver validation", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        let inspections = 0
        const prototype = new Proxy({ change() { this.count++; return this.count } }, {
            getOwnPropertyDescriptor(target, key) {
                if (key === "then") inspections++
                return Reflect.getOwnPropertyDescriptor(target, key)
            },
        })
        const value = Object.assign(Object.create(prototype), { count: 1 })
        runtime.managedState(value)
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })
        const baseline = inspections
        expect(run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })).to.be(2)
        expect(inspections).to.be(baseline)
    })

    it("poisons receiver validation reflection failures", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("receiver reflection failed")
        const target = { fail: false }
        const traps = {
            ownKeys(value) {
                if (value.fail) throw failure
                return Reflect.ownKeys(value)
            },
        }
        class Value {
            change() {
                this.state = new Proxy(this.state, traps)
                this.state.fail = true
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.state = target
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })

        const validationFailure = run(
            chain,
            [],
            "change",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        )
        expect(errorCause(validationFailure)).to.be(failure)
        expect(chain._state.value).to.be(validationFailure)
    })

    it("poisons a mutation when the mutator throws", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("mutator failed")
        class Value {
            change() {
                this.changed = true
                throw failure
            }
        }
        managedStateClass(Value)
        const source = new Value()
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })

        const mutationFailure = run(
            chain,
            [],
            "change",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        )
        expect(errorCause(mutationFailure)).to.be(failure)
        expect(chain._state.value).to.be(mutationFailure)
    })

    it("retains exact admitted identities returned by an observation", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Point {
            constructor(x) {
                this.x = x
            }
        }
        class Holder {
            result() {
                const result = { point: this.point }
                result.self = result
                return result
            }
        }
        managedStateClass(Point)
        managedStateClass(Holder)
        const holder = new Holder()
        holder.point = new Point(1)

        const result = run(
            new Chain(holder, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "result",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        expect(result.self).to.be(result)
        expect(result.point).to.be(holder.point)
        expect(result.point instanceof Point).to.be(true)
        const chain = new Chain(holder, { ...testContext, errorContext: "test Chain initialization" })
        assignPath(chain, ["point", "x"], 2, testContext)
        expect(result.point.x).to.be(1)
        expect(chain._state.value.point.x).to.be(2)
    })

    it("shares an exact mutation result through ordinary COW", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Holder {
            change() {
                this.point.x++
                return this.point
            }
        }
        managedStateClass(Holder)
        const holder = new Holder()
        holder.point = { x: 1 }
        const chain = new Chain(holder, { ...testContext, errorContext: "test Chain initialization" })

        const result = run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(result).to.be(chain._state.value.point)
        expect(result.x).to.be(2)
        run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
        expect(result.x).to.be(2)
        expect(chain._state.value.point).not.to.be(result)
        expect(chain._state.value.point.x).to.be(3)
    })

    it("protects descendants retained by a detached mutation result", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Holder {
            detach() {
                const result = this.wrapper
                this.child = result.branch.child
                delete this.wrapper
                return result
            }

            change() {
                this.child.value++
            }
        }
        managedStateClass(Holder)
        const child = { value: 1 }
        const holder = new Holder()
        holder.wrapper = { branch: { child } }
        const chain = new Chain(holder, { ...testContext, errorContext: "test Chain initialization" })

        const result = run(chain, [], "detach", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
        expect(result.branch.child).to.be(chain._state.value.child)

        run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(result.branch.child).not.to.be(chain._state.value.child)
        expect(result.branch.child.value).to.be(1)
        expect(chain._state.value.child.value).to.be(2)
    })

    it("shares a mutation receiver nested in its result", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            change() {
                this.x++
                return { me: this }
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.x = 1
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })

        const result = run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(result.me).to.be(chain._state.value)
        expect(result.me instanceof Value).to.be(true)
        expect(result.me.x).to.be(2)
        run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
        expect(result.me.x).to.be(2)
        expect(chain._state.value).not.to.be(result.me)
        expect(chain._state.value.x).to.be(3)
    })

    it("keeps external identities and Functions exact in imported results", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class External {}
        const external = new External()
        const fn = () => {}
        class Holder {
            result() {
                return { external: this.external, fn: this.fn }
            }
        }
        managedStateClass(Holder)
        const holder = new Holder()
        holder.external = external
        holder.fn = fn

        const result = run(
            new Chain(holder, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "result",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        expect(result.external).to.be(external)
        expect(result.fn).to.be(fn)
    })

    it("keeps result-import reflection failure independent from mutation", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const failure = new Error("result reflection failed")
        const result = new Proxy({}, {
            ownKeys() {
                throw failure
            },
        })
        class Value {
            change() {
                this.value++
                return result
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.value = 1
        const chain = new Chain(value, { ...testContext, errorContext: "test Chain initialization" })

        expect(errorCause(run(
            chain,
            [],
            "change",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false, mutationScopeDepth: 0 },
        ))).to.be(failure)
        expect(chain._state.value).not.to.be(value)
        expect(chain._state.value.value).to.be(2)
        expect(value.value).to.be(1)
    })

    it("awaits direct Promise results and retains nested Promise results", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            direct() {
                return Promise.resolve(1)
            }

            nested() {
                return { value: Promise.resolve(1) }
            }
        }
        managedStateClass(Value)
        const chain = new Chain(new Value(), { ...testContext, errorContext: "test Chain initialization" })

        expect(await run(chain, [], "direct", [], { ...testContext, errorContext: "test run" }, { repair: false })).to.be(1)
        const nested = run(chain, [], "nested", [], { ...testContext, errorContext: "test run" }, { repair: false })
        expect(nested instanceof Promise).to.be(false)
        expect(await readPath(new Chain(nested, { ...testContext, errorContext: "test Chain initialization" }), ["value"], testContext)).to.be(1)
    })

    for (const projection of ["entry", "slice", "extended backing"]) {
        it(`materializes observational Array receivers only when storage differs: ${projection}`, () => {
            const ctx = { execution: new runtime.Execution(), errorContext: {} }
            const items = [1, 2], array = new runtime.Chain(items, ctx)
            if (projection === "entry") runtime.enter(array, [5], ctx, true, () => undefined)
            else runtime.run(array, [], projection === "slice" ? "slice" : "concat",
                projection === "slice" ? [] : [[3]], ctx, {})
            let observed
            const receiver = new runtime.Chain({ items, inspect() {
                observed = this.items
                return this.items.length
            } }, ctx)

            assert.equal(runtime.run(receiver, [], "inspect", [], ctx, {}), 2)
            assert.equal(observed === items, projection !== "extended backing")
            assert.deepEqual(observed, [1, 2])
        })
    }

    it("materializes logical Arrays before managed external code", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        const source = [1, , 3]
        const view = run(
            new Chain(source, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "slice",
            [0, 3],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )
        class Holder {
            inspect() {
                return Array.isArray(this.items) && !(1 in this.items)
            }

            append() {
                this.native = Array.isArray(this.items)
                this.items.push(4)
            }
        }
        managedStateClass(Holder)
        const holder = new Holder()
        holder.items = view
        const sibling = {}
        holder.sibling = sibling

        expect(run(
            new Chain(holder, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "inspect",
            [],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )).to.be(true)
        expect(requiresCopyOnWrite(sibling, testContext)).to.be(false)
        const chain = new Chain(holder, { ...testContext, errorContext: "test Chain initialization" })
        run(chain, [], "append", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(chain._state.value.native).to.be(true)
        expect(Array.isArray(chain._state.value.items)).to.be(true)
        expect(chain._state.value.items).to.eql([1, , 3, 4])
        expect(run(
            new Chain(view, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "join",
            [","],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )).to.be("1,,3")
    })

    it("replaces an indexed receiver with an unindexed working copy", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            change() {
                this.value++
            }
        }
        managedStateClass(Value)
        const source = new Value()
        source.value = 1
        source.child = { stable: true }
        new Chain(source, testContext)
        buildRefIndex(source, testContext)
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })

        run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(chain._state.value).not.to.be(source)
        expect(source.value).to.be(1)
        expect(chain._state.value.value).to.be(2)
        verifyRefCounts(testContext, source, chain._state.value)
    })

    it("copies a live-Promise version owner before direct mutation", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            change() {
                this.changed = true
            }
        }
        managedStateClass(Value)
        const pending = deferred()
        const source = new Value()
        source.pending = pending.promise
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })
        const result = run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        pending.resolve(1)
        await result

        expect(chain._state.value).not.to.be(source)
        expect(chain._state.value.changed).to.be(true)
        expect(source.changed).to.be(undefined)
    })

    it("remaps earlier sibling aliases copied through a later branch", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Holder {
            change() {
                this.later.child.value++
            }
        }
        managedStateClass(Holder)
        const child = { value: 1 }
        const later = { child }
        lookupPath(new Chain(later, { ...testContext, errorContext: "test Chain initialization" }), [], testContext)
        const holder = new Holder()
        holder.earlier = child
        holder.later = later
        const chain = new Chain(holder, { ...testContext, errorContext: "test Chain initialization" })

        run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        expect(chain._state.value.earlier).to.be(chain._state.value.later.child)
        expect(chain._state.value.earlier).not.to.be(child)
        expect(chain._state.value.earlier.value).to.be(2)
        expect(child.value).to.be(1)
    })

    it("expands a descendant copy through a receiver cycle", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Holder {
            change() {
                this.child.value++
            }
        }
        managedStateClass(Holder)
        const holder = new Holder()
        const child = { value: 1, parent: holder }
        holder.child = child
        lookupPath(new Chain(child, { ...testContext, errorContext: "test Chain initialization" }), [], testContext)
        const chain = new Chain(holder, { ...testContext, errorContext: "test Chain initialization" })

        run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        const copy = chain._state.value
        expect(copy).not.to.be(holder)
        expect(copy.child.parent).to.be(copy)
        expect(copy.child.value).to.be(2)
        expect(holder.child).to.be(child)
        expect(child.parent).to.be(holder)
    })

    it("preserves cycles when a protected receiver is copied", () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Cyclic {
            change() {
                this.value++
            }
        }
        managedStateClass(Cyclic)
        const source = new Cyclic()
        source.value = 1
        source.self = source
        lookupPath(new Chain(source, { ...testContext, errorContext: "test Chain initialization" }), [], testContext)
        const chain = new Chain(source, { ...testContext, errorContext: "test Chain initialization" })

        run(chain, [], "change", [], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })

        const copy = chain._state.value
        expect(copy).not.to.be(source)
        expect(copy.self).to.be(copy)
        expect(copy.value).to.be(2)
        expect(source.self).to.be(source)
        expect(source.value).to.be(1)
    })

    it("orders mutations behind pending managed preparation", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Counter {
            add(value) {
                this.value += value
                return this.value
            }
        }
        managedStateClass(Counter)
        const counter = new Counter()
        counter.value = 0
        const chain = new Chain(counter, { ...testContext, errorContext: "test Chain initialization" })
        const pending = deferred()

        const first = run(chain, [], "add", [pending.promise], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
        const second = run(chain, [], "add", [1], { ...testContext, errorContext: "test run" }, { repair: false, mutationScopeDepth: 0 })
        pending.resolve(1)

        expect(await first).to.be(1)
        expect(await second).to.be(2)
        expect(chain._state.value.value).to.be(2)
        await flushMicrotasks()
    })

    it("abandons a late argument after fatal receiver preparation", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            read() {}
        }
        managedStateClass(Value)
        const receiverValue = deferred()
        const argument = deferred()
        let fail = false
        const broken = new Proxy({}, {
            ownKeys() {
                if (fail) submitFatal(testContext, new Error("receiver failed"))
                return []
            },
        })
        importValue(broken, { ...testContext, errorContext: "prepared fatal receiver child" })
        fail = true
        const receiver = new Value()
        receiver.child = receiverValue.promise
        const result = run(
            new Chain(receiver, { ...testContext, errorContext: "test Chain initialization" }),
            [],
            "read",
            [argument.promise],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        receiverValue.resolve(broken)
        expect(await result.catch(error => error)).to.be.a(Error)

        let reflected = false
        argument.resolve(new Proxy({}, {
            getPrototypeOf(target) {
                reflected = true
                return Reflect.getPrototypeOf(target)
            },
        }))
        await flushMicrotasks()

        expect(reflected).to.be(false)
        expect(metaOf(receiver, testContext).readLeaseCount).to.be(1)
    })

    it("abandons late receiver work after fatal argument preparation", async () => {
        const testContext = { execution: new Execution(), errorContext: "test operation" }
        class Value {
            read() {}
        }
        managedStateClass(Value)
        const receiverValue = deferred()
        const argument = deferred()
        let fail = false
        const broken = new Proxy({}, {
            ownKeys() {
                if (fail) submitFatal(testContext, new Error("argument failed"))
                return []
            },
        })
        importValue(broken, { ...testContext, errorContext: "prepared fatal argument" })
        fail = true
        const receiver = new Value()
        receiver.child = receiverValue.promise
        const chain = new Chain(receiver, { ...testContext, errorContext: "test Chain initialization" })
        const result = run(
            chain,
            [],
            "read",
            [argument.promise],
            { ...testContext, errorContext: "test run" },
            { repair: false },
        )

        argument.resolve(broken)
        expect(await result.catch(error => error)).to.be.a(Error)

        let reflected = false
        const late = new Proxy({}, {
            ownKeys() {
                reflected = true
                return []
            },
        })
        receiverValue.resolve(late)
        await flushMicrotasks()

        expect(reflected).to.be(false)
        expect(metaOf(receiver, testContext).placementVersions.child.value)
            .to.be(receiverValue.promise)
        expect(metaOf(receiver, testContext).readLeaseCount).to.be(1)
        expect(metaOf(late, testContext)).to.be(undefined)
    })
})
