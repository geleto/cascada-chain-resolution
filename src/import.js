const {
    isPromise,
    isTracked,
    onValueResolve,
} = require("./helpers")
const {
    createCycleError,
    reportFatalError,
} = require("./error")
const {
    ensureMeta,
    markImported,
    metaOf,
    nodeImportContext,
} = require("./meta")
const {
    getCommittedCycleError,
    getPromiseMirror,
    getOrCreatePromiseMirror,
    readLogicalProperty,
} = require("./promise-mirrors")

const EMPTY_PREPARATION = {
    records: new Map(),
    commit() {},
}

function importValue(value, importContext) {
    if (!importContext) {
        reportFatalError(new Error("import requires an error context"))
    }
    if (isPromise(value)) {
        return onValueResolve(value, settled => markImported(settled, importContext))
    }
    return markImported(value, importContext)
}

// Purely discover an imported graph. The returned commit closure is the sole
// publication point for shared marks, cycle Errors, and mirrors.
function prepareImportedData(
    value,
    inheritedImportContext,
    writeTarget = undefined,
    excludedMirror = undefined,
) {
    if (!isTracked(value)) return EMPTY_PREPARATION

    const rootContext = nodeImportContext(value, inheritedImportContext)
    if (rootContext === undefined) return EMPTY_PREPARATION
    if (metaOf(value)?.importPrepared) return EMPTY_PREPARATION

    const records = new Map()
    let needsScc = false
    discover(value, rootContext)

    if (needsScc) stageCycleErrors(records)
    return {
        records,
        commit(commitCycleError) {
            for (const record of records.values()) {
                const meta = ensureMeta(record.node)
                meta.shared = true
                meta.importPrepared = true
                // Mirrors are born before cycle Errors are published so every committed
                // placement has its final storage owner when bookkeeping runs.
                for (const edge of record.edges) {
                    if (edge.cycleError || !isPromise(edge.value) ||
                        edge.mirror === excludedMirror) continue
                    let mirror = edge.mirror
                    if (mirror?.promise === edge.value) {
                        mirror.importContext ??= record.context
                        mirror.externalHolder = true
                    } else {
                        mirror = getOrCreatePromiseMirror(
                            record.node,
                            edge.key,
                            edge.value,
                            record.context,
                        )
                    }
                    edge.mirror = mirror
                }
            }

            for (const record of records.values()) {
                for (const edge of record.edges) {
                    if (getCommittedCycleError(record.node, edge.key) !== edge.cycleError) {
                        commitCycleError(record.node, edge.key, edge.cycleError)
                    }
                }
            }
        },
    }

    function discover(node, inheritedContext) {
        if (node === writeTarget) return

        const existing = records.get(node)
        if (existing) {
            if (existing.state === "active") needsScc = true
            return
        }

        const context = nodeImportContext(node, inheritedContext)
        const record = {
            node,
            context,
            edges: [],
            state: "active",
        }
        records.set(node, record)

        for (const key of Object.keys(node)) {
            const mirror = getPromiseMirror(node, key)
            const child = readLogicalProperty(node, key)
            const edge = {
                key,
                value: child,
                mirror,
                cycleError: getCommittedCycleError(node, key),
            }
            record.edges.push(edge)
            if (edge.cycleError || isPromise(child) || !isTracked(child)) continue

            discover(child, context)
        }
        record.state = "done"
    }
}

function stageCycleErrors(records) {
    let nextIndex = 0
    const stack = []

    for (const record of records.values()) {
        if (record.index === undefined) visit(record)
    }

    function visit(record) {
        record.index = nextIndex
        record.low = nextIndex
        nextIndex++
        stack.push(record)
        record.onStack = true

        for (const edge of record.edges) {
            if (edge.cycleError) continue
            const child = records.get(edge.value)
            if (!child) continue
            if (child.index === undefined) {
                visit(child)
                record.low = Math.min(record.low, child.low)
            } else if (child.onStack) {
                record.low = Math.min(record.low, child.index)
            }
        }

        if (record.low !== record.index) return
        const component = []
        let member
        do {
            member = stack.pop()
            member.onStack = false
            component.push(member)
        } while (member !== record)

        const members = new Set(component.map(item => item.node))
        const cyclic = component.length > 1 || component[0].edges.some(
            edge => !edge.cycleError && edge.value === component[0].node,
        )
        if (!cyclic) return

        for (const ownerRecord of component) {
            for (const edge of ownerRecord.edges) {
                if (edge.cycleError || !members.has(edge.value)) continue
                edge.cycleError = createCycleError(edge.key, ownerRecord.context)
            }
        }
    }
}

module.exports = {
    import: importValue,
    prepareImportedData,
}
