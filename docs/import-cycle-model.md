# Imported cycle model: the chosen strategy

This records the decision from `docs/import-cycle-strategies.md`: DFS discovery
with persistent per-placement cuts, plus one proposed refinement to the error
queries. It also answers the three re-rooting objections raised against it.
Mechanics live in `docs/import-preparation.md` and
`docs/counters-implementation.md`.

## The strategy

- Cycles in imported graphs are discovered by an ordinary active-path DFS
  (eager at import today; lazy first-index discovery is a compatible later
  optimization).
- A discovered back-edge receives one persistent attributed cycle Error at its
  owner/key placement. The raw property is never changed.
- The counter graph keeps one shared projection: a cut contributes `[0, 1]`,
  installs no reverse parent edge, and the projected parents graph stays
  acyclic.
- Lookup and mutation follow raw values along finite explicit paths. Normalize
  classifies through counters, then traverses raw logical values through cuts
  with an identity map, extending the promise frontier behind them.
- Proposed refinement (not yet the implemented contract): `getErrors`'
  collection becomes cycle-aware like normalize's raw phase. See "Raw
  error-collection contract" below. `hasError` is unchanged and still answers
  from `errorCount`.

## Two laws that make it sound

1. **Every directed cycle must contain at least one cut edge.** Counters are
   one scalar record per node and deltas propagate recursively through
   `parents`; an uncut loop would make propagation non-terminating. The cuts
   form a feedback edge set: one cut can break several overlapping cycles, and
   a dense strongly connected region can require several cuts. Any
   architecture with one shared incremental counter index must cap some root's
   view at a cut; placement only chooses which root, never whether.
2. **The cap is always flagged.** Anything hidden from a query root sits
   behind either a pending mirror placement (`[1, 0]`) or a committed cut
   (`[0, 1]`) inside that root's projection. A draining mirror keeps a
   privately prepared cut represented as `[1, 0]` until its final commit, so
   the flag for an in-flight cut is the promise count, not the error count.
   Corollary: only a settled projection — `promiseCount === 0 &&
   errorCount === 0` — proves nothing is hidden; the O(1) fast paths remain
   valid because they answer clean only in that settled case. A committed cut
   can still hide raw pending promises behind a zero projected `promiseCount`;
   its nonzero `errorCount` is the signal that cut-aware consumers must
   inspect raw data.

## Objection 1: extraction should remove the cycle

`ext.mid.leaf.back = mid`, cut at `(leaf, "back")`; lookup extracts `leaf`.
Expectation: the extracted branch has no cycle, so the cut is stale.

A directed cycle is a property of the graph, not of the traversal root.
Extraction returns the same identity and severs nothing: `mid.leaf` still
exists, so `leaf -> mid -> leaf` is intact from the new root. A cut is placed
only when the target lies on a real active path, so every cut edge is on a
genuine cycle made of edges that do not change afterwards: imported data is
immutable after import by contract — the runtime neither freezes nor copies
it, and host writes after the boundary are out of scope — while language
mutation COWs away from it. Under that contract, re-rooting can never falsify
a committed cut.

The cases where the cycle genuinely is absent already work: a branch that
cannot reach the cut never sees the Error; a COW copy inherits no placement
metadata and is classified fresh in its own world; replacing or deleting the
cyclic property removes the cut's contribution at commit.

## Objection 2: queries skip the cut edge, so unique nodes are missed and the cut should sit "as far down as possible"

"Down" is root-relative. A DFS cut is already maximal for its discovery root —
every node on the loop is visited before the back-edge fires — and no single
placement is optimal for two roots: moving it down for one moves it up for the
other. Chasing per-root placement ends at transient per-walk cuts (strategy 2
in the comparison doc), which cannot host the counter index at all.

The resolution is to make placement stop mattering for query results instead
of optimizing it. Law 2 guarantees a capped answer is conservatively flagged,
and the raw-phase `getErrors` refinement enumerates through cuts, so result
completeness comes from traversal rather than placement. Placement still
determines which property key the Error names, projected counter magnitudes,
parent-map topology, which promises the counted settlement phase waits on
before the raw phase extends the frontier, and traversal cost. It no longer
determines the final contents of `getErrors` or the `hasError` boolean: any
root that reaches a cycle reaches some cut in its projection.

