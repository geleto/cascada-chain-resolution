import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { ready, OrderedThenable } from '../../test/ordered-thenable.js'

function deliver(value, mode) {
  if (mode === 'ready') return { value, release() {} }
  if (mode === 'synchronous') return { value: ready(value), release() {} }
  const signal = mode === 'native' ? Promise.withResolvers() : new OrderedThenable()
  return { value: signal.promise ?? signal, release(next = value) { signal.resolve(next) } }
}
const modes = ['ready', 'synchronous', 'native', 'ordered']
let adoption = 0, lateEscape = 0
for (const mode of modes) for (const failed of [false, true]) for (const array of [false, true]) {
  const ctx = { execution: new r.Execution(), errorContext: { mode, failed, array } }
  const original = array ? [1, { value: 2 }] : { value: 1, deep: { value: 2 } }
  const source = new r.Chain(r.import(original, ctx), ctx)
  let retained
  const signal = deliver(undefined, mode)
  const receiver = new r.Chain({ install(report, copy) {
    report(copy)
    this.copy = copy
    if (failed) this.invalid = { then() { throw new Error('must not subscribe') } }
    return mode === 'ready' ? { copy } : mode === 'synchronous' ? ready({ copy }) : signal.value
  } }, ctx)
  const result = r.run(receiver, [], 'install', [copy => { retained = copy }, r.lookupPath(source, [], ctx)], ctx, { mutationScopeDepth: 0 })
  const output = new r.Chain(result, ctx)
  if (mode === 'native' || mode === 'ordered') {
    assert(r.isPending(result, ctx))
    signal.release({ copy: retained })
  }
  const completed = await result
  assert.notEqual(retained, original)
  assert.notEqual(array ? retained[1] : retained.deep, array ? original[1] : original.deep)
  if (failed) {
    assert.equal(completed.kind, r.ERROR_KIND.InvalidManagedReceiver)
    assert.equal(r.repairPath(receiver, [], ctx), undefined)
    assert.equal(r.lookupPath(receiver, ['copy'], ctx), undefined)
  } else {
    assert.equal(r.hasError(receiver, [], ctx), false)
    assert.deepEqual(r.export(output, ['copy'], ctx), original)
    r.assignPath(receiver, ['copy', array ? 0 : 'value'], 7, ctx)
    r.assignPath(receiver, ['copy', array ? 1 : 'deep', 'value'], 8, ctx)
    assert.deepEqual(r.export(output, ['copy'], ctx), original)
  }
  const receivedAgain = new r.Chain(r.import(retained, ctx), ctx)
  r.assignPath(receivedAgain, [array ? 0 : 'value'], 9, ctx)
  r.assignPath(receivedAgain, [array ? 1 : 'deep', 'value'], 10, ctx)
  assert.deepEqual(retained, original)
  assert.deepEqual(r.export(source, [], ctx), original)
  assert.equal(ctx.execution.fatalError, null)
  adoption++
}
for (const direct of modes) for (const nested of ['native', 'ordered']) for (const conflict of [false, true]) {
  const execution = new r.Execution()
  const at = errorContext => ({ execution, errorContext })
  const callAt = at('call'), laterAt = at('later'), conflictAt = at('conflict')
  let calls = 0
  const host = r.externalState({ value: 0, produce() { calls++; this.value++; return outer.value }, increment() { calls++; return ++this.value } })
  const inner = deliver(host, nested)
  const outer = deliver({ late: inner.value }, direct)
  const chain = new r.ContextChain({ host }, at('context'), { host: {} })
  const call = r.run(chain, ['host'], 'produce', [], callAt, { mutationScopeDepth: 1 })
  const output = new r.Chain(call, callAt)
  const later = r.run(chain, ['host'], 'increment', [], laterAt, { mutationScopeDepth: 1 })
  assert.equal(host.value, direct === 'native' || direct === 'ordered' ? 1 : 2)
  if (direct === 'native' || direct === 'ordered') {
    assert(r.isPending(later, laterAt))
    outer.release()
  }
  await call
  assert.equal(await later, 2)
  assert.equal(calls, 2)
  const escaped = r.lookupPath(output, ['late'], callAt)
  assert(r.isPending(escaped, callAt))
  let competitor
  if (conflict) competitor = new r.ContextChain({ host }, conflictAt, { host: {} })
  inner.release()
  const failure = await escaped
  assert.equal(failure.kind, r.ERROR_KIND.ExternalCapabilityEscape)
  assert.equal(failure.errorContext, 'call')
  assert.equal(await r.getErrors(output, [], callAt), failure)
  const scopeFailure = r.getErrors(chain, ['host'], laterAt)
  if (conflict) {
    assert.equal(scopeFailure.kind, r.ERROR_KIND.ExternalLocationConflict)
    assert.equal(scopeFailure.errorContext, 'conflict')
    assert.equal(scopeFailure.errors, undefined)
    assert.equal(r.getErrors(competitor, ['host'], laterAt), scopeFailure)
  } else assert.equal(scopeFailure, null)
  assert.equal(host.value, 2)
  assert.equal(execution.fatalError, null)
  lateEscape++
}
console.log(JSON.stringify({ adoption, lateEscape, total: adoption + lateEscape }))
