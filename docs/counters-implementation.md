# Subtree counters

Subtree counters are a lazy index over the runtime's projected logical graph.
Each indexed node stores the number of pending Promise placements and Error
placements reachable below it. They replace the former CLEAN flag:

```text
clean <=> promiseCount + errorCount === 0
```

Counters say what is pending or broken. The shared mark says who may observe a
value. These concerns are independent.

## Metadata

All per-node runtime state lives in the single META record:

- `promiseCount`, `errorCount`: exact projected subtree totals.
- `parents`: reverse indexed edges with multiplicity. Its existence is the
  ref-indexed marker; an empty Map is an indexed root.
- `mirrors`: promise placements and their private logical state.
- `cycleErrors`: property-level cycle Errors. Each one cuts its raw edge from the
  projected counter graph while leaving that edge visible to path operations
  and cycle-aware normalization.
- `settlementPromise`, `settlementResolve`: normalize's optional shared wait
  generation.
- `shared`, `importBoundary`: ownership and import state. A direct boundary
  stores `{ root, errorContext }`.

A META record starts empty. Each field is added by the subsystem that activates
it: `shared` at the first ownership boundary, mirrors and cycle cuts on first
placement, the counter trio on ref-indexing, settlement fields on a pending
normalize, and the import boundary at direct import.

Inline metadata uses one non-enumerable Symbol on extensible values. The same
WeakMap used by WeakMap mode is the fallback for non-extensible values, so both
storage modes have identical semantics.

## Projected placements

Counts are placement-sensitive. `getPropertyRefCounts(parent, key)` applies
these rules in order:

- An unresolved or draining live mirror contributes `[1, 0]`.
- A settled cycle Error contributes `[0, 1]`.
- An ordinary Promise contributes `[1, 0]`.
- An ordinary Error contributes `[0, 1]`.
- A tracked child contributes its indexed subtree totals.
- A primitive contributes `[0, 0]`.

`getCountedChild(parent, key)` returns the child that owns a reverse parent edge,
or nothing for a pending mirror or cycle cut. Code that changes a property
must use these placement helpers rather than inspect the physical slot.

`getCommittedCycleError(parent, key)` reads only attached state, so a draining
mirror remains `[1,0]`. `getResolvedCycleError(placement)` lets an operation
that captured a mirror see its private prepared Error. These views are distinct
because private FIFO state must not leak into parent counters before drain.
`src/import.js` owns both views and delegates attached publication to one atomic
refcount edge transaction.

Every ordinary tracked child below an indexed parent is itself indexed. A
missing child counter is a fatal downward-closure violation, not a request for
implicit repair.

## Building the index

`buildRefIndex(value, inheritedImportBoundary, placement)` is the sole public
entry for initial indexing.

Trusted language data follows the compiler's tree-shaped ownership contract,
so `commitRefIndex` walks it directly without identity bookkeeping. When an
import boundary is reached, `prepareImportedData` starts from that boundary's
stored root. One depth-first walk uses `visited` to mark repeated identities
shared and `currentPath` to cut properties that point back into the active
path. It publishes mirrors and cycle Errors directly. Ordinary `commitRefIndex`
then walks the resulting acyclic projection from the root; no imported record
graph or preparation flag is retained. See `docs/lazy-import.md`.

Frozen, sealed, and otherwise non-extensible nodes follow the same counter
rules as extensible nodes. Once reached by a successful index build, each has a
counter in WeakMap metadata, and every ordinary tracked child below it is also
indexed. Non-extensibility affects ownership and physical writeback, not counts.

Parent maps retain every structural edge. If one parent references a child at
two keys, its map entry has multiplicity two and propagated deltas are
multiplied accordingly. Cycle cuts never add reverse edges.

## Edge transitions

New values are prepared before they enter the attached graph:

- `preparePropertyTransition(owner, key, propertyMirror, newValue)` derives imported
  preparation, cycle Errors, and child indexing without changing the attached
  placement. Counts are read from that prepared state only when it is committed.
- `commitPropertyTransition(owner, key, propertyMirror, prepared)` installs that state.

Every live assignment, deletion, changed cycle Error, and successful mirror drain
then shares one synchronous commit primitive. It snapshots the old projected
counts and child, performs the already-validated placement update, swaps the
reverse edge, and propagates exactly one delta from explicitly supplied next
counts. Revoked mirror state is private and bypasses this attached-edge commit.
Descriptor constraints that could block assignment or deletion are validated
before new-value preparation. The physical mutation then occurs before mirror
or cycle-Error metadata changes, so a failed mutation leaves the previous attached
edge unchanged. A fatal preparation likewise leaves it unchanged. A newly
assigned Promise is installed immediately as a fresh mirror contributing
`[1,0]`.

`copyCounters` reconstructs an indexed COW copy from the copy's own logical
placements. It never clones source totals, parent maps, or placement cycle Errors.

## Promise mirrors

Every callback that consumes a mirrored Promise registers through
`onPromiseMirrorResolve`. Registration increments `pendingConsumerCount`
synchronously. A consumer decrements only after its synchronous body and any
final drain commit succeed.

The mandatory writeback is the mirror's first counted consumer. While any
consumer remains, the mirror is pending and the attached placement stays `[1, 0]`.
Consumers prepare successive private values in FIFO order. The sole remaining
consumer commits the final prepared value once if the mirror is still live,
then decrements to zero. Zero is the settled state. A revoked mirror keeps only
its private result.

This drain rule closes the settlement-to-writeback race. A read cannot use a
settled fast path while an earlier registered mutation is still queued. A
synchronous fatal consumer leaves its count outstanding and prevents
publication.

`readLogicalProperty` therefore returns:

- the original Promise for a live unresolved or draining mirror;
- `mirror.currentValue` when `pendingConsumerCount === 0`;
- otherwise the own enumerable physical property.

External imported holders and holders that become non-extensible retain their
physical Promise permanently; the mirror remains the authoritative logical
placement.

A mirrored placement stores its cycle Error exclusively in `mirror.cycleError`.
Installing a mirror clears `meta.cycleErrors[key]`, and removing one clears both
locations, so a stale cycle Error can never reappear after mirror removal.

## Delta propagation

`applyCountDelta(node, promiseDelta, errorDelta)` updates one indexed node and
recursively propagates the delta through every parent, multiplied by edge
count. The projected parent graph is acyclic: trusted data is tree-shaped,
imported aliases retain multiplicity, and every imported cycle is cut by a
cycle Error.

When `promiseCount` falls to zero, its optional normalize settlement generation
is cleared and resolved immediately. Promise callbacks remain asynchronous;
the mirror-drain invariant makes the zero exact by retaining `[1,0]` until all
registered consumers have completed their synchronous work.

## Consumers

- `normalize` indexes the reached path value, optionally waits for settlement,
  and inspects projected Errors. Cycle-only branches are then traversed through
  raw logical values with one identity map; a plain copy is constructed during
  that same raw traversal.
- `hasError` answers from `errorCount` immediately when possible and otherwise
  follows only the captured pending mirror frontier.
- `getErrors` uses counters to prune clean branches, collects Error identities
  into one Set, and waits for the complete captured mirror frontier.

Only the initial reached path value calls `buildRefIndex`. Resolved child
branches are prepared and indexed by their mirror writeback before query
continuations inspect them.

## Verification

`verifyRefCounts` independently recounts logical placements, checks exact
stored totals, reverse-edge multiplicity, and downward closure, and detects a
cycle in the parent graph as a fatal invariant failure. A draining mirror is
recounted as `[1, 0]`, regardless of its physical or currently prepared value.
Verification reads no host-only metadata and never changes runtime state.
