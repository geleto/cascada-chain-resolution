import * as steps from "./internal-step.js"
import * as properties from "./language-properties.js"
import * as values from "./language-values.js"
import * as versions from "./property-versions.js"

// Fix presence before consuming values, retaining per-key reflection failures
// through the caller's boundary without dropping other discoverable keys.
function captureManagedKeys(value, operationContext, inspect) {
    const keys = []
    inspect(() => {
        for (const key of properties.enumerableLanguageKeyCandidates(value, operationContext)) {
            const present = inspect(() => properties.hasLanguageProperty(value, key, operationContext))
            if (present === true) keys.push(key)
        }
    })
    return keys
}

// Consume placements in source order and finish all available work before
// joining pending children. Callers own identity tracking and Error collection.
function walkManagedProperties(value, owner, inspect, visit, beforePending, onCapture) {
    const operationContext = owner.operationContext
    const keys = captureManagedKeys(value, operationContext, inspect)
    const complete = onCapture?.(keys)
    const waits = []
    for (const key of keys) {
        const child = inspect(() => properties.readLanguageProperty(value, key, operationContext))
        let readiness
        if (values.isPending(child, operationContext)) {
            beforePending?.(key)
            readiness = versions.observePromiseVersion(
                child, versions.requirePromiseVersion(value, key, operationContext), operationContext,
                (resolved, version) => visit(resolved, key, version.present !== false), owner)
        } else readiness = visit(child, key)
        if (values.isPending(readiness, operationContext)) waits.push(readiness)
    }
    if (waits.length === 0) return complete?.()
    return steps.continueOperation(waits.length === 1 ? waits[0] : Promise.all(waits), operationContext,
        () => complete?.(), undefined, owner)
}

export { captureManagedKeys, walkManagedProperties }
