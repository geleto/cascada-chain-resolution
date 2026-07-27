import * as helpers from "./helpers.js"
import * as languageProperties from "./language-properties.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"

let commitLiveEdge

function initImport(commitLiveEdgeFn) {
    commitLiveEdge = commitLiveEdgeFn
}

function importValue(value, errorContext) {
    return helpers.runFatal(() => {
        if (!errorContext) {
            throw new Error("import requires an error context")
        }
        if (helpers.isPromise(value)) {
            return helpers.onInitialPromiseResolve(
                value,
                importResolvedValue,
            )
        }
        return importResolvedValue(value)

        function importResolvedValue(resolvedValue) {
            const createdBoundary = metadata.markImported(
                resolvedValue,
                errorContext,
            )
            const importBoundary = metadata.nodeImportBoundary(resolvedValue)
            if (createdBoundary) prepareImportedData(importBoundary)
            return resolvedValue
        }
    })
}

function hasCycleCut(parent, key) {
    return metadata.metaOf(parent)?.cycleCuts?.has(key) === true
}

// These are non-transactional storage operations used inside live-edge
// commits. Import's synchronous discovery wraps setCycleCut below.
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

function publishCycleCut(parent, key) {
    if (hasCycleCut(parent, key)) return
    commitLiveEdge(parent, key, () => setCycleCut(parent, key))
}

// Imported cycles are the graph fact trusted data cannot contain. The raw edge
// remains ordinary data; its cut only keeps the ref-index projection acyclic.
function prepareImportedData(importBoundary) {
    walkValue(
        importBoundary.root,
        importBoundary,
        {
            currentPath: new Set(),
            visited: new WeakSet(),
        },
    )

    function walkProperty(parent, key, inheritedBoundary, state) {
        if (hasCycleCut(parent, key)) return
        const value = languageProperties.readLanguageProperty(parent, key)
        if (helpers.isPromise(value)) {
            if (promiseMirrors.getPromiseMirror(parent, key)) return

            const resumedState = {
                currentPath: new Set(state.currentPath),
                visited: new WeakSet(),
            }
            promiseMirrors.getOrCreatePromiseMirror(
                parent,
                key,
                value,
                inheritedBoundary,
                (resolvedValue, inheritedResolvedBoundary) => {
                    const resolvedBoundary = metadata.nodeImportBoundary(
                        resolvedValue,
                        inheritedResolvedBoundary,
                    )
                    const cycleAncestor = walkValue(
                        resolvedValue,
                        resolvedBoundary,
                        resumedState,
                    )
                    if (resolvedBoundary) {
                        metadata.markImported(
                            resolvedValue,
                            resolvedBoundary.errorContext,
                        )
                    }
                    return cycleAncestor
                },
            )
            return
        }

        const cycleAncestor = walkValue(
            value,
            inheritedBoundary,
            state,
        )
        if (!cycleAncestor) return undefined
        // Copied ancestors predate this Promise and are absent from the fresh
        // visited set, so their cycle must bubble to the Promise placement.
        if (!state.visited.has(cycleAncestor)) return cycleAncestor
        publishCycleCut(parent, key)
        return undefined
    }

    // Returns the repeated ancestor to the incoming property. That property
    // cuts locally unless the ancestor predates this Promise segment, in which
    // case the identity bubbles up to the Promise placement.
    function walkValue(value, inheritedBoundary, state) {
        if (!helpers.isTracked(value)) return undefined
        if (state.currentPath.has(value)) {
            metadata.markShared(value)
            return value
        }
        if (state.visited.has(value)) {
            metadata.markShared(value)
            return undefined
        }
        state.visited.add(value)

        // META persists completed preparation. A later hit is a globally
        // repeated imported identity and needs only a fixed-path cycle scan.
        if (value !== importBoundary.root && metadata.metaOf(value)) {
            metadata.markShared(value)
            return scanFixedPathForCycles(
                value,
                inheritedBoundary,
                new Set(state.currentPath),
            )
        }
        metadata.ensureMeta(value)

        const valueImportBoundary = metadata.nodeImportBoundary(
            value,
            inheritedBoundary,
        )
        state.currentPath.add(value)
        let cycleAncestor
        for (const key of Object.keys(value)) {
            const foundAncestor = walkProperty(
                value,
                key,
                valueImportBoundary,
                state,
            )
            if (foundAncestor) cycleAncestor = foundAncestor
        }
        state.currentPath.delete(value)
        return cycleAncestor
    }
}

