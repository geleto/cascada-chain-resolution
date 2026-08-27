import { runInNewContext } from "node:vm"

import {
    assignPath,
    Chain,
    buildRefIndex,
    deferred,
    expect,
    flushMicrotasks,
    importValue,
    lookupPath,
    metaOf,
    readPath,
    managedStateClass,
    reportFatalError,
    run,
    setFatalErrorReporter,
    thrownBy,
    verifyRefCounts,
} from "./support.js"

describe("registered class invocation", () => {
    it("rejects prototype accessors and excludes Object.prototype methods", () => {
        class WithAccessor {
            get value() {
                return 1
            }
        }
        expect(
            managedStateClass(WithAccessor) instanceof TypeError,
        ).to.be(true)

        class Value {}
        managedStateClass(Value)
        expect(run(
            new Chain(new Value()),
            [],
            "toString",
            false,
        ) instanceof Error).to.be(true)
    })

    it("ends foreign class lookup before its Object prototype", () => {
        const { Foreign, value } = runInNewContext(`
            class Foreign {
                read() { return this.value }
            }
            ({ Foreign, value: Object.assign(new Foreign(), { value: 3 }) })
        `)
        managedStateClass(Foreign)

        expect(run(new Chain(value), [], "read", false)).to.be(3)
        expect(run(
            new Chain(value),
            [],
            "toString",
            false,
        ) instanceof Error).to.be(true)
    })

    it("prepares receiver state before reporting a missing method", async () => {
        class Value {}
        managedStateClass(Value)
        const pending = deferred()
        const value = new Value()
        value.pending = pending.promise

        const result = run(new Chain(value), [], "missing", false)

        expect(result instanceof Promise).to.be(true)
        pending.resolve(1)
        expect((await result).message).to.be("Method is not callable: missing")
    })

    it("rejects a language property that shadows a registered-class method", () => {
        class Value {
            read() {
                return 1
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.read = () => 2

        expect(run(new Chain(value), [], "read", false).message).to.be(
            "Cannot call read because an own data property with that name " +
            "hides the method",
        )
    })

    it("ignores an own non-placement during method selection", () => {
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

        expect(run(new Chain(value), [], "read", false)).to.be(1)
        expect(accessed).to.be(false)
    })

    it("resolves a method only after clean preparation and before isolation", () => {
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
        const failed = new Chain(new Value())
        reflections.length = 0
        expect(run(
            failed,
            [],
            "change",
            true,
            failure,
        )).to.be(failure)
        expect(reflections).to.eql([])

        const receiverFailure = new Error("invalid receiver")
        const invalid = new Value()
        invalid.failure = receiverFailure
        const invalidChain = new Chain(invalid)
        reflections.length = 0
        expect(run(invalidChain, [], "change", true)).to.be(receiverFailure)
        expect(reflections).to.eql([])

        const value = new Proxy(new Value(), {
            ownKeys(target) {
                reflections.push("receiver")
                return Reflect.ownKeys(target)
            },
        })
        const chain = new Chain(value)
        lookupPath(chain, [])
        reflections.length = 0

        run(chain, [], "change", true)

        expect(reflections).to.eql(["receiver", "method", "receiver"])
        expect(chain._state.value).not.to.be(value)
        expect(chain._state.value.value).to.be(2)
        expect(value.value).to.be(1)
    })

    it("reports a prototype accessor added after registration fatally", () => {
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
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })

        const failure = thrownBy(() => run(
            new Chain(new Value()),
            [],
            "read",
            false,
        ))
        setFatalErrorReporter()

        expect(failure.message).to.be(
            "Registered class prototype accessor changed",
        )
        expect(reported).to.be(failure)
    })

    it("rejects synchronous Cascada reentry from a registered-class method", () => {
        const observed = new Chain({ value: 1 })
        class Value {
            read() {
                return readPath(observed, [])
            }
        }
        managedStateClass(Value)
        let reported
        setFatalErrorReporter(error => {
            reported = error
        })

        const failure = thrownBy(() => run(
            new Chain(new Value()),
            [],
            "read",
            false,
        ))
        setFatalErrorReporter()

        expect(failure.message).to.be(
            "Cascada cannot be re-entered from supported user code",
        )
        expect(reported).to.be(failure)
    })

    it("prepares the complete observed receiver under a lease", async () => {
        class Line {
            length() {
                return this.start.x + this.start.y
            }
        }
        managedStateClass(Line)
        const pending = deferred()
        const line = new Line()
        line.start = { x: pending.promise, y: 2 }
        const chain = new Chain(line)

        const result = run(chain, [], "length", false)
        assignPath(chain, ["start", "y"], 5)
        pending.resolve(1)

        expect(await result).to.be(3)
        expect(line.start.y).to.be(2)
        expect(chain._state.value.start.y).to.be(5)
    })

    it("returns a nested receiver Error without invoking an observation", () => {
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

        expect(run(new Chain(value), [], "read", false)).to.be(failure)
        expect(invoked).to.be(false)
    })

    it("exposes settled logical values without changing imported storage", async () => {
        class Vec {
            value() {
                return this.x
            }
        }
        managedStateClass(Vec)
        const pending = deferred()
        const source = new Vec()
        source.x = pending.promise
        importValue(source, "registered-class Promise state")
        const result = run(new Chain(source), [], "value", false)

        pending.resolve(4)

        expect(await result).to.be(4)
        expect(source.x).to.be(pending.promise)
    })

    it("mutates an owned receiver and returns the published receiver", () => {
        class Vec {
            add(value) {
                this.x += value
                return this
            }
        }
        managedStateClass(Vec)
        const source = new Vec()
        source.x = 1
        const chain = new Chain(source)

        const result = run(chain, [], "add", true, 2)

        expect(chain._state.value).to.be(source)
        expect(result).to.be(source)
        expect(source.x).to.be(3)
        expect(metaOf(source).shared).to.be(true)
    })

    it("copies a protected receiver before direct class mutation", () => {
        class Vec {
            add(value) {
                this.x += value
                return this.x
            }
        }
        managedStateClass(Vec)
        const source = importValue(new Vec(), "shared registered-class receiver")
        source.x = 1
        importValue(source, "shared registered-class receiver")
        const chain = new Chain(source)

        expect(run(chain, [], "add", true, 2)).to.be(3)
        expect(chain._state.value).not.to.be(source)
        expect(chain._state.value instanceof Vec).to.be(true)
        expect(chain._state.value.x).to.be(3)
        expect(source.x).to.be(1)
    })

    it("returns the published copy when a protected mutation returns this", () => {
        class Vec {
            add(value) {
                this.x += value
                return this
            }
        }
        managedStateClass(Vec)
        const source = new Vec()
        source.x = 1
        lookupPath(new Chain(source), [])
        const chain = new Chain(source)

        const result = run(chain, [], "add", true, 2)

        expect(result).to.be(chain._state.value)
        expect(result).not.to.be(source)
        expect(result.x).to.be(3)
        expect(source.x).to.be(1)
        expect(metaOf(result).shared).to.be(true)
    })

    it("copies only a protected receiver descendant", () => {
        class Line {
            move() {
                this.start.x++
            }
        }
        managedStateClass(Line)
        const start = { x: 1 }
        lookupPath(new Chain(start), [])
        const line = new Line()
        line.start = start
        const chain = new Chain(line)

        run(chain, [], "move", true)

        expect(chain._state.value).to.be(line)
        expect(line.start).not.to.be(start)
        expect(line.start.x).to.be(2)
        expect(start.x).to.be(1)
    })

    it("isolates a registered-class mutation beneath a shared ancestor", () => {
        class Value {
            change() {
                return ++this.x
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.x = 1
        const source = { value }
        lookupPath(new Chain(source), [])
        const chain = new Chain(source)

        expect(run(chain, ["value"], "change", true)).to.be(2)
        expect(chain._state.value).not.to.be(source)
        expect(chain._state.value.value).not.to.be(value)
        expect(chain._state.value.value.x).to.be(2)
        expect(source.value).to.be(value)
        expect(value.x).to.be(1)
    })

    it("retains nested argument identities exactly and marks them shared", () => {
        class Line {
            setStart(options) {
                this.start = options.point
            }
        }
        managedStateClass(Line)
        const point = { x: 1 }
        const options = { point }
        const line = new Line()
        const chain = new Chain(line)

        run(chain, [], "setStart", true, options)

        expect(line.start).to.be(point)
        expect(metaOf(point).shared).to.be(true)
        expect(metaOf(point).readLeaseCount).to.be(undefined)
    })

    it("isolates an argument retained by a later registered-class mutation", () => {
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
        const chain = new Chain(line)

        run(chain, [], "setStart", true, start)
        run(chain, [], "move", true)

        expect(chain._state.value.start).not.to.be(start)
        expect(chain._state.value.start.x).to.be(2)
        expect(start.x).to.be(1)
    })

    it("stores a private logical copy of a materialized argument", async () => {
        class Holder {
            setValue(value) {
                this.value = value
            }
        }
        managedStateClass(Holder)
        const pending = deferred()
        const argument = { value: pending.promise }
        importValue(argument, "registered-class argument")
        const holder = new Holder()
        const chain = new Chain(holder)

        const result = run(chain, [], "setValue", true, argument)
        pending.resolve(3)
        await result

        expect(holder.value).not.to.be(argument)
        expect(holder.value.value).to.be(3)
        expect(argument.value).to.be(pending.promise)
    })

    it("remaps receiver aliases nested in arguments", () => {
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
        const chain = new Chain(line)

        run(chain, [], "move", true, options)

        expect(line.same).to.be(true)
        expect(line.start).not.to.be(point)
        expect(line.start.x).to.be(2)
        expect(point.x).to.be(1)
        expect(options.point).to.be(point)
    })

    it("poisons the complete mutation receiver for a nested Error", () => {
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

        expect(run(new Chain(source), [], "read", false)).to.be(failure)
        expect(metaOf(source).readLeaseCount).to.be(undefined)
        const chain = new Chain(source)
        expect(run(chain, [], "change", true)).to.be(failure)
        expect(chain._state.value).to.be(failure)
        expect(source.changed).to.be(undefined)
        expect(metaOf(source).readLeaseCount).to.be(undefined)
    })

    it("combines original input Errors once in call order", () => {
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
            new Chain(source),
            [],
            "read",
            false,
            { error: argumentError },
        )

        expect(result.errors).to.have.length(3)
        expect(result.errors.slice(0, 2).includes(receiverErrors[0])).to.be(true)
        expect(result.errors.slice(0, 2).includes(receiverErrors[1])).to.be(true)
        expect(result.errors[2]).to.be(argumentError)
    })

    it("rejects invalid completed state and independent Promise results", () => {
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
        const invalidChain = new Chain(invalid)
        expect(run(
            invalidChain,
            [],
            "leavePromise",
            true,
        ) instanceof Error).to.be(true)
        expect(invalidChain._state.value instanceof Error).to.be(true)

        const valid = new Value()
        valid.value = 1
        const validChain = new Chain(valid)
        expect(run(
            validChain,
            [],
            "returnPromise",
            true,
        ) instanceof Error).to.be(true)
        expect(validChain._state.value).to.be(valid)
        expect(valid.value).to.be(2)
    })

    it("publishes a valid mutation that deliberately returns an Error", () => {
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
        const chain = new Chain(value)

        expect(run(chain, [], "change", true)).to.be(resultError)
        expect(chain._state.value).to.be(value)
        expect(value.value).to.be(2)
    })

    it("poisons receiver validation reflection failures", () => {
        const failure = new Error("receiver reflection failed")
        const target = { fail: false }
        const state = new Proxy(target, {
            ownKeys(value) {
                if (value.fail) throw failure
                return Reflect.ownKeys(value)
            },
        })
        class Value {
            change() {
                this.state.fail = true
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.state = state
        const chain = new Chain(value)

        expect(run(chain, [], "change", true)).to.be(failure)
        expect(chain._state.value).to.be(failure)
    })

    it("poisons a mutation when the mutator throws", () => {
        const failure = new Error("mutator failed")
        class Value {
            change() {
                this.changed = true
                throw failure
            }
        }
        managedStateClass(Value)
        const source = new Value()
        const chain = new Chain(source)

        expect(run(chain, [], "change", true)).to.be(failure)
        expect(chain._state.value).to.be(failure)
    })

    it("copies every non-receiver traversable result independently", () => {
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

        const result = run(new Chain(holder), [], "result", false)

        expect(result.self).to.be(result)
        expect(result.point).not.to.be(holder.point)
        expect(result.point instanceof Point).to.be(true)
        result.point.x = 2
        expect(holder.point.x).to.be(1)
    })

    it("copies a mutation result independently from receiver state", () => {
        class Holder {
            change() {
                this.point.x++
                return this.point
            }
        }
        managedStateClass(Holder)
        const holder = new Holder()
        holder.point = { x: 1 }
        const chain = new Chain(holder)

        const result = run(chain, [], "change", true)

        expect(result).not.to.be(holder.point)
        expect(result.x).to.be(2)
        result.x = 3
        expect(holder.point.x).to.be(2)
    })

    it("copies a result containing the mutation receiver", () => {
        class Value {
            change() {
                this.x++
                return { me: this }
            }
        }
        managedStateClass(Value)
        const value = new Value()
        value.x = 1
        const chain = new Chain(value)

        const result = run(chain, [], "change", true)

        expect(result.me).not.to.be(value)
        expect(result.me instanceof Value).to.be(true)
        expect(result.me.x).to.be(2)
        result.me.x = 3
        expect(value.x).to.be(2)
    })

    it("keeps opaque identities and Functions exact in copied results", () => {
        class Opaque {}
        const opaque = new Opaque()
        const fn = () => {}
        class Holder {
            result() {
                return { opaque: this.opaque, fn: this.fn }
            }
        }
        managedStateClass(Holder)
        const holder = new Holder()
        holder.opaque = opaque
        holder.fn = fn

        const result = run(new Chain(holder), [], "result", false)

        expect(result.opaque).to.be(opaque)
        expect(result.fn).to.be(fn)
    })

    it("keeps result-copy reflection failure independent from mutation", () => {
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
        const chain = new Chain(value)

        expect(run(chain, [], "change", true)).to.be(failure)
        expect(chain._state.value).to.be(value)
        expect(value.value).to.be(2)
    })

    it("rejects direct and nested Promise observation results", () => {
        class Value {
            direct() {
                return Promise.resolve(1)
            }

            nested() {
                return { value: Promise.resolve(1) }
            }
        }
        managedStateClass(Value)
        const chain = new Chain(new Value())

        expect(run(chain, [], "direct", false) instanceof Error).to.be(true)
        expect(run(chain, [], "nested", false) instanceof Error).to.be(true)
    })

    it("materializes logical Arrays before registered-class host code", () => {
        const source = [1, , 3]
        const view = run(new Chain(source), [], "slice", false, 0, 3)
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

        expect(run(new Chain(holder), [], "inspect", false)).to.be(true)
        const chain = new Chain(holder)
        run(chain, [], "append", true)

        expect(holder.native).to.be(true)
        expect(Array.isArray(holder.items)).to.be(true)
        expect(holder.items).to.eql([1, , 3, 4])
        expect(run(new Chain(view), [], "join", false, ",")).to.be("1,,3")
    })

    it("replaces an indexed receiver with an unindexed working copy", () => {
        class Value {
            change() {
                this.value++
            }
        }
        managedStateClass(Value)
        const source = new Value()
        source.value = 1
        source.child = { stable: true }
        buildRefIndex(source)
        const chain = new Chain(source)

        run(chain, [], "change", true)

        expect(chain._state.value).not.to.be(source)
        expect(source.value).to.be(1)
        expect(chain._state.value.value).to.be(2)
        verifyRefCounts(source, chain._state.value)
    })

    it("copies a live-mirror owner before direct mutation", async () => {
        class Value {
            change() {
                this.changed = true
            }
        }
        managedStateClass(Value)
        const pending = deferred()
        const source = new Value()
        source.pending = pending.promise
        const chain = new Chain(source)
        const result = run(chain, [], "change", true)

        pending.resolve(1)
        await result

        expect(chain._state.value).not.to.be(source)
        expect(chain._state.value.changed).to.be(true)
        expect(source.changed).to.be(undefined)
    })

    it("remaps earlier sibling aliases copied through a later branch", () => {
        class Holder {
            change() {
                this.later.child.value++
            }
        }
        managedStateClass(Holder)
        const child = { value: 1 }
        const later = { child }
        lookupPath(new Chain(later), [])
        const holder = new Holder()
        holder.earlier = child
        holder.later = later
        const chain = new Chain(holder)

        run(chain, [], "change", true)

        expect(holder.earlier).to.be(holder.later.child)
        expect(holder.earlier).not.to.be(child)
        expect(holder.earlier.value).to.be(2)
        expect(child.value).to.be(1)
    })

    it("expands a descendant copy through a receiver cycle", () => {
        class Holder {
            change() {
                this.child.value++
            }
        }
        managedStateClass(Holder)
        const holder = new Holder()
        const child = { value: 1, parent: holder }
        holder.child = child
        lookupPath(new Chain(child), [])
        const chain = new Chain(holder)

        run(chain, [], "change", true)

        const copy = chain._state.value
        expect(copy).not.to.be(holder)
        expect(copy.child.parent).to.be(copy)
        expect(copy.child.value).to.be(2)
        expect(holder.child).to.be(child)
        expect(child.parent).to.be(holder)
    })

    it("preserves cycles when a protected receiver is copied", () => {
        class Cyclic {
            change() {
                this.value++
            }
        }
        managedStateClass(Cyclic)
        const source = new Cyclic()
        source.value = 1
        source.self = source
        lookupPath(new Chain(source), [])
        const chain = new Chain(source)

        run(chain, [], "change", true)

        const copy = chain._state.value
        expect(copy).not.to.be(source)
        expect(copy.self).to.be(copy)
        expect(copy.value).to.be(2)
        expect(source.self).to.be(source)
        expect(source.value).to.be(1)
    })

    it("orders mutations behind pending registered-class preparation", async () => {
        class Counter {
            add(value) {
                this.value += value
                return this.value
            }
        }
        managedStateClass(Counter)
        const counter = new Counter()
        counter.value = 0
        const chain = new Chain(counter)
        const pending = deferred()

        const first = run(chain, [], "add", true, pending.promise)
        const second = run(chain, [], "add", true, 1)
        pending.resolve(1)

        expect(await first).to.be(1)
        expect(await second).to.be(2)
        expect(chain._state.value.value).to.be(2)
        await flushMicrotasks()
    })

    it("abandons a late argument after fatal receiver preparation", async () => {
        class Value {
            read() {}
        }
        managedStateClass(Value)
        const receiverValue = deferred()
        const argument = deferred()
        let fail = false
        const broken = new Proxy({}, {
            ownKeys() {
                if (fail) reportFatalError(new Error("receiver failed"))
                return []
            },
        })
        importValue(broken, "prepared fatal receiver child")
        fail = true
        const receiver = new Value()
        receiver.child = receiverValue.promise
        const result = run(
            new Chain(receiver),
            [],
            "read",
            false,
            argument.promise,
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
        expect(metaOf(receiver).readLeaseCount).to.be(undefined)
    })

    it("abandons late receiver work after fatal argument preparation", async () => {
        class Value {
            read() {}
        }
        managedStateClass(Value)
        const receiverValue = deferred()
        const argument = deferred()
        let fail = false
        const broken = new Proxy({}, {
            ownKeys() {
                if (fail) reportFatalError(new Error("argument failed"))
                return []
            },
        })
        importValue(broken, "prepared fatal argument")
        fail = true
        const receiver = new Value()
        receiver.child = receiverValue.promise
        const chain = new Chain(receiver)
        const result = run(
            chain,
            [],
            "read",
            false,
            argument.promise,
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
        importValue(late, "prepared late receiver child")
        reflected = false
        receiverValue.resolve(late)
        await flushMicrotasks()

        expect(reflected).to.be(false)
        expect(readPath(chain, ["child"])).to.be(late)
        expect(metaOf(receiver).readLeaseCount).to.be(undefined)
        expect(metaOf(late).readLeaseCount).to.be(undefined)
        verifyRefCounts(chain._state.value)
    })
})
