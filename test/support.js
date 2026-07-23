import expect from "expect.js"

import * as runtime from "../src/index.js"
import * as refcounts from "../src/refcounts.js"

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

function expectCounts(value, promiseCount, errorCount, cycleCutCount = 0) {
    expect(refcounts.getRefCounts(value)).to.eql([
        promiseCount,
        errorCount,
        cycleCutCount,
    ])
}

function thrownBy(fn) {
    try {
        fn()
    } catch (error) {
        return error
    }
    return undefined
}

export {
    Chain,
    assignPath,
    deletePath,
    export as exportValue,
    getErrors,
    hasError,
    lookupPath,
} from "../src/index.js"

export {
    reportFatalError,
    setFatalErrorReporter,
} from "../src/error.js"

export {
    onInternalResolve,
    onValueResolve,
} from "../src/helpers.js"

export {
    buildRefIndex,
    getRefCounter,
    getRefCounts,
} from "../src/refcounts.js"

export {
    metaOf,
    STORE_META_IN_WEAKMAP,
} from "../src/meta.js"

export { verifyRefCounts } from "../src/verify-refcounts.js"

export {
    expect,
    runtime,
    importValue,
    countPromiseRegistrations,
    deferred,
    flushMicrotasks,
    expectCounts,
    thrownBy,
}
