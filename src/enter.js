import "./init.js"
import { Chain } from "./chain.js"
import * as errorUtils from "./error.js"
import * as helpers from "./helpers.js"
import * as imports from "./import.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"
import {
    setProperty,
    walkMutationPath,
} from "./mutations.js"
import { walkObservationPath } from "./observations.js"
import * as promiseMirrors from "./promise-mirrors.js"
import * as resolution from "./resolution.js"

function enter(chain, path, mutates, onEntered) {
    return helpers.runFatal(() => {
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

function enterReadOnly(chain, path, onEntered) {
    return walkObservationPath(chain, path, (value, importBoundary) => {
        if (languageValues.isError(value)) return value

        if (importBoundary) {
            imports.import(value, importBoundary.errorContext)
        }
        const entered = new Chain(value, false)
        const leaseValue = languageValues.isTracked(value) ? value : undefined
        if (leaseValue) metadata.updateReadLease(leaseValue, 1)
        const close = () => {
            entered.close()
            if (leaseValue) metadata.updateReadLease(leaseValue, -1)
        }
        return resolution.runOperationCallbackOrFatal(
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
        (parent, key, importBoundary, attachmentPath) => {
            const value = languageProperties.readLanguageProperty(parent, key)
            const privateChain = new Chain(value, true)
            const sourceMirror = languageValues.isPromise(value)
                ? promiseMirrors.getOrCreatePromiseMirror(
                    parent,
                    key,
                    value,
                    importBoundary,
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
                importBoundary,
                attachmentPath,
            )

            if (sourceMirror) {
                promiseMirrors.transferDetachedPromiseMirror(
                    sourceMirror,
                    privateChain._state,
                    "value",
                    value,
                    attachmentPath,
                )
            } else if (attachmentPath) {
                metadata.markShared(value)
            }

            entered = privateChain
        },
        entryError => {
            if (entryError) return entryError
            const close = () => {
                entered.close()
            }
            return resolution.runOperationCallbackOrFatal(
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
    const value = state.value
    if (!languageValues.isPromise(value)) {
        resolveGate(value)
        return
    }

    // Registration happens only after callback issuance has stopped. The root
    // mirror and all earlier private commands therefore update state.value
    // first in the same canonical FIFO batch.
    resolution.onLaterPromiseReady(value, () => {
        const publishedValue = state.value
        if (languageValues.isPromise(publishedValue)) {
            errorUtils.reportFatalError(
                new Error("Entered root remained pending at publication"),
            )
        }
        resolveGate(publishedValue)
    })
}

export { enter }
