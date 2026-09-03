# Error Handling Architecture

## Purpose

This document defines how Cascada classifies, represents, attributes, propagates, combines, and reports failures. It also defines how a fatal failure closes an execution.

## Terms

- A **raw failure** is a native JavaScript `Error`, thrown value, or rejection reason not yet classified by Cascada.
- A **causal boundary** (formerly **source boundary**) is the exact language or host action allowed to convert an expected raw failure into recoverable Error data.
- A **causal occurrence** is one boundary-position contextualization of a raw failure. Its wrapper is preserved when later consumers retain or propagate it; consuming the same raw failure at another causal boundary creates another occurrence.
- A **consumer** reads, stores, propagates, or combines an existing value. It preserves a classified Error and cannot classify a new raw failure.
- **Runtime-owned work** (formerly **structural owner**) is trusted runtime machinery such as traversal, continuation, mirror update, publication, scheduling, or cleanup.
- An **operation** is one issued semantic command and its continuations.
- An **operation owner** holds one operation's open/closed state, operation-only resources, and pending public outcome, when any.
- An **execution** is one isolated runtime run. It owns graph state, operation work, and fatal state.
- An **operation context** is the immutable `{ execution, errorContext }` record for one operation. `errorContext` is opaque diagnostic source data.
- The **language graph** is the logical data held by Chain roots and reachable placements. A **placement** is one logical `(container, key)` property location.
- **Shared settlement** advances Promise-backed graph state that remains required after one operation closes.
- A **language Error**, or **poison**, is a recoverable `PoisonError` or `CompoundPoisonError`.
- A **fatal failure** is a `RuntimeError` caused by a runtime defect, broken invariant, or unsafe host behavior that leaves runtime state, ownership, or ordering untrustworthy.
- A **direct Promise** is the Promise returned as a boundary's result. A Promise nested inside that result is ordinary result data.

## First principles

- **Recoverable failure is language data.** It may be stored, returned, inspected, combined, replaced, or repaired.
- **Unexpected runtime failure is fatal.** It is reported once and propagated, never admitted or reinterpreted as language data.
- **The cause determines classification.** Classification depends on the action that failed, not whether failure arrived by return, throw, fulfillment, or rejection.
- **Conversion is narrow and single-use.** Only a causal boundary converts an expected raw failure, and it does so once. Consumers preserve the result. Every other raw failure is fatal.
- **Attribution is immutable.** Once poison has a source and kind, or a fatal Error has a source, delay, copying, publication, and later consumption preserve them.
- **Promises change availability, not meaning.** Ready and asynchronous forms of one failure have the same classification and kind.
- **Required collection is complete.** Independent required inputs contribute every language Error unless a fatal failure closes the operation.
- **Fatal handling is simpler than recovery.** Fatal failures are neither admitted, combined, queried, repaired, nor reclassified.
- **The first fatal failure owns shutdown.** It closes the execution to new operation work, fails pending outcomes with the same Error, and permits required shared settlement and cleanup to finish.

The default is strict: an unclassified exception or rejection is fatal. Recoverable behavior always requires an explicit causal boundary.

## Failure model

### Error hierarchy

~~~text
Error
|- PoisonError
|  `- CompoundPoisonError
`- RuntimeError
~~~

- `PoisonError` directly extends native `Error`. It records a nonempty stable `kind`, originating `errorContext`, and optional exact `cause`.
- `CompoundPoisonError` extends `PoisonError`. Its `.errors` contains flattened poison leaves.
- `RuntimeError` directly extends native `Error`. It records its originating `errorContext`, exact cause, and private report-once state.

There is no shared runtime `CascadaError` base. Such a base adds no capability and permits an ambiguous Error that is neither recoverable nor fatal. Cascada may retain a separate compile-time Error base.

### Recognition

Recognize every native Error form before inspecting Promise or thenable behavior:

~~~text
RuntimeError                       -> fatal; never language data
PoisonError or CompoundPoisonError -> existing language Error
native Error                       -> raw Error requiring contextualization
anything else                      -> not an Error
~~~

Consequences:

- Semantic `isError(value)` recognizes native host Errors and both poison classes but excludes `RuntimeError`.
- Guard thenability inspection with native `Error.isError(value)`, not semantic `isError(value)`, so no Error form, including `RuntimeError`, has `then` sampled.
- A native Error remains an Error even when it has a callable or throwing `then`; Cascada never reads that property.
- Declaration APIs return an existing Error unchanged before probing thenability.
- Import and assignment contextualize a raw native Error before storing its logical value.
- Imported physical storage may retain a native Error while its placement version contains the contextualized occurrence.
- Ordinary graph consumers encounter contextualized language Errors or fatal `RuntimeError` values, not unclassified native Errors.

