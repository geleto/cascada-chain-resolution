import { MAX_COUNT } from "./array-layout.js"
import { collectInputs, continueGraphTransition } from "./internal-step.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { markPromiseHandled } from "./thenable-subscription.js"

const clamp = (n, low, high) => Math.max(low, Math.min(high, n))

// A membership question asks whether the width exceeds its index. Keep
// sorted runs of power-of-two capacity. Joining equal runs doubles that
// capacity, so a question moves O(log N) times across selecting a history.
// An offset translates an entire run without visiting its questions.
class WidthQuestions {
    runs = []
    insert(run, rank) {
        while (this.runs[rank]) {
            run = mergeRuns(this.runs[rank], run)
            this.runs[rank++] = undefined
        }
        run.owner = this
        run.rank = rank
        this.runs[rank] = run
    }
    trim(run) {
        if (!run.live) {
            this.runs[run.rank] = undefined
            while (this.runs.length && !this.runs.at(-1)) this.runs.pop()
            if (!this.runs.length) this.onEmpty?.()
        } else if (2 * run.live < run.entries.length) {
            // A single open threshold must not keep a spent run's storage.
            run.entries = run.entries.slice(run.first, run.end).filter(q => q?.deliver)
            run.first = 0
            run.end = run.entries.length
        }
    }
    answer(minimum, maximum) {
        let ready
        for (const run of this.runs) {
            if (!run) continue
            const { entries, offset } = run
            while (run.first < run.end) {
                const q = entries[run.first]
                if (q.deliver && q.index + offset >= minimum) break
                entries[run.first++] = undefined
                if (q.deliver) take(q, true)
            }
            while (run.first < run.end) {
                const q = entries[run.end - 1]
                if (q.deliver && q.index + offset < maximum) break
                entries[--run.end] = undefined
                if (q.deliver) take(q, false)
            }
            this.trim(run)
        }
        // A completed projected length can release its other threshold.
        for (const [deliver, answer] of ready ?? []) deliver(answer)
        function take(q, answer) {
            ;(ready ??= []).push([q.deliver, answer])
            q.run.live--
            q.run = q.deliver = undefined
        }
    }
}
function mergeRuns(a, b) {
    const run = { entries: [], first: 0, offset: 0 }
    while (a.first < a.end || b.first < b.end) {
        const from = b.first === b.end || a.first < a.end &&
            a.entries[a.first].index + a.offset <= b.entries[b.first].index + b.offset ? a : b
        const question = from.entries[from.first++]
        if (question.deliver) {
            question.index += from.offset
            question.run = run
            run.entries.push(question)
        }
    }
    run.end = run.live = run.entries.length
    return run
}

function questionsAt(root) {
    if (root.questions) return root.questions
    const questions = root.questions = new WidthQuestions()
    const remove = !(root instanceof LinkedWidth) && root.watch((lo, hi) => questions.answer(lo, hi))
    questions.onEmpty = () => { root.questions = undefined; if (remove) remove() }
    return questions
}

// Inside a projection's unsaturated interval, y > i means x > i - offset.
export function watchWidthIndex(width, index, deliver) {
    const root = width instanceof LinkedWidth ? width.root() : width
    if (root !== width) index -= width.offset
    const q = { index, deliver }
    const run = q.run = { entries: [q], first: 0, end: 1, live: 1, offset: 0 }
    questionsAt(root).insert(run, 0)
    return () => {
        if (!q.run) return
        const run = q.run
        q.run = q.deliver = undefined
        run.live--
        run.owner.trim(run)
    }
}

export function widthInRange(width, index) {
    if (index < width.minimum) return true
    if (index >= width.maximum) return false
    const { promise, resolve } = Promise.withResolvers()
    watchWidthIndex(width, index, resolve)
    return promise
}

