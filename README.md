# Cascada chain resolution

Cascada is an implicitly asynchronous data language. A value may contain
Promises at any depth, operations are issued without waiting for earlier
Promises, and the result must still match sequential program order.

This repository is a sandbox for the runtime kernel that provides those
semantics.

## Usage

The package is native ESM and runs directly in Node without compilation:

```js
import * as runtime from "cascada-chain-resolution"

const chain = new runtime.Chain({ ready: true })
const output = runtime.export(chain, [])
```

Internal modules group helper functions under a namespace:

```js
import * as helpers from "./helpers.js"

if (helpers.isError(value) || helpers.isPromise(value)) {
    // ...
}
```

## Documentation

- [`docs/runtime-spec.md`](docs/runtime-spec.md) defines the current observable
  behavior and compiler/host contracts.
- [`docs/import-preparation.md`](docs/import-preparation.md) explains imported
  graph preparation, aliases, cycles, and Promise continuations.
- [`docs/counters-implementation.md`](docs/counters-implementation.md) explains
  lazy subtree counters, Promise mirrors, settlement, and verification.
- [`docs/cycles-as-data.md`](docs/cycles-as-data.md) defines cycle cuts and the
  projected/raw traversal boundary.
- [`docs/plan.md`](docs/plan.md) tracks implemented and pending work.
- [`docs/future/export-error-set.md`](docs/future/export-error-set.md)
  specifies a future complete Error result for export.

The first four documents describe the implemented runtime. `docs/plan.md`
tracks both completed and pending work; documents under `docs/future` describe
planned end states and are not current behavior.

## Source layout

- `src/index.js` owns `Chain`, runtime initialization, and the public API.
- `src/mutations.js` owns assignment, deletion, mutation-path walking, and COW.
- `src/observations.js` owns lookup, export, Error queries, and their
  shared observational walkers.
- `src/import.js` prepares imported graphs, aliases, cycles, and Promise
  continuations.
- `src/refcounts.js` owns lazy subtree counters, parent edges, settlement, and
  atomic property transitions.
- `src/promise-mirrors.js` owns the `PromiseMirror` lifecycle and logical reads.
- `src/raw-walk.js` owns metadata-free graph copying and raw Error traversal.
- `src/language-properties.js` owns descriptor validation and safe physical
  writes for language-visible properties.
- The remaining small modules own metadata, fatal errors, helpers, and refcount
  verification.

## Runtime model

Three rules shape the kernel:

- **Values are implicitly asynchronous.** A Promise is used as the value it
  will produce. A property may itself be a Promise.
- **Errors are values.** A rejected data Promise becomes an Error value at the
  property where its result belongs. Runtime failures are separate and fatal.
- **Variables have value semantics.** Reusing a value behaves like copying it:
  changing one owner must never change another.

Objects and arrays are tracked nodes. A node and everything reachable below it
form a branch. Runtime operations work on a `Chain`, whose private
`_state.value` slot is the mutable root location; other `Chain` fields are not
language data.

## Owned and imported data

Compiler-created data follows a single-owner contract. A new tracked value has
one owner. When it escapes or receives another owner, the runtime marks it
shared. A later mutation through a shared branch copies only the path being
changed.

External JavaScript data has no such guarantees. It may contain repeated
identities, cycles, non-extensible objects, and Promises at any depth. Every
external value enters through `import(value, errorContext)`, which:

- marks the imported boundary shared;
- retains the attribution context;
- prepares aliases and cycle-closing properties;
- registers imported Promise continuations in issue order; and
- leaves subtree counters lazy until a branch query needs them.

Imported host objects are not physically changed. Logical settled Promise
values and cycle cuts live in runtime metadata. Language mutation first copies
the imported path. A cut is structural bookkeeping, not an Error: finite paths
cross it normally, Error queries ignore it as data, and export reconstructs the
original cyclic topology.

Host code receives tracked Cascada data only through `export`, which returns
a metadata-free deep copy with logical Promise values materialized. Internal
code may use non-sharing lookup only when it does not expose the returned
tracked value to mutable host code.

## Commands and issue order

The public operations are:

| Operation | Purpose |
| --- | --- |
| `assignPath(chain, path, value)` | Assign or replace a path value |
| `deletePath(chain, path)` | Delete a path value |
| `lookupPath(chain, path, sharedOwnership)` | Read a path value |
| `import(value, errorContext)` | Admit external data |
| `export(chain, path)` | Produce settled metadata-free output |
| `hasError(chain, path)` | Test for a reachable Error |
| `getErrors(chain, path)` | Collect distinct reachable Errors |

