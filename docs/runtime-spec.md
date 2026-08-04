# Runtime contract

This document defines the observable contract of the Cascada chain-resolution
kernel. Implementation details live in
[`import-preparation.md`](import-preparation.md) and
[`counters-implementation.md`](counters-implementation.md).

## Values

The sandbox recognizes five value categories:

- **Primitive:** `null`, `undefined`, strings, numbers, booleans, symbols, and
  bigints.
- **Promise:** any object or function with a callable `then` property.
- **Error:** a JavaScript `Error`, used here as the stand-in for Cascada's
  language Error value.
- **Tracked value:** an Array, plain object, null-prototype record, registered
  data-class instance, or internal `ArrayView`.
- **Opaque value:** any other non-null non-Promise object. It retains identity
  but has no traversable language properties.

A language data object must not rely on a callable `then` property because the
kernel and JavaScript Promise resolution both treat it as a Promise.

An ordinary callable function that is not classified as a Promise is not a
language value. Compiler and host integrations must keep callables and
executable descriptors outside the graph. Prototype methods on registered class
instances are likewise outside the language-property surface. The kernel does
not promise proactive callable validation at every assignment boundary.

Language-visible object properties are own enumerable string keys. Arrays
instead expose canonical Array-index strings and the special `length`
property; other string properties are outside their language surface and
cannot be assigned or deleted through Cascada. Inherited and own
non-enumerable properties are not readable as language data.

Registered data-class COW and exact prototype preservation are
implemented support for class instances as data. Construction and mutating
class-method execution remain outside the current runtime plan. Restricted
read-only methods and standard Array/String operations are defined in
[`run.md`](run.md).

## Chain roots

Every public path operation receives a `Chain`. Its private `_state.value`
property is the mutable root location. The holder itself is runtime state, not
language data; other `Chain` fields are never walked, copied, indexed, marked,
or validated by the kernel.

An empty path targets `_state.value`. This stable parent/key location lets a
root Promise use the same Promise-mirror machinery as any nested property.

Assignment and deletion change the `Chain` and return `undefined`. Values are
observed through `lookupPath`, `export`, `hasError`, `getErrors`, and the
restricted standard-method [`run`](run.md) operation.

## Program order

Operations on one `Chain` are issued sequentially without awaiting between
calls. Each operation:

1. runs its synchronous prefix immediately;
2. commits every synchronous change;
3. registers all continuations needed at its current program position; and
4. returns before unresolved data is available.

Each callable thenable is canonicalized once to one native Promise. Reactions
registered on that shared Promise run in registration order. Every consumer of
a Promise-backed property registers through that property's captured mirror,
so its synchronous continuation observes all earlier consumers and none issued
later.

An operation describes the state at its own issue position. A later overwrite,
deletion, or copy-on-write transition cannot change the result captured by an
earlier observation. A continuation for a property version that is no longer
live may finish privately but cannot write into the replacement property.

Runtime operations are ordinary functions, not `async` functions. An
observation returns a direct result when its answer is available synchronously
and a Promise only when resolution or settlement is required.

## Ownership

Compiler-created tracked data is tree-shaped and singly owned.

- A new tracked value is assigned to one owner.
- Reusing or exposing an existing tracked value goes through an ownership
  boundary that marks it shared.
- Mutation through a shared branch performs copy-on-write before the first
  language write.
- The compiler evaluates the right-hand side of `a.property = a` first through
  shared lookup. The assignment therefore receives the value of `a` before the
  new property exists; raw self-assignment through the kernel is not valid
  compiler output.

`lookupPath` marks a returned tracked value shared by default. Passing
`sharedOwnership = false` is valid only for pure internal inspection or a
proven final ownership transfer. An extracted imported value remains imported
and shared even when this argument is false.

Non-extensible tracked nodes are external and must enter through import. Their
imported ownership, rather than their physical shape, causes copy-on-write.

## Copy-on-write

Mutation through a shared branch shallow-copies each node on the target path.
Off-path properties are reused. Reused tracked children are marked shared, and
Promise-backed properties receive independent mirrors at the copy's program
position.

