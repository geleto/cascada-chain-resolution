import { ArrayView } from "./array-view.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"
import * as internalSteps from "./internal-step.js"
import * as refcounts from "./refcounts.js"

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
    createArrayFromRemap,
    createRemap,
    placeRemap,
    resolveDenseRemapPresence,
}
