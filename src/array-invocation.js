import * as internalSteps from "./internal-step.js"
import * as arrayRemaps from "./array-remap.js"
import * as arrayViews from "./array-view.js"
import * as errorUtils from "./error.js"
import {
    ARRAY_METHODS,
    RETURN_RECEIVER,
    PASS_AS_PAYLOAD,
    runArrayStep,
} from "./array-methods.js"

function getArrayMethodDescription(invocationContext) {
    const { method, mutation, receiver } = invocationContext
    const methodDefinition = ARRAY_METHODS[method]
    if (!methodDefinition) {
        return errorUtils.validationError(
            `Unsupported Array method: ${method}`,
            invocationContext.operationContext,
            errorUtils.ERROR_KIND.MissingFunction,
        )
    }
    if (mutation && methodDefinition.methodResult === undefined) {
        return errorUtils.validationError(
            `Array method ${method} cannot be used as a mutation`,
            invocationContext.operationContext,
            errorUtils.ERROR_KIND.InvalidArrayOperation,
        )
    }
    return {
        receiverToLease: mutation ? undefined : receiver,
        leaseInputsThroughResult: !mutation &&
            methodDefinition.leaseInputsThroughResult,
        prepareArguments: () =>
            runArrayStep(invocationContext, () =>
                prepareArrayMethodArguments(
                    methodDefinition,
                    invocationContext,
                ),
            ),
        invoke(preparedArguments) {
            return runArrayStep(invocationContext, () => {
                const failure = validateArrayOperation(
                    preparedArguments,
                    invocationContext,
                )
                if (failure) return failure
                return mutation
                    ? invokeArrayMutationMethod(
                        methodDefinition,
                        preparedArguments,
                        invocationContext,
                    )
                    : invokeArrayObservationMethod(
                        methodDefinition,
                        preparedArguments,
                        invocationContext,
                    )
            })
        },
    }
}

function prepareArrayMethodArguments(methodDefinition, invocationContext) {
    const { args } = invocationContext
    if (methodDefinition.prepare) {
        return methodDefinition.prepare(invocationContext)
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
            prepared[index] = invocationContext.retainArgument(args[index])
            continue
        }
        const result = input(args[index], invocationContext)
        readiness.push(
            internalSteps.continueOperation(
                result,
                invocationContext.operationContext,
                value => {
                    if (errorUtils.isPoisonError(value)) return value

                    prepared[index] = value
                },
                undefined,
                invocationContext,
            ),
        )
    }
    if (methodDefinition.remainingArgsAsPayload) {
        for (let index = inputs.length; index < args.length; index++) {
            prepared[index] = invocationContext.retainArgument(args[index])
        }
    }
    return internalSteps.prepareInputs(
        readiness,
        invocationContext.operationContext,
        () => prepared,
        invocationContext,
    )
}

// view, observe, remap, and intrinsic fallback are distinct because each avoids
// progressively more representation work.
function invokeArrayObservationMethod(
    methodDefinition,
    preparedArgs,
    invocationContext,
) {
    if (methodDefinition.view) {
        const view = methodDefinition.view(preparedArgs, invocationContext)
        if (view !== undefined) return view
    }
    if (methodDefinition.observe) {
        return methodDefinition.observe(preparedArgs, invocationContext)
    }

    let remap
    if (methodDefinition.remap) {
        remap = methodDefinition.remap(preparedArgs, invocationContext)
    } else {
        const source = arrayRemaps.createRemap(invocationContext.receiver, invocationContext.operationContext)
        const result = Reflect.apply(methodDefinition.intrinsic, source, preparedArgs)
        // Dense observations retain only the placements selected by the native
        // mapping. Overwritten and removed inputs create no presence dependency.
        remap = methodDefinition.methodResult === undefined
            ? arrayRemaps.settleDenseRemap(result, invocationContext) : source
    }
    return internalSteps.continueOperation(
        remap,
        invocationContext.operationContext,
        remap =>
            runArrayStep(invocationContext, () => {
                if (errorUtils.isPoisonError(remap)) return remap
                return arrayRemaps.createArrayFromRemap(
                    remap,
                    invocationContext.operationContext,
                )
            }),
        undefined,
        invocationContext,
    )
}

function invokeArrayMutationMethod(
    methodDefinition,
    preparedArguments,
    invocationContext,
) {
    const thisValue = invocationContext.receiver
    if (methodDefinition.view) {
        const view = methodDefinition.view(
            preparedArguments,
            invocationContext,
        )
        if (view !== undefined) {
            return {
                mutatedValue: view,
                result: methodDefinition.methodResult(
                    methodDefinition.viewMethodResult(
                        view,
                        invocationContext,
                    ),
                    invocationContext,
                ),
            }
        }
    }

    if (methodDefinition.remap) {
        return internalSteps.continueOperation(
            methodDefinition.remap(preparedArguments, invocationContext),
            invocationContext.operationContext,
            remap =>
                runArrayStep(invocationContext, () => {
                    if (errorUtils.isPoisonError(remap)) return remap
                    return finishMutation(remap, captureResult(remap))
                }),
            undefined,
            invocationContext,
        )
    }

    const mutation = arrayRemaps.traceArrayMutation(
        thisValue,
        invocationContext.operationContext,
    )
    // The intrinsic and its remap traps are trusted work on prepared inputs.
    // Exact external reflection escapes to the operation's marker consumer.
    const nativeResult = Reflect.apply(
        methodDefinition.intrinsic,
        mutation.working,
        preparedArguments,
    )
    const result = captureResult(nativeResult)
    return finishMutation(runArrayStep(invocationContext, () => mutation.materialize()), result)

    function captureResult(nativeResult) {
        // Capture removed property versions before committing the receiver.
        return methodDefinition.methodResult === RETURN_RECEIVER
            ? undefined
            : methodDefinition.methodResult(
                nativeResult,
                invocationContext,
            )
    }

    function finishMutation(remap, result) {
        const mutatedValue = errorUtils.isPoisonError(remap) ? remap :
            runArrayStep(invocationContext, () => arrayRemaps.createArrayFromRemap(remap, invocationContext.operationContext))
        if (methodDefinition.methodResult === RETURN_RECEIVER) result = mutatedValue
        else if (errorUtils.isPoisonError(mutatedValue)) {
            // Publish receiver failure now; only the independent result waits.
            result = internalSteps.continueOperation(
                result,
                invocationContext.operationContext,
                value => errorUtils.isPoisonError(value)
                    ? errorUtils.combineErrors([mutatedValue, value], "Array mutation failed")
                    : mutatedValue,
                undefined,
                invocationContext,
            )
        }
        return { mutatedValue, result }
    }
}

function validateArrayOperation(args, { receiver, method, operationContext }) {
    const length = arrayViews.logicalArrayLength(receiver, operationContext)
    if (method === "with") {
        const index = args[0] ?? 0
        if (index < -length || index >= length) {
            return errorUtils.validationError(
                "Array index is out of range",
                operationContext,
                errorUtils.ERROR_KIND.InvalidArrayOperation,
            )
        }
    }
    let nextLength = length
    if (method === "push" || method === "unshift") nextLength += args.length
    else if (method === "splice" || method === "toSpliced") {
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

export { getArrayMethodDescription }
