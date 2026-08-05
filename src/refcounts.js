import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"

function getRefCounter(node) {
    const meta = metadata.metaOf(node)
    return meta?.parents ? meta : undefined
}

function getRequiredRefCounter(node) {
    const counter = getRefCounter(node)
    if (!counter) {
        errorUtils.reportFatalError(
            new Error("Ref counts require a ref-indexed value"),
        )
    }
    return counter
}

function hasCycleCut(parent, key) {
    return metadata.metaOf(parent)?.cycleCuts?.has(key) === true
}

function clearCycleCut(parent, key) {
    const meta = metadata.metaOf(parent)
    if (!meta?.cycleCuts) return
    meta.cycleCuts.delete(key)
    if (meta.cycleCuts.size === 0) delete meta.cycleCuts
}

function setCycleCut(parent, key) {
    const meta = metadata.ensureMeta(parent)
    meta.cycleCuts ??= new Set()
    meta.cycleCuts.add(key)
}

function getRefCounts(value) {
    let promiseCount = 0
    let errorCount = 0
    let cycleCutCount = 0
    if (languageValues.isPromise(value)) promiseCount = 1
    else if (languageValues.isError(value)) errorCount = 1
    else if (languageValues.isTracked(value)) {
        const counter = getRequiredRefCounter(value)
        promiseCount = counter.promiseCount
        errorCount = counter.errorCount
        cycleCutCount = counter.cycleCutCount
    }
    return { promiseCount, errorCount, cycleCutCount }
}

function getPropertyRefState(parent, key) {
    let child = languageProperties.readLanguageProperty(parent, key)
    let promiseCount = 0
    let errorCount = 0
    let cycleCutCount = 0
    if (languageValues.isPromise(child)) {
        child = undefined
        promiseCount = 1
    } else if (hasCycleCut(parent, key)) {
        child = undefined
        cycleCutCount = 1
    } else if (languageValues.isError(child)) {
        errorCount = 1
    } else if (languageValues.isTracked(child)) {
        const counter = getRequiredRefCounter(child)
        promiseCount = counter.promiseCount
        errorCount = counter.errorCount
        cycleCutCount = counter.cycleCutCount
    }
    return { child, promiseCount, errorCount, cycleCutCount }
}

function buildRefIndex(value, preparePromiseProperty) {
    if (!languageValues.isTracked(value) || getRefCounter(value)) return value

    const cutTargetQueue = []
    indexComponent(value, cutTargetQueue, preparePromiseProperty)

    // A cut blocks count propagation, not indexing. Defer its target until the
    // current component is published so a closing back edge cannot re-enter an
    // active recursive frame.
    for (let index = 0; index < cutTargetQueue.length; index++) {
        const target = cutTargetQueue[index]
        if (!getRefCounter(target)) {
            indexComponent(target, cutTargetQueue, preparePromiseProperty)
        }
    }
    return value
}

function indexValueIfSourceIndexed(source, value, preparePromiseProperty) {
    if (getRefCounter(source)) buildRefIndex(value, preparePromiseProperty)
}

// Index the prospective child, then ask the maintained reverse-edge DAG
// whether adding parent -> child would close a cycle.
function prepareRefEdge(parent, child, preparePromiseProperty) {
    if (!getRefCounter(parent)) return false
    buildRefIndex(child, preparePromiseProperty)
    if (!languageValues.isTracked(child)) return false

    const visited = new WeakSet()
    return reachesChild(parent)

    function reachesChild(node) {
        if (node === child) return true
        if (visited.has(node)) return false
        visited.add(node)
        for (const ancestor of getRequiredRefCounter(node).parents.keys()) {
            if (reachesChild(ancestor)) return true
        }
        return false
    }
}

