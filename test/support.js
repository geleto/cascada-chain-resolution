const expect = require("expect.js")

const runtime = require("../src")
const { onResolve } = require("../src/helpers")
const {
    buildRefIndex,
    getRefCounter,
    getRefCounts,
} = require("../src/refcounts")
const {
    metaOf,
    STORE_META_IN_WEAKMAP,
} = require("../src/meta")
const { verifyRefCounts } = require("../src/verify-refcounts")

const {
    assignPath,
    deletePath,
    hasError,
    lookupPath,
    normalize,
} = runtime

function importValue(value, context = "test import") {
    return runtime.import(value, context)
}

function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

async function flushMicrotasks(count = 8) {
    for (let i = 0; i < count; i++) {
        await Promise.resolve()
    }
}

function expectCounts(value, promiseCount, errorCount) {
    expect(getRefCounts(value)).to.eql([promiseCount, errorCount])
}

function thrownBy(fn) {
    try {
        fn()
    } catch (error) {
        return error
    }
    return undefined
}

module.exports = {
    expect,
    runtime,
    onResolve,
    buildRefIndex,
    getRefCounter,
    getRefCounts,
    metaOf,
    STORE_META_IN_WEAKMAP,
    verifyRefCounts,
    assignPath,
    deletePath,
    hasError,
    lookupPath,
    normalize,
    importValue,
    deferred,
    flushMicrotasks,
    expectCounts,
    thrownBy,
}
