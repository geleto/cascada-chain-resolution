# Partial Array publication: queryable block layouts

## 1. Decision and status

Use **one queryable block layout integrated with the existing Array machinery**. Each captured Array version has one logical layout. Ordinary Arrays and simple ArrayViews remain compact representations; they do not require a block-list allocation.

The earlier alternatives were **A: extend existing storage with partial mappings** and **B: retain a persistent sequence of pieces**. The selected design combines A's existing property/version boundary with B's useful block structure. How blocks are stored, updated, and materialized are implementation choices within this architecture.

The shared architecture is selected; production implementation and work bounds are not yet validated. [iterate-plan.md](iterate-plan.md) owns the method contracts, iterator API, effect/failure rules, and rollout. [Data limitations](docs/data-limitations.md) remains authoritative for current production behavior. [Repair simplification](repair-simplification-plan.md) is a separate revision.

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

These descriptors are internal. Public iteration still uses ordinary numeric destination indexes.

Block sequences describe logical order, not a mandatory flat list of absolute destination indexes. A deferred region may retain a nested transformation such as reversal until it can be reduced. Lists, chunks, and indexed structures remain storage choices subject to the same queries and work bounds.

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

If a later command assigns `a[1] = "Y"`, its successor uses the new point version. Count settlement must not restore `B` there. An earlier capture still sees `B`.

## 4. Queries and publication

### 4.1 One query boundary

Behind the existing logical-property boundary, ask whether a destination position is definitely in range, then capture its final value or value Promise.

- Use exact mappings, captured source/shape facts, and optional bounds. Reuse the existing captured length/`inRange` facilities; do not create a separately authoritative prefix model.
- Reads, copies, searches, writes, Error queries, export, and iteration consume the same logical state. No consumer bypasses unfinished work through raw backing storage.
- Point overrides, including absence, mask older mappings according to the captured version. Never combine an old layout with later live overrides.
- A hole within length is an iteration position yielding `undefined`, while other consumers retain the distinction between absence and a present `undefined`.

### 4.2 Position certainty and value readiness

`[pendingA, "B"]` can issue both positions immediately. A known destination extent can also issue positions whose source indexes remain pending, using Promises for their final contents.

Those Promises include every earlier unfinished mutation that may select, overwrite, or delete the contents. Never publish the old stored value provisionally.

Bounds extend what queries can prove. A known three-position block followed by an unknown-count block permits three positions immediately. If the second block has count bounds `[2, 4]`, five positions are guaranteed even while their values remain pending.

For the partial splice's length bounds `[3, 5]`, indexes `0–2` are in range, `3–4` are undecided, and `5` onward are out of range. The bounds refine the captured version; a later mutation may create a shorter successor without retracting that capture.

### 4.3 Ordered progress

1. Establish target selection, authority, and required publication validation.
2. Capture the Array version and ask whether the next position is in range.
3. If known in range, capture its final slot and issue it; the value may be pending or poison.
4. If out of range, finish. If membership is pending, retain the question. If membership fails, report the structural failure.
5. Resume at that position when relevant facts change.

