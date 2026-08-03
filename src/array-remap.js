import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import * as imports from "./import.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import {
    deleteProperty,
    setProperty,
} from "./mutations.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as propertyOrigins from "./property-origin.js"
import * as propertyTransitions from "./property-transitions.js"
import * as refcounts from "./refcounts.js"

const KIND_ADD = 0
const KIND_DELETE = 1
const KIND_LENGTH = 2
const KIND_MOVE = 3

function createInitialRemap(array) {
    const length = arrayViews.logicalArrayLength(array)
    const remap = new Array(length)
    for (let index = 0; index < length; index++) {
        const origin = propertyOrigins.getOrigin(array, index)
        if (origin) remap[index] = origin
    }
    return remap
}

function trace(arrayRemap) {
    const operations = []
    const working = new Proxy(arrayRemap, {
        set(target, key, value) {
            if (key === "length") {
                operations.push({ kind: KIND_LENGTH, value })
            } else if (arrayViews.isArrayIndex(key)) {
                operations.push(createPlacementOperation(value, Number(key)))
            }
            return Reflect.set(target, key, value, target)
        },
        deleteProperty(target, key) {
            if (arrayViews.isArrayIndex(key)) {
                operations.push({
                    kind: KIND_DELETE,
                    index: Number(key),
                })
            }
            return Reflect.deleteProperty(target, key)
        },
    })
    return { working, operations }
}

function createPlacementOperation(entry, newIndex) {
    return propertyOrigins.isOrigin(entry)
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
    for (const origin of remap) {
        if (!propertyOrigins.isOrigin(origin)) continue
        placementCount.set(
            origin,
            (placementCount.get(origin) ?? 0) + 1,
        )
    }
    for (const operation of operations) {
        if (operation.kind === KIND_MOVE) {
            propertyOrigins.captureOrigin(operation.origin)
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
            if (operation.kind === KIND_MOVE) {
                placeOrigin(
                    array,
                    key,
                    operation.origin,
                    (placementCount.get(operation.origin) ?? 0) > 1,
                )
            } else {
                setProperty(array, key, operation.value)
            }
        }
        return undefined
    } catch (error) {
        return errorUtils.toPoison(error)
    }
}

function createArrayFromRemap(remap, refIndexSource = undefined) {
    const output = new Array(remap.length)
    remap.forEach((entry, index) => {
        if (propertyOrigins.isOrigin(entry)) {
            placeOrigin(output, String(index), entry)
        } else {
            setProperty(output, String(index), entry)
            if (!languageValues.isPromise(entry)) metadata.markShared(entry)
        }
    })
    if (refIndexSource !== undefined) {
        refcounts.indexValueIfSourceIndexed(refIndexSource, output)
    }
    return output
}

function placeOrigin(
    destination,
    key,
    origin,
    retained = true,
) {
    propertyOrigins.captureOrigin(origin)
    const stringKey = String(key)
    languageProperties.assertCanSetLanguageProperty(
        destination,
        stringKey,
        origin.importBoundary?.errorContext,
    )

    const value = origin.value
    if (languageValues.isPromise(value)) {
        const mirror = promiseMirrors.forkPromiseMirror(
            origin.owner,
            destination,
            origin.key,
            value,
            retained,
            origin.importBoundary,
            undefined,
            {
                sourceMirror: origin.mirror,
                destinationKey: stringKey,
                install: false,
                fallbackImportBoundary: origin.importBoundary,
            },
        )
        propertyTransitions.replaceProperty(
            destination,
            stringKey,
            mirror,
            value,
        )
        return
    }

    if (origin.importBoundary && languageValues.isTracked(value)) {
        imports.import(value, origin.importBoundary.errorContext)
    } else if (retained) {
        metadata.markShared(value)
    }
    refcounts.indexValueIfSourceIndexed(destination, value)
    refcounts.commitLiveEdge(destination, stringKey, () => {
        promiseMirrors.detachPromiseMirror(destination, stringKey)
        languageProperties.writeLanguageProperty(
            destination,
            stringKey,
            value,
        )
        imports.clearCycleCut(destination, stringKey)
        if (origin.cycleCut) {
            imports.setCycleCut(destination, stringKey)
        }
    })
}

export {
    applyRemapToArray,
    createArrayFromRemap,
    createInitialRemap,
    trace,
}
