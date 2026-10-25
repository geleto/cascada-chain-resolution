import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const r = await import('../../src/index.js')
const { OrderedThenable } = await import('../../test/ordered-thenable.js')
const rows = []
for (const method of ['includes', 'indexOf', 'lastIndexOf'])
for (const initialNonempty of [false, true])
for (const delivery of ['native', 'ordered']) {
  const execution = new r.Execution()
  const ctx = { execution, errorContext: { method, initialNonempty, delivery } }
  const mutate = { execution, errorContext: { laterMutation: true } }
  const bound = delivery === 'native' ? Promise.withResolvers() : new OrderedThenable()
  const causes = [new Error('needle'), new Error('bound')]
  const poison = r.createPoisonError(causes[0], ctx, r.ERROR_KIND.OperationInputFailed)
  const api = r.externalState({ array: initialNonempty ? [7] : [], flip() {
    if (this.array.length) this.array.length = 0
    else this.array.push(7)
    return this.array.length
  } })
  const chain = new r.ContextChain({ api }, ctx, { api: {} })
  const result = r.run(chain, ['api', 'array'], method, [poison, bound.promise ?? bound], ctx, {})
  assert.equal(r.isPending(result, ctx), initialNonempty, 'Captured shape alone controls required bound wait')
  if (!initialNonempty) assert.equal(result, poison)
  if (delivery === 'ordered') assert.equal(bound.subscriptions > 0, initialNonempty, 'Bound consumption must follow captured shape')
  const changed = r.run(chain, ['api'], 'flip', [], mutate, { mutationScopeDepth: 1 })
  assert.equal(changed, initialNonempty ? 0 : 1, 'Captured receiver must have ended native access')
  if (initialNonempty) {
    let settled = false
    result.then(() => { settled = true })
    await new Promise(setImmediate)
    assert.equal(settled, false, 'Required bound still pending after later mutation')
    bound.reject(causes[1])
  } else bound.resolve(0)
  const outcome = await result
  const errors = outcome.errors ?? [outcome]
  assert.equal(errors.length, initialNonempty ? 2 : 1)
  assert.deepEqual(new Set(errors.map(error => error.cause)), new Set(initialNonempty ? causes : causes.slice(0, 1)))
  for (const error of errors) {
    assert.equal(error.errorContext, ctx.errorContext)
    assert.equal(error.kind, r.ERROR_KIND.OperationInputFailed)
  }
  assert.equal(r.getErrors(chain, ['api'], ctx), null, 'Independent search failure does not poison native resource')
  assert.equal(execution.fatalError, null)
  rows.push({ method, initialNonempty, delivery, asserted: true, causes: errors.length })
}
const sourceHash = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex')
console.log(JSON.stringify({ cases: rows.length, rows, sourceHash, node: process.version }))