Every operation runs its synchronous prefix immediately. If it reaches a
Promise, it registers a continuation and returns; the next operation starts
without waiting.

JavaScript runs reactions registered on one Promise in registration order.
Cascada issues operations and registers their reactions in program order, so
operations blocked on the same Promise resume in that order. The runtime never
uses `await` to enter a Promise-backed branch because doing so would move
registration out of the operation's issue position.

Observations describe the branch captured at their own issue position. A later
assignment or deletion may change the live `Chain`, but it cannot change what
an earlier lookup, export, or Error query observes.

## Promise mirrors

Each Promise-backed property has a mirror record. It identifies that exact
property version and stores:

- the original Promise;
- the latest logical value prepared by registered consumers;
- the number of consumers that still have synchronous work to perform; and
- any private or published cycle cut for that placement.

The mandatory writeback is the first consumer. Every later operation that
needs the property registers through the same mirror and increments its
consumer count synchronously.

While any consumer remains, the property is still logically pending. A later
read joins the Promise queue instead of observing a half-advanced settled
value. The final successful consumer commits one transition from the pending
placement to its final logical state.

Overwriting or deleting a Promise-backed property removes its live mirror.
Operations that already captured the old mirror continue privately, but their
result cannot write back into the newer property. Reassigning the same Promise
creates a fresh mirror because it is a new property version.

When copy-on-write copies a node containing a pending property, the copy gets
its own mirror at the copy's issue position. The original and copied worlds
therefore include exactly the earlier operations and diverge independently
after the copy.

## Copy-on-write

A tracked node starts owned. Shared lookup, import, repeated imported identity,
and non-extensibility establish shared ownership. A shared node is never
mutated in place.

For a write such as:

```js
doc.body.title = "Final"
```

the runtime shallow-copies only `doc` and `body`, installs the new title, and
reuses every off-path child. Reused tracked children are marked shared because
both worlds can now reach them.

The language-visible property surface is own enumerable string keys. Arrays
preserve their length during copying. Runtime metadata is outside that surface
and is reconstructed only where needed; it is never copied as language data.

## Subtree counters

`hasError`, `getErrors`, and `export` ask questions about complete branches.
Repeated full scans would be expensive, so the first such operation builds a
lazy ref index for the reached branch.

Each indexed node stores:

- `promiseCount`: pending Promise placements in its projected subtree;
- `errorCount`: Error placements in its projected subtree;
- `cycleCutCount`: cycle-cut placements in its projected subtree; and
- reverse parent edges with exact structural multiplicity.

Every committed property transition computes the old and new contribution,
updates the reverse edge, and propagates one delta through indexed parents.
Unqueried branches pay no counter maintenance cost.

Imported cycles cannot participate directly in recursive parent propagation.
A cycle cut contributes only to `cycleCutCount` and installs no reverse parent
edge. Operations requiring complete raw data cross cuts with an identity-aware
walk.

## Branch observations

**`hasError`** returns `true` immediately for a positive `errorCount`. A
cut-free branch uses counter-pruned Promise traversal; a branch with cuts uses
one raw identity-aware traversal and reports only ordinary Errors. It does not
pin or mark the branch.

**`getErrors`** returns each reachable Error identity once. Counters prune clean
cut-free regions. A branch containing cuts is walked raw so ordinary Errors and
Promises hidden behind the projection remain visible. Cuts themselves add
nothing. It waits for the complete Promise frontier captured and recursively
exposed at its issue position.

**`export`** produces a metadata-free deep copy. If settlement is required,
it marks the reached branch shared so later writes copy away, then waits for
`promiseCount` to reach zero after every earlier mirror consumer drains.
Ordinary Errors collapse the current sandbox result to one Error. The final
copy always walks the raw graph, so aliases and cycles are reconstructed and
Promises hidden behind cuts are included.

## Metadata

One META record per tracked node contains only the fields whose subsystems have
become active: ownership marks, import state, Promise mirrors, cycle
cuts, counters, reverse parents, and optional export settlement
state.

Inline mode stores META in an own non-enumerable Symbol property when possible.
WeakMap mode stores it externally, and inline mode uses the same WeakMap
fallback for non-extensible nodes. Both modes have identical behavior and run
the complete test suite.

The detailed invariants and transitions live in
[`counters-implementation.md`](docs/counters-implementation.md).
