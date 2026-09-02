import * as errorUtils from "./error.js"

const TYPE_ERROR = 1
const TYPE_ARRAY = 2
const TYPE_FUNCTION = 3
const TYPE_STRING = 4
const TYPE_PRIMITIVE = 5
const TYPE_RECORD = 6
const TYPE_MANAGED_CLASS = 7
const TYPE_EXTERNAL = 8

const DECLARATION_MANAGED = 1
const DECLARATION_EXTERNAL = 2

const IDENTITY_DECLARATIONS = new WeakMap()
const MANAGED_PROTOTYPES = new Set()

function metaOf(value, operationContext) {
    return operationContext.execution._metadata.get(value)
}

function getOrCreateMeta(
    value,
    operationContext,
    type = undefined,
    admittedPrototype = undefined,
) {
    const metadata = operationContext.execution._metadata
    let meta = metadata.get(value)
    if (!meta) {
        meta = type === undefined
            ? inspectMetaFacts(value)
            : admittedPrototype === undefined
                ? { type }
                : { type, admittedPrototype }
        if (
            (meta.type === TYPE_RECORD || meta.type === TYPE_MANAGED_CLASS) &&
            meta.admittedPrototype === undefined
        ) {
            errorUtils.reportFatalError(
                new TypeError("Managed container admission requires a prototype"),
            )
        }
        metadata.set(value, meta)
    } else if (type !== undefined && meta.type !== type) {
        errorUtils.reportFatalError(
            new TypeError("Admitted type cannot change"),
        )
    }
    return meta
}

// Classification is a capability probe whose reflection can invoke Proxy
// traps. If it cannot identify managed structure, preserving the exact value
// as external is always safe.
function inspectMetaFacts(value) {
    return errorUtils.catchUserCodeFailure(
        () => errorUtils.runUserCode(() => classifyTypeFacts(value)),
        () => ({ type: TYPE_EXTERNAL }),
    )
}

function classifyTypeFacts(value) {
    // This order is the admission-precedence contract.
    if (Error.isError(value)) return { type: TYPE_ERROR }
    if (typeof value === "function") return { type: TYPE_FUNCTION }
    const declaration = IDENTITY_DECLARATIONS.get(value)
    if (declaration === DECLARATION_EXTERNAL) return { type: TYPE_EXTERNAL }
    if (Array.isArray(value)) return { type: TYPE_ARRAY }

    const admittedPrototype = Object.getPrototypeOf(value)
    if (
        admittedPrototype === null ||
        isPlainObjectPrototypeUnchecked(admittedPrototype)
    ) return { type: TYPE_RECORD, admittedPrototype }

    return declaration === DECLARATION_MANAGED ||
        MANAGED_PROTOTYPES.has(admittedPrototype)
        ? { type: TYPE_MANAGED_CLASS, admittedPrototype }
        : { type: TYPE_EXTERNAL, admittedPrototype }
}

function isPlainObjectPrototype(prototype) {
    // Prototype and descriptor reflection can invoke Proxy traps.
    return errorUtils.runUserCode(
        () => isPlainObjectPrototypeUnchecked(prototype),
    )
}

function isPlainObjectPrototypeUnchecked(prototype) {
    if (prototype === Object.prototype) return true
    if (prototype === null) return false
    if (Object.getPrototypeOf(prototype) !== null) return false
    const constructor = Object.getOwnPropertyDescriptor(
        prototype,
        "constructor",
    )?.value
    return typeof constructor === "function" &&
        Object.getOwnPropertyDescriptor(
            constructor,
            "prototype",
        )?.value === prototype
}

function validateManagedPrototype(prototype) {
    for (
        let current = prototype;
        current !== null && !isPlainObjectPrototypeUnchecked(current);
        current = Object.getPrototypeOf(current)
    ) {
        for (const key of Reflect.ownKeys(current)) {
            const descriptor = Object.getOwnPropertyDescriptor(current, key)
            if (descriptor && !("value" in descriptor)) {
                throw new TypeError(
                    "Managed class prototypes cannot contain accessors",
                )
            }
        }
    }
}

function identityDeclarationOf(value) {
    return IDENTITY_DECLARATIONS.get(value)
}

function setIdentityDeclaration(value, declaration) {
    IDENTITY_DECLARATIONS.set(value, declaration)
}

function addManagedPrototype(prototype) {
    MANAGED_PROTOTYPES.add(prototype)
}

function isObjectLike(value) {
    return value !== null && (
        typeof value === "object" ||
        typeof value === "function"
    )
}

function requireMeta(value, operationContext) {
    const meta = metaOf(value, operationContext)
    if (!meta) {
        errorUtils.reportFatalError(
            new TypeError("Value metadata requires prior admission"),
        )
    }
    return meta
}

function requiresCopyOnWrite(value, operationContext) {
    return metaOf(value, operationContext)?.shared === true ||
        hasReadLease(value, operationContext)
}

function isTraversableType(type) {
    return type === TYPE_ARRAY ||
        type === TYPE_RECORD ||
        type === TYPE_MANAGED_CLASS
}

function hasReadLease(value, operationContext) {
    return (metaOf(value, operationContext)?.readLeaseCount ?? 0) > 0
}

function incrementReadLease(value, operationContext) {
    if (!isObjectLike(value)) return false
    const meta = requireMeta(value, operationContext)
    if (!isTraversableType(meta.type)) return false
    meta.readLeaseCount = (meta.readLeaseCount ?? 0) + 1
    return true
}

function decrementReadLease(value, operationContext) {
    if (!isObjectLike(value)) return
    const meta = requireMeta(value, operationContext)
    const count = meta.readLeaseCount ?? 0
    if (count < 1) {
        errorUtils.reportFatalError(new Error("Read lease underflow"))
    }
    if (count === 1) delete meta.readLeaseCount
    else meta.readLeaseCount = count - 1
}

function markShared(value, operationContext) {
    if (!isObjectLike(value)) return value
    const meta = requireMeta(value, operationContext)
    if (isTraversableType(meta.type)) meta.shared = true
    return value
}

// New identities admitted by one import share its origin token.
function markImported(value, importBoundary, operationContext) {
    const meta = requireMeta(value, operationContext)
    meta.importBoundary ??= importBoundary
    if (isTraversableType(meta.type)) meta.shared = true
}

function importBoundaryOf(value, operationContext) {
    return metaOf(value, operationContext)?.importBoundary
}

export {
    TYPE_ARRAY,
    TYPE_ERROR,
    TYPE_EXTERNAL,
    TYPE_FUNCTION,
    TYPE_MANAGED_CLASS,
    TYPE_PRIMITIVE,
    TYPE_RECORD,
    TYPE_STRING,
    DECLARATION_EXTERNAL,
    DECLARATION_MANAGED,
    addManagedPrototype,
    decrementReadLease,
    getOrCreateMeta,
    hasReadLease,
    incrementReadLease,
    importBoundaryOf,
    identityDeclarationOf,
    inspectMetaFacts,
    isObjectLike,
    isPlainObjectPrototype,
    isTraversableType,
    markImported,
    markShared,
    metaOf,
    requireMeta,
    requiresCopyOnWrite,
    setIdentityDeclaration,
    validateManagedPrototype,
}
