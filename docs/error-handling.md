# Error Handling Architecture

## Purpose

This document defines how Cascada classifies, represents, attributes, propagates, combines, and reports failures. It also defines how a fatal failure closes an execution.

## Terms

- A **raw failure** is a native JavaScript `Error`, thrown value, or rejection reason not yet classified by Cascada.
- A **causal boundary** (formerly **source boundary**) is the exact language or external action allowed to convert an expected raw failure into recoverable Error data.
- A **causal occurrence** is a raw failure attributed to one opaque source context and kind. Existing contextualized wrappers propagate unchanged. Separate constructions may represent the same semantic occurrence; collection compares raw cause, source-context identity, and kind rather than requiring interned wrapper identity.
- A **consumer** reads, stores, propagates, or combines an existing value. It preserves a classified Error and cannot classify a new raw failure.
- **Runtime-owned work** (formerly **structural owner**) is trusted runtime machinery such as traversal, continuation, mirror update, publication, scheduling, or cleanup.
- An **operation** is one issued semantic command and its continuations.
- An **operation owner** holds one operation's open/closed state and operation-only resources, when any.
- An **execution** is one isolated runtime run. It owns graph state, operation work, and fatal state.
- An **operation context** is the immutable `{ execution, errorContext }` record for one operation. `errorContext` is opaque diagnostic source data.
- The **language graph** is the logical data held by Chain roots and reachable placements. A **placement** is one logical `(container, key)` property location.
- **Shared settlement** advances Promise-backed graph state that remains required after one operation closes.
- A **language Error**, or **poison**, is a recoverable `PoisonError` or `CompoundPoisonError`.
- A **fatal failure** is a `FatalError` caused by an internal defect, broken invariant, or unsafe host behavior that leaves execution state, ownership, or ordering untrustworthy.
- A **direct Promise**, or more generally **direct asynchronous result**, is the native Promise or supported thenable returned as a boundary's result. A Promise or thenable nested inside that result is ordinary result data.
- An **operation result boundary** returns one execution-bound operation's direct result. It returns a ready result directly and registers only an actually pending direct result for fatal rejection, removing that registration when the result settles. An immediate non-blocking API return is already final even when internal work continues. Contextless host-configuration APIs have no execution to observe and remain synchronous.
- A **language-outcome transition** is a transition whose contract permits a language Error as its outcome. It may preserve a poison return or rejection and applies the boundary's defined graph effect.
- A **fatal-on-escape transition** is trusted work whose contract permits no language Error escape. Any throw or rejection from it is fatal, including an existing poison.

## First principles

- **Recoverable failure is language data.** It may be stored, returned, inspected, combined, replaced, or repaired.
- **Unexpected failure is fatal.** It is recorded and reported once by each execution it closes. Every still-pending operation result fails with it; internal and detached work stops at its next execution check. It is never admitted or reinterpreted as language data.
- **The cause determines classification.** Classification depends on the action that failed, not whether failure arrived by return, throw, fulfillment, or rejection.
- **The transition contract determines whether poison is expected.** A `PoisonError` proves that an earlier boundary classified a language failure; it does not make an escape from a cleanup, scheduling, bookkeeping, or other fatal-on-escape transition recoverable.
- **Conversion is narrow and single-use.** Only a causal boundary converts an expected raw failure, and it does so once. Consumers preserve the result. Every other raw failure is fatal.
- **Attribution is immutable.** Once poison has a source and kind, or a fatal Error has a source, delay, copying, publication, and later consumption preserve them.
- **Promises change availability, not meaning.** Ready and asynchronous forms of one failure have the same classification and kind.
- **Required collection is complete.** In a live execution, independent required inputs contribute every language Error; fatal execution failure ends that requirement and later resumptions return immediately.
- **Fatal handling is simpler than recovery.** Fatal failures are neither admitted, combined, queried, repaired, nor reclassified.
- **The first fatal failure owns shutdown.** It closes the execution to all further graph and operation work and becomes the result of every still-pending execution-bound operation. Already-registered internal continuations return at their next execution check.

The default is strict: an unclassified exception or rejection is fatal. Recoverable behavior always requires an explicit causal boundary.

The exported Chain constructors, operation contexts, and graph operations form the trusted kernel integration protocol used by Cascada; “operation result boundary” does not make their control facts application language data. The kernel does not defensively validate an omitted or malformed operation context: a malformed root integration call produces an ordinary JavaScript programming error and creates no contextless fatal outcome. If such a defect escapes work already running under a valid operation context, that enclosing fatal guard submits it normally. Chain/context execution mismatch and new issuance through a closed entered Chain remain fatal checks before graph access because they protect actual execution isolation and capability lifetime. Cascada supplies these facts and validates its application inputs separately.

## Failure model

### Error hierarchy

~~~text
Error
|- PoisonError
|  `- CompoundPoisonError
`- FatalError
~~~

- `PoisonError` directly extends native `Error`. It records a nonempty stable `kind`, originating `errorContext`, and optional exact `cause`.
- `CompoundPoisonError` extends `PoisonError`. Its trusted factory supplies distinct poison leaves, and the constructor freezes that finalized array. The factory expands direct compound inputs by one level before deciding whether multiple leaves require a compound. Because every compound has this invariant, nested compounds require no recursive traversal.
- `FatalError` directly extends native `Error`. It records its originating `errorContext` and exact cause. Under the supported stable Error prototype contract it has no callable `then` and is not a language thenable.

The kernel creates these Errors through factories in the Error module. `createPoisonError(reason, operationContext, kind)` submits an existing `FatalError`, preserves existing poison, and otherwise creates one causal poison occurrence; `combineErrors` creates the compound form from semantically distinct leaves with unspecified order. Semantic recognition first uses native `Error.isError`, which rejects arbitrary Proxy values without prototype traversal, and then ordinary `instanceof` inheritance. Standard Error constructors and prototype chains must remain unmodified. The runtime is a programming API rather than a security boundary: direct construction, subclassing, prototype replacement, or prototype mutation is unsupported deliberate misuse and receives no token, registry, exact-prototype machinery, or frozen shared prototype. Internal factories trust their compiler/runtime-supplied kind and source rather than repeating defensive validation. Each factory installs every subclass field before freezing the complete wrapper; a compound first copies and freezes its `.errors` array. Distinct compound kinds are derived from those leaves only when diagnostics need them; they are not duplicated in semantic Error state. The opaque `errorContext` is itself an immutable handle or value. The exact cause remains a diagnostic identity outside the language graph; later host mutation of that external object cannot replace the wrapper's cause reference or change its stored message, classification, or source. Do not copy arbitrary enumerable properties from the cause or read its stack while constructing the kernel wrapper; guarded diagnostic formatting may inspect the exact cause later without changing semantic Error data.

There is no shared kernel `CascadaError` base. Such a base adds no capability and permits an ambiguous Error that is neither recoverable nor fatal. Cascada may retain a separate compile-time Error base.

### Recognition

Recognize every native Error form before inspecting Promise or thenable behavior:

~~~text
FatalError                         -> fatal; never language data
PoisonError or CompoundPoisonError -> existing language Error
native Error                       -> raw Error requiring contextualization
anything else                      -> not an Error
~~~

Consequences:

- Use precise predicates: `isPoisonError(value)` for language poison, `isFatalError(value)` for fatal state, and native `Error.isError(value)` for any native Error form. Do not use one semantic `isError` predicate that conflates raw native Errors with admitted poison.
- Guard thenability inspection with native `Error.isError(value)`, so no Error form, including `FatalError`, has `then` read.
- A native Error remains an Error even when it has a callable or throwing `then`; Cascada never reads that property.
- Declaration APIs return an existing Error unchanged before probing thenability.
- Import and assignment contextualize a raw native Error before storing its logical value.
- Imported physical storage may retain a native Error while its placement version contains the contextualized occurrence.
- Ordinary graph consumers encounter contextualized language Errors or fatal `FatalError` values, not unclassified native Errors.
- The common post-boundary ready-admission choke point accepts only poison among Error values. It submits `FatalError` and treats any remaining raw native Error as a fatal missed-boundary defect. An inbound boundary may inspect a raw Error only while creating its occurrence wrapper before that admission.

### Failure kinds

One frozen public `ERROR_KIND` object owns the complete vocabulary below. Every runtime call site supplies one specific PascalCase constant whose key equals its string value; there is no empty, arbitrary, or generic fallback. Trusted factories use this table directly instead of paying for repeated runtime membership validation. Focused construction and route tests verify the resulting kinds. Messages remain presentation and do not substitute for kind or source.

| Area | Kinds |
| --- | --- |
| Availability and paths | `ChainValueFailed`, `ContextValueFailed`, `AssignmentValueFailed`, `OperationInputFailed`, `PathSegmentFailed`, `InvalidPathSegment`, `ThenAccessFailed`, `ThenInvocationFailed` |
| Import and lookup | `ImportReflectionFailed`, `NullLookup`, `ScalarLookup`, `LookupReflectionFailed`, `QueryReflectionFailed` |
| Invocation and conversion | `MissingFunction`, `NotAFunction`, `InvocationFailed`, `ControlledCallbackFailed`, `InvalidCallbackResult`, `ScalarConversionFailed`, `UnsupportedMutation` |
| Export and mutation | `ExportReflectionFailed`, `PropertyMutationFailed`, `PropertyValidation`, `InvalidManagedReceiver`, `InvalidArrayLength`, `InvalidArrayOperation` |
| External state | `ExternalLocationConflict`, `ExternalPropertyReadFailed`, `ExternalPropertyWriteFailed`, `ExternalPropertyDeleteFailed`, `InvalidExternalContainment`, `ExternalCapabilityEscape`, `InvalidExternalSnapshot`, `ExternalRepairFailed` |
| Higher Cascada runtime | `DivideByZero`, `ImportBindingMissing`, `IncompatibleOperands`, `InvalidConcurrentLimit`, `InvalidTextValue`, `IteratorFailed`, `LoadFailed`, `NaNResult`, `NotDestructurable`, `NotIterable`, `UnknownVariable` |
| Compound meta-kind | `Multiple` |

This table is authoritative. A new feature changes it and its exact causal-boundary inventory together; implementation-only additions are not permitted.