### Failure kinds

One frozen public `ERROR_KIND` object owns the complete vocabulary. Every `PoisonError` has one specific PascalCase kind whose key equals its string value:

~~~js
UserCallThrew: "UserCallThrew"
~~~

There is no empty or generic fallback. Every poison requires a kind and source; every `RuntimeError` requires a source. A missing required field is a fatal invariant failure. Messages are presentation and remain independent of structured kinds.

Reuse these established kernel kinds only for their existing meanings:

- `LookupThrew`
- `MissingFunction`
- `NotAFunction`
- `NullLookup`
- `ScalarLookup`
- `UserCallThrew`

Keep these names in the same public `ERROR_KIND` namespace, but reserve them for the higher Cascada runtime:

- `DivideByZero`
- `ImportBindingMissing`
- `IncompatibleOperands`
- `InvalidConcurrentLimit`
- `InvalidTextValue`
- `IteratorThrew`
- `LoadFailed`
- `NaNResult`
- `NotDestructurable`
- `NotIterable`
- `UnknownVariable`

Kernel features add exact boundary-specific kinds to `ERROR_KIND`; this document need not duplicate their complete implementation list. `Multiple` is only the compound meta-kind.

Kinds describe causes, not transport. Ready Error values and Promise rejections at the same boundary use one kind:

| Boundary | Kind |
| --- | --- |
| Chain initialization | `ChainValueFailed` |
| Context import | `ContextValueFailed` |
| Assignment | `AssignmentValueFailed` |
| Operation input | `OperationInputFailed` |

Arrival mode is not structured data. Preserve the exact cause for diagnosis, but do not infer whether it was returned, thrown, fulfilled, or rejected. Every unsupported controlled-callback result uses `InvalidCallbackResult`: a Promise where synchronous output is required and a ready value of the wrong type violate the same callback-result contract and have the same graph effect. The message identifies the violated constraint.

## Boundary classification

### Decision cascade

Each causal boundary applies one rule:

~~~text
existing RuntimeError     -> submit unchanged to the current execution; propagate its authoritative fatal Error
existing language Error   -> preserve unchanged
expected raw failure      -> PoisonError(source, kind, exact cause)
successful value          -> continue boundary processing
any other raw failure     -> RuntimeError; fail the execution
~~~

Boundary and consumer are roles of actions, not modules. One import, lookup, export, or invocation may consume an existing Error in one step and cause a new failure in another.

Causal boundaries include:

- language validation;
- first consumption of a native Error introduced through import or assignment;
- supported host calls, accessors, reflection hooks, comparators, and callbacks;
- a direct Promise returned by supported host code;
- supported import, lookup, conversion, and export reflection;
- documented external-operation failures; and
- any other language operation explicitly defined as producing poison.

A synchronous throw, explicitly returned native Error, and direct-Promise rejection use the same kind when they represent failure of the same action. A direct Error result always means that boundary failed; returning an Error as successful payload is unsupported. Ready and asynchronous delivery therefore have the same graph effect. An explicitly returned native Error is contextualized once, while an existing poison is preserved.

### Supported synchronous host code

Private `runUserCode` wraps exactly one supported synchronous host-controlled action:

~~~text
runUserCode(action):
    enter runtime-wide re-entry guard
    try action()
    on RuntimeError -> rethrow unchanged
    on any other throw -> throw private UserCodeFailure(exact reason)
    finally leave guard
~~~

The marker also transports an existing poison thrown by host code. The owning semantic boundary catches only `UserCodeFailure`, preserves a contained poison or contextualizes another reason with its operation context and kind, and then applies that boundary's graph effect. This keeps thrown poison recoverable without letting it bypass receiver poisoning or other boundary behavior. The split is deliberate: a low-level reflection helper knows that host code threw; its caller knows which boundary owns that interaction. The private marker avoids broad conversion catches and boundary-policy arguments throughout graph helpers.

Keep receiver preparation, argument export, result import, publication, bookkeeping, and cleanup outside the host envelope. Any unmarked failure from that work is fatal. A synchronous Cascada re-entry while supported host code is active is also fatal.

A direct host Promise settles after the synchronous envelope. Its first existing boundary continuation classifies a raw rejection using the source and kind recorded when the Promise was accepted. Do not recreate the envelope or allocate an attribution-only Promise.

Application callbacks and effectful reflection are supported host code. A captured built-in is runtime-owned only when its inputs are runtime-owned and hook-free; applying it to a Proxy or host object that may invoke traps is supported host code. “Native code” alone is not a recoverable category.

