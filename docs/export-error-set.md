# Export with the complete Error set

**Status:** Implemented.

`export` is one operation that either returns a metadata-free copy of its
captured branch or reports every distinct ordinary Error reachable from that
branch. Cycles are valid data and remain cycles in successful output.

## Result channel

Successful data returns directly. Failure returns a fresh non-thenable Error
with message `export: branch contains errors`. Its `.errors` array contains
every distinct reachable Error identity.

The outer Error distinguishes failure from a successful array value.

## One captured operation

Export does not call `getErrors` or start a second path operation. Path
resolution and raw traversal register at export's issue position and share one
state across the synchronous prefix and every recursively exposed Promise:

```js
{
    visited: new WeakSet(),
    copies: new WeakMap(),
    errors: new Set(),
    copying: true,
}
```

- `visited` spans the complete operation and keeps cycles finite.
- While copying, `copies` maps each source object to its one output object.
- The first Error sets `copying = false` and releases the copy map.
- Every captured Promise extends the same hierarchical readiness tree.

The export shell keeps one reference to the root output and clears it when
collection-only mode begins.

## Direct terminals

- A path-blocking or terminal Error produces a one-element Error outcome.
- A primitive or missing terminal returns directly.
- A tracked terminal begins the raw copy-or-collect walk.

Export never requires a ref index.

## Copy guarantees

Before an Error is found, the raw walk creates one plain-data output graph:

- arrays retain length and sparse slots;
- tracked non-array containers become plain objects;
- opaque values retain their identity;
- aliases retain one output identity;
- cycles point back into the output graph;
- object own enumerable string keys and Array indexed elements are copied;
- own-key enumeration order is preserved;
- an own enumerable `__proto__` key is defined as ordinary data; and
- runtime metadata, mirrors, counters, descriptors, and prototypes are omitted.

A tracked identity enters both identity tables before descent so aliases and
cycles can refer to its output immediately.

## Collection-only mode

The first ordinary Error switches the complete operation to collection-only
mode. From then on the walk:

- records every distinct Error identity;
- continues through every captured property and Promise;
- creates no output objects;
- performs no output writes; and
- still records visited identities before descending.

Work copied before an asynchronously discovered Error is unavoidable, but
dropping the copy map and root reference lets the abandoned output graph be
collected. Traversal cannot stop at the first Error because another captured
Promise may expose a different Error.

## Promise ordering

The raw walk begins immediately:

- synchronously available data is copied before export returns;
- a logical Promise property registers through its exact `PromiseMirror`;
- its first resolver runs before export's later readiness resolver;
- export then reads that captured mirror's latest value;
- recursively exposed Promises are registered synchronously in the parent
  resolver; and
- an already resolved logical property is read synchronously and causes no
  duplicate Promise registration.

Every callable thenable has one canonical native Promise. Every resolver uses
one direct reaction on that shared Promise and completes its local work
synchronously. Same-Promise FIFO order therefore makes earlier operations
visible and excludes later ones.

## Ownership precondition

Export does not pin or mark the source branch. Its issue-time behavior relies
on the runtime ownership contract:

- compiler-created mutable data has one owner;
- extracting or otherwise sharing a tracked value marks it shared;
- repeated imported identities are classified as shared; and
- mutation through a shared route COWs before writing.

Thus a later operation cannot mutate an unreached node in place through another
valid alias. External code must not mutate imported data after import. Native
code receives runtime data through `export`, not through runtime-owned
identities.

Export captures only its reached path and the Promise frontier recursively
exposed through that path. It does not wait for unrelated Promises elsewhere in
the Chain.

## Mirror and metadata effects

Export creates no shared mark, ref index, or settlement state. It may install a
Promise mirror when traversal first discovers a logical Promise on an unindexed
owner. Registration is synchronous and preserves FIFO order.

Mirror acquisition enforces downward closure:

- an indexed owner must already have the mirror for every logical Promise
  property; absence is fatal corruption; and
- an unindexed owner may lazily create the mirror.

`parents` is published only after index construction has scanned every property
and created every required mirror.

If an export-created mirror later resolves after its owner becomes indexed, its
first resolver indexes the new tracked value and commits the exact counter and
parent-edge delta.

Export does not use `buildRefIndex`, subtree counters, shared marking, or a
settlement coordinator. Error queries retain ref indexing because counters can
prune clean branches; export must inspect the complete raw graph to create a
successful copy.

## Completion and fatal errors

The raw walk returns no readiness when its complete frontier is synchronous.
Otherwise it returns one hierarchical `Promise.all` tree.

Export consumes that tree with `resolveOperationResultOrFatal`:

- rejected data Promises were converted to ordinary Error values by their
  first property resolver; and
- rejection or failure of internal readiness is fatal.

The synchronous path and raw-walk prefix run inside the same fatal boundary.
Unexpected enumeration, descriptor, invariant, or output-write failures are
reported fatally rather than returned as data Errors.

After readiness:

- a non-empty Error Set becomes the Error outcome; or
- the root output becomes the successful result.

A synchronously known Error does not complete export while a captured Promise
is pending, because that Promise may reveal another distinct Error. `hasError`
can therefore return `true` synchronously while export remains pending.

## Error scope

The Error result contains exactly the ordinary Error identities reachable from
the captured terminal through:

- synchronously available properties;
- Promise values consumed at export's FIFO positions; and
- raw properties behind cycle cuts.

Repeated references contribute one entry. Distinct Error objects remain
distinct. Cycle cuts contribute nothing. Array order is not semantic.

A broken required path creates a fresh path-access Error for each public
operation. Export and `getErrors` therefore agree structurally on such failures,
not by Error identity.

## Raw walker

`src/raw-walk.js` owns the identity-aware traversal. It returns only optional
readiness; copied values live in the operation's copy map and Errors in its Set.
The `copying` flag controls both initial output creation and the global switch
to collection-only mode.

## Required coverage

The inline and WeakMap suites cover:

- primitives, objects, arrays, sparse arrays, aliases, cycles, own-key order,
  and enumerable `__proto__`;
- synchronous, aliased, distinct, and path-access Errors;
- a known Error beside pending and recursively exposed Promises;
- rejected Promises converted to ordinary Errors;
- Promise and Error values reachable only through cycle cuts;
- switching once to collection-only mode with no later copy allocation;
- earlier same-Promise operations included and later operations excluded;
- live and detached Promise property versions;
- a missing required mirror below an indexed owner failing fatally;
- an unindexed owner discovered by export and indexed before settlement;
- writable runtime Promise properties, non-writable imported Promise data
  properties, and invalid accessor properties;
- concurrent exports with independent state;
- metadata-free successful output; and
- fatal internal readiness rejection.

At equivalent captured positions:

```text
hasError(chain, path) === (getErrors(chain, path).length > 0)
```

Export succeeds exactly when both sides are false. Otherwise its `.errors`
array contains the same distinct data Error identities, disregarding order.