// Recursively index one cut-free projected component. Its cuts become roots of
// later components in the same build.
function indexComponent(
    node,
    cutTargetQueue,
    preparePromiseProperty,
    active = new WeakSet(),
) {
    const existing = getRefCounter(node)
    if (existing) return existing

    let promiseCount = 0
    let errorCount = 0
    let cycleCutCount = 0
    const childNodes = []
    active.add(node)

    for (const key of languageProperties.enumerableLanguageKeys(node)) {
        const child = languageProperties.readLanguageProperty(node, key)
        if (hasCycleCut(node, key)) {
            cycleCutCount++
            cutTargetQueue.push(child)
            continue
        }

        if (languageValues.isPromise(child)) {
            preparePromiseProperty(node, key, child)
            promiseCount++
            continue
        }

        if (languageValues.isError(child)) {
            errorCount++
            continue
        }
        if (!languageValues.isTracked(child)) continue

        if (active.has(child)) {
            metadata.markShared(child)
            setCycleCut(node, key)
            cycleCutCount++
            cutTargetQueue.push(child)
            continue
        }

        const childCounts = indexComponent(
            child,
            cutTargetQueue,
            preparePromiseProperty,
            active,
        )
        promiseCount += childCounts.promiseCount
        errorCount += childCounts.errorCount
        cycleCutCount += childCounts.cycleCutCount
        childNodes.push(child)
    }
    active.delete(node)

    const counter = metadata.ensureMeta(node)
    counter.promiseCount = promiseCount
    counter.errorCount = errorCount
    counter.cycleCutCount = cycleCutCount
    // Publish `parents` last. Mirror discovery uses its presence to distinguish
    // a complete index, where every Promise property must already have a mirror.
    counter.parents = new Map()
    for (const child of childNodes) addParentEdge(child, node)
    return counter
}

function commitLiveEdge(
    owner,
    key,
    value,
    preparePromiseProperty,
    updateProperty,
) {
    const cycleCut = prepareRefEdge(owner, value, preparePromiseProperty)
    const counter = getRefCounter(owner)
    const oldState = counter ? getPropertyRefState(owner, key) : undefined
    updateProperty()
    if (!counter) return

    if (cycleCut) setCycleCut(owner, key)
    else clearCycleCut(owner, key)
    const nextState = getPropertyRefState(owner, key)
    removeParentEdge(oldState.child, owner)
    addParentEdge(nextState.child, owner)
    propagateCountDelta(owner, oldState, nextState)
}

function addParentEdge(value, parent) {
    if (!languageValues.isTracked(value)) return
    const counter = getRequiredRefCounter(value)
    counter.parents.set(parent, (counter.parents.get(parent) ?? 0) + 1)
}

function removeParentEdge(value, parent) {
    if (!languageValues.isTracked(value)) return
    const counter = getRequiredRefCounter(value)
    const count = counter.parents.get(parent)
    if (count === 1) {
        counter.parents.delete(parent)
    } else if (count > 1) {
        counter.parents.set(parent, count - 1)
    }
}

function propagateCountDelta(node, previousState, nextState) {
    const promiseDelta = nextState.promiseCount - previousState.promiseCount
    const errorDelta = nextState.errorCount - previousState.errorCount
    const cycleCutDelta = nextState.cycleCutCount -
        previousState.cycleCutCount
    if (promiseDelta === 0 && errorDelta === 0 && cycleCutDelta === 0) return

    const states = new Map()
    const ordered = []
    const source = visit(node)
    source.multiplier = 1
    for (let index = ordered.length - 1; index >= 0; index--) {
        const { counter, multiplier } = ordered[index]
        counter.promiseCount += promiseDelta * multiplier
        counter.errorCount += errorDelta * multiplier
        counter.cycleCutCount += cycleCutDelta * multiplier
        for (const [parent, multiplicity] of counter.parents) {
            states.get(parent).multiplier += multiplier * multiplicity
        }
    }

    // Memoized DFS records parent-first postorder. Reversing it lets every
    // child contribute before a converging parent is updated.
    function visit(current) {
        const existing = states.get(current)
        if (existing) {
            if (!existing.complete) {
                errorUtils.reportFatalError(
                    new Error("Ref-count parent graph contains a cycle"),
                )
            }
            return existing
        }

        const state = {
            counter: getRequiredRefCounter(current),
            multiplier: 0,
            complete: false,
        }
        states.set(current, state)
        for (const parent of state.counter.parents.keys()) visit(parent)
        state.complete = true
        ordered.push(state)
        return state
    }
}

export {
    buildRefIndex,
    commitLiveEdge,
    getRefCounter,
    getRequiredRefCounter,
    getRefCounts,
    hasCycleCut,
    indexValueIfSourceIndexed,
}
