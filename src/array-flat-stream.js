import { captureIdentity, compareIdentities } from "./captured-identity.js"
import { finiteFlatLayout } from "./array-flat.js"
import { capacityError, captureLayout, MAX_ARRAY_LENGTH, mapLayout, restrict, span, structuralPlacement } from "./array-layout.js"
import { appendContribution, capacitySequence, captureSequence, fixed, pendingSequence, publishFixedCopy, publishLayout, publishSequence } from "./array-sequence.js"
import { ArrayView, isLogicalArray } from "./array-view.js"
import { sliceOutput } from "./array-remap.js"
import { CHAIN_MODE } from "./chain.js"
import { ERROR_KIND, isPoisonError, intrinsicValidationError } from "./error.js"
import { collectInputs, continueGraphTransition, decideInputs } from "./internal-step.js"
import { isPending } from "./language-values.js"
import { isObjectLike } from "./meta.js"
import { OperationOwner, releaseOnClose } from "./operation-lifecycle.js"
import { createLeaseLedger } from "./ownership.js"
import { placementValue, resolvePlacementTransition, resolvePresentPlacement, resolveVisiblePlacement } from "./property-versions.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { numericInput, runArrayStep } from "./array-methods.js"

const empty = fixed(span(0))

// Suspended occurrences keep their own ancestry. Index the active identities
// by domain so an alias need only compare candidates that could be equal.
// Each descent copies one path of the binary tree, including across forks.
function activeAncestors(path, key) {
    while (path && key) {
        path = path[key % 2]
        key = Math.floor(key / 2)
    }
    return path?.top
}
function pushAncestor(path, key, identity) {
    if (!key) return { ...path, top: { identity, parent: path?.top } }
    const bit = key % 2
    return { ...path, [bit]: pushAncestor(path?.[bit], Math.floor(key / 2), identity) }
}

// A newly revealed edge can immediately re-enter an earlier branch. Expire
// all affected depth/ancestry facts before that descent, even when several
// different roots could have triggered the first change.
function invalidate(first) {
    const pending = [first]
    while (pending.length) {
        const change = pending.pop()
        if (change.done) continue
        change.done = true
        for (const parent of change.parents ?? []) pending.push(parent)
        change.parents = undefined
        change.unlink?.()
        change.signal?.resolve()
        change.signal = undefined
    }
}

function findFlatAncestor(ancestry, identity, work) {
    for (let current = ancestry; current; current = current.parent) {
        const same = compareIdentities(current.identity, identity, work)
        if (isPending(same, work.operationContext))
            return continueGraphTransition(same, work.operationContext,
                same => same ? current : findFlatAncestor(current.parent, identity, work), undefined, work)
        if (same) return current
    }
}

