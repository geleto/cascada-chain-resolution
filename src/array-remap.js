import { ArrayView } from "./array-view.js"
import { defineCopyProperty } from "./placement-structure.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"
import * as internalSteps from "./internal-step.js"
import * as refcounts from "./refcounts.js"

// Fix presence without consuming values. Complete preparation supplies a guard
// to retain unreadable placements as Error inputs; structural remaps fail fast.
function createRemap(
    array,
    operationContext,
    start = 0,
    end = undefined,
    inspect = action => action(),
) {
    const remap = new Array((end ?? ArrayView.minimumLength(array, operationContext)) - start)
    for (const key of languageProperties.enumerableLanguageKeyCandidates(
        array,
        operationContext,
        start,
        end,
    )) {
        const placement = inspect(() => propertyVersions.getPropertyPlacement(array, key, operationContext))
        if (placement === undefined) continue
        defineCopyProperty(remap, String(Number(key) - start), placement)
    }
    return remap
}

function createArrayFromRemap(
    remap,
    operationContext,
    refIndexSource = undefined,
) {
    const output = new Array(remap.length)
    languageValues.admitReadyValue(
        output,
        operationContext,
        languageValues.TYPE.Array,
    )
    placeRemap(output, remap, operationContext)
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
) {
    for (const index of Object.keys(remap))
        placeEntry(destination, String(offset + Number(index)), remap[index], operationContext)
}

function placeEntry(destination, key, entry, operationContext) {
    if (propertyVersions.isPropertyPlacement(entry)) {
        propertyVersions.transferPlacement(entry.ensureCaptured(), destination, key, operationContext, true)
        return
    }
    propertyVersions.assignProperty(
        destination,
        key,
        entry,
        operationContext,
        true,
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
    createArrayFromRemap,
    createRemap,
    placeRemap,
    resolveDenseRemapPresence,
}
