# First-principles refactoring opportunities

## Purpose

This document applies the first principles in `AGENTS.md` to source-wide refactoring. It starts from Cascada's fixed observable contracts and seeks the simplest general mechanisms that make special state, paths, and coupling unnecessary. `AGENTS.md` is authoritative; these proposals should be removed as they are completed.

The phases are ranked by architectural value. Implementation order also considers dependencies and risk. Every change must preserve synchronous progress, FIFO Promise ordering, exact property versions, ownership and import isolation, graph semantics, and the language Error/fatal boundary.

## 1. Make property versions and publication authoritative

### Problem

A Promise-backed property version currently stores its logical value in one of three places:

- the physical property while an ordinary mirror is live;
- `resolvedValue` while an imported mirror is live; or
- `detachedValue` after the mirror is displaced.

That storage split spreads one property-version transition across several mechanisms:

- `PromiseMirror.getValue(parent, key)` locates the current storage;
- detachment moves state between fields;
- imported settlement needs a separate overlay;
- retained ArrayView forks pass `sharedBacking`;
- refcounting needs `commitPendingPromiseEdge` when shared physical storage advances first; and
- logical property reads probe for `resolvedValue` directly.

Property-version behavior is also divided among `promise-mirrors.js`, `property-capture.js`, `property-transitions.js`, and the post-load injection in `init.js`. Mutation, observation, raw export, and Error search repeat capture, FIFO registration, and exact-version reads.

Ownership publication is split too. A retained Promise value is marked shared in mirror callbacks, while one remap path can pass a Promise to the otherwise synchronous-looking `markShared`. That asynchronous branch is `meta.js`'s only dependency on `resolution.js`.

### Simplest target

Every mirror owns one `value`, containing the current logical value of its property version:

1. A new mirror starts with its Promise as `value`.
2. The first settlement resolver advances `mirror.value` in its FIFO transition.
3. Logical reads of a mirrored property read `mirror.value`.
4. Detachment removes the mirror from the live map but does not move its value.
5. Advancing a live runtime-owned version also writes the property physically.
6. Advancing an imported or detached version changes only the mirror; an imported property retains its physical Promise.

Every mirror gains one value field immediately. Some runtime-owned properties may also duplicate that value physically, but logical graph operations no longer choose between storage locations.

Build one property-version protocol around that state, with purpose-specific entry points for:

- creating a property reference that fixes owner, key, and presence when structure is observed;
- lazily capturing its logical value and mirror at the consumer's exact program position;
- continuing a captured version at a consumer's FIFO position;
- assigning and discovering versions;
- forking and transferring versions; and
- advancing, detaching, and publishing versions.

These entry points share one internal publication transition instead of configuring behavior through flags. Publication coordinates the mirror value, import and ownership classification, refcounts, cycle cuts, and required physical writeback synchronously.

Publication owns placement effects, while the boundary that knows whether the source survives decides ownership. It offers purpose-specific retained and exclusive placement: retained placement marks the value shared before a later continuation can observe it, while exclusive placement does not add an owner. Phase 3 maps method and lookup outcomes directly to these entry points, without preserving `sharedOwnership` or another Boolean adapter.

Promise placement therefore never relies on asynchronous `markShared`. Make `markShared` synchronous: it marks a tracked identity, ignores nontracked non-Promise values such as primitives and Errors, and treats a Promise as a fatal invariant violation. The resolver responsible for a Promise placement must classify its settled value.

One protocol means one owner for coordination, not one module that absorbs every concern. Language-property code continues to own descriptors and physical access, resolution owns the canonical Promise queue, import owns external classification, and refcounting owns its graph projection. Where a subsystem both requests and participates in publication, split those roles instead of replacing the current injection with another cycle.

Removing `initPromiseMirrors` requires an acyclic dependency direction, not merely moving publication. Today `indexComponent` requests mirror discovery while publication updates refcounts; import also requests mirror discovery while publication performs import classification. Separate those roles so no subsystem both calls the property-version protocol and is called back by it.

