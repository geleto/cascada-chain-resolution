const { isTracked } = require("./helpers")

const META = Symbol("META")

function createMeta() {
    return {
        shared: false,
        mirrors: null,
        promiseCount: 0,
        errorCount: 0,
        settlementVerifyScheduled: false,
        parents: undefined,
    }
}

function metaOf(value) {
    if (!isTracked(value) || !Object.isExtensible(value)) return undefined
    return value[META]
}

function ensureMeta(value) {
    let meta = metaOf(value)
    if (meta === undefined) {
        meta = createMeta()
        Object.defineProperty(value, META, {
            value: meta,
            enumerable: false,
            writable: true,
            configurable: true,
        })
    }
    return meta
}

function hasSharedMark(value) {
    return isTracked(value) &&
        (metaOf(value)?.shared === true || !Object.isExtensible(value))
}

function setSharedMark(value) {
    if (!isTracked(value) || !Object.isExtensible(value)) return value
    ensureMeta(value).shared = true
    return value
}

function getPromiseMirrorMap(node) {
    return metaOf(node)?.mirrors
}

function ensurePromiseMirrorMap(node) {
    const meta = ensureMeta(node)
    if (meta.mirrors === null) {
        meta.mirrors = Object.create(null)             // null proto: no inherited keys
    }
    return meta.mirrors
}

module.exports = {
    ensureMeta,
    ensurePromiseMirrorMap,
    getPromiseMirrorMap,
    hasSharedMark,
    metaOf,
    setSharedMark,
}
