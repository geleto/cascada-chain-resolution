import expect from "expect.js"

import * as runtime from "../src/index.js"
import * as sourceArrayViews from "../src/array-view.js"
import * as errorUtils from "../src/error.js"
import * as metadata from "../src/meta.js"
import * as propertyVersions from "../src/property-versions.js"
import * as refcounts from "../src/refcounts.js"
import * as resolution from "../src/resolution.js"
import * as sourceLanguageValues from "../src/language-values.js"
import { readPath as readObservedPath } from "../src/observations.js"
import { verifyRefCounts as verifyExecutionRefCounts } from "./verify-refcounts.js"

let testExecution

function resetTestExecution() {
    testExecution = undefined
}

function useTestExecution(reporter) {
    testExecution = new runtime.Execution(reporter)
    return testExecution
}

function testOperationContext(
    errorContext = "test operation",
    execution = testExecution ??= new runtime.Execution(),
) {
    return { execution, errorContext }
}

function chainOperationContext(chain, errorContext) {
    return testOperationContext(errorContext, chain._execution)
}

function Chain(initialValue, execution = undefined) {
    return new runtime.Chain(
        initialValue,
        testOperationContext("test Chain initialization", execution),
    )
}
Chain.prototype = runtime.Chain.prototype

function ContextChain(
    initialValue,
    errorContext = "test context initialization",
    execution = undefined,
    scopeMutationPaths = [],
    propertyMutationPaths = [],
) {
    return new runtime.ContextChain(
        initialValue,
        testOperationContext(errorContext, execution),
        scopeMutationPaths,
        propertyMutationPaths,
    )
}
ContextChain.prototype = runtime.ContextChain.prototype

function importValue(value, errorContext = "test import") {
    return runtime.import(value, testOperationContext(errorContext))
}

function assignPath(chain, path, value, mutationScopeDepth = path.length) {
    return runtime.assignPath(
        chain,
        path,
        value,
        chainOperationContext(chain, "test assignment"),
        mutationScopeDepth,
    )
}

function deletePath(chain, path, mutationScopeDepth = path.length) {
    return runtime.deletePath(
        chain,
        path,
        chainOperationContext(chain, "test deletion"),
        mutationScopeDepth,
    )
}

function lookupPath(chain, path) {
    return runtime.lookupPath(chain, path, chainOperationContext(chain, "test lookup"))
}

function readPath(chain, path) {
    return readObservedPath(chain, path, chainOperationContext(chain, "test read"))
}

function exportValue(chain, path) {
    return runtime.export(chain, path, chainOperationContext(chain, "test export"))
}

function hasError(chain, path) {
    return runtime.hasError(chain, path, chainOperationContext(chain, "test hasError"))
}

function getErrors(chain, path) {
    return runtime.getErrors(
        chain,
        path,
        chainOperationContext(chain, "test getErrors"),
    )
}

function run(chain, path, method, args, facts) {
    return runtime.run(
        chain,
        path,
        method,
        args,
        chainOperationContext(chain, "test run"),
        facts,
    )
}

function enter(chain, path, entryMutable, onEntered) {
    return runtime.enter(
        chain,
        path,
        chainOperationContext(chain, "test enter"),
        entryMutable,
        onEntered,
    )
}

function metaOf(value, execution = testExecution) {
    return execution
        ? metadata.metaOf(value, testOperationContext("test metadata", execution))
        : undefined
}

function markShared(value) {
    return metadata.markShared(value, testOperationContext())
}

function incrementReadLease(value) {
    return metadata.incrementReadLease(value, testOperationContext())
}

function decrementReadLease(value) {
    return metadata.decrementReadLease(value, testOperationContext())
}

function getPromiseMirror(owner, key) {
    return propertyVersions.getPromiseMirror(
        owner,
        key,
        testOperationContext("test Promise mirror"),
    )
}

function advancePromiseVersion(owner, key, mirror, value) {
    return propertyVersions.advancePromiseVersion(
        owner,
        key,
        mirror,
        value,
        testOperationContext("test Promise advancement"),
    )
}

function buildRefIndex(value) {
    return refcounts.buildRefIndex(value, testOperationContext("test ref index"))
}

function getRefCounter(value) {
    return refcounts.getRefCounter(value, testOperationContext("test ref count"))
}

function getRefCounts(value) {
    return refcounts.getRefCounts(value, testOperationContext("test ref counts"))
}

function hasCycleCut(value, key) {
    return refcounts.hasCycleCut(
        value,
        key,
        testOperationContext("test cycle cut"),
    )
}

