import * as errorUtils from "./error.js"
import { isArrayIndex } from "./array-view.js"
import * as metadata from "./meta.js"

function externalState(value) {
    if (errorUtils.isFatalError(value)) throw value
    if (Error.isError(value)) return value
    const failure = validateTarget(value, "externalState")
    if (failure) return failure
    if (metadata.identityDeclarationOf(value) === metadata.DECLARATION_MANAGED)
        return conflictError("externalState", "managed")
    metadata.setIdentityDeclaration(value, metadata.DECLARATION_EXTERNAL)
    return value
}

function managedState(value) {
    if (errorUtils.isFatalError(value)) throw value
    if (Error.isError(value)) return value
    const failure = validateTarget(value, "managedState")
    if (failure) return failure
    if (
        metadata.identityDeclarationOf(value) ===
        metadata.DECLARATION_EXTERNAL
    ) return conflictError("managedState", "external")
    const visited = new Set()
    const declarations = new Set()
    const prototypes = new Set()
    const walkFailure = walk(value, true)
    if (walkFailure) return walkFailure
    for (const prototype of prototypes) {
        const failure = validateManagedPrototype(prototype)
        if (Error.isError(failure)) return failure
    }
    for (const identity of declarations)
        metadata.setIdentityDeclaration(
            identity, metadata.DECLARATION_MANAGED,
        )
    return value

    function walk(identity, root = false) {
        if (errorUtils.isFatalError(identity)) throw identity
        if (
            Error.isError(identity) ||
            !metadata.isObjectLike(identity) ||
            typeof identity === "function" ||
            visited.has(identity)
        )
            return undefined
        visited.add(identity)
        if (!root) {
            const failure = validateTarget(identity, "managedState")
            if (failure) return failure
        }
        if (
            metadata.identityDeclarationOf(identity) ===
            metadata.DECLARATION_EXTERNAL
        )
            return undefined
        const facts = metadata.inspectDeclarationMetaFacts(identity)
        if (facts.type === metadata.TYPE.External) {
            if (!facts.admittedPrototype)
                return root
                    ? errorUtils.declarationValidationError(
                          "managedState cannot inspect this prototype",
                      )
                    : undefined
            declarations.add(identity)
            prototypes.add(facts.admittedPrototype)
        } else if (facts.type === metadata.TYPE.ManagedClass) {
            declarations.add(identity)
            prototypes.add(facts.admittedPrototype)
        } else if (!metadata.isTraversableType(facts.type)) return undefined

        const keys = inspectDeclaration(() => Reflect.ownKeys(identity))
        if (Error.isError(keys)) return keys
        const array = inspectDeclaration(() => Array.isArray(identity))
        if (Error.isError(array)) return array
        for (const key of keys) {
            if (
                typeof key !== "string" ||
                (array && !isArrayIndex(key))
            ) continue
            const descriptor = inspectDeclaration(() =>
                Object.getOwnPropertyDescriptor(identity, key),
            )
            if (Error.isError(descriptor)) return descriptor
            if (descriptor?.enumerable && "value" in descriptor) {
                const failure = walk(descriptor.value)
                if (failure) return failure
            }
        }
    }
}

function managedStateClass(...classes) {
    const prototypes = new Set()
    for (const ManagedClass of classes) {
        if (errorUtils.isFatalError(ManagedClass)) throw ManagedClass
        if (Error.isError(ManagedClass)) return ManagedClass
        if (typeof ManagedClass !== "function")
            return errorUtils.declarationValidationError(
                "managedStateClass requires functions",
            )
        const prototype = inspectDeclaration(() => ManagedClass.prototype)
        if (Error.isError(prototype)) return prototype
        if (!metadata.isObjectLike(prototype))
            return errorUtils.declarationValidationError(
                "managedStateClass requires object prototypes",
            )
        const failure = validateManagedPrototype(prototype)
        if (Error.isError(failure)) return failure
        prototypes.add(prototype)
    }
    for (const prototype of prototypes) metadata.addManagedPrototype(prototype)
}

function validateManagedPrototype(prototype) {
    for (let current = prototype; current !== null;) {
        const plain = inspectDeclaration(() =>
            metadata.isPlainObjectPrototype(current),
        )
        if (Error.isError(plain)) return plain
        if (plain) return undefined
        const descriptor = inspectDeclaration(() =>
            Object.getOwnPropertyDescriptor(current, "then"),
        )
        if (Error.isError(descriptor)) return descriptor
        if (
            descriptor &&
            (!("value" in descriptor) || typeof descriptor.value === "function")
        ) return errorUtils.declarationValidationError(
            "Managed class prototypes cannot contain an unsafe then",
        )
        current = inspectDeclaration(() => Object.getPrototypeOf(current))
        if (Error.isError(current)) return current
    }
}

function validateTarget(value, api) {
    if (!metadata.isObjectLike(value))
        return errorUtils.declarationValidationError(api + " requires an object")
    if (typeof value === "function")
        return errorUtils.declarationValidationError(
            api + " cannot declare a Function",
        )
    const thenable = inspectDeclaration(() => {
        const candidate = value.then
        if (errorUtils.isFatalError(candidate)) throw candidate
        return typeof candidate === "function"
    })
    if (Error.isError(thenable)) return thenable
    if (thenable)
        return errorUtils.declarationValidationError(api + " cannot declare a Promise")
}

function conflictError(api, existing) {
    const requested = existing === "managed" ? "external" : "managed"
    return errorUtils.declarationValidationError(
        api +
            " cannot declare this value " +
            requested +
            " because it is already " +
            existing,
    )
}

// This is a contextless declaration probe, not an execution failure boundary.
function inspectDeclaration(action) {
    try {
        return action()
    } catch (reason) {
        if (errorUtils.isFatalError(reason)) throw reason
        return Error.isError(reason)
            ? reason
            : new Error("Could not inspect declaration input", {
                  cause: reason,
              })
    }
}

export { externalState, managedState, managedStateClass }
