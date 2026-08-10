import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"

const COMMIT_UNINDEXED_EDGE = updateProperty => updateProperty()

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

function setCycleCut(parent, key) {
    updateCycleCut(metadata.ensureMeta(parent), key, true)
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

function getValueRefState(child, cycleCut = false) {
    let promiseCount = 0
    let errorCount = 0
    let cycleCutCount = 0
    let childCounter
    if (languageValues.isPromise(child)) {
        promiseCount = 1
    } else if (cycleCut) {
        cycleCutCount = 1
    } else if (languageValues.isError(child)) {
        errorCount = 1
    } else if (languageValues.isTracked(child)) {
        childCounter = getRequiredRefCounter(child)
        promiseCount = childCounter.promiseCount
        errorCount = childCounter.errorCount
        cycleCutCount = childCounter.cycleCutCount
    }
    return { childCounter, promiseCount, errorCount, cycleCutCount }
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
function prepareRefEdge(parent, parentCounter, child, preparePromiseProperty) {
    if (!languageValues.isTracked(child)) return false
    buildRefIndex(child, preparePromiseProperty)

    const visited = new WeakSet()
    return reachesChild(parent, parentCounter)

    function reachesChild(node, counter) {
        if (node === child) return true
        if (visited.has(node)) return false
        visited.add(node)
        for (const ancestor of counter.parents.keys()) {
            if (reachesChild(ancestor, getRequiredRefCounter(ancestor))) {
                return true
            }
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

// Complete fallible graph preparation before returning a commit that touches
// only the property and captured bookkeeping state.
function prepareLiveEdge(
    owner,
    key,
    value,
    preparePromiseProperty,
) {
    const counter = getRefCounter(owner)
    if (!counter) return COMMIT_UNINDEXED_EDGE

    const cycleCut = prepareRefEdge(
        owner,
        counter,
        value,
        preparePromiseProperty,
    )
    const previousState = getValueRefState(
        languageProperties.readLanguageProperty(owner, key),
        counter.cycleCuts?.has(key) === true,
    )
    const nextState = getValueRefState(value, cycleCut)
    const applyCountUpdate = prepareCountUpdate(
        owner,
        counter,
        previousState,
        nextState,
    )
    return updateProperty => {
        updateProperty()
        updateCycleCut(counter, key, cycleCut)
        removeParentCounterEdge(previousState.childCounter, owner)
        addParentCounterEdge(nextState.childCounter, owner)
        applyCountUpdate?.()
    }
}

function addParentEdge(value, parent) {
    if (!languageValues.isTracked(value)) return
    addParentCounterEdge(getRequiredRefCounter(value), parent)
}

function addParentCounterEdge(counter, parent) {
    if (!counter) return
    counter.parents.set(parent, (counter.parents.get(parent) ?? 0) + 1)
}

function removeParentCounterEdge(counter, parent) {
    if (!counter) return
    const count = counter.parents.get(parent)
    if (count === 1) {
        counter.parents.delete(parent)
    } else if (count > 1) {
        counter.parents.set(parent, count - 1)
    }
}

function updateCycleCut(counter, key, cut) {
    if (cut) {
        counter.cycleCuts ??= new Set()
        counter.cycleCuts.add(key)
        return
    }
    if (!counter.cycleCuts) return
    counter.cycleCuts.delete(key)
    if (counter.cycleCuts.size === 0) delete counter.cycleCuts
}

function prepareCountUpdate(node, counter, previousState, nextState) {
    const promiseDelta = nextState.promiseCount - previousState.promiseCount
    const errorDelta = nextState.errorCount - previousState.errorCount
    const cycleCutDelta = nextState.cycleCutCount -
        previousState.cycleCutCount
    if (promiseDelta === 0 && errorDelta === 0 && cycleCutDelta === 0) {
        return undefined
    }

    const states = new Map()
    const ordered = []
    const source = visit(node, counter)
    source.multiplier = 1
    for (let index = ordered.length - 1; index >= 0; index--) {
        const state = ordered[index]
        for (const [parent, multiplicity] of state.counter.parents) {
            states.get(parent).multiplier += state.multiplier * multiplicity
        }
    }
    return () => {
        for (const { counter, multiplier } of ordered) {
            counter.promiseCount += promiseDelta * multiplier
            counter.errorCount += errorDelta * multiplier
            counter.cycleCutCount += cycleCutDelta * multiplier
        }
    }

    // Memoized DFS records parent-first postorder. Reversing it lets every
    // child contribute before a converging parent is updated.
    function visit(current, currentCounter) {
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
            counter: currentCounter,
            multiplier: 0,
            complete: false,
        }
        states.set(current, state)
        for (const parent of state.counter.parents.keys()) {
            visit(parent, getRequiredRefCounter(parent))
        }
        state.complete = true
        ordered.push(state)
        return state
    }
}

export {
    buildRefIndex,
    getRefCounter,
    getRequiredRefCounter,
    getRefCounts,
    hasCycleCut,
    indexValueIfSourceIndexed,
    prepareLiveEdge,
}
