import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import { inspect } from "node:util"
import * as trace from "./trace-state.js"

function verifyInstrumentation() {
    if (process.env.CASCADA_SEQUENCE_EXPECT_TRACE === "1" &&
        (!trace.enabled || !(trace.counts().prepareInput > 0)))
        throw new Error("Generated runtime worker did not execute the required preparation tracer")
}

// Paired replays are one comparison case. Expose the active replay and the
// siblings not yet started, so a crashed/timed-out worker reports both exactly.
export function reportGeneratedStage(stage) {
    if (process.env.CASCADA_SEQUENCE_WORKER === "1") process.send({ stage })
}

// Only successful, serializable evidence leaves a worker. A failed worker is
// discarded before another case starts, including its pending runtime work.
// Cases must construct fresh inputs, models and executions on every invocation.
export async function runGeneratedCases({ moduleURL, cases, runCase, onPass = () => {} }) {
    if (process.env.CASCADA_SEQUENCE_WORKER === "1") {
        process.on("message", async ({ index, spec }) => {
            try {
                const result = await runCase(spec, index)
                verifyInstrumentation()
                // Let escaped asynchronous failures reach strict Node handling
                // before accepting this case's successful evidence.
                await new Promise(setImmediate)
                process.send({ passed: true, result })
            } catch (error) {
                process.send({ passed: false, diagnostic: inspect(error, { depth: 8 }) })
            }
        })
        await new Promise(() => {})
    }

    const totals = { attempted: 0, passed: 0, failed: 0, skipped: 0 }
    const failureLimit = Number(process.env.CASCADA_SEQUENCE_CONTINUE ?? 0)
    if (!Number.isSafeInteger(failureLimit) || failureLimit < 0)
        throw new Error("CASCADA_SEQUENCE_CONTINUE must be a nonnegative failure limit")
    if (failureLimit === 0) {
        for (const [index, spec] of cases.entries()) {
            totals.attempted++
            const result = await runCase(spec, index)
            verifyInstrumentation()
            onPass(result, spec, index)
            totals.passed++
        }
        return totals
    }

    const timeout = Number(process.env.CASCADA_SEQUENCE_TIMEOUT_MS ?? 30000)
    if (!Number.isSafeInteger(timeout) || timeout <= 0)
        throw new Error("CASCADA_SEQUENCE_TIMEOUT_MS must be a positive deadline")
    let worker
    async function discardWorker() {
        if (!worker) return
        const child = worker
        worker = undefined
        if (child.exitCode !== null || child.signalCode !== null) return
        const exited = new Promise(resolve => child.once("exit", resolve))
        child.kill()
        await exited
    }
    function runIsolated(spec, index) {
        if (!worker) worker = fork(fileURLToPath(moduleURL), [], {
            execArgv: process.execArgv,
            env: { ...process.env, CASCADA_SEQUENCE_WORKER: "1" },
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            windowsHide: true,
        })
        return new Promise(resolve => {
            const child = worker
            let stderr = ""
            let stage
            const capture = data => { stderr = (stderr + data).slice(-16384) }
            const finish = result => {
                clearTimeout(timer)
                child.off("message", message)
                child.off("exit", exited)
                child.off("error", failed)
                child.stderr.off("data", capture)
                resolve({ ...result, stage })
            }
            const message = result => {
                if (result.stage) stage = result.stage
                else finish(result)
            }
            const exited = (code, signal) => finish({ passed: false,
                diagnostic: `worker escaped: exit=${code}, signal=${signal}\n${stderr}` })
            const failed = error => finish({ passed: false, diagnostic: `worker error: ${error.message}` })
            const timer = setTimeout(() => finish({ passed: false,
                diagnostic: `worker deadline exceeded (${timeout} ms)\n${stderr}` }), timeout)
            child.stderr.on("data", capture)
            child.on("message", message)
            child.once("exit", exited)
            child.once("error", failed)
            child.send({ index, spec }, error => { if (error) failed(error) })
        })
    }
    try {
        for (const [index, spec] of cases.entries()) {
            if (totals.failed >= failureLimit) break
            totals.attempted++
            const result = await runIsolated(spec, index)
            if (result.passed) {
                onPass(result.result, spec, index)
                totals.passed++
            } else {
                totals.failed++
                console.error(`generated case ${index}: ${JSON.stringify(spec)}\n${result.diagnostic}` +
                    (result.stage ? `\nactive replay: ${JSON.stringify(result.stage)}; ` +
                        `abandoned sibling replays=${result.stage.remainingReplays?.length ?? 0}` : ""))
                // Never keep an Error, model, pending callback or input graph in
                // the coordinator, and never continue in the failed worker.
                await discardWorker()
            }
        }
    } finally {
        await discardWorker()
    }
    totals.skipped = cases.length - totals.attempted
    if (totals.failed) process.exitCode = 1
    return totals
}
