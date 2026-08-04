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
ownership and preparation.

Inline metadata uses an own non-enumerable Symbol on runtime-owned nodes.
Imported metadata and all metadata in WeakMap mode live externally.

## Property projection

Counts belong to owner/key placements. `getPropertyRefState(parent, key)`
returns the placement's `counts` contribution and counted `child` for
reverse-edge bookkeeping:

| Property state | Contribution |
| --- | --- |
| Logical Promise | `[1, 0, 0]` |
| Published cycle cut | `[0, 0, 1]` |
| Error | `[0, 1, 0]` |
| Indexed tracked child | Child totals |
| Primitive or missing value | `[0, 0, 0]` |

Promises and cycle cuts return no child. Other states return the logical value;
only an indexed tracked child receives a reverse parent edge. A logical Promise
and a cycle cut on the same placement are invalid.

A retained live mirror does not alter the contribution after its first resolver
has published the logical result. It remains only as property-version identity
for already-registered resolvers.

Distinct ArrayViews have distinct property mirrors. A retained view mirror may
settle after its source mirror has already changed their shared backing slot;
its transition replaces the view edge's known `[1, 0, 0]` contribution instead
of recapturing that physical old value.

Every tracked value reachable in the raw graph below an indexed root is
indexed. Ordinary properties connect those counters through reverse parent
edges; cuts separate them into independent components. A missing child counter
is a fatal raw-closure violation.

## Building the index

`buildRefIndex(value, inheritedImportBoundary)` is the entry for initial
indexing.

Trusted compiler-created data is tree-shaped under the single-owner/COW
contract and needs no cycle table. Imported data has already been prepared:
cycle-closing properties are cut, aliases are marked shared, and pending
properties have mirrors plus their import consumers. Details live in
[`import-preparation.md`](import-preparation.md).

Index construction walks the prepared graph as cut-separated projected
components:

1. A logical Promise contributes `[1, 0, 0]` and is not entered.
2. A cycle cut contributes `[0, 0, 1]`, installs no reverse edge, and queues its
   tracked target as the root of another component.
3. An ordinary tracked child is indexed recursively and receives a reverse
   parent edge.
4. Existing compatible indexed subtrees may be connected without recounting
   their descendants.
5. Structural aliases add exact edge multiplicity.

Queued cut targets are processed only after the component that found them is
published. A closing back edge can therefore point to that completed component
without re-entering an active recursive frame. The queue grows as later
components expose more cuts, so one `buildRefIndex` call indexes every
raw-reachable tracked value.

An unresolved Promise has no target to index yet. Its first resolver indexes a
tracked result before publishing it when the owner is indexed. A detached
mirror also indexes its private tracked result before an earlier query consumes
it.

The `parents` map is also the completed-index marker used by Promise-mirror
acquisition. It is published only after the node's property scan has created
every required mirror and computed the complete counter triple. Once present,
a Promise property without a mirror is fatal downward-closure
corruption.

Index construction starts at the branch requested by the counter operation. It
does not widen that work to the stored import root or unrelated imported
siblings.

Frozen, sealed, and otherwise non-extensible nodes enter through import and use
the same index rules. Imported Promise data properties need not be writable.
Runtime-owned Promise properties write through and therefore must be writable.

## Property transitions

New values are prepared before they enter an attached indexed graph.

`propertyTransitions.replaceProperty(owner, key, propertyMirror, newValue)`
asks refcounting to index the entering child when the owner is already indexed,
then publishes the property and its optional Promise mirror through one
live-edge transaction.

The property shape is checked before mirror creation and a live write-through
is revalidated before its commit. A fatal transition does not publish an edge.

Every live assignment, deletion, cycle-cut change, and ordinary Promise resolver
update is performed by `src/property-transitions.js` or `src/import.js` inside
one `refcounts.commitLiveEdge` transaction:

1. Snapshot the old projected counts and counted child.
2. Perform the validated logical property, mirror, and cycle-cut update.
3. Read the new projected counts and counted child.
4. Remove and add reverse edges as needed.
5. Propagate exactly one count delta.

The commit is atomic in the JavaScript execution sense: no other operation can
interleave with the synchronous transition. It does not attempt rollback after
an internal fatal failure.

