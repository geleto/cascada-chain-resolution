import assert from 'node:assert/strict'
import * as r from '../src/index.js'
import { verifyRefCounts } from './verify-refcounts.js'

describe('localized Array range recovery', () => {
    for (const [method, args] of [['fill', [9, 1, 3]], ['copyWithin', [1, 0, 2]]]) {
        it(`restores the complete ${method} baseline after required placement inspection fails`, () => {
            const ctx = { execution: new r.Execution(), errorContext: method }, cause = new Error('lookup refused')
            let armed = false, wrote = false
            const array = new Proxy([1, , 3, 4], {
                defineProperty(target, key, descriptor) {
                    if (armed && key === '1') wrote = true
                    return Reflect.defineProperty(target, key, descriptor)
                },
                getOwnPropertyDescriptor(target, key) {
                    if (armed && wrote && key === '2') throw cause
                    return Reflect.getOwnPropertyDescriptor(target, key)
                },
            })
            const chain = new r.Chain(array, ctx)
            armed = true
            const failed = r.run(chain, [], method, args, ctx, { mutationScopeDepth: 0 })
            armed = false
            assert.equal(failed.cause, cause)
            assert.equal(r.isPoisoned(chain, [], ctx), true)
            r.repairPath(chain, [], ctx)
            assert.deepEqual(r.export(chain, [], ctx), [1, , 3, 4])
            verifyRefCounts(ctx, chain._state)
        })
        for (const boundary of ['storage', 'publication']) for (const indexed of [false, true]) {
            it(`commits the complete ${method} result after a refused ${boundary} cache write, indexed=${indexed}`, () => {
                const ctx = { execution: new r.Execution(), errorContext: `${method} failure` }
                const cause = new Error('range write refused')
                let armed = false
                const child = { n: 1 }, source = [child, , { n: 3 }, child]
                const array = new Proxy(source, {
                    deleteProperty(target, key) {
                        if (armed && boundary === 'storage' && key === '2') throw cause
                        return Reflect.deleteProperty(target, key)
                    },
                    set(target, key, value, receiver) {
                        if (armed && boundary === 'storage' && key === '2') throw cause
                        return Reflect.set(target, key, value, receiver)
                    },
                    defineProperty(target, key, descriptor) {
                        if (armed && boundary === 'storage' && key === '2') throw cause
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
                expected.array[method](...args)
                assert.equal(r.isPoisoned(chain, ['array'], ctx), false)
                assert.deepEqual(r.export(new r.Chain(result, ctx), [], ctx), expected.array)
                assert.equal(r.repairPath(chain, ['array'], ctx), undefined)
                const restored = r.export(chain, [], ctx)
                assert.deepEqual(restored, expected)
                assert.equal(restored.array[0], restored.array[3])
                assert.equal(Object.hasOwn(restored.array, 2), Object.hasOwn(expected.array, 2))
                verifyRefCounts(ctx, chain._state)
                assert.equal(ctx.execution.fatalError, null)
            })
        }
    }
})
