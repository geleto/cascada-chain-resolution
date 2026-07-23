import expect from "expect.js"
import { setFatalErrorReporter } from "../src/error.js"

const unhandledRejections = []

function onUnhandledRejection(reason) {
    unhandledRejections.push(reason)
}

export const mochaHooks = {
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
