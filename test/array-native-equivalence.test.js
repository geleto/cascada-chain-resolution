import assert from "node:assert/strict"

import { ARRAY_METHODS } from "../src/array-methods.js"
import * as arrayViews from "../src/array-view.js"
import {
    Chain,
    assignPath,
    deferred,
    deletePath,
    importValue,
    lookupPath,
    run,
    verifyRefCounts,
} from "./support.js"
import {
    VALUES,
    argumentsByArity,
    assertOutcome,
    assertValue,
    callNativeMethod,
    cloneData,
    createRandom,
    forEachNativeCase,
    hash,
    noArguments,
    pick,
    position,
    randomInteger,
    scenarioMessage,
} from "./native-equivalence-support.js"

const NUMERIC_COMPARATOR = (left, right) => Number(left) - Number(right)
const STRING_COMPARATOR = (left, right) => {
    left = String(left)
    right = String(right)
    return left < right ? -1 : left > right ? 1 : 0
}

// Keep oracle facts independent of the declarations they verify, so a bad
// declaration cannot silently remove the scenario that would expose it.
const ELEMENT_WAIT_METHODS = new Set([
    "join",
    "sort",
    "toSorted",
    "toString",
])
const STRUCTURAL_PROMISE_METHODS = new Set([
    "at",
    "concat",
    "copyWithin",
    "fill",
    "flat",
    "pop",
    "push",
    "reverse",
    "shift",
    "slice",
    "splice",
    "toReversed",
    "toSpliced",
    "unshift",
    "with",
])
const ARGUMENT_WAIT_METHODS = new Set([
    "at",
    "concat",
    "copyWithin",
    "flat",
    "includes",
    "indexOf",
    "join",
    "lastIndexOf",
    "slice",
    "sort",
    "splice",
    "toSorted",
    "toSpliced",
    "with",
])

const ARRAY_METHOD_FACTS = {
    at: { args: indexArguments },
    concat: { args: concatArguments },
    copyWithin: { args: rangeArguments, mutationArgs: [1, 0] },
    fill: { args: fillArguments, mutationArgs: [9] },
    flat: { args: flatArguments, source: generateNestedArray },
    includes: { args: searchArguments },
    indexOf: { args: searchArguments },
    join: { args: joinArguments, source: generateNestedArray },
    lastIndexOf: { args: searchArguments },
    pop: { args: noArguments, mutationArgs: [] },
    push: { args: valueArguments, mutationArgs: [9] },
    reverse: { args: noArguments, mutationArgs: [] },
    shift: { args: noArguments, mutationArgs: [] },
    slice: { args: rangeArguments },
    sort: { args: sortArguments, mutationArgs: [] },
    splice: { args: spliceArguments, mutationArgs: [1, 1, 9] },
    toReversed: { args: noArguments },
    toSorted: { args: sortArguments },
    toSpliced: { args: spliceArguments },
    toString: { args: noArguments, source: generateNestedArray },
    unshift: { args: valueArguments, mutationArgs: [9] },
    with: { args: withArguments },
}

