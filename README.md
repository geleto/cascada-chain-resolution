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

`new Chain(value, mutates = true)` stores the Chain's exact capability mode. `chain.close()` prevents new operations through that Chain without cancelling work already issued through it; closing is one-shot.

Internal modules group value predicates under a namespace:

```js
import * as languageValues from "./language-values.js"

if (languageValues.isError(value) || languageValues.isPromise(value)) {
    // ...
}
```

## Data class copy-on-write

The kernel supports copying an explicitly registered JavaScript data-class
instance without losing its prototype. This is completed support for class
instances as data; the implemented runtime graph remains data-only. Restricted
side-effect-free method invocation is defined in [`run.md`](docs/run.md), while
general proxy-backed mutating class methods remain deferred in
[`future/run.md`](docs/future/run.md).

The COW support is limited to simple data classes.

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

runtime.registerDataClass(Point)
```

Its state properties must be own, enumerable, string-keyed data properties.
Inherited methods and class inheritance are preserved when copy-on-write makes
a new instance. The constructor is not called during copying. Registration is
permanent, applies only to the class's exact prototype, and must happen before
its instances enter Cascada. Register each participating subclass separately.
The registry does not modify the class or its prototype.

External classes must not depend on:

- `#private` fields;
- Symbol-keyed or non-enumerable state;
- getters or setters used as instance state;
- state hidden in closures;
- hidden shared mutable storage; or
- native internal slots such as those used by Map, Set, Date, RegExp, and typed
  arrays.

These restrictions are trusted. JavaScript reflection cannot reliably detect
all hidden state. No standard internal-slot class is registered automatically;
such types require dedicated support rather than `registerDataClass`.

Promise-valued properties are supported when they are ordinary own enumerable
writable data properties. Assigning even the same Promise again creates a new
property version.

Arrays, including array subclasses and cross-realm arrays, are copied as
ordinary local arrays. Array-subclass prototypes and methods are not retained.
Export also intentionally produces plain host data rather than preserving
class prototypes or methods.

An unregistered class or native internal-slot object remains an opaque identity
leaf. It can be assigned, returned, and exported, but Cascada does not traverse,
copy, index, or invoke methods on it. External mutation of an opaque value is
outside Cascada's guarantees.

The complete implemented contract is documented in
[`data-classes.md`](docs/data-classes.md).

## Implemented `enter` and standard invocation

The mutating `enter` primitive declares an asynchronous effect path before
waiting:

```js
return enter(player, ["pos"], true, entered => {
  assignPath(entered, ["x"], 2)
})
```

For a mutating entry, `player.pos` becomes a gate Promise and mutating `enter` passes a
private Chain rooted at the captured property version to its callback. `onEntered` may be
synchronous or asynchronous: operations return either their direct result or a
Promise defining the callback's complete lifetime. Mutating `enter` keeps the Chain active
until that result fulfills, then prevents new operations through it and publishes
the private value through the gate automatically. It forwards the operation
result after closing the Chain without waiting for gate publication; the gate
itself orders later graph operations. Direct
entry setup invokes the callback synchronously. A pending path reuses the Promise
returned by the existing path helper. Each walker invokes its callback within
the existing path continuation; mutating setup does so after gate reconstruction.
Later consumers of that path Promise then traverse the installed gate. No second
same-source reaction, separate readiness Promise, pending state, source path, or
command queue is added.
If the callback throws or its Promise rejects, `enter` closes the Chain before
fatal reporting, releases a read-only entry if one was acquired, and leaves a
mutating gate unresolved.
Later traversals through `player.pos` wait in normal
mirror order while unrelated paths continue. A direct replacement of
`player.pos` creates a newer version immediately. Callback completion starts or
arranges publication of the private value. Publishing an Error uses an ordinary private-root assignment
before returning. If owning-path COW leaves the target reachable from the source
graph, a direct target is marked shared before the callback; a Promise target's
transfer sampler marks its prepared value before target-dependent private work. A
Promise-valued target first replaces the public placement with its gate, which
synchronously detaches the source mirror. It then installs the private-root
transfer before invoking the callback. The source version's earlier resolver
prepares `detachedValue`, which the transfer samples without retaining the source
parent or key. The callback starts immediately with
the source Promise while
target-independent work overlaps its resolution. Target-dependent commands
register behind the transfer on the source's canonical FIFO queue and receive
the prepared logical value. If callback work leaves the
private Chain's `state.value` holding a Promise, publication registers once
through `onLaterPromiseReady`. After the root mirror and earlier FIFO operations
have updated the authoritative slot, that callback opens the gate with the
current `state.value` rather than letting the gate resolver assimilate the raw
Promise. Another root Promise assignment would have occurred synchronously
before completion and would therefore be the value registered instead.
Gate installation and publication use ordinary atomic property transitions, so
indexed counters and reverse-parent edges remain exact; the private Chain's
host-state holder is not added to the language graph.