### Must preserve

- `mirror.value` is authoritative only for logical value. The physical descriptor remains authoritative for property presence, shape, writability, and configurability.
- Every mirrored property requires a stable own data-property shape. While runtime-owned writeback remains observable, a live runtime-owned property must also be writable and must fail validation at the same program position as today; an imported property need not be writable.
- Every Promise placement creates a fresh mirror, including reassignment of the same Promise.
- Structural presence is fixed when a property is referenced; its logical value and mirror are captured only when the operation consumes it. A direct walk may do both consecutively, but native remapping must keep capture lazy so access and Promise registration do not move earlier.
- Structural discovery may establish property-version state, but it does not register an operation as a consumer. Consumers register only where they actually depend on the pending version.
- A value resolving through an imported property is classified before publication, and the imported container remains physically unchanged.
- Settlement payload is consumed only by the version's first resolver. Later consumers and forks read the latest state of the captured mirror.
- A fork or transfer samples its source version at its own FIFO position.
- Retained values become shared before a later continuation can observe them; transferred values do not gain a second owner.
- Detached versions remain usable by operations that captured them and receive any bookkeeping those operations need.
- Identity, property-version, placement, and operation facts remain at their natural scopes.
- Captured presence and own-key order remain stable across suspended operations.

### Expected removals

- `resolvedValue` and `detachedValue`;
- the live/detached value-storage branch;
- the parent/key parameters from mirror value reads;
- `isLive` as a storage selector;
- the `resolvedValue` presence check in logical property reads;
- `sharedBacking` and `commitPendingPromiseEdge`;
- asynchronous Promise handling in `markShared` and the `meta.js` dependency on `resolution.js`;
- `initPromiseMirrors` and `init.js` bootstrap wiring;
- repeated `getOrCreatePromiseMirror` + `onLaterPromiseReady` + `getValue` sequences; and
- fork options made redundant by mirror-owned values and one publication transition.

### Verification

Representation-pinning tests must be migrated in the same change. Prefer public observations of settlement, detachment, import preservation, and version isolation. Keep direct mirror inspection only in focused invariant tests that cannot verify corruption or bookkeeping precisely through public behavior, and update those tests to the new representation.

Cover same-Promise reassignment, lazy property capture and registration order, imported-value promotion, frozen and writable imported properties remaining physically unchanged, host-visible runtime-owned writeback, detached consumers, retained ArrayView forks, and refcount correctness.

## 2. Propagate refcount deltas over the projection DAG once

### Problem

`applyCountDelta` recursively follows every parent path. Cycle cuts guarantee termination and the resulting multiplicities are correct, but a DAG is traversed as if it were a tree. A stack of `N` diamonds can therefore require `O(2^N)` recursive visits, and a deep chain can exhaust the call stack.

### Simplest target

For each publication, use iterative worklists to derive the reachable parent DAG locally, accumulate the delta and edge multiplicity for each node, and apply the totals in child-before-parent topological order. Each reachable node and edge should be processed a bounded number of times while preserving the contribution of every distinct path and without relying on the call stack.

Do not store a persistent topological order. The parent DAG changes with property placement, while the local order is recoverable from the maintained reverse edges.

The local algorithm trades `O(V + E)` temporary state per propagation for bounded traversal. Measure ordinary chains and trees as well as stacked diamonds, including peak temporary memory. Do not add a persistent topology cache or a special fast path without evidence that this trade is unfavorable in practice.

### Must preserve

- A diamond ancestor receives the sum of every path contribution; a simple visited-set suppression would be incorrect.
- Parent-edge multiplicity continues to multiply the propagated delta.
- Cycle cuts remain projection boundaries and are not crossed as ordinary parent edges.
- Promise, Error, and cycle-cut deltas remain one synchronous part of property publication.
- The projection need not become canonical; this changes propagation cost, not cut placement or observable graph behavior.
- Counter and parent-edge invariant failures remain fatal.

