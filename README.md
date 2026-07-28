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
  lazy subtree counters, Promise mirrors, and verification.
- [`docs/cycles-as-data.md`](docs/cycles-as-data.md) defines cycle cuts and
  cut-separated ref-index components.
- [`docs/export-error-set.md`](docs/export-error-set.md) defines export's fused
  copy-or-collect traversal and complete Error result.
- [`docs/property-state-classes.md`](docs/property-state-classes.md) defines
  certified class prototype preservation during copy-on-write.
- [`docs/plan.md`](docs/plan.md) tracks implemented and pending work.

The first six documents describe the implemented runtime. `docs/plan.md`
tracks both completed and pending work.

### Pending designs

- [`docs/future/keyed-containers.md`](docs/future/keyed-containers.md) records
  deferred array-subclass, Map, Set, other built-in, virtual-property, and
  method-integration ideas that are not requirements of step 20.

## Source layout

- `src/index.js` owns `Chain`, runtime initialization, and the public API.
- `src/mutations.js` owns assignment, deletion, mutation-path walking, and COW.
  It also owns the host-only property-state class certification Symbol and the
  private COW shell selection.
- `src/observations.js` owns lookup, export, Error queries, and their
  shared observational walkers.
- `src/import.js` prepares imported graphs, aliases, cycles, and Promise
  continuations.
- `src/property-transitions.js` coordinates property replacement, deletion,
  Promise-mirror publication, and cycle-cut changes.
- `src/refcounts.js` owns lazy subtree counters, parent edges, and atomic
  accounting around indexed property transitions.
- `src/promise-mirrors.js` owns the `PromiseMirror` lifecycle.
- `src/raw-walk.js` owns metadata-free export copying and Error collection.
- `src/language-properties.js` owns descriptor validation and safe physical
  writes for language-visible properties.
- The remaining small source modules own metadata, fatal errors, and helpers.
  Refcount verification is test-only in `test/verify-refcounts.js`.

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

Language mutation never changes imported host objects; it copies the imported
path first. Promise settlement is the one deliberate handoff: an own enumerable
writable Promise property receives its prepared value physically. A Promise
property that is missing, non-enumerable, an accessor, or non-writable is
invalid imported data. Ordinary frozen data remains supported.

Cycle cuts live in metadata. A cut is structural bookkeeping, not an Error:
finite paths cross it normally, Error queries ignore it as data, and export
reconstructs the original cyclic topology.

Host code receives tracked Cascada data only through `export`, which returns a
metadata-free deep copy with captured Promise-property values materialized.
Internal code may use non-sharing lookup only when it does not expose the
returned tracked value to mutable host code.

## Commands and issue order

The public operations are:

| Operation | Purpose |
| --- | --- |
| `assignPath(chain, path, value)` | Assign or replace a path value |
| `deletePath(chain, path)` | Delete a path value |
| `lookupPath(chain, path, sharedOwnership)` | Read a path value |
| `import(value, errorContext)` | Admit external data |
| `export(chain, path)` | Copy host-ready output or collect its Errors |
| `hasError(chain, path)` | Test for a reachable Error |
| `getErrors(chain, path)` | Collect distinct reachable Errors |

Every operation runs its synchronous prefix immediately. If it reaches a
Promise, it registers a continuation and returns; the next operation starts
without waiting. Each callable thenable is canonicalized once to one native
Promise, so every runtime registration for that value shares one FIFO queue.

JavaScript runs reactions registered on one Promise in registration order.
Cascada issues operations and registers their reactions in program order, so
operations blocked on the same Promise resume in that order. The runtime never
uses `await` to enter a Promise-backed branch because doing so would move
registration out of the operation's issue position.

Observations describe the branch captured at their own issue position. A later
assignment or deletion may change the live `Chain`, but it cannot change what
an earlier lookup, export, or Error query observes.

## Promise mirrors

Each Promise-backed property has a mirror identifying that exact property
version. While the mirror is live, the physical property is its authoritative
state: first the Promise, then each value produced by FIFO operations. The
first resolver consumes fulfillment or converts rejection to Error and
publishes it. Later resolvers use the Promise only as a readiness signal and
read the latest property value left by earlier resolvers.

Overwriting or deleting the property detaches its mirror. At that moment the
old value is captured as `detachedValue`; already-issued operations continue
against that private state and cannot write into the replacement property.
Reassigning even the same Promise creates a fresh mirror because it is a new
property version.

When copy-on-write copies a node containing a pending property, the copy gets
its own mirror at the copy's issue position. Its FIFO resolver samples the
source at that exact position, so the two worlds include the same earlier
operations and diverge independently afterward.

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

`hasError` and `getErrors` ask questions about complete branches. Repeated full
scans would be expensive, so the first Error query builds a lazy ref index for
the reached branch. Export walks the raw branch directly because producing a
successful copy already requires visiting all of it.

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
edge. Ref-indexing resumes at the target as an independent component, while
export alone walks the raw graph without counters.

## Branch observations

**`hasError`** returns `true` immediately for a positive `errorCount`. A
counter-fenced walk follows only subtrees whose Promise, Error, or cycle-cut
count reports relevant work. At a cycle cut, its independently indexed target
resumes the same fenced traversal. It reports only ordinary Errors and does not
pin or mark the branch.

**`getErrors`** returns each reachable Error identity once. Counters prune clean
regions through the same fenced walk, including independently indexed cut
targets. Cuts themselves add nothing. It waits for the complete Promise
frontier captured and recursively exposed at its issue position.

**`export`** performs one immediate raw copy-or-collect walk at its issue
position. A successful result is a metadata-free deep copy preserving arrays,
holes, own-key order, aliases, cycles, enumerable `__proto__`, and captured
Promise-property values.
The first Error stops further copy allocation, but traversal continues through
the complete captured Promise frontier. Failure returns a fresh outer Error
whose `.errors` array contains each reachable Error identity once. Export does
not ref-index, mark, or pin the branch.

## Metadata

One META record per tracked node contains only the fields whose subsystems have
become active: ownership marks, import state, Promise mirrors, cycle
cuts, counters, and reverse parents.

Inline mode stores META in an own non-enumerable Symbol property when possible.
WeakMap mode stores it externally, and inline mode uses the same WeakMap
fallback for non-extensible nodes. Both modes have identical behavior and run
the complete test suite.

The detailed invariants and transitions live in
[`counters-implementation.md`](docs/counters-implementation.md).
