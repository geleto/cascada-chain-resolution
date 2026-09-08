# Managed Invocation Architecture

## Causal completion

Receiver preparation and argument export complete their entire required Error frontier before invocation. A direct method Error poisons the receiver with `InvocationFailed` whether returned, thrown, fulfilled, or rejected. Importing an independent successful result graph is a separate boundary: its `ImportReflectionFailed` outcome does not discard valid receiver mutation. The direct host-result continuation makes this decision before result import. A prototype accessor safely detected before invocation returns `InvalidManagedReceiver`. Operation resources close through the common idempotent owner transition after final call completion; a component finishing preparation does not close sibling collection.

Developer-facing restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document describes the common invocation boundary for managed records and managed class instances.

## Principle

Managed records and classes use one invocation lifecycle. Category-specific code selects a method; common code owns preparation, argument export, invocation, mutation publication, result admission, and cleanup. Managed behavior remains concentrated at this boundary and adds no special path, lookup, assignment, refcount, or Promise-mirror behavior.

The caller selects observation or mutation mode. An observation method must not mutate its receiver; any method that may do so must run as a mutation.

Observation immutability is a trusted contract, not runtime enforcement. A violating write may affect live state when no materialization was needed or only a discarded working copy when materialization occurred; both behaviors are unsupported.

## Method selection

Method reflection happens once, after receiver and argument preparation succeeds and before mutation isolation.

- A record method is an own enumerable string-keyed placement whose prepared logical value is a Function. Accessors, non-enumerables, inherited properties, non-Functions, and extracted Functions are not record methods.
- A class method is a Function-valued data property found on the admitted prototype chain up to, but excluding, `Object.prototype`. An own record placement with the same name hides it. Unrelated prototype accessors are permitted but are not Cascada methods and are never invoked by method selection. Class declaration rejects a callable or accessor `then` so a copied instance cannot be assimilated only on an asynchronous result path. If method selection reaches an accessor or later detects an unsafe `then` or another invalid prototype change before invoking external code or publishing state, the call returns `InvalidManagedReceiver` and preserves the original receiver. The violation is fatal only after it has made runtime state or ordering untrustworthy.
- `constructor` is never callable.

Nested calls such as `this.increaseBy(1)` are ordinary JavaScript calls on the prepared receiver, not nested Cascada invocations.

## Call lifecycle

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

Preparation consumes the complete receiver graph because method code may read any state through `this`. Capture candidate keys and validate their placement descriptors before consuming their values. A failed descriptor contributes its causal Error without hiding other known keys; failed key-list reflection ends only that inaccessible interior. It resolves every reached Promise through its captured property version, including Promises revealed by fulfillment, and collects every reached contextual Error. Aliases and cycles are preserved. Imported storage may retain a physical Promise or native Error while the working receiver exposes its logical value.

Every traversable receiver identity is leased while preparation may resume reading it. Readiness comes from each normalized preparation or result transition, not from whether its callback populated preparation state. A synchronous observation releases the leases after result admission. An actually pending direct-result observation retains them through settlement so a later Cascada mutation uses COW without waiting. A mutation releases receiver-source leases immediately before isolation; its isolated receiver is then private. The separate `receiverReached` fact remains necessary: a receiver may already be selected even when the invoked method's independent result is pending.

Observation materialization copies only paths needed to expose logical storage. Both fixed overlays and Promise mirrors can make a physical slot differ from its prepared logical value. Materialize the affected containers and ancestors while preserving aliases and cycles; do not resubscribe to the physical thenable. Receiver leases protect reused children for the call; only identities retained by the imported result become permanently shared.

Arguments cross the host boundary through one `exportManyValues` operation. Managed argument graphs are independent copies with aliases, cycles, Array structure, and admitted prototypes preserved across argument positions. Functions and external identities remain exact. Receiver and argument identities are not cross-remapped, and managed invocation adds no argument-source leases after export capture.

## Mutation isolation

