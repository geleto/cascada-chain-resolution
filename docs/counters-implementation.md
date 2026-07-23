# Subtree counters

Subtree counters are a lazy index over the projected logical graph. Each
indexed node stores independent totals for pending Promises, ordinary Errors,
and cycle cuts.

```text
cut-free complete <=> promiseCount === 0 && cycleCutCount === 0
cut-free clean    <=> promiseCount === 0 &&
                      errorCount === 0 &&
                      cycleCutCount === 0
```

Counters describe pending and broken content. The shared mark describes
ownership. Neither substitutes for the other.

## Counter metadata

Ref-indexing adds four fields to the node's META record:

- `promiseCount`: exact pending Promise placements in the projected subtree;
- `errorCount`: exact Error placements in the projected subtree; and
- `cycleCutCount`: exact projected cycle-cut placements; and
- `parents`: `Map<parentNode, edgeCount>` for reverse indexed edges.

`parents === undefined` means the node is not ref-indexed. An empty Map means it
is indexed but currently has no indexed parent. Multiplicity matters: if one
parent references the same child under two keys, the child records edge count
two for that parent.

Other META fields belong to their own subsystems. Promise mirrors and cycle
cuts affect property contributions, shared/import fields affect
ownership and preparation, and settlement fields exist only while
export waits.

Inline metadata uses an own non-enumerable Symbol when possible. WeakMap mode,
and inline mode's fallback for non-extensible nodes, provide identical
semantics.

## Property projection

Counts belong to owner/key placements, not blindly to physical values.
`getPropertyRefState(parent, key)` returns the placement's `counts` contribution
and its logical `child` for reverse-edge bookkeeping:

| Logical property state | Contribution |
| --- | --- |
| Unresolved or draining live mirror | `[1, 0, 0]` |
| Published cycle cut | `[0, 0, 1]` |
| Ordinary Promise | `[1, 0, 0]` |
| Ordinary Error | `[0, 1, 0]` |
| Indexed tracked child | Child totals |
| Primitive or missing value | `[0, 0, 0]` |

Pending mirrors and cycle cuts return no child. Other states return their
logical value; only a tracked child receives a reverse parent edge.

`hasPublishedCycleCut(parent, key)` reads only the state published by the live
property:

- a plain property checks `meta.cycleCuts`;
- a drained mirror reads `mirror.cycleCut`; and
- a draining mirror returns `false` because the property still contributes
  `[1, 0, 0]`.

An operation that captured a mirror may read its private `mirror.cycleCut`
before publication. Private FIFO state never contributes to parent counters.

Every ordinary tracked child below an indexed parent is indexed. A missing
child counter is a fatal downward-closure violation.

## Building the index

`buildRefIndex(value, inheritedImportBoundary)` is the entry for initial
indexing.

Trusted compiler-created data is tree-shaped under the single-owner/COW
contract and needs no cycle table. Imported data has already been prepared:
cycle-closing properties are cut, aliases are marked shared, and pending
properties have mirrors plus their import consumers. Details live in
[`import-preparation.md`](import-preparation.md).

Index construction walks the prepared projection:

1. A draining mirror contributes `[1, 0, 0]` and is not entered.
2. A cycle cut contributes `[0, 0, 1]` and is not entered.
3. An ordinary tracked child is indexed recursively and receives a reverse
   parent edge.
4. Existing compatible indexed subtrees may be connected without recounting
   their descendants.
5. Structural aliases add exact edge multiplicity.

The first counter operation reached inside an import boundary may begin at the
stored boundary root so the complete projected ancestry is represented.

Frozen, sealed, and otherwise non-extensible nodes use the same index rules.
Only metadata storage and physical write policy differ.

## Property transitions

New values are prepared before they enter an attached indexed graph.

`preparePropertyTransition(owner, propertyMirror, newValue)` performs the
non-publishing work:

- preserve or establish import state;
- prepare a child mirror value when applicable; and
- build the entering child's index if the owner is already indexed.

Descriptor failures are checked before preparation. A fatal preparation leaves
the attached edge unchanged.

Every live assignment, deletion, cycle-cut change, and successful final
mirror drain uses one synchronous commit transaction:

1. Snapshot the old projected counts and counted child.
2. Perform the validated physical/mirror/cycle update.
3. Read the new projected counts and counted child.
4. Remove and add reverse edges as needed.
5. Propagate exactly one count delta.

The commit is atomic in the JavaScript execution sense: no other operation can
interleave with the synchronous transition. It does not attempt rollback after
an internal fatal failure.

A newly assigned Promise installs a fresh mirror and immediately contributes
`[1, 0, 0]`. Deletion removes only the old contribution. Revoked mirror state is
private and never enters the former parent's transaction.