A read-only `enter(..., false, onEntered)` installs no gate and invokes its
callback only after capturing a protected root. Every tracked root
increments `META.readEnterCount`, including values already protected by
sharing or import; primitives require no metadata.
If the target was reached through an inherited import boundary, entry first
makes it an independently attributed imported root.
Overlapping readers increment independently. Live mutation then uses
copy-on-write without permanently marking an otherwise singly-owned value
shared. Earlier effects and Promise settlement remain part of the captured
world, while commands use their normal mirror semantics. Observational native
work uses an exported snapshot rather than the raw captured value;
already-issued kernel continuations remain ordered by
their captured mirror positions. Every Chain that can issue operations has an
exact `mutates` capability: ordinary Chains use `true`, while an entered Chain
uses the compiler's validated Boolean fact. Automatic completion removes it
from the entered Chain to prevent new operations. Internal
mutating/read-only paths and completion routines are neither exported nor called
directly by other operations.

The [`run`](docs/run.md) operation is restricted to
standard String and Array operations and trusted read-only methods. Path
Promises remain owned by the existing walkers; Array mutation installs an
assigned-Promise gate only when receiver or required argument preparation must
continue after the target is reached. Assignment-style element payloads remain
logical values and do not create a wait. Controlled Array methods use logical
algorithms and Promise-sensitive scalar conversion rather than exporting their
receiver or inspected elements. Ready work stays synchronous.
[`ArrayView`](docs/array-view.md) is its internal shared-range representation.
Functions and executable descriptors remain outside the language graph.
Trusted String protocols and callbacks and sort comparators are supported;
other Array callbacks are deferred, and only the known Array mutators may have
side effects.

General class methods that mutate through ordinary JavaScript `this` remain
separate future work. Their archived design combines `enter` with an
operation-local recursive proxy:

- [`enter.md`](docs/enter.md) defines the implemented primitive.
- [`run.md`](docs/run.md) defines the restricted standard operation.
- [`array-view.md`](docs/array-view.md) defines its internal shared-range
  representation.
- [`future/run.md`](docs/future/run.md) records the deferred mutating-class
  proxy design.
- [`future/run-draft-proxy-archive.md`](docs/future/run-draft-proxy-archive.md)
  retains the historical predecessor analysis.

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
- [`docs/data-classes.md`](docs/data-classes.md) defines
  registered data-class prototype preservation during copy-on-write.
- [`docs/enter.md`](docs/enter.md) defines implemented asynchronous path
  ownership and gate publication.
- [`docs/run.md`](docs/run.md) defines the restricted standard method
  operation.
- [`docs/array-view.md`](docs/array-view.md) defines its internal shared-range
  representation.
- [`docs/plan.md`](docs/plan.md) tracks implemented, deferred, and pending
  work.

These documents describe implemented runtime behavior. `docs/plan.md` tracks
completed, deferred, and pending work.

### Deferred designs

- [`docs/future/run.md`](docs/future/run.md) records proxy-backed mutating
  class methods beyond restricted `run`.
- [`docs/future/keyed-containers.md`](docs/future/keyed-containers.md) records
  deferred array-subclass, Map, Set, other built-in, and general
  virtual-container ideas.
