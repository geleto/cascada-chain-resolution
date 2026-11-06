import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { normalizeModuleURL } from "./module-url.js"

const trace = new URL("./trace-runtime.js", import.meta.url).href
const fault = new URL("./safeguards/fault-hook.mjs", import.meta.url).href
const source = `
    import assert from 'node:assert/strict';
    import * as r from './src/index.js';
    import * as trace from './test/trace-state.js';
    const ctx = { execution: new r.Execution(), errorContext: 'loader sensitivity' };
    const actual = r.import(7, ctx);
    assert(trace.counts().prepareInput > 0, 'runtime-worker-trace-receipt');
    assert.equal(actual, 7, 'runtime-value-witness');
`
const anchor = "if (!metadata.isObjectLike(root)) return root"

function run(loaders, replacement, script = source, extraEnv) {
    const env = { ...process.env, ...extraEnv, CASCADA_SAFEGUARD_RECEIPTS: "1",
        CASCADA_SAFEGUARD_FAULT: JSON.stringify([{
            file: "src/input-preparations.js", find: anchor, replace: replacement,
        }]) }
    // Each child deliberately tests its named loader composition, independently
    // of a surrounding safeguard experiment.
    delete env.NODE_OPTIONS
    return spawnSync(process.execPath, [...loaders.flatMap(url => ["--import", url]),
        "--unhandled-rejections=strict", "--input-type=module", "-e", script],
    { env, encoding: "utf8", timeout: 15000 })
}

