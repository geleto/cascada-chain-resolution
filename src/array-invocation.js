import { createMutationOutcome } from "./mutations.js"
import { ArrayView } from "./array-view.js"
import * as internalSteps from "./internal-step.js"
import * as arrayRemaps from "./array-remap.js"
import * as errorUtils from "./error.js"
import {
    ARRAY_METHODS,
    RETURN_RECEIVER,
    PASS_AS_PAYLOAD,
    runArrayStep,
    toRelativeIndex,
    searchFromIndex,
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
        prepareArguments: () => runArrayStep(invocationWork, () => internalSteps.continueGraphTransition(
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
        // No placement can receive an empty fill's payload. Stop its pending
        // root preparation before successful invocation transfers other inputs.
        if (work.method === "fill" &&
            toRelativeIndex(args[1], length, 0) >= toRelativeIndex(args[2], length, length)) {
            work.discardArgument(0)
        }
        return args
    })
}

function prepareArrayMethodArguments(methodDefinition, invocationWork) {
    const { args } = invocationWork
    const inputs = methodDefinition.inputs ?? []
    const count = inputs[1] === searchFromIndex && ArrayView.readyLength(invocationWork.receiver, invocationWork.operationContext) === 0
        ? 1 : methodDefinition.restInput ? args.length : inputs.length
    invocationWork.prepareArgumentFrontier(count)
    // The prepared length preserves omission and every remaining argument.
    const prepared = new Array(methodDefinition.restInput
        ? args.length
        : Math.min(inputs.length, args.length))
    const readiness = []
    for (let index = 0; index < prepared.length; index++) {
        const input = inputs[index] ?? methodDefinition.restInput
        if (input === PASS_AS_PAYLOAD) {
            prepared[index] = args[index]
            continue
        }
        const result = input(args[index], invocationWork)
        // Scalar, identity and executable conversion capture their source on
        // reception. Concat retains payloads; a search bound first awaits shape.
        if (methodDefinition !== ARRAY_METHODS.concat && input !== searchFromIndex)
            invocationWork.releaseArgument(index)
        readiness.push(
            internalSteps.continueGraphTransition(
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
    return internalSteps.prepareInputs(
        readiness,
        invocationWork.operationContext,
        () => methodDefinition.prepare ? methodDefinition.prepare(prepared, invocationWork) : prepared,
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
        if (view !== undefined) {
            if (!mutation) return invocationWork.retainOutput(view)
            // Publication already owns the view when consuming the independent
            // removed element may remain pending or fail during capture.
            const outcome = createMutationOutcome(view, undefined, operationContext)
            try {
                outcome.result = methodDefinition.methodResult(
                    methodDefinition.viewNativeResult(view, invocationWork), invocationWork)
                return outcome
            } catch (failure) {
                outcome.releasePublication()
                throw failure
            }
        }
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
    return internalSteps.continueGraphTransition(remap, operationContext,
        remap => runArrayStep(invocationWork, () => {
            if (errorUtils.isPoisonError(remap)) return remap
            // Only intrinsic mutators have a separate native result. Capture
            // removed placements before materializing the new receiver.
            let result = mutation && methodDefinition.methodResult !== RETURN_RECEIVER
                ? methodDefinition.methodResult(nativeResult, invocationWork) : undefined
            const output = runArrayStep(invocationWork, () =>
                arrayRemaps.createArrayFromRemap(remap, operationContext))
            if (!mutation) return invocationWork.retainOutput(output)
            if (methodDefinition.methodResult === RETURN_RECEIVER) result = invocationWork.retainOutput(output)
            else if (errorUtils.isPoisonError(output)) {
                // Publish receiver failure now; only the independent result waits.
                result = internalSteps.continueGraphTransition(result, operationContext,
                    value => errorUtils.isPoisonError(value)
                        ? errorUtils.combineErrors([output, value], "Array mutation failed") : output,
                    undefined, invocationWork)
            }
            return createMutationOutcome(output, result, operationContext)
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
