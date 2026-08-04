import * as imports from "./import.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as refcounts from "./refcounts.js"

// Coordinate logical property state while refcounts transparently account for
// the same update when the owner already belongs to an index.

function replaceProperty(
    owner, key, propertyMirror, newValue, cycleCut = false,
) {
    refcounts.indexValueIfSourceIndexed(owner, newValue)
    refcounts.commitLiveEdge(
        owner,
        key,
        () => {
            promiseMirrors.detachPromiseMirror(owner, key)
            languageProperties.writeLanguageProperty(owner, key, newValue)
            imports.clearCycleCut(owner, key)
            if (cycleCut) imports.setCycleCut(owner, key)
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
    cycleCut = false,
    sharedBacking = false,
) {
    if (languageValues.isPromise(newValue)) {
        errorUtils.reportFatalError(
            new Error("A Promise requires a fresh property version"),
        )
    }
    const isLive = mirror.isLive(owner, key)
    const resolvesPrivately = mirror.importBoundary !== undefined
    if (isLive && !resolvesPrivately) {
        const importBoundary = metadata.nodeImportBoundary(newValue)
        languageProperties.assertCanUpdatePromiseProperty(
            owner,
            key,
            importBoundary?.errorContext,
        )
    }
    refcounts.indexValueIfSourceIndexed(owner, newValue)

    if (isLive) {
        const commit = sharedBacking
            ? refcounts.commitPendingPromiseEdge
            : refcounts.commitLiveEdge
        commit(owner, key, () => {
            if (resolvesPrivately) mirror.resolvedValue = newValue
            else languageProperties.writeLanguageProperty(owner, key, newValue)
            if (cycleCut) imports.setCycleCut(owner, key)
            else imports.clearCycleCut(owner, key)
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
        imports.clearCycleCut(owner, key)
    })
}

export {
    removeProperty,
    replaceProperty,
    setMirrorValue,
}
