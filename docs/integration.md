# Public higher-runtime integration

This document specifies the public surface completed by Phase 9D-B. The implementation is currently at the 9D-A baseline; the phase removes the existing integration-only subpath and adds the facilities below. See [the implementation plan](first-principles-conformance-plan.md#phase-9d-b-separate-graph-errors-from-expression-failure-values) for the complete cutover and tests.

Cascada imports only the documented root package API. Public Chain operations retain their result boundaries; unwrapped core operations, graph metadata, and private external-escape machinery remain package internals. Every semantic operation carries its immutable { execution, errorContext }, and related Chains share their execution. Source handles remain opaque to graph code.

The public surface supplies:

- Chain and ContextChain construction, declarations, lookup, primitive lookup, mutation, invocation, entry, import, export, and Error queries.
- Native Error classes, kinds, precise predicates, createPoisonError, validationError, and combineErrors.
- createPoisonedValue and isPoisonedValue for the separate expression failure container. Its .error is an ordinary leaf or compound Error.
- runInternalStep, continueOperation, runExternalBoundary, isPending, failExecution, and returnOperationResult for semantic work owned by the higher runtime. These reuse the kernel implementations and trust required compiler/runtime operation contexts. isPending recognizes normalized kernel results, not raw expression values.
- Public importMethodResult, using the causal InvocationFailed kind and the ordinary public result boundary, for higher-runtime-owned host protocols.

Enter a semantic body through runInternalStep and resume it through continueOperation. Supported external work uses the exact runExternalBoundary envelope after required input export and receiver selection. It owns synchronous external-action bracketing, causal classification of returned/thrown native Errors, and authoritative fatal checking at action exit. Compiler-controlled calls are trusted language work, not external actions. Host protocols select and validate their protocol data before admitting a language result.

Normalized graph results are T | PoisonError | Promise<T | PoisonError>. Causal input rejection and explicitly admitted callback-result rejection become ordinary Error data before logical completion. Publication, complete collection, and cleanup then follow the same ready/fulfilled transition. Unexpected trusted throws and rejections remain fatal; do not introduce permissive rejection handlers into every internal callback.

lookupPrimitiveValue returns Primitive | PoisonedValue | Promise<Primitive>. Its ready wrapper rejects synchronously through then; its pending result rejects with the ordinary Error. It accepts only JavaScript primitives and never coerces or deep-copies a selected object. Call and graph results stay in Chains until extracted for an expression. Cascada's own operators create attributed Errors through the same factories and use createPoisonedValue to propagate an expression failure. Assignment/import consumes those expression results through the ordinary input boundary and stores only the contained Error.

getErrors succeeds with a complete Array of ordinary Errors, empty when healthy. hasError is an existence query. Failure of either query is a separate ordinary Error result. Diagnostics consume successful inspection without rethrowing its leaves; explicit propagation combines collected Errors and wraps the result. A diagnostic object belongs in a Chain; a selected primitive diagnostic field can enter an expression.

Each public kernel operation owns its pending result once. Guarded helpers, internal scheduler commands, and constructors do not register merely for composing work. Cascada owns results it buffers or discards and never reapplies returnOperationResult to an already delegated public result. A distinct higher-runtime operation with additional required work owns its own completion, including a render that must complete final graph export. Its final failure conversion occurs outside a trusted fatal-on-escape body and before final outward settlement. Native facades reject with ordinary Errors, never expression containers.

A standalone external call exports all required arguments before invoking the Function with undefined as its receiver, then admits its result through public importMethodResult. Failed preparation collects all required Errors and suppresses invocation. Iterator advancement and finalization retain their protocol-specific rules in Phase 13. No private imports, duplicate guards, Error constructors, compatibility aliases, or second continuation mechanism are needed.