const ARRAY_MODES = [
    { name: "observation", cases: 16 },
    {
        name: "promised receiver observation",
        cases: 4,
        promiseReceiver: true,
    },
    {
        name: "promised arguments observation",
        cases: 4,
        promiseArguments: true,
        supports: scenario => scenario.args.length > 0,
    },
    {
        name: "Promise element observation",
        cases: 4,
        promiseElements: "first",
        shapeSource: ensurePresentElement,
    },
    {
        name: "mixed Promise frontier observation",
        cases: 2,
        promiseArguments: true,
        promiseElements: "first",
        promiseReceiver: true,
        shapeSource: ensurePresentElement,
    },
    {
        name: "aliased nested elements observation",
        cases: 3,
        shapeSource: aliasedNestedElements,
    },
    mutationMode("owned in-place mutation", 16, {
        assertIdentity: true,
    }),
    mutationMode("shared-target copy-on-write", 8, {
        receiver: "shared",
    }),
    mutationMode("shared-ancestor copy-on-write", 4, {
        receiver: "shared ancestor",
    }),
    mutationMode("imported copy-on-write", 8, {
        receiver: "imported",
    }),
    mutationMode("frozen imported copy-on-write", 4, {
        frozen: true,
        receiver: "imported",
    }),
    mutationMode("promised receiver mutation", 4, {
        promiseReceiver: true,
    }),
    mutationMode(
        "promised arguments mutation",
        4,
        {
            promiseArguments: true,
            supports: scenario => scenario.args.length > 0,
        },
    ),
    mutationMode(
        "Promise element mutation",
        4,
        {
            promiseElements: "first",
            shapeSource: ensurePresentElement,
        },
    ),
    mutationMode(
        "shared Promise-element copy-on-write",
        4,
        {
            promiseElements: "first",
            receiver: "shared",
            shapeSource: ensurePresentElement,
        },
    ),
    mutationMode(
        "imported Promise-element copy-on-write",
        4,
        {
            promiseElements: "first",
            receiver: "imported",
            shapeSource: ensurePresentElement,
        },
    ),
    {
        name: "duplicate Promise elements observation",
        cases: 4,
        promiseElements: "duplicate",
        shapeSource: ensureDuplicateElements,
    },
    mutationMode("duplicate Promise elements mutation", 4, {
        promiseElements: "duplicate",
        shapeSource: ensureDuplicateElements,
    }),
    mutationMode("shared duplicate-Promise copy-on-write", 4, {
        promiseElements: "duplicate",
        receiver: "shared",
        shapeSource: ensureDuplicateElements,
    }),
    mutationMode("aliased nested elements mutation", 3, {
        shapeSource: aliasedNestedElements,
    }),
    mutationMode("shared aliased-elements copy-on-write", 3, {
        receiver: "shared",
        shapeSource: aliasedNestedElements,
    }),
    {
        name: "rejected Promise element observation",
        cases: 3,
        assertValue: assertLogicalValue,
        setup: rejectedElementWorld,
        shapeSource: rejectedElementSource,
        supports: scenario => STRUCTURAL_PROMISE_METHODS.has(
            scenario.method,
        ),
    },
    mutationMode("rejected Promise element mutation", 3, {
        assertValue: assertLogicalValue,
        setup: rejectedElementWorld,
        shapeSource: rejectedElementSource,
        supports: scenario => STRUCTURAL_PROMISE_METHODS.has(
            scenario.method,
        ),
    }),
    mutationMode(
        "mixed Promise frontier mutation",
        4,
        {
            promiseArguments: true,
            promiseElements: "first",
            promiseReceiver: true,
            shapeSource: ensurePresentElement,
        },
    ),
    mutationMode("delayed shared-target copy-on-write", 3, {
        expectPromise: true,
        promiseArguments: true,
        receiver: "shared",
        supports: argumentWillWait,
    }),
    mutationMode("delayed imported copy-on-write", 3, {
        expectPromise: true,
        promiseArguments: true,
        receiver: "imported",
        supports: argumentWillWait,
    }),
    mutationMode("delayed interior-ArrayView materialization", 3, {
        expectPromise: true,
        promiseArguments: true,
        receiver: "view",
        shapeSource: (source, index) => viewSource(
            source,
            index,
            "interior",
        ),
        supports: argumentWillWait,
    }),
    ...viewModes(false),
    ...viewModes(true),
    {
        name: "delayed-argument observation followed by mutation",
        cases: 4,
        promiseArguments: true,
        supports: argumentWillWait,
        compare: compareDelayedObservation,
    },
    {
        name: "Promise-element observation followed by mutation",
        cases: 4,
        promiseElements: "first",
        shapeSource: ensurePresentElement,
        supports: scenario => ELEMENT_WAIT_METHODS.has(scenario.method),
        compare: compareDelayedObservation,
    },
    mutationMode(
        "delayed-argument mutation followed by mutation",
        4,
        {
            compare: compareDelayedMutation,
            promiseArguments: true,
            supports: argumentWillWait,
        },
    ),
    mutationMode(
        "Promise-element mutation followed by mutation",
        4,
        {
            compare: compareDelayedMutation,
            promiseElements: "first",
            shapeSource: ensurePresentElement,
            supports: scenario => ELEMENT_WAIT_METHODS.has(scenario.method),
        },
    ),
    mutationMode(
        "Promise view-version chain",
        4,
        {
            compare: comparePromiseViewVersionChain,
            shapeSource: (source, index) => viewSource(
                ensurePresentElement(source),
                index,
                index % 2 === 0 ? "tail" : "interior",
            ),
        },
    ),
]

