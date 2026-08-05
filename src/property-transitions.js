import * as errorUtils from "./error.js"
import * as imports from "./import.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as refcounts from "./refcounts.js"

// Coordinate logical property state while refcounts transparently account for
// the same update when the owner already belongs to an index.

function replaceProperty(owner, key, propertyMirror, newValue) {
    const cycleCut = refcounts.prepareRefEdge(owner, newValue)
    refcounts.commitLiveEdge(
        owner,
        key,
        () => {
            promiseMirrors.detachPromiseMirror(owner, key)
            languageProperties.writeLanguageProperty(owner, key, newValue)
            refcounts.clearCycleCut(owner, key)
            if (cycleCut) refcounts.setCycleCut(owner, key)
            if (propertyMirror) {
                promiseMirrors.installPromiseMirror(owner, key, propertyMirror)
            }
        },
    )
}

function setMirrorValue(
    owner,
    key,
    mirror,
    newValue,
    {
        importBoundary = undefined,
        sharedBacking = false,
    } = {},
) {
    if (languageValues.isPromise(newValue)) {
        errorUtils.reportFatalError(
            new Error("A Promise requires a fresh property version"),
        )
    }
    if (importBoundary) {
        imports.prepareImportedValue(newValue, importBoundary)
    }
    const isLive = mirror.isLive(owner, key)
    // Each resolver supplies the import token captured at its program position.
    const resolvesPrivately = isLive && importBoundary !== undefined
    if (isLive && !resolvesPrivately) {
        const newValueBoundary = metadata.importBoundaryOf(newValue)
        languageProperties.assertCanUpdatePromiseProperty(
            owner,
            key,
            newValueBoundary?.errorContext,
        )
    }
    const cycleCut = isLive
        ? refcounts.prepareRefEdge(owner, newValue)
        : false
    if (!isLive) refcounts.indexValueIfSourceIndexed(owner, newValue)

    if (isLive) {
        const commit = sharedBacking
            ? refcounts.commitPendingPromiseEdge
            : refcounts.commitLiveEdge
        commit(owner, key, () => {
            if (resolvesPrivately) mirror.resolvedValue = newValue
            else languageProperties.writeLanguageProperty(owner, key, newValue)
            if (cycleCut) refcounts.setCycleCut(owner, key)
            else refcounts.clearCycleCut(owner, key)
        })
    } else {
        mirror.detachedValue = newValue
    }
}

function removeProperty(owner, key, remove) {
    refcounts.commitLiveEdge(owner, key, () => {
        promiseMirrors.detachPromiseMirror(owner, key)
        if (remove) remove()
        else languageProperties.deleteLanguageProperty(owner, key)
        refcounts.clearCycleCut(owner, key)
    })
}

export {
    removeProperty,
    replaceProperty,
    setMirrorValue,
}
