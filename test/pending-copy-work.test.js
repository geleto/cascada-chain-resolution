import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('./fixtures/pending-copy-work.js', import.meta.url))
function execute(args = []) {
    return spawnSync(process.execPath, [...process.execArgv, '--unhandled-rejections=strict',
        '--max-old-space-size=384', fixture, ...args], { encoding: 'utf8', timeout: 60000 })
}

describe('pending placement copy work', () => {
    it('bounds live capture and subscription history through remapping and COW', function () {
        this.timeout(70000)
        const result = execute()
        assert.equal(result.error, undefined)
        assert.equal(result.status, 0, result.stderr || result.stdout)
    })

    it('rejects a disabled pending-copy work counter', function () {
        this.timeout(70000)
        const result = execute(['--no-op-loader'])
        assert.equal(result.status, 1)
        assert.match(result.stderr, /Pending-copy counter loader must execute every substitution/)
    })
})
