import * as errorUtils from "./error.js"
import { exportArgument } from "./observations.js"
import * as resolution from "./resolution.js"

function invokeDataFunctionOrPoison(callable, thisValue, args) {
    try {
        return Reflect.apply(callable, thisValue, args)
    } catch (error) {
        return errorUtils.toPoison(error)
    }
}

function findPropertyDescriptor(object, key) {
    try {
        let owner = object
        while (owner !== null) {
            const descriptor = Object.getOwnPropertyDescriptor(owner, key)
            if (descriptor) return { descriptor, owner }
            owner = Object.getPrototypeOf(owner)
        }
        return undefined
    } catch (error) {
        return errorUtils.toPoison(error)
    }
}

function invokeObservationMethodWithExportedArgs(
    callable,
    thisValue,
    args,
    validatePreparedArguments,
) {
    return resolution.continueOperationsUnlessPoison(
        args.map(exportArgument),
        preparedArgs => {
            const error = validatePreparedArguments?.(preparedArgs)
            if (error) return error
            return resolution.resolveInitialValueOrPoison(
                invokeDataFunctionOrPoison(
                    callable,
                    thisValue,
                    preparedArgs,
                ),
            )
        },
    )
}

export {
    findPropertyDescriptor,
    invokeDataFunctionOrPoison,
    invokeObservationMethodWithExportedArgs,
}