describe("Array native equivalence", () => {
    it("keeps method facts complete", () => {
        assert.deepEqual(
            Object.keys(ARRAY_METHOD_FACTS).sort(),
            Object.keys(ARRAY_METHODS).sort(),
        )
    })

    for (const mode of ARRAY_MODES) {
        it(`matches ${mode.name}`, async () => {
            await forEachNativeCase(
                ARRAY_METHOD_FACTS,
                mode,
                createArrayCase,
                mode.compare ?? compareArrayCase,
            )
        })
    }

    it("matches indexed, length, and deletion sequences", async () => {
        for (let caseIndex = 0; caseIndex < 32; caseIndex++) {
            const random = createRandom(0x51f15e + caseIndex)
            const source = generateArray(random, caseIndex)
            const native = cloneData(source)
            const chain = new Chain(cloneData(source))
            for (let step = 0; step < 12; step++) {
                const kind = randomInteger(random, 3)
                if (kind === 0) {
                    const index = randomInteger(random, native.length + 4)
                    const value = pick(random, VALUES)
                    native[index] = value
                    assignPath(chain, [String(index)], value)
                } else if (kind === 1) {
                    const length = randomInteger(random, 12)
                    native.length = length
                    assignPath(chain, ["length"], length)
                } else {
                    const index = randomInteger(random, native.length + 3)
                    delete native[index]
                    deletePath(chain, [String(index)])
                }
                await assertValue(chain._state.value, native, {
                    message: `property sequence case=${caseIndex} step=${step}`,
                })
                verifyRefCounts(chain._state.value)
            }
        }
    })

    it("matches partial native mutation failures", async () => {
        for (const [method, fact] of Object.entries(ARRAY_METHOD_FACTS)) {
            if (!fact.mutationArgs) continue
            for (const restriction of [
                "nonWritable",
                "nonConfigurable",
                "fixedLength",
            ]) {
                const nativeSource = restrictedArray(restriction)
                const runtimeSource = restrictedArray(restriction)
                const chain = new Chain(runtimeSource)
                const native = callArrayMethod(
                    nativeSource,
                    method,
                    cloneData(fact.mutationArgs),
                )
                const result = run(
                    chain,
                    [],
                    method,
                    true,
                    ...cloneData(fact.mutationArgs),
                )
                const scenario = {
                    message: `${method} restriction=${restriction}`,
                }

                await assertOutcome(result, native.error, native.result, scenario)
                await assertValue(chain._state.value, nativeSource, scenario)
                verifyRefCounts(chain._state.value, result)
            }
        }
    })

})

async function compareArrayCase(scenario, mode) {
    const nativeSource = cloneData(scenario.source)
    const native = callArrayMethod(
        nativeSource,
        scenario.method,
        cloneData(scenario.args),
    )
    const world = (mode.setup ?? setupArrayWorld)(scenario, mode)
    const result = run(
        world.chain,
        world.path ?? [],
        scenario.method,
        mode.mutate === true,
        ...(world.args ?? cloneData(scenario.args)),
    )
    if (mode.expectPromise) {
        assert(result instanceof Promise, scenario.message)
    }
    world.afterInvoke?.()

    if (world.identity) {
        assert.equal(world.chain._state.value, world.identity, scenario.message)
    }
    const actualResult = await assertOutcome(
        result,
        native.error,
        mode.mutate ? native.result : (
            scenario.mutates ? nativeSource : native.result
        ),
        scenario,
        mode.assertValue,
    )
    await (mode.assertValue ?? assertValue)(
        world.chain._state.value,
        world.expectedState
            ? world.expectedState(nativeSource)
            : mode.mutate ? nativeSource : scenario.source,
        scenario,
    )
    for (const retained of world.retained ?? []) {
        await assertValue(retained.actual, retained.expected, scenario)
    }
    verifyViewRepresentation(
        actualResult,
        native,
        nativeSource,
        scenario,
        mode,
        world,
    )
    verifyRefCounts(
        world.chain._state.value,
        actualResult,
        ...(world.retained ?? []).map(retained => retained.actual),
    )
}