`copyCounters` reconstructs an indexed COW copy from the copy's own logical
properties. It never clones source totals, parent maps, or placement-specific
cycle cuts.

## Promise-mirror drain

One internal `PromiseMirror` represents one Promise-backed property version.
Every consumer registers through `mirror.onResolve(...)`; `isDrained()` and
`isLive()` keep pending visibility independent from property liveness, while
`setValue(...)` owns prepared logical-value updates.

Registration:

1. increments `pendingConsumerCount` synchronously;
2. registers directly on the raw source Promise at the caller's issue position;
3. converts a source rejection to a language Error value;
4. runs the consumer's synchronous body; and
5. decrements after successful completion.

The mandatory writeback is the first consumer. Import preparation, mutation and
observation continuations, COW forks, and Error-query waits use the same
ordering mechanism.

While `pendingConsumerCount > 0`, the attached placement remains `[1, 0, 0]`.
Consumers prepare successive private `currentValue` states in FIFO order, but
the parent contribution does not bounce through intermediate values.

The final successful consumer performs one drain:

1. capture the old `[1, 0, 0]` contribution;
2. refresh child preparation if the owner became indexed;
3. commit the final logical value or cycle cut if the mirror is live;
4. decrement the count to zero inside that transition; and
5. read and propagate the final property contribution.

Zero means the source resolved, every registered consumer completed its
synchronous work, and final publication succeeded. This closes the
settlement-to-writeback race: a later read cannot use a synchronous settled
value while an earlier registered mutation is still queued.

A synchronous fatal consumer leaves its count outstanding and prevents final
publication. A revoked mirror reaches its private final state but performs no
attached-edge commit.

## Logical reads

`readLanguageProperty(parent, key)` returns:

- the original Promise while a live mirror is draining;
- `mirror.currentValue` after that mirror drains; or
- the own enumerable physical property when no mirror exists.

Returning the Promise while draining forces the caller to register behind every
earlier consumer. Returning `currentValue` after drain also handles a legitimate
settled `undefined`.

Imported-original and non-extensible holders may retain their physical Promise
permanently. Logical reads therefore remain mirror-aware after settlement.

A mirrored property stores its cycle cut exclusively on the mirror.
Installing or removing a mirror clears competing plain-property cycle metadata,
so an old cut cannot reappear after transition.

## Delta propagation

`applyCountDelta(node, promiseDelta, errorDelta, cycleCutDelta)` updates one
indexed node and propagates all three deltas through every reverse parent edge,
multiplied by that edge's count.

The projected parent graph is acyclic:

- trusted language data is tree-shaped;
- imported aliases retain finite edge multiplicity;
- Promise placements are frontiers while draining; and
- every imported cycle has a cut with no reverse edge.

Zero deltas stop immediately.

## Settlement

When export must wait, the reached indexed node receives one shared
settlement generation:

- `settlementPromise`; and
- `settlementResolve`.

Concurrent exports of that branch share the generation. When
`promiseCount` reaches zero, `applyCountDelta` clears both fields and resolves
the generation immediately.

No extra verification microtask is needed. The mirror remains `[1, 0, 0]` until
all consumers at earlier FIFO positions have finished, so the zero crossing is
already final for that issue-time world.

`hasError` and `getErrors` do not use this shared settlement state. Each owns
its captured Promise wait tree and does not pin the branch.

## Consumers

### `export`

Export indexes the reached path value and waits for `promiseCount` to reach
zero when necessary. A positive `errorCount` then takes the Error fast path.
Otherwise one raw identity-aware walk creates the metadata-free copy and finds
Promises or Errors hidden behind cuts.

### `hasError`

`errorCount > 0` answers `true` immediately. With `cycleCutCount === 0`, the
operation follows only relevant projected Promises. With a positive cut count,
it raw-walks the complete reached branch and resolves on the first ordinary
Error or complete clean frontier.

### `getErrors`

Counters prune clean cut-free projected regions. A positive `cycleCutCount`
switches the complete reached branch to raw traversal. Ordinary Error
identities enter one operation-local Set; cuts add nothing.

Only the initial value reached by path resolution calls `buildRefIndex`.
Resolved child branches are prepared and, when required by downward closure,
indexed by mirror processing before query continuations inspect them.

## Verification

`verifyRefCounts` independently:

- recounts every projected logical placement;
- compares exact Promise, Error, and cycle-cut totals;
- checks reverse-edge multiplicity;
- checks downward closure;
- verifies cut shape and mirror/plain exclusivity; and
- treats a cycle in the projected parents graph as a fatal invariant failure.

A draining mirror always recounts as `[1, 0, 0]`, regardless of its physical or
private prepared value. Verification never changes runtime state.
