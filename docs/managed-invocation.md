# Managed Invocation Architecture

## Causal completion

Receiver preparation and argument export complete their entire required Error frontier before invocation. A direct method Error fails the selected mutation scope with `InvocationFailed` whether returned, thrown, fulfilled, or rejected. Importing an independent successful result graph is a separate boundary: its `ImportReflectionFailed` outcome does not discard valid receiver mutation. The direct host-result continuation makes this decision before result import. A prototype accessor safely detected before invocation returns `InvalidManagedReceiver`. Operation resources close through the common idempotent owner transition after final call completion; a component finishing preparation does not close sibling collection.

Developer-facing restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document describes the common invocation boundary for managed records and managed class instances.

## Principle

Managed records and classes use one invocation lifecycle. Category-specific code selects a method; common code owns preparation, argument export, invocation, mutation publication, result admission, and cleanup. Managed behavior remains concentrated at this boundary and adds no special path, lookup, assignment, refcount, or Promise-version behavior.

The caller selects observation or mutation mode. An observation method must not mutate its receiver; any method that may do so must run as a mutation.

Observation immutability is a trusted contract, not runtime enforcement. A violating write may affect live state when no materialization was needed or only a discarded working copy when materialization occurred; both behaviors are unsupported.

## Method selection

Method reflection happens once, after receiver and argument preparation succeeds and before mutation isolation.

- A record method is an own enumerable string-keyed placement whose prepared logical value is a Function. Accessors, non-enumerables, inherited properties, non-Functions, and extracted Functions are not record methods.
- A class method is a Function-valued data property found on the admitted prototype chain up to, but excluding, `Object.prototype`. An own record placement with the same name hides it. Unrelated prototype accessors are permitted but are not Cascada methods and are never invoked by method selection. Class declaration rejects a callable or accessor `then` so a copied instance cannot be assimilated only on an asynchronous result path. If method selection reaches an accessor or later detects an unsafe `then` or another invalid prototype change before invoking external code or publishing state, the call returns `InvalidManagedReceiver` and preserves the original receiver. The violation is fatal only after it has made runtime state or ordering untrustworthy.
- `constructor` is never callable.

Nested calls such as `this.increaseBy(1)` are ordinary JavaScript calls on the prepared receiver, not nested Cascada invocations.

## Call lifecycle

Receiver preparation and export share `managed-traversal.js` for complete managed-property capture and delivery. Preparation retains receiver leases and its own graph identity and Error state. Receiver validation shares only key capture: it reads existing versions or raw descriptors without consuming newly produced availability. Native snapshotting, selective receiver copying, and transactional admission retain their different traversal rules.

One operation context performs the call:

1. Select the managed boundary from the admitted receiver category, method name, and mode without reflecting on the method.
2. Prepare the complete receiver graph and export every explicit argument together. Continue both after language Errors to collect every required receiver and argument Error; after a fatal failure, either path simply returns at its next execution check.
3. Resolve and validate the method once from the prepared receiver or admitted class prototype.
4. Materialize an observational receiver when its logical representation cannot be exposed physically, or isolate a mutation receiver.
5. Invoke once with `Reflect.apply(method, workingReceiver, exportedArguments)`.
6. Import the result. Validate and publish a mutation receiver before its result becomes observable.
7. Release operation resources after their last possible access on every completion path.

If receiver selection is pending, the common coordinator consumes each possible root-argument Promise. A ready custom thenable retains its fulfilled identity synchronously; only a returned pending continuation is handled as detached work. A traversable fulfillment is leased until selected preparation synchronously captures that root. This closes the interval before argument export can register its own ordered work without exporting or traversing arguments before receiver classification.

## Receiver preparation

A managed mutation scope cannot cover canonical registered mutable external locations. Scope selection checks the external tree at its context route. Independently, native managed receiver preparation rejects every registered mutable external identity reached in the complete receiver, including inert aliases outside that tree route: native code could access them through this. Observation-only external identities remain opaque leaves. Reject before invocation, preserving the selected value under owner-isolated scope poison where repair applies. An inert alias does not prohibit controlled managed writes to its containing graph, and entering a mixed branch grants no additional mutation authority.

