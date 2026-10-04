import { isArrayIndex } from "./array-view.js"
import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"

function externalState(value) {
    return inspectDeclaration(reflect => {
        if (errorUtils.isFatalError(value)) throw value
        if (Error.isError(value)) return value
        const failure = validateTarget(value, "externalState", reflect)
        if (failure) return failure
        if (metadata.identityDeclarationOf(value) === metadata.DECLARATION_MANAGED)
            return conflictError("externalState", "managed")
        metadata.setIdentityDeclaration(value, metadata.DECLARATION_EXTERNAL)
        return value
    })
}

function managedState(value) {
    return inspectDeclaration(reflect => {
        if (errorUtils.isFatalError(value)) throw value
        if (Error.isError(value)) return value
        const failure = validateTarget(value, "managedState", reflect)
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
            const failure = validateManagedPrototype(prototype, reflect)
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
                const failure = validateTarget(identity, "managedState", reflect)
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

            const keys = reflect(() => Reflect.ownKeys(identity))
            const array = facts.type === metadata.TYPE.Array
            for (const key of keys) {
                if (
                    typeof key !== "string" ||
                    (array && !isArrayIndex(key))
                ) continue
                const descriptor = reflect(() => Object.getOwnPropertyDescriptor(identity, key))
                if (descriptor?.enumerable && "value" in descriptor) {
                    const failure = walk(descriptor.value)
                    if (failure) return failure
                }
            }
        }
    })
}

function managedStateClass(...classes) {
    return inspectDeclaration(reflect => {
        const prototypes = new Set()
        for (const ManagedClass of classes) {
            if (errorUtils.isFatalError(ManagedClass)) throw ManagedClass
            if (Error.isError(ManagedClass)) return ManagedClass
            if (typeof ManagedClass !== "function")
                return errorUtils.declarationValidationError(
                    "managedStateClass requires functions",
                )
            const prototype = reflect(() => ManagedClass.prototype)
            if (!metadata.isObjectLike(prototype))
                return errorUtils.declarationValidationError(
                    "managedStateClass requires object prototypes",
                )
            const failure = validateManagedPrototype(prototype, reflect)
            if (Error.isError(failure)) return failure
            prototypes.add(prototype)
        }
        for (const prototype of prototypes) metadata.addManagedPrototype(prototype)
    })
}

function validateManagedPrototype(prototype, reflect) {
    for (let current = prototype; current !== null;) {
        const plain = metadata.isPlainObjectPrototype(current, reflect)
        if (plain) return undefined
        const descriptor = reflect(() => Object.getOwnPropertyDescriptor(current, "then"))
        if (
            descriptor &&
            (!("value" in descriptor) || typeof descriptor.value === "function")
        ) return errorUtils.declarationValidationError(
            "Managed class prototypes cannot contain an unsafe then",
        )
        current = reflect(() => Object.getPrototypeOf(current))
    }
}

function validateTarget(value, api, reflect) {
    if (!metadata.isObjectLike(value))
        return errorUtils.declarationValidationError(api + " requires an object")
    if (typeof value === "function")
        return errorUtils.declarationValidationError(
            api + " cannot declare a Function",
        )
    const candidate = reflect(() => value.then)
    if (errorUtils.isFatalError(candidate)) throw candidate
    if (typeof candidate === "function")
        return errorUtils.declarationValidationError(api + " cannot declare a Promise")
}

// Only the exact host actions passed to reflect produce the shared escape.
// Traversal, validation, and registration defects pass through unchanged.
function inspectDeclaration(work) {
    return errorUtils.catchExternalAction(
        () => work(errorUtils.runDeclarationAction),
        declarationFailure,
    )
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

// Only thrown reflection failures enter this lane; a reflected Error may be
// legitimate prototype data. Each declaration commits after all validation.
function declarationFailure(reason) {
    if (errorUtils.isFatalError(reason)) throw reason
    return Error.isError(reason)
        ? reason
        : new Error("Could not inspect declaration input", { cause: reason })
}

export { externalState, managedState, managedStateClass }