The copy contains only language-visible keys:

- arrays, including subclasses and cross-realm arrays, become local ordinary
  arrays with the same length and enumerable indexed keys;
- plain objects, including cross-realm plain objects, become local plain
  objects;
- null-prototype records retain `null`;
- registered data-class instances retain their exact
  prototype;
- holes in sparse arrays remain holes; and
- runtime metadata is never copied as language data.

`registerDataClass(Class)` permanently adds the constructor's exact prototype
to a private `WeakSet` without modifying it. Registration must happen before
instances enter Cascada, is not inherited, does not invoke a constructor or
copying callback, and asserts that all required state is compatible with own
enumerable string-key copying.
The kernel does not attempt to detect private fields, required hidden state,
native internal slots, or other false assertions.

All genuine arrays retain their existing path regardless of realm or subclass;
array subclass prototypes and methods are deliberately normalized away.
Unregistered classes and native internal-slot objects are opaque identity
leaves. They may be stored and exported, but the graph does not traverse,
index, copy, or attach metadata to them. A path cannot enter an opaque value,
and `run` cannot use one as a receiver. Registered class export remains plain
data and does not preserve its prototype or methods.

Imported attribution remains attached to retained external children. Newly
copied path nodes are language-owned. If the copied source was already
ref-indexed, the copy receives counters reconstructed from its own logical
properties rather than cloned totals or parent links.

## Imported data

Every external value must pass through:

```js
runtime.import(value, errorContext)
```

`errorContext` must be truthy. A missing or falsy context is a fatal
integration error.

For a non-Promise root, import returns the same value after synchronously
establishing its boundary and preparing every currently reachable synchronous
part of the graph. For a Promise root, import returns a derived Promise that
performs the same boundary work on its settled value before exposing it.

Import preparation:

- gives each newly imported tracked identity a direct boundary and shared ownership;
- stores the root and attribution context;
- discovers repeated identities and cycle-closing properties;
- registers continuations for nested Promises without awaiting them; and
- does not build subtree counters.

Newly reached host objects receive externally stored metadata recording their
provenance and completed preparation.
Existing runtime metadata identifies a previously prepared or runtime-owned
identity. Every imported identity remains externally owned, so language mutation
copy-on-writes before changing its data even when that identity is used as a
root. A Promise property discovered inside its boundary is
not replaced: its mirror keeps the prepared logical value while the external
property retains its Promise. Frozen imported data therefore follows the same
path as writable imported data.

External code must not mutate an imported graph after import. Native code must
receive tracked Cascada data through `export`, not through a direct
metadata-bearing identity.

## Imported cycles

The runtime retains each raw cyclic property and publishes a boolean marker on
selected owner/key placements that cut every imported cycle from the projected
refcount graph.

- Finite lookup and mutation paths follow the raw value.
- Ref-indexing contributes one `cycleCutCount` and installs no reverse parent
  edge through the cut, then indexes its target as an independent component.
- `hasError` and `getErrors` report only ordinary Errors, including those
  reached beyond a cut through that component's counters.
- `export` reconstructs aliases and cycles in metadata-free output.

Replacing or deleting the selected property removes that placement's cycle
cut. Copy-on-write reconstructs placement state instead of copying cuts
blindly. See [`cycles-as-data.md`](cycles-as-data.md).

## Path rules

Every path is a complete target path. The final segment is the target property;
every preceding segment is required.

When a required intermediate is:

- an Error, the same Error is propagated;
- missing, `null`, `undefined`, or primitive, a path-access Error is produced;
- a Promise, the operation registers at that property's program position and
    continues from the state captured by its Promise mirror; or
- tracked, traversal continues.

A mutation installs a produced path-access Error at the broken intermediate
and stops. Observations return the Error.

The final target has operation-specific behavior:

| Target state | Assignment | Deletion | Lookup | Export | `hasError` | `getErrors` |
| --- | --- | --- | --- | --- | --- | --- |
| Missing | Create it | No-op | `undefined` | `undefined` | `false` | `[]` |
| Primitive or `null` | Replace it | Delete it | Return it | Return it | `false` | `[]` |
| Error | Replace it | Delete it | Return it | Error outcome containing it | `true` | `[error]` |
| Tracked | Replace it | Delete it | Return it | Copy or Error outcome | Query branch | Query branch |

