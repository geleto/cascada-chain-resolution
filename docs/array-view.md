# `ArrayView`

`ArrayView` is the internal copy-on-write representation used by [`run`](run.md) for `push`, `pop`, `shift`, and `unshift`. Owned native Arrays are mutated directly; a view is created only when an endpoint operation must preserve the current logical identity.

## Representation

A view is a half-open logical range over shared storage:

```js
storage = { array, baseIndex }
physicalIndex = _start + logicalIndex + storage.baseIndex
length = _end - _start
```

The constructor accepts an Array or `ArrayView`; `start` and `end` are relative to that logical source and default to its full range. If an Array has an attached view, that projection is the source. Internally the bounds are converted to storage coordinates.

`_storage`, `_start`, and `_end` are non-enumerable runtime fields. Derived views share the storage record, so a physical prepend updates `baseIndex` once while every existing view keeps stable coordinates. The backing Array carries no ArrayView-specific property.

When a native Array first becomes backing, its metadata stores an attached view covering the whole Array. That view is the native Array identity's projection; the native Array continues to own its metadata, parent edges, and Promise property versions. A separately published `ArrayView` is a distinct logical identity with its own metadata.

`ArrayView` is not exported from the package.

## Logical surface

A view exposes the translated enumerable indexes inside its range and a virtual non-enumerable `length`. Canonical string indexes such as `"0"` are indexes exactly as in JavaScript; other string properties are not Array data. Holes remain holes. Runtime fields, backing indexes outside the range, symbols, non-enumerable properties, and metadata are outside the language surface.

The language-property boundary resolves an attached projection and delegates descriptor, read, write, delete, presence, and key operations to the view. Traversal, ownership, import, export, refcounting, Error search, Promise mirrors, iteration, and copy-on-write therefore operate on logical owners and keys rather than physical backing positions.

Ordinary indexed mutation or deletion materializes the changing identity first. Endpoint transitions and bounds-only length changes may continue on shared storage because they do not change any preserved view's logical surface.

The representation provides:

```js
has(key)
get(key)
set(key, value)
delete(key)
descriptor(key)
keys()
setLength(length)
```

Its iterator reads the current logical length and yields every logical position, including `undefined` for holes.

## Endpoint derivation

An endpoint derivation is allowed only when the receiver is not imported.

The first derivation attaches the source projection. A native source prepares each retained property on derivation because an earlier contraction may have excluded it; a published `ArrayView` already owns prepared retained properties. Tracked retained values become shared. Each retained Promise property receives a result-view mirror forked at the derivation's FIFO position. Promise arguments receive fresh result-view mirrors before the physical write. The mirrors remain logically independent even though their properties use the same backing slot.

`pop` and `shift` only contract the result bounds. Empty views keep their bounds. `push` requires the logical end to equal the physical end. `unshift` requires the logical start to equal the physical start; after the native prepend, increasing the shared base offset absorbs the physical movement for all earlier views. Adding no values derives a new view without touching the backing.

Physical extension is preflighted before attachment or mirror preparation. It checks the Array length limit, extensibility, writable length and affected indexed properties, and indexed prototype interference. If extension is ineligible, the logical range materializes and the operation continues on the resulting native Array.

## Materialization and length

Materialization creates an owned native Array containing the logical length and indexed elements. It recreates ownership, refcounts, import attribution, cycle cuts, and Promise mirrors for that identity; storage and view state are not copied.

Length shrink moves `_end` while deleting the changing identity's logical edge state one index at a time. Growth with holes can extend shared storage only when the view ends at the physical end and the backing length is writable; otherwise the view materializes first. Growing after a bounds-only shrink therefore cannot reveal retained physical values.

Indexed assignment follows JavaScript Array length behavior. Assignment beyond a view's end can extend shared storage, including holes, when the view reaches the physical end and the backing is extensible with writable length. It publishes a derived view ending at `index + 1`; otherwise the receiver materializes before assignment. Unlike native endpoint methods, this direct own-property write need not inspect inherited indexes.

Export always materializes the logical surface and resolves reachable Promises according to the normal export contract. Native Array methods never receive the physical backing as an ordinary receiver.
