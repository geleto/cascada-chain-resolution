import { registerHooks } from "node:module"
import * as trace from "./trace-state.js"

const sourceRoot = new URL("../src/", import.meta.url).href
const stateURL = new URL("./trace-state.js", import.meta.url).href
const functions = {
    "input-preparations.js": ["prepareInput", "commitPreparedInput"],
    "error.js": ["runExternalAction"],
    "property-versions.js": ["replacePlacement", "commitPlacementVersion", "commitPromiseVersion",
        "installPlacementGate", "installMutationVersion", "detachAbsentVersion", "copyPlacement", "installPlacementVersion", "detachPlacementVersion"],
    "language-properties.js": ["writeLanguageProperty", "deleteLanguageProperty", "readLanguagePlacement"],
    "mutations.js": ["shallowCopyPathContainer"],
    "array-remap.js": ["createArrayFromRemap", "createRemap"],
    "placement-structure.js": ["defineCopyProperty", "createEmptyContainer"],
    "export.js": ["exportValues"],
    "captured-graph.js": ["assembleCapturedGraph"],
    "managed-invocation.js": ["validateReceiver"],
    "external-snapshot.js": ["snapshotExternalValue"],
    "language-values.js": ["isPending", "thenValue"],
}

trace.enable()
registerHooks({
    load(url, context, nextLoad) {
        const loaded = nextLoad(url, context)
        const names = url.startsWith(sourceRoot) && functions[url.slice(sourceRoot.length)]
        if (!names) return loaded
        let source = String(loaded.source)
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
            } else if (name === "readLanguagePlacement") {
                source += `\nfunction readLanguagePlacement(...args) {
                    const result = readLanguagePlacementUntraced(...args);
                    if (!result.sourceVersion && !errorUtils.isPoisonError(result.value) && metadata.isObjectLike(result.value) &&
                        !metadata.metaOf(result.value, args[2]))
                        throw new Error("Ordinary read reached an unprepared child");
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