Invocation uses the common [scope transition](error-handling.md#scope-transitions). Preserve each selected managed scope before its operation writes, not just fixed namespaces. Invalid mixed scopes are rejected before invocation and retain their unchanged baseline; valid managed scopes mutate isolated working state. No namespace-specific recovery path or failed-candidate reconstruction is required. External calls cannot modify managed namespaces.

Preparation consumes the complete receiver graph because method code may read any state through `this`. Capture candidate keys and validate their placement descriptors before consuming their values. A failed descriptor contributes its causal Error without hiding other known keys; failed key-list reflection ends only that inaccessible interior. It resolves every reached Promise through its captured property version, including Promises revealed by fulfillment, and collects every reached contextual Error. Aliases and cycles are preserved. Imported storage may retain a physical Promise or native Error while the working receiver exposes its logical value.

Every traversable receiver identity is leased while preparation may resume reading it. Readiness comes from each normalized preparation or result transition, not from whether its callback populated preparation state. A synchronous observation releases the leases after result admission. An actually pending direct-result observation retains them through settlement so a later Cascada mutation uses COW without waiting. A mutation releases receiver-source leases immediately before isolation; its isolated receiver is then private. The separate `receiverReached` fact remains necessary: a receiver may already be selected even when the invoked method's independent result is pending.

Observation materialization copies only paths needed to expose logical storage. Both fixed overlays and Promise versions can make a physical slot differ from its prepared logical value. Materialize the affected containers and ancestors while preserving aliases and cycles; do not resubscribe to the physical thenable. Receiver leases protect reused children for the call; only identities retained by the imported result become permanently shared.

Arguments cross the host boundary through one `exportManyValues` operation. Managed argument graphs are independent copies with aliases, cycles, Array structure, and admitted prototypes preserved across argument positions. Functions and external identities remain exact. Receiver and argument identities are not cross-remapped, and managed invocation adds no argument-source leases after export capture.

## Mutation isolation

A managed mutation preserves its selected scope before invocation. Arbitrary JavaScript writes bypass path COW and graph bookkeeping, so the method's entire traversable receiver graph must be independent of the protected baseline. Use the existing complete-graph copy with aliases, cycles, admitted prototypes, sparse Array structure, Functions, and permitted exact external leaves. The scope above the receiver needs only ordinary path COW; rollback does not require copying unrelated descendants of the selected scope.

Full receiver isolation is an accepted graph-sized work/allocation cost for native managed mutating calls, including successful calls. Preparation already traverses the receiver; avoid materializing a complete graph only to copy it again when the same pass can supply independent working storage. Preserve permitted opaque external leaves by identity. Controlled mutations retain their narrower COW/view mechanisms. Measure copying and peak retention to catch redundant implementation work, not to make rollback conditional on receiver ownership.

The private receiver is invocation working state. Never mutate the retained baseline in place merely because it has no other public owner. Reuse an already independent receiver only when existing ownership facts establish complete isolation; add no copy-history or rollback-specific provenance mechanism. Copying or preparation failure leaves the baseline unchanged and requires no failed-receiver reconstruction. Existing observation materialization and its leases keep their separate purpose.

After invocation, one complete walk admits newly created identities and rejects any Promise or Error left in the receiver. Exact reflection failures join the same validation accumulator; they discard neither earlier Errors nor accessible later siblings. Before admitting a new object or accepting a managed identity already admitted before the call, inspect its native `then` lookup through own descriptors and the actual prototype chain. A callable data property or accessor produces `InvalidManagedReceiver`; never invoke the accessor or subscribe to a stored thenable during validation. This check includes non-enumerable own properties and Array non-index properties, while Error collection and admission still traverse only language placements. A known managed identity with unsafe `then` still contributes Errors from its other placements. Exact Functions and external leaves follow the successful-value host contract in [`data-limitations.md`](data-limitations.md).

A clean receiver is published through the ordinary mutation transition only after required validation and publication succeed. Method failure, receiver-validation failure, or failed required publication discards private working changes and poisons the selected scope while retaining its baseline. If independent result import also failed, combine its already discovered Error with the mutation failures for the operation result without losing cause, source, or kind. Result-import failure alone leaves a valid receiver mutation intact. Use the operation's captured baseline rather than an undo log, changed-property set, active-lease scan, or managed-specific refcount state.

## Results and direct Promises

Observations and non-receiver mutation results use common method-result import: it traverses even an already admitted managed root, enforces result-boundary restrictions, and marks every reached managed identity shared. A mutation returning its working receiver selects the published receiver and marks it shared when retained as output. A mutation prefix or external child does not change these ownership rules. A mutation can move a result descendant onto a shorter receiver path, where sharing only the result root would not protect it. The common result traversal protects that descendant without result-provenance state or a separate mutation-result policy.

Managed operation results have shape `T | PoisonError | Promise<T | PoisonError>`. Required completion publishes the logical outcome and returns or fulfills with its ordinary Error. Only a result extracted for an expression uses rejecting transport through `lookupPathForExpression`.

A Promise nested inside a synchronous result is ordinary imported data and does not extend the call. A possible Promise returned directly by the method is consumed through the common helper; a sync-first custom outcome continues the call directly, while a returned pending chain is the call completion:

- An observation keeps its receiver leases until settlement. Fulfillment imports the value; rejection leaves the receiver unchanged and preserves an existing contextual failure or wraps a raw reason at the invocation boundary.
- A mutation keeps its private receiver behind the ordinary transition gate. Fulfillment imports the value, validates the receiver, and publishes the successful mutation. Rejection contextualizes the failure, discards the working receiver, and publishes scope poison retaining the pre-operation value. Independent nested results do not extend this publication lifetime.
- A direct Error is call failure whether it is returned, fulfilled, thrown, or rejected. An observation returns it; a mutation publishes it at the selected scope after the defined graph effect.
- A recoverable mutation failure publishes scope poison and retains the pre-operation value in placement metadata, for ordinary managed scopes as well as fixed namespaces. Lookup, queries, and export observe the original Error until repair or permitted replacement. Repair reveals the baseline, never the partially modified working receiver. A successful controlled mutation with an independent Error result remains committed.

A synchronous method throw, explicit returned Error, direct Error fulfillment,
and direct-result rejection follow the same causal and graph-effect rules for
the failed call. A Promise nested inside a successful result is independent data;
its later Error does not poison an already published valid receiver. Later
operations preserve every contextualized Error's attribution.

Asynchronous receiver access and any inspection of a read-only exact external argument must belong to the direct Promise and finish before it settles. Detached access and receiver exposure through a nested result Promise are trusted contract violations. Exact observation-only external identities may be retained or returned inertly because this transfers no authority. The managed structure of exported argument copies may outlive the invocation; exact external leaves follow the same rule. Synchronous re-entry into the same execution is forbidden. A separate script execution may start immediately; independent work in this execution may start after the host call returns, but the direct host Promise must not depend on work ordered behind its active receiver gate or external phase.

## Managed-code contract

Managed class semantic state uses own enumerable string-keyed data properties. A managed method keeps mutable semantic state in `this`, receives other state through explicit arguments, and does not depend on mutable parent, closure, module, private-field, Symbol, non-enumerable, accessor, or internal-slot state. Method code does not change traversable prototypes, descriptors, or extensibility.

A method may create managed data backed by a Proxy only under the
[managed-storage contract](data-limitations.md#proxies-in-managed-storage).
The restriction on individual storage traps does not prevent a method from
mutating its working receiver and then throwing or rejecting; the ordinary
receiver-failure rules still apply.

Managed code may inspect and mutate exported managed argument copies. Exact Functions and external identities remain read-only. An external identity nested in the receiver is an opaque leaf; explicit external access must use its own ordered operation rather than being hidden inside managed code.

## Implementation boundary

[`../src/invocation.js`](../src/invocation.js) owns the common call transition and leases. [`../src/managed-invocation.js`](../src/managed-invocation.js) owns managed preparation, selection, receiver materialization and isolation, validation, and result completion. [`../src/run.js`](../src/run.js) only routes admitted managed records and classes to that boundary.
