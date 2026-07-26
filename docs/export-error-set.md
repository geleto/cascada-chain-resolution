# Export with the complete Error set

**Status:** Implemented.

The target behavior is:

- successful `export` returns the metadata-free captured branch; and
- a branch containing ordinary Error data returns the complete set of distinct
  reachable Error identities.

Cycles are valid data. They remain in successful output and never enter the
Error result. Ordinary Errors and Promises remain visible through cycle cuts.

## Result channel

Successful data returns directly. Failure returns a fresh non-thenable Error
with message `export: branch contains errors`; its `errors` property is an array
containing every distinct reachable Error identity. The outer Error is the
channel, so its array cannot be confused with an ordinary successful array.

## One operation

Export is one copy-or-collect operation. It does not call `getErrors`, start a
second path operation, or defer choosing its observation position.

Path resolution registers through Promise mirrors at export's issue position.
As soon as the terminal value is available, one raw identity-aware walk begins
at that captured FIFO position. The walk owns one state across its synchronous
prefix and every recursively exposed Promise:

```js
{
    visited: new WeakSet(),
    copies: new WeakMap(),
    errors: new Set(),
    copying: true,
}
```

The two weak identity stores have separate lifetimes:

- `visited` spans the complete operation and keeps traversal finite;
- while copying, `copies` maps each source object to its output object; and
- the first Error drops `copies`, while `visited` continues through the
  remaining Promise frontier.

The copy map preserves output aliases and cycles without creating several
output graphs. Weak identity state does not strongly retain source nodes for a
permanently pending operation.

The export shell keeps one mutable reference to the root output. Its Error
callback clears that reference when collection-only mode begins, while the raw
walker drops the copy map it owns.

## Direct terminals

- A path-blocking or terminal Error produces a one-element Error outcome.
- A primitive or missing terminal produces a direct success outcome.
- A tracked terminal, including one reached through a cycle cut, starts the raw
  copy-or-collect walk.

No terminal requires a ref index.

## Copy guarantees

Before an Error is found, the raw walk creates one metadata-free plain-data
output graph:

- arrays retain their length and sparse slots;
- non-array containers become plain objects;
- DAG aliases retain one output identity;
- cycles point back into the output graph;
- only own enumerable string keys are copied;
- own-key enumeration order is preserved, including for Promise-backed keys;
- an own enumerable `__proto__` key is defined as ordinary data without invoking
  the inherited prototype setter; and
- runtime metadata, mirrors, counters, descriptors, and prototypes do not enter
  the output.

Each first-seen tracked identity enters `visited` and, while copying, `copies`
before descent so an alias or cycle can refer to its output immediately.
Property reads use logical mirror values.

## Collection-only switch

The first ordinary Error switches the complete export operation to
collection-only mode by setting `copying = false`. Error queries use their
separate counter-fenced traversal and state; they do not enter this raw walker.

After that switch:

- add every distinct ordinary Error identity to `errors`;
- continue traversing every relevant property and Promise;
- create no more output objects;
- perform no more output writes, including writes while recursive calls unwind;
  and
- record each first-seen tracked identity in `visited` before descending.

Copying completed before an asynchronously discovered Error is unavoidable.
The switch drops the copy map and root output, allowing that partial graph to
be collected while preventing all later copy allocation and writes. Pending
continuations capture source identity rather than output objects. Traversal
cannot stop at the first Error because another captured Promise may expose a
different Error.

## Promise ordering

The raw walk starts immediately instead of waiting for subtree counters.

- Synchronously reachable data is copied before export returns.
- A pending property registers through its exact Promise mirror as soon as
  export reaches it.
- Consumers already registered on that mirror run first, so their logical
  advances are included.
- Consumers issued later through the same captured path register afterward, so
  their advances are excluded.
- If a resolved value exposes another Promise, export registers the nested
  continuation synchronously inside its parent continuation, before a later
  consumer of the parent can register nested work through that path.
- Already-drained mirrors expose `currentValue` synchronously and create no
  duplicate continuation.

One operation-local readiness tree contains every recursively captured Promise.
The output graph remains private until that tree completes.

## Ownership precondition

Removing export's pin relies on the runtime's existing ownership contract:

- compiler-created mutable data has one owner;
- extracting or otherwise sharing a tracked value marks it shared;
- repeated imported identities are prepared as shared; and
- mutation through a shared route performs COW before writing.

Therefore a node that export has not yet reached cannot be changed in place by
a later operation through a different alias. Such an alias is necessarily
shared and its mutation copies away. This invariant is load-bearing; admitting
an unmarked alias from outside the import/compiler boundary invalidates the
kernel contract.

External code must not mutate an imported graph after import. Internal
non-sharing lookup may be used only for a pure read or a genuine ownership
transfer; it must not expose a value to mutable host code while export still
captures that value. COW protects runtime mutations, not arbitrary native
writes.

Export captures its issue-time path and the Promise frontier recursively
exposed through that path. It does not wait for an earlier operation suspended
on an unrelated Promise that is outside this captured frontier.

## Mirror and metadata effects

Export creates no shared mark, ref index, or settlement state. It may still
install a Promise mirror and therefore META when raw traversal first discovers
a pending property. This synchronous registration is required for FIFO
ordering.