Invalid host output is recoverable only when the boundary can reject it without compromising runtime invariants. Examples include an unsupported controlled-callback result and a managed receiver whose completed state fails validation. Host behavior is fatal when it makes runtime state, ownership, ordering, publication, or cleanup untrustworthy. Do not classify both cases under a generic “host-contract violation.”

### Catch roles

Failure-classifying and recovery catches have only four roles:

1. The exact synchronous host interaction wraps every nonfatal throw as `UserCodeFailure`.
2. Its semantic boundary catches only that marker, preserves a contained poison or contextualizes another reason, and applies its graph effect.
3. The operation fatal envelope and guarded asynchronous transitions propagate an escaping `PoisonError` unchanged. They submit an existing `RuntimeError` unchanged, or contextualize another escaping failure, and propagate the execution's authoritative first fatal Error.
4. Reporter and shutdown-cleanup catches preserve the committed fatal outcome while continuing best-effort reporting or cleanup.

No other catch reclassifies failure. Rejection handlers that only establish Promise ownership are not classification catches. Rollback, result handling, publication, and similar work inspect returned language Errors and let thrown failures reach the fatal envelope.

Runtime-owned failures are always fatal, including failures in:

- mirrors and placement versions;
- COW and refcounts;
- leases, gates, and external phases;
- graph traversal and publication;
- operation lifetimes and cleanup; and
- schedulers or trusted callbacks without an explicit supported-host contract.

A higher-level feature may explicitly classify its own failure, such as load failure. That policy stays above the graph kernel; there is no generic classification hook.

## Causal attribution

### Source selection

The operation that causes a new Error supplies its opaque source context:

| Failure | Source |
| --- | --- |
| Validation | Validating operation |
| Host throw or direct-result rejection | Host invocation |
| Getter or Proxy trap | Property access |
| Imported Promise rejection | Import that introduced it |
| Assigned Promise rejection | Assignment that introduced it |
| Copy, publication, bookkeeping, or cleanup | Operation performing that fatal transition |

An existing language Error or `RuntimeError` keeps its source. A later consumer supplies context only to a new failure it causes. This is causal, not chronological: a Promise introduced by import keeps the import source when it rejects later, while an invalid lookup through successfully imported data uses the lookup source.

A Chain retains its execution, not initialization source as a fallback. Initialization context applies only to work it introduces; later operations supply their own contexts. Contextless source is reserved for genuinely executionless configuration. Diagnostic-route data may supplement a causal source but never replace it.

Retain an operation context only while deferred work may still create a newly attributed Error. Once settlement produces a successful value or contextualized Error, propagation needs only that result.

### Native Error occurrences and import

Contextualize one raw native Error per causal occurrence, never once per identity or execution:

- Preserve the native Error unchanged as the wrapper's exact `cause`.
- Reusing it at another boundary creates another `PoisonError` wrapper.
- Propagating a contextualized occurrence preserves its wrapper exactly.
- Root import returns its occurrence wrapper.
- Nested import leaves host storage unchanged and stages the wrapper as the parent-key placement's fixed logical version.
- A failed import segment commits neither the wrapper nor any other staged fact.
- Promise fulfillment begins another atomic import segment; it neither reopens nor rolls back the earlier segment.

Store no wrapper on the native Error identity and keep no execution-wide Error-keyed cache.

### Promises, mirrors, and thenables

- A raw rejection uses the boundary that introduced its Promise. Introducing one raw rejecting Promise at two boundaries creates two causal occurrences.
- A pending Chain root installs its exact initial version and mirror during initialization, so deferred failure retains the initialization operation's source.
- Contextualize in the first import, mirror, validation, or publication continuation already required by the boundary. Add no forwarding Promise merely for attribution.
- A copied or derived pending placement gets a new mirror at its program position and preserves the source mirror's eventual contextualized Error.
- Mirrors and placement versions retain origin only while needed. Promise identities, Chains, shared settlement, and later consumers are not fallback sources.

Reading `then` and invoking the captured callable are separate causal boundaries. Thenability acquisition and assimilation are execution-local. A genuine native Promise already performs recursive assimilation, so register directly on its captured native `then`; classify a fulfilled Error, but do not resample fulfillment thenability. A synchronous failure during that registration belongs to the registering operation.

A captured custom thenable follows this sequence:

