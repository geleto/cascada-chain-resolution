import assert from 'node:assert/strict'
import * as r from '../src/index.js'
import { verifyRefCounts } from './verify-refcounts.js'

describe('localized Array range recovery', () => {
    for (const [method, args] of [['fill', [9, 1, 3]], ['copyWithin', [1, 0, 2]]]) {
        for (const boundary of ['storage', 'publication']) for (const indexed of [false, true]) {
            it(`restores the complete ${method} baseline after ${boundary} failure, indexed=${indexed}`, () => {
                const ctx = { execution: new r.Execution(), errorContext: `${method} failure` }
                const cause = new Error('range write refused')
                let armed = false, wrote = false
                const child = { n: 1 }, source = [child, , { n: 3 }, child]
                const array = new Proxy(source, {
                    deleteProperty(target, key) {
                        if (armed && boundary === 'storage' && key === '2') throw cause
                        if (armed) wrote = true
                        return Reflect.deleteProperty(target, key)
                    },
                    set(target, key, value, receiver) {
                        if (armed && boundary === 'storage' && key === '2') throw cause
                        if (armed) wrote = true
                        return Reflect.set(target, key, value, receiver)
                    },
                    defineProperty(target, key, descriptor) {
                        if (armed && boundary === 'storage' && key === '2') throw cause
                        if (armed) wrote = true
                        return Reflect.defineProperty(target, key, descriptor)
                    },
                })
                const root = new Proxy({ array, sibling: 7 }, {
                    set(target, key, value, receiver) {
                        if (armed && boundary === 'publication' && key === 'array') throw cause
                        return Reflect.set(target, key, value, receiver)
                    },
                })
                const chain = new r.Chain(root, ctx)
                if (indexed) assert.equal(r.hasError(chain, [], ctx), false)
                const expected = r.export(chain, [], ctx)
                armed = true
                const result = r.run(chain, ['array'], method, args, ctx, { mutationScopeDepth: 1 })
                armed = false
                assert.equal(result.cause, cause)
                assert.equal(result.errorContext, ctx.errorContext)
                assert.equal(wrote, true, 'Failure follows a successful range write')
                assert.equal(r.repairPath(chain, ['array'], ctx), undefined)
                const restored = r.export(chain, [], ctx)
                assert.deepEqual(restored, expected)
                assert.equal(restored.array[0], restored.array[3])
                assert.equal(Object.hasOwn(restored.array, 1), false)
                verifyRefCounts(ctx, chain._state)
                assert.equal(ctx.execution.fatalError, null)
            })
        }
    }
})
