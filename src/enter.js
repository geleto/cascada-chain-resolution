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

function enter(chain, path, mutates, onEntered) {
    return errorUtils.runFatal(() => {
        if (mutates !== true && mutates !== false) {
            throw new TypeError("enter requires an exact mutates Boolean")
        }
        if (typeof onEntered !== "function") {
            throw new TypeError("enter requires an onEntered callback")
        }
        return mutates
            ? enterMutating(chain, path, onEntered)
            : enterReadOnly(chain, path, onEntered)
    })
}

function runEnteredCallback(callback, entered, onFulfilled, onRejected) {
    let result
    try {
        result = callback(entered)
    } catch (error) {
        errorUtils.runFatal(onRejected, error)
        return errorUtils.reportFatalError(error)
    }
    if (!languageValues.isPromise(result)) {
        return errorUtils.runFatal(onFulfilled, result)
    }
    return resolution.observeResultPromise(
        result,
        onFulfilled,
        reason => {
            onRejected(reason)
            errorUtils.reportFatalError(reason)
        },
    )
}

function enterReadOnly(chain, path, onEntered) {
    return walkObservationPath(chain, path, value => {
        if (languageValues.isError(value)) return value

        const entered = new Chain(value, false)
        const leased = metadata.incrementReadLease(value)
        const close = () => {
            entered.close()
            if (leased) metadata.decrementReadLease(value)
        }
        return runEnteredCallback(
            onEntered,
            entered,
            result => {
                close()
                return result
            },
            close,
        )
    })
}

function enterMutating(chain, path, onEntered) {
    let entered
    let resolveGate

    return walkMutationPath(
        chain,
        path,
        target => {
            if (
                target.propertyKind !==
                languageProperties.ORDINARY_PROPERTY
            ) {
                const error = languageProperties.propertyValidationError(
                    target.receiver,
                    "Cannot enter length for mutation",
                )
                target.replaceReceiver(error)
                return error
            }
            const { parent, key, attachmentRoot } = target
            const value = languageProperties.readLanguageProperty(parent, key)
            const privateChain = new Chain(value, true)
            const sourceMirror = languageValues.isPromise(value)
                ? propertyVersions.getOrCreatePromiseMirror(
                    parent,
                    key,
                    value,
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
                attachmentRoot,
            )

            if (sourceMirror) {
                propertyVersions.placePromiseVersion(
                    sourceMirror,
                    value,
                    privateChain._state,
                    "value",
                    Boolean(attachmentRoot),
                )
            } else if (attachmentRoot) {
                metadata.markShared(value)
            }

            entered = privateChain
        },
        entryError => {
            if (entryError) return entryError
            const close = () => {
                entered.close()
            }
            return runEnteredCallback(
                onEntered,
                entered,
                result => {
                    close()
                    publishEnteredValue(entered._state, resolveGate)
                    return result
                },
                // A fatal callback outcome must not publish private state.
                close,
            )
        },
    )
}

function publishEnteredValue(state, resolveGate) {
    const value = languageProperties.readLanguageProperty(state, "value")
    if (!languageValues.isPromise(value)) {
        resolveGate(value)
        return
    }

    // Registration happens only after callback issuance has stopped. The root
    // mirror and all earlier private commands therefore update state.value
    // first in the same canonical FIFO batch.
    const mirror = propertyVersions.getPromiseMirror(state, "value")
    if (!mirror) {
        // Preserve publication ordering for corrupt raw Promise state: issuance
        // is already closed; report the invariant failure from this FIFO slot.
        resolution.onLaterPromiseReady(value, () => {
            errorUtils.reportFatalError(
                new Error("Entered root remained pending at publication"),
            )
        })
        return
    }
    propertyVersions.continuePromiseVersion(value, mirror, publishedValue => {
        if (languageValues.isPromise(publishedValue)) {
            errorUtils.reportFatalError(
                new Error("Entered root remained pending at publication"),
            )
        }
        resolveGate(publishedValue)
    })
}

export { enter }
