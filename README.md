# Cascada chain resolution

## Introduction

Cascada is a runtime kernel for an implicitly asynchronous data language. A
value may contain Promises at any depth, and operations can be issued without
waiting for earlier Promises. The runtime preserves program order so the
observable result is the same as if all values had been available and every
operation had run sequentially.

A `Chain` holds a logical root value. Path operations read and update its graph,
Promise mirrors preserve the exact property versions captured by pending work,
and copy-on-write keeps mutations isolated between owners. Imported host data is
never modified. JavaScript `Error` objects are language values, so a rejected
data Promise poisons the affected value without stopping unrelated work.

The package is native ESM, requires Node.js 24 or newer, and needs no build
step.

```js
import * as cascada from "cascada-chain-resolution"

const input = cascada.import(
    { profile: Promise.resolve({ name: "Ada" }) },
    "application input",
)
const chain = new cascada.Chain(input)

cascada.assignPath(chain, ["profile", "active"], true)

console.log(await cascada.export(chain, []))
// { profile: { name: "Ada", active: true } }
```

## API reference

```js
import {
    Chain,
    assignPath,
    deletePath,
    enter,
    externalState,
    export as exportValue,
    getErrors,
    hasError,
    import as importValue,
    lookupPath,
    managedState,
    managedStateClass,
    run,
} from "cascada-chain-resolution"
```

### Common behavior

A path is an array of property keys. An empty path (`[]`) selects the Chain
root. Records expose own enumerable string-keyed data properties; Arrays expose
canonical indexes and `length`. Missing final properties are valid, while a
missing or non-traversable intermediate property produces a language `Error`.

Operations do all available work synchronously. An observation or method call
returns a Promise only when its result depends on pending data. Operations
issued after it do not need to await that Promise: continuations are registered
in issue order and observe all earlier effects.

Managed records, Arrays, and class instances are traversable. Primitives,
Functions, Errors, and external identities are terminal values. Records and
Arrays default to managed; class instances default to external.

### `new Chain(initialValue, mutates = true)`

Creates a Chain rooted at `initialValue`. `mutates` must be exactly `true` or
`false`. A read-only Chain accepts observations but rejects mutation operations.
Creating a Chain admits the value but does not mark host data as imported; pass
host-provided roots through `import` first.

#### `chain.close()`

Permanently prevents new operations through the Chain. Work issued before the
call continues at its captured position. Closing a Chain more than once, or
using it after closure, is a fatal usage error.

### `import(value, errorContext)`

Admits externally owned data and returns its logical root. `errorContext` is a
required truthy value used to attribute failures.

For an available root, the original root is returned synchronously after its
reachable graph is classified. A Promise root returns a Promise for the
admitted result. Nested Promises are registered without waiting for them.
Imported identities are protected by copy-on-write, so Cascada mutations never
modify their host representation. Application code must not mutate the imported
graph after admission.

### `assignPath(chain, path, value)`

Assigns `value` to the selected property, creating a missing final property when
needed. An empty path replaces the root. Assignment uses copy-on-write whenever
the current logical value must be preserved for another owner.

Successful issuance returns `undefined`, including when traversal must resume
after a Promise. A failure found synchronously is published at the failed
mutation location and returned as an `Error`; a failure found later is published
to the graph.

### `deletePath(chain, path)`

Deletes the selected property. A missing final property is a no-op, deleting an
Array index preserves its length, and an empty path replaces the root with
`null`.

Its return behavior matches `assignPath`: success and suspended issuance return
`undefined`, while a synchronous failed mutation publishes and returns its
`Error`.

### `lookupPath(chain, path)`

Returns the value captured at `path`. A returned traversable identity gains an
owner and is marked shared, ensuring later mutation through either owner is
isolated by copy-on-write. The result is direct unless path traversal crosses a
Promise.

### `enter(chain, path, mutates, onEntered)`

