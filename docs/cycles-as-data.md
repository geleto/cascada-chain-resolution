# Cycles as data

**Status:** Implemented.

The language graph may be cyclic. Cascada preserves the raw graph and makes
only the refcount projection acyclic.

## Observable behavior

- Finite lookup and mutation paths follow cyclic properties normally.
- Cycles are not Errors.
- `hasError` and `getErrors` still reach Promises and Errors beyond cycles.
- `export` preserves cycles and aliases in its metadata-free copy.

## Cycle cuts

A cycle cut is an owner/key marker in `meta.cycleCuts`. It removes that one
edge from the refcount projection without changing the logical property.

The property's projected contribution is:

| State | Counts | Reverse parent edge |
| --- | --- | --- |
| Pending Promise | One Promise | No |
| Cycle cut | One cycle cut | No |
| Error | One Error | No |
| Indexed tracked value | Child totals | Yes |
| Other value | None | No |

A property cannot be both logically pending and cut. Replacing or deleting it
clears its old cut.

## Creating the projection

`buildRefIndex` accepts any language graph. While recursively indexing one
component, an edge to an identity on the active DFS path becomes a cut. Its raw
target is queued and indexed as another component after the current component
has been published. Structural aliases outside the active path remain ordinary
edges with their exact multiplicity.

Consequently every raw-reachable tracked identity is indexed, while reverse
parent edges form a DAG.

An unindexed write needs no cycle work. When that graph is indexed later, the
same DFS rule handles every cycle regardless of whether it came from import,
ordinary assignment, Promise settlement, or a method result.

The projection is not canonical. Initial indexing cuts a DFS back edge, while
an indexed publication cuts the edge being published. The same raw topology
can therefore have different valid cuts and counter totals depending on its
construction history; observations remain identical because they continue
from every cut target.

## Updating an indexed graph

Before publishing a tracked child under an indexed parent, Cascada indexes the
child and walks upward from the parent through reverse parent edges. Reaching
the child means the new forward edge would close a cycle, so that placement is
published as a cut. Otherwise it receives the ordinary reverse edge.

The logical value, cut, reverse edges, and count delta are committed in one
synchronous transition. Promise settlement uses this same property transition
in its first FIFO resolver; it has no separate cycle algorithm.

Copy-on-write does not copy cuts or counters. An indexed copy rebuilds its
projection from its own logical properties.

Cuts are conservative. Changing another edge does not search for cuts that
have become unnecessary; a cut is reconsidered only when its own property is
republished or removed. The runtime maintains an acyclic projection rather than
a minimum cut set.

## Observations

A cut stops count propagation only across its property. Its target has an
independent index. Error queries use `cycleCutCount` to find cut placements and
continue from their targets with one operation-local visited set.

Export does not use the refcount projection. Its raw identity-aware walk
reconstructs the actual graph.

## Verification

`test/verify-refcounts.js` independently checks all three counts, cut shape,
raw-reachable index closure, reverse-edge multiplicity, Promise mirror shape,
and acyclicity of the projected parent graph.

## Module boundary

- `src/refcounts.js` owns cut storage and maintains the acyclic projection.
- `src/property-versions.js` publishes property, cut, and counter changes
  atomically.
- `src/observations.js` follows counter frontiers.
- `src/raw-walk.js` traverses the unprojected graph.
