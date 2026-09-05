# Error Handling Architecture

## Purpose

This document defines how Cascada classifies, represents, attributes, propagates, combines, and reports failures. It also defines how a fatal failure closes an execution.

## Terms

- A **raw failure** is a native JavaScript `Error`, thrown value, or rejection reason not yet classified by Cascada.
- A **causal boundary** (formerly **source boundary**) is the exact language or host action allowed to convert an expected raw failure into recoverable Error data.
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

The exported Chain constructors, operation contexts, and graph operations form the trusted kernel integration protocol used by Cascada; “operation result boundary” does not make their control facts application language data. Trust avoids defensive validation of arbitrary context shape and source payload, but the kernel still checks the minimal routing invariants required to select one execution safely. A missing operation context, a Chain/context execution mismatch, or new issuance through a closed entered Chain is therefore a fatal integration violation checked before graph access. An incidental property-access `TypeError` is not an adequate substitute because it loses deliberate attribution and may occur after state selection has begun. Cascada supplies these facts and validates its actual application inputs separately. A future general host-facing wrapper may reject its own malformed invocation before calling the kernel, but the kernel retains one execution-selection and fatal-classification path.

## Failure model

### Error hierarchy

~~~text
Error
|- PoisonError
|  `- CompoundPoisonError
`- FatalError
~~~

- `PoisonError` directly extends native `Error`. It records a nonempty stable `kind`, originating `errorContext`, and optional exact `cause`.
- `CompoundPoisonError` extends `PoisonError`. Its `.errors` contains flattened poison leaves.
- `FatalError` directly extends native `Error`. It records its originating `errorContext` and exact cause. Its prototype defines an own non-callable `then` before freezing, so it remains non-thenable even if host code later adds `then` to `Error.prototype`. This is a narrow representation invariant, not a general promise to tolerate modified primordials: unlike Array or String behavior, the presence of this one property would let native Promise assimilation change Cascada's own fatal-versus-language-Error protocol. The one-time own property prevents that category collapse without hardening the wider native surface.

The kernel creates these Errors through factories in the Error module. `createPoisonError(reason, operationContext, kind)` submits an existing `FatalError`, preserves existing poison, and otherwise creates one causal poison occurrence; `combineErrors` creates the compound form from semantically distinct leaves with unspecified order. Their exported classes require a module-private construction token and semantic recognition uses a module-private brand rather than forgeable prototype shape alone. Public code may use the classes for recognition, but direct construction, subclass construction, or prototype forgery cannot create a valid kernel-attributed instance or choose an arbitrary kind or source. The token check is the host API validation; internal factories trust their compiler/runtime-supplied kind and source rather than repeating defensive shape or membership checks. Each factory installs every subclass field before a private finalizer freezes the complete wrapper; a compound first copies and freezes its `.errors` array. Freeze each concrete kernel Error prototype once after installing its final methods, so host code cannot change `then` or other behavior of already-created Errors through the shared prototype. This one-time protection replaces per-instance method copies and repeated integrity checks. Distinct compound kinds are derived from those leaves only when diagnostics need them; they are not duplicated in semantic Error state. The opaque `errorContext` is itself an immutable handle or value. The exact cause remains a diagnostic identity outside the language graph; later host mutation of that external object cannot replace the wrapper's cause reference or change its stored message, classification, or source. Do not copy arbitrary enumerable properties from the cause or read its stack while constructing the kernel wrapper; guarded diagnostic formatting may inspect the exact cause later without changing semantic Error data.

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
- The common post-boundary ready-admission choke point accepts only branded poison among Error values. It submits `FatalError` and treats any remaining raw native Error as a fatal missed-boundary defect. An inbound boundary may inspect a raw Error only while creating its occurrence wrapper before that admission.

### Failure kinds

One frozen public `ERROR_KIND` object owns the complete vocabulary below. Every runtime call site supplies one specific PascalCase constant whose key equals its string value; there is no empty, arbitrary, or generic fallback. Trusted factories use this table directly instead of paying for repeated runtime membership validation. Focused construction and route tests verify the resulting kinds. Messages remain presentation and do not substitute for kind or source.

| Area | Kinds |
| --- | --- |
| Availability and paths | `ChainValueFailed`, `ContextValueFailed`, `AssignmentValueFailed`, `OperationInputFailed`, `PathSegmentFailed`, `InvalidPathSegment`, `ThenAccessFailed`, `ThenInvocationFailed` |
| Import and lookup | `ImportReflectionFailed`, `InvalidImportValue`, `NullLookup`, `ScalarLookup`, `LookupReflectionFailed`, `QueryReflectionFailed` |
| Invocation and conversion | `MissingFunction`, `NotAFunction`, `HostCallFailed`, `ControlledCallbackFailed`, `InvalidCallbackResult`, `ScalarConversionFailed`, `UnsupportedMutation` |
| Export and mutation | `InvalidExportValue`, `ExportReflectionFailed`, `PropertyMutationFailed`, `PropertyValidation`, `InvalidManagedReceiver`, `InvalidArrayLength`, `InvalidArrayOperation` |
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

The opaque source identifies the exact occurrence; it does not replace the stable machine-readable kind. Split kinds only when the violated contract, graph/result effect, recovery meaning, or materially useful diagnosis differs. An external property observation therefore uses `ExternalPropertyReadFailed` whether its getter or Proxy trap throws, its direct value is an Error, or its direct Promise rejects. Likewise `HostCallFailed` covers the selected invocation and its direct result boundary. Import, lookup, query, and export reflection retain distinct kinds because failure has distinct operation outcomes; collapsing them merely to `ReflectionFailed` would erase that contract difference. Splitting one boundary by transport or ready-result inspection would instead add policy without changing recovery, graph effect, or diagnosis materially.

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
- a direct Promise returned by supported host code;
- supported import, lookup, conversion, and export reflection;
- documented external-operation failures; and
- any other language operation explicitly defined as producing poison.

A synchronous throw, explicitly returned native Error, and direct-Promise rejection use the same kind when they represent failure of the same action. A direct Error result always means that boundary failed; returning an Error as successful payload is unsupported. Ready and asynchronous delivery therefore have the same graph effect. An explicitly returned native Error is contextualized once, while an existing poison is preserved.

### Supported synchronous host code

One private `runHostBoundary` owns exactly one supported synchronous host-controlled action and that action's ready Error result:

~~~text
runHostBoundary(operationContext, kind, action):
    try result = action()
    on throw reason:
        if operationContext.execution.fatalError is present -> throw it
        return createPoisonError(reason, operationContext, kind)
    if operationContext.execution.fatalError is present -> throw it
    if result is Error -> return createPoisonError(result, operationContext, kind)
    return result
~~~