A retained ArrayView mirror uses the same transition with its known old
pending-Promise contribution because another mirror may already have updated
the shared physical slot.

A newly assigned Promise installs a fresh mirror and immediately contributes
`[1, 0, 0]`. Deletion removes only the old contribution. Detached mirror state
is private and never enters the former parent's transaction.

Because cut targets already own counters, clearing or replacing a cut uses the
ordinary property transaction: it reconnects the new child if applicable and
propagates the exact triple without a conditional indexing path.

`indexValueIfSourceIndexed` reconstructs a COW copy's index from the copy's own
logical properties when the source was indexed. It never clones source totals,
parent maps, or placement-specific cycle cuts.

## Promise mirrors

One internal `PromiseMirror` represents one Promise-backed property version.
While it is live, the physical property is normally authoritative. A mirror
whose property belongs to imported data retains its import boundary, preserves
that property, and stores its logical value in `resolvedValue`. Assigned and
discovered mirrors use `resolveInitialValueOrPoison`; forks use
`onLaterPromiseReady` and sample their source mirror at the fork position. A
fork mirror is runtime-owned and writes through. All resolvers for one callable
thenable register on its shared canonical Promise.

Replacing or deleting the property detaches its mirror inside the same live
transition. Detachment moves the current logical value to `detachedValue`,
removes any `resolvedValue`, and removes the map entry. Already-issued resolvers
then update only that private value. Detached state contributes nothing to the
former parent's counters.

A live resolved mirror remains installed because queued resolvers still use its
identity. It stores no Promise, parent, key, consumer count, or cycle cut; its
only optional value fields are `resolvedValue` while preserving an imported
property and `detachedValue` after displacement.

A state-changing live resolver:

1. validates a write-through property immediately before changing it;
2. prepares and indexes the entering tracked value when required;
3. captures the old contribution, using the known pending state for a retained
   ArrayView fork whose physical slot has already advanced;
4. writes the physical property or private `resolvedValue` together with the
   cycle-cut state; and
5. updates reverse edges and propagates one exact delta.

The resolver performs any import preparation and cycle classification before
publication. A rejected first result is published as one Error; later readiness
callbacks do not convert the rejection again.

## Logical reads

`readLanguageProperty(parent, key)` first returns `resolvedValue` from the
current live mirror when present, then falls back to the own enumerable physical
property. A captured mirror reads its own overlay or the physical property while
live and `detachedValue` afterward.

## Delta propagation

`applyCountDelta(node, promiseDelta, errorDelta, cycleCutDelta)` updates one
indexed node and propagates all three deltas through every reverse parent edge,
multiplied by that edge's count.

The projected parent graph is acyclic:

- trusted language data is tree-shaped;
- imported aliases retain finite edge multiplicity;
- logical Promise placements are frontiers; and
- every imported cycle has a cut with no reverse edge.

Zero deltas stop immediately.

## Consumers

Subtree counters serve Error queries. Export does not build or read the index;
its raw copy-or-collect walk must visit the complete branch on success and owns
its Promise readiness directly.

### `hasError`

`errorCount > 0` answers `true` immediately. Otherwise the operation uses all
three counters to fence its indexed walk. A positive `cycleCutCount` guides the
walk to actual cut placements, whose independently indexed targets resume the
same fenced traversal. `hasError` resolves on the first ordinary Error or the
complete clean frontier.

### `getErrors`

A counter-fenced walk prunes subtrees whose complete counter triple is zero.
At actual cut placements, the target resumes through its independent index.
Ordinary Error identities enter one operation-local Set; cuts add nothing.

Only the initial value reached by path resolution calls `buildRefIndex`.
Resolved child branches are prepared and, when required by downward closure,
indexed by their first resolver before query continuations inspect them.

## Verification

`verifyRefCounts` independently:

- recounts every projected logical placement;
- compares exact Promise, Error, and cycle-cut totals;
- checks reverse-edge multiplicity;
- checks raw-reachable counter closure, including across cuts;
- verifies cut shape, logical Promise/cut exclusivity, and live mirror property
  descriptors; and
- treats a cycle in the projected parents graph as a fatal invariant failure.

A logical Promise always recounts as `[1, 0, 0]`. A live `resolvedValue` is
counted like an ordinary property value. Verification never changes runtime
state.
