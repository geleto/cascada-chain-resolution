import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import { OrderedThenable, ready, rejected } from '../../test/ordered-thenable.js'
import { verifyLiveness } from '../../test/verify-parents.js'
import { verifyRefCounts } from '../../test/verify-refcounts.js'

// Independent expectations: an issued query/export captures the pre-write
// placement; later replacement/deletion removes only the current occurrence.
let histories = 0
for (const mode of ['ready', 'synchronous', 'native', 'ordered'])
for (const array of [false, true])
for (const deletion of [false, true])
for (const rejection of [false, true]) {
    const execution = new r.Execution()
    const ctx = { execution, errorContext: { boundary: 'original import' } }
    const queryCtx = { execution, errorContext: { boundary: 'query' } }
    const cause = new Error('captured failure')
    const healthyError = new Error('opaque healthy data')
    const signal = mode === 'ordered' ? new OrderedThenable() : Promise.withResolvers()
    const input = mode === 'ready' ? (rejection ? r.createPoisonError(cause, ctx, r.ERROR_KIND.OperationInputFailed) : 7)
        : mode === 'synchronous' ? (rejection ? rejected(cause) : ready(7)) : signal.promise ?? signal
    const branch = { value: input }; branch.self = branch
    const root = array ? [branch, healthyError] : { branch, healthyError }
    const chain = new r.Chain(r.import(root, ctx), ctx)
    const beforeErrors = r.getErrors(chain, [], queryCtx)
    const beforeHas = r.hasError(chain, [], queryCtx)
    const beforeExport = r.export(chain, [], queryCtx)
    const pending = mode === 'native' || mode === 'ordered'
    for (const value of [beforeErrors, beforeHas, beforeExport]) assert.equal(value instanceof Promise, pending)
    const key = array ? 0 : 'branch'
    if (deletion) r.deletePath(chain, [key], ctx)
    else r.assignPath(chain, [key], { replacement: true }, ctx)
    assert.equal(r.getErrors(chain, [], queryCtx), null)
    assert.equal(r.hasError(chain, [], queryCtx), false)
    verifyLiveness(ctx, [branch], new Set(), 'Captured query/export versions do not retain the retired source container')
    if (pending) rejection ? signal.reject(cause) : signal.resolve(7)
    const [errors, has, exported] = await Promise.all([beforeErrors, beforeHas, beforeExport])
    assert.equal(has, rejection)
    if (rejection) {
        for (const error of [errors, exported]) {
            assert.equal(error.cause, cause)
            assert.equal(error.kind, r.ERROR_KIND.OperationInputFailed)
            assert.equal(error.errorContext, ctx.errorContext)
        }
    } else {
        assert.equal(errors, null)
        assert.equal(exported[key].value, 7)
        assert.equal(exported[key].self, exported[key])
        assert.equal(exported[array ? 1 : 'healthyError'], healthyError)
    }
    const current = r.export(chain, [], ctx)
    assert.equal(Object.hasOwn(current, key), !deletion)
    if (!deletion) assert.deepEqual(current[key], { replacement: true })
    assert.equal(r.getErrors(chain, [], ctx), null)
    verifyRefCounts(ctx, chain._state)
    assert.equal(execution.fatalError, null)
    histories++
}

// A later binding conflict must not replace the pending mutation's own failure.
// A prior child poison must remain its own cause, with Object.is source equality.
let conflictHistories = 0
for (const mode of ['native', 'ordered'])
for (const completionFirst of [false, true]) {
    const execution = new r.Execution()
    const firstCtx = { execution, errorContext: -0 }
    const secondCtx = { execution, errorContext: +0 }
    const conflictCtx = { execution, errorContext: 'competing registration' }
    const cause = new Error('shared raw cause')
    const signal = mode === 'ordered' ? new OrderedThenable() : Promise.withResolvers()
    const first = r.externalState({ fail() { throw cause } })
    const second = r.externalState({ fail() { return signal.promise ?? signal } })
    const chain = new r.ContextChain({ first, second }, firstCtx, { first: {}, second: {} })
    const failed = r.run(chain, ['first'], 'fail', [], firstCtx, { mutationScopeDepth: 1 })
    assert.equal(failed.cause, cause)
    const pending = r.run(chain, ['second'], 'fail', [], secondCtx, { mutationScopeDepth: 1 })
    assert(pending instanceof Promise)
    const collection = r.getErrors(chain, [], firstCtx)
    assert(collection instanceof Promise)
    if (completionFirst) {
        signal.reject(cause)
        await collection
    }
    new r.ContextChain({ second }, conflictCtx, { second: {} })
    if (!completionFirst) signal.reject(cause)
    const ownFailure = await pending
    assert.equal(ownFailure.cause, cause)
    assert(Object.is(ownFailure.errorContext, +0))
    const errors = await collection
    const leaves = errors.errors ?? [errors]
    assert.equal(leaves.length, completionFirst ? 2 : 3)
    assert(leaves.some(error => error.cause === cause && Object.is(error.errorContext, -0)))
    assert(leaves.some(error => error.cause === cause && Object.is(error.errorContext, +0)))
    assert.equal(leaves.some(error => error.kind === r.ERROR_KIND.ExternalLocationConflict && error.errorContext === conflictCtx.errorContext), !completionFirst)
    assert.equal(r.repairPath(chain, ['second'], firstCtx).kind, r.ERROR_KIND.ExternalLocationConflict)
    assert.equal((r.getErrors(chain, [], firstCtx).errors ?? []).length, 3)
    assert.equal(execution.fatalError, null)
    conflictHistories++
}
console.log(JSON.stringify({ histories, conflictHistories, checks: 'captured queries, retirement, causal errors, native failure ownership and blocked repair' }))
