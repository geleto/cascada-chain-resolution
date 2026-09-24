# `ArrayView`

`ArrayView` owns Array bounds and backing storage when those differ from a simple native Array. It supports both pending length and the shared-storage operations `slice`, `concat`, `push`, `pop`, and `shift`. Ordinary native Arrays use their physical length; they acquire a view when they need captured growth knowledge or a bounded storage projection.

## Representation

A view is a half-open logical range over shared storage:

```js
physicalIndex = _start + logicalIndex
minimumLength = _lengthState.minimum ?? _lengthState
```

The constructor accepts an Array or `ArrayView`; `start` and `end` are relative to that logical source and default to its full range. If an Array has an attached view, that projection is the source. Internally the bounds are converted to storage coordinates.

`_backing`, `_start`, and `_lengthState` are non-enumerable runtime fields. `_lengthState` is either a fixed number or the ordered growth/watcher sequence. Derived views reference the same backing Array directly and keep independent bounds. The backing Array carries no ArrayView-specific property or separate logical-length metadata.

Callers use the `ArrayView` class for both native Arrays and views; they never access the length sequence or its maximum directly. `resolveLength` supplies exact length, and `resolveInRange` supplies index validity, immediately when known. `captureLength` retains the current program position for a complete traversal to finish after its captured placement transitions. `minimumLength` supplies only the committed prefix for incremental scans and storage allocation; `readyLength` returns exact length or `undefined` for a boundary that must reject pending shape without subscribing. There is no generic `ArrayView.length` getter that could mistake a lower bound for an exact answer. Language-level `array.length` uses `resolveLength`.

When a native Array first becomes backing, its metadata stores an attached view covering the whole Array. That view is the native Array identity's projection; the native Array continues to own its metadata, parent edges, and Promise property versions. A separately published `ArrayView` is a distinct logical identity with its own metadata.

Imported managed Arrays are never backing. Operations materialize them into runtime-owned Arrays, preserving the borrowed host data and its external metadata.

`ArrayView` is not exported from the package.

Controlled Array intrinsics operate on ordinary sparse Arrays of placement references. Capturing that remap does not resolve element values. The intrinsic moves or replaces the references, then common placement transfer publishes the resulting Array. Removed-element results retain their own captured placements independently of receiver publication; ArrayView derivation remains the backing-reuse path.

## Logical surface

A view exposes the translated enumerable indexes inside its range and a virtual non-enumerable `length`. Canonical string indexes such as `"0"` are indexes exactly as in JavaScript; other string properties are not Array data. Holes remain holes. Runtime fields, backing indexes outside the range, symbols, non-enumerable properties, and metadata are outside the language surface.

Installed placement versions also contribute logical indexes, including without physical slots. The view's length is authoritative; physical length cannot erase committed growth or determine possible growth. Enumeration merges version keys with physical candidates in numeric order. Materialization, export, and detached snapshots preserve logical length and trailing holes. Sharing backing requires resolved length, including for a zero-growth derivation.

The common language-property boundary reads each logical owner's installed versions before its translated physical descriptors. It also enumerates candidates and resolves logical presence for records, Arrays, and views. ArrayView supplies storage projection and length knowledge, without a separate logical element-read, enumeration, or iteration API. Traversal, ownership, import, export, refcounting, Error search, and copy-on-write use the same owner and property boundary.

Ordinary indexed mutation or deletion on a distinct view materializes the changing identity first. A native Array with an attached projection continues in place when ordinary ownership permits and its committed length matches physical storage; additional independent entries do not copy it. Sharing and leases use ordinary COW. A mismatch between committed and physical length requires materialization before indexed mutation, including retained storage outside the view or logical growth without physical storage. Endpoint methods may derive views over shared storage because they do not change any preserved view's logical surface.

## Length state and backing ownership

Possible out-of-range creation adds a contribution to the existing length sequence and a gate to the logical placement. It neither creates a physical element nor resizes backing storage. ArrayView owns length state and backing bounds; placement publication owns the corresponding graph effects. The linked-list module handles only contributions, captured questions, and their ordering.

Placement publication uses two class operations: `beginIndexTransition` returns the completion action for possible creation, and `prepareIndexCreation` returns a growth commit for a known creation. Preparation performs fallible storage reads before publication; the commit updates logical growth after the element write without another host read. Callers hold neither sequence nodes nor a separate length-registration token.

Copying a logical Array also copies its shape through `copyShape`, called by common container-copy bookkeeping. This is distinct from copying backing storage: an independently mutable copy retains earlier growth outcomes but must exclude later source operations. Only that case forks the sequence. Read-only captures retain one position instead. Native Arrays with no projection continue to use their physical length directly.

Preparing a shared-storage derivation marks the backing Array with the ordinary `shared` flag. Subsequent mutation of its existing slots follows ordinary COW. Length assignment on that shared native owner also uses ordinary COW; a distinct view retains independent bounds. A projection installed only to track length does not mark the Array shared. Pre-existing storage outside a view's range remains unavailable for extension, even when it consists entirely of holes. Imported backing is never modified. End extension still reuses shared backing when it adds storage beyond preserved bounds. No separate backing-ownership flag or speculative capacity lifecycle is needed.