One centralized mirror-acquisition helper enforces the downward-closure
invariant wherever import preparation, mutation, ref-indexing, path resolution,
or raw traversal encounters a Promise property:

- a pending property whose owner is already ref-indexed must already have the
  matching mirror; its absence is fatal corruption and export must not repair
  it; and
- a pending property on an unindexed owner may create and install its mirror.

The presence of `parents` publishes a completed ref index. Index construction
therefore adds it only after scanning every property and creating every required
mirror.

An export-created mirror can later drain while its owner is indexed. Its final
transition must produce the same exact counter and parent-edge delta as any
other mirror.

Export does not use:

- `buildRefIndex`;
- `promiseCount`, `errorCount`, or `cycleCutCount`;
- `markShared`; or
- subtree settlement generations.

`hasError` and `getErrors` retain lazy ref indexing because they can prune
settled clean regions without copying them. Export must inspect the complete raw
branch to produce successful output, so counters cannot avoid its traversal.

The final META schema has no `settlementPromise` or `settlementResolve`.
`waitForSettlement` is absent, and `applyCountDelta` contains no export
settlement zero-crossing branch.

## Completion and fatal errors

The raw walk returns no readiness value when its complete frontier is available
synchronously. Otherwise it returns one hierarchical `Promise.all` tree.

Export consumes that readiness with `onInternalResolve`:

- rejected data Promises have already been converted to ordinary Error values
  by their Promise mirrors; and
- rejection or failure of the internal readiness tree is fatal and passes
  through `reportFatalError`.

The synchronous path-resolution and raw-walk prefix runs under the same fatal
boundary. Unexpected getter, enumeration, invariant, or output-write failures
are reported through `reportFatalError`; they are never returned as language
Error data.

After readiness:

- a non-empty `errors` Set becomes the Error outcome; or
- the root output graph becomes the success outcome.

A synchronously discovered Error does not permit early completion when another
captured Promise remains pending: export must wait in case that Promise exposes
another distinct Error. `hasError` may therefore return `true` synchronously
while export returns a Promise for the complete Error outcome.

There is no second classification, Error walk, or copy walk.

## Error scope

For Errors already present in language data, the Error outcome contains exactly
the identities reachable from the captured terminal through:

- synchronously available properties;
- Promise values consumed at export's FIFO positions; and
- raw values behind cycle cuts.

Repeated references to one Error contribute one entry. Distinct Error objects
remain distinct. Cycle cuts contribute nothing. Array order is not semantic;
identity-set equality is the contract.

A broken required path prefix creates a fresh path-access Error for each public
operation. Export and `getErrors` therefore do not share that Error identity;
their path failures agree structurally by Error kind, message, and attribution.

## Raw walker

`src/raw-walk.js` owns export's identity-aware traversal primitive. Export keeps
a copy map only until its Error Set becomes non-empty.

The traversal returns only optional readiness. Copied values live in the copy
map; export reads its root copy there after the synchronous walk. Operation-owned
state carries the Error Set, so no separate mutable inspection wrapper is
required. The operation-wide `copying` field supplies the initial and dynamic
output policy without overloading Error-Set emptiness.

## Required coverage

Run under inline and WeakMap metadata storage:

- synchronous clean primitives, plain objects, arrays, sparse arrays, DAG
  aliases, cycles, Promise-backed own-key order, and own enumerable `__proto__`
  data;
- synchronous distinct and aliased ordinary Errors;
- a freshly generated path-access Error as the sole structural Error outcome;
- a focused raw-walker state test, without production-only instrumentation,
  proving that an early Error disables later output allocation and writes;
- a known Error plus a pending Promise remaining pending until all distinct
  Errors are known;
- rejected Promises converted to ordinary Error values;
- recursively exposed and alternating Promise/cycle frontiers;
- ordinary Errors and Promises reachable only through cycle cuts;
- one identity reachable synchronously and again behind a Promise using its
  original output copy;
- an earlier Promise consumer changing the value before export's consumer;
- a later Promise consumer or mutation leaving export's copy unchanged;
- an owned synchronous node mutated in place after export copied it;
- a node behind a Promise reached later through another shared alias, proving
  the ownership precondition prevents a torn copy;
- live, revoked, drained, and pending captured mirrors;
- a pending property on an indexed owner missing its required mirror failing
  fatally rather than being repaired;
- an export-created mirror on an unindexed owner later draining under indexed
  ownership with exact counters and parent edges, including a non-extensible
  holder;
- non-extensible and imported-original holders retaining their physical Promise
  while export materializes the logical value;
- concurrent exports owning independent identity, Error, and readiness state;
- metadata-free successful output;
- no export-created shared mark, ref index, or settlement state;
- internal readiness rejection remaining fatal; and
- a clean array success beside an Error-bearing array failure, proving the
  outer Error channel is unambiguous.

For equivalent captured data positions, after all required readiness:

```text
hasError(chain, path) === (getErrors(chain, path).length > 0)
```

Export succeeds exactly when both sides are false. Otherwise its Error outcome
contains the same distinct data Error identities, compared without array-order
significance. Structural path failures are compared separately as described
above.
