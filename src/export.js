import * as errorUtils from "./error.js"
import * as steps from "./internal-step.js"
import * as values from "./language-values.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { ManagedCapture } from "./managed-capture.js"
import { assembleCapturedGraph } from "./captured-graph.js"

function exportValue(value, owner) {
    return exportValues([value], owner, outcome =>
        errorUtils.isPoisonError(outcome) ? outcome : outcome[0])
}

function exportManyValues(values, owner) {
    return exportValues(values, owner, values => values)
}

function exportValues(inputs, owner, onResult) {
    const { operationContext } = owner
    const errors = new Set()
    const capture = new ManagedCapture(owner, errorUtils.ERROR_KIND.ExportReflectionFailed, collect)
    let unregister
    const readiness = capture.capture(inputs)
    inputs = undefined
    const result = steps.continueGraphTransition(readiness, operationContext, () => {
        if (errors.size) return finish()
        return steps.continueGraphTransition(capture.resolve(), operationContext, finish, undefined, owner)
    }, undefined, owner)
    if (values.isPending(result, operationContext)) unregister = releaseOnClose(owner, release)
    return result

    function collect(error) {
        errors.add(error)
        capture.discard()
        owner.preparationFailed?.()
    }

    function finish() {
        const outcome = errors.size
            ? errorUtils.combineErrors(errors)
            : assembleCapturedGraph(capture)
        release()
        return onResult(outcome)
    }

    function release() {
        unregister?.()
        unregister = undefined
        capture.discard()
        errors.clear()
    }
}

export { exportManyValues, exportValue }
