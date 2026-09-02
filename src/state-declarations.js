import * as errorUtils from "./error.js"
import { isArrayIndex } from "./array-view.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

function externalState(value) {
    return declarationBoundary(() => {
        const isPromise = languageValues.createPromiseProbe()
        if (languageValues.isError(value)) return value
        const failure = validateDeclarationTarget(
            value,
            "externalState",
            isPromise,
        )
        if (failure) return failure

        const declaration = metadata.identityDeclarationOf(value)
        if (declaration === metadata.DECLARATION_MANAGED) {
            return conflictError("externalState", "managed")
        }
        metadata.setIdentityDeclaration(value, metadata.DECLARATION_EXTERNAL)
        return value
    })
}

function managedState(value) {
    return declarationBoundary(() => {
        const isPromise = languageValues.createPromiseProbe()
        if (languageValues.isError(value)) return value
        const rootFailure = validateDeclarationTarget(
            value,
            "managedState",
            isPromise,
        )
        if (rootFailure) return rootFailure
        if (
            metadata.identityDeclarationOf(value) ===
            metadata.DECLARATION_EXTERNAL
        ) return conflictError("managedState", "external")

        const declarations = new Set()
        const prototypes = new Set()
        const visited = new Set()
        const walkFailure = walk(value, true)
        if (walkFailure) return walkFailure
        for (const prototype of prototypes) {
            errorUtils.runUserCode(
                () => metadata.validateManagedPrototype(prototype),
            )
        }
        for (const identity of declarations) {
            metadata.setIdentityDeclaration(
                identity, metadata.DECLARATION_MANAGED,
            )
        }
        return value

        function walk(identity, root = false) {
            if (languageValues.isError(identity)) return undefined
            if (isPromise(identity)) {
                return errorUtils.validationError(
                    "managedState cannot contain a Promise",
                )
            }
            if (!metadata.isObjectLike(identity)) {
                return undefined
            }
            if (typeof identity === "function") {
                return undefined
            }
            if (visited.has(identity)) return undefined
            visited.add(identity)

            const declaration = metadata.identityDeclarationOf(identity)
            if (declaration === metadata.DECLARATION_EXTERNAL) {
                return undefined
            }

            const facts = metadata.inspectMetaFacts(identity)
            if (facts.type === languageValues.TYPE_EXTERNAL) {
                if (!facts.admittedPrototype) {
                    return root
                        ? errorUtils.validationError(
                            "managedState cannot declare this value managed " +
                            "because its prototype could not be inspected",
                        )
                        : undefined
                }
                prototypes.add(facts.admittedPrototype)
                declarations.add(identity)
            } else if (facts.type === languageValues.TYPE_MANAGED_CLASS) {
                prototypes.add(facts.admittedPrototype)
                declarations.add(identity)
            } else if (
                facts.type !== languageValues.TYPE_RECORD &&
                facts.type !== languageValues.TYPE_ARRAY
            ) {
                return undefined
            }

            for (const descriptor of getDeclarationChildDescriptors(identity)) {
                const childFailure = walk(descriptor.value)
                if (childFailure) return childFailure
            }
            return undefined
        }
    })
}

function managedStateClass(...classes) {
    return declarationBoundary(() => {
        const prototypes = new Set()
        for (const ManagedClass of classes) {
            if (typeof ManagedClass !== "function") {
                return errorUtils.validationError(
                    "managedStateClass requires constructors",
                )
            }
            if (!isConstructor(ManagedClass)) {
                return new TypeError(
                    "managedStateClass requires constructors",
                )
            }
            const prototype = errorUtils.runUserCode(() => {
                const candidate = ManagedClass.prototype
                if (!metadata.isObjectLike(candidate)) {
                    throw new TypeError(
                        "managedStateClass requires object prototypes",
                    )
                }
                metadata.validateManagedPrototype(candidate)
                return candidate
            })
            prototypes.add(prototype)
        }
        for (const prototype of prototypes) {
            metadata.addManagedPrototype(prototype)
        }
        return undefined
    })
}

// A Proxy preserves constructibility; its trap avoids invoking the target or
// reading its prototype.
function isConstructor(value) {
    try {
        Reflect.construct(new Proxy(value, {
            construct: () => ({}),
        }), [])
        return true
    } catch {
        return false
    }
}

function validateDeclarationTarget(value, api, isPromise) {
    if (!metadata.isObjectLike(value)) {
        return errorUtils.validationError(`${api} requires an object`)
    }
    if (typeof value === "function") {
        return errorUtils.validationError(`${api} cannot declare a Function`)
    }
    if (isPromise(value)) {
        return errorUtils.validationError(`${api} cannot declare a Promise`)
    }
    return undefined
}

function conflictError(api, existing) {
    const requested = existing === "managed" ? "external" : "managed"
    return errorUtils.validationError(
        `${api} cannot declare this value ${requested} because it is already ${existing}`,
    )
}

function declarationBoundary(fn) {
    return errorUtils.runContextlessFatal(fn)
}

function getDeclarationChildDescriptors(value) {
    const descriptors = []
    const array = errorUtils.runUserCode(() => Array.isArray(value))
    for (const key of errorUtils.runUserCode(() => Reflect.ownKeys(value))) {
        if (
            typeof key !== "string" ||
            (array && !isArrayIndex(key))
        ) continue
        const descriptor = errorUtils.runUserCode(
            () => Object.getOwnPropertyDescriptor(value, key),
        )
        if (descriptor?.enumerable && "value" in descriptor) {
            descriptors.push(descriptor)
        }
    }
    return descriptors
}

export { externalState, managedState, managedStateClass }
