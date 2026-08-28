# Managed Invocation Architecture

Developer-facing restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document describes the common invocation boundary for managed records and managed class instances.

## Principle

Managed records and classes use one invocation lifecycle. Category-specific code selects a method; common code owns preparation, argument export, invocation, mutation publication, result admission, and cleanup. Managed behavior remains concentrated at this boundary and adds no special path, lookup, assignment, refcount, or Promise-mirror behavior.

The caller selects observation or mutation mode. An observation method must not mutate its receiver; any method that may do so must run as a mutation.

Observation immutability is a trusted contract, not runtime enforcement. A violating write may affect live state when no materialization was needed or only a discarded working copy when materialization occurred; both behaviors are unsupported.

## Method selection

Method reflection happens once, after receiver and argument preparation succeeds and before mutation isolation.

- A record method is an own enumerable string-keyed placement whose prepared logical value is a Function. Accessors, non-enumerables, inherited properties, non-Functions, and extracted Functions are not record methods.
- A class method is a Function-valued data property found on the admitted prototype chain up to, but excluding, `Object.prototype`. An own record placement with the same name hides it. Class declaration rejects prototype accessors; a later accessor change is fatal.
- `constructor` is never callable.

Nested calls such as `this.increaseBy(1)` are ordinary JavaScript calls on the prepared receiver, not nested Cascada invocations.

## Call lifecycle

One operation context performs the call:

1. Select the managed boundary from the admitted receiver category, method name, and mode without reflecting on the method.
2. Prepare the complete receiver graph and export every explicit argument together. Continue both after language Errors to collect the required receiver-then-argument outcome; a fatal failure abandons operation-specific work in both.
3. Resolve and validate the method once from the prepared receiver or admitted class prototype.
4. Materialize an observational receiver when its logical representation cannot be exposed physically, or isolate a mutation receiver.
5. Invoke once with `Reflect.apply(method, workingReceiver, exportedArguments)`.
6. Import the result. Validate and publish a mutation receiver before its result becomes observable.
7. Release operation resources after their last possible access on every completion path.

If receiver selection is pending, the common coordinator registers on each root argument Promise. A traversable fulfillment is leased until selected preparation synchronously captures that root. This closes the interval before argument export can register its own ordered work without exporting or traversing arguments before receiver classification.

## Receiver preparation

Preparation consumes the complete receiver graph because method code may read any state through `this`. It resolves every reached Promise through its captured property version, including Promises revealed by fulfillment, and collects every reached Error. Aliases and cycles are preserved. Imported storage may retain a physical Promise while the working receiver exposes its logical value.

Every traversable receiver identity is leased while preparation may resume reading it. A synchronous observation releases the leases after result admission. A direct-Promise observation retains them through settlement so a later Cascada mutation uses COW without waiting. A mutation releases receiver-source leases immediately before isolation; its isolated receiver is then private.

Observation materialization copies only paths needed to expose logical storage. Its receiver leases protect reused children for the call; only identities retained by the imported result become permanently shared.

Arguments cross the host boundary through one `exportManyValues` operation. Managed argument graphs are independent copies with aliases, cycles, Array structure, and admitted prototypes preserved across argument positions. Functions and external identities remain exact. Receiver and argument identities are not cross-remapped, and managed invocation adds no argument-source leases after export capture.

## Mutation isolation

Direct JavaScript mutation must not change protected managed state or invalidate operational bookkeeping. Isolation therefore copies:

- the receiver root when the owning path transition already requires its old value to survive;
- any reached identity requiring ordinary COW;
- any reached refcount-indexed identity;
- any identity owning a live Promise mirror; and
- any logical Array requiring materialization.

Refcount indexing is downward-closed. An indexed identity cannot be mutated in place because arbitrary JavaScript changes bypass edge deltas, parent links, counters, and cycle cuts. Publishing a fresh identity through an ordinary placement transition is what makes the replacement visible to existing bookkeeping.

The isolation walk inspects each reached identity once before any required complete-subgraph copy. A qualifying identity is replaced with a complete graph copy that preserves aliases, cycles, admitted prototypes, sparse Array structure, Functions, and exact external leaves. The walk continues through nonqualifying identities to find qualifying descendants. If a copied subgraph reaches an ancestor, that ancestor is copied too. Copies reconnect through ordinary placement replacement, materializing a retained parent when its representation cannot accept the replacement. No receiver copy is allocated when nothing qualifies.

After invocation, one complete walk admits newly created identities and rejects any Promise or Error left in the receiver. A clean receiver is published through the ordinary mutation transition. No pre-call identity history, changed-property set, active-lease scan, result-provenance map, or managed-specific refcount state is kept.

## Results and direct Promises

Every managed result is imported without deep-copying it. An observation uses ordinary import. A mutation returning its working receiver returns the published receiver. Every other mutation uses managed mutation-result import: it traverses even an already admitted managed root and marks every reached managed identity shared. A mutation can move a result descendant onto a shorter receiver path, where sharing only the result root would not protect it. Managed mutation-result import protects that descendant without result-provenance state. Its cost is one identity traversal of the non-receiver mutation result.

A Promise nested inside a synchronous result is ordinary imported data and does not extend the call. One Promise returned directly by the method is the call completion:

- An observation keeps its receiver leases until settlement. Fulfillment imports the value; rejection remains the exact rejection and leaves the receiver unchanged.
- A mutation keeps its private receiver behind the ordinary transition gate. Fulfillment imports the value, validates the receiver, and publishes one mutation outcome. Rejection poisons the receiver while the operation result preserves the exact rejection.
- A fulfilled Error is an ordinary result and does not poison an otherwise valid mutation receiver.
- A receiver validation failure poisons the receiver and becomes the fulfilled operation result.

All asynchronous receiver or argument access must belong to the direct Promise and finish before it settles. Detached work, exposing a receiver or argument identity through a nested result Promise, and Cascada re-entry while supported user code is active are trusted contract violations.

## Managed-code contract

Managed class semantic state uses own enumerable string-keyed data properties. A managed method keeps mutable semantic state in `this`, receives other state through explicit arguments, and does not depend on mutable parent, closure, module, private-field, Symbol, non-enumerable, accessor, or internal-slot state. Method code does not change traversable prototypes, descriptors, or extensibility.

Managed code may inspect and mutate exported managed argument copies. Exact Functions and external identities remain read-only. An external identity nested in the receiver is an opaque leaf; explicit external access must use its own ordered operation rather than being hidden inside managed code.

## Implementation boundary

[`../src/invocation.js`](../src/invocation.js) owns the common call transition and leases. [`../src/managed-invocation.js`](../src/managed-invocation.js) owns managed preparation, selection, receiver materialization and isolation, validation, and result completion. [`../src/run.js`](../src/run.js) only routes admitted managed records and classes to that boundary.
