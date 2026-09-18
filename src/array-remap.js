import * as arrayViews from "./array-view.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"
import * as internalSteps from "./internal-step.js"
import * as refcounts from "./refcounts.js"

function createRemap(
    array,
    operationContext,
    start = 0,
    end = arrayViews.logicalArrayLength(array, operationContext),
) {
    const remap = new Array(end - start)
    for (const key of arrayViews.enumerableArrayKeys(
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

function traceArrayMutation(array, operationContext) {
    // Untouched placements remain in the source until the intrinsic completes.
    const deleted = new Set()
    let sourceLength = arrayViews.logicalArrayLength(array, operationContext)
    const partial = new Array(sourceLength)
    const working = new Proxy(partial, {
        has(target, key) {
            if (!arrayViews.isArrayIndex(key)) {
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
            if (!arrayViews.isArrayIndex(key)) {
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
            if (arrayViews.isArrayIndex(key)) {
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
function settleDenseRemap(remap, operation) {
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
    traceArrayMutation,
    createArrayFromRemap,
    createRemap,
    placeRemap,
    settleDenseRemap,
}
