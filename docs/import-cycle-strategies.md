# Imported cycle handling strategies

This document compares three ways to handle cycles that are reachable through
imported data. It is a design discussion, not the current runtime contract.

The difficult case is not finding a cycle. A depth-first walk needs only its
current active path to recognize a back-edge. The difficult part is reconciling
that fact with:

- shared identities that can be reached through more than one placement;
- Promises that expose new graph edges later;
- copy-on-write (COW) and lookup creating independently usable views;
- persistent subtree counters and reverse parent links; and
- normalize preserving the raw cyclic topology.

## Required behavior

Any solution should preserve these rules:

- Trusted compiler-created data is acyclic under the single-owner/COW contract.
  Cycle handling is needed only while traversing imported provenance.
- Lookup and mutation may follow a raw cyclic property along a finite explicit
  path.
- `hasError` and `getErrors` treat a cycle as a language Error.
- The projected refcount graph must be acyclic. A cycle cut contributes
  `[0, 1]` and installs no reverse parent edge.
- Normalize must terminate, preserve identity topology when appropriate, and
  still detect ordinary Errors and pending Promises.
- A Promise result is processed in its FIFO mirror position before later
  consumers can depend on its ref-indexed state.
- Runtime observations must not change language-visible identity merely to make
  analysis easier.

An "imported path" means a path carrying an inherited import boundary. It does
not require two objects with direct import marks. A single imported root such
as `a.self = a` is sufficient.

## 1. COW the path that makes an imported cycle

When attaching imported data inside another imported path, the runtime could
copy the destination path before publishing a cycle marker. The marker would
then belong to that copied view rather than to a shared object that may also be
reachable elsewhere.

### Shape

1. Walk the incoming imported branch against the destination ancestry.
2. When it reaches a destination ancestor, identify the cycle-closing
   placement.
3. Shallow-copy every owner between the destination root and that placement.
4. Store the cycle Error on the copied placement.
5. Reconnect the copied path into the Chain state.
6. Perform equivalent copying when a Promise result creates the cycle.

Initial cycles already present wholly inside one imported value still need a
normal active-path DFS. This option primarily changes how attachment-created
cycles are represented.

### Advantages

- A marker can be scoped to the particular language view that caused it.
- The projected refcount graph can keep using stable per-placement cuts.
- Other aliases do not inherit metadata from the copied owners.

### Problems

- Cycle discovery would perform a language-visible structural operation.
  `hasError`, `getErrors`, or lazy counter construction could change identities
  even though they are observations.
- Copying only the path to the discovered back-edge is not necessarily enough
  to describe the complete cyclic topology. Copying more of the graph quickly
  becomes expensive and difficult to define.
- Promise settlement would have to find and replace the correct live view while
  preserving all earlier captured views and mirror FIFO ordering.
- Lookup of a copied sub-branch raises another question: whether the copied
  cycle classification remains valid after that branch becomes independently
  usable.
- It duplicates much of `walkMutationPath`, including COW, mirror forking,
  counter reconstruction, and commit sequencing.
- A cycle query would no longer be a pure query.

### Assessment

This is the most expensive and invasive option. It solves marker scoping by
creating more graph views, but doing so introduces harder identity and ordering
questions than the marker itself. It is not recommended.

## 2. Detect cycles on every recursive walk

The runtime could remove persistent cycle markers and let every recursive walk
carry an active-path set. A repeated identity in that active path is a cycle for
that walk.

Finite path operations such as lookup and mutation would not need this logic:
their explicit path length already guarantees termination. Recursive operations
would need it:

- ref-index construction and verification;
- `hasError` and `getErrors`;
- normalize and plain-copy normalization;
- Promise-result traversal; and
- any future whole-branch operation.

Each operation would also normally keep a completed/visited set so DAG aliases
are not traversed repeatedly. The active-path and completed sets have different
meanings: an active repeat is a cycle, while a completed repeat is only an
alias.

### Advantages

- Cycle classification is always derived from the exact graph and traversal
  root currently being observed.
- There is no persistent cycle marker that can appear context-dependent.
- The fundamental detection rule is small and familiar.

### Refcount conflict

The current subtree counters cannot use a purely transient cut. Counters are
maintained after the original walk, and each ordinary child edge installs a
reverse parent link. If a later update changes a child count, propagation uses
those links without repeating the original DFS.

For a cycle edge, the runtime must remember at least:

- that the edge contributed `[0, 1]` instead of the child's counters; and
- that no reverse parent edge was installed for it.

Without persistent edge state, a later replacement or deletion cannot know
which old contribution and parent relationship to remove. Installing every raw
edge would instead make parent propagation cyclic.

Avoiding that state requires a larger redesign:

- do not ref-index cyclic imported regions;
- recompute their results for every query;
- treat them as opaque values at every indexed parent; or
- replace scalar subtree counters with an SCC-aware graph representation.

All of these weaken or replace the current incremental counter architecture.

### Other costs

- The same cycle logic is repeated across several independent walks.
- `hasError` loses its constant-time `errorCount > 0` answer after indexing.
- `getErrors` and normalize repeatedly scan cyclic imported graphs.
- Every Promise continuation must retain or reconstruct operation-specific path
  state.
- Different operations may choose different transient cuts, making cached
  counters or shared query helpers difficult to reuse.

### Assessment