Kinds describe the violated semantic contract, not transport or merely the physical mechanism that threw. Ready Error values and Promise rejections at the same boundary use one kind:

| Boundary | Kind |
| --- | --- |
| Chain initialization | `ChainValueFailed` |
| Context import | `ContextValueFailed` |
| Assignment | `AssignmentValueFailed` |
| Operation input | `OperationInputFailed` |

Arrival mode is not structured data. Preserve the exact cause for diagnosis, but do not infer whether it was returned, thrown, fulfilled, or rejected. Every unsupported controlled-callback result uses `InvalidCallbackResult`: a Promise where synchronous output is required and a ready value of the wrong type violate the same callback-result contract and have the same graph effect. The message identifies the violated constraint.

`InvalidExpressionValue` identifies a selected null, undefined, Symbol, or non-primitive at `lookupPathForExpression`; it is a new extraction failure at that operation's source. Existing Error propagation never changes kind.

The opaque source identifies the causal source handle, not a unique dynamic invocation; collection identifies a failure by that handle, raw cause, and kind. It does not replace the stable machine-readable kind. Split kinds only when the violated contract, graph/result effect, recovery meaning, or materially useful diagnosis differs. An external property observation therefore uses `ExternalPropertyReadFailed` whether its getter or Proxy trap throws, its direct value is an Error, or its direct Promise rejects. Likewise `InvocationFailed` covers the selected invocation and its direct result boundary. Import, lookup, query, and export reflection retain distinct kinds because failure has distinct operation outcomes; collapsing them merely to `ReflectionFailed` would erase that contract difference. Splitting one boundary by transport or ready-result inspection would instead add policy without changing recovery, graph effect, or diagnosis materially.

## Boundary classification

### Decision cascade

Each causal boundary applies one rule:

~~~text
existing FatalError     -> submit unchanged to the current execution; propagate its authoritative fatal Error
existing language Error   -> preserve unchanged
expected raw failure      -> PoisonError(source, kind, exact cause)
successful value          -> continue boundary processing
any other raw failure     -> FatalError; fail the execution
~~~

Boundary and consumer are roles of actions, not modules. One import, lookup, export, or invocation may consume an existing Error in one step and cause a new failure in another.

Causal boundaries include:

- language validation;
- first consumption of a native Error introduced through import or assignment;
- supported host calls, accessors, reflection hooks, comparators, and callbacks;
- a direct Promise returned by supported external code;
- supported import, lookup, conversion, and export reflection;
- documented external-operation failures; and
- any other language operation explicitly defined as producing poison.

A synchronous throw, explicitly returned native Error, and direct-Promise rejection use the same kind when they represent failure of the same action. A direct Error result always means that boundary failed; returning an Error as successful payload is unsupported. Ready and asynchronous delivery therefore have the same graph effect. An explicitly returned native Error is contextualized once, while an existing poison is preserved.

### Supported synchronous external code

One private external-escape protocol separates exact external actions from their causal failure handling. The three-argument `runExternalBoundary(operationContext, kind, action)` composes that protocol for direct language-result calls and also contextualizes returned native Errors. `runExternalAction` marks one Boolean on the selected execution for only the exact synchronous action, restores its previous value in `finally`, and checks that execution's fatal state after either return or throw. An ordinary throw carries a private identity brand through shared graph helpers; the owning `catchExternalThrow` consumes only that marker and supplies its operation context and fixed kind. Contextualization and the causal caller's failure effect run outside recovery. Recovery encloses each initial or resumed semantic step inside its fatal guard; an issuance-level catch cannot recover an escape already classified by an inner guard. Complete collectors recover descriptor failure per candidate key and continue accessible siblings. Receiver validation retains its accumulated failures when later reflection fails; mutation completion combines any already discovered independent result-import failure into the operation result. Unmarked internal failures escape to the fatal envelope. Markers are neither language data nor an integration API. No global depth, second recovery mode, mutable policy on operation contexts, or separate post-external-action check exists.

The private marker keeps shared enumeration, descriptor, numeric, and placement helpers on their ordinary return contracts. Returning poison directly from an exact key-reflection action requires a poison branch before filtering or iteration and at every intervening indexing/export caller. A descriptor reader can also legitimately return graph poison, which differs from a query's own reflection failure. The single escape carrier preserves that distinction without threading classification policy through every graph helper. Query/index/export regression tests pair recoverable traps with adjacent internal defects and verify retained cyclic indexes. The public integration helper uses this same producer and consumer; there is no parallel direct-classification mode.

`createPoisonError` submits an existing `FatalError` and throws the receiving execution's authoritative fatal, preserves existing poison, or creates a frozen leaf containing the exact raw cause, source-context handle, and kind. The post-external-action checkpoint runs before interpreting the action's outcome, including when external code swallowed a fatal re-entry exception. Protocol probes select their semantic result inside the action: a non-callable native Error-valued `then` is a successful probe, while throwing that Error is `ThenAccessFailed`.

Keep receiver preparation, argument export, result import, publication, bookkeeping, and cleanup outside the external-action envelope. Any unmarked failure from that work is fatal. Supported external code must not synchronously re-enter the same execution. An outer transition has not yet published an ordering point, so a nested mutation could otherwise overtake it and then be overwritten. Installing a Promise gate before every ready host mutation would add an asynchronous publication path to the common synchronous case. Reject same-execution re-entry as a fatal host-contract violation instead. Another execution remains independent and may run synchronously; compiler-controlled calls and recursion are internal work rather than external actions. The Boolean never spans a Promise boundary. The post-external-action fatal check remains necessary when external code catches the violation or a reporter re-enters after fatal commit.

A direct host Promise settles after the synchronous envelope. Its first existing boundary continuation captures the source and kind when the Promise is accepted and classifies a raw rejection when it runs. The operation's existing returned Promise carries that outcome. Do not recreate the envelope, persist attribution on the source Promise or its metadata, or allocate an attribution-only Promise.

Application callbacks and effectful reflection are supported external code. Captured intrinsics on runtime-owned data, including runtime-owned remap traps, remain trusted work. Their predictable Array index/length failures are validated before invocation; any exact reflection on host-controlled storage uses the private external-action producer. An application comparator is its own `ControlledCallbackFailed` boundary. A Promise returned in that unsupported callback-result position is rejected as `InvalidCallbackResult` and its rejection is owned. “Native code” alone is not a recoverable category.

### Conservative probes

`runExternalBoundary` applies only when failure of the supported external action is itself the operation's language outcome. A probe whose documented result includes “cannot determine” owns that result locally instead of manufacturing poison that its caller would discard:

- Admission classification performs only its exact reflection probe. If ordinary host reflection cannot establish a supported structure, the result is the existing conservative external-category fact. Because admission is execution-bound, the probe checks `execution.fatalError` after either return or throw, and an existing `FatalError` is submitted normally; neither may be hidden by the fallback.
- A declaration is contextless host configuration. It preserves native Errors and performs ordinary supported-thenable recognition as it reaches each identity. A callable `then` is invalid declaration input; inability to inspect an unsupported identity produces an ordinary declaration-validation Error because the declaration cannot establish that the identity is safe to declare. It neither reads nor changes any execution's active-external-action Boolean and may be called during an external action. Deliberately recursive configuration through its own reflection is unsupported programming-interface misuse rather than another guarded state. Unexpected implementation exceptions escape synchronously, and an existing `FatalError` is thrown unchanged; declarations construct no fatal outcome. The probe creates no poison, kind, execution state, Promise, thenability cache, or synthetic thenable.

These are explicit probe semantics, not another host-failure policy. Keep their exact `try`/`catch` at the probe that owns the fallback. Do not add a generic completion record, callback, policy mode, or second host-boundary framework merely to share their different result shapes. Other effectful reflection whose failure is observable uses the exact external-action producer and its causal consumer; a complete language-result call uses their `runExternalBoundary` composition.

Invalid host output is recoverable only when the boundary can reject it without compromising runtime invariants. Examples include an unsupported controlled-callback result and a managed receiver whose completed state fails validation. Host behavior is fatal when it makes runtime state, ownership, ordering, publication, or cleanup untrustworthy. Do not classify both cases under a generic “host-contract violation.”

### Transition and catch roles

Expectedness belongs to the transition contract, not the Error class. A poison returned or rejected through a language-outcome transition is recoverable. The same poison escaping a fatal-on-escape transition is evidence that trusted work violated its contract and is fatal. The common continuation mechanism checks execution and local lifetime only; each transition body owns its Error semantics explicitly:

~~~text
language-outcome body:
    ready or fulfilled poison -> apply the defined language-Error transition
    poison rejection          -> apply that same transition
    FatalError                -> submit unchanged
    other unexpected failure  -> fatal

fatal-on-escape body:
    execute trusted work
    on any throw or rejection, including PoisonError -> fatal
~~~

Failure-classifying and recovery catches have only these roles:

1. `runExternalBoundary` catches only the exact synchronous external action, performs the one post-external-action fatal check, and then preserves or contextualizes its reason; its causal caller applies the boundary's graph effect outside that catch.
2. A language-outcome continuation body recognizes an existing poison before the fatal-on-escape lane and performs its exact publication, collection, or result transition.
3. A fatal-on-escape envelope submits an existing `FatalError` unchanged or contextualizes every other escaping failure, including poison, and propagates the execution's authoritative first fatal Error.
4. The reporter catch preserves the committed fatal outcome. Local cleanup uses ordinary `try`/`finally` only to clear its own live-operation state; a cleanup failure is not reclassified or swallowed and becomes fatal through the surrounding fatal-on-escape envelope.
5. An explicitly specified conservative probe catch returns only that probe's indeterminate or validation outcome. It creates no poison and never hides an existing or newly committed execution fatality.

No other catch reclassifies failure. Rejection handlers that only establish Promise ownership are not classification catches. Expected synchronous language Errors normally return as values. When a native API requires throwing to abort, such as an Array comparator, one exact adapter catches that deliberate poison escape and applies its language transition before it can reach a fatal-on-escape envelope.

