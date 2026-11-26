import { isLogicalArray } from "./array-view.js"
import { join, mapLayout, placementCounts, span, structuralPlacement } from "./array-layout.js"
import { placementValue, resolvePlacementPresence, resolvePresentPlacement } from "./property-versions.js"
import { markPromiseHandled } from "./thenable-subscription.js"
import * as steps from "./internal-step.js"
import * as values from "./language-values.js"
import * as errors from "./error.js"

const UNREAD = 0, PRESENCE_PENDING = 1, PRESENCE_READY = 2, VALUE_PENDING = 3, VALUE_READY = 4
const discarded = { value: undefined, present: true }

// One physical representation has one placement capture. Depth requests only
// extend which captured roots must be classified. Available discovery is FIFO,
// so short ready paths establish their larger depth budget before longer paths.
class FlatCapture {
    sources = new WeakMap()
    nodes = []
    queue = []
    waiting = 0
    draining = false
    finished = false

    constructor(work, read, output) { this.work = work; this.read = read; this.output = output }

    start(array, depth) {
        this.root = this.receive(array, depth)
        this.drain()
        if (this.finished) return this.root
        this.completion = Promise.withResolvers()
        return this.completion.promise
    }

    receive(array, depth) {
        let node = this.sources.get(array)
        if (!node) {
            node = { source: array, depth }
            this.sources.set(array, node)
            this.nodes.push(node)
            this.enqueue(node)
        } else this.request(node, depth)
        return node
    }

    request(node, depth) {
        if (depth <= node.depth) return
        node.depth = depth
        this.enqueue(node)
    }

    enqueue(node) {
        if (node.queued) return
        node.queued = true
        this.queue.push(node)
    }

    follow(result, callback) {
        const { work } = this
        const transition = steps.continueGraphTransition(result, work.operationContext, callback, undefined, work)
        if (!values.isPending(transition, work.operationContext)) return
        this.waiting++
        markPromiseHandled(steps.continueGraphTransition(transition, work.operationContext, () => {
            this.waiting--
            this.drain()
        }, undefined, work), work.operationContext)
    }

    drain() {
        if (this.draining || this.finished || !this.work.open) return
        this.draining = true
        try {
            for (let index = 0; index < this.queue.length; index++) {
                const node = this.queue[index]
                this.queue[index] = undefined
                node.queued = false
                if (node.parts) this.extend(node)
                else if (node.source) this.initialize(node)
            }
            this.queue.length = 0
            if (!this.waiting) {
                for (const node of this.nodes) {
                    node.parts = node.parts.filter(record => record.present)
                    for (const record of node.parts) record.input = undefined
                }
                this.finished = true
                this.completion?.resolve(this.root)
            }
        } finally { this.draining = false }
    }

    initialize(node) {
        const input = this.read(node.source)
        node.source = undefined
        this.follow(input, captured => {
            const layout = errors.isPoisonError(captured) ? span(1, captured) : captured
            const parts = new Map()
            for (const [p, count] of placementCounts(layout)) if (p)
                parts.set(p, errors.isPoisonError(p) ? { count, error: p, present: true, state: VALUE_READY } :
                    { count, input: p, state: UNREAD })
            node.parts = [...parts.values()]
            node.order = mapLayout(layout, leaf => leaf.left ? undefined :
                parts.has(leaf.placement) ? span(leaf.length, parts.get(leaf.placement)) : span(0))
            this.enqueue(node)
        })
    }

    extend(node) {
        const { work } = this
        for (const record of node.parts) {
            if (node.depth > 0 && record.state < VALUE_PENDING) {
                record.state = VALUE_PENDING
                this.follow(resolvePresentPlacement(record.input, work.operationContext, p => p), placement => {
                    record.state = VALUE_READY
                    record.present = placement.present !== false
                    // A pending version has now selected its terminal value.
                    if (record.present) record.placement = this.output(placement) ?? discarded
                    record.input = undefined
                    if (!record.present) return
                    const value = placementValue(placement)
                    if (errors.isPoisonError(value)) record.error = value
                    else if (isLogicalArray(value, work.operationContext)) record.child = this.receive(value, node.depth - 1)
                })
            } else if (record.state === UNREAD) {
                record.state = PRESENCE_PENDING
                this.follow(resolvePlacementPresence(record.input, work.operationContext, p => p), placement => {
                    record.present = placement.present !== false
                    if (record.state === PRESENCE_PENDING) {
                        record.state = PRESENCE_READY
                        if (record.present) record.placement = this.output(placement) ?? discarded
                    }
                    if (this.root.depth <= 1) record.input = undefined
                })
            } else if (record.child) this.request(record.child, node.depth - 1)
        }
    }

    release() {
        this.nodes.length = this.queue.length = 0
        this.root = this.sources = this.completion = this.read = this.output = undefined
    }
}

function finiteFlatLayout(array, depth, spent, work, read, output) {
    const capture = new FlatCapture(work, read, output)
    return steps.continueGraphTransition(capture.start(array, depth - spent), work.operationContext, root => {
        try { return flatLayout(root, depth, spent) }
        finally { capture.release() }
    }, undefined, work)
}


