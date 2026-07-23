# Runtime contract

This document defines the observable contract of the Cascada chain-resolution
kernel. Implementation details live in
[`import-preparation.md`](import-preparation.md) and
[`counters-implementation.md`](counters-implementation.md).

## Values

The sandbox recognizes four value categories:

- **Primitive:** `null`, `undefined`, strings, numbers, booleans, symbols, and
  bigints.
- **Promise:** any object or function with a callable `then` property.
- **Error:** a JavaScript `Error`, used here as the stand-in for Cascada's
  language Error value.
- **Tracked value:** any other non-null object, including arrays, plain
  objects, class instances, and non-extensible objects.

A language data object must not rely on a callable `then` property because the
kernel and JavaScript Promise resolution both treat it as a Promise.

Language-visible properties are own enumerable string keys. Inherited and own
non-enumerable properties are not readable as language data. Arrays are tracked
objects with the same property rules.

## Chain roots

Every public path operation receives a `Chain`. Its private `_state.value`
property is the mutable root location. The holder itself is runtime state, not
language data; other `Chain` fields are never walked, copied, indexed, marked,
or validated by the kernel.

An empty path targets `_state.value`. This stable parent/key location lets a
root Promise use the same Promise-mirror machinery as any nested property.

Mutating operations change the `Chain` and return `undefined`. Values are
observed only through `lookupPath`, `export`, `hasError`, and `getErrors`.

## Program order

Operations on one `Chain` are issued sequentially without awaiting between
calls. Each operation:

1. runs its synchronous prefix immediately;
2. commits every synchronous change;
3. registers all continuations needed at its current program position; and
4. returns before unresolved data is available.

Promise reactions registered on the same source run in registration order.
Every consumer of a Promise-backed property registers through that property's
captured mirror, so its synchronous continuation observes all earlier
consumers and none issued later.

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

Non-extensible tracked nodes are implicitly shared. Mutation copies them before
writing.

## Copy-on-write

Mutation through a shared branch shallow-copies each node on the target path.
Off-path properties are reused. Reused tracked children are marked shared, and
Promise-backed properties receive independent mirrors at the copy's program
position.

The copy contains only language-visible keys:

- arrays become arrays with the same length and enumerable keys;
- other tracked objects become plain objects;
- holes in sparse arrays remain holes; and
- runtime metadata is never copied as language data.

Current generic copying does not preserve a class instance's prototype,
private fields, or internal slots. Explicit class adapters are tracked as
future work in `plan.md`.

Imported provenance remains attached to retained external children. Newly
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

An import boundary:

- marks its tracked root shared;
- stores the root and attribution context;
- discovers repeated identities and cycle-closing properties;
- registers continuations for nested Promises without awaiting them; and
- does not build subtree counters.

Newly reached host objects are recorded as imported originals. Existing
runtime metadata identifies a previously prepared or runtime-owned identity.
Imported originals are treated as physically immutable by Cascada. Promise
settlement and cycle classification update logical runtime state, not the host
object's properties.

External code must not mutate an imported graph after import. Native code must
receive tracked Cascada data through `export`, not through a direct
metadata-bearing identity.

## Imported cycles

The implemented runtime retains the raw cyclic property and publishes one
attributed cycle Error for the property selected as the cycle cut.

- Finite lookup and mutation paths follow the raw value.
- Ref-indexing does not cross the cut, counts it as one Error, and installs no
  reverse parent edge through it.
- `hasError` reports the cut.
- `getErrors` includes the cycle Error and follows the raw value to find
  ordinary Errors and Promises behind it.
- `export` treats a cycle-only branch as valid raw topology and reconstructs
  its aliases and cycles in the output.

Replacing or deleting the selected property removes that placement's cycle
diagnostic. Copy-on-write does not blindly copy placement diagnostics.

The chosen future model keeps the cut but removes its Error semantics; see
[`future/cycles-as-data.md`](future/cycles-as-data.md).

## Path rules

Every path is a complete target path. The final segment is the target property;
every preceding segment is required.

When a required intermediate is:

