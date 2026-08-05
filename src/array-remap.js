import * as arrayViews from "./array-view.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import {
    deleteProperty,
    setProperty,
    setRetainedProperty,
} from "./mutations.js"
import * as propertyVersions from "./property-versions.js"

const KIND_ADD = 0
const KIND_DELETE = 1
const KIND_LENGTH = 2
const KIND_MOVE = 3

function createInitialRemap(array) {
    const length = arrayViews.logicalArrayLength(array)
    const remap = new Array(length)
    for (const key of languageProperties.enumerableLanguageKeys(array)) {
        languageProperties.writeLanguageProperty(
            remap,
            key,
            propertyVersions.getPropertyReference(array, key),
        )
    }
    return remap
}

function createMutationRemap(array, inPlace) {
    if (inPlace) return traceMutation(array)
    const remap = createInitialRemap(array)
    return { remap, working: remap }
}

function traceMutation(array) {
    const operations = []
    const deleted = new Set()
    let sourceLength = arrayViews.logicalArrayLength(array)
    const remap = new Array(sourceLength)
    const working = new Proxy(remap, {
        has(target, key) {
            if (!arrayViews.isArrayIndex(key)) {
                return Reflect.has(target, key)
            }
            if (Object.hasOwn(target, key)) return true
            if (deleted.has(key) || Number(key) >= sourceLength) return false
            return languageProperties.hasLanguageProperty(array, key)
        },
        get(target, key, receiver) {
            if (!arrayViews.isArrayIndex(key)) {
                return Reflect.get(target, key, receiver)
            }
            if (Object.hasOwn(target, key)) return target[key]
            if (deleted.has(key) || Number(key) >= sourceLength) return undefined
            // Assignment could invoke an inherited numeric setter.
            const origin = propertyVersions.getPropertyReference(array, key)
            if (origin) languageProperties.writeLanguageProperty(
                target, key, origin,
            )
            return origin
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
    return { remap, working, operations }

    function record(operation) {
        languageProperties.writeLanguageProperty(
            operations,
            String(operations.length),
            operation,
        )
    }
}

function createPlacementOperation(entry, newIndex) {
    return propertyVersions.isPropertyReference(entry)
        ? {
            kind: KIND_MOVE,
            origin: entry,
            newIndex,
        }
        : { kind: KIND_ADD, newIndex, value: entry }
}

function applyRemapToArray(array, remap, operations) {
    operations ??= Array.from({ length: remap.length }, (_, newIndex) => {
        return newIndex in remap
            ? createPlacementOperation(remap[newIndex], newIndex)
            : { kind: KIND_DELETE, index: newIndex }
    })
    const placementCount = new Map()
    remap.forEach(origin => {
        if (!propertyVersions.isPropertyReference(origin)) return
        placementCount.set(
            origin,
            (placementCount.get(origin) ?? 0) + 1,
        )
    })
    for (const operation of operations) {
        if (operation.kind === KIND_MOVE) {
            propertyVersions.capturePropertyVersion(operation.origin)
        }
    }

    try {
        for (const operation of operations) {
            if (operation.kind === KIND_LENGTH) {
                const error = setProperty(array, "length", operation.value)
                if (languageValues.isError(error)) return error
                continue
            }
            if (operation.kind === KIND_DELETE) {
                deleteProperty(array, String(operation.index))
                continue
            }
            const key = String(operation.newIndex)
            const entry = operation.kind === KIND_MOVE
                ? operation.origin
                : operation.value
            const retained = operation.kind === KIND_ADD ||
                (placementCount.get(entry) ?? 0) > 1
            placeEntry(array, key, entry, retained)
        }
        return undefined
    } catch (error) {
        if (!languageProperties.isPropertyShapeError(error)) throw error
        return error
    }
}

function createArrayFromRemap(
    remap,
    refIndexSource = undefined,
    retained = true,
) {
    const output = new Array(remap.length)
    placeRemap(output, remap, 0, retained)
    if (refIndexSource !== undefined) {
        propertyVersions.indexValueIfSourceIndexed(refIndexSource, output)
    }
    return output
}

function placeRemap(destination, remap, offset = 0, retained = true) {
    remap.forEach((entry, index) => {
        const key = String(offset + index)
        placeEntry(destination, key, entry, retained)
    })
}

function placeEntry(destination, key, entry, retained) {
    if (propertyVersions.isPropertyReference(entry)) {
        placeOrigin(destination, key, entry, retained)
        return
    }
    const place = retained ? setRetainedProperty : setProperty
    place(destination, key, entry)
}

function placeOrigin(
    destination,
    key,
    origin,
    retained = true,
) {
    propertyVersions.capturePropertyVersion(origin)
    const stringKey = String(key)
    languageProperties.assertCanSetLanguageProperty(
        destination,
        stringKey,
        metadata.importBoundaryOf(destination)?.errorContext,
    )

    const value = origin.value
    if (languageValues.isPromise(value)) {
        propertyVersions.placePromiseVersion(
            origin.mirror,
            value,
            destination,
            stringKey,
            retained,
        )
        return
    }

    propertyVersions.assignProperty(destination, stringKey, value, retained)
}

export {
    applyRemapToArray,
    createArrayFromRemap,
    createInitialRemap,
    createMutationRemap,
    placeRemap,
}
