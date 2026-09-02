import * as runtime from "../../src/index.js"
import { setFatalErrorReporter } from "../../src/error.js"

const reported = []
const unhandled = []

function pendingProperty(changeDescriptor, settledValue = "settled") {
    let resolve
    const promise = new Promise(settle => {
        resolve = settle
    })
    const root = {}
    const operationContext = {
        execution: new runtime.Execution(),
        errorContext: "fixture",
    }
    runtime.assignPath(
        new runtime.Chain(root, operationContext),
        ["value"],
        promise,
        operationContext,
    )
    changeDescriptor(root)
    resolve(typeof settledValue === "function"
        ? settledValue(operationContext)
        : settledValue)
    return root
}

setFatalErrorReporter(error => {
    reported.push(error)
})
process.on("unhandledRejection", error => {
    unhandled.push(error)
})

const descriptorChanges = [
    root => {
        delete root.value
    },
    root => {
        Object.defineProperty(root, "value", {
            value: root.value,
            enumerable: false,
            writable: true,
            configurable: true,
        })
    },
    root => {
        Object.defineProperty(root, "value", {
            get: () => "host value",
            enumerable: true,
            configurable: true,
        })
    },
    root => {
        Object.defineProperty(root, "value", {
            value: root.value,
            enumerable: true,
            writable: false,
            configurable: true,
        })
    },
]
for (const changeDescriptor of descriptorChanges) {
    pendingProperty(changeDescriptor)
}
pendingProperty(
    descriptorChanges[3],
    operationContext => runtime.import({}, operationContext),
)

setImmediate(() => {
    process.stdout.write(JSON.stringify({
        reportCount: reported.length,
        unhandledCount: unhandled.length,
        sameErrors: reported.every(error => unhandled.includes(error)),
        messages: reported.map(error => error.message),
    }))
})
