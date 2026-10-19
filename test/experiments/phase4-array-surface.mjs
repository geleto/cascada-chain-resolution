// Catalogue-derived semantics and completed-source lifetime probe.
import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { ARRAY_METHODS } from '../../src/array-methods.js'
import { ArrayView } from '../../src/array-view.js'
import { ready, OrderedThenable } from '../ordered-thenable.js'
assert(global.gc, 'Run with --expose-gc')
const argsByMethod = {
  at: [1], concat: [[8, , 9]], copyWithin: [0, 2], fill: [9, 1, 3], flat: [1],
  includes: [1], indexOf: [1], join: ['|'], lastIndexOf: [1], pop: [], push: [8],
  reverse: [], shift: [], slice: [1, 3], sort: [], splice: [1, 2, 8],
  toReversed: [], toSorted: [], toSpliced: [1, 2, 8], toString: [], unshift: [8], with: [1, 8],
}
assert.deepEqual(Object.keys(argsByMethod).sort(), Object.keys(ARRAY_METHODS).sort(), 'Catalogue drift')
const mutators = new Set(['copyWithin','fill','pop','push','reverse','shift','sort','splice','unshift'])
const ignoresArguments = new Set(['pop','reverse','shift','toReversed','toString'])
const prebuilt = new Error('prebuilt')
const rows = []
const faults = []
let views = 0
async function execute(method, mutation, shape, mode, failure) {
  const label = [method, mutation, shape, mode, failure].join('/')
  const ctx = { execution: new r.Execution(), errorContext: label }
  let array = [3, , 1, 2]
  let payload = { marker: label }
  let source = { array, payload }
  const weak = [new WeakRef(array), new WeakRef(payload), new WeakRef(source)]
  let root = new r.Chain(shape === 'view' ? source : r.import(source, ctx), ctx)
  let holder = root, path = ['array']
  if (shape === 'view') {
    holder = new r.Chain(r.run(root, path, 'slice', [], ctx, {}), ctx)
    path = []
    assert(r.lookupPath(holder, [], ctx) instanceof ArrayView, label)
    views++
  }
  let args = structuredClone(argsByMethod[method])
  const reference = [3, , 1, 2]
  const nativeResult = Reflect.apply(Array.prototype[method], reference, structuredClone(args))
  const hasMutation = mutators.has(method)
  const expected = mutation || !hasMutation ? nativeResult : reference
  let late
  if (failure === 'argument') args = [prebuilt]
  if (mode === 'sync') args = args.map(ready)
  if (mode === 'native' && args.length) {
    late = Promise.withResolvers()
    const value = args[0]; args[0] = late.promise
    late.complete = () => late.resolve(value)
  }
  if (mode === 'ordered' && args.length) {
    const value = args[0]; late = new OrderedThenable(); args[0] = late
    late.complete = () => { late.resolve(value); late.flush() }
  }
  let result = r.run(holder, path, method, args, ctx, mutation ? { mutationScopeDepth: path.length } : {})
  late?.complete()
  result = await result
  let output
  if (r.isPoisonError(result)) output = result
  else output = await r.export(new r.Chain(result, ctx), [], ctx)
  if (mutation && !hasMutation) assert.equal(output.kind, r.ERROR_KIND.InvalidArrayOperation, label)
  else if (!failure) assert.deepEqual(output, expected, label)
  else if (ignoresArguments.has(method)) assert.deepEqual(output, expected, label)
  else if (mutation && (method === 'push' || method === 'unshift')) assert.equal(output, 5, label)
  else assert.equal(output.kind, r.ERROR_KIND.OperationInputFailed, label)
  // Native snapshots and Errors cannot legitimately own the former source graph.
  rows.push({label, weak, keep: [ctx, output]})
  result = output = late = args = holder = root = array = payload = source = undefined
}
for (const method of Object.keys(argsByMethod)) for (const mutation of [false, true])
for (const shape of ['array', 'view']) for (const mode of ['ready', 'sync', 'native', 'ordered'])
for (const failure of [undefined, 'argument']) {
  try { await execute(method, mutation, shape, mode, failure) }
  catch (error) { faults.push({method, mutation, shape, mode, failure, error: String(error), stack: error.stack}) }
}
for (let i = 0; i < 30; i++) { await new Promise(setImmediate); global.gc() }
const retained = rows.filter(row => row.weak.some(ref => ref.deref())).map(row => row.label)
console.log(JSON.stringify({cases: rows.length, views, faults, retained}, null, 2))
assert.deepEqual(faults, [], 'Semantic failures')
assert.deepEqual(retained, [], 'Completed Array operations retain dropped sources')
