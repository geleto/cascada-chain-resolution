import { markPromiseHandled } from "./thenable-subscription.js"
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
    return errorUtils.runInternalStep(operationContext, () => {
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
) {
    const result = onEntered(enteredChain)
    const fatalError = operationContext.execution.fatalError
    if (fatalError !== null) throw fatalError
    return resolution.continueInternalResultOrFatal(
        result,
        operationContext,
        finish,
        reason => {
            if (!(reason instanceof errorUtils.PoisonError)) throw reason
            return finish(reason)
        },
    )

    function finish(value) {
        if (errorUtils.isFatalError(value)) {
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
                undefined,
                operationContext,
                true,
                externalMutationTree,
            )
            const sourceMirror = languageValues.isPending(value, operationContext)
                ? propertyVersions.requirePromiseMirror(
                    parent,
                    key,
                    operationContext,
                )
                : undefined

            const gate = new Promise(resolve => {
                resolveGate = resolve
            })

            // Capture the source before detaching it. The private Chain is
            // initialized without consuming that source; its exact version
            // transfers only after the entry gate excludes outside access.
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
            } else {
                propertyVersions.assignProperty(enteredChain._state, "value", value, operationContext)
                if (attachmentRoot) metadata.markShared(value, operationContext)
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
            )
        },
    )
}

function publishEnteredValue(rootState, resolveGate, operationContext) {
    const version = metadata.metaOf(rootState, operationContext).placementVersions?.value
    const value = version ? version.value : rootState.value
    if (!languageValues.isPending(value, operationContext)) {
        resolveGate(value)
        return
    }

    // Registration happens only after callback issuance has stopped. The root
    // mirror and all earlier private commands therefore update rootState.value
    // first in the same FIFO delivery.
    const mirror = propertyVersions.requirePromiseMirror(
        rootState,
        "value",
        operationContext,
    )
    const publication = propertyVersions.continuePromiseVersion(
        value,
        mirror,
        operationContext,
        publishedValue => {
            if (languageValues.isPending(publishedValue, operationContext)) {
                throw new Error("Entered root remained pending at publication")
            }
            resolveGate(publishedValue)
        },
    )
    markPromiseHandled(publication, operationContext)
}

export { enter }