function setupArrayWorld(scenario, mode) {
    if (mode.receiver === "view") return setupViewWorld(scenario, mode)
    if (mode.receiver === "attached") {
        return setupAttachedWorld(scenario, mode)
    }

    const receiver = runtimeArray(scenario.source, mode)
    if (mode.frozen) Object.freeze(receiver)
    let world
    if (mode.receiver === "shared") {
        const chain = new Chain({ changed: receiver, retained: receiver })
        lookupPath(chain, ["retained"])
        world = {
            chain,
            path: ["changed"],
            expectedState: nativeSource => ({
                changed: nativeSource,
                retained: scenario.source,
            }),
        }
    } else if (mode.receiver === "shared ancestor") {
        const branch = { value: receiver }
        const chain = new Chain({ changed: branch, retained: branch })
        lookupPath(chain, ["retained"])
        world = {
            chain,
            path: ["changed", "value"],
            expectedState: nativeSource => ({
                changed: { value: nativeSource },
                retained: { value: scenario.source },
            }),
        }
    } else if (mode.receiver === "imported") {
        const external = { value: receiver }
        importValue(external)
        world = {
            chain: new Chain(external),
            path: ["value"],
            expectedState: nativeSource => ({ value: nativeSource }),
            retained: [{
                actual: external,
                expected: { value: scenario.source },
            }],
        }
    } else {
        world = {
            chain: new Chain(
                mode.promiseReceiver ? Promise.resolve(receiver) : receiver,
            ),
            identity: mode.assertIdentity ? receiver : undefined,
        }
    }
    if (mode.promiseArguments) {
        world.args = promisedArguments(scenario.args)
    }
    return world
}

function rejectedElementWorld(scenario) {
    const receiver = cloneData(scenario.source)
    const rejection = deferred()
    receiver[0] = undefined
    const chain = new Chain(receiver)
    assignPath(chain, ["0"], rejection.promise)
    return {
        chain,
        afterInvoke: () => rejection.reject(scenario.source[0]),
    }
}

function setupViewWorld(scenario, mode) {
    const backing = cloneData(scenario.layout.backing)
    if (mode.restriction === "non-extensible") {
        Object.preventExtensions(backing)
    } else if (mode.restriction === "fixed-length") {
        Object.defineProperty(backing, "length", { writable: false })
    }
    const base = new Chain(backing)
    const view = run(
        base,
        [],
        "slice",
        false,
        scenario.layout.start,
        scenario.layout.end,
    )
    assert(arrayViews.isArrayView(view), scenario.message)
    const world = {
        chain: new Chain(view),
        retained: [
            { actual: view, expected: scenario.source },
            { actual: base._state.value, expected: scenario.layout.backing },
        ],
        viewInfo: {
            startAvailable: scenario.layout.start === 0,
            endAvailable:
                scenario.layout.end === scenario.layout.backing.length,
            restricted: mode.restriction !== undefined,
        },
    }
    if (mode.promiseArguments) {
        world.args = promisedArguments(scenario.args)
    }
    return world
}

function setupAttachedWorld(scenario) {
    const receiver = cloneData(scenario.layout.backing)
    const chain = new Chain(receiver)
    const prepend = scenario.index % 2 === 1
    const marker = 0x61 + scenario.index
    const version = run(
        chain,
        [],
        prepend ? "unshift" : "push",
        false,
        marker,
    )
    assert(arrayViews.isArrayView(version), scenario.message)
    const expectedVersion = cloneData(scenario.source)
    if (prepend) {
        Array.prototype.unshift.call(expectedVersion, marker)
    } else {
        Array.prototype.push.call(expectedVersion, marker)
    }
    return {
        chain,
        retained: [
            { actual: receiver, expected: scenario.source },
            { actual: version, expected: expectedVersion },
        ],
        viewInfo: {
            startAvailable: !prepend,
            endAvailable: prepend,
            restricted: false,
        },
    }
}

function runtimeArray(source, mode) {
    if (mode.promiseElements === "first") return withPromisedElement(source)
    if (mode.promiseElements === "duplicate") {
        return withDuplicatePromise(source)
    }
    return cloneData(source)
}

function promisedArguments(args) {
    return args.map(value => Promise.resolve(cloneData(value)))
}

function createArrayCase(method, fact, index, mode) {
    const seed = hash(method) ^ index * 0x45d9f3b
    const random = createRandom(seed)
    const generated = (fact.source ?? generateArray)(random, index)
    const shaped = mode.shapeSource
        ? mode.shapeSource(generated, index)
        : generated
    const source = Array.isArray(shaped) ? shaped : shaped.source
    const args = fact.args(random, source, index)
    return {
        method,
        index,
        seed,
        source,
        args,
        layout: Array.isArray(shaped) ? undefined : shaped.layout,
        mutates: fact.mutationArgs !== undefined,
        message: scenarioMessage(method, mode.name, seed, source, args),
    }
}

