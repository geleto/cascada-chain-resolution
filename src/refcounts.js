import * as errorUtils from "./error.js"
import * as metadata from "./meta.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import { ArrayView } from "./array-view.js"
import { getOwnPlacementVersion } from "./property-versions.js"

const COUNT_FIELDS = ["frontierCount", "errorCount"]
const OWN_FAILURE = Symbol("own placement failure")

// Identifying the cause later cannot change this edge's contribution.
function counterValue(placement) { return placement.ownFailure ? OWN_FAILURE : placement.value }

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

function getValueRefState(child, operationContext, cycleCut = false) {
    const state = { frontierCount: 0, errorCount: 0 }
    if (languageValues.isPending(child, operationContext) || cycleCut) {
        state.frontierCount = 1
    } else if (child === OWN_FAILURE || errorUtils.isPoisonError(child)) {
        state.errorCount = 1
    } else if (languageValues.isTraversable(child, operationContext)) {
        state.childCounter = getRequiredRefCounter(child, operationContext)
        for (const field of COUNT_FIELDS)
            state[field] = Number(state.childCounter[field] > 0)
    }
    return state
}

function buildRefIndex(value, operationContext, canIndex) {
    if (languageValues.isPending(value, operationContext)) return value
    languageValues.admitReadyValue(value, operationContext)
    if (
        !languageValues.isTraversable(value, operationContext) ||
        getRefCounter(value, operationContext)
    ) {
        return value
    }

    const staged = new Map()
    const active = new Set()
    let excluded = false
    try {
        visit(value)
        // A full query can encounter a virtual Array whose boundary excludes
        // its interior. Leave the optional index unbuilt across that edge.
        if (excluded) return false

        // No external reflection or subscription remains. Publish the complete region,
        // including cut targets, before adding its reverse edges to existing indexes.
        for (const { meta, counter } of staged.values()) {
            Object.assign(meta, counter)
        }
        for (const [node, { children, backingUses, span, meta }] of staged) {
            for (const [child, count] of children) addParentCounterEdge(child, node, operationContext, count)
            for (const [key, version] of backingUses) retainBackingCounter(version, node, key, operationContext)
            if (span?.region.pending) {
                meta.indexedRegion = span.region
                ;(span.region.indexed ??= new Set()).add(node)
            }
        }
        // Replaying settled values must see every new owner of a shared region.
        for (const { span } of staged.values()) span?.region.indexFixed()
        return value
    } finally { staged.clear(); active.clear(); value = undefined }

    function visit(node) {
        const existing = getRefCounter(node, operationContext) ?? staged.get(node)?.counter
        if (existing) return existing
        if (canIndex && !canIndex(node)) { excluded = true; return }
        const counter = {
            frontierCount: 0,
            errorCount: 0,
            parents: new Map(),
        }
        const children = []
        const backingUses = []
        let span
        staged.set(node, { meta: metadata.requireMeta(node, operationContext), counter, children, backingUses })
        active.add(node)
        for (const range of ArrayView.implicitRanges(node, operationContext)) {
            if (range.region.pending) { counter.frontierCount++; span = range }
            counter.errorCount += range.errors
            range.region.children(range, (p, count) => {
                if (!excluded && !p.ownFailure && languageValues.isTraversable(p.value, operationContext))
                    childEdge(p.value, count, p)
            })
            if (excluded) return
        }
        staged.get(node).span = span
        for (const key of languageProperties.enumerableLanguageKeys(node, operationContext, 0, undefined, undefined, true)) {
            const child = counterValue(languageProperties.readLanguagePlacement(node, key, operationContext))
            const backingVersion = !getOwnPlacementVersion(node, key, operationContext) &&
                ArrayView.backingVersion(node, key, operationContext)
            if (backingVersion) backingUses.push([key, backingVersion])
            if (languageValues.isPending(child, operationContext))
                counter.frontierCount++
            else if (child === OWN_FAILURE || errorUtils.isPoisonError(child)) counter.errorCount++
            else if (languageValues.isTraversable(child, operationContext)) childEdge(child, 1, key)
            if (excluded) return
        }
        active.delete(node)
        return counter

        function childEdge(child, count, key) {
            if (active.has(child)) {
                if (typeof key === "object") (counter.sharedCuts ??= new WeakSet()).add(key)
                else updateCycleCut(counter, key, true)
                counter.frontierCount += count
            } else {
                const childCounter = visit(child)
                if (!childCounter) return
                for (const field of COUNT_FIELDS) if (childCounter[field]) counter[field] += count
                children.push([childCounter, count])
            }
        }
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
function prepareCounterUpdate(
    owner,
    key,
    before,
    value,
    operationContext,
) {
    const ownerMeta = metadata.metaOf(owner, operationContext)
    if (ownerMeta?.backingOwners) {
        const updates = []
        const version = getOwnPlacementVersion(owner, key, operationContext)
        for (const [parent, logicalKey] of version?.counterProjections ?? []) {
            const update = prepareCounterUpdate(parent, logicalKey, before, value, operationContext)
            if (update) updates.push(update)
        }
        return () => { for (const update of updates) update() }
    }
    const counter = getRefCounter(owner, operationContext)
    if (!counter) return
    const backingVersion = !getOwnPlacementVersion(owner, key, operationContext) &&
        ArrayView.backingVersion(owner, key, operationContext)
    const cycleCut = prepareRefEdge(
        owner,
        counter,
        value,
        operationContext,
    )
    const previousState = getValueRefState(
        before,
        operationContext,
        counter.cycleCuts?.has(key) === true || backingVersion?.layoutChild && counter.sharedCuts?.has(backingVersion),
    )
    const nextState = getValueRefState(value, operationContext, cycleCut)
    return () => {
        if (backingVersion && (getOwnPlacementVersion(owner, key, operationContext) ||
            ArrayView.backingVersion(owner, key, operationContext) !== backingVersion))
            releaseBackingCounter(backingVersion, owner, operationContext)
        updateCycleCut(counter, key, cycleCut)
        removeParentCounterEdge(previousState.childCounter, owner, operationContext)
        addParentCounterEdge(nextState.childCounter, owner, operationContext)
        for (const field of COUNT_FIELDS)
            updateCount(counter, field, nextState[field] - previousState[field], operationContext)
    }
}

// Index construction already visits each logical placement. Maintain that
// exact optional projection until its owner overrides the slot or retires;
// shared settlement must not scan unrelated backing owners to rediscover it.
function retainBackingCounter(version, owner, key, operationContext) {
    ;(version.counterProjections ??= new Map()).set(owner, key)
    ;(metadata.requireMeta(owner, operationContext).backingCounterVersions ??= new Set()).add(version)
}

function releaseBackingCounter(version, owner, operationContext) {
    version.counterProjections?.delete(owner)
    if (!version.counterProjections?.size) delete version.counterProjections
    const meta = metadata.requireMeta(owner, operationContext)
    meta.backingCounterVersions?.delete(version)
    if (!meta.backingCounterVersions?.size) delete meta.backingCounterVersions
}

function retireRefIndex(owner, operationContext) {
    const meta = metadata.requireMeta(owner, operationContext)
    const region = meta.indexedRegion
    region?.removeIndex(owner)
    delete meta.indexedRegion
    for (const parents of meta.counterChildren ?? []) parents.delete(owner)
    for (const version of meta.backingCounterVersions ?? [])
        releaseBackingCounter(version, owner, operationContext)
    for (const field of ["parents", "frontierCount", "errorCount", "cycleCuts", "sharedCuts", "counterChildren"])
        delete meta[field]
}

function indexRegionPoint(version, owner, key, operationContext) {
    retainBackingCounter(version, owner, key, operationContext)
    updateCount(getRequiredRefCounter(owner, operationContext), "frontierCount", 1, operationContext)
}

function publishRegionCount(owner, failed, region, range, operationContext) {
    const counter = getRequiredRefCounter(owner, operationContext)
    if (range) region.children(range, (p, count) => {
        if (p.ownFailure || !languageValues.isTraversable(p.value, operationContext)) return
        const cut = prepareRefEdge(owner, counter, p.value, operationContext)
        if (cut) (counter.sharedCuts ??= new WeakSet()).add(p)
        const state = getValueRefState(p.value, operationContext, cut)
        addParentCounterEdge(state.childCounter, owner, operationContext, count)
        for (const field of COUNT_FIELDS) if (state[field]) updateCount(counter, field, count, operationContext)
    })
    delete counter.indexedRegion
    updateCount(counter, "frontierCount", -1, operationContext)
    if (failed) updateCount(counter, "errorCount", failed, operationContext)
}

function addParentCounterEdge(counter, parent, operationContext, count = 1) {
    if (!counter) return
    counter.parents.set(parent, (counter.parents.get(parent) ?? 0) + count)
    const meta = metadata.requireMeta(parent, operationContext)
    ;(meta.counterChildren ??= new Set()).add(counter.parents)
}

function removeParentCounterEdge(counter, parent, operationContext) {
    if (!counter) return
    const count = counter.parents.get(parent)
    if (count === 1) {
        counter.parents.delete(parent)
        const meta = metadata.requireMeta(parent, operationContext)
        meta.counterChildren?.delete(counter.parents)
        if (meta.counterChildren?.size === 0) delete meta.counterChildren
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
    counterValue,
    indexRegionPoint,
    publishRegionCount,
    retainBackingCounter,
    releaseBackingCounter,
    buildRefIndex,
    getRefCounter,
    getRequiredRefCounter,
    indexValueIfSourceIndexed,
    prepareCounterUpdate,
    retireRefIndex,
}