### Verification

Use focused invariant tests for repeated parent edges, single and stacked diamonds, cut components, and a deep chain. Integration tests must continue to verify Error queries and Promise settlement across shared and cyclic graphs without pinning a particular valid cut placement or counter total. Benchmark ordinary chains and trees against the current implementation, and verify that stacked diamonds grow linearly in visited nodes and edges.

## 3. Make method dispatch and result ownership declarative

### Problem

`ARRAY_METHODS` under-declares several independent decisions:

- `view: true` leaves `tryArrayViewMethod` to infer the strategy from the method name;
- `definition.implementation ?? methods[method]` binds implementations through namespace-name coincidence; and
- `transformResult` is used with incompatible inputs: a native result, a property origin, or a result plus an ownership boolean.

Ownership is then re-derived under unrelated names. `replaceReceiver` is passed as `retained` because receiver replacement happens to imply that a removed result still exists in the preserved source. Remap placement, mirror forks, and lookup use other booleans for related retain, transfer, and read outcomes.

Ordinary method selection also returns `undefined`, an Error, or a function. Its caller repeatedly re-derives intrinsic dispatch, receiver materialization, result import, and read leasing from that union.

### Simplest target

Give every supported Array method an explicit declaration or handler for:

- argument preparation;
- intrinsic implementation or native remapping;
- ArrayView strategy;
- result strategy and input shape; and
- result ownership when the source may survive.

Dispatch rejects an absent or unknown strategy instead of defaulting by method name or module export. Prefer purpose-specific handlers over a table of interacting Boolean flags.

Decide result ownership once at the boundary where the value leaves the operation:

- **retain/extract:** another owner survives, so an aliased result becomes shared;
- **borrow/read:** ownership does not change; and
- **transfer:** the prior ownership ends, so no second owner is created.

These are boundary contracts, not necessarily one enum threaded through unrelated layers. Retain/extract uses retained publication, transfer uses exclusive publication, and borrow/read performs no placement. Pass only the distinction a lower layer must act on; never reuse `replaceReceiver` or `sharedOwnership` as that distinction.

Return ordinary-versus-intrinsic method selection as an explicit dispatch decision. It may carry the callable, effective receiver, read-lease value, and result-admission policy that the caller would otherwise infer repeatedly.

Use one fallible attachment boundary, such as `ArrayView.tryAttachTo`, that rejects imported backing before adding view metadata or changing storage. Derivation and growth APIs use that boundary, while callers provide only the before-write transition that forks retained Promise versions.

### Must preserve

- ArrayView backing is runtime-owned, and eligibility is checked before metadata attachment or backing mutation.
- Retained Promise properties fork at the operation's FIFO position before physical storage changes.
- Distinct logical properties retain distinct mirrors even when they share backing storage.
- Sparse holes, canonical indexes, length limits, inherited indexed properties, descriptor failures, and partial native mutations retain their current behavior.
- Removed-element results capture the correct source property version.
- Result sharing depends on whether another owner retains the value, not on which mechanical dispatch path produced it.
- Observation views and receiver-replacing mutation views produce the same public results as their materialized equivalents.
- Controlled intrinsic results retain their method-specific ownership: newly created data is runtime-owned, while extracted existing identities become shared unless ownership transfers. Opaque ordinary-method results retain their current import behavior.
- Pending opaque observations retain the correct receiver through the existing read lease.
- Ordinary method lookup, exact `this` identity, accessors, physical property reads, and Error conversion retain their current contracts. Internal reads do not discover or wait for nested Promise properties.

### Expected removals

- implicit method-name defaults in `tryArrayViewMethod`;
- namespace-name implementation lookup;
- the overloaded `transformResult` contract;
- the separate shift/pop result-origin branch;
- `replaceReceiver` used as an ownership argument;
- `sharedOwnership` as an ownership-policy Boolean;
- repeated inference from function/Error/`undefined` method selection; and
- duplicated imported-backing guards and the unguarded attachment entry point.

