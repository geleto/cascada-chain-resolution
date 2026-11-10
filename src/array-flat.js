// Expand captured Array placements, never live source properties. A finite depth
// can revisit a tiny cyclic graph far more often than it produces output. Keep
// those cycles in the capture and skip silent laps before counting/materializing.
const MAX_ARRAY_LENGTH = 0xffffffff
const COUNT_LIMIT = MAX_ARRAY_LENGTH + 1

function flattenCapturedArrays(root, depth) {
    const facts = flatGraphFacts(root)
    markSilentCycles(facts)

    // Above the exact subtraction range, preserve the original Number and the
    // small consumed offset. Rounding depth-1 must not change cycle parity.
    const initial = depth > Number.MAX_SAFE_INTEGER && depth !== Infinity
        ? { base: depth, spent: 0 } : depth
    // Capacity is an exact nonnegative affine recurrence on the captured graph:
    // F(0) counts retained placements; F(d) sums child F(d-1) and scalar leaves.
    // Power that recurrence by the original Number depth, rather than unfolding
    // a near-capacity cycle or rounding a large depth minus a consumed offset.
    // Nonnegative sums/products are exact below the cap; rounding above it
    // cannot affect the capped result.
    const count = facts.get(root).height === Infinity
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
            const fact = facts.get(part.child)
            if (fact.productive || !atLeast(child.depth, fact.height)) stack.push(child)
        }
    }
    return output

    function acyclicCount(node, remaining) {
        const fact = facts.get(node)
        remaining = Math.min(remaining, fact.height)
        const counts = fact.counts ??= new Map()
        if (counts.has(remaining)) return counts.get(remaining)
        let count = 0
        if (!remaining) count = node.parts.length
        else for (const part of node.parts) {
            count = Math.min(COUNT_LIMIT, count + (part.child ? acyclicCount(part.child, remaining - 1) : 1))
            if (count === COUNT_LIMIT) break
        }
        counts.set(remaining, count)
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
                    count = Math.min(COUNT_LIMIT, count + coefficient * counts[column])
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
                        squared.set(column, Math.min(COUNT_LIMIT, previous + left * right))
                }
                return squared
            })
        }
        return counts[facts.get(root).index]
    }

    function frame(node, remaining) {
        const { height, period, transient } = facts.get(node)
        // Empty exits have vanished after the transient. Whole silent laps
        // then preserve the output, including the depth-boundary placement.
        if (period && atLeast(remaining, transient + period))
            remaining = transient + modulo(remaining, period, transient)
        else if (height !== Infinity && atLeast(remaining, height)) remaining = height
        return { node, depth: remaining, childDepth: decrement(remaining), index: 0 }
    }
}

// A back edge has infinite height and always leaves an occurrence at a finite
// depth boundary. All other facts follow directly from the captured children.
function flatGraphFacts(root) {
    const facts = new Map()
    visit(root)
    return facts

    function visit(node) {
        if (facts.has(node)) return facts.get(node)
        const fact = { index: facts.size, height: Infinity, productive: true }
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

// Silent cycles have exactly one productive child per node and no scalar
// leaves. Follow that single successor; no general component analysis is needed.
function markSilentCycles(facts) {
    const visited = new Set()
    for (const node of facts.keys()) {
        if (visited.has(node)) continue
        const path = new Map()
        let current = node
        while (current && !visited.has(current)) {
            visited.add(current)
            path.set(current, path.size)
            const fact = facts.get(current)
            const live = current.parts.filter(part => !part.child || facts.get(part.child).productive)
            fact.transient = 0
            for (const { child } of current.parts) if (child && !facts.get(child).productive)
                fact.transient = Math.max(fact.transient, facts.get(child).height + 1)
            current = live.length === 1 ? live[0].child : undefined
        }
        if (!path.has(current)) continue
        const cycle = [...path.keys()].slice(path.get(current))
        const transient = Math.max(...cycle.map(node => facts.get(node).transient))
        for (const node of cycle) Object.assign(facts.get(node), { period: cycle.length, transient })
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

// Skip acyclic shared subgraphs when collecting unlimited-depth occurrences.
function cyclicFlatInputs(root) {
    return new Set([...flatGraphFacts(root)].filter(([, fact]) => fact.height === Infinity).map(([node]) => node))
}

export { flattenCapturedArrays, cyclicFlatInputs }
