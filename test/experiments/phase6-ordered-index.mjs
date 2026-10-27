// Live selection IDs only. Balanced height bounds lookup/update independently
// of command history; deleting a member drops its value immediately.
class OrderedIndex {
    constructor(counts) { this.counts = counts }
    set(key, value) { this.root = insert(this.root, key, value, this.counts) }
    delete(key) { this.root = remove(this.root, key, this.counts) }
    first() {
        let node = this.root
        while (node?.left) {
            this.counts.indexSteps++
            node = node.left
        }
        return node?.value
    }
    floor(key) {
        let node = this.root, value
        while (node) {
            this.counts.indexSteps++
            if (node.key > key) node = node.left
            else {
                value = node.value
                node = node.right
            }
        }
        return value
    }
}

const height = node => node?.height ?? 0
function update(node) {
    node.height = 1 + Math.max(height(node.left), height(node.right))
    return node
}
function left(node) {
    const root = node.right
    node.right = root.left
    root.left = update(node)
    return update(root)
}
function right(node) {
    const root = node.left
    node.left = root.right
    root.right = update(node)
    return update(root)
}
function balance(node) {
    update(node)
    if (height(node.left) > height(node.right) + 1) {
        if (height(node.left.right) > height(node.left.left)) node.left = left(node.left)
        return right(node)
    }
    if (height(node.right) > height(node.left) + 1) {
        if (height(node.right.left) > height(node.right.right)) node.right = right(node.right)
        return left(node)
    }
    return node
}
function insert(node, key, value, counts) {
    counts.indexSteps++
    if (!node) return { key, value, height: 1 }
    if (key < node.key) node.left = insert(node.left, key, value, counts)
    else if (key > node.key) node.right = insert(node.right, key, value, counts)
    else node.value = value
    return balance(node)
}
function remove(node, key, counts) {
    counts.indexSteps++
    if (!node) return
    if (key < node.key) node.left = remove(node.left, key, counts)
    else if (key > node.key) node.right = remove(node.right, key, counts)
    else {
        if (!node.left) return node.right
        if (!node.right) return node.left
        let next = node.right
        while (next.left) {
            counts.indexSteps++
            next = next.left
        }
        node.key = next.key
        node.value = next.value
        node.right = remove(node.right, next.key, counts)
    }
    return balance(node)
}

export { OrderedIndex }
