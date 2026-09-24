import { TREE_NODE, findBranch } from "../src/external-mutation-tree.js"
import * as internalSteps from "../src/internal-step.js"
import expect from "expect.js"

import * as runtime from "../src/index.js"
import * as sourceArrayViews from "../src/array-view.js"
import * as errorUtils from "../src/error.js"
import * as metadata from "../src/meta.js"
import * as propertyVersions from "../src/property-versions.js"
import * as refcounts from "../src/refcounts.js"
import * as sourceLanguageValues from "../src/language-values.js"
import { readLanguageProperty } from "../src/language-properties.js"
import { OperationOwner } from "../src/operation-lifecycle.js"
import { walkObservationPath } from "../src/observations.js"
import { verifyRefCounts as verifyExecutionRefCounts } from "./verify-refcounts.js"

let testExecution

// Tests inspect the same logical owner surface as runtime consumers. ArrayView
// is only a storage projection and has no separate semantic read interface.
export { readLanguageProperty as logicalProperty, enumerableLanguageKeys as logicalKeys } from "../src/language-properties.js"
export function* logicalArrayValues(array, operationContext) {
    const length = sourceArrayViews.ArrayView.minimumLength(array, operationContext)
    for (let index = 0; index < length; index++) yield readLanguageProperty(array, String(index), operationContext)
}

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
    mutationAccessTree = undefined,
) {
    return new runtime.ContextChain(
        initialValue,
        testOperationContext(errorContext, execution),
        mutationAccessTree,
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

// Inspect logical storage without the public lookup's final output sharing.
// Pending transitions still use the walker's ordinary capture protection.
function readPath(chain, path) {
    const operationContext = chainOperationContext(chain, "test read")
    return internalSteps.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        const owner = new OperationOwner(operationContext)
        const result = walkObservationPath(chain, [...(chain._rootPath ?? []), ...path], operationContext, value => value, undefined, undefined, { owner })
        return internalSteps.continueOperation(result, operationContext, value => { owner.close(); return value })
    })
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
        { repair: false, ...facts },
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

function getPromiseVersion(owner, key) {
    return propertyVersions.getPromiseVersion(
        owner,
        key,
        testOperationContext("test Promise version"),
    )
}

function publishPromiseVersion(owner, key, promiseVersion, placement) {
    return propertyVersions.publishPromiseVersion(
        owner,
        key,
        promiseVersion,
        placement,
        testOperationContext("test Promise advancement"),
    )
}

function buildRefIndex(value) {
    return refcounts.buildRefIndex(value, testOperationContext("test ref index"))
}

function getRefCounter(value) {
    return refcounts.getRefCounter(value, testOperationContext("test ref count"))
}

function hasCycleCut(value, key) {
    return refcounts.hasCycleCut(
        value,
        key,
        testOperationContext("test cycle cut"),
    )
}

function runInternalStep(work) {
    return internalSteps.runInternalStep(
        testOperationContext("test fatal work"),
        work,
    )
}

function submitFatal(reason, errorContext = "test fatal injection") {
    errorUtils.failExecution(
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
export function arrayBacking(value, operationContext = testOperationContext("test Array backing")) {
    const projection = sourceArrayViews.ArrayView.projectionOf(value, operationContext)
    return sourceArrayViews.isArrayView(projection, operationContext) ? projection._backing : projection
}
ArrayView.projectionOf = value => sourceArrayViews.ArrayView.projectionOf(
    value, testOperationContext("test Array projection"))
ArrayView.minimumLength = (value, operationContext = testOperationContext("test Array minimum")) =>
    sourceArrayViews.ArrayView.minimumLength(value, operationContext)

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
}

const testPropertyVersions = {
    ...propertyVersions,
    getPromiseVersion: (owner, key) => propertyVersions.getPromiseVersion(
        owner,
        key,
        testOperationContext("test Promise version"),
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

function consumeValue(value, fn) {
    return internalSteps.consumeValue(
        value,
        testOperationContext("test initial resolution"),
        errorUtils.ERROR_KIND.OperationInputFailed,
        fn,
    )
}

function advanceSettledValue(promise, fn) {
    return internalSteps.continueOperation(
        promise,
        testOperationContext("test later resolution"),
        fn,
        fn,
    )
}

function continueOperation(internalResult, onFulfilled) {
    return internalSteps.continueOperation(
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
    const counter = getRefCounter(value)
    expect(counter.promiseCount).to.be(promiseCount)
    expect(counter.errorCount).to.be(errorCount)
    expect(counter.cycleCutCount).to.be(cycleCutCount)
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
    publishPromiseVersion,
    buildRefIndex,
    continueOperation,
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
    advanceSettledValue,
    readPath,
    getPromiseVersion,
    consumeValue,
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

export function externalLocations(tree, path = []) {
    const found = []
    visit(findBranch(tree, path))
    return found
    function visit(node) {
        if (!node) return
        if (node[TREE_NODE].identity) found.push(node)
        for (const child of Object.values(node)) visit(child)
    }
}
