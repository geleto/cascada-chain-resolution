import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"

const COMMIT_UNINDEXED_EDGE = updateProperty => updateProperty()
const COUNT_FIELDS = ["promiseCount", "errorCount", "cycleCutCount"]

function getRefCounter(node, operationContext) {
    const meta = metadata.metaOf(node, operationContext)
    return meta?.parents ? meta : undefined
}

function getRequiredRefCounter(node, operationContext) {
    const counter = getRefCounter(node, operationContext)
    if (!counter) {
        throw new Error("Ref counts require a ref-indexed value")
    }
    return counter
}

function hasCycleCut(parent, key, operationContext) {
    return metadata.metaOf(parent, operationContext)
        ?.cycleCuts?.has(key) === true
}

function getValueRefState(child, operationContext, cycleCut = false) {
    const state = { promiseCount: 0, errorCount: 0, cycleCutCount: 0 }
    if (languageValues.isPending(child, operationContext)) {
        state.promiseCount = 1
    } else if (cycleCut) {
        state.cycleCutCount = 1
    } else if (errorUtils.isPoisonError(child)) {
        state.errorCount = 1
    } else if (languageValues.isTraversable(child, operationContext)) {
        state.childCounter = getRequiredRefCounter(child, operationContext)
        for (const field of COUNT_FIELDS)
            state[field] = Number(state.childCounter[field] > 0)
    }
    return state
}

function buildRefIndex(value, operationContext) {
    if (languageValues.isPending(value, operationContext)) return value
    languageValues.admitReadyValue(value, operationContext)
    if (
        !languageValues.isTraversable(value, operationContext) ||
        getRefCounter(value, operationContext)
    ) {
        return value
    }

    const staged = new Map()
    const pending = new Set()
    discover(value)

    // A later custom-thenable subscription in this same synchronous index build
    // can deliver earlier subscriptions in FIFO order, advancing captured versions.
    // Discover those newly available values before counting, without resubscribing
    // or rereading physical slots. Discovery can settle a version already skipped
    // in this pass, so repeat while available work makes progress.
    while (pending.size > 0) {
        let advanced = false
        for (const version of pending) {
            if (languageValues.isPending(version.value, operationContext)) continue
            pending.delete(version)
            discover(version.value)
            advanced = true
        }
        if (!advanced) break
    }

    const active = new Set()
    count(value)

    // No external reflection or subscription remains. Publish the complete region,
    // including cut targets, before adding its reverse edges to existing indexes.
    for (const { meta, counter } of staged.values()) {
        if (counter) Object.assign(meta, counter)
    }
    for (const [node, { children }] of staged) {
        for (const child of children) addParentCounterEdge(child, node)
    }
    return value

    function discover(node) {
        if (!languageValues.isTraversable(node, operationContext) ||
            getRefCounter(node, operationContext) || staged.has(node)) return
        const meta = metadata.requireMeta(node, operationContext)
        const placements = new Map()
        staged.set(node, { meta, placements, children: [] })
        for (const key of languageProperties.enumerableLanguageKeys(node, operationContext)) {
            const child = languageProperties.readLanguageProperty(node, key, operationContext)
            const version = meta.placementVersions?.[key] ?? { value: child }
            placements.set(key, version)
            if (languageValues.isPending(version.value, operationContext)) pending.add(version)
            else discover(version.value)
        }
    }

    function count(node) {
        // A required settlement during discovery may have completed this index
        // independently. Reuse it instead of overwriting its live bookkeeping.
        const existing = getRefCounter(node, operationContext)
        if (existing) return existing
        const state = staged.get(node)
        if (state.counter) return state.counter
        const counter = state.counter = {
            promiseCount: 0,
            errorCount: 0,
            cycleCutCount: 0,
            parents: new Map(),
        }
        active.add(node)
        for (const [key, version] of state.placements) {
            const child = version.value
            if (languageValues.isPending(child, operationContext))
                counter.promiseCount++
            else if (errorUtils.isPoisonError(child)) counter.errorCount++
            else if (languageValues.isTraversable(child, operationContext)) {
                if (active.has(child)) {
                    updateCycleCut(counter, key, true)
                    counter.cycleCutCount++
                } else {
                    const childCounter = count(child)
                    for (const field of COUNT_FIELDS)
                        counter[field] += Number(childCounter[field] > 0)
                    state.children.push(childCounter)
                }
            }
        }
        active.delete(node)
        return counter
    }
}

