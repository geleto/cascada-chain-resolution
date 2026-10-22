import { isArrayIndex } from "./array-view.js"
import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"

function externalState(value) {
    try {
        return errorUtils.runDeclarationBoundary(reflect => {
            if (errorUtils.isFatalError(value)) throw value
            if (Error.isError(value)) return value
            const failure = validateTarget(value, "externalState", reflect)
            if (failure) return failure
            if (metadata.identityDeclarationOf(value) === metadata.DECLARATION_MANAGED)
                return conflictError("externalState", "managed")
            metadata.setIdentityDeclaration(value, metadata.DECLARATION_EXTERNAL)
            return value
        })
    } finally { value = undefined }
}

function managedState(value) {
    try {
        return errorUtils.runDeclarationBoundary(reflect => {
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
            try {
                const walkFailure = walk(value, true)
                if (walkFailure) return walkFailure
                for (const prototype of prototypes) {
                    const failure = validateManagedPrototype(prototype, reflect)
                    if (errorUtils.isPoisonError(failure)) return failure
                }
                for (const identity of declarations)
                    metadata.setIdentityDeclaration(
                        identity, metadata.DECLARATION_MANAGED,
                    )
                return value
            } finally {
                visited.clear()
                declarations.clear()
                prototypes.clear()
            }

            function walk(identity, root = false) {
                try {
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
                    const facts = metadata.classifyTypeFacts(identity, reflect)
                    if (facts.type === metadata.TYPE.External || facts.type === metadata.TYPE.ManagedClass) {
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
                } finally { identity = undefined }
            }
        })
    } finally { value = undefined }
}

function managedStateClass(...classes) {
    try {
        return errorUtils.runDeclarationBoundary(reflect => {
            const prototypes = new Set()
            try {
                for (let ManagedClass of classes) {
                    try {
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
                        if (errorUtils.isPoisonError(failure)) return failure
                        prototypes.add(prototype)
                    } finally { ManagedClass = undefined }
                }
                for (const prototype of prototypes) metadata.addManagedPrototype(prototype)
            } finally { prototypes.clear() }
        })
    } finally { classes = undefined }
}

function validateManagedPrototype(prototype, reflect) {
    let current = prototype
    try {
        for (; current !== null;) {
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
    } finally { prototype = current = undefined }
}

function validateTarget(value, api, reflect) {
    try {
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
    } finally { value = undefined }
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

export { externalState, managedState, managedStateClass }
