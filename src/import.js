const {
    isPromise,
    isTracked,
    onValueResolve,
} = require("./helpers")
const {
    createCycleError,
    reportFatalError,
} = require("./error")
const {
    markImported,
    markShared,
    nodeImportBoundary,
} = require("./meta")
const {
    getCommittedCycleError,
    getPromiseMirror,
    getOrCreatePromiseMirror,
    readLogicalProperty,
} = require("./promise-mirrors")

function importValue(value, errorContext) {
    if (!errorContext) {
        reportFatalError(new Error("import requires an error context"))
    }
    if (isPromise(value)) {
        return onValueResolve(value, settled => markImported(settled, errorContext))
    }
    return markImported(value, errorContext)
}

// Imported aliases and cycles are the only graph facts trusted data cannot
// contain. Discover and publish them in one depth-first walk.
function prepareImportedData(
    importBoundary,
    writeTarget,
    excludedMirror,
    commitCycleError,
) {
    const visited = new Set()
    const currentPath = new Set()
    walkImportedData(importBoundary.root, importBoundary)

    function walkImportedData(node, inheritedBoundary) {
        if (node === writeTarget) return

        const boundary = nodeImportBoundary(node, inheritedBoundary)
        visited.add(node)
        currentPath.add(node)

        for (const key of Object.keys(node)) {
            if (getCommittedCycleError(node, key)) continue

            const mirror = getPromiseMirror(node, key)
            const child = readLogicalProperty(node, key)
            if (isPromise(child)) {
                if (mirror === excludedMirror) continue
                if (mirror?.promise === child) {
                    mirror.importBoundary ??= boundary
                    mirror.externalHolder = true
                } else {
                    getOrCreatePromiseMirror(node, key, child, boundary)
                }
                continue
            }
            if (!isTracked(child)) continue

            if (child === writeTarget) continue
            if (visited.has(child)) {
                markShared(child)
                if (currentPath.has(child)) {
                    commitCycleError(
                        node,
                        key,
                        createCycleError(key, boundary.errorContext),
                    )
                }
                continue
            }
            walkImportedData(child, boundary)
        }
        currentPath.delete(node)
    }
}

module.exports = {
    import: importValue,
    prepareImportedData,
}