`createPoisonError` submits an existing `FatalError` and throws the execution's authoritative fatal outcome, returns existing poison unchanged, and otherwise returns one new poison occurrence with the exact reason as cause. The direct field check after either exit from `action` is the one post-host checkpoint. It runs before interpreting a throw or return, so synchronous re-entry that already killed this execution wins without allocating poison or processing the host result. The caller therefore sees only success or language poison and applies that boundary's required graph or result effect outside the `try` that contains `action`; if contextualization or failure application itself throws, the surrounding fatal-on-escape transition treats that as fatal. The factory neither performs preparation nor accepts a callback or policy flag. A low-level reflection primitive does not catch; its causal caller wraps only that primitive invocation. This removes the private marker, paired wrap/catch path, and separate post-host helper without broadening recovery.

Keep receiver preparation, argument export, result import, publication, bookkeeping, and cleanup outside the host envelope. Any unmarked failure from that work is fatal. Supported host code must not synchronously re-enter Cascada. An outer transition has not yet published an ordering point, so a nested mutation could otherwise overtake it and then be overwritten. Installing a Promise gate before every ready host mutation would add an asynchronous publication path to the common synchronous case. Reject re-entry as a fatal host-contract violation instead; higher-runtime nested script dispatch occurs outside an active host boundary. The post-host fatal check remains necessary when host code catches that violation or a reporter re-enters after fatal commit.

A direct host Promise settles after the synchronous envelope. Its first existing boundary continuation captures the source and kind when the Promise is accepted and classifies a raw rejection when it runs. The operation's existing returned Promise carries that outcome. Do not recreate the envelope, persist attribution on the source Promise or its metadata, or allocate an attribution-only Promise.

Application callbacks and effectful reflection are supported host code. A captured built-in is runtime-owned only when its inputs are runtime-owned and hook-free; applying it to a Proxy or host object that may invoke traps is supported host code. “Native code” alone is not a recoverable category.

### Conservative probes

`runHostBoundary` applies only when failure of the supported host action is itself the operation's language outcome. A probe whose documented result includes “cannot determine” owns that result locally instead of manufacturing poison that its caller would discard:

- Admission classification performs only its exact reflection probe. If ordinary host reflection cannot establish a supported structure, the result is the existing conservative external-category fact. Because admission is execution-bound, the probe checks `execution.fatalError` after either return or throw, and an existing `FatalError` is submitted normally; neither may be hidden by the fallback.
- A declaration is contextless host configuration. It preserves native Errors and performs ordinary supported-thenable recognition as it reaches each identity. A callable `then` is invalid declaration input; inability to inspect an unsupported identity produces an ordinary declaration-validation Error because the declaration cannot establish that the identity is safe to declare. Re-entrant declaration use throws an ordinary host error before registry mutation; if it escapes the user code, the surrounding operation contextualizes it as poison. Unexpected implementation exceptions escape synchronously, and an existing `FatalError` is thrown unchanged; declarations construct no fatal outcome. The probe creates no poison, kind, execution state, Promise, thenability cache, or synthetic thenable.

These are explicit probe semantics, not another host-failure policy. Keep their exact `try`/`catch` at the probe that owns the fallback. Do not add a generic completion record, callback, policy mode, or second host-boundary framework merely to share their different result shapes. Other effectful reflection whose failure is observable still uses `runHostBoundary`.

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

1. `runHostBoundary` catches only the exact synchronous host action, performs the one post-host fatal check, and then preserves or contextualizes its reason; its causal caller applies the boundary's graph effect outside that catch.
2. A language-outcome continuation body recognizes an existing poison before the fatal-on-escape lane and performs its exact publication, collection, or result transition.
3. A fatal-on-escape envelope submits an existing `FatalError` unchanged or contextualizes every other escaping failure, including poison, and propagates the execution's authoritative first fatal Error.
4. The reporter catch preserves the committed fatal outcome. Local cleanup uses ordinary `try`/`finally` only to clear its own live-operation state; a cleanup failure is not reclassified or swallowed and becomes fatal through the surrounding fatal-on-escape envelope.
5. An explicitly specified conservative probe catch returns only that probe's indeterminate or validation outcome. It creates no poison and never hides an existing or newly committed execution fatality.

No other catch reclassifies failure. Rejection handlers that only establish Promise ownership are not classification catches. Expected synchronous language Errors normally return as values. When a native API requires throwing to abort, such as an Array comparator, one exact adapter catches that deliberate poison escape and applies its language transition before it can reach a fatal-on-escape envelope.

A trusted callback's declared result decides which continuation consumes it. If its result admits a language Error, a ready poison and a direct-Promise poison rejection have the same recoverable meaning. If its result admits no poison, any poison throw or rejection is fatal. For a Promise result that admits poison, JavaScript cannot distinguish an intentional poison result from `Promise.reject(poison)` inside that callback; adding a tagged completion protocol solely to infer intent is not justified. Keep such contracts narrow and compiler-controlled.

Runtime-owned failures are always fatal, including failures in:

- mirrors and placement versions;
- COW and refcounts;
- leases, gates, and external phases;
- internal graph traversal and publication;
- operation lifetimes and cleanup; and
- schedulers or trusted callbacks without an explicit supported-host contract.

Effectful reflection on user-controlled identities remains supported host code even when reached by an Error query. A safely rejectable query reflection failure produces `QueryReflectionFailed` for that query; it is not a found graph Error. Refcount, index, mirror, or other hook-free query machinery failing remains fatal because it violates trusted state.

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

This removes sideband attribution, not state with a different purpose. A Promise's settlement is immutable, while later FIFO consumers may transform a placement's logical value, so the mirror still stores that current value. Fixed imported logical overlays preserve host storage whose physical Error or synchronously consumed custom thenable differs from its final language value; complete Error collection keeps poison outside thenable fulfillment; and `execution.fatalError` provides synchronous fatal state. None is an alternate place to store Promise attribution.

The supported thenable contract is defined by [`data-limitations.md`](data-limitations.md). Native Promises use standard behavior. A custom thenable exposes a stable callable `then`, supports the subscriptions Cascada makes, represents one outcome, and implements chainable sync-first return behavior. It notifies subscriptions in registration order even across settlement: a later ready subscription cannot overtake an earlier undelivered one. It may invoke a callback before `then` returns when already settled. A synchronous callback throw escapes that call; a callback that throws after pending delivery rejects the returned chain. It supplies final non-thenable fulfillment values and owns any nested assimilation. A host implementation that cannot provide this contract supplies a native Promise instead. Dynamic accessors, Proxy-dependent or changing `then`, inconsistent settlement, insufficient subscription support, non-FIFO notification, and custom fulfillment with another thenable are unsupported host behavior. Cascada does not validate or repair these cases.

Use one common continuation helper, but let the thenable remain the one continuation mechanism. At each consumer's program position the helper performs an ordinary `then(onFulfilled, onRejected)` subscription, with the execution/lifetime guard and that consumer's semantic transition in the supplied callbacks. A synchronous callback completes in the same turn; do not add a native Promise or microtask merely to normalize it. A pending subscription returns the chain supplied by the thenable. Only that pending return, not the mere fact that the input had a callable `then`, enters an aggregate wait, retains pending-only protection, or reaches public fatal-result registration. All ordering-sensitive subscriptions use this helper so registration positions remain explicit, but Cascada keeps no execution-wide thenability cache, captured callable, canonical settlement Promise, first-settlement record, subscriber queue, species-defense path, or active custom-thenable assimilation set.

