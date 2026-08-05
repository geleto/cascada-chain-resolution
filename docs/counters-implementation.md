# Subtree counters

Subtree counters are a lazy index over an acyclic projection of the logical
graph. They describe pending Promises, Errors, and the cuts that keep cyclic
data out of reverse propagation.

## Metadata

Each indexed tracked identity stores:

- `promiseCount`: pending Promise placements in its projected subtree;
- `errorCount`: Error placements in its projected subtree;
- `cycleCutCount`: cut placements in its projected subtree; and
- `parents`: `Map<parent, multiplicity>` for reverse projected edges.

`parents === undefined` means unindexed. An empty map means indexed with no
projected parent. Shared/import marks describe ownership and are independent of
these counters.

## Property projection

| Logical property | Contribution | Counted child |
| --- | --- | --- |
| Pending Promise | One Promise | None |
| Cycle cut | One cycle cut | None |
| Error | One Error | None |
| Indexed tracked value | Child totals | The value |
| Other value | None | None |

Every raw-reachable tracked value beneath an indexed root is indexed. Cuts
separate that raw graph into projected components; their targets have
independent counters.

## Building an index

`buildRefIndex(value)` recursively indexes each component. An edge to an
identity on the active DFS path becomes a cut and its target is queued. The
current component is fully published before queued targets are indexed, so a
back edge cannot re-enter an active frame. A completed indexed child can be
connected directly, preserving exact alias multiplicity.

Promise placements receive mirrors during this walk but are not entered until
their logical values publish. `parents` is installed last, after all properties
and required mirrors are complete.

This algorithm accepts cyclic runtime and imported data equally. Import does
not prepare the graph for ref-indexing.

## Publishing an indexed edge

Before a tracked value enters an indexed container, Cascada indexes it. The new
edge closes a projected cycle exactly when walking upward from the container
through the maintained `parents` DAG reaches that value. Such an edge becomes a
cut; every other edge receives the normal reverse-parent entry.

`commitLiveEdge` performs one synchronous transition:

1. capture the old property's counted child and counts;
2. publish its logical value, mirror, and cut state;
3. capture the new child and counts;
4. replace reverse-parent multiplicities; and
5. propagate the count delta once over the reachable parent DAG.

Assignment, deletion, Promise settlement, Array remapping, and COW
reconstruction all use this accounting. Detached mirror values are private;
they are indexed when their former owner is indexed, but contribute no edge to
that owner.

An indexed COW copy is indexed from its own logical properties. Source totals,
parents, mirrors, and cuts are never copied as metadata.

## Promise mirrors

One `PromiseMirror` represents one property version. A logically pending
property contributes one pending Promise. Its first FIFO resolver publishes the
result through the same property transition as an ordinary assignment.

Each mirror's `value` is the authoritative logical edge. Imported physical
properties keep their Promise, runtime-owned live properties also write through,
and detached versions retain their private mirror value. These storage choices
do not change the counter rules.

Distinct logical ArrayView properties have distinct mirrors even when they
share a physical slot. Refcounting reads each mirror's logical edge, independent
of changes another view made to the backing slot.

## Delta propagation

For each nonzero delta, a memoized DFS derives the reachable reverse-parent DAG
and records parent-first postorder. Traversing that order in reverse multiplies
each edge by its stored multiplicity, sums every path into one multiplier per
node, and applies the scaled counts once to each node. This takes `O(V + E)`
time and `O(V)` operation-local state without persistent topology.

The parent graph is a DAG by construction: pending properties and cuts have no
reverse edge, initial indexing cuts DFS back edges, and later edge publication
checks the existing parent DAG before committing.

## Consumers and verification

`hasError` and `getErrors` fence their walks with all three counters. At a cut,
they continue from its independently indexed target. Export instead walks the
raw graph and never builds or reads counters.

The test verifier independently recounts property contributions, raw-reachable
index closure, reverse-edge multiplicity, cut and mirror shape, and parent-DAG
acyclicity. It uses direct import status when deciding whether a physical
Promise may be preserved; physical shape is not an ownership proxy.