### Verification

Compare every supported method with its native equivalent across dense and sparse inputs, accessors, inherited properties, partial failures, and synchronous/Promise interleavings. Cover retained extraction, transfer, pure borrow/read, ordinary-method result import, exact receiver identity, receiver read leasing, runtime-owned writeback visibility, imported physical preservation, nested Promises left undiscovered by host reads, and every ArrayView derivation, fallback, and imported-backing guard.

## 4. Move property behavior into one policy and lower its primitives

### Problem

Array and String `length` behavior is distributed across several layers:

- `setProperty` dispatches Array length specially;
- `assignPath` redirects every terminal `length` to `assignLengthPath`;
- `assignLengthPath` performs receiver transformation and Promise gating;
- `walkMutationPath` emits `virtualLength`;
- mutation invocation and deletion interpret that flag separately; and
- `language-properties.js` already owns logical length reads and descriptors.

The redirect exists because intrinsic length mutation targets and may replace the receiver rather than an enumerable child. Stopping the walk one level early makes `transformLength` repeat the walk's final copy-on-write step. The walk and method invocation also compute the same receiver-preservation predicate separately; length transformation repeats its ownership-based part under other names. ArrayView materialization and growth are distinct concerns, but the common path-copy decision is duplicated.

Ordinary property assertions also receive a container's import `errorContext` from callers that already pass the container. One exceptional settlement path instead attributes failure to the newly published value's import boundary, but the generic parameter does not communicate that distinction.

Finally, `array-remap.js` depends on high-level mutation helpers because low-level property assignment still owns length dispatch, Promise placement, and attachment behavior.

### Simplest target

The language-property layer classifies terminal properties: ordinary properties, Array length, ArrayView length, String length, and invalid Array keys. It owns logical access, descriptors, validation, and physical property primitives.

The mutation walk classifies the terminal `(receiver, key)` before treating the key as a graph edge. An ordinary property targets that property; an intrinsic property targets the receiver. The target transition may return a replacement receiver, and the walk reconstructs it through the same writeback path used for every other replacement.

The mutation layer continues to own copy-on-write, Promise gates, receiver replacement, and path reconstruction. The walk computes the base path-copy decision once per level and supplies the target context. ArrayView materialization remains an explicit walk-level addition, while growth remains operation-specific. When a pending value cannot occupy the physical property, the existing `transformProperty` transition gates the enclosing receiver version.

Assignment, deletion, and mutation invocation share the classification but retain responsibility for their own language results.

Normal property assertions derive error attribution from their container. Property publication uses a purpose-specific path when failure must instead be attributed to the newly published value. Do not retain a generic override at every normal call site for one exceptional meaning.

Once `setProperty` no longer owns intrinsic length policy, move low-level property assignment and deletion below both path mutation and Array remapping. This removes the `mutations.js`/`array-remap.js` dependency cycle without carrying the special path into another module.

### Must preserve

- Array and String length are intrinsic state, not enumerable language-graph edges. They do not acquire ordinary property mirrors or refcount edges.
- An ordinary object's enumerable key named `length` remains an ordinary property and may hold any value, including a Promise.
- A deferred Array length installs its receiver gate synchronously at issuance, so later receiver operations remain ordered behind it.
- Shared and imported receivers are copied before any physical mutation.
- An intrinsic length operation that cannot mutate fails before unnecessary copy-on-write or receiver replacement.
- Per-operation rejection remains distinct: deleting intrinsic length reports that length cannot be deleted, while Array mutation through length reports that the receiver is not an Array.
- Native Array contraction may delete part of the requested range before a non-configurable element stops it. Those deletions, their mirrors, refcounts, and cycle cuts remain committed, and the operation returns the Error with the partially contracted receiver.
- ArrayView contraction, tail growth, and materialization retain their current eligibility and sparse behavior.
- Validation errors retain the correct import attribution and timing.
- Missing properties are defined as own data properties, so inherited setters never participate.

