import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

// Classify one imported graph while exposing its Promise placements to the
// property-version protocol. Runtime-owned islands keep their ownership but
// still expose their currently available Promise frontier.
function prepareImportedData(
    root,
    importBoundary,
    explicitImport,
    prepareImportedPromise,
    getOrCreatePromise,
) {
    if (!canHaveImportBoundary(root)) return
    const importVisited = new Set()
    const runtimeScanned = new Set()
    const metadataBeforeRuntimeScan = new Set()
    walkImported(root, explicitImport)

    function walkImported(value, promote = false) {
        if (!canHaveImportBoundary(value)) return
        if (importVisited.has(value)) {
            metadata.markShared(value)
            return
        }
        importVisited.add(value)

        const hasExistingWorld = runtimeScanned.has(value)
            ? metadataBeforeRuntimeScan.has(value)
            : metadata.hasOperationalMetadata(value)
        const alreadyImported = metadata.importBoundaryOf(value) !== undefined
        if (
            !promote &&
            hasExistingWorld &&
            (!alreadyImported || !explicitImport)
        ) {
            metadata.markShared(value)
            walkRuntime(value)
            return
        }

        // Explicit import revisits imported identities so interrupted admission
        // can resume. A prior runtime scan does not block this imported pass.
        runtimeScanned.add(value)
        metadata.markImported(value, importBoundary)
        if (!languageValues.isTraversable(value)) return
        for (const key of languageProperties.enumerableLanguageKeys(value)) {
            const child = languageProperties.readLanguageProperty(value, key)
            if (languageValues.isPromise(child)) {
                const preparePromise = alreadyImported
                    ? getOrCreatePromise
                    : prepareImportedPromise
                preparePromise(value, key, child)
            } else {
                walkImported(child)
            }
        }
    }

    function canHaveImportBoundary(value) {
        const type = languageValues.typeOf(value)
        return type !== languageValues.TYPE_PRIMITIVE &&
            type !== languageValues.TYPE_STRING &&
            type !== languageValues.TYPE_ERROR
    }

    function walkRuntime(value) {
        if (
            !languageValues.isTraversable(value) ||
            runtimeScanned.has(value)
        ) return
        // Promise discovery can add metadata. Remember whether the identity
        // already had a world so new metadata cannot hide a later direct path
        // from the imported graph.
        if (metadata.hasOperationalMetadata(value)) {
            metadataBeforeRuntimeScan.add(value)
        }
        runtimeScanned.add(value)
        for (const key of languageProperties.enumerableLanguageKeys(value)) {
            const child = languageProperties.readLanguageProperty(value, key)
            if (languageValues.isPromise(child)) {
                getOrCreatePromise(value, key, child)
            } else {
                walkRuntime(child)
            }
        }
    }
}

export { prepareImportedData }
