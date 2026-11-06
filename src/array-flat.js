// Expand captured Array placements, never live source properties. A finite depth
// can revisit a tiny cyclic graph far more often than it produces output. Keep
// those cycles in the capture and skip silent laps before counting/materializing.
const MAX_ARRAY_LENGTH = 0xffffffff
const COUNT_LIMIT = MAX_ARRAY_LENGTH + 1

function flattenCapturedArrays(root, depth) {
    const facts = new Map(), active = [], components = []
    let nextIndex = 0
    visit(root)
    for (const component of components) productive(component)
    for (const component of components) {
        component.cyclic = component.nodes.length > 1 || component.nodes.some(node =>
            node.parts.some(part => part.child === node))
        if (!component.cyclic) continue
        component.branching = component.nodes.some(node => node.parts.filter(part =>
            part.child && facts.get(part.child).component === component).length > 1)
        component.emitting = component.nodes.some(node => node.parts.some(part =>
            !part.child || facts.get(part.child).component !== component &&
                facts.get(part.child).component.productive))
    }
    for (const component of components) height(component)
    for (const component of components) if (component.cyclic && !component.branching && !component.emitting) {
        component.transient = 0
        for (const node of component.nodes) for (const { child } of node.parts) if (child) {
            const target = facts.get(child).component
            if (target !== component) component.transient = Math.max(component.transient, target.height + 1)
        }
    }

    // Above the exact subtraction range, preserve the original Number and the
    // small consumed offset. Rounding depth-1 must not change cycle parity.
    const initial = depth > Number.MAX_SAFE_INTEGER && depth !== Infinity
        ? { base: depth, spent: 0 } : depth
    // Capacity is an exact nonnegative affine recurrence on the captured graph:
    // F(0) counts retained placements; F(d) sums child F(d-1) and scalar leaves.
    // Power that recurrence by the original Number depth, rather than unfolding
    // a near-capacity cycle or rounding a large depth minus a consumed offset.
    const count = facts.get(root).component.height === Infinity
        ? cyclicCount(depth) : acyclicCount(root, depth)
    if (count > MAX_ARRAY_LENGTH) return undefined

    const output = []
    if (!count) return output
    const stack = [frame(root, initial)]
    while (stack.length) {
        const current = stack.at(-1)
        if (current.index === current.node.parts.length) { stack.pop(); continue }
        const part = current.node.parts[current.index++]
        if (current.depth === 0 || !part.child) output.push(part.placement)
        else {
            const child = frame(part.child, current.childDepth)
            const component = facts.get(part.child).component
            if (component.productive || !atLeast(child.depth, component.height)) stack.push(child)
        }
    }
    return output

    // Tarjan walks the finite captured graph, not the requested unfolding depth.
    // Ordinary data-graph recursion retains the runtime's existing depth bound.
    function visit(node) {
        const fact = { index: nextIndex, low: nextIndex++, active: true, counts: new Map() }
        facts.set(node, fact)
        active.push(node)
        for (const { child } of node.parts) if (child) {
            if (!facts.has(child)) { visit(child); fact.low = Math.min(fact.low, facts.get(child).low) }
            else if (facts.get(child).active) fact.low = Math.min(fact.low, facts.get(child).index)
        }
        if (fact.low !== fact.index) return
        const component = { nodes: [] }
        let member
        do {
            member = active.pop()
            const memberFact = facts.get(member)
            memberFact.active = false
            memberFact.component = component
            component.nodes.push(member)
        } while (member !== node)
        components.push(component)
    }

    function productive(component) {
        if (component.productive !== undefined) return component.productive
        // A cycle always has a retained occurrence at a finite depth boundary.
        if (component.nodes.length > 1 || component.nodes.some(node =>
            node.parts.some(part => part.child === node))) return component.productive = true
        return component.productive = component.nodes.some(node => node.parts.some(part =>
            !part.child || productive(facts.get(part.child).component)))
    }

    function height(component) {
        if (component.height !== undefined) return component.height
        if (component.cyclic) return component.height = Infinity
        let maximum = 0
        for (const node of component.nodes) for (const { child } of node.parts) if (child)
            maximum = Math.max(maximum, height(facts.get(child).component) + 1)
        return component.height = maximum
    }

    function acyclicCount(node, remaining) {
        const fact = facts.get(node)
        remaining = Math.min(remaining, fact.component.height)
        if (fact.counts.has(remaining)) return fact.counts.get(remaining)
        let count = 0
        if (!remaining) count = node.parts.length
        else for (const part of node.parts) {
            count = Math.min(COUNT_LIMIT, count + (part.child ? acyclicCount(part.child, remaining - 1) : 1))
            if (count === COUNT_LIMIT) break
        }
        fact.counts.set(remaining, count)
        return count
    }

    function cyclicCount(exponent) {
        const constant = facts.size, rows = [], values = []
        for (const [node, fact] of facts) {
            const row = new Map()
            for (const part of node.parts) {
                const column = part.child ? facts.get(part.child).index : constant
                row.set(column, Math.min(COUNT_LIMIT, (row.get(column) ?? 0) + 1))
            }
            rows[fact.index] = row
            values[fact.index] = Math.min(COUNT_LIMIT, node.parts.length)
        }
        rows.push(new Map([[constant, 1]]))
        values.push(1)
        let power = rows, counts = values
        while (exponent) {
            if (exponent % 2) counts = power.map(row => {
                let count = 0
                for (const [column, coefficient] of row) {
                    count = Math.min(COUNT_LIMIT, count + cappedProduct(coefficient, counts[column]))
                    if (count === COUNT_LIMIT) break
                }
                return count
            })
            exponent = Math.floor(exponent / 2)
            if (!exponent) break
            power = power.map(row => {
                const squared = new Map()
                for (const [middle, left] of row) for (const [column, right] of power[middle]) {
                    const previous = squared.get(column) ?? 0
                    if (previous !== COUNT_LIMIT)
                        squared.set(column, Math.min(COUNT_LIMIT, previous + cappedProduct(left, right)))
                }
                return squared
            })
        }
        return counts[facts.get(root).index]
    }

    function frame(node, remaining) {
        const component = facts.get(node).component
        if (component.cyclic) {
            const period = component.nodes.length
            if (!component.branching && !component.emitting && atLeast(remaining, component.transient + period)) {
                // Off-cycle empty subgraphs have vanished after their own
                // height. Keep that transient and the exact residual cycle lap.
                remaining = component.transient + modulo(remaining, period, component.transient)
            }
        } else if (component.height !== Infinity && atLeast(remaining, component.height)) remaining = component.height
        return { node, depth: remaining, childDepth: decrement(remaining), index: 0 }
    }
}

