import assert from "node:assert/strict"

import { Chain, run } from "./support.js"
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

const STRING_METHOD_FACTS = Object.fromEntries([
    ...stringFacts([
        "big", "blink", "bold", "fixed", "isWellFormed", "italics",
        "small", "strike", "sub", "sup", "toLocaleLowerCase",
        "toLocaleUpperCase", "toLowerCase", "toString", "toUpperCase",
        "toWellFormed", "trim", "trimEnd", "trimLeft", "trimRight",
        "trimStart", "valueOf",
    ], noArguments),
    ...stringFacts([
        "anchor", "fontcolor", "fontsize", "link",
    ], stringValueArguments),
    ...stringFacts([
        "at", "charAt", "charCodeAt", "codePointAt",
    ], stringIndexArguments),
    ...stringFacts([
        "slice", "substr", "substring",
    ], stringRangeArguments),
    ...stringFacts([
        "endsWith", "includes", "indexOf", "lastIndexOf", "startsWith",
    ], stringSearchArguments),
    ...stringFacts(["concat"], valueArguments),
    ...stringFacts(["localeCompare"], stringValueArguments),
    ...stringFacts(["match", "matchAll", "search"], stringPatternArguments),
    ...stringFacts(["normalize"], normalizeArguments),
    ...stringFacts(["padEnd", "padStart"], padArguments),
    ...stringFacts(["repeat"], repeatArguments),
    ...stringFacts(["replace", "replaceAll"], replaceArguments),
    ...stringFacts(["split"], splitArguments),
])

const STRINGS = [
    "",
    "abc",
    "  a b  ",
    "a\u{1d306}b",
    "\ud800x",
    "\u0130\u00df",
    "0,-1,2",
]

const STRING_MODES = [
    { name: "direct inputs", cases: 8 },
    { name: "promised receiver", cases: 8, promiseReceiver: true },
    {
        name: "promised arguments",
        cases: 8,
        promiseArguments: true,
        supports: scenario => scenario.args.length > 0,
    },
    {
        name: "promised receiver and arguments",
        cases: 8,
        promiseArguments: true,
        promiseReceiver: true,
        supports: scenario => scenario.args.length > 0,
    },
]

describe("String native equivalence", () => {
    it("keeps method facts complete", () => {
        assert.deepEqual(
            Object.keys(STRING_METHOD_FACTS).sort(),
            Object.getOwnPropertyNames(String.prototype).filter(method => {
                return method !== "constructor" && method !== "length"
            }).sort(),
        )
    })

    for (const mode of STRING_MODES) {
        it(`matches standard methods with ${mode.name}`, async () => {
            await forEachNativeCase(
                STRING_METHOD_FACTS,
                mode,
                createStringCase,
                compareStringCase,
            )
        })
    }
})

function createStringCase(method, fact, index, mode) {
    const seed = hash(method) ^ index * 0x45d9f3b
    const random = createRandom(seed)
    const source = pick(random, STRINGS)
    const args = fact(random, source, index)
    return {
        method,
        source,
        args,
        message: scenarioMessage(method, mode.name, seed, source, args),
    }
}

async function compareStringCase(scenario, mode) {
    const { method, source, args } = scenario
    const native = callStringMethod(source, method, cloneData(args))
    if (!native.error && method === "matchAll") {
        native.result = Array.from(native.result)
    }

    const chain = new Chain(
        mode.promiseReceiver ? Promise.resolve(source) : source,
    )
    let result = run(
        chain,
        [],
        method,
        false,
        ...(mode.promiseArguments
            ? args.map(value => Promise.resolve(cloneData(value)))
            : cloneData(args)),
    )
    result = await result
    if (!(result instanceof Error) && method === "matchAll") {
        result = Array.from(result)
    }

    await assertOutcome(result, native.error, native.result, scenario)
    await assertValue(chain._state.value, source, scenario)
}

function callStringMethod(source, method, args) {
    return callNativeMethod(String.prototype, source, method, args)
}

function stringFacts(methods, args) {
    return methods.map(method => [method, args])
}

function stringValueArguments(random, source, caseIndex) {
    return caseIndex % 4 === 0 ? [] : [pick(random, STRINGS)]
}

function stringIndexArguments(random, source, caseIndex) {
    return caseIndex % 4 === 0 ? [] : [position(random, source.length)]
}

function stringRangeArguments(random, source, caseIndex) {
    const count = caseIndex % 3
    return Array.from(
        { length: count },
        () => position(random, source.length),
    )
}

function stringSearchArguments(random, source, caseIndex) {
    const search = random() < 0.5
        ? source.slice(0, randomInteger(random, source.length + 1))
        : pick(random, ["", "a", "x", " ", "2"])
    return argumentsByArity(caseIndex, [
        search,
        position(random, source.length),
    ])
}

function stringPatternArguments(random, source, caseIndex) {
    return caseIndex % 4 === 0
        ? []
        : [pick(random, ["", "a", "x", ".", "[a]"])]
}

function normalizeArguments(random, source, caseIndex) {
    return caseIndex % 4 === 0
        ? []
        : [pick(random, ["NFC", "NFD", "NFKC", "NFKD", "invalid"])]
}

function padArguments(random, source, caseIndex) {
    const length = pick(random, [0, 1, source.length, source.length + 3, "8"])
    return argumentsByArity(caseIndex, [
        length,
        pick(random, ["", " ", "0", "xy"]),
    ])
}

function repeatArguments(random, source, caseIndex) {
    return caseIndex % 4 === 0
        ? []
        : [pick(random, [0, 1, 2, 3, "2", -1, Infinity])]
}

function replaceArguments(random, source, caseIndex) {
    return argumentsByArity(caseIndex, [
        pick(random, ["", "a", "x", "2"]),
        pick(random, ["", "z", "$&", "$$"]),
    ])
}

function splitArguments(random, source, caseIndex) {
    const separator = pick(random, [undefined, "", "a", " ", ","])
    return argumentsByArity(caseIndex, [
        separator,
        pick(random, [undefined, 0, 1, 4, 0xffffffff]),
    ])
}

function valueArguments(random, source, caseIndex) {
    return Array.from(
        { length: caseIndex % 4 },
        () => pick(random, VALUES),
    )
}
