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
            ? inspectAdmissionMetaFacts(value, operationContext)
            : admittedPrototype === undefined
                ? { type }
                : { type, admittedPrototype }
        if (
            (meta.type === TYPE_RECORD || meta.type === TYPE_MANAGED_CLASS) &&
            meta.admittedPrototype === undefined
        ) {
            throw new TypeError("Managed container admission requires a prototype")
        }
        metadata.set(value, meta)
    } else if (type !== undefined && meta.type !== type) {
        throw new TypeError("Admitted type cannot change")
    }
    return meta
}

// Classification is a capability probe whose reflection can invoke Proxy
// traps. If it cannot identify managed structure, preserving the exact value
// as external is always safe.
function inspectAdmissionMetaFacts(value, operationContext) {
    let facts
    let fatal
    errorUtils.enterHostCode()
    try {
        facts = classifyTypeFacts(value)
    } catch (reason) {
        if (errorUtils.isFatalError(reason)) fatal = reason
        else facts = { type: TYPE_EXTERNAL }
    } finally {
        errorUtils.leaveHostCode()
    }
    if (operationContext.execution.fatalError !== null)
        throw operationContext.execution.fatalError
    if (fatal) errorUtils.failExecution(operationContext, fatal)
    return facts
}

function inspectDeclarationMetaFacts(value) {
    errorUtils.enterHostCode()
    try {
        return classifyTypeFacts(value)
    } catch (reason) {
        if (errorUtils.isFatalError(reason)) throw reason
        return { type: TYPE_EXTERNAL }
    } finally {
        errorUtils.leaveHostCode()
    }
}

function classifyTypeFacts(value) {
    // This order is the admission-precedence contract.
    if (Error.isError(value)) return { type: TYPE_ERROR }
    if (typeof value === "function") return { type: TYPE_FUNCTION }
    const declaration = IDENTITY_DECLARATIONS.get(value)
    if (declaration === DECLARATION_EXTERNAL) return { type: TYPE_EXTERNAL }
    if (Array.isArray(value)) return { type: TYPE_ARRAY }

    const admittedPrototype = Object.getPrototypeOf(value)
    if (admittedPrototype === null || isPlainObjectPrototype(admittedPrototype))
        return { type: TYPE_RECORD, admittedPrototype }

    return declaration === DECLARATION_MANAGED ||
        MANAGED_PROTOTYPES.has(admittedPrototype)
        ? { type: TYPE_MANAGED_CLASS, admittedPrototype }
        : { type: TYPE_EXTERNAL, admittedPrototype }
}

function isPlainObjectPrototype(prototype) {
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
        throw new TypeError("Value metadata requires prior admission")
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
        throw new Error("Read lease underflow")
    }
    if (count === 1) delete meta.readLeaseCount
    else meta.readLeaseCount = count - 1
}

function markShared(value, operationContext) {
    if (!isObjectLike(value)) return value
    if (errorUtils.isFatalError(value)) throw value
    if (Error.isError(value)) return value
    const meta = requireMeta(value, operationContext)
    if (isTraversableType(meta.type)) meta.shared = true
    return value
}

function markImported(value, operationContext) {
    const meta = requireMeta(value, operationContext)
    meta.imported = true
    if (isTraversableType(meta.type)) meta.shared = true
}

function isImported(value, operationContext) {
    return metaOf(value, operationContext)?.imported === true
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
    isImported,
    identityDeclarationOf,
    inspectAdmissionMetaFacts,
    inspectDeclarationMetaFacts,
    isObjectLike,
    isPlainObjectPrototype,
    isTraversableType,
    markImported,
    markShared,
    metaOf,
    requireMeta,
    requiresCopyOnWrite,
    setIdentityDeclaration,
}
