# Registered-Class Invocation Architecture

## Principle

Registered classes are ordinary JavaScript classes that know nothing about Cascada. Keep registered-class-specific handling at their invocation boundary and reuse the common invocation lifecycle everywhere else.

The caller's observation-or-mutation mode is a trusted assertion about the selected method. An observation method must not mutate its receiver; any method that may do so must be invoked in mutation mode.

[`managed-and-external-state.md`](managed-and-external-state.md) generalizes this boundary to managed class instances and managed record methods. That later architecture retains the receiver-isolation rules below but replaces registered argument handling with export and independent result copying with import and shared ownership.

## Prerequisite: common invocation

Before adding registered-class invocation, consolidate record, Array, String, registered-class, and opaque calls into one lifecycle. It owns method selection, input readiness and protection, invocation, ordered Error handling, mutation publication, result admission, and cleanup. The lifecycle also orders selection and failures. Each receiver category supplies its method-selection rules and rejects an unsupported mode with a validation Error. Replace `run`'s Array-specific mutation Boolean with a category-neutral observation-or-mutation request interpreted after receiver classification. Route every supported mutation through `transformProperty` and remove superseded paths.

Each invocation prepares only the inputs its category consumes. Before returning pending, lease every source record, Array, and registered instance retained by a continuation, adding leases as Promise resolution reveals identities. Release each lease after the last access. Exported host inputs release their source leases when export finishes; a managed direct Promise retains the prepared sources its method may still access. Primitives need no lease. External identities remain exact and require the identity phases and source-use validation supplied by the call boundary. Host calls consume every explicit argument, while controlled Array methods keep their per-method input selection.

After registered-class method selection succeeds, the call consumes its complete receiver graph. A pending observation holds its receiver-source leases through result copying and admission; mutation preparation holds the same sources until receiver isolation begins. An Array observation leases its receiver only when a pending continuation will reread it. A String receiver is a primitive.

## Host identity lifetime

After a value has been passed to Cascada, application and host code must not mutate any exact identity that was reachable from it, including during an invoked method. The same rule covers identities reachable from an opaque invocation result. It follows the original identities, not copies Cascada later makes. Cascada may still mutate logical values through COW; an explicit opaque mutation may change its receiver only when this rule does not cover that identity. This is a trusted contract: Cascada neither tracks identity history nor copies solely to enforce it.

## Registered classes

All semantic state is exposed through own enumerable string-keyed data properties. Methods must not depend on own accessors, Symbols, non-enumerables, private fields, internal slots, or closure state. Registered dispatch selects methods from the prototype captured at admission and its inherited class chain up to, but excluding, `Object.prototype`. Registration rejects accessors on that same chain; application code must not later change the chain or its descriptors.

Registered state may contain primitives, records, Arrays, registered instances, opaque identities, Functions, aliases, and cycles. Ordinary graph operations may leave Promises or Errors there between calls. Call preparation resolves Promises and treats an encountered Error as call poison; methods receive neither in the receiver or consumed arguments, and a mutator may leave neither in its completed receiver. Because the complete receiver graph is consumed, any reached Error poisons the call and a mutation poisons its receiver placement.

An observation does not mutate its receiver. A method may access its prepared inputs and, for a mutation, change its isolated receiver until its direct result settles. Every asynchronous access or effect must belong to work represented by that Promise and complete before it settles; detached work is forbidden. No method may read or mutate externally mutable state, or retain an argument or receiver except through its receiver or result.

Methods may mutate their receiver graph through ordinary JavaScript, including nested class calls, while their invocation is active. They must not change a traversable identity's prototype, property descriptors, or extensibility.

Method-behavior restrictions are trusted class contracts except for the receiver and result validation specified below. Cascada does not snapshot descriptors, track later work, or add machinery solely to detect violations.

A mutation must not mutate an identity reached only from an argument at entry. It may store that identity in its receiver and mutate it in a later registered-class call, after isolation. If the argument already aliases receiver state at entry, the method may mutate the isolated alias without changing the original Cascada argument. For example, if `line.start === start` at entry, the method sees `this.start` and `start` as the same private copy. If `start` is not yet receiver state, `setStart(start)` may store it but must not mutate it during that call.

