import { captureIdentity, reserveEntryIdentity } from "./captured-identity.js"
import { captureLayout, join, MAX_ARRAY_LENGTH, MAX_COUNT, span } from "./array-layout.js"
import { ArrayView } from "./array-view.js"
import { captureSequence, concatSequence, fixed, pendingSequence, publishSequence, refine, SelectionQuestions, trimmedSequence, watch } from "./array-sequence.js"
import { continueGraphTransition } from "./internal-step.js"
import { createLeaseLedger } from "./ownership.js"
import { resolveVisiblePlacement } from "./property-versions.js"
import { markPromiseHandled } from "./thenable-subscription.js"

const hole = Object.freeze({ value: undefined, present: false })

// Inside the entry each command sees its own prefix. The reserved public
// version grows from that prefix and closes over the last issued version.
class OpenAppend extends SelectionQuestions {
    constructor(source, bound, ctx) {
        super()
        this.ctx = ctx
        this.leases = createLeaseLedger(ctx)
        const range = ArrayView.borrowPrefix(source, ArrayView.readyLength(source, ctx), ctx)
        this.prefix = captureSequence(source, ctx, { omitEnd: range?.length })
        this.leases.acquire(source)
        this.head = this.prefix.head
        this.tail = span(0)
        this.minimum = this.prefix.minimum
        this.maximum = this.prefix.maximum + Math.min(bound ?? MAX_COUNT, MAX_COUNT - this.prefix.maximum)
        if (bound !== undefined && this.minimum !== this.prefix.maximum) {
            this.initial = this.prefix
            this.bound = bound
        }
        this.completion = Promise.withResolvers()
        this.ready = continueGraphTransition(this.completion.promise, ctx, final => final.ready)
        this.length = continueGraphTransition(this.completion.promise, ctx, final => final.length)
        this.output = publishSequence(this, ctx, () => this.leases.release(), range && { source, range })
        this.forwardIdentity = reserveEntryIdentity(source, this.output, ctx)
        this.observe(this.prefix)
    }

    get current() { return this.final || this.minimum === this.maximum ? this.prefix : undefined }

    // The private prefix can already contain unordered occurrences. Its last
    // item and a search miss still depend on whatever the open issuer adds.
    split() {
        const prefix = this.prefix
        if (prefix.maximum && !prefix.node) return [prefix, this.after(prefix)]
    }

    after(prefix) {
        const ctx = this.ctx
        if (prefix === this.prefix && this.remainder) return this.remainder
        const change = this.read(() => this.prefix !== prefix || this.current ? this.prefix : undefined)
        const remaining = pendingSequence(change, next => {
            const added = appendedAfter(prefix, next, ctx)
            return this.current === next ? added : concatSequence(added, this.after(next), ctx)
        }, ctx, 0, this.maximum - prefix.minimum)
        // All consumers of this issued prefix share one future contribution.
        if (prefix === this.prefix && !this.current) this.remainder = remaining
        return remaining
    }

    observe(current) {
        this.unwatch?.()
        const update = (_lo, _hi, pending) => {
            if (current !== this.prefix) return
            let maximum = this.maximum
            if (this.initial) {
                // The original width may still vary after every permitted
                // append has arrived. Cancel the shared prefix for this proof.
                let appended = current
                while (appended instanceof OpenAppend) appended = appended.prefix
                const [before, after] = relativeParts(this.initial, appended)
                if (!this.bound || after.minimum - (before?.maximum ?? 0) >= this.bound) this.final = true
                maximum = this.initial.maximum + Math.min(this.bound, MAX_COUNT - this.initial.maximum)
            }
            refine(this, current.minimum, this.final ? current.maximum : maximum, pending)
            this.changed()
            // Further pushes cannot change a full contribution's contents.
            // The entry still owns its identity decision through closure.
            if (this.completion && (this.final || this.minimum === this.maximum)) {
                this.completion.resolve(current)
                this.completion = this.initial = this.remainder = undefined
            }
        }
        update()
        this.unwatch = watch(current, update, this.ctx)
    }

    update(placement) {
        if (!this.completion && !this.closed) return
        const ctx = this.ctx
        // Later issuance can replace a pending private capture. Only the
        // latest one can become the public end of this contribution.
        this.placement = placement
        const wait = resolveVisiblePlacement(placement, ctx, selected => {
            if (this.placement !== placement) return
            const value = selected.value
            if (this.completion) {
                const prior = this.prefix, length = ArrayView.readyLength(value, ctx)
                const retained = createLeaseLedger(ctx)
                retained.acquire(value)
                this.leases.release()
                this.leases = retained
                // A push-only issuer preserves every earlier coordinate.
                const current = this.prefix = prior.node && length !== undefined && !ArrayView.region(value, ctx)?.pending ?
                    fixed(join(prior.node, captureLayout(value, ctx, length, prior.node.length, length))) :
                    captureSequence(value, ctx, { omitEnd: ArrayView.prefixLength(this.output, ctx) })
                this.remainder = undefined
                this.final = this.closed
                this.observe(current)
            }
            if (this.closed) {
                this.forwardIdentity(captureIdentity(value, ctx))
                this.forwardIdentity = this.placement = this.output = undefined
            }
        })
        markPromiseHandled(wait, ctx)
    }

    point(index, back) {
        return this.read(() => {
            if (index >= this.maximum) return hole
            if (this.final || (!back || this.minimum === this.maximum) && index < this.prefix.minimum)
                return this.prefix.point(index, back)
        })
    }

    seal(placement) {
        this.closed = true
        this.update(placement)
        this.changed()
    }
}

// Push preserves its predecessor. A shared left operand cancels even before
// its length settles, including when concat coalesced the two fixed tails.
function relativeParts(prefix, next) {
    while (next.maximum <= MAX_ARRAY_LENGTH && next.parts) {
        if (next.parts[0] === prefix) return [undefined, next.parts[1]]
        if (next.parts[0] !== prefix.parts?.[0]) break
        prefix = prefix.parts[1]
        next = next.parts[1]
    }
    return [prefix, next]
}

function appendedAfter(prefix, next, ctx) {
    if (prefix === next) return fixed(span(0))
    if (next instanceof OpenAppend) return next.after(prefix)
    const [before, after] = relativeParts(prefix, next)
    if (!before) return after
    return pendingSequence(before.length, n => trimmedSequence(after, n, 0, ctx), ctx,
        Math.max(0, after.minimum - before.maximum), after.maximum - before.minimum)
}

export { OpenAppend }