A trusted callback's declared result decides which continuation consumes it. If its result admits a language Error, a ready poison and a direct-Promise poison rejection have the same recoverable meaning. If its result admits no poison, any poison throw or rejection is fatal. For a callback result that admits recoverable rejection, an async throw and Promise.reject with that Error are the same rejection channel. Both normalize to ordinary Error data at that declared boundary. A Promise fulfillment with an ordinary Error already carries the logical result; no tagged protocol is needed. Keep such contracts narrow and compiler-controlled.

Runtime-owned failures are always fatal, including failures in:

- mirrors and placement versions;
- COW and refcounts;
- leases, gates, and external phases;
- internal graph traversal and publication;
- operation lifetimes and cleanup; and
- schedulers or trusted callbacks without an explicit supported-external-action contract.

Effectful reflection on user-controlled identities remains supported external code even when reached by an Error query. A safely rejectable query reflection failure produces `QueryReflectionFailed` for that query; it is not a found graph Error. Refcount, index, mirror, or other hook-free query machinery failing remains fatal because it violates trusted state. Index construction prepares new counters, cuts, and reverse-edge additions locally through fallible reflection and logical-version normalization, then commits a complete downward-closed region synchronously without host hooks. Recovering from reflection failure abandons those staged facts and leaves every retained index valid, including targets reached through cycle cuts. Shared property settlement still uses its ordinary publication transition.

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

An existing language Error or `FatalError` keeps its source. A later consumer supplies context only to a new failure it causes. This is causal, not chronological: a Promise introduced by import keeps the import source when it rejects later, while an invalid lookup through successfully imported data uses the lookup source.

A Chain retains its execution, not initialization source as a fallback. Initialization context applies only to work it introduces; later operations supply their own contexts. Contextless source is reserved for genuinely executionless configuration. Diagnostic-route data may supplement a causal source but never replace it.

Retain an operation context only while deferred work may still create a newly attributed Error. Once settlement produces a successful value or contextualized Error, propagation needs only that result.

### Native Error occurrences and import

Contextualize raw native Errors at their introducing boundaries; propagate an existing contextualized Error by reference:

- Preserve the native Error unchanged as the wrapper's exact `cause`.
- A separate introduction may create another immutable wrapper; collection merges equivalent wrappers by raw cause, source-context identity, and kind.
- Propagating a contextualized occurrence preserves its wrapper exactly.
- Root import returns its occurrence wrapper.
- Nested import leaves host storage unchanged and stages the wrapper as the parent-key placement's fixed logical version.
- A failed import segment commits neither the wrapper nor any other staged fact.
- Promise fulfillment begins another atomic import segment; it neither reopens nor rolls back the earlier segment.

Store no wrapper on the native Error identity and keep no execution-wide or runtime-wide Error cache. Reuse through an existing walk map is optional; do not retain that map across import segments merely to intern wrappers. Semantic equivalence is resolved during collection.

### Promises, mirrors, and thenables

- A raw rejection uses the boundary that introduced its Promise. Introducing one raw rejecting Promise at two boundaries creates two causal occurrences.
- A pending Chain root installs its exact initial version and mirror during initialization. The resolver continuation captures the initialization operation's source until settlement.
- Contextualize in the first import, mirror, validation, or publication continuation already required by the boundary. Its closure retains source and kind until it runs. Add no forwarding Promise merely for attribution.
- For a direct operation result, later work consumes the Promise returned by that boundary continuation. For a graph placement, later continuations use FIFO only as readiness and read the contextualized logical value already published to the mirror; they never reinterpret the raw settlement payload.
- A copied or derived pending placement gets a new mirror at its program position and preserves the source mirror's eventual contextualized Error by reading it after the source resolver's FIFO position.
- Store no attribution on the source Promise, its identity metadata, the Chain, or the mirror. Once settlement succeeds, the value needs none; once it fails, the contextualized Error itself carries source and kind.

This removes sideband attribution, not state with a different purpose. A Promise's settlement is immutable, while later FIFO consumers may transform a placement's logical value, so the mirror still stores that current value. Fixed imported logical overlays preserve host storage whose physical Error or synchronously consumed custom thenable differs from its final language value; complete Error collection retains every required logical failure; and `execution.fatalError` provides synchronous fatal state. None is an alternate place to store Promise attribution.

Every representation boundary consumes logical placement versions, whether fixed or pending. Managed receiver preparation materializes the affected containers and ancestors when their physical slots differ from the prepared graph; it preserves aliases and cycles without copying the whole receiver by default. Derived ArrayViews retain fixed logical values as well as fresh mirrors for actually pending placements. Neither route rereads a raw Error to attribute it again or resubscribes to a synchronously consumed thenable. Placement replacement and removal complete fallible physical storage work before detaching the old version or committing the prepared refcount change, so a rejected storage operation that leaves physical data unchanged preserves every surviving alias and index.

