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
- `edgeMarks`: property-level tagged `{ kind, error }` projected cuts. `cycle`
  keeps the raw edge visible to normalization; `invalid` is an Error boundary.
- `settlementPromise`, `settlementResolve`,
  `settlementVerifyScheduled`: normalize's optional shared wait generation.
- `shared`, `importContext`, `importPrepared`: ownership and lazy import state.

Inline metadata uses one non-enumerable Symbol on extensible values. The same
WeakMap used by WeakMap mode is the fallback for non-extensible values, so both
storage modes have identical semantics.

## Projected placements

Counts are placement-sensitive. `getPropertyRefCounts(parent, key)` applies
these rules in order:

- An unresolved or draining live mirror contributes `[1, 0]`.
- A settled `cycle` or `invalid` edge mark contributes `[0, 1]`.
- An ordinary Promise contributes `[1, 0]`.
- An ordinary Error contributes `[0, 1]`.
- A tracked child contributes its indexed subtree totals.
- A primitive contributes `[0, 0]`.

`getCountedChild(parent, key)` returns the child that owns a reverse parent edge,
or nothing for a pending mirror or marked cut. Code that changes a property
must use these placement helpers rather than inspect the physical slot.

`getCommittedEdgeMark(parent, key)` reads only attached state, so a draining
mirror remains `[1,0]`. `getResolvedPlacementMark(placement)` lets an operation
that captured a mirror see its private prepared mark. These views are distinct
because private FIFO state must not leak into parent counters before drain.

Every ordinary tracked child below an indexed parent is itself indexed. A
missing child counter is a fatal downward-closure violation, not a request for
implicit repair.

## Building the index

`buildRefIndex(value, inheritedImportContext, placement)` is the sole public
entry for initial indexing.

Trusted language data follows the compiler's tree-shaped ownership contract,
so `commitRefIndex` walks it directly without identity bookkeeping. When an
import context is reached, `prepareImportedData` first discovers and validates
that imported region, deduplicates its identities, stages cycle/validation
cuts, and creates required mirrors. The completed preparation is then committed
and its records are indexed. See `docs/lazy-import.md`.

Frozen, sealed, and otherwise non-extensible nodes follow the same counter
rules as extensible nodes. Once reached by a successful index build, each has a
counter in WeakMap metadata, and every ordinary tracked child below it is also
indexed. Non-extensibility affects ownership and physical writeback, not counts.

Parent maps retain every structural edge. If one parent references a child at
two keys, its map entry has multiplicity two and propagated deltas are
multiplied accordingly. Cycle and validation cuts never add reverse edges.

## Edge transitions

Candidates are prepared before they enter the attached graph:

- `prepareEdgeTransition(owner, key, mirror, candidate)` derives imported
  preparation, markers, child indexing, and final counts without changing the
  attached placement.
- `commitEdgeTransition(owner, key, mirror, prepared)` installs that state.

Every live assignment, deletion, changed edge mark, and successful mirror drain
then shares one synchronous commit primitive. It snapshots the old projected
counts and child, performs the already-validated placement update, swaps the
reverse edge, and propagates exactly one delta from explicitly supplied next
counts. Revoked mirror state is private and bypasses this attached-edge commit.
Descriptor constraints that could block assignment or deletion are validated
before candidate preparation. The physical mutation then occurs before mirror
or mark metadata changes, so a failed mutation leaves the previous attached
edge unchanged. A fatal preparation likewise leaves it unchanged. A newly
assigned Promise is installed immediately as a fresh mirror contributing
`[1,0]`.

`copyCounters` reconstructs an indexed COW copy from the copy's own logical
placements. It never clones source totals, parent maps, or placement markers.

## Promise mirrors

Every callback that consumes a mirrored Promise registers through
`onPromiseMirrorResolve`. Registration increments `pendingConsumerCount`
synchronously. Completion decrements it after the callback's synchronous body
has run.

The mandatory writeback is the mirror's first counted consumer. While any
consumer remains, `settled` is false and the attached placement stays `[1, 0]`.
Consumers prepare successive private values in FIFO order. The successful
transition to zero consumers is the only drain point: the final prepared value
is committed once if the mirror is still live. A revoked mirror keeps only its
private result.

This drain rule closes the settlement-to-writeback race. A read cannot use a
settled fast path while an earlier registered mutation is still queued. A
synchronous fatal consumer marks the drain failed and prevents publication.

`readLogicalProperty` therefore returns:

- the original Promise for a live unresolved or draining mirror;
- `mirror.currentValue` for a settled mirror;
- otherwise the own enumerable physical property.

External imported holders and holders that become non-extensible retain their
physical Promise permanently; the mirror remains the authoritative logical
placement.

A mirrored placement stores its edge mark exclusively in `mirror.edgeMark`.
Installing a mirror clears `meta.edgeMarks[key]`, and removing one clears both
locations, so a stale metadata mark can never reappear after mirror removal.

## Delta propagation

`applyCountDelta(node, promiseDelta, errorDelta)` updates one indexed node and
recursively propagates the delta through every parent, multiplied by edge
count. The projected parent graph is acyclic: trusted data is tree-shaped,
imported aliases retain multiplicity, and every imported cycle is cut by a
marker.

When `promiseCount` falls to zero, normalize's settlement verification is
queued once. The extra microtask lets FIFO jobs already registered on the same
settling promise raise the count before verification. A waiting generation is
resolved only if the count is still zero then.

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
