# Partial Array publication: two implementation approaches

## 1. Purpose and status

This document compares two ways to represent an Array whose final layout is only partly available:

- **Approach A — shared range mappings:** extend the existing Array storage, property versions, and ArrayViews with descriptions of unfinished regions.
- **Approach B — persistent segments:** represent the logical Array as a sequence of shared pieces that can be concatenated, sliced, and traversed in either direction.

Both must provide the same safe, ordered iteration. Both may conservatively wait when they cannot prove that a position is available. Neither may expose a provisional value or position that an earlier unfinished command could invalidate.

The current recommendation is **A, with a small end-relative query extension evaluated separately**. This is an architectural recommendation, not a completed implementation or a demonstrated performance result. B remains a candidate if its broader benefits justify the integration cost.

The implementation contract and unresolved failure decisions remain in [iterate-plan.md](iterate-plan.md). This comparison explains the mechanisms and tradeoffs without repeating the full method specification.

## 2. Runtime concepts needed for the comparison

### 2.1 A logical Array is more than its JavaScript storage

The runtime already separates an Array's logical contents from its physical backing:

| Concept | Meaning |
| --- | --- |
| **Placement** | A logical location such as Array index 2. A present slot has a value; a hole is absent even though its index is within length. |
| **Property version** | The captured state of one placement, including a pending value or a later settlement obligation. An earlier reader keeps its version when a later command writes that location. |
| **ArrayView** | An internal view over backing storage, currently using a start offset, logical length state, and owner-local overrides. |
| **Length bounds** | A guaranteed minimum length and possible maximum length. Exact length is available when the bounds agree. |
| **Layout mapping** | For each position in the destination Array (after the operation), identifies its origin position in the captured source Array (before the operation): **destination index → source index**. A destination can also be supplied directly by a new value or a hole. See the [example below](#example-reversing-an-array-with-a-pending-value). |
| **Data producer** | A Promise supplying a pending value, or the runtime computation that completes an unfinished layout. This is a descriptive term, not an additional producer object. See the [example below](#example-supplying-a-pending-value). |
| **Lease and copy-on-write** | Protection that lets earlier captures retain their logical values while later mutations proceed. Capturing does not necessarily copy the whole Array. |

The method generates the layout mapping; a generic algorithm applies it to the source to produce the destination.

#### Example: reversing an Array with a pending value

```text
Source (captured before reverse): [pendingA, "B", "C"]
Destination (after reverse):      ["C", "B", pendingA]
```

There is one captured source version. Every source index in this mapping refers to that same version:

| Destination index | Source index | Value |
| --- | --- | --- |
| 0 | 2 | `"C"` |
| 1 | 1 | `"B"` |
| 2 | 0 | `pendingA` |

The runtime knows where every element belongs without waiting for `pendingA`. It can describe the entire mapping with one rule: destination index `i` reads source index `2-i`. It does not need a separate mapping entry for every element. Later writes cannot change the captured source.

Source and destination describe logical states; they do not require two separate physical Arrays. Operations such as `concat` have several captured source Arrays, but each source is still fixed at the operation's input position. The mapping does not independently choose a historical version for each element.

For a more complex operation, part of the rule may remain unresolved. A splice with a pending deletion count can determine its unchanged prefix while leaving the source positions of its remaining elements undecided. Supporting such partial mappings is planned work.

#### Example: supplying a pending value

```text
source = [pendingA, "B"]
result = source.slice(0, 2)
```

Here, **the pending data is simply supplied by a Promise**, `pendingA`. The slice can return an Array immediately because its length and positions are known. Its first slot follows the captured pending value; when that value becomes `"A"`, readers can use it without running the slice again.

Existing property versions handle the destination: if a later command replaces `result[0]` with `"X"`, settlement still serves earlier captures without overwriting `"X"`. Calling this a data producer does not introduce another object around the Promise.

**An unfinished layout also needs code that uses the promised value.** Consider the planned partial splice:

```text
source = ["A", "B", "C", "D"]
source!.splice(2, pendingCount, "X")
```

The prefix `A,B,X` is determined. To complete the remainder, the runtime retains:

- `pendingCount`, the Promise supplying the deletion count.
- Captured source slots for `C` and `D`, plus the original length and splice bounds needed to calculate the result.
- A continuation: the code registered to run when the Promise settles. For example, count 1 selects `D` for destination index 3 and establishes length 4.

These are the concrete “inputs and callbacks.” They can be ordinary captured state and Promise-continuation code, using the runtime's existing mechanisms. The count Promise supplies a number; the continuation uses that number to finish the layout. “Data producer” is shorthand for this completion work, not a proposed new scheduling system. The splice's own result may remain pending until its required work finishes.

Ordinary reads, copies, queries, export, and iteration must use the same logical property boundary. An iterator must not inspect raw backing storage to bypass unfinished mutations.

### 2.2 What already exists

The runtime already provides:

- Captured length and `inRange(i)` questions, principally for uncertain indexed growth.
- Property versions that carry pending values without waiting for their payloads.
- ArrayViews, point overrides, source captures, and ownership protection.
- Controlled remaps that move captured placement references rather than resolving every element value.

It does **not** yet provide general partial layout publication through pending structural method arguments. Many intrinsic-backed methods still prepare their required arguments and exact length before invocation. The public managed iterator is also planned work.

Relevant implementation sources are [array-length.js](src/array-length.js), [array-view.js](src/array-view.js), [property-versions.js](src/property-versions.js), and [array-invocation.js](src/array-invocation.js). [ArrayView documentation](docs/array-view.md) describes the existing storage and ownership model.

## 3. The common prefix mechanism

### 3.1 Position certainty and value readiness are separate

For this captured Array:

```text
[pendingA, "B"]
```

both positions can be issued immediately:

```text
index 0 -> pendingA
index 1 -> "B"
```

The important guarantee is that these are the **final slots at the iterator's command position**. A later command creates another version and cannot rewrite what this iterator observes.

An earlier unfinished mutation is different. If it may change slot 0, the iterator must capture a promise for the final contents of slot 0, including that mutation. It cannot hand out the old element currently stored there and hope it stays put.

A hole inside length still counts as an Array iteration position and yields `undefined`. This does not make a hole equivalent to a present `undefined` placement for other operations.

### 3.2 Bounds establish a safe prefix

Suppose captured final length is somewhere between 3 and 5:

```text
indexes 0, 1, 2: definitely in range
indexes 3, 4:    not yet determined
index 5 onward: definitely out of range
```

Once root selection, authority, and publication prerequisites are satisfied, the iterator can issue positions 0–2 with their final-slot values or promises. It waits at position 3.

Bounds belong to a captured version. They may tighten as its dependencies settle. A later mutation can produce a different version with a smaller length; that does not retract the earlier iterator's prefix.

Both A and B use this mechanism. A more expressive representation may determine some values sooner, but a segment tree is not necessary to issue positions with pending values.

### 3.3 Settlement updates facts; it does not replay commands

The intended flow is:

1. Capture the command's inputs and install its successor dependencies once.
2. Compute available shape and layout facts.
3. Issue the currently guaranteed prefix.
4. Retain a question for the next undecided position.
5. When a relevant dependency settles, update the affected facts and resume from the saved cursor.

Re-evaluating a small, pure bounds calculation is acceptable. Re-running `splice`, invoking a comparator again, or scanning the entire command history after every settlement is not the intended implementation.

Already-issued item promises have their own dependencies. Their settlement need not wake or restart the iterator.

This cannot bypass an earlier producer that may still issue unrestricted mutations. If that producer could still clear the Array, no existing prefix is final. Once its relevant command issuance closes, unfinished payloads and captured regional dependencies can remain without forcing whole-Array completion.

## 4. Approach A: shared range mappings

### 4.1 What is stored

A keeps existing Array/ArrayView storage and property versions. It adds compact descriptions of regions whose contents are forwarded, replaced, or still being determined.

Conceptually, a captured version contains:

```text
shape facts
point overrides
range mappings
captured backing / source versions
```

A range mapping might say:

- Destination indexes 0–9 use the same indexes of a captured source.
- Destination indexes 10–19 use source indexes 20–29.
- A selected range contains one retained fill payload.
- A region's source selection depends on an unfinished control argument.

These are descriptions of data dependencies, not instructions to execute the mutation again. A single deferred region can serve many reads; we need not allocate a promise for every possible index in advance.

The exact indexing structure for these descriptions is still to be validated. A does not imply an ever-growing linked list of operations.

### 4.2 Example: partial splice

```text
a = ["A", "B", "C", "D"]
a!.splice(2, pendingCount, "X")
```

The normalized deletion count `d` is between 0 and 2. A can describe the successor as:

```text
length:        between 3 and 5
index 0:       captured source index 0 -> "A"
index 1:       captured source index 1 -> "B"
index 2:       inserted payload       -> "X"
index 3 onward: deferred remainder selected by d
```

The iterator can issue `A`, `B`, and `X` immediately. The splice's removed-elements result can still be pending.

When `d` settles, the same successor becomes:

| d | Resulting Array |
| --- | --- |
| 0 | `[A, B, X, C, D]` |
| 1 | `[A, B, X, D]` |
| 2 | `[A, B, X]` |

Only the unfinished facts advance. Previously issued positions remain unchanged.

### 4.3 Later writes override their own destinations

If a later command assigns `a[1] = "Y"`, its successor uses a new point version for index 1. The old splice producer must not replay its prefix and restore `B` when the count settles.

An earlier iterator still sees its captured `B`; a later reader sees `Y`. The existing version and publication-authority model provides the basis for this separation.

This is why A fits point assignment, deletion, and bounded `fill` well: these operations already have explicit destination coordinates and a natural place to install overrides.

### 4.4 Strengths and costs

**Strengths**

- Extends the current logical-property boundary and placement machinery.
- Gives ordinary reads and iteration the same partial data.
- Fits fixed-index writes, sparse presence, and local replacement.
- Can conservatively defer a difficult mapping without adding a general solver.

**Costs and risks**

- Deferred mappings can form long chains if each merely wraps its predecessor.
- Repeated reads can revisit the same history unless captures, normalization, and indexes prevent it.
- Superseded ranges must release their source uses while older snapshots retain theirs.
- A purely numeric mapping may wait for exact length even when an end-relative fact would answer the read.

A reduces the scope of the storage redesign. It does not eliminate the need to design and measure dependency propagation.

## 5. A possible extension to A: read from either end

This is a query capability, not a separate storage representation or public iterator API.

Instead of supporting only “read numeric position i,” a captured mapping can also answer “read offset r from the end.” Bounds still establish whether the selected position exists.

Some local rules are simple:

| Operation | Query rule |
| --- | --- |
| `reverse` | A front query becomes a back query on the captured predecessor, and vice versa. |
| `push` of k items | The last k offsets select inserted payloads; deeper back offsets select the predecessor at offset `r-k`. |
| `unshift` of k items | The first k offsets select inserted payloads; deeper front offsets select the predecessor at offset `r-k`. |

Other operations can conservatively wait when they cannot locate the requested range. We do not need a rule for every combination of methods.

### Example: pending splice, push, reverse

```text
a = ["A", "B"]
a!.splice(0, pendingCount)
a!.push("Z")
a!.reverse()
iterate a
```

Ordinary bounds alone give:

```text
after splice:  length in [0, 2]
after push:    length in [1, 3]
after reverse: length in [1, 3]
```

Therefore the baseline can issue position 0 with a promise for its final contents.

End-relative queries can additionally determine its value:

```text
first of reversed result
    -> last of pushed result
    -> "Z"
```

The absolute append index is never needed for that proof. We have not assigned `Z` a guessed index in the earlier Array; reverse has established its final position in the later Array.

This extension is promising, but not yet a production guarantee. Its interaction with poison, snapshots, graph indexing, source release, and long dependency chains must be validated. A local selector proof alone does not establish those properties.

## 6. Approach B: persistent segments

### 6.1 What “persistent” means

Here, persistent means that later versions share unchanged structure with earlier versions. It does not mean disk storage.

A logical Array is an ordered sequence of pieces. Possible pieces include:

| Piece | Contents |
| --- | --- |
| Captured source slice | A range of placements from an earlier version. |
| Payload run | One or more inserted values or promises. |
| Hole run | A range of absent placements. |
| Concatenation | Several pieces in a fixed order. |
| Deferred region | A piece whose layout or length still depends on unfinished work. |

Reverse changes traversal direction. It need not immediately copy or renumber every element.

The logical structure of a captured version is preserved. A shared producer can settle an unfinished piece, just as a captured promise can settle; a later command does not edit the earlier version's logical contents.

This is internal data structure. Public iteration still uses ordinary numeric indexes.

### 6.2 The same splice as segments

The splice from section 4 can be represented as:

```text
captured slice [A, B]
    + payload [X]
    + deferred tail: source slice starting at 2+d
```

The first two pieces have known length and contents. The tail's length is between 0 and 2.

This yields the same guaranteed prefix as A. Its main difference is that the ordering of pieces is explicitly represented rather than being recovered through destination mappings.

### 6.3 Why endpoints and reverse fit naturally

For the push/reverse example, the intermediate sequence is:

```text
[unknown-length region] + [Z]
```

Traversing it backward reaches `Z` first. The length of the earlier piece is irrelevant to that first value.

Appending, prepending, concatenating, and reversing are natural operations on this structure. This is B's strongest advantage.

### 6.4 Numeric indexes still need coordinates

Suppose the sequence is:

```text
S, with length between 1 and 3
    + [M, N]
```

Index 1 might be inside `S`, or it might be `M`. A fixed-index read or write cannot choose a piece from the minimum length alone.

The last value is definitely `N`, but that does not make every numeric position immediately selectable. B still needs bounds, deferred coordinate selection, and final-slot promises.

### 6.5 Middle edits and unresolved controls

For a known-range `fill`, B can retain the prefix and suffix and replace the middle piece. A point write can split a source slice around one replacement.

If the split coordinate is unknown, the split must itself be deferred. A general pending `splice`, `fill`, or `copyWithin` therefore still needs operation-specific dependency rules. A sequence of pieces does not remove this work.

A method's known shape facts must also survive. For example, `fill` preserves exact length even if its bounds are pending. Breaking its output into pieces with uncertain individual lengths must not lose that known total or require a solver to rediscover it.

### 6.6 Strengths and costs

**Strengths**

- Structural sharing is natural for concatenation and slicing.
- Known outer pieces remain accessible despite unknown interior lengths.
- Reversed traversal can expose a known suffix without knowing its absolute offset.
- Several operations can reuse a small set of sequence primitives.

**Costs and risks**

- Repeated edits can fragment the sequence into many pieces.
- Efficient numeric lookup may require a balanced index over pieces and their lengths.
- Unknown lengths can still prevent navigation to a numeric index.
- Balancing concatenations does not balance arbitrary chains of deferred transformations.
- Sharing one source in several places requires tracking each distinct occurrence.
- Using this as permanent Array storage broadens the changes to parent indexing, ownership, overlays, materialization, and retirement.

Small segment descriptions could also be used inside A's deferred producers. The larger architectural choice is whether to make a general persistent sequence the Array's permanent layout representation.

## 7. How important operations compare

| Operation or workload | A: shared mappings | B: persistent segments |
| --- | --- | --- |
| Known positions, pending values | Ordinary captured placement promises. | Pending payloads within known pieces. No prefix advantage over A. |
| Known-start splice, pending count | Known prefix/insertion, deferred remainder. | Known pieces followed by a deferred remainder. |
| Push, unshift, reverse | Local mappings; optional end-relative queries improve readiness. | Sequence boundaries and traversal direction give the same proofs naturally. |
| Point assignment, deletion, bounded fill | Fits existing overrides and range publication. | Requires split/replacement or an integrated override mechanism. |
| Overlapping copyWithin | Capture pre-write source versions, then map destinations. | Reuse slices of the pre-write version, never the live destination. |
| Slice and concat | Reuse captured ranges where suitable; defer unresolved offsets. | Strong structural fit, but source classification and result-root validation still apply. |
| Sort | Preserve known shape; wait for required comparisons for affected values. | A deferred sorted piece can serve the same role. A tree cannot prove comparison results. |
| Flat | Required classification, depth, cycle and capacity rules still apply. | Pieces help assembly after those facts are established; they do not remove validation barriers. |
| Full export or native receiver preparation | Consume required shape and placements, then assemble. | Same obligation; segment structure does not permit exporting only the healthy prefix. |

For example, overlapping copyWithin must preserve the original source:

```text
[A, B, C, D].copyWithin(1, 0, 3)
    -> [A, A, B, C]
```

A captures source positions 0–2 before destination writes. B retains a slice of the old version. Neither may read destination index 1 after overwriting it and accidentally copy the new `A` again.

## 8. Runtime obligations neither representation removes

### 8.1 Graph indexing and ownership

The runtime tracks logical `(parent, key)` relationships, including Array indexes. These support ownership, copy-on-write, Error summaries, and retirement.

Current ArrayView sharing projects backing positions through a single offset view. B can require several source slices, reversed slices, and repeated occurrences within one Array. Its projection into logical indexes is therefore more general.

For example, concatenating the same captured slice twice creates two sets of logical placements, even though the underlying data is shared. Registering only one occurrence would lose topology.

If a preceding piece has unknown length, a later object's numeric index may be unknown. Neither implementation may invent a parent edge at a guessed index. Captures or leases retain the required source until actual publication is possible. Once a placement is published, its relationships must be complete before consumers observe it.

A also needs new integration for partial regions. The difference is that it can publish known coordinates through existing placements instead of immediately generalizing all backing projections.

### 8.2 Writes and identity are separate from layout

Two reverses can restore the original arrangement:

```text
a!.reverse()
a!.reverse()
```

The representation may reuse the original layout afterward. That does not cancel any prescribed writes, failure boundaries, or write-based identity changes.

Both approaches need an explicit write/effect decision in addition to a description of resulting values. A simpler layout is not evidence that the commands were no-ops.

### 8.3 Poison is a semantic outcome, not a storage optimization

For the selected partial-splice semantics, a failed count leaves the specified independent `A,B,X` prefix usable while dependent length and remainder facts fail. Both representations must implement that same contract.

Three states must remain distinct:

- **Pending:** required input has not settled.
- **Conservatively unknown:** the analysis cannot yet prove an answer from the available facts.
- **Poisoned:** the specified result depends on a failed prerequisite.

These are distinctions for reasoning, not a new public value type. Conservatism limits early proofs; once the inputs required for normal evaluation are available, the operation must finish its normal computation. The first two states are not permission to invent an Error. Conversely, an owning-path poison cannot be bypassed by inspecting hidden backing data or taking an end-relative shortcut.

A stronger representation may prove an independence that a simpler one does not. If that changes Error presence, it is a semantic decision to settle and apply consistently, not an optional fast path. Storage eligibility or settlement order must not choose the failure result.

Capacity failure and unresolved write-effect decisions remain separately identified in [the implementation plan](iterate-plan.md#12-remaining-failed-effect-contract). Choosing A or B does not settle them. Repair remains limited by [its own specification](repair-simplification-plan.md); neither representation may reconstruct missing layout through repair.

### 8.4 Sources must be released at their last use

Shared structure is useful only while its retained inputs are needed.

- Replacing the current Array must detach old producers from that destination.
- Earlier snapshots keep their own required captures.
- A late settlement may complete an old capture, but must not overwrite a later version.
- Overwriting a deferred region must release obsolete source uses when no other consumer needs them.
- A completed call that returns a partial Array must transfer unfinished production to shared state rather than leave it dependent on a closed invocation.

These are lifetime and publication responsibilities. Garbage collection of a tree or mapping object does not establish them by itself.

## 9. Work bounds and failure modes

### 9.1 What to avoid in A

If each command adds a wrapper and each read walks every wrapper, a small Array can acquire expensive history despite having little data.

Likewise, if each settled argument scans every operation issued so far, N settlements can cause work proportional to `1 + 2 + ... + N`.

Needed protections include shared captures, normalization of resolved mappings, removal of superseded dependencies, and notifications limited to facts still being consumed. The exact mechanism needs a prototype; there is no established constant-time guarantee.

### 9.2 What to avoid in B

Copying an ever-longer flat segment list on every append can also produce quadratic work. A permanently skewed concatenation tree can make lookups history-sized.

A balanced structure can address those particular problems, but not every deferred transformation is a concatenation. Pending edits can still leave long chains above an otherwise balanced sequence.

Snapshots may legitimately retain old structure. The test is whether retention corresponds to live captured versions and necessary unfinished work, rather than obsolete wrapper chains or duplicated indexes.

### 9.3 Measure the same workloads

Compare the approaches with:

1. Ordinary known-layout Arrays containing pending values.
2. Partial splice followed by point reads, bounded writes, and iteration.
3. Endpoint operations and reverse around an unknown-length region.
4. Repeated fixed-index edits and overlapping copies.
5. Sparse Arrays with large holes.
6. Retained snapshots followed by current-owner replacement or truncation.
7. Many pending operations on a small Array, including operations later proved to have no effect.
8. One permanently pending branch while unrelated work settles and releases its inputs.

Count allocations, mapping/segment visits, notifications, retained captures, and actual emitted output separately. Faster prefix delivery is not a sufficient win if it requires unbounded history or persistent extra copies.

## 10. Recommendation and remaining decisions

### Recommended direction

Start with **A: shared range mappings behind the existing property boundary**. It addresses the required prefix behavior while limiting the storage redesign.

Evaluate end-relative queries as a small, general extension. They may recover useful endpoint/reverse concurrency without a permanent segment tree or operation-combination rules.

Use small shared pieces where they simplify the mapping implementation. Do not keep A and B as separate authoritative Array models with different behavior.

### When B could be preferable

B becomes more attractive if prototypes show that:

- Common concatenation, slicing, and remapping workloads otherwise require substantial copying.
- A accumulates special-case state that common sequence primitives would remove.
- Segment sharing improves those workloads without making indexed edits, topology, or lifetime handling disproportionately complex.

The push/reverse example alone is not enough to justify the larger change.

### What is established and what is not

| Established design direction | Still to validate or settle |
| --- | --- |
| One shared logical-property interface for all consumers. | Compact storage and indexes for deferred mappings. |
| Sound conservative bounds and captured final-slot promises. | Propagation and retention costs across long histories. |
| Incremental fact updates, without replaying commands. | Production integration of end-relative reads. |
| No provisional values or guessed positions. | Failure semantics of stronger composed-selector proofs. |
| Existing ownership, publication, and snapshot guarantees remain binding. | The remaining failed-effect contract in the implementation plan. |

The objective is a small common mechanism that makes useful progress, not a complete proof system for every theoretically deterministic result.

## 11. Ideas

Prototype candidates under the existing [publication contract](#3-the-common-prefix-mechanism) and [ownership, failure, and lifetime obligations](#8-runtime-obligations-neither-representation-removes).

### 11.1 Count per remap entry

Reduces mapping memory by representing consecutive source elements with one entry.

- Remap entries can represent captured source blocks as `{ index, count }`; omitted `count` means `1`.
- `abs(count)` is the number of elements; a negative count traverses backward from `index`. Example: `{ index: 5, count: -3 }` selects source indexes `5, 4, 3`.
- Signed counts support mixed directions after composition. Reversing a nonempty block moves `index` to its other end and flips `count`; whole-remap reversal also reverses block order.
- Distinct inserted values can share an internal backing Array through `{ source, index, count }`; splitting entries need not copy values. Repeated values, as in `fill`, need only one value and a repetition count. An Array-valued element remains one element.
- Block lists need runtime range operations: native Array methods would treat each block as one element. No compiler range analysis is required.

### 11.2 Promises for index and count, with optional bounds

Allows earlier publication of determined positions without waiting for every structural argument to resolve.

- `index` and `count` can be Promises when their determining arguments are unresolved; consume each only when the requested position or value depends on it.
- Promise fields and deferred regions driven by arguments can provide the same early publication; prototype which fits the existing machinery more simply.
- Optional inclusive bounds (`sourceIndexRange`, `countRange`) cover every possible normalized mapping value and narrow as dependencies settle. Derive them from captured shape and method semantics: on a length-10 Array, `splice(5, pendingCount)` deletes between zero and five elements. No prediction of the Promise's value is needed.
- Length bounds follow `abs(count)`: count bounds `[-4, -2]` give length bounds `[2, 4]`; `[-4, 2]` gives `[0, 4]`.
- Keep `destinationStartRange` separate: a minimum affected destination start of `5` leaves positions `0–4` unaffected, regardless of source traversal direction.

### 11.3 Remap composition

Can reduce lookup depth and mapping storage, and avoid intermediate Array materialization. This targets retained mappings; current ordinary remaps are generally materialized per operation.

- Primary case: fold one new operation's mapping into the previous captured mapping to form its successor. A general merger of two arbitrary compositions is optional.
- Compose destination → intermediate → source into destination → source, preserving selected values and holes.
- If a composition retains a sequence of operation mappings, fold them one by one. Flattened blocks instead describe pieces of one output; resolve each against its captured source rather than treating it as the next operation.
- Composition can trim, split, reorder, duplicate, or remove blocks and omit unselected values. Discard intermediate remaps only when no consumer or required command work needs them.
- Start with resolved indexes/counts; pending element values do not prevent composition. Defer regions whose coordinates remain unresolved.
- Split at crossed block boundaries rather than expand every element. Worst-case fragmentation produces one-element blocks, so compose selectively when reduced lookup depth justifies the extra blocks and work. Avoid rebuilding the whole mapping after every operation.
- Preserve each command's results, writes, identity changes, and failures, plus intermediate versions still in use.

### 11.4 Remap queries as the common publication interface

Determine publication from partial or composed mappings without maintaining a separate publishable-prefix model.

- Behind the shared logical-property boundary, ask whether a destination position is definitely in range, then capture its final value or value Promise. A pending source index need not block issuance of a known destination position; never expose provisional old contents.
- Answer from exact mappings, captured source facts, and optional bounds. Preserve known total length even when individual block counts remain pending. Composition can simplify queries but must preserve required dependencies and publication prerequisites.
- Example: a known block of three positions followed by an unknown-count block permits three positions immediately. Count bounds `[2, 4]` for the second block establish five guaranteed positions, even if their values remain pending.
- Resume iteration at its next undecided position when relevant facts change; avoid rescanning the complete mapping or maintaining iterator-specific availability facts.

### 11.5 Dependent structural updates

Resolving an index or count can split, trim, remove, or shift unfinished blocks in dependent remaps.

- Example: after `a!.splice(2, pendingCount, "X")` on `[A, B, C, D]`, `a.slice(3)` produces `[C, D]`, `[D]`, or `[]` when the count resolves to `0`, `1`, or `2`.
- Retain the source captures and deferred transformations needed to finish these updates. Composition must preserve unresolved dependencies.
- Re-evaluate small, pure range calculations for affected dependencies; do not replay commands or comparators, or scan the whole history per settlement. Queries can follow updated sources or use derived updates; avoid maintaining both redundantly.
- Published positions remain fixed for their captured version. Release discarded blocks when no other capture or consumer needs them.

### 11.6 Remap optimization

Reduces block count and storage whenever compatible regions become known.

- Apply after construction, composition, or index/count settlement; revisit affected blocks and their neighbors rather than the whole history.
- Merge adjacent blocks selecting contiguous positions from the same captured source with compatible traversal directions.
- Successive `push` calls can share one appended block. Reuse append storage where permitted; avoid repeatedly copying the accumulated tail.
- Preserve per-call results (including each push's length), write/identity effects, validation/failure boundaries, captured versions, and required dependencies.
