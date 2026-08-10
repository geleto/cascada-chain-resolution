import * as errorUtils from "./error.js"
import { exportArgument } from "./observations.js"
import * as resolution from "./resolution.js"

function invokeDataFunction(callable, thisValue, args) {
    return errorUtils.runUserCode(
        () => Reflect.apply(callable, thisValue, args),
    )
}

function findPropertyDescriptor(object, key) {
    let owner = object
    while (owner !== null) {
        const descriptor = errorUtils.runUserCode(
            () => Object.getOwnPropertyDescriptor(owner, key),
        )
        if (descriptor) return { descriptor, owner }
        owner = errorUtils.runUserCode(
            () => Object.getPrototypeOf(owner),
        )
    }
    return undefined
}

function invokeObservationMethodWithExportedArgs(
    callable,
    thisValue,
    args,
) {
    return resolution.continueOperationsUnlessPoison(
        args.map(exportArgument),
        preparedArgs => resolution.resolveInitialValueOrPoison(
            invokeDataFunction(
                callable,
                thisValue,
                preparedArgs,
            ),
        ),
    )
}

export {
    findPropertyDescriptor,
    invokeDataFunction,
    invokeObservationMethodWithExportedArgs,
}