function mutationMode(name, cases, options) {
    const supports = options.supports
    return {
        ...options,
        name,
        cases,
        mutate: true,
        supports: scenario => scenario.mutates && (
            supports === undefined || supports(scenario)
        ),
    }
}

function viewModes(mutate) {
    const operation = mutate ? "mutation" : "observation"
    const modes = ["full", "head", "tail", "interior"].map(bounds => {
        return {
            name: `${bounds} ArrayView ${operation}`,
            receiver: "view",
            shapeSource: (source, index) => {
                return viewSource(source, index, bounds)
            },
        }
    })
    modes.push({
            name: `attached source-version ${operation}`,
            receiver: "attached",
            shapeSource: attachedSource,
        },
        {
            name: `fixed-length ArrayView ${operation}`,
            receiver: "view",
            restriction: "fixed-length",
            shapeSource: (source, index) => viewSource(
                source, index, "full",
            ),
        },
    )
    return modes.map(mode => mutate
        ? mutationMode(mode.name, 4, mode)
        : { ...mode, cases: 4 })
}

function viewSource(source, index, bounds) {
    const backing = ensureViewBacking(source, index)
    const start = bounds === "tail" || bounds === "interior" ? 1 : 0
    const end = bounds === "head" || bounds === "interior"
        ? backing.length - 1
        : backing.length
    return {
        source: cloneData(backing).slice(start, end),
        layout: { backing, start, end },
    }
}

function attachedSource(source, index) {
    const backing = ensureViewBacking(source, index)
    return { source: cloneData(backing), layout: { backing } }
}

function ensureViewBacking(source, index) {
    const backing = cloneData(source)
    while (backing.length < 4) backing.push(index + backing.length + 1)
    return backing
}

function ensurePresentElement(source) {
    const output = cloneData(source)
    if (firstPresentIndex(output) === undefined) output[0] = 1
    return output
}

function ensureDuplicateElements(source) {
    const output = ensurePresentElement(source)
    const value = output[firstPresentIndex(output)]
    output[0] = value
    output[1] = value
    return output
}

function aliasedNestedElements(source, index) {
    const output = cloneData(source)
    const child = [index, `value ${index}`]
    output[0] = child
    output[1] = child
    return output
}

function rejectedElementSource(source, index) {
    const output = ensurePresentElement(source)
    output[0] = new Error(`rejected element ${index}`)
    return output
}

function withPromisedElement(source) {
    const output = cloneData(source)
    const index = firstPresentIndex(output)
    output[index] = Promise.resolve(output[index])
    return output
}

function withDuplicatePromise(source) {
    const output = cloneData(source)
    const promise = Promise.resolve(output[0])
    output[0] = promise
    output[1] = promise
    return output
}

function argumentWillWait(scenario) {
    if (scenario.method === "fill") return scenario.args.length > 1
    return scenario.args.length > 0 &&
        ARGUMENT_WAIT_METHODS.has(scenario.method)
}

async function assertLogicalValue(actual, expected, scenario) {
    assert.deepStrictEqual(
        await logicalSnapshot(actual),
        await logicalSnapshot(expected),
        scenario.message,
    )
}

async function logicalSnapshot(value) {
    value = await value
    if (!arrayViews.isLogicalArray(value)) return value

    const array = arrayViews.projectionOf(value)
    const output = new Array(array.length)
    const keys = arrayViews.isArrayView(array)
        ? array.keys()
        : Object.keys(array)
    for (const key of keys) {
        if (!arrayViews.isArrayIndex(key)) continue
        const element = arrayViews.isArrayView(array)
            ? array.get(key)
            : array[key]
        output[key] = await logicalSnapshot(element)
    }
    return output
}