### Expected removals

- `assignLengthPath` as a parallel path;
- `virtualLength`;
- the early terminal-`length` redirect;
- `transformLength`'s duplicate final-level copy-on-write;
- repeated base receiver-preservation predicates in the walk and its callers;
- repeated Array/String length checks in the path walker and its callers;
- routine `errorContext` derivation and threading at assertion call sites; and
- the `mutations.js`/`array-remap.js` dependency cycle.

### Verification

Cover synchronous and Promise-converted lengths, ordinary object `length`, read-only Array and String length, ArrayView growth and contraction, partial contraction failure, deletion, copy-on-write isolation, import attribution, and refcount correctness through public operations.

## 5. Deduplicate Promise-frontier discovery within one import

### Problem

When import reaches a metadata-bearing runtime-owned identity, `discoverPromiseMirrors` starts a fresh graph walk. With `M` overlapping runtime-owned islands across `N` reachable identities, one import can approach `O(N × M)` scanning. Persisted discovery state would go stale, but no persistent state is needed.

### Simplest target

Create one discovery `WeakSet` for each import preparation and pass it through every runtime-island discovery walk. Each available tracked identity is then scanned at most once during that import, while a later import starts with a fresh frontier.

### Must preserve

- Discovery reads logical language properties and stops descent at each Promise placement.
- It creates missing mirrors but does not register the import operation as a consumer.
- Cycles terminate without changing sharing, ownership, or import classification.
- Runtime-owned islands retain their ownership, and later mutations can expose a new frontier to a later import.

### Verification

Verify that overlapping runtime-owned islands are scanned once per import, using focused instrumentation if public behavior cannot expose the work. A later import must still discover a Promise inserted or exposed after an earlier import. Ownership and import classification, mirror creation, and consumer registration must remain unchanged.

### Possible follow-up

`containsPromise`, runtime-island discovery, and import preparation share a narrow available-frontier traversal shape. Extract a common primitive only if it can express early success, revisits, promotion, and Promise-leaf actions directly, without becoming a configurable callback walker. Raw export, ref indexing, and Error search do not belong in that primitive.

## Fixed contract: opaque method receivers

Controlled intrinsics read logical graph properties. An ordinary trusted method is an opaque host call: Cascada resolves its receiver path and exported arguments, then invokes the method with the resolved receiver directly as `this`. An internal ArrayView is first materialized, and the resulting native Array is `this`. Cascada does not mediate property reads inside the method, discover nested Promise dependencies, or replace the receiver with a logical snapshot or Proxy.

Exact host receiver behavior makes runtime-owned physical writeback observable. Phase 1 must therefore keep writing an advancing live runtime-owned Promise version into its property. Imported and detached versions remain mirror-only, so an imported method receiver retains its external Promise. This difference follows directly from exact host identity and the rule that imported data is never modified.

A pending ordinary invocation continues to preserve its captured receiver, and tracked ordinary-method results remain imported at admission. Mirror-owned logical settlement requires a stable data-property shape; host-visible runtime-owned writeback additionally requires writability and its existing validation timing. Virtualizing the receiver or removing this writeback would be a separate public contract change.

## Smaller independent opportunities

### Make Error-query strategy explicit

Use one named counter-fence predicate throughout Error search. Select first-error and all-errors behavior explicitly instead of inferring mode from callback presence. Keep their necessary state distinct: first-error search stops and resolves a Boolean, while all-errors search retains a Set until its captured frontier completes.

Do not force both through a generic race abstraction. `includes` has a fixed pending set, whereas Error search can discover nested pending work after settlement.

### Name path ancestry

Unlimited Array flattening and recursive Array-to-string conversion use the same linked ancestry check. If a natural low-level home exists while those areas are edited, give this per-path cycle discipline one named helper. It must remain distinct from a global visited set, which would suppress legitimate revisits through separate paths.

### Remove call-stack dependence from unbounded walks