Enters the value captured at `path` and passes a temporary Chain to
`onEntered`. `mutates` must be exactly `true` or `false`, and `onEntered` must be
a function. The temporary Chain is closed automatically when the callback's
direct result or Promise completes.

With `mutates: false`, the callback receives a read-only Chain and the captured
value is protected from concurrent Cascada mutation for the callback's complete
lifetime. The public path is not gated, so unrelated operations continue
normally.

With `mutates: true`, the callback receives a private mutable Chain. The target
placement is replaced with a Promise gate before target-dependent callback work
runs. Later operations on that placement wait while the callback issues its
private operations. When the callback fulfills, its final private root is
published through the gate; the callback's own result is returned from `enter`.
A mutating entry requires a mutable parent Chain.

If path resolution produces a language `Error`, the callback is not invoked and
the Error is returned. A callback throw or rejected callback Promise is fatal,
closes the temporary Chain, and does not publish its private state.

### `export(chain, path)`

Returns a host-ready snapshot of the branch captured at the operation's issue
position. Traversable data is deep-copied without runtime metadata while
preserving Arrays, holes, property order, aliases, and cycles. Managed class
instances become plain records; external values retain their exact identities.

If the branch contains one `Error`, that Error is returned. If it contains
several distinct Errors, export returns a new `Error` whose `errors` property
contains them. The result is a Promise when the complete snapshot or Error set
depends on pending data.

### `hasError(chain, path)`

Returns `true` when an `Error` is reachable from the captured path value and
`false` otherwise. A broken required path counts as an Error. The result is
direct when it can be decided immediately and otherwise a Promise for a
Boolean.

### `getErrors(chain, path)`

Returns each distinct reachable `Error` identity once. A broken required path
contributes its path-access Error; a missing or primitive final value contributes
nothing. The result is an Array when complete synchronously and otherwise a
Promise for the Array.

### State declarations

`externalState(value)` declares one exact record, Array, or class instance
external and returns it. The declaration is shallow.

`managedState(value)` declares a class instance managed and returns it. Given
unadmitted managed state, it also declares every currently reachable class
instance while preserving aliases and cycles.

`managedStateClass(...classes)` declares each exact class prototype managed for
instances admitted later and returns `undefined`. Class declarations are not
inherited, and an exact `externalState` declaration takes precedence.

Declarations must precede admission and never wait. A matching request for
admitted state returns it without another walk; invalid or conflicting input
returns a validation `Error`. Managed classes keep semantic state in own
enumerable string-keyed data properties and cannot require prototype accessors,
private fields, Symbols, hidden mutable state, or native internal slots.

### `run(chain, path, method, mutation, ...arguments)`

Invokes a supported method on the receiver at `path`. `method` must be a string
and `mutation` must be exactly `true` or `false`. Observation mode preserves the
receiver. Mutation mode publishes the completed receiver through the normal
copy-on-write mutation path and requires a mutable Chain.

Supported receivers are:

- Strings, for native observations.
- Logical Arrays, for the controlled standard methods listed below and trusted
  observation-only overrides.
- Records, for trusted read-only host methods outside the language-property
  surface.
- Managed class instances, for trusted synchronous observations and
  mutations.

The controlled Array methods are `at`, `concat`, `copyWithin`, `fill`, `flat`,
`includes`, `indexOf`, `join`, `lastIndexOf`, `pop`, `push`, `reverse`, `shift`,
`slice`, `sort`, `splice`, `toReversed`, `toSorted`, `toSpliced`, `toString`,
`unshift`, and `with`. Array callback methods such as `map`, `filter`, `reduce`,
and `forEach` are not supported. `sort` and `toSorted` support synchronous
comparators.

For an Array mutator, `mutation: true` updates the receiver and returns the
corresponding native mutator result. With `mutation: false`, the receiver is
unchanged and the transformed Array is returned. Managed-class methods must
finish synchronously; observation methods must not mutate, and mutation methods
may mutate only their receiver graph. A method result may be returned directly
or as a Promise where that receiver category permits asynchronous host results.