function forwardQuestions(questions, width) {
    questions.onEmpty = undefined
    questions.answer(width.minimum, width.maximum)
    if (!questions.runs.length) return
    const root = width instanceof LinkedWidth ? width.root() : width
    const target = questionsAt(root), offset = root === width ? 0 : width.offset
    for (const run of questions.runs) if (run) {
        run.offset -= offset
        target.insert(run, run.rank)
    }
    questions.runs.length = 0
}

// A selected width and a clamped offset share one numeric source. Compose
// their projections when following a decided path. Neither bounds nor
// subscriptions need the layout or its values.
export class LinkedWidth {
    constructor(minimum, maximum) {
        this.low = minimum
        this.high = maximum
        this.offset = 0
    }
    static pending(minimum, maximum, ctx) {
        const width = new LinkedWidth(minimum, maximum)
        if (minimum === maximum) width.length = minimum
        else {
            const { promise, resolve } = Promise.withResolvers()
            publishWidthLength(width, promise, ctx)
            width.resolve = resolve
        }
        return width
    }
    project(n) { return clamp(n + this.offset, this.low, this.high) }
    root() {
        let part = this, path
        while (part.source instanceof LinkedWidth && part.source.source) {
            ;(path ??= []).push(part)
            part = part.source
        }
        while (path?.length) {
            const outer = path.pop(), inner = outer.source
            const low = outer.project(inner.low), high = outer.project(inner.high)
            // A nonconstant composite maps two legal adjacent widths to
            // legal adjacent widths, so its signed offset is a safe integer.
            outer.offset = low === high ? 0 : outer.offset + inner.offset
            outer.low = low
            outer.high = high
            outer.source = low === high ? undefined : inner.source
        }
        return this.source ?? this
    }
    get minimum() {
        const root = this.root()
        return root === this ? this.low : this.project(root.minimum)
    }
    get maximum() {
        const root = this.root()
        return root === this ? this.high : this.project(root.maximum)
    }
    watch(update) {
        const reader = { width: this, update, low: this.minimum, high: this.maximum }
        attachReader(reader)
        return () => { reader.remove?.(); reader.update = undefined }
    }
    select(width, active) {
        const pending = active ?? []
        const low = width.minimum, high = width.maximum
        this.low = low
        this.high = high
        if (low !== high) this.source = width
        if (this.questions) {
            const questions = this.questions
            this.questions = undefined
            forwardQuestions(questions, width)
        }
        const waiting = this.waiting
        this.waiting = undefined
        for (const reader of waiting ?? []) {
            reader.remove = undefined
            if (!reader.update) continue
            attachReader(reader)
            notifyReader(reader, pending)
        }
        this.resolve?.(low === high ? low : width.length)
        this.resolve = undefined
        if (!active) drainWidthUpdates(pending)
    }
    narrow(low, high, active) {
        if (low === this.low && high === this.high) return
        this.low = low
        this.high = high
        this.questions?.answer(low, high)
        const pending = active ?? []
        for (const reader of this.waiting ?? []) notifyReader(reader, pending)
        if (low === high) { this.resolve?.(low); this.resolve = this.waiting = undefined }
        if (!active) drainWidthUpdates(pending)
    }
}

function attachReader(reader) {
    if (reader.width.minimum === reader.width.maximum) return
    const root = reader.width.root()
    if (root instanceof LinkedWidth) {
        const waiting = root.waiting ??= new Set()
        waiting.add(reader)
        reader.remove = () => waiting.delete(reader)
    } else reader.remove = root.watch((_lo, _hi, active) => notifyReader(reader, active))
}

function notifyReader(reader, active) {
    if (!reader.update) return
    const low = reader.width.minimum, high = reader.width.maximum
    if (low === reader.low && high === reader.high) return
    reader.low = low
    reader.high = high
    if (low === high) reader.remove?.()
    if (active) active.push([reader.update, low, high])
    else reader.update(low, high)
}

export function drainWidthUpdates(pending) {
    for (let i = 0; i < pending.length; i++) {
        const [update, lo, hi] = pending[i]
        pending[i] = undefined
        update(lo, hi, pending)
    }
}