function indexValueIfSourceIndexed(
    source,
    value,
    operationContext,
) {
    if (getRefCounter(source, operationContext)) {
        buildRefIndex(value, operationContext)
    }
}

// Index the prospective child, then ask the maintained reverse-edge DAG
// whether adding parent -> child would close a cycle.
function prepareRefEdge(
    parent,
    parentCounter,
    child,
    operationContext,
) {
    if (!languageValues.isTraversable(child, operationContext)) return false
    buildRefIndex(child, operationContext)

    const visited = new Set()
    return reachesChild(parent, parentCounter)

    function reachesChild(node, counter) {
        if (node === child) return true
        if (visited.has(node)) return false
        visited.add(node)
        for (const ancestor of counter.parents.keys()) {
            if (reachesChild(
                ancestor,
                getRequiredRefCounter(ancestor, operationContext),
            )) {
                return true
            }
        }
        return false
    }
}

// Complete fallible graph preparation and capture edge contributions first.
// After storage succeeds, publish bookkeeping without callbacks or suspension.
function prepareLiveEdge(
    owner,
    key,
    value,
    operationContext,
) {
    const counter = getRefCounter(owner, operationContext)
    if (!counter) return COMMIT_UNINDEXED_EDGE

    const cycleCut = prepareRefEdge(
        owner,
        counter,
        value,
        operationContext,
    )
    const previousState = getValueRefState(
        languageProperties.readLanguageProperty(owner, key, operationContext),
        operationContext,
        counter.cycleCuts?.has(key) === true,
    )
    const nextState = getValueRefState(value, operationContext, cycleCut)
    return updateProperty => {
        updateProperty()
        updateCycleCut(counter, key, cycleCut)
        removeParentCounterEdge(previousState.childCounter, owner)
        addParentCounterEdge(nextState.childCounter, owner)
        for (const field of COUNT_FIELDS)
            updateCount(counter, field, nextState[field] - previousState[field], operationContext)
    }
}

function addParentCounterEdge(counter, parent) {
    if (!counter) return
    counter.parents.set(parent, (counter.parents.get(parent) ?? 0) + 1)
}

function removeParentCounterEdge(counter, parent) {
    if (!counter) return
    const count = counter.parents.get(parent)
    if (count === 1) {
        counter.parents.delete(parent)
    } else if (count > 1) {
        counter.parents.set(parent, count - 1)
    }
}

function updateCycleCut(counter, key, cut) {
    if (cut) {
        counter.cycleCuts ??= new Set()
        counter.cycleCuts.add(key)
        return
    }
    if (!counter.cycleCuts) return
    counter.cycleCuts.delete(key)
    if (counter.cycleCuts.size === 0) delete counter.cycleCuts
}

// One placement changes each category in only one direction. An ancestor's
// presence changes at most once, even across reconverging paths: on its first
// addition or last removal. Live counters accumulate these changes within the
// synchronous commit; unchanged presence stops propagation to further ancestors.
// Index construction and edge preparation keep this parent graph acyclic.
function updateCount(counter, field, delta, operationContext) {
    if (delta === 0) return
    const previous = counter[field]
    counter[field] += delta
    const change = Number(counter[field] > 0) - Number(previous > 0)
    if (change === 0) return
    for (const [parent, multiplicity] of counter.parents) {
        updateCount(
            getRequiredRefCounter(parent, operationContext),
            field,
            change * multiplicity,
            operationContext,
        )
    }
}

export {
    buildRefIndex,
    getRefCounter,
    getRequiredRefCounter,
    hasCycleCut,
    indexValueIfSourceIndexed,
    prepareLiveEdge,
}
