import expect from "expect.js"
import * as internalSteps from "../src/internal-step.js"
import * as metadata from "../src/meta.js"
import { ArrayView } from "../src/array-view.js"
import { getRefCounter } from "../src/refcounts.js"
import { readLanguageProperty } from "../src/language-properties.js"
import { OperationOwner } from "../src/operation-lifecycle.js"
import { walkObservationPath } from "../src/path-operation.js"
import { TREE_NODE, findBranch } from "../src/external-mutation-tree.js"

export { expect }
export { readLanguageProperty as logicalProperty, enumerableLanguageKeys as logicalKeys } from "../src/language-properties.js"

export function* logicalArrayValues(array, operationContext) {
    const length = ArrayView.minimumLength(array, operationContext)
    for (let index = 0; index < length; index++) yield readLanguageProperty(array, String(index), operationContext)
}

// Inspect logical storage without the public lookup's result handoff lease.
// Pending transitions still use the walker's ordinary capture protection.
export function readPath(chain, path, operationContext) {
    return internalSteps.runInternalStep(operationContext, () => {
        chain._assertOperationContext(operationContext)
        const owner = new OperationOwner(operationContext)
        const result = walkObservationPath(chain, [...(chain._rootPath ?? []), ...path], operationContext, value => value, undefined, undefined, { owner })
        return internalSteps.continueOperation(result, operationContext, value => { owner.close(); return value })
    })
}

export function arrayBacking(value, operationContext) {
    return metadata.metaOf(value, operationContext)?.arrayRange?.backing ?? value
}

export function lengthNotificationCount(source) {
    return [...source.consumers.values()].filter(node => node !== undefined).length
}

export function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

export function flushMicrotasks() {
    // A full turn runs the recursively queued promise jobs from this turn.
    return new Promise(resolve => setImmediate(resolve))
}

export function countPromiseRegistrations(promise) {
    // Observe registrations on this exact promise without changing settlement.
    let count = 0
    const then = promise.then
    promise.then = function (...args) {
        count++
        return then.apply(this, args)
    }
    return () => count
}

export function hasCycleCut(parent, key, operationContext) {
    return metadata.metaOf(parent, operationContext)?.cycleCuts?.has(key) === true
}

export function expectCounts(operationContext, value, frontierCount, errorCount) {
    const counter = getRefCounter(value, operationContext)
    expect(counter.frontierCount).to.be(frontierCount)
    expect(counter.errorCount).to.be(errorCount)
}

export function thrownBy(fn) {
    try {
        fn()
    } catch (error) {
        return error
    }
    return undefined
}

export function errorCause(value) {
    return value?.cause ?? value
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

export function externalLocationPaths(tree, path = []) {
    if (!tree) return []
    const paths = tree[TREE_NODE].identity ? [path] : []
    for (const key of Object.keys(tree)) paths.push(...externalLocationPaths(tree[key], [...path, key]))
    return paths
}