function flatStream(args, work) {
    const ctx = work.operationContext, producer = new OperationOwner(ctx)
    const sequential = work.mode === CHAIN_MODE.Sequential
    const append = (left, right) => appendContribution(left, right, sequential, ctx)
    const leases = createLeaseLedger(ctx), sources = new WeakMap(), receipts = new WeakMap(), domains = new WeakMap()
    const sharedDomains = new Set()
    let nextSource = 0
    const complete = work.mode === CHAIN_MODE.Complete
    let terminals = complete ? [] : undefined
    // Complete has to release successful input even while another branch is
    // collecting Errors. Hand deferred captures to their remaining discovery
    // work before dropping the whole-result lease.
    let deferred
    const marker = error => {
        if (terminals) {
            for (const p of terminals) p.value = p.sourceVersion = p.transition = p.ownFailure = undefined
            terminals = undefined
            const held = deferred
            deferred = undefined
            for (const open of held ?? []) open()
            leases.release()
            work.preparationFailed()
        }
        return { ...fixed(span(1, structuralPlacement(error))), widthFailure: error }
    }
    const inspect = action => runArrayStep(producer, action)
    let depth, consulted = false
    function readDepth() {
        if (!consulted) {
            consulted = true
            depth = numericInput(work.takeArgument(0, args), producer)
            args = undefined
            markPromiseHandled(continueGraphTransition(depth, ctx, d => { depth = d === undefined ? 1 : d }), ctx)
        }
        return depth
    }

    function repeat(part, n) {
        let output = empty
        while (n) {
            if (n % 2) output = append(output, part)
            n = Math.floor(n / 2)
            if (n) part = append(part, part)
        }
        return output
    }
    function map(node, select, memo = new Map()) {
        if (!node.length) return empty
        if (memo.has(node)) return memo.get(node)
        const output = node.left ? append(map(node.left, select, memo), map(node.right, select, memo)) :
            node.placement ? repeat(select(node.placement), node.length) : empty
        memo.set(node, output)
        return output
    }
    // Complete output can be discarded while other occurrences still require
    // discovery. Clear only private terminal placements that can retain data.
    function outputPlacement(p) {
        if (!complete || !p) return p
        if (!terminals) return
        if (!p.sourceVersion && !p.ownFailure && !isObjectLike(p.value))
            return p
        const copy = { ...p }
        terminals.push(copy)
        return copy
    }
    // The same captured expansion serves every depth that reaches all its
    // current leaves. A pending classification can change that threshold.
    function requireDepth(frame, height, change) {
        if (frame?.height === undefined) return
        frame.height = Math.max(frame.height, height)
        if (change) (frame.changes ??= new Set()).add(change)
    }
    // Reprojection consumes the captured delivery, including a synchronous
    // one, without subscribing to a settled native Promise again.
    function receive(key, read) {
        let receipt = receipts.get(key)
        if (!receipt) {
            receipts.set(key, receipt = {})
            captureReceipt(receipt, read)
        }
        return receipt
    }
    function captureReceipt(receipt, read) {
        receipt.value = read(value => {
            receipt.value = value
            invalidate(receipt)
            return value
        })
        return receipt
    }
    function firstChange(changes) {
        if (!changes) return
        if (changes.size === 1) return changes.values().next().value
        for (const change of changes) if (change.done) return change
        const change = {}
        for (const input of changes) (input.parents ??= new Set()).add(change)
        let unregister
        change.unlink = () => {
            unregister?.()
            for (const input of changes) input.parents?.delete(change)
            changes = change.unlink = unregister = undefined
        }
        unregister = releaseOnClose(producer, change.unlink)
        return change
    }
    function select(p, budget, spent, ancestry) {
        if (isPoisonError(p)) return marker(p)
        if (p.discovery) {
            const receipt = p.discovery
            if (!receipt.done) requireDepth(ancestry, 1, receipt)
            return pendingSequence(receipt.value, item => !item ? empty : item.child ?
                expandRecord(item.child, Infinity, spent + 1, ancestry) :
                item.failure ? marker(item.failure) : fixed(span(1, item.terminal)), ctx)
        }

        let resolved = p
        if (resolved.transition) {
            const presence = receive(resolved.transition, done => resolvePlacementTransition(resolved, ctx, done))
            resolved = presence.value
            if (!presence.done) {
                requireDepth(ancestry, typeof budget === "number" && budget > spent ? 1 : Infinity, presence)
                if (budget === undefined) readDepth()
                return pendingSequence(resolved, item => select(item, budget, spent, ancestry), ctx)
            }
        }
        if (resolved.present === false) return empty
        const leaf = () => fixed(span(1, outputPlacement(resolved)))
        if (typeof budget === "number" && budget <= spent) {
            requireDepth(ancestry, Infinity)
            return leaf()
        }
        const prior = receipts.get(resolved)
        let root = prior ? prior.value : placementValue(resolved)
        const scalar = value => !isPoisonError(value) && !isLogicalArray(value, ctx)
        if (!isPending(root, ctx) && scalar(root)) return leaf()
        const d = budget ?? readDepth()
        requireDepth(ancestry, typeof budget === "number" ? 1 : Infinity)
        const descend = (value, limit) => {
            if (scalar(value)) return leaf()
            if (isPoisonError(limit)) return marker(limit)
            if ((limit ?? 1) <= spent) return leaf()
            if (isPoisonError(value)) return marker(value)
            root = resolved = undefined
            return expand(value, limit ?? 1, spent + 1, ancestry)
        }
        if (!isPending(d, ctx) && !isPoisonError(d) && (d ?? 1) <= spent) return leaf()
        if (!isPending(root, ctx)) return pendingSequence(d, limit => descend(root, limit), ctx)
        const receipt = prior ?? receive(resolved, done => resolveVisiblePlacement(resolved, ctx, item => done(placementValue(item))))
        if (!receipt.done) requireDepth(ancestry, 1, receipt)
        if (!isPending(d, ctx)) return pendingSequence(receipt.value, value => descend(value, d), ctx)
        // Depth zero retains the payload immediately. A classified healthy
        // scalar also settles this occurrence at every depth.
        const choice = decideInputs([d, receipt.value], ctx, ([limit, value], _settled, remaining) => {
            if (typeof limit === "number" && limit <= spent || !isPending(value, ctx) && scalar(value)) return leaf()
            if (!remaining) return descend(value, limit)
        }, producer)
        return pendingSequence(choice, part => part, ctx)
    }
    function sourceRecord(array) {
        let record = sources.get(array)
        if (!record) {
            const identity = captureIdentity(array, ctx)
            const index = nextSource++
            let domain = domains.get(identity.domain)
            if (domain === undefined) domains.set(identity.domain, domain = index)
            else sharedDomains.add(domain)
            record = { identity, index, domain, source: array }
            sources.set(array, record)
        }
        return record
    }
    function expand(array, budget, spent, ancestry) {
        return expandRecord(sourceRecord(array), budget, spent, ancestry, array)
    }
    function expandRecord(record, budget, spent, ancestry, array = record.source) {
        // Finite depth counts physical expansions. Logical identity is a
        // dependency only for the unlimited-depth cycle marker.
        if (budget !== Infinity && budget > spent && activeAncestors(ancestry?.path, record.index)) {
            requireDepth(ancestry, Infinity)
            return finiteCycle(array, budget, spent)
        }
        const ancestor = budget === Infinity && findFlatAncestor(activeAncestors(ancestry?.path, record.domain), record.identity, producer)
        const pending = isPending(ancestor, ctx)
        if (pending) requireDepth(ancestry, Infinity)
        const unread = pending && !record.input ? createLeaseLedger(ctx) : undefined
        if (record.input) array = undefined
        unread?.acquire(array)
        return pendingSequence(ancestor, cycle => {
            try {
                if (cycle) {
                    requireDepth(ancestry, Infinity)
                    return marker(intrinsicValidationError(producer, ERROR_KIND.InvalidArrayOperation,
                        "Cannot flat an Array cycle to unlimited depth"))
                }
                readRecord(record, budget)
                return isPoisonError(record.input) ? marker(record.input) : project(record, budget, spent, ancestry)
            } finally { unread?.release(); record = array = undefined }
        }, ctx)
    }
    function readRecord(record, budget) {
        if (!record.input) {
            leases.acquire(record.source)
            record.input = captureFlatInput(record.source, ctx, inspect)
            record.source = undefined
            if (complete && budget === Infinity && !isPoisonError(record.input))
                record.input = unlimitedInput(record.input)
        }
        return record.input
    }
    // Distinct physical Arrays in one lineage can have different fallible
    // reads. Cutting a logical back-edge must precede any cached descendant.
    function sameAncestry(left, right) {
        if (left === right) return true
        for (const domain of sharedDomains)
            if (activeAncestors(left, domain) !== activeAncestors(right, domain)) return false
        return true
    }
    function project(record, budget, spent, ancestry) {
        const key = typeof budget === "number" && budget !== Infinity ?
            budget > Number.MAX_SAFE_INTEGER ? spent : Math.max(0, budget - spent) : budget
        const exact = record.byDepth?.get(key)
        if (exact) {
            requireDepth(ancestry, Infinity)
            return exact
        }
        const deep = record.expansion
        if (deep && budget - spent >= deep.height && !deep.change?.done &&
            (budget !== Infinity || sameAncestry(deep.path, ancestry?.path))) {
            requireDepth(ancestry, deep.height + 1, deep.change)
            if (!deep.change || budget !== Infinity && key === deep.key) return deep.output
            if (budget !== Infinity && complete && !terminals) return build(record, budget, spent, ancestry, key)
            // The established slots and bounds agree. Resolve new discovery
            // at this occurrence's own depth and ancestry. An observation of
            // its current interior can open just this projection sooner.
            let opened
            const resume = action => {
                if (opened) return opened
                deferred?.delete(open)
                try { return opened = action(record, budget, spent, ancestry, key) }
                finally { record = ancestry = undefined }
            }
            const open = () => resume(build)
            if (complete && budget !== Infinity) (deferred ??= new Set()).add(open)
            const changed = deep.change.value ?? (deep.change.signal ??= Promise.withResolvers()).promise
            const part = pendingSequence(changed, () => resume(project),
                ctx, deep.minimum, deep.maximum, deep.minimum ? open : undefined)
            part.head = deep.output.head
            part.tail = deep.output.tail
            if (isPoisonError(deep.output.widthFailure)) part.widthFailure = deep.output.widthFailure
            return part
        }
        return build(record, budget, spent, ancestry, key)
    }
    function build(record, budget, spent, ancestry, key) {
        const next = { path: pushAncestor(ancestry?.path, budget === Infinity ? record.domain : record.index, record.identity), height: 0 }
        const output = flattenInput(record.input, p => select(p, budget, spent, next), budget, next)
        const height = next.changes || output.node ? next.height : Infinity
        const change = Number.isFinite(height) ? firstChange(next.changes) : undefined
        next.height = next.changes = undefined
        requireDepth(ancestry, height + 1, change)
        if (Number.isFinite(height)) record.expansion = { key, output, height, change, path: budget === Infinity ? ancestry?.path : undefined,
            minimum: output.minimum, maximum: output.maximum }
        if (budget !== Infinity && (!Number.isFinite(height) || complete && !terminals)) (record.byDepth ??= new Map()).set(key, output)
        return output
    }
    // Capture only the input facts an unlimited-depth replay will consume.
    // Already classified Array edges refer to their capture, and successful
    // terminal payloads have the same lifetime as the operation's output.
    function unlimitedInput(input) {
        function slot(p) {
            if (!p || isPoisonError(p)) return p
            if (!p.transition && p.present === false) return
            if (!p.transition && !p.sourceVersion && !p.ownFailure && !isObjectLike(p.value)) return p
            const receipt = captureReceipt({}, done => resolvePresentPlacement(p, ctx, ready => {
                if (ready.present === false) return done()
                const value = placementValue(ready)
                return done(isPoisonError(value) ? { failure: value } : isLogicalArray(value, ctx) ?
                    { child: sourceRecord(value) } : { terminal: outputPlacement(ready) })
            }))
            return { discovery: receipt }
        }
        const transform = layout => mapLayout(layout, part => {
            if (!part.left) return span(part.length, slot(part.placement))
        })
        if (input.node) return fixed(transform(input.node))
        return { head: transform(input.head), ready: continueGraphTransition(input.ready, ctx, transform) }
    }
    function finiteCycle(array, budget, spent) {
        const ready = finiteFlatLayout(array, budget, spent, producer, array => {
            const input = readRecord(sourceRecord(array), budget)
            return input.ready ?? input
        }, outputPlacement)
        return pendingSequence(ready, ({ layout, markers }) => {
            if (!markers.size) return fixed(layout)
            const causes = new Set(markers.values())
            return map(layout, p => causes.has(p) ? marker(p.value) : fixed(span(1, p)))
        }, ctx)
    }
    function flattenInput(input, child, budget, frame) {
        try {
            if (input.node) return map(input.node, child)
            if (budget === undefined) readDepth()
            const head = input.head.length
            const shape = receive(input, done => continueGraphTransition(input.ready, ctx, done, undefined, producer))
            if (!shape.done) requireDepth(frame, 1, shape)
            return append(map(input.head, child), pendingSequence(shape.value, node => map(restrict(node, head, node.length), child), ctx))
        } finally { input = undefined }
    }
    function release() {
        args = terminals = deferred = undefined
        leases.release()
        producer.close()
    }
    try {
        const budget = !args.length || args[0] === undefined ? 1 : typeof args[0] === "number" ?
            Math.max(0, Math.trunc(args[0]) || 0) : undefined
        const region = budget === 0 && ArrayView.region(work.receiver, ctx)
        if (budget === 0 && (region ? region.fixedCoordinates && ArrayView.readyLength(work.receiver, ctx) !== undefined :
            ArrayView.hasStoredVersions(work.receiver, ctx) && ArrayView.tryShareStorage(work.receiver, ctx))) {
            const captured = readRecord(sourceRecord(work.receiver), budget)
            if (captured.node?.dense && !captured.node.skipped) {
                try { return work.retainOutput(region ? publishFixedCopy(captured.node, ctx) :
                    sliceOutput(work.receiver, 0, captured.node.length, ctx)) }
                finally { release() }
            }
        }
        const result = expand(work.receiver, budget, 0)
        if (complete)
            return collectInputs([result.ready, result.widthFailure], ctx, ([node, failure]) => {
                try { return failure ?? (node.length > MAX_ARRAY_LENGTH ? capacityError(ctx) : work.retainOutput(publishLayout(node, ctx))) }
                finally { release() }
            }, work)
        return work.retainOutput(publishSequence(capacitySequence(result, ctx), ctx, release))
    } catch (failure) { release(); throw failure }
}

// A descriptor failure is one failed discovery. Every other selected slot
// retains its own capture, including siblings encountered after the failure.
function captureFlatInput(array, ctx, inspect) {
    try {
        return inspect(() => {
            const region = ArrayView.region(array, ctx)
            if (region?.pending && !region.placements) return captureSequence(array, ctx, { inspect })
            const end = ArrayView.maximumLength(array, ctx)
            return fixed(captureLayout(array, ctx, end, 0, end, inspect))
        })
    } finally { array = undefined }
}

export { flatStream }
