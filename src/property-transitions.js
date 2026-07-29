import * as imports from "./import.js"
import * as helpers from "./helpers.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as refcounts from "./refcounts.js"

// Coordinate physical property state while refcounts transparently account
// for the same update when the owner already belongs to an index.

function replaceProperty(owner, key, propertyMirror, newValue) {
    refcounts.indexValueIfSourceIndexed(owner, newValue)
    refcounts.commitLiveEdge(
        owner,
        key,
        () => {
            promiseMirrors.detachPromiseMirror(owner, key)
            languageProperties.writeLanguageProperty(owner, key, newValue)
            imports.clearCycleCut(owner, key)
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
) {
    if (helpers.isPromise(newValue)) {
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
            owner, key, importBoundary?.errorContext,
        )
    }
    // An indexed observer may still own a detached mirror version. Its resolved
    // branch needs counters even though it no longer contributes to this edge.
    refcounts.indexValueIfSourceIndexed(owner, newValue)

    if (isLive) {
        refcounts.commitLiveEdge(owner, key, () => {
            languageProperties.writeLanguageProperty(owner, key, newValue)
            if (cycleCut) imports.setCycleCut(owner, key)
            else imports.clearCycleCut(owner, key)
        })
    } else {
        // A detached version has no placement for a cycle cut.
        mirror.detachedValue = newValue
    }
    delete mirror.importBoundary
}

function deleteProperty(parent, key) {
    refcounts.commitLiveEdge(parent, key, () => {
        promiseMirrors.detachPromiseMirror(parent, key)
        delete parent[key]
        imports.clearCycleCut(parent, key)
    })
}

export {
    deleteProperty,
    replaceProperty,
    setMirrorValue,
}
