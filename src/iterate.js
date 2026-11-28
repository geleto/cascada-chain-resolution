import { ArrayView, isLogicalArray } from "./array-view.js"
import { skippedCause, missingOutputMarkers, span } from "./array-layout.js"
import { CHAIN_MODE, chainFromPlacement } from "./chain.js"
import { catchExternalThrow, combineErrors, ERROR_KIND, isPoisonError, validationError } from "./error.js"
import { collectInputs, continueGraphTransition } from "./internal-step.js"
import { readLanguagePlacement } from "./language-properties.js"
import { isPending } from "./language-values.js"
import { decrementReadLease, incrementReadLease } from "./meta.js"
import { OperationOwner } from "./operation-lifecycle.js"
import { returnIteratorResult } from "./operation-result.js"
import { runOutsideGraphTransition, runReceivingCommand } from "./ownership.js"
import { PathOperation } from "./path-operation.js"
import { blockedPlacement, capturePlacementFromVersion, consumePlacementTransition, getPlacementVersion, resolvePlacementTransition, retainPlacement, structuralFailure } from "./property-versions.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { fixed } from "./array-sequence.js"
import { unorderedOccurrences } from "./array-occurrences.js"

const done = Object.freeze({ done: true })

// The cursor protects unread storage. Once a pull captures a slot, only its
// exact placement can affect that request, even if the cursor closes.
class ArrayCursor extends OperationOwner {
    index = 0
    stopped = false
    reading = false

    constructor(chain, path, operationContext, { bindingContext = operationContext, bindingMode = CHAIN_MODE.Unordered,
        firstDynamicSegment = path.length, metadata, onSkip, windowEnd = Number.MAX_SAFE_INTEGER }) {
        super(operationContext)
        if (bindingContext.execution !== operationContext.execution)
            throw new Error("Iteration binding belongs to another execution")
        this.bindingContext = bindingContext
        this.bindingMode = bindingMode
        this.unordered = chain._mode === CHAIN_MODE.Unordered
        this.onSkip = onSkip
        this.fields = metadata?.slice()
        this.windowStart = 0
        this.windowEnd = windowEnd
        const selection = this.selection = new PathOperation(chain, path, operationContext, undefined, false, firstDynamicSegment)
        const capture = value => this.capture(value)
        const selected = selection.observe(capture, access => access.read(false, capture))
        this.ready = continueGraphTransition(selection.finish(selected), operationContext, failure => {
            this.selection = undefined
            return failure
        })
        markPromiseHandled(this.ready, operationContext)
    }

    capture(value) {
        if (!this.open) return
        if (isPoisonError(value)) return value
        if (!isLogicalArray(value, this.operationContext))
            return validationError("Iteration requires a managed Array", this.operationContext, ERROR_KIND.NotIterable)
        this.length = ArrayView.readyLength(value, this.operationContext)
        if (this.length === 0) return
        if (this.unordered) this.occurrences = unorderedOccurrences(value,
            this.operationContext, () => this.wake())
        incrementReadLease(value, this.operationContext)
        this.array = value
    }

    [Symbol.asyncIterator]() { return this }
    next() { return this.step(false) }
    return() { return this.step(true) }

    step(stop) {
        const ctx = this.operationContext
        try {
            return runReceivingCommand(ctx, () => {
                if (stop) this.stop()
                if (this.stopped) return Promise.resolve(done)
                this.reading = true
                const read = continueGraphTransition(this.ready, ctx, failure => failure ?? this.readNext())
                return returnIteratorResult(ctx, continueGraphTransition(read, ctx, result => {
                    this.reading = false
                    if (this.stopped || isPoisonError(result) || result.done || !this.unordered && this.index === this.length) this.stop()
                    return result
                }))
            })
        } catch (fatal) {
            return Promise.reject(fatal)
        }
    }

    readNext() {
        return catchExternalThrow(() => {
            if (this.unordered) return this.discover()
            const ctx = this.operationContext, index = this.index
            const member = this.length === undefined ? ArrayView.captureInRange(this.array, index, ctx) : index < this.length
            if (member === false) return done
            const point = ArrayView.capturePoint(this.array, index, ctx)
            if (point) return this.bindSlot(point.placement, member, point.release)
            if (isPending(member, ctx)) {
                this.releaseConsumedPrefix()
                // A selected version and its membership question survive
                // close independently of the Array and its consumed prefix.
                const version = getPlacementVersion(this.array, index, ctx)
                if (version) return this.bindSlot(capturePlacementFromVersion(version), member)
                return continueGraphTransition(member, ctx, found => found ? this.readSlot() : done)
            }
            return this.readSlot()
        }, this.operationContext, ERROR_KIND.LookupReflectionFailed)
    }

