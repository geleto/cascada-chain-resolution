# Public higher-runtime integration

This document specifies the implemented public root API and compiler handoff. ContextChain consumes the compiler mutation access tree below; Phase 13 implements its emission in Cascada.

Cascada imports only the documented root package API. Public Chain operations retain their result boundaries; unwrapped core operations, graph metadata, and private external-escape machinery remain package internals. Every semantic operation carries its immutable { execution, errorContext }, and related Chains share their execution. Source handles remain opaque to graph code.

The public surface supplies:

- Chain and ContextChain construction, declarations, lookup, expression lookup, mutation, invocation, entry, import, export, and Error queries.
- Native Error classes, kinds, precise predicates, createPoisonError, validationError, and combineErrors.
- createPoisonedValue and isPoisonedValue for the separate expression failure container. Its .error is an ordinary leaf or compound Error.
- runInternalStep, continueOperation, runExternalBoundary, isPending, failExecution, and returnOperationResult for semantic work owned by the higher runtime. These reuse the kernel implementations and trust required compiler/runtime operation contexts. isPending recognizes normalized kernel results, not raw expression values. Consume an incoming expression thenable at its input boundary; create an outgoing ready PoisonedValue after classifying pending work. Do not add a container predicate to the kernel detector.
- Public importMethodResult, using the causal InvocationFailed kind and the ordinary public result boundary, for higher-runtime-owned host protocols.

Enter a semantic body through runInternalStep and resume it through continueOperation. Supported external work uses the exact runExternalBoundary envelope after required input export and receiver selection. It owns synchronous external-action bracketing, causal classification of returned/thrown native Errors, and authoritative fatal checking at action exit. Compiler-controlled calls are trusted language work, not external actions. Host protocols select and validate their protocol data before admitting a language result.

Normalized graph results are T | PoisonError | Promise<T | PoisonError>. Causal input rejection and explicitly admitted callback-result rejection become ordinary Error data before logical completion. Publication, complete collection, and cleanup then follow the same ready/fulfilled transition. Unexpected trusted throws and rejections remain fatal; do not introduce permissive rejection handlers into every internal callback.

lookupPathForExpression returns ExpressionValue | PoisonedValue | Promise<ExpressionValue>. Its ready wrapper rejects synchronously through then; its pending result rejects with the ordinary Error. Here ExpressionValue means string | number | boolean | bigint. It rejects null, undefined, Symbols, and all non-primitives and never coerces or deep-copies a selected object. Call and graph results stay in Chains until extracted for an expression. Cascada's own operators create attributed Errors through the same factories and use createPoisonedValue to propagate an expression failure. Assignment/import consumes those expression results through the ordinary input boundary and stores only the contained Error. BigInt crosses extraction unchanged. Expression implementation and operator semantics belong to Cascada. This is the only Chain operation returning a ready PoisonedValue; expression producers and final native delivery may also use its factory. A call result used in an expression enters a Chain and is extracted at the empty path. An operator-created failure can use the factories directly without constructing a Chain just to wrap its Error.

getErrors returns null when healthy, the unchanged Error for one distinct leaf, or a CompoundPoisonError for several after complete collection. Pending results fulfill with the same null or ordinary Error; getErrors never creates a PoisonedValue. hasError is an existence query. Failure of either query is a separate ordinary Error result. Diagnostics consume successful inspection without rethrowing its leaves; explicit synchronous propagation wraps a non-null result directly without combining it again. Pending outward propagation rejects directly with that Error. A query result used in a condition first enters a Chain and crosses lookupPathForExpression. Only a successfully extracted Boolean reaches the condition continuation: neither an ordinary query Error nor its expression container is safe to test with JavaScript truthiness. Do not give hasError a second result convention. A diagnostic object belongs in a Chain; a selected primitive diagnostic field can enter an expression.

Each public kernel operation owns its pending result once. Guarded helpers, internal scheduler commands, and constructors do not register merely for composing work. Cascada owns results it buffers or discards and never reapplies returnOperationResult to an already delegated public result. A distinct higher-runtime operation with additional required work owns its own completion, including a render that must complete final graph export. Its final failure conversion occurs outside a trusted fatal-on-escape body and before final outward settlement. Native facades reject with ordinary Errors, never expression containers.

Failure conversion preserves success. A synchronously completed failure uses createPoisonedValue(error); a pending operation rejects its existing outward Promise directly with the ordinary Error. The caller first completes extraction validation or graph export and all required Error collection. This package supplies those boundaries and factories; Cascada owns expression evaluation.

| Completed normalized outcome | Expression boundary | Final native render boundary |
| --- | --- | --- |
| Ready success | Return the validated primitive | Deliver the completed exported value |
| Ready Error | Return its PoisonedValue synchronously | Return its PoisonedValue for native assimilation, or deliver the Error to the native failure callback |
| Pending success | Fulfill with the validated primitive | Fulfill with the completed exported value |
| Pending Error | Reject with the exact ordinary Error | Reject with the exact ordinary Error |

For pending completion, use the outward Promise's rejection settlement directly; create no intermediate PoisonedValue. Keep intentional rejection outside the trusted fatal-on-escape body and fatal ownership until final outward settlement. A ready container creates no Promise or fatal registration. Reuse existing guarded continuation and return machinery, without a generic projection or transport mode.

