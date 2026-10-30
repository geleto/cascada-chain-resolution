import * as errors from "./error.js"
import * as steps from "./internal-step.js"
import { releaseOnClose } from "./operation-lifecycle.js"
import { TREE_NODE } from "./external-mutation-tree.js"
import { isPending } from "./language-values.js"

const EMPTY = 0, ERROR = 1, PAIR = 2, PENDING = 3, FORWARD = 4
const LEFT = 0, RIGHT = 1
const empty = { kind: EMPTY }

// A metadata version is a sparse binary tree. A pending version creates only
// the component futures actually selected. Publication forwards those parts;
// versions hold no reverse links, so unreachable history is ordinary garbage.
class State {
    size = 1
    constructor(kind, a = empty, b = empty, error) {
        this.kind = kind
        this.a = a
        this.b = b
        this.error = error
    }
}

function resolved(state) {
    let root = state
    while (root.kind === FORWARD) root = root.into
    while (state.kind === FORWARD) {
        const next = state.into
        state.into = root
        state = next
    }
    return root
}

function field(state, part) {
    state = resolved(state)
    if (state === empty) return empty
    const key = part === LEFT ? "a" : "b"
    if (state.kind === PENDING && state[key] === empty) state[key] = pending()
    return resolved(state[key])
}

function resolveSignal(signal, state) {
    if (!signal) return
    state = resolved(state)
    // Transfer the flat resolver chain without waking consumers for an alias
    // change or building a history-sized Promise-adoption microtask chain.
    if (state.kind === PENDING) {
        if (!state.signal) state.signal = signal
        else {
            state.signal.tail.next = signal
            state.signal.tail = signal.tail
            signal.tail = undefined
        }
        return
    }
    while (signal) {
        const next = signal.next
        signal.next = signal.tail = undefined
        signal.resolve()
        signal = next
    }
}

function pendingSignal() {
    const signal = Promise.withResolvers()
    signal.tail = signal
    return signal
}

function pending() { return new State(PENDING) }

function publish(future, value) {
    const merges = [[future, value]]
    while (merges.length) {
        const [heldFrom, heldTo] = merges.pop()
        const from = resolved(heldFrom), to = resolved(heldTo)
        if (from === to) continue
        // Each consumed part has its own future. Completing the containing
        // version delivers only those parts, without retaining its source.
        if (from.kind === PENDING) {
            if (from.a !== empty) merges.push([from.a, field(to, LEFT)])
            if (from.b !== empty) merges.push([from.b, field(to, RIGHT)])
        }
        const signal = from.signal
        if (to === empty) {
            from.kind = FORWARD
            from.into = empty
            from.a = from.b = from.error = from.signal = from.size = undefined
            resolveSignal(signal, empty)
            continue
        }
        // Keep the larger alias class as representative so a later merge does
        // not leave an earlier holder behind a history-length forwarding chain.
        const winner = to.size >= from.size ? to : from
        const loser = winner === from ? to : from
        if (winner === from) {
            from.kind = to.kind
            from.a = to.a
            from.b = to.b
            from.error = to.error
            from.signal = to.signal
        }
        winner.size += loser.size
        loser.kind = FORWARD
        loser.into = winner
        loser.a = loser.b = loser.error = loser.signal = loser.size = undefined
        resolveSignal(signal, winner)
    }
}

function consume(state, owner, onReady) {
    state = resolved(state)
    if (state.kind !== PENDING) return onReady(state)
    let captured = state
    const signal = state.signal ??= pendingSignal()
    const unregister = releaseOnClose(owner, () => { captured = undefined })
    return steps.continueGraphTransition(signal.promise, owner.operationContext, () => {
        const value = captured
        captured = undefined
        unregister?.()
        return consume(value, owner, onReady)
    }, undefined, owner)
}

function pair(a, b) {
    a = resolved(a)
    b = resolved(b)
    return a === empty && b === empty ? empty : new State(PAIR, a, b)
}

function childAt(map, index, span) {
    while (span > 1) {
        span /= 2
        if (index < span) map = field(map, LEFT)
        else { map = field(map, RIGHT); index -= span }
    }
    return map
}

function withChild(map, index, span, value) {
    if (span === 1) return value
    const half = span / 2
    return index < half ? pair(withChild(field(map, LEFT), index, half, value), field(map, RIGHT)) :
        pair(field(map, LEFT), withChild(field(map, RIGHT), index - half, half, value))
}

function select(state, path) {
    for (const node of path) {
        const record = node[TREE_NODE]
        state = childAt(field(state, RIGHT), record.index, record.parent[TREE_NODE].span)
    }
    return state
}

function replace(state, path, change, index = 0) {
    if (index === path.length) return change(state)
    const record = path[index][TREE_NODE], map = field(state, RIGHT)
    return pair(field(state, LEFT), withChild(map, record.index, record.parent[TREE_NODE].span,
        replace(childAt(map, record.index, record.parent[TREE_NODE].span), path, change, index + 1)))
}

function route(node, root) {
    const path = []
    while (node !== root) { path.push(node); node = node[TREE_NODE].parent }
    return path.reverse()
}

