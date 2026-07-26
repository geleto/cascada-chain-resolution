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
    const mirror = promiseMirrors.getPromiseMirror(parent, key)
    if (mirror && !mirror.isDrained()) {
        return { child: undefined, counts: [1, 0, 0] }
    }
    if (imports.hasPublishedCycleCut(parent, key)) {
        return { child: undefined, counts: [0, 0, 1] }
    }
    const child = languageProperties.readLanguageProperty(parent, key)
    return { child, counts: getRefCounts(child) }
}

function buildRefIndex(value, inheritedImportBoundary = undefined) {
    if (!helpers.isTracked(value) || getRefCounter(value)) return value

    const cutTargetQueue = []
    const importBoundary = metadata.nodeImportBoundary(value, inheritedImportBoundary)
    indexComponent(value, importBoundary, cutTargetQueue)

    // A cut blocks count propagation, not indexing. Defer its target until the
    // current component is published so a closing back edge cannot re-enter an
    // active recursive frame.
    for (let index = 0; index < cutTargetQueue.length; index++) {
        const target = cutTargetQueue[index]
        if (!getRefCounter(target.value)) {
            indexComponent(
                target.value,
                target.importBoundary,
                cutTargetQueue,
            )
        }
    }
    return value
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
        if (imports.hasPublishedCycleCut(node, key)) {
            cycleCutCount++
            const mirror = promiseMirrors.getPromiseMirror(node, key)
            cutTargetQueue.push({
                value: child,
                importBoundary: mirror?.importBoundary ??
                    metadata.nodeImportBoundary(child, importBoundary),
            })
            continue
        }

        const mirror = promiseMirrors.getOrCreateMirrorForValue(
            node,
            key,
            child,
            importBoundary,
        )
        if (helpers.isPromise(child)) {
            promiseCount++
            continue
        }

        if (helpers.isError(child)) {
            errorCount++
            continue
        }
        if (!helpers.isTracked(child)) continue

        const childImportBoundary = mirror?.importBoundary ??
            metadata.nodeImportBoundary(child, importBoundary)
        const childCounts = indexComponent(
            child,
            childImportBoundary,
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

function preparePropertyTransition(
    owner,
    propertyMirror,
    newValue,
    markNewValueShared = false,
) {
    // The next FIFO consumer may mutate this private value before the mirror
    // drains. Publish the irreversible sharing mark now so that advance COWs.
    if (markNewValueShared) metadata.markShared(newValue)
    const importBoundary = metadata.nodeImportBoundary(
        newValue,
        propertyMirror?.importBoundary,
    )
    if (propertyMirror && importBoundary) {
        propertyMirror.importBoundary = importBoundary
    }

    if (getRefCounter(owner) && helpers.isTracked(newValue)) {
        buildRefIndex(newValue, importBoundary)
    }
}

function commitPropertyTransition(owner, key, propertyMirror, newValue) {
    commitLiveEdge(
        owner,
        key,
        () => {
            if (propertyMirror) {
                languageProperties.writeLanguageProperty(
                    owner,
                    key,
                    propertyMirror.promise,
                )
                imports.clearPlainCycleCut(owner, key)
                promiseMirrors.installPromiseMirror(owner, key, propertyMirror)
            } else {
                languageProperties.writeLanguageProperty(owner, key, newValue)
                imports.clearPlainCycleCut(owner, key)
                promiseMirrors.clearPromiseMirror(owner, key)
            }
        },
    )
}

function commitMirrorDrain(mirror) {
    if (!mirror.isLive()) {
        mirror.pendingConsumerCount--
        return
    }

    if (getRefCounter(mirror.node) &&
        helpers.isTracked(mirror.currentValue) &&
        !getRefCounter(mirror.currentValue)) {
        buildRefIndex(mirror.currentValue, mirror.importBoundary)
    }

    commitLiveEdge(
        mirror.node,
        mirror.key,
        () => {
            if (!metadata.metaOf(mirror.node)?.importedOriginal &&
                Object.isExtensible(mirror.node)) {
                languageProperties.writeLanguageProperty(
                    mirror.node,
                    mirror.key,
                    mirror.currentValue,
                )
            }
            imports.clearPlainCycleCut(mirror.node, mirror.key)
            mirror.pendingConsumerCount--
        },
    )
}

function deleteEdge(parent, key) {
    commitLiveEdge(parent, key, () => {
        delete parent[key]
        promiseMirrors.clearPromiseMirror(parent, key)
        imports.clearPlainCycleCut(parent, key)
    })
}

function commitLiveEdge(owner, key, updateProperty) {
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

function indexCopyIfSourceIndexed(source, copy) {
    if (!getRefCounter(source)) return
    buildRefIndex(copy)
}

imports.initImport(commitLiveEdge, mirror => {
    preparePropertyTransition(
        mirror.node,
        mirror,
        mirror.currentValue,
    )
})

export {
    buildRefIndex,
    commitPropertyTransition,
    commitMirrorDrain,
    deleteEdge,
    getRefCounter,
    getRequiredRefCounter,
    getRefCounts,
    indexCopyIfSourceIndexed,
    preparePropertyTransition,
}
