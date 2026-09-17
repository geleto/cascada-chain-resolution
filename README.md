# Cascada chain resolution

## Introduction

Cascada is a runtime kernel for an implicitly asynchronous data language. A
value may contain Promises at any depth, and operations can be issued without
waiting for earlier Promises. The runtime preserves program order so the
observable result is the same as if all values had been available and every
operation had run sequentially.

A `Chain` holds a logical root value. Path operations read and update its graph,
Promise versions preserve the exact property versions captured by pending work,
and copy-on-write keeps mutations isolated between owners. Imported managed data is
never modified; explicit external mutation changes only its authorized owner. Recoverable JavaScript `Error` objects are language values, so
a rejected data Promise poisons the affected value without stopping unrelated
work. Each language failure records its causal source operation and kind.

The package is native ESM, requires Node.js 24 or newer, and needs no build
step.

See [`docs/data-limitations.md`](docs/data-limitations.md) before passing application data or host APIs to Cascada. It consolidates the supported graph shape, managed-method restrictions, Array limitations, and external-state ownership rules.

```js
import * as cascada from "cascada-chain-resolution"

const execution = new cascada.Execution()
const operationContext = Object.freeze({ execution, errorContext: "example" })
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

Managed mutations retain their pre-operation value for repair. External scopes order overlapping work hierarchically; their repair clears poison without rolling back native effects.

```js
import {
    Chain,
    CompoundPoisonError,
    ContextChain,
    ERROR_KIND,
    Execution,
    FatalError,
    PoisonError,
    assignPath,
    deletePath,
    enter,
    externalState,
    export as exportValue,
    getErrors,
    hasError,
    import as importValue,
    isFatalError,
    isPoisonError,
    lookupPath,
    lookupPathForExpression,
    managedState,
    managedStateClass,
    repairPath,
    run,
    selectEntryPath,
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
Functions and Errors are terminal values. External identities use native path
and invocation boundaries rather than managed graph traversal. Records and
Arrays default to managed; class instances default to external.

### `new Execution(reporter?)`

Creates runtime state shared by related Chains. Every operation context in one
execution carries this exact identity. The optional reporter is captured when
the execution is created and is called once with that execution's first fatal
`FatalError`; reporting is notification and cannot replace the failure.
`execution.fatalError` is a read-only query that is `null` until then.

Fatal failure rejects every operation result that is still pending.
Already completed results stay completed, and ready results remain synchronous.
Internal work simply stops when a common continuation next observes the failed
execution; source Promises are not cancelled and private gates are not settled
for shutdown.

### Operation context

Every Chain constructor and graph operation receives
`{ execution, errorContext }`. `execution` must match the Chain. `errorContext`
identifies the source operation and may differ for every call.

### Errors

`PoisonError` and `FatalError` directly extend native `Error`; `CompoundPoisonError` extends `PoisonError`. Use `isPoisonError` and `isFatalError` to recognize kernel outcomes. Trusted runtime code uses the factories from `cascada-chain-resolution`; direct construction is outside the supported API. Complete wrappers and compound child arrays are frozen.

A poison retains its exact native `.cause`, opaque `.errorContext`, and stable `.kind`. Later propagation preserves them. Compounds and `getErrors` flatten and deduplicate by cause, source-context identity, and kind, with unspecified order. Exact causes follow the [diagnostic payload contract](docs/data-limitations.md#errors).

A graph **Error**, or **poison**, is an ordinary non-thenable native Error. Ready Error results can be inspected directly, and pending normalized graph operations fulfill with the same logical Error after required processing. Raw native Errors receive causal attribution before thenability recognition. FatalError stays non-thenable and is never graph data.

The graph result contract is `T | PoisonError | Promise<T | PoisonError>`. Error queries succeed with ordinary data and report a query failure separately. [Phase 9D-B](docs/first-principles-conformance-plan.md#phase-9d-b-separate-graph-errors-from-expression-failure-values) implements `lookupPathForExpression` and a separate `PoisonedValue` expression container: ready expression failure returns the container, and pending expression failure rejects directly with the ordinary Error.

Compiler mutation access trees drive atomic external identity registration and hierarchical ordering of overlapping native scopes. Observations copy mutable property results. A failed managed mutation discards private changes and retains its pre-operation value beneath placement poison; repair exposes that baseline. Failed external mutations retain native effects and poison their selected tree scope; repair clears covered external subtree poison without native rollback. See [mutation and observation](docs/mutation-and-observation.md) and [external ordering](docs/external-context-ordering.md).

### Higher-runtime integration

The source implements Phase 9D-B and the [public higher-runtime API](docs/integration.md). Cascada uses the documented root API for Chain operations, guarded composition, Error factories, and expression extraction. Graph values stay in operation Chains. Only synchronous expression failure uses the separate container; pending failure uses ordinary Promise rejection.

### `new Chain(initialValue, operationContext)`

Creates a mutation-capable Chain rooted at an existing Cascada value. It admits
the value but does not import host data; pass host-provided roots through
`import` first. Read-only and automatically closed Chains exist only inside
`enter`.

### `new ContextChain(initialValue, operationContext, mutationAccessTree = undefined)`

Imports a raw host context and filters a
compiler-provided tree of static mutation access prefixes into its external
mutation index. Every compiler node is a property map; endpoints use `{}`:

```js
new ContextChain(context, operationContext, { apis: { db: {}, cache: {} } })
```

Calls contribute receiver paths and property mutations contribute containing
paths, independently of their `!` poison scopes. Import follows only named
properties, records requested nested external scopes as well as their external
parents, and prunes routes that yield no scope. Every Promise or thenable stops discovery, including synchronous
delivery; ordinary import still consumes those values normally.

Omitting the tree means no requests. `{}` requests the context root itself and
does not search a managed subtree. The compiler retains ownership of its input;
the runtime builds a separate context-local tree without changing it. See
[compiler construction rules](docs/integration.md#compiler-construction-of-the-mutation-access-tree)
for path selection, static prefixes, merging, and root cases.

### `import(value, operationContext)`

Admits externally owned data and returns its logical root.

For an available root, including a custom thenable consumed synchronously, the
admitted logical root is returned synchronously after its reachable graph is classified.
An actually pending Promise root returns a Promise for the admitted result.
Nested possible Promises are consumed as reached; only returned pending chains
remain registered after the synchronous import segment.
Imported identities are protected by copy-on-write, so Cascada mutations never
modify their host representation. Application code must not mutate the imported
graph after admission.

A native Error at the root returns its contextual `PoisonError`. A nested native
Error remains physically unchanged in host storage, while Cascada retains the
wrapper as that property's logical version.

### `assignPath(chain, path, value, operationContext, mutationScopeDepth = path.length)`

Assigns `value` to the selected property, creating a missing final property when
needed. An empty path replaces the root. Assignment uses copy-on-write whenever
the current logical value must be preserved for another owner.
`mutationScopeDepth` gives the depth of the compiler-selected `!` scope; by
default, only the target is selected in managed storage. Native property writes
use the deepest registered scope covering the containing receiver, capped by
the selected `!` prefix. The old final value does not select a narrower scope.

Successful issuance returns `undefined`, including when traversal must resume
after a Promise. A failure found synchronously is published at the failed
mutation location and returned as an `Error`; a failure found later is published
to the graph.

### `deletePath(chain, path, operationContext, mutationScopeDepth = path.length)`

Deletes the selected property. A missing final property is a no-op, deleting an
Array index preserves its length. An empty path on an entered Chain deletes
its selected placement; on an ordinary Chain it replaces the root with `null`. `mutationScopeDepth` has the same meaning as for `assignPath`.

Its return behavior matches `assignPath`: success and suspended issuance return
`undefined`, while a synchronous failed mutation publishes and returns its
`Error`.

### `lookupPath(chain, path, operationContext)`

Returns the value captured at `path`. A returned traversable identity gains an
owner and is marked shared, ensuring later mutation through either owner is
isolated by copy-on-write. The result is direct unless path traversal crosses a
Promise.

### `lookupPathForExpression(chain, path, operationContext)`

Selects through the same path semantics as lookupPath, accepting only strings,
numbers, booleans, and BigInts. Null, undefined, Symbols, and non-primitives
produce InvalidExpressionValue without coercion, descendant traversal, or
source mutation. A missing final property also fails this validation.

Success returns the selected value directly or a Promise fulfilling with it.
A synchronous failure returns a PoisonedValue containing the ordinary Error;
a pending failure rejects directly with that Error. Existing failures retain
their exact source and cause. Expression evaluation belongs to Cascada.

### `enter(chain, path, operationContext, entryMutable, onEntered)`

Reserve access to a branch and pass a temporary Chain to the callback. Entry supports Cascada reference arguments and delayed control flow, including mixed managed/external branches. It grants no mutation authority: contained operations still obey their bang scope restrictions. Entering a.x leaves a.y available.

Managed mutating entry installs a placement gate using ordinary path COW; managed read-only entry leases its capture. Covered external resources use exclusive reservations for mutating entry and observation reservations for read-only entry, including at an external root. Contained commands use the same ordering algorithm in private ordering state covered by the outer reservation. Entry is not a callback-wide rollback transaction. Compiler entry selection chooses the deepest registered scope for a native-property target and leaves managed/mixed targets unchanged.

The callback's direct completion closes new issuance. Already-issued commands and nested entries remain valid. Managed publication and external effect completion retain separate lifetimes, preserving ready managed siblings while native children remain pending. Returned/admitted rejected poison completes the callback normally; an unexpected internal throw/rejection is fatal. [enter.md](docs/enter.md) specifies capture, reservation ownership, and publication.

### `export(chain, path, operationContext)`

Returns a host-ready snapshot of the branch captured at the operation's issue
position. Traversable data is deep-copied without runtime metadata while
preserving Arrays, holes, property order, aliases, and cycles. Managed class
instances preserve their admitted prototypes without running constructors;
observation-only external values retain their exact identities. Registered
mutable identities produce `ExternalCapabilityEscape` at any depth, including
after Promise fulfillment. Export acquires no external phase.

If the branch contains one language Error, that contextualized occurrence is
returned. Several leaves produce a `CompoundPoisonError`; nested compounds are
flattened and deduplicated by cause, source-context identity, and kind, with
unspecified Error order.
The result is a Promise when the complete snapshot or Error set depends on
pending data. A language Error keeps the full scan running; a fatal
`FatalError` stops it.

### `hasError(chain, path, operationContext)`

Returns `true` when an `Error` is reachable from the captured path value and
`false` otherwise. A broken required path counts as an Error. The result is
direct when it can be decided immediately and otherwise a Promise for a
Boolean.

### `getErrors(chain, path, operationContext)`

Returns null when no Error is found, the original Error
for one distinct leaf, or a CompoundPoisonError for several. It completes all
required collection and deduplicates by cause, source-context identity, and kind.
A broken required path contributes its path-access Error; a missing or healthy
primitive final value contributes nothing. The result is direct when ready;
a pending result fulfills with the same null or ordinary Error. Query-reflection
failure returns its own QueryReflectionFailed Error instead of a completed
collection. No PoisonedValue is created by this operation.

Both Error queries include ordered external subtree metadata without reading native properties. Complete collection includes own and descendant Errors at the selected external scope. A strict-ancestor own poison blocks access; a managed guard remains terminal and hides its retained contents.

### `repairPath(chain, path, operationContext, firstDynamicSegment = path.length)`

Clear selected managed scope poison to expose its preserved pre-operation value, and clear repairable poison in a covered external subtree without reverting native effects. Use ordinary managed ordering and required exclusive external reservations. Successful repair returns undefined without invoking a native method or external-resource read/write. A healthy or absent managed target needs no managed change; an ordinary Error without a retained baseline returns that Error unchanged. Own poison above the target and permanent binding conflict cannot be cleared. Ordinary Error data and independent earlier managed failures are not erased. A replaceable managed location may instead be assigned/deleted; fixed resource locations remain protected. Repair-and-call clears first, then invokes under the same protection; a new failed managed mutation rolls back to that repaired baseline and poisons again.

### Static path provenance and compiler entry selection

Every path operation accepts an optional final `firstDynamicSegment` argument,
defaulting to `path.length` (fully static). `run` carries it in its facts object.
The compiler supplies the index of the first computed key, even when that key
already holds a string or number. Every selected registered resource path must precede that index; computed unregistered native suffixes and ordinary managed paths remain supported.
Promise-valued path keys are separate work in Phase 10.

`selectEntryPath(chain, path, operationContext, firstDynamicSegment = path.length)`
returns `{ path, firstDynamicSegment, suffix }`. A native-property target selects its deepest enclosing registered external scope, leaving the suffix for contained commands. Managed and mixed targets stay unchanged. It uses
only the runtime tree, invokes no native reflection, and does not widen explicit
`enter` calls. See the [compiler handoff](docs/integration.md#entry-target-selection).

Inside mutable external state, assignment exports the RHS before writing native
storage and orders the complete write against conflicting ancestor/descendant scope work.
Neither assignment nor deletion reads the old native target. Registered mutable
identities and their connecting placements cannot be replaced, removed, or moved.

Mutable property lookup copies the selected graph under an observation phase.
A direct property Promise is supported; intermediate native Promises and nested
snapshot thenables are rejected without subscribing. The exact mutable identity
cannot be extracted. Observation-only external property identities remain exact
and external on first admission.

### Data declarations

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
data properties. Prototype accessors are not Cascada methods, and a managed
prototype cannot expose a callable or accessor `then` or require private fields, Symbols, hidden mutable state, or native
internal slots.

### `run(chain, path, method, args, operationContext, { mutationScopeDepth, repair, firstDynamicSegment = path.length })`

Invokes a supported method on the receiver at `path`. `args` is the ordered
Array of explicit arguments. An absent or `undefined` `mutationScopeDepth`
selects observation; otherwise it selects mutation and gives the depth of the
`!` prefix, where `0` selects the root. Observation preserves the receiver;
managed mutation publishes through its selected scope. The required Boolean
`repair` is normally `false`; `true` requires mutation and performs repair-and-call
as one ordered transition, without exposing an intermediate cleared guard.

Supported receivers are:

- Strings, for native observations.
- Logical Arrays, for the controlled standard methods listed below. Custom
  Array methods are unsupported.
- Managed records, for own enumerable Function-valued methods.
- Managed class instances, for methods on their admitted prototype chain.
- External identities, using exact native receivers and exported arguments.
  Mutation requires their registered static context location. Native Arrays use
  native effects and ownership rules, including rejection of receiver escape.

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

A managed Array containing registered mutable external resources cannot be a
mutation scope, including for `push`. Ordinary index assignment and `length`
growth remain valid when they preserve registered locations: their placement
scope differs from an explicit bang on the whole Array.