// Observe the numeric producer at its own boundary. An unrelated operation
// can remove its exact reader while the producer is still pending.
export function publishWidthLength(width, length, ctx) {
    width.length = length
    if (typeof length === "number") return
    const receipt = width.exact = {}
    markPromiseHandled(continueGraphTransition(length, ctx, n => {
        receipt.value = n
        const waiting = receipt.waiting
        receipt.waiting = undefined
        for (const read of waiting ?? []) read(n)
    }), ctx)
}

function watchExactWidth(width, deliver) {
    if (typeof width.length === "number") { deliver(width.length); return }
    const receipt = width.exact
    if (receipt.value !== undefined) { deliver(receipt.value); return }
    ;(receipt.waiting ??= new Set()).add(deliver)
    return () => receipt.waiting?.delete(deliver)
}

function watchProjectedLength(source, offset, floor, ceiling, deliver) {
    let fromFloor, fromCeiling, fromLength
    if (source.minimum + offset < floor) fromFloor = watchWidthIndex(source, floor - offset, above => { if (!above) finish(floor) })
    if (source.maximum + offset > ceiling) fromCeiling = watchWidthIndex(source, ceiling - offset - 1, above => { if (above) finish(ceiling) })
    fromLength = watchExactWidth(source, n => finish(clamp(n + offset, floor, ceiling)))
    return release
    function finish(n) {
        if (!deliver) return
        const read = deliver
        release()
        read(n)
    }
    function release() {
        fromFloor?.(); fromCeiling?.(); fromLength?.()
        fromFloor = fromCeiling = fromLength = deliver = undefined
    }
}

// The immutable numeric capture has its own use. A later write can fork or
// extend the Array's length state while this question follows the old width.
export function captureWidth(width, index, limit, owner) {
    const { promise, resolve } = Promise.withResolvers()
    let answer, unwatch, unregister
    const deliver = n => { answer = n; release(); resolve(n) }
    unwatch = index === undefined ? watchProjectedLength(width, 0, 0, limit ?? MAX_COUNT, deliver) :
        watchWidthIndex(width, index, deliver)
    if (owner && answer === undefined) unregister = releaseOnClose(owner, release)
    return { read: () => answer ?? promise, release }
    function release() {
        unwatch?.(); unregister?.()
        unwatch = unregister = undefined
    }
}

export function fixedWidth(n) { return { minimum: n, maximum: n, length: n, watch() {} } }

export function projectedCount(source, offset, ctx, floor = 0, ceiling = MAX_COUNT) {
    const lo = source.minimum, hi = source.maximum
    const minimum = clamp(lo + offset, floor, ceiling), maximum = clamp(hi + offset, floor, ceiling)
    if (minimum === maximum) return fixedWidth(minimum)
    const affine = maximum - minimum === hi - lo
    if (affine && !offset) return source
    const width = new LinkedWidth(minimum, maximum)
    width.source = source
    width.offset = offset
    if (affine) publishWidthLength(width, continueGraphTransition(source.length, ctx, n => n + offset), ctx)
    else {
        const { promise, resolve } = Promise.withResolvers()
        publishWidthLength(width, promise, ctx)
        // A clipped result can finish at either plateau before the source
        // is exact. Interior answers need only its final value.
        watchProjectedLength(source, offset, floor, ceiling, resolve)
    }
    return width
}

export const sumWidths = (a, b) => a + Math.min(MAX_COUNT - a, b)

