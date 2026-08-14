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

All semantic state is exposed through own enumerable string-keyed data properties. Methods must not depend on own accessors, Symbols, non-enumerables, private fields, internal slots, or closure state. Registered dispatch selects methods from the prototype captured at admission and its inherited class chain. Registration rejects accessors on that chain up to, but excluding, `Object.prototype`; application code must not later change the chain or its descriptors.

Registered state may contain primitives, records, Arrays, registered instances, opaque identities, Functions, aliases, cycles, and Promises between calls. Methods receive no Promise or Error in the receiver or consumed arguments, and a completed mutation receiver may contain neither.

Every method finishes synchronously, and its result cannot be or traversably contain a Promise. An observation does not mutate its receiver. No method may read or mutate externally mutable state, or retain an argument or receiver except through its receiver or result.

A mutation must not mutate an identity reached only from an argument at entry. It may store that identity in its receiver and mutate it in a later registered call, after isolation. If the argument already aliases receiver state at entry, the method may mutate the isolated alias without changing the original Cascada argument. For example, if `line.start === start` at entry, the method sees `this.start` and `start` as the same private copy. If `start` is not yet receiver state, `setStart(start)` may store it but must not mutate it during that call.

Opaque identities and Functions remain exact and may expose only immutable state. Registered methods must not mutate them or their ordinary, hidden, internal, or captured state; application code must not mutate that state after the identity enters registered state or a registered result.

Cascada may copy any record, Array, or registered instance reached through an argument or receiver before or after invocation. Copies preserve registered prototypes, Array structure, and aliases and cycles within each copied subgraph. Traversable identity is stable only during the synchronous call. Records may be copied in full; use immutable non-registered class instances for large opaque data.

## Call preparation

Prepare every explicit argument and the complete receiver graph in one operation-local state, preserving aliases and cycles across all materialized inputs. Recursively capture and resolve every Promise through existing property-version continuations, including Promises revealed by resolution. Invoke only after preparation succeeds, reusing common protection and opaque ordering.

For a mutation, lease every traversable source argument identity, including ready ones, through final receiver isolation. If the method retains argument data in the receiver, the post-call walk therefore copies it before publication.

Prepare host-visible data from logical values, not physical Promise writeback. In arguments and observational receivers, copy only paths needed to expose a logical value that cannot be written back or to materialize an ArrayView as a native Array. Do not otherwise snapshot them. Mutation receivers use the isolation below.

An observation uses the common receiver lease and no transition gate. Pending mutation preparation uses the ordinary gate at the receiver placement and leases every traversable receiver source retained by its continuations.

## Receiver mutation

### Isolation walk

The pre- and post-call walks use the same isolation rule. A reached record, Array, or registered instance requires isolation when it is shared or actively leased, owns a live Promise-mirror placement, or is refcount-indexed. An ArrayView and an Array attached to one also require isolation. Sharing already covers import, and refcount indexing covers cycle cuts. Use one dedicated predicate for this rule rather than the temporary import runtime-island predicate or arbitrary metadata keys.

Each walk starts at the receiver and visits every reached identity once. When an identity requires isolation, copy it and its complete traversable subgraph with one copy map, remapping every occurrence to preserve aliases and cycles. Continue through identities that do not require isolation so qualifying descendants are still found. If a copied subgraph refers back to an ancestor, copy and remap that ancestor too; otherwise the copy could retain a reference to protected original state. Reconnect copies inside the working receiver without bypassing placement bookkeeping, materializing when necessary. Copies retain only admitted type and prototype facts.

If the receiver root requires isolation, copy the complete receiver. Otherwise, copy only qualifying descendant subgraphs; allocate nothing if none qualify. A qualifying root requires a full copy because arbitrary class mutation could change any descendant and invalidate the root's protected state or bookkeeping. Refcount indexes and live mirrors are therefore conservative copy conditions. Decide during the walk; do not add a preliminary scan or size threshold.

Property changes are not isolation conditions. In-place child mutation may require a pre-call copy; assigning a fresh value requires no copy; assigning an argument may require a post-call copy because the argument remains leased.

### Mutation lifecycle

A mutation performs two complete receiver walks, each with a fresh copy map. The pre-call walk isolates existing state before arbitrary class mutation. The post-call walk isolates retained or added state and validates and admits the completed receiver. Neither walk records which properties changed.

The mutation uses this sequence:

1. After preparation, release receiver-only preparation leases but retain all argument leases.

2. Walk the complete receiver with a fresh copy map to isolate existing state before arbitrary class mutation.

3. If that map is nonempty, scan the prepared arguments once. Replace every copied receiver identity found there with the same copy, materializing only paths to those occurrences. This preserves receiver-argument aliases and cycles without snapshotting unrelated argument data. Skip the scan when the map is empty.

4. Invoke the mutator once and synchronously, recording whether its raw result is the receiver.

5. With argument leases still active, walk the complete final receiver with a fresh copy map. A retained source argument that was not remapped before the call requires isolation through its lease; a remapped private receiver copy does not. Apply the same isolation predicate to every other value reached by the walk, retain fresh values exactly, admit new identities as runtime-owned, and reject any Promise or Error.

6. Publish through `transformProperty`, replacing the receiver placement only if isolation changed its root, then release the argument leases. Never publish before final validation.

### Cost

Each pass visits every reached identity once. A mutation performs preparation and pre- and post-call receiver walks; a nonempty pre-call map adds one argument scan with allocation only along remapped paths. Other allocation is limited to materialization and isolated subgraphs, so a receiver without isolation metadata incurs no receiver-copy allocation.

## Results and failures

### Results

When a mutation returns its receiver, return the published receiver and let common completion mark it shared because the placement and result are separate owners.

Before common admission, deep-copy every other traversable observation or mutation result with a separate map. Preserve registered prototypes, Array structure, aliases, and cycles within the result; share no record, Array, or registered instance with the receiver or arguments; keep opaque identities and Functions exact.

### Failures

Reuse common failure handling. Preparation rejection, a prepared input Error, or a synchronous throw affects only an observation result; a mutation publishes the Error at its receiver through `transformProperty`. A Promise or Error in the completed receiver is a validation failure and is never published. A result that is or traversably contains a Promise instead returns an independent validation Error while a valid mutation publishes; any other language failure confined to result copying, validation, or admission likewise affects only the result. Runtime invariant failures remain fatal, and a deliberately returned Error remains an ordinary result.

## Scope

Do not persist mutation or identity history or add defensive argument snapshots, registered-specific ownership state, or registered refcount rules. Reuse ordinary COW, readiness and protection, refcounting, Promise mirrors, import, opaque ordering, result admission, and mutation publication. After the prerequisite, registered-specific code is limited to common dispatch into one small module for receiver and result preparation, copying, and validation.
