# `ArrayView`

`ArrayView` is the internal shared-storage representation used by [`run`](run.md) for `slice`, `concat`, `push`, `pop`, and `shift`. Owned native Arrays are mutated directly; a view is created when an operation can preserve existing logical identities by changing only bounds or hidden backing storage.

## Representation

A view is a half-open logical range over shared storage:

```js
physicalIndex = _start + logicalIndex
length = _end - _start
```

The constructor accepts an Array or `ArrayView`; `start` and `end` are relative to that logical source and default to its full range. If an Array has an attached view, that projection is the source. Internally the bounds are converted to storage coordinates.

`_backing`, `_start`, and `_end` are non-enumerable runtime fields. Derived views reference the same backing Array directly and keep independent bounds. The backing Array carries no ArrayView-specific property.

When a native Array first becomes backing, its metadata stores an attached view covering the whole Array. That view is the native Array identity's projection; the native Array continues to own its metadata, parent edges, and Promise property versions. A separately published `ArrayView` is a distinct logical identity with its own metadata.

Imported managed Arrays are never backing. Operations materialize them into runtime-owned Arrays, preserving the borrowed host data and its external metadata.

`ArrayView` is not exported from the package.

## Logical surface

A view exposes the translated enumerable indexes inside its range and a virtual non-enumerable `length`. Canonical string indexes such as `"0"` are indexes exactly as in JavaScript; other string properties are not Array data. Holes remain holes. Runtime fields, backing indexes outside the range, symbols, non-enumerable properties, and metadata are outside the language surface.

Installed placement versions also contribute logical indexes, including without physical slots. Committed length lives on the logical owner's metadata when publication records it separately; physical length cannot erase that state. Enumeration merges version keys with physical candidates in numeric order. Materialization, export, and detached snapshots preserve logical length and trailing holes. Before attaching or deriving a view, including a zero-growth derivation, require its storage window to represent that logical length; otherwise use materialization.

The common language-property boundary reads each logical owner's installed versions before its translated physical descriptors. It also enumerates candidates and resolves logical presence for records, Arrays, and views. ArrayView supplies only physical projection; it has no separate logical read, enumeration, or iteration API. Traversal, ownership, import, export, refcounting, Error search, and copy-on-write use the same owner and property boundary.

Ordinary indexed mutation or deletion on an ArrayView materializes the changing identity first. Entry protection uses the same materialization eligibility: an attached view or resolved logical length differing from physical storage requires a copy. Unresolved growth alone does not require copying an owned native Array; logical placements already represent that uncertainty. Ownership and leases retain their ordinary COW rules. Endpoint transitions and bounds-only length changes may continue on shared storage because they do not change any preserved view's logical surface.

The storage representation provides translated `descriptor`, `set`, `delete`, and `setLength` operations. These are internal storage operations, not permission to bypass ownership or placement publication. Logical consumers call `readLanguageProperty`, `hasLanguageProperty`, and `enumerableLanguageKeys` with the logical owner. Complete collectors use `enumerableLanguageKeyCandidates` so a failed descriptor does not hide other candidates. Optional Array ranges filter stored and version candidates together.

## Derivation

A derivation is allowed only when the receiver is not imported.

The first derivation attaches the source projection and captures the selected range. Tracked retained values become shared. Each retained Promise property receives a result-view Promise version forked at the derivation's FIFO position. Inserted properties use ordinary remap placement and receive their own versions. The versions remain logically independent even though their properties use the same backing slot.

A constructed result records `retainedPrefixLength`: the prefix whose backing elements have already been normalized and protected for retention. Subsequent derivations capture that prefix's installed versions and the uncaptured suffix, without rereading the prefix's ordinary physical slots. They still transfer absent overlays and independently capture pending versions. New suffix elements need no premature sharing; the next derivation retains them when needed. A contraction clamps the retained prefix to the new bounds. Ordinary indexed changes materialize a new Array, which carries no retained-prefix fact. The fact is local to the logical view and never copied as identity metadata.

This makes repeated endpoint derivation proportional to newly retained elements and captured versions after the initial backing capture. It also preserves shared storage for protected sources. Initial capture, copying an ineligible representation, and building a refcount index for a new result still require their ordinary graph work; this is not an unconditional constant-time promise for every `push` or `pop`. The optimization uses the same derivation, publication, and rollback paths for observation and mutation.

Retained-property capture and Promise settlement on a view update its logical overlays without writing shared physical slots. The view owns those placements, not the source's storage. This also applies to synchronous thenable normalization. Fresh suffix insertion may write beyond the source's preserved bounds; ordinary indexed mutation still materializes first. No storage copy is required solely to settle a retained element.

`pop` and `shift` derive the retained subrange; an empty result is an empty native Array. Non-empty `push` requires the logical end to equal the physical end. `unshift` uses the ordinary remap path whenever its receiver must be preserved; physically moving shared backing would require mutable coordinates shared by every existing view.

`slice` logically converts its bounds before representation work, then returns a subview over the selected range when backing reuse is eligible. Empty results use an empty native Array; otherwise an ineligible source is remapped directly.

`concat` extends only the receiver backing; it never prepends into an argument backing. The receiver's attached view keeps its old end while the result view includes the appended suffix. The suffix is built as a sparse property-placement remap, so holes, ownership, Promise versions, and indexed-edge accounting use the same placement path as materialization. Overlapping inputs, including `array.concat(array)`, are captured before placement. If the receiver does not reach the physical end or its backing cannot extend, concat materializes normally.

