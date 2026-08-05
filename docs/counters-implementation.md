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
| Pending Promise | `[1, 0, 0]` | None |
| Cycle cut | `[0, 0, 1]` | None |
| Error | `[0, 1, 0]` | None |
| Indexed tracked value | Child totals | The value |
| Other value | `[0, 0, 0]` | None |

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

1. capture the old property's counted child and triple;
2. publish its logical value, mirror, and cut state;
3. capture the new child and triple;
4. replace reverse-parent multiplicities; and
5. propagate the triple delta through `parents`.

Assignment, deletion, Promise settlement, Array remapping, and COW
reconstruction all use this accounting. Detached mirror values are private;
they are indexed when their former owner is indexed, but contribute no edge to
that owner.

An indexed COW copy is indexed from its own logical properties. Source totals,
parents, mirrors, and cuts are never copied as metadata.

## Promise mirrors

One `PromiseMirror` represents one property version. A logically pending
property contributes `[1, 0, 0]`. Its first FIFO resolver publishes the result
through the same property transition as an ordinary assignment.

Imported physical Promise properties keep their Promise and expose the logical
result through `resolvedValue`; runtime-owned properties write through. A
detached version uses `detachedValue`. These storage choices do not change the
counter rules.

Distinct logical ArrayView properties have distinct mirrors even when they
share a physical slot. Their settlement supplies the known old pending
contribution because another view may already have changed the backing slot.

## Delta propagation

Count deltas propagate through each reverse parent edge multiplied by its
multiplicity. The parent graph is a DAG by construction: pending properties and
cuts have no reverse edge, initial indexing cuts DFS back edges, and later edge
publication checks the existing parent DAG before committing.

## Consumers and verification

`hasError` and `getErrors` fence their walks with all three counters. At a cut,
they continue from its independently indexed target. Export instead walks the
raw graph and never builds or reads counters.

The test verifier independently recounts property contributions, raw-reachable
index closure, reverse-edge multiplicity, cut and mirror shape, and parent-DAG
acyclicity. It uses direct import status when deciding whether a physical
Promise may be preserved; physical shape is not an ownership proxy.