Raw possible-Promise recognition and returned-chain pending recognition are different questions. At a raw boundary, recognize Error and Function and consult fixed admitted metadata before any `then` access; an identity already admitted as non-Promise is never reinterpreted by a later context-free shape probe. The raw consumer performs recognition and subscription as one effectful boundary operation rather than first using a Boolean probe that reads `then` again. A returned chain is already in the trusted continuation-result domain and needs no persistent identity fact. Do not introduce a `{ pending, value }` result algebra: the common helper's direct callback result versus pending chain already carries the distinction.

Use the returned transition result itself as the only readiness signal. A transition callback that begins another possible Promise must consume it through the same helper before returning; therefore, after Error, Function, and fixed admitted-category precedence, a thenable still present in this trusted result position is actually pending. Do not add a `callbackRan`, `settledSynchronously`, or backwrite-observed flag. A callback may update a mirror, aggregate slot, receiver, or query state because that is its semantic effect, but the helper return identifies pending work without using that update as a readiness flag. The selected target and publication facts determine which dependency still needs protection; only a pending outward result receives fatal-delivery registration.

Calling `then` is a narrow trusted scheduling protocol, not an arbitrary host callback. Do not keep the generic host-code re-entry guard active while the supplied kernel continuation runs; otherwise every legal synchronous delivery would look like forbidden re-entry. The thenable body performs its own subscription, delivery, and chaining work and must not synchronously invoke Cascada APIs except through a supplied callback. An escaping `FatalError` from that callback is preserved and unwinds synchronously. A throw from accessing `then`, or from invoking its body before a callback supplies the outcome, is classified as `ThenAccessFailed` or `ThenInvocationFailed` at the exact recognizing or subscribing boundary. Cascada does not add state to diagnose a thenable that catches callback failures or otherwise violates the protocol.

Each causal boundary interprets the fulfillment or rejection delivered to its own subscription using its own operation context. A raw rejection reused at two causal boundaries therefore creates two contextualized poison occurrences; later propagation of either occurrence preserves it. Promise mirrors remain per placement and version because later FIFO consumers may transform that placement's logical value; they do not duplicate thenable settlement state.

Consume a possible placement thenable before choosing its representation. If its resolver transition returns directly, publish the final value directly into runtime-owned storage; when imported or non-writable physical storage must be preserved, reuse a fixed placement overlay for that final logical value. Install a changing Promise mirror only when the resolver transition actually remains pending. The resolver may write the logical value into unpublished staging state, but its returned direct-or-pending shape, rather than whether that write occurred, selects the representation. Initialize callback-visible unpublished staging and captured versions before subscribing, without installing a changing mirror or other pending-only machinery. Once the resolver returns pending, JavaScript run-to-completion prevents later asynchronous delivery from interleaving before its pending mirror is installed.

Error recognition precedes thenability recognition. Admission also preserves an identity's already-fixed category before probing; the metadata short-circuit is an admission invariant, not a thenability cache. Failure while ordinary raw recognition or subscription invokes supported host behavior belongs to that exact causal boundary. The contract does not require special diagnosis for an unstable getter or broken ordering: a safely observed throw is classified normally, while an undetectable ordering violation is an unsupported host-contract violation.

Readiness and publication authority remain scoped to the work they describe. A pending independent result cannot extend completed path selection, receiver publication, or source capture. Import subscriptions share one segment-local lifecycle fact, `staging -> committed` or `staging -> abandoned`. Commit grants semantic publication authority; abandonment makes later callbacks return after the common execution and segment checks without that work. Release staging collections on either terminal transition while retaining rejection ownership of already-created reactions. Synchronous custom delivery joins the current staging walk; later delivery for a committed placement starts a new segment. No committed shared version exists for an abandoned import subscription to settle.

### Hook-free contextualization and diagnostics

Contextualization invokes no host code. It never calls getters, coercion hooks, `toString`, `then`, `stack` or `cause.stack`, or arbitrary Error properties.

- Preserve the exact thrown or rejected value as `cause`.
- Derive a message only from primitives or safely inspected own data properties; otherwise use fixed text.
- Copy no cause properties onto the wrapper.

The kernel stores classification and structured facts, not formatted source presentation. `.message` contains no opaque source fields or compound-child listing. Kernel Errors expose `name`, `message`, `kind` for poison, opaque `errorContext`, optional exact `cause`, and `.errors` only on `CompoundPoisonError`; they do not expose Cascada's legacy `_errorContext`, expanded `context`, `fullMessage`, `totalErrorCount`, `kinds`, `getInfo`, or per-location convenience fields. The higher runtime formats source data, diagnostic routes, cause stacks, and bounded compound displays into a separate immutable, non-thenable diagnostic view outside graph transitions and under `try`/`catch`. Its child and cause fields contain only diagnostic views or safe scalar presentation, never a poison/native Error or exact hostile cause that language access could consume again. Error inspection returns `null` for healthy data and this view for poison; query failure remains poison. It does not add presentation fields to the frozen Error. Formatter failure cannot change the stored Error or outcome.

Host-configuration APIs remain outside language execution. A documented declaration validation failure, including conflicting declaration, invalid declaration value, or unreadable thenability, returns an ordinary Error value synchronously and changes no configuration. Malformed invocation of another host-configuration API may throw an ordinary host API Error when its own contract says so. An unexpected contextless defect becomes a contextless `FatalError` and throws synchronously; it creates no poison, closes no execution, and has no separate reporting path. If it later enters an execution, that execution submits and reports it normally.

## Recoverable Error behavior

### Rejecting-thenable representation

Both poison classes are synchronously detectable native Errors and sync-first rejecting thenables:

~~~text
isPoisonError(error)        -> true
await error                 -> rejects with error
Promise result adopts error -> rejects with error
~~~

Their `then` reuses Cascada's established sync-first poison behavior, applied directly to the Error rather than through a separate value wrapper. It exists only for assimilation and `await`:

~~~js
then(_onFulfilled, onRejected) {
    if (typeof onRejected !== "function") return this
    return onRejected(this)
}
~~~

It never fulfills or allocates another Error. It directly returns the rejection callback's value and lets any callback throw propagate normally. No catch is needed: native assimilation supplies a rejection function that does not throw, and kernel code never calls `then` because Error recognition precedes thenability. Because `PoisonError` itself is the value, Cascada's wrapper conversion, `catch`, `finally`, Promise-compatible chaining, and `RuntimePromise` are unnecessary.

Native assimilation still applies. `Promise.resolve(error)` rejects with that exact Error; returning it from a rejection callback causes the next native Promise to assimilate and reject with it again. A fulfilled inspection result must therefore be non-thenable. `FatalError` is not a language thenable, so host code can physically return or fulfill with one. Every ready, fulfilled, thrown, rejected, or traversed occurrence is submitted to the current execution before it could be admitted or exposed as language data.

