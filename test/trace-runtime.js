import { registerHooks } from "node:module"
import * as trace from "./trace-state.js"

const sourceRoot = new URL("../src/", import.meta.url).href
const stateURL = new URL("./trace-state.js", import.meta.url).href
const functions = {
    "input-preparations.js": ["prepareInput", "commitPreparedInput"],
    "error.js": ["runExternalAction"],
    "thenable-subscription.js": ["runSubscription"],
    "property-versions.js": ["replacePlacement", "commitPlacementVersion", "commitPromiseVersion",
        "installPlacementGate", "installMutationVersion", "copyPlacement", "normalizeRawPropertyValue", "installPlacementVersion", "detachPlacementVersion"],
    "language-properties.js": ["writeLanguageProperty", "deleteLanguageProperty"],
    "mutations.js": ["shallowCopyPathContainer"],
    "array-remap.js": ["createArrayFromRemap", "createRemap"],
    "placement-structure.js": ["defineCopyProperty", "createEmptyContainer"],
    "export.js": ["exportValues"],
    "managed-invocation.js": ["copyCompleteGraph", "validateReceiver"],
    "external-snapshot.js": ["snapshotExternalValue"],
    "language-values.js": ["isPending"],
    "meta.js": ["getOrCreateMeta"],
}

trace.enable()
registerHooks({
    load(url, context, nextLoad) {
        const loaded = nextLoad(url, context)
        const names = url.startsWith(sourceRoot) && functions[url.slice(sourceRoot.length)]
        if (!names) return loaded
        let source = String(loaded.source)
        // Export destinations are detached outputs, including writes made by
        // later traversal callbacks after exportValues has returned.
        if (url.endsWith("/export.js"))
            source = source.replaceAll("defineCopyProperty(", "publicationTrace.exportCopy(defineCopyProperty, ")
        for (const name of names) {
            const declaration = `function ${name}(`
            if (!source.includes(declaration)) throw new Error(`Missing traced function ${name}`)
            source = source.replace(declaration, `function ${name}Untraced(`)
            if (name === "createEmptyContainer") {
                source += `\nfunction createEmptyContainer(...args) {
                    const result = createEmptyContainerUntraced(...args);
                    publicationTrace.allocated(result);
                    return result;
                }\n`
            } else if (name === "isPending") {
                source += `\nfunction isPending(...args) { publicationTrace.count("isPending"); return isPendingUntraced(...args) }\n`
            } else if (name === "getOrCreateMeta") {
                source += `\nfunction getOrCreateMeta(...args) {
                    const before = args[1]?.execution?._metadata.get(args[0]);
                    const result = getOrCreateMetaUntraced(...args);
                    if (!before && isTraversableType(result.type))
                        publicationTrace.admission(args[0], args[1]);
                    return result;
                }\n`
            } else if (process.env.CASCADA_TRACE_OMIT_BOUNDARY === name) {
                source += `\nfunction ${name}(...args) { return ${name}Untraced(...args) }\n`
            } else {
                source += `\nfunction ${name}(...args) {
                    publicationTrace.enter(${JSON.stringify(name)}, args);
                    try { return ${name}Untraced(...args) } finally { publicationTrace.leave() }
                }\n`
            }
        }
        return { ...loaded, source: `import * as publicationTrace from ${JSON.stringify(stateURL)};\n${source}` }
    },
})
