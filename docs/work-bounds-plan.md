# Work Bounds Refactoring Plan

## Purpose

This plan applies the Work Bounds in `AGENTS.md` to `src`. It seeks the simplest mechanisms that prevent operations from processing unrelated graph data while preserving every observable runtime contract.

Phases remain in this document after completion. Update their status and final design instead of removing them.

## Method

Implement pending phases in order and evaluate each independently. After every code phase:

- run the complete suite with inline and WeakMap metadata;
- verify the bound through public operations where possible;
- review architecture, source size, and remaining special cases; and
- keep only changes whose reduction in work justifies their complexity.

Use Proxy reflection traps for integration-level work checks, following the existing import coverage. When no public boundary exposes the work, use a focused internal check only if it requires neither production instrumentation nor dependence on interchangeable metadata layout; otherwise verify the bound by review. Use the consistency oracle to verify ref-index correctness, not complexity.

Then perform a simplification review whose goal is lower total complexity: fewer concepts, moving parts, and lines that must be understood together. Review in this order:

1. structural changes that could replace several mechanisms with one invariant, even if that means rewriting a module;
2. parallel paths that can become one general path;
3. adapters, indirection, state, configuration, and error paths that no longer earn their cost; and
4. apparent cruft that must remain because it protects a real invariant.

This is not a style or micro-refactoring pass. Reconsider the implementation from first principles, compare source size and concept count, simplify again where useful, and revert the phase wholly or partly if its bounded-work improvement does not justify its architectural cost.

## Phase 1: Clarify the cycle-cut work bound

Status: complete.

Cycle cuts may require a counter-selected walk when maintained counters cannot answer across the cut. All cycle-cut walks belonging to one operation share one visited set and visit each identity at most once. A separate pass that builds a missing index is permitted.

This keeps recursive Promise continuations in the same operation-wide walk without coupling initial ref-index construction to Error identities or Promise consumers.

## Phase 2: Use maintained counters during Promise-presence checks

Status: complete.

`containsPromise` guards attachment-root sharing with one counter-pruned walk rather than a counter path beside an exact path:

- a Promise is true; an untracked or already-visited value is false;
- an indexed node with `promiseCount > 0` is true without enumeration;
- an indexed node with zero `promiseCount` and zero `cycleCutCount` is false without enumeration; and
- every other node — unindexed, or indexed with cuts at or below it — enumerates its own keys and applies the same rules to each child.

The fallback is the walk itself; counters only prune it. The inconclusive indexed case is the sanctioned counter-selected cut region, and the unindexed case is the operation's own input value, so both enumerations are in bounds. One visited set spans the call. Indexed clean children terminate through their counters, which is what prunes clean subtrees beyond a cut. The walk must not build an index solely to answer this question: index construction installs mirrors and first resolvers, and structural discovery alone must not create consumers.

Complexity result: the existing recursive walk gained only a refcount lookup and two terminal conditions. It adds no persistent state, parallel path, index construction, or traversal abstraction.

Always marking the attachment root shared would make the immediate decision constant-time and remain correct, but would permanently force unnecessary copy-on-write after assignments containing no delayed work. Retain exact classification to avoid moving the cost into every later mutation.

Verification:

- counter-proven positive and negative answers do not enumerate graph data;
- unindexed values, clean cycles, and Promises beyond cuts retain their behavior;
- aliases and cut regions are visited at most once per call; and
- focused Proxy checks exercise assignment through a copied attachment via public operations; and
- the complete suite passes with inline and WeakMap metadata.

## Phase 3: Keep Array range work inside the logical range

Status: complete.

Array range work uses three shared mechanisms, so every consumer inherits the bound rather than implementing its own scan:

1. One ranged key-enumeration primitive owns the range policy: when the selected range spans the physical backing, enumerate present keys; for a strict subrange, scan exactly that numeric range and no properties outside it. `ArrayView.keys` enumerates the complete view through that primitive. No strategy dominates both cases, so the split is by selection: the strict-range cost may include holes because those holes belong to the explicitly selected range, while full-range sparse operations must remain proportional to present properties.

2. Retained-property preparation takes one contiguous source range and destination offset in place of the former destination-key callback. Every mapping — slice, pop, and shift views, append identity, prepend shift — is contiguous.

3. One range-remap primitive owns both full remapping and selected `slice` results. Fallback `slice` converts each argument once with JavaScript numeric coercion and the same relative-index normalization used by view derivation, then remaps only the resulting range. This is simpler than a second lazy-Proxy mechanism and keeps graph reflection outside native conversion error handling.

Promise versions flow through the same origin and placement helpers in all three mechanisms, so ownership, holes, and version semantics need no new handling.

Complexity result: full remapping is the full-range case of the new primitive, the retained callback is gone, and fallback `slice` adds no Proxy, adapter, state, or alternate remap representation. The inherited-setter-safe key set is load-bearing because even temporary Arrays must not invoke inherited numeric setters.

Verification:

- a small slice or view does not inspect backing properties outside its range;
- full-range sparse operations do not materialize or inspect every hole;
- Promise versions, ownership, holes, imported materialization, and native slice argument conversion remain correct; and
- indexing, copy-on-write, raw export, retained views, and ordinary method materialization obey the same range bound through shared enumeration; and
- focused Proxy checks and the complete suite pass with inline and WeakMap metadata.

## Phase 4: Make detached-result indexing consumer-driven

Status: pending.