function atLeast(depth, bound) {
    return typeof depth === "number" ? depth >= bound : depth.base >= bound + depth.spent
}

function modulo(depth, period, consumed) {
    const remainder = typeof depth === "number" ? depth % period :
        (depth.base % period - depth.spent % period + period) % period
    return (remainder - consumed % period + period) % period
}

function decrement(depth) {
    return typeof depth === "number" ? depth - 1 : { base: depth.base, spent: depth.spent + 1 }
}

// Both operands are exact integers up to 2^32. Avoid an imprecise product only
// when its exact value is already beyond the sole distinction we retain.
function cappedProduct(left, right) {
    return right && left > COUNT_LIMIT / right ? COUNT_LIMIT : left * right
}

// Removing finite sinks leaves exactly the nodes that can reach a cycle. Skip
// acyclic shared subgraphs when collecting unlimited-depth cycle occurrences.
function cyclicFlatInputs(root) {
    const facts = new Map(), pending = [root]
    while (pending.length) {
        const node = pending.pop()
        if (facts.has(node)) continue
        facts.set(node, { children: 0, parents: [] })
        for (const { child } of node.parts) if (child) pending.push(child)
    }
    for (const [node, fact] of facts) for (const { child } of node.parts) if (child) {
        fact.children++
        facts.get(child).parents.push(node)
    }
    const cyclic = new Set(facts.keys())
    for (const [node, fact] of facts) if (!fact.children) pending.push(node)
    while (pending.length) {
        const node = pending.pop()
        cyclic.delete(node)
        for (const parent of facts.get(node).parents) if (--facts.get(parent).children === 0) pending.push(parent)
    }
    return cyclic
}

export { flattenCapturedArrays, cyclicFlatInputs }
