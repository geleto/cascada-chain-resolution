import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as imports from "./import.js"
import * as languageProperties from "./language-properties.js"

function getRefCounter(node) {
    const meta = metadata.metaOf(node)
    return meta?.parents ? meta : undefined
}

function getRequiredRefCounter(node) {
    const counter = getRefCounter(node)
    if (!counter) {
        errorUtils.reportFatalError(new Error("Ref counts require a ref-indexed value"))
    }
    return counter
}

function getRefCounts(value) {
    if (helpers.isPromise(value)) return [1, 0, 0]
    if (helpers.isError(value)) return [0, 1, 0]
    if (!helpers.isTracked(value)) return [0, 0, 0]

    const counter = getRequiredRefCounter(value)
    return [
        counter.promiseCount,
        counter.errorCount,
        counter.cycleCutCount,
    ]
}

function getPropertyRefState(parent, key) {
    const child = languageProperties.readLanguageProperty(parent, key)
    if (helpers.isPromise(child)) {
        return { child: undefined, counts: [1, 0, 0] }
    }
    if (imports.hasCycleCut(parent, key)) {
        return { child: undefined, counts: [0, 0, 1] }
    }
    return { child, counts: getRefCounts(child) }
}

function buildRefIndex(value, inheritedImportBoundary = undefined) {
    if (!helpers.isTracked(value) || getRefCounter(value)) return value

    const cutTargetQueue = []
    indexComponent(value, inheritedImportBoundary, cutTargetQueue)

    // A cut blocks count propagation, not indexing. Defer its target until the
    // current component is published so a closing back edge cannot re-enter an
    // active recursive frame.
    for (let index = 0; index < cutTargetQueue.length; index++) {
        const target = cutTargetQueue[index]
        if (!getRefCounter(target.value)) {
            indexComponent(
                target.value,
                target.inheritedImportBoundary,
                cutTargetQueue,
            )
        }
    }
    return value
}

function indexValueIfSourceIndexed(source, value) {
    if (getRefCounter(source)) buildRefIndex(value)
}

// Recursively index one cut-free projected component. Its cuts become roots of
// later components in the same build.
function indexComponent(
    node,
    inheritedImportBoundary,
    cutTargetQueue,
) {
    if (!helpers.isTracked(node)) return [0, 0, 0]

    const existing = getRefCounter(node)
    if (existing) {
        return [
            existing.promiseCount,
            existing.errorCount,
            existing.cycleCutCount,
        ]
    }

    const importBoundary = metadata.nodeImportBoundary(node, inheritedImportBoundary)

    let promiseCount = 0
    let errorCount = 0
    let cycleCutCount = 0
    const childNodes = []

    for (const key of Object.keys(node)) {
        const child = languageProperties.readLanguageProperty(node, key)
        if (imports.hasCycleCut(node, key)) {
            cycleCutCount++
            cutTargetQueue.push({
                value: child,
                inheritedImportBoundary: importBoundary,
            })
            continue
        }

        if (helpers.isPromise(child)) {
            promiseMirrors.getOrCreatePromiseMirror(
                node,
                key,
                child,
                importBoundary,
            )
            promiseCount++
            continue
        }

        if (helpers.isError(child)) {
            errorCount++
            continue
        }
        if (!helpers.isTracked(child)) continue

        const childCounts = indexComponent(
            child,
            importBoundary,
            cutTargetQueue,
        )
        promiseCount += childCounts[0]
        errorCount += childCounts[1]
        cycleCutCount += childCounts[2]
        childNodes.push(child)
    }

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
) {
    const counter = getRefCounter(owner)
    const oldState = counter ? getPropertyRefState(owner, key) : undefined

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

function addParentEdge(value, parent) {
    if (!helpers.isTracked(value)) return
    const counter = getRequiredRefCounter(value)
    counter.parents.set(parent, (counter.parents.get(parent) ?? 0) + 1)
}

function removeParentEdge(value, parent) {
    if (!helpers.isTracked(value)) return
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
    commitLiveEdge,
    getRefCounter,
    getRequiredRefCounter,
    getRefCounts,
    indexValueIfSourceIndexed,
}
