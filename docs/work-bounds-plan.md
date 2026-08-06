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

Status: complete.

Detached or displaced settlement stores `mirror.value` without ref-index preparation. Eager preparation would inspect unrelated result data, discover nested Promise placements, and register their first resolvers through structural discovery alone; deferring only counter allocation would retain that traversal.

The runtime already publishes unindexed values wherever the owner is unindexed — entered roots and plain state holders — so consumers already read detached values logically and discover their nested Promises through the ordinary first-discovery path. The audit of detached-mirror consumers finds exactly one that reads maintained counters: the fenced error walk shared by `hasError` and `getErrors`. The design is therefore:

- detached and displaced settlement stores `mirror.value` without ref-index preparation; imported settlement keeps its admission and Promise-placement discovery, which run before the liveness check and are independent of ref indexing;
- the fenced error walk indexes each value at entry; for a resolved Promise value this happens at the consumer's own FIFO position and is idempotent when already indexed; and
- no other consumer changes: mutation descent, observation continuations, raw export, and remap origins read logical values and need no counters.

Index construction at the consumer creates mirrors for the Promise properties it discovers, preserving the invariant that an indexed owner mirrors every Promise property. A Promise first reached after settlement follows the ordinary first-discovery asynchronous path; eager counter timing is not independently contractual, and publication after detachment does not write physically.

Complexity result: publication no longer inspects a detached result. The fenced error walk establishes its own indexing prerequisite, so root and Promise-resumed searches use one mechanism. Production source loses one line and gains no state, mode, flag, adapter, or alternate discovery path.

Verification:

- settling an unconsumed runtime-owned detached version neither enumerates its result nor creates its ref index or nested Promise mirrors; imported settlement still performs its independent admission walk;
- Error collection through a captured detached version still finds direct Errors, follows nested Promises, and supports imported non-extensible values;
- already-settled nested Promises, recursive Error search, export, path operations, cycles, rejection conversion, and same-source FIFO ordering retain their behavior; and
- the complete suite passes with inline and WeakMap metadata.

## Phase 5: Evaluate bounded ref-index maintenance for bulk Array changes

Status: complete; existing mechanism retained.

In-place Array replay commits each changed property through `commitLiveEdge`. Each commit maintains the physical property, Promise version, cycle cut, reverse edges, and counters before replay proceeds. Cycle detection and counter propagation may each walk the affected ancestor cone, so a bulk transition can cost `changes * affected ancestors`.

Retain this mechanism. Its work is confined to explicitly changed properties and affected dependencies, so it satisfies the Work Bounds. Cascada does not expect unusually large graphs, and no compact general batching transition emerged whose complexity is justified by the repeated work.

The repeated walks are load-bearing under the current graph model. Indexing a prospective child can add parents above an existing cone member, and it can read counters changed by earlier properties in the same replay. Reusing an ancestor closure or deferring deltas would therefore require invalidation, flushing, or a transactional overlay coordinated across layers. Those mechanisms add more state and ordering rules than they remove.

Implicit host reentrancy remains a separate contract question. Promise classification and graph reflection can invoke host code during a transition; any rule or guard for command reentry must be designed and enforced independently, not introduced only to enable refcount batching.

Result:

- public behavior and source remain unchanged;
- every property still completes its maintenance synchronously in native order; and
- no batching state, fast path, overlay, adapter, or representation-pinning test is added.

## Phase interaction

Phase 3's ranged enumeration is the substrate the other phases' walks inherit: the presence walk in Phase 2, consumer-driven indexing in Phase 4, and ref-index builds reached during Array replay all enumerate through it.

Phase 4 leaves more detached results unindexed. When later operations reach them, Phase 2's bounded fallback and ordinary consumer-driven indexing handle only that reached data; this does not require bulk refcount batching.
