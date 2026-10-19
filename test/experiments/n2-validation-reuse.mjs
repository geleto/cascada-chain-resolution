// Experimental loader only: evaluate pending-version reuse without changing
// production sources or the fresh-identity fallback.
// node --import ./test/experiments/n2-validation-reuse.mjs <test file>
import assert from "node:assert/strict"
import { registerHooks } from "node:module"

const inputURL = new URL("../../src/input-preparations.js", import.meta.url).href
const versionsURL = new URL("../../src/property-versions.js", import.meta.url).href
const coverageURL = new URL("./n2-validation-coverage.mjs", import.meta.url).href
registerHooks({ load(url, context, next) {
    const result = next(url, context)
    if (url === versionsURL) {
        const marker = "        version.value = placement.value"
        const source = String(result.source)
        assert.equal(source.split(marker).length, 2)
        return { ...result, source: source.replace(marker,
            "        delete version.n2ValidationCoverage\n" + marker) }
    }
    if (url !== inputURL) return result
    let source = String(result.source)
    source = `import { hasCoverage as n2Covered, addCoverage as n2AddCoverage } from ${JSON.stringify(coverageURL)}\n` + source
    for (const [marker, replacement] of [
        ["    failures,\n)", "    failures,\n    validation,\n)"],
        ["    const leases = createLeaseLedger(operationContext)",
            "    if (policy.methodResult) validation ??= { id: operationContext.execution.n2ValidationSequence = (operationContext.execution.n2ValidationSequence ?? 0) + 1, inputs: new WeakMap() }\n    const leases = createLeaseLedger(operationContext)"],
        ["                const placement = resultErrors", "                let placement = resultErrors"],
        ["                const child = placement.value\n                const borrowed = retentions.has(value) && policy.methodResult && languageValues.isPending(child, operationContext)\n                const sourceVersion = placement.sourceVersion\n                const version = propertyVersions.createVersionFromPlacement(placement)\n                const staged = { version, original: child, placement }",
            `                const child = placement.value
                const inputVersion = placement.sourceVersion
                const pendingValidation = !!validation && languageValues.isPending(child, operationContext)
                const ownOutput = pendingValidation && !!inputVersion && n2Covered(inputVersion.n2ValidationCoverage, validation.id)
                const cached = pendingValidation && !ownOutput && inputVersion && validation.inputs.get(inputVersion)
                const shared = cached && cached.inputValue === inputVersion.value &&
                    cached.publication === inputVersion.publication ? cached.output : undefined
                if (shared) placement = propertyVersions.capturePlacementFromVersion(shared)
                const validatedPending = ownOutput || !!shared
                const borrowed = !ownOutput && retentions.has(value) && policy.methodResult && pendingValidation
                const sourceVersion = placement.sourceVersion
                const version = propertyVersions.createVersionFromPlacement(placement)
                if (pendingValidation) {
                    const previous = sourceVersion?.n2ValidationCoverage
                    version.n2ValidationCoverage = validatedPending ? previous : n2AddCoverage(previous, validation.id)
                }
                const validationInput = pendingValidation && inputVersion && !validatedPending ? inputVersion : undefined
                const n2Output = validationInput ? propertyVersions.createVersionFromPlacement(placement) : undefined
                if (n2Output) {
                    n2Output.n2ValidationCoverage = version.n2ValidationCoverage
                    validation.inputs.set(validationInput, { output: n2Output,
                        inputValue: validationInput.value, publication: validationInput.publication })
                }
                const staged = { version, original: child, placement, validationInput, n2Output }`],
        ["        container.target = createEmptyContainer(source, operationContext)",
            "        container.target = createEmptyContainer(source, operationContext)\n        for (const staged of container.placements.values()) staged.n2Start?.()"],
        ["                if (sourceVersion?.transition) {",
            "                staged.n2OwnOutput = ownOutput\n                staged.n2Start = start\n                if (!ownOutput || container.target !== value) start()\n                function start() {\n                staged.n2Start = undefined\n                if (staged.placement.sourceVersion?.transition) {"],
        ["propertyVersions.resolvePlacementTransition(placement, operationContext, published => {",
            "propertyVersions.resolvePlacementTransition(staged.placement, operationContext, published => {"],
        ["                } else subscribe()\n                if (failure && !resultErrors) break",
            "                } else subscribe()\n                }\n                if (failure && !resultErrors) break"],
        ["        for (const [key, { version, original }] of placements) {",
            "        for (const [key, { version, original, n2OwnOutput, n2Output }] of placements) {\n            if (n2OwnOutput && target === source) continue"],
        ["            version.value = containers.get(version.value)?.target ?? version.value",
            "            version.value = containers.get(version.value)?.target ?? version.value\n            if (n2Output && !languageValues.isPending(version.value, operationContext)) propertyVersions.commitPromiseVersion(undefined, key, n2Output, propertyVersions.capturePlacementFromVersion(version), operationContext, false)"],
        ["                    const transition = version.transition = {}",
            "                    const transition = version.transition = {}\n                    const n2Transition = n2Output && (n2Output.transition = {})"],
        ["                        staged.placement = published",
            "                        staged.placement = published\n                        if (n2Output) {\n                            n2Output.present = published.present\n                            n2Output.recovery = published.recovery\n                            n2Output.position = published.position\n                            delete n2Output.pendingPresence\n                            delete n2Output.transition\n                            n2Transition.placement = propertyVersions.capturePlacementFromVersion(n2Output)\n                        }"],
        ["                    const pending = propertyVersions.trackVersionPublication(version, transition.promise, operationContext)",
            "                    if (n2Transition) n2Transition.promise = transition.promise\n                    if (n2Output) propertyVersions.trackVersionPublication(n2Output, transition.promise, operationContext)\n                    const pending = propertyVersions.trackVersionPublication(version, transition.promise, operationContext)"],
        ["                    const pending = propertyVersions.trackVersionPublication(version, publication, operationContext)",
            "                    if (n2Output) propertyVersions.trackVersionPublication(n2Output, publication, operationContext)\n                    const pending = propertyVersions.trackVersionPublication(version, publication, operationContext)"],
        ["                        const validated = languageProperties.validatePropertyValue(key, placement.value, operationContext)",
            "                        if (staged.validationInput && validation.inputs.get(staged.validationInput)?.output === n2Output) validation.inputs.delete(staged.validationInput)\n                        staged.validationInput = undefined\n                        const validated = languageProperties.validatePropertyValue(key, placement.value, operationContext)"],
        ["                staged.version.value = staged.version.recovery = undefined",
            "                if (staged.validationInput && validation.inputs.get(staged.validationInput)?.output === staged.n2Output) validation.inputs.delete(staged.validationInput)\n                staged.validationInput = undefined\n                staged.version.value = staged.version.recovery = undefined"],
        ["                            const child = walk(validated)",
            "                            const child = validatedPending ? validated : walk(validated)"],
        ["                            const prepared = prepareInput(validated, operationContext, policy)",
            "                            const prepared = validatedPending ? validated :\n                                prepareInput(validated, operationContext, policy, undefined, undefined, validation)"],
        ["                            propertyVersions.commitPromiseVersion(container.owner, key, version,",
            "                            if (n2Output) propertyVersions.commitPromiseVersion(undefined, key, n2Output, { ...placement, value: prepared }, operationContext, false)\n                            propertyVersions.commitPromiseVersion(container.owner, key, version,"],
    ]) {
        source = source.replaceAll("\r\n", "\n")
        assert.equal(source.split(marker).length, 2, `N2 candidate marker must occur once: ${marker}`)
        source = source.replace(marker, replacement)
    }
    return { ...result, source }
} })