Where an input permits availability, ordinary supported-thenable consumption accepts a PoisonedValue and stores its Error. Where thenables are forbidden, use that boundary's existing validation behavior instead; declarations do not start consuming expression failures or create operation-context poison. The container has inherited then behavior. Validation of a callable placement named then is not a substitute for input consumption.

A standalone external call exports all required arguments before invoking the Function with undefined as its receiver, then admits its result through public importMethodResult. Failed preparation collects all required Errors and suppresses invocation. Iterator advancement and finalization retain their protocol-specific rules in Phase 13. No private imports, duplicate guards, Error constructors, compatibility aliases, or second continuation mechanism are needed.

## Compiler construction of the mutation access tree

`ContextChain(initialValue, operationContext, mutationAccessTree = undefined)` accepts one compiler-owned tree of potential mutation access routes. Every node is an ordinary own enumerable String-keyed property map, including endpoints represented by `{}`. The compiler emits no boundary markers, identity entries, receiver values, or poison-scope metadata. Host classification belongs to initial import.

```js
{ apis: { db: {}, config: { setting: {}, flags: {} } } }
```

Construct this tree from every potentially executed mutation in the context, including conditional work, without evaluating application expressions:

Express each route relative to its originating root ContextChain before merging it. For work inside an entered Chain, prepend the entry's contextual prefix and preserve any earlier computed segment; rebasing a relative path cannot turn that segment static. For example, a mutation of `db` inside a static entry at `apis` contributes `apis.db`, not a new root-level `db` location. Use the same canonical path composition as actual operations.

1. For a mutating call, take its complete receiver path. The method name is separate. The position of `!` selects the operation's poison scope and does not shorten this access path.
2. For assignment or deletion, take the containing path, excluding the final property key. Whole-root replacement or deletion contributes no request because it has no containing object.
3. For repair-only, take the selected scope path. Repair-and-call contributes its call receiver path; the operation still carries its selected repair scope independently.
4. Truncate each selected path immediately before its first source-computed segment. A ready result or a synchronous thenable does not make that segment static. Every retained prefix, including an empty prefix, can select an external owner if import finds one there; no prefix requests a search of its managed descendants.
5. Merge the resulting paths into one property map. Normalize literal Number keys to the same String keys used by language property access. Shared prefixes occur once. When one path ends at a node with requested children, keep the children without a separate endpoint flag: import examines every visited prefix for an external owner.

| Source operation | Compiler contribution |
| --- | --- |
| `apis.db!.write()` or `apis!.db.write()` | `{ apis: { db: {} } }` |
| `apis.db.status = value` or `delete apis.db.status` | `{ apis: { db: {} } }` |
| `apis.db[key]!.write()` | `{ apis: { db: {} } }` |
| `apis[key]!.write()` | `{ apis: {} }` |
| Mutating call on the context root, or assignment to one of its properties | `{}` |
| Whole-root replacement/deletion, with no other mutation requests | `undefined` |

Observations alone contribute no mutation request. Merely calling a method does not make its receiver externally mutable, and a managed receiver needs no tree marker. The compiler includes potential mutations regardless of which conditional branches eventually execute; initial import supplies their actual host categories.

Omitting the tree or supplying `undefined` means no requests. Supplying `{}` requests only the context root as a potential external owner. It does not select every external object below a managed root. Merging a root request with descendant requests needs no extra root marker.

Serialize all keys as own data properties, including empty String keys, `constructor`, and `__proto__`. For the latter, a generated object literal can use `["__proto__"]: {}` to avoid JavaScript's prototype-setter syntax. This is literal-key code generation and does not evaluate a source-computed path expression. The tree is finite trusted compiler data; the kernel adds no malformed-tree validation or compatibility representation.

The compiler owns the input. It may emit a fresh literal or reuse a constant across contexts and executions. The kernel leaves it unchanged and builds only the required context-local runtime branches and boundary records; it performs no preliminary deep copy and retains no compiler tree after construction. Cascada chooses allocation and code-size optimizations independently of this API.

Sharing a compiler tree does not share a runtime location. Two independent root ContextChains in one execution still make competing claims if that same compiler input selects the same exact external identity in both contexts. Different selected identities have independent entries; different executions have independent state under the existing single-execution host ownership restriction.

Initial import follows only the tree's named properties in the original context, using already staged/admitted categories. A first external identity becomes a runtime boundary record and ends traversal, even if that compiler node has children. Managed endpoints, absent or primitive values, Errors, Functions, and every Promise or thenable contribute no boundary; newly empty branches disappear. Ordinary data import still consumes thenables normally. Runtime filtering, atomic registration, and internal records are specified in [external context ordering](external-context-ordering.md#static-external-mutation-tree).

Actual operations retain their `firstDynamicSegment` source fact independently of this constructor input. Resolving a computed key to an already recorded location never grants static authority. The compiler tree contains only static prefixes and needs no such field, receiver-used flag, or `!` marker. Entry lowering uses the completed runtime tree through the public Phase 9F handoff; generated code does not inspect internal Symbols or identity entries.