function storeOf(node, view) {
    if (view) return view
    while (node[TREE_NODE].parent) node = node[TREE_NODE].parent
    return node[TREE_NODE].metadata ??= { root: node, current: empty }
}

function replaceSubtree(store, state, node, resetOnly) {
    let before = select(state, route(node, store.root)), future = pending()
    const own = field(before, LEFT)
    store.current = replace(store.current, route(node, store.root), () =>
        // Only a reset can promise that healthy own metadata stays empty.
        // Repair-and-call and entry may publish a new own failure.
        pair(resetOnly && own === empty ? empty : field(future, LEFT), field(future, RIGHT)))
    store = state = node = undefined
    return {
        before,
        publish(value) {
            publish(future, value)
            before = future = this.before = undefined
        },
    }
}

class MetadataSelection {
    constructor(capture, node, resetOnly = true) {
        this.node = node
        this.publication = replaceSubtree(capture.store, capture.state, node, resetOnly)
    }
    narrow(node) {
        if (!this.publication || node === this.node) return
        if (!node) return this.finish(false)
        const store = { root: this.node, current: this.publication.before }
        const next = replaceSubtree(store, store.current, node, true)
        this.publication.publish(store.current)
        this.node = node
        this.publication = next
    }
    finish(success, value = empty) {
        this.publication?.publish(success ? value : this.publication.before)
        this.node = this.publication = undefined
    }
}

function enterMetadata(node, enclosing, mutable) {
    const store = storeOf(node, enclosing)
    let state = store.current
    const ancestors = [...(store.ancestors ?? [])]
    for (const child of route(node, store.root)) {
        ancestors.push(field(state, LEFT))
        state = select(state, [child])
    }
    const publication = mutable ? replaceSubtree(store, store.current, node, false) : undefined
    const view = { root: node, current: state, ancestors }
    return {
        view,
        close() {
            publication?.publish(view.current)
            view.current = undefined
            ancestors.length = 0
        },
    }
}

function collect(state, owner, found) {
    state = resolved(state)
    if (state === empty || !owner.open) return
    return consume(state, owner, state => {
        if (state === empty || !owner.open) return
        if (state.kind === ERROR) return found(state.error)
        const waits = [collect(state.a, owner, found)]
        if (owner.open) waits.push(collect(state.b, owner, found))
        const result = steps.collectInputs(waits, owner.operationContext, () => undefined, owner)
        // Completed healthy versions stay empty. Collapse them once on read,
        // so repeated queries do not rescan settled child history.
        if (owner.open && resolved(state.a) === empty && resolved(state.b) === empty) publish(state, empty)
        return result
    })
}

function nativeMutation(before = empty) {
    let own = field(before, LEFT)
    before = undefined
    const future = pending()
    return {
        state: pair(future, empty),
        finish(error) {
            publish(future, error ? new State(ERROR, empty, empty, error) : own)
            own = undefined
        },
    }
}

// PathOperation owns this capture directly; pending consumers keep their own
// selected states until they finish or their owner closes.
class MetadataCapture {
    constructor(node, view, owner) {
        this.owner = owner
        this.store = storeOf(node, view)
        this.node = this.store.root
        this.state = this.store.current
        this.ancestors = [...(this.store.ancestors ?? [])]
    }
    close() {
        this.ancestors = this.state = this.store = this.node = undefined
    }
    advance(node) {
        for (const child of route(node, this.node)) {
            const own = field(this.state, LEFT)
            if (own !== empty) this.ancestors.push(own)
            this.state = select(this.state, [child])
        }
        this.node = node
        // A resolved healthy ancestor can never block this captured view again.
        // Keep poison for repeated preflight and pending own states for later use.
        this.ancestors = this.ancestors.filter(own => resolved(own) !== empty)
    }
    blockers(node, includeSelected = true, subtree = true) {
        const found = new Set()
        return steps.continueGraphTransition(this.collect(node, error => found.add(error), includeSelected, subtree),
            this.owner.operationContext, () => found.size ? errors.combineErrors(found) : null, undefined, this.owner)
    }
    collect(node, found, includeSelected = true, subtree = true) {
        if (!node) return
        this.advance(node)
        let state = !includeSelected ? empty : subtree ? this.state : field(this.state, LEFT)
        let ancestors = [...this.ancestors], unregister
        const complete = () => {
            state = ancestors = found = undefined
            unregister?.()
            unregister = undefined
        }
        const scan = index => {
            if (index === ancestors.length) return collect(state, this.owner, found)
            return consume(ancestors[index], this.owner, own => own.kind === ERROR ? found(own.error) : scan(index + 1))
        }
        const result = scan(0)
        if (isPending(result, this.owner.operationContext)) unregister = releaseOnClose(this.owner, complete)
        return steps.continueGraphTransition(result, this.owner.operationContext, value => {
            complete()
            return value
        })
    }
    mutation(node) {
        const mutation = nativeMutation(select(this.state, route(node, this.store.root)))
        this.store.current = replace(this.store.current, route(node, this.store.root), state =>
            pair(field(mutation.state, LEFT), field(state, RIGHT)))
        return mutation
    }
}

export { MetadataCapture, empty, nativeMutation, enterMetadata, MetadataSelection }
