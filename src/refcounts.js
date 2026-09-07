import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"

const COMMIT_UNINDEXED_EDGE = updateProperty => updateProperty()

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

function getRefCounts(value, operationContext) {
    let promiseCount = 0
    let errorCount = 0
    let cycleCutCount = 0
    if (languageValues.isPending(value, operationContext)) promiseCount = 1
    else if (errorUtils.isPoisonError(value)) errorCount = 1
    else if (languageValues.isTraversable(value, operationContext)) {
        const counter = getRequiredRefCounter(value, operationContext)
        promiseCount = counter.promiseCount
        errorCount = counter.errorCount
        cycleCutCount = counter.cycleCutCount
    }
    return { promiseCount, errorCount, cycleCutCount }
}

function getValueRefState(child, operationContext, cycleCut = false) {
    let promiseCount = 0
    let errorCount = 0
    let cycleCutCount = 0
    let childCounter
    if (languageValues.isPending(child, operationContext)) {
        promiseCount = 1
    } else if (cycleCut) {
        cycleCutCount = 1
    } else if (errorUtils.isPoisonError(child)) {
        errorCount = 1
    } else if (languageValues.isTraversable(child, operationContext)) {
        childCounter = getRequiredRefCounter(child, operationContext)
        promiseCount = childCounter.promiseCount
        errorCount = childCounter.errorCount
        cycleCutCount = childCounter.cycleCutCount
    }
    return { childCounter, promiseCount, errorCount, cycleCutCount }
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
    // can deliver earlier subscriptions in FIFO order, advancing captured mirrors.
    // Discover those newly available values before counting, without resubscribing
    // or rereading physical slots. Repeat only while available work makes progress.
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
                    counter.promiseCount += childCounter.promiseCount
                    counter.errorCount += childCounter.errorCount
                    counter.cycleCutCount += childCounter.cycleCutCount
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

// Complete fallible graph preparation before returning a commit that touches
// only the property and captured bookkeeping state.
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
    const applyCountUpdate = prepareCountUpdate(
        owner,
        counter,
        previousState,
        nextState,
        operationContext,
    )
    return updateProperty => {
        updateProperty()
        updateCycleCut(counter, key, cycleCut)
        removeParentCounterEdge(previousState.childCounter, owner)
        addParentCounterEdge(nextState.childCounter, owner)
        applyCountUpdate?.()
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

function prepareCountUpdate(
    node,
    counter,
    previousState,
    nextState,
    operationContext,
) {
    const promiseDelta = nextState.promiseCount - previousState.promiseCount
    const errorDelta = nextState.errorCount - previousState.errorCount
    const cycleCutDelta = nextState.cycleCutCount -
        previousState.cycleCutCount
    if (promiseDelta === 0 && errorDelta === 0 && cycleCutDelta === 0) {
        return undefined
    }

    const states = new Map()
    const ordered = []
    const source = visit(node, counter)
    source.multiplier = 1
    for (let index = ordered.length - 1; index >= 0; index--) {
        const state = ordered[index]
        for (const [parent, multiplicity] of state.counter.parents) {
            states.get(parent).multiplier += state.multiplier * multiplicity
        }
    }
    return () => {
        for (const { counter, multiplier } of ordered) {
            counter.promiseCount += promiseDelta * multiplier
            counter.errorCount += errorDelta * multiplier
            counter.cycleCutCount += cycleCutDelta * multiplier
        }
    }

    // Memoized DFS records parent-first postorder. Reversing it lets every
    // child contribute before a converging parent is updated.
    function visit(current, currentCounter) {
        const existing = states.get(current)
        if (existing) {
            if (!existing.complete) {
                throw new Error("Ref-count parent graph contains a cycle")
            }
            return existing
        }

        const state = {
            counter: currentCounter,
            multiplier: 0,
            complete: false,
        }
        states.set(current, state)
        for (const parent of state.counter.parents.keys()) {
            visit(parent, getRequiredRefCounter(parent, operationContext))
        }
        state.complete = true
        ordered.push(state)
        return state
    }
}

export {
    buildRefIndex,
    getRefCounter,
    getRequiredRefCounter,
    getRefCounts,
    hasCycleCut,
    indexValueIfSourceIndexed,
    prepareLiveEdge,
}
