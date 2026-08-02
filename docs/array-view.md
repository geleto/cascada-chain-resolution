# `ArrayView`

## Status

**Implemented and internal.** `ArrayView` is the optional endpoint representation used by [`run`](run.md). It is not a package API and does not add Map or Set support.

## Representation and identity

`ArrayView` represents a half-open logical range over native Array storage. Its named fields are defined as non-enumerable own properties rather than JavaScript class fields:

```js
class ArrayView {
    constructor(array, start, end) {
        Object.defineProperties(this, {
            _array: { value: array, writable: true },
            _start: { value: start, writable: true },
            _end: { value: end, writable: true },
        })
    }

    get length() {
        return this._end - this._start
    }
}
```

An internal brand distinguishes views from user objects. `_array`, `_start`, and `_end` are runtime state, not language properties, and `_array` is never a language edge.

An attached view is stored in the original native Array's `META.arrayView`. It is that Array identity's projection: references, metadata, parent edges, and property versions remain owned by the native Array and use the attached bounds. A separately returned or published `ArrayView` is a distinct language identity with its own metadata.

## Coordinates and backing

`_baseIndex` is a module-private Symbol:

```js
const _baseIndex = Symbol("ArrayView._baseIndex")
```

`_start`, `_end`, and `_array[_baseIndex]` are safe integers satisfying:

```js
0 <= _array[_baseIndex]
_array[_baseIndex] <= _array.length
0 <= _start + _array[_baseIndex]
_start + _array[_baseIndex] <= _end + _array[_baseIndex]
_end + _array[_baseIndex] <= _array.length
```

Logical indexes translate as:

```js
coordinate = _start + logicalIndex
physicalIndex = coordinate + _array[_baseIndex]
```

Eligible backing receives one reserved property:

```js
Object.defineProperty(_array, _baseIndex, {
    value: 0,
    enumerable: false,
    writable: true,
    configurable: false,
})
```

The property is installed once when an Array first becomes backing. Existing backing is reached through its runtime attachment or an `ArrayView` and the value is thereafter trusted rather than revalidated.

Keeping `_baseIndex` on the backing lets one physical prepend update every view's translation while their stable coordinates remain unchanged.

## Logical surface

A view exposes translated enumerable indexes in its active range, the backing Array's non-index own enumerable string properties, and a virtual non-enumerable non-configurable `length`. Internal fields, the base-index Symbol, metadata, and physical indexes outside the active range are not language properties.

Traversal, ownership, import, export, refcounting, Error search, copy-on-write, Promise mirrors, and iteration use logical Array accessors rather than raw `Object.keys`, `Array.isArray`, or physical property access. Bookkeeping is keyed by logical owner and logical index. Moving storage changes no earlier view's logical edge.

`ArrayView` owns the range-dependent operations:

```js
has(index)
get(index)
set(index, value)
delete(index)
descriptor(key)
keys()
setLength(length)
```

The language-property boundary selects an attachment or an ordinary Array and delegates to these methods only for a view. `run` looks up standard methods on the backing Array, so the internal methods are not language-callable. Indexed access follows Array semantics through safe language-property transitions; `has` preserves the distinction between a hole and stored `undefined`. Other keys use the same logical property adapters.

`run` mutates an owned native Array in place; `ArrayView` is introduced only when an endpoint operation must preserve another logical version. ArrayView backing is always treated as shared, even if only one view remains reachable. Ordinary indexed writes, deletions, and non-index changes first materialize the changing receiver; assigning even the same value still creates a new property version. Endpoint transitions and bounds-only length changes may continue on the backing because they preserve every earlier view.

## Attachment

`ArrayView.attachTo(array)` installs the source projection when a previously unattached native Array becomes backing. The Array must be extensible and non-imported. Every logical property exposed by both the preserved source and the derived result must also be free of a direct Promise value because one physical property cannot represent two independently advancing property versions. A Promise in an endpoint excluded from one view or newly added for only one view is allowed, and Promises nested inside retained tracked children do not affect eligibility.

Before first derivation, the Array receives the base-index property and its metadata receives the attached source view; the result view derives from the post-operation bounds. Derivation initializes the result's logical bookkeeping and applies ordinary shared ownership to every retained tracked child. Initial source bounds are `_start = 0` and `_end = array.length`; an existing attachment supplies its current logical range without rechecking the backing's internal fields.

Attachment changes representation only. The attached source identity, logical values, property versions, ordering positions, and bookkeeping remain unchanged. A native Array updated as its sole logical version is not wrapped.

Deriving another identity from a standalone view copies that view's bounds. No attachment is needed because the backing is not itself a language identity.

Read leases protect logical identities, not physical backing. Attachment, extension, and relocation do not change any preserved view's logical surface, so read leases do not make backing ineligible. Ordinary native observation receives a shallow-materialized logical Array; runtime-controlled standard intrinsics receive prepared arguments and shallow working storage. Neither receives the backing itself.

An ineligible source materializes.

## Materialization and export

Materialization creates an owned native Array containing the logical length, holes, and non-index own enumerable string properties, but no internal fields, metadata, or base-index Symbol. Retained children receive normal ownership, import attribution, refcounts, and fresh Promise mirrors at the operation's program position. A mutation publishes the native Array at the changing path; the attached source and other views remain unchanged.

