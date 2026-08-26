# Runtime contract

This document defines the observable contract of the Cascada chain-resolution kernel. Implementation details live in [`import-preparation.md`](import-preparation.md), [`counters-implementation.md`](counters-implementation.md), and [`work-bounds.md`](work-bounds.md).

## Values

The runtime recognizes these value categories:

- **Primitive:** `null`, `undefined`, strings, numbers, booleans, symbols, and
  bigints.
- **Promise:** any object or function with a callable `then` property.
- **Error:** a JavaScript `Error`, used here as the stand-in for Cascada's
  language Error value.
- **Managed value:** an Array, record, managed class instance, or internal
  `ArrayView`. Managed values have traversable language properties.
- **External value:** any other non-null non-Promise object. It retains exact
  identity but has no traversable language properties.
- **Function:** stored as terminal data and executable only in a supported call
  position.

A language data object must not rely on a callable `then` property because the
kernel and JavaScript Promise resolution both treat it as a Promise.

Prototype methods on managed class instances are outside the language-property
surface.

Language-visible object properties are own enumerable string-keyed data
properties. Own accessors, non-enumerables, inherited properties, Symbols,
and prototypes are outside the graph and are never invoked by graph access. Arrays
instead expose canonical Array-index strings and the special `length`
property; other string properties are outside their language surface and
cannot be assigned or deleted through Cascada.

Managed-class COW, exact prototype preservation, and synchronous observation
and mutation methods are implemented. Construction remains outside the runtime.
Invocation is defined in [`run.md`](run.md) and
[`registered-class-invocation.md`](registered-class-invocation.md).

## Chain roots

Every public path operation receives a `Chain`. Its private `_state.value`
property is the mutable root location. The holder itself is runtime state, not
language data; other `Chain` fields are never walked, copied, indexed, marked,
or validated by the kernel.

An empty path targets `_state.value`. This stable parent/key location lets a
root Promise use the same Promise-mirror machinery as any nested property.

Successful assignment and deletion change the `Chain` and return `undefined`.
A ready failed mutation returns the Error it publishes. Values are
observed through `lookupPath`, `export`, `hasError`, `getErrors`, and the
restricted standard-method [`run`](run.md) operation.

## Program order

Operations on one `Chain` are issued sequentially without awaiting between
calls. Each operation:

1. runs its synchronous prefix immediately;
2. commits every synchronous change;
3. registers all continuations needed at its current program position; and
4. returns before unresolved data is available.

A callable thenable is canonicalized once only when Cascada needs FIFO ordering
among continuations on that source: to advance or consume a captured version,
resume or finish a transition, or perform settlement bookkeeping before later
Cascada use. Returning a result alone does not canonicalize or replace it.
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

Compiler-created graph data is initially singly owned but may be cyclic.
Reusing or exposing an existing graph identity gives it another owner and
marks it shared. Mutation through a shared branch performs copy-on-write before
the first language write.

`lookupPath` extracts its result and marks a returned graph identity shared.
`readPath` adds no owner; use it only for a temporary read or when prior
ownership is ceded. Imported values retain their existing import and sharing
state in either case.

Non-extensible managed data must enter through import. Its imported ownership,
rather than its physical shape, causes copy-on-write.

## Copy-on-write

Mutation through a shared branch shallow-copies each node on the target path.
Off-path properties are reused. Reused traversable children are marked shared, and
Promise-backed properties receive independent mirrors at the copy's program
position.

The copy contains only language-visible keys:

- arrays, including subclasses and cross-realm arrays, become local ordinary
  arrays with the same length and enumerable indexed keys;
- records and managed class instances retain their admitted prototype,
  including cross-realm and null prototypes;
- holes in sparse arrays remain holes; and
- runtime metadata is never copied as language data.

Records and Arrays default to managed; class instances default to external.
`externalState` and `managedState` declare identity overrides, while
`managedStateClass` declares exact class prototypes for later admission.
Declarations neither modify nor admit values. First admission fixes an
identity's category and prototype permanently. See
[`data-classes.md`](data-classes.md).

All genuine arrays retain their existing path regardless of realm or subclass;
array subclass prototypes and methods are deliberately normalized away.
External classes and native internal-slot objects are identity leaves. The graph
does not traverse, index, or copy their state. A path cannot enter an external
value, and `run` cannot yet use one as a receiver. Managed-class export creates
an independent metadata-free object with the admitted prototype without
invoking its constructor.

Imported attribution remains attached to retained imported children. Newly
copied path nodes are language-owned. If the copied source was already
ref-indexed, the copy receives counters reconstructed from its own logical
properties rather than cloned totals or parent links.

## Imported data

Every host-provided root must pass through:

```js
runtime.import(value, errorContext)
```

`errorContext` must be truthy. A missing or falsy context is a fatal
integration error.

For a ready root, import returns its admitted logical value after one
transactional synchronous walk. For a Promise root, one operation Promise
performs the same work on fulfillment before exposing the result; rejection
remains rejection.

Import:

- records origin and marks newly imported managed identities shared;
- retains already admitted identities without rescanning or changing origin;
- registers continuations for nested Promises without awaiting them; and
- does not build subtree counters.

