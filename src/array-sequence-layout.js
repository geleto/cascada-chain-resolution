import { collectInputs, continueGraphTransition } from "./internal-step.js"
import { isPending } from "./language-values.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import { join, MAX_COUNT } from "./array-layout.js"
import { retainPlacement } from "./property-versions.js"
import { getOrCreateMeta, TYPE } from "./meta.js"
import { linkRetentionParent, unlinkRetentionParent } from "./parent-placements.js"

// A pending selection can acquire its data after a consumer starts using it.
// Selecting the same captured input for a second observer adds no new lease.
export class SelectedOperands {
    uses = 0
    constructor(input) { this.input = input }
    select(operands, ctx) {
        if (operands === this.input) return
        const previous = this.input
        this.input = operands
        // Both paths originate at this selector. An operand reached while
        // installing the new path cannot disconnect when the old one leaves.
        const retained = this.uses && operands && previous ? new Set() : undefined
        if (this.uses && operands) updateOperands(operands, ctx, true, this, retained)
        if (this.readUses && operands) updateOperands(operands, ctx, true)
        if (this.readUses && previous) updateOperands(previous, ctx, false)
        if (this.uses && previous) updateOperands(previous, ctx, false, this, retained)
    }
}

export function combineOperands(a, b) {
    if (!a || a === b) return b
    if (!b) return a
    return { left: a, right: b, uses: 0 }
}

// Fixed inputs are the actual restricted layout. An open join retains its
// contributing inputs. Neither a numeric question nor a discarded range
// owns a lease. Joins can form a command-history-sized spine.
export function layoutOperands(node) { return node.stored || node.shared ? node : undefined }

function updateOperands(root, ctx, retain, parent, retained) {
    const read = !parent
    const stack = [[root, parent]]
    while (stack.length) {
        const [part, source] = stack.pop()
        if (part.height && !layoutOperands(part)) continue
        if (read) {
            part.readUses = (part.readUses ?? 0) + (retain ? 1 : -1)
            if (part.readUses !== Number(retain)) continue
        } else {
            const meta = getOrCreateMeta(part, ctx, TYPE.Primitive)
            if (retain) {
                retained?.add(part)
                linkRetentionParent(part, source, ctx)
                part.uses = (part.uses ?? 0) + 1
                if (part.uses > 1) continue
            }
            else {
                unlinkRetentionParent(part, source, ctx, retained?.has(part))
                if (--part.uses) continue
            }
            meta.relationshipsActive = retain
        }
        const owner = read ? undefined : part
        if (part.left) {
            if (part.right !== part.left) stack.push([part.right, owner])
            stack.push([part.left, owner])
        }
        else if (part instanceof SelectedOperands) {
            if (!(read ? part.uses : part.readUses)) {
                if (retain) part.activate?.()
                else part.suspend?.()
            }
            if (part.input) stack.push([part.input, owner])
        } else if (read) {
            if (retain) part.releaseRead = retainPlacement(part.placement, ctx)
            else { part.releaseRead(); part.releaseRead = undefined }
        } else if (retain) part.releasePlacement = retainPlacement(part.placement, ctx, part)
        else { part.releasePlacement(); part.releasePlacement = undefined }
    }
}

// Several readers can wait on one structural choice. Removing the last
// reader leaves only a data-free receipt subscribed to the original signal.
export function selectionReceipt(input, ctx) {
    let listeners
    function deliver() {
        input = undefined
        const waiting = listeners
        listeners = undefined
        for (const resume of waiting) resume()
    }
    return wake => {
        if (input === undefined) return
        const subscribe = !listeners
        const waiting = listeners ??= new Set()
        waiting.add(wake)
        if (subscribe) markPromiseHandled(continueGraphTransition(input, ctx, deliver), ctx)
        if (input !== undefined) return () => waiting.delete(wake)
    }
}

function watchSignal(signal, wake, ctx) {
    return (signal.watch ??= selectionReceipt(signal.pending, ctx))(wake)
}

// A control can select a smaller layout before the original source closes.
// An active data consumer follows that selection. Disconnected forward state
// can make the same choice on re-entry without keeping a reverse reference.
class SelectedLayout extends SelectedOperands {
    constructor(input, choice, select, ctx) {
        super(input)
        this.choice = choice
        this.selectChild = select
        this.ctx = ctx
        const { promise, resolve } = Promise.withResolvers()
        this.forward = { signal: { pending: promise }, project: node => node, selection: this }
        this.resolve = resolve
    }
    current(initial = false) {
        if (this.child || this.choice.pending) return this.child
        // A later start can settle before all its predecessors. Building it
        // can request a restriction of any decided predecessor. Prepare those
        // first, stopping at fixed data and at still-undecided choices.
        const stack = [this], building = [], seen = new Set()
        while (stack.length) {
            const part = stack.pop()
            if (!part || part.height) continue
            if (part === building.at(-1)) {
                building.pop()
                part.build(part === this && initial)
                continue
            }
            if (seen.has(part)) continue
            seen.add(part)
            if (part instanceof SelectedLayout) {
                if (part.child || part.choice.pending) continue
                building.push(part)
                stack.push(part, part.input)
            } else if (part instanceof SelectedOperands) stack.push(part.input)
            else stack.push(part.left, part.right)
        }
        return this.child
    }
    build(initial) {
        const child = this.child = this.selectChild(this.choice.value)
        this.choice = this.selectChild = undefined
        if (initial) this.input = child.operands
        else this.select(child.operands, this.ctx)
        this.forward.left = capture(child, this.ctx)
    }
    activate(initial = true) {
        if (!this.resolve) return
        const child = this.current(initial)
        // A re-entered publication may already have assembled this node.
        const signal = child ? this.forward.left?.signal : this.choice
        if (signal?.pending) this.unwatch = watchSignal(signal, this.wake, this.ctx)
        else {
            this.forward.signal.pending = undefined
            this.forward.selection = undefined
            this.resolve()
            this.resolve = undefined
        }
    }
    wake = () => { this.unwatch = undefined; this.activate(false) }
    suspend() { this.unwatch?.(); this.unwatch = undefined }
}

