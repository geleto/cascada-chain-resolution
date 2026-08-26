import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

function externalState(value) {
    return declarationBoundary(() => {
        if (languageValues.isError(value)) return value
        const failure = validateDeclarationTarget(value, "externalState")
        if (failure) return failure

        const admitted = metadata.metaOf(value)
        if (admitted) {
            return admitted.type === languageValues.TYPE_EXTERNAL
                ? value
                : conflictError("externalState", "managed")
        }
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
        if (languageValues.isError(value)) return value
        const rootFailure = validateDeclarationTarget(value, "managedState")
        if (rootFailure) return rootFailure
        const admittedRoot = metadata.metaOf(value)
        if (admittedRoot) {
            return languageValues.isTraversableType(admittedRoot.type)
                ? value
                : conflictError("managedState", "external")
        }
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
            if (languageValues.isPromise(identity)) {
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

            if (metadata.metaOf(identity)) return undefined

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

            for (const key of languageProperties.enumerableLanguageKeys(
                identity,
            )) {
                const descriptor = languageProperties
                    .getLanguagePlacementDescriptor(identity, key)
                if (!descriptor) continue
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

function validateDeclarationTarget(value, api) {
    if (!metadata.isObjectLike(value)) {
        return errorUtils.validationError(`${api} requires an object`)
    }
    if (typeof value === "function") {
        return errorUtils.validationError(`${api} cannot declare a Function`)
    }
    if (languageValues.isPromise(value)) {
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
    return errorUtils.runFatal(fn)
}

export { externalState, managedState, managedStateClass }
