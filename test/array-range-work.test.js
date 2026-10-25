import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('./fixtures/array-range-work.js', import.meta.url))
describe('localized Array mutation work', () => {
    for (const disabled of [false, true]) it(disabled ? 'rejects disabled range instrumentation' :
        'bounds point fill and copyWithin work by the selected range', function () {
        this.timeout(60000)
        const result = spawnSync(process.execPath, [...process.execArgv, '--unhandled-rejections=strict',
            fixture, ...(disabled ? ['--no-op-loader'] : [])], { encoding: 'utf8', timeout: 50000 })
        assert.equal(result.error, undefined)
        assert.equal(result.status, disabled ? 1 : 0, result.stderr || result.stdout)
        if (disabled) assert.match(result.stderr, /Range work instrumentation must execute/)
    })
})
