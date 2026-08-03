import * as imports from "./import.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as refcounts from "./refcounts.js"

// Coordinate physical property state while refcounts transparently account
// for the same update when the owner already belongs to an index.

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
    prepareImportedValue,
    sharedBacking = false,
) {
    if (languageValues.isPromise(newValue)) {
        errorUtils.reportFatalError(
            new Error("A Promise requires a fresh property version"),
        )
    }
    const cycleCut = prepareImportedValue?.(
        newValue, mirror.importBoundary,
    )
    const isLive = mirror.isLive(owner, key)
    if (isLive) {
        const importBoundary = metadata.nodeImportBoundary(
            newValue, mirror.importBoundary,
        )
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
            languageProperties.writeLanguageProperty(owner, key, newValue)
            if (cycleCut) imports.setCycleCut(owner, key)
            else imports.clearCycleCut(owner, key)
        })
    } else {
        mirror.detachedValue = newValue
    }
    delete mirror.importBoundary
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
