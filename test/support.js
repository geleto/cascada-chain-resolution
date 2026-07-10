const expect = require("expect.js")

const runtime = require("../src")
const helpers = require("../src/helpers")
const error = require("../src/error")
const refcounts = require("../src/refcounts")
const meta = require("../src/meta")
const verifyRefcounts = require("../src/verify-refcounts")

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

module.exports = {
    Chain: runtime.Chain,
    expect,
    runtime,
    reportFatalError: error.reportFatalError,
    setFatalErrorReporter: error.setFatalErrorReporter,
    onInternalResolve: helpers.onInternalResolve,
    onValueResolve: helpers.onValueResolve,
    buildRefIndex: refcounts.buildRefIndex,
    getRefCounter: refcounts.getRefCounter,
    getRefCounts: refcounts.getRefCounts,
    metaOf: meta.metaOf,
    STORE_META_IN_WEAKMAP: meta.STORE_META_IN_WEAKMAP,
    verifyRefCounts: verifyRefcounts.verifyRefCounts,
    assignPath: runtime.assignPath,
    deletePath: runtime.deletePath,
    hasError: runtime.hasError,
    lookupPath: runtime.lookupPath,
    normalize: runtime.normalize,
    importValue,
    deferred,
    flushMicrotasks,
    expectCounts,
    thrownBy,
}
