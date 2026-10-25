import { ArrayView } from "./array-view.js"
import { defineCopyProperty } from "./placement-structure.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"
import * as internalSteps from "./internal-step.js"
import * as refcounts from "./refcounts.js"
import * as metadata from "./meta.js"
import { inheritIdentity } from "./captured-identity.js"
import { PlacementConstruction } from "./parent-placements.js"

// A controlled range write carries only the selected replacement placements.
// Exclusive storage preserves its old range in a view before writing; shared
// or constrained representations use ordinary private materialization.
class ArrayRangeRemap {
    constructor(start, entries, length) {
        this.start = start
        this.entries = entries
        this.length = length
    }

    createOutput(work) {
        const { receiver, operationContext } = work
        const { start, entries, length } = this
        // Consume the carrier before fallible construction. Saved Error frames
        // may retain this remap, but must not keep its selected values alive.
        this.entries = undefined
        // Overlapping copies select every source version before the first write.
        for (const key of Object.keys(entries))
            if (propertyVersions.isPropertyPlacement(entries[key])) entries[key].ensureCaptured()
        const end = start + entries.length
        const meta = metadata.requireMeta(receiver, operationContext)
        const canShare = work.mutation && work.preserveReceiverBaseline &&
            !Object.keys(meta.placementVersions ?? {}).length &&
            (!meta.backingRecord || meta.backingRecord.owners.size === 1)
        if (canShare && work.preserveReceiverBaseline(source => {
            if (metadata.requiresCopyOnWrite(source, operationContext)) return
            for (let index = start; index < end; index++)
                if (languageProperties.requiresRepresentationCopyForPropertyMutation(source, String(index),
                    operationContext, languageProperties.PROPERTY_MUTATION_MODE.AssignOrDelete)) return
            if (!ArrayView.tryShareStorage(source, operationContext)) return
            return () => {
                const snapshot = new ArrayView(source, operationContext, 0, length)
                inheritIdentity(source, snapshot, operationContext)
                return PlacementConstruction.initializeAndPublish(snapshot, operationContext, snapshot => {
                    for (let index = start; index < end; index++) {
                        const key = String(index)
                        propertyVersions.copyPlacement(languageProperties.readLanguagePlacement(source, key, operationContext),
                            snapshot, key, operationContext, false)
                    }
                })
            }
        })) {
            for (let index = 0; index < entries.length; index++) {
                const key = String(start + index)
                if (Object.hasOwn(entries, index)) placeEntry(receiver, key, entries[index], operationContext)
                else propertyVersions.deleteProperty(receiver, key, operationContext)
            }
            return receiver
        }
        const remap = createRemap(receiver, operationContext, 0, length)
        for (let index = 0; index < entries.length; index++) {
            if (Object.hasOwn(entries, index)) remap[start + index] = entries[index]
            else delete remap[start + index]
        }
        return createArrayFromRemap(remap, operationContext)
    }
}

// Fix presence without consuming values. Complete preparation supplies a guard
// to retain unreadable placements as Error inputs; structural remaps fail fast.
function createRemap(
    array,
    operationContext,
    start = 0,
    end = undefined,
    inspect = action => action(),
    onPlacement,
) {
    try {
        const remap = new Array((end ?? ArrayView.minimumLength(array, operationContext)) - start)
        for (const key of languageProperties.enumerableLanguageKeyCandidates(
            array,
            operationContext,
            start,
            end,
        )) {
            const placement = inspect(() => propertyVersions.getPropertyPlacement(array, key, operationContext))
            if (placement === undefined) continue
            const index = Number(key) - start
            defineCopyProperty(remap, String(index), placement)
            onPlacement?.(placement, index)
        }
        return remap
    } finally { array = undefined }
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
    PlacementConstruction.initializeAndPublish(output, operationContext, output => placeRemap(output, remap, operationContext))
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
        const placement = entry.ensureCaptured()
        if (languageValues.isPending(placement.value, operationContext))
            propertyVersions.copyPlacement(placement, destination, key, operationContext)
        else propertyVersions.transferPlacement(placement, destination, key, operationContext)
        return
    }
    propertyVersions.assignProperty(
        destination,
        key,
        entry,
        operationContext,
    )
}

// The intrinsic has already made every output position present. A source gate
// that publishes absence therefore contributes explicit undefined, not a hole.
function resolveDenseRemapPresence(remap, operation) {
    const waits = []
    for (const key of Object.keys(remap)) {
        const placement = remap[key]
        if (!propertyVersions.isPropertyPlacement(placement)) continue
        const pending = internalSteps.continueGraphTransition(placement.resolvePresence(), operation.operationContext, () => {
            if (placement.present === false) remap[key] = undefined
        }, undefined, operation)
        if (languageValues.isPending(pending, operation.operationContext)) waits.push(pending)
    }
    return internalSteps.continueGraphTransition(waits.length ? Promise.all(waits) : undefined,
        operation.operationContext, () => remap, undefined, operation)
}

export {
    ArrayRangeRemap,
    createArrayFromRemap,
    createRemap,
    placeRemap,
    resolveDenseRemapPresence,
}
