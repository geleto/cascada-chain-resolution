import * as properties from "./language-properties.js"
import * as values from "./language-values.js"
import * as versions from "./property-versions.js"

// Consume placements in source order and finish all available work before
// joining pending children. Callers own identity tracking and Error collection.
function walkManagedProperties(value, owner, inspect, visit, onCapture) {
    const operationContext = owner.operationContext
    try {
        const keys = properties.enumerableLanguageKeys(value, operationContext, 0, undefined, inspect)
        onCapture(keys)
        const waits = []
        for (const key of keys) {
            const child = inspect(() => properties.readLanguageProperty(value, key, operationContext))
            let readiness
            if (values.isPending(child, operationContext)) {
                readiness = versions.observePromiseVersion(
                    child, versions.requirePromiseVersion(value, key, operationContext), operationContext,
                    (resolved, version) => visit(resolved, key, version.present !== false), owner)
            } else readiness = visit(child, key)
            if (values.isPending(readiness, operationContext)) waits.push(readiness)
        }
        value = undefined
        if (waits.length) return waits.length === 1 ? waits[0] : Promise.all(waits)
    } finally { value = undefined }
}

export { walkManagedProperties }
