import * as runtime from "../../src/index.js"

const reported = []
const unhandled = []

function pendingProperty(changeDescriptor, settledValue = "settled") {
    let resolve
    const promise = new Promise(settle => {
        resolve = settle
    })
    const root = {}
    const operationContext = {
        execution: new runtime.Execution(error => reported.push(error)),
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
        messages: reported.map(error => error.message),
    }))
})