Newly reached host objects receive external metadata recording their admitted
category and origin. Import traverses only new managed identities and stops at
external identities, Functions, and Errors. It commits no metadata or Promise
mirror from a synchronous segment whose enumeration or descriptor lookup fails.
A nested Promise property is not replaced: its mirror keeps the logical value
while imported storage retains the Promise. Frozen imported managed data
therefore follows the same path as writable imported managed data.

External code must not mutate an imported graph after import. Native code must
receive traversable Cascada data through `export`, not through a direct runtime
identity.

## Cycles

Runtime-owned and imported graphs may both be cyclic. Ref-index construction
cuts DFS back edges from its projection. A later edge entering an indexed
container is cut exactly when the maintained reverse-parent graph shows that it
would close a cycle.

- Finite lookup and mutation paths follow the raw value.
- Ref-indexing contributes one `cycleCutCount` and installs no reverse parent
  edge through the cut, then indexes its target as an independent component.
- `hasError` and `getErrors` report only ordinary Errors, including those
  reached beyond a cut through that component's counters.
- `export` reconstructs aliases and cycles in metadata-free output.

Replacing or deleting a selected property removes that placement's cut.
Copy-on-write reconstructs placement state instead of copying cuts blindly.
See [`cycles-as-data.md`](cycles-as-data.md).

## Path rules

Every path is a complete target path. The final segment is the target property;
every preceding segment is required.

When a required intermediate is:

- an Error, the same Error is propagated;
- missing, `null`, `undefined`, or primitive, a path-access Error is produced;
- a Promise, the operation registers at that property's program position and
    continues from the state captured by its Promise mirror; or
- traversable, traversal continues.

A mutation installs a produced path-access Error at the broken intermediate
and stops. Observations return the Error.

The final target has operation-specific behavior:

| Target state | Assignment | Deletion | Lookup | Export | `hasError` | `getErrors` |
| --- | --- | --- | --- | --- | --- | --- |
| Missing | Create it | No-op | `undefined` | `undefined` | `false` | `[]` |
| Primitive or `null` | Replace it | Delete it | Return it | Return it | `false` | `[]` |
| Error | Replace it | Delete it | Return it | Return it | `true` | `[error]` |
| Tracked | Replace it | Delete it | Return it | Copy, one Error, or combined Errors | Query branch | Query branch |

An empty assignment path replaces the root. An empty deletion path replaces
the root with `null`.

Deleting an array index removes the own property and preserves array length.

## Property writes

A missing target key is created as an own enumerable, writable, configurable
data property. This applies to `__proto__`, so the inherited legacy setter is
never invoked and the object's prototype is unchanged.

An accessor or non-enumerable property is logically absent. Final assignment
materializes an ordinary runtime-owned container and creates a placement that
shadows it; final deletion is a no-op. Traversal through it produces the same
path Error as any other missing segment. No getter or setter runs.

A physical restriction such as non-writability, non-configurability,
non-extensibility, or blocked Array length change causes the mutation path to
materialize ordinary writable storage before committing. It is not a language
failure. If the selected representation still cannot perform a preflighted
commit, the violated runtime invariant is fatal.

## Promise-backed properties

One mirror represents one Promise-backed property version. Assigning the same
Promise again, copying the property, or retaining it in a distinct ArrayView
creates a new mirror at that operation's FIFO position. ArrayViews may still
share the property's physical backing slot.

The mirror's single `value` field is the property version's authoritative logical
value. Its first resolver captures the property's import boundary at creation.
Every state-changing resolver uses the import status captured at registration;
the boundary remains on the imported owner and imported graph values, not the
mirror. A live runtime-owned version normally writes through to its physical
property. If writeback reflection fails, its Error remains logical in the mirror
and the physical Promise is preserved. An imported version always preserves the
external Promise.

A fork uses the canonical Promise only as a FIFO readiness signal and samples
its source mirror at the fork position. Retained ArrayView properties have
distinct mirrors even when they share a physical backing slot, so their logical
edges and later operations remain independent.

A later overwrite or deletion detaches the mirror by removing it from the live
map. The mirror keeps its current value; resolvers already registered for that
property version continue against it and cannot affect a replacement property.
The mirror stores no source Promise, parent, key, or import boundary.

## Errors and fatal failures

A rejected data Promise is converted to a language Error before its value
continuation runs. An Error keeps its identity. Every other reason is retained
as the `cause`; a primitive also supplies the message, while an object receives
a fixed message without invoking its properties or conversion hooks.

Synchronous failures from supported user code and exact reflection hooks are
language Errors. The boundary catches only the user-controlled invocation;
adjacent runtime work remains outside it. Synchronous re-entry into Cascada
from such code is a fatal host-contract violation.

Internal failures are fatal. They are reported through `reportFatalError` and
the original thrown value continues to throw or reject. Continuation throws,
rejection-conversion failures, invariant violations, and rejected internal
aggregate waits are never converted into language Error values.

