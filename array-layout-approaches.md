# Partial Array publication: queryable block layouts

## 1. Decision and status

Use **one queryable block layout integrated with the existing Array machinery**. Each captured Array version has one logical layout. Ordinary Arrays and simple ArrayViews remain compact representations; they do not require a block-list allocation.

Use **[Variant B: persistent sequence](docs/remap-structure-variant-B.md)** for retained block layouts: small flat leaves, a balanced tree of relative count measures when needed, exclusive-node reuse, and path copying for shared nodes. Variant A remains a comparison baseline, not a second implementation to deliver.

The architecture and storage variant are selected; production implementation and work bounds are not yet validated. Balancing details, leaf capacity, cache policy, and materialization thresholds remain implementation choices. [iterate-plan.md](iterate-plan.md) owns the method contracts, iterator API, effect/failure rules, and rollout. [Data limitations](docs/data-limitations.md) remains authoritative for current production behavior. The [Chain modes and failure contract](poison-policy-plan.md) define complete, sequential-stream, and unordered-stream behavior, including fallback positions, missing-output markers, and [status-only repair](repair-simplification-plan.md). Actual path flags block access in every mode; unordered mode avoids creating flags solely for positional uncertainty. Structural streaming requires the corresponding failure rules, not merely a new storage format.

The design must preserve sequential equivalence, captured versions, ownership, and deterministic poisoning. The plan's supported dependency rules define which facts must be available and survive failure. Conservative internal bounds cannot override those rules. Representation choices change computation cost, not required dependencies, command effects, or poison presence.

## 2. Runtime concepts

### 2.1 Logical data and physical storage