    readSlot() {
        const ctx = this.operationContext
        const selected = catchExternalThrow(() => readLanguagePlacement(this.array, this.index, ctx),
            ctx, ERROR_KIND.LookupReflectionFailed)
        if (isPoisonError(selected)) return selected
        return this.bindSlot(selected, true)
    }

    bindSlot(selected, member, release) {
        const ctx = this.operationContext, index = this.index++
        // A pending structural transition owns its eventual binding; an ordinary
        // pending payload transfers immediately. Neither needs the old Array.
        const binding = this.bindingContext
        const metadata = this.project(index)
        const bind = () => continueGraphTransition(selected, ctx, selected =>
            consumePlacementTransition(selected, ctx, placement => this.item(placement, binding, metadata)))
        const protect = member !== true && !isPending(selected, ctx) && retainPlacement(selected, ctx)
        const step = member === true ? bind() : continueGraphTransition(member, ctx, found => {
            try { return found ? bind() : done } finally { if (protect) protect() }
        })
        const result = !release ? step : continueGraphTransition(step, ctx, result => { release(); return result })
        this.reading = false
        if (this.stopped || this.index === this.length) this.stop()
        if (this.array && isPending(result, ctx)) this.releaseConsumedPrefix()
        return result
    }

    item(placement, binding, metadata) {
        const failure = structuralFailure(placement)
        if (failure) return failure
        const item = placement.present === false ? { value: undefined, present: true } : placement
        const step = { done: false, value: chainFromPlacement(item, binding, this.bindingMode) }
        if (metadata) step.metadata = metadata
        return step
    }

    // Metadata belongs to the delivered occurrence. Its independent shape
    // questions remain valid after this cursor releases the source.
    project(index, candidate) {
        if (!this.fields?.length) return
        const ctx = this.operationContext, fields = {}
        const length = () => {
            if (this.metadataLength === undefined) {
                const capture = this.length ?? ArrayView.captureLength(this.array, ctx)
                this.metadataLength = capture?.read ? capture.read() : capture
            }
            return this.metadataLength
        }
        let reverse
        const offset = () => reverse ??= candidate?.fromEnd ? candidate.fromEnd() :
            continueGraphTransition(length(), ctx, n => continueGraphTransition(index, ctx, i => n - 1 - i))
        const oneBased = value => candidate?.ranks ? candidate.ranks.shifted(value, 1) :
            continueGraphTransition(value, ctx, i => i + 1)
        for (const name of this.fields) {
            switch (name) {
            case "index0": fields.index0 = index; break
            case "index": fields.index = oneBased(index); break
            case "first": fields.first = candidate?.first ? candidate.first() : candidate?.low > 0 ? false :
                continueGraphTransition(index, ctx, i => i === 0); break
            case "length": fields.length = length(); break
            case "revindex0": fields.revindex0 = offset(); break
            case "revindex": fields.revindex = oneBased(offset()); break
            case "last":
                fields.last = candidate?.last ? candidate.last() : typeof index === "number" ? continueGraphTransition(ArrayView.captureInRange(this.array, index + 1, ctx), ctx, present => !present) :
                    candidate?.high < this.length - 1 ? false : continueGraphTransition(offset(), ctx, i => i === 0)
                break
            }
        }
        return fields
    }

    setWindow(first, end) {
        return runReceivingCommand(this.operationContext, () => {
            this.windowStart = first
            this.windowEnd = end
            this.wake()
        })
    }

    wake() {
        const signal = this.signal
        this.signal = undefined
        signal?.resolve()
    }