End growth is shared by `push`, `concat`, and past-length assignment. It requires the physical end and writable length, plus extensibility when properties will be added. If extension is ineligible, the logical range materializes and the operation continues on a native Array.

## Materialization and length

Materialization creates an owned native Array containing the logical length and indexed elements. It rebuilds ownership, refcounts, cycle cuts, and Promise versions from those logical placements; import status remains on the retained child identities, while storage and view state are not copied.

Length shrink moves `_end` while deleting the changing identity's logical edge state in descending order. A non-configurable logical element stops the shrink at that index after higher elements have been removed, matching `ArraySetLength`. Growth with holes can extend shared storage only when the view ends at the physical end and the backing length is writable; otherwise the view materializes first. Growing after a bounds-only shrink therefore cannot reveal retained physical values.

Indexed assignment follows JavaScript Array length behavior. Assignment beyond a view's end can extend shared storage, including holes, when the view reaches the physical end and the backing is extensible with writable length. It publishes a derived view ending at `index + 1`; otherwise the receiver materializes before assignment. Unlike native endpoint methods, this direct own-property write need not inspect inherited indexes.

Export always materializes the logical surface and resolves reachable Promises according to the normal export contract. Native Array methods never receive the physical backing as an ordinary receiver.

## Captured shape and pending placements

Element state and Array length answer different questions. Creating index 4 commits length at least 5 even if its value is pending or the entry stays open; deleting that index later leaves length 5. Entering index 4 without creating it adds no growth. The element's placement version orders access to that element; length state records only whether creation has happened or is still possible.

Length questions keep their program position. For an initially empty Array, an entry at index 4, a length read, and then an entry at index 8 mean the read can return only 0 or 5. The later entry cannot change that earlier answer, even if it finishes first. Conversely, a length read issued after both entries can return 9 as soon as index 8 is created, without waiting for the earlier entry at index 4. This is why length knowledge has an ordered sequence rather than a single array-wide gate.

Each logical Array or ArrayView owns its length knowledge. Its ordered growth contributions and length/range questions preserve captured prefixes: the minimum is committed growth, and the maximum also includes unresolved bounds. Exact length is ready when bounds coincide; a range question can answer earlier. Forks share earlier outcomes but exclude later contributions and operation watchers. Coalesce adjacent settled growth and unlink completed watchers, including behind an unresolved head. Pending watchers use the existing operation owner and release-on-close mechanism. Intrinsic length reads create no property version or graph Promise edge.

Array candidate enumeration includes installed versions beyond the published minimum or physical length, bounded by the requested range. Undecided presence is a candidate, not a present undefined element. A consumer resolving a placement uses its captured presence and value; a settled overlay remains authoritative over stale storage.

Deriving a view transfers in-range absence overlays as well as present placements. An absent overlay may hide a physical backing slot; omitting it would expose that stale value in the derived view. Ordinary holes need no overlay. Transfer logical contents without copying the source's storage authority or physical-absence bookkeeping.

Length shrink removes every logical placement in its truncated suffix, including versions with no physical property. Detaching those versions revokes their authority to publish into the shortened owner. Earlier captures keep their own settlement; shrink waits for conflicting transitions, never for the ordinary payloads they publish. A later payload cannot regrow the Array or write outside a subsequently derived ArrayView.

Complete traversal captures shape before suspension and visits all required placement candidates. Their completed transitions determine final shape without another wait. Export and native materialization use that captured length and preserve holes. Bounded consumers exclude placements outside their consumed range; positive at needs no length query, positive bounded slice may use a range proof, and with still needs exact output length after index validation. Physical backing reuse additionally requires resolved shape equal to its storage window.

Controlled Array algorithms own their shape dependencies. `at`, `slice`, and searches prepare their selected indexes or ranges through their ordinary argument preparation. Check for provably empty ranges and invalid indexes before requesting exact length, retaining required argument processing. For a negative index `i`, validity is the range question at `-i - 1`; only a potentially valid position needs exact length for normalization. `with` uses that same range rule for validation, then requires exact output shape on success. Searches capture their consumed range, including an empty range when their start cannot reach an element. `join`, `toString`, `flat`, and sorting capture their required placements and shape together, without an earlier exact-length wait. `concat` captures each remap before waiting for its length and retains input leases until output placement; ordinary element data need not settle before it returns the outer Array. Intrinsic methods prepare exact remap length before execution.

Forward searches scan the committed prefix before requesting more range knowledge; a known match does not wait for unrelated growth. A nonnegative backward start proven in range also needs no exact length. Relative starts and unbounded backward search wait for the shape needed to locate their start. Index searches preserve scan order; `includes` may finish on any match while other comparisons or growth remain pending. Searches lease the receiver while they may read more placements. Once `includes` has captured every candidate, it releases that lease even if captured values are still pending; an early match also releases unused range questions through ordinary operation closure.

Array methods publish independently owned placements through remaps or derived views. Retained placements transfer their complete captured value, presence, recovery, and transition state; discarded or overwritten source placements retain no write authority over the resulting Array. Element entry completion therefore adds no method-wide wait. Intrinsics still need exact shape and prepared arguments, and algorithms such as sorting still consume their required values. A removed-element result may remain pending after the new receiver and its length are ready. This isolation follows destination publication authority, not mandatory eager copying of every source element; backing reuse and future optimizations must preserve it. Assignment of length `n` waits for unfinished transitions at indexes at least `n`, including logical candidates beyond physical storage, without waiting for ordinary data those transitions publish. Transitions in the retained prefix carry into the resulting Array; neither they nor unknown growth confined to that prefix delay the length assignment.
