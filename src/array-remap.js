// Each present remap entry is a captured placement. Its destination can consume
// the exact version after overlapping writes. Missing entries are holes.

import { ERROR_KIND } from "./error.js"
import { ArrayView } from "./array-view.js"
import { defineCopyProperty } from "./placement-structure.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"
import * as metadata from "./meta.js"
import { inheritIdentity } from "./captured-identity.js"
import { PlacementConstruction } from "./parent-placements.js"

// Argument reception already prepared a ready input. A still-pending payload
// needs one producer that every destination of this input can share.
function arrayInput(value, ctx) {
    return languageValues.isPending(value, ctx) ?
        propertyVersions.prepareInputPlacement(value, ctx, ERROR_KIND.OperationInputFailed) : { value, present: true }
}

// A controlled range write carries only the selected replacement placements.
// Exclusive storage saves the old range for recovery. A private result can
// overlay the selected range on shared storage or materialize protected input.
function createRangeOutput(start, entries, work) {
    const { receiver, operationContext, arrayLength: length } = work
    if (length === undefined) return patchedView(receiver, start, entries, length, operationContext)
    const end = start + entries.length
    if (work.mutation && work.preserveReceiverBaseline?.(source => !metadata.requiresCopyOnWrite(source, operationContext) &&
        captureRangeBaseline(source, start, end, length, operationContext))) {
        for (let index = 0; index < entries.length; index++) {
            const key = String(start + index)
            if (Object.hasOwn(entries, index)) placeEntry(receiver, key, entries[index], operationContext, propertyVersions.CACHE_WRITE)
            else propertyVersions.transferPlacement({ value: undefined, present: false }, receiver, key, operationContext,
                undefined, undefined, propertyVersions.CACHE_WRITE)
        }
        return receiver
    }
    if (entries.length === length) return createArrayFromRemap(entries, operationContext)
    if (ArrayView.tryShareStorage(receiver, operationContext))
        return patchedView(receiver, start, entries, length, operationContext)
    return createArrayFromRemap(patchedRemap(receiver, start, entries, length, operationContext), operationContext)
}

function captureRangeBaseline(source, start, end, length, ctx) {
    const meta = metadata.requireMeta(source, ctx)
    if (meta.outgoingPlacements?.size || meta.backingRecord && meta.backingRecord.owners.size !== 1) return
    for (let index = start; index < end; index++)
        if (languageProperties.requiresRepresentationCopyForPropertyMutation(source, String(index), ctx,
            languageProperties.PROPERTY_MUTATION_MODE.AssignOrDelete)) return
    if (!ArrayView.tryShareStorage(source, ctx)) return
    return () => {
        const snapshot = new ArrayView(source, ctx, 0, length)
        inheritIdentity(source, snapshot, ctx)
        return PlacementConstruction.initializeAndPublish(snapshot, ctx, snapshot => {
            for (let index = start; index < end; index++) {
                const key = String(index)
                propertyVersions.copyPlacement(languageProperties.readLanguagePlacement(source, key, ctx), snapshot, key, ctx, false)
            }
        })
    }
}

function patchedRemap(receiver, start, entries, length, ctx) {
    const remap = new Array(length)
    captureRange(remap, receiver, ctx, 0, start, 0)
    for (const key of Object.keys(entries)) defineCopyProperty(remap, String(start + Number(key)), entries[key])
    return captureRange(remap, receiver, ctx, start + entries.length, length, 0)
}

function patchedView(receiver, start, entries, length, ctx) {
    try {
        const view = new ArrayView(receiver, ctx, 0, length)
        if (length === undefined) {
            ArrayView.prepareShapeCopy(receiver, view, ctx)()
            length = ArrayView.maximumLength(receiver, ctx)
        }
        return PlacementConstruction.initializeAndPublish(view, ctx, output => {
            if (start) propertyVersions.copyArrayOverlays(receiver, output, ctx, 0, start)
            const end = start + entries.length
            if (end < length) propertyVersions.copyArrayOverlays(receiver, output, ctx, end, length)
            for (let index = 0; index < entries.length; index++) {
                const placement = entries[index] ?? { value: undefined, present: false }
                propertyVersions.copyPlacement(placement, output, String(start + index), ctx, false)
            }
        })
    } finally { receiver = entries = undefined }
}