The [managed-storage Proxy contract](data-limitations.md#proxies-in-managed-storage) requires each primitive property write, definition, or deletion to implement the requested operation on success and leave the represented graph unchanged on failure. Supported failures use the ordinary causal Error path; the kernel does not detect Proxies, roll back storage, or guarantee recovery from a trap that changes managed data and then fails. This rule applies to individual managed-storage operations. Ordinary managed methods may mutate their working receiver before failure, and authorized external mutation may leave completed effects and poison its phase. Runtime-internal Array remapping Proxies retain their existing role.

The supported thenable contract is defined by [`data-limitations.md`](data-limitations.md). Native Promises use standard behavior. A custom thenable exposes a stable callable `then`, supports the subscriptions Cascada makes, represents one outcome, and implements chainable sync-first return behavior. It notifies subscriptions in registration order even across settlement: a later ready subscription cannot overtake an earlier undelivered one. It may invoke a callback before `then` returns when already settled. A synchronous callback throw escapes that call; a callback that throws after pending delivery rejects the returned chain. It supplies final non-thenable fulfillment values and owns any nested assimilation. A host implementation that cannot provide this contract supplies a native Promise instead. Dynamic accessors, Proxy-dependent or changing `then`, inconsistent settlement, insufficient subscription support, non-FIFO notification, and custom fulfillment with another thenable are unsupported host behavior. Cascada does not validate or repair these cases.

Use one common continuation helper, but let the thenable remain the one continuation mechanism. At each consumer's program position the helper performs an ordinary `then(onFulfilled, onRejected)` subscription, with the execution/lifetime guard and that consumer's semantic transition in the supplied callbacks. A synchronous callback completes in the same turn; do not add a native Promise or microtask merely to normalize it. A pending subscription returns the chain supplied by the thenable. Only that pending return, not the mere fact that the input had a callable `then`, enters an aggregate wait, retains pending-only protection, or reaches public fatal-result registration. All ordering-sensitive subscriptions use this helper so registration positions remain explicit, but Cascada keeps no execution-wide thenability cache, captured callable, canonical settlement Promise, first-settlement record, subscriber queue, species-defense path, or active custom-thenable assimilation set.

Raw possible-Promise recognition and returned-chain pending recognition are different questions. At a raw boundary, recognize Error and Function and consult fixed admitted metadata before any `then` access; an identity already admitted as non-Promise is never reinterpreted by a later context-free shape probe. The raw consumer performs recognition and subscription as one effectful boundary operation rather than first using a Boolean probe that reads `then` again. A returned chain is already in the trusted continuation-result domain and needs no persistent identity fact. Do not introduce a `{ pending, value }` result algebra: the common helper's direct callback result versus pending chain already carries the distinction.

Use the returned transition result itself as the only readiness signal. A transition callback that begins another possible Promise must consume it through the same helper before returning; therefore, after Error, Function, and fixed admitted-category precedence, a thenable still present in this trusted result position is actually pending. Do not add a `callbackRan`, `settledSynchronously`, or backwrite-observed flag. A callback may update a mirror, aggregate slot, receiver, or query state because that is its semantic effect, but the helper return identifies pending work without using that update as a readiness flag. The selected target and publication facts determine which dependency still needs protection; only a pending outward result receives fatal-delivery registration.

Calling `then` is a narrow trusted scheduling protocol, not an arbitrary host callback. Do not mark the execution as inside an external action while the supplied kernel continuation runs; otherwise every legal synchronous delivery would look like forbidden re-entry. The thenable body performs its own subscription, delivery, and chaining work and must not synchronously invoke Cascada APIs except through a supplied callback. An escaping `FatalError` from that callback is preserved and unwinds synchronously. A throw from accessing `then`, or from invoking its body before a callback supplies the outcome, is classified as `ThenAccessFailed` or `ThenInvocationFailed` at the exact recognizing or subscribing boundary. A callback delivered after its original subscription returned pending rejects that returned chain on failure, including when a newer subscription drains it. Catching such an older failure is required chaining behavior; swallowing a throw from the currently supplied synchronous callback is unsupported. The subscription-exit check gives an already-committed fatal precedence over either the new result or an invocation throw. Cascada adds no state to diagnose unsupported protocol violations.

Each causal boundary interprets the fulfillment or rejection delivered to its own subscription using its own operation context. A raw rejection reused at two causal boundaries therefore creates two contextualized poison occurrences; later propagation of either occurrence preserves it. Promise mirrors remain per placement and version because later FIFO consumers may transform that placement's logical value; they do not duplicate thenable settlement state.

Consume a possible placement thenable before choosing its representation. If its resolver transition returns directly, publish the final value directly into runtime-owned storage; when imported or non-writable physical storage must be preserved, reuse a fixed placement overlay for that final logical value. Install a changing Promise mirror only when the resolver transition actually remains pending. The resolver may write the logical value into unpublished staging state, but its returned direct-or-pending shape, rather than whether that write occurred, selects the representation. Initialize callback-visible unpublished staging and captured versions before subscribing, without installing a changing mirror or other pending-only machinery. Once the resolver returns pending, JavaScript run-to-completion prevents later asynchronous delivery from interleaving before its pending mirror is installed.

Error recognition precedes thenability recognition. Admission also preserves an identity's already-fixed category before probing; the metadata short-circuit is an admission invariant, not a thenability cache. Failure while ordinary raw recognition or subscription invokes supported host behavior belongs to that exact causal boundary. The contract does not require special diagnosis for an unstable getter or broken ordering: a safely observed throw is classified normally, while an undetectable ordering violation is an unsupported host-contract violation.

Readiness and publication authority remain scoped to the work they describe. A pending independent result cannot extend completed path selection, receiver publication, or source capture. Import subscriptions share one segment-local lifecycle fact, `staging -> committed` or `staging -> abandoned`. Commit grants semantic publication authority; abandonment makes later callbacks return after the common execution and segment checks without that work. Release staging collections on either terminal transition while retaining rejection ownership of already-created reactions. Synchronous custom delivery joins the current staging walk; later delivery for a committed placement starts a new segment. No committed shared version exists for an abandoned import subscription to settle.

### Hook-free contextualization and diagnostics

Exact causes follow the diagnostic-payload contract in [data limitations](data-limitations.md#errors). A host reason must not expose protected managed receivers, arguments, or mutation-capable external identities through its fields, prototype, or nested cause. Throwing the receiver itself or attaching it to an Error is unsupported. Kernel validation uses diagnostic-only messages; compliant native Errors and primitive reasons remain exact without a cause-graph walk, copy, or deep freeze. Freezing the wrapper preserves attribution, not cause isolation.

Contextualization invokes no external code. It never calls getters, coercion hooks, `toString`, `then`, `stack` or `cause.stack`, or arbitrary Error properties.

- Preserve the exact thrown or rejected value as `cause`.
- Derive a message only from primitives or safely inspected own data properties; otherwise use fixed text.
- Copy no cause properties onto the wrapper.

The kernel stores classification and structured facts, not formatted source presentation. `.message` contains no opaque source fields or compound-child listing. Kernel Errors expose `name`, `message`, `kind` for poison, opaque `errorContext`, optional exact `cause`, and `.errors` only on `CompoundPoisonError`; they do not expose Cascada's legacy `_errorContext`, expanded `context`, `fullMessage`, `totalErrorCount`, `kinds`, `getInfo`, or per-location convenience fields. The higher runtime formats source data, diagnostic routes, cause stacks, and bounded compound displays into a separate immutable, non-thenable diagnostic view outside graph transitions and under `try`/`catch`. Its child and cause fields contain only diagnostic views or safe scalar presentation, never a poison/native Error or exact hostile cause that language access could consume again. Error inspection returns `null` for healthy data and this view for poison; query failure remains poison. It does not add presentation fields to the frozen Error. Formatter failure cannot change the stored Error or outcome.

Host-configuration APIs remain outside language execution. A documented declaration validation failure, including conflicting declaration, invalid declaration value, or unreadable thenability, returns an ordinary Error value synchronously and changes no configuration. Malformed invocation of another host-configuration API may throw an ordinary host API Error when its own contract says so. An unexpected implementation defect escapes synchronously without constructing a `FatalError`; an existing `FatalError` supplied to the API is thrown unchanged. Every authentic fatal outcome originates through execution-bound `failExecution`, so contextless configuration creates no poison, fatal state, or reporting path.

## Recoverable Error behavior

### Graph Errors and expression failure values

PoisonError and CompoundPoisonError are ordinary non-thenable native Errors. The graph and normalized kernel operations carry these Errors as data. A ready result is a value or Error; pending recoverable completion fulfills with that same logical outcome after required processing. Raw host rejection is contextualized at its causal input boundary. An unexpected rejection escaping a trusted transition remains fatal.

The separate expression-facing PoisonedValue is an immutable non-Error container holding one ordinary leaf or compound Error in its immutable .error field. Its source, cause, kind, and children are not duplicated. Public createPoisonedValue and isPoisonedValue provide creation and precise recognition. It supplies synchronous, repeatable rejection delivery:

~~~js
then(_onFulfilled, onRejected) {
    return typeof onRejected === "function" ? onRejected(this.error) : this
}
~~~

Native await and assimilation reject with the contained Error. Returning that ordinary Error from a native rejection handler fulfills successfully; returning its PoisonedValue propagates rejection. The container adds no scheduling, callback catch, catch/finally API, grouping, attribution cache, or RuntimePromise. A raw native Error remains an Error even if it has a hostile then property; the kernel never probes that property. FatalError stays non-thenable and is never language data.

Public lookupPathForExpression(chain, path, operationContext) reuses ordinary path observation and accepts only String, Number, Boolean, and BigInt primitives. Null, undefined, Symbols, and non-primitives are unsupported. It preserves a selected Error. Another unsupported value produces InvalidExpressionValue at the extraction's source without coercion, deep export, descendant inspection, or source mutation. Existing path, reflection, and external-authority checks still apply. Cascada operators own operand combinations and numeric validity. The compiler retains graph and call results in operation Chains and uses this API whenever a result enters primitive expression evaluation.

Normalized kernel results have shape T | PoisonError | Promise<T | PoisonError>. With ExpressionValue defined as string | number | boolean | bigint, expression extraction has shape ExpressionValue | PoisonedValue | Promise<ExpressionValue>, with pending failure rejecting directly with the ordinary Error and no intermediate PoisonedValue allocation. Convert only at the final expression-facing result boundary after required kernel work. A ready failure returns its container synchronously, with no pending-result registration or graph protection. A pending expression operation owns exactly one final outward fatal obligation; conversion cannot detach it from required work or allow fatality before final settlement to appear successful.

Cascada also creates failures during expression evaluation. Those producers use the same public attributed-Error factories and expression wrapper factory. At inputs allowing availability, consumption in the opposite direction unwraps ready expression poison by its ordinary rejection callback or handles a rejected expression Promise, then stores only the ordinary Error. Boundaries forbidding thenables retain their existing validation outcome. No container-specific admission or pending-detector branch is needed. Existing attribution is preserved; wrapping is never a new causal event.

Error inspection stays successful: getErrors returns or fulfills with null when healthy, the unchanged leaf for one distinct Error, or a CompoundPoisonError for several after complete collection. It creates no PoisonedValue and does not reject because Errors were found. Query failure is a separate ordinary Error result. hasError is existence-only and may finish early. A caller explicitly propagating a non-null completed result uses the ready failure factory or direct pending rejection, without combining it again. Diagnostic views remain immutable safe data. A query result used in an expression crosses primitive extraction through a Chain; direct JavaScript truthiness of a query Error or PoisonedValue would incorrectly turn failure into success. Final script delivery completes export first and converts a failed exported result to native rejection at the higher-runtime outward boundary. After their distinct validation or export prerequisites, these boundaries return a container only for synchronous failure and reject an existing pending result directly with its ordinary Error. The [integration recipe](integration.md) specifies ready and pending conversion without exposing managed objects to expressions or changing fatal ownership.

Phase 9D-B supplies this public contract; Phase 13 changes the Cascada compiler and runtime consumers. The source implementation status is recorded in the plan.

### Publication and complete collection

Ordinary Errors can safely fulfill native Promises. Publish or retain the Error in its logical location before the operation completes with that same Error. Rejecting expression containers remain outside graph storage and normalized transition results.

A recoverable failure while publishing an already failed value retains both Errors. Property preflight, index preparation, and writeback retries combine the current diagnostic with each newly discovered failure before publishing the mirror. Mutation coordination retains the existing receiver/result outcome through target publication and every enclosing writeback, including gate-installation failure. Gate completion consumes the committed logical version, with its continuation registered at issuance after shared settlement and before later operations can advance that version. A raw gate fulfillment alone does not establish publication success. A mutation that has an independent result keeps receiver publication separate: publish a receiver failure immediately and combine it with an already selected result Error, waiting only for that independent direct result if necessary. Release completed receiver protection while result collection continues. Do not scan nested result payload or add another gate for it.

Normalized language-result continuations receive ordinary Errors through the same success callback as other logical values. Returning the Error safely fulfills a native Promise. An input or callback channel that explicitly admits recoverable rejection converts it once before these transitions; ordinary trusted continuations retain fatal-on-escape behavior.

Graph publication stores the Error and completes required bookkeeping before returning or fulfilling with it. Complete independent-input collection records every required result and combines failures only after its captured frontier completes. Keep readiness-only waits where they express scheduling; do not box an Error solely to defeat assimilation or add a recoverable rejection branch to every internal callback.

Local completion and structural Array work use those same logical payloads. Searching, flattening, and retaining an element do not consume its Error merely because they move or compare it. Only required conversion, receiver preparation, or export consumes a failure. Preserve mutation receiver/result records and external phase records because they encode distinct effects and ordering, independently of Error transport.

### Compound Errors

~~~text
combine(errors):
    require at least one input; zero is fatal
    expand direct CompoundPoisonError values to their invariant leaf arrays
    deduplicate by raw cause, source-context identity, and kind
    retain one representative per semantic Error; order is unspecified
    return the exact leaf if one remains
    otherwise return CompoundPoisonError(leaves)
~~~

Use one collection-local `flattenAndDeduplicateErrors` rule in both `getErrors` and the `combineErrors` factory. The key is the tuple `(raw cause, opaque source-context identity, kind)`. Compare object and Function causes by identity, and primitive reasons by ordinary Map key equality; compare the retained context handle directly without inspecting its diagnostic fields. A leaf without a cause uses its own identity as the first key component. Distinct contexts or kinds remain distinct even with one cause. Expand each direct compound to its already-flat child array, deduplicate, and retain an existing immutable leaf as the representative. Recursive flattening is unnecessary because the factory establishes the leaf-only invariant. Normalize before allocating an Error: `combineErrors` returns a sole leaf unchanged and constructs a compound only for several leaves. The constructor trusts the finalized array and freezes it. No temporary compound, persistent Error registry, or canonicalization across executions is needed. Propagation of an already-contextualized Error preserves its exact reference; equivalent separately constructed wrappers need not be `===`.

The compound:

- preserves every surviving leaf's source and kind;
- exposes one representative of every semantic leaf through its frozen `.errors` array, with unspecified order;
- uses that kind when all leaves match, otherwise `ERROR_KIND.Multiple`;
- uses a retained leaf as representative context without promising a primary or earliest failure, and without changing any child; and
- requires no shared source ancestor.

Combination deduplicates equivalent wrappers without merging distinct source contexts or kinds. The caller's message names the failed boundary without enumerating children. Presentation may sort, group, cap, or summarize a separate diagnostic view; it never reorders or changes an already-created compound.

### Graph and operation effects

- Language Errors may occupy roots, placements, mirrors, and independent results. Assignment and deletion may replace them.
- Repairable external poison stays in phase metadata when replacing the target would destroy its capability. Repair clears old poison on success or replaces it with the repair failure; it never silently converts failure to success.
- Errors never cross export as host data. An Error found in arguments prevents host invocation after all required argument and nested Errors are collected and combined.
- Existing input Errors preserve their source. A new export or validation failure uses the current invocation and exact boundary kind.
- An observation failure normally affects only its result.
- A mutating call's preparation, method, validation, or direct-result failure normally poisons its receiver placement after the defined graph effect. Every direct Error result is a direct-result failure, whether ready, explicitly returned, fulfilled, or rejected. Failure while importing an independent result graph, or reached later through its nested values, does not poison an otherwise successful mutation.
- If poisoning managed state would remove authoritative external capability, preserve the scope and return the Error.
- A normalized kernel result returns or fulfills with its ordinary Error after required processing. Primitive expression extraction and final native script delivery explicitly convert failure to rejecting transport.
- On success, `hasError` returns a Boolean and stops once an Error is proven. Already-started shared settlement and publication finish, but unused query work explores no further.
- On success, `getErrors` scans its complete captured graph and Promise frontier and returns null for no Errors, the unchanged leaf for one distinct Error, or a compound for several. Use the common combination factory once at completion, preserving every distinct cause/context/kind class and unspecified child order.
- Supported host reflection failure during either query returns or fulfills with QueryReflectionFailed, separately from a successful Error collection. hasError never converts it to true; getErrors returns that operation Error instead of a completed collection. A stored QueryReflectionFailed encountered as graph data is still collected normally; the shared Error result shape is not a separate success/failure discriminator.

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
existing FatalError rejection            -> submit unchanged; propagate the execution's authoritative fatal Error
raw runtime-owned rejection                 -> fatal
~~~

The first existing boundary continuation performs the only asynchronous conversion. Later native Promise propagation keeps the exact Error. A direct host-result Promise remains within its recorded causal boundary through final import or validation. An unclassified raw rejection reaching a consumer or runtime-owned continuation is fatal.

Required publication and boundary processing finish before outcome exposure. A direct operation Promise keeps its operation lifetime and external phase active through that work. A nested result Promise is ordinary result data and extends neither.

One outer fatal envelope covers the synchronous operation transition; guarded continuations cover asynchronous transitions. In a live execution, a pending transition completes required shared settlement before checking whether only its local operation has closed. If the execution itself has failed, it returns before settlement because no later operation may observe that graph.

Add rejection handling without replacing the Promise or changing its semantic consumers when a kernel-owned Promise may reject before another owner attaches. The cases are:

- operation-result Promises retained internally for later Cascada use instead of exposed immediately;
- internal continuation, aggregate, gate, and cleanup Promises that can reject and are not returned immediately; and
- expression or native outward Promises that reject directly after required kernel work, or host Promises assimilating an already returned ready PoisonedValue.

Handling is not publication: the handler never publishes poison or satisfies a semantic consumer. Immediate real consumption handles its source Promise; apply the ownership rule to any derived Promise. Use one named `markPromiseHandled` helper only if at least two actual producer sites require this exact operation; otherwise keep the action at its sole ownership site. Do not recursively observe unused host input merely to suppress process warnings. Cascada's discarded-expression handling, including `observeDiscardedExpression`, remains a higher-runtime responsibility.

Rejection observation uses the same ordinary supported-thenable subscription protocol. A native `Promise.prototype.then` call cannot observe a custom receiver. An observer that completes synchronously creates no pending result to mark handled; apply ownership only to a returned pending chain that can reject, without creating a recursive chain of no-op observers. A fulfillment-only external-phase completion carries poison inside its non-thenable record and needs no rejection-only observer. Its derived reactions are separate owned results if they can reject.

Promise rejection ownership transfers at explicit boundaries:

- A host-supplied Promise remains host-owned until selected semantic work consumes it. The kernel then owns the reaction and every Promise that reaction derives; it never walks an otherwise unused input graph looking for Promises.
- A kernel producer owns its Promise until it returns it to an immediate semantic consumer, stores it for a known later consumer and marks it handled, or exposes it through the host-facing facade. Storing or ignoring a source Promise does not implicitly own the derived Promise returned by `.then`.
- `returnOperationResult` consumes the internal direct-result Promise, unregisters its fatal reject action on normal settlement, and transfers the returned wrapper Promise to the host caller. The kernel does not add a no-op handler merely because a caller may ignore a normal operation rejection.
- Cascada owns compiler-, loader-, iterator-, buffer-, and scheduler-created Promises. It also owns any kernel result it buffers, schedules, or discards rather than returning. `observeDiscardedExpression` handles that last case at the exact discard site without recursively inspecting the discarded value.

The implementation plan audits Promise producers, resolver paths, reactions, delayed consumers, and transfers whenever those paths change. Strict unhandled-rejection tests and focused route coverage verify ownership without adding a runtime Promise registry or pretending a syntactic inventory can prove the distinct publication, complete-collection, settlement-record, gate, and phase transitions.

## Fatal failure lifecycle

### Fatal sources and submission

A `FatalError` means language execution cannot safely continue. Causes include:

- internal invariant or bookkeeping failure;
- malformed trusted runtime facts;
- raw failure escaping a consumer or runtime-owned work;
- rejected internal readiness or aggregate work;
- unsafe host behavior that compromises runtime state, ownership, ordering, publication, or cleanup; and
- required cleanup or publication failure.

Fatal Errors are never admitted, returned as language data, combined with poison, found by Error queries, stored as repairable poison, or recontextualized.

~~~text
failExecution(operationContext, reason):
    candidate = existing FatalError
              or FatalError(operation source, exact reason)
    authoritative = operationContext.execution.fail(candidate)
    throw or reject with authoritative

runWithFatalGuard(operationContext, work):
    execute trusted work
    on any throw, including PoisonError:
        failExecution(operationContext, reason)
~~~

`failExecution` is the sole supported execution-failure entry. It preserves an existing fatal or constructs one with the supplied operation source, asks the execution to commit it, and throws the authoritative outcome. A detecting `runInternalStep` or continuation uses this path; a continuation observing an already failed execution simply returns. `runInternalStep` trusts its required operation context, checks the selected execution's current fatal state, and then uses `runWithFatalGuard`; it adds no malformed-context diagnostic path. A malformed root integration call therefore throws an ordinary programming error, while the same defect escaping an enclosing valid operation becomes fatal through that enclosing guard. Declaration/configuration validation stays outside execution: expected validation returns an ordinary native Error and unexpected implementation exceptions escape synchronously. Missing optional file/line information never makes a supported application failure fatal.

### Atomic execution fatal state

Each `Execution` directly owns these private fields and their transitions:

- one private nullable fatal Error slot exposed through a read-only `fatalError` class getter, which is both the closed/open fact and the authoritative first `FatalError`;
- one initially empty Set of rejection actions for operation results that are currently pending; and
- one reporter captured immutably when the execution is created.

There is no separate `hadFatalError` Boolean or latch. `fatalError === null` is the complete live-state test; storing the Error makes it non-null atomically and preserves the outcome needed by every observer. A normal class getter exposes the private field. Deliberate invocation of trusted execution methods, property redefinition, or prototype replacement is unsupported programming-API misuse and earns no second state-hiding mechanism.

The pending-result Set is not another live/failed fact: only `fatalError` answers that question. The trusted `registerFatalResultRejection` method adds one idempotent native-Promise reject action only after the facade has identified an actually pending direct result. Its matching outward-settlement transition deletes that exact action before exposing normal fulfillment or rejection. Settling the internal source only queues this transition; until it runs, the operation result is still pending and a synchronously committed fatal outcome wins. Once the transition removes the action and settles the outward wrapper, later fatality cannot change that result. After the core operation's effectful boundaries have propagated fatality, native wrapper construction and registration run without host hooks. Source-reaction attachment is a subscription boundary: it may deliver older queued callbacks and must propagate their fatal outcome. The native outward Promise executor owns any failure escaping bridge setup, so a wrapper rejected during subscription is still returned and no pending registration or derived rejection is lost. An execution with ready-only operation results therefore allocates no wrapper Promise and stores no rejection action.

This narrowly scoped Set is not a task, owner, resource, cleanup, cancellation, or arbitrary listener registry. Its entries represent only the externally observable results that the execution is currently obligated to fail promptly. A single permanently pending shared fatal Promise is smaller superficially, but every settled `Promise.race` leaves its losing reaction attached to that Promise and can retain historical result Promises and values for the execution's lifetime. Deleting each reject action on settlement keeps retention proportional to current pending operation results instead of all results ever issued. A root-only race would also avoid many reactions, but would leave another package-level public operation blocked behind a never-settling dependency after fatality.

The trusted `execution.fail(candidate)` method performs one synchronous transition for the first candidate:

1. Store the candidate in `fatalError`.
2. Reject every currently pending operation result with the stored Error and clear that Set.
3. Invoke this execution's captured reporter after fatal state is committed.
4. Return the stored Error.

No operation owner, gate, phase, internal Promise, resource, or task is registered with the execution for fatal delivery. Rejecting a native wrapper Promise schedules its reactions and invokes no external code synchronously. Later candidates return `fatalError` without replacing or reattributing it. Operation owners remain local lifetime mechanisms used only to stop sibling work after an operation reaches its own final outcome while the execution is still live; fatal shutdown neither closes nor consults them.

The `fatalError` first-write rule owns report idempotence. `Execution.fail` selects and reports one outcome for that execution; later submissions return the first outcome. It and the getter use the same private field, so the value is not duplicated. The method trusts package integration and performs no candidate revalidation; deliberate direct use is unsupported rather than prevented. If the same `FatalError` reaches another execution, that execution independently closes and reports it once through its own reporter. The Error carries no mutable reporting state. Cascada supplies its per-render `onError` when creating the execution; a mutable module-global reporter is not execution routing.

The reporter is a synchronous, best-effort notification, never a control-transfer mechanism. Capture it in a local and invoke it as an unbound function in a protective `try` after committing fatal state; never use the `Execution` as its receiver or argument. Ignore its return without inspecting thenability, and preserve the authoritative Error if it throws. A reporter that starts asynchronous work owns that work and its rejection handling. Reporter failure cannot replace the outcome, trigger a second report, or block the fatal transition. Reporter re-entry observes the non-null `fatalError`. A caller that supplied no reporter still receives fatality through its pending operation result or a later synchronous public-entry check and may query `execution.fatalError`; do not simulate delivery with an asynchronous global throw.

The captured reporter is also the sole proactive notification for a fatal discovered after every outward result has already settled. It does not reopen or contradict that result: the execution has failed, but JavaScript cannot retroactively change a returned ready value or settled Promise. Do not add a late-only listener registry or another per-operation callback path. Cascada installs its render-local `onError` as this reporter before starting the execution.

### Fatal checks and operation result completion

Check fatal state before:

- public operation work;
- common continuation settlement and operation work;
- processing the result of a supported external action;
- processing a supported subscription's return or invocation throw;
- and scheduler command dispatch.

These are centralized transition checkpoints, not polling requirements. Public entry, the common operation-continuation and subscription helpers, `runExternalBoundary`, and scheduler dispatch own them. The resumption check covers later work in that hook-free synchronous transition; adding another check immediately before an effect in the same transition would be redundant. Inner hook-free synchronous helpers and loops do not repeatedly check because fatal state cannot change concurrently there. No checkpoint interrupts synchronous JavaScript or an active host call. If nested work closes the same execution during a host call, that call may finish synchronously, but `runExternalBoundary` discards the returned value before contextualization, import, or publication and propagates the authoritative Error. Another execution remains independent unless its `FatalError` escapes into the current boundary; receiving it then closes the current execution under the ordinary submission rule.

The common asynchronous rule is deliberately small:

~~~text
if execution.fatalError is present:
    return
finish required shared settlement
if this operation's local owner is closed:
    return
continue operation-specific work
~~~

A subscription can deliver older queued callbacks whose detecting failures reject their own previously returned chains. The currently subscribing stack therefore checks its execution at subscription exit and propagates the authoritative fatal, even if its own callback merely skipped. This also covers no-op ownership subscriptions. Keep rejection ownership for a returned derived chain that can no longer be returned after that check; no-op handlers do no semantic work and need no recursive observer.

A closed execution starts no new operation, graph settlement, or host work. At public operation entry, throw the stored `FatalError` synchronously. At a common internal resumption, simply return without inspecting or publishing the settled value. A detached continuation does the same because `Execution.fail` has already stored and reported the Error. Fatal observation performs no owner closure, release walk, or other cleanup protocol: state belonging only to the failed execution has no later semantic consumer. Some bounded extra hook-free work after closure is acceptable when avoiding it would require checks below the centralized transition points; no later graph or host effect may ignore closure.

This check-and-return rule is the runtime's cancellation mechanism. “Cancellation,” “stop,” and “shutdown” do not name another abstraction or state: there is no task token, `cancelled` flag, abandonment object, callback broadcast, or cleanup walk behind them.

A missing required Promise mirror is a known runtime defect at publication. Use the existing required-mirror invariant and fail immediately; do not wait for that corrupt value to settle. Valid entry callback results and pending gated publication keep their independent lifetimes.

Fatal handling does not cancel, reject, or otherwise settle a source Promise, private gate, external phase, or internal aggregate merely to wake its waiters. If its existing blocker settles, its ordinary continuation reaches the common fatal check and stops. If it never settles, that internal work may remain pending indefinitely. A pending operation result is registered for independent fatal rejection, so the blocker cannot hang that API result. Already-observed native Promises remain handled.

This can retain some operation-only objects behind an externally retained, never-settling source Promise. The source reaction itself cannot be removed, and the execution is already unusable. Although that reaction can retain its operation context and therefore the execution, the execution's identity stores are `WeakMap`s and do not root their own keys; metadata remains reachable only for identities retained elsewhere, though one live identity's metadata may retain related graph identities. The stuck reaction's direct additional retention is therefore limited to its captured identities and operation resources. A global owner sweep would improve only partial memory release while adding task registration, fatal callbacks, and terminal gate/phase states. A resumed reaction returns and releases whatever only that reaction retained through ordinary garbage collection. This is distinct from operation-result registration, whose action is deleted on ordinary result settlement and whose sole purpose is required fatal delivery.

Do not register internal waits, gates, phases, aggregates, or detached work for fatal rejection. Every execution-bound operation uses this two-boundary pattern:

1. Its existing public-entry check fails immediately if `fatalError` is already present.
2. It performs its own required processing synchronously as far as possible.
3. It passes the operation context and already classified direct result to one `returnOperationResult(operationContext, result)` helper.

The helper receives a ready semantic result or a direct result whose required core transitions are still pending. Those core transitions have already consumed any synchronously delivered custom thenable. The helper preserves Error, Function, and fixed admitted-category precedence, then uses the runtime's ordinary hook-minimal pending recognition; there is no producer record, native-brand probe, preliminary subscription, or second result-classification path. If the result is ready, it returns it directly. Any supported thenable that remains at this point is pending by the upstream invariant. Only then does the helper construct one native outward wrapper, register its idempotent fatal reject action, and subscribe once to that pending result through the common guarded path. The helper relies on the core operation's common host and subscription exits to propagate synchronous fatality. JavaScript run-to-completion protects only the hook-free work between these boundaries. The outward bridge uses the same subscription-exit check; its native Promise executor delivers an escaping fatal through the outward result after the execution has committed it. No duplicate facade-wide final check is needed. The outward-settlement transition first unregisters the action, then settles the wrapper with the already classified outcome. Source settlement before that transition runs is not operation completion; a fatal commit during that interval rejects the still-pending wrapper. The derived continuation is immediately marked handled when ownership requires it. The helper accepts no owner, cleanup policy, result mode, or boundary-specific option. Public operations retain their own semantic processing; the helper only preserves synchronous return and adds prompt fatal delivery to an actually pending direct result.

This guarantee depends on a semantic invariant upstream of the helper: the direct result remains pending for every unfinished transition that can still change the operation's specified result or an effect promised complete with it. Boundary admission, validation, copying, Error collection, and required publication therefore feed that direct result. Fire-and-register mutation returns are issuance outcomes instead; their gates make later dependent reads or exports wait. Nested result Promises and branches abandoned after a short-circuit proof are likewise independent when they can no longer change the operation's result. A late fatal from such work closes and reports the execution but cannot revise a completed result. Misclassifying required work as independent is an operation implementation bug that no fatal-result wrapper can repair.

Put this helper in the package facade and use it once for each public normalized graph operation result. Unwrapped core functions remain private and do not register intermediate work. Cascada calls public graph operations and uses the public guarded composition and Error factories for work it owns. A separate higher-runtime operation with additional required work owns its final result; aliases delegate an existing result unchanged. Primitive extraction performs its terminal validation and expression conversion before final outward settlement while preserving synchronous ready failure and exactly one pending fatal obligation. No public/internal flag or alternate graph API is needed.

Script completion first uses common export and then applies this helper exactly once. A raw managed lookup can contain an independent nested Promise, and a fire-and-register return can precede its gated publication; neither is a host-ready script result or proof of work that the script intends to await. The higher runtime may return without unrelated work, but it must keep every intended script-result dependency in the exported result's frontier.

## Minimal mechanism map

| Requirement | Minimal mechanism | Why it remains |
| --- | --- | --- |
| Stop failed execution work | `if (execution.fatalError !== null) return` at centralized resumptions | A second cancellation state, listener, owner sweep, or fatal cleanup path adds no semantic guarantee. |
| Fail a waiting operation promptly | One `returnOperationResult` wrapper and one Set entry per currently pending operation result | A field check cannot wake a result whose ordinary dependency never settles; settlement removes the entry so the execution retains no result history, while ready results need neither wrapper nor registration. |
| Stop siblings after a live operation finishes early | One local `open` fact and one lifecycle-owned idempotent close transition | This is independent of fatality and is needed by operations such as early `hasError`; ready work creates no release registry. |
| Convert supported host failure | One exact-action marker producer and fixed causal consumer; `runExternalBoundary` composes them for direct language-result calls | Shared helpers retain ordinary returns, internal defects stay fatal, and complete boundaries also contextualize returned Errors. |
| Handle an explicitly conservative host probe | One exact local catch returning that probe's prescribed fallback or validation outcome | The failure is not a language outcome; routing it through `runExternalBoundary` would allocate discarded poison, while a generic probe-result algebra would add machinery without unifying semantics. |
| Attribute and deduplicate raw failures | Immutable boundary wrappers plus collection-local cause/context/kind equivalence | Existing Errors propagate by reference; equivalent new wrappers need no interning or execution-wide cache. |
| Preserve imported host storage | Existing placement overlays | Mutating the host Error or Promise would violate imported-data protection. |
| Support native Promises and ordered sync-first thenables | One ordinary `.then` subscription per required continuation through the common helper | A cache, canonical settlement Promise, or second subscriber queue duplicates behavior the supported thenable already owns and can add an unwanted microtask. |
| Distinguish ready from pending after that subscription | Inspect the normalized transition result after Error, Function, and fixed admitted-category precedence | A callback-ran flag or backwrite test duplicates information already carried by the sync-first return contract and confuses semantic state with readiness. |
| Expose failure to primitive expression code | One separate PoisonedValue containing an ordinary Error, created at the expression boundary | Native rejection skips expression success work without changing graph Error transport. |
| Collect several independent Errors | Complete collection with local semantic deduplication and a frozen result array | Unspecified Error order removes ordered branch summaries; successful value positions and effects remain ordered. |

Everything else stays in the semantic operation that needs it. In particular, execution fatality does not own resource cleanup, graph publication, gate or phase settlement, or local operation closure.

## Component responsibilities

The documented [public integration surface](integration.md) reuses these implementations, including causal method-result import. [Integration tests](../test/causal-failures.test.js) cover standalone calls and iterator advancement with each public operation and higher-runtime completion owning its actual result boundary.

- `execution.js` owns the private nullable fatal slot, its public read-only `fatalError` getter, the currently pending operation-result rejection Set, the captured reporter, the one internal active-external-action Boolean, and the trusted `fail` and `registerFatalResultRejection` transitions on `Execution`. The Error and facade layers use that state directly; no runtime-wide counter, state map, or free-standing adapter mirrors execution ownership outside the class.
- `error.js` owns trusted Error construction, `ERROR_KIND`, precise Error predicates, the single external-action producer/consumer behind the three-argument `runExternalBoundary`, hook-free contextualization, compound construction, and fatal submission.
- `language-values.js` owns causal initial value consumption, ready admission, Error-before-Promise precedence, and the ordinary-subscription path for native Promises and supported custom thenables. Each causal boundary supplies its own operation context in its continuation closure.
- `thenable-subscription.js` owns the shared subscription-exit fatal check and rejection ownership, including exceptional exits. Its scheduling scope does not mark an external action active during supplied callbacks.
- Admission classification owns its conservative external fallback and brackets its own execution-bound reflection with that execution's active-action Boolean. Declaration code owns its direct contextless thenability recognition and touches no execution. Neither is a poison boundary or a mode of `runExternalBoundary`.
- Causal boundaries contextualize ready failures and raw rejection in their first existing import, mirror, validation, or publication continuation.
- `internal-step.js` owns immediate operation-work entry, continuation after one result, initial value consumption, and complete step-input collection. `collectInputs` keeps poison outside readiness Promises; `prepareInputs` uses that same collector to combine all required input failures before invoking a success continuation. Structural payload joins retain individual Error values; there is no failure-policy flag or second subscription mechanism.
- `operation-lifecycle.js` owns only the local open fact, idempotent close, and lazily allocated local release set. It is not a continuation, Promise-combinator, or Error-policy layer. Graph publication remains an explicit semantic body at its owning boundary.
- The public package facade owns normalized operation return and expression extraction. Core modules register no intermediate results. Public Error factories and guarded composition facilities reuse the same implementations; they do not expose an alternate unwrapped graph API or accept a public/internal mode.
- Import, assignment, lookup, invocation, conversion, export, and external-operation modules define narrow causal boundaries and kinds without alternate propagation paths.
- Error queries and aggregators preserve existing Errors. Supported query reflection failure is poison; internal traversal or bookkeeping failure is fatal.
- The higher scheduler observes the execution fatal outcome and owns no duplicate state.
- The diagnostic layer formats opaque source context, exact causes, and bounded compound views without changing kernel Errors.

## Intentional differences from Cascada

The graph kernel keeps Cascada's useful semantics, not its current interfaces. Cascada should adapt during integration; the kernel adds no compatibility path.

### Cascada strengths retained

- Preserve synchronous progress and direct ready results; asynchronous availability alone never forces all operations through a Promise path.
- Preserve one fatal outcome and reporter per render, but put that authority on the render's `Execution` so graph work and public operations observe the same state. Retain only rejection actions for operation results that are currently pending.
- Preserve inexpensive boundary checks, exact producer-side rejection handling, complete poison collection where semantics require it, and rejecting expression-value behavior.
- Preserve compact source tables, diagnostic routes, cause stacks, and bounded formatting above the graph kernel.

The deviations remove machinery rather than semantics: one Error replaces poison wrappers and `RuntimePromise`; one `returnOperationResult` helper generalizes Cascada's root-only return while deleting settled registrations; one nullable Error replaces duplicate fatal facts; and direct check-and-return replaces fatal broadcast, iterator abort, and bulk internal-result rejection.

### Required Cascada changes

- Move fatal authority from `RenderState` to `Execution`. Capture the render's reporter on that execution; the render and command-buffer scheduler observe its outcome. Do not replace per-render reporting with mutable module-global routing.
- Do not copy `RenderState.raceRootResult` wholesale. It is root-only, owns an independent `.then` policy, converts an already-failed ready call into a Promise rejection, and classifies rejection again at return. The host-facing facade instead receives a classified ready value or direct supported asynchronous result, recognizes Error first, uses the common thenable contract, returns ready values directly, and registers only the actually pending case for fatal rejection.
- Remove `RenderState`'s eager fatal Promise and no-op rejection observer. A pending outward result gets one removable rejection action; executions whose outward results are ready allocate none, and completed results leave no reaction attached to a permanently pending shared signal.
- Keep fatal authority out of diagnostic context. Coordination uses `operationContext.execution`; compact diagnostic representation remains behind opaque `errorContext`.
- Replace the generated error-context-only flow with one render-local table of immutable operation contexts. Pair each prepared static source handle with that render's execution once, pass the selected operation context to every emitted kernel call and command, and reuse it whenever the exact source handle repeats. Distinct or dynamically derived source handles remain distinct. Do not recover execution from the diagnostic handle or allocate a two-field carrier on every loop iteration.
- Commit fatal state before invoking `onError` or another reporter. A detecting transition submits and propagates the authoritative Error; a later transition that observes closed state returns. Neither path performs fatal-specific local-owner cleanup.
- Preserve Cascada's separation between ordinary Errors and an expression PoisonedValue. Keep graph Errors non-thenable; use the public expression extraction and expression factory at expression boundaries. Remove duplicate Cascada wrapper/grouping and RuntimePromise implementations after adopting those APIs and causal continuations.
- Convert raw failure at its causal boundary through the kernel's external-escape protocol. Direct language-result calls use `runExternalBoundary` to preserve or contextualize thrown and returned Errors; shared kernel reflection uses the same exact-action producer with its fixed causal consumer. Apply the graph effect outside recovery and classify raw rejection in the existing boundary continuation. Cascada does not keep a separate marker or catcher implementation.
- Treat every direct Error result as boundary failure. A mutating boundary applies the same failure effect whether the Error is returned, fulfilled, thrown, or rejected.
- Retain Cascada's useful sync-first thenable behavior: native Promises and supported ordered custom thenables use ordinary `.then` subscriptions through the common continuation helper, and already-ready custom values may resume synchronously. Require custom thenables to own FIFO delivery, chaining, and nested assimilation. Do not port a kernel cache, canonical settlement Promise, subscriber queue, or `Symbol.species` defense. Keep Cascada's single-consumer `IteratorWaitToken` internal rather than passing it through the kernel boundary.
- Replace transport-specific `...Error` and `...Rejected` kinds with one `...Failed` kind per cause. Keep `Multiple` as a meta-kind. Use one `ExternalPropertyReadFailed` kind for the complete direct property-observation boundary rather than adding an `ExternalPropertyValueFailed` split.
- Replace Cascada's `RuntimeError`, shared `CascadaError` / `RuntimeContextError` ancestry, and mixed construction/reporting methods with direct native-Error branches: `PoisonError` and the kernel's `FatalError` directly extend `Error`, while `CompoundPoisonError` extends `PoisonError`. `FatalError` deliberately names the execution-ending effect rather than the broad implementation domain implied by Cascada's `RuntimeError`. Share construction utilities rather than an inheritance base.
- Normalize every execution-bound fatal occurrence to `FatalError`; keep the raw value as exact cause. Contextless configuration and malformed root integration calls construct no fatal outcome. Submit an existing `FatalError` unchanged to each receiving execution so its first fatal remains authoritative.
- Replace Cascada's cause-only deduplication with cause/context/kind equivalence shared by queries and compounds. Remove mandatory source sorting and logical Error-order guarantees. A retained leaf supplies representative context; existing poison propagates unchanged, while equivalent new wrappers require no persistent cache. Presentation may sort a separate view.
- Keep report idempotence on each execution's first write to `fatalError`, not on `FatalError`; the same occurrence may close and be reported by another execution.
- Ignore legacy attribution properties such as `_errorContext`; the accepting operation supplies causal source.

### Recommended Cascada changes

- Keep compact context tables, diagnostic routes, and stacks behind opaque source context.
- Format sources and causes in the diagnostic layer; keep eager formatting, arbitrary cause inspection, source sorting, and display truncation out of the kernel.
- Keep load-failure policy above the kernel rather than adding a generic policy hook.
- Keep compiler-created and discarded-value Promise handling above the kernel. Cascada owns every Promise it creates and every kernel result it schedules, buffers, or discards instead of returning; `returnOperationResult` transfers the returned Promise to the host caller.
- Route every pending public-operation fatal failure through the execution outcome, preserve sync-first result completion, unregister normally settled results, and let buffers stop at their existing dispatch/resumption checks. Then remove duplicate fatal queries and adapters.
- Cascada uses only the documented root API: public Chain operations, shared Error/expression factories, guarded higher-runtime composition, and fatal/result completion. Unwrapped graph functions stay private. Each public kernel call owns its pending result; a render with additional work owns a distinct completion, and aliases delegate an existing public result unchanged.
- Remove Cascada's fatal broadcast flag, active-iterator abort sweep, and bulk rejection of pending command results. Replace its fatal-only abort/abandon helpers with the same execution check used at ordinary dispatch and resumption boundaries.
- Preserve compact source tables and bounded diagnostics through one explicit formatter adapter returning a separate diagnostic view. Kernel Errors expose only their immutable structured facts and do not retain Cascada's legacy presentation fields; formatting failure is isolated and cannot change them.
- Raise Cascada's Node floor to `>=24`, matching the kernel, and require supported browsers to provide native `Error.isError`. Use that predicate directly; do not add an approximate portable fallback.
- Remove render/fatal authority from compact source tuples. Preserve their compact source facts as an immutable opaque handle, but route fatal state only through `operationContext.execution`.
- Replace Cascada's broad recursive Promise-marking safety net with ownership at the exact Promise producer and transfer boundary. Do not inspect or attach handlers to unused host-input graphs merely to suppress warnings. Audit affected Promise producers and transfers when they change, run with strict unhandled-rejection behavior, and cover their semantic routes with focused tests. Keep the small actual-export classifier, but add no custom source analyzer or manifest of semantic claims that syntax cannot prove.

## Renamed, split, and removed terms

### Renamed and removed

| Previous term | Current term | Reason |
| --- | --- | --- |
| Cascada `RuntimeError` | `FatalError` | Names the execution-ending semantics; "runtime" also describes recoverable execution, ownership, and integration. |
| Source boundary | **Causal boundary** | The exact cause, not transport, owns classification. |
| Structural owner | **Runtime-owned work** | Avoids confusion with graph ownership. |
| `PoisonErrorGroup` | `CompoundPoisonError` | Matches compound Error semantics. |
| `ChainValueError` / `ChainValueRejected` | `ChainValueFailed` | One kind for ready and asynchronous transport. |
| `ContextValueError` / `ContextValueRejected` | `ContextValueFailed` | One kind for ready and asynchronous transport. |
| `AssignmentValueError` / `AssignmentValueRejected` | `AssignmentValueFailed` | One kind for ready and asynchronous transport. |
| `OperationInputError` / `OperationInputRejected` | `OperationInputFailed` | One kind for ready and asynchronous transport. |
| `AsyncCallback` | `InvalidCallbackResult` | One kind for every unsupported callback result. |
| `LookupThrew` | `LookupReflectionFailed` | Name the reflection boundary, not throw transport. |
| Other `...Threw` kinds | Corresponding `...Failed` kind | Ready, returned, fulfilled, thrown, and rejected forms share one contract-based name. |
| Cascada expression failure and Promise attribution | Public PoisonedValue container plus causal boundary continuations | Expression propagation is separate from ordinary graph Error data; source attribution stays on the Error. |
| Cascada `RuntimeContextError` / runtime `CascadaError` bases | Removed | Recoverable and fatal Errors are distinct direct branches. |
| `RenderState` as fatal authority | Execution-owned fatal state | Coordination belongs to the execution, not diagnostics. |

### Semantic splits

`UserCallThrew` is not renamed mechanically. Audit each former call site by the action whose failure it represents:

| Former use | Current kind |
| --- | --- |
| External Function or method invocation, including its direct result boundary | `InvocationFailed` |
| Runtime-controlled callback or comparator invocation | `ControlledCallbackFailed` |

No compatibility alias remains. A transport-independent name does not erase the causal distinction between invoking the selected host operation and invoking a callback owned by a controlled operation.

## Deliberate exclusions

The architecture adds no:

- separate synchronous poison wrapper;
- common kernel Error base;
- `RuntimePromise` or Promise subclass;
- per-consumer Error proxy;
- parallel continuation mechanism;
- Promise allocated only for attribution;
- broad catch that converts adjacent runtime work into poison;
- a second host-failure carrier or public escape marker;
- generic host-probe completion algebra or configurable fallback mode on `runExternalBoundary`;
- contextualization that invokes external code or copies arbitrary cause properties;
- registered formatter or generic fatal-versus-recoverable policy hook;
- general internal result algebra shared by semantically different transition records;
- execution-wide operation-owner registration or fatal-reject actions for internal work;
- permanently retained fatal-Promise reactions for already-settled operation results;
- a separate `hadFatalError` Boolean or fatal latch alongside `fatalError`;
- fatal-only gate, phase, or aggregate terminal states;
- registration of internal operation Promises for fatal delivery;
- competing fatal reporter, state, or scheduler;
- an executionless reporting path;
- context inference from a later consumer;
- recovery of a fatally closed execution; or
- assumption that native work can be cancelled or rolled back.

## Verification

### Representation, kinds, and attribution

- Both concrete Error branches directly extend native `Error`; no shared runtime base or legacy wrapper remains.
- PoisonError and CompoundPoisonError are immutable non-thenable Errors. PoisonedValue is a separate immutable non-Error container; ready and pending expression failures reject with its exact contained Error. Native inspection can successfully return that ordinary Error. FatalError remains non-thenable and never enters graph data.
- Every Error precedes thenability inspection, including a hostile Error with throwing `then`.
- A `FatalError` encountered as a ready return, Promise fulfillment or rejection, synchronous throw, or nested imported value is submitted to the current execution and never admitted as language data.
- Poison kind and source and fatal source are mandatory and stable. Ready and asynchronous failures at one boundary share a kind; `Multiple` is only a meta-kind.
- Ready return, explicit Error, synchronous throw, Error fulfillment, and direct rejection follow the same causal and graph-effect rules at every supported boundary. A direct mutation Error always follows mutation-failure behavior.
- Existing poison preserves identity and attribution. An existing `FatalError` is submitted unchanged to the receiving execution, which propagates it unless an earlier fatal Error is already authoritative. Equivalent separately constructed wrappers deduplicate by cause/context/kind; different contexts or kinds remain distinct.
- Delayed settlement, copying, and repeated consumption preserve source and kind. A later failure uses its own causing operation.
- Then access and invocation failures use the exact subscribing operation. Native Promises and supported custom thenables deliver through ordinary subscriptions; synchronous delivery remains synchronous, and the thenable owns one-outcome settlement, FIFO notification, chaining, and nested assimilation. Two causal boundaries consuming one raw rejected Error create separate occurrences, while later consumers of either occurrence preserve it. Dynamic `then`, repeated or inconsistent settlement, non-FIFO notification, insufficient subscriber support, and custom fulfillment with another thenable are outside the supported-data contract rather than repaired by kernel state.
- Imported occurrences commit atomically, and copied or derived mirrors preserve origin.
- Contextualization of hostile failures invokes no host hook.

### Collection, graph, and Promise behavior

- Combining zero inputs is fatal. Nonempty combination expands direct compounds by one level, deduplicates by cause/context/kind, exposes leaf-only immutable `.errors` with unspecified order, and selects `.kind` correctly without storing a redundant `.kinds` projection.
- `getErrors` and combination use identical equivalence. They merge the same cause/context/kind and preserve distinct contexts or kinds. Tests compare semantic membership rather than order or canonical representative identity.
- Required argument and export Error collection finishes without host invocation and uses only non-thenable internal readiness.
- hasError exits early and otherwise returns Boolean; getErrors completes its captured traversal and returns null or the combined ordinary Error. Supported query reflection failure returns or fulfills with the ordinary QueryReflectionFailed Error, separately from found data. Trusted traversal or bookkeeping failure is fatal.
- A graph Error is published before its operation Promise rejects with it.
- Root and nested imported native Errors receive atomic occurrence wrappers without modifying host storage. Ready and deferred raw-Error introductions preserve attribution and deduplicate equivalently during collection without cross-segment interning; failed import commits nothing.
- Direct host-result rejection is converted once in its existing boundary continuation. No attribution-only Promise or parallel continuation remains.
- Every kernel-owned Promise category is handled without recursively observing unused host input.
- Stored poison can be replaced; repairable external poison can be repaired without replacing its capability.

### Classification boundaries

- Only the exact synchronous external-action envelope catches an observable nonfatal throw for boundary handling. It preserves thrown poison or converts an expected raw failure; its causal caller applies the graph effect outside the catch. Adjacent preparation, publication, cleanup, and trusted-callback failure remain fatal.
- Conservative classification and declaration probes keep only their exact local catches and prescribed opaque or validation outcomes. They create no discarded poison or generic probe framework and cannot hide execution fatality.
- Safely rejectable host output validation produces poison; unsafe host behavior that compromises runtime invariants is fatal.
- Complete independent-input collection finds every required poison before host work; unclassified or fatal rejection closes the operation.
- A language-outcome transition preserves an expected poison return or rejection. A fatal-on-escape transition treats every escape, including poison, as fatal. Raw consumer failures remain fatal unless an exact causal boundary classifies them.
- Supported external actions and callbacks do not synchronously re-enter their execution. Attempted same-execution re-entry is fatal; a separate execution remains independent, and compiler-controlled recursion is not an external action.
- Contextless declaration and host-configuration behavior follows its explicit rules and never fabricates an operation context.

### Fatal behavior

- Expected poison is consumed before fatal submission; poison escaping a fatal-on-escape transition is the cause of a new `FatalError`. Fatal submission preserves an existing `FatalError`, contextualizes any other cause at the causing operation, and propagates the execution's authoritative first Error.
- The first fatal stores the authoritative Error, rejects and clears exactly the operation results then pending, and commits before reporting. It walks no operation owners or internal waits; later candidates do not replace it.
- The same occurrence reports once within each execution it closes through that execution's captured reporter; another receiving execution closes and reports independently through its own reporter.
- Every execution failure originates through `failExecution` with an execution and operation source. A malformed root integration call produces an ordinary JavaScript programming error and constructs no contextless fatal diagnostic; a defect escaping work under a valid operation context enters that execution's fatal guard normally. Contextless configuration constructs no fatal outcome; expected declaration failures are ordinary host API Errors, unexpected implementation exceptions escape synchronously, and an existing `FatalError` is thrown unchanged.
- Centralized fatal checkpoints prevent new operation work and effects after resumption without polling inner synchronous helpers or interrupting active JavaScript. A external action that returns after nested work closed its execution cannot have its result imported or published.
- A fatal from unrelated work fails each public operation while its outward result is pending, including after internal source settlement but before the outward-settlement reaction runs. If outward settlement completes first, unrelated and never-settling work does not delay it; completed output remains stable, while a later fatal is recorded and reported as a defect that may make the result's trustworthiness unknown.
- `execution.fatalError` exposes the authoritative first fatal. It remains `null` before one occurs and makes no claim that unfinished work will succeed.
- Every pending execution-bound operation result rejects promptly even when its normal input never settles. Internal waits are not registered; they stop at their next centralized check and may remain pending forever when their blocker never settles.
- Ready operation results remain synchronous: they allocate no result Promise or registration and incur no microtask merely to observe fatal state. Error, Function, and fixed admitted-category precedence applies before thenability when deciding whether a wrapper is needed.
- Operation owners remain local and are never registered with or closed by fatal handling. They close only for their own live-execution operation outcomes.
- Every live-execution terminal route closes its local owner and balances registered releases and leases. Route tests assert those facts for success, language Error, supported boundary failure, and early sibling completion; there is no global quiescence oracle or test-wide owner registry because legitimate pending work and fatal execution have different cleanup semantics.
- The scheduler checks the same `fatalError` field before dispatch, and the execution retains only current pending operation-result reject actions; normal settlement removes each action, so no historical result graph remains rooted. No competing fatal or cancellation state exists.
- Reporter or formatter failure cannot replace the committed outcome.
- Late native settlement remains handled and performs no graph or operation work after its execution-fatal check.
- Completed Error instances and compound arrays remain frozen. Shared prototypes remain ordinary under the supported programming-interface contract; deliberate prototype mutation is unsupported. Expression containers are immutable and never change the contained Error or its attribution.
- Fatal handling neither settles gates and phases nor publishes fatal graph data. If their ordinary blockers resume, they reach the common fatal check and perform no host effect or publication.
