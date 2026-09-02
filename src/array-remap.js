import * as arrayViews from "./array-view.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as propertyVersions from "./property-versions.js"

const KIND_ADD = 0
const KIND_DELETE = 1
const KIND_LENGTH = 2
const KIND_MOVE = 3

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

class ArrayMutation {
    #array
    #operationContext
    // Present for a traced partial remap that must be replayed against the
    // source; absent when the supplied remap is already complete.
    #operations

    constructor(array, remap, operationContext, operations = undefined) {
        this.#array = array
        this.#operationContext = operationContext
        this.#operations = operations
        this.remap = remap
        this.working = remap
    }

    static trace(array, operationContext) {
        const operations = []
        const deleted = new Set()
        let sourceLength = arrayViews.logicalArrayLength(array, operationContext)
        const remap = new Array(sourceLength)
        const mutation = new ArrayMutation(
            array,
            remap,
            operationContext,
            operations,
        )
        mutation.working = new Proxy(remap, {
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
                    record({ kind: KIND_LENGTH, value })
                    sourceLength = Math.min(sourceLength, value)
                } else if (arrayViews.isArrayIndex(key)) {
                    record(createPlacementOperation(value, Number(key)))
                }
                return Reflect.set(target, key, value, target)
            },
            deleteProperty(target, key) {
                if (arrayViews.isArrayIndex(key)) {
                    deleted.add(key)
                    record({
                        kind: KIND_DELETE,
                        index: Number(key),
                    })
                }
                return Reflect.deleteProperty(target, key)
            },
        })
        return mutation

        function record(operation) {
            languageProperties.writeLanguageProperty(
                operations,
                String(operations.length),
                operation,
                operationContext,
            )
        }
    }

    requiresCopy() {
        // ArrayView receivers are materialized or handled by a view transition
        // before this preflight; this method considers only the native Array.
        const operations = this.#operations ?? operationsForRemap(this.remap)
        for (const operation of operations) {
            const requiresCopy = operation.kind === KIND_LENGTH
                ? languageProperties.arrayLengthMutationRequiresCopy(
                    this.#array,
                    operation.value,
                    this.#operationContext,
                )
                : languageProperties.propertyMutationRequiresCopy(
                    this.#array,
                    String(operation.kind === KIND_DELETE
                        ? operation.index
                        : operation.newIndex),
                    this.#operationContext,
                    operation.kind === KIND_DELETE,
                )
            if (requiresCopy) return true
        }
        return false
    }

    materialize() {
        if (!this.#operations) return this.remap
        const remap = createRemap(this.#array, this.#operationContext)
        for (const operation of this.#operations) {
            if (operation.kind === KIND_LENGTH) {
                remap.length = operation.value
            } else if (operation.kind === KIND_DELETE) {
                delete remap[operation.index]
            } else {
                languageProperties.writeLanguageProperty(
                    remap,
                    String(operation.newIndex),
                    operation.kind === KIND_MOVE
                        ? operation.placement
                        : operation.value,
                    this.#operationContext,
                )
            }
        }
        this.remap = remap
        return remap
    }

    apply() {
        const operations = this.#operations ?? operationsForRemap(this.remap)
        const placementCount = new Map()
        this.remap.forEach(placement => {
            if (!propertyVersions.isPropertyPlacement(placement)) return
            placementCount.set(
                placement,
                (placementCount.get(placement) ?? 0) + 1,
            )
        })
        for (const operation of operations) {
            if (operation.kind === KIND_MOVE) operation.placement.captureVersion()
        }

        for (const operation of operations) {
            if (operation.kind === KIND_LENGTH) {
                propertyVersions.commitArrayLength(
                    this.#array,
                    operation.value,
                    this.#operationContext,
                )
                continue
            }
            if (operation.kind === KIND_DELETE) {
                propertyVersions.deleteProperty(
                    this.#array,
                    String(operation.index),
                    this.#operationContext,
                )
                continue
            }
            const key = String(operation.newIndex)
            const entry = operation.kind === KIND_MOVE
                ? operation.placement
                : operation.value
            const retained = operation.kind === KIND_ADD ||
                (placementCount.get(entry) ?? 0) > 1
            placeEntry(
                this.#array,
                key,
                entry,
                retained,
                this.#operationContext,
            )
        }
    }
}

function createPlacementOperation(entry, newIndex) {
    return propertyVersions.isPropertyPlacement(entry)
        ? {
            kind: KIND_MOVE,
            placement: entry,
            newIndex,
        }
        : { kind: KIND_ADD, newIndex, value: entry }
}

function operationsForRemap(remap) {
    return Array.from({ length: remap.length }, (_, newIndex) => {
        return newIndex in remap
            ? createPlacementOperation(remap[newIndex], newIndex)
            : { kind: KIND_DELETE, index: newIndex }
    })
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
        languageValues.TYPE_ARRAY,
    )
    placeRemap(output, remap, operationContext, 0, retained)
    if (refIndexSource !== undefined) {
        propertyVersions.indexValueIfSourceIndexed(
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
    remap.forEach((entry, index) => {
        const key = String(offset + index)
        placeEntry(destination, key, entry, retained, operationContext)
    })
}

function placeEntry(destination, key, entry, retained, operationContext) {
    if (propertyVersions.isPropertyPlacement(entry)) {
        placePlacement(destination, key, entry, operationContext, retained)
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

function placePlacement(
    destination,
    key,
    placement,
    operationContext,
    retained = true,
) {
    placement.captureVersion()
    const stringKey = String(key)

    const value = placement.value
    if (languageValues.isPromise(value, operationContext)) {
        propertyVersions.placePromiseVersion(
            placement.mirror,
            value,
            destination,
            stringKey,
            operationContext,
            retained,
        )
        return
    }

    propertyVersions.assignProperty(
        destination,
        stringKey,
        value,
        operationContext,
        retained,
    )
}

export {
    ArrayMutation,
    createArrayFromRemap,
    createRemap,
    placeRemap,
}
