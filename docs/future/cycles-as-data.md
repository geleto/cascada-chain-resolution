# Cycles as valid data

**Status:** Chosen future design; not implemented.

This plan makes imported cycles valid data rather than language Errors. The raw
graph, eager import preparation, Promise FIFO ordering, copy-on-write ownership,
and acyclic projected refcount graph remain unchanged.

The central rule is:

> A cycle-closing property is a structural traversal frontier, not an Error and
> not a Promise.

The runtime still detects and marks cycle-closing properties. Ref-indexing cuts
those properties to keep reverse-parent propagation acyclic, while path
operations and cycle-aware observations continue through their raw values.

## Observable behavior

- Lookup and mutation follow cycle-closing properties normally.
- A cycle containing no ordinary Error makes `hasError` return `false`.
- `getErrors` never includes a diagnostic merely because a cycle exists.
- `normalize` preserves cycles and aliases in its metadata-free output.
- Promises reachable only through a cut are still observed when an operation
  requires complete branch knowledge.
- Imported host objects remain physically unchanged.
- Replacing or deleting a cycle-closing property removes its cut metadata.

Example:

```js
const external = {}
external.self = external

const value = runtime.import(external, "native cycle")
const chain = new runtime.Chain(value)

runtime.hasError(chain, [])       // false
runtime.getErrors(chain, [])      // []

const copy = runtime.normalize(chain, [])
copy.self === copy                // true
```

An ordinary Error elsewhere in the cycle remains visible to both Error queries.

## Placement markers

Each selected cycle-closing owner/key property receives a boolean `cycleCut`.
It identifies the exact raw edge omitted from the projected graph.

Storage:

- plain properties use `meta.cycleCuts[key]`;
- Promise-backed properties use `mirror.cycleCut`;
- a draining mirror keeps its cut private until final publication; and
- a captured operation reads private mirror state directly when required.

A Promise-backed property stores its cut only on its mirror. Installing a
mirror clears the plain-property slot, and removing or replacing the mirror
cannot reveal stale cut metadata.

The raw property is never replaced by the marker.

## Counter schema

Ref-indexed nodes store three independent totals:

- `promiseCount`: pending or draining Promise placements;
- `errorCount`: ordinary Error placements; and
- `cycleCutCount`: projected cycle-cut placements.

`cycleCutCount` includes structural multiplicity through aliases. It does not
count mathematically distinct cycles.

Property contributions are triples:

| Logical property state | Contribution |
| --- | --- |
| Pending or draining mirror | `[1, 0, 0]` |
| Cycle cut | `[0, 0, 1]` |
| Ordinary Promise | `[1, 0, 0]` |
| Ordinary Error | `[0, 1, 0]` |
| Indexed tracked child | Child totals |
| Primitive or missing value | `[0, 0, 0]` |

No reverse parent edge crosses a pending mirror or cycle cut.

The clean predicate ignores valid cycles:

```text
clean <=> promiseCount === 0 && errorCount === 0
```

Operations that must cross both asynchronous and cyclic frontiers derive:

```text
frontierCount = promiseCount + cycleCutCount
```

This sum is a traversal fence, not stored state.

## Separate Promise and cycle counts

Settlement depends only on `promiseCount`. Consider a Promise resolving to a
cycle:

```text
before: promiseCount=1, cycleCutCount=0
after:  promiseCount=0, cycleCutCount=1
```

The derived frontier remains one, but all Promise work has settled.
Normalization's settlement generation must resolve at this transition.

Therefore:

- traversal pruning uses `promiseCount + cycleCutCount`;
- settlement notification uses `promiseCount`;
- Error fast paths use `errorCount`; and
- cleanliness ignores `cycleCutCount`.

A combined stored counter would lose these distinctions.

## Imported preparation

Cycle detection remains import-only. Trusted compiler-created data is
tree-shaped under the single-owner/COW contract.

The existing preparation walks retain their structure:

1. A fresh detached DFS checks each value against its active path.
2. An active-path repeat marks the incoming property with `cycleCut` and does
   not enter it.
3. A repeated alias is marked shared.
4. A prepared-island or attachment scan checks against its fixed entering
   ancestry.
5. A Promise captures the applicable path and resumes through its placement
   state at the correct FIFO position.

Every directed imported cycle must contain at least one cut before
ref-indexing. Fixed-path matches continue to propagate to the entering
placement, preventing placement-dependent cuts on shared inner nodes.

Import attribution remains necessary for external ownership and unrelated
validation failures, but no cycle Error message or Error identity is created.

## Ref-index and transitions

Index construction does not descend through a cut. It contributes `[0, 0, 1]`
and installs no reverse parent edge through the raw target.

Every live property transaction handles triples:

1. Read old counts and the old counted child.
2. Commit the prepared value, Promise state, or cut update.
3. Read new counts and the new counted child.
4. Replace reverse edges.
5. Propagate all three deltas.

`applyCountDelta` gains `cycleCutDelta`. Settlement logic still compares only
the old and new `promiseCount`.

Assignment and deletion clear the exact replaced placement's cut. COW
reconstructs cut state from the copy's own prepared placements and never copies
markers blindly.

## Frontier traversal

