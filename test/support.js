import expect from "expect.js"

import * as runtime from "../src/index.js"
import * as helpers from "../src/helpers.js"
import * as error from "../src/error.js"
import * as refcounts from "../src/refcounts.js"
import * as meta from "../src/meta.js"
import * as verifyRefcounts from "../src/verify-refcounts.js"

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

function flushMicrotasks() {
    // A full turn drains the recursively queued promise jobs from this turn.
    return new Promise(resolve => setImmediate(resolve))
}

function countPromiseRegistrations(promise) {
    // Observe registrations on this exact promise without changing settlement.
    let count = 0
    const then = promise.then
    promise.then = function (...args) {
        count++
        return then.apply(this, args)
    }
    return () => count
}

function expectCounts(value, promiseCount, errorCount) {
    expect(refcounts.getRefCounts(value)).to.eql([promiseCount, errorCount])
}

function thrownBy(fn) {
    try {
        fn()
    } catch (error) {
        return error
    }
    return undefined
}

const {
    Chain,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    lookupPath,
    normalize,
} = runtime
const { reportFatalError, setFatalErrorReporter } = error
const { onInternalResolve, onValueResolve } = helpers
const {
    buildRefIndex,
    getRefCounter,
    getRefCounts,
} = refcounts
const { metaOf, STORE_META_IN_WEAKMAP } = meta
const { verifyRefCounts } = verifyRefcounts

export {
    Chain,
    expect,
    runtime,
    reportFatalError,
    setFatalErrorReporter,
    onInternalResolve,
    onValueResolve,
    buildRefIndex,
    getRefCounter,
    getRefCounts,
    metaOf,
    STORE_META_IN_WEAKMAP,
    verifyRefCounts,
    assignPath,
    deletePath,
    getErrors,
    hasError,
    lookupPath,
    normalize,
    importValue,
    countPromiseRegistrations,
    deferred,
    flushMicrotasks,
    expectCounts,
    thrownBy,
}
