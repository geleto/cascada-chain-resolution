import * as externalTree from "./external-mutation-tree.js"
import { consumePathInput } from "./language-properties.js"
import * as errors from "./error.js"

function captureRoute(chain, path, firstDynamicSegment = path.length, scopeDepth = path.length) {
    const rootPath = chain._rootPath, inheritedDynamic = chain._firstDynamicSegment ?? Infinity
    const origin = chain._externalMutationTree?.[externalTree.TREE_NODE].depth ?? 0
    if (rootPath) { firstDynamicSegment += rootPath.length; scopeDepth += rootPath.length }
    path = rootPath ? [...rootPath, ...path] : [...path]
    const route = { path, dynamicDepth: origin +
        (inheritedDynamic < (rootPath?.length ?? 0) ? inheritedDynamic : firstDynamicSegment),
        origin, nodes: [chain._externalMutationTree], consumed: 0 }
    let node = chain._externalMutationTree, depth = 0
    while (node) {
        if (node[externalTree.TREE_NODE].identity) {
            if (node[externalTree.TREE_NODE].depth <= route.dynamicDepth) route.externalBoundary ??= node
            if (depth <= scopeDepth && node[externalTree.TREE_NODE].depth <= route.dynamicDepth) route.externalScope = node
        }
        if (depth === path.length) break
        const key = path[depth]
        if (typeof key !== "string" && typeof key !== "number") {
            route.dynamicDepth = Math.min(route.dynamicDepth, origin + depth)
            break
        }
        node = node[key]
        route.nodes[++depth] = node
    }
    return route
}

function consumeSegment(owner, index, onKey) {
    let route = owner.route
    if (index < route.consumed) return onKey(route.path[index])
    let input = route.path[index]
    if (typeof input !== "string" && typeof input !== "number") {
        route.dynamicDepth = Math.min(route.dynamicDepth, route.origin + index)
    }
    route.path[index] = undefined
    const accept = key => {
        try {
            route.path[index] = key
            route.consumed = index + 1
            if (!errors.isPoisonError(key)) {
                const node = route.nodes[index]?.[key]
                route.nodes[index + 1] = node
                owner.advanceRoute?.(node, index + 1)
            }
            return onKey(key)
        } finally { route = owner = onKey = undefined }
    }
    try {
        return consumePathInput(input, owner.operationContext, accept, owner)
    } finally { input = undefined }
}

export { captureRoute, consumeSegment }
