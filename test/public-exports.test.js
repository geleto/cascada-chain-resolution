import { readFileSync } from "node:fs"

import { expect } from "./support.js"

const exportsByEntry = {
    ".": {
        "execution operation": [
            "assignPath", "deletePath", "enter", "export", "getErrors",
            "hasError", "import", "lookupPath", "run",
        ],
        construction: ["Chain", "ContextChain"],
        "contextless configuration": [
            "externalState", "managedState", "managedStateClass",
        ],
        configuration: ["Execution"],
        recognition: ["isFatalError", "isPoisonError"],
        "Error data": [
            "CompoundPoisonError",
            "ERROR_KIND",
            "PoisonError",
            "FatalError",
        ],
    },
}

exportsByEntry["./integration"] = {
    ...exportsByEntry["."],
    "trusted composition": [
        "importMethodResult",
        "createPoisonError",
        "validationError",
        "combineErrors",
        "failExecution",
        "runExternalBoundary",
        "runInternalStep",
        "continueOperation",
        "isPending",
        "returnOperationResult",
    ],
}

const packageManifest = JSON.parse(readFileSync(
    new URL("../package.json", import.meta.url),
))
const packageRoot = new URL("../", import.meta.url)

describe("public exports", () => {
    it("classifies every package entrypoint and export", async () => {
        expect(Object.keys(packageManifest.exports).sort()).to.eql(
            Object.keys(exportsByEntry).sort(),
        )
        for (const [entry, exportsByRole] of Object.entries(exportsByEntry)) {
            const target = packageManifest.exports[entry]
            const runtime = await import(new URL(target, packageRoot))
            expect(Object.keys(runtime).sort()).to.eql(
                Object.values(exportsByRole).flat().sort(),
            )
        }
    })
})
