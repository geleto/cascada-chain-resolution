import { Chain } from "./chain.js"
import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import {
    setProperty,
    walkMutationPath,
} from "./mutations.js"
import { walkObservationPath } from "./observations.js"
import * as propertyVersions from "./property-versions.js"
import * as resolution from "./resolution.js"

function enter(chain, path, operationContext, entryMutable, onEntered) {
    return errorUtils.runFatal(operationContext, () => {
        chain._assertOperationContext(operationContext)
        path = [...path]
        const externalMutationTree = chain._externalMutationTree?.findBranch(path)
        const enterOperation = entryMutable ? enterMutating : enterReadOnly
        return enterOperation(
            chain,
            path,
            operationContext,
            onEntered,
            externalMutationTree,
        )
    })
}

function runEnteredCallback(
    onEntered,
    enteredChain,
    operationContext,
    onFulfilled,
    onRejected,
) {
    let result
    try {
        result = onEntered(enteredChain)
    } catch (error) {
        onRejected(error)
        throw error
    }
    if (!languageValues.isPromise(result, operationContext)) {
        return finish(result)
    }
    return resolution.continueInternalPromiseOrFatal(
        result,
        operationContext,
        finish,
        reason => {
            onRejected(reason)
            throw reason
        },
    )

    function finish(value) {
        if (errorUtils.isFatalError(value)) {
            onRejected(value)
            throw value
        }
        return onFulfilled(value)
    }
}

function enterReadOnly(
    chain,
    path,
    operationContext,
    onEntered,
    externalMutationTree,
) {
    return walkObservationPath(chain, path, operationContext, value => {
        if (languageValues.isError(value)) return value

        const enteredChain = new Chain(
            value,
            operationContext,
            false,
            externalMutationTree,
        )
        const leased = metadata.incrementReadLease(
            value,
            operationContext,
        )
        const close = () => {
            enteredChain._closeEntry()
            if (leased) metadata.decrementReadLease(
                value,
                operationContext,
            )
        }
        return runEnteredCallback(
            onEntered,
            enteredChain,
            operationContext,
            result => {
                close()
                return result
            },
            close,
        )
    })
}

function enterMutating(
    chain,
    path,
    operationContext,
    onEntered,
    externalMutationTree,
) {
    let enteredChain
    let resolveGate

    return walkMutationPath(
        chain,
        path,
        operationContext,
        target => {
            if (
                target.propertyKind !==
                languageProperties.ORDINARY_PROPERTY
            ) {
                const error = languageProperties.propertyValidationError(
                    "Cannot enter length for mutation",
                    operationContext,
                )
                target.replaceReceiver(error)
                return error
            }
            const { parent, key, attachmentRoot } = target
            const value = languageProperties.readLanguageProperty(
                parent,
                key,
                operationContext,
            )
            enteredChain = new Chain(
                value,
                operationContext,
                true,
                externalMutationTree,
            )
            const sourceMirror = languageValues.isPromise(value, operationContext)
                ? propertyVersions.getOrCreatePromiseMirror(
                    parent,
                    key,
                    value,
                    operationContext,
                )
                : undefined

            const gate = new Promise(resolve => {
                resolveGate = resolve
            })

            // Install the gate first. Promise reactions cannot run in this
            // synchronous transition, so the source is safely detached before
            // its transfer registers, still ahead of the callback and all
            // target-dependent commands.
            setProperty(
                parent,
                key,
                gate,
                operationContext,
                attachmentRoot,
            )

            if (sourceMirror) {
                propertyVersions.placePromiseVersion(
                    sourceMirror,
                    value,
                    enteredChain._state,
                    "value",
                    operationContext,
                    Boolean(attachmentRoot),
                )
            } else if (attachmentRoot) {
                metadata.markShared(value, operationContext)
            }
        },
        entryError => {
            if (entryError) return entryError
            const close = () => {
                enteredChain._closeEntry()
            }
            return runEnteredCallback(
                onEntered,
                enteredChain,
                operationContext,
                result => {
                    close()
                    publishEnteredValue(
                        enteredChain._state,
                        resolveGate,
                        operationContext,
                    )
                    return result
                },
                // A fatal callback outcome must not publish private state.
                close,
            )
        },
    )
}

function publishEnteredValue(rootState, resolveGate, operationContext) {
    const value = languageProperties.readLanguageProperty(
        rootState,
        "value",
        operationContext,
    )
    if (!languageValues.isPromise(value, operationContext)) {
        resolveGate(value)
        return
    }

    // Registration happens only after callback issuance has stopped. The root
    // mirror and all earlier private commands therefore update rootState.value
    // first in the same canonical FIFO batch.
    const mirror = propertyVersions.getPromiseMirror(
        rootState,
        "value",
        operationContext,
    )
    if (!mirror) {
        // Preserve publication ordering for corrupt raw Promise state: issuance
        // is already closed; report the invariant failure from this FIFO slot.
        resolution.onLaterPromiseReady(value, operationContext, () => {
            throw new Error("Entered root remained pending at publication")
        })
        return
    }
    propertyVersions.continuePromiseVersion(
        value,
        mirror,
        operationContext,
        publishedValue => {
            if (languageValues.isPromise(publishedValue, operationContext)) {
                throw new Error("Entered root remained pending at publication")
            }
            resolveGate(publishedValue)
        },
    )
}

export { enter }
