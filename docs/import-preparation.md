# Imported graph preparation

`import(value, errorContext)` is the only boundary for external data. It marks
the imported root shared, records attribution, prepares aliases and cycles in
the reachable graph, and registers the first resolver for every nested Promise.
Subtree counters remain lazy until an Error query needs them.

Cycle-cut and counter semantics are specified in
[`cycles-as-data.md`](cycles-as-data.md).

## Boundaries

A direct import boundary stores:

```js
{ root, errorContext }
```

The context must be truthy. Descendants inherit the nearest boundary while a
walk remains inside imported data; they do not all receive direct boundary
metadata. A tracked value receives its own boundary when it becomes
independently usable, such as after extraction.

Imported roots are shared. Repeated identities discovered below them are also
marked shared. Language mutation therefore COWs before writing external or
aliased data.

META presence is the durable prepared-identity signal. A META-bearing value is
either an already prepared imported identity or trusted runtime data, so a
later imported walk treats it as an island instead of repeating full
preparation. This relies on the language contract that all external values pass
through `import`.

Non-extensible values store metadata in the WeakMap fallback and are implicitly
shared.

## Root import

For a non-Promise root, import:

1. establishes the direct boundary;
2. synchronously prepares the reachable graph; and
3. returns the original value.

For a Promise root, import returns one derived Promise. Its single value
reaction converts rejection to a language Error when needed, establishes the
resolved root boundary, performs the same preparation, and then exposes the
result.

Import preparation never builds subtree counters.

## Graph walk

`prepareImportedData` performs a depth-first walk over language properties:
own enumerable string keys for objects and canonical indexed elements for
Arrays. Each synchronous segment keeps:

- `currentPath`, the active DFS ancestry; and
- `visited`, identities already entered in that segment.

For each tracked property value:

1. Stop at an existing cycle cut.
2. If the value is on `currentPath`, the property closes a cycle. Mark the
   repeated identity shared, publish a cut on that property, and do not enter
   it.
3. If the value is in `visited`, it is an alias already handled in this
   segment. Mark it shared and stop.
4. If the value already has META, mark it shared and scan that prepared island
   only for references into the current ancestry.
5. Otherwise create its META, add it to the traversal sets, and walk its
   properties.

`Object.keys` order makes synchronous discovery deterministic.

## Prepared islands

Re-entering a prepared identity under a new ancestry can create a cycle even
though the identity was prepared earlier. A fixed-path scanner checks the
island against an immutable copy of the entering ancestry.

The scanner:

- stops at existing cuts;
- uses one weak visited set because its comparison path is fixed;
- marks repeated identities shared; and
- reports whether a route reaches the fixed path.

A synchronous match belongs to the property that entered the prepared island.
Storing that placement-dependent cut on an inner shared node would leave a
phantom cut if the entering property were later replaced.

A Promise encountered by this scan is handled at its own property placement.
Its first resolver resumes the same fixed-path check before publishing the
resolved value.

## Promise properties

The first operation to reach an unmirrored Promise property installs a
`PromiseMirror` and directly registers that property version's first resolver.
Import is the first operation for previously unseen external Promise
placements, so its resolver owns preparation.

At settlement the first resolver:

1. converts rejection to a language Error;
2. resumes full preparation or the fixed-path scan with captured ancestry;
3. keeps intrinsic cycles in newly exposed data on their actual DFS
   back-edges;
4. attributes a cycle reaching ancestry captured before the Promise to the
   Promise placement;
5. marks a resolved tracked value with the inherited import boundary; and
6. publishes the prepared value and placement cut in one transition.

If the mirror remains live, publication replaces the physical Promise property.
If a later operation already replaced that property, publication updates only
the mirror's private `detachedValue`. It never changes the former owner or its
counters.

Later operations registered on the same Promise use it only as a FIFO readiness
signal. They ignore its settlement payload and read the latest live or detached
state from the captured mirror. Every resolver performs its complete work
synchronously, preserving operation order. Callable thenables are canonicalized
once so these registrations share one native Promise reaction queue.

## Imported attachment

`attachImportedDataToImportedData` handles an already resolved imported value
installed within an imported mutation path. It does not repeat full imported
preparation.

The mutation walk supplies the actual post-COW destination ancestry.
Attachment scans the incoming value only for references into that fixed path.
A match publishes a cut on the new owner/key placement.

A fresh assigned or forked Promise captures its destination ancestry at birth.
Its first resolver performs the equivalent attachment scan before publishing
the value. An already imported pending branch needs no second asynchronous
classifier: its original import resolver is already first in FIFO order and
prepares the value before later consumers can observe it.

When a pending attachment is captured, the destination root is marked shared.
A later mutation therefore COWs away and cannot alter the issue-time ancestry.

## Cycle projection

A cycle cut belongs to one owner/key property. The raw property value is not
changed, and the cut is not an Error.

In the ref-index projection:

- a cut contributes `[0, 0, 1]`;
- counts and reverse parent edges do not cross it; and
- its raw target starts an independently indexed component.

Every directed imported cycle has at least one cut before ref-indexing. An
existing cut inside a detected cycle can make another closing cut unnecessary.

The raw graph remains available:

- finite lookup and mutation paths follow ordinary properties;
- Error queries use `cycleCutCount` to reach cut targets through their
  independent indexes; and
- `export` walks raw properties to reconstruct aliases and cycles.

Replacing or deleting the exact cut property removes its cut. COW reconstructs
the new placements instead of copying cut metadata blindly.

## Physical host data

Cycle discovery and ref-index construction do not change language-visible
string-key data, though inline metadata may add a non-enumerable Symbol.
Language mutation first COWs and therefore does not write the imported object.

Promise settlement is the deliberate exception. A live Promise placement must
remain an own enumerable writable data property, and its first resolver writes
the prepared value there. Existing writable properties on sealed or otherwise
non-extensible holders are valid. A missing, accessor, non-enumerable, or
non-writable Promise property is a fatal host-boundary violation.

Ordinary frozen data remains valid when it contains no Promise property that
needs settlement. Native code receives runtime data only through `export`,
which returns a metadata-free copy.

## Enumerable `__proto__`

An own enumerable `__proto__` property is ordinary language data. Missing keys
are created with `Object.defineProperty` as own enumerable data properties, so
runtime writes never invoke the inherited `Object.prototype.__proto__` setter.

## Cost

Fresh preparation is O(n) in the synchronously reachable graph. Re-entering a
prepared island adds a fixed-path scan for that ancestry. Promise continuations
retain only their captured path and weak identity state.

Recursive synchronous graphs are bounded by the JavaScript call stack.
Permanently pending Promises may retain traversal state, so retained identity
tables are weak.

## Module boundary

`src/import.js` owns import boundaries, graph preparation, fixed-path scanning,
imported attachment, cycle cuts, and import-specific first resolvers.

`src/meta.js` owns metadata and ownership marks.
`src/promise-mirrors.js` owns live/detached property-version identity.
`src/property-transitions.js` coordinates physical property and mirror changes.
`src/refcounts.js` consumes the prepared projection and owns atomic count and
parent-edge accounting around those changes.
