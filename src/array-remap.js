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
import * as propertyCaptures from "./property-capture.js"
import * as propertyTransitions from "./property-transitions.js"
import * as refcounts from "./refcounts.js"

const NAMED_PROPERTIES = Symbol("Array remap named properties")
const KIND_ASSIGN = 0
const KIND_DELETE = 1
const KIND_LENGTH = 2
const KIND_REMAP = 3

function capture(array) {
    const length = arrayViews.logicalArrayLength(array)
    const remap = new Array(length)
    for (let index = 0; index < length; index++) {
        const property = propertyCaptures.capture(array, String(index))
        if (property) remap[index] = property
    }
    const named = []
    for (const key of languageProperties.enumerableLanguageKeys(array)) {
        if (arrayViews.isArrayIndex(key)) continue
        named.push([key, propertyCaptures.capture(array, key)])
    }
    remap[NAMED_PROPERTIES] = named
    return remap
}

function trace(remap) {
    const operations = []
    const working = new Proxy(remap, {
        set(target, key, value) {
            if (key === "length") {
                operations.push({ kind: KIND_LENGTH, value })
            } else if (arrayViews.isArrayIndex(key)) {
                operations.push(operationFor(value, Number(key)))
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

function operationFor(element, newIndex) {
    return propertyCaptures.is(element)
        ? {
            kind: KIND_REMAP,
            property: element,
            newIndex,
        }
        : { kind: KIND_ASSIGN, newIndex, value: element }
}

function apply(array, remap, operations) {
    operations ??= Array.from({ length: remap.length }, (_, newIndex) => {
        return newIndex in remap
            ? operationFor(remap[newIndex], newIndex)
            : { kind: KIND_DELETE, index: newIndex }
    })
    const placementCount = new Map()
    for (const property of remap) {
        if (!propertyCaptures.is(property)) continue
        placementCount.set(
            property,
            (placementCount.get(property) ?? 0) + 1,
        )
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
            if (operation.kind === KIND_REMAP) {
                place(
                    array,
                    key,
                    operation.property,
                    (placementCount.get(operation.property) ?? 0) > 1,
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

function createArray(remap, retained) {
    const output = new Array(remap.length)
    remap.forEach((element, index) => {
        if (propertyCaptures.is(element)) {
            place(
                output,
                String(index),
                element,
                retained,
            )
        } else {
            setProperty(output, String(index), element)
            if (!languageValues.isPromise(element)) metadata.markShared(element)
        }
    })
    for (const [key, property] of remap[NAMED_PROPERTIES] ?? []) {
        place(output, key, property, retained)
    }
    return output
}

function materialize(remap, retained = true) {
    const output = createArray(remap, retained)
    refcounts.buildRefIndex(output)
    return output
}

function materializeSource(source) {
    const output = createArray(capture(source), true)
    refcounts.indexValueIfSourceIndexed(source, output)
    return output
}

function place(destination, key, property, retained = true) {
    const stringKey = String(key)
    languageProperties.assertCanSetLanguageProperty(
        destination,
        stringKey,
        property.importBoundary?.errorContext,
    )

    const value = property.value
    if (languageValues.isPromise(value)) {
        const mirror = promiseMirrors.forkPromiseMirror(
            property.owner,
            destination,
            property.key,
            value,
            retained,
            property.importBoundary,
            undefined,
            {
                sourceMirror: property.mirror,
                destinationKey: stringKey,
                install: false,
                fallbackImportBoundary: property.importBoundary,
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

    if (property.importBoundary && languageValues.isTracked(value)) {
        imports.import(value, property.importBoundary.errorContext)
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
        if (property.cycleCut) imports.setCycleCut(destination, stringKey)
    })
}

export {
    apply,
    capture,
    materialize,
    materializeSource,
    trace,
}
