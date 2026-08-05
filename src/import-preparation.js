import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

// Classify one imported graph while exposing its Promise placements to the
// property-version protocol. Runtime-owned islands keep their ownership but
// still expose their currently available Promise frontier.
function prepareImportedData(
    root,
    importBoundary,
    promoteRoot,
    prepareImportedPromise,
    discoverRuntimePromise,
) {
    if (!languageValues.isTracked(root)) return
    const importVisited = new WeakSet()
    const runtimeScanned = new WeakSet()
    const metadataBeforeRuntimeScan = new WeakSet()
    walkImported(root, promoteRoot)

    function walkImported(value, promote = false) {
        if (!languageValues.isTracked(value)) return
        if (importVisited.has(value)) {
            metadata.markShared(value)
            return
        }
        importVisited.add(value)

        const hasExistingWorld = runtimeScanned.has(value)
            ? metadataBeforeRuntimeScan.has(value)
            : metadata.metaOf(value) !== undefined
        if (!promote && hasExistingWorld) {
            metadata.markShared(value)
            walkRuntime(value)
            return
        }

        // A later runtime path need not rescan an identity already prepared as
        // external. A prior runtime scan does not block this imported pass.
        runtimeScanned.add(value)
        metadata.markImported(value, importBoundary)
        for (const key of languageProperties.enumerableLanguageKeys(value)) {
            const child = languageProperties.readLanguageProperty(value, key)
            if (languageValues.isPromise(child)) {
                prepareImportedPromise(value, key, child)
            } else {
                walkImported(child)
            }
        }
    }

    function walkRuntime(value) {
        if (!languageValues.isTracked(value) || runtimeScanned.has(value)) return
        // Promise discovery can add metadata. Remember whether the identity
        // already had a world so new metadata cannot hide a later direct path
        // from the imported graph.
        if (metadata.metaOf(value)) metadataBeforeRuntimeScan.add(value)
        runtimeScanned.add(value)
        for (const key of languageProperties.enumerableLanguageKeys(value)) {
            const child = languageProperties.readLanguageProperty(value, key)
            if (languageValues.isPromise(child)) {
                discoverRuntimePromise(value, key, child)
            } else {
                walkRuntime(child)
            }
        }
    }
}

export { prepareImportedData }