// A back edge has infinite height and always leaves an occurrence at a finite
// depth boundary. All other facts follow directly from the captured children.
function flatGraphFacts(root) {
    const facts = new Map()
    visit(root)
    return facts

    function visit(node) {
        if (facts.has(node)) return facts.get(node)
        const fact = { height: Infinity, productive: true }
        facts.set(node, fact)
        let height = 0, productive = false
        for (const { child } of node.parts) {
            if (!child) productive = true
            else {
                const next = visit(child)
                height = Math.max(height, next.height + 1)
                productive ||= next.productive
            }
        }
        Object.assign(fact, { height, productive })
        return fact
    }
}

// One descent can take a single child once every other branch is empty.
function prepareUnarySteps(facts) {
    for (const [node, fact] of facts) {
        let next, minimum = 1
        for (const { child, count } of node.parts) {
            if (node.parts.length > 1 && child && !facts.get(child).productive) {
                minimum = Math.max(minimum, facts.get(child).height + 1)
            } else if (child && count === 1 && !next) next = child
            else { next = undefined; break }
        }
        if (next) fact.steps = [{ target: next, minimum }]
    }
}

// Finite cyclic production is a substitution of captured occurrences. Double
// the number of expansions per pass. Once empty exits have disappeared, every
// remaining symbol emits at least one slot, so keeping the first K is exact.
function flatLayout(root, depth, spent = 0) {
    const facts = flatGraphFacts(root)
    let transient = 0
    for (const fact of facts.values()) {
        if (!fact.productive) transient = Math.max(transient, fact.height)
    }
    if (transient) prepareUnarySteps(facts)
    const empty = span(0), markers = new Map()
    function leaf(part, expand) {
        if (part.error && (expand || !part.placement)) {
            if (!markers.has(part)) markers.set(part, structuralPlacement(part.error))
            return span(1, markers.get(part))
        }
        return span(1, part.placement ?? structuralPlacement(part.error))
    }
    // Each cached step spans twice as many descents as its predecessor. The
    // second half must still have enough depth left to discard its empty exits.
    function step(node, k) {
        const steps = facts.get(node).steps
        if (!steps) return
        while (steps.length <= k) {
            const level = steps.length - 1, first = steps[level]
            if (!first) return
            const second = step(first.target, level)
            steps.push(second && { target: second.target, minimum: Math.max(first.minimum, 2 ** level + second.minimum) })
        }
        return steps[k]
    }
    function initial(node, n) {
        let fact = facts.get(node)
        n = Math.min(fact.height, n)
        for (let k = Math.floor(Math.log2(n)); k >= 0 && n && fact.steps; k--) {
            const jump = step(node, k)
            if (jump && jump.minimum <= n) {
                node = jump.target
                fact = facts.get(node)
                n -= 2 ** k
            }
        }
        if (!fact.productive && n >= fact.height) return empty
        n = Math.min(fact.height, n)
        const uses = fact.layouts ??= new Map()
        if (uses.has(n)) return uses.get(n)
        const word = substitute(node.order, part => part.present ?
            n && part.child ? initial(part.child, n - 1) : leaf(part, n > 0) : empty, new Map())
        uses.set(n, word)
        return word
    }
    const remaining = depth - spent
    if (remaining <= transient || Number.isFinite(facts.get(root).height))
        return { layout: initial(root, remaining), markers }
    // Inside a rule, a captured Array node stands for its next expansion.
    // Ordinary placement records are already terminal.
    let rules = new Map()
    for (const [node, fact] of facts) {
        if (!fact.productive) continue
        rules.set(node, substitute(node.order, part => !part.present ? empty : !part.child ?
            leaf(part, true) : facts.get(part.child).productive ? span(1, part.child) : empty, new Map()))
    }
    function substitute(word, replacement, memo) {
        if (!word.length) return word
        if (memo.has(word)) return memo.get(word)
        let result
        if (word.left) {
            const left = substitute(word.left, replacement, memo), right = substitute(word.right, replacement, memo)
            result = left === word.left && right === word.right ? word : join(left, right)
        } else {
            let part = replacement(word.placement)
            result = part === undefined ? word : empty
            if (part) for (let n = word.length; n; n = Math.floor(n / 2)) {
                if (n % 2) result = join(result, part)
                if (n > 1) part = join(part, part)
            }
        }
        memo.set(word, result)
        return result
    }
    let word = span(1, root), exponent = depth, discount = spent + transient
    // Subtract the consumed depth one binary digit at a time. Forming
    // depth-spent directly would lose its low bits above MAX_SAFE_INTEGER.
    while (exponent) {
        let digit = exponent % 2 - discount % 2
        discount = Math.floor(discount / 2)
        if (digit < 0) { digit += 2; discount++ }
        const memo = new Map(), replace = child => rules.get(child)
        if (digit) word = substitute(word, replace, memo)
        exponent = Math.floor(exponent / 2)
        if (exponent) {
            const squared = new Map()
            for (const [node, rule] of rules) squared.set(node, substitute(rule, replace, memo))
            rules = squared
        }
    }
    return { layout: substitute(word, node => facts.has(node) ? initial(node, transient) : undefined, new Map()), markers }
}

export { finiteFlatLayout }