// A prefix of an append history is a list of disjoint power-of-two blocks.
// One delivered width updates its enclosing blocks. Earlier captures can
// read their own total without subscribing every historical prefix.
class ConcatWidths {
    constructor(left, right, ctx) {
        let rest = left.blocks ?? { count: 1, width: left }
        let width = right, count = 1
        while (rest?.count === count) {
            width = sumExtent(rest.width, width, ctx)
            count *= 2
            rest = rest.rest
        }
        this.blocks = { count, width, rest }
        if (rest) publishWidthLength(this, prefixLength(this.blocks, ctx), ctx)
        else { this.length = width.length; this.exact = width.exact }
    }
    total(edge) {
        let n = 0
        for (let block = this.blocks; block && n < MAX_COUNT; block = block.rest) n = sumWidths(n, block.width[edge])
        return n
    }
    get minimum() { return this.total("minimum") }
    get maximum() { return this.total("maximum") }
    watch(update) {
        const removes = []
        let low = this.minimum, high = this.maximum
        const release = () => { while (removes.length) removes.pop()() }
        const changed = (_lo, _hi, active) => {
            const minimum = this.minimum, maximum = this.maximum
            if (low === minimum && high === maximum) return
            low = minimum; high = maximum
            if (low === high) release()
            update(low, high, active)
        }
        for (let block = this.blocks; block && low !== high; block = block.rest) {
            const remove = block.width.watch(changed)
            if (remove) removes.push(remove)
        }
        return release
    }
}
function prefixLength(blocks, ctx) {
    let widths = []
    for (let block = blocks; block; block = block.rest) widths.push(block.width)
    if (widths.reduce((n, w) => sumWidths(n, w.maximum), 0) < MAX_COUNT)
        return collectInputs(widths.map(w => w.length), ctx, counts => counts.reduce(sumWidths, 0))
    const { promise, resolve } = Promise.withResolvers()
    const receipts = [], thresholds = []
    let remaining = widths.length, sum = 0
    for (const width of widths) {
        const remove = watchExactWidth(width, n => {
            sum = sumWidths(sum, n)
            if (!--remaining || sum === MAX_COUNT) finish(sum)
        })
        if (!widths) break
        if (remove) receipts.push(remove)
    }
    watchGrowth(true)
    return promise

    function finish(n) {
        if (!widths) return
        widths = undefined
        while (receipts.length) receipts.pop()()
        while (thresholds.length) thresholds.pop()()
        resolve(n)
    }
    // If the sum reaches the cap, at least one open block has grown by
    // its share of the remaining distance. Small changes below every
    // threshold cannot affect the answer for this historical prefix.
    function watchGrowth(reached) {
        if (!reached || !widths) return
        while (thresholds.length) thresholds.pop()()
        let minimum = 0, open = 0
        for (const w of widths) {
            minimum = sumWidths(minimum, w.minimum)
            if (w.minimum !== w.maximum) open++
        }
        if (minimum === MAX_COUNT || !open) return finish(minimum)
        const step = Math.ceil((MAX_COUNT - minimum) / open)
        for (const w of widths) if (w.maximum - w.minimum >= step)
            thresholds.push(watchWidthIndex(w, w.minimum + (step - 1), watchGrowth))
    }
}

export function sumExtent(a, b, ctx, trackPrefix = false) {
    if (trackPrefix) return new ConcatWidths(a, b, ctx)
    if (a.minimum === a.maximum) return projectedCount(b, a.minimum, ctx)
    if (b.minimum === b.maximum) return projectedCount(a, b.minimum, ctx)
    const minimum = sumWidths(a.minimum, b.minimum), maximum = sumWidths(a.maximum, b.maximum)
    if (minimum === maximum) return fixedWidth(minimum)
    const count = LinkedWidth.pending(minimum, maximum, ctx)
    function changed(_lo, _hi, active) {
        if (!count.resolve) return
        const lo = sumWidths(a.minimum, b.minimum), hi = sumWidths(a.maximum, b.maximum)
        if (lo !== hi && a.minimum !== a.maximum && b.minimum !== b.maximum)
            return count.narrow(lo, hi, active)
        stopA?.(); stopB?.()
        count.select(lo === hi ? fixedWidth(lo) : a.minimum === a.maximum ?
            projectedCount(b, a.minimum, ctx) : projectedCount(a, b.minimum, ctx), active)
    }
    const stopA = a.watch(changed), stopB = b.watch(changed)
    return count
}