function runInternalStep(work) {
    return errorUtils.runInternalStep(
        testOperationContext("test fatal work"),
        work,
    )
}

function submitFatal(reason, errorContext = "test fatal injection") {
    return errorUtils.failExecution(
        testOperationContext(errorContext),
        reason,
    )
}

function ArrayView(source, start = 0, end = undefined) {
    return new sourceArrayViews.ArrayView(
        source,
        testOperationContext("test ArrayView"),
        start,
        end,
    )
}
ArrayView.prototype = sourceArrayViews.ArrayView.prototype
ArrayView.tryAttachTo = value => sourceArrayViews.ArrayView.tryAttachTo(
    value,
    testOperationContext("test ArrayView attachment"),
)

const arrayViews = {
    ...sourceArrayViews,
    ArrayView,
    isArrayView: value => sourceArrayViews.isArrayView(
        value,
        testOperationContext("test ArrayView check"),
    ),
    isLogicalArray: value => sourceArrayViews.isLogicalArray(
        value,
        testOperationContext("test logical Array check"),
    ),
    backingOf: value => sourceArrayViews.backingOf(
        value,
        testOperationContext("test Array backing"),
    ),
    projectionOf: value => sourceArrayViews.projectionOf(
        value,
        testOperationContext("test Array projection"),
    ),
}

const testPropertyVersions = {
    ...propertyVersions,
    getPromiseMirror: (owner, key) => propertyVersions.getPromiseMirror(
        owner,
        key,
        testOperationContext("test Promise mirror"),
    ),
    getPropertyPlacement: (owner, key) => propertyVersions.getPropertyPlacement(
        owner, key, testOperationContext("test placement capture"),
    ),
}

const languageValues = {
    ...sourceLanguageValues,
    admitReadyValue: value => sourceLanguageValues.admitReadyValue(
        value,
        testOperationContext("test admission"),
    ),
    isPending: value => sourceLanguageValues.isPending(
        value,
        testOperationContext("test Promise check"),
    ),
    isTraversable: value => sourceLanguageValues.isTraversable(
        value,
        testOperationContext("test traversal check"),
    ),
    typeOf: value => sourceLanguageValues.typeOf(
        value,
        testOperationContext("test type check"),
    ),
}

const testMetadata = {
    ...metadata,
    metaOf,
    isImported: value => metadata.isImported(
        value,
        testOperationContext(),
    ),
    incrementReadLease,
}

function continueInitialValue(value, fn, shouldContinue) {
    return resolution.continueInitialValue(
        value,
        testOperationContext("test initial resolution"),
        fn,
        shouldContinue,
    )
}

function continueWhenSettled(promise, fn) {
    return resolution.continueWhenSettled(
        promise,
        testOperationContext("test later resolution"),
        fn,
    )
}

function continueInternalResultOrFatal(internalResult, onFulfilled) {
    return resolution.continueInternalResultOrFatal(
        internalResult,
        testOperationContext("test internal continuation"),
        onFulfilled,
    )
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
    // A full turn runs the recursively queued promise jobs from this turn.
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
    expect(getRefCounts(value)).to.eql({
        promiseCount,
        errorCount,
        cycleCutCount,
    })
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
    externalState,
    managedState,
    managedStateClass,
    Execution,
} from "../src/index.js"

export {
    getRefCounter,
    getRefCounts,
}

function errorCause(value) {
    return value?.cause ?? value
}

function verifyRefCounts(...values) {
    return verifyExecutionRefCounts(
        testOperationContext("test ref verification"),
        ...values,
    )
}

export {
    expect,
    runtime,
    Chain,
    ContextChain,
    ArrayView,
    arrayViews,
    assignPath,
    advancePromiseVersion,
    buildRefIndex,
    continueInternalResultOrFatal,
    deletePath,
    decrementReadLease,
    enter,
    errorCause,
    exportValue,
    getErrors,
    hasError,
    hasCycleCut,
    importValue,
    incrementReadLease,
    lookupPath,
    languageValues,
    metaOf,
    markShared,
    testMetadata as metadata,
    continueWhenSettled,
    readPath,
    getPromiseMirror,
    continueInitialValue,
    resetTestExecution,
    run,
    runInternalStep,
    submitFatal,
    testOperationContext,
    useTestExecution,
    testPropertyVersions as propertyVersions,
    countPromiseRegistrations,
    deferred,
    flushMicrotasks,
    expectCounts,
    thrownBy,
    verifyRefCounts,
}
