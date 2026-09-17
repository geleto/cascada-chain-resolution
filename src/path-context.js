import * as tree from "./external-mutation-tree.js"

function capturePath(chain, path, firstDynamicSegment = path.length, scopeDepth = path.length) {
    const prefix = chain._contextOrigin
    // An entered element can share its protected Array's private root. Apply
    // that relative path once so every operation retains the structural owner.
    const rootPath = chain._rootPath
    if (rootPath) {
        firstDynamicSegment += rootPath.length
        scopeDepth += rootPath.length
    }
    path = rootPath ? [...rootPath, ...path] : [...path]
    return {
        ...tree.tracePath(chain._externalMutationTree, path, scopeDepth),
        path,
        firstDynamicSegment,
        depth: (prefix?.depth ?? 0) + path.length,
        dynamicDepth: prefix && prefix.dynamicDepth < prefix.depth + (rootPath?.length ?? 0)
            ? prefix.dynamicDepth : (prefix?.depth ?? 0) + firstDynamicSegment,
    }
}

function captureOrigin(route, depth = route.depth) {
    // The exposed root may be below this backing root; preserve its provenance.
    return { depth, dynamicDepth: route.dynamicDepth }
}

function selectEntryPath(chain, path, operationContext, firstDynamicSegment = path.length) {
    chain._assertOperationContext(operationContext)
    const route = capturePath(chain, path, firstDynamicSegment)
    const scope = route.scope
    const depth = scope ? scope[tree.TREE_NODE].path.length - (chain._contextOrigin?.depth ?? 0) : route.path.length
    const start = chain._rootPath?.length ?? 0
    return { path: route.path.slice(start, depth), firstDynamicSegment: Math.min(firstDynamicSegment, depth - start), suffix: route.path.slice(depth) }
}

export { captureOrigin, capturePath, selectEntryPath }
