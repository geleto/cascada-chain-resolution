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
                return mutation
                    ? invokeArrayMutationMethod(
                        methodDefinition,
                        preparedArguments,
                        invocationWork,
                    )
                    : invokeArrayObservationMethod(
                        methodDefinition,
                        preparedArguments,
                        invocationWork,
                    )
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

// view, observe, remap, and intrinsic fallback are distinct because each avoids
// progressively more representation work.
function invokeArrayObservationMethod(
    methodDefinition,
    preparedArgs,
    invocationWork,
) {
    if (methodDefinition.view) {
        const view = methodDefinition.view(preparedArgs, invocationWork)
        if (view !== undefined) return view
    }
    if (methodDefinition.observe) {
        return methodDefinition.observe(preparedArgs, invocationWork)
    }

    let remap
    if (methodDefinition.remap) {
        remap = methodDefinition.remap(preparedArgs, invocationWork)
    } else {
        const source = arrayRemaps.createRemap(invocationWork.receiver, invocationWork.operationContext, 0, invocationWork.arrayLength)
        const result = Reflect.apply(methodDefinition.intrinsic, source, preparedArgs)
        // Dense observations retain only the placements selected by the native
        // mapping. Overwritten and removed inputs create no presence dependency.
        remap = methodDefinition.methodResult === undefined
            ? arrayRemaps.resolveDenseRemapPresence(result, invocationWork) : source
    }
    return internalSteps.continueOperation(
        remap,
        invocationWork.operationContext,
        remap =>
            runArrayStep(invocationWork, () => {
                if (errorUtils.isPoisonError(remap)) return remap
                return arrayRemaps.createArrayFromRemap(
                    remap,
                    invocationWork.operationContext,
                )
            }),
        undefined,
        invocationWork,
    )
}

function invokeArrayMutationMethod(
    methodDefinition,
    preparedArguments,
    invocationWork,
) {
    // Remaps and derived views publish independent placements. Retained entries
    // carry their captured transitions; removed entries cannot write into the
    // new receiver. Only consumed shape or values require waiting.
    const thisValue = invocationWork.receiver
    if (methodDefinition.view) {
        const view = methodDefinition.view(
            preparedArguments,
            invocationWork,
        )
        if (view !== undefined) {
            return {
                mutatedValue: view,
                result: methodDefinition.methodResult(
                    methodDefinition.viewNativeResult(
                        view,
                        invocationWork,
                    ),
                    invocationWork,
                ),
            }
        }
    }

    if (methodDefinition.remap) {
        return internalSteps.continueOperation(
            methodDefinition.remap(preparedArguments, invocationWork),
            invocationWork.operationContext,
            remap =>
                runArrayStep(invocationWork, () => {
                    if (errorUtils.isPoisonError(remap)) return remap
                    return finishMutation(remap, captureResult(remap))
                }),
            undefined,
            invocationWork,
        )
    }

    const mutation = arrayRemaps.traceArrayMutation(
        thisValue,
        invocationWork.operationContext,
        invocationWork.arrayLength,
    )
    // The intrinsic and its remap traps are trusted work on prepared inputs.
    // Exact external reflection escapes to the operation's marker consumer.
    const nativeResult = Reflect.apply(
        methodDefinition.intrinsic,
        mutation.working,
        preparedArguments,
    )
    const result = captureResult(nativeResult)
    return finishMutation(runArrayStep(invocationWork, () => mutation.materialize()), result)

    function captureResult(nativeResult) {
        // Capture removed property versions before committing the receiver.
        return methodDefinition.methodResult === RETURN_RECEIVER
            ? undefined
            : methodDefinition.methodResult(
                nativeResult,
                invocationWork,
            )
    }

    function finishMutation(remap, result) {
        const mutatedValue = errorUtils.isPoisonError(remap) ? remap :
            runArrayStep(invocationWork, () => arrayRemaps.createArrayFromRemap(remap, invocationWork.operationContext))
        if (methodDefinition.methodResult === RETURN_RECEIVER) result = mutatedValue
        else if (errorUtils.isPoisonError(mutatedValue)) {
            // Publish receiver failure now; only the independent result waits.
            result = internalSteps.continueOperation(
                result,
                invocationWork.operationContext,
                value => errorUtils.isPoisonError(value)
                    ? errorUtils.combineErrors([mutatedValue, value], "Array mutation failed")
                    : mutatedValue,
                undefined,
                invocationWork,
            )
        }
        return { mutatedValue, result }
    }
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
