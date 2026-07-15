const {
    isPromise,
    isTracked,
    onValueResolve,
} = require("./helpers")
const {
    forbiddenKeyError,
    reportFatalError,
    validationError,
} = require("./error")
const {
    ensureMeta,
    markImported,
    metaOf,
    nodeImportContext,
} = require("./meta")
const {
    getCommittedEdgeMark,
    getPromiseMirror,
    getOrCreatePromiseMirror,
    readLogicalProperty,
} = require("./promise-mirrors")

const EMPTY_PREPARATION = {
    failure: undefined,
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

// Purely discover and validate an imported graph. The returned commit closure
// is the sole publication point for shared marks, edge marks, and mirrors.
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
    let failure
    let needsScc = false
    discover(value, rootContext)
    if (failure) return { failure, commit() {} }

    if (needsScc) markCycleEdges(records)
    return {
        failure: undefined,
        records,
        commit(commitEdgeMark) {
            for (const record of records.values()) {
                const meta = ensureMeta(record.node)
                meta.shared = true
                meta.importPrepared = true
                // Mirrors are born before marks are published so every committed
                // placement has its final storage owner when bookkeeping runs.
                for (const edge of record.edges) {
                    if (edge.edgeMark || !isPromise(edge.value) ||
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
                    if (getCommittedEdgeMark(record.node, edge.key) !== edge.edgeMark) {
                        commitEdgeMark(record.node, edge.key, edge.edgeMark)
                    }
                }
            }
        },
    }

    function discover(node, inheritedContext) {
        if (failure || !isTracked(node)) return
        if (node === writeTarget) return

        const context = nodeImportContext(node, inheritedContext)
        const existing = records.get(node)
        if (existing) {
            if (existing.state === "active") needsScc = true
            return
        }

        const record = {
            node,
            context,
            edges: [],
            state: "active",
        }
        records.set(node, record)

        for (const key of Object.keys(node)) {
            if (key === "__proto__") {
                failure = forbiddenKeyError(context)
                return
            }
            const mirror = getPromiseMirror(node, key)
            const child = readLogicalProperty(node, key)
            const edge = {
                key,
                value: child,
                mirror,
                edgeMark: getCommittedEdgeMark(node, key),
            }
            record.edges.push(edge)
            if (edge.edgeMark || isPromise(child) || !isTracked(child)) continue

            discover(child, nodeImportContext(child, context))
            if (failure) return
        }
        record.state = "done"
    }
}

function markCycleEdges(records) {
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
            if (edge.edgeMark) continue
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
            edge => !edge.edgeMark && edge.value === component[0].node,
        )
        if (!cyclic) return

        for (const ownerRecord of component) {
            for (const edge of ownerRecord.edges) {
                if (edge.edgeMark || !members.has(edge.value)) continue
                edge.edgeMark = {
                    kind: "cycle",
                    error: validationError(
                        `Cyclic property "${String(edge.key)}"`,
                        ownerRecord.context,
                    ),
                }
            }
        }
    }
}

module.exports = {
    import: importValue,
    prepareImportedData,
}