// Search an already prepared graph only for references into one fixed path.
// A synchronous match propagates to the placement that entered the graph.
function scanFixedPathForCycles(
    value,
    inheritedBoundary,
    fixedPath,
    pathRootToPin = undefined,
) {
    // A permanently pending Promise may retain this scanner indefinitely.
    const visited = new WeakSet()
    return walkValue(value, inheritedBoundary)

    function walkProperty(parent, key, inheritedBoundary) {
        if (hasCycleCut(parent, key)) return undefined
        const value = languageProperties.readLanguageProperty(parent, key)
        if (helpers.isPromise(value)) {
            if (pathRootToPin) metadata.markShared(pathRootToPin)
            if (promiseMirrors.getPromiseMirror(parent, key)) return undefined

            promiseMirrors.getOrCreatePromiseMirror(
                parent,
                key,
                value,
                inheritedBoundary,
                (resolvedValue, inheritedResolvedBoundary) => {
                    const resolvedBoundary = metadata.nodeImportBoundary(
                        resolvedValue,
                        inheritedResolvedBoundary,
                    )
                    const matchedAncestor = walkValue(
                        resolvedValue,
                        resolvedBoundary,
                    )
                    if (resolvedBoundary) {
                        metadata.markImported(
                            resolvedValue,
                            resolvedBoundary.errorContext,
                        )
                    }
                    return matchedAncestor
                },
            )
            return undefined
        }
        return walkValue(value, inheritedBoundary)
    }

    function walkValue(value, inheritedBoundary) {
        if (!helpers.isTracked(value)) return undefined
        if (fixedPath.has(value)) {
            metadata.markShared(value)
            return value
        }
        if (visited.has(value)) {
            metadata.markShared(value)
            return undefined
        }
        visited.add(value)

        const importBoundary = metadata.nodeImportBoundary(
            value,
            inheritedBoundary,
        )
        for (const key of Object.keys(value)) {
            const matchedAncestor = walkProperty(
                value,
                key,
                importBoundary,
            )
            if (matchedAncestor) return matchedAncestor
        }
        return undefined
    }
}

// A fresh assigned or forked Promise captures its destination ancestry at
// birth. Its initial resolver classifies imported data before publishing it.
function createImportedValuePreparer(ancestors) {
    const fixedPath = new Set(ancestors)
    return (value, inheritedImportBoundary) => {
        const importBoundary = metadata.nodeImportBoundary(
            value,
            inheritedImportBoundary,
        )
        const cycleCut = importBoundary &&
            scanFixedPathForCycles(value, importBoundary, fixedPath)
        if (importBoundary) {
            metadata.markImported(value, importBoundary.errorContext)
        }
        return cycleCut
    }
}

// Synchronous attachment of already resolved imported data.
function attachImportedDataToImportedData(parent, key, attachmentPath) {
    const value = languageProperties.readLanguageProperty(parent, key)
    if (helpers.isPromise(value)) return

    const importBoundary = metadata.nodeImportBoundary(value)
    if (!importBoundary) return
    if (scanFixedPathForCycles(
        value,
        importBoundary,
        new Set(attachmentPath.ancestors),
        attachmentPath.root,
    )) {
        publishCycleCut(parent, key)
    }
}

export {
    attachImportedDataToImportedData,
    clearCycleCut,
    createImportedValuePreparer,
    hasCycleCut,
    initImport,
    importValue as import,
    setCycleCut,
}
