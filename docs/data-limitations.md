# Data and Host-Code Limitations

This is the authoritative developer-facing contract for data passed between JavaScript and Cascada. The runtime may reject unsupported data, but restrictions on native code are trusted contracts unless stated otherwise.

## Terms

- **Managed data:** data whose complete logical state Cascada can traverse, resolve, copy, and isolate. Records and Arrays are managed by default; declared class instances can also be managed.
- **External state:** an exact host identity whose live state Cascada does not copy or manage. Class instances are external by default; a record or Array can be declared external.
- **External code:** JavaScript methods, accessors, callbacks, and other functions invoked across the Cascada boundary.
- **Controlled method:** a runtime implementation, such as a supported logical Array method, that operates directly on logical Cascada data rather than arbitrary host state.
- **Supported thenable:** a native Promise with standard behavior or an ordered, chainable Promise-like value satisfying the contract below.

## Observation and effects

Method calls may have application-visible effects only in explicit mutation mode (`!`), within their selected authority. Assignment, deletion and explicit repair are also mutations. An ordinary call, getter, coercion or structural reflection hook must not mutate its receiver or shared application state. Preparing inputs to a mutating call does not authorize effects in its implicit inspections. Allocating a result, modifying detached argument copies and maintaining unobservable implementation caches remain permitted. A managed observation receiver stays read-only even when copied: its inherited logical identity requires that immutability. Runtime settlement, bookkeeping and specified poison publication are not additional host mutation authority.

Managed-data reflection must describe the protected logical state consistently, including through Proxies. It cannot make its values or failures depend on which unrelated branch was inspected first. Available managed branches may therefore be prepared or consumed independently while other branches are pending. Their physical inspection order is not a public guarantee; values, aliases, validation, required poison collection and publication retain their normal contracts. Diagnostic instrumentation may count inspections to verify work bounds, but cannot turn an inspection trace into application semantics.

Purity does not make reads of live external state interchangeable with mutations. External observations remain ordered against conflicting explicit mutations, and a captured managed value remains protected against later Chain writes. Supported inspection failures still produce poison at the consuming boundary; internal runtime defects remain fatal. This host contract is trusted, not enforced by detecting Proxies or tracking their effects.

For example, `items.sort()` may construct a separately sorted result but cannot change `items`; `items!.sort()` publishes a mutation. Likewise, a native `api.read()` or `api.value` getter cannot update the API's shared state. Ordering them against an earlier or later `api!.update()` remains necessary because that explicit mutation can change what they read.

## Managed results and receiving boundaries

**Implementation status:** common preparation, prepared method-result preservation, parent indexing, bounded delivery, ownership, retirement, write-based identity, canonical native assembly and managed snapshot adoption are implemented. Physical reuse is excluded.

