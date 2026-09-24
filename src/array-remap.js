import { ArrayView, isArrayIndex } from "./array-view.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"
import * as internalSteps from "./internal-step.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"

// Direct length mutation can remove live placements in its truncated suffix.
// Wait for their transitions, never for ordinary data they publish. Method
// remaps instead transfer placements into a separate owner and need no wait.
function resolveTruncatedArrayTransitions(array, work, start) {
    const context = work.operationContext
    const versions = metadata.metaOf(array, context)?.placementVersions
    if (!versions) return undefined
    const waits = []
    for (const key of Object.keys(versions)) {
        const version = versions[key]
        if (Number(key) < start || !version?.transition) continue
        const wait = propertyVersions.resolvePlacementTransition(
            propertyVersions.capturePlacementFromVersion(version), context, () => undefined)
        if (languageValues.isPending(wait, context)) waits.push(wait)
    }
    return waits.length ? internalSteps.continueOperation(
        waits.length === 1 ? waits[0] : Promise.all(waits), context, () => undefined, undefined, work) : undefined
}

function createRemap(
    array,
    operationContext,
    start = 0,
    end = undefined,
) {
    const remap = new Array((end ?? ArrayView.minimumLength(array, operationContext)) - start)
    for (const key of languageProperties.enumerableLanguageKeys(
        array,
        operationContext,
        start,
        end,
    )) {
        languageProperties.writeLanguageProperty(
            remap,
            String(Number(key) - start),
            propertyVersions.getPropertyPlacement(array, key, operationContext),
            operationContext,
        )
    }
    return remap
}

function traceArrayMutation(array, operationContext, length) {
    // Untouched placements remain in the source until the intrinsic completes.
    const deleted = new Set()
    let sourceLength = length
    const partial = new Array(sourceLength)
    const working = new Proxy(partial, {
        has(target, key) {
            if (!isArrayIndex(key)) {
                return Reflect.has(target, key)
            }
            if (Object.hasOwn(target, key)) return true
            if (deleted.has(key) || Number(key) >= sourceLength) return false
            return languageProperties.hasLanguageProperty(
                array,
                key,
                operationContext,
            )
        },
        get(target, key, receiver) {
            if (!isArrayIndex(key)) {
                return Reflect.get(target, key, receiver)
            }
            if (Object.hasOwn(target, key)) return target[key]
            if (deleted.has(key) || Number(key) >= sourceLength) {
                return undefined
            }
            // Assignment could invoke an inherited numeric setter.
            const placement = propertyVersions.getPropertyPlacement(
                array,
                key,
                operationContext,
            )
            if (placement) languageProperties.writeLanguageProperty(
                target,
                key,
                placement,
                operationContext,
            )
            return placement
        },
        set(target, key, value) {
            if (key === "length") {
                sourceLength = Math.min(sourceLength, value)
            }
            return Reflect.set(target, key, value, target)
        },
        deleteProperty(target, key) {
            if (isArrayIndex(key)) {
                deleted.add(key)
            }
            return Reflect.deleteProperty(target, key)
        },
    })
    return { working, materialize }

    function materialize() {
        const remap = createRemap(array, operationContext, 0, sourceLength)
        remap.length = partial.length
        for (const key of deleted) delete remap[key]
        for (const key of Object.keys(partial))
            languageProperties.writeLanguageProperty(remap, key, partial[key], operationContext)
        return remap
    }
}

function createArrayFromRemap(
    remap,
    operationContext,
    refIndexSource = undefined,
    retained = true,
) {
    const output = new Array(remap.length)
    languageValues.admitReadyValue(
        output,
        operationContext,
        languageValues.TYPE.Array,
    )
    placeRemap(output, remap, operationContext, 0, retained)
    if (refIndexSource !== undefined) {
        refcounts.indexValueIfSourceIndexed(
            refIndexSource,
            output,
            operationContext,
        )
    }
    return output
}

function placeRemap(
    destination,
    remap,
    operationContext,
    offset = 0,
    retained = true,
) {
    for (const index of Object.keys(remap))
        placeEntry(destination, String(offset + Number(index)), remap[index], retained, operationContext)
}

function placeEntry(destination, key, entry, retained, operationContext) {
    if (propertyVersions.isPropertyPlacement(entry)) {
        propertyVersions.transferPlacement(entry.ensureCaptured(), destination, key, operationContext, retained)
        return
    }
    propertyVersions.assignProperty(
        destination,
        key,
        entry,
        operationContext,
        retained,
    )
}

// The intrinsic has already made every output position present. A source gate
// that publishes absence therefore contributes explicit undefined, not a hole.
function resolveDenseRemapPresence(remap, operation) {
    const waits = []
    for (const key of Object.keys(remap)) {
        const placement = remap[key]
        if (!propertyVersions.isPropertyPlacement(placement)) continue
        const pending = internalSteps.continueOperation(placement.resolvePresence(), operation.operationContext, () => {
            if (placement.present === false) remap[key] = undefined
        }, undefined, operation)
        if (languageValues.isPending(pending, operation.operationContext)) waits.push(pending)
    }
    return internalSteps.continueOperation(waits.length ? Promise.all(waits) : undefined,
        operation.operationContext, () => remap, undefined, operation)
}

export {
    resolveTruncatedArrayTransitions,
    traceArrayMutation,
    createArrayFromRemap,
    createRemap,
    placeRemap,
    resolveDenseRemapPresence,
}