1. Sample `then` at most once per identity in one execution. A throwing getter belongs to the first sampling operation.
2. Create one cached settlement Promise and invoke only the captured callable. Give it callbacks that fulfill that Promise with a hook-free record equivalent to `{ fulfilled, value }` or `{ rejected, reason }`; never pass an arbitrary thenable a native Promise resolver.
3. Apply native first-settlement-wins behavior. A throw before settlement is `ThenInvocationThrew` attributed to the operation creating the settlement Promise and is stored as its rejected outcome. Ignore a throw or callback after settlement.
4. Each causal boundary that introduced the thenable interprets the record using the operation context retained by that boundary. The raw rejected reason is contextualized separately at each such boundary; later non-boundary consumers receive that boundary's existing Error. An already contextualized Error is preserved.
5. For fulfillment, recognize every Error form first. Consume a nested thenable through execution-local capture using the introducing boundary's context; otherwise continue with the value.
6. Never expose the record outside the Promise-continuation mechanism. After invocation, retain neither the captured callable nor its operation context; the source-neutral settlement Promise is sufficient.

A failed first sample establishes the identity's rejecting thenability state for that execution, attributed to the first sampler. A failed invocation similarly stores its already contextualized rejected outcome. Later consumers preserve either failure regardless of which operation advances shared settlement. Successful invocation and ordinary settlement retain no operation context. Declaration probes are contextless and operation-local because declarations run before admission; they create no persistent thenability or continuation state.

### Hook-free contextualization and diagnostics

Contextualization invokes no host code. It never calls getters, coercion hooks, `toString`, `then`, `stack` or `cause.stack`, or arbitrary Error properties.

- Preserve the exact thrown or rejected value as `cause`.
- Derive a message only from primitives or safely inspected own data properties; otherwise use fixed text.
- Copy no cause properties onto the wrapper.

The kernel stores classification and structured facts, not formatted source presentation. `.message` contains no opaque source fields or compound-child listing. The higher runtime formats source data, diagnostic routes, cause stacks, and bounded compound displays outside graph transitions and under `try`/`catch`. Formatter failure cannot change the stored Error or outcome.

Host-configuration APIs remain outside language execution. Invalid public configuration may throw an ordinary host API Error. An unexpected contextless defect becomes a contextless `RuntimeError`, is reported directly, creates no poison, and closes no execution.

## Recoverable Error behavior

### Rejecting-thenable representation

Both poison classes are synchronously detectable native Errors and sync-first rejecting thenables:

~~~text
isError(error)              -> true
await error                 -> rejects with error
Promise result adopts error -> rejects with error
~~~

Their `then` exists only for assimilation and `await`:

~~~js
then(_onFulfilled, onRejected) {
    return typeof onRejected === "function" ? onRejected(this) : this
}
~~~

It never fulfills or allocates another Error. It returns the rejection callback's value and propagates its throw synchronously. It needs no `catch`, `finally`, Promise-compatible chaining, Promise subclass, or wrapper. The kernel never calls it because Error recognition precedes thenability.

Native assimilation still applies. `Promise.resolve(error)` rejects with that exact Error; returning it from a rejection callback causes the next native Promise to assimilate and reject with it again. A fulfilled inspection result must therefore be non-thenable. `RuntimeError` is not a language thenable, so host code can physically return or fulfill with one. Every ready, fulfilled, thrown, rejected, or traversed occurrence is submitted to the current execution before it could be admitted or exposed as language data.

### Publication and complete collection

Native Promise resolution assimilates thenables. When poison must remain graph data, publish or retain it in its logical location before the operation's native Promise rejects with that same Error. Runtime continuations never depend on fulfillment with poison.

Ordinary continuations propagate an existing poison rejection unchanged. Intercept it only for these distinct transitions:

- **Graph publication:** publish the Error, then reject the operation with it.
- **Complete independent-input collection:** record each poison outside the aggregate Promise and fulfill that internal branch with `undefined`, allowing every required input to settle before combination without assimilating poison. An unclassified or fatal rejection still fails immediately.

Keep separate helpers only when these different transitions need them. Do not hide them behind a policy flag, shared result wrapper, general rejection-to-value path, or helper whose only job is turning every poison rejection into fulfillment. The custom-thenable first-settlement record is private to thenable assimilation and serves neither transition.

### Compound Errors

~~~text
combine(errors):
    require at least one input; zero is fatal
    flatten nested CompoundPoisonError values
    preserve logical collection order
    deduplicate by an identity-bearing cause; otherwise by leaf identity
    return the exact leaf if one remains
    otherwise return CompoundPoisonError(leaves)
~~~

An object, Function, or Symbol cause has identity and may identify the same underlying failure across occurrence wrappers. Primitive causes such as two separately thrown equal strings do not; each wrapper remains a distinct occurrence.

The compound:

- preserves every surviving leaf's source and kind;
- exposes every leaf through `.errors` in collection order;
- exposes distinct child kinds through `.kinds` in first-occurrence order;
- uses that kind when all leaves match, otherwise `ERROR_KIND.Multiple`;
- uses the first leaf as primary context without changing any child; and
- requires no shared source ancestor.

