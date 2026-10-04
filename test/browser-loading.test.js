import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

describe("portable module loading in a Node VM", () => {
    it("loads through relative imports without consulting a host's process global", () => {
        const sourceRoot = new URL("../src/", import.meta.url).href
        const result = spawnSync(process.execPath,
            ["--experimental-vm-modules", "--unhandled-rejections=strict", "--input-type=module", "-e", `
                import assert from "node:assert/strict"
                import { readdir, readFile } from "node:fs/promises"
                import { createContext, SourceTextModule } from "node:vm"
                const root = new URL(${JSON.stringify(sourceRoot)})
                const globals = { queueMicrotask }
                let nodeGlobalReads = 0
                Object.defineProperty(globals, "process", { get() {
                    nodeGlobalReads++
                    throw new Error("The runtime must not consult a Node-specific global")
                } })
                const context = createContext(globals)
                const modules = new Map()
                for (const file of await readdir(root)) {
                    if (!file.endsWith(".js")) continue
                    const url = new URL(file, root)
                    modules.set(url.href, new SourceTextModule(await readFile(url, "utf8"),
                        { context, identifier: url.href }))
                }
                const entry = modules.get(new URL("index.js", root).href)
                await entry.link((specifier, parent) => {
                    assert(specifier.startsWith("."), "Browser loading requires relative imports: " + specifier)
                    return modules.get(new URL(specifier, parent.identifier).href)
                })
                await entry.evaluate()
                const r = entry.namespace
                const ctx = { execution: new r.Execution(), errorContext: "browser join" }
                const source = ["a", , "b"]
                const chain = new r.Chain(r.import(source, ctx), ctx)
                assert.equal(r.run(chain, [], "join", ["|"], ctx, {}), "a||b")
                assert.equal(ctx.execution.fatalError, null)
                for (const pending of [false, true]) {
                    const reports = [], execution = new r.Execution(error => reports.push(error))
                    const operation = { execution, errorContext: { pending, browser: true } }
                    const signal = pending ? Promise.withResolvers() : undefined
                    const sparse = new Array(2 ** 30)
                    const receiver = new r.Chain(r.import(signal?.promise ?? sparse, operation), operation)
                    const result = r.run(receiver, [], "join", [], operation, {})
                    assert.equal(typeof result?.then === "function", pending)
                    signal?.resolve(sparse)
                    const failure = await result
                    assert(r.isPoisonError(failure))
                    assert.equal(failure.kind, r.ERROR_KIND.ScalarConversionFailed)
                    assert.equal(failure.errorContext, operation.errorContext)
                    assert.equal(failure.cause.name, "RangeError")
                    assert.equal(execution.fatalError, null)
                    assert.deepEqual(reports, [])
                    assert.equal(r.lookupPath(receiver, ["length"], operation), sparse.length)
                    assert.equal(r.import(3, operation), 3)
                }
                assert.equal(nodeGlobalReads, 0, "The runtime must use only standard JavaScript APIs")
            `], { encoding: "utf8", timeout: 10000 })
        assert.equal(result.status, 0, result.stdout + result.stderr)
    })
})