The observable result shape is therefore `T | PoisonError | Promise<Awaited<T>>`, where the Promise rejects with poison or fatal Error; it never fulfills with poison. The rejecting `then` is what lets a generic `await operation()` reject identically when the operation produced poison synchronously or asynchronously without forcing the ready result through a Promise. A facade-only normalization reaction cannot provide both properties: wrapping ready poison would lose sync-first return, while leaving it plain would make `await` fulfill with an Error. A boundary whose callback result admits poison treats a direct poison return and a direct-Promise poison rejection equivalently after applying the boundary's graph effect.

### Publication and complete collection

Native Promise resolution assimilates thenables. When poison must remain graph data, publish or retain it in its logical location before the operation's native Promise rejects with that same Error. Runtime continuations never depend on fulfillment with poison.

Ordinary continuations propagate an existing poison rejection unchanged. Intercept it only for these distinct transitions:

- **Graph publication:** publish the Error, then reject the operation with it.
- **Complete independent-input collection:** record each poison outside the aggregate Promise and fulfill that internal branch with `undefined`, allowing every required input to settle before combination without assimilating poison. An unclassified or fatal rejection still fails immediately.

Keep separate helpers only when these different transitions need them. Do not hide them behind a policy flag, shared result wrapper, general rejection-to-value path, or helper whose only job is turning every poison rejection into fulfillment. Complete-collection state and external-phase state have different invariants and remain purpose-specific non-thenable records. Audit each Promise producer and transfer where it is implemented, and use strict unhandled-rejection execution plus focused route tests to detect omissions. Do not add a general result algebra or redundant operation-result normalization merely to make that audit uniform.