function verifyViewRepresentation(
    actualResult,
    native,
    nativeSource,
    scenario,
    mode,
    world,
) {
    if (!world.viewInfo || native.error) return
    const method = scenario.method
    let expected
    if (method === "push" || method === "unshift") {
        const endpoint = method === "push"
            ? world.viewInfo.endAvailable
            : world.viewInfo.startAvailable
        expected = scenario.args.length === 0 || (
            endpoint && !world.viewInfo.restricted
        )
    } else if (method === "pop" || method === "shift") {
        expected = nativeSource.length > 0
    } else if (method === "concat") {
        const growth = native.result.length - scenario.source.length
        expected = growth === 0 || (
            world.viewInfo.endAvailable && !world.viewInfo.restricted
        )
    } else if (method === "slice") {
        expected = scenario.args.every(value => {
            return value === undefined || typeof value === "number"
        }) && native.result.length > 0
    } else if (
        scenario.mutates ||
        [
            "flat",
            "toReversed",
            "toSorted",
            "toSpliced",
            "with",
        ].includes(method)
    ) {
        expected = false
    }
    if (expected === undefined) return

    const output = mode.mutate ? world.chain._state.value : actualResult
    assert.equal(arrayViews.isArrayView(output), expected, scenario.message)
}

async function compareDelayedObservation(scenario, mode) {
    const observedSource = cloneData(scenario.source)
    const native = callArrayMethod(
        observedSource,
        scenario.method,
        cloneData(scenario.args),
    )
    const finalSource = cloneData(scenario.source)
    const marker = 0x71 + scenario.index
    const laterNative = callArrayMethod(finalSource, "push", [marker])
    const chain = new Chain(
        runtimeArray(scenario.source, mode),
    )
    const result = run(
        chain,
        [],
        scenario.method,
        false,
        ...(mode.promiseArguments
            ? promisedArguments(scenario.args)
            : cloneData(scenario.args)),
    )
    assert(result instanceof Promise, scenario.message)
    const laterResult = run(chain, [], "push", true, marker)

    const actualResult = await assertOutcome(
        result,
        native.error,
        scenario.mutates ? observedSource : native.result,
        scenario,
    )
    const actualLaterResult = await assertOutcome(
        laterResult,
        laterNative.error,
        laterNative.result,
        scenario,
    )
    await assertValue(chain._state.value, finalSource, scenario)
    verifyRefCounts(chain._state.value, actualResult, actualLaterResult)
}

async function compareDelayedMutation(scenario, mode) {
    const nativeSource = cloneData(scenario.source)
    const native = callArrayMethod(
        nativeSource,
        scenario.method,
        cloneData(scenario.args),
    )
    const expectedResult = cloneData(native.result)
    const marker = 0x81 + scenario.index
    const laterNative = callArrayMethod(nativeSource, "push", [marker])
    const chain = new Chain(
        runtimeArray(scenario.source, mode),
    )
    const result = run(
        chain,
        [],
        scenario.method,
        true,
        ...(mode.promiseArguments
            ? promisedArguments(scenario.args)
            : cloneData(scenario.args)),
    )
    assert(result instanceof Promise, scenario.message)
    const laterResult = run(chain, [], "push", true, marker)

    const actualResult = await assertOutcome(
        result,
        native.error,
        expectedResult,
        scenario,
    )
    const actualLaterResult = await assertOutcome(
        laterResult,
        laterNative.error,
        laterNative.result,
        scenario,
    )
    await assertValue(chain._state.value, nativeSource, scenario)
    verifyRefCounts(chain._state.value, actualResult, actualLaterResult)
}

async function comparePromiseViewVersionChain(scenario) {
    const nativeSource = cloneData(scenario.source)
    const native = callArrayMethod(
        nativeSource,
        scenario.method,
        cloneData(scenario.args),
    )
    const expectedResult = cloneData(native.result)
    const marker = 0x91 + scenario.index
    const laterNative = callArrayMethod(nativeSource, "push", [marker])

    const backing = cloneData(scenario.layout.backing)
    const logicalIndex = firstPresentIndex(scenario.source)
    const physicalIndex = scenario.layout.start + logicalIndex
    backing[physicalIndex] = Promise.resolve(backing[physicalIndex])
    const base = new Chain(backing)
    const view = run(
        base,
        [],
        "slice",
        false,
        scenario.layout.start,
        scenario.layout.end,
    )
    const chain = new Chain(view)
    const result = run(
        chain,
        [],
        scenario.method,
        true,
        ...cloneData(scenario.args),
    )
    const laterResult = run(chain, [], "push", true, marker)

    const actualResult = await assertOutcome(
        result,
        native.error,
        expectedResult,
        scenario,
    )
    const actualLaterResult = await assertOutcome(
        laterResult,
        laterNative.error,
        laterNative.result,
        scenario,
    )
    await assertValue(chain._state.value, nativeSource, scenario)
    await assertValue(view, scenario.source, scenario)
    await assertValue(base._state.value, scenario.layout.backing, scenario)
    verifyRefCounts(
        chain._state.value,
        view,
        base._state.value,
        actualResult,
        actualLaterResult,
    )
}

