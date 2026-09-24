import { ArrayView } from "./array-view.js"
import * as internalSteps from "./internal-step.js"
import * as arrayRemaps from "./array-remap.js"
import * as errorUtils from "./error.js"
import {
    ARRAY_METHODS,
    RETURN_RECEIVER,
    PASS_AS_PAYLOAD,
    runArrayStep,
} from "./array-methods.js"

function selectArrayMethodDescription(invocationWork) {
    const { method, mutation, receiver } = invocationWork
    const methodDefinition = ARRAY_METHODS[method]
    if (!methodDefinition) {
        return errorUtils.validationError(
            `Unsupported Array method: ${method}`,
            invocationWork.operationContext,
            errorUtils.ERROR_KIND.MissingFunction,
        )
    }
    if (mutation && methodDefinition.methodResult === undefined) {
        return errorUtils.validationError(
            `Array method ${method} cannot be used as a mutation`,
            invocationWork.operationContext,
            errorUtils.ERROR_KIND.InvalidArrayOperation,
        )
    }
    return {
        receiverToLease: mutation ? undefined : receiver,
        leaseInputsThroughResult: !mutation &&
            methodDefinition.leaseInputsThroughResult,
        prepareArguments: () => runArrayStep(invocationWork, () => internalSteps.continueOperation(
            prepareArrayMethodArguments(methodDefinition, invocationWork),
            invocationWork.operationContext, args => errorUtils.isPoisonError(args) || !methodDefinition.intrinsic
                ? args : runArrayStep(invocationWork, () => prepareIntrinsicArrayLength(args, invocationWork)),
            undefined, invocationWork)),
        invoke(preparedArguments) {
            return runArrayStep(invocationWork, () => {
                const failure = validateArrayOperation(
                    preparedArguments,
                    invocationWork,
                )
                if (failure) return failure
                return invokeArrayMethod(methodDefinition, preparedArguments, invocationWork)
            })
        },
    }
}

// Intrinsics require an exact remap length. Controlled algorithms prepare
// their own bounds or capture shape alongside their required placements.
function prepareIntrinsicArrayLength(args, work) {
    return ArrayView.resolveLength(work.receiver, work, length => {
        work.arrayLength = length
        return args
    })
}

function prepareArrayMethodArguments(methodDefinition, invocationWork) {
    const { args } = invocationWork
    if (methodDefinition.prepare) {
        return methodDefinition.prepare(invocationWork)
    }

    const inputs = methodDefinition.inputs ?? []
    const fixedCount = Math.min(inputs.length, args.length)
    // The prepared length preserves omission and every remaining argument.
    const prepared = new Array(methodDefinition.remainingArgsAsPayload
        ? args.length
        : fixedCount)
    const readiness = []
    for (let index = 0; index < fixedCount; index++) {
        const input = inputs[index]
        if (input === PASS_AS_PAYLOAD) {
            prepared[index] = invocationWork.leaseArgument(args[index])
            continue
        }
        const result = input(args[index], invocationWork)
        readiness.push(
            internalSteps.continueOperation(
                result,
                invocationWork.operationContext,
                value => {
                    if (errorUtils.isPoisonError(value)) return value

                    prepared[index] = value
                },
                undefined,
                invocationWork,
            ),
        )
    }
    if (methodDefinition.remainingArgsAsPayload) {
        for (let index = inputs.length; index < args.length; index++) {
            prepared[index] = invocationWork.leaseArgument(args[index])
        }
    }
    return internalSteps.prepareInputs(
        readiness,
        invocationWork.operationContext,
        () => prepared,
        invocationWork,
    )
}

// Views and direct observations avoid remap materialization. All remaining
// methods produce one remap; mutation additionally captures the native result
// before publishing the new receiver.
function invokeArrayMethod(methodDefinition, preparedArguments, invocationWork) {
    const { mutation, operationContext } = invocationWork
    if (methodDefinition.view) {
        const view = methodDefinition.view(preparedArguments, invocationWork)
        if (view !== undefined) return mutation ? {
            mutatedValue: view,
            result: methodDefinition.methodResult(
                methodDefinition.viewNativeResult(view, invocationWork), invocationWork),
        } : view
    }
    if (methodDefinition.observe) return methodDefinition.observe(preparedArguments, invocationWork)

    let remap, nativeResult
    if (methodDefinition.remap) {
        remap = methodDefinition.remap(preparedArguments, invocationWork)
    } else {
        remap = arrayRemaps.createRemap(invocationWork.receiver, operationContext, 0, invocationWork.arrayLength)
        nativeResult = Reflect.apply(methodDefinition.intrinsic, remap, preparedArguments)
        // Dense observations consume only the placements selected by the native
        // mapping. Overwritten and removed inputs create no presence dependency.
        if (methodDefinition.methodResult === undefined)
            remap = arrayRemaps.resolveDenseRemapPresence(nativeResult, invocationWork)
    }
    return internalSteps.continueOperation(remap, operationContext,
        remap => runArrayStep(invocationWork, () => {
            if (errorUtils.isPoisonError(remap)) return remap
            // Only intrinsic mutators have a separate native result. Capture
            // removed placements before materializing the new receiver.
            let result = mutation && methodDefinition.methodResult !== RETURN_RECEIVER
                ? methodDefinition.methodResult(nativeResult, invocationWork) : undefined
            const output = runArrayStep(invocationWork, () =>
                arrayRemaps.createArrayFromRemap(remap, operationContext))
            if (!mutation) return output
            if (methodDefinition.methodResult === RETURN_RECEIVER) result = output
            else if (errorUtils.isPoisonError(output)) {
                // Publish receiver failure now; only the independent result waits.
                result = internalSteps.continueOperation(result, operationContext,
                    value => errorUtils.isPoisonError(value)
                        ? errorUtils.combineErrors([output, value], "Array mutation failed") : output,
                    undefined, invocationWork)
            }
            return { mutatedValue: output, result }
        }), undefined, invocationWork)
}

function validateArrayOperation(args, { arrayLength: length, method, operationContext }) {
    const appends = method === "push" || method === "unshift"
    const splices = method === "splice" || method === "toSpliced"
    if (!appends && !splices) return
    let nextLength = length
    if (appends) nextLength += args.length
    else if (splices) {
        const relativeStart = args[0] ?? 0
        const start =
            relativeStart < 0
                ? Math.max(length + relativeStart, 0)
                : Math.min(relativeStart, length)
        const removed =
            args.length === 0
                ? 0
                : args.length === 1
                  ? length - start
                  : Math.min(Math.max(args[1] ?? 0, 0), length - start)
        nextLength += Math.max(args.length - 2, 0) - removed
    }
    if (nextLength > 0xffffffff) {
        return errorUtils.validationError(
            "Invalid Array length",
            operationContext,
            errorUtils.ERROR_KIND.InvalidArrayLength,
        )
    }
}

export { selectArrayMethodDescription }
