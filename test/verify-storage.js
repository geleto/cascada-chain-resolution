import { getPlacementVersion } from "../src/property-versions.js"
import { logicalVersionEntries } from "./verify-parents.js"
// Test-only storage oracle. Physical storage is a cache beneath installed
// placement versions, and a settled absent version may retire only when that
// fallback is absent too. Check every storage fact an installed version
// records, including inside retained recovery baselines, so a later retirement
// cannot expose stale data. Valid between transitions, not only at quiescence.
import * as errorUtils from "../src/error.js"
import * as metadata from "../src/meta.js"
import * as languageProperties from "../src/language-properties.js"
import * as languageValues from "../src/language-values.js"

function verifyStorage(operationContext, ...roots) {
    const seen = new Set()
    for (const root of roots) visit(root)

    function visit(node) {
        if (!languageValues.isTraversable(node, operationContext) || seen.has(node)) return
        seen.add(node)
        const meta = metadata.metaOf(node, operationContext)
        for (const [key, version] of logicalVersionEntries(meta)) {
            if (version.storageAbsent === true &&
                languageProperties.getLanguagePlacementDescriptor(node, key, operationContext)) {
                fatal("Absent storage fact hides a physical placement", operationContext)
            }
            visit(version.recovery?.value)
        }
        for (const key of languageProperties.enumerableLanguageKeys(node, operationContext)) {
            const child = languageProperties.readLanguageProperty(node, key, operationContext)
            visit(child)
        }
    }
}

function fatal(message, operationContext) {
    errorUtils.failExecution(operationContext, new Error(message))
}

function getPromiseVersion(owner, key, operationContext) {
    const version = getPlacementVersion(owner, key, operationContext)
    return version?.promiseBacked === true ? version : undefined
}

export { verifyStorage, getPromiseVersion }
