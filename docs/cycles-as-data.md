# Cycles as valid data

**Status:** Implemented.

Imported cycles are valid data rather than language Errors. The raw
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
- `export` preserves cycles and aliases in its metadata-free output.
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

const copy = runtime.export(chain, [])
copy.self === copy                // true
```

An ordinary Error elsewhere in the cycle remains visible to both Error queries.

## Placement markers

Each selected cycle-closing owner/key property receives a boolean `cycleCut`.
It identifies the exact raw edge omitted from the projected graph.

Storage:

- plain properties use membership in the optional `meta.cycleCuts` Set;
- Promise-backed properties use `mirror.cycleCut`;
- a draining mirror keeps its cut private until final publication; and
- a captured operation reads private mirror state directly when required.

A Promise-backed property stores its cut only on its mirror. Installing a
mirror clears the plain-property slot, and removing or replacing the mirror
cannot reveal stale cut metadata.

`hasPublishedCycleCut(owner, key)` reads only public property state: a plain
property's Set membership or a drained mirror's boolean. A consumer that
captured a draining or revoked mirror reads `mirror.cycleCut` directly.

The raw property is never replaced by the marker.

## Counter projection

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

Cuts are persistent owner/key facts, not choices recomputed for each import or
query root. Refcounts describe this one global projected graph, so the same
tracked identity can keep one counter while being reached through multiple
roots and uncut parent placements. A cut need not be the deepest cycle edge
relative to every such root.

A cut stops count propagation only across its own property. It neither clears
nor resets the raw target's counter. The target can already have a counter
through another parent, or can be indexed independently when an operation
starts on the far side of the cut.

For any raw path from a reached root into data omitted by projection, consider
the first cut on that path. Its owner is reachable through an entirely uncut
prefix, so that cut's `cycleCutCount` contribution reaches the root. Therefore:

- `cycleCutCount === 0`, with no captured private mirror cut, proves that
  `promiseCount` and `errorCount` are complete for that reached root;
- `cycleCutCount > 0` means those totals cover only the projected prefix; an
  operation still needing complete branch knowledge must use raw traversal; and
- aliases propagate a child's projected triple through every uncut parent
  placement with structural multiplicity.

For a cut-free branch, the complete clean predicate is:

```text
clean <=> promiseCount === 0 && errorCount === 0
```

`cycleCutCount` must be an exact propagated count rather than a per-boundary or
monotone boolean. A query can start at an owned ancestor above an imported
cyclic branch, so the fact that a cut exists below must propagate through every
uncut parent placement. Repair must also decrement that contribution and reveal
when the final reachable cut disappears; a boolean would require a rescan, and
a monotone flag could never recover the cut-free fast path.

Different import roots can have different root totals or encounter a cut at
different depths without changing observable results. A given tracked identity
still has only one projected counter.

Settlement depends only on `promiseCount`. Consider a Promise resolving to a
cycle:

```text
before: promiseCount=1, cycleCutCount=0
after:  promiseCount=0, cycleCutCount=1
```

The structural cut remains, but all Promise work has settled. Export's
settlement generation must resolve at this transition.

Therefore:

- `cycleCutCount` selects projected or raw Error-query traversal;
- settlement notification uses `promiseCount`;
- Error fast paths use `errorCount`; and
- a cycle cut is not itself an Error or pending Promise.

A combined stored counter would lose these distinctions.

## Imported preparation and cut selection

Cycle detection remains import-only. Trusted compiler-created data is
tree-shaped under the single-owner/COW contract.

Traversal, alias marking, active-path detection, prepared-island checks,
attachment checks, and Promise FIFO continuation remain as specified in
[Imported graph preparation](import-preparation.md). A detected cycle
publishes a boolean cut instead of an attributed Error.

Only a cut between the earlier occurrence and the closing property covers the
detected cycle. A cut on the path prefix before that occurrence merely hides
the cycle from one root and cannot suppress its internal marker. Projected
preparation normally makes this rule automatic by not descending through an
existing cut; a continuation using captured path state rechecks applicable
private or newly published cuts before adding another.

For example:

```text
B -> C -[cut]-> X -> D -> B
```

The final `D -> B` repeat receives no new cut. The existing `C -> X` cut already
breaks that exact directed cycle, so another marker would be redundant. In
contrast, a cut on an edge before the first `B` would not cover
`B -> C -> X -> D -> B`.

Fresh detached preparation marks the closing back edge of each uncovered cycle.
Fixed-path island and attachment scans retain their entering-placement cut,
because reaching the fixed ancestry proves that placement belongs to the cycle.
This keeps prepared identities safe under other roots and aliases.

Every directed imported cycle has at least one cut before ref-indexing, but cuts
are not globally minimized or relocated across distinct cycles. Several cycles
can share one cut. A scan does not cross an existing cut, so an already covered
cycle does not receive a second cut; an alternate route that bypasses the cut
still receives its own marker.

Import attribution remains necessary for external ownership and unrelated
validation failures; cycle cuts themselves create no Error or Error identity.

## Ref-index and transitions

Index construction does not descend through a cut. It contributes `[0, 0, 1]`
and installs no reverse parent edge through the raw target.

Every live property transaction handles triples:

1. Read old counts and the old counted child.
2. Commit the prepared value, Promise state, or cut update.
3. Read new counts and the new counted child.
4. Replace reverse edges.
5. Propagate all three deltas.

`applyCountDelta` propagates `cycleCutDelta` alongside the Promise and Error
deltas. Settlement logic compares only the old and new `promiseCount`.

Assignment and deletion clear the exact replaced placement's cut. COW
reconstructs cut state from the copy's own prepared placements and never copies
markers blindly.

## Error-query dispatch: whole-branch raw fallback

Both Error queries make one branch-level dispatch:

- a path ending directly at a published or captured private cut enters raw mode
  without requiring the cut target to have a counter;
- an ordinary tracked terminal is indexed, after which
  `cycleCutCount === 0` uses the counter-pruned projected walk; and
- `cycleCutCount > 0` switches the complete reached branch to one
  identity-aware raw walk.

A Promise reached by projected mode applies the same dispatch to its exact
captured resolved branch. A private cut on a draining or revoked mirror selects
raw mode even though attached counters do not contain it. Once raw mode begins,
Promises resume the same raw traversal state without requiring counters or
another dispatch.

**Whole-branch raw fallback is a deliberate design decision.** After any
conclusive counter fast path, a cut-bearing branch is raw-walked from its
reached root. This re-walks the clean projected prefix and forgoes fine-grained
pruning of clean subtrees, keeping the uncommon cyclic case small and avoiding
cut-location tracking.

The raw walk follows logical values without consulting cut metadata. One
operation-local visited set terminates cycles, deduplicates aliases, and spans
every captured Promise continuation. A counterless raw region can be entered
only through a published or captured private cut; after that boundary, its
descendants need no counters. Downward counter closure remains mandatory for
every ordinary projected edge.

## `hasError`

An ordinary Error returns `true`; an untracked value returns `false`. At an
indexed terminal, `errorCount > 0` returns `true` before branch dispatch. A
cut-free branch with `promiseCount === 0` returns `false`; otherwise its
projected Promise walk uses the first-error-versus-completion race.

Raw mode uses the same first-error policy: it returns `true` on the first
synchronously reachable Error, returns `false` when it finds neither Error nor
Promise, and otherwise races the first asynchronous Error against completion of
its hierarchical Promise wait tree. A cut itself never returns `true`.

## `getErrors`

`getErrors` remains exhaustive after the shared dispatch. Its projected mode
prunes a child when both `errorCount` and `promiseCount` are zero; raw mode walks
the complete branch once per identity. Ordinary Error identities enter one
result Set, cuts add nothing, and Promise continuations extend the hierarchical
readiness tree using the same visited and Error sets.

## `export`

Export produces a metadata-free graph copy with one raw identity map. A
terminal cut target enters raw copying directly and may be counterless. An
ordinary tracked terminal is indexed:

1. `promiseCount > 0` waits for the shared settlement generation.
2. After any required projected settlement, `errorCount > 0` takes the generic
   Error fast path.
3. Otherwise one `copyRawBranch` call constructs the output and detects any
   ordinary Error or Promise hidden beyond a cut.

Every non-fast-path tracked branch uses that same raw copy, whether cut-free or
cyclic. `cycleCutCount` selects no second copy algorithm, and no projected cycle
classifier exists. Terminal-cut knowledge is used only at operation entry to
select the counterless raw path; it is not threaded through settlement or
completion.

A synchronous cycle containing no Promise requires no pin merely because it is
cyclic. If the copy captures a Promise, export pins the issue-time branch before
returning its readiness Promise. Ordinary Errors produce export's generic Error
result; [`future/export-error-set.md`](future/export-error-set.md) specifies a
separate complete-Error-set result.

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
- every plain cut key is a string naming an existing own enumerable property
  whose logical value is tracked;
- every private or published mirror cut has a tracked prepared value;
- no reverse parent edge through a Promise or cut;
- downward closure through ordinary tracked edges;
- acyclic projected parent propagation;
- no competing plain cut below a mirrored property; and
- removal of stale cuts on replacement and deletion.

Counterless raw regions are the sole exception to downward counter closure. In
the attached graph, the verifier permits entry into one only through a
published cut. Operation-focused checks permit entry through the exact captured
private mirror cut. Once raw mode begins, descendants are outside the projected
closure requirement; every ordinary projected tracked property must still lead
to a ref-indexed child.

Verification does not prove that every retained cut still closes a cycle.
Changing another edge can make a cut conservative without making it invalid;
the cut is removed when its own placement is replaced or deleted.

Import-focused tests must independently prove that every directed cycle in a
prepared imported graph has at least one cut. Production refcounting continues
to rely on that import contract.

## Module ownership

- `src/import.js`: detect, publish, read, and clear cycle cuts.
- `src/meta.js`: store optional `cycleCuts`.
- `src/promise-mirrors.js`: retain private Promise-placement cut state.
- `src/refcounts.js`: count triples, parent transitions, propagation, COW
  reconstruction, and Promise-only settlement.
- `src/observations.js`: cycle-aware `hasError`, `getErrors`, and export
  policy, including branch-level projected/raw dispatch.
- `src/raw-walk.js`: marker-independent raw copying and Error traversal with
  Promise frontier extension.
- `test/verify-refcounts.js`: test-only independent triple recount and cut invariants.

## Required coverage

Run every case under inline and WeakMap metadata storage:

- self-cycles and overlapping cycles without ordinary Errors;
- ordinary Errors queried from every node in a strongly connected region;
- the same cyclic identities reached from different imported roots, with
  Promises and Errors on both sides of the selected cut; assert exact projected
  triples and identical observations from every root;
- cut coverage where a middle-edge cut suppresses a redundant closing marker,
  a prefix cut does not, and an alternate route bypassing the existing cut
  receives its own marker; assert that the covered cycle receives no second cut
  and include captured private Promise cuts;
- Promises reachable only through cuts, resolving cleanly and to Errors;
- Promise-to-cut and cut-to-Promise transitions with exact ancestor deltas;
- settlement resolving when a Promise becomes a cut even though
  `cycleCutCount` becomes positive;
- aliases, arrays, enumerable `__proto__`, and parent multiplicity;
- COW mutation, deletion, partial repair, and whole-boundary replacement;
- private, live, revoked, and forked Promise-placement cuts;
- paths ending directly at plain published, draining private, and revoked
  captured cuts, including counterless raw targets;
- alternating Promise/cycle frontiers at one captured issue position;
- a known projected Error alongside a pending Promise hidden behind a cut,
  preserving each operation's immediate-versus-exhaustive result policy;
- rejected Promises reachable only through cuts becoming ordinary Errors;
- non-extensible imported holders; and
- verifier failures for wrong cut counts, stale markers, crossed parent edges,
  counterless ordinary tracked edges, non-enumerable or non-tracked cut
  placements, and uncut projected cycles.

Coherence:

```text
hasError(chain, path) === (getErrors(chain, path).length > 0)
```

The assertion applies whenever path resolution reaches a value or ordinary
Error. A cycle by itself never makes either side true.
