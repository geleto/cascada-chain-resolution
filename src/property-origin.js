import * as imports from "./import.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as resolution from "./resolution.js"

const PROPERTY_ORIGIN = Symbol("Property origin")

function getOrigin(owner, key) {
    const stringKey = String(key)
    if (!languageProperties.hasLanguageProperty(owner, stringKey)) {
        return undefined
    }
    return {
        [PROPERTY_ORIGIN]: true,
        owner,
        key: stringKey,
    }
}

function isOrigin(value) {
    return value?.[PROPERTY_ORIGIN] === true
}

function captureOrigin(origin, inheritedImportBoundary = undefined) {
    if (!origin || "value" in origin) return origin
    const { owner, key } = origin
    const value = languageProperties.readLanguageProperty(owner, key)
    const importBoundary = metadata.nodeImportBoundary(
        owner,
        inheritedImportBoundary,
    )
    const mirror = languageValues.isPromise(value)
        ? promiseMirrors.getOrCreatePromiseMirror(
            owner,
            key,
            value,
            importBoundary,
        )
        : undefined
    origin.value = value
    origin.mirror = mirror
    origin.importBoundary = mirror?.importBoundary ?? importBoundary
    origin.cycleCut = imports.hasCycleCut(owner, key)
    return origin
}

function resolveOriginValue(origin) {
    captureOrigin(origin)
    if (!origin || !languageValues.isPromise(origin.value)) {
        return origin?.value
    }
    return resolution.onLaterPromiseReady(origin.value, () => {
        const value = origin.mirror.getValue(origin.owner, origin.key)
        origin.value = value
        delete origin.mirror
        return value
    })
}

function resolveOriginValueAtKey(owner, key) {
    return resolveOriginValue(getOrigin(owner, key))
}

export {
    captureOrigin,
    getOrigin,
    isOrigin,
    resolveOriginValue,
    resolveOriginValueAtKey,
}
