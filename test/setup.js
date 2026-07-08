const expect = require("expect.js")

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
        expect(reasons).to.eql([])
    },

    afterAll() {
        process.removeListener("unhandledRejection", onUnhandledRejection)
    },
}