Direct JavaScript mutation must not change protected managed state or invalidate operational bookkeeping. Isolation therefore copies:

- the receiver root when the owning path transition already requires its old value to survive;
- any reached identity requiring ordinary COW;
- any reached refcount-indexed identity;
- any identity owning a placement version, fixed or Promise-backed; and
- any logical Array requiring materialization.

Refcount indexing is downward-closed. An indexed identity cannot be mutated in place because arbitrary JavaScript changes bypass edge deltas, parent links, counters, and cycle cuts. Publishing a fresh identity through an ordinary placement transition is what makes the replacement visible to existing bookkeeping.

The isolation walk inspects each reached identity once before any required complete-subgraph copy. A qualifying identity is replaced with a complete graph copy that preserves aliases, cycles, admitted prototypes, sparse Array structure, Functions, and exact external leaves. The walk continues through nonqualifying identities to find qualifying descendants. If a copied subgraph reaches an ancestor, that ancestor is copied too. Copies reconnect through ordinary placement replacement, materializing a retained parent when its representation cannot accept the replacement. No receiver copy is allocated when nothing qualifies.

After invocation, one complete walk admits newly created identities and rejects any Promise or Error left in the receiver. Exact reflection failures join the same validation accumulator; they discard neither earlier Errors nor accessible later siblings. Before admitting a new object or accepting a managed identity already admitted before the call, inspect its native `then` lookup through own descriptors and the actual prototype chain. A callable data property or accessor produces `InvalidManagedReceiver`; never invoke the accessor or subscribe to a stored thenable during validation. This check includes non-enumerable own properties and Array non-index properties, while Error collection and admission still traverse only language placements. A known managed identity with unsafe `then` still contributes Errors from its other placements. Exact Functions and external leaves follow the successful-value host contract in [`data-limitations.md`](data-limitations.md).

A clean receiver is published through the ordinary mutation transition. A receiver-validation failure poisons the receiver. If independent result import also failed, combine its already discovered Error with the receiver failures for the operation result, preserving every leaf's cause, source, and kind. Result-import failure alone leaves valid receiver mutation intact. Direct method-result consumption does not weaken this completed-receiver contract. No pre-call identity history, changed-property set, active-lease scan, result-provenance map, or managed-specific refcount state is kept.

## Results and direct Promises

Every managed result is imported without deep-copying it. An observation uses ordinary import. A mutation returning its working receiver returns the published receiver. Every other mutation uses managed mutation-result import: it traverses even an already admitted managed root and marks every reached managed identity shared. A mutation can move a result descendant onto a shorter receiver path, where sharing only the result root would not protect it. Managed mutation-result import protects that descendant without result-provenance state. Its cost is one identity traversal of the non-receiver mutation result.

Managed operation results have shape `T | PoisonError | Promise<T | PoisonError>`. Required completion publishes the logical outcome and returns or fulfills with its ordinary Error. Only a result extracted for an expression uses rejecting transport through `lookupPathForExpression`.

A Promise nested inside a synchronous result is ordinary imported data and does not extend the call. A possible Promise returned directly by the method is consumed through the common helper; a sync-first custom outcome continues the call directly, while a returned pending chain is the call completion:

- An observation keeps its receiver leases until settlement. Fulfillment imports the value; rejection leaves the receiver unchanged and preserves an existing contextual failure or wraps a raw reason at the invocation boundary.
- A mutation keeps its private receiver behind the ordinary transition gate. Fulfillment imports the value, validates the receiver, and publishes one mutation outcome. Rejection contextualizes the same way and poisons the receiver with that occurrence.
- A direct Error is call failure whether it is returned, fulfilled, thrown, or rejected. An observation returns it; a mutation normally poisons its receiver with it after the defined graph effect.
- Any recoverable mutation failure normally poisons the receiver and becomes the operation result; pending transport fulfills with that ordinary Error only after the required graph effect is published. If replacing the receiver with an Error would remove a live external mutation-tree leaf, discard the private receiver, preserve the original managed state, and return the Error instead.

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
