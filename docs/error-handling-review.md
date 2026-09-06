Error architecture review — 6 September 2026

The overall direction is strong. Execution-owned fatal state, narrow causal classification, immutable attribution, and ordinary FIFO subscriptions are worth retaining. Phase 9C substantially improves on Cascada's fatal handling. However, I would not implement 9D-A literally yet: recovery can currently leave invalid bookkeeping, the output contract has two insufficiently specified escape routes, and the proposed removal of the host-failure marker lacks a concrete account of classification through shared graph helpers.

This review evaluates the working trees, including the existing staged 9C changes. I read the architecture, relevant plan phases, AGENTS.md and data restrictions, and traced the affected implementation paths in both repositories. The kernel suite passes **919 tests** under strict unhandled-rejection handling on Node **v24.14.1**. Targeted probes nevertheless reproduce the failures below. I did not run Cascada's full suite. No existing source or contract files were changed.

The runnable [review probes](C:/Projects/cascada-chain-resolution/docs/error-handling-review-repros.mjs) use public kernel operations for the kernel examples and the existing Cascada loop helper for the iterator example:

```powershell
node --unhandled-rejections=strict docs/error-handling-review-repros.mjs C:/Projects/cascada
```

| Priority | Finding | Status |
| --- | --- | --- |
| High | Recoverable reflection failure can leave a partially published cyclic index | Reproduced current correctness defect; also a prerequisite missing from 9D-A |
| High | Exact public causes can expose unexported managed state | Reproduced access route; unresolved boundary contract |
| High | Native-assimilation safety is not established by the proposed source checks | Reproduced accepted inputs/outputs; incomplete validation and host restrictions |
| High before integration | The trusted integration surface omits mechanisms needed by higher-runtime host boundaries | Missing implementation path in phase 12 |
| Medium before 9D-A | Removing the host-failure marker may move rather than remove complexity | Unresolved implementation design; protocol-result counterexample |
| Medium before integration | Fatal check-and-return does not specify iterator finalization | Reproduced behavior in Cascada; semantic decision required |
| Medium | Deduplication identifies source/cause classes, not dynamic occurrences | Terminology and requirements need reconciliation |
| Medium | Diagnostic safety and preservation are goals without a complete capture/fallback contract | Partial phase-12 implementation path |

**1. Recovery must preserve the validity of all retained runtime state, not only poison the failed target.**

A public assignment can return `PoisonError(PropertyMutationThrew)` while leaving the execution live, yet corrupt the usable refcount projection of another retained Chain. The probe constructs `a.b = b`, `b.back = a`, and an additional Proxy child whose `ownKeys` throws. It first indexes an unrelated destination, retains `b` through another Chain, and assigns `a` into the indexed destination.

Observed output:

```text
assignment: PoisonError, PropertyMutationThrew, execution still live
subsequent hasError(retainedB): FatalError
message: Ref counts require a ref-indexed value
```

The assignment's indexing walk finishes and publishes `b` with a cut to `a`, then encounters the throwing sibling before publishing `a`. The recovery path poisons the assignment's target, but `b` remains indexed with a reachable unindexed cut target. A later walk trusts that published index and fails. No malformed context, direct metadata mutation, or manual fatal injection is necessary.

The relevant mechanisms are [buildRefIndex and indexComponent](C:/Projects/cascada-chain-resolution/src/refcounts.js:64), [prepareLiveEdge](C:/Projects/cascada-chain-resolution/src/refcounts.js:198), and the mutation's [recovery transition](C:/Projects/cascada-chain-resolution/src/mutations.js:248). `indexComponent` publishes descendants before the whole cyclic region has completed fallible reflection. `buildRefIndex` then treats an existing index as complete.

