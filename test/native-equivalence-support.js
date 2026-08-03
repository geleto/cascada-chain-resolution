import assert from "node:assert/strict"
import { inspect } from "node:util"

import { Chain, exportValue } from "./support.js"

const VALUES = [
    undefined,
    null,
    false,
    true,
    -0,
    0,
    1,
    -2,
    3.5,
    NaN,
    Infinity,
    -Infinity,
    "",
    "0",
    "2",
    "x",
]

async function assertOutcome(
    actual,
    nativeError,
    expected,
    scenario,
    compareValue = assertValue,
) {
    actual = await actual
    if (nativeError) {
        assert(actual instanceof Error, scenario.message)
        return actual
    }
    if (expected instanceof Error) {
        assert(actual instanceof Error, scenario.message)
        assert.deepStrictEqual(actual, expected, scenario.message)
        return actual
    }
    assert(!(actual instanceof Error), scenario.message)
    await compareValue(actual, expected, scenario)
    return actual
}

async function assertValue(actual, expected, scenario) {
    const exported = await exportValue(new Chain(actual), [])
    assert.deepStrictEqual(
        cloneData(exported),
        cloneData(expected),
        scenario.message,
    )
}

function callNativeMethod(prototype, source, method, args) {
    try {
        return {
            result: Reflect.apply(prototype[method], source, args),
        }
    } catch (error) {
        return { error }
    }
}

function cloneData(value, clones = new Map()) {
    if (!Array.isArray(value)) return value
    const existing = clones.get(value)
    if (existing) return existing
    const output = new Array(value.length)
    clones.set(value, output)
    for (let index = 0; index < value.length; index++) {
        if (Object.prototype.propertyIsEnumerable.call(value, index)) {
            output[index] = cloneData(value[index], clones)
        }
    }
    return output
}

function scenarioMessage(method, mode, seed, source, args) {
    return `${method} mode=${mode} seed=${seed >>> 0} source=${
        inspect(source)
    } args=${inspect(args)}`
}

function noArguments() {
    return []
}

function argumentsByArity(caseIndex, values) {
    return values.slice(0, caseIndex % (values.length + 1))
}

function position(random, length) {
    return pick(random, [
        undefined,
        NaN,
        -Infinity,
        Infinity,
        -length - 2,
        -1,
        -0,
        0,
        1,
        1.75,
        length - 1,
        length,
        length + 2,
        "1",
        "-1",
    ])
}

function pick(random, values) {
    return values[randomInteger(random, values.length)]
}

function randomInteger(random, limit) {
    return Math.floor(random() * limit)
}

function createRandom(seed) {
    let state = seed >>> 0
    return () => {
        state += 0x6d2b79f5
        let value = state
        value = Math.imul(value ^ value >>> 15, value | 1)
        value ^= value + Math.imul(value ^ value >>> 7, value | 61)
        return ((value ^ value >>> 14) >>> 0) / 0x100000000
    }
}

function hash(value) {
    let result = 2166136261
    for (const character of value) {
        result ^= character.charCodeAt(0)
        result = Math.imul(result, 16777619)
    }
    return result >>> 0
}

async function forEachNativeCase(facts, mode, createCase, compare) {
    for (const [method, fact] of Object.entries(facts)) {
        for (let index = 0; index < mode.cases; index++) {
            const scenario = createCase(method, fact, index, mode)
            if (mode.supports && !mode.supports(scenario)) continue
            await compare(scenario, mode)
        }
    }
}

export {
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
}
