import "./init.js"
import { Chain } from "./chain.js"
import * as errorUtils from "./error.js"
import * as helpers from "./helpers.js"
import * as imports from "./import.js"
import * as languageProperties from "./language-properties.js"
import * as metadata from "./meta.js"
import {
    setProperty,
    walkMutationPath,
} from "./mutations.js"
import { walkObservationPath } from "./observations.js"
import * as promiseMirrors from "./promise-mirrors.js"

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
        if (helpers.isError(value)) return value

        if (importBoundary) {
            imports.import(value, importBoundary.errorContext)
        }
        const entered = new Chain(value, false)
        const readMeta = helpers.isTracked(value)
            ? metadata.ensureMeta(value)
            : undefined
        if (readMeta) updateReadEnterCount(readMeta, 1)
        const close = () => {
            entered.close()
            if (readMeta) updateReadEnterCount(readMeta, -1)
        }
        return helpers.runOperationCallback(
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
            const sourceMirror = helpers.isPromise(value)
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
            return helpers.runOperationCallback(
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

function updateReadEnterCount(meta, change) {
    const count = meta.readEnterCount ?? 0
    const next = count + change
    if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        !Number.isSafeInteger(next) ||
        next < 0
    ) {
        errorUtils.reportFatalError(
            new Error("Read entry count is inconsistent"),
        )
    }
    if (next === 0) delete meta.readEnterCount
    else meta.readEnterCount = next
}

function publishEnteredValue(state, resolveGate) {
    const value = state.value
    if (!helpers.isPromise(value)) {
        resolveGate(value)
        return
    }

    // Registration happens only after callback issuance has stopped. The root
    // mirror and all earlier private commands therefore update state.value
    // first in the same canonical FIFO batch.
    helpers.onLaterPromiseReady(value, () => {
        const publishedValue = state.value
        if (helpers.isPromise(publishedValue)) {
            errorUtils.reportFatalError(
                new Error("Entered root remained pending at publication"),
            )
        }
        resolveGate(publishedValue)
    })
}

export { enter }