- an Error, the same Error is propagated;
- missing, `null`, `undefined`, or primitive, a path-access Error is produced;
- a Promise, the operation registers at that property's program position and
  continues from its logical value; or
- tracked, traversal continues.

A mutation installs a produced path-access Error at the broken intermediate
and stops. Observations return the Error.

The final target has operation-specific behavior:

| Target state | Assignment | Deletion | Lookup / export | `hasError` | `getErrors` |
| --- | --- | --- | --- | --- | --- |
| Missing | Create it | No-op | `undefined` | `false` | `[]` |
| Primitive or `null` | Replace it | Delete it | Return it | `false` | `[]` |
| Error | Replace it | Delete it | Return it | `true` | `[error]` |
| Tracked | Replace it | Delete it | Continue operation | Query branch | Query branch |

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
Promise again creates a new mirror.

Each mirror is an internal `PromiseMirror` instance. `onResolve` owns counted
FIFO registration, `setValue` owns prepared logical-value updates,
`isDrained` controls synchronous visibility, and `isLive` distinguishes the
installed property version from a revoked version retained by older operations.

The mirror's mandatory writeback and every waiting operation register directly
on the source Promise in issue order. A mirror remains logically pending until
all registered consumers finish their synchronous work. Only the final
successful consumer may publish its prepared value to the live property.

An extensible runtime-owned holder receives the final physical value. An
imported-original or non-extensible holder may retain the original Promise
physically; all runtime reads use the mirror's logical value.

A later overwrite or deletion revokes the mirror from the live property.
Already registered consumers retain that captured property version and finish
privately.

## Errors and fatal failures

A rejected data Promise is converted to a language Error before its value
continuation runs. If the rejection reason is already an Error, its identity is
preserved; otherwise the sandbox creates `new Error(String(reason))`.

Internal failures are fatal. They are reported through `reportFatalError` and
the original thrown value continues to throw or reject. Continuation throws,
rejection-conversion failures, invariant violations, and rejected internal
aggregate waits are never converted into language Error values.

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

Returns the logical value at the path. The default marks a returned tracked
value shared. The result is synchronous unless path resolution crosses a
Promise.

### `export(chain, path)`

Returns host-ready data for the branch captured at its issue position.

- Primitive, missing, and Error terminals return directly.
- A tracked branch is ref-indexed lazily.
- If projected Promises remain, the branch is marked shared to pin that world
  while earlier consumers drain.
- A successful result is always a metadata-free deep copy preserving arrays,
  holes, aliases, cycles, enumerable `__proto__`, and logical mirror values.
- An ordinary Error reachable after settlement collapses the sandbox result to
  one new export Error.
- Cycle diagnostics alone do not prevent successful output.

The result is direct when complete synchronously and otherwise a Promise.

### `hasError(chain, path)`

Returns whether an Error is reachable in the issue-time branch.

- A broken required prefix or existing path Error returns `true`.
- A missing or primitive terminal returns `false`.
- A positive indexed `errorCount` returns `true` immediately.
- A settled zero-error branch returns `false` immediately.
- Otherwise it follows the captured pending Promise frontier and resolves on
  the first Error or when the complete frontier is clean.

The operation never marks or pins the branch.

### `getErrors(chain, path)`

Returns an array containing each reachable Error identity once.

- A broken required prefix contributes its path-access Error.
- Missing and primitive terminals return `[]`.
- Counters prune clean projected regions.
- A cycle cut contributes its cycle Error and raw traversal continues behind
  it.
- Promise waits recursively extend the captured issue-time frontier.

The operation never marks or pins the branch. It returns the array directly
when no wait is required and otherwise returns a Promise for that array.

## Ref-index contract

Subtree counters are created lazily at the path value reached by `export`,
`hasError`, or `getErrors`. Indexed regions are downward-closed through every
ordinary tracked property. A pending Promise placement and a cycle cut are
frontiers and do not install reverse child edges.

All later transitions below an indexed parent maintain exact counts and parent
multiplicity. Missing counters below an ordinary indexed edge are a fatal
invariant failure.

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
