# Trusted runtime integration

`cascada-chain-resolution/integration` is the compiler and higher-runtime composition surface. It re-exports the kernel implementations rather than wrapping public operations. Every operation receives its immutable `{ execution, errorContext }`; related Chains use that execution. The source handle is opaque and may contain all compiler diagnostic facts without graph code inspecting their shape.

The subpath supplies:

- Unwrapped Chain operations, `Chain`, `ContextChain`, execution construction, and declarations.
- `createPoisonError`, `validationError`, `combineErrors`, precise poison/fatal predicates, the native Error subclasses, and `ERROR_KIND`.
- `runInternalStep`, `runHostBoundary`, `continueOperation`, and execution-bound `isPending` recognition.
- `importMethodResult`, which performs atomic host-result admission with the causal `HostCallFailed` kind, including direct and nested rejection. Reusing the context importer here would assign the wrong introducing kind.
- `returnOperationResult`, used exactly once by the final facade that exposes an operation result to native code, and `failExecution` for trusted fatal submission.

Enter the initial semantic body through `runInternalStep`. Its one routing check diagnoses a missing operation context or execution binding before work, including an accidentally supplied source-only context; diagnostic fields remain opaque. Prepare/export required inputs and select any authorized native receiver before calling the three-argument `runHostBoundary`. That helper catches only its exact supported host action, contextualizes returned native Errors as well as throws, enforces the shared re-entry guard, and checks authoritative fatal state even if host code caught a nested fatal and returned normally. Surrounding graph work does not become recoverable merely because it calls native JavaScript.

Use `continueOperation(value, operationContext, onFulfilled, onRejected?, owner?)` for the first required deferred transition. It calls the source's ordinary `then` at the current program position, preserves synchronous custom delivery, and guards execution and optional operation lifetime. An owner is needed only when actual resources or early completion require one. The semantic callback explicitly handles expected poison; an unexpected throw or raw rejection is fatal. Subscription itself follows the supported scheduling protocol and does not keep the host-code guard active around its supplied continuation. The raw subscription primitive and private host-escape marker are not integration exports.

`createPoisonError` preserves poison, submits an existing fatal, or retains the exact raw cause with the supplied source and kind. `validationError` creates a causeless validation leaf. Factories trust compiler/runtime kind and context facts; constructors cannot forge kernel brands. Cause payloads must satisfy the [diagnostic data contract](data-limitations.md#errors).

Internal composition returns its classified result directly. The outer facade calls `returnOperationResult(operationContext, result)` once. Ready results allocate no Promise or fatal registration; an actually pending outward result has one removable fatal reject action. Intermediate imports, iterator steps, and helper calls add none. This is a documented trust boundary, not a security boundary or a configurable public/internal mode.

A standalone call exports all required arguments, invokes the host Function with `undefined` as its receiver, and admits the result through `importMethodResult`. Iterator advancement uses an already selected and ordered iterator, invokes `next` through `runHostBoundary` with `IteratorFailed`, and classifies any direct rejection in its first `continueOperation` callback. The caller validates and consumes the iteration record; the containing runtime owns iterator finalization and diagnostics as specified in Phase 12. [Integration tests](../test/causal-failures.test.js) exercise these compositions.

Phase 9D-A provides these causal semantics with immutable non-thenable poison. Phase 9D-B adds rejecting poison transport to the same implementations; it introduces no second integration surface.
