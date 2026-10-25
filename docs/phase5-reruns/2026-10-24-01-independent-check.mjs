import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { SAFEGUARDS } from '../../test/safeguards/registry.mjs'

const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'))
const acceptance = read('docs/phase5-acceptance.json')
const sensitivity = read('docs/phase5-sensitivity.json')
const reuse = read('docs/phase5-reruns/2026-10-24-01-reuse.json')
const initial = read('docs/phase5-reruns/2026-10-24-01-initial.json')
const manifest = Object.fromEntries(Object.keys(acceptance.manifest).sort().map(path => [path, hash(fs.readFileSync(path))]))
assert.deepEqual(manifest, acceptance.manifest)
assert.deepEqual(manifest, initial.manifest)
assert.equal(hash(JSON.stringify(manifest)), acceptance.candidateDigest)
assert.equal(reuse.sourceCandidateDigest, acceptance.candidateDigest)
assert.equal(hash(fs.readFileSync('docs/phase5-acceptance.json')), reuse.portableAcceptanceSHA256)
assert.equal(hash(fs.readFileSync('docs/phase5-sensitivity.json')), reuse.portableSensitivitySHA256)
assert.equal(acceptance.runs.length, 54)
assert.equal(reuse.logs.length, acceptance.runs.length)
let logs = 0, receipts = 0, anchors = 0, obligations = 0
for (const run of acceptance.runs) {
  assert.equal(run.exitCode, 0, run.label)
  assert.deepEqual(run.changedInputs, [], run.label)
  assert.equal(run.manifestDigest, acceptance.candidateDigest, run.label)
  const record = reuse.logs.find(record => record.label === run.label)
  assert(record?.reconciled, run.label)
  assert.equal(hash(fs.readFileSync(run.log)), record.sha256, run.label)
  if (run.logDigest) assert.equal(record.sha256, run.logDigest, run.label)
  logs++
  if (run.receiptDigest) {
    assert.equal(hash(fs.readFileSync(run.env.CASCADA_TRACE_RECEIPT_FILE)), run.receiptDigest, run.label)
    receipts++
  }
}
const scales = acceptance.runs.filter(run => run.label.startsWith('candidate-5-scale-'))
assert.equal(scales.length, 8)
for (const run of scales) assert.equal(run.env.CASCADA_SEQUENCE_SEEDS, '1600', run.label)
for (let index = 0; index < 8; index++) {
  const matrix = acceptance.runs.find(run => run.label === `candidate-5-matrix-${index}`)
  assert.equal(matrix.env.CASCADA_CONFLICT_PART, `${index}/8`)
  assert.equal(matrix.env.CASCADA_CONFLICT_MATRIX, 'full')
  const pair = acceptance.runs.find(run => run.label === `candidate-5-pairs-${index}`)
  assert(pair.command.includes(`${index}/8`))
}
assert.equal(sensitivity.rows.length, 22)
assert.equal(SAFEGUARDS.length, 217)
for (const entry of SAFEGUARDS) {
  const saved = sensitivity.safeguardCatalog[entry.id]
  assert(saved, entry.id)
  assert.equal(saved.outcome, 'witnessed', entry.id)
  assert(saved.failureCount > 0 && saved.representativeDiagnostics.length > 0, entry.id)
  assert.deepEqual(saved.faultEdits, entry.faults, entry.id)
  assert.deepEqual(saved.declaredWitnessSelectors, entry.witnesses, entry.id)
  const sources = new Map()
  for (const fault of entry.faults) {
    const source = sources.get(fault.file) ?? fs.readFileSync(fault.file, 'utf8').replaceAll('\r\n', '\n')
    assert(source.includes(fault.find), entry.id)
    sources.set(fault.file, source.replace(fault.find, fault.replace))
    anchors++
  }
}
for (const row of sensitivity.rows) for (const obligation of row.obligations) {
  assert(obligation.callers && obligation.witnessScope, `${row.id} ${obligation.obligation}`)
  for (const id of obligation.safeguards ?? []) assert(sensitivity.safeguardCatalog[id], `${row.id} ${id}`)
  obligations++
}
const reportArgument = sensitivity.execution.command.find(argument => argument.startsWith('--report='))
assert.equal(hash(fs.readFileSync(reportArgument.slice('--report='.length))), sensitivity.reportSHA256)
const baselines = read('docs/phase5-reruns/2026-10-24-01-baselines.json')
assert.equal(baselines.runs.length, 2)
for (const run of baselines.runs) {
  assert.equal(run.exitCode, 0, run.name)
  assert.equal(run.passingTests, 5299, run.name)
  assert.deepEqual(run.changedInputs, [], run.name)
  assert.equal(run.manifestDigest, acceptance.candidateDigest, run.name)
  const log = fs.readFileSync(run.log)
  assert.equal(hash(log), run.logSHA256, run.name)
  assert.match(String(log), /5299 passing/, run.name)
}
const traced = baselines.runs.find(run => run.name === 'traced')
const receiptBytes = fs.readFileSync(traced.env.CASCADA_TRACE_RECEIPT_FILE)
assert.equal(hash(receiptBytes), baselines.trace.receiptSHA256)
const events = String(receiptBytes).trim().split(/\r?\n/).map(line => JSON.parse(line))
const lines = new Set()
assert.equal(baselines.trace.sessions.length, 220)
for (const session of baselines.trace.sessions) {
  const loaded = events[session.loadedLine - 1]
  assert.equal(loaded.event, 'loaded')
  assert.equal(loaded.pid, session.pid)
  assert.equal(loaded.parent, session.parent)
  assert.equal(loaded.script, session.script)
  assert(!lines.has(session.loadedLine))
  lines.add(session.loadedLine)
  if (session.executedLine) {
    const executed = events[session.executedLine - 1]
    assert.equal(executed.event, 'executed')
    assert.equal(executed.pid, session.pid)
    assert(!lines.has(session.executedLine))
    lines.add(session.executedLine)
  }
}
assert.equal(lines.size, events.length)
assert.equal(baselines.trace.sessions.filter(session => session.executedLine).length, 205)
const coordinators = baselines.trace.startupOnly.filter(session => session.classification === 'coordinator')
assert.equal(coordinators.length, 13)
assert.equal(coordinators.reduce((sum, session) => sum + session.executedChildInstances.length, 0), 81)
for (const coordinator of coordinators) for (const child of coordinator.executedChildInstances) {
  assert.equal(baselines.trace.sessions[child].parentInstance, coordinator.instance)
  assert(baselines.trace.sessions[child].executedLine)
}
const rerun = read('docs/phase5-reruns/2026-10-24-01-acceptance.json')
assert.equal(rerun.finalCandidateDigest, acceptance.candidateDigest)
assert.equal(rerun.gates.length, 54)
assert.equal(new Set(rerun.gates.map(gate => gate.id)).size, 54)
let freshGates = 0, reusedGates = 0
for (const gate of rerun.gates) {
  assert.equal(gate.candidateDigest, acceptance.candidateDigest, gate.id)
  if (gate.classification === 'newly executed') {
    const run = baselines.runs[Number(gate.evidence.jsonPointer.split('/').at(-1))]
    assert.equal(gate.id, `candidate-5-${run.name}`)
    assert.equal(gate.executedOn, '2026-10-24')
    assert.deepEqual(gate.command, run.command)
    assert.deepEqual(gate.env, run.env)
    assert.equal(gate.exitCode, run.exitCode)
    assert.equal(gate.seconds, run.seconds)
    assert.equal(gate.logSHA256, run.logSHA256)
    freshGates++
  } else {
    assert.equal(gate.classification, 'reused with justification', gate.id)
    const run = acceptance.runs[Number(gate.evidence.jsonPointer.split('/').at(-1))]
    assert.equal(gate.id, run.label)
    assert.equal(gate.originalExecutionDate, '2026-10-22')
    assert.equal(gate.evidence.sha256, reuse.portableAcceptanceSHA256)
    assert.deepEqual(gate.command, run.command)
    assert.deepEqual(gate.env, run.env)
    assert.equal(gate.exitCode, run.exitCode)
    assert.equal(gate.seconds, run.seconds)
    assert.equal(gate.logSHA256, reuse.logs.find(record => record.label === run.label).sha256)
    assert(gate.reuseJustification)
    reusedGates++
  }
}
assert.equal(freshGates, 2)
assert.equal(reusedGates, 52)
assert.deepEqual(rerun.rows.map(row => row.id), Array.from({ length: 22 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`))
assert.equal(rerun.supplementaryProbes.length, 4)
for (const probe of rerun.supplementaryProbes) {
  assert.equal(probe.classification, 'newly executed')
  if (probe.source) assert.equal(hash(fs.readFileSync(`docs/phase5-reruns/${probe.source}`)), probe.sourceSHA256)
}
const summary = { status: 'passed', candidateDigest: acceptance.candidateDigest,
  executionInputs: Object.keys(manifest).length, historicalLogsVerified: logs,
  historicalReceiptFilesVerified: receipts, required1600SeedFamilies: scales.length,
  conflictPartitions: 8, publicationPairPartitions: 8, sensitivityRows: sensitivity.rows.length,
  obligationGroups: obligations, safeguards: SAFEGUARDS.length, currentFaultAnchors: anchors,
  freshBaselineLogsVerified: 2, freshPassingTests: [5299, 5299], freshReceiptEventsVerified: events.length,
  freshLoadedInstances: 220, freshExecutedInstances: 205, freshCoordinators: 13, freshExecutedCoordinatorChildren: 81,
  consolidatedGateMappingsVerified: 54, consolidatedNewGates: freshGates, consolidatedReusedGates: reusedGates,
  consolidatedRows: rerun.rows.length, consolidatedSupplementaryProbeGroups: rerun.supplementaryProbes.length,
  qualification: 'Read-only hash, inventory and recorded-result verification; no new fault or acceptance execution. Actual diagnostic and child-receipt scope retains the reviewed portable records and current source review.' }
fs.writeFileSync('docs/phase5-reruns/2026-10-24-01-independent-check.json', JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary))
