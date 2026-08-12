import * as errorUtils from "./error.js"
import { exportArgument } from "./observations.js"
import * as resolution from "./resolution.js"

function invokeDataFunction(callable, thisValue, args) {
    return errorUtils.runUserCode(
        () => Reflect.apply(callable, thisValue, args),
    )
}

function findPropertyDescriptor(object, key) {
    // Walking a host prototype chain can invoke Proxy reflection traps.
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
    return resolution.continuePreparedValuesUnlessPoison(
        args.map(exportArgument),
        preparedArgs => invokeDataFunction(
            callable,
            thisValue,
            preparedArgs,
        ),
    )
}

export {
    findPropertyDescriptor,
    invokeDataFunction,
    invokeObservationMethodWithExportedArgs,
}