Opaque identities and Functions remain exact and may expose only immutable state. Registered-class methods must not mutate them or their ordinary, hidden, internal, or captured state; application code must not mutate that state after the identity enters registered state or a registered-class result.

Cascada may copy any record, Array, or registered instance reached through an argument or receiver before or after invocation. Copies preserve registered-class prototypes, Array structure, and aliases and cycles within each copied subgraph. Traversable identity is stable only while the invocation is active. Records may be copied in full; use immutable non-registered class instances for large opaque data.

## Call preparation

Prepare every explicit argument and the complete receiver graph in one operation-local state, preserving aliases and cycles across all materialized inputs. Recursively capture and resolve every Promise through existing property-version continuations, including Promises revealed by resolution. Invoke only after preparation succeeds, reusing common protection and any selected external identity phases.

For a mutation, lease every traversable identity reachable through any argument, including ready ones, through final receiver processing. Acquire these leases during the existing preparation walk. They protect pending inputs and are the only marker finalization needs: mark each retained actively leased identity shared before releasing the leases, using the same ownership rule as ordinary assignment. Do not collect argument identities separately or copy a value merely because it was an argument.

Prepare host-visible data from logical values, not physical Promise writeback. In arguments and observational receivers, copy only paths needed to expose a logical value that cannot be written back or to materialize an ArrayView as a native Array. Do not otherwise snapshot them. Mutation receivers use the isolation below.

An observation runs on its prepared receiver under the common lease, without a snapshot or transition gate. The lease protects it from concurrent Cascada mutation, not from a method violating the read-only contract. Pending mutation preparation uses the ordinary gate at the receiver placement and leases every traversable receiver source retained by its continuations.

## Receiver mutation

### Pre-call isolation

Before mutation, the receiver root requires isolation when the ordinary mutation context must preserve it because an ancestor path was copied. Any reached record, Array, or registered instance also requires isolation when the existing `requiresCopyOnWrite` predicate says it is shared or actively leased, direct JavaScript mutation would invalidate a live Promise mirror or refcount index it owns, or its logical Array representation is an ArrayView or an Array attached to one. Sharing already covers import, and refcount indexing covers cycle cuts. Compose the identity-local facts in one dedicated predicate and pass the existing receiver-preservation decision separately; do not test the temporary import runtime-island predicate or arbitrary metadata keys.

Refcount indexing is downward-closed, so a receiver beneath an indexed ancestor is itself indexed. Registered-class code must not mutate an indexed identity in place: arbitrary JavaScript changes bypass property transitions, leaving its counters, parent edges, and cycle cuts stale. Copying abandons an isolated old index or reconnects a fresh identity through an ordinary placement transition, allowing indexed ancestors to process the replacement.

Use one metadata-free complete-graph copier for isolation and result copying. It preserves registered-class prototypes, aliases, and cycles; retains opaque identities and Functions exactly; and gives copies only admitted type and prototype facts. It represents every logical Array, including an ArrayView or an Array attached to one, as an unattached native Array with the same logical length, holes, and present indexes. Result copying forces the root through this copier with a separate map.

The isolation walk starts at the receiver and visits every reached identity once. At a qualifying identity, invoke the complete-graph copier and remap every occurrence. Continue through nonqualifying identities so qualifying descendants are still found. If a copied subgraph refers back to an ancestor, copy and remap that ancestor too. Reconnect a copy inside a retained original container through ordinary placement replacement, materializing when necessary; never use a raw property write that bypasses bookkeeping.

If the receiver root must be preserved or qualifies, copy the complete receiver because class code may mutate any descendant directly. Otherwise, copy only qualifying descendant subgraphs; allocate no receiver graph copy if none qualify. Decide during the walk without a preliminary scan or size threshold. Property changes are not isolation conditions: isolation protects state that existed before arbitrary class mutation, while finalization handles ownership of values retained afterward.

### Mutation lifecycle

The mutation uses this sequence:

1. After preparation, release receiver-only preparation leases but retain all argument leases.