Complete collectors preserve semantic membership, not arrival-independent Error order. They may accumulate arrivals and suppress repeated graph-identity inspection with a visited set. No ordered child sequences or second captured-graph reduction is required solely for Errors. Collection still finishes every required input and preserves normal property-version captures and effect ordering. `hasError` retains its first-proof short circuit. The allowed Error-output and detection races are enumerated in [data-limitations.md](data-limitations.md#allowed-nondeterminism-in-error-handling).

### Compound Errors

~~~text
combine(errors):
    require at least one input; zero is fatal
    flatten nested CompoundPoisonError values
    deduplicate by raw cause, source-context identity, and kind
    retain one representative per semantic Error; order is unspecified
    return the exact leaf if one remains
    otherwise return CompoundPoisonError(leaves)
~~~

Use one collection-local equivalence rule in both `getErrors` and compound construction. The key is the tuple `(raw cause, opaque source-context identity, kind)`. Compare object and Function causes by identity, and primitive reasons by ordinary Map key equality; compare the retained context handle directly without inspecting its diagnostic fields. A leaf without a cause uses its own identity as the first key component. Distinct contexts or kinds remain distinct even with one cause. Flatten compounds before deduplication, and retain an existing immutable leaf as the representative. No new wrapper, persistent Error registry, or canonicalization across executions is needed. Propagation of an already-contextualized Error preserves its exact reference; equivalent separately constructed wrappers need not be `===`.

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
- A mutating call's preparation, method, validation, or direct-result failure normally poisons its receiver placement after the defined graph effect. Every direct Error result is a direct-result failure, whether ready, explicitly returned, fulfilled, or rejected. Failure confined to an independent nested result does not poison an otherwise successful mutation.
- If poisoning managed state would remove authoritative external capability, preserve the scope and return the Error.
- A script or operation result remains synchronously inspectable; a pending result rejects with the same Error and never fulfills with poison.
- On success, `hasError` returns a Boolean and stops once an Error is proven. Already-started shared settlement and publication finish, but unused query work explores no further.
- On success, `getErrors` scans its complete captured graph and Promise frontier and returns an Array containing one representative per reached semantic Error, using the same deduplication as compound construction and with unspecified order.
- Supported host reflection failure during either query is failure of the query operation, not a found graph Error: a ready query returns its `QueryReflectionFailed` poison directly and a pending query rejects with that same poison. `hasError` does not convert it to `true`, and `getErrors` neither returns an Array nor collects it into one. Internal indexing, refcount, mirror, or bookkeeping failure is fatal.

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
- kernel Promises that assimilate thenable language Errors.

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
    authoritative = commitFatal(operationContext.execution, candidate)
    throw or reject with authoritative

runInternalStep(operationContext, work):
    execute trusted work
    on any throw, including PoisonError:
        failExecution(operationContext, reason)
~~~

`failExecution` is the sole fatal entry and every authentic `FatalError` originates there with an operation context and execution. `runInternalStep` and a fatal-on-escape Promise reaction that detects failure use it and propagate the authoritative Error to unwind that call or derived Promise. Every call to `runInternalStep` already identifies its execution; it has no contextless fallback. A later guarded continuation that merely observes the already-non-null `fatalError` returns before work instead. Do not make the detecting reaction fulfill successfully with `undefined`: that would erase structured control transfer and require every downstream consumer to distinguish a real successful `undefined` from swallowed fatality. A language-outcome transition recognizes expected poison before this lane; poison that reaches this lane is a trusted-contract violation and becomes the exact cause of a new `FatalError`. Contextless configuration validation remains outside both poison and fatal construction: expected host failure returns an ordinary host API Error, while an unexpected implementation exception escapes synchronously. An existing `FatalError` is still propagated unchanged. There is no contextless source sentinel, fatal factory, reporter, or global failure state.

### Atomic execution fatal state

`execution.js` keeps one module-private state record keyed by each exact `Execution`. The public object exposes only the read-only query. Each record owns:

- one private nullable fatal Error slot exposed through a read-only `fatalError` class getter, which is both the closed/open fact and the authoritative first `FatalError`;
- one initially empty Set of rejection actions for operation results that are currently pending; and
- one reporter captured immutably when the execution is created.

There is no separate `hadFatalError` Boolean or latch. `fatalError === null` is the complete live-state test; storing the Error makes it non-null atomically and preserves the outcome needed by every observer. A normal class getter exposes the module-private state and prevents ordinary assignment without adding a per-instance accessor. Deliberate property redefinition or prototype replacement of an execution is outside the trusted control-object protocol.

The pending-result Set is not another live/failed fact: only `fatalError` answers that question. A module-private registration operation adds one idempotent native-Promise reject action only after the facade has identified an actually pending direct result. Its matching outward-settlement transition deletes that exact action before exposing normal fulfillment or rejection. Settling the internal source only queues this transition; until it runs, the operation result is still pending and a synchronously committed fatal outcome wins. Once the transition removes the action and settles the outward wrapper, later fatality cannot change that result. Registration, source-reaction attachment, and returned-wrapper construction form one hook-free synchronous transition; fatality cannot interleave with a partially registered result. An execution with ready-only operation results therefore allocates no wrapper Promise and stores no rejection action.

This narrowly scoped Set is not a task, owner, resource, cleanup, cancellation, or arbitrary listener registry. Its entries represent only the externally observable results that the execution is currently obligated to fail promptly. A single permanently pending shared fatal Promise is smaller superficially, but every settled `Promise.race` leaves its losing reaction attached to that Promise and can retain historical result Promises and values for the execution's lifetime. Deleting each reject action on settlement keeps retention proportional to current pending operation results instead of all results ever issued. A root-only race would also avoid many reactions, but would leave another package-level public operation blocked behind a never-settling dependency after fatality.

The module-private `commitFatal(execution, candidate)` performs one synchronous transition for the first candidate:

1. Store the candidate in `fatalError`.
2. Reject every currently pending operation result with the stored Error and clear that Set.
3. Invoke this execution's captured reporter after fatal state is committed.
4. Return the stored Error.

No operation owner, gate, phase, internal Promise, resource, or task is registered with the execution for fatal delivery. Rejecting a native wrapper Promise schedules its reactions and invokes no host code synchronously. Later candidates return `fatalError` without replacing or reattributing it. Operation owners remain local lifetime mechanisms used only to stop sibling work after an operation reaches its own final outcome while the execution is still live; fatal shutdown neither closes nor consults them.

The `fatalError` first-write rule owns report idempotence. `commitFatal` selects and reports one outcome for that execution; later submissions do not report again. It is an internal function in `execution.js`, not a public method or host capability; both it and the getter access the same module-private record, so trusted callers need no token or repeated candidate validation and the value is not duplicated. If the same `FatalError` reaches another execution, that execution independently closes and reports it once through its own reporter. The Error carries no mutable reporting state. Cascada supplies its per-render `onError` when creating the execution; a mutable module-global reporter is not execution routing.

The reporter is a synchronous, best-effort notification, never a control-transfer mechanism. Capture it in a local and invoke it as an unbound function in a protective `try` after committing fatal state; never expose the private execution-state record as its receiver or argument. Ignore its return without inspecting thenability, and preserve the authoritative Error if it throws. A reporter that starts asynchronous work owns that work and its rejection handling. Reporter failure cannot replace the outcome, trigger a second report, or block the fatal transition. Reporter re-entry observes the non-null `fatalError`. A caller that supplied no reporter still receives fatality through its pending operation result or a later synchronous public-entry check and may query `execution.fatalError`; do not simulate delivery with an asynchronous global throw.

The captured reporter is also the sole proactive notification for a fatal discovered after every outward result has already settled. It does not reopen or contradict that result: the execution has failed, but JavaScript cannot retroactively change a returned ready value or settled Promise. Do not add a late-only listener registry or another per-operation callback path. Cascada installs its render-local `onError` as this reporter before starting the execution.

### Fatal checks and operation result completion

Check fatal state before:

- public operation work;
- common continuation settlement and operation work;
- processing the result of a supported host action;
- and scheduler command dispatch.

These are centralized transition checkpoints, not polling requirements. Public entry, the one common operation-continuation helper, `runHostBoundary`, and scheduler dispatch own them. The resumption check covers later work in that hook-free synchronous transition; adding another check immediately before an effect in the same transition would be redundant. Inner hook-free synchronous helpers and loops do not repeatedly check because fatal state cannot change concurrently there. No checkpoint interrupts synchronous JavaScript or an active host call. If nested work closes the same execution during a host call, that call may finish synchronously, but `runHostBoundary` discards the returned value before contextualization, import, or publication and propagates the authoritative Error. Another execution remains independent unless its `FatalError` escapes into the current boundary; receiving it then closes the current execution under the ordinary submission rule.

The common asynchronous rule is deliberately small:

~~~text
if execution.fatalError is present:
    return
finish required shared settlement
if this operation's local owner is closed:
    return
continue operation-specific work
~~~

A closed execution starts no new operation, graph settlement, or host work. At public operation entry, throw the stored `FatalError` synchronously. At a common internal resumption, simply return without inspecting or publishing the settled value. A detached continuation does the same because `commitFatal` has already stored and reported the Error. Fatal observation performs no owner closure, release walk, or other cleanup protocol: state belonging only to the failed execution has no later semantic consumer. Some bounded extra hook-free work after closure is acceptable when avoiding it would require checks below the centralized transition points; no later graph or host effect may ignore closure.

This check-and-return rule is the runtime's cancellation mechanism. “Cancellation,” “stop,” and “shutdown” do not name another abstraction or state: there is no task token, `cancelled` flag, abandonment object, callback broadcast, or cleanup walk behind them.

Fatal handling does not cancel, reject, or otherwise settle a source Promise, private gate, external phase, or internal aggregate merely to wake its waiters. If its existing blocker settles, its ordinary continuation reaches the common fatal check and stops. If it never settles, that internal work may remain pending indefinitely. A pending operation result is registered for independent fatal rejection, so the blocker cannot hang that API result. Already-observed native Promises remain handled.

This can retain some operation-only objects behind an externally retained, never-settling source Promise. The source reaction itself cannot be removed, and the execution is already unusable. Although that reaction can retain its operation context and therefore the execution, the execution's identity stores are `WeakMap`s and do not root their own keys; metadata remains reachable only for identities retained elsewhere, though one live identity's metadata may retain related graph identities. The stuck reaction's direct additional retention is therefore limited to its captured identities and operation resources. A global owner sweep would improve only partial memory release while adding task registration, fatal callbacks, and terminal gate/phase states. A resumed reaction returns and releases whatever only that reaction retained through ordinary garbage collection. This is distinct from operation-result registration, whose action is deleted on ordinary result settlement and whose sole purpose is required fatal delivery.

Do not register internal waits, gates, phases, aggregates, or detached work for fatal rejection. Every execution-bound operation uses this two-boundary pattern:

1. Its existing public-entry check fails immediately if `fatalError` is already present.
2. It performs its own required processing synchronously as far as possible.
3. It passes the operation context and already classified direct result to one `returnOperationResult(operationContext, result)` helper.

The helper preserves Error, Function, and fixed admitted-category precedence before supported thenability and returns a ready result directly. It performs the same ordinary, hook-minimal recognition used by the rest of the runtime; there is no producer record, native-brand probe, or second result classification path. It first consumes a possible Promise through the common transition. If that transition returns directly, `returnOperationResult` returns that value with no wrapper or readiness flag. If it returns a Promise, required outward work is actually pending: only then does `returnOperationResult` construct one native outward wrapper, register its idempotent fatal reject action, and subscribe to that pending chain through the common guarded path. The public-entry check is the only synchronous fatal check: if the operation returned, no fatal can have been committed synchronously without propagating from the detecting boundary, and JavaScript cannot interleave an asynchronous fatal before registration finishes. The outward-settlement transition first unregisters the action, then settles the wrapper with the already classified outcome. Source settlement before that transition runs is not operation completion; a fatal commit during that interval rejects the still-pending wrapper. The derived continuation is immediately marked handled when ownership requires it. The helper accepts no owner, cleanup policy, result mode, or boundary-specific option. Public operations retain their own semantic processing; the helper only preserves synchronous return and adds prompt fatal delivery to an actually pending direct result.

This guarantee depends on a semantic invariant upstream of the helper: the direct result remains pending for every unfinished transition that can still change the operation's specified result or an effect promised complete with it. Boundary admission, validation, copying, Error collection, and required publication therefore feed that direct result. Fire-and-register mutation returns are issuance outcomes instead; their gates make later dependent reads or exports wait. Nested result Promises and branches abandoned after a short-circuit proof are likewise independent when they can no longer change the operation's result. A late fatal from such work closes and reports the execution but cannot revise a completed result. Misclassifying required work as independent is an operation implementation bug that no fatal-result wrapper can repair.

Put this helper in the package's host-facing facade and use it for every execution-bound host-facing import, lookup, call, entry, export, Error-query, and mutation result. Core operation functions remain unaware of outward fatal registration, so internal composition does not wrap intermediate asynchronous results. A separate explicit trusted integration entrypoint exposes those same unwrapped core functions plus `returnOperationResult`, poison/compound factories, fatal submission, Error kinds, and precise predicates needed by a higher runtime such as Cascada. That runtime uses core operations for compiler commands and applies `returnOperationResult` only to the outward results it owns. The integration subpath is a documented composition trust boundary, not a security capability; do not duplicate factories or add authorization tokens around it. This module boundary is the one composition mechanism: do not infer call origin dynamically or add a public/internal mode flag. Chain and context-root construction performs its public-entry check, but its immediate Chain return is already final and needs neither a final recheck nor registration. Contextless declaration and host-configuration APIs remain synchronous and have no execution fatal state to observe. A small test reads the package manifest and classifies every entrypoint's actual export surface; focused route tests verify the behavior of each execution operation. The helper adds no wrapper to a ready value or to an immediate non-blocking return whose operation continues internally. It preserves Error, Function, and fixed admitted-category semantics before ordinary supported thenability recognition; it does not consult a cache, resample a previously captured method, or probe native Promise branding. Every successful non-Promise language-data result is safe under native Promise resolution: graph placement transitions reject a callable own `then`, managed prototype validation rejects an inherited callable `then`, and stable/read-only host contracts cover standard prototypes, Functions, and external identities. Non-callable `then` data remains ordinary. These source invariants are the minimum restriction that keeps ready and pending result transport equivalent without a second result path. Operation-result registration performs no task cancellation, resource cleanup, dependency walk, or owner notification; internal work observes the execution field at its normal checkpoints. If fatal occurs while an operation result is pending, that result fails promptly even when its normal input never settles or its internal source has settled but outward settlement has not run. Once the outward settlement transition begins, it unregisters first and the delivered result wins over any later fatal. Script completion is one use of this same rule, not a special fatal boundary. `fatalError === null` is not proof that unfinished detached work will succeed. A scheduler uses the rule only when it returns its own outward completion result and owns no second fatal state. There is no execution-idle counter or quiescence barrier.

Script completion first uses common export and then applies this helper exactly once. A raw managed lookup can contain an independent nested Promise, and a fire-and-register return can precede its gated publication; neither is a host-ready script result or proof of work that the script intends to await. The higher runtime may return without unrelated work, but it must keep every intended script-result dependency in the exported result's frontier.

## Minimal mechanism map

| Requirement | Minimal mechanism | Why it remains |
| --- | --- | --- |
| Stop failed execution work | `if (execution.fatalError !== null) return` at centralized resumptions | A second cancellation state, listener, owner sweep, or fatal cleanup path adds no semantic guarantee. |
| Fail a waiting operation promptly | One `returnOperationResult` wrapper and one Set entry per currently pending operation result | A field check cannot wake a result whose ordinary dependency never settles; settlement removes the entry so the execution retains no result history, while ready results need neither wrapper nor registration. |
| Stop siblings after a live operation finishes early | One local `open` fact and idempotent `close()` | This is independent of fatality and is needed by operations such as early `hasError`; ready work creates no release registry. |
| Convert supported host failure | One three-argument `runHostBoundary` around the exact host action | Inline copies drift; callbacks, policy modes, and thrown markers are unnecessary. |
| Handle an explicitly conservative host probe | One exact local catch returning that probe's prescribed fallback or validation outcome | The failure is not a language outcome; routing it through `runHostBoundary` would allocate discarded poison, while a generic probe-result algebra would add machinery without unifying semantics. |
| Attribute and deduplicate raw failures | Immutable boundary wrappers plus collection-local cause/context/kind equivalence | Existing Errors propagate by reference; equivalent new wrappers need no interning or execution-wide cache. |
| Preserve imported host storage | Existing placement overlays | Mutating the host Error or Promise would violate imported-data protection. |
| Support native Promises and ordered sync-first thenables | One ordinary `.then` subscription per required continuation through the common helper | A cache, canonical settlement Promise, or second subscriber queue duplicates behavior the supported thenable already owns and can add an unwanted microtask. |
| Distinguish ready from pending after that subscription | Inspect the normalized transition result after Error, Function, and fixed admitted-category precedence | A callback-ran flag or backwrite test duplicates information already carried by the sync-first return contract and confuses semantic state with readiness. |
| Collect several independent Errors | Complete collection with local semantic deduplication and a frozen result array | Unspecified Error order removes ordered branch summaries; successful value positions and effects remain ordered. |

Everything else stays in the semantic operation that needs it. In particular, execution fatality does not own resource cleanup, graph publication, gate or phase settlement, or local operation closure.

## Component responsibilities

- `execution.js` owns the private nullable fatal slot, its public read-only `fatalError` getter, the currently pending operation-result rejection Set, the captured reporter, and module-private `commitFatal(execution, candidate)`.
- `error.js` owns trusted Error construction, `ERROR_KIND`, precise Error predicates, the single three-argument `runHostBoundary`, hook-free contextualization, compound construction, and fatal submission.
- `language-values.js` owns context-free Error recognition, Error-before-Promise precedence, and the common ordinary-subscription path for native Promises and supported custom thenables. Each causal boundary supplies its own operation context in its continuation closure.
- Admission classification owns its conservative external fallback, and declaration code owns its direct contextless thenability recognition. Neither is a poison boundary or a mode of `runHostBoundary`.
- Causal boundaries contextualize ready failures and raw rejection in their first existing import, mirror, validation, or publication continuation.
- `resolution.js` preserves FIFO order through one common guarded continuation path. Each transition body explicitly handles expected language Error or lets an unexpected escape enter the fatal-on-escape envelope; publication and complete collection retain their distinct semantic bodies, not distinct continuation frameworks.
- `operation-lifecycle.js` owns only the local open fact, idempotent close, lazily allocated local release set, and one guarded operation-transition entry. It is not a Promise-combinator or Error-policy layer. Initial admission, graph publication, and complete input collection remain explicit semantic bodies in their owning modules rather than lifecycle wrapper variants.
- The package host-facing facade owns the one `returnOperationResult` wrapper and registers only its pending returned Promise with the execution. The trusted integration entrypoint re-exports that helper, unwrapped core work, poison/compound factories, fatal submission, Error kinds, and precise predicates for higher-runtime composition. Core modules neither wrap intermediate results nor accept a public/internal mode flag.
- Import, assignment, lookup, invocation, conversion, export, and external-operation modules define narrow causal boundaries and kinds without alternate propagation paths.
- Error queries and aggregators preserve existing Errors. Supported query reflection failure is poison; internal traversal or bookkeeping failure is fatal.
- The higher scheduler observes the execution fatal outcome and owns no duplicate state.
- The diagnostic layer formats opaque source context, exact causes, and bounded compound views without changing kernel Errors.

## Intentional differences from Cascada

The graph kernel keeps Cascada's useful semantics, not its current interfaces. Cascada should adapt during integration; the kernel adds no compatibility path.

### Cascada strengths retained

- Preserve synchronous progress and direct ready results; asynchronous availability alone never forces all operations through a Promise path.
- Preserve one fatal outcome and reporter per render, but put that authority on the render's `Execution` so graph work and public operations observe the same state. Retain only rejection actions for operation results that are currently pending.
- Preserve inexpensive boundary checks, exact producer-side rejection handling, complete poison collection where semantics require it, and rejecting-thenable poison behavior.
- Preserve compact source tables, diagnostic routes, cause stacks, and bounded formatting above the graph kernel.

The deviations remove machinery rather than semantics: one Error replaces poison wrappers and `RuntimePromise`; one `returnOperationResult` helper generalizes Cascada's root-only return while deleting settled registrations; one nullable Error replaces duplicate fatal facts; and direct check-and-return replaces fatal broadcast, iterator abort, and bulk internal-result rejection.

### Required Cascada changes

- Move fatal authority from `RenderState` to `Execution`. Capture the render's reporter on that execution; the render and command-buffer scheduler observe its outcome. Do not replace per-render reporting with mutable module-global routing.
- Do not copy `RenderState.raceRootResult` wholesale. It is root-only, owns an independent `.then` policy, converts an already-failed ready call into a Promise rejection, and classifies rejection again at return. The host-facing facade instead receives a classified ready value or direct supported asynchronous result, recognizes Error first, uses the common thenable contract, returns ready values directly, and registers only the actually pending case for fatal rejection.
- Remove `RenderState`'s eager fatal Promise and no-op rejection observer. A pending outward result gets one removable rejection action; executions whose outward results are ready allocate none, and completed results leave no reaction attached to a permanently pending shared signal.
- Keep fatal authority out of diagnostic context. Coordination uses `operationContext.execution`; compact diagnostic representation remains behind opaque `errorContext`.
- Replace the generated error-context-only flow with one render-local table of immutable operation contexts. Pair each prepared static source handle with that render's execution once, pass the selected operation context to every emitted kernel call and command, and reuse it whenever the exact source handle repeats. Distinct or dynamically derived source handles remain distinct. Do not recover execution from the diagnostic handle or allocate a two-field carrier on every loop iteration.
- Commit fatal state before invoking `onError` or another reporter. A detecting transition submits and propagates the authoritative Error; a later transition that observes closed state returns. Neither path performs fatal-specific local-owner cleanup.
- Reuse Cascada's proven sync-first rejecting-thenable poison behavior, but apply it directly to `PoisonError` and `CompoundPoisonError`. Remove `PoisonedValue`, `RuntimePromise`, and `PoisonErrorGroup`; their wrapper and chaining machinery is unnecessary when the Error is itself the language value.
- Convert raw failure once at its causal boundary. Replace Cascada's paired host wrapper/marker/catcher with one narrow `runHostBoundary` around the exact synchronous host action; it preserves or contextualizes a thrown or returned Error, then its causal caller applies the graph effect. Use an existing boundary continuation for raw rejection.
- Treat every direct Error result as boundary failure. A mutating boundary applies the same failure effect whether the Error is returned, fulfilled, thrown, or rejected.
- Retain Cascada's useful sync-first thenable behavior: native Promises and supported ordered custom thenables use ordinary `.then` subscriptions through the common continuation helper, and already-ready custom values may resume synchronously. Require custom thenables to own FIFO delivery, chaining, and nested assimilation. Do not port a kernel cache, canonical settlement Promise, subscriber queue, or `Symbol.species` defense. Keep Cascada's single-consumer `IteratorWaitToken` internal rather than passing it through the kernel boundary.
- Replace transport-specific `...Error` and `...Rejected` kinds with one `...Failed` kind per cause. Keep `Multiple` as a meta-kind. Use one `ExternalPropertyReadFailed` kind for the complete direct property-observation boundary rather than adding an `ExternalPropertyValueFailed` split.
- Replace Cascada's `RuntimeError`, shared `CascadaError` / `RuntimeContextError` ancestry, and mixed construction/reporting methods with direct native-Error branches: `PoisonError` and the kernel's `FatalError` directly extend `Error`, while `CompoundPoisonError` extends `PoisonError`. `FatalError` deliberately names the execution-ending effect rather than the broad implementation domain implied by Cascada's `RuntimeError`. Share construction utilities rather than an inheritance base.
- Normalize every fatal occurrence to `FatalError`, including contextless failure; keep the raw value as exact cause. Submit an existing `FatalError` unchanged to each receiving execution so its first fatal remains authoritative.
- Replace Cascada's cause-only deduplication with cause/context/kind equivalence shared by queries and compounds. Remove mandatory source sorting and logical Error-order guarantees. A retained leaf supplies representative context; existing poison propagates unchanged, while equivalent new wrappers require no persistent cache. Presentation may sort a separate view.
- Keep report idempotence on each execution's first write to `fatalError`, not on `FatalError`; the same occurrence may close and be reported by another execution.
- Ignore legacy attribution properties such as `_errorContext`; the accepting operation supplies causal source.

### Recommended Cascada changes

- Keep compact context tables, diagnostic routes, and stacks behind opaque source context.
- Format sources and causes in the diagnostic layer; keep eager formatting, arbitrary cause inspection, source sorting, and display truncation out of the kernel.
- Keep load-failure policy above the kernel rather than adding a generic policy hook.
- Keep compiler-created and discarded-value Promise handling above the kernel. Cascada owns every Promise it creates and every kernel result it schedules, buffers, or discards instead of returning; `returnOperationResult` transfers the returned Promise to the host caller.
- Route every pending public-operation fatal failure through the execution outcome, preserve sync-first result completion, unregister normally settled results, and let buffers stop at their existing dispatch/resumption checks. Then remove duplicate fatal queries and adapters.
- Give the higher runtime one explicit trusted package integration entrypoint for unwrapped core operations, operation-result return, poison/compound construction, fatal submission, Error kinds, and precise recognition. Expose once at the outward result owned by a render execution. Callback adapters and public aliases that merely delegate to that same render consume the already-exposed result and do not wrap it again; compiler commands and buffer results use the integration entrypoint and only fatal checks.
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
| `PoisonedValue` and `RuntimePromise` | Rejecting-thenable `PoisonError` | One representation works synchronously and asynchronously. |
| `valueWithOrigin` attribution wrapper | Existing boundary continuation | Reuses work already required at that boundary. |
| Cascada `RuntimeContextError` / runtime `CascadaError` bases | Removed | Recoverable and fatal Errors are distinct direct branches. |
| `RenderState` as fatal authority | Execution-owned fatal state | Coordination belongs to the execution, not diagnostics. |

### Semantic splits

`UserCallThrew` is not renamed mechanically. Audit each former call site by the action whose failure it represents:

| Former use | Current kind |
| --- | --- |
| Host Function or method invocation, including its direct result boundary | `HostCallFailed` |
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
- private thrown-failure marker or paired host wrap/catch helpers;
- generic host-probe completion algebra or configurable fallback mode on `runHostBoundary`;
- contextualization that invokes host code or copies arbitrary cause properties;
- registered formatter or generic fatal-versus-recoverable policy hook;
- general internal result algebra shared by semantically different transition records;
- execution-wide operation-owner registration or per-operation fatal-reject actions;
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
- `PoisonError` supplies synchronous detection and sync-first `.then`; `CompoundPoisonError` inherits that behavior. Both preserve missing-handler behavior, exact rejection identity, and native re-assimilation. `FatalError` remains non-thenable even after `Error.prototype.then` modification; this targeted protocol protection does not imply general tolerance of modified primordials.
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

- Combining zero inputs is fatal. Nonempty combination flattens, deduplicates by cause/context/kind, exposes immutable `.errors` with unspecified order, and selects `.kind` correctly without storing a redundant `.kinds` projection.
- `getErrors` and combination use identical equivalence. They merge the same cause/context/kind and preserve distinct contexts or kinds. Tests compare semantic membership rather than order or canonical representative identity.
- Required argument and export Error collection finishes without host invocation and uses only non-thenable internal readiness.
- `hasError` exits early and otherwise returns Boolean; `getErrors` completes its captured traversal and otherwise returns an Array. Supported query reflection failure is the query's direct `QueryReflectionFailed` outcome (or pending rejection), not `true` and not a collected Array element; trusted traversal or bookkeeping failure is fatal.
- A graph Error is published before its operation Promise rejects with it.
- Root and nested imported native Errors receive atomic occurrence wrappers without modifying host storage. Ready and deferred raw-Error introductions preserve attribution and deduplicate equivalently during collection without cross-segment interning; failed import commits nothing.
- Direct host-result rejection is converted once in its existing boundary continuation. No attribution-only Promise or parallel continuation remains.
- Every kernel-owned Promise category is handled without recursively observing unused host input.
- Stored poison can be replaced; repairable external poison can be repaired without replacing its capability.

### Classification boundaries

- Only the exact synchronous host envelope catches an observable nonfatal throw for boundary handling. It preserves thrown poison or converts an expected raw failure; its causal caller applies the graph effect outside the catch. Adjacent preparation, publication, cleanup, and trusted-callback failure remain fatal.
- Conservative classification and declaration probes keep only their exact local catches and prescribed opaque or validation outcomes. They create no discarded poison or generic probe framework and cannot hide execution fatality.
- Safely rejectable host output validation produces poison; unsafe host behavior that compromises runtime invariants is fatal.
- Complete independent-input collection finds every required poison before host work; unclassified or fatal rejection closes the operation.
- A language-outcome transition preserves an expected poison return or rejection. A fatal-on-escape transition treats every escape, including poison, as fatal. Raw consumer failures remain fatal unless an exact causal boundary classifies them.
- Supported host actions and callbacks do not synchronously re-enter Cascada. Attempted re-entry is fatal; nested higher-runtime dispatch occurs outside an active host boundary rather than adding gates or a second ordering path to every ready mutation.
- Contextless declaration and host-configuration behavior follows its explicit rules and never fabricates an operation context.

### Fatal behavior

- Expected poison is consumed before fatal submission; poison escaping a fatal-on-escape transition is the cause of a new `FatalError`. Fatal submission preserves an existing `FatalError`, contextualizes any other cause at the causing operation, and propagates the execution's authoritative first Error.
- The first fatal stores the authoritative Error, rejects and clears exactly the operation results then pending, and commits before reporting. It walks no operation owners or internal waits; later candidates do not replace it.
- The same occurrence reports once within each execution it closes through that execution's captured reporter; another receiving execution closes and reports independently through its own reporter.
- Every authentic `FatalError` originates through `failExecution` with an execution and operation source. Contextless configuration constructs none; expected declaration failures are ordinary host API Errors, unexpected implementation exceptions escape synchronously, and an existing `FatalError` is thrown unchanged.
- Centralized fatal checkpoints prevent new operation work and effects after resumption without polling inner synchronous helpers or interrupting active JavaScript. A host action that returns after nested work closed its execution cannot have its result imported or published.
- A fatal from unrelated work fails each public operation while its outward result is pending, including after internal source settlement but before the outward-settlement reaction runs. If outward settlement completes first, unrelated and never-settling work does not delay it; completed output remains stable, while a later fatal is recorded and reported as a defect that may make the result's trustworthiness unknown.
- `execution.fatalError` exposes the authoritative first fatal. It remains `null` before one occurs and makes no claim that unfinished work will succeed.
- Every pending execution-bound operation result rejects promptly even when its normal input never settles. Internal waits are not registered; they stop at their next centralized check and may remain pending forever when their blocker never settles.
- Ready operation results remain synchronous: they allocate no result Promise or registration and incur no microtask merely to observe fatal state. Error, Function, and fixed admitted-category precedence applies before thenability when deciding whether a wrapper is needed.
- Operation owners remain local and are never registered with or closed by fatal handling. They close only for their own live-execution operation outcomes.
- Every live-execution terminal route closes its local owner and balances registered releases and leases. Route tests assert those facts for success, language Error, supported boundary failure, and early sibling completion; there is no global quiescence oracle or test-wide owner registry because legitimate pending work and fatal execution have different cleanup semantics.
- The scheduler checks the same `fatalError` field before dispatch, and the execution retains only current pending operation-result reject actions; normal settlement removes each action, so no historical result graph remains rooted. No competing fatal or cancellation state exists.
- Reporter or formatter failure cannot replace the committed outcome.
- Late native settlement remains handled and performs no graph or operation work after its execution-fatal check.
- Completed Error wrappers, compound arrays, and concrete kernel Error prototypes remain frozen; host observation cannot rewrite later graph attribution, representation, or poison assimilation behavior.
- Fatal handling neither settles gates and phases nor publishes fatal graph data. If their ordinary blockers resume, they reach the common fatal check and perform no host effect or publication.
