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

See [`docs/data-limitations.md`](docs/data-limitations.md) before passing application data or host APIs to Cascada. It consolidates the supported graph shape, managed-method restrictions, Array limitations, and external-state ownership rules.

```js
import * as cascada from "cascada-chain-resolution"

const execution = new cascada.Execution()
const operationContext = { execution, errorContext: "example" }
const input = cascada.import(
    { profile: Promise.resolve({ name: "Ada" }) },
    operationContext,
)
const chain = new cascada.Chain(input, operationContext)

cascada.assignPath(chain, ["profile", "active"], true, operationContext)

console.log(await cascada.export(chain, [], operationContext))
// { profile: { name: "Ada", active: true } }
```

## API reference

```js
import {
    Chain,
    ContextChain,
    Execution,
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

### `new Execution()`

Creates runtime state shared by related Chains. Every operation context in one
execution carries this exact identity.

### Operation context

Every Chain constructor and graph operation receives
`{ execution, errorContext }`. `execution` must match the Chain. `errorContext`
identifies the source operation and may differ for every call.

### `new Chain(initialValue, operationContext)`

Creates a mutation-capable Chain rooted at an existing Cascada value. It admits
the value but does not import host data; pass host-provided roots through
`import` first. Read-only and automatically closed Chains exist only inside
`enter`.

### `new ContextChain(initialValue, operationContext, scopeMutationPaths = [], propertyMutationPaths = [])`

Imports a raw host context root and builds its initial external-mutation index
from compiler-provided paths. Scope paths contain each prefix selected by `!`;
property paths contain complete assignment and deletion targets. When both
path Arrays are empty, the context is imported without external authority. An
empty property path replaces the root and likewise creates no authority.

### `import(value, operationContext)`

Admits externally owned data and returns its logical root.

For an available root, the original root is returned synchronously after its
reachable graph is classified. A Promise root returns a Promise for the
admitted result. Nested Promises are registered without waiting for them.
Imported identities are protected by copy-on-write, so Cascada mutations never
modify their host representation. Application code must not mutate the imported
graph after admission.

### `assignPath(chain, path, value, operationContext, mutationScopeDepth = path.length)`

Assigns `value` to the selected property, creating a missing final property when
needed. An empty path replaces the root. Assignment uses copy-on-write whenever
the current logical value must be preserved for another owner.
`mutationScopeDepth` gives the depth of the compiler-selected `!` scope; by
default, only the target is selected.

Successful issuance returns `undefined`, including when traversal must resume
after a Promise. A failure found synchronously is published at the failed
mutation location and returned as an `Error`; a failure found later is published
to the graph.

### `deletePath(chain, path, operationContext, mutationScopeDepth = path.length)`

Deletes the selected property. A missing final property is a no-op, deleting an
Array index preserves its length, and an empty path replaces the root with
`null`. `mutationScopeDepth` has the same meaning as for `assignPath`.

Its return behavior matches `assignPath`: success and suspended issuance return
`undefined`, while a synchronous failed mutation publishes and returns its
`Error`.

### `lookupPath(chain, path, operationContext)`

Returns the value captured at `path`. A returned traversable identity gains an
owner and is marked shared, ensuring later mutation through either owner is
isolated by copy-on-write. The result is direct unless path traversal crosses a
Promise.

### `enter(chain, path, operationContext, entryMutable, onEntered)`

Enters the value captured at `path` and passes a temporary Chain to
`onEntered`. The compiler supplies the exact `entryMutable` Boolean and callback as
trusted runtime facts. The temporary Chain is closed automatically when the
callback's direct result or Promise completes.

With `entryMutable: false`, the callback receives a read-only Chain and the captured
value is protected from concurrent Cascada mutation for the callback's complete
lifetime. The public path is not gated, so unrelated operations continue
normally.

With `entryMutable: true`, the callback receives a private mutable Chain. The target
placement is replaced with a Promise gate before target-dependent callback work
runs. Later operations on that placement wait while the callback issues its
private operations. When the callback fulfills, its final private root is
published through the gate; the callback's own result is returned from `enter`.
A mutating entry requires a mutable parent Chain.

If path resolution produces a language `Error`, the callback is not invoked and
the Error is returned. A callback throw or rejected callback Promise is fatal,
closes the temporary Chain, and does not publish its private state.

### `export(chain, path, operationContext)`

Returns a host-ready snapshot of the branch captured at the operation's issue
position. Traversable data is deep-copied without runtime metadata while
preserving Arrays, holes, property order, aliases, and cycles. Managed class
instances preserve their admitted prototypes without running constructors;
external values retain their exact identities.

If the branch contains one `Error`, that Error is returned. If it contains
several distinct Errors, export returns a new `Error` whose `errors` property
contains them. The result is a Promise when the complete snapshot or Error set
depends on pending data. An `Error` keeps the full scan running; a fatal runtime
failure stops it.

### `hasError(chain, path, operationContext)`

Returns `true` when an `Error` is reachable from the captured path value and
`false` otherwise. A broken required path counts as an Error. The result is
direct when it can be decided immediately and otherwise a Promise for a
Boolean.

### `getErrors(chain, path, operationContext)`

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

Declarations must precede admission and never wait. Repeating the same
declaration is harmless; invalid or conflicting input returns a validation
`Error`. A late declaration never reclassifies an admitted identity and is
unsupported because it can affect that identity's admission in a later
execution. Managed classes keep semantic state in own enumerable string-keyed
data properties and cannot require prototype accessors, private fields, Symbols,
hidden mutable state, or native internal slots.

### `run(chain, path, method, args, operationContext, { mutationScopeDepth })`

Invokes a supported method on the receiver at `path`. `args` is the ordered
Array of explicit arguments. An absent or `undefined` `mutationScopeDepth`
selects observation; otherwise it selects mutation and gives the depth of the
`!` prefix, where `0` selects the root. Observation preserves the receiver;
mutation publishes it through the normal copy-on-write path.

Supported receivers are:

- Strings, for native observations.
- Logical Arrays, for the controlled standard methods listed below. Custom
  Array methods are unsupported.
- Managed records, for own enumerable Function-valued methods.
- Managed class instances, for methods on their admitted prototype chain.

Controlled Array and native String dispatch rejects unsupported calls before
preparing arguments. Record and managed-class members are resolved only after
their required inputs are clean, so poisoned inputs invoke no application
getter, Proxy trap, or managed-prototype reflection.

The controlled Array methods are `at`, `concat`, `copyWithin`, `fill`, `flat`,
`includes`, `indexOf`, `join`, `lastIndexOf`, `pop`, `push`, `reverse`, `shift`,
`slice`, `sort`, `splice`, `toReversed`, `toSorted`, `toSpliced`, `toString`,
`unshift`, and `with`. Array callback methods such as `map`, `filter`, `reduce`,
and `forEach` are not supported. `sort` and `toSorted` support synchronous
comparators. Controlled methods prepare only the arguments they consume;
numeric and string positions use Cascada conversion, while retained payloads
keep their logical values. A comparator receives exported element copies and
must return a Number. `concat` spreads only logical Arrays and ignores
`Symbol.isConcatSpreadable`.

For an Array mutator, a defined `mutationScopeDepth` updates the receiver and
returns the corresponding native mutator result. Without it, the receiver is
unchanged and the transformed Array is returned. Managed-record and
managed-class observations must not mutate their receiver; mutations may
mutate only their isolated receiver graph. Every explicit argument is exported.
A direct result Promise extends the managed invocation, while a Promise nested
inside a synchronous result is ordinary result data and must not later expose
the receiver or an argument identity.
