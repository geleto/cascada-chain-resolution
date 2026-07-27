import * as runtime from "../../src/index.js"
import { setFatalErrorReporter } from "../../src/error.js"

const reported = []
const unhandled = []

function pendingProperty(changeDescriptor) {
    let resolve
    const promise = new Promise(settle => {
        resolve = settle
    })
    const root = {}
    runtime.assignPath(new runtime.Chain(root), ["value"], promise)
    changeDescriptor(root)
    resolve("settled")
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

setImmediate(() => {
    process.stdout.write(JSON.stringify({
        reportCount: reported.length,
        unhandledCount: unhandled.length,
        sameErrors: reported.every(error => unhandled.includes(error)),
        messages: reported.map(error => error.message),
    }))
})