Only explicit combination deduplicates different occurrence wrappers with the same identity-bearing cause. Normal propagation preserves them. The caller's message names the failed boundary without enumerating children; presentation may cap or summarize a separate view.

### Graph and operation effects

- Language Errors may occupy roots, placements, mirrors, and independent results. Assignment and deletion may replace them.
- Repairable external poison stays in phase metadata when replacing the target would destroy its capability. Repair clears old poison on success or replaces it with the repair failure; it never silently converts failure to success.
- Errors never cross export as host data. An Error found in arguments prevents host invocation after all required argument and nested Errors are collected and combined.
- Existing input Errors preserve their source. A new export or validation failure uses the current invocation and exact boundary kind.
- An observation failure normally affects only its result.
- A mutating call's preparation, method, validation, or direct-result failure normally poisons its receiver placement after the defined graph effect. Every direct Error result is a direct-result failure, whether ready, explicitly returned, fulfilled, or rejected. Failure confined to an independent nested result does not poison an otherwise successful mutation.
- If poisoning managed state would remove authoritative external capability, preserve the scope and return the Error.
- A script or operation result remains synchronously inspectable; awaiting it rejects with the same Error.
- `hasError` stops once an Error is proven. Already-started shared settlement and publication finish, but abandoned query work explores no further.
- `getErrors` scans its complete captured graph and Promise frontier and returns every distinct reached language Error identity. Wrappers with one cause remain distinct until explicit combination.
- Query traversal, indexing, or bookkeeping failure is fatal.

## Operation lifecycle and Promise ownership

Ready and pending operations follow one semantic lifecycle:

1. Consume and validate selected inputs.
2. Finish required independent Error collection. If Errors exist, combine them and stop before host work.
3. Run only the supported host or language action inside its causal boundary.
4. Contextualize an expected raw failure once.
5. Complete required result admission and publication.
6. Expose the final value or language Error.

When required data is pending, the common FIFO continuation resumes the same lifecycle:

~~~text
raw rejection introduced by this boundary -> contextualize once
existing language Error rejection          -> preserve
existing RuntimeError rejection            -> submit unchanged; propagate the execution's authoritative fatal Error
raw runtime-owned rejection                 -> fatal
~~~

The first existing boundary continuation performs the only asynchronous conversion. Later native Promise propagation keeps the exact Error. A direct host-result Promise remains within its recorded causal boundary through final import or validation. An unclassified raw rejection reaching a consumer or runtime-owned continuation is fatal.

Required publication and boundary processing finish before outcome exposure. A direct operation Promise keeps its operation lifetime and external phase active through that work. A nested result Promise is ordinary result data and extends neither.

One outer fatal envelope covers the synchronous operation transition; guarded continuations cover asynchronous transitions. Every pending transition first completes required shared settlement. If its operation has closed, it performs no later operation-specific work.

`markPromiseHandled(promise)` adds rejection handling without replacing the Promise or changing its semantic consumers. Apply it to kernel-owned Promises that may reject before another owner attaches:

- the execution fatal Promise;
- public operation results retained for later Cascada use;
- internal continuation, aggregate, gate, phase, and cleanup Promises not returned immediately; and
- kernel Promises that assimilate thenable language Errors.

Handling is not publication: `markPromiseHandled` never publishes poison or satisfies a semantic consumer. Immediate real consumption handles its source Promise; apply the ownership rule to any derived Promise. Do not recursively observe unused host input merely to suppress process warnings. Cascada's discarded-expression handling, including `observeDiscardedExpression`, remains a higher-runtime responsibility.

## Fatal failure lifecycle

### Fatal sources and submission

A `RuntimeError` means language execution cannot safely continue. Causes include:

- internal invariant or bookkeeping failure;
- malformed trusted runtime facts;
- raw failure escaping a consumer or runtime-owned work;
- rejected internal readiness or aggregate work;
- synchronous Cascada re-entry from supported host code;
- unsafe host behavior that compromises runtime state, ownership, ordering, publication, or cleanup; and
- required cleanup or publication failure.

Fatal Errors are never admitted, returned as language data, combined with poison, found by Error queries, stored as repairable poison, or recontextualized.

~~~text
runFatal(operationContext, work):
    execute work
    on failure:
        existing PoisonError -> propagate unchanged
        candidate = existing RuntimeError
                  or RuntimeError(operation source, exact raw cause)
        authoritative = operationContext.execution.fail(candidate)
        throw or reject with authoritative
~~~

