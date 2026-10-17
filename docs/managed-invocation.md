# Managed Invocation Architecture

**Implementation status:** common preparation, parent indexing, bounded delivery, ownership and canonical receiver assembly are implemented. The [runtime evolution plan](runtime-evolution-plan.md#n2-method-result-validation-identity) records the remaining validation-copy identity gap. Private native mutation graphs acquire incoming relationships only after successful receiver validation or result adoption.

## Causal completion

Receiver preparation and argument export complete their entire required Error frontier before invocation. A direct method Error fails the selected mutation scope with `InvocationFailed` whether returned, thrown, fulfilled, or rejected. Importing an independent successful result graph is a separate boundary: its `ImportReflectionFailed` outcome does not discard valid receiver mutation. The direct host-result continuation makes this decision before result import. A prototype accessor safely detected before invocation returns `InvalidManagedReceiver`. Operation resources close through the common idempotent owner transition after final call completion; a component finishing preparation does not close sibling collection.

Developer-facing restrictions are centralized in [`data-limitations.md`](data-limitations.md). This document describes the common invocation boundary for managed records and managed class instances.

## Principle

Managed records and classes use one invocation lifecycle. Category-specific code selects a method; common code owns preparation, argument export, invocation, mutation publication, result admission, and cleanup. Managed behavior remains concentrated at this boundary and adds no special path, lookup, assignment, refcount, or Promise-version behavior.

The caller selects observation or mutation mode. An observation method must not mutate its receiver; any method that may do so must run as a mutation.

Observation immutability remains a trusted contract. Even though the receiver is copied, mutating it in observation mode would invalidate its inherited logical identity; such writes remain unsupported.

## Method selection

Method reflection happens once, after receiver and argument preparation succeeds and before mutation isolation.

Rejected selection, including an accessor method, follows the ordinary operation outcome: mutation poisons its selected scope and retains the baseline for repair; observation fails only its result. Selection never reports a successful receiver transition alongside its failure.

- A record method is an own enumerable string-keyed placement whose prepared logical value is a Function. Accessors, non-enumerables, inherited properties, non-Functions, and extracted Functions are not record methods.
- A class method is a Function-valued data property found on the admitted prototype chain up to, but excluding, `Object.prototype`. An own record placement with the same name hides it. Unrelated prototype accessors are permitted but are not Cascada methods and are never invoked by method selection. Class declaration rejects a callable or accessor `then` so a copied instance cannot be assimilated only on an asynchronous result path. Method selection rejects accessor methods with `InvalidManagedReceiver`. Post-admission prototype changes are unsupported and have no diagnostic or recovery guarantee.
- `constructor` is never callable.

Nested calls such as `this.increaseBy(1)` are ordinary JavaScript calls on the prepared receiver, not nested Cascada invocations.

## Call lifecycle

Receiver preparation and export share `managed-capture.js`: source-free records hold captured identities, admitted type/prototype, shape and resolved edges. A weak representation map bounds physical inspection; already equal keys share a record without suppressing any representation's required reads. Successful capture resolves its equality partition and assembles one shell per canonical key, then fills the captured edges. Both native modes copy the complete receiver. Observation copies inherit captured identity; mutation copies start fresh. No source-reuse checks, reverse ancestry, copy-selection flags or source rereads are needed.

The invocation coordinator owns separate receiver and argument captures and one Error collection. Both finish required value/Error collection before either starts identity resolution or assembly. An Error on either side immediately discards both sides' success-only state while required Error collection continues. A lone key or keys that have merged need no further publication wait. Receiver and argument batches remain separate alias domains. The shared copier leaves exported arguments unadmitted; receiver admission remains a native-call policy. Receiver validation stays separate because native code has produced new state. See the [assembly plan](runtime-evolution-plan.md#2-ordered-capture-and-assembly).

One operation context performs the call:

1. Select the managed boundary from the admitted receiver category, method name, and mode without reflecting on the method.
2. Prepare the complete receiver graph and export every explicit argument together. Continue both after language Errors to collect every required receiver and argument Error; after a fatal failure, either path simply returns at its next execution check.
3. Select record methods and class own-property shadowing from the canonical root's captured entries. Class methods still require lookup on the admitted prototype chain; neither mode rereads captured own placements.
4. Assemble a complete independent receiver from the canonical capture, with inherited identity for observation or fresh identity for mutation.
5. Invoke once with `Reflect.apply(method, workingReceiver, exportedArguments)`.
6. Import the result. Validate and publish a mutation receiver before its result becomes observable.
7. Release operation resources after their last possible access on every completion path.

Common [input reception](integration.md#immediate-reception-and-continued-use) prepares every fresh argument that the call consumes or provisionally retains, before a receiver wait, mutation-path traversal, or selected processing. Available structure establishes relationships to borrowed descendants; each direct pending-input callback protects delivery. Keep method selection and argument export receiver-first. Already prepared input skips repeat preparation. Mutating calls protect inputs before receiver traversal because an argument can borrow the receiver or its ancestors, including through a fresh wrapper. Dispatch may therefore reject after provisional preparation; unused inputs add no required wait or Error outcome. Ready observational rejection leaves arguments unconsumed. Release argument leases after export capture or another consumer accepts every remaining source dependency.

## Receiver preparation

A managed mutation scope cannot cover canonical registered mutable external locations. Scope selection checks the external tree at its context route. Independently, native managed receiver preparation rejects every registered mutable external identity reached in the complete receiver, including inert aliases outside that tree route: native code could access them through this. Observation-only external identities remain opaque leaves. Reject before invocation, preserving the selected value under owner-isolated scope poison where repair applies. An inert alias does not prohibit controlled managed writes to its containing graph, and entering a mixed branch grants no additional mutation authority.

Invocation uses the common [scope transition](error-handling.md#scope-transitions). Preserve each selected managed scope before its operation writes, not just fixed namespaces. Invalid mixed scopes are rejected before invocation and retain their unchanged baseline; valid managed scopes mutate isolated working state. No namespace-specific recovery path or failed-candidate reconstruction is required. External calls cannot modify managed namespaces.

Preparation consumes the complete receiver graph because method code may read any state through `this`. Capture candidate keys and validate their placement descriptors before consuming their values. A failed descriptor contributes its causal Error without hiding other known keys; failed key-list reflection ends only that inaccessible interior. It resolves every reached Promise through its captured property version, including Promises revealed by fulfillment, and collects every reached contextual Error. Aliases and cycles are preserved. Imported storage may retain a physical Promise or native Error while the working receiver exposes its logical value.

The common invocation boundary leases the selected receiver before argument preparation. Capturing its available placements and exact pending versions ends receiver-source access and releases that lease in both modes. Each later delivery captures its newly available structure synchronously under the ordinary input handoff. Pending work retains capture records and versions, not the former source containers. Path observation drops its source Chain after capturing the root placement; an independently pending argument or native result cannot retain that owner. Argument reception still protects its direct deliveries; mutation scope retention still protects its rollback baseline through publication. Neither lifetime is replaced by receiver capture.

Readiness comes from each normalized transition, not from whether its callback populated capture state. The separate `receiverReached` fact remains necessary: a receiver may already be selected while an independent native result remains pending. Native code uses the independent assembled graph through its direct result Promise. Later Chain mutations cannot change that graph and need no receiver-source lease for the call.

Each observation copy inherits its captured generation, including returned receivers, descendants and aliases inside wrappers. Inspect every required physical representation; equal keys share captured data, while distinct pending keys may converge before assembly. After complete Error collection succeeds, resolve captured Array lengths and the identity partition before allocating shells. Shape can remain pending after deletion removes its contributing placement. Allocate shells from resolved shape and admitted prototypes before filling edges to preserve aliases and cycles. Release records after assembly or failed selection. Pending preparation registers one cleanup with the invocation owner; preparation failure discards successful captures and releases their shape questions while complete Error collection continues.

Materialization copies remain private working storage and publish no incoming relationships merely for the observation. Result admission initializes any copy that escapes, including copies reached through returned aliases or cycles.

Arguments cross the host boundary as one batch through the shared capture and assembler. Managed argument graphs are independent copies with aliases, cycles, Array structure, and admitted prototypes preserved across argument positions. Functions and external identities remain exact. Receiver and argument identities are not cross-remapped, and managed invocation adds no argument-source leases after export capture.

## Mutation isolation

A managed mutation preserves its selected scope before invocation. Arbitrary JavaScript writes bypass path COW and graph bookkeeping, so the method's entire traversable receiver graph must be independent of the protected baseline. Use the existing complete-graph copy with aliases, cycles, admitted prototypes, sparse Array structure, Functions, and permitted exact external leaves. The scope above the receiver needs only ordinary path COW; rollback does not require copying unrelated descendants of the selected scope.

Complete receiver copying is an accepted graph-sized work/allocation cost for both native managed modes. Preparation finishes receiver and argument collection before method selection. The shared assembler creates independent invocation storage only after successful selection. It preserves permitted opaque external leaves exactly. Controlled mutations and entry retain their narrower COW/view mechanisms; they do not acquire this native-call copying cost.

The private receiver is invocation working state. Never mutate the retained baseline in place merely because it has no other public owner. Copying or preparation failure leaves the baseline unchanged and requires no failed-receiver reconstruction. Baseline retention continues through required publication, independently of completed source capture.

After invocation, one complete walk admits newly created identities and rejects any Promise or Error left in the receiver. Exact reflection failures join the same validation accumulator; they discard neither earlier Errors nor accessible later siblings. Before admitting a new object, read its `then` through the ordinary external-action boundary and reject a callable value as `InvalidManagedReceiver`, without subscribing. Errors and Functions retain classification precedence, and admitted identities retain their category. During the existing placement walk, use the common placement-value validator to reject a callable `then` placement with that same kind. A known managed identity with an invalid placement still contributes Errors from its other placements.

Native lookup safety outside language placements relies on the managed-data host contract, including stable prototypes and no unsafe hidden `then`. Receiver validation does not repeat descriptor or prototype-chain checks. Declaration and snapshot boundaries retain their prototype validation; a prototype substituted before admission must independently satisfy the same contract. Exact Functions and external leaves follow the successful-value host contract in [`data-limitations.md`](data-limitations.md).

A clean receiver is published through the ordinary mutation transition only after required validation and publication succeed. Method failure, receiver-validation failure, or failed required publication discards private working changes and poisons the selected scope while retaining its baseline. Receiver-validation failure combines every Error already collected during direct result admission into the operation result, including Errors inside an otherwise admitted result graph. Reuse that admission collection without rescanning the result or awaiting independent nested Promises. Receiver poison contains only its own failure. Result-import failure alone leaves a valid receiver mutation intact. Use the operation's captured baseline rather than an undo log, changed-property set, active-lease scan, or managed-specific refcount state.

## Results and direct Promises

Observations and non-receiver mutation results use common method-result import: it traverses even an already admitted managed root where result-boundary validation requires it. Returning the working mutation receiver selects its published logical value. Preserve all result uses through common capture and receiving lifetimes, including descendants arbitrary receiver mutation can detach from their former ancestors. A mutation prefix or external child does not change these ownership rules; no permanent result-sharing flag substitutes for actual retention.

Borrowing includes lazily admitted descendants of a managed source. Capture source placements before result-specific pending validation, and copy only affected containers and their borrowed ancestors. The staging identity map preserves aliases and cycles; unchanged branches stay shared. Raw Errors newly produced by native mutation still receive invocation attribution.

A borrowed pending placement preserves its publication transition separately from data availability. Publication fixes presence without awaiting the published value. The result's transition exposes its own validated version, so Array copying, replacement, and later repair cannot bypass result validation by following the source's value directly.

Managed operation results have shape `T | PoisonError | Promise<T | PoisonError>`. Required completion publishes the logical outcome and returns or fulfills with its ordinary Error. Only a result extracted for an expression uses rejecting transport through `lookupPathForExpression`.

A Promise nested inside a synchronous result is ordinary imported data and does not extend the call. A possible Promise returned directly by the method is consumed through the common helper; a sync-first custom outcome continues the call directly, while a returned pending chain is the call completion:

- An observation uses its independent receiver until settlement. Fulfillment imports the value; rejection leaves the managed source unchanged and preserves an existing contextual failure or wraps a raw reason at the invocation boundary.
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

[`../src/invocation.js`](../src/invocation.js) owns the common call transition and leases. [`../src/managed-invocation.js`](../src/managed-invocation.js) coordinates managed preparation, selection, receiver admission, validation, and result completion. [`../src/managed-capture.js`](../src/managed-capture.js) owns the shared source-free capture and assembly used by receivers and export. [`../src/run.js`](../src/run.js) only routes admitted managed records and classes to that boundary.
