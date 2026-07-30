# Deferred Keyed Containers

## Status

This document records possible future extensions that were considered while
designing property-state class COW. None is part of plan step 20.

These extensions are independent of the completed property-state class COW
step. String and array convenience behavior can be implemented as
language-defined operations without first adding native container support.
Planned [`ArrayView`](../array-view.md) is one Array-specific logical-property
integration in step 23; it does not generalize the graph to Map, Set, or other
virtual containers.

The current recommendation is to use plain objects at the Cascada boundary:

```js
const mapData = Object.fromEntries(map)
const setData = Object.fromEntries(
    [...set].map(key => [key, true]),
)
```

This preserves the existing graph, Promise, Error, ownership, and COW model
without introducing virtual property storage.

## Array subclasses

Step 20 treats array subclasses as ordinary arrays. A future extension that
preserves their prototypes could:

- require the same exact-prototype certification as ordinary classes;
- create a genuine same-length base array;
- restore the subclass prototype without invoking its constructor; and
- reuse the existing array property-copy pipeline.

This is technically smaller than Map or Set support but is deferred because no
current use case requires it. A plain data object containing an ordinary array
covers the current language use case.

## Why Map and Set are deferred

Map entries and Set members are not own enumerable JavaScript properties.
Making them appear as Cascada properties would require a logical-property
abstraction across:

- import preparation;
- path traversal and mutation;
- COW construction;
- Promise mirrors and settlement;
- property transitions;
- cycle cuts;
- refcounts and parent edges;
- lookup and Error queries;
- export; and
- verification.

Map would be especially costly because an entry containing `undefined` must be
distinguished from a missing entry, and a live Promise mirror would require a
container-aware placement-validity invariant.

Set membership can hold only `true` or absence. It has no physical placement
for a pending Promise, settled `false`, or Error, so Promise-valued membership
would conflict with the live-property mirror contract.

## Possible Map model

If implemented later, a conservative model would require:

- string keys only;
- no collision between an entry and an own enumerable subclass field;
- Map entries exposed as logical own enumerable properties;
- missing keys created as entries;
- a subclass's ordinary field set fixed by its imported shape;
- intrinsic-only iteration, reads, writes, and deletion;
- a genuine base Map shell populated before restoring a certified subclass
  prototype;
- rebuilt classification metadata on every COW copy;
- full Promise, Error, alias, cycle, and refcount participation; and
- plain-object export with normal JavaScript object key ordering.

Non-string keys should make the Map unsupported instead of being retained as
opaque unindexed aliases.

A live Map mirror would remain valid only while the owner retains its captured
Map classification, the normalized key remains an entry, no ordinary property
collides, and the placement remains the same storage kind captured at mirror
birth.

## Possible Set model

A conservative future Set model would require:

- string members only;
- no collision between membership and an own enumerable subclass field;
- present members reading as `true`;
- `true` adding membership;
- `false`, `null`, `undefined`, and deletion removing membership;
- every other raw kernel value being a compiler-contract violation;
- intrinsic-only construction and mutation;
- a base Set shell populated before restoring a certified subclass prototype;
  and
- membership skipped by refcount and Error walks because primitive `true`
  contributes no graph work.

Promise-valued membership would remain unsupported unless the live-property
mirror model itself were redesigned.

## Unsupported-container observation

If virtual containers are added, unsupported instances must not silently export
as truncated `{}` values. Import preparation should record a stable attributed
Error for an unsupported identity and boundary:

- lookup returns it;
- `hasError` returns `true`;
- `getErrors` includes it;
- export fails with it; and
- COW replaces the unsupported placement with the same Error.

Ref-indexing would count the placement as one Error contribution without
descending into the unsupported identity.

This observation model is deferred together with virtual containers. Step 20
only prevents silent demotion when mutation actually requires COW through an
unsupported instance.

## Other built-in types

Native internal-slot types need individual semantics and kernel-owned copy
strategies. Prototype restoration alone is not sufficient.

| Type | Possible copy basis | Unresolved issue |
| --- | --- | --- |
| `Date` | `new Date(source.getTime())` | Atomic value versus extra properties |
| `RegExp` | clone source, flags, and `lastIndex` | Whether `lastIndex` is language state |
| `ArrayBuffer` | `source.slice(0)` | Buffer/view alias topology |
| typed arrays | copy storage and restore prototype | Index and shared-buffer semantics |
| `DataView` | clone or remap backing storage | Buffer/view alias topology |

WeakMap and WeakSet cannot enumerate or copy their contents and cannot use the
Map/Set model.

Each built-in should remain unsupported until its native method validity, COW
isolation, aliases, Promises, Errors, and export semantics are specified and
tested.

## Method-call integration

The deferred proxy-backed invocation design is recorded separately in
[`run.md`](run.md). Native Map/Set mutators would additionally require the
logical-property semantics deferred by this document. Neither feature is part
of the current data-only runtime plan.

## Suggested future phases

If demand justifies the complexity, implement independently:

1. optional certified array-subclass support;
2. a no-behavior-change logical-property interface refactor;
3. string-only Map support;
4. string-only Set support;
5. selected built-in value types.

Each phase should be optional and should preserve the ordinary object/array
fast path.
