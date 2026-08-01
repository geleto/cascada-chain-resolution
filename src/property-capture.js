import * as imports from "./import.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as resolution from "./resolution.js"

const PROPERTY_CAPTURE = Symbol("Property capture")

function capture(owner, key, inheritedImportBoundary = undefined) {
    const stringKey = String(key)
    if (!languageProperties.hasLanguageProperty(owner, stringKey)) {
        return undefined
    }

    const value = languageProperties.readLanguageProperty(owner, stringKey)
    const importBoundary = metadata.nodeImportBoundary(
        owner,
        inheritedImportBoundary,
    )
    const mirror = languageValues.isPromise(value)
        ? promiseMirrors.getOrCreatePromiseMirror(
            owner,
            stringKey,
            value,
            importBoundary,
        )
        : undefined
    return {
        [PROPERTY_CAPTURE]: true,
        owner,
        key: stringKey,
        value,
        mirror,
        importBoundary: mirror?.importBoundary ?? importBoundary,
        cycleCut: imports.hasCycleCut(owner, stringKey),
    }
}

function is(value) {
    return value?.[PROPERTY_CAPTURE] === true
}

function resolve(property) {
    if (!property) return undefined
    if (!languageValues.isPromise(property.value)) return property.value
    return resolution.onLaterPromiseReady(property.value, () => {
        return property.mirror.getValue(property.owner, property.key)
    })
}

function resolveAt(owner, key) {
    const property = capture(owner, key)
    return resolve(property)
}

function updateValue(property, value) {
    if (property.value === value) return
    property.value = value
    delete property.mirror
}

export {
    capture,
    is,
    resolve,
    resolveAt,
    updateValue,
}
