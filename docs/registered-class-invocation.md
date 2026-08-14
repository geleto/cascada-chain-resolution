# Registered-Class Invocation Architecture

## Principle

Registered classes are ordinary synchronous JavaScript classes that know nothing about Cascada. Keep registered-specific handling at their invocation boundary and reuse the common invocation lifecycle everywhere else.

## Prerequisite: common invocation

Before adding registered invocation, consolidate record, Array, String, registered, and opaque calls into one lifecycle. It owns method selection, input readiness and protection, invocation, ordered Error handling, mutation publication, result admission, and cleanup. The lifecycle also orders selection and failures. Each receiver category supplies its method-selection rules and rejects an unsupported mode with a validation Error. Replace `run`'s Array-specific mutation Boolean with a category-neutral observation-or-mutation request interpreted after receiver classification. Route every supported mutation through `transformProperty` and remove superseded paths.

Each invocation prepares only the inputs its category consumes. Before returning pending, lease every source record, Array, and registered instance retained by a continuation, adding leases as Promise resolution reveals identities. Release each lease after the last access, or after a returned host Promise settles when host code may retain it. Primitives need no lease; opaque identities use common ordering. Host calls consume every explicit argument, while controlled Array methods keep their per-method input selection.

A registered call consumes its complete receiver graph. A pending observation holds its receiver-source leases through result copying and admission; mutation preparation holds the same sources until receiver isolation begins. An Array observation leases its receiver only when a pending continuation will reread it. A String receiver is a primitive.

## Host identity lifetime

After a value has been passed to Cascada, application and host code must not mutate any exact identity that was reachable from it, including during an invoked method. The same rule covers identities reachable from an opaque invocation result. It follows the original identities, not copies Cascada later makes. Cascada may still mutate logical values through COW; an explicit opaque mutation may change its receiver only when this rule does not cover that identity. This is a trusted contract: Cascada neither tracks identity history nor copies solely to enforce it.

## Registered classes

All semantic state is exposed through own enumerable string-keyed data properties. Methods must not depend on own accessors, Symbols, non-enumerables, private fields, internal slots, or closure state. Registered dispatch selects methods from the prototype captured at admission and its inherited class chain up to, but excluding, `Object.prototype`. Registration rejects accessors on that same chain; application code must not later change the chain or its descriptors.

Registered state may contain primitives, records, Arrays, registered instances, opaque identities, Functions, aliases, and cycles. Ordinary graph operations may leave Promises or Errors there between calls. Call preparation resolves Promises and treats an encountered Error as call poison; methods receive neither in the receiver or consumed arguments, and a mutator may leave neither in its completed receiver. Because the complete receiver graph is consumed, any reached Error poisons the call and a mutation poisons its receiver placement.

Every method finishes synchronously and performs no work or input access after returning, including through a Promise, callback, or scheduled continuation. Its result cannot be or traversably contain a Promise. An observation does not mutate its receiver. No method may read or mutate externally mutable state, or retain an argument or receiver except through its receiver or result.

Methods may mutate their receiver graph through ordinary synchronous JavaScript, including nested class calls. They must not change a traversable identity's prototype, property descriptors, or extensibility.

Method-behavior restrictions are trusted class contracts except for the receiver and result validation specified below. Cascada does not snapshot descriptors, track later work, or add machinery solely to detect violations.

A mutation must not mutate an identity reached only from an argument at entry. It may store that identity in its receiver and mutate it in a later registered call, after isolation. If the argument already aliases receiver state at entry, the method may mutate the isolated alias without changing the original Cascada argument. For example, if `line.start === start` at entry, the method sees `this.start` and `start` as the same private copy. If `start` is not yet receiver state, `setStart(start)` may store it but must not mutate it during that call.

Opaque identities and Functions remain exact and may expose only immutable state. Registered methods must not mutate them or their ordinary, hidden, internal, or captured state; application code must not mutate that state after the identity enters registered state or a registered result.

Cascada may copy any record, Array, or registered instance reached through an argument or receiver before or after invocation. Copies preserve registered prototypes, Array structure, and aliases and cycles within each copied subgraph. Traversable identity is stable only during the synchronous call. Records may be copied in full; use immutable non-registered class instances for large opaque data.

## Call preparation

Prepare every explicit argument and the complete receiver graph in one operation-local state, preserving aliases and cycles across all materialized inputs. Recursively capture and resolve every Promise through existing property-version continuations, including Promises revealed by resolution. Invoke only after preparation succeeds, reusing common protection and opaque ordering.

For a mutation, lease every traversable identity reachable through any argument, including ready ones, through final receiver processing. Acquire these leases during the existing preparation walk. They protect pending inputs and are the only marker finalization needs: mark each retained actively leased identity shared before releasing the leases, using the same ownership rule as ordinary assignment. Do not collect argument identities separately or copy a value merely because it was an argument.

Prepare host-visible data from logical values, not physical Promise writeback. In arguments and observational receivers, copy only paths needed to expose a logical value that cannot be written back or to materialize an ArrayView as a native Array. Do not otherwise snapshot them. Mutation receivers use the isolation below.

An observation runs on its prepared receiver under the common lease, without a snapshot or transition gate. The lease protects it from concurrent Cascada mutation, not from a method violating the read-only contract. Pending mutation preparation uses the ordinary gate at the receiver placement and leases every traversable receiver source retained by its continuations.