    discover() {
        const ctx = this.operationContext
        for (;;) {
            let use, placement, index, candidate, metadata
            if (this.available?.length) {
                use = this.available.pop()
                ;({ placement, index, metadata } = use)
                this.uses.delete(use)
            } else if (!this.array) {
                if (this.uses?.size) return this.waitForChange()
                return this.skipped ? collectInputs([...this.skipped], ctx, combineErrors) : done
            } else if (this.occurrences) {
                candidate = this.occurrences.next(this.windowStart, this.windowEnd)
                if (!candidate) {
                    if (!this.occurrences.done(this.windowStart)) return this.waitForChange()
                    this.releaseSource()
                    continue
                }
                index = candidate.position()
                placement = candidate.read()
            } else {
                const limit = this.length ?? ArrayView.minimumLength(this.array, ctx)
                if (this.index >= this.windowEnd || this.index >= limit) {
                    if (this.index >= limit) {
                        if (this.length !== undefined) { this.releaseSource(); continue }
                        if (!this.awaitingLength) {
                            this.awaitingLength = true
                            const wait = ArrayView.resolveInRange(this.array, this.index, this, present => {
                                if (!present) this.length = this.index
                                this.awaitingLength = false
                                this.wake()
                            })
                            if (!isPending(wait, ctx)) continue
                            markPromiseHandled(wait, ctx)
                        }
                    }
                    return this.waitForChange()
                }
                index = this.index++
                placement = readLanguagePlacement(this.array, index, ctx)
            }
            if (!use && !candidate?.markers && !candidate?.capturedMarkers) metadata = this.project(index, candidate)
            if (!use && (isPending(placement, ctx) || placement.transition && !placement.transition.structuralError)) {
                use = { index, metadata, cursor: this, markers: candidate?.markers }
                ;(this.uses ??= new Set()).add(use)
                const wait = continueGraphTransition(placement, ctx, p => {
                    if (!use.cursor) return
                    use.release = retainPlacement(p, ctx)
                    const accept = ready => {
                        if (!use.cursor) return
                        use.placement = ready
                        ;(use.cursor.available ??= []).push(use)
                        use.cursor.wake()
                    }
                    return resolvePlacementTransition(p, ctx, accept, blockedPlacement)
                })
                markPromiseHandled(wait, ctx)
                continue
            }
            if (!placement.transition?.structuralError && !structuralFailure(placement)) {
                let item
                try { item = this.item(placement, this.bindingContext, metadata) } finally { use?.release?.() }
                if (this.occurrences ? this.occurrences.done() : this.index === this.length) this.releaseSource()
                return { ...item, index }
            }
            const linear = !use && !candidate
            const skipped = use?.markers ?? candidate?.markers ??
                (linear ? (this.skippedRun ??= ArrayView.captureSkippedRuns(this.array, ctx))(index) : undefined)
            const range = skipped ?? span(1, placement)
            const markers = candidate?.capturedMarkers ?? (this.onSkip && fixed(missingOutputMarkers(range, ctx)))
            const count = markers?.length ?? range.length
            const cause = markers ? continueGraphTransition(markers.ready, ctx, node => skippedCause(node, ctx)) :
                skippedCause(range, ctx)
            use?.release?.()
            if (linear) this.index = index + count
            ;(this.skipped ??= new Set()).add(cause)
            // Containment proves this credit even when its coordinate is pending.
            if (this.onSkip) {
                const end = continueGraphTransition(index, ctx, i => i + count)
                runOutsideGraphTransition(ctx, () => this.onSkip(index, end, cause, count, markers))
            }
        }
    }

    releaseConsumedPrefix() {
        const ctx = this.operationContext, prefix = this.array && ArrayView.prefixLength(this.array, ctx)
        if (prefix && (this.occurrences?.firstUnread ?? this.index) >= prefix) {
            const remaining = ArrayView.captureAfterPrefix(this.array, prefix, ctx)
            incrementReadLease(remaining, ctx)
            decrementReadLease(this.array, ctx)
            this.array = remaining
            this.skippedRun = undefined
            this.occurrences?.releasePrefix()
        }
    }

    waitForChange() {
        this.releaseConsumedPrefix()
        const signal = this.signal ??= Promise.withResolvers()
        return continueGraphTransition(signal.promise, this.operationContext, () => this.readNext(), undefined, this)
    }

    stop() {
        this.stopped = true
        if (!this.reading) this.close()
    }

    releaseSource() {
        this.occurrences?.close()
        this.occurrences = undefined
        if (this.array) decrementReadLease(this.array, this.operationContext)
        this.array = this.skippedRun = undefined
    }

    release() {
        this.releaseSource()
        this.ready = this.bindingContext = this.fields = this.metadataLength = undefined
        for (const use of this.uses ?? []) {
            use.cursor = use.placement = use.metadata = undefined
            use.release?.()
        }
        this.uses = this.available = this.skipped = this.onSkip = undefined
        // A native observation that already started owns its reservation through
        // completion. A suspended managed selection can release its path now.
        if (this.selection && !this.selection.reachedExternal) {
            this.selection.completeExternalEffect()
            this.selection.close()
        }
        this.selection = undefined
    }
}

function iterate(chain, path, operationContext, facts = {}) {
    return runReceivingCommand(operationContext, () =>
        new ArrayCursor(chain, path, operationContext, facts))
}

export { iterate }