function callArrayMethod(source, method, args) {
    return callNativeMethod(Array.prototype, source, method, args)
}

function restrictedArray(restriction) {
    const output = [3, 1, 2, 0]
    if (restriction === "nonWritable") {
        Object.defineProperty(output, "1", {
            value: output[1],
            enumerable: true,
            writable: false,
            configurable: true,
        })
    } else if (restriction === "nonConfigurable") {
        Object.defineProperty(output, "1", {
            value: output[1],
            enumerable: true,
            writable: true,
            configurable: false,
        })
    } else if (restriction === "fixedLength") {
        Object.defineProperty(output, "length", { writable: false })
    }
    return output
}

function generateArray(random, caseIndex = 0) {
    const length = caseIndex < 4 ? caseIndex : randomInteger(random, 9)
    const output = new Array(length)
    for (let index = 0; index < length; index++) {
        if (caseIndex % 4 === 1 || random() < 0.65) {
            output[index] = pick(random, VALUES)
        }
    }
    return output
}

function generateNestedArray(random, caseIndex = 0) {
    const output = generateArray(random, caseIndex)
    for (let index = 0; index < output.length; index++) {
        if (!(index in output) || random() >= 0.35) continue
        const nested = generateArray(random, index + 2)
        if (random() < 0.35) nested[0] = [pick(random, VALUES)]
        output[index] = nested
    }
    return output
}

function indexArguments(random, source, caseIndex) {
    return caseIndex % 4 === 0 ? [] : [position(random, source.length)]
}

function rangeArguments(random, source, caseIndex) {
    const count = caseIndex % 4
    return Array.from(
        { length: count },
        () => position(random, source.length),
    )
}

function fillArguments(random, source, caseIndex) {
    const count = caseIndex % 4
    if (count === 0) return []
    return [
        pick(random, VALUES),
        ...Array.from(
            { length: count - 1 },
            () => position(random, source.length),
        ),
    ]
}

function flatArguments(random, source, caseIndex) {
    return caseIndex % 4 === 0
        ? []
        : [pick(random, [undefined, -1, 0, 1, 2, Infinity, "2"])]
}

function searchArguments(random, source, caseIndex) {
    const present = presentIndexes(source)
    const search = present.length > 0 && random() < 0.6
        ? source[pick(random, present)]
        : pick(random, VALUES)
    return argumentsByArity(caseIndex, [
        search,
        position(random, source.length),
    ])
}

function joinArguments(random, source, caseIndex) {
    return caseIndex % 2 === 0
        ? []
        : [pick(random, [undefined, null, "", ",", "|", "--"])]
}

function valueArguments(random, source, caseIndex) {
    return Array.from(
        { length: caseIndex % 4 },
        () => pick(random, VALUES),
    )
}

function sortArguments(random, source, caseIndex) {
    return [
        [],
        [undefined],
        [NUMERIC_COMPARATOR],
        [STRING_COMPARATOR],
    ][caseIndex % 4]
}

function spliceArguments(random, source, caseIndex) {
    const count = caseIndex % 5
    if (count === 0) return []
    if (count === 1) return [position(random, source.length)]
    const output = [
        position(random, source.length),
        position(random, source.length),
    ]
    while (output.length < count) output.push(pick(random, VALUES))
    return output
}

function concatArguments(random, source, caseIndex) {
    return Array.from(
        { length: caseIndex % 4 },
        (_, index) => random() < 0.65
            ? generateArray(random, index + 1)
            : pick(random, VALUES),
    )
}

function withArguments(random, source, caseIndex) {
    return argumentsByArity(caseIndex, [
        position(random, source.length),
        pick(random, VALUES),
    ])
}

function presentIndexes(array) {
    const indexes = []
    for (let index = 0; index < array.length; index++) {
        if (index in array) indexes.push(index)
    }
    return indexes
}

function firstPresentIndex(array) {
    for (let index = 0; index < array.length; index++) {
        if (index in array) return index
    }
}
