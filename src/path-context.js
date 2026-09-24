import * as externalTree from "./external-mutation-tree.js"

function captureRoute(chain, path, firstDynamicSegment = path.length, scopeDepth = path.length) {
    const prefix = chain._contextOrigin
    // A reference keeps its unavailable or intrinsic suffix relative to the
    // captured anchor. Rebasing never turns an earlier dynamic segment static.
    const rootPath = chain._rootPath
    if (rootPath) {
        firstDynamicSegment += rootPath.length
        scopeDepth += rootPath.length
    }
    path = rootPath ? [...rootPath, ...path] : [...path]
    if (prefix && prefix.dynamicDepth < prefix.depth + (rootPath?.length ?? 0))
        firstDynamicSegment = Math.min(firstDynamicSegment, Math.max(0, prefix.dynamicDepth - prefix.depth))
    return {
        ...externalTree.tracePath(chain._externalMutationTree, path, Math.min(scopeDepth, firstDynamicSegment)),
        path,
        firstDynamicSegment,
        dynamicDepth: prefix && prefix.dynamicDepth < prefix.depth + (rootPath?.length ?? 0)
            ? prefix.dynamicDepth : (prefix?.depth ?? 0) + firstDynamicSegment,
    }
}

function capturePathOrigin(route, depth) {
    // The exposed root may be below this backing root; preserve its provenance.
    return { depth, dynamicDepth: route.dynamicDepth }
}

export { capturePathOrigin, captureRoute }
