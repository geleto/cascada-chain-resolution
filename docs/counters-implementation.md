# Subtree counters

Subtree counters are a lazy index over an acyclic projection of the logical
graph. They describe pending Promises, Errors, and the cuts that keep cyclic
data out of reverse propagation.

## Metadata

Each indexed traversable identity stores:

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
| Indexed traversable value | Child totals | The value |
| Other value | None | None |

Every raw-reachable traversable value beneath an indexed root is indexed. Cuts
separate that raw graph into projected components; their targets have
independent counters.

## Building an index

`buildRefIndex(value, operationContext)` prepares one complete region in an
operation-local map, reusing already-complete indexes:

1. Discover unindexed traversable identities and capture each logical property
   version. Reads normalize newly reached placements and install mirrors only
   for actually pending outcomes.
2. Finish discovery of captured mirrors advanced by later synchronous
   subscriptions. Reuse their current logical values without another
   subscription or physical-slot read; repeat only while newly available work
   advances the frontier. Still-pending versions remain pending edges.
3. Count the captured graph with a DFS. An edge to an active identity becomes a
   staged cut; other traversable edges contribute child totals and staged
   reverse-parent additions. An index completed independently by shared
   settlement during discovery is reused.
4. Commit every prepared counter and cut, then add the reverse edges, including
   additions to existing indexes, in one synchronous transition with no host
   reflection or subscriptions.

All fallible reflection and logical-value preparation precede this commit.
An abandoned build publishes no partial index, cut, or reverse-parent edge.
Ordinary normalization and shared property settlement remain valid independent
transitions; the build does not roll them back. Index presence always denotes a
complete downward-closed region, including its cut targets. A descendant cannot
be published while a cut still reaches an unfinished ancestor.

This algorithm accepts cyclic runtime and imported data equally. Import does
not prepare the graph for ref-indexing. No cut-target queue or persistent
construction state is needed.

## Publishing an indexed edge

Before a traversable value enters an indexed container, Cascada indexes it. The new
edge closes a projected cycle exactly when walking upward from the container
through the maintained `parents` DAG reaches that value. Such an edge becomes a
cut; every other edge receives the normal reverse-parent entry.

`prepareLiveEdge` completes fallible child indexing, captures the old and new
property contributions, and prepares the reverse-parent count delta. Its returned
commit publishes the logical value, mirror, and cut state, replaces reverse-parent
multiplicities, and applies that delta once over the reachable parent DAG.

Assignment, deletion, Promise settlement, Array remapping, and COW
reconstruction all use this accounting. Detached mirror values are private;
they are indexed when their former owner is indexed, but contribute no edge to
that owner.

An indexed COW copy is indexed from its own logical properties. Source totals,
parents, mirrors, and cuts are never copied as metadata.

## Promise mirrors

One `PromiseMirror` represents one actually pending property version. A logically pending
property contributes one pending Promise. Its first FIFO resolver publishes the
result through the same property transition as an ordinary assignment.

Each mirror's `value` is the authoritative logical edge. Imported physical
properties keep their Promise, runtime-owned live properties also write through,
and detached versions retain their private mirror value. A synchronously
consumed custom thenable contributes its final logical value directly, or
through a fixed overlay over imported storage, and has no pending count. These
storage choices do not change the counter rules.

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

Each Error query implements the common operation-lifecycle owner while keeping only query-local visited and Error-collection state. After `hasError` succeeds early, a captured Promise version in the still-live execution maintains shared counters when it publishes, but the closed query performs no further indexing or traversal. If the execution is fatal, a resumed continuation stops before counter publication because that execution's graph is no longer observable. `getErrors` otherwise exhausts its complete captured frontier.

The test verifier independently recounts property contributions, raw-reachable
index closure, reverse-edge multiplicity, cut and mirror shape, and parent-DAG
acyclicity. It uses direct import status when deciding whether a physical
Promise may be preserved; physical shape is not an ownership proxy.
