import { ArrayView, isLogicalArray, isArrayIndex } from "./array-view.js"
import * as metadata from "./meta.js"
import * as properties from "./language-properties.js"

function recordOrder(owner, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    // Untouched keys keep their physical relative order. Only protected or
    // newly created keys need tokens; entering one key never scans siblings.
    return meta.recordOrder ??= { clock: { next: 0 }, positions: new Map() }
}

// One reserved placement can publish several structural effects before its
// final value. Copies retain its token/outcome; later writers get new tokens.
function beginPlacementStructure(owner, key, placement, operationContext) {
    const array = isLogicalArray(owner, operationContext)
    const order = array ? undefined : recordOrder(owner, operationContext)
    // -1 keeps physical relative order; Infinity denotes absence. Nonnegative
    // positions order creations by issuance, independently of storage writes.
    const token = order ? { position: placement.position ?? (placement.present ? -1 : Infinity) } : undefined
    // All commands inside this entry precede later sibling operations, even
    // when those siblings finish first. No-op/replacement keeps the old position.
    const creationPosition = order ? order.clock.next++ : undefined
    const completeGrowth = array ? ArrayView.beginIndexTransition(owner, key, operationContext) : undefined
    const enclosing = metadata.metaOf(owner, operationContext)?.entryGate?.structure
    if (order) order.positions.set(key, token)
    return {
        prepare(placement) {
            const present = placement.present !== false
            const commitEnclosing = enclosing?.prepare(placement)
            if (token) placement.position = present ? placement.position < Infinity ? placement.position : creationPosition : Infinity
            return () => {
                if (token) token.position = placement.position
                if (present) completeGrowth?.(true)
                commitEnclosing?.()
            }
        },
        complete() {
            completeGrowth?.(false)
            // Captures retain their tokens. A completed physical-order token
            // adds no information to this owner's future enumerations.
            if (order && order.positions.get(key) === token && (token.position === Infinity || token.position === -1)) {
                order.positions.delete(key)
            }
        },
    }
}

function preparePlacementStructure(owner, key, placement, structure, operationContext, writeBack) {
    if (placement.pendingPresence) return () => {}
    if (structure) return structure.prepare(placement)
    const present = placement.present !== false
    const meta = metadata.requireMeta(owner, operationContext)
    const array = isLogicalArray(owner, operationContext)
    const before = meta.placementVersions?.[key]
    const wasPresent = before ? before.present !== false && !before.pendingPresence : properties.hasLanguageProperty(owner, key, operationContext)
    if (placement.position === undefined && wasPresent)
        placement.position = before?.position ?? meta.recordOrder?.positions.get(key)?.position ?? -1
    const commitEntry = meta.entryGate?.structure.prepare(placement)
    const order = !array && (meta.entryGate || placement.position >= 0 && placement.position < Infinity)
        ? recordOrder(owner, operationContext) : meta.recordOrder
    const created = present && !wasPresent
    if (order) placement.position = present ? placement.position < Infinity ? placement.position : order.clock.next++ : Infinity
    else if (!array) placement.position = present ? -1 : Infinity
    const commitGrowth = created && array
        ? ArrayView.prepareIndexCreation(owner, key, operationContext, writeBack) : undefined
    return () => {
        commitGrowth?.()
        if (order) {
            if (!present || placement.position === -1) order.positions.delete(key)
            else order.positions.set(key, { position: placement.position })
        }
        commitEntry?.()
    }
}

function copyContainerStructure(source, destination, operationContext) {
    if (isLogicalArray(source, operationContext)) {
        ArrayView.copyShape(source, destination, operationContext)
        return
    }
    const order = metadata.metaOf(source, operationContext)?.recordOrder
    if (order?.positions.size) metadata.requireMeta(destination, operationContext).recordOrder = {
        clock: order.clock, positions: new Map(order.positions),
    }
}

function captureRecordOrder(owner, keys, operationContext) {
    const order = metadata.metaOf(owner, operationContext)?.recordOrder
    return order?.positions.size ? new Map(keys.map(key => [key, order.positions.get(key)])) : undefined
}

function orderRecordKeys(keys, positions) {
    if (!positions?.size) return keys
    return keys.sort((a, b) => {
        const ai = isArrayIndex(a), bi = isArrayIndex(b)
        return ai && bi ? Number(a) - Number(b) : ai ? -1 : bi ? 1 :
            (positions.get(a)?.position ?? -1) - (positions.get(b)?.position ?? -1)
    })
}

function captureContainerStructure(owner, keys, operationContext) {
    return isLogicalArray(owner, operationContext)
        ? { length: ArrayView.captureLength(owner, operationContext) }
        : { order: captureRecordOrder(owner, keys, operationContext) }
}

function finishContainerCopy(copy, shape) {
    if (shape.length !== undefined) {
        const length = shape.length
        copy.length = typeof length === "number" ? length : length.read()
    } else if (shape.order) {
        const keys = orderRecordKeys(Object.keys(copy), shape.order)
        const properties = keys.map(key => Object.getOwnPropertyDescriptor(copy, key))
        for (const key of keys) delete copy[key]
        for (let index = 0; index < keys.length; index++) Object.defineProperty(copy, keys[index], properties[index])
    }
}

export { beginPlacementStructure, captureRecordOrder, preparePlacementStructure,
    captureContainerStructure, finishContainerCopy,
    copyContainerStructure, orderRecordKeys }
