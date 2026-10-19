// Source-free pending-producer coverage for the opt-in N2 experiment.
// Leaves are execution-local scope numbers. Branch bits strictly decrease,
// so lookup and path copying have at most 53 levels with Number scope IDs.
// A new root shares subtrees, never a predecessor root or a scope record.
function hasCoverage(root, id) {
    while (typeof root === "object") root = side(id, root.bit) ? root.one : root.zero
    return root === id
}

function addCoverage(root, id) {
    if (root === undefined) return id
    let leaf = root
    while (typeof leaf === "object") leaf = side(id, leaf.bit) ? leaf.one : leaf.zero
    if (leaf === id) return root

    // Find the highest differing bit without truncating IDs to 32 bits.
    let bit = 1, left = leaf, right = id
    while (left !== right) {
        left = Math.floor(left / 2)
        right = Math.floor(right / 2)
        bit *= 2
    }
    bit /= 2

    const path = []
    let node = root
    while (typeof node === "object" && node.bit > bit) {
        path.push(node)
        node = side(id, node.bit) ? node.one : node.zero
    }
    let result = side(id, bit) ? branch(bit, node, id) : branch(bit, id, node)
    while (path.length) {
        const parent = path.pop()
        result = side(id, parent.bit)
            ? branch(parent.bit, parent.zero, result)
            : branch(parent.bit, result, parent.one)
    }
    return result
}

function side(id, bit) { return Math.floor(id / bit) % 2 }
function branch(bit, zero, one) { return { bit, zero, one } }

export { hasCoverage, addCoverage }
