# First-principles refactoring opportunities

## Purpose

This document applies the first principles in `AGENTS.md` to source-wide refactoring. It starts from Cascada's fixed observable contracts and seeks the simplest general mechanisms that make special state, paths, and coupling unnecessary. `AGENTS.md` is authoritative; these proposals should be removed as they are completed.

The remaining phases are ranked by architectural value. Implementation order also considers dependencies and risk. Every change must preserve synchronous progress, FIFO Promise ordering, exact property versions, ownership and import isolation, graph semantics, and the language Error/fatal boundary.

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

## Fixed contract: opaque method receivers

Controlled intrinsics read logical graph properties. An ordinary trusted method is an opaque host call: Cascada resolves its receiver path and exported arguments, then invokes the method with the resolved receiver directly as `this`. An internal ArrayView is first materialized, and the resulting native Array is `this`. Cascada does not mediate property reads inside the method, discover nested Promise dependencies, or replace the receiver with a logical snapshot or Proxy.

Exact host receiver behavior makes runtime-owned physical writeback observable. The property-version protocol therefore writes an advancing live runtime-owned version into its property. Imported and detached versions remain mirror-only, so an imported method receiver retains its external Promise. This difference follows directly from exact host identity and the rule that imported data is never modified.

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

Ref indexing, import preparation, raw export, Error search, and `containsPromise` differ in traversal order, stopping, cycle handling, ownership, and Promise consumption. A generic callback walker would hide required transitions rather than remove them. Share a traversal only if its full contract is identical at every caller.

### Resolution helper split

Initial data resolution, later property readiness, and operation-result resolution have different rejection contracts. Their separate helpers make the language Error/fatal boundary explicit.

### Native Array remapping

Most remap complexity follows sparse native behavior, partial failures, result ownership, and exact property-version placement. Simplification should target surrounding publication and declarative dispatch, not erase those distinctions.

### A separate Chain `closed` flag

The presence of the exact `mutates` Boolean is the Chain's issuance capability. Removing it closes that capability while already-captured state remains available to continuations. Moving that fact off the language surface is useful; adding a second flag would persist a duplicate fact that can disagree with the first.

## Recommended sequence

- **Refcount propagation:** Replace recursive per-path propagation after the publication boundary is stable.
- **Method dispatch:** Make Array and ordinary dispatch, result strategy, result ownership, and ArrayView attachment explicit together.
- **Property policy:** Unify intrinsic property behavior, then lower assignment and deletion to remove the mutation/remap cycle.

Error-query and ancestry cleanups should land only when they simplify touched code without introducing a new framework. Stack-depth changes should accompany their owning area; moving Chain capability off the language surface can land independently.

The opaque receiver contract is fixed: no phase virtualizes an ordinary method receiver, and the property-version protocol preserves host-visible runtime-owned writeback.

Each phase should remove the mechanisms it supersedes in the same change and pass the complete suite with both inline and WeakMap metadata. Prefer integration tests through public operations; use focused unit tests only for load-bearing invariants that public behavior cannot verify precisely. Behavioral tests must not pin mirror fields, helper boundaries, cycle-cut placement, or exact counter totals; a focused invariant test may inspect representation only when public behavior cannot verify that invariant precisely.

## Baseline

Verified after the property-version refactoring on 2026-08-05. The complete suite passed in both metadata modes:

- 632 tests with inline metadata; and
- 632 tests with WeakMap metadata.