An empty assignment path replaces the root. An empty deletion path replaces
the root with `null`.

Deleting an array index removes the own property and preserves array length.

## Property writes

A missing target key is created as an own enumerable, writable, configurable
data property. This applies to `__proto__`, so the inherited legacy setter is
never invoked and the object's prototype is unchanged.

On an owned object:

- assignment to an own accessor or non-writable property is fatal;
- deletion of an own non-configurable property is fatal; and
- mutation of any own non-enumerable property is fatal.

On a shared or imported branch, copy-on-write occurs first. Non-enumerable
properties are absent from the copy, so a language write may create a new
enumerable property that shadows them.

These failures indicate invalid compiler or host integration and are not
language Error values.

## Promise-backed properties

One mirror represents one Promise-backed property version. Assigning the same
Promise again, copying the property, or retaining it in a distinct ArrayView
creates a new mirror at that operation's FIFO position. ArrayViews may still
share the property's physical backing slot.

While a mirror is live, its property is normally authoritative. If the mirror
carries an import boundary, resolution preserves the external property and
stores the logical result in `resolvedValue`; the boundary remains with that
imported placement. An assigned or discovered mirror consumes fulfillment or
converts rejection to Error and prepares the value. A fork instead uses the
canonical Promise only as a FIFO readiness signal, samples its source mirror at
the fork position, and writes the result into its runtime-owned destination.

A retained ArrayView mirror may run after the source mirror has already changed
their shared backing slot. Its settlement therefore replaces that logical
edge's known pending-Promise contribution instead of recapturing the physical
old value. The mirrors and their later operations remain independent.

A later overwrite or deletion detaches the mirror and moves its current logical
value to `detachedValue`. Resolvers already registered for that property version
continue against its private value and cannot affect a replacement property.

The mirror stores no source Promise, parent, or key. It retains an import
boundary only for an imported property, optional `resolvedValue` for that
preserved live property, or `detachedValue` after detachment.

## Errors and fatal failures

A rejected data Promise is converted to a language Error before its value
continuation runs. If the rejection reason is already an Error, its identity is
preserved; otherwise the sandbox creates `new Error(String(reason))`.

Internal failures are fatal. They are reported through `reportFatalError` and
the original thrown value continues to throw or reject. Continuation throws,
rejection-conversion failures, invariant violations, and rejected internal
aggregate waits are never converted into language Error values.

Every public operation runs its synchronous prefix under this fatal boundary.
The helpers share one canonical native Promise for each callable thenable.
`resolveInitialValueOrPoison` converts the first data result,
`onLaterPromiseReady` runs later property resolvers without reconverting
rejection, and `resolveOperationResultOrFatal` owns internal operation and readiness failures. None adds a per-consumer proxy or second
reaction.

An object-like fatal value is reported once per identity even if it crosses
several fatal wrapper boundaries.

## Operations

### `assignPath(chain, path, value)`

Assigns or replaces the target. It creates a fresh mirror when `value` is a
Promise, performs copy-on-write where required, updates existing refcounts, and
returns `undefined`.

### `deletePath(chain, path)`

Deletes the target or replaces the root with `null` for an empty path. Missing
targets are no-ops. It updates existing refcounts and returns `undefined`.

### `lookupPath(chain, path, sharedOwnership = true)`

Returns the value captured at the path. The default marks a returned tracked
value shared. The result is synchronous unless path resolution crosses a
Promise.

### `run(chain, path, method, mutateArray, ...arguments)`

Invokes supported String and Array operations or a trusted read-only method.
Array mutation mode publishes through the normal mutation path; observation
mode preserves the receiver. See [`run.md`](run.md) for dispatch, argument,
ordering, and result contracts.

### `export(chain, path)`

Returns host-ready data for the branch captured at its issue position.

- Primitive and missing terminals return directly.
- An Error terminal returns a fresh outer Error whose `.errors` array contains
  that terminal identity.