## Receiver mutation

### Pre-call isolation

Before mutation, a reached record, Array, or registered instance requires isolation for one of three reasons: the existing `requiresCopyOnWrite` predicate says it is shared or actively leased; direct JavaScript mutation would invalidate a live Promise mirror or refcount index it owns; or its logical Array representation is an ArrayView or an Array attached to one. Sharing already covers import, and refcount indexing covers cycle cuts. Compose these existing facts in one dedicated predicate rather than testing the temporary import runtime-island predicate or arbitrary metadata keys.

Refcount indexing is downward-closed, so a receiver beneath an indexed ancestor is itself indexed. Registered code must not mutate an indexed identity in place: arbitrary JavaScript changes bypass property transitions, leaving its counters, parent edges, and cycle cuts stale. Copying abandons an isolated old index or reconnects a fresh identity through an ordinary placement transition, allowing indexed ancestors to process the replacement.

Use one metadata-free complete-graph copier for isolation and result copying. It preserves registered prototypes, aliases, and cycles; retains opaque identities and Functions exactly; and gives copies only admitted type and prototype facts. It represents every logical Array, including an ArrayView or an Array attached to one, as an unattached native Array with the same logical length, holes, and enumerable properties. Result copying forces the root through this copier with a separate map.

The isolation walk starts at the receiver and visits every reached identity once. At a qualifying identity, invoke the complete-graph copier and remap every occurrence. Continue through nonqualifying identities so qualifying descendants are still found. If a copied subgraph refers back to an ancestor, copy and remap that ancestor too. Reconnect a copy inside a retained original container through ordinary placement replacement, materializing when necessary; never use a raw property write that bypasses bookkeeping.

If the receiver root qualifies, copy the complete receiver because class code may mutate any descendant directly. Otherwise, copy only qualifying descendant subgraphs; allocate nothing if none qualify. Decide during the walk without a preliminary scan or size threshold. Property changes are not isolation conditions: isolation protects state that existed before arbitrary class mutation, while finalization handles ownership of values retained afterward.

### Mutation lifecycle

The mutation uses this sequence:

1. After preparation, release receiver-only preparation leases but retain all argument leases.

2. Walk the complete receiver with a fresh copy map to isolate existing state before arbitrary class mutation.

3. If that map is nonempty, scan the prepared arguments once. Replace a mapped argument root directly; materialize only paths to nested mapped occurrences. This preserves receiver-argument aliases and cycles without snapshotting unrelated argument data. If the map is empty, skip the scan and leave every argument identity exact.

4. Invoke the mutator once and synchronously, recording whether its raw result is the receiver.

5. With argument leases still active, walk the complete final receiver once. Reject any Promise or Error, admit new identities as runtime-owned, and mark each actively leased traversable identity shared; every other identity remains exact.

6. Return the final working receiver to `transformProperty` as the mutated value, then release the argument leases. Let `transformProperty` compare it with the captured receiver and publish any replacement caused by isolation. Never publish before final validation.

### Cost

Preparation, pre-call isolation, and finalization are three complete receiver traversals. They remain separate because preparation may suspend, isolation must use the protection state after preparation and receiver-only lease release, and finalization must inspect arbitrary class changes. Argument preparation leases each reached traversable identity once, and releasing those leases is linear in the reached argument graph. A nonempty isolation map adds one argument scan with allocation only along remapped paths. Finalization allocates no graph copy.

The pre-call walk allocates nothing only when no reached identity satisfies the isolation predicate. A cycle does not qualify by itself, but a copied subgraph that reaches an ancestor expands the copy to that ancestor. Operational metadata is identity-local: a copy begins with none, but placement into an indexed parent indexes it before publication. The fast path therefore depends on current graph history and placement; do not assume either that qualification persists or that copying clears it.

A non-`this` traversable result adds one complete result copy. No other copying is hidden in finalization.

## Results and failures

### Results

When a mutation returns its receiver, return the published receiver and let common completion mark it shared because the placement and result are separate owners.

Before common admission, pass every other traversable observation or mutation result through the complete-graph copier with a separate map. The result therefore shares no record, Array, or registered instance with the receiver or arguments. A newly retained traversable argument remains exact but shared in the receiver; returning that value or a receiver descendant produces an independent result graph. Only returning the mutation receiver itself avoids result copying. Copying is unconditional because selective reuse would require a separate result-provenance and ownership path.

### Failures

Reuse common failure handling. Preparation rejection, a prepared input Error, or a synchronous throw affects only an observation result; a mutation publishes the Error at its receiver through `transformProperty`. A Promise or Error in the completed receiver is a validation failure and is never published. A result that is or traversably contains a Promise instead returns an independent validation Error while a valid mutation publishes; Cascada neither awaits nor retains that Promise. Any other language failure confined to result copying, validation, or admission likewise affects only the result. Runtime invariant failures and host-contract violations exposed at an existing boundary remain fatal; do not add detection solely for trusted restrictions. A deliberately returned Error remains an ordinary result.

## Scope

Do not persist mutation or identity history or add defensive argument snapshots, registered-specific ownership state, or registered refcount rules. Reuse ordinary COW, readiness and protection, refcounting, Promise mirrors, import, opaque ordering, result admission, and mutation publication. After the prerequisite, registered-specific code is limited to common dispatch into one module for receiver and result preparation, copying, and validation.