## Objection 3: after extracting a branch and attaching it elsewhere, counts never reach the old root

True — and by law 1 no placement fixes it. If the new placement counted
through `leaf.back -> root` while the original counts `root -> ... -> leaf`,
the parents graph would cycle. One side is always capped; relocating the cut
just swaps which side.

It stays correct because counters were never the source of truth across cuts.
They exist for termination, settlement wakeup, and pruning of one projection.
Every consumer that needs truth through a cut goes raw: normalize already
extends the raw promise frontier behind cuts (its spec states projected
`promiseCount` alone is insufficient there), `getErrors` does under the
proposed refinement, and `hasError` is true from the cut itself. Capped counts
are conservative, never wrong.

Two recorded extensions if this ever needs more than conservatism:

- Lazy discovery makes placement first-indexer-wins, so the root a program
  actually queries usually gets the deep projection.
- SCC condensation counters are the only design where counts cross cycles for
  every root: each strongly connected component shares one counter node and
  the condensation is a DAG, needing no cuts. Under the same immutability
  contract it is more feasible here than the comparison doc implies —
  imported originals are logically append-only (settlement only adds edges;
  mutation COWs), so components only merge and never split, while trusted
  data stays tree-shaped. It is still deliberately not adopted: it replaces
  the counter/parents/verifier architecture to close a gap the raw phase
  already covers.

## Raw error-collection contract (proposed)

The refinement is a contract change, not a drop-in edit: `docs/initial-spec.md`
currently specifies that `getErrors` never descends through a cycle cut, and
the collector implements that stop. Adoption requires a coordinated spec,
collector, and test update.

The raw collector must:

- add the placement's cycle Error, then continue through the raw logical value
  behind it;
- accept counterless raw targets — nothing behind a cut is required to be
  indexed;
- observe a terminal or private mirror cut at the query's own FIFO position
  through the resolved (private) read view, preserving issue-time semantics
  while a cut is still private to a draining mirror;
- wait recursively for promises found behind cuts. Unlike the counted
  collector — which requires existing mirrors because ref-indexing guarantees
  them inside indexed branches — the raw phase is an observation and may
  create-or-reuse mirrors, exactly as normalize's raw phase does;
- share one query-local identity set across the projected and raw traversals.

Its natural home is the single raw logical walker that item 14 already plans
to consolidate from `inspectRawCycleBranch` and `copyToPlainValue`: an
error-collecting mode on that walker, not an ad-hoc extension of the counted
collector.

Required coverage: a unique Error reachable only behind a cut; a pending
Promise reachable only behind a cut; `hasError` answering immediately from the
cut while `getErrors` waits behind it; a private terminal mirror cut with a
counterless raw target; revocation of a placement-dependent mirror leaving no
phantom marker; and, in the same scenario, a cycle that does not depend on the
placement edge keeping its cut despite the revocation.

## Guard rail for lazy promise scans

If discovery moves to first-index time, where a newly discovered cut is stored
is decided by one criterion: whether the cycle passes through the enabling
placement edge.

- A cycle through the placement edge exists only if that mirror's drain
  commits. Its cut is stored at the mirror placement (`mirror.cycleError`):
  private until drain, discarded with a revoked mirror. This generalizes the
  current direct-ancestor rule and deliberately trades projection precision
  for revocation safety — the whole resolved value sits behind `[0, 1]` even
  when one deep property closes the loop. The value is still privately
  prepared and indexed so raw `getErrors` and normalize can inspect it once
  the outer cut commits.
- A cycle that does not pass through the placement edge — wholly internal to
  genuinely new nodes, or pre-existing among reachable shared nodes and merely
  discovered first by this scan — is a graph fact independent of the mirror's
  fate. Its cut is stored at its actual back-edge and remains valid even if
  the mirror is revoked.

Do not infer privacy from indexing state: a resolved value can alias
pre-existing shared imported objects, so "unindexed" does not mean "private to
this mirror," and a placement-dependent cut stored on such a node would
survive revocation as a phantom. The owner's projected ancestor closure,
computed from the existing `parents` maps, remains useful to accelerate
detection of placement-dependent cycles; it never determines where a cut is
stored.
