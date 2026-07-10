const runtime = require("../../src")
const { setFatalErrorReporter } = require("../../src/error")

const reported = []
const unhandled = []

function suspendedRoot() {
    let resolve
    const promise = new Promise(settle => {
        resolve = settle
    })
    const root = {}
    Object.defineProperty(root, "hidden", {
        value: 0,
        enumerable: false,
        writable: true,
        configurable: true,
    })
    return { chain: new runtime.Chain(promise), resolve, root }
}

setFatalErrorReporter(error => {
    reported.push(error)
})
process.on("unhandledRejection", error => {
    unhandled.push(error)
})

const assigned = suspendedRoot()
const deleted = suspendedRoot()
const assignResult = runtime.assignPath(assigned.chain, ["hidden"], 1)
const deleteResult = runtime.deletePath(deleted.chain, ["hidden"])
assigned.resolve(assigned.root)
deleted.resolve(deleted.root)

setImmediate(() => {
    process.stdout.write(JSON.stringify({
        returnsUndefined: assignResult === undefined && deleteResult === undefined,
        reportCount: reported.length,
        unhandledCount: unhandled.length,
        sameErrors: reported.every(error => unhandled.includes(error)),
        messages: reported.map(error => error.message),
        valuesUnchanged: assigned.root.hidden === 0 && deleted.root.hidden === 0,
    }))
})