`runFatal(operationContext, work)` is the sole operation fatal entry. `runContextlessFatal(work)` is the sole executionless entry and reports without closing an execution. A `PoisonError` is never escalated.

### Atomic execution shutdown

Each `Execution` owns:

- one fatal latch and authoritative first `RuntimeError`;
- one `fatalPromise`, marked handled at creation and observable by the root and scheduler;
- its registered live operation work; and
- a readable `fatalError`, which is `null` until the latch closes.

The first `Execution.fail(candidate)` performs one synchronous transition:

1. Store the candidate and close the latch.
2. Fail registered operation work with the stored Error. Each owner releases its resources and rejects its pending public outcome, when present.
3. Reject `fatalPromise` with the stored Error.
4. Invoke the runtime-wide reporter after state and work closure are committed.
5. Return the stored Error.

No Promise continuation runs during this transition, so the internal order between owner failure and `fatalPromise` rejection is not semantic. Later candidates return the stored Error without replacing or reattributing it.

A pending public outcome belongs to its existing operation owner. The owner keeps one idempotent fatal reject action until normal settlement or closure; fatal shutdown invokes it directly instead of racing every operation against `fatalPromise`. This extends the live-operation registry rather than creating another registry.

A component must not close or unregister its owner before submitting a fatal failure. It enters the execution fatal path first; `Execution.fail` invokes the owner's fatal rejection and cleanup together. Otherwise that pending outcome could escape shutdown.

The execution latch and Error report-once fact have different scopes:

- `Execution.fail` selects one outcome and initiates shutdown for one execution.
- `RuntimeError` suppresses another report if that occurrence crosses another reporting surface or execution.
- Every receiving execution may still close.

Reporter failure cannot replace the outcome or block shutdown. Cleanup releases are synchronous, idempotent, and non-throwing by contract; if one violates that contract, preserve the first Error and finish the cleanup sweep.

### Checkpoints and cooperative completion

Check fatal state before:

- public operation work;
- operation-specific continuation work after shared settlement;
- supported host work or another effect after a wait;
- scheduler command dispatch; and
- normal root completion.

A closed execution uses the API's normal synchronous or Promise transport to propagate the stored Error. It starts no operation or host work and creates no new occurrence. No checkpoint interrupts synchronous JavaScript, an active host call, or required shared settlement and cleanup.

Shutdown:

- propagates the authoritative Error through owner outcomes and `fatalPromise`, waking pending runtime waits;
- abandons unfinished operation-only work and releases its resources;
- completes required shared settlement, publication, bookkeeping, and cleanup; and
- keeps already-observed native Promises handled after their results are abandoned.

It does not cancel native Promises, undo started host effects, recover the execution, or assume host cancellation. A host API may independently support cancellation, but this architecture does not rely on it. Post-shutdown continuations perform only required shared settlement or cleanup.

Every runtime wait that could outlive abandoned work observes `fatalPromise` or another execution-owned outcome. Pending public outcomes are woken by their owners. The root races its returned value's required boundary processing and export against `fatalPromise`; it does not wait for unrelated operations, Chains, shared settlement, or cleanup. If the result completes first, later work continues. A later fatal is stored, reported, and closes remaining work, but cannot alter the delivered result. Reading `execution.fatalError` exposes that first fatal; `null` is not proof of eventual success while work remains. The higher scheduler observes the same `fatalPromise` and exact Error to stop dispatch, abort or finish active iterators and child buffers, release waiters, and reject unresolved command results without waiting on abandoned normal blockers. It neither owns another fatal state nor bypasses required graph settlement. There is no execution-idle counter or quiescence barrier.

## Component responsibilities

- `execution.js` owns the fatal latch, readable `fatalError`, handled `fatalPromise`, live-operation registry, and `Execution.fail(candidate)`.
- `error.js` owns concrete Error classes, `ERROR_KIND`, `UserCodeFailure`, `runUserCode`, hook-free contextualization, compound construction, fatal wrapping, report-once state, `runFatal`, and `runContextlessFatal`.
- `language-values.js` owns context-free Error recognition, Error-before-Promise precedence, direct native-Promise registration, source-neutral custom-thenable settlement records, and per-boundary nested capture.
- Causal boundaries contextualize ready failures and raw rejection in their first existing import, mirror, validation, or publication continuation.
- `resolution.js` preserves FIFO order and distinguishes data rejection from internal failure. Publication and complete collection use their distinct transitions.
- `operation-lifecycle.js` closes operation work after required Error handling and publication without cancelling shared settlement.
- Import, assignment, lookup, invocation, conversion, export, and external-operation modules define narrow causal boundaries and kinds without alternate propagation paths.
- Error queries and aggregators preserve existing Errors; runtime traversal or bookkeeping failure is fatal.
- The higher scheduler observes the execution fatal outcome and owns no duplicate state.
- The diagnostic layer formats opaque source context, exact causes, and bounded compound views without changing kernel Errors.