- A successful result is always a metadata-free deep copy preserving arrays,
  holes, own-key order, aliases, cycles, enumerable `__proto__`, and captured
  Promise-property values.
- A tracked branch starts one raw identity-aware copy-or-collect walk
  immediately; export does not build a ref index, mark ownership, or pin.
- The first reachable Error disables further output allocation and writes, but
  traversal continues through every captured Promise so the result is complete.
- Failure returns a fresh outer Error with message
  `export: branch contains errors`; `.errors` contains each reachable Error
  identity once, and its order is not semantic.
- Cycle cuts alone do not prevent successful output.

The result is direct when complete synchronously and otherwise a Promise.
Unexpected synchronous traversal failures and rejected internal readiness are
fatal. Rejected data Promises are converted to ordinary Error values before
collection.

### `hasError(chain, path)`

Returns whether an Error is reachable in the issue-time branch.

- A broken required prefix or existing path Error returns `true`.
- A missing or primitive terminal returns `false`.
- A positive indexed `errorCount` returns `true` immediately.
- A cut-free settled zero-error branch returns `false` immediately.
- Otherwise a counter-fenced walk follows only subtrees with Promise, Error, or
  cycle-cut work.
- At an actual cycle cut, its independently indexed target resumes the same
  fenced traversal.

The operation never marks or pins the branch.

### `getErrors(chain, path)`

Returns an array containing each reachable Error identity once.

- A broken required prefix contributes its path-access Error.
- Missing and primitive terminals return `[]`.
- A counter-fenced walk prunes subtrees with no Promise, Error, or cycle-cut
  work.
- At an actual cycle cut, its independently indexed target resumes the same
  walk; the cut itself contributes nothing.
- Promise waits recursively extend the captured issue-time frontier.

The operation never marks or pins the branch. It returns the array directly
when no wait is required and otherwise returns a Promise for that array.

## Ref-index contract

Subtree counters are created lazily at the path value reached by `hasError` or
`getErrors`. A successful build indexes every raw-reachable tracked value.
Ordinary properties connect components through reverse child edges; pending
Promise placements and cycle cuts are propagation frontiers and install no
such edge. Export does not use subtree counters.

Each indexed node stores exact `promiseCount`, `errorCount`, and
`cycleCutCount` totals. All later transitions below an indexed parent maintain
those totals and exact parent multiplicity. A missing counter anywhere in an
indexed raw-reachable graph is a fatal invariant failure.

The complete implementation is specified in
[`counters-implementation.md`](counters-implementation.md).

## Language integration

The compiler and host layer must:

- wrap every external value with `import(value, errorContext)`;
- establish shared ownership whenever an existing tracked value gains another
  owner or escapes;
- use non-sharing lookup only for internal inspection or proven final transfer;
- send tracked output to native code only through `export`;
- evaluate assignment right-hand sides before mutating their destinations; and
- treat fatal kernel exceptions as integration/runtime failures rather than
  language Error values.

The kernel relies on these rules instead of validating trusted data for aliases
or cycles.

`run` keeps two narrow executable-boundary exceptions. First, a
runtime-controlled structural Array intrinsic may receive Cascada values when
retaining or relocating those exact identities is the defined language
operation. Its wrapper owns slot classification, entering ownership, Promise
mirrors, and bookkeeping. Standard scalar conversion is performed against
logical Cascada values before native invocation; locale methods likewise
construct only the small native input their intrinsic inspects. An ordinary
native observation receives its path-resolved receiver directly. `run` exports
each native-bound argument after dispatch; controlled logical payloads retain
their identity. A pending call holds a read lease, and an ArrayView receiver is
shallow-materialized. The method remains trusted read-only, non-retaining, and
free of external side effects.

A `sort` or `toSorted` comparator is the second executable-control
exception. A direct or Promise-resolved callable remains outside the graph and
receives resolved logical elements under a trusted read-only, side-effect-free,
non-retaining contract. Its result and Cascada numeric conversion must complete
synchronously before native stable sorting can continue; this does not
authorize other callbacks or native access to tracked identities.
