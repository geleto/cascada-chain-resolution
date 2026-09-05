import { resetTestExecution } from "./support.js"

export const mochaHooks = {
    beforeEach() {
        resetTestExecution()
    },
}
