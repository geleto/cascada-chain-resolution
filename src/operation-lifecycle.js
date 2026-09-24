// Keep this module minimal: a direct `open` fact, an idempotent `close()`, and lazy local
// release registration. Publication stays at its natural semantic boundary, and release
// registration never tracks or cancels work. See AGENTS.md "Operation Work Lifetimes".

class OperationOwner {
    open = true
    constructor(operationContext) {
        this.operationContext = operationContext
    }
    close() {
        if (!this.open) return
        this.open = false
        try {
            this.release?.()
        } finally {
            const releases = this.releases
            this.releases = undefined
            if (releases) {
                try {
                    for (const release of releases) release()
                } finally {
                    releases.clear()
                }
            }
        }
    }
}

function releaseOnClose(operation, release) {
    if (!operation.open) {
        release()
        return undefined
    }
    const releases = (operation.releases ??= new Set())
    releases.add(release)
    return () => {
        if (!releases.delete(release)) return
        if (releases.size === 0) operation.releases = undefined
    }
}

export { OperationOwner, releaseOnClose }