When a detached or displaced version settles, publication stores `mirror.value` and then eagerly ref-indexes it because the former owner was indexed. That walk discovers nested Promise placements, installs their mirrors, and registers their first resolvers through structural discovery alone. Deferring only counter allocation retains the traversal and is not worthwhile; remove the walk instead.

The runtime already publishes unindexed values wherever the owner is unindexed — entered roots and plain state holders — so consumers already read detached values logically and discover their nested Promises through the ordinary first-discovery path. The audit of detached-mirror consumers finds exactly one that reads maintained counters: the fenced error walk shared by `hasError` and `getErrors`. The design is therefore:

- detached and displaced settlement stores `mirror.value` without ref-index preparation; imported settlement keeps its admission and Promise-placement discovery, which run before the liveness check and are independent of ref indexing;
- the fenced error walk indexes each resolved value at its own FIFO position in its Promise continuation — idempotent when the value is already indexed, and exactly how `hasError` and `getErrors` already index their entry value; and
- no other consumer changes: mutation descent, observation continuations, raw export, and remap origins read logical values and need no counters.

Index construction at the consumer creates mirrors for the Promise properties it discovers, preserving the invariant that an indexed owner mirrors every Promise property. A Promise first reached after settlement follows the ordinary first-discovery asynchronous path; eager counter timing is not independently contractual, and publication after detachment does not write physically.

Implementation must still confirm the audit through the suite: already-settled nested Promises, recursive Error search, export, path operations, cycles, rejection conversion, and same-source FIFO ordering. The tests named `ref-indexes a detached mirror's private resolved branch` and `indexes private non-extensible values from detached mirrors` must verify public behavior — Error collection through the captured version — rather than require eager counters.

Acceptance:

- settlement does not create a ref index or nested mirrors solely because the detached value's former owner was indexed;
- every consumer preserves its observable result and ordering; and
- the implementation removes the eager walk without adding consumer flags, adapter state, or a second discovery mechanism.

If these conditions cannot be met this simply, retain eager preparation and record why it is load-bearing.

Complexity gate: this phase should remove eager work with a local change at publication and the counter-dependent consumer. Add no mirror mode, consumer flag, persisted state, or alternate discovery mechanism.

## Phase 5: Evaluate bounded ref-index maintenance for bulk Array changes

Status: pending design validation.

In-place Array replay commits every changed property through `commitLiveEdge`, so each property walks the owner's ancestor cone twice: once for the cycle check and once for counter propagation. A bulk transition is therefore proportional to `changes * ancestors`. Caching the ancestor closure or deferring propagation is unsound as a blanket policy: indexing a prospective child can link new parents above existing cone members, changing the closure, and can read counters that earlier properties in the same transition changed.

Synchronous reentrancy is an additional hazard. Promise classification reads public `then` properties, and tracking and key enumeration can invoke Proxy traps. Host code reached there can issue another Cascada command while replay has committed physical properties but not deferred counter changes. That command can observe partial graph state and stale counters, build an index from them, or mutate data that replay still expects to own.

Resolve that contract before choosing a batching design. The preferred rule is that a Cascada transition runs to completion before another command may enter through host code it invokes implicitly, including thenable access and reflection traps; such reentry is fatal. Explicit callbacks may issue commands only where their operation defines an issuance scope. Add the final rule to `AGENTS.md` when adopted, and enforce it independently of this optimization rather than only while a refcount batch happens to be active.

After resolving reentrancy, evaluate one general synchronous transition for remap replay and bulk length shrink. A candidate keeps physical properties, mirror registrations, cycle cuts, and reverse parent edges current per property, while accumulating one counter delta for the batch owner and memoizing its ancestor set. Indexing a previously unindexed value would flush the delta and invalidate that set before proceeding. This candidate is acceptable only if the reentrancy rule makes every observation point explicit and the result reduces total complexity.

Do not add a transactional read-through overlay or a fast path selected by prospective-child shape. If no simple universal mechanism emerges, retain per-edge maintenance and record the repeated ancestor work as load-bearing under the current graph model. Replays that build a fresh unindexed result remain outside this work because their final index build already costs one walk; single-property commits retain their simple path.

Complexity gate: proceed only with a compact general transition. If correctness requires a transactional overlay, batching-specific reentrancy rules, or lifecycle state coordinated across layers, keep per-edge maintenance. Reentrancy remains an independent runtime contract and must not be resolved only to enable this optimization.

Acceptance:

- public results, native partial failures, cycle cuts, and exact Promise versions remain unchanged;
- each changed property is processed in native order;
- no index construction observes stale topology or counters;
- implicit host reentry follows the adopted runtime contract;
- repeated work is reduced without production test hooks or representation-pinning tests; and
- single-property commits retain their simple path.

A single tracked-edge change may still walk its affected ancestor cone once for cycle detection and once for propagation. Both passes remain proportional to that cone; only multiplicative repetition across a bulk transition is under evaluation.

## Phase interaction

Phase 3's ranged enumeration is the substrate the other phases' walks inherit: the presence walk in Phase 2, consumer-driven indexing in Phase 4, and replay index builds in Phase 5 all enumerate through it.

Phase 4 may reduce the number of values that already have counters, so remeasure the Phase 2 fast path and the Phase 5 batching opportunity after Phase 4. This does not change their order: Phase 2 is a small independent correction, while Phase 4 has an observable ordering surface and must be evaluated separately.
