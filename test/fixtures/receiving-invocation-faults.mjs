// These in-memory source substitutions exercise supported programs and the
// independent assertions. They are distinct from the safeguard registry's
// complete caller audit and do not change source files on disk.
const receipt = name => `console.error("receiving differential fault executed: ${name}")`
export const receivingFaults = [
    { name: "value", assertion: /\["(?:left|right)"\]\["k"\]: exact leaf/, edit: {
        file: "src/property-versions.js",
        find: "function prepareInputPlacement(value, operationContext, kind, contextSetup) {",
        replace: `function prepareInputPlacement(value, operationContext, kind, contextSetup) {
            if (operationContext.errorContext === "path write") {
                ${receipt("value")}; value++
            }`,
    } },
    { name: "alias", assertion: /preserve aliases and cycles/, edit: {
        file: "src/captured-graph.js",
        find: "defineCopyProperty(node.copy, key, outputOf(node.entries.get(key)))",
        replace: `defineCopyProperty(node.copy, key,
            key === "right" && capture.owner.operationContext.errorContext === "before native mutation"
                ? (${receipt("alias")}, { ...outputOf(node.entries.get(key)) }) : outputOf(node.entries.get(key)))`,
    } },
    { name: "poison", assertion: /complete exact poison membership/, edit: {
        file: "src/error.js",
        find: "const leaves = flattenAndDeduplicateErrors(inputs)",
        replace: `const leaves = flattenAndDeduplicateErrors(inputs)
    if (leaves.length > 1 && leaves.every(leaf => leaf.errorContext === "receive failures")) {
        ${receipt("poison")}; leaves.pop()
    }`,
    } },
    { name: "effect", assertion: /\["total"\]: exact leaf/, edit: {
        file: "src/managed-invocation.js",
        find: "result = invocation.invokeFunction(callable, receiver, args, operationContext)",
        replace: `const previousTotal = receiver.total
        result = invocation.invokeFunction(callable, receiver, args, operationContext)
        if (operationContext.errorContext === "native mutation") {
            ${receipt("effect")}; receiver.total = previousTotal
        }`,
    } },
    { name: "completion", assertion: /export completion includes captured graph availability/, edit: {
        file: "src/export.js",
        find: "    return result\n\n    function collect(error)",
        replace: `    if (operationContext.errorContext === "before native mutation" && values.isPending(result, operationContext)) {
        ${receipt("completion")}; return {}
    }
    return result

    function collect(error)`,
    } },
]