Managed results preserve their logical values through immediate reception by an operation or retention in a Chain or other explicit holder. A raw managed value or Promise is a handoff, not indefinite storage: receive it before an intervening operation can change its source, and protect each delivered input before forwarding or joining readiness. External code receives detached exports. The [integration contract](integration.md#managed-value-reception-and-delivery) specifies these boundaries and temporary Chain release.

Import host data before ordinary Chain initialization or assignment; Cascada-created structures preserve their runtime-owned origin. Every literal evaluation allocates its newly constructed containers afresh; the compiler must not reuse mutable data templates across evaluations or executions. Existing managed references may intentionally recur within one execution, including inside fresh wrappers, so freshness is not required at every reception. Host-owned cached graphs require import; direct cross-execution transfer of managed identities is unsupported and requires export then import. Prepare each fresh input that a call consumes or provisionally retains before receiver waits, mutation-path traversal, or selected processing, including its available internal relationships. Receiver selection precedes boundary-specific argument conversion/export; method-member lookup follows successful input preparation. Reuse completed preparation. Mutation calls provisionally prepare inputs before walking the receiver path, including calls whose dispatch later rejects. Ready rejected observations leave arguments unconsumed. Outward-only writes also prepare fresh managed sources before export; their source relationships are managed facts, while detached output copies have no managed parents.

Promise delivery does not change ownership: an unimported delivered container is runtime-owned just like a ready one. Import host-owned data to preserve it against mutation; timing alone does not provide that protection.

Call evaluation selects the receiver before boundary-specific argument processing. Native receiver-path getters run at the operation's ordered external turn, including when an argument is or later becomes poison. The selected value's category determines dispatch and required inputs. Method-member lookup and invocation happen only after those inputs are prepared successfully. Ready, synchronously delivered and pending arguments follow this same order. Common ownership preparation may run earlier without changing this selection order. Capturing a detached receiver ends its native access; an exact external receiver keeps its reservation through native completion.

### Method results

A method returning an existing prepared managed value in the same execution preserves that captured logical value, identity, origin and pending-delivery obligations through ordinary ownership protection. It does not request a new validation of the value's interior. This rule applies at the root, inside a fresh wrapper and when a later result property reveals the reference. Preparation means that available structure and pending-delivery obligations are established; admission alone is insufficient, and pending or Error-containing data can still be prepared.

Successful native completion and result admission have separate effects. Rejecting independent result data, including an exact-receiver escape or structural preparation failure, affects the result without poisoning the successful mutation's scope. This rule applies to managed and external calls regardless of whether fresh result data is immediately available or revealed later. Native throws, rejections, and direct poison results remain method failures with their ordinary scope-poison effect.

New or not-yet-prepared managed containers receive staged input preparation. An unreadable child remains poison at that branch; healthy siblings and pending producers survive. Only an unreadable container shape replaces that container. A known unreadable descriptor becomes a fixed poison placement without an invented recovery value. A call inside mutable external state rejects its exact native receiver at the direct result and while preparing fresh data. Newly owned pending deliveries retain that identity check and their causal context. A prepared child stops the walk; its existing producer keeps its obligations.

Registered external references remain inert data in both fresh and prepared method results, including direct results. Receiving or storing one grants no authority. With a healthy canonical binding, off-path selection reports `ExternalLocationConflict`, including when selecting an export root; export traversal and native receiver preparation reject a contained reference with `ExternalCapabilityEscape`. Returning a prepared graph neither repeats interior reflection nor searches it for this call's native receiver. Exposing mutable receiver-owned storage through a hidden alias remains prohibited host behavior.

Freshness does not select a registered-reference validation policy. A failed fresh segment still records no preparation; later attempts must perform the unfinished work. Preparation, admission and readiness remain distinct.

Managed does not mean ready, Error-free or exportable. Queries and export still consume their required data and collect Errors. Failed managed receiver validation combines its failure with Errors encountered by the result's required fresh preparation; it does not scan a reused interior solely to collect Errors from a discarded result, or await independent nested result Promises. Native mutation finalization validates actual changed state; it is not skipped by result preservation.

Returning a prepared graph with pending properties is permitted. Storing that reference into a native mutation receiver is different: the completed receiver must satisfy the [managed receiver rules](#managed-method-contract), including containing no Promise or supported thenable. Finalization rejects pending stored data with `InvalidManagedReceiver` rather than waiting for it; preparation alone does not make that data ready. A method that needs such data in its receiver must finish the required work within its direct completion before finalization.

Host code must relinquish mutation of new storage that becomes managed, or return a detached copy. Returning an existing managed reference grants no right to inspect or mutate its raw storage. Explicit native arguments and script results use export, which resolves required availability, collects Errors and copies managed data while preserving aliases and cycles. Returning an exported argument copy introduces new data, not an identity round trip. Mutable-external property snapshots retain their separate ownership and readiness rules.

### Managed identity

**Managed identity contract:** managed identity is write-based. A command that publishes anything is effective, even when it writes an equal value. Starting from `v.k === 1`, assigning `v.k = 1` separates the affected identity from a retained earlier version. Assigning `2` and then `1` also leaves it distinct. Same-value writes therefore separate aliases for searches and export. This consequence is accepted.

Only commands that publish nothing are no-ops: deleting an absent placement, repairing healthy data, an Array call whose logical operation writes no placement or structural state, and entry whose contained commands publish nothing. A failed command is classified by its actual publication: committed poison is effective; an independent result Error without publication is not. Entry preserves each contained command's effects even when the final contents match its initial contents.

Protection and representation copies inherit the captured source identity. Gate installation, storage copying, bookkeeping, and settlement of an already captured Promise-backed placement do not themselves introduce a new command publication. Fresh objects remain distinct even when their contents are equal. Storing a managed reference changes the destination and affected ancestors, not the stored reference's own identity.

Array classification follows logical writes, not equality of final contents: filling a nonempty range with its existing value is effective; an empty fill range writes nothing. Standard mutators that explicitly assign length (`push`, `unshift`, `pop`, `shift`, and `splice`) are effective even when that length is equal. Deleting absent Array positions is still nonpublishing. A successful native mutating call publishes its isolated working receiver and separates the affected path ancestors, even if the method writes nothing. Every managed node copied to form that receiver gets a fresh identity, including apparently untouched descendants. Already-prepared managed references newly linked during the call retain their captured identities, just as in ordinary assignment; fresh nodes created by the method have their own identities. A later native call copies those linked nodes as part of its receiver and gives the copies fresh identities. Unrelated branches retain identity. No before/after comparison or write instrumentation is performed. See the [identity plan](runtime-evolution-plan.md#phase-3-establish-write-based-identity-and-searches) for publication boundaries and producer coverage.

Comparisons use shared identity, immutable domain separation, and settled publication outcomes. An identity pairs a domain with a mutation cell. A fresh identity starts a domain; a pending successor shares its predecessor's domain because a no-op can only forward to that predecessor. A snapshot renews each incoming domain while preserving the captured mutation cells: its aliases follow those outcomes, but its identities remain distinct from the source and other snapshots. Different domains compare unequal immediately. Distinct unresolved cells within one domain may wait for their outcomes, indefinitely if they never settle. Each unresolved cell belongs to an earlier command publication, including validation required before that publication. Private entry consumers capture only their issued prefix, excluding the enclosing entry's future completion. Shared inherited identity can compare equal before its common outcome settles. Export and native receiver assembly require a fixed equality partition of their completed capture: one captured cell in a domain needs no wait, and merged cells need not settle their common predecessor. Every required representation is still inspected. Consumers do not inspect history to seek an earlier negative answer. There is no correlated evidence, evidence-sharing subsystem, or cyclic proof solver. Publication and unrelated value access remain independent of identity-only waits. After `v.k = p; v.k = 1`, published assignments are effective regardless of `p`; an overwritten pending value is not retained or awaited to decide whether those writes were equal.

### Search completion

Searches follow their normal short-circuit rules. They may wait for unresolved comparisons rather than reason about combinations of possible future results.

Once both compared values are available, a primitive and an object or Function compare unequal immediately, without waiting for object identity completion. Pending value availability remains a separate dependency.

- `includes` returns `true` as soon as one candidate is known to match, even if other comparisons are pending. It returns `false` when the eligible range is complete and every candidate is known to differ.
- `indexOf` and `lastIndexOf` preserve their search order. A pending comparison before a known match in that order may delay the result, because it could change which index is returned.

For example, two mutable entries start from the identity retained as `S` and await the same Boolean. The entry producing `A` writes only when it is false; the entry producing `B` writes only when it is true. Thus one entry publishes nothing and `[A, B].includes(S)` will return `true` either way. Cascada may wait until it knows which entry preserved identity; it need not combine those possibilities. If the Boolean never settles, the search may remain pending. A plain assignment of the Boolean or its Promise is already a write and does not create this situation.

This rule concerns when a search finishes, not whether later operations can be issued. It changes neither the eventual answer nor method ordering, Error handling, or effect ordering. Answers established by the documented comparison and short-circuit rules must still complete synchronously. [Phase 3](runtime-evolution-plan.md#phase-3-establish-write-based-identity-and-searches) uses domain separation and settled publication outcomes, as specified above; it does not combine hypothetical outcomes into comparison evidence.

## Deterministic Error reporting

**Poisoning errors obey sequential equivalence.** Given the same operation issuance order, logical inputs, and host outcomes, concurrent execution must produce the observable results and effects of sequential execution in issuance order. Physical callbacks may run out of order; semantic precedence and observable publication may not follow their arrival order. This includes whether poisoning occurs, poison kind, which causal failures require collection, and validation policy. Import source attribution and its derived deduplication and compound diagnostics have the exception below. Different outcomes produced by host code are different inputs; opaque source contexts are not sortable operation identifiers.

**Late first registration is a narrow effect exception.** A native operation may cross unregistered external identities and then wait for an input. If a root, intermediate identity or receiver on its retained noncanonical route is first registered elsewhere before further live host access, continued access fails locally. Rechecking only the receiver is insufficient. Canonical bindings remain immutable, and an already captured managed receiver has no further native-prefix authority dependency. Already-started host effects and exposed results are not undone, so readiness can affect whether that earlier alias access starts before the first registration. Preserve this live check; it does not permit arrival-order mutation or poison publication elsewhere. A later duplicate claim instead fails the new context import and never revokes the original binding. Historical metadata captures never grant current host authority.

**Import source attribution follows the first actual preparation.** When several imports encounter the same managed identity, the first successful preparation establishes the source context of preparation failures and pending producers. Ready input participates immediately; an earlier-issued import awaiting that identity does not later replace the context. This concerns preparation, not when the whole import finishes. The exception covers import routes, including host-result and external-property reception. These established contexts also determine deduplication and compound reporting: timing may therefore change the number of reported leaves, whether the report is a leaf or compound, its message and its group source. For example, two rejections with one native Error deduplicate when their established source contexts and kinds match, but remain two leaves when the contexts differ. Preserve the first preparation's attribution and apply the ordinary collection rules without reconciliation. This permits those reporting differences, not changes to poison kind, validation policy or graph effects, or omission of a required causal failure. No wait or arbitration is required solely to determine this attribution.

**Collected poison order is temporarily unspecified.** Deterministic collection order is future work. For fixed leaf outcomes, this permits different permutations of the same semantic collection, not different poisoning or validation outcomes. A compound always has message `Multiple Errors` and carries a group source only when all leaves share the same opaque source handle or value; otherwise its `errorContext` is `undefined`. Source equality follows `Object.is` for both deduplication and common-source agreement. Combination uses the contexts established by the producers, including the import exception, and selects no primary failure. Existing contextualized Errors remain immutable and preserve their attribution.

**Fatal crash diagnostics need not be deterministic.** The first fatal actually encountered fails the execution, becomes its authoritative fatal, rejects currently pending public results, and is reported once. Its cause and causal source remain exact; a different crash may be encountered first under another schedule. Do not wait for earlier-issued work to discover a preferred crash, continue unsafe graph work, or replace the committed fatal. Already delivered results remain delivered. This is the approved existing shutdown mechanism, not an open selection problem. Ordinary application failures and safely rejectable host output remain poison; this distinction grants no permission to reclassify them as fatal to evade determinism.

Classification uses the stable categories below, and structural preparation failures stay at the unreadable container or placement. Neither requires arbitration between imports. The [reporting investigation](phase4-review.md#deterministic-reporting-investigation-2026-10-19) records the earlier designs; its issuance-order requirement for import source contexts is superseded by the exception above. Establish relevant ordering dependencies before suspension; allow physical progress only where it preserves the required sequential outcome. Necessary dependencies may remain pending indefinitely. That permission does not authorize adding circular dependencies, inventing a substitute cause, or rewriting an exposed Error or settled result.

`hasError` returns or fulfills with a Boolean: either reachable poison or a recoverable failure to inspect the selected branch proves `true`. It can stop as soon as either is known; neither has precedence over the other. A query's own inspection failure does not mutate the inspected graph. `getErrors` reports that contextualized `QueryReflectionFailed` poison instead of a completed collection. Internal traversal and bookkeeping defects remain fatal.

Currently, each mutable external identity has one canonical location per execution. The first valid registration remains valid. Registration commits synchronously from directly available original context identities; Promise fulfillment never creates a binding. Validate every proposed registration before committing any admission, managed topology or registration from the new context. A repeated identity within that context or one already registered by an earlier context rejects the entire new import with ExternalLocationConflict at its own import operation. Otherwise independent fresh resources in the rejected context remain unregistered. Earlier contexts, their pending operations and their metadata are unchanged. There is no shared permanent conflict or revocation. Registration persists while the identity is live after its original canonical location is collected, so collection does not permit rebinding. A regular Chain creates no registration, and an earlier inert occurrence does not disqualify a valid context.

Native work checks current membership for every retained external path identity reached without its canonical node before further host access after suspension. A newly registered root, intermediate identity or receiver now fails locally; access through the first valid canonical binding remains valid despite rejected duplicate claims. Previously completed access cannot be retroactively rejected or repaired by rewriting a retained value. Canonical metadata queries inspect their captured poison state, and repair changes only covered repairable state; neither grants host authority. Exporting a managed graph containing the resource independently rejects capability escape at the export operation. Native authority failure and export capability failure retain their distinct causal boundaries and diagnostics.

## Graph-visible data

Cascada graph state consists only of own enumerable string-keyed data properties.

- Records expose those properties.
- Arrays expose canonical indexes. Length and holes retain Array semantics, but custom properties are outside the graph.
- Symbols, inherited properties, non-enumerables, accessors, prototypes, private fields, and native internal slots are outside the graph.
- An accessor or non-enumerable property is treated as absent. Cascada does not invoke it as managed graph data.
- Paths use String or Number segments. Consume availability and propagate language poison before validating a successful key; an expression PoisonedValue preserves its contained Error. Other successfully supplied values, including native Error objects, are invalid keys and are never coerced through user hooks. A native Error supplied by throwing or rejection instead creates a failure at that consuming boundary. See [Promise-valued paths](promise-path-segments.md) for key consumption and selection ordering.
- Aliases, cycles, sparse Arrays, Functions, Errors, external identities, and nested Promises are supported unless a narrower rule below excludes them.
- A successful non-Promise language-data result must be safe under native Promise resolution. Cascada rejects an ordinary callable own `then` placement during assignment and Promise-backed publication. Completed managed mutation applies the same placement-value rule with `InvalidManagedReceiver` and rejects newly encountered stored thenables without subscribing. Validation does not rescan admitted identities' hidden properties or prototype chains. Managed-class declaration and snapshot adoption reject callable or accessor `then` anywhere on the retained prototype chain; that chain must remain safe and stable. Records and Arrays rely on stable standard prototypes. Installing an unsafe native `then` through an accessor, non-enumerable property, Array non-index property, or prototype change is unsupported and carries no diagnostic or recovery guarantee.
- An exact Function or external identity used as a successful non-Promise language value must have a stable native `then` lookup that safely yields a non-callable value throughout its use, including before admission. Remaining read-only after admission does not establish that initial condition. Function and Error classification still precede availability recognition: classifying a Function without sampling its `then` does not promise supported output for an unsafe Function. Errors retain their separate Error semantics. Unsafe exact values are outside the host contract; Cascada adds no recurring reflection probe, thenability cache, or facade wrapper to support them. A non-callable data `then` remains ordinary. Without these source restrictions, native Promise resolution could invoke the same object only when an operation completed asynchronously, breaking ready/pending equivalence.

Do not place semantic managed state outside graph-visible properties. Cascada may copy or materialize managed data without copying hidden state or preserving its physical JavaScript address between operations. Representation-only observation materialization preserves managed logical identity, including a returned receiver, descendant, or alias inside a returned wrapper. Successful identity comparisons and exported aliases must not depend on whether preparation required such a copy or on Promise timing. Native code must not retain an unexported receiver for comparison across calls; arguments still cross their separate export boundary.

## Proxies in managed storage

Host-supplied Proxies may represent managed records, Arrays, or declared managed
classes only while they obey the managed-data contracts. A Proxy does not by
itself make an identity external; ordinary admission and declarations determine
its category.

Structural traps obey the [observation contract](#observation-and-effects): they inspect stable managed state without application-visible effects. The runtime need not serialize independent trap invocations across pending branches.

The native Promise-resolution safety rule also applies to Proxy-backed managed storage: reading `then` on a non-Promise value must safely yield a non-callable value throughout its use, including when a gate delivers it.

Descriptor reads used to select a managed mutation placement and capture its baseline must succeed. A host that hides a reached property's value, presence, or attributes during that selection is outside the placement-local recovery contract. The runtime does not retain an unread baseline or retry descriptor reads to reconstruct it. This restriction does not change ordinary poison handling for required classification, queries, observation, import, and receiver preparation.

Each primitive property write, definition, or deletion on managed storage must
implement the requested operation with ordinary property and Array semantics
on success. If it fails, the represented graph must remain unchanged. This
includes a `set`, `defineProperty`, or `deleteProperty` trap that throws or
reports failure; changing the underlying data before failing is unsupported.
The rule lets Cascada retain the old placement version and refcount state when
the physical operation fails. This contract applies to each primitive storage operation; it does not permit a failing trap to alter its input. The enclosing managed mutation preserves its baseline and discards failed working state; earlier successful Cascada commands remain committed.

Runtime-owned Array storage must accept length changes that ordinary Array semantics permit. This includes Arrays introduced inside a native managed mutation: a Proxy must not independently refuse valid length changes. The runtime relies on that contract without refusal recovery or compliance probes. Refused element writes retain ordinary placement-local failure and repair semantics. Imported Arrays are copied before mutation or resizing; ordinary copy eligibility still accounts for non-writable length and fixed storage. External Proxies retain their external-operation contract.

Ordinary managed methods may mutate their isolated working receiver and then throw or reject. The runtime discards that failed working state, poisons the selected scope, and retains its pre-operation logical value for repair.
An opaque external identity follows external-operation semantics instead:
authorized mutation, including property mutation through a Proxy, may leave
completed effects when it fails and poisons the selected mutation scope. This storage
restriction imposes no rollback requirement on external state.

Cascada trusts this contract. It adds no Proxy detection, compliance probes,
rollback, or recovery guarantee for violations. Supported required storage failures
remain ordinary language Errors. Updating a physical slot merely to replace an already committed Promise with its settled value is optional synchronization: a refused write or its preflight leaves that value in the authoritative logical version, without poison or rollback. Required assignment/mutation writes, value validation, indexing, and structural publication retain their normal failure rules; fatal failures are never ignored. Runtime-created Proxies used for internal
control, such as Array remapping, are implementation machinery rather than
host-supplied graph data and remain available.

## Executable positions

- A Function is data unless a supported method or callback position explicitly selects it for execution.
- `constructor` is never a callable method through `run`.
- Strings support documented native observations only.
- Number, Boolean, BigInt, Symbol, `null`, and `undefined` have no methods or property writes.
- A Promise or supported thenable has no direct operations; the resolved value determines its capabilities.
- A Promise or supported-thenable input that an operation does not consume remains host-owned. This includes an unused path segment or an argument to an observational call rejected while its receiver is ready; application code remains responsible for handling its rejection. Before a mutation call walks its receiver path, or while observational receiver selection is pending, explicit arguments may be provisionally consumed and fresh managed structure prepared to preserve borrowed descendants. Such inspection does not make an ultimately unused input a required wait or Error-collection obligation.
- A language Error has no operations and propagates when consumed.

## Promises and supported thenables

A required Promise may never settle, and an operation depending on it may remain pending indefinitely. Cascada does not have to detect this, choose a different result, weaken Error attribution, or impose a timeout. A future explicitly requested timeout is a separate operation contract. Non-blocking issuance permits further commands while a result is pending; it does not promise completion without the dependencies required by that result. Runtime-created dependency cycles and unnecessary barriers remain implementation concerns.

Cascada supports native Promises with standard behavior and custom ordered,
chainable thenables. Error and Function classification takes precedence over
thenability. In this contract and the architecture that depends on it,
unqualified **Promise** in a semantic role such as an input, direct result,
placement, Promise version, or frontier includes any supported thenable; **native
Promise** means the built-in JavaScript mechanism specifically. A supported
custom thenable:

- exposes a callable `then` whose identity and behavior remain stable while Cascada may use it;
- represents one outcome, supports every subscription Cascada makes, invokes at most one supplied callback once per subscription, and gives every subscription that same outcome;
- delivers callbacks in subscription order, including across settlement: a later
  subscription to an already-settled value cannot overtake an earlier
  subscription whose callback has not yet been delivered;
- may synchronously invoke only the newly supplied callback when its outcome is already available; it never drains callbacks from earlier subscriptions inside `then`; and
- returns the callback result directly when it invokes the callback synchronously, or a supported thenable representing that callback's eventual result when delivery is pending.

If the newly supplied callback runs synchronously and throws, that throw escapes
its `then` call. Once a subscription returns pending, a later callback throw
rejects its returned chain. A lazy-flushing implementation must schedule older
callbacks separately and return pending while preserving FIFO; it cannot flush
them from a new subscription. An implementation that cannot provide this
sync-first chain contract should expose a native Promise instead.

A custom thenable delivers a final non-thenable fulfillment value; it owns any
nested assimilation before invoking the fulfillment callback. Native Promises
retain native assimilation. This contract admits Cascada's sync-first resolved
values and rejecting expression containers without imposing a microtask on ready work.

Cascada invokes `then` through its common continuation helper at the operation's
program position. The thenable itself owns subscription storage, settlement,
and FIFO delivery. Cascada does not cache `then`, canonicalize the thenable onto
another Promise, maintain a parallel subscriber queue, or inspect the object
returned by `then` as shared settlement state. A synchronous callback is
processed in the same turn; Cascada adds no microtask merely to normalize it.
The `then` invocation is a trusted scheduling protocol, not a general external-code
callback: its implementation performs its own subscription, delivery, and
chaining work, and must not call back into Cascada synchronously except through
the newly supplied callbacks. Cascada does not add state merely to diagnose
violations of that contract. Synchronous callback failures unwind through their
ordinary guards; pending failures reject their own chains. No-op rejection
handlers retain rejection ownership after failure without semantic work or a
separate subscription-exit check.

After consuming a possible thenable, Cascada derives readiness only from the
returned transition result. A transition that finishes synchronously returns
its direct result; one whose required work remains unfinished returns its
pending chain. Cascada does not infer readiness from whether a callback ran or
whether that callback wrote into a Promise version, aggregate slot, receiver, or other
state. Such writes may carry the transition's data, but they are not readiness
signals. A transition that starts another possible thenable consumes it through
the same rule before returning, so any thenable left in this trusted result
position is actually pending. Error, Function, and fixed admitted-category
precedence still applies to that check.

Readiness is relative to the work being completed. A pending independent result
does not mean that path selection, receiver mutation, or source access remains
unfinished. Once those transitions finish, their protection ends according to
their own contracts even when the independent result is still pending. A
subscription may invoke its continuation before returning; only a callback
still pending after that return is excluded by JavaScript run-to-completion
from interleaving before the current stack returns.

Dynamic or throwing `then` getters, Proxy-dependent `then` behavior, changing
methods, inconsistent outcomes, repeated settlement, insufficient subscription
support, non-FIFO delivery, draining older callbacks during subscription, and
custom fulfillment with another thenable are
outside the supported data contract. Cascada does not add validation or repair
machinery for these cases. A failure that ordinary supported-external-action boundary
handling observes is still classified normally; undetectable ordering violations
remain host-contract violations.

## Errors

Ordinary non-poison native Errors are healthy data when supplied, stored, returned or fulfilled. They retain their exact identity and opaque native state, follow observation-only external access, and contribute no poison to queries or export. Returning `new Error("failure")` succeeds; throwing it or rejecting with it creates poison at that causal boundary. Only poison has recoverable failure semantics; fatal handling remains separate.

Recoverable failure of a requested operation produces poison; internal defects are fatal. Optional implementation work may fall back only when the complete required behavior, including effects and ordering, is preserved. For example, physical cache synchronization may fail while the authoritative logical version still supplies the correct value. Required classification is not optional: failure to inspect a category cannot silently select external semantics.

A script reports a recoverable Error only when its returned data is poisoned. Errors propagate through the data and the defined mutation effects; there is no execution-wide recoverable-error history or separate list of operation failures that the script must check. Repair and replacement with fresh data may remove poison, as in `if x is error: x = default`. Complete Error collection means collecting every Error required by the currently consumed data, not retaining failures that no longer contribute to the output. Fatal execution failure remains separate.

Failure payloads are diagnostic data. An exact native cause may retain its native stack, code, diagnostic fields, and nested native cause. It must not retain a protected managed receiver or argument, or a mutation-capable external identity, through any field, prototype, or nested cause. For example, `throw this` from a managed method and `throw Object.assign(new Error("failed"), { receiver: this })` violate this contract. Cascada retains compliant causes exactly and does not traverse, copy, or deep-freeze their graphs; freezing the poison wrapper cannot isolate a mutable cause. Kernel-created validation reasons contain only diagnostic facts.

`PoisonError` is recoverable language data. A causal leaf records an opaque source context, a stable failure kind, and its exact raw cause when present. Once contextualized, it propagates by reference without changing its source. Separate introductions may construct distinct immutable wrappers. Collection treats wrappers as equivalent when their raw cause, source-context identity, and kind match; physical wrapper identity is not a cross-construction guarantee.

Rejections in newly prepared graph placements use `OperationInputFailed`, independently of the receiving boundary. Their source follows the [first-actual-preparation exception](#deterministic-error-reporting), including pending producers. Existing contextualized Errors retain their exact source and kind. Direct root inputs and host-action failures keep their action-specific kinds: for example, a direct method throw or rejection uses `InvocationFailed`. Merely storing that raw Error inside a successful result does not mean the method failed.

`CompoundPoisonError` contains flattened leaves in `.errors` and preserves each retained leaf's exact source, kind, cause and message. Its message is `Multiple Errors`; its group context follows the common-source rule above, and its kind is the common leaf kind or `Multiple`. `combineErrors(errors)` accepts no summary message or group context. `getErrors` returns null for no Errors, the unchanged leaf for one distinct Error, or a compound for several; pending completion fulfills with that ordinary result. It and compound construction use the same semantic deduplication rule above, without a persistent Error cache. An input representing the complete union can be reused because its aggregate diagnostics derive from its leaves. Collected leaf order is temporarily unspecified under the [reporting contract](#deterministic-error-reporting). Different source contexts or kinds remain distinct even when the cause is the same. A present cause is compared even when it is `undefined`, `null`, `false`, zero, or `NaN`; causeless validation leaves use their own identity and remain distinct. Future deterministic leaf ordering will additionally require order-preserving compound reuse.

Both poison types are ordinary non-thenable **graph Errors**, recognized synchronously with `isPoisonError`. Normalized graph operations return or fulfill with them as data. The separate expression-facing PoisonedValue is not an Error; it retains one Error in `.error` and rejects await/native assimilation with that Error. Public `lookupPathForExpression` accepts only string, number, boolean, and bigint (ExpressionValue), rejects Null, undefined, Symbols, and non-primitives, and returns `ExpressionValue | PoisonedValue | Promise<ExpressionValue>`; it performs no object coercion or descendant traversal. Input consumption converts a supplied expression failure to its ordinary Error before graph admission, preserving source and cause. Native Errors are recognized before any `then` property is read; only a throw or rejection introduces causal attribution. Diagnostic views are separate safe non-thenable data.

`FatalError` represents an execution-ending internal defect, broken invariant, or unsafe
host failure. It is reported and rethrown, never treated as language data.
Kernel-created Error wrappers and compound child arrays are frozen after
construction, so exposing an Error cannot mutate later graph attribution.

Imported host storage and logical placements preserve healthy native Errors unchanged. Declaration APIs also return a supplied Error unchanged. Poison is never exported to external code; ordinary native Error data is permitted.

A poison leaf with `errorContext === undefined` acquires the context of the runtime operation that first receives or consumes it, including import, Chain initialization, assignment and host-result reception. Attribution creates a frozen contextualized value; it never changes the original diagnostic or establishes an execution-wide source for it. Independent uses can therefore have different sources without depending on arrival order. Existing message, kind and cause remain; if the diagnostic had no cause, that diagnostic becomes the cause so repeated receptions at one source still deduplicate. Once attributed, later consumers preserve the exact poison. A compound fills only missing leaf sources: a mixed-source group's `undefined` context does not make its already attributed leaves unattributed. If integration provides no source context, the runtime cannot invent one.

## Classification and declarations

Records and Arrays default to managed. Class instances default to external, including classes extending `null`. A null-prototype record is still a record; a class's null-rooted prototype is not a realm's `Object.prototype`.

Ordinary import, method results and observation-only external property reads use the same declarations and defaults. A record or Array does not become external because it was read beneath an external parent. Common import establishes imported protection, prepared placements and pending producers; prepared managed values retain their existing preparation. Errors and Functions retain classification precedence. Mutable-external snapshots copy managed portions before admission and preserve permitted exact external leaves; they never import mutable raw managed storage in place. Path observations and method dispatch follow these same categories. Native mutation cannot cross managed storage.

- Call `externalState(value)` before passing the value to Cascada to make one exact record, Array, or class instance external. The declaration is shallow and overrides `managedStateClass` for that identity.
- Call `managedState(value)` before passing the value to Cascada to make a class instance managed. When given undeclared managed data, it also declares reachable class instances until it reaches declared external boundaries. An unreadable identity fails the complete declaration atomically.
- Call `managedStateClass(...classes)` to make subsequently admitted instances of those exact classes managed. The rule is not inherited by subclasses.
- Classification becomes permanent at first admission within one execution. Later declarations and class-registry changes cannot reclassify that execution's identity, but another execution admits the same host identity independently.
- Repeating the same declaration is allowed. A conflicting declaration returns `DeclarationValidation` poison without changing the established category.
- Declaration APIs are synchronous and never await. Do not pass them a Promise or supported thenable. A declaration performs ordinary thenability recognition as it reaches each identity; failed required inspection returns `DeclarationReflectionFailed` poison and records nothing. Invalid input returns `DeclarationValidation` poison. These host-configuration failures initially have no source context; the runtime operation that receives them supplies it under the Error rule above. This is distinct from Cascada variable declarations: Chain initialization already carries its source operation context and preserves an initializer's existing attribution. Configuration creates no Promise, thenability cache, or persistent continuation state. `externalState` also rejects Functions and primitives. Passing an Error returns that exact Error unchanged without reading `then`.

Required category inspection failure produces poison at the consuming boundary, with no admission of the failed identity. Import keeps that poison at the affected child and preserves healthy siblings; snapshots and complete receiver validation keep their existing aggregate failure rules. Explicitly declared external identities bypass structural classification.

Declaration APIs create no execution. An internal defect escaping a valid declaration call throws a frozen `FatalError` with its exact cause and no source context; an existing fatal is thrown unchanged. A later execution receiving that fatal fails normally.

Declare a managed class before admission of its instances. The same categories apply to snapshots: an undeclared class remains external, and a snapshot cannot override an explicit external declaration on a class, record or Array. Only managed categories receive structural copies. Logical Arrays, including undeclared Array subclasses, retain Array precedence and controlled behavior; class registration applies only to its exact registered prototypes.

An internal managed copy inherits its source category. A host export is a new host identity: an instance-only declaration on its source does not automatically apply to that copy if imported again. Class-wide registration still applies to new instances with that prototype. A declaration does not bind an identity's prototype. If application code replaces it before admission, the replacement must independently satisfy the managed-class contract, including absence of callable or accessor `then`; the earlier check does not certify a later replacement. Changing an admitted identity's prototype or classification afterward is unsupported.

## Managed data ownership

After host-owned managed data is passed to Cascada, application and external code must not mutate its original managed identities. External leaves retain their separate authority and ordering contract. Cascada borrows that storage and preserves its logical value through copy-on-write; it does not make concurrent host mutation safe.

This restriction follows the original identities even if Cascada later copies them. Mutate managed data through Cascada operations or mutate a host-ready copy produced by export.

Managed values move between independent Cascada executions only through export followed by import. Do not pass an execution's internal managed identity directly into another execution.

### External reuse across executions

Observation-only external identities may be shared across executions under their read-only host contract. A mutable external resource may be reused across executions when the host or higher runtime guarantees exclusive, non-overlapping access lifetimes. Before transferring access, all work from the preceding execution that can read or mutate the resource must have finished, including pending operations and native asynchronous work. Earlier executions must not resume access while another execution uses the resource. Independent host activity and access through retained aliases obey the same exclusion.

An operation result that acknowledges issuance does not establish completion of its effects. Fatal rejection also does not establish completion: already-started native asynchronous work may still access the resource after Cascada reports failure. A runner that sequences executions must establish completion of all resource access before handoff, including on failure; merely awaiting a result is sufficient only when that result guarantees such completion.

Cascada keeps external bindings, authority, ordering, and poison execution-local. It neither detects cross-execution reuse nor enforces this exclusion. Sequential reuse creates no shared binding or poison state and does not relax the fixed-location rules within each execution.

### Mutation scopes and ownership

A managed mutation scope must not cover canonical registered mutable external locations. Use the external tree at the selected context route to enforce this restriction; reject an invalid mixed bang scope before mutation and poison that scope, retaining its value for repair. This managed-scope failure precedes an invalid native crossing deeper in the selected path, independent of key availability; a scope at the external resource itself still applies native authority validation. An external reference stored elsewhere is inert: its presence alone does not forbid controlled managed assignment, deletion, or Array operations. Copying or retaining such a reference grants no external observation or mutation authority. Observation-only external identities remain permitted opaque leaves. Managed lookup, import, assignment inputs, and retention still use ordinary sharing, leases, versions, and COW; a bang never promotes managed storage to native-writable data.

For example, if services.db is a registered mutable external location, services!.count = 1 is an invalid mixed scope, while the ordinary sibling write services.count = 1 remains valid. A retained managed copy at another location may use copy!.count = 1 even though it contains the same inert db reference. Use of copy.db as an external receiver still fails locally and does not poison services.db. Native managed calls consume their complete receiver, so preparation must reject any registered mutable external identity in that receiver, including an inert alias. Controlled operations do not scan or await unrelated data to establish that an inert alias is absent.

An external mutation selects one registered external scope and may change only its owned native subtree. Nested registered scopes permit sibling concurrency and parent-wide exclusion. Managed parents, siblings, and aliases are not accessible to the native method through raw references. Arguments use the ordinary export/ownership contract regardless of their source path. External methods do not recursively prepare managed aliases hidden inside native state.

Entry is an access reservation, not mutation authority. It may select a mixed branch and protect its managed placement and external descendants. Every operation issued through it must still obey the bang restrictions. Ordinary sibling paths outside the entry remain available. Gate installation itself uses path COW where required to preserve another owner's logical placement.

A failed Array-index mutation or broken prefix publishes Error at its selected or first failed placement, except repair, which reports a broken prefix without changing it. Creating that placement commits ordinary Array growth. Repair restores an absent baseline as a hole and preserves the committed length, as does deletion. An explicit broader mutation scope remains the owner; intrinsic length writes and remapping retain the complete Array baseline. A containing object acquires no poison merely because a child is poisoned; see [managed structural effects](error-handling.md#managed-structural-effects).

Each managed mutation preserves its selected scope's logical value at its ordered turn, before any write, using existing ownership and COW. Success publishes the working state. Failure discards it and publishes scope poison in owning-placement metadata while retaining the baseline for repair, regardless of whether the value was previously shared, leased, imported, or exclusively owned. The Error contains no recovery data. Ordinary Error data and an independent Error result from a successful mutation remain distinct. External failure keeps native state and completed effects, with poison in the external tree. [Scope transitions](error-handling.md#scope-transitions) define publication and repair. Further operations blocked by that scope poison preserve the same Error and original recovery baseline; one repair restores that baseline regardless of the number of blocked attempts.

A rejected context registration leaves an already-issued mutation and its scope untouched. If that mutation fails, its own failure still publishes normally; the rejected context's import Error belongs only to that context. An operation stopped by a pre-existing blocker adds no new scope poison and does not promote a child's poison into its ancestor.

## Runtime primordials

Cascada assumes the global `Array`, `Array[Symbol.species]`, the standard Array intrinsics, `Array.prototype`, `Promise`, `Promise.prototype`, `String.prototype`, `Object.prototype`, `Error`, and standard Error prototype chains are not modified. Otherwise native dispatch, inherited indexes, accessors, species, protocols, or Error classification could change controlled behavior.

Custom or replaced methods and accessors on `String.prototype` or `Object.prototype` are unsupported through native String dispatch. Cascada never invokes those accessors while selecting a String method.

A boxed String's own character indexes and `length` are not method candidates. `Object.prototype.__proto__` is an accessor, so it is unsupported and never invoked.

## Logical Arrays

Sort comparators must return a Number synchronously. A returned Promise/thenable is an invalid callback result; the selected callback boundary owns its rejection. This does not subscribe to forbidden thenables merely found during declarations or managed-receiver validation.

Logical Arrays support only the controlled methods documented in [`run.md`](run.md). Custom Array methods are unsupported.

```js
class Values extends Array {
    total() { return this.reduce((sum, value) => sum + value, 0) }
}

// Unsupported through Cascada run:
run(chain, [], "total", [], operationContext, {})
```

- A supported method name always selects Cascada's controlled implementation. An own or inherited override cannot replace it.
- Every other method name is rejected. Cascada does not inspect custom Array properties, prototypes, accessors, or proxies to find a callable.
- Controlled numeric and string arguments use Cascada's logical conversion, not native coercion of exported objects. External identities such as `Date` are invalid in these scalar positions; Cascada never invokes their `valueOf`, `toString`, or `Symbol.toPrimitive` hooks.
- Logical Array joining and Array-to-string conversion reject engine string-size overflow with `ScalarConversionFailed` poison. No standard JavaScript API exposes the engine's string-size limit, so its expected native failure is classified at the join over already converted strings. The implementation uses standard JavaScript APIs and relative ESM imports, without Node globals or built-in module APIs.
- Array callback methods are unsupported unless explicitly listed. A supplied `sort` or `toSorted` comparator is the documented exception.
- `Symbol.isConcatSpreadable` and custom Array properties are outside the language graph and do not affect controlled `concat`.
- A host comparator must run synchronously and return a Number. Poison propagates as its failure outcome; a Promise, ordinary native Error, or any other non-Number result is invalid. It may mutate or retain its exported managed argument copies, but exact Functions and external identities remain read-only. It must not synchronously re-enter the same execution.

Use a managed class rather than an Array subclass or custom Array prototype when data needs application-defined methods.

## Managed records and classes

A managed record exposes only own enumerable Function-valued data properties as methods. Inherited Functions, accessors, non-enumerables, and extracted Functions are not record methods.

A managed class has these additional restrictions:

- Its semantic state uses only own enumerable string-keyed data properties.
- Its prototype chain up to `Object.prototype` may contain accessors, but they are not Cascada methods. It contains no callable or accessor `then`.
- It does not depend on private fields, Symbols, non-enumerables, accessors, native internal slots, mutable closure or module state, parent state, or hidden shared mutable storage.
- Constructors are not run when Cascada copies an instance.
- External code does not change its prototype chain, descriptors, or extensibility after admission.

Method selection rejects accessor methods without invoking them. Receiver validation rejects callable `then` placements and newly encountered stored thenables before publishing the candidate. Native lookup safety outside those placements relies on the host restrictions above, without repeated integrity checks.

Do not declare native internal-slot types such as `Date` managed. Their prototype can be preserved, but their hidden state cannot be reconstructed in a copy. Keep them external, and explicitly declare a nested identity external before a surrounding `managedState` walk reaches it.

These restrictions allow records and class instances to share one managed invocation model. Every native managed call receives a complete copy of its logical receiver, preserving aliases, cycles, Array shape and admitted prototypes. Observation copies inherit logical identity; mutation copies follow the whole-receiver publication rule above. Receiver sources need protection only until their placements and pending versions are captured. Entry and controlled Array operations retain their existing narrower mechanisms.

## Managed method contract

- The call mode must describe the method correctly. An observation does not mutate its receiver; a method that may mutate the receiver must use mutation mode.
- A method may change its exported managed argument graph in either mode. It may change its managed receiver only in mutation mode, and must not mutate unrelated exact state.
- All explicit managed arguments are exported together into one host graph independent from their Cascada sources. Aliases across argument positions remain aliases. A method may mutate, retain, store, or return that graph without changing the Cascada sources.
- Managed receiver state and exported managed arguments are separate graphs. A method must not rely on a managed argument retaining an identity relationship with `this` or one of its properties across the boundary.
- Functions and external identities remain exact when exported and are read-only as arguments. Passing or retaining one never grants external mutation authority.
- Every managed record or class method keeps mutable semantic state in `this` and receives other state through explicit arguments. It must not read or mutate mutable parent, closure, module, or other state outside those inputs.
- External identities inside a managed receiver are opaque leaves. A method may retain, compare, return, or add another reference to observation-only identities, but it must not inspect or mutate their host state. A mutating managed receiver cannot contain registered mutable external identities. It may replace or remove an observation-only identity, but must not move, replace, or remove a mutation-capable identity recorded at a live context-tree leaf.
- Access mutable external state through a separate Cascada operation selecting an external scope, such as `api.db!.close()`. A managed `api!.close()` cannot contain registered mutable db, and `api!.db.close()` is invalid when api is managed. An external api may select its whole native subtree, subject to fixed nested locations.
- A completed mutation receiver contains no Promise, supported thenable, poison or registered mutable external identity. Finalization rejects an introduced registered identity with `ExternalCapabilityEscape` at the introducing call, whether or not the offending data is returned. The call discards its working receiver and poisons its selected scope while retaining the baseline for repair; later calls preserve that scope Error. Validation rejects a stored thenable without consuming it, even if it could deliver synchronously. Ordinary managed state may contain these values between calls; native receiver preparation resolves availability and rejects poison or registered mutable identities before invocation. Ordinary native Errors remain healthy opaque data throughout preparation and finalization. Controlled managed writes may still retain inert registered references.
- A managed method may complete synchronously or through one direct Promise. Later receiver access and any inspection of a read-only exact external input must belong to that Promise and finish before it settles.
- Direct poison, throws and rejections report native method failure; ordinary native Error results are healthy data. A managed mutating call discards its private changes and retains its pre-operation scope beneath placement poison; an external call poisons its scope without native rollback. An invalid mixed managed scope is rejected before invocation and retains its unchanged baseline. An independent result Error from a successful controlled mutation does not roll back its effects.
- Detached receiver or external-input work is forbidden. A Promise nested in a synchronous result must not later access or expose the receiver, or inspect or mutate an exact external input; return that Promise directly when its completion needs such access. Exact observation-only external identities may be retained or returned inertly because this grants no authority. The managed structure of exported argument copies may be retained, used, or returned later; exact external leaves inside it follow the same rule. Synchronous re-entry into the same execution is forbidden; a separate script execution may start immediately, and independent work in this execution may start after the host call returns with its own explicit operation context.

Nested calls such as `this.increment()` are ordinary JavaScript calls on the already prepared receiver and follow the same outer invocation contract.

## External state

External identities are exact host objects. Cascada observes them by default and mutates them only through an explicit mutation operation: a marked call, assignment, or deletion under valid authority.

### Mutation location

Mutable external scopes are registered at fixed context locations. Observation-only external data needs neither registration nor locks. Each registered location must be directly accessible through original own data properties, with no Promise, thenable, or accessor on its route. This excludes synchronously delivering thenables too. Ordinary import may consume such availability, but discovery never follows its outcomes or adds nodes later.

Registration commits during initial context import, before the first observation or mutation. From that point, use through a copy or unrelated alias fails even if the original context location has never been used. An authorized entered route retains the original location's authority; copying managed data does not transfer it.

For a still-live host identity, collection of its former context does not erase registration or permit rebinding in that execution.

The compiler supplies finite static receiver paths for mutations, containing paths for native writes/deletions, and repair paths. Initial import follows only these named routes. It retains external nodes and their connecting paths, including requested nested external objects below a first external boundary. Managed endpoints disappear; discovery uses the same declarations/defaults as other admission and cannot force a record or Array external merely to register it. Duplicate selected locations for one exact external identity fail the initial import atomically. No discovery subtree search, late registration, or alias scan is performed.

Supported reflection failure while reading a compiler-named native data placement during discovery produces ImportReflectionFailed at context import and commits no partial tree, admission, or binding changes. Discovery does not enumerate native properties or invoke getters. Each requested native crossing checks descriptor-based direct availability before classification, even if an ordinary import alias has already established a category. Cached classification failure is reused at that later step; it does not override an earlier availability failure. A container's local structural poison does not erase successful category facts or permit native authority to cross managed storage.

Every registered external node selected or crossed for actual native access requires a source-static path. Literal String/Number keys are static; computed ready Strings and synchronously resolving keys are not. A Promise key ends the static prefix even with omitted or later declared firstDynamicSegment. The existing routing/consumption walk narrows that prefix at non-String/Number input without coercion, then lookup, subscription or an unused-suffix scan; successful delivery never promotes it to static authority. Invalid keys still fail only when reached. Dynamic input keys remain usable inside unregistered native suffixes, but cannot select another registered descendant for native access. Canonical metadata-only queries and repair have the metadata exception specified below. Native intermediate property values and method receivers remain ready; only final read values or direct method results consume availability.

For external apis with registered config and db, config mutation and db mutation overlap. A mutation selecting apis waits for both and blocks later descendants. A parent observation waits for child mutations and blocks later child mutations. Ordinary observations overlap. Scope selection uses the explicit bang prefix when present, otherwise the deepest registered scope covering the operation's receiver/container. A bang inside an unregistered native suffix uses its enclosing registered scope. Entry at a native suffix protects its deepest selectable registered scope without reading that suffix. Contained commands retain normal path and authority rules.

Forbidden dynamic observation returns local ExternalLocationConflict before host access. A shared prefix containing registered siblings does not forbid unrelated dynamic managed or observation-only paths. Existing poison takes precedence, and computed keys never grant native authority or reserve a guessed resource.

**Dynamic-path failures:** healthy computed and Promise-resolved keys use ordinary path failure scope for both unregistered external mutation and forbidden registered-resource routing. With no statically selected external owner, a forbidden crossing fails at the reached managed placement holding that identity, or an already-selected broader mutation scope. For default `P[i].api.x = 2`, healthy i selecting a therefore poisons P.a.api, leaving P.a's other properties and P.b usable; native api storage is unchanged. A statically selected external owner instead retains its ordinary ordered scope poison and intact managed binding. Repair-only uses the canonical metadata-selection rule below; invalid selection preserves all prior state, while a healthy computed canonical route may clear the selected resource's repairable metadata. Off-path aliases fail at their local placement without poisoning the valid canonical location. The failure scope preserves the requirement for source-static external authority.

A poisoned key before child selection follows ordinary failed-key publication at the reached prefix: if i fails in `P[i].api.x = 2`, the default mutation poisons P. Key readiness alone cannot widen failure scope. Explicit broader scopes retain their ordinary validation and publication rules, including rejection of a managed mutation scope covering registered locations.

Registered identities and connecting placements cannot be replaced, removed, or moved by reset, Array remapping, assignment, deletion, or any native method. Ordinary unregistered child objects and Arrays may be replaced within the selected authority. Managed namespace parents may retain ordinary mutable siblings, but cannot be selected as bang mutation scopes when their canonical route covers registered locations. COW, entry, guard poisoning, and repair preserve fixed identities and locations.

Actual native use of a registered identity requires its canonical context route or a valid entered route derived from it. Regular-Chain storage/import creates no competing registration; off-path use fails locally and does not poison the valid context. Currently, the first valid binding remains valid and a later conflicting context import fails atomically before any of its staged changes commit. Failed external-authority discovery commits none of the initial segment. Inert aliases and Promise-only routes make no claim. Completed effects and exposed results are not revoked retrospectively, and no reverse alias/exposure history is maintained.

Registered mutable identities cannot escape through host arguments, native write values, controlled callbacks, or direct result extraction. Ordinary import neither grants authority nor downgrades a registered identity to observation-only. A parent external scope may operate on its fixed native descendants at their canonical locations; this grants no authority to hidden sibling aliases or managed storage. Hidden writable overlap between otherwise independent registered siblings violates the host contract.

Registering a nested resource also restricts its extraction: lookup of registered apis.db.config as data fails with ExternalCapabilityEscape, while a canonical lookup of config.timeout can return its value. An unregistered sibling object retains ordinary detached-snapshot behavior when supported. A snapshot containing a registered identity fails rather than copying that identity's interior; observation failure remains local. Managed-parent retention may carry an inert reference but grants no access authority.

The compiler format and entry lowering are specified in [integration.md](integration.md#compiler-construction-of-the-mutation-access-tree); the tree representation and reservation rules are in [external context ordering](external-context-ordering.md).

### Ordered external metadata

**Implemented architecture.** Runtime-owned external poison uses ordered versioned views. Canonical bindings are immutable after successful registration; rejected duplicate claims publish no resource metadata. Contextual hasError/getErrors and repair-only may select canonical registered scopes through static, ready computed, synchronous thenable or deferred keys. Selection follows the fixed tree and validates keys without reading native properties, exposing identities, adding registrations or granting off-path aliases authority. Unregistered suffixes select their enclosing registered metadata scope. Readonly references still cannot repair. Actual host access retains its source-static requirement.

Queries capture state at issuance in their ordering view, including earlier pending native outcomes and excluding later failures and repair. A delayed key selects within that captured view. Later writes below a broad pending repair or entry publication that need its resolved state retain their issuance position through successor versions; queries capture the latest visible version without publishing a write or recapturing live state after a wait. Native outcomes update only their node's own poison, preserving children. Preserve ordinary strict-ancestor blocker and complete selected-subtree collection rules. Rejected context imports cannot change either earlier or later metadata queries of the valid context. Actual native access trusts its canonical nodes and independently checks current membership for retained native path identities reached without their canonical nodes. Entry retains its fixed scope and private publication view; metadata capture does not narrow its native access reservation.

#### Contextual Error collection

When a contextual query reaches its selected managed placement, getErrors combines that placement's visible poison with the complete required own/descendant Error union of its canonical resource-tree scope. A managed guard terminates managed-value traversal; it does not hide separately maintained resource metadata that repair at that placement would clear. Never inspect the hidden recovery graph or native properties to collect it. Preserve original Error identities/contexts and ordinary deduplication. hasError may finish immediately on the guard. Poison on a strict ancestor still prevents reaching the requested target and returns that blocker; this rule does not authorize querying through it. A [terminal off-path alias](#terminal-alias-placement) has no canonical subtree and retains its placement-only boundary.

#### Repair transitions

Repair-only validates and preflights restoration, then commits managed recovery and covered metadata reset together. Once those prerequisites are ready, the external subtree becomes empty whether its earlier state was healthy, poisoned or pending. Do not inspect that state or await earlier native outcomes whose poison is overwritten. A reset covering a pending metadata subtree replaces it without waiting for its publication or an earlier repair's unresolved key. The reset's own pending keys, strict-ancestor own poison and required managed placement/publication transitions still determine success or failure; selecting a target below a pending publication can still depend on its resolved state. Repair retains its completion/error result for these dependencies; it does not always return undefined at issuance. Earlier captures retain old metadata and native work keeps its actual reservations, so post-repair queries and independent siblings can proceed while overlapping host access still waits. Invalid selection or supported preflight/publication failure preserves both stores, including pending earlier publications. Successful repair changes neither bindings nor native authority. Returning undefined means repair completed; independent ordinary Error data may remain. A rejected context import has no recovery baseline and cannot be repaired into a valid context. Never clear ordinary managed Error data without recovery or erase unrelated failures.

#### Repair-and-call preflight

Repair-and-call remains a combined ordered operation. Its declared repair scope determines binding recovery and covered metadata even when the receiver is deeper. Preflight only structural route, mutation scope and readonly capability before clearing; successful metadata selection does not authorize a dynamically selected host call. Method-name checks, including constructor and unsupported Array names, receiver category/dispatch, argument processing, member resolution and invocation follow committed repair through the ordinary call path. Their failure can replace the cleared poison with new call poison; it does not roll back repair. Failed repair returns its causal Error and suppresses invocation, preserving the prior graph poison/recovery state. After repair commits, call preparation and invocation follow ordinary failure rules and live authority checks under the original operation's ordering. Composing existing transitions cannot discard a repair failure or defer the call's issuance position behind later work. The live check still rejects any retained noncanonical root, intermediate identity or receiver first registered while work waited; a rejected duplicate context cannot revoke a valid binding. A later call failure does not restore deliberately cleared poison. [External metadata architecture](external-context-ordering.md#poison-and-repair) owns the version, publication and lifetime protocol. Structural route uses the consumed path, provenance and fixed resource tree; it never classifies the hidden recovery value. A restored receiver's availability and value-revealed authority are ordinary post-repair call work.

#### Terminal alias placement

For a managed placement P.m.alias holding a resource registered at P.a.api, a metadata-only query or repair that ends at the alias operates on the managed placement. A healthy external identity is opaque there: getErrors returns null and hasError returns false. Placement or earlier-prefix poison follows ordinary query rules and preserves its original Error. Repair restores the placement's retained baseline, or is a no-op when healthy; an unrecoverable Error keeps its ordinary behavior. Neither operation reads native properties, inspects/clears canonical resource poison, creates a reservation merely for the inert identity, or grants resource authority.

Continuing through that alias into the resource, such as P.m.alias.x, is an off-path resource selection and returns ExternalLocationConflict before host access, subject to earlier-poison precedence. A native call at the alias also remains forbidden even though its receiver path ends there. Repair-and-call at a poisoned terminal alias restores that placement first, then its ordinary receiver-authority check fails with new local ExternalLocationConflict poison and no native call. Detecting this alias requires the restored value, so it is not structural preflight and must not inspect or wait for the hidden baseline. Repair grants no native authority. Earlier failures while selecting an unreachable target remain pre-repair failures. Direct canonical selection at P.a.api still queries or repairs canonical resource metadata. Determine this boundary from the consumed route and whether the operation consumes the placement or the resource; identity equality alone grants neither authority nor a reason to reject a terminal placement query.

### Identity and hidden state

- One mutable host resource must have one external identity. Do not expose the same resource through multiple wrappers or roots with overlapping independent access lifetimes. Sequential reuse across executions follows the [host exclusion contract](#external-reuse-across-executions).
- Cascada does not scan external graphs for aliases or shared descendants. Hidden access to another mutable external owner's state, including read-only access through a wrapper, violates the single-owner ordering contract.
- Application code must not independently mutate or replace external state while Cascada may access it.
- Mutation-capable external APIs should be stable context resources, such as databases, web services, or LLM clients. Do not move, replace, or delete their original context binding after initialization.
- A retained reference to admitted managed data grants native methods no permission to inspect or mutate its raw storage. Managed data supplied to native code uses the normal explicit argument export boundary. Runtime property observation through such a reference uses logical snapshot reads, not arbitrary native dereferencing. Merely returning an inert managed reference preserves its prepared logical value and pending obligations under the [method-result contract](#method-results). Cascada does not inspect closures, private fields, or unrelated native properties to find hidden references.
- Observation-only external property reception follows the [approved classification rule](#classification-and-declarations) and ordinary import preparation; existing admission and binding facts are never overwritten. Reading inside mutable external state copies managed portions and preserves permitted observation-only external leaves, including native classes with private or internal state. A copied managed class must satisfy its declared state and method contract; a class is never made managed merely because copying its enumerable properties appears possible.
- Exact external leaves must satisfy the observation-only host contract even when reached inside a snapshot. A host must not expose a live mutable child as such a leaf and later mutate it through its parent. Registered capabilities are rejected; hidden mutable overlap remains the documented host responsibility, without alias scans or automatic new registrations.
- Managed state may contain external identities, subject to the opaque-leaf managed-method rule above.

### External operations

- An external observation must not mutate its receiver.
- An external mutation may mutate only state owned by its selected registered external scope. A path crossing managed storage cannot regain native mutation authority at a later external descendant; writes, deletes, and mutating calls through that route fail without touching native state. A native receiver inside that scope uses its ordering; a managed ancestor or separately owned external sibling remains outside it. Exact external arguments grant no mutation authority and remain read-only; exported managed argument copies are independent host data.
- A property read crosses into Cascada through ordinary import when the external state is observation-only. A read inside mutable external state instead snapshots managed data and preserves only permitted exact external leaves under the receiving contract. A property write crosses into external code and its value is exported first.
- The detached managed portions have the same visible graph-copy semantics as export: they preserve Arrays, aliases, cycles, admitted prototypes, and Functions and may expose supported managed methods without exposing mutable source storage. For fresh managed-shaped data, copy own enumerable string-keyed data properties (canonical indexes for Arrays); ignore ordinary property accessors without invoking them. Availability recognition is separate: snapshot capture may read a fresh value's native `then` getter to recognize a thenable, but never invokes its callable `then`. Selecting a property on an external receiver can also invoke that receiver's getter. A Promise returned directly by the selected property may resolve before copying, but traversable snapshot data must contain no Promise. Opaque external interiors are not traversed.
- An admitted managed source contributes its logical properties and Array structure, including ready placement-version values, rather than its physical storage. Every required nested value, placement presence, Array length and property order must be ready during capture. An unresolved logical property, managed data gate, undecided presence, or unresolved Array length produces `InvalidExternalSnapshot`, just like a nested host thenable; capture does not subscribe to or wait for those data dependencies. An undecided logical placement cannot be skipped because it has no physical slot or lies beyond the known minimum length. Ready logical length remains authoritative even above physical storage, preserving trailing holes. This ready-data restriction also applies when continuing a property path through an admitted managed source. Use ordinary managed operations when pending managed data must be consumed.
- Ready snapshot data may still have an unresolved managed identity partition. This is valid input: complete data/Error capture and release the external observation reservation and source references. Lookup immediately admits detached managed copies with fresh identities whose alias decisions follow the captured publication cells. Managed access waits only for dependencies required by the selected operation: `at(0)` can return an available object and `includes(7)` can finish on a known match despite unrelated pending aliases. Complete native export still waits for a fixed alias partition and transfers canonical copies without admission. A lone key or already fixed partition needs no wait. Data failure does not wait for identity. Later native work can proceed after capture, and neither route rereads its source.
- Calls selecting a managed snapshot receiver perform method selection and required argument validation before native alias assembly, including controlled Array range and output-length validation from captured shape. A determined call failure does not wait for an otherwise irrelevant identity decision. Controlled methods consume ordinary managed copies; successful native invocation still receives canonical aliases and detached storage.
- A managed parent is retained through ordinary sharing and COW, without reading or copying its external interiors. Opaque external references remain inert without authority at the new location. Access through another location fails before host work, and export rejects a mutable external capability wherever it occurs in traversable data.
- Method results use the [preservation and fresh-input admission rules](#method-results), not the mutable-property snapshot rule. A host method that returns an object to become managed must relinquish mutation of that identity or return a detached copy. Merely snapshotting a different observation does not make a managed source safe for native mutation.
- External Arrays and native collections use this host-method contract, not the controlled managed Array algorithms. Mutation mode must match the native method's effects. Inside mutable external state, a method returning its exact receiver is rejected, including native `reverse` or `sort` in mutation mode; completed effects remain and result rejection leaves the selected scope healthy. A shallow result such as `slice` over mutable object elements is not detached: use a host method that returns an independent graph, relinquish the returned storage, or read a property snapshot. Cascada does not insert automatic callback export or borrowed-result copying into arbitrary native methods. A genuinely observation-only external receiver may return itself unchanged; it remains read-only and gains no authority.
- Assignment and deletion are mutations even without `!`; their default mutation scope is the exact target placement. An explicit ancestor `!` broadens that scope. External scope selection uses the selected registered tree node; a mixed managed ancestor is invalid and becomes guarded poison before native work.
- Replacing `ctx.db` changes a managed placement even when its old value is external. Changing `ctx.db.name` is an external property operation when `ctx.db` is external.
- Native Array length assignment must preserve registered indexes, including when the selected mutation scope is an ancestor of the Array. A rejected truncation leaves native storage unchanged and poisons its selected scope; repair restores access. Ordinary managed index appends and length growth remain allowed, but an Array-wide bang such as push cannot cover registered mutable resources.
- A native setter must finish synchronously.
- All mutations inside one mutable external owner are exclusive across its entire native graph. Assigning resource.a = pendingValue reserves that owner before waiting for the value, finishes export and the native write, and only then releases the phase. A later write or read of resource.b waits even though b is unrelated. Consecutive observations after that mutation may overlap; the next mutation waits for all of them. No native property receives a runtime gate or Promise placeholder, and the ordinary assignment return still signals issuance rather than completion.
- Inside external state, intermediate path values must be ready native values. Cascada never awaits a Promise to continue a native property path or obtain a method receiver/callable. Only the final value read by lookup, or the direct result of an invoked method, may be a Promise; its result boundary consumes that Promise before import or snapshotting. A Promise nested inside the final snapshot graph remains invalid.
- Native property lookup, assignment, and deletion are supported under their ordinary authority and ordering. For external `x`, looking up `x.promiseProperty` may consume that final Promise, and `x.promiseProperty = value` or `delete x.promiseProperty` replaces or removes the property without reading or consuming its old value. Traversing `x.promiseProperty.y`, including assigning or deleting `y`, fails without subscribing to the intermediate Promise. Assignment exports the new value before the native write; it never installs a Cascada Promise version in external storage.
- An authorized external mutation may leave completed effects when its method, setter, or Proxy trap throws or rejects. Failure poisons the selected mutation scope; it does not roll back those effects. The managed-storage Proxy restriction does not apply inside an opaque external identity.
- External mutation authority is never transferred through lookup, assignment, an argument, export, storage, or return.

### Entry

Entry supports Cascada reference arguments and delayed control flow. It may select a mixed branch and grants no exception to mutation scope rules. Mutating managed entry gates its selected placement, using ordinary ancestor COW where necessary; entering a.x does not block a.y. It also reserves exclusive access to any external descendants. Managed read-only entry leases its captured value. Every read-only entry, including one rooted at an external scope, reserves observation access to covered external resources; other observations overlap and later mutations wait. Entry itself is not a rollback transaction: each contained managed mutation has its own baseline and earlier completed operations remain committed.

Entry preserves placement presence and record own-key order. A no-op callback creates no property, hole fill, or logical growth. Protection does not resize backing storage; imported storage stays unchanged. Element creation commits growth even while its entry stays open; subsequent deletion or repair to absence does not shrink it. See [structural publication](enter.md#structural-publication) for the ordering of Array effects. Readonly entry registers no growth. Entry captures the narrowest directly selectable managed placement or statically selected registered external scope. Unavailable, missing, primitive, poisoned, intrinsic, or unreadable suffixes remain a relative path on that reference. Its protection anchor stays fixed. Resolve preceding placement transitions and external predecessors before callback activation, but do not await ordinary pending data just to select an unused suffix. Supported inspection failure stops optional discovery without creating poison; contained commands consume and validate their destinations at their own operation contexts.

Entry may select a poisoned managed or external target so its callback can inspect, repair, or replace that target through ordinary permitted operations. Recovery state stays attached to the selected placement and transfers with the entered root; it is not attached to the Error. Poison on a strict ancestor prevents reaching the target. Read-only entry permits inspection but grants no repair or mutation permission.

The compiler passes the requested entry path and its original firstDynamicSegment. Runtime capture and rebasing preserve that provenance; no compiler-side selector or native leaf reflection is required. A no-op callback does not consume its suffix or trigger native poison/binding checks. Actual contained access retains every static-resource, capability, poison, and repair restriction.

Contained operations run through the entry's reservation view and cannot wait behind later outside work already waiting for that entry. Nested entries retain their own completion after parent callback closure. Closing the callback stops new issuance, not already-issued effects. Managed root publication is independent of external descendant completion, so ready managed siblings remain usable while a native child is pending. Reference arguments to Cascada functions use this same mechanism; host-native arguments retain their separate export contract.

### Repair

A scope's own poison blocks its descendants. Child poison blocks operations consuming the whole ancestor subtree, but leaves healthy siblings usable; it creates no duplicate ancestor-owned poison. [Contextual queries](#contextual-error-collection) collect the selected canonical metadata alongside visible managed poison without reading native properties or hidden recovery values.

Repair-only uses ordinary managed placement ordering and ordered external metadata publication without a host reservation of its own. It clears selected managed scope poison to expose its preserved pre-operation value/version, and unconditionally resets the covered external metadata subtree without changing native state or waiting for earlier native poison outcomes it overwrites. Successful repair returns undefined and invokes no native method or external-resource read/write. A healthy or absent managed target requires no managed change; an ordinary Error without a retained baseline returns that exact Error unchanged and blocks repair-and-call. Strict-ancestor own poison blocks selection; derived external summaries do not block repairing their child. It does not traverse or erase ordinary Error data or independent earlier managed failures within the retained baseline.

Managed repair restores the baseline and removes its poison in one placement transition. Required fallible selection, preparation and publication precede commit; supported failure preserves the entire prior managed and external state and never poisons a healthy external owner. Complete managed and metadata updates before dependent access resumes. Invalid canonical authority or traversal through an off-path alias into a registered resource uses ExternalLocationConflict; a computed canonical metadata path is valid. Repair at the managed alias placement itself remains ordinary local recovery and grants no canonical authority; the [terminal-alias boundary](#terminal-alias-placement) distinguishes it from traversal and specifies the matching opaque-query behavior.

Repair-and-call performs the same clearing first, then ordinary call preparation and invocation under the same required managed/external ordering. A managed call captures its repaired baseline; failure cannot restore deliberately cleared poison. For external apis, apis!!.reset() clears child scope Errors before reset runs; a preparation error or thrown/rejected/direct method Error poisons again with new failure. Outside work cannot observe intermediate clearing under that protection. Entry may be mixed, but repair-and-call still obeys ordinary mutation-scope restrictions.

Repair does not expose the failed managed working receiver: that state was discarded when its operation failed. Captured earlier values and returned Errors remain unchanged. Final replacement/deletion of a replaceable managed location can discard scope poison and its baseline; fixed resource namespaces cannot be replaced or deleted. Repair creates no authority, changes no registered identity or tree structure, and reverses no external effects. Cascada code may modify the restored state afterward; higher-level guard/recover owns rollback across multiple operations.

## Boundary values and external code

Host data entering Cascada's language graph is imported. Data leaving the graph for host JavaScript is exported. A synchronous scalar callback result used only to control its operation is validated by that callback's contract instead of entering the graph.

- Import is used for host roots, supported host-call and callback results that enter the graph, external-property reads, and later Promise fulfillment from those boundaries.
- Export is used for native-call arguments, controlled callback inputs, external-property writes, and script results.
- External identities reached as graph leaves or selected query roots stay opaque. Selecting an observation-only external property imports its value under the [normal category rules](#classification-and-declarations) for lookup, export, `hasError` and `getErrors`, just as a method result is imported. Import does not make an undeclared class instance managed. Queries may await that value and its required graph data; getter/import poison is reported normally. Querying the external root alone does not inspect its contents.
- Registered mutable-resource queries remain metadata-only: contextual `hasError` and `getErrors` observe captured runtime-owned poison versions at their ordered position, without reading native properties or extracting the capability. A healthy scope yields `false`/`null`; a poisoned scope yields `true`/its original Error. Ancestor contextual queries include accessible descendant scope Errors. A poisoned guard is terminal: its retained children are recovery state and are not traversed. Ordinary copied aliases gain no live scope-query authority. To query native data inside mutable state, first read its property snapshot into a managed holder. Export of a selected mutable property likewise snapshots its value.
- Exported managed records, Arrays, and class instances are independent host data. Class copies preserve their admitted prototypes without running constructors. External code may mutate or retain the copies without changing their Cascada sources.
- Functions and external identities cross exactly. External code must treat them as read-only unless the exact external identity is independently covered by the active receiver mutation scope.
- Export consumes poison at any depth. If any argument or assigned value contains poison, external code is not called and no poison crosses the boundary. Ordinary native Errors remain healthy data.
- External code may retain exported copies. It must not retain access to an unexported managed receiver or source.
- Host methods, accessors, controlled callbacks, and reflection hooks must not synchronously re-enter the same execution. Attempted same-execution re-entry is fatal because the outer transition has not yet published an ordering point. A host function may start a script under a separate execution, while compiler-controlled script calls and recursion remain internal work and do not enter the external-action boundary. Trusted runtime control-flow callbacks such as `enter` follow their explicit gate/lease and closure contracts instead.
- A direct result Promise may keep using its receiver and exact external inputs until it settles. A nested result Promise does not extend that authority, though it may carry an exact external identity as inert result data. The managed structure of exported copies may outlive either Promise; exact external leaves gain no later authority.
- A direct host Promise must not depend on a nested Cascada operation ordered behind that call's active managed gate or external phase. Such a dependency is a self-wait and is invalid host behavior.
- Compiler-controlled entry callbacks use captured references for their observation and mutation dependencies. An operation issued after suspension through an unrelated outside Chain keeps its later issuance position. If it waits behind a mutation whose exported arguments depend on the entry's completion, those dependencies form a cycle. Capture the required references before suspension and use their entry views; [coordinated reference selection](enter.md#multiple-reference-arguments) remains a compiler-integration obligation. The current single-path API does not reserve unrelated references automatically.
- A callback invoked by a controlled method must complete synchronously and must not return a Promise. It receives only its declared exported inputs and may not access an unexported managed source.

## Choosing a representation

- Use a record for ordinary managed data without inherited behavior.
- Use a managed class when state needs application-defined methods or when large records would be copied frequently.
- Use a logical Array only for indexed data and supported controlled methods.
- Use external state for live host resources, native objects, APIs, databases, streams, handles, and state that Cascada cannot fully own.
- Keep immutable values external when they need native identity or unsupported internal state, such as a `Date` used only as a value.