## Intentional differences from Cascada

The graph kernel keeps Cascada's useful semantics, not its current interfaces. Cascada should adapt during integration; the kernel adds no compatibility path.

### Required Cascada changes

- Move fatal authority from `RenderState` to `Execution`. The render and command-buffer scheduler observe the execution's outcome.
- Keep shutdown authority out of diagnostic context. Coordination uses `operationContext.execution`; compact diagnostic representation remains behind opaque `errorContext`.
- Commit fatal state and operation closure before invoking `onError` or another reporter.
- Replace `PoisonedValue`, thrown `PoisonError`, `RuntimePromise`, and `PoisonErrorGroup` with rejecting-thenable `PoisonError` and `CompoundPoisonError`.
- Convert raw failure once at its causal boundary. Use the private host marker for every nonfatal synchronous host throw, including thrown poison, so the owning boundary applies the graph effect. Use an existing boundary continuation for raw rejection.
- Treat every direct Error result as boundary failure. A mutating boundary applies the same failure effect whether the Error is returned, fulfilled, thrown, or rejected.
- Keep direct registration for genuine native Promises. Cache a custom thenable's raw first-settlement record without native assimilation; each introducing boundary routes a fulfilled nested value through execution-local capture using its retained operation context.
- Replace transport-specific `...Error` and `...Rejected` kinds with one `...Failed` kind per cause. Keep `Multiple` as a meta-kind.
- Classify concrete recoverable and fatal branches rather than a common runtime Error base.
- Normalize every fatal occurrence to `RuntimeError`, including contextless failure; keep the raw value as exact cause. Submit an existing `RuntimeError` unchanged to each receiving execution so its first fatal remains authoritative.
- Preserve compound collection order, retain separate equal primitive causes, and use the first retained leaf as primary context. Presentation may sort a separate view.
- Keep report idempotence on `RuntimeError`, independent of reporting surface.
- Ignore legacy attribution properties such as `_errorContext`; the accepting operation supplies causal source.

### Recommended Cascada changes

- Keep compact context tables, diagnostic routes, and stacks behind opaque source context.
- Format sources and causes in the diagnostic layer; keep eager formatting, arbitrary cause inspection, source sorting, and display truncation out of the kernel.
- Keep load-failure policy above the kernel rather than adding a generic policy hook.
- Keep compiler-created and discarded-value Promise handling above the kernel.
- Route buffer shutdown and pending-root fatal failure through the execution fatal outcome, preserve result-driven early completion, then remove duplicate fatal queries and adapters.

## Renamed and removed terms

| Previous term | Current term | Reason |
| --- | --- | --- |
| Source boundary | **Causal boundary** | The exact cause, not transport, owns classification. |
| Structural owner | **Runtime-owned work** | Avoids confusion with graph ownership. |
| `PoisonErrorGroup` | `CompoundPoisonError` | Matches compound Error semantics. |
| `ChainValueError` / `ChainValueRejected` | `ChainValueFailed` | One kind for ready and asynchronous transport. |
| `ContextValueError` / `ContextValueRejected` | `ContextValueFailed` | One kind for ready and asynchronous transport. |
| `AssignmentValueError` / `AssignmentValueRejected` | `AssignmentValueFailed` | One kind for ready and asynchronous transport. |
| `OperationInputError` / `OperationInputRejected` | `OperationInputFailed` | One kind for ready and asynchronous transport. |
| `AsyncCallback` | `InvalidCallbackResult` | One kind for every unsupported callback result. |
| `PoisonedValue` and `RuntimePromise` | Rejecting-thenable `PoisonError` | One representation works synchronously and asynchronously. |
| `valueWithOrigin` attribution wrapper | Existing boundary continuation | Reuses work already required at that boundary. |
| Runtime `CascadaError` base | Removed | Recoverable and fatal Errors are distinct branches. |
| `RenderState` as fatal authority | Execution-owned fatal state | Coordination belongs to the execution, not diagnostics. |

## Deliberate exclusions

The architecture adds no:

- separate synchronous poison wrapper;
- common runtime Error base;
- `RuntimePromise` or Promise subclass;
- per-consumer Error proxy;
- parallel continuation mechanism;
- Promise allocated only for attribution;
- broad catch that converts adjacent runtime work into poison;
- contextualization that invokes host code or copies arbitrary cause properties;
- registered formatter or generic fatal-versus-recoverable policy hook;
- competing fatal reporter, state, or scheduler;
- context inference from a later consumer;
- recovery of a fatally closed execution; or
- assumption that native work can be cancelled or rolled back.