2. Walk the complete receiver with a fresh copy map to isolate existing state before arbitrary class mutation.

3. Materialize the prepared arguments once for host representation, applying mapped receiver identities during the same walk. Replace a mapped argument root directly and copy only paths to nested remaps or representation mismatches. This preserves receiver-argument aliases and cycles without snapshotting unrelated argument data. An empty isolation map adds no isolation copy.

4. Invoke the mutator once. A synchronous result continues immediately. A direct Promise keeps the private mutation active behind its transition gate and continues with its fulfillment.

5. With argument leases still active, walk the complete final receiver once. Reject any Promise or Error, admit new identities as runtime-owned, and mark each actively leased traversable identity shared; every other identity remains exact.

6. Return the final working receiver to `transformProperty` as the mutated value, then release the argument leases. Let `transformProperty` compare it with the captured receiver and publish any replacement caused by isolation. Never publish before final validation. A direct-Promise rejection poisons this receiver transition and releases its leases.

### Cost

Preparation, pre-call isolation, and finalization are three complete receiver traversals. They remain separate because preparation may suspend, isolation must use the protection state after preparation and receiver-only lease release, and finalization must inspect arbitrary class changes. Argument preparation balances every lease acquisition after finalization, with release work linear in acquisitions. Argument materialization traverses its reached graph once and allocates only paths to remaps or representation mismatches. Finalization allocates no graph copy.

The pre-call walk allocates no receiver graph copy when no reached identity satisfies the isolation predicate. A cycle does not qualify by itself, but a copied subgraph that reaches an ancestor expands the copy to that ancestor. Operational metadata is identity-local: a copy begins with none, but placement into an indexed parent indexes it before publication. The fast path therefore depends on current graph history and placement; do not assume either that qualification persists or that copying clears it.

A synchronous non-`this` traversable result adds one complete result copy. No other copying is hidden in finalization.

## Results and failures

### Results

When a mutation directly returns its receiver, return the published receiver and let common completion mark it shared because the placement and result are separate owners.

Run common origin-aware result import on every synchronous result before passing each non-`this` traversable result through the complete-graph copier with a separate map. The registered-class result therefore shares no record, Array, or registered instance with the receiver or arguments. A newly retained traversable argument remains exact but shared in the receiver; returning that value or a receiver descendant produces an independent result graph. Preserve nested Promise placements without waiting. Only directly returning the mutation receiver itself avoids result copying. Copying is unconditional because selective reuse would require a separate result-provenance and ownership path.

A direct Promise keeps the call active and returns an operation Promise that applies normal result import and copying to fulfillment while preserving rejection. An observation leases every traversable receiver and argument identity until settlement, allowing mutation through another owner to proceed through COW. A mutation retains its argument leases and keeps its isolated receiver private behind the ordinary transition gate; its receiver-source leases have already ended at isolation. On fulfillment, validate and publish the receiver, returning the published receiver when the fulfillment is the working receiver. A Promise nested in a synchronous result is instead imported and copied as ordinary result data without extending the call.

### Failures

Reuse common failure handling. Combine prepared input Errors once, preserving every distinct original in receiver-then-argument order. Preparation rejection, a prepared input Error, or a synchronous throw affects only an observation result; a mutation publishes the Error at its receiver through `transformProperty`. A direct-Promise rejection has the same graph effect as a synchronous failure after invocation: an observation leaves its receiver unchanged, while a mutation poisons its receiver; both preserve the rejection as the operation outcome. A Promise or Error in the completed receiver is a validation failure and is never published. Failure confined to result copying or admission affects only the result. Runtime invariant failures and host-contract violations exposed at an existing boundary remain fatal; do not add detection solely for trusted restrictions. A deliberately returned Error remains an ordinary result.

## Scope

Do not persist registered-class mutation or identity history or add defensive argument snapshots, registered-class-specific ownership state, or registered-class refcount rules. Reuse ordinary COW, readiness and protection, refcounting, Promise mirrors, import, external identity phases, result admission, and mutation publication. After the prerequisite, registered-class-specific code is limited to common dispatch into one module for receiver and result preparation, copying, and validation.
