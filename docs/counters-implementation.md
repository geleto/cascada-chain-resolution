# Graph presence summaries

Presence summaries are a lazy index over an acyclic projection of the logical
graph. They identify Error presence and whether pending Promises or cycle cuts require
further query traversal, without counting paths through aliases.

## Metadata

Each indexed traversable identity stores:

- `frontierCount`: immediate placements contributing pending-Promise or cycle-cut reachability;
- `errorCount`: immediate placements contributing Error presence; and
- `parents`: `Map<parent, multiplicity>` for reverse projected edges.

`parents === undefined` means unindexed. An empty map means indexed with no
projected parent. Ownership uses complete incoming placements, imported
protection, preservation relationships, and leases independently of these
counters. There is no permanent shared mark.

## Property projection

| Logical property | Contribution | Counted child |
| --- | --- | --- |
| Pending Promise | One frontier | None |
| Cycle cut | One frontier | None |
| Error | One Error | None |
| Indexed traversable value | One for each nonzero child summary | The value |
| Other value | None | None |

Every raw-reachable traversable value beneath an indexed root is indexed. Cuts
separate that raw graph into projected components; their targets have
independent counters.

Each placement contributes at most one to each summary. A child containing both
pending Promises and cycle cuts contributes one frontier through each parent key. An indexed child with
one Error and a child with many paths to an Error contribute equally through
one parent key. Several keys referencing that child contribute their actual
local edge multiplicity. Counts are bounded by the node's immediate placements;
they are neither descendant totals nor ownership reference counts.

## Building an index

`buildRefIndex(value, operationContext)` prepares one complete region in an
operation-local map, reusing already-complete indexes:

1. Traverse unindexed identities and count their prepared logical properties in
   one DFS. An edge to an active identity becomes a staged cut; other traversable
   edges contribute child presence and staged reverse-parent additions. Reuse
   completed live or staged child counters. Inspection starts no normalization
   or subscription; pending values remain pending edges. No captured-placement
   map or second graph traversal is needed.
2. Commit every prepared counter and cut, then add the reverse edges, including
   additions to existing indexes, in one synchronous transition with no host
   reflection or subscriptions.

All fallible reflection precedes this commit.
An abandoned build publishes no partial index, cut, or reverse-parent edge.
Input preparation and shared property settlement remain independent transitions;
the build only inspects their published values. Index presence always denotes a
complete downward-closed region, including its cut targets. A descendant cannot
be published while a cut still reaches an unfinished ancestor.

This algorithm accepts cyclic runtime and imported data equally. Import prepares
logical placements but does not build this optional index. No pending-frontier
drain, cut-target queue, or persistent construction state is needed.

## Publishing an indexed edge

Before a traversable value enters an indexed container, Cascada indexes it. The new
edge closes a projected cycle exactly when walking upward from the container
through the maintained `parents` DAG reaches that value. Such an edge becomes a
cut; every other edge receives the normal reverse-parent entry.

`prepareCounterUpdate` completes fallible child indexing and captures the old and
new property contributions. Property-version publication supplies the captured
old value and owns commit ordering: storage, logical version, structure, incoming
placements, then this optional counter update. The counter update replaces cut
state and reverse-parent multiplicities and propagates deltas through the parent
DAG. Refcounts owns no property mutation or complete-parent maintenance. After
storage succeeds, bookkeeping runs without callbacks or suspension.

Assignment, deletion, Promise settlement, Array remapping, and COW
reconstruction all use this accounting. A detached Promise version settles
privately without indexing its result or contributing an edge to its former
owner. A consuming Error query or publication into an indexed placement builds
an index when needed.

An indexed COW copy is indexed from its own logical properties. Source summaries,
parents, versions, and cuts are never copied as metadata.

## Promise versions

One `PromiseVersion` represents one actually pending property version. A logically pending
property contributes one pending Promise. Its first FIFO resolver publishes the
result through the same property transition as an ordinary assignment.

Each Promise version's `value` is the authoritative logical edge. Imported physical
properties keep their Promise, runtime-owned live properties also write through
when publication succeeds, and detached versions retain their private Promise version
value. Failed writeback can leave a settled Promise version over any previous physical
value, including a ready value published by an earlier transition. Counters
follow the logical value. The [managed-storage contract](data-limitations.md#proxies-in-managed-storage)
requires failed primitive writes, definitions, and deletions to leave the graph
unchanged, so the previous version remains valid until a replacement commits.
Complete fallible storage work before committing placement and refcount changes;
no Proxy-specific recovery or rollback is needed. A synchronously
consumed custom thenable contributes its final logical value directly, or
through a fixed overlay over imported storage, and has no pending count. These
storage choices do not change the counter rules.

Distinct logical ArrayView properties have distinct versions even when they
share a physical slot. Refcounting reads each Promise version's logical edge, independent
of changes another view made to the backing slot.

## Delta propagation

Apply an edge's old/new contribution delta to its immediate container. Only a
zero/nonzero change in that container's summary changes its contribution to
parents. Each parent receives that Boolean change multiplied by its actual
number of keys referencing the child, never by the number of paths through
ancestors. Stop propagation for an unchanged presence component.

Apply one placement transition at a time. Within each category every induced
delta has the same sign, so an ancestor's presence changes at most once: on
its first addition or last removal. Recursive propagation through the maintained
parent DAG therefore delivers only final presence changes, even when paths
reconverge. Live counters accumulate these contributions directly within the
synchronous commit after fallible storage work succeeds. Each category crosses a
reverse edge at most once; unchanged presence does not visit further ancestors.
No ancestor sort, descendant-path multiplier, BigInt, saturation, graph rescan,
or persistent topology is needed. This relies on one placement transition;
opposing deltas from different placements must not be batched into this walk.

The parent graph is a DAG by construction: pending properties and cuts have no
reverse edge, initial indexing cuts DFS back edges, and later edge publication
checks the existing parent DAG before committing.

## Consumers and verification

`hasError` and `getErrors` fence their walks with both counters. `errorCount`
can prove `hasError` immediately; `frontierCount` requires further traversal.
The ordinary traversable-child walk also follows cut targets, using their
independent indexes and the query's visited set. Export instead walks the
raw graph and never builds or reads counters. Contextual Error queries also
observe selected mutable-external scope metadata through its ordered phase;
a zero managed summary cannot prune those required static-tree locations.
External phase poison is not copied into managed identity summaries.

Each Error query implements the common operation-lifecycle owner while keeping only query-local visited and Error-collection state. After `hasError` succeeds early, a captured Promise version in the still-live execution maintains shared counters when it publishes, but the closed query performs no further indexing or traversal. If the execution is fatal, a resumed continuation stops before counter publication because that execution's graph is no longer observable. `getErrors` otherwise exhausts its complete captured frontier.

The test verifier independently recounts property contributions, raw-reachable
index closure, reverse-edge multiplicity, cut and Promise version shape, and parent-DAG
acyclicity. It uses direct import status when deciding whether a physical
Promise may be preserved; physical shape is not an ownership proxy.

Verify dense aliasing with few identities, reconverging dependencies, cycles,
and repeated additions/removals. Removing a heavily aliased Error or Promise
branch must preserve another contributing sibling. The verifier counts local
Boolean child contributions independently of the propagation implementation.
