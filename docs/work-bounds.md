# Bounded Graph Work

This document records the implemented mechanisms that keep graph work within the values, paths, results, Promise frontier, and maintained dependencies selected by an operation.

## Cycle cuts

Refcount cycle cuts may require a counter-selected walk when maintained counters cannot answer across a cut. All such walks in one operation share one visited set and inspect each identity at most once. Building a missing index may use a separate pass.

## Promise presence

`containsPromise` uses one counter-pruned walk:

- a Promise proves presence;
- an untracked or already visited value does not;
- an indexed node with `promiseCount > 0` proves presence;
- an indexed node with zero `promiseCount` and zero `cycleCutCount` proves absence; and
- an unindexed node or indexed node with cuts enumerates its own logical children recursively.

One visited set spans the walk. Counters prune clean indexed subtrees; the fallback covers only the selected input and counter-selected cut regions. The check does not build an index because structural discovery must not create Promise consumers. Exact classification avoids permanently sharing an attachment root that contains no delayed work.

## Array ranges

Array work is bounded by three shared mechanisms:

1. Ranged key enumeration scans a strict selected range, including its holes, but enumerates present keys when the selection spans the complete physical backing so sparse full-range work remains proportional to present properties.
2. Retained-property preparation represents contiguous movement as one source range and destination offset.
3. Range remapping handles both complete remaps and selected `slice` results. `slice` converts each consumed bound once and remaps only the normalized range when view reuse is unavailable.

All three use the common Promise-origin and placement transitions, preserving holes, ownership, mirrors, and inherited-setter safety without operation-specific paths.

## Controlled Array work

One invocation lifetime covers controlled input preparation, logical conversion, recursive `flat`, search continuations, comparator export, and remap construction. A final local result closes that work. A late continuation in a live execution still finishes required shared Promise settlement and bookkeeping, but performs no further Array-specific work. A continuation in a fatal execution returns at the common execution check before either kind of work.

`concat` bounds later work by synchronously capturing each resolved logical Array as a sparse property-placement remap. Sort resolves each present top-level placement once. Default sorting converts each sortable occurrence once; comparator sorting exports one dense snapshot and reuses it for every comparison.

Array-length assignment makes the existing mutation context its explicit guarded-work owner, so ready conversion allocates no additional owner object or release-registry state. Pending conversion normally closes only after its mutation gate publishes. Local sibling closure in a live execution does not suppress required shared property settlement; execution fatality stops a resumed conversion before settlement.

## Detached results

Settlement of a detached or displaced property version stores its logical mirror value without building a ref index or inspecting nested data. Imported settlement still performs its independent admission and Promise-placement work before liveness is considered.

Consumers discover detached data through their ordinary logical path. The fenced Error walk is the only consumer that requires maintained counters, so it indexes the reached value at its own FIFO position before consulting them. Mutation, observation, export, and remapping need no eager index.

## Bulk Array mutation

In-place Array replay commits each changed property through the ordinary live-edge transition. Every commit completes its property write, Promise version, cycle cut, reverse edges, and counter delta before the next native-order change.

This can repeat ancestor work across many changed properties, but the work remains limited to changed placements and affected dependencies. Batching would need an invalidated ancestor cache or transactional overlay because indexing one child can change the ancestor cone and counters observed by later changes. That additional state and ordering is not justified for the expected graph sizes.

## Managed calls

A managed call explicitly consumes its complete receiver graph. Receiver preparation, mutation isolation, and finalization are separate full walks because preparation may suspend, isolation uses the protection state after preparation, and finalization must inspect arbitrary method changes. Each walk remains bounded by the receiver and explicit inputs and never expands into unrelated graph state.