Runtime-owned backing accepts valid length changes under the [managed-storage contract](data-limitations.md#proxies-in-managed-storage). A failed element write can still commit logical poison and length beyond physical storage; placement versions and the view's length remain authoritative. Native managed observations reuse an existing native Array when its physical bounds and properties already match its logical surface, including an attached projection with unchanged bounds. Distinct views, differing bounds, and differing logical overlays require materialization. Managed mutation retains complete receiver isolation.

The storage representation provides translated `descriptor`, `set`, and `delete` operations; `set("length", value, operationContext)` also handles length writes. These are internal storage operations, not permission to bypass ownership or placement publication. Logical consumers call `readLanguageProperty`, `hasLanguageProperty`, and `enumerableLanguageKeys` with the logical owner. Complete collectors use `enumerableLanguageKeyCandidates` so a failed descriptor does not hide other candidates. Optional Array ranges filter stored and version candidates together.

## Derivation

A derivation is allowed only when the receiver is not imported.

The first derivation attaches the source projection and captures the selected range. The backing Array and tracked retained values become shared. Each retained Promise property receives a result-view Promise version forked at the derivation's FIFO position. Inserted properties use ordinary remap placement and receive their own versions. The versions remain logically independent even though their properties use the same backing slot.

A constructed result records `retainedPrefixLength`: the prefix whose backing elements have already been normalized and protected for retention. Subsequent derivations capture that prefix's installed versions and the uncaptured suffix, without rereading the prefix's ordinary physical slots. They still transfer absent overlays and independently capture pending versions. New suffix elements need no premature sharing; the next derivation retains them when needed. A contraction clamps the retained prefix to the new bounds. Ordinary indexed changes materialize a new Array, which carries no retained-prefix fact. The fact is local to the logical view and never copied as identity metadata.

This makes repeated endpoint derivation proportional to newly retained elements and captured versions after the initial backing capture. It also preserves shared storage for protected sources. Initial capture, copying an ineligible representation, and building a refcount index for a new result still require their ordinary graph work; this is not an unconditional constant-time promise for every `push` or `pop`. The optimization uses the same derivation, publication, and rollback paths for observation and mutation.

Retained-property capture and Promise settlement on a view update its logical overlays without writing shared physical slots. The view owns those placements, not the source's storage. This also applies to synchronous thenable normalization. Fresh suffix insertion may write beyond the source's preserved bounds; ordinary indexed mutation still materializes first. No storage copy is required solely to settle a retained element.

`pop` and `shift` derive the retained subrange; an empty result is an empty native Array. Non-empty `push` requires the logical end to equal the physical end. `unshift` uses the ordinary remap path whenever its receiver must be preserved; physically moving shared backing would require mutable coordinates shared by every existing view.

`slice` logically converts its bounds before representation work, then returns a subview over the selected range when backing reuse is eligible. Empty results use an empty native Array; otherwise an ineligible source is remapped directly.

`concat` extends only the receiver backing; it never prepends into an argument backing. The receiver's attached view keeps its old end while the result view includes the appended suffix. The suffix is built as a sparse property-placement remap, so holes, ownership, Promise versions, and indexed-edge accounting use the same placement path as materialization. Overlapping inputs, including `array.concat(array)`, are captured before placement. If the receiver does not reach the physical end or its backing cannot extend, concat materializes normally.

End growth is shared by `push`, `concat`, and past-length assignment. It requires the physical end and writable length, plus extensibility when properties will be added. If extension is ineligible, the logical range materializes and the operation continues on a native Array.

## Materialization and length

Materialization creates an owned native Array containing the logical length and indexed elements. It rebuilds ownership, refcounts, cycle cuts, and Promise versions from those logical placements; import status remains on the retained child identities, while storage and view state are not copied.

Length assignment preserves its rollback baseline through the ordinary scope transition. It materializes directly into an Array of the assigned length, transferring only retained placements; discarded elements need no capture, subscription, indexing, or physical deletion. The baseline stays intact even if publishing the resized Array fails. This also handles restricted source storage without a separate in-place resize path. Endpoint methods retain their shared-backing optimizations: deriving shorter bounds does not delete backing, and eligible extension grows backing without changing earlier views.

Indexed assignment follows JavaScript Array length behavior. Assignment beyond a view's end can extend shared storage, including holes, when the view reaches the physical end and the backing is extensible with writable length. It publishes a derived view ending at `index + 1`; otherwise the receiver materializes before assignment. Unlike native endpoint methods, this direct own-property write need not inspect inherited indexes.

Export always materializes the logical surface and resolves reachable Promises according to the normal export contract. Native Array methods never receive the physical backing as an ordinary receiver.

## Captured shape and pending placements

Element state and Array length answer different questions. Creating index 4 commits length at least 5 even if its value is pending or the entry stays open; deleting that index later leaves length 5. Entering index 4 without creating it adds no growth. The element's placement version orders access to that element; length state records only whether creation has happened or is still possible.

Length questions keep their program position. For an initially empty Array, an entry at index 4, a length read, and then an entry at index 8 mean the read can return only 0 or 5. The later entry cannot change that earlier answer, even if it finishes first. Conversely, a length read issued after both entries can return 9 as soon as index 8 is created, without waiting for the earlier entry at index 4. This is why length knowledge has an ordered sequence rather than a single array-wide gate.

Each logical Array owns its length knowledge through its ArrayView projection when physical length alone is insufficient. Its ordered growth contributions and length/range questions preserve captured prefixes: the minimum is committed growth, and the maximum also includes unresolved bounds. Exact length is ready when bounds coincide; a range question can answer earlier. Read-only captures retain passive question markers in that sequence; only independently mutable copies fork it. Forks share earlier outcomes but exclude later contributions and questions. When current bounds coincide, the Array retains the ready number while earlier questions keep their own sequence. Coalesce adjacent settled growth and unlink completed watchers, including behind an unresolved head. Pending watchers use the existing operation owner and release-on-close mechanism. Intrinsic length reads create no property version or graph Promise edge.

Growth sources retain their final outcome and subscribe only sequences with pending questions that need notification. An active completion updates bounds from its changed contribution onward, using the already-current subscribed prefix and compacting affected nodes in the same pass. Adding or removing a question adjusts subscriptions only where the observed prefix changes. Other captured sequences read those outcomes when used; sources hold no reverse registry of unused copies. Normal completion and local closure remove subscriptions. Ready reads remain synchronous, and an unchanged outcome frontier requires no repeated scan.

Array candidate enumeration includes installed versions beyond the published minimum or physical length, bounded by the requested range. Undecided presence is a candidate, not a present undefined element. Length readiness does not release element gates: sparse output retains absence, while dense output turns a retained absent position into present undefined. A consumer resolving a placement uses its captured presence and value; a settled overlay remains authoritative over stale storage.

Deriving a view transfers in-range absence overlays as well as present placements. An absent overlay may hide a physical backing slot; omitting it would expose that stale value in the derived view. Ordinary holes need no overlay. Transfer logical contents without copying the source's storage authority or physical-absence bookkeeping.

Length shrink excludes every logical placement in its truncated suffix, including versions with no physical property. Only retained placements transfer to the resized Array, so discarded versions have no authority to publish into it. Earlier captures keep their own settlement; shrink waits for conflicting transitions, never for the ordinary payloads they publish. A later payload cannot regrow the Array or write outside a subsequently derived ArrayView.

Complete traversal captures shape before suspension and visits all required placement candidates. Their completed transitions determine final shape without another wait. Export and native materialization use that captured length and preserve holes. Bounded consumers exclude placements outside their consumed range; positive at needs no length query, positive bounded slice may use a range proof, and with still needs exact output length after index validation. Physical backing reuse additionally requires resolved shape equal to its storage window. External snapshot reads, including a length read through a managed alias, require their selected value to be ready synchronously; unresolved shape produces `InvalidExternalSnapshot` without subscribing.

Controlled Array algorithms own their shape dependencies. `at`, `slice`, and searches prepare their selected indexes or ranges through their ordinary argument preparation. Check for provably empty ranges and invalid indexes before requesting exact length, retaining required argument processing. For a negative index `i`, validity is the range question at `-i - 1`; only a potentially valid position needs exact length for normalization. `with` uses that same range rule for validation, then requires exact output shape on success. Searches capture their consumed range, including an empty range when their start cannot reach an element. `join`, `toString`, `flat`, and sorting capture their required placements and shape together, without an earlier exact-length wait. `concat` captures each remap before waiting for its length and retains input leases until output placement; ordinary element data need not settle before it returns the outer Array. Intrinsic methods prepare exact remap length before execution.

Forward searches scan the committed prefix before requesting more range knowledge; a known match does not wait for unrelated growth. A nonnegative backward start proven in range also needs no exact length. Relative starts and unbounded backward search wait for the shape needed to locate their start. Index searches preserve scan order; `includes` may finish on any match while other comparisons or growth remain pending. Searches lease the receiver while they may read more placements. Once `includes` has captured every candidate, it releases that lease even if captured values are still pending; an early match also releases unused range questions through ordinary operation closure.

Array methods publish independently owned placements through remaps or derived views. Retained placements transfer their complete captured value, presence, recovery, and transition state; discarded or overwritten source placements retain no write authority over the resulting Array. Element entry completion therefore adds no method-wide wait. Intrinsics still need exact shape and prepared arguments, and algorithms such as sorting still consume their required values. A removed-element result may remain pending after the new receiver and its length are ready. This isolation follows destination publication authority, not mandatory eager copying of every source element; backing reuse and future optimizations must preserve it. Assignment of length `n` waits for unfinished transitions at indexes at least `n`, including logical candidates beyond physical storage, without waiting for ordinary data those transitions publish. Transitions in the retained prefix carry into the resulting Array; neither they nor unknown growth confined to that prefix delay the length assignment.