## Verification

### Representation, kinds, and attribution

- Both concrete Error branches directly extend native `Error`; no shared runtime base or legacy wrapper remains.
- Both poison types support synchronous detection, sync-first `.then`, missing-handler behavior, exact rejection identity, and native re-assimilation. `RuntimeError` is non-thenable.
- Every Error precedes thenability inspection, including a hostile Error with throwing `then`.
- A `RuntimeError` encountered as a ready return, Promise fulfillment or rejection, synchronous throw, or nested imported value is submitted to the current execution and never admitted as language data.
- Poison kind and source and fatal source are mandatory and stable. Ready and asynchronous failures at one boundary share a kind; `Multiple` is only a meta-kind.
- Ready return, explicit Error, synchronous throw, Error fulfillment, and direct rejection follow the same causal and graph-effect rules at every supported boundary. A direct mutation Error always follows mutation-failure behavior.
- Existing poison preserves identity and attribution. An existing `RuntimeError` is submitted unchanged to the receiving execution, which propagates it unless an earlier fatal Error is already authoritative. Reusing a raw native Error at different boundaries creates separate wrappers.
- Delayed settlement, copying, and repeated consumption preserve source and kind. A later failure uses its own causing operation.
- Then acquisition and captured invocation use their exact source operations and native first-settlement precedence. Native Promises register directly without resampling fulfillment thenability. A custom thenable's cached Promise fulfills only with its private non-thenable first-settlement record; each introducing boundary applies its retained attribution and nested capture. Two boundaries introducing one raw rejected outcome create separate occurrences, while cached acquisition and invocation failures retain their first operation.
- Imported occurrences commit atomically, and copied or derived mirrors preserve origin.
- Contextualization of hostile failures invokes no host hook.

### Collection, graph, and Promise behavior

- Combining zero inputs is fatal. Nonempty combination flattens, preserves order, deduplicates identity-bearing causes, retains separate equal primitive causes, preserves complete `.errors`, and selects `.kind` and `.kinds` correctly.
- `getErrors` retains distinct occurrence wrappers even when later combination deduplicates their shared cause.
- Required argument and export Error collection finishes without host invocation and uses only non-thenable internal readiness.
- `hasError` exits early; `getErrors` completes its captured traversal; query-owned failure is fatal.
- A graph Error is published before its operation Promise rejects with it.
- Root and nested imported native Errors receive atomic occurrence wrappers without modifying host storage. Failed import commits nothing.
- Direct host-result rejection is converted once in its existing boundary continuation. No attribution-only Promise or parallel continuation remains.
- Every kernel-owned Promise category is handled without recursively observing unused host input.
- Stored poison can be replaced; repairable external poison can be repaired without replacing its capability.

### Classification boundaries

- Only the exact synchronous host envelope marks a nonfatal throw for boundary handling. Its owner preserves thrown poison or converts an expected raw failure; adjacent preparation, publication, cleanup, and trusted-callback failure remain fatal.
- Safely rejectable host output validation produces poison; unsafe host behavior that compromises runtime invariants is fatal.
- Complete independent-input collection finds every required poison before host work; unclassified or fatal rejection closes the operation.
- Raw consumer and runtime-owned failures are fatal in ready and pending transitions.
- Synchronous Cascada re-entry is fatal.
- Contextless declaration and host-configuration behavior follows its explicit rules and never fabricates an operation context.

### Fatal behavior

- An existing `PoisonError` bypasses fatal submission unchanged. Fatal submission preserves an existing `RuntimeError`, contextualizes a raw cause at the causing operation, and propagates the execution's authoritative first Error.
- The first fatal fails operation-owned pending outcomes, rejects `fatalPromise`, and commits before reporting. Later candidates do not replace it.
- The same occurrence reports once across outer boundaries and executions; each receiving execution may still close.
- Fatal checkpoints prevent new work without interrupting synchronous transitions or shared cleanup.
- A fatal from unrelated work fails the root while the root is pending. If the returned value completes first, unrelated and never-settling work does not delay it; a later fatal is recorded and reported without changing that delivered result.
- `execution.fatalError` exposes the authoritative first fatal. It remains `null` before one occurs and makes no claim that unfinished work will succeed.
- A fatal immediately rejects a pending public outcome even when its normal input never settles.
- The scheduler and root observe the same handled Promise and exact Error; no competing fatal or cancellation state exists.
- Release, reporter, or formatter failure cannot replace the committed outcome or strand cleanup.
- Late native settlement remains handled and performs no abandoned operation work.