`indexComponent`, `containsPromise`, raw export, Error search, and mutation-path walking recurse with input depth. Treat unbounded synchronous depth as a correctness concern. When each area is changed, use operation-local iterative state and add deep-input coverage; do not turn the distinct traversals into a generic walker.

### Keep Chain capability off the language surface

The Chain state holder participates in language-property and refcount machinery, so its own enumerable string keys are language-graph edges. `mutates` is an issuance capability, not language data. Keep the same exact Boolean and close-by-removal contract, but store it under a private Symbol or another non-language key. Verify mutable, read-only, closed, and entered Chains through public behavior, with a focused invariant test for ref-indexed state.

## Deliberate non-candidates

The following code should not be generalized merely because its syntax looks similar.

### `containsPromise`

Its precise scan avoids permanently sharing attachment roots that contain no delayed work. Unindexed values have no counters, while an indexed projection hides descendant Promise counts behind cycle cuts. `promiseCount === 0 && cycleCutCount === 0` can prove a negative for an indexed value, but the counters cannot replace the exact scan in every case. Persisting an exact answer would require additional mutation-aware state.

### General Promise gates and races

Creating a Promise or composing readiness Promises is not the same as registering on a graph thenable. `transformProperty` gates a receiver mutation; `enter` transfers a private version and withholds publication on fatal callback failure. Likewise, `includes` races a fixed set while Error search discovers work recursively. Extract a helper only where the complete transition and rejection contract are identical; do not introduce `deferredValue`, `allReady`, or `firstTrue` as adapters over different operations.

### Generic graph walkers

Ref indexing, raw export, and Error search differ in traversal order, stopping, cycle handling, ownership, and Promise consumption. A generic callback walker would hide required transitions rather than remove them. Only the narrower available-frontier follow-up above warrants joint evaluation.

### Resolution helper split

Initial data resolution, later property readiness, and operation-result resolution have different rejection contracts. Their separate helpers make the language Error/fatal boundary explicit.

### Native Array remapping

Most remap complexity follows sparse native behavior, partial failures, result ownership, and exact property-version placement. Simplification should target surrounding publication and declarative dispatch, not erase those distinctions.

### A separate Chain `closed` flag

The presence of the exact `mutates` Boolean is the Chain's issuance capability. Removing it closes that capability while already-captured state remains available to continuations. Moving that fact off the language surface is useful; adding a second flag would persist a duplicate fact that can disagree with the first.

## Recommended sequence

- **Property versions:** Rewrite mirror state, exact-version capture, publication, and retained ownership together so no transitional storage adapter survives.
- **Refcount propagation:** Replace recursive per-path propagation after the publication boundary is stable.
- **Method dispatch:** Make Array and ordinary dispatch, result strategy, result ownership, and ArrayView attachment explicit together.
- **Property policy:** Unify intrinsic property behavior, then lower assignment and deletion to remove the mutation/remap cycle.

Import-local frontier deduplication can land before the property-version rewrite. Otherwise fold it into Phase 1, because both reshape version discovery. Error-query and ancestry cleanups should land only when they simplify touched code without introducing a new framework. Stack-depth changes should accompany their owning area; moving Chain capability off the language surface can land independently.

The opaque receiver contract is fixed: no phase virtualizes an ordinary method receiver, and Phase 1 preserves host-visible runtime-owned writeback while simplifying mirror storage and internal logical reads.

Each phase should remove the mechanisms it supersedes in the same change and pass the complete suite with both inline and WeakMap metadata. Prefer integration tests through public operations; use focused unit tests only for load-bearing invariants that public behavior cannot verify precisely. Behavioral tests must not pin mirror fields, helper boundaries, cycle-cut placement, or exact counter totals; a focused invariant test may inspect representation only when public behavior cannot verify that invariant precisely.

## Baseline

Reviewed on 2026-08-05 against source commit `8e2c1e3`. The complete suite passed in both metadata modes:

- 628 tests with inline metadata; and
- 628 tests with WeakMap metadata.
