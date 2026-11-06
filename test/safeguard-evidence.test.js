import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { classifySafeguard, witnessFaultReceipts } from "./safeguards/evidence.mjs"

describe("safeguard evidence classification", () => {
    const entry = { witnesses: ["checks publication"] }
    const baseline = { completed: true, instrumented: true }
    const failing = message => ({ ...baseline, failures: [{ fullTitle: "checks publication", err: { message } }] })

    for (const message of ["Timeout of 30000ms exceeded", "spawnSync node ETIMEDOUT",
        "SyntaxError: Unexpected token '}'", "Error [ERR_MODULE_NOT_FOUND]: missing fixture",
        "Safeguard fault no longer matches src/property-versions.js",
        "AssertionError [ERR_ASSERTION]: Runtime counter anchor: file:///C:/src/placement-structure.js: prepare(placement) {",
        "AssertionError [ERR_ASSERTION]: Runtime counter anchor: file:///C:/src/array-view.js: /(yield |keys\\.push\\()String\\(index(?: - offset)?\\)/g"]) {
        it(`does not count a named witness's infrastructure failure: ${message}`, () => {
            assert.equal(classifySafeguard(entry, failing(message)).status, "inconclusive")
        })
    }
    it("requires a loaded fault and an actual named assertion failure", () => {
        const result = failing("AssertionError: expected immutable earlier result")
        assert.equal(classifySafeguard(entry, result).status, "witnessed")
        assert.equal(classifySafeguard(entry, { ...result, instrumented: false }).status, "uninstrumented")
        assert.equal(classifySafeguard(entry, { ...baseline, failures: [] }).status, "lost")
    })
    it("reads child receipts from the actual json-stream string Error shape", () => {
        const receipt = { pid: 4652, edit: 0, file: "src/managed-invocation.js" }
        const message = `[cascada-safeguard] ${JSON.stringify(receipt)}\nAssertionError: expected release`
        assert.deepEqual(witnessFaultReceipts({ err: message, stack: message }), [receipt])
        assert.deepEqual(witnessFaultReceipts({ err: { message, stack: message } }), [receipt])
        assert.deepEqual(witnessFaultReceipts({ err: "AssertionError: expected release" }), [])
        assert.equal(classifySafeguard(entry, { ...baseline,
            failures: [{ fullTitle: "checks publication", err: "child failed", stack: "SyntaxError: Unexpected token" }] }).status,
        "inconclusive")
    })
})

describe("safeguard runner configuration", function () {
    this.timeout(15000)
    for (const parallel of ["0", "-1", "0.5", "Infinity", "bogus", "1=garbage"]) {
        it(`rejects an invalid worker count: ${parallel}`, () => {
            const result = spawnSync(process.execPath, ["test/safeguards/run.mjs",
                "--skip-baseline", `--parallel=${parallel}`], {
                cwd: fileURLToPath(new URL("../", import.meta.url)),
                encoding: "utf8", timeout: 10000, windowsHide: true,
            })
            assert.ifError(result.error)
            assert.notEqual(result.status, 0, "An empty safeguard run must not report success")
            assert.match(result.stderr, /--parallel must be a positive safe integer/)
        })
    }

    it("rejects a baseline process failure after its reporter emitted end", () => {
        const hook = `import { registerHooks } from 'node:module';
            registerHooks({ load(url, context, next) {
                const loaded = next(url, context);
                if (!url.endsWith('/node_modules/mocha/bin/mocha.js')) return loaded;
                return { ...loaded, source: 'console.log(JSON.stringify(["end", {}])); process.exitCode = 1;' };
            } });`
        const loader = `data:text/javascript,${encodeURIComponent(hook)}`
        const result = spawnSync(process.execPath, ["test/safeguards/run.mjs", "--parallel=1",
            "entry-preserves-ancestor-provenance"], {
            cwd: fileURLToPath(new URL("../", import.meta.url)),
            env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${loader}` },
            encoding: "utf8", timeout: 10000, windowsHide: true,
        })
        assert.ifError(result.error)
        assert.equal(result.status, 2, result.stdout + result.stderr)
        assert.match(result.stderr, /Baseline suite is not clean/)
        assert.equal(result.stdout, "", "No fault runs may follow a failed baseline")
    })
})
