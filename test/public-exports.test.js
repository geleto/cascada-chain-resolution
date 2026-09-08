import { readFileSync } from "node:fs"

import { expect } from "./support.js"

const exportsByRole = {
    "execution operation": [
        "assignPath", "deletePath", "enter", "export", "getErrors",
        "hasError", "import", "importMethodResult", "lookupPath", "lookupPathForExpression", "run",
    ],
    construction: ["Chain", "ContextChain"],
    "contextless configuration": [
        "externalState", "managedState", "managedStateClass",
    ],
    configuration: ["Execution"],
    recognition: ["isFatalError", "isPoisonError", "isPoisonedValue", "isPending"],
    "Error factories": ["createPoisonError", "validationError", "combineErrors", "createPoisonedValue"],
    "guarded composition": ["runInternalStep", "continueOperation", "runExternalBoundary", "failExecution", "returnOperationResult"],
    "Error data": [
        "CompoundPoisonError",
        "ERROR_KIND",
        "PoisonError",
        "FatalError",
    ],
}

const packageManifest = JSON.parse(readFileSync(
    new URL("../package.json", import.meta.url),
))

describe("public exports", () => {
    it("classifies every package entrypoint and export", async () => {
        expect(packageManifest.exports).to.eql({ ".": "./src/index.js" })
        const runtime = await import("cascada-chain-resolution")
        expect(Object.keys(runtime).sort()).to.eql(
            Object.values(exportsByRole).flat().sort(),
        )
    })
})