This exposes a missing implementation requirement in [9D-A's query-reflection recovery](C:/Projects/cascada-chain-resolution/docs/first-principles-conformance-plan.md:1678). Returning `QueryReflectionFailed` and closing query-local state will not repair partially published global index facts. The current public query's fatal behavior avoids promising recovery there; simply changing its classification would expose the same defect more widely.

Use the successful import pattern more broadly: **prepare the new index facts, finish fallible work, then publish a downward-closed valid region**. Stage the newly built index/cut/parent facts until publication is safe, while reusing existing valid indexes. This needs neither a general rollback system nor a full graph copy. If incremental partial publication is retained, each published region must already satisfy the complete index invariant, including across cuts.

Add tests that fail reflection after a child has been indexed, after a cycle cut has been discovered, and during a later sibling. After recoverable failure, queries and mutations through every retained alias must still work and the refcount oracle must pass. A poisoned destination alone is an inadequate success criterion for recovery.

**2. Exact diagnostic causes need an explicit ownership and authority rule.**

The design carefully separates diagnostics from graph data, but a public Error still exposes its exact cause. A managed observation can execute `throw this`. [Observation preparation](C:/Projects/cascada-chain-resolution/src/managed-invocation.js:280) can pass the actual managed receiver, and [toPoison](C:/Projects/cascada-chain-resolution/src/error.js:261) stores that receiver as `.cause`.

The probe observes `n === 1`, obtains the returned poison, writes `failure.cause.n = 9`, and observes `n === 9` through the Chain. The write intentionally demonstrates the exposed access; it is not a claim that direct host mutation of an unexported receiver is supported. The preceding `throw this`, however, has no specific failure-payload restriction in the architecture.

Freezing the completed Error will not remove this alias. Nor does describing the cause as outside the language graph make it inaccessible to a native caller. A native Error containing `{ receiver: this }` has the same problem indirectly. A thrown mutation-capable external identity can similarly escape through a failure rather than a successful result.

This is a tension between [the exact-cause rule](C:/Projects/cascada-chain-resolution/docs/error-handling.md:238) and [the native-boundary rule](C:/Projects/cascada-chain-resolution/docs/data-limitations.md:290). Exact identity is useful for attribution and deduplication; it should not accidentally grant a second output channel around export.

The smallest compatible restriction is to require host failure payloads, including diagnostic references reachable from them, to contain no unexported managed source or mutation-capable external capability. Treat failure payloads as diagnostic host data subject to an explicit non-retention contract. This is a host restriction, not something to enforce with an unbounded recursive scan of arbitrary causes. Ordinary native Errors and primitive reasons remain easy to use.

If unrestricted thrown objects are required, exact causes should instead stay behind a trusted diagnostic interface, with safe public summaries. That changes the public `.cause` promise. Choose one model explicitly before freezing the final public Error surface in 9D-A. The phase-12 safe inspection view only protects the language `#` route; it does not protect native access to an earlier exposed Error.

**3. The no-assimilation invariant needs to cover the native property surface, not just placements.**

The architecture correctly recognizes that a successful ready value must survive native Promise resolution unchanged. The implementation and stated enforcement do not establish that invariant for every accepted category.

First, a Function with a callable own `then` retains Function classification. The same Function is returned directly by a ready lookup, but a lookup through a pending parent returns the value supplied by that `then`. The probe prints:

```text
readyIsFunction: true
delayed: "assimilated"
then calls: 1
execution still live: true
```

Being read-only after admission does not prove that an exact Function was safe under assimilation when admitted. [The Function-precedence test](C:/Projects/cascada-chain-resolution/test/supported-thenables.test.js:348) even establishes recognition behavior for a Function with a throwing `then` getter, without testing its later native Promise transport.

Second, a managed method can create a **non-enumerable** callable `then` on its receiver and return `this`. The current [receiver validation](C:/Projects/cascada-chain-resolution/src/managed-invocation.js:536) skips thenability for already-admitted identities and then checks graph placements. The new non-placement is invisible. The probe returns a successful receiver, yet `await result` produces `99`.

The broad data contract already forbids an unsafe successful non-Promise result. Thus the Function example should not be advertised as a supported program under that contract. The defect is that the specific host restrictions and enforcement story imply safety they do not establish, and the invalid completed receiver is accepted instead of being rejected as promised. This distinction matters when deciding whether to validate or document a precondition.

Preserve Function classification, but explicitly require exact Functions and other exact values to have a stable, harmless, non-callable native `then` throughout use. Classification precedence need not imply accepting a Function with an unsafe transport surface. For managed results, validate the relevant native `then` descriptor/prototype surface, including non-enumerables and Array non-index properties; do not infer safety solely from enumerable graph placements. An accessor can be rejected without invoking it. Alternatively, consistently materialize away unsupported hidden properties before publication, if that follows the existing representation contract.

Add ready/pending tests for Function results, non-enumerable `then`, nested Arrays changed by a managed method, and asynchronously selected results that were already admitted. These are source-validation tests, not a reason to add another result wrapper. Pending-result unregistration also relies on the fulfilled value being safe for immediate native settlement.

**4. Phase 12 does not yet give higher-runtime causal boundaries a complete shared integration protocol.**

The proposed [integration subpath](C:/Projects/cascada-chain-resolution/docs/first-principles-conformance-plan.md:2442) exposes unwrapped operations, result exposure, factories, fatal submission, kinds, and predicates. It does not explicitly expose the host-boundary envelope or the common guarded continuation entry, while requiring Cascada to share both mechanisms and remove its existing ones.

Cascada owns supported host interactions beyond the kernel's managed-method `run`: standalone function calls, environment calls, callback extensions, loading, iterator acquisition/advancement, and related reflection. See [callWrapAsyncInternal and envCallWrapAsync](C:/Projects/cascada/src/runtime/call.js:37) and [the loop implementation](C:/Projects/cascada/src/runtime/loop.js:178). Factories alone do not provide the shared host re-entry guard, post-host fatal check, ordinary thenable subscription, or continuation escape policy.

Without an explicit path, integration must duplicate those mechanisms, deep-import private modules, or leave some host calls outside them. In particular, a locally duplicated host catcher cannot activate the kernel's private re-entry guard merely by calling `createPoisonError`.

Specify a small trusted composition surface that includes the existing host-action and guarded-transition primitives, or route every higher-runtime host interaction through kernel-owned operations that already provide them. These are alternatives; both are implementable. The existing plan does not finish either. Keep outward result wrapping separate, as already designed.

The standalone-call migration also needs to decide what replaces Cascada's implicit host `this` value derived from its execution context. Replacing its catch blocks does not, by itself, establish exported argument/receiver safety. Give each surviving call/iterator/loader adapter a concrete input, host action, result, and rejection boundary.

Test a higher-runtime standalone call and iterator method that attempt kernel re-entry, catch the nested failure, and return a normal value. The shared execution's fatal outcome must still win before any later result processing. Test synchronous custom delivery and deferred rejection through those same adapters.

**5. The proposed host-helper simplification needs a representative implementation before it becomes an absolute rule.**

One narrow envelope is a good objective. Removing `UserCodeFailure` is not automatically a reduction in total complexity.

Today [language-properties.js](C:/Projects/cascada-chain-resolution/src/language-properties.js:61) identifies the exact host reflection, while callers such as export, indexing, and mutation determine the causal contract and failure effect. For example, `enumerableLanguageKeys` contains both `Reflect.ownKeys` and repeated descriptor operations, and `readLanguageProperty` also performs normalization. An outer catch around either entire helper is broader than an exact host action. A low-level catcher, on the other hand, cannot infer whether the required kind is query, export, import, or mutation failure from `{ execution, errorContext }` alone.

[9D-A](C:/Projects/cascada-chain-resolution/docs/first-principles-conformance-plan.md:1648) says to delete the marker, leave low-level primitives uncaught, wrap only the exact invocation, and preserve distinct operation-specific reflection kinds. The missing design is how those facts and poison outcomes pass through the intervening shared helpers.

There is also a small counterexample to the universal “a returned Error means the action failed” wording. During thenability recognition, reading `object.then` may legitimately return a non-callable Error value; the object can have ordinary Error data in its `then` placement. A getter that **throws** that Error has failed. If the raw property read is passed to the new helper unchanged, the two cases collapse before the caller can distinguish them.

The helper should enclose the semantic protocol action: for then recognition, normalize a non-callable member to the successful “no then method” result inside that narrow action. It need not classify every intermediate host return as a language result. Descriptors and other protocol facts similarly have their own contracts.

Before deleting the marker everywhere, implement one end-to-end design for query indexing and export. Explicitly pass the fixed boundary kind to the narrow reflection layer, return failures through the semantic traversal, and compare that design with the existing single private escape marker. If removing the marker proliferates policy parameters and error-propagation branches across unrelated graph helpers, retaining that one marker is a defensible simpler architecture. The foundational rule is narrow classification with correct attribution; “zero markers” is an implementation preference.

This review does not recommend restoring a broad catch that converts internal traversal defects to poison. Any replacement must also solve finding 1.

**6. Fatal shutdown needs a decision about host iterator finalization.**

The kernel's decision not to sweep dead leases, settle gates, or drain internal phases is sound. It does not settle the semantics of host resource finalization in the higher runtime.

Cascada's [iterateAsyncSequential](C:/Projects/cascada/src/runtime/loop.js:178) uses `for await`. After a pending `next()` resumes, its fatal check executes `break`. JavaScript then calls the iterator's `return()`. Changing that `break` to `return` still closes the iterator. The probe against the actual Cascada helper records **zero body calls and one host `return()` call after fatal observation**.

Consequently, [phase 12's check-and-return migration](C:/Projects/cascada-chain-resolution/docs/first-principles-conformance-plan.md:2440) cannot simultaneously preserve the existing native loop structure and promise that no further host action runs. `try/finally` cleanup has the same general issue. Removing the internal scheduler's `CommandIterator.abort` is a separate matter from closing an application-supplied iterator.

My preference is to preserve ordinary iterator finalization and explicitly distinguish it from further language work: owned host cleanup may run, may not re-enter the closed execution, and may not replace or delay the authoritative outward fatal outcome. This can remain local to the iterator; it needs no execution-wide cancellation registry. Specify ownership for a rejecting or never-settling cleanup result.

If zero host finalization after fatality is essential, explicitly drive iterators without native `for await` closure on that path and document the resource consequence. That is a real restriction, not merely replacing one fatal helper. Include tests for iterator `return()` that throws, rejects, waits forever, or tries to re-enter Cascada.

**7. Cause/context/kind equivalence is useful, but it is not occurrence identity.**

The tuple improves on Cascada's cause-only deduplication. It preserves separate locations and contracts without retaining an execution-wide wrapper cache. Unspecified child order is also a useful simplification.

However, [phase 12](C:/Projects/cascada-chain-resolution/docs/first-principles-conformance-plan.md:2435) reuses one static source handle across loop executions. If two independent calls at that site throw the same singleton Error—or the same primitive reason—the proposed tuple merges them. Failures from two renders can also merge if their exact source handles and raw cause are deliberately shared. Conversely, causeless validation Errors use their own identity and remain distinct.

Those are coherent **unique failure-at-source** semantics. They do not preserve every dynamic causal occurrence. The phrases “exact occurrence,” “separate introductions,” and “reuse never merges causal positions” overstate what the key can represent.

Prefer retaining the cheaper tuple and explicitly documenting that collection is not an event log or occurrence count. Add a loop test with a reused raw Error and a reused primitive reason. If distinct dynamic failure events are actually required, introduce an occurrence identity at the causal operation, potentially allocated only when needed, while leaving static source handles reusable. Do not silently add counters or per-iteration contexts to satisfy ambiguous terminology.

**8. The diagnostic-view design is strong, but phase 12 leaves preservation and failure behavior underspecified.**

A separate immutable non-thenable view is the right replacement for returning inspectable poison as successful data. It prevents child selection from accidentally re-entering Error propagation, and keeps formatting out of graph mechanics.

The [formatter plan](C:/Projects/cascada-chain-resolution/docs/first-principles-conformance-plan.md:2477) still needs three concrete decisions:

- Where an async diagnostic route is captured and retained until inspection. Accepting an “optional route” in a formatter does not preserve it after the old buffer/context fields disappear. An immutable derived source handle is one available mechanism; use it where dynamic routes are required and state its interaction with deduplication.
- What a formatting failure returns. `null` would falsely mean healthy input, a new poison would change the inspected outcome, and a throw would contradict best-effort inspection. Define a minimal successful fallback view retaining safe kind/message/source facts.
- Which host hooks formatting may execute. A protective catch isolates exceptions; it does not prevent a getter from successfully re-entering Cascada, mutating external state, or never returning. This matters for live recoverable-Error inspection, not only fatal reporting after closure.

Reuse the kernel's hook-free message principle for the minimum language diagnostic view: immutable structured source facts, fixed text for arbitrary hostile causes, and safe native-Error data descriptors. If richer cause/stack formatting executes host code, give it an explicit host contract and execution/re-entry treatment. Do not assume `try/catch` provides that treatment.

Cascada's [current diagnostic layer](C:/Projects/cascada/src/runtime/error-format.js:1) has useful compact source and bounded compound presentation, but also performs direct property reads and coercions. Preserve the useful presentation capability with a specific capture-and-format path rather than merely deleting the old fields.

**Architecture-to-plan coverage**

Most architectural topics do have an assigned phase. The principal gaps concern preservation of invariants during implementation, and the cross-package boundaries, rather than wholly forgotten Error features.

| Architectural obligation | Implementation path and present assessment |
| --- | --- |
| One authoritative fatal outcome, report once per execution, first fatal wins | 9C implemented. Private state, reporter capture, commit-before-report, and removable pending-result rejection actions are appropriate. |
| Prompt fatal delivery behind a never-settling dependency | 9C implemented and tested. Keep the bounded set of outward obligations. |
| Fatal observation stops internal work without gate/phase settlement or an owner sweep | 9C implemented; 9E/F and 12 extend it. Higher-runtime iterator/finalizer effects need finding 6 resolved. |
| Detecting transitions propagate fatal; later resumptions skip work | 9C implemented. Keep this distinction; swallowing the detecting failure as successful `undefined` would be unsound. |
| Final poison hierarchy, protected construction, immutability, precise native recognition | 9D-A/B explicitly own the remaining cutover. Current mutable poison and transitional ancestry are acknowledged phase debt, not missed 9C work. |
| Stable kinds, hook-free contextualization, raw-cause/source attribution | 9D-A has a detailed causal inventory. Current transport-specific kinds and `valueWithOrigin` are explicitly transitional. Exact-cause access needs finding 2 resolved. |
| Supported thenables, sync-first delivery, FIFO, pending-only protection | 9C addendum implemented. Do not restore caches or normalization queues. Native-result safety needs finding 3. |
| Imported Error overlays, copied mirrors, boundary-owned deferred attribution | Placement/import machinery exists; 9D-A completes Error attribution using it. The staged import pattern is a good model for finding 1. |
| Complete independent Error collection and poison-safe Promise transitions | 9D-A defines membership; 9D-B audits assimilation and publication atomically. Both phases are necessary under the selected thenable-poison contract. |
| Compound flattening, semantic deduplication, immutable children, unspecified order | 9D-A/B cover it. Resolve the occurrence terminology in finding 7; do not retain source-order assertions. |
| `hasError` short circuit and complete `getErrors` | Existing mechanisms; 9D-A changes query-reflection failure. Index validity after recoverable failure is missing. |
| Observation versus mutation poison effects; direct versus nested result failure | 9D-A/B cover kernel transitions; 9F covers authoritative external leaves. Current direct-Error-result discrepancies are scheduled work. |
| Local operation closure and balanced live-execution leases | Existing owners; 9D-A explicitly collapses competing close paths and lifecycle variants. This is useful cleanup if semantic bodies remain distinct. |
| External phase poison, complete predecessor collection, repair and permanent conflict | 9E/F provide concrete state/transition designs. Their non-thenable phase records are justified and differ from collection state. These routes are not implemented by 9C. |
| Promise-valued paths, prefix protection and causal segment failures | Phase 10 gives a concrete path using leases/gates/phases. Preserve unused-segment short circuit and separate target handoff from pending independent results. |
| Imported-Promise processor ownership | Already simplified by the addendum. Phase 11 correctly requires no further rewrite absent new evidence. |
| Promise rejection ownership at producers, reactions and transfers | 9C implemented coverage; 9D-B, 9E and 12 extend the audit. Strict rejection testing is useful but cannot establish graph recovery or assimilation correctness by itself. |
| Compiler operation contexts, shared higher-runtime host/continuation boundaries | Phase 12 names the migration; finding 4 identifies a missing trusted composition surface. |
| Safe `#`/peek diagnostics, route preservation, formatter failure isolation | Phase 12 covers the goal and surface change; finding 8 supplies missing behavioral decisions. |
| Actual export classification and one outward result boundary | Existing classifier is useful. Phase 12 correctly extends it to integration and delegated render APIs. Avoid wrapping internal commands. |
| Platform support | Both current working-tree package manifests already say Node `>=24`. Browser support and the native `Error.isError` requirement still need integration verification. |

**Comparison with Cascada**

The strongest improvements are substantive, rather than naming changes:

- [Cascada's RenderState](C:/Projects/cascada/src/runtime/render-state.js:13) invokes `onError` before rejecting its fatal signal, without protecting that invocation. A throwing reporter can prevent delivery. The kernel's commit/reject/report order and protective reporter catch fix this directly.
- `reportAndThrowFatalError` can throw its newly supplied candidate after an earlier Error is already stored. The kernel consistently throws the execution's authoritative Error.
- A single eager fatal Promise is tolerable for a bounded root race, but is a poor primitive to generalize to many independently exposed operation results. Removable reject actions are appropriate for this kernel's broader obligation. Do not describe Cascada's root-only use as proof of an existing unbounded per-operation race leak; the retention argument is principally against copying that design into the new surface.
- Cascada's [Error implementation](C:/Projects/cascada/src/runtime/errors.js:135) expands context, reads stacks, copies arbitrary cause properties, and combines semantic and presentation state. The planned immutable kernel wrappers and separate diagnostic views remove real coupling.
- Cascada's `RuntimePromise` propagates attribution through wrapper chaining. Boundary-continuation attribution is smaller and more precise when the kernel already owns the necessary import/publication continuation.
- Applying rejecting behavior directly to poison removes `PoisonedValue` conversion and the legacy callback-thrown-poison interception. Cascada's current `finally` also suppresses failures from its callback; that behavior should not migrate into trusted runtime cleanup.
- Cause/context/kind equivalence preserves more useful provenance than Cascada's cause-only key. Removing mandatory semantic sorting is a sound reduction, subject to the explicit occurrence interpretation above.

Keep Cascada's strengths: synchronous progress, complete Error collection as a determinism requirement, producer-side Promise ownership, immutable causal attribution, compact source tables, bounded display, and render-local fatal routing. The new architecture retains most of these well. Dynamic diagnostic routes and host iterator/resource semantics are the two strengths at risk of being lost under broadly worded cleanup instructions.

The kernel currently uses the `runUserCode`/`UserCodeFailure`/paired catcher mechanism; Cascada's inspected call wrappers use broad local catches. Phase 9D-A chooses the simplest shared host-boundary implementation that preserves exact failure classification, and Phase 12 reuses that boundary in Cascada.

**Simplifications and required semantics**

Keep one execution fatal slot, one bounded outward-obligation set, one continuation protocol, source attribution in the causally required continuation, and one staged import mechanism. Keep local owners separate from execution failure. Keep fixed logical overlays and pending mirrors as variants of placement state. The existing `WrappedMethodResult` also demonstrates that a small purpose-specific carrier can be justified when it prevents unrelated result assimilation; the criterion should be its invariant, not the mere presence of a wrapper.

Recoverable **Error values** are native `PoisonError` or `CompoundPoisonError` instances with sync-first rejecting-thenable behavior. They can be detected and processed synchronously without awaiting, while `await errorValue` and native Promise assimilation reject with that exact object. A raw native Error becomes an attributed Error value at its causal boundary and is retained as its `.cause`. `FatalError` and diagnostic views remain non-thenable and have their own distinct roles. Phase 9D-B owns the atomic transport cutover; temporary non-thenable poison before that phase is implementation staging.

**No required Error may be lost.** Complete collection is part of Cascada's determinism: automatic invocation preparation, export, and explicit `getErrors` must collect every semantically distinct Error in their required inputs and captured graph frontier. A recoverable failure cannot close the collector or discard other required work. Given the same selected work and failures, changing availability or settlement order must preserve the complete cause/source/kind membership. Error presentation order remains unspecified.

Rejecting Error values provide synchronous inspection and native-await rejection through one representation. Their assimilation behavior requires publication before outward rejection and non-thenable internal readiness for complete collection. Keep the operation's collection lifetime open until every required input has completed, including after one has failed; release each resource at its own last access. A required sibling that remains pending keeps collection pending. Existing fatal-execution semantics remain authoritative. These mechanisms implement required semantics directly.

**Implementation guidance**

The [conformance plan](first-principles-conformance-plan.md) defines the final requirements, implementation ownership, and verification. Phase 9D-0 repairs recoverable index publication and successful-result native-then safety. Phase 9D-A owns attribution, boundary classification, narrowly justified operation-context checks, complete collection, local closure, and alignment of the architecture and principles. Phase 9D-B installs rejecting Error values atomically with their publication and collection handling. Phase 12 integrates Cascada's compiler, diagnostics, host boundaries, iterator finalization, and platform verification.

Choose internal helper placement, resource-release organization, and equivalent representations using implementation judgment. Preserve the settled semantics and reuse working mechanisms. Investigate uncertain choices within their owning phase; consult the user for a material unresolved semantic decision or when no defensible best implementation emerges. Keep requirements and their reasons in the architecture, and concrete implementation and verification work in the plan. Record each settled design directly rather than retaining historical alternatives or resolved contradiction tables.
