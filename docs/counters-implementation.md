# Graph presence summaries

Presence summaries are a lazy index over an acyclic projection of the logical
graph. They identify reachable pending Promises, Errors, and cycle cuts without
counting paths through aliases.

## Metadata

Each indexed traversable identity stores:

- `promiseCount`: immediate placements contributing pending-Promise presence;
- `errorCount`: immediate placements contributing Error presence;
- `cycleCutCount`: immediate placements contributing cycle-cut reachability; and
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
| Indexed traversable value | One for each nonzero child summary | The value |
| Other value | None | None |

Every raw-reachable traversable value beneath an indexed root is indexed. Cuts
separate that raw graph into projected components; their targets have
independent counters.

Each placement contributes at most one to each summary. An indexed child with
one Error and a child with many paths to an Error contribute equally through
one parent key. Several keys referencing that child contribute their actual
local edge multiplicity. Counts are bounded by the node's immediate placements;
they are neither descendant totals nor ownership reference counts.

## Building an index

`buildRefIndex(value, operationContext)` prepares one complete region in an
operation-local map, reusing already-complete indexes:

1. Discover unindexed traversable identities and capture each logical property
   version. Reads normalize newly reached placements and install versions only
   for actually pending outcomes.
2. Finish discovery of captured versions advanced by later synchronous
   subscriptions. Reuse their current logical values without another
   subscription or physical-slot read; repeat only while newly available work
   advances the frontier. Discovering a later version can settle one already
   skipped in that pass, requiring another pass. Still-pending versions remain
   pending edges.
3. Count the captured graph with a DFS. An edge to an active identity becomes a
   staged cut; other traversable edges contribute child presence and staged
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

`prepareLiveEdge` completes fallible child indexing and captures the old and new
property contributions. Its returned commit completes storage work first, then
publishes the logical value, Promise version, and cut state, replaces reverse-parent
multiplicities, and updates live counters through the parent DAG. After storage
succeeds, this bookkeeping runs without callbacks or suspension.

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

`hasError` and `getErrors` fence their walks with all three counters. At a cut,
they continue from its independently indexed target. Export instead walks the
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
