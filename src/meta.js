import * as errorUtils from "./error.js"

const TYPE = Object.freeze({
    Error: 1,
    Array: 2,
    Function: 3,
    String: 4,
    Primitive: 5,
    Record: 6,
    ManagedClass: 7,
    External: 8,
})

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
            (meta.type === TYPE.Record || meta.type === TYPE.ManagedClass) &&
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
    const execution = operationContext.execution
    const previousExternalActionActive = execution._externalActionActive
    let facts
    let fatal
    execution._externalActionActive = true
    try {
        facts = classifyTypeFacts(value)
    } catch (reason) {
        if (errorUtils.isFatalError(reason)) fatal = reason
        else facts = { type: TYPE.External }
    } finally {
        execution._externalActionActive = previousExternalActionActive
    }
    if (execution.fatalError !== null) throw execution.fatalError
    if (fatal) errorUtils.failExecution(operationContext, fatal)
    return facts
}

function inspectDeclarationMetaFacts(value) {
    try {
        return classifyTypeFacts(value)
    } catch (reason) {
        if (errorUtils.isFatalError(reason)) throw reason
        return { type: TYPE.External }
    }
}

function classifyTypeFacts(value) {
    // This order is the admission-precedence contract.
    if (Error.isError(value)) return { type: TYPE.Error }
    if (typeof value === "function") return { type: TYPE.Function }
    const declaration = IDENTITY_DECLARATIONS.get(value)
    if (declaration === DECLARATION_EXTERNAL) return { type: TYPE.External }
    if (Array.isArray(value)) return { type: TYPE.Array }

    const admittedPrototype = Object.getPrototypeOf(value)
    if (admittedPrototype === null || isPlainObjectPrototype(admittedPrototype))
        return { type: TYPE.Record, admittedPrototype }

    return declaration === DECLARATION_MANAGED ||
        MANAGED_PROTOTYPES.has(admittedPrototype)
        ? { type: TYPE.ManagedClass, admittedPrototype }
        : { type: TYPE.External, admittedPrototype }
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
    return type === TYPE.Array ||
        type === TYPE.Record ||
        type === TYPE.ManagedClass
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
    TYPE,
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