This is attractive only if persistent subtree counters are removed for imported
cycles. With the current counter design, the supposedly marker-free solution
eventually recreates persistent per-edge state under another name. It is not
recommended without a broader counter redesign.

## 3. Lazy DFS discovery with persistent ref-index cuts

The recommended approach separates discovery from representation:

- discover cycles lazily with an ordinary active-path DFS; and
- persist only the cycle-closing edge needed by the ref-index.

The cycle Error does not claim that a particular traversal path is permanent.
It records that the raw owner/key edge is part of an actual directed cycle and
is therefore excluded from the projected counter graph.

### Why an edge cut is not merely path-dependent

Suppose `bridge.back === shared` is encountered while the active path already
contains `shared`. The active path proves that the graph contains:

```text
shared -> ... -> bridge -> shared
```

The traversal determines which edge discovers the cycle, but `bridge.back` is
objectively part of that directed cycle. A branch rooted at either `shared` or
`bridge` can reach the cycle.

Lookup does not erase it: it exposes the same identity and marks ownership as
shared. A later language mutation COWs the changed path, preserving the old
world for existing references. New copies do not inherit the old placement
metadata, so a genuinely cycle-free copy does not inherit the cut.

### When discovery runs

`import` only needs to establish the imported root, attribution context, and
shared ownership. It does not need to walk the complete graph immediately.

Cycle discovery runs when an acyclic projection is actually required:

1. Before an imported branch is first ref-indexed by normalize, `hasError`, or
   `getErrors`.
2. Before an indexed imported property commits a newly attached value.
3. Before an indexed imported Promise mirror commits its resolved logical
   value.

If the owner is not ref-indexed, assignment or Promise settlement need not scan
the branch. A later first ref-index performs the scan over the then-current
logical graph.

### The synchronous scan

One scan owns two local identity sets:

- `activePath`: nodes in the current DFS ancestry;
- `completed`: nodes completely checked during this synchronous scan.

Conceptually:

```text
scan(value, placement):
    if placement already has a cycle cut: stop
    if value is untracked or an unresolved Promise: stop
    if value is in activePath:
        attach a cycle Error to placement
        stop
    if value is in completed: stop

    add value to activePath
    scan each logical property
    remove value from activePath
    add value to completed
```

A current-path repeat is cut. A completed repeat is a DAG alias and can be
skipped safely because the graph cannot change during the synchronous scan.
The scanner must traverse logical mirror values and must not skip an ordinary
node merely because that node already has counters.

### Promise results and new placements

An unresolved Promise is a leaf contributing `[1, 0]`. Ref-indexing creates or
reuses its mirror. When it resolves under an indexed owner, mirror preparation
runs a fresh scan before indexing and committing the resolved branch.

The fresh scan seeds `activePath` with the placement owner. Any cycle newly
created by the property edge must include that edge, so the resolved value must
be able to reach its owner. Internal cycles wholly inside the resolved value are
found by ordinary path growth.

This removes the need for:

- one visited table retained across asynchronous segments;
- visit-generation tokens;
- copied Promise ancestry from the original import walk; and
- separate detached and attached recursive walkers.

The same placement preparation can be used for a resolved Promise and for an
imported value assigned beneath an indexed imported owner.

### Persistent cut

When the scan finds a back-edge:

- the raw property remains unchanged;
- the owner/key placement stores an attributed cycle Error;
- the placement contributes `[0, 1]`;
- no reverse parent edge is installed through it; and
- recursive projected walks stop at it.

A draining mirror keeps a newly discovered cut private until its FIFO consumers
finish and the placement commits. This preserves the existing current-position
ordering contract.

`hasError` and `getErrors` then use counters and committed cuts rather than
performing their own cycle detection. Normalize first uses the projected graph
for settlement and ordinary-Error classification, then follows raw values with
an identity map when it must preserve cyclic topology.

### Duplicate identities

Duplicate detection is independent from cycle detection. `completed` avoids
repeated work during one scan, but an imported DAG alias does not itself need a
permanent shared mark for cycle correctness.

Imported provenance already forces COW while traversing the imported branch.
If a descendant is extracted for independent use, lookup establishes a direct
import/shared boundary for it. Permanent duplicate marks should therefore be
kept only if another demonstrated ownership invariant requires them, not as
part of the cycle algorithm.

### Advantages

- Cycle detection remains one small, conventional DFS.
- Unused imported values pay no recursive preparation cost.
- Error queries retain fast counter-based pruning.
- Parent propagation remains acyclic and incremental.
- Promise handling uses the existing mirror preparation/commit boundary.
- No observation performs COW merely to classify the graph.
- Cycle metadata remains limited to the placements required by refcounting.

### Remaining complexity

- The mirror/private-versus-committed cut distinction remains necessary for
  FIFO current-position semantics.
- Edge replacement must atomically remove the old projected contribution and
  install the new one.
- The verifier should still report any cycle in the projected parents graph as
  a fatal internal invariant failure.

These costs belong to the persistent counter architecture and are not created
by cycle discovery itself.

## Recommendation

Use lazy DFS discovery with persistent ref-index cuts.

Do not COW merely to scope cycle diagnostics, and do not spread active-path
tracking through every recursive operation. Detect imported cycles at the
small number of boundaries where a ref-indexed placement is prepared, store the
minimal edge cut needed by counters, and let queries and normalize consume that
prepared representation.
