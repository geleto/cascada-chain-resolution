import * as errorUtils from "./error.js"
import * as languageProperties from "./language-properties.js"
import * as languageValues from "./language-values.js"
import * as metadata from "./meta.js"

class ExternalMutationTree {
    constructor(path = []) {
        this._children = Object.create(null)
        // Queries are relative to this node; paths remain absolute from the
        // root ContextChain so entered branches retain canonical locations.
        this._path = path
    }

    static prepare(
        root,
        operationContext,
        factsOf,
        scopeMutationPaths,
        propertyMutationPaths,
    ) {
        const requests = new ExternalMutationTree()
        let requested = false
        for (const path of scopeMutationPaths) {
            requests._add(path)._scope = true
            requested = true
        }
        for (const path of propertyMutationPaths) {
            if (path.length === 0) continue
            requests._add(path.slice(0, -1))
            requested = true
        }
        if (!requested) return undefined

        const tree = new ExternalMutationTree()
        let leafCount = 0
        const completedScopes = new Map()
        walkRequests(root, requests, [])
        return leafCount === 0 ? undefined : tree

        function walkRequests(value, request, path) {
            const type = admittedTypeOf(value)
            if (type === languageValues.TYPE_EXTERNAL) {
                addLeaf(value, path)
                return
            }
            if (!languageValues.isTraversableType(type)) return

            if (request._scope) {
                for (const relative of scanScope(
                    value,
                    new Set(),
                    completedScopes,
                ).paths) {
                    addLeaf(relative.identity, [...path, ...relative.path])
                }
                return
            }

            for (const [key, childRequest] of Object.entries(
                request._children,
            )) {
                const child = languageProperties
                    .getLanguagePlacementDescriptor(value, key, operationContext)
                if (child) {
                    walkRequests(child.value, childRequest, [...path, key])
                }
            }
        }

        function scanScope(value, ancestors, completed) {
            const type = admittedTypeOf(value)
            if (type === languageValues.TYPE_EXTERNAL) {
                return {
                    paths: [{ identity: value, path: [] }],
                    cyclic: false,
                }
            }
            if (!languageValues.isTraversableType(type)) {
                return { paths: [], cyclic: false }
            }
            if (ancestors.has(value)) return { paths: [], cyclic: true }
            const cached = completed.get(value)
            if (cached) return cached

            ancestors.add(value)
            const paths = []
            let cyclic = false
            for (const key of languageProperties.enumerableLanguageKeys(
                value,
                operationContext,
            )) {
                const child = languageProperties
                    .getLanguagePlacementDescriptor(value, key, operationContext)
                if (!child) continue
                const result = scanScope(child.value, ancestors, completed)
                cyclic ||= result.cyclic
                for (const found of result.paths) {
                    paths.push({
                        identity: found.identity,
                        path: [key, ...found.path],
                    })
                }
            }
            ancestors.delete(value)

            const result = { paths, cyclic }
            if (!cyclic) completed.set(value, result)
            return result
        }

        function admittedTypeOf(value) {
            if (!metadata.isObjectLike(value)) return undefined
            if (languageValues.isPromise(value, operationContext)) return undefined
            const facts = factsOf(value)
            if (!facts) {
                errorUtils.reportFatalError(
                    new Error(
                        "Context tree reached an identity outside the " +
                        "downward-closed admission set",
                    ),
                )
            }
            return facts.type
        }

        function addLeaf(identity, path) {
            const node = tree._add(path)
            if (!node._identity) leafCount++
            // Discovery stops at the first external boundary, so a live leaf
            // never has discovered descendants.
            node._identity = identity
        }
    }

    commit(operationContext) {
        const externalIdentities = operationContext.execution._externalIdentities
        visit(this)
        return this

        function visit(node) {
            if (node._identity) {
                let entry = externalIdentities.get(node._identity)
                if (!entry) {
                    entry = {}
                    externalIdentities.set(node._identity, entry)
                }
                node._boundaryRecord = Object.freeze({
                    entry,
                    identity: node._identity,
                    location: node,
                    path: Object.freeze([...node._path]),
                })
            }
            for (const child of Object.values(node._children)) visit(child)
        }
    }

    branch(path) {
        return this._reach(path)?.node
    }

    findBoundary(path) {
        return this._reach(path)?.boundary
    }

    findExactBoundary(path) {
        const reached = this._reach(path)
        return reached?.complete && reached.node._identity
            ? reached.node._boundary()
            : undefined
    }

    findDescendants(path) {
        const reached = this._reach(path)
        if (!reached) return []
        if (reached.boundary && !reached.complete) {
            return [reached.boundary]
        }
        const boundaries = []
        collect(reached.node)
        return boundaries

        function collect(node) {
            if (node._identity) boundaries.push(node._boundary())
            for (const child of Object.values(node._children)) collect(child)
        }
    }

    _add(path) {
        let node = this
        for (const key of path) {
            // Object-key storage intentionally canonicalizes equivalent Number
            // and String property segments without a parallel normalization.
            let child = node._children[key]
            if (!child) {
                child = new ExternalMutationTree([...node._path, key])
                node._children[key] = child
            }
            node = child
        }
        return node
    }

    _reach(path) {
        let node = this
        let boundary = node._identity ? node._boundary() : undefined
        let depth = 0
        while (!boundary && depth < path.length) {
            const key = path[depth]
            if (typeof key !== "string" && typeof key !== "number") {
                return undefined
            }
            node = node._children[key]
            if (!node) return undefined
            depth++
            if (node._identity) boundary = node._boundary()
        }
        return {
            boundary,
            complete: depth === path.length,
            node,
        }
    }

    _boundary() {
        if (!this._boundaryRecord) {
            errorUtils.reportFatalError(
                new Error("External boundary queried before tree commit"),
            )
        }
        return this._boundaryRecord
    }
}

export { ExternalMutationTree }
