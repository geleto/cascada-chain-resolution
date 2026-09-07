class OperationOwner {
    open = true
    constructor(operationContext) {
        this.operationContext = operationContext
    }
    close() {
        close(this)
    }
}

function close(operation) {
    if (!operation.open) return
    operation.open = false
    try {
        operation.release?.()
    } finally {
        const releases = operation.releases
        operation.releases = undefined
        if (releases) {
            try {
                for (const release of releases) release()
            } finally {
                releases.clear()
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

export { OperationOwner, close, releaseOnClose }
