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

## Data-only language scope

For now, Cascada variables hold data only:

- primitive values;
- plain objects and null-prototype records;
- ordinary arrays;
- Error values; and
- Promises that produce supported data.

Functions and class instances are not part of the planned language value
surface. Common string and array work will be provided by language-defined
data-handling functions instead of arbitrary JavaScript calls. Those
operations will use Cascada ordering and return data or Error values; they will
not expose tracked objects to host code or permit user-defined side effects.

Map, Set, native container behavior, arbitrary functions, and executable class
methods remain deferred.

## Internal class COW experiment (on hold)

The kernel currently contains and tests an internal experiment for copying an
explicitly certified JavaScript class instance without losing its prototype.
It is not a supported Cascada language feature, its certification Symbol is
not public, and further class integration is on hold.

The experiment is limited to simple data classes.

A supported instance must keep all meaningful state in ordinary public
properties:

```js
class Point {
    constructor(x, y) {
        this.x = x
        this.y = y
    }

    length() {
        return Math.hypot(this.x, this.y)
    }
}
```

Its state properties must be own, enumerable, string-keyed data properties.
Inherited methods and class inheritance are preserved when copy-on-write makes
a new instance. The constructor is not called during copying.

External classes must not depend on:

- `#private` fields;
- Symbol-keyed or non-enumerable state;
- getters or setters used as instance state;
- state hidden in closures;
- hidden shared mutable storage; or
- native internal slots such as those used by Map, Set, Date, RegExp, and typed
  arrays.

These restrictions are trusted. JavaScript reflection cannot reliably detect
all hidden state.

Promise-valued properties are supported when they are ordinary own enumerable
writable data properties. Assigning even the same Promise again creates a new
property version.

Arrays, including array subclasses and cross-realm arrays, are copied as
ordinary local arrays. Array-subclass prototypes and methods are not retained.
Export also intentionally produces plain host data rather than preserving
class prototypes or methods.

An uncertified or unsupported class instance can still exist as data. If a
mutation needs to copy it, that placement becomes an Error value instead of a
counterfeit plain object. Host code must not mutate an instance or its
descriptors after importing it.

The certification Symbol currently belongs to the internal mutation module
and is not part of the package-level public API. The complete implemented
contract is documented in
[`property-state-classes.md`](docs/property-state-classes.md).

## Archived `run` design

**On hold.** Class support — native and CascadaScript — is not planned work.
Language variables hold data only for now. The design below is retained for the
analysis it records, not as pending work; see
[`run.md`](docs/future/run.md) for why it was deferred.

```js
run(path, mutates, ...arguments)
```

It would support side-effect-free functions, native JavaScript methods, and
compiler-generated CascadaScript methods.

Standalone functions use:

```js
run(functionPath, false, ...arguments)
```

They may return a value or Promise, but must not mutate arguments, closure
state, globals, I/O, DOM state, or any other host state. Purity is trusted;
arbitrary JavaScript side effects cannot be detected.

A trusted read-only native method also uses `false`. It runs directly on the
original receiver without a proxy, copy, or graph traversal:

```js
run(["point", "length"], false)
```

Mutating native methods use a temporary proxy-backed draft:

```js
run(methodPath, true, ...arguments)
run(methodPath, ["position", "velocity"], ...arguments)
```

`true` permits synchronous mutation throughout the supported receiver graph.
An array permits replacement of those direct receiver properties and mutation
of every supported identity reachable beneath them. Permission follows object
identity, so an allowed object remains allowed when reached through another
alias.

Native methods may mutate ordinary properties, nested objects, arrays,
aliases, and cycles. Only identities that were written, plus the containers
needed to reconnect them, are copied after the call. Unchanged data is reused.

Native methods may have Promise-valued properties and may return a Promise.
All receiver access and mutation must finish before the native method returns
that Promise. This is valid:

```js
async calculate() {
    this.status = "started"
    const input = this.input
    return calculate(input)
}
```

This is not:

```js
async calculate() {
    const result = await calculate(this.input)
    this.result = result
}
```

The draft is committed and revoked as soon as the method returns. Code running
after `await`, in a timer, or in a later callback cannot read or mutate the
draft. A later rejection becomes an Error result but does not undo synchronous
changes already committed.

Native `run` does not support private fields, accessors used as state,
descriptor or prototype mutation, sealing/freezing, Symbol or non-enumerable
mutation, mutation through unproxied arguments or closure aliases, or native
Map/Set/Date-style internal mutation. It can roll back intercepted draft
writes after a thrown exception, but it cannot roll back I/O, globals, DOM
changes, or other external effects.

Returning an Error is a successful result and keeps synchronous changes.
Throwing an Error fails the call and discards intercepted draft changes.
Expected usage failures are returned as Error values; fatal reporting is
reserved for runtime bugs and invariant failures.

CascadaScript classes use a different implementation selected by trusted
compiler metadata. Their properties are Cascada variables, so their methods
use normal Cascada operations instead of JavaScript proxies. They may suspend
on Promises and mutate later because the compiler registers each continuation
at its correct program position.

The complete proposed design and limitations are documented in
[`run.md`](docs/future/run.md).

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
- [`docs/plan.md`](docs/plan.md) tracks implemented, deferred, and pending
  work.

The first five documents describe the implemented core runtime.
`docs/property-state-classes.md` records an implemented kernel experiment whose
language integration is on hold. `docs/plan.md` tracks completed, deferred, and
pending work.

### Pending designs

- [`docs/future/keyed-containers.md`](docs/future/keyed-containers.md) records
  deferred array-subclass, Map, Set, other built-in, and virtual-property ideas
  that are not requirements of step 20.
- [`docs/future/run.md`](docs/future/run.md) archives the proposed `run`
  function/method analysis, why class support is on hold, and the machinery
  that would be required to revive it.

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
