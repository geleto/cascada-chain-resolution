const runtime = require("../../src")
const { setFatalErrorReporter } = require("../../src/error")

let resolveRoot
const pendingRoot = new Promise(resolve => {
    resolveRoot = resolve
})
const chain = new runtime.Chain(pendingRoot)
const root = {}
const reported = []
const unhandled = []

Object.defineProperty(root, "hidden", {
    value: 0,
    enumerable: false,
    writable: true,
    configurable: true,
})
setFatalErrorReporter(error => {
    reported.push(error)
})
process.on("unhandledRejection", error => {
    unhandled.push(error)
})

const result = runtime.assignPath(chain, ["hidden"], 1)
resolveRoot(root)

setImmediate(() => {
    process.stdout.write(JSON.stringify({
        returnsUndefined: result === undefined,
        reportCount: reported.length,
        unhandledCount: unhandled.length,
        sameError: reported[0] === unhandled[0],
        message: reported[0]?.message,
        valueUnchanged: root.hidden === 0,
    }))
})
