# Cycles as valid data

**Status:** Implemented.

Imported cycles are valid data. A cycle-closing property is a structural
traversal frontier, not an Error and not a Promise.

Import preparation marks enough cycle-closing properties to make the projected
refcount graph acyclic. Finite path operations and raw export continue through
the original values.

## Observable behavior

- Lookup and mutation follow cycle-closing properties normally.
- A cycle containing no ordinary Error makes `hasError` return `false`.
- `getErrors` never returns a diagnostic merely because a cycle exists.
- `export` preserves cycles and aliases in its metadata-free output.
- Promises and Errors reachable only through a cut remain observable.
- Replacing or deleting a cycle-closing property removes its cut.

Example:

```js
const external = {}
external.self = external

const value = runtime.import(external, "native cycle")
const chain = new runtime.Chain(value)

runtime.hasError(chain, [])  // false
runtime.getErrors(chain, []) // []

const copy = runtime.export(chain, [])
copy.self === copy           // true
```

An ordinary Error elsewhere in the cycle remains visible to both Error
queries.

## Placement markers

Each selected cycle-closing owner/key property is present in the optional
`meta.cycleCuts` Set. The raw property is never replaced by the marker.

Cycle cuts are live property facts:

- a logically pending Promise property has no published cut;
- its first resolver publishes the prepared value and any cut together;
- replacing or deleting the property clears the cut; and
- a detached Promise mirror retains only its private value, not a former
  placement cut.

A logically pending Promise and a published cut on the same owner/key are
mutually exclusive. An imported physical Promise may remain after its logical
value and cut are published.

## Counter projection

Ref-indexed nodes store three independent totals:

- `promiseCount`: logically pending Promise placements;
- `errorCount`: ordinary Error placements; and
- `cycleCutCount`: projected cycle-cut placements.

Property contributions are triples:

| Property state | Contribution |
| --- | --- |
| Logical Promise | `[1, 0, 0]` |
| Cycle cut | `[0, 0, 1]` |
| Ordinary Error | `[0, 1, 0]` |
| Indexed tracked child | Child totals |
| Primitive or missing value | `[0, 0, 0]` |

No reverse parent edge crosses a Promise or cycle cut.

A cut stops propagation only across its own property. It does not clear the raw
target's counter. One `buildRefIndex` call indexes every raw-reachable tracked
value: each cut target becomes the root of another independently counted
component.

For any raw path into data hidden by projection, the first cut is reached
through an uncut prefix. Its `cycleCutCount` therefore propagates to the query
root:

- `cycleCutCount === 0` means projected Promise and Error totals cover the
  complete reached branch;
- `cycleCutCount > 0` means complete observations must also traverse the
  indexed cut targets; and
- aliases propagate child totals through every uncut parent placement with
  structural multiplicity.

For a cut-free branch:

```text
clean <=> promiseCount === 0 && errorCount === 0
```

`cycleCutCount` is an exact propagated count rather than a monotone flag. A
query can start above an imported cyclic branch, and repairing the last cut must
restore the cut-free fast path without rescanning the graph.

The counts remain independent when a Promise resolves to a cycle:

```text
before: promiseCount=1, cycleCutCount=0
after:  promiseCount=0, cycleCutCount=1
```

## Cut selection

Cycle detection is import-only. Trusted compiler-created data is acyclic under
the single-owner/COW contract.

Preparation details are specified in
[`import-preparation.md`](import-preparation.md). Fresh data normally cuts the
closing DFS back-edge. Entering a prepared island that reaches the captured
ancestry cuts the entering placement instead, because that cycle depends on the
placement.

An existing cut between the repeated identity and the closing property already
breaks that directed cycle:

```text
B -> C -[cut]-> X -> D -> B
```

The final `D -> B` edge needs no second cut. A cut before the first `B` would
not cover this internal cycle. Distinct cycles or alternate routes that bypass
an existing cut may still require additional markers. Cuts are deterministic
but are not globally minimized.

## Ref-index transitions

Index construction contributes `[0, 0, 1]` for a cut, installs no reverse edge
through it, and queues its tracked raw target as a separate component. The
current component is published before queued cut targets are indexed, so a
back-edge cannot re-enter an active recursive frame.

Every live property transition:

1. reads the old counts and counted child;
2. commits the logical value and cut update;
3. reads the new counts and counted child;
4. replaces reverse parent edges; and
5. propagates all three deltas.

Assignment, deletion, and Promise resolution therefore update logical state,
cuts, counters, and parents in one synchronous transition. An imported live
resolver changes `resolvedValue` instead of the external property; a detached
resolver changes only `detachedValue`.

## Error queries

Both Error queries use the same counter-fenced traversal:

- skip a subtree whose three totals are zero;
- follow positive Promise counts to captured Promise mirrors;
- follow positive cut counts to actual cut placements;
- continue from each cut target through its independent index; and
- share one operation-local visited set across components and Promise
  continuations.

When a Promise continuation runs, its first resolver has already published and
indexed the latest value at an earlier FIFO position. A detached resolver also
indexes its private tracked value before an already-issued query reads it.

`hasError` returns `true` immediately for a positive `errorCount`. Otherwise it
races the first Error against readiness for all captured Promise and cut
frontiers. A cut itself never counts as an Error.

`getErrors` exhaustively follows the same frontiers and deduplicates ordinary
Error identities in one Set.

## Export

Export does not use counters. It performs one raw identity-aware copy, follows
ordinary values through cuts, waits recursively for captured Promises, and
preserves aliases and cycles in successful output.

The first ordinary Error switches the operation from copying to
collection-only mode. Every captured frontier still completes so the result can
contain the full distinct Error set. See
[`export-error-set.md`](export-error-set.md).

## Path operations and ownership

Finite `lookupPath`, `assignPath`, and `deletePath` ignore cut metadata and
follow logical properties or the exact detached Promise state captured by an
earlier operation. Their finite path length guarantees termination.

Every imported identity is shared. Mutation COWs before writing it through any
path or root. A copied placement receives a cut only if preparation establishes
that the new placement closes a cycle.

## Verification

`test/verify-refcounts.js` independently checks:

- exact `promiseCount`, `errorCount`, and `cycleCutCount`;
- `[1, 0, 0]` for every logically pending Promise;
- `[0, 0, 1]` for every published cut;
- mutual exclusion of a logical Promise and a cut;
- every cut key names an existing own enumerable tracked property;
- every indexed Promise property has its required live mirror;
- every write-through live mirror has a writable language property, while an
  imported mirror may preserve a non-writable property;
- no reverse parent edge through a Promise or cut;
- downward counter closure through ordinary tracked edges;
- independent counters for raw cut targets;
- acyclic projected parent propagation; and
- removal of stale cuts after replacement or deletion.

Verification does not prove that every retained cut still closes a cycle.
Changing another edge can make a cut conservative without making the projected
graph invalid. Import-focused tests separately prove cut coverage.

## Module ownership

- `src/import.js`: detect, publish, read, and clear cycle cuts.
- `src/meta.js`: store optional `cycleCuts`.
- `src/promise-mirrors.js`: retain exact live or detached Promise-property
  versions.
- `src/property-transitions.js`: coordinate logical property and mirror
  changes.
- `src/refcounts.js`: count triples and update parent graphs.
- `src/observations.js`: counter-fenced Error queries and export policy.
- `src/raw-walk.js`: raw export copying and Error collection.
- `test/verify-refcounts.js`: test-only independent recount and invariants.

## Required coverage

The inline and WeakMap suites cover:

- self-cycles, overlapping cycles, aliases, and cuts shared by several cycles;
- cycles reached from different imported roots;
- ordinary Errors and Promises on both sides of cuts;
- Promise-to-cut, cut-to-Promise, repair, replacement, and deletion deltas;
- cut targets receiving independent indexes;
- alternating Promise/cycle frontiers;
- rejected Promises becoming ordinary Errors;
- COW forks, detached property versions, arrays, enumerable `__proto__`, and
  parent multiplicity;
- writable runtime Promise properties, non-writable imported Promise data
  properties, and invalid accessor placements; and
- verifier failures for wrong counts, stale cuts, crossed parent edges,
  missing mirrors, invalid descriptors, and uncut projected cycles.

For every resolved path:

```text
hasError(chain, path) === (getErrors(chain, path).length > 0)
```

A cycle by itself never makes either side true.