// Capture each selected descriptor once, including its version but without
// consuming its value. Complete preparation can keep a failed read as input.
function readArrayPlacement(array, key, ctx, inspect) {
    try {
        return inspect ? inspect(() => languageProperties.readLanguagePlacement(array, key, ctx)) :
            languageProperties.readLanguagePlacement(array, key, ctx)
    } finally { array = undefined }
}

function captureRange(remap, array, ctx, first, end, origin) {
    try {
        if (first === end) return remap
        for (const key of languageProperties.enumerableLanguageKeyCandidates(array, ctx, first, end)) {
            const p = readArrayPlacement(array, key, ctx)
            if (propertyVersions.placementPresent(p))
                defineCopyProperty(remap, String(Number(key) - origin), p)
        }
        return remap
    } finally { array = undefined }
}

function createRemap(array, ctx, first = 0, end) {
    const remap = new Array((end ?? ArrayView.minimumLength(array, ctx)) - first)
    return captureRange(remap, array, ctx, first, end, first)
}

function createArrayFromRemap(remap, operationContext) {
    const output = new Array(remap.length)
    languageValues.admitReadyValue(output, operationContext, languageValues.TYPE.Array)
    return PlacementConstruction.initializeAndPublish(output, operationContext, array => placeRemap(array, remap, operationContext))
}

// Fixed physical input goes straight into its final native order. Capture
// both sides of a mutation before publishing either. Stored values and fixed
// regional placements have already crossed reception.
function copyPhysicalArray(work, length, finish, at = 0, cut = 0, inserted = []) {
    const captured = capturePhysicalArray(work, length, at, cut, inserted)
    if (!captured) return
    const ctx = work.operationContext
    return finish(publish(captured.output), captured.removed && (() => work.retainOutput(publish(captured.removed))))

    function publish({ array, overrides, dense }) {
        languageValues.admitReadyValue(array, ctx, languageValues.TYPE.Array)
        return PlacementConstruction.initializeAndPublish(array, ctx, output => {
            for (const [key, p] of overrides ?? [])
                propertyVersions.copyPlacement(dense ? propertyVersions.densePlacement(p, ctx) : p, output, key, ctx)
        })
    }
}

function capturePhysicalArray(work, length, at, cut, inserted) {
    const { operationContext: ctx, method } = work
    const dense = method === "toReversed" || method === "toSpliced" || method === "with"
    const reverse = method === "reverse" || method === "toReversed"
    const takeRemoved = work.mutation && method === "splice"
    const after = at + cut, shift = inserted.length - cut
    if (length + shift > 0xffffffff || length === cut && !work.mutation) return
    let source = work.receiver, storage = ArrayView.denseStorage(source, length, ctx,
        takeRemoved ? 0 : at, takeRemoved ? 0 : cut, work.mutation && reverse)
    if (!storage) return
    let output = buffer(length + shift, dense)
    let removed = takeRemoved && buffer(cut, false)
    const ownerVersions = metadata.requireMeta(source, ctx).outgoingPlacements?.size
    try {
        // A mutation consumes the cut as well. Preserve the single listing
        // and source order of its complete receiver capture. An observation
        // never reflects on discarded descriptors.
        const whole = removed || !cut
        copy(0, whole ? length : at)
        for (let i = 0; i < inserted.length; i++)
            place(output, at + i, inserted[i])
        if (!whole) copy(after, length)
        return { output, removed }
    } finally { source = storage = output = removed = inserted = undefined }

    function buffer(size, dense) {
        // This private Array always has the standard prototype. Densifying
        // methods give even an unlisted hole its own undefined placement.
        const array = new Array(size)
        if (dense) array.fill(undefined)
        return { array, dense }
    }
    function copy(first, end) {
        if (first === end) return
        for (const key of languageProperties.enumerableLanguageKeyCandidates(source, ctx, first, end)) {
            const i = Number(key), segment = i < storage.prefix ? storage : storage.tail
            const physical = segment.start + i
            let to = output, index = i
            if (reverse) index = length - 1 - i
            else if (i >= after) index += shift
            else if (i >= at) { to = removed; index -= at }
            const version = (ownerVersions && propertyVersions.getOwnPlacementVersion(source, key, ctx)) ||
                (segment.producers && propertyVersions.getOwnPlacementVersion(segment.producers, physical, ctx))
            const p = version ? propertyVersions.capturePlacementFromVersion(version) : segment.slots?.[i]
            if (p) place(to, index, p)
            else {
                const descriptor = languageProperties.getStorageDescriptor(segment.backing, physical, ctx)
                if (languageProperties.isDataPlacement(descriptor)) to.array[index] = descriptor.value
            }
        }
    }
    function place(to, index, p) {
        if (p.sourceVersion || p.ownFailure || p.role || p.discoveryBlocked || p.pendingPresence) {
            ;(to.overrides ??= []).push([String(index), p])
        } else if (p.present !== false) to.array[index] = p.value
    }
}