Export creates a native Array from only the logical surface, preserving holes, cycles, repeated identities, and non-index own enumerable string properties. It resolves every reachable Promise, returns a Promise only when settlement is required, and returns the normal export Error outcome for a reachable Error.

## Endpoint operations

All representation, storage, bounds, and bookkeeping changes for one endpoint call form one synchronous transition. Isolation changes only a derived view's bounds, and storage needed by an earlier view is never deleted.

Shared physical extension first validates control-argument preparation, the new length, every affected storage descriptor, and the Promise-overlap condition. A failed preflight materializes before any backing write; a partial relocation must never become visible to an earlier view. A Promise property retained by only one logical identity keeps that owner and logical key across physical relocation. An operation that would expose it through another identity materializes instead.

`pop` contracts `_end`; `shift` advances `_start`. An empty view keeps its bounds.

The representation-only `ArrayView.canExtendBacking`, `canExtend`, `extend`, and `contract` operations own backing preflight and bound changes, but not method dispatch, ownership, mirrors, result construction, or fallback materialization.

`push(...values)` extends backing only at the physical end:

```js
_end + _array[_baseIndex] === _array.length
```

After ownership and mirror preparation, the wrapper may invoke the native `push` intrinsic with the Cascada values, add their logical-edge contributions, and advance `_end`.

`unshift(...values)` extends backing only at the physical start:

```js
_start + _array[_baseIndex] === 0
```

After preflight, the wrapper may use the native `unshift` intrinsic directly:

```js
const count = values.length
Array.prototype.unshift.call(_array, ...values)
_array[_baseIndex] += count
next._start -= count
```

The wrapper prepares entering ownership and mirrors before the call and applies the result view's placement bookkeeping with the coordinate update. No reaction or observer can interleave with this synchronous transition, and increasing the base absorbs the physical shift for every earlier view.

If an edge condition fails, the active range materializes before the endpoint method. Bounds-only contraction may retain inaccessible physical storage; materialization may compact it at any time because compaction is not observable.

## `length`

Length assignment follows `ArraySetLength` exactly. An owned attached or standalone view may contract its own `_end`; a language-shared receiver derives a separate changing view first. Growth extends with holes only when the logical end is the physical end and shared-extension preflight succeeds; otherwise the active range materializes before its native length changes.

Truncation removes the changing logical owner's edge contribution and placement-specific state at every successfully deleted index greater than or equal to the new length, even when physical storage remains for another view. Growing after a bounds-only shrink must not reveal old physical values; the failed physical-end condition forces materialization and creates holes.

## Standard Array surface

`ArrayView` implements the standard data-only surface under [`run`'s dispatch rules](run.md#dispatch). Endpoint methods use the rules above; other standard methods use `run`'s logical wrapper or a shallow materialized working Array. Standard method execution does not export the view; ordinary native observation follows [`run`'s Language Integration boundary](run.md#language-integration). Physical backing is never an ordinary native receiver.

Array-producing methods and materialization return native Arrays. Array species and subclass preservation are outside the language data model. `run` owns mutation publication and transformed-Array observation results.

The view is directly iterable. Its internal iterator reads logical length on every step and yields the logical value at each index, including `undefined` for holes. Cascada iteration and spread resolve a native Array's attached view before selecting this path, so physical indexes outside the logical range never escape. The stateful iterator is consumed by lowering and is not a language-data result returned by `run`.

## Implementation boundary

`src/array-view.js` owns the brand, internal helpers, attachment, backing preflight, representation-only endpoint transitions, bounds, and iteration. `src/array-invocation.js` decides whether the optimization applies and owns Promise mirrors, ownership, fallback, and JavaScript method results. `src/property-origin.js` captures origin property state only when placement begins; placement materializes a view, while ordinary mutation coordinates length assignment. `ArrayView` and its representation adapters are internal module exports; none are callable through ordinary method dispatch or exported by `src/index.js`.

`src/meta.js` stores `arrayView` on an attached native Array identity and reusable read leases. Logical adapters may be adopted incrementally while they remain identity operations for ordinary Arrays; attachment must stay disabled until every subsystem named under Logical surface uses them.

## Verification

Run all coverage in inline-Symbol and WeakMap metadata modes. Cover:

- non-enumerable fields, private Symbol branding and base index, repeated base-index updates, and attached versus standalone identity;
- unconditional shared-backing isolation for indexed, non-index, delete, Promise, and same-value writes without a view registry;
- ready and delayed attachment, logical read leases, imported and non-extensible data, direct Promise overlap, exclusive endpoint Promises, and nested Promises;
- zero and multiple endpoint arguments, direct tracked and Promise payloads, repeated endpoint operations, both physical-edge failures, native prepend with base absorption, preflight failure, and unchanged earlier views;
- holes, explicit `undefined`, non-index properties, aliases, cycles, Errors, child ownership, refcounts, mirrors, counters, and compaction;
- length reads, native and bounds-only shrink, physical-end growth, growth after shrink, invalid values, removed mirrors, and earlier-view preservation;
- native-Array materialization, export settlement and Error outcomes, and no internal-field leakage; and
- direct iteration, live length, holes, attached native iteration and spread, standard method results, deferred callback rejection, prepared native sort comparison, and receiver identity.