Already-issued value Promises have their own dependencies; their settlement need not restart the cursor. Required errors and completion retain the [iterator contract](iterate-plan.md#7-ordered-iterator-api).

This revision implements only ordered prefix delivery. The [future out-of-order iterator](iterate-plan.md#future-out-of-order-element-delivery) changes callback delivery and pacing over the same captured layout; it adds no notification or scheduling machinery to the current implementation. Payloads can already settle out of order.

A newly produced Array root must also pass its result validation. For example, `with(pendingIndex, value)` waits for index validity and may resolve to poison; a mapping cannot expose an Array root that might later be retracted.

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
a.at(-1)                 // "Z", even if pendingCount fails
a!.reverse()
iterate a
```

Length bounds progress through `[0, 2]`, `[1, 3]`, and `[1, 3]`. The appended value is last regardless of the deletion count. The negative-index read must return `"Z"` without waiting for that count; after reverse, position zero must likewise yield `"Z"`. Dependent length and other positions retain their pending/failed facts.

The selector reduction is:

```text
first of reversed result → last of appended result → "Z"
```

The known final block becomes first without determining the earlier region's length. This never assigns Z a guessed index in the intermediate Array.

This availability and failure rule is fixed, not selected by a performance prototype. Target/authority/capacity validation still precedes publication, and no owning-path blocker may be bypassed. Prototypes must validate topology, snapshots, and bounded work while preserving this result; those implementation obligations do not authorize poisoning Z.

### 4.5 Earlier commands still to be issued

An earlier open producer may still issue `clear`, replacement, or arbitrary mutations. Its current prefix is not final merely because existing mappings have settled.

Release publication once relevant command issuance closes, or a sufficient remaining-effect guarantee proves independence. Path-only entry reservations do not supply that guarantee. Append-only production is one sufficient restriction, not the only one. Pending payloads and unrelated effects need not hold an otherwise final region.

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

Two implementation policies remain to be tested:

| Policy | Benefit | Risk |
| --- | --- | --- |
| Update derived mappings on settlement | Subsequent reads can be simpler; obsolete blocks may be released promptly. | One settlement may propagate through many descendants. |
| Resolve derived layout through queries | Avoids computing unused derived layouts. | Repeated queries may revisit the same history or retain obsolete dependencies too long. |

Start with shared dependency state, notifications to active consumers, and queries for derived layout facts. Test eager updates where reuse justifies them. Cache useful derivations without maintaining two independently authoritative layouts.

Required mutation completion, poison handling, publication, parent/counter maintenance, and last-use release must advance at their prescribed transitions, even when nobody later reads the result. Query-driven work may defer optional layout calculations, not these obligations. Waiting consumers must resume when their dependencies permit it. This boundary applies to both live destinations and retained captures; their existence alone does not decide how every derived calculation is stored or cached.

## 7. Runtime obligations

### 7.1 Ownership and parent relationships

Captured sources remain protected against later writes. Overlapping copies always read the pre-write version:

```text
[A, B, C, D].copyWithin(1, 0, 3) → [A, A, B, C]
```

Reading destination index 1 after overwriting it would incorrectly copy the new A again.

Current backing-owner projection uses a single offset. Multiple, reversed, or repeated source blocks require generalized projection or ordinary placement publication; this is real integration work. Reusing a source slice twice creates two logical occurrences.

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

| State | Meaning |
| --- | --- |
| Pending | A required input has not settled. |
| Analysis incomplete | Internal work has not yet established the contract's answer; this is not a failure outcome. |
| Poisoned | The specified outcome depends on a failed prerequisite. |

Uncertainty is not an Error. Complete the specified reductions before deciding which inputs are required. A fact independent of an input under those rules must not wait for it, even if it never settles. An uncovered failure case is a specification gap to close before production, not permission for a representation to choose extra poison.

Poison follows semantic dependencies, including positions, shape, presence, and effects. [Irrelevant arguments never introduce poison](iterate-plan.md#universal-rule-irrelevant-arguments-never-introduce-poison): this applies to every argument and operation, including independent outcomes of operations with real effects. Array no-ops and searches are examples of that rule. No combinatorial search over hypothetical values is required.

Under the selected partial-splice contract, a failed count leaves `A/B/X` usable while dependent exact length and remainder questions fail. It does not invent a shortened healthy Array. An owning-path blocker forbids access through that path; backing data or endpoint queries cannot bypass it.

Optimizations must preserve the required availability and failure outcomes. A healthy fact published while P is pending must survive P failing; a fact required to survive P's failure cannot wait for P once its other prerequisites are ready. This concerns the fact itself, not the later outcome of a returned value Promise. Additional selector rules that change these dependencies require a common semantic decision. Root, authority, dispatch, and required boundary validation retain their contracts; opaque native calls retain their isolation/completion rules.

Capacity failure poisons the affected Array's owning path before any successor fact escapes; an eligible explicit-! repair exposes its retained pre-call state. Controlled self-copy creates no new poison, even with a failed end. These [effect rules](iterate-plan.md#12-required-effect-failures) require neither a special failed-size marker nor a failed-identity state. [Repair](repair-simplification-plan.md) only clears the selected own-path blocker originating from explicit `!`; it neither clears local data poison nor reconstructs a failed layout.

### 7.4 Release at last use

- A later write, truncation, or replacement removes obsolete publication authority; late settlement cannot overwrite or regrow the successor.
- Earlier snapshots retain exactly the captures they still need.
- Drop discarded blocks and source references when no consumer or required command work needs them, even while unrelated inputs remain pending.
- Transfer unfinished independent result-data production to shared state before closing its invocation.
- A source's last access can precede result completion; capturing pending versions must not retain the former owner unnecessarily.

Garbage collection of a mapping/tree is not a substitute for these lifetime transitions.

## 8. Method families

The [full method specification](iterate-plan.md#3-controlled-operation-rules) remains in the implementation plan. The representation must handle these cases through one logical boundary:

| Operation | Layout behavior and constraint |
| --- | --- |
| Known positions with pending values | Capture ordinary pending placements; no structural wait. |
| `push` / `unshift` | Append/prepend value blocks; preserve capacity validation and per-call length/effects. |
| `pop` / `shift` | Trim an endpoint; shape and removed-value readiness are separate. |
| `splice` | Preserve known prefix/insertion; defer dependent remainder and split coordinates. |
| `reverse` / `toReversed` | Reverse block order and traversal; preserve length. Dense-copy hole rules still apply. |
| Point assignment, deletion, `fill` | Integrate point overrides or range replacement; retain unaffected regions. Deletion may create a hole, not shorten the Array. Unknown boundaries remain deferred. |
| `copyWithin` | Identical normalized source/destination starts are a no-op with irrelevant end. Otherwise map captured pre-write source ranges; overlapping copies must not read new writes. |
| `slice` / `concat` | Reuse captured blocks, including multiple occurrences; classification and result-root validation remain required. |
| `sort` / `toSorted` | Preserve known shape; wait for required comparisons to determine affected values. A tree cannot prove comparison results. |
| `flat` | Assemble blocks after required classification, depth, cycle, and capacity decisions. |
| Full export / native preparation | Consume the required complete shape and graph and use canonical assembly; a healthy prefix is not a complete export. |

Generic mapping machinery centralizes layout handling. It does not remove each method's semantics or required algorithm.

## 9. Storage and work bounds

### 9.1 Retain or materialize

Reuse existing Arrays and simple ArrayViews when they already represent the layout compactly. Retain block layouts when they avoid unnecessary intermediate copying. Materialize when a boundary requires it or measured costs justify it; do not flatten after every command.

Internal materialization can transfer pending placements without awaiting their payloads. Export/native boundaries still require their specified completion.

A retained block layout and a materialized Array are representations of the same captured logical version, not competing authorities. Sharing unchanged structure across versions is persistence; it does not require a balanced tree or permanent storage of every command.

### 9.2 Block storage and indexing

Small block lists, chunked storage, and indexed structures are implementation options. Efficient numeric access may need an index over block extents; unknown lengths can still prevent selecting the containing block.

Avoid:

- copying a growing list on every append;
- walking all predecessor mappings for every read;
- scanning the complete history after each settlement;
- retaining spent mappings behind an unrelated pending dependency.

A balanced sequence index does not automatically bound chains of deferred transformations. Local composition and merging help, but are not complexity proofs.

Notifying only when a fact changes is necessary but does not prove O(versions × Array size). Even facts that settle once can have a quadratic number of dependency edges or repeated queries. Length-interval narrowing does not bound selector, Error-membership, identity, or release work. The representation must bound these costs rather than count the dependency records it chose to allocate.

Bound work to consumed data, produced output, captured versions, and necessary unfinished work. Preserve sparse gaps symbolically; do not allocate entries for every possible hole. Legitimately retained snapshots can cost space; obsolete history cannot be justified by calling it a snapshot.

## 10. Prototype and remaining decisions

### 10.1 Fixed architecture and implementation options

| Selected | To validate or choose |
| --- | --- |
| One captured layout through the existing logical-property boundary | Block storage and indexing structure |
| Shared facts, conservative bounds, final-slot capture | Update derived layouts on settlement versus through queries |
| One-operation composition and local optimization | Which compositions/merges save work under fragmentation |
| Existing versions, ownership, publication, and effects | When to retain blocks, publish placements, or materialize |
| Ordered numeric iteration and required endpoint relationships | Their bounded implementation with topology and lifetime obligations |

These are choices within one architecture. A prototype must not preserve separate ready/pending semantic engines or alternate failure policies.

### 10.2 Acceptance workloads

1. Known layouts with pending payloads, including ready values after a pending one.
2. Partial splice followed by reads, bounded writes, slices, Error queries, and iteration.
3. Unknown-length regions followed by push/unshift/reverse and fixed-index access.
4. Repeated appends, fixed-index edits, overlapping copies, and fragmented compositions.
5. Sparse Arrays with large holes, repeated source occurrences, aliases, and cycles.
6. Retained snapshots followed by writes, truncation, replacement, and retirement/re-entry.
7. Many pending operations on a small Array, including operations later proved to have no effect.
8. An indefinitely pending branch while unrelated work completes and releases sources.

Compare ready controls, varied settlement order, rejection, and synchronous delivery. Verify early accessibility with controlled or never-settling inputs rather than timing-based sleeps. Successful native operations can be an oracle for layout; revised dependency-based failure behavior needs its own semantic model.

Build a small independent oracle that enumerates bounded legal controls and source selectors at every partial-settlement state, including failed controls retaining their domains. Check required availability, failure membership, validity, and write decisions as well as final values. Preserve the plan's [shared inputs and occurrences](iterate-plan.md#shared-inputs-and-occurrences); do not replace them with independently varying alternatives. Enumeration is test machinery, not the production evaluator, and need not require every mathematically possible proof beyond the specified rules.

Measure allocations, block/mapping visits, notifications, copied materialization, parent-index work, and retained sources separately from emitted output. Include both update policies and storage choices in these workloads. Passing a pure selector model is insufficient evidence for ownership, publication, poison, or work bounds.

The remaining production gates are reference-rule coverage, bounded propagation/retention, and topology/lifetime integration. The objective is one small mechanism with useful early publication, not a solver for every theoretically independent outcome.

### 10.3 First integration prototype

Exercise the hard representation boundary before selecting storage or shipping a method family: a pending-count splice, then push, reverse/at, and captured prefix queries. Include managed children, inherited poison, retained earlier versions, and both count fulfillment and rejection.

Verify source protection before numeric keys are known, conditional Error/Promise summaries, parent publication when keys become known, copy-on-write, and retirement of abandoned layouts. A selector-only model or shape-preserving example does not validate this integration. Keep production rollout order separate from this early prototype requirement.

### 10.4 Ready-input performance

Compare the new evaluator with the current implementation on ready inputs as well as pending ones. Measure normalization, query/block visits, allocation, and materialization for small ordinary Arrays, long appends, sparse ranges, and fragmented layouts. Report input/output size and retained versions separately. A ready fast path may specialize the shared rules; it must not become a second semantic implementation or change failure behavior.
