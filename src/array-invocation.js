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
        leaseReceiverThroughResult: !mutation &&
            methodDefinition.leaseReceiverThroughResult,
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
        const thisValue = invocationContext.receiver
        remap = arrayRemaps.createRemap(thisValue, invocationContext.operationContext)
        const result = Reflect.apply(
            methodDefinition.intrinsic,
            remap,
            preparedArgs,
        )
        // Mutators change the receiver remap; observations return one.
        if (methodDefinition.methodResult === undefined) remap = result
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
    const sourceSurvives = invocationContext.preserveReceiver ||
        arrayViews.requiresArrayMaterialization(
            thisValue,
            invocationContext.operationContext,
        )
    if (sourceSurvives && methodDefinition.view) {
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
                    sourceSurvives,
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
                    return finishMutation(
                        new arrayRemaps.ArrayMutation(
                            thisValue,
                            remap,
                            invocationContext.operationContext,
                        ),
                        remap,
                    )
                }),
            undefined,
            invocationContext,
        )
    }

    const mutation = arrayRemaps.ArrayMutation.trace(
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
    return finishMutation(mutation, nativeResult)

    function finishMutation(mutation, nativeResult) {
        const representationCopy = sourceSurvives
            ? false
            : mutation.requiresCopy()
        const copiesReceiver = sourceSurvives || representationCopy
        if (copiesReceiver) mutation.materialize()
        const returnsReceiver = methodDefinition.methodResult === RETURN_RECEIVER
        // Capture removed property versions before committing the receiver.
        let result = returnsReceiver
            ? undefined
            : methodDefinition.methodResult(
                nativeResult,
                sourceSurvives,
                invocationContext,
            )

        const mutatedValue = runArrayStep(invocationContext, () => {
            if (copiesReceiver) return arrayRemaps.createArrayFromRemap(
                mutation.remap,
                invocationContext.operationContext,
                undefined,
                sourceSurvives,
            )
            mutation.apply()
            return thisValue
        })
        if (returnsReceiver) result = mutatedValue
        else if (errorUtils.isPoisonError(mutatedValue)) {
            // Publish receiver failure now; only the independent result waits.
            result = internalSteps.collectInputs(
                [mutatedValue, result],
                invocationContext.operationContext,
                values => errorUtils.combineErrors(
                    values.filter(errorUtils.isPoisonError),
                    "Array mutation failed",
                ),
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