A frontier-aware walk prunes an indexed child only when the operation-relevant
counts are zero. At each property it distinguishes:

- a Promise, which registers through its captured placement state;
- a cycle cut, whose raw value is followed synchronously with an
  operation-local visited set; and
- an ordinary indexed child, whose counters determine whether entry is needed.

One visited set spans projected traversal, raw traversal through cuts, and all
Promise continuations captured by the operation. This prevents recursion while
preserving issue-time Promise state.

Counterless raw targets reached through cuts are walked directly; downward
closure is required only for ordinary projected edges.

## `hasError`

At a reached tracked branch:

1. `errorCount > 0` returns `true`.
2. A zero Promise/cycle frontier returns `false`.
3. Otherwise walk both frontier kinds.
4. A cut contributes no result; follow its raw value.
5. An ordinary Error returns `true`.
6. A Promise extends the existing first-error-versus-completion wait.

Walking cuts is required because a projected `errorCount` can be capped by a
cycle edge. The result must not depend on which DFS edge preparation selected
as the cut.

## `getErrors`

`getErrors` uses the same frontier mechanics but remains exhaustive:

- ordinary Error identities enter the result Set;
- cycle cuts add no result and expose their raw values;
- Promise continuations extend the hierarchical readiness tree; and
- the same visited and Error sets span synchronous and asynchronous segments.

A child is prunable only when its `errorCount`, `promiseCount`, and
`cycleCutCount` are all irrelevant to the remaining search.

## `normalize`

Normalization continues to produce a metadata-free graph copy with one raw
identity map.

- `promiseCount` controls the shared settlement generation.
- `cycleCutCount` never keeps settlement pending.
- A cut-free branch retains the existing counted fast path.
- A branch with cuts follows raw values and recursively captures Promises hidden
  beyond the projected frontier.
- A synchronous cycle containing no Promise requires no pin merely because it
  is cyclic.
- Ordinary Errors retain normalization's implemented Error behavior until the
  separate complete-error-set plan is implemented.

If raw traversal captures a Promise, normalization pins the issue-time branch
before returning its readiness Promise.

## Path operations and ownership

Finite `lookupPath`, `assignPath`, and `deletePath` ignore cut metadata and
follow raw logical values. Their explicit path length guarantees termination.

Imported roots and repeated identities remain shared. Mutation COWs before the
first write, so host data remains unchanged. A copied placement receives a cut
only if preparation establishes that the new placement closes a cycle.

## Verification

`verifyRefCounts` must verify:

- exact `promiseCount`, `errorCount`, and `cycleCutCount`;
- `[1, 0, 0]` for every draining mirror;
- `[0, 0, 1]` for every published cut;
- no reverse parent edge through a Promise or cut;
- downward closure through ordinary tracked edges;
- acyclic projected parent propagation;
- no competing plain cut below a mirrored property; and
- removal of stale cuts on replacement and deletion.

Import-focused tests must independently prove that every directed cycle in a
prepared imported graph has at least one cut. Production refcounting continues
to rely on that import contract.

## Module ownership

- `src/import.js`: detect, publish, read, and clear cycle cuts.
- `src/meta.js`: store optional `cycleCuts`.
- `src/promise-mirrors.js`: retain private Promise-placement cut state.
- `src/refcounts.js`: count triples, parent transitions, propagation, COW
  reconstruction, and Promise-only settlement.
- `src/index.js`: cycle-aware `hasError`, `getErrors`, and normalization policy.
- `src/raw-walk.js`: raw traversal through cuts and Promise frontier extension.
- `src/verify-refcounts.js`: triple recount and cut invariants.

## Implementation order

The counter tuple width and cycle semantics must land atomically:

1. Replace cycle-Error storage with boolean cycle-cut storage.
2. Add `cycleCutCount` to construction, property contributions, propagation,
   COW reconstruction, and verification.
3. Keep settlement keyed exclusively to `promiseCount`.
4. Make Error queries follow Promise and cycle frontiers without reporting cuts.
5. Remove cycle-only Error classification from normalization.
6. Update import preparation, Promise drain, attachment, replacement, and
   deletion to publish or clear cuts.
7. Remove cycle Error creation, attribution, and identity expectations.
8. Update current-state documentation after both metadata modes pass.

## Required coverage

Run every case under inline and WeakMap metadata storage:

- self-cycles and overlapping cycles without ordinary Errors;
- ordinary Errors queried from every node in a strongly connected region;
- Promises reachable only through cuts, resolving cleanly and to Errors;
- Promise-to-cut and cut-to-Promise transitions with exact ancestor deltas;
- aliases, arrays, enumerable `__proto__`, and parent multiplicity;
- COW mutation, deletion, partial repair, and whole-boundary replacement;
- private, live, revoked, and forked Promise-placement cuts;
- alternating Promise/cycle frontiers at one captured issue position;
- non-extensible imported holders; and
- verifier failures for wrong cut counts, stale markers, crossed parent edges,
  and uncut projected cycles.

Coherence:

```text
hasError(chain, path) === (getErrors(chain, path).length > 0)
frontierCount === promiseCount + cycleCutCount
```

The first assertion applies whenever path resolution reaches a value or
ordinary Error. A cycle by itself never makes either side true.
