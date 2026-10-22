import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('./fixtures/pending-push-work.js', import.meta.url))
function execute(args = []) {
    const result = spawnSync(process.execPath, [...process.execArgv, '--unhandled-rejections=strict',
        '--max-old-space-size=384', fixture, ...args],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
    assert.equal(result.error, undefined, String(result.error))
    return result
}

describe('pending push history work', () => {
    it('bounds unresolved storage and aggregate copied placements linearly (B22)', function () {
        this.timeout(70000)
        const result = execute()
        assert.equal(result.status, 0, result.stderr || result.stdout)
    })

    it('rejects a no-op counter loader before counting its result as evidence', function () {
        this.timeout(70000)
        const result = execute(['--no-op-loader'])
        assert.equal(result.status, 1, result.stdout + result.stderr)
        assert.match(result.stderr, /B22 counter loader must execute every substitution/)
    })

    it('detects the original copied-producer history after all semantic controls complete', function () {
        this.timeout(70000)
        const result = execute(['--legacy-copies'])
        assert.equal(result.status, 1, result.stdout + result.stderr)
        assert.match(result.stderr, /B22 copied placement entries are not linear: 16 forward issued: 120/)
        const report = JSON.parse(result.stdout)
        assert(report.samples.every(sample => sample.settled.liveCaptures === 0))
        assert.equal(report.controls.length, 2)
    })
})
