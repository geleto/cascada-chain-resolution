const expect = require("expect.js")
const { setFatalErrorReporter } = require("../src/error")

const unhandledRejections = []

function onUnhandledRejection(reason) {
    unhandledRejections.push(reason)
}

exports.mochaHooks = {
    beforeAll() {
        process.on("unhandledRejection", onUnhandledRejection)
    },

    async afterEach() {
        await new Promise(resolve => setImmediate(resolve))
        const reasons = unhandledRejections.splice(0)
        setFatalErrorReporter()

        expect(reasons).to.eql([])
    },

    afterAll() {
        process.removeListener("unhandledRejection", onUnhandledRejection)
    },
}
