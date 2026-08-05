import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as resolution from "./resolution.js"

function importValue(value, errorContext) {
    return errorUtils.runFatal(() => {
        if (!errorContext) {
            throw new Error("import requires an error context")
        }
        return resolution.resolveInitialValueOrPoison(value, resolvedValue => {
            if (!languageValues.isTracked(resolvedValue)) return resolvedValue
            if (metadata.importBoundaryOf(resolvedValue)) return resolvedValue

            prepareImportedData(
                resolvedValue,
                { errorContext },
                true,
            )
            return resolvedValue
        })
    })
}

// A resolved imported Promise extends its owner's import, unless the value
// already belongs to an imported or runtime-owned world.
function prepareImportedValue(value, importBoundary) {
    prepareImportedData(value, importBoundary, false)
}

// Import classifies existing identities and installs each Promise property's
// first resolver. Cycles remain ordinary graph data until ref-indexing projects
// them onto an acyclic parent graph.
function prepareImportedData(root, importBoundary, promoteRoot) {
    if (!languageValues.isTracked(root)) return
    const visited = new WeakSet()
    walkValue(root, promoteRoot)

    function walkValue(value, promote = false) {
        if (!languageValues.isTracked(value)) return
        if (visited.has(value)) {
            metadata.markShared(value)
            return
        }
        visited.add(value)

        if (!promote && metadata.metaOf(value)) {
            metadata.markShared(value)
            discoverPromiseMirrors(value)
            return
        }

        metadata.markImported(value, importBoundary)
        for (const key of languageProperties.enumerableLanguageKeys(value)) {
            const child = languageProperties.readLanguageProperty(value, key)
            if (!languageValues.isPromise(child)) {
                walkValue(child)
                continue
            }

            const existing = promiseMirrors.getPromiseMirror(value, key)
            if (existing) {
                // Promotion changes this property's publication policy at the
                // import position, so earlier operations retain the old mirror.
                // Install directly: its earlier resolver fills detachedValue
                // before this fork samples it on the same FIFO Promise.
                promiseMirrors.forkPromiseMirror(
                    value,
                    value,
                    key,
                    child,
                    { sourceMirror: existing },
                )
            } else {
                promiseMirrors.getOrCreatePromiseMirror(value, key, child)
            }
        }
    }
}

// A runtime-owned island keeps its ownership, but import has reached its
// currently available Promise frontier and must make those placements live.
function discoverPromiseMirrors(root) {
    const visited = new WeakSet()
    walkValue(root)

    function walkValue(value) {
        if (!languageValues.isTracked(value) || visited.has(value)) return
        visited.add(value)
        for (const key of languageProperties.enumerableLanguageKeys(value)) {
            const child = languageProperties.readLanguageProperty(value, key)
            if (languageValues.isPromise(child)) {
                promiseMirrors.getOrCreatePromiseMirror(value, key, child)
            } else {
                walkValue(child)
            }
        }
    }
}

export {
    importValue as import,
    prepareImportedValue,
}
