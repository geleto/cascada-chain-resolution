import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
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
    if (languageValues.isPromise(value)) return [1, 0, 0]
    if (languageValues.isError(value)) return [0, 1, 0]
    if (!languageValues.isTracked(value)) return [0, 0, 0]

    const counter = getRequiredRefCounter(value)
    return [
        counter.promiseCount,
        counter.errorCount,
        counter.cycleCutCount,
    ]
}

function getPropertyRefState(parent, key) {
    const child = languageProperties.readLanguageProperty(parent, key)
    if (languageValues.isPromise(child)) {
        return { child: undefined, counts: [1, 0, 0] }
    }
    if (hasCycleCut(parent, key)) {
        return { child: undefined, counts: [0, 0, 1] }
    }
    return { child, counts: getRefCounts(child) }
}

function buildRefIndex(value) {
    if (!languageValues.isTracked(value) || getRefCounter(value)) return value

    const cutTargetQueue = []
    const active = new WeakSet()
    indexComponent(value, cutTargetQueue, active)

    // A cut blocks count propagation, not indexing. Defer its target until the
    // current component is published so a closing back edge cannot re-enter an
    // active recursive frame.
    for (let index = 0; index < cutTargetQueue.length; index++) {
        const target = cutTargetQueue[index]
        if (!getRefCounter(target)) {
            indexComponent(target, cutTargetQueue, active)
        }
    }
    return value
}

function indexValueIfSourceIndexed(source, value) {
    if (getRefCounter(source)) buildRefIndex(value)
}

// Index the prospective child, then ask the maintained reverse-edge DAG
// whether adding parent -> child would close a cycle.
function prepareRefEdge(parent, child) {
    if (!getRefCounter(parent)) return false
    buildRefIndex(child)
    if (!languageValues.isTracked(child)) return false
    if (parent === child) return true

    const parents = getRequiredRefCounter(parent).parents
    if (parents.size === 0) return false
    const visited = new WeakSet()
    const pending = [...parents.keys()]
    while (pending.length > 0) {
        const node = pending.pop()
        if (node === child) return true
        if (visited.has(node)) continue
        visited.add(node)
        for (const ancestor of getRequiredRefCounter(node).parents.keys()) {
            pending.push(ancestor)
        }
    }
    return false
}

// Recursively index one cut-free projected component. Its cuts become roots of
// later components in the same build.
function indexComponent(node, cutTargetQueue, active) {
    if (!languageValues.isTracked(node)) return [0, 0, 0]

    const existing = getRefCounter(node)
    if (existing) {
        return [
            existing.promiseCount,
            existing.errorCount,
            existing.cycleCutCount,
        ]
    }

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
            promiseMirrors.getOrCreatePromiseMirror(node, key, child)
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

        const childCounts = indexComponent(child, cutTargetQueue, active)
        promiseCount += childCounts[0]
        errorCount += childCounts[1]
        cycleCutCount += childCounts[2]
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
    return [promiseCount, errorCount, cycleCutCount]
}

function commitLiveEdge(
    owner,
    key,
    updateProperty,
    knownOldState,
) {
    const counter = getRefCounter(owner)
    const oldState = counter
        ? knownOldState ?? getPropertyRefState(owner, key)
        : undefined
    updateProperty()
    if (!counter) return

    const nextState = getPropertyRefState(owner, key)
    removeParentEdge(oldState.child, owner)
    addParentEdge(nextState.child, owner)
    applyCountDelta(
        owner,
        nextState.counts[0] - oldState.counts[0],
        nextState.counts[1] - oldState.counts[1],
        nextState.counts[2] - oldState.counts[2],
    )
}

function commitPendingPromiseEdge(owner, key, updateProperty) {
    // An ArrayView fork can remain logically pending after its backing advances.
    commitLiveEdge(
        owner,
        key,
        updateProperty,
        { child: undefined, counts: [1, 0, 0] },
    )
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

function applyCountDelta(node, promiseDelta, errorDelta, cycleCutDelta) {
    if (promiseDelta === 0 && errorDelta === 0 && cycleCutDelta === 0) return

    const counter = getRequiredRefCounter(node)
    counter.promiseCount += promiseDelta
    counter.errorCount += errorDelta
    counter.cycleCutCount += cycleCutDelta
    for (const [parent, multiplicity] of counter.parents) {
        applyCountDelta(
            parent,
            promiseDelta * multiplicity,
            errorDelta * multiplicity,
            cycleCutDelta * multiplicity,
        )
    }
}

export {
    buildRefIndex,
    clearCycleCut,
    commitLiveEdge,
    commitPendingPromiseEdge,
    getRefCounter,
    getRequiredRefCounter,
    getRefCounts,
    hasCycleCut,
    indexValueIfSourceIndexed,
    prepareRefEdge,
    setCycleCut,
}