| Concept | Meaning |
| --- | --- |
| **Placement** | A logical `(container, key)` location. A present Array index holds a property version; a hole is absent even though its index is within length. |
| **Property version** | Captured value, presence, and pending delivery state. Earlier readers retain their version through later writes. |
| **ArrayView** | An internal view over backing storage, currently using a start offset, logical length state, and owner-local overrides. |
| **Layout mapping** | For each destination position (after an operation), identifies its origin in the captured source (before): **destination index → source index**. New values and holes can supply destinations directly. See the [example below](#example-reversing-an-array-with-a-pending-value). |
| **Bounds** | Guaranteed minimum and possible maximum for a normalized coordinate or length. Equal bounds establish an exact value. |
| **Data producer** | A Promise supplying a value, or retained runtime work completing an unfinished layout. This does not require another producer object or scheduler. |
| **Lease and copy-on-write** | Protection preserving captured logical values against later writes; capture need not copy the whole Array. |

The method generates the layout mapping; a generic algorithm applies it to the source to produce the destination.

Source and destination are logical states, not necessarily separate physical Arrays. An operation normally maps from one captured source version; `concat` and inserted-value blocks can have several explicit sources. No mapping may read a later live version instead.

#### Example: reversing an Array with a pending value

```text
Source:      [pendingA, "B", "C"]
Destination: ["C", "B", pendingA]
Mapping:     destination i → source 2-i
```

All source indexes refer to the same captured Array version. The layout is determined without awaiting `pendingA`.

#### Example: supplying a pending value

```text
source = [pendingA, "B"]
result = source.slice(0, 2)
```

The result's shape is ready; its first slot follows `pendingA`. If a later command assigns `result[0] = "X"`, settlement still serves earlier captures without overwriting `"X"`.

Finishing an unknown layout needs more than the payload Promise: it retains the required method arguments, captured source placements and shape, and a continuation. The [partial splice example](#35-partial-splice) shows these dependencies.

### 2.2 Existing implementation and required changes

The runtime already has captured length/`inRange(i)` questions, primarily for uncertain indexed growth; pending property versions; ArrayViews; point overrides; source captures; and ownership protection.

Current remaps are ordinary sparse Arrays of placement references or inserted values. They are built explicitly, not by Proxy tracing. Many methods apply native Array operations to those references and then publish through common placement machinery. Pending values and presence can survive this process; generic promised layout indexes/counts are not implemented.

General partial publication through pending structural arguments and the public managed iterator are planned work. Many current methods still prepare required arguments and exact length before building their output.

A compressed block list needs runtime range operations: native Array methods would treat a block as one element. No compiler range analysis is required. Adapted methods must use the same semantic mapping/write evaluator for ready and pending inputs; native assembly may materialize determined layouts.

Relevant sources: [array-remap.js](src/array-remap.js), [array-invocation.js](src/array-invocation.js), [array-length.js](src/array-length.js), [array-view.js](src/array-view.js), and [property-versions.js](src/property-versions.js). See also [ArrayView documentation](docs/array-view.md).

## 3. Blocks and partial mappings

### 3.1 Counted source blocks

Reduce mapping memory by describing consecutive source positions with one entry.

- A block selects a captured source using `{ index, count, fromEnd }`; omitted `count` means `1`, and omitted `fromEnd` means `false`.
- `abs(count)` is its length. A negative count traverses backward: `{ index: 5, count: -3 }` selects source indexes `5, 4, 3`. Zero count contributes no positions.
- Reversing a nonempty block moves `index` to its other end and flips `count`. Whole-layout reversal also reverses block order.
- Signed counts allow composed layouts to contain both forward and backward blocks.

These descriptors are internal. Ordered iteration consumes ordinary numeric destination indexes; unordered iteration consumes distinct occurrences with independent index futures under the [iterator contract](iterate-plan.md#7-ordered-iterator-api).

Block sequences describe logical order, not a flat list of absolute destination indexes. Variant B stores them in small leaves joined by relative-count tree nodes. A deferred region may retain a nested transformation such as reversal until it can be reduced; the same queries and work bounds apply.

#### End-relative indexes

`index` is a nonnegative offset in the captured source. With `fromEnd: false`, zero selects the first element; with `fromEnd: true`, zero selects the last. Keep the flag and offset until a numeric coordinate is actually required, rather than immediately awaiting length to compute `length - 1 - index`.

```js
{ index: 0, count: 1, fromEnd: true }  // last element
{ index: 0, count: -3, fromEnd: true } // last three, traversed backward
{ index: 2, count: 3, fromEnd: true }  // last three, traversed forward
```

The flag selects the reference end; the sign of `count` still selects traversal toward increasing or decreasing source positions. Use the same coordinate convention for queries and range-edit targets. A source index selects contents; an edit target selects where to replace them. Method normalization preserves clamping, empty ranges, and half-open range semantics before constructing these spans.

When the method already knows the reference end, a pending offset retains that known flag. If a pending input can select either end, keep that choice deferred rather than guessing. Membership and capacity checks still apply.

### 3.2 Inserted values, repetition, and holes

Distinct inserted values can share an internal backing Array:

```text
values = ["X", "Y", "Z"]
block  = { source: values, index: 0, count: 3 }
```

Splitting that block shares its backing instead of copying values. An Array inserted as one element remains one element; it is distinct from this internal backing Array.

A repeated value, as in `fill("X")`, needs one retained value and a repetition count. Repeated object values preserve their shared identity. Holes can be represented as runs of absent placements; they must not become present `undefined` except where the method specifies that conversion.

### 3.3 Promised indexes and counts

Allow known regions to be used while other parts of the layout remain unfinished.

An `index` or `count` can depend on a Promise. Consume it only when the requested fact or required effect depends on it. Pending element values do not prevent a determined layout.

Promise-valued fields participate in shared deferred-region state. That state retains the normalized domain/constraints and causal Error even after failure; a rejected numeric Promise alone is insufficient. Field placement is an implementation detail, not a separate architectural alternative.

Retain the necessary source captures and structural relationships. Length intervals alone do not preserve source identity, block order, or relationships between selectors.

One deferred region can serve many reads. Do not allocate a Promise or descriptor for every possible destination in advance.

#### Deferred-region state

Retain only what the unfinished mapping needs:

- captured source/shape facts and payloads, with their protection;
- the pure mapping rule for the affected region;
- shared control dependencies, their remaining domains/constraints, and causal Errors;
- live destinations, retained uses, and active questions that need notification.

These are logical obligations; reuse captured versions, publication records, and continuations rather than duplicating their state in a new registry.

Required command effects and completion stay with their existing operation owner. A transferred result-data producer must not retain an invocation merely to keep its mapping usable.

#### Queries and settlement

A query reduces available facts to a captured source, payload, hole, or established Error. Otherwise it retains the still-required dependencies. Do not guess an address or replay the original operation.

On settlement, advance affected facts and required placement/index publication before notifying consumers. Release spent captures at their last required use. Replace resolved regions with ordinary blocks when useful; do not eagerly flatten unread regions merely because one control settled. Failure retains only the alternatives and causes still relevant to the mapping.

### 3.4 Optional bounds

Derive useful bounds from method semantics and captured shape, without predicting Promise values.

- `sourceIndexRange` and `countRange` are inclusive `[min, max]` bounds on normalized mapping fields. Index bounds describe nonnegative offsets from the selected end. They must contain every possible successful normalized outcome and may only narrow for that capture.
- On a length-10 Array, `splice(5, pendingCount)` deletes between zero and five elements, regardless of the unknown argument's eventual numeric value.
- Signed count bounds `[-4, -2]` imply length bounds `[2, 4]`; a conservative interval `[-4, 2]` implies `[0, 4]`. Keep a known direction constraint rather than unnecessarily widening across zero. A deferred selection between forward and reversed blocks may leave direction unknown; signed counts do not require it to be unknown.
- Keep the first affected destination coordinate separate from the source index. A front-relative `destinationStartRange` with minimum `5` leaves positions `0–4` unaffected, regardless of source traversal direction. Neither a source index of `5` nor an end-relative target offset of `5` establishes that prefix guarantee.
- Preserve known total-length facts. For example, `fill` preserves length even when its block boundaries are pending; independent block bounds must not lose that fact.

Store bounds only where needed; cheap derivation and exact values need no redundant interval records. The specified rules may require less than an unlimited proof procedure could discover, but every representation must preserve their required answers. A wider internal interval is not a reason to await an irrelevant input or return extra poison. Never certify a position that can disappear.

### 3.5 Partial splice

```text
a = ["A", "B", "C", "D"]
a!.splice(2, pendingCount, "X")
```

Let `d` be the normalized deletion count, between zero and two. The successor layout is:

```text
captured source block: index 0, count 2   → [A, B]
inserted value:                          → [X]
deferred source block: index 2+d, count 2-d
total length:                           → between 3 and 5
```

The first three positions are available independently of `d`. The remainder retains `pendingCount`, captured source placements for `C/D`, the required shape facts, and continuation work. The splice's removed-elements result and command completion may still depend on the count.

| d | Successor Array |
| --- | --- |
| 0 | `[A, B, X, C, D]` |
| 1 | `[A, B, X, D]` |
| 2 | `[A, B, X]` |

If the count fails, the streaming fallback is `[A, B, X, Error, Error]`: C/D might have been deleted and cannot be recovered. The removed-elements call result is poison. Complete mode instead fails the whole Array before iteration begins. A/B/X can be published early only in a streaming mode and after ordinary publication prerequisites.

If a later command assigns `a[1] = "Y"`, its successor uses the new point version. Count settlement or fallback must not restore `B` there. An earlier capture still sees `B`.

## 4. Queries and publication

### 4.1 One query boundary

Behind the existing logical-property boundary, request the fact the consumer needs: shape, presence, selected value, or a range. These are related questions, not a mandatory length-then-presence-then-value pipeline. Ordered iteration must establish existence before issuing a position; an ordinary read may already have a determined value without that proof.

- Use exact mappings, captured source/shape facts, and optional bounds. Reuse the existing captured length/`inRange` facilities; do not create a separately authoritative prefix model.
- Reads, copies, searches, writes, Error queries, export, and iteration consume the same logical state. No consumer bypasses unfinished work through raw backing storage.
- Point overrides, including absence, mask older mappings according to the captured version. Never combine an old layout with later live overrides.

For example, after a partial splice leaves index 3's membership uncertain, a successful `delete a[3]` establishes absence without fixing length. Reading `a[3]` or `a.at(3)` then yields `undefined` whether that index is outside length or an in-range hole. Iteration still needs `inRange(3)` to decide whether to issue a body. An owning-path blocker remains a prerequisite for both consumers.

#### Sparse presence and traversal

Counts include holes; they do not establish own-property presence. Keep holes distinct from present `undefined`, and apply each method's specified hole-preservation or densification rules.

Sparse consumers skip hole spans and enumerate captured placements through the same source selectors and override view. Do not scan every numeric index merely because a span has a large count. Unresolved presence remains a dependency, never assumed absence; unknown destination keys are not guessed. Value iteration separately visits every position it actually issues, yielding `undefined` for a hole.

### 4.2 Position certainty and value readiness

`[pendingA, "B"]` can issue both positions immediately. The occurrences and their payload sources are final; only A's payload is pending. A rejection then poisons that value alone.

A Promise for an unfinished source selection is different. Knowing that index i exists does not establish which occurrence survives there. Numeric lookup may return a Promise for that selection, but iteration waits until the occurrence is structurally published. Never deliver old contents provisionally or turn a later structural failure into an already-issued payload.

For the partial splice's length bounds [3,5], indexes 0–2 are in range and select A/B/X; they form a published prefix. Indexes 3–4 remain undecided. A lower bound can prove existence without proving source selection, so it cannot alone extend that prefix.

#### Unknown upper bounds

Retain [minimum, unknown] when no useful upper bound is available, subject to Array validity. For `[AB] + R + [FGHIJ]`, with R of width [0,unknown], total length is [7,unknown]. Sequential iteration initially issues A/B, then waits for R's selection or end. It cannot issue seven occurrences merely from the length bound. End-relative access can still select J; the future unordered iterator can discover guaranteed survivors in the suffix without their numeric indexes.

### 4.3 Ordered progress

All publication examples assume target, authority, ordering, and validation prerequisites. Complete mode additionally waits for the captured Array's required structural outcome. Genuine path flags block access in every mode.

1. Capture the Array version through the common property boundary.
2. Ask whether the next position exists and which final occurrence supplies it.
3. If membership, source selection, and the intended numeric position are established, capture the payload version and issue it. The payload may be pending or ordinary data poison.
4. If out of range, finish. If a required structural fact is pending, retain the question. If it fails, report structural failure without issuing a guessed occurrence, positional flag, or missing-output marker as a healthy item.
5. Resume at that position when relevant facts change.

Already-issued payload Promises settle independently. Their settlement need not restart the cursor. Required errors and completion retain the [iterator contract](iterate-plan.md#7-ordered-iterator-api).

The [future unordered iterator](iterate-plan.md#future-out-of-order-element-delivery) discovers guaranteed surviving occurrences through the same captured layout. It may deliver them before their indexes are known and accepts the selected positional fallback on failure. It still excludes potentially deleted or overwritten occurrences. Implement occurrence discovery in the unordered stage; ordinary payloads can already settle out of order.

The following [bounded-window phase](iterate-plan.md#bounded-window-iteration) restricts demand to [f,r), where Cascada owns both boundaries and B bounds unfinished positions. Initially r=B; every newly completed admitted occurrence extends r once, including before its exact index settles. Advancing f across the proved completed prefix does not credit those completions again. Thus interior completions expand the window, and retiring them later shrinks its width. Before source/capacity clipping, (r-f) minus completed positions inside the window equals B.

A guaranteed, not-yet-delivered occurrence with possible final index range [lo,hi] is eligible when lo >= f and hi < r, without awaiting its exact index or payload. Intersecting ranges alone cannot establish admission. Include declared fallback in these bounds and preserve count correlations through composed mappings. Completed occurrences with unknown indexes remain excluded from delivery; their pending position resolution must not duplicate an earlier capacity credit.

Reuse sparse/range queries and captured occurrence uses to prune disjoint blocks, revisit only affected boundary candidates, and deliver eligible occurrences once. Do not select an out-of-window occurrence and then block the pull while an eligible earlier occurrence is available. Window updates must neither rescan the unread suffix/completed history nor eagerly allocate holes. Coalesce completed runs and release spent body/payload references while preserving only necessary unresolved occurrence facts. This is another consumer of the same layout; completion acknowledgement and command execution remain in Cascada.

A newly produced Array root must pass its required result validation. For example, `with(pendingIndex, value)` waits for index validity and may resolve to poison; a mapping cannot expose a root that might later be retracted.

### 4.4 Queries from either end

A private query or range-edit target uses an offset and the [fromEnd flag](#end-relative-indexes). The [required endpoint rules](iterate-plan.md#required-endpoint-relationships) belong to the semantic plan; the layout implements them through captured blocks and deferred transformations. Bounds establish membership, and local mapping rules preserve the selected source without requiring an absolute coordinate first.

Numeric coordinates remain necessary for ordinary indexed access. In `S + [M, N]`, where S has length between one and three, the last value is N but numeric index 1 may belong to S or select M.

#### Read or edit a known suffix

For `[A,B] + deferredRemainder + [Z]`, the final block is known even while Z's numeric index is not. Applied independently, `at(-1)` selects Z, `slice(-1)` constructs [Z], `pop()` removes that final block and returns Z, and `fill("Y",-1)` replaces it with [Y]. Relative edits use the same capture and composition machinery as other edits; they do not write to a guessed numeric key.

When an earlier index/count settles, update affected offsets, bounds, and blocks. Fixed published positions never move; unresolved coordinates become determined. If the selected block genuinely depends on an unresolved control, retain that dependency. This is ordinary dependent-remap work, not command replay.

#### Example: pending splice, push, reverse

```text
a = ["A", "B"]
a!.splice(0, pendingCount)
a!.push("Z")
a.at(-1)                 // streaming modes: "Z" despite count failure
a!.reverse()
iterate a
```

Length bounds progress through `[0, 2]`, `[1, 3]`, and `[1, 3]`. The appended value is last regardless of the deletion count. The negative-index read must return `"Z"` without waiting for that count; after reverse, position zero must likewise yield `"Z"`. While the count is pending, dependent length and positions remain unresolved. On failure, streaming modes apply their specified fallback to the earlier region; complete mode fails the Array. Fallback must preserve Z and every other fact already published.

The selector reduction is:

```text
first of reversed result → last of appended result → "Z"
```

The known final block becomes first without determining the earlier region's length. This never assigns Z a guessed index in the intermediate Array.

Within streaming modes, this availability and failure rule is fixed, not selected by a performance prototype. Target/authority/capacity validation still precedes publication, and no owning-path blocker may be bypassed. Prototypes must validate topology, snapshots, and bounded work while preserving this result; those implementation obligations do not authorize poisoning Z.

### 4.5 Earlier commands still to be issued

An earlier open producer may still issue `clear`, replacement, or arbitrary mutations. Its current prefix is not final merely because existing mappings have settled.

Release publication once relevant command issuance closes, or a sufficient remaining-effect guarantee proves independence. Path-only entry reservations do not supply that guarantee. Append-only production is one sufficient restriction, not the only one. Pending payloads and unrelated effects need not hold an otherwise final region.

### 4.6 Follow-up: open append regions in enter

A declared push-only mode on an entered reference supplies the append guarantee. Extend the existing entry capability to distinguish read-only, push-only, and unrestricted mutation; the compiler selects the mode and contained commands enforce it. This extends entry publication after captured-Array iteration, partial-layout integration, and the Chain policy/status foundation. It is planned behavior, not a capability of today's path-only `enter()` API.

#### Push-only capability

- Allow observations and controlled `push` mutations of the selected managed Array.
- Forbid replacement, deletion, repair, other mutations of that Array, and writes through the reference to existing elements or their descendants.
- Nested references to the same Array retain the restriction; descendant references permit observations, not mutation. A method named `push` on a nested Array is not a push to the selected Array.
- Reference arguments retain their capability through calls. Returning or copying a value through ordinary ownership keeps its existing isolation contract.

Compiler-generated failure publication remains permitted through the trusted boundary: it can publish a missing-output marker or a genuine path status as specified below. This is not an application mutation authorized by the push-only capability.

The declaration supplies the mutation restriction without a whole-program effect proof. It does not itself establish target validity, capacity, failure coverage, or append order. Preserve ordinary unused-reference behavior: setup need not consume an unavailable target solely to validate a reference the body never uses.

#### Overlapping references

Ordinary owner isolation protects aliases through other placements, and outside conflicting work keeps its position after the entry. References to the same placement inside one coordinated entry can instead share a private holder; they do not automatically COW from each other.

Entry overlap analysis must account for every reference that can replace the selected Array or mutate its existing contents, including a reference to an ancestor. An overlapping unrestricted reference prevents early prefix publication while that access remains possible. Preserve each reference's own capability and ordinary entry protection; merging references must not silently widen push-only authority.

#### Representation

With ordered activation and resolved preceding append counts, represent successful production as a fixed prefix followed by one open append region. Starting from `[A]`, once root and capacity prerequisites permit publication:

```text
After push(P):       [A, P]    + [open append region]
After push(B):       [A, P, B] + [open append region]
After issuance ends: [A, P, B]
```

P can remain a pending payload or become element poison without changing its position. Additional publishable appends raise the known length lower bound. Exact length and end remain pending unless separately proved. The existing shape queries and cursor handle this progress. This successful ordered case can use compact append storage.

#### Activation order and concurrency

The entry stage must represent later pushes while an earlier push-only entry can still append. Reserve the earlier contribution in command order and place later contributions after it; do not wait for its final count merely to retain later payloads. Their absolute indexes can remain pending. Reads and effects still wait for their actual predecessors and required validity facts. Payload settlement is not append-issuance closure.

```js
if (slowCondition) out.push("A");
out.push("B");
```

Representing both contributions as `[optional A] + [B]` guarantees at least one occurrence, subject to root/capacity prerequisites. It does not establish which occurrence occupies index 0, so sequential iteration waits there. Retaining B immediately still supports end-relative queries and future unordered delivery; B need not wait for the earlier contribution merely to exist in the layout.

Arrival order cannot assign destination indexes. Reuse the region/query model without hierarchical indexes or a second iterator. An open earlier contribution leaves later offsets unresolved, so the one-open-tail representation is not universal. If the condition fails before its push is issued, a streaming fallback inserts one missing-output Error marker in that reserved contribution, before B. Do not invent A. Actual issued contributions keep their own facts. Unordered delivery can emit B before its index is known only when its survival and payload source are guaranteed, including under fallback.

#### Entry views and closure

Inside the entry, reads capture the private command prefix: `a.length` must not wait for that same entry's future appends. A consumer logically after the entry captures its eventual post-entry version. Later outside mutations create successors; late entry work cannot overwrite them or change an earlier capture.

Expose the protected partial version through the common publication boundary while retaining the remaining entry reservation. Seal its open region when all relevant references, including nested entries, have stopped issuing appends. Reuse entry issuance and producer lifetimes; callback completion alone need not close nested issuers, and payload settlement need not delay sealing. Parent relationships, identity, effects, and last-use release retain their existing obligations.

#### Control-flow failure and path status

Use the [common missing-output contract](poison-policy-plan.md#6-missing-output-markers):

| Failure | Effect |
| --- | --- |
| A pushed payload rejects | Poison only its established value; preserve contribution count and iterator eligibility. |
| An independent observation or callback result fails | Fail that result; do not automatically poison entered data. |
| A condition or enumeration fails and required output may be missing | In streaming modes, retain issued work and add one structural Error element for the failed contribution. Complete mode fails the Array. |
| An actual scope/path or required publication prerequisite fails | Keep its specified failure scope and ordering. Genuine path poison blocks access in every mode. |
| Fatal runtime failure | Keep the existing fatal contract. |

Put the marker at the reserved contribution boundary, before later parent appends. With no tighter location facts, use the captured end; otherwise respect captured bounds and established positions. One failed contribution adds one marker, not one per hypothetical item. Positional uncertainty alone adds none: known inserted values remain represented.

The marker is ordinary Array storage with a structural failure role. Array methods move, overwrite, or remove it normally; iteration reports it as structural failure rather than a healthy occurrence. Do not add a zero-sized side channel or permanent error-history ledger. Preserve that role through capture and materialization without confusing ordinary payload Errors with markers.

Bounds and early publication include failure fallbacks. A success-only promise of two future outputs proves no two-element lower bound if failure could instead produce one marker. Close the contribution separately from callback-result delivery: nested issuers and already-issued effects retain their obligations.

Land capability enforcement and ordered compiler failure publication together. The compiler identifies affected targets and contributions; unrelated result failure does not become Array failure merely because it happened inside entry.

#### Capacity and path status

Every published insertion, including a possible marker, needs capacity at its logical position. A later push behind an unbounded earlier contribution may have to wait. A total upper bound can prove safety without exact counts; filtering a captured valid Array into an empty Array is bounded when the whole failure contract also fits that bound. Pre-existing output, multiple pushes per input, and independent failure markers require their own accounting.

Complete mode waits for required structural completion. Streaming modes can publish independent occurrences only if no remaining prerequisite can invalidate those publications. An unrestricted entry, uncertain capacity, or potential genuine whole-path blocker can therefore prevent early access; a safe append bound alone is not universal permission.

For a required append beyond Array capacity, no legal extra slot exists. Use the specified whole-Array failure boundary: ordinary Error in complete mode, genuine affected-path status in streaming modes. Do not introduce a poisoned-size state or bypass that status. This exceptional case cannot retract an earlier publication; discharge the relevant validity prerequisites first.

#### Integration order

| Concern | Required integration |
| --- | --- |
| Foundation | Captured iteration, partial layouts, and the selected mode/failure primitives precede open-entry streaming. |
| Publication | Structural membership and payload source are final; sequential delivery also needs the intended numeric position. |
| Failure | Distinguish payload Errors, positional fallback, uncertain survival, missing output, and genuine scope flags. |
| Capacity | Prove each insertion and possible fallback safe, using broader bounds where available. |
| Activation | Reserve earlier open contributions and retain later pushes before their indexes are known. |
| Closure | Seal after all relevant issuers close; retain issued data/effect obligations independently. |

Finalize entry encoding, overlap handling, contribution reservation, marker publication, and closure as implementation work. Use the [common policy contract](poison-policy-plan.md); compact diagnostic refinements are a later stage.

## 5. Composition and optimization

### 5.1 Add one operation at a time

Each operation maps its captured predecessor to a successor. This is the primary composition case; merging two arbitrary complex compositions is optional.

The method supplies semantic mapping and write rules. Common machinery applies available facts, retains unresolved dependencies, and publishes permitted regions. A single operation can still produce multiple blocks or require sorting/classification work.

Ready and pending controls use the same rules. Do not replay the original command or introduce a separate semantic implementation for pending inputs.

### 5.2 Remap composition

Reduce lookup depth and retained intermediate storage by replacing:

```text
destination → intermediate → source
```

with:

```text
destination → source
```

- Preserve selected values, holes, and captured sources. Composition can trim, split, reorder, duplicate, or remove blocks and omit unselected values.
- Start with resolved indexes/counts. Pending element values do not obstruct composition; unresolved coordinates can leave parts deferred.
- Preserve dependencies needed to finish deferred regions. Earlier captures and required command work may still need intermediate mappings.
- If operation mappings are retained as a sequence, they can be folded one by one. Flattened blocks instead describe pieces of one output, each read from its captured source.

#### Shared conditions in nested selections

Repeated selections that already share one internal captured control must preserve the branch conditions established by their enclosing selection. For example, when both fills below share that fact and normalize against the same unchanged length:

```js
a!.fill("X", s)
a!.fill("Y", s)
```

For position `j`, let `C` mean `j >= normalizedStart(s)`. The composed contents are:

```text
C ? Y : (C ? X : original[j])
              ->
C ? Y : original[j]
```

Inside the outer false branch, C is already false; X cannot survive there. Retain this condition while evaluating or simplifying nested selectors rather than treating repeated uses as independent alternatives. This uses captured condition identity, not enumeration or a general solver. Different captures or normalizations do not gain equivalence from equal variable names. Recovering shared provenance across separate lookup/Promise wrappers is not required; do not add an API or registry solely for that optimization. Resolved normalized arguments can be compared directly.

The proof concerns the successor's contents. Earlier captures, call results, prescribed writes, identity, and required completion work retain their contracts.

#### Example: splitting at block boundaries

```text
First mapping:    [{ index: 0, count: 3 }, { index: 10, count: 3 }]
Selected indexes: [0, 1, 2, 10, 11, 12]

Second mapping:   [{ index: 1, count: 4 }]
Combined mapping: [{ index: 1, count: 2 }, { index: 10, count: 2 }]
```

The second mapping selects intermediate positions 1–4. Composition splits at the crossed boundary; it need not expand four individual entries. Reversed blocks follow the same principle.

Worst-case fragmentation can produce one-element blocks. Compose selectively when reduced lookup depth justifies additional blocks and work; do not rebuild the entire mapping after every operation. This benefits retained layouts; current ordinary remaps are generally materialized per operation.

### 5.3 Local optimization

Reduce fragmentation and storage after construction, composition, **or index/count settlement**.

- Revisit affected blocks and neighbors.
- Merge adjacent blocks selecting contiguous positions from the same captured source with compatible traversal directions.
- Successive `push` calls may share an appended block. Reuse append storage where permitted; avoid repeatedly copying the accumulated tail.
- Preserve each call's returned length/result, writes, identity changes, validation/failure boundaries, captures, and required dependencies.

Optimization simplifies representation. It does not combine the semantic commands into one call.

## 6. Settlement and dependent layouts

### 6.1 Structural updates

Resolving an index/count may change other mappings: split, trim, remove, or shift unfinished blocks, change ranges, and release unused sources. Replacing a Promise field with a number is not sufficient.

For the [partial splice](#35-partial-splice), a following `a.slice(3)` yields:

| Resolved count | Following slice |
| --- | --- |
| 0 | `[C, D]` |
| 1 | `[D]` |
| 2 | `[]` |

Retain the source captures and deferred transformations needed to establish these outcomes. Composition must not erase them.

Install dependencies once. On settlement, small pure range calculations may run again for affected facts; commands, comparators, conversions, and host actions must not be replayed. Use existing guarded synchronous continuations and history-safe worklists, not a new execution-wide scheduler. A genuinely required Promise may remain pending indefinitely.

### 6.2 Derived updates versus queries

Detailed mapping calculation and caching retain these implementation choices:

| Policy | Benefit | Risk |
| --- | --- | --- |
| Update derived mappings on settlement | Subsequent reads can reuse the computed mapping. | One settlement may calculate many unused descendants. |
| Resolve derived layout through queries | Avoids computing unused derived layouts. | Repeated queries may revisit the same history without suitable sharing or caching. |

Maintain compact facts needed for active progress with [change-sensitive propagation](docs/remap-structure-variant-B.md#change-sensitive-propagation): recompute affected projections and stop when unchanged. The fixed-size probe found quadratic work when every dirty captured root woke its question. Detailed derived mappings can remain query-driven; optional cache policy is separate from required notifications. Neither policy creates a second authority for layout.

Required mutation completion, poison handling, publication, parent/counter maintenance, and last-use release must advance at their prescribed transitions, even when nobody later reads the result. Query-driven work may defer optional layout calculations, not these obligations. Waiting consumers must resume when their dependencies permit it. This boundary applies to both live destinations and retained captures; their existence alone does not decide how every derived calculation is stored or cached.

### 6.3 Waiting shape queries

A waiting query cannot always watch only one deferred region. With two adjacent regions each of width `[0, 1]`, either becoming definitely nonempty establishes that position `0` exists. Numeric lookup can return a pending source-selection result at that position. The ordered iterator still waits until its final occurrence and payload source are established; existence alone does not permit an item step.

Keep one existence registration per cursor on the captured layout's semantic shape summary, updating the next undecided index as the cursor advances. That summary includes region constraints and indexed growth, not just a length interval. Registration consumes current state; relevant failure changes must notify it even without narrower bounds. Optional cache dirtiness alone does not wake the cursor. Retain the required shape facts, not a payload-owning root solely to keep this registration alive; [consumed-region release](#advancing-consumers-release-consumed-regions) remains required.

Remove the registration at completion or early stop. Slot-value selection keeps its own dependencies. Subscribing each position's existence question to every candidate could otherwise create `O(K²)` registrations for `K` pending regions. Both storage variants use this rule; a tree root is not required.

Reuse shared control settlement and maintain affected uses incrementally. One root notification may wake several cursors; count waiter deliveries and query evaluation separately from summary propagation. Registration reuse alone does not bound that work. General widths and correlated totals require semantic shape facts, not only empty/nonempty counters.

## 7. Runtime obligations

### 7.1 Ownership and parent relationships

Captured sources remain protected against later writes. Overlapping copies always read the pre-write version:

```text
[A, B, C, D].copyWithin(1, 0, 3) → [A, A, B, C]
```

Reading destination index 1 after overwriting it would incorrectly copy the new A again.

Current backing-owner projection uses a single offset. Multiple, reversed, or repeated source blocks require generalized projection or ordinary placement publication; this is real integration work. Reusing a source slice twice creates two logical occurrences.

The [initial integration baseline](docs/array-layout-implementation-findings.md#publication-baseline) uses ordinary publication for changed established placements and retains the existing simple backing projection. Generalized multi-span projection needs a measured benefit before adding it. Layout-owned unplaced inputs use parent-derived preservation, so they force COW without invented keys or self-sustaining lease roots.

Never register a parent edge at an unknown destination index. Source captures/leases retain required values until publication or discard. Published placements must have complete logical `(parent, key)` relationships and required active counters before consumer callbacks. Sparse enumeration, aliases, cycles, copy-on-write, and retirement use the same logical boundary.

[Deferred-child integration](iterate-plan.md#deferred-children-and-graph-summaries) extends retention and aggregate queries beyond established numeric placements. Include only output-relevant dependencies in Error/Promise summaries; a privately retained child that may be discarded is not automatically an output member. Release obsolete layout uses on retirement without dropping earlier captures or retaining abandoned cycles.

### 7.2 Effects, identity, and completion

A determined layout does not by itself establish command completion.

Use [write-based identity](iterate-plan.md#identity-policy-and-implementation-cost): prescribed writes create identity, including equal-value writes; commands publishing nothing preserve it through the existing mechanism. Do not resolve old payloads merely to avoid a write or identity change. A different uniform policy would require an explicit revision, not a per-call fallback.

- Two reverses can restore the original arrangement while retaining prescribed writes, failures, and write-based identity changes.
- Same-value writes remain writes; an empty write interval can be a genuine no-op.
- Controlled self-copy is also a semantic no-op: when normalized copyWithin source/destination starts are proved identical, ignore end, preserve identity, and avoid mutation copying. Any provisional no-effect copy retains the original identity.
- Partial receiver publication is separate from the mutating call's result and completion. A splice may expose its prefix while its count still determines remaining effects and removed elements.
- Result-data production can outlive a completed invocation only when it no longer contributes to that invocation's required effects or result completion.

Keep effect decisions at the operation, independent of representation optimization.

#### Structural proofs survive materialization

Identical captured selectors or a repeated-source block can prove data independent without reading payloads. Preserve those required relationships through composition, copying, materialization, and settlement; representation must not change which arguments introduce poison. Retain compact source facts rather than old containers or complete command history solely for this proof.

Such a data proof does not erase prescribed writes. For example, sorting a known repetition of one captured payload needs no comparator to determine the mapping, but still performs its specified writes. Do not scan or await old values solely to discover equal contents; comparisons and value inspection required by the operation itself retain their ordinary dependencies.

### 7.3 Poison, validation, and repair

Pending inputs remain pending. Analysis not yet performed is not failure. Apply the declared bounded reductions before retaining a dependency; an [irrelevant argument](iterate-plan.md#universal-rule-irrelevant-arguments-never-introduce-poison) cannot introduce poison. Required comparisons and prescribed writes retain their own effects and completion; do not inspect old payloads merely to avoid identity changes.

Use one [mode/failure contract](poison-policy-plan.md) throughout layout queries, composition, and ordinary consumers:

- Complete mode exposes the Array only after its required structural outcome; structural failure normally produces ordinary root Error. The [mutating-sort exception](poison-policy-plan.md#sorting-requires-order) retains repairable Array-path status for required preparation/comparison failure in every mode.
- Sequential mode publishes the structurally fixed prefix. Surviving occurrences with lost positions receive repairable flags at deterministic fallback positions.
- Unordered mode preserves and can deliver guaranteed survivors despite positional failure; it adds no positional Error merely to report ordering that this mode does not require.
- Potential deletion or overwrite produces permanent structural poison. Possibly missing output gets one real marker for that failed contribution. Ordinary payload poison affects only the value.

For `[A,B,C,D].splice(2,failedCount,"X")`, streaming fallback is `[A,B,X,Error,Error]`. The removed-elements result fails independently. For `[A,B].splice(failedStart,0,X)`, fallback is `[A,B,X]`: sequential mode flags potentially misplaced occurrences; unordered mode adds neither positional flags nor a fourth marker.

Fallback is ordered, deterministic, and compatible with every published fact. A later push follows the failed operation's fallback; settlement order must not move it ahead. The [bounded splice analysis](docs/array-iteration-technical-analysis.md#5-a-bounded-splice-fallback) specifies a tested case: choose a compatible latest insertion boundary and minimum deletion count, then classify retained survivors and uncertain output slots. Integrate its bounds with the [method specification](docs/array-method-specification.md), including shared-control normalization and the [selected decisions](iterate-plan.md#13-selected-decisions), at their affected cutovers.

The [Error-query contract](poison-policy-plan.md#4-error-queries) includes structural markers, local poison, and own-path status at their captured scopes. Genuine flags block access in every mode. Healthy extraction does not inherit unrelated failures; it also cannot erase failures contained in the captured value.

[Repair](repair-simplification-plan.md) clears only selected own status on current data. It never clears Error values or markers, reconstructs deleted candidates, restores intended order, or rolls back. Repair of a sequential positional flag exposes the retained payload at its fallback index. Capacity and invalid explicit length use their declared whole-Array boundary; add no failed-size or failed-identity state.

### 7.4 Release at last use

- A later write, truncation, or replacement removes obsolete publication authority; late settlement cannot overwrite or regrow the successor.
- Earlier snapshots retain exactly the captures they still need.
- Drop discarded blocks and source references when no consumer or required command work needs them, even while unrelated inputs remain pending.
- Transfer unfinished independent result-data production to shared state before closing its invocation.
- A source's last access can precede result completion; capturing pending versions must not retain the former owner unnecessarily.

Garbage collection of a mapping/tree is not a substitute for these lifetime transitions.

#### Contents and shape have separate dependencies

A full fill can discard old-value dependencies while its repeated-value block still depends on the earlier length. Retain the required shape fact rather than old payloads solely to remember their count. Earlier captures and required command work retain their own uses.

#### Advancing consumers release consumed regions

A full snapshot can retain a whole layout root; a forward-only consumer should progressively release its consumed region once item handoff and its own remaining work no longer need it. Keep unread-range uses, pending selected values, and requested shape facts separately. Retaining a root solely for its length must not retain otherwise spent payload branches.

Use [restricted persistent captures](docs/array-layout-implementation-findings.md#2-use-sliced-ownership-not-a-producer-wide-range-registry) for slices and deferred producers. Shared nodes account for overlapping uses without a producer-wide range registry. Advance cursor uses at suitable span/leaf boundaries instead of rebuilding a persistent root for every item. Other captures, required command work, and the existing whole-backing retention allowance still apply. Verify a separately backed consumed prefix is released while an unrelated tail remains pending and no other owner needs the prefix.

A numeric lookup need not identify a consumed source subtree. For `[R(width 0..1), Z]`, position 0 exists immediately, but its lookup Promise may select R or Z. Sequential iteration waits for that selection. Keep conditional range uses until it is determined; requesting one numeric position does not consume every possible source candidate. Shape-only captures preserve shared constraints without retaining otherwise spent payloads.

## 8. Method families

The implementation plan owns the [method catalogue and semantic rules](iterate-plan.md#3-controlled-operation-rules). This layer provides a smaller set of shared representation operations:

| Representation operation | Consumers |
| --- | --- |
| Fixed-slot capture and point override | Ordinary reads/writes/deletion and pending payloads; no layout is needed merely because a value is pending. |
| Split, replace, and join counted blocks | Endpoint edits, splice, and fill; unresolved boundaries use deferred regions. |
| Capture source slices, repeat occurrences, and reverse traversal | slice, concat, copyWithin, and reversal. Each source refers to its required captured version. |
| Install an algorithm's resulting mapping or blocks | Sorting and flattening; tree navigation does not replace their comparisons or discovery. |
| Traverse the complete logical result | Export and native preparation through canonical assembly. |

Methods retain normalization, hole handling, validation, prescribed writes, identity, and completion decisions. Common layout machinery applies their mappings through one logical boundary; it does not infer those semantics from tree edits.

## 9. Storage and work bounds

### 9.1 Retain or materialize

Reuse existing Arrays and simple ArrayViews when they already represent the layout compactly. Retain block layouts when they avoid unnecessary intermediate copying. Materialize when a boundary requires it or measured costs justify it; do not flatten after every command.

#### Compact append path

A controlled push onto an ordinary Array or simple ArrayView with determined length uses the existing compact append machinery. Push alone must not promote that representation to a block layout. Pending or poisoned argument payloads occupy fixed placement versions; they do not require a tree or delay the new length. Target and capacity validation, ownership protection, and publication still apply.

Thus an append-only `results!.push(fetch(x))` loop starting from a compact known-shape Array requires no block allocation or tree traversal merely because fetch results are pending. Iteration captures final-slot Promises through the same property boundary. This is a specialization of the shared mapping/write rules, not a second method implementation.

Pushing onto an already fragmented layout need not flatten it first. Extend a compatible tail run through append storage, preserving earlier captured bounds. One uncertain region followed by such appends can stay `[R] + [X1 ... Xn]`; payload count alone must not create one remap entry per push.

#### Returning to compact storage

Simplification can move the current version back to an ordinary Array or simple ArrayView when its remaining mapping fits that representation. Reuse a compatible contiguous backing range without copying its payloads. Pending payloads alone do not prevent the change; preserve required shape and selector facts, overrides, and earlier captures.

Resolved coordinates do not guarantee one contiguous backing range. For several exact spans, retain the compact span sequence with an appendable tail, or materialize when required or justified by its cost. Do not force a full copy whenever the last control settles: alternating a small uncertain edit with appends could otherwise repeatedly copy a large Array. Retire spent deferred state, collapse redundant branches, and avoid rescanning a resolved prefix on later pushes. Tree-to-leaf collapse, span merging, and Array/View adoption use the same local simplification and lifetime rules.

#### Materialization invariants

Internal materialization can transfer pending placements without awaiting their payloads. Preserve sparse presence, point overrides, and the [compact selector relationships](#structural-proofs-survive-materialization) required by the dependency contract. Export/native boundaries still require their specified validation and completion.

A retained block layout and a materialized Array are representations of the same captured logical version, not competing authorities. Sharing unchanged structure across versions is persistence; it does not require a balanced tree or permanent storage of every command.

If unresolved logical facts remain, retain their layout/shape state; physical storage is not authoritative for them. Earlier captures and already-issued slot Promises keep their logical versions rather than switching to a later live Array. Release replaced layout uses only after equivalent state takes over.

### 9.2 Block storage and indexing

Use Variant B's flat leaves and balanced relative-count tree for retained layouts. Ordinary Arrays and simple ArrayViews remain the compact path; a short block sequence needs only one leaf. Unknown lengths can still prevent selecting the containing block even with a balanced index.

Blocks support deferred selection and sharing across multiple spans, including fully resolved spans. They are not limited to splice or unknown widths. Classified concat parts with uncertain lengths, slices, flat results, and conditional endpoint edits can also create multiple regions; their [result-root prerequisites](iterate-plan.md#validate-a-result-before-handing-out-its-root) still apply.

The storage documents describe the selected design and its comparison baseline:

- **Selected — [Variant B: persistent sequence](docs/remap-structure-variant-B.md):** a balanced tree with count measures, exclusive-node reuse, and path copying where captures share nodes.
- **Baseline — [Variant A: ordered flat sequence](docs/remap-structure-variant-A.md):** one output-order array with front/back boundary columns and shared settlement.

Implement and validate Variant B. Local structural sharing and relative counts motivate the selection; measure complete storage and runtime costs to refine its implementation. The comparison below records the tradeoffs without keeping the production variant undecided or requiring a parallel Variant A implementation.

Avoid:

- copying a growing list on every append;
- walking all predecessor mappings for every read;
- scanning the complete history after each settlement;
- retaining spent mappings behind an unrelated pending dependency.

A balanced sequence index does not automatically bound chains of deferred transformations. Local composition and merging help, but are not complexity proofs.

Notifying only when a fact changes is necessary but does not prove O(versions × Array size). Even facts that settle once can have a quadratic number of dependency edges or repeated queries. Length-interval narrowing does not bound selector, Error-membership, identity, or release work. The representation must bound these costs rather than count the dependency records it chose to allocate.

Bound work to consumed data, produced output, captured versions, and necessary unfinished work. Preserve sparse gaps symbolically; do not allocate entries for every possible hole. Legitimately retained snapshots can cost space; obsolete history cannot be justified by calling it a snapshot.

### 9.3 Candidate cost comparison

Variant B is selected. Variant A remains here to explain the cost tradeoffs against a flat representation; both describe the same semantic contract. [iterate-plan.md](iterate-plan.md) remains the authority for required behavior.

`B` is the number of indexed entries and `C` the conservative candidate-run length. Navigation costs assume usable cached bounds/measures and bounded-size tree leaves. They exclude nested deferred selection, refresh, replacement construction, and managed-graph work unless listed explicitly.

| Work | Variant A: flat sequence | Variant B: persistent sequence |
| --- | --- | --- |
| Capture existing layout storage | Constant-size storage reference; ordinary capture/protection work still applies | Constant-size root reference; ordinary capture/protection work still applies |
| Position lookup | `O(log B + C)` candidate discovery and scan | `O(log B + C)` balanced traversal and candidate scan |
| Known endpoint edit | Exact base adjustment is constant-size; entry movement, clipping, and folding may be linear | `O(log B)` navigation/update work; exclusive nodes are reused, shared paths copied; construction and affected-region work remain |
| Middle edit with determined boundaries | Potentially linear movement and cumulative-bound updates | `O(log B)` path work, plus replacement construction and affected-region work |
| Uncertain endpoint or middle edit | Conditional trimming/selection and potentially linear bound propagation | Deferred trim/slice; work depends on candidate and dependency regions |
| Exact-key point write | Existing placement override; no mandatory entry-array splice | Existing placement override; no mandatory tree edit |
| First logical edit of shared layout storage | Potentially `O(B)` copying and pending-use registration | Path copying, normally `O(log B)` structural nodes, plus new entries and uses |
| Edit of exclusively owned storage | Reuse storage; movement and bound updates remain | Reuse exclusive paths/leaves; allocate only for inserted data, splits, or required structural growth |
| Whole-layout reversal | Constant-size orientation/base-role change before folding and runtime effects | Constant-size orientation change before folding and runtime effects |
| One width refinement | Up to `O(B)` cumulative-column updates per divergent storage; constraints may reduce the affected region | Up to `O(log B)` structural summary updates for one isolated occurrence/version, stopping at unchanged projections; semantic and waiter work remain |
| Settlement and cached measures | Refine identical shared storage once; update affected columns and divergent uses | Propagate changed shared facts; charge optional cache refresh to dirtiness and initialization, with consumer work counted separately |
| Shared structure during refinement | Splitting/removing rows requires stable cursor/registration handles or their maintenance | Shared topology stays fixed; cursors follow forwarding and updated facts, with separate chain-compaction work |
| Release a capture/root | Drop one use; final storage release visits its entries and dependency uses | Visit nodes losing their final use, plus released entries and dependency uses |
| Managed-parent publication | Range re-keying or generalized backing projection; separate graph cost | Same obligation; path copying does not move parent keys automatically |
| Waiting queries and deferred history | Shared summaries and bounded propagation still require proof | Same obligation; balancing bounds navigation, not dependency history |

Candidate runs may contain false positives. Indexed growth must update the common semantic shape in both representations. Root release can also trigger managed-data retirement, beyond internal storage accounting.

A one-leaf tree can reuse flat storage machinery. Beyond leaf capacity, cumulative boundary columns in A and relative subtree counts in B produce different update and sharing costs. Repeated captures followed by conflicting structural edits can repeatedly copy A's entry storage, while B copies shared changed paths. Both reuse exclusive storage. The relevant sizes are entries, occurrences, and retained versions, not simply Array element count.

A avoids balancing, per-tree-node use counts, and orientation propagation through branches; it still needs storage and producer-use lifetime accounting. B's flat leaves limit small-layout overhead, but ready endpoint costs and the leaf-cache policy remain measurement questions. Parent keys, partial-use release, managed cycles, override folding, and deferred-history bounds are common work.

The [propagation probes](docs/array-layout-implementation-findings.md#4-propagate-changed-facts-not-dirty-notifications) select changed-summary notifications over dirty-root wakeups. The [structural refresh bound](docs/remap-structure-variant-B.md#structural-work-bound) still applies to optional lazy caches, but does not prove acceptable total history work. Count initialization, actual summary changes, waiter deliveries, repeated occurrences, and semantic-region work separately. Verify failure notifications without bound changes and progress without waking every retained query on unchanged facts.

## 10. Prototype and remaining decisions

### 10.1 Fixed architecture and implementation options

| Selected | To validate or choose |
| --- | --- |
| Variant B through the existing logical-property boundary | Balancing scheme, leaf capacity, and optional leaf indexes |
| Shared facts, published-occurrence capture, changed-summary notifications | Which detailed derivations to cache or calculate eagerly |
| One-operation composition and local optimization | Which compositions/merges save work under fragmentation |
| Existing versions, ownership, publication, and effects | When to retain blocks, publish placements, or materialize |
| Ordered numeric iteration and required endpoint relationships | Their bounded implementation with topology and lifetime obligations |

These are choices within one architecture. A prototype must not preserve separate ready/pending semantic engines or alternate failure policies.

The [implementation findings](docs/array-layout-implementation-findings.md) specify the chosen fact/content separation, sliced ownership, preservation-parent integration, publication baseline, and notification protocol. Their executable probes cover selected cases; the remaining integrated checks are explicit there.

#### Bounded dependency rules

Implement the [selected method specification](docs/array-method-specification.md), including symbolic/shared normalizers, bounded fallback, coupled copying, sorting/flattening, and occurrence roles. The method catalogue remains an inventory; the specification owns the reductions and failure rules, including the all-mode repairable flag for mutating-sort preparation/comparison failure, copying-sort root Error, and ordinary later publication-failure boundary. Apply the mode-dependent [copy-result boundary](iterate-plan.md#constructed-array-results) and [shared-control rule](iterate-plan.md#captured-control-identity-at-the-api-boundary). No new cross-read provenance API is required.

Include the [required capacity proofs](iterate-plan.md#required-capacity-proofs), not merely sound intervals. Preserve correlated totals such as splice(p,0,X) producing L+1. The oracle must distinguish safe publication, necessary waiting, definite overflow, and a failed required capacity prerequisite; cached bound precision cannot choose different failure coverage.

Use method-specific transfer rules over the common captured facts, with the specified range arithmetic, identical selectors, and shared-condition reductions. Reuse each region's source/control state; tree measures remain cached projections. Do not add a general constraint solver or a second expression interpreter just to derive bounds. Any required result the bounded evaluator cannot yet establish is a design gap to resolve, not permission to return extra poison or silently weaken the contract. Keep the oracle's required proof rules explicit too.

### 10.2 Acceptance workloads

1. Known layouts with pending payloads, including ready values after a pending one. Include append-only construction from a compact Array with ready, pending, and rejected payloads; verify no promotion to block storage or tree traversal, and capture final slots while payloads remain pending.
2. Partial splice followed by reads, bounded writes, slices, Error queries, and iteration.
3. Unknown-length regions followed by push/unshift/reverse and fixed-index access. Include one capacity-safe pending splice followed by a long push tail, with and without captures between pushes. Measure tail merging, layout entry count, shape-dependency depth, and release before and after the count settles or fails.
4. Repeated appends on exclusive and shared layouts, fixed-index edits, overlapping copies, and fragmented compositions.
5. Sparse Arrays with large holes, repeated source occurrences, aliases, and cycles.
6. Retained snapshots followed by writes, truncation, replacement, and retirement/re-entry. Include pending `a.length` captures before each push; retain only their needed shape facts and distinguish those from captures retaining layout storage.
7. Many pending operations on a small Array, including operations later proved to have no effect.
8. An indefinitely pending branch while unrelated work completes and releases sources. Include an iterator that has handed off a separately backed prefix, with its original Array replaced and no other prefix owner; unread tail state must not retain that spent prefix. Repeat with pending requested metadata and earlier snapshots that legitimately retain it.
9. Concat accumulation: first use pending part roots, where classification/capacity can hold the result root; then use classified partial Arrays with safe length bounds and unresolved widths, so many regions coexist in a valid layout. Check independent progress, retained captures, and bounded propagation without treating unclassified parts as published regions.
10. Return to compact storage after structural uncertainty resolves, including pending payloads and retained older versions. Alternate short uncertain edits with long append tails; reject policies that repeatedly flatten or rescan the accumulated Array merely to return to the compact path.

Compare ready controls, varied settlement order, rejection, and synchronous delivery. Verify early accessibility with controlled or never-settling inputs rather than timing-based sleeps. Successful native operations can be an oracle for layout; revised dependency-based failure behavior needs its own semantic model.

Build a small independent oracle that enumerates bounded legal controls and source selectors at every partial-settlement state, including failed controls retaining their domains. Check required availability, failure membership, validity, and write decisions as well as final values. Preserve the plan's [shared inputs and occurrences](iterate-plan.md#shared-inputs-and-occurrences); do not replace them with independently varying alternatives. Enumeration is test machinery, not the production evaluator, and need not require every mathematically possible proof beyond the specified rules.

Measure allocations, block/mapping visits, notifications, copied materialization, parent-index work, and retained sources separately from emitted output. Compare update policies and leaf/cache choices within Variant B. Passing a pure selector model is insufficient evidence for ownership, publication, poison, or work bounds.

Check active propagation against question-specific changed projections, including exact readiness separate from optional numeric-bound refinement. Verify multiple waiters sharing one root, retained exact-length queries, and mixed transforms on a fixed small graph. Verify sparse traversal and materialization with pending payloads, overrides, and retained captures; required selector proofs and emitted slot outcomes must survive storage changes.

The remaining production gates are reference-rule coverage, bounded propagation/retention, and topology/lifetime integration. The objective is one small mechanism with useful early publication, not a solver for every theoretically independent outcome.

### 10.3 First integration prototype

Validate Variant B at the hard representation boundary before shipping a method family: a pending-count splice, then push, reverse/at, and captured prefix queries. Include managed children, inherited poison, retained earlier versions, and both count fulfillment and rejection.

Verify source protection before numeric keys are known, conditional Error/Promise summaries, parent publication when keys become known, copy-on-write, and retirement of abandoned layouts. A selector-only model or shape-preserving example does not validate this integration. Keep production rollout order separate from this early prototype requirement.

### 10.4 Ready-input performance

Compare the new evaluator with the current implementation on ready inputs as well as pending ones. Measure normalization, query/block visits, allocation, and materialization for small ordinary Arrays, long appends, sparse ranges, and fragmented layouts. Report input/output size and retained versions separately. A ready fast path may specialize the shared rules; it must not become a second semantic implementation or change failure behavior.

### 10.5 Open append entry follow-up

After captured-layout and policy integration, test [push-only entries](#46-follow-up-open-append-regions-in-enter) with pending payloads, nested issuers, earlier unresolved branches, and later parent pushes. Cover inherited capability, forbidden descendant mutation, overlapping unrestricted references, private-prefix reads, final end detection, and closure.

Distinguish payload poison, independent result failure, positional fallback, missing-output markers, and genuine scope flags. Verify marker position before later parent appends, one marker per failed contribution, ordinary removal/replacement, and no marker for a represented but misplaced value. Complete mode waits for structure; sequential mode issues only the fixed prefix; unordered delivery later discovers all guaranteed survivors.

Exercise unknown exact length with safe total bounds, uncertain capacity, and failure fallbacks within those bounds. Query captured status independently of iterator consumption. Early consumer stop releases only its own uses and does not cancel shared production. Measure representation of later contributions behind earlier open regions separately from unavoidable capacity or authority waits.