export function selectSequenceLayout(output, operands, choice, select, ctx) {
    const use = new SelectedLayout(operands, choice, select, ctx)
    output.operands = use
    defineReady(output, use.forward, ctx)
    return () => use.current()
}

export function retainOperands(root, ctx, parent) {
    if (!root) return
    updateOperands(root, ctx, true, parent)
    return () => {
        if (root) { updateOperands(root, ctx, false, parent); root = parent = undefined }
    }
}

// A structural signal carries availability only. An active publication or
// an independent data reader owns the forward operands needed for assembly.
function capture(sequence, ctx) {
    if (sequence.node) return sequence
    if (sequence.layoutSource) return sequence.layoutSource
    const source = sequence.layoutSource = {}
    const ready = sequence.ready
    if (!isPending(ready, ctx)) source.node = ready
    else {
        const signal = source.signal = {}
        signal.pending = continueGraphTransition(ready, ctx, node => { source.node = node; signal.pending = undefined })
        markPromiseHandled(signal.pending, ctx)
    }
    return source
}

function joinedSignal(left, right, leftLength, canSaturate, ctx) {
    const a = left?.pending, b = right?.pending
    if (!b || left === right) return left
    if (!a && !canSaturate) return right
    const required = canSaturate ? continueGraphTransition(leftLength, ctx, n => n === MAX_COUNT ? undefined : b) : b
    if (!a && required === b) return right
    const signal = {}
    signal.pending = collectInputs([a, required], ctx, () => { signal.pending = undefined })
    markPromiseHandled(signal.pending, ctx)
    return signal
}

// Joins and unary projections form a DAG of captured operands. Settlement
// may expose a history-sized spine even when it produces a very small Array.
export function readSequenceLayout(source, probe = false) {
    if (source.node) return source.node
    const stack = [source]
    while (stack.length) {
        const part = stack[stack.length - 1], left = part.left, right = part.right
        if (probe && (!left || part.prerequisite?.pending)) return
        if (!left.node) { stack.push(left); continue }
        if (right && left.node.length < MAX_COUNT && !right.node) { stack.push(right); continue }
        if (!right) part.node = part.project(left.node)
        else part.node = left.node.length === MAX_COUNT ? left.node : join(left.node, right.node)
        part.left = part.right = part.project = part.prerequisite = undefined
        stack.pop()
    }
    return source.node
}

export function deriveSequenceLayout(output, left, right, project, ctx, prerequisite) {
    if (!right && left.operands) output.operands = left.operands
    const a = capture(left, ctx), b = right && capture(right, ctx)
    const signal = b ? joinedSignal(a.signal, b.signal, left.length, left.maximum === MAX_COUNT, ctx) :
        joinedSignal(a.signal, prerequisite, undefined, false, ctx)
    defineReady(output, { left: a, right: b, project, signal, prerequisite, selection: Boolean(a.selection || b?.selection) }, ctx)
}

// An independent layout reader must drive unresolved range choices. Each
// choice ends its own use when its selected layout settles. Fixed data
// already belongs to the caller, which may discard it before a sibling ends.
function requestSelections(source, ctx) {
    const stack = [source]
    while (stack.length) {
        const part = stack.pop(), selection = part.selection
        part.selection = undefined
        if (!selection || !part.signal?.pending) continue
        if (selection === true) {
            if (part.left?.selection) stack.push(part.left)
            if (part.right?.selection) stack.push(part.right)
        } else {
            const release = retainOperands(selection, ctx)
            markPromiseHandled(continueGraphTransition(part.signal.pending, ctx, release), ctx)
        }
    }
}

function defineReady(output, source, ctx) {
    output.layoutSource = source
    let result
    Object.defineProperty(output, "ready", { configurable: true, get() {
        if (!source.signal?.pending) return readSequenceLayout(source)
        if (!result) {
            if (source.selection) requestSelections(source, ctx)
            result = continueGraphTransition(source.signal.pending, ctx, () => readSequenceLayout(source))
        }
        return result
    } })
}