Every public operation runs its synchronous prefix under this fatal boundary.
The FIFO helpers register directly on a native Promise and otherwise share one
canonical native Promise for each ordered thenable.
`resolveInitialValueOrPoison` converts the first data result,
`onLaterPromiseReady` runs later property resolvers without reconverting
rejection, and `observeResultPromise` registers ordered admission or lease
bookkeeping without replacing a result. `continueInternalPromiseOrFatal`
continues an already-native intermediate wait directly and owns its rejection.
An independent result Promise remains unchanged. None adds a per-consumer
proxy.

An object-like fatal value is reported once per identity even if it crosses
several fatal wrapper boundaries.

## Operations

### `assignPath(chain, path, value)`

Assigns or replaces the target. It creates a fresh mirror when `value` is a
Promise, performs copy-on-write or representation materialization where
required, and updates existing refcounts. Success returns `undefined`; a ready
failed transition publishes and returns its Error. A suspended call still
returns `undefined`; any later failure is published only in the graph.

### `deletePath(chain, path)`

Deletes the target or replaces the root with `null` for an empty path. Missing
targets are no-ops. It updates existing refcounts. Success returns `undefined`;
a ready failed transition publishes and returns its Error. A suspended call
still returns `undefined`; any later failure is published only in the graph.

### `lookupPath(chain, path)`

Extracts the value captured at the path and marks a returned graph identity
shared. The result is synchronous unless path resolution crosses a Promise.

### `readPath(chain, path)`

Returns the value captured at the path without adding an owner. The caller must
either use it temporarily or cede the prior ownership.

### `run(chain, path, method, mutation, ...arguments)`

Invokes a supported operation through one common lifecycle after classifying
the receiver. Mutation mode publishes through the normal mutation path;
observation mode preserves the receiver. See [`run.md`](run.md) for dispatch,
argument, ordering, and result contracts.

### `export(chain, path)`

Returns host-ready data for the branch captured at its issue position.

- Primitive and missing terminals return directly.
- One Error returns unchanged.
- A successful result is always a metadata-free deep copy preserving arrays,
  holes, own-key order, aliases, cycles, admitted prototypes, enumerable
  `__proto__`, and captured Promise-property values.
- A traversable branch starts one identity-aware boundary copy-or-collect walk
  immediately; export does not build a ref index, mark ownership, or pin.
- The first reachable Error disables further output allocation and writes, but
  traversal continues through every captured Promise so the result is complete.
- Several Errors return an Error with message
  `export: branch contains errors`; `.errors` contains each distinct reachable
  Error identity, and its order is not semantic.
- Cycle cuts alone do not prevent successful output.

The result is direct when complete synchronously and otherwise a Promise. A
pending export fulfills with its final single or combined Error. A synchronous
reflection failure returns its Error. Other unexpected traversal failures and
rejected internal readiness are fatal. Rejected data Promises are converted to
ordinary Error values before collection.

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
`getErrors`. A successful build indexes every raw-reachable traversable value.
Ordinary properties connect components through reverse child edges; pending
Promise placements and cycle cuts are propagation frontiers and install no
such edge. Initial DFS back edges and later cycle-closing publications become
cuts, so the reverse-parent projection remains acyclic. Export does not use
subtree counters.

Each indexed node stores exact `promiseCount`, `errorCount`, and
`cycleCutCount` totals. All later transitions below an indexed parent maintain
those totals and exact parent multiplicity. A missing counter anywhere in an
indexed raw-reachable graph is a fatal invariant failure.

The complete implementation is specified in
[`counters-implementation.md`](counters-implementation.md).

## Language integration

The compiler and host layer must:

- wrap every host-provided root with `import(value, errorContext)`;
- establish shared ownership whenever an existing graph identity gains another
  owner or escapes;
- use non-sharing lookup only for internal inspection or proven final transfer;
- send traversable output to native code only through `export`;
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
native-bound arguments as one batch after dispatch; controlled logical payloads
retain their identity. Export captures available state synchronously and uses
exact Promise mirrors without source leases. Other pending preparation leases
each traversable source its continuations must later read and releases those
leases after their last access. Pending
controlled argument preparation leases its captured receiver only until
invocation. A controlled method owns any lease required by later receiver
reads, while an independent result Promise adds none. An
ordinary native call retains an exact traversable receiver through its returned
Promise, and an ArrayView receiver is shallow-materialized. The method remains
trusted read-only, non-retaining beyond that result, and free of external side
effects.

A managed-class call prepares every explicit argument and the complete receiver
graph. An observation runs synchronously on its leased prepared receiver. A
mutation isolates protected receiver identities, invokes once synchronously,
validates and admits the completed receiver, and publishes it through the
ordinary mutation transition. It returns the published receiver for `this` and
an independent copy for every other traversable result. Promise-valued
managed-class results are validation Errors and are never awaited.

A `sort` or `toSorted` comparator is the second executable-control
exception. A direct or Promise-resolved callable remains outside the graph and
receives resolved logical elements under a trusted read-only, side-effect-free,
non-retaining contract. Its result and Cascada numeric conversion must complete
synchronously before native stable sorting can continue; this does not
authorize other callbacks or native access to runtime-managed identities.
