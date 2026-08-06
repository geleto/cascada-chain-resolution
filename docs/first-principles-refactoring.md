# First-principles refactoring opportunities

## Purpose

This document applies the first principles in `AGENTS.md` to source-wide refactoring. It starts from Cascada's fixed observable contracts and seeks the simplest general mechanisms that make special state, paths, and coupling unnecessary. `AGENTS.md` is authoritative; this document retains each proposal and its evaluated outcome.

The opportunities are independent. Every change must preserve synchronous progress, FIFO Promise ordering, exact property versions, ownership and import isolation, graph semantics, and the language Error/fatal boundary.

## Fixed contract: opaque method receivers

Controlled intrinsics read logical graph properties. An ordinary trusted method is an opaque host call: Cascada resolves its receiver path and exported arguments, then invokes the method with the resolved receiver directly as `this`. An internal ArrayView is first materialized, and the resulting native Array is `this`. Cascada does not mediate property reads inside the method, discover nested Promise dependencies, or replace the receiver with a logical snapshot or Proxy.

Exact host receiver behavior makes runtime-owned physical writeback observable. The property-version protocol therefore writes an advancing live runtime-owned version into its property. Imported and detached versions remain mirror-only, so an imported method receiver retains its external Promise. This difference follows directly from exact host identity and the rule that imported data is never modified.

A pending ordinary invocation continues to preserve its captured receiver, and tracked ordinary-method results remain imported at admission. Mirror-owned logical settlement requires a stable data-property shape; host-visible runtime-owned writeback additionally requires writability and its existing validation timing. Virtualizing the receiver or removing this writeback would be a separate public contract change.

## Smaller independent opportunities

### Make Error-query strategy explicit

Use one named counter-fence predicate throughout Error search. Select first-error and all-errors behavior explicitly instead of inferring mode from callback presence. Keep their necessary state distinct: first-error search stops and resolves a Boolean, while all-errors search retains a Set until its captured frontier completes.

Do not force both through a generic race abstraction. `includes` has a fixed pending set, whereas Error search can discover nested pending work after settlement.

Outcome: kept. Explicit strategies removed the mixed-mode state object and reduced the implementation.

### Name path ancestry

Unlimited Array flattening and recursive Array-to-string conversion use the same linked ancestry check. If a natural low-level home exists while those areas are edited, give this per-path cycle discipline one named helper. It must remain distinct from a global visited set, which would suppress legitimate revisits through separate paths.

Outcome: kept. Logical Array handling now owns the shared exact-identity ancestry predicate.

### Keep Chain capability off the language surface

The Chain state holder participates in language-property and refcount machinery, so its own enumerable string keys are language-graph edges. `_mutates` is an issuance capability, not language data. Keep the same exact Boolean and close-by-removal contract, but store it on the host Chain instead of its language state. Verify mutable, read-only, closed, and entered Chains through public behavior, with a focused invariant test for the state graph.

Outcome: kept. The exact capability is now outside the language surface, while closure still removes it.

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

The presence of the exact `_mutates` Boolean is the Chain's issuance capability. Removing it closes that capability while already-captured state remains available to continuations. Moving that fact off the language surface is useful; adding a second flag would persist a duplicate fact that can disagree with the first.

Error-query and ancestry cleanups should land only when they simplify touched code without introducing a new framework. Stack-depth changes should accompany their owning area; moving Chain capability off the language surface can land independently.

The opaque receiver contract is fixed: no refactoring virtualizes an ordinary method receiver, and the property-version protocol preserves host-visible runtime-owned writeback.

Each refactoring should remove the mechanisms it supersedes in the same change and pass the complete suite with both inline and WeakMap metadata. Prefer integration tests through public operations; use focused unit tests only for load-bearing invariants that public behavior cannot verify precisely. Behavioral tests must not pin mirror fields, helper boundaries, cycle-cut placement, or exact counter totals; a focused invariant test may inspect representation only when public behavior cannot verify that invariant precisely.

## Baseline

Verified after the evaluated independent refactorings on 2026-08-06. The complete suite passed in both metadata modes:

- 643 tests with inline metadata; and
- 643 tests with WeakMap metadata.