function placeRemap(
    destination,
    remap,
    operationContext,
    offset = 0,
    writeBack = true,
) {
    for (const index of Object.keys(remap))
        placeEntry(destination, String(offset + Number(index)), remap[index], operationContext, writeBack)
}

function placeEntry(destination, key, placement, operationContext, writeBack) {
    if (placement.sourceVersion && languageValues.isPending(placement.value, operationContext))
        propertyVersions.copyPlacement(placement, destination, key, operationContext, writeBack)
    else propertyVersions.transferPlacement(placement, destination, key, operationContext, undefined, undefined, writeBack)
}

function sliceOutput(source, start, end, operationContext) {
    if (start === end) return createArrayFromRemap([], operationContext)
    const meta = metadata.requireMeta(source, operationContext), range = meta.arrayRange
    const overrides = meta.outgoingPlacements?.size ?? 0
    // Repeated endpoint cuts through a dense set of owner-local versions
    // would copy the entire version table at each step. Capture it once on
    // private backing so subsequent cuts share its producers.
    if (overrides > 64 && !ArrayView.region(source, operationContext) &&
        (range?.backing && range.backing !== source || overrides >= ArrayView.storedIndexes(source, operationContext) / 4)) {
        const backing = new Array(end - start)
        languageValues.admitReadyValue(backing, operationContext, languageValues.TYPE.Array)
        PlacementConstruction.initializeAndPublish(backing, operationContext, () => {})
        return PlacementConstruction.initializeAndPublish(new ArrayView(backing, operationContext), operationContext,
            view => placeRemap(view, createRemap(source, operationContext, start, end), operationContext, 0, propertyVersions.CACHE_WRITE))
    }
    let view
    if (range?.borrowed && end <= ArrayView.prefixLength(source, operationContext)) {
        const offset = range.borrowed.start + range.start
        view = new ArrayView(range.borrowed.record.array, operationContext, offset + start, offset + end)
    } else if (ArrayView.tryShareStorage(source, operationContext)) view = new ArrayView(source, operationContext, start, end)
    else return createArrayFromRemap(createRemap(source, operationContext, start, end), operationContext)
    return PlacementConstruction.initializeAndPublish(view, operationContext, view => {
        propertyVersions.copyArrayOverlays(
            source,
            view,
            operationContext,
            start,
            end,
            -start,
        )
    })
}

function appendView(receiver, parts, length, count, ctx) {
    try {
        return ArrayView.tryExtendEnd(receiver, count, ctx, view => {
            let start = length
            for (const part of parts) {
                placeRemap(view, part, ctx, start, propertyVersions.CACHE_WRITE)
                start += part.length
            }
        }, length)
    } finally { parts = undefined }
}

export {
    sliceOutput, appendView, captureRangeBaseline,
    createRangeOutput,
    createArrayFromRemap, copyPhysicalArray,
    createRemap, readArrayPlacement,
    arrayInput,
}