describe("runtime worker loader evidence", function () {
    this.timeout(20000)

    it("rejects a completed-work selector that executes no lifetime cases", () => {
        const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--expose-gc",
            "test/fixtures/completed-work-retention.js", "nonexistent-audit-case"],
        { encoding: "utf8", timeout: 15000 })
        assert.ifError(result.error)
        assert.equal(result.status, 1)
        assert.match(result.stderr, /No completed-work retention cases match/)
    })

    for (const name of ["lifetime-overflow", "lifetime-remaps"]) {
        it(`rejects an unknown method in the ${name} review probe`, () => {
            const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--expose-gc",
                `docs/phase5-probes/${name}.mjs`],
            { env: { ...process.env, METHOD: "nonexistent-audit-method" }, encoding: "utf8", timeout: 15000 })
            assert.ifError(result.error)
            assert.equal(result.status, 1)
            assert.match(result.stderr, /No lifetime cases match METHOD/)
        })
    }

    it("normalizes Windows drive casing without changing path casing", () => {
        assert.equal(normalizeModuleURL("file:///C:/Projects/a%20b.js"), "file:///c:/Projects/a%20b.js")
        assert.notEqual(normalizeModuleURL("file:///c:/Projects/A.js"), normalizeModuleURL("file:///c:/Projects/a.js"))
        assert.equal(normalizeModuleURL("node:assert/strict"), "node:assert/strict")
    })

    for (const loaders of [[trace, fault], [fault, trace]]) {
        it(`executes both tracing and faulted runtime bodies: ${loaders[0] === trace ? "trace first" : "fault first"}`, () => {
            const clean = run(loaders, anchor)
            assert.equal(clean.status, 0, clean.stderr)
            assert.match(clean.stderr, /\[cascada-safeguard\].*"edit":0/)
            const broken = run(loaders, "if (!metadata.isObjectLike(root)) return 42")
            assert.notEqual(broken.status, 0)
            assert.match(broken.stderr, /runtime-value-witness/)
            assert.match(broken.stderr, /\[cascada-safeguard\].*"edit":0/)
            assert.doesNotMatch(broken.stderr, /runtime-worker-trace-receipt/)
        })
    }

    it("rejects an absent tracer even when its test-state module is imported", () => {
        const uninstrumented = run([fault], anchor)
        assert.notEqual(uninstrumented.status, 0)
        assert.match(uninstrumented.stderr, /runtime-worker-trace-receipt/)
    })

    it("shares actual tracing state across mixed Windows drive spellings", function () {
        if (process.platform !== "win32") return this.skip()
        for (const drive of ["upper", "lower"]) {
            const mixed = trace.replace(/file:\/\/\/([a-z]):/i, (_, letter) =>
                `file:///${drive === "upper" ? letter.toUpperCase() : letter.toLowerCase()}:`)
            const result = run([mixed, fault], anchor)
            assert.equal(result.status, 0, result.stderr)
            assert.match(result.stderr, /\[cascada-safeguard\].*"edit":0/)
        }
    })

    it("cannot count a no-op substitution as detecting a wrong runtime value", () => {
        const noOp = run([trace, fault], anchor)
        assert.equal(noOp.status, 0, noOp.stderr)
        assert.doesNotMatch(noOp.stderr, /runtime-value-witness/)
    })

    it("records actual runtime execution separately from loading in each worker", () => {
        const directory = mkdtempSync(join(tmpdir(), "cascada-trace-receipts-"))
        const path = join(directory, "receipts.jsonl")
        try {
            const active = run([trace], anchor, source, { CASCADA_TRACE_RECEIPT_FILE: path })
            const idle = run([trace], anchor,
                "import { fixture, enter, leave, count } from './test/trace-state.js'; fixture(() => {}); enter('manual', []); leave(); count('manual');",
                { CASCADA_TRACE_RECEIPT_FILE: path })
            assert.equal(active.status, 0, active.stderr)
            assert.equal(idle.status, 0, idle.stderr)
            const receipts = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line))
            assert.deepEqual(receipts.filter(item => item.pid === active.pid).map(item => item.event), ["loaded", "executed"])
            assert.deepEqual(receipts.filter(item => item.pid === idle.pid).map(item => item.event), ["loaded"])
        } finally {
            rmSync(path, { force: true })
            rmdirSync(directory)
        }
    })

    for (const name of ["identity-work", "length-fork-work"]) {
        it(`requires the ${name} counter loader before accepting zero-work evidence`, () => {
            const env = { ...process.env, CASCADA_WORK_NOOP_LOADER: "1" }
            delete env.NODE_OPTIONS
            const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--expose-gc",
                `test/fixtures/${name}.js`], { env, encoding: "utf8", timeout: 15000 })
            assert.ifError(result.error)
            assert.equal(result.status, 1)
            assert.match(result.stderr, /work requires its runtime counter loader/)
        })
    }

    for (const [name, anchor, replacement, assertion] of [
        ["./fixtures/array-enumeration-work.js", "globalThis.countRangeKey = () => produced++",
            "globalThis.countRangeKey = () => undefined", "Range-key instrumentation must count each streamed candidate"],
        ["./fixtures/length-fork-work.js", "globalThis.__countLengthNode = state => { if (state === measured) visits++ }",
            "globalThis.__countLengthNode = () => undefined", "Length work instrumentation must count an active refresh"],
        ...["live", "peakUses", "subscriptions"].map(field => ["./fixtures/pending-copy-work.js",
            "counts = { live: 0, subscriptions: 0, uses: 0, peakUses: 0 }",
            `counts = new Proxy({ live: 0, subscriptions: 0, uses: 0, peakUses: 0 }, { set(target, key, value) {
                if (key !== ${JSON.stringify(field)}) target[key] = value; return true
            } })`, `Pending-copy instrumentation must count ${field}`]),
        ...["captures", "peakUses"].map(field => ["../docs/phase5-probes/work-histories.mjs",
            "counts = { captures: 0, createdVersions: 0, copiedPlacements: 0, overlayVisits: 0,\n            live: 0, subscriptions: 0, uses: 0, peakUses: 0 }",
            `counts = new Proxy({ captures: 0, createdVersions: 0, copiedPlacements: 0, overlayVisits: 0,
                live: 0, subscriptions: 0, uses: 0, peakUses: 0 }, { set(target, key, value) {
                if (key !== ${JSON.stringify(field)}) target[key] = value; return true
            } })`, `History work instrumentation must count ${field}`]),
    ]) {
        it(`rejects an inactive ${name} counter even when its loader ran: ${assertion}`, () => {
            const fixture = new URL(name, import.meta.url).href
            const script = `
                import assert from 'node:assert/strict';
                import { registerHooks } from 'node:module';
                registerHooks({ load(url, context, next) {
                    const result = next(url, context);
                    if (url !== ${JSON.stringify(fixture)}) return result;
                    const source = String(result.source).replaceAll('\\r\\n', '\\n');
                    const anchor = ${JSON.stringify(anchor)};
                    assert.equal(source.split(anchor).length - 1, 1, 'counter-control-anchor');
                    return { ...result, source: source.replace(anchor, ${JSON.stringify(replacement)}) };
                } });
                await import(${JSON.stringify(fixture)});
            `
            const result = spawnSync(process.execPath,
                ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
                { encoding: "utf8", timeout: 15000 })
            assert.ifError(result.error)
            assert.equal(result.status, 1)
            assert(result.stderr.includes(assertion), result.stderr)
            assert.doesNotMatch(result.stderr, /counter-control-anchor|Runtime counter anchor/)
        })
    }

    for (const mode of ["unloaded", "missing anchor", "ambiguous anchor"]) {
        it(`rejects ${mode} in shared work instrumentation`, () => {
            const marker = mode === "missing anchor" ? "missing runtime counter anchor" :
                mode === "ambiguous anchor" ? "operationContext" : anchor
            const script = `
                import { instrumentRuntime } from './test/runtime-transform.js';
                const verify = instrumentRuntime(new Map([['input-preparations.js', [[${JSON.stringify(marker)}, '$&']]]]));
                ${mode === "unloaded" ? "" : "await import('./src/index.js');"}
                verify('work-loader-receipt');
            `
            const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
                { encoding: "utf8", timeout: 15000 })
            assert.ifError(result.error)
            assert.equal(result.status, 1)
            assert.match(result.stderr, mode === "unloaded" ? /work-loader-receipt/ : /Runtime counter anchor/)
        })
    }
})