- [`docs/future/run-draft-proxy-archive.md`](docs/future/run-draft-proxy-archive.md)
  preserves the earlier proxy/draft analysis that predates callback-based
  `enter`.

## Source layout

- `src/index.js` owns the public API and re-exports `Chain` from `src/chain.js`.
- `src/init.js` owns the cycle-breaking runtime wiring shared by the
  package facade and internal entry points.
- `src/mutations.js` owns assignment, deletion, mutation-path walking, and COW.
- `src/language-values.js` owns value classification and the data-class
  registry.
- `src/invocation.js` owns shared reflection, native calls, and ordinary
  exported-argument invocation, including String methods.
- `src/observations.js` owns lookup, export, Error queries, and their
  shared observational walkers.
- `src/run.js` owns restricted method routing and common observation handling.
- `src/array-view.js`, `src/array-invocation.js`, `src/array-methods.js`, and
  `src/array-remap.js` own logical Array representation and method execution.
- `src/import.js` prepares imported graphs, aliases, cycles, and Promise
  continuations.
- `src/property-transitions.js` coordinates property replacement, deletion,
  Promise-mirror publication, and cycle-cut changes.
- `src/refcounts.js` owns lazy subtree counters, parent edges, and atomic
  accounting around indexed property transitions.
- `src/promise-mirrors.js` owns the `PromiseMirror` lifecycle.
- `src/raw-walk.js` owns metadata-free export copying and Error collection.
- `src/language-properties.js` owns descriptor validation and logical reads and
  writes for language-visible properties.
- The remaining small source modules own metadata and fatal errors.
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

- marks each imported tracked identity shared;
- retains the attribution context;
- prepares aliases and cycle-closing properties;
- registers imported Promise continuations in issue order;
- stores newly needed metadata outside the host values; and
- leaves subtree counters lazy until a branch query needs them.

Language mutation never changes imported host objects; it copies the imported
path first. Promise settlement also preserves an imported property: its mirror
stores the logical result while the external Promise remains physically in
place. Imported Promise properties must be own enumerable data properties, but
need not be writable. Frozen data uses the same path.

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
| `run(chain, path, method, mutateArray, ...arguments)` | Invoke a supported method |
| `registerDataClass(Class)` | Register an exact class prototype as tracked data |
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
version. A live mirror normally writes each resolved value back to the property.
An imported property instead preserves its external Promise and keeps the
logical value in `resolvedValue` on the mirror. The first resolver consumes
fulfillment or converts rejection to Error and publishes that logical value.
Later resolvers use the Promise only as a readiness signal and read the latest
value left by earlier resolvers.

Overwriting or deleting the property detaches its mirror. At that moment the
logical value is moved to `detachedValue`; already-issued operations continue
against that private state and cannot write into the replacement property.
Reassigning even the same Promise creates a fresh mirror because it is a new
property version.

When copy-on-write copies a node containing a pending property, the copy gets
its own mirror at the copy's issue position. Its FIFO resolver samples the
source at that exact position and writes the result into the runtime-owned copy.
If the source already has a logical result, COW copies that result immediately
and creates no mirror. The two worlds include the same earlier operations and
diverge independently afterward.

## Copy-on-write

A tracked node starts owned. Shared lookup and import establish shared
ownership. A shared node is never mutated in place.

For a write such as:

```js
doc.body.title = "Final"
```

the runtime shallow-copies only `doc` and `body`, installs the new title, and
reuses every off-path child. Reused tracked children are marked shared because
both worlds can now reach them.

The language-visible object-property surface is own enumerable string keys.
Arrays expose only canonical indexes plus `length`; other string properties
cannot be assigned or deleted through Cascada. Arrays preserve their length
during copying. Runtime metadata is outside that surface and is reconstructed
only where needed; it is never copied as language data.

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

Inline mode stores runtime-owned META in an own non-enumerable Symbol property.
Imported META and all META in WeakMap mode live externally. Both modes have
identical behavior and run the complete test suite.

The detailed invariants and transitions live in
[`counters-implementation.md`](docs/counters-implementation.md).
