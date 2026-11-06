# Remap structure, variant A: ordered flat sequence

## Purpose

This is the flat-sequence comparison baseline for the [queryable block layout](../array-layout-approaches.md). The [persistent-sequence variant B](remap-structure-variant-B.md) is selected for implementation. Both follow [iterate-plan.md](../iterate-plan.md).

Methods generate mappings from captured source versions to a destination. The remap structure composes those mappings and answers which destination positions and contents are determined. Reads, searches, copies, Error queries, and iteration use the same facts.

Both variants follow the shared [query and publication rules](../array-layout-approaches.md#4-queries-and-publication), [settlement rules](../array-layout-approaches.md#6-settlement-and-dependent-layouts), and [materialization rules](../array-layout-approaches.md#91-retain-or-materialize).

Ordinary Arrays and simple ArrayViews keep their compact representations; allocate an entry sequence when the layout needs it.

## One sequence, two directions

The **remap structure** represents one captured Array layout. A **remap entry** describes a contiguous piece of its output, possibly with unresolved extent or contents.

Keep entries in one array in **logical output order**, with front-boundary and back-boundary columns, two base offsets, and an orientation. Back traversal reads the same sequence in reverse. Separate sorted containers and linking tokens are unnecessary.

Entry order does not depend on resolved numeric positions. In `R + M`, an uncertain remainder `R` precedes the appended `M`, even when both minimum front boundaries are zero. If a region's internal order is unresolved, keep that uncertainty inside a deferred entry.

Entries describe composed output. Their possible position ranges can overlap, but in each legal outcome their actual spans are consecutive and disjoint. Earlier writes are captured inside selectors, not retained as competing output layers.

## Entry contents

An entry retains:

- Its width or width rule, including exact counts, bounds, and required relationships to shared controls.
- Its contents: a captured source span, inserted values, a repeated value, holes, or a deferred selection rule.
- Derived front/back boundary bounds used for lookup.

A deferred selection rule obtains final contents from captured inputs as control facts settle. It does not rerun the original command, coercion, or callback. Failed controls retain their bounds and causal poison.

Source coordinates are separate from destination coordinates. Source spans retain their captured version, offset, `fromEnd` flag, and traversal direction, following the [block selector convention](../array-layout-approaches.md#31-counted-source-blocks). Inserted values can share an Array backing; repetition and holes need no per-position allocation.

## Boundary coordinates

For a destination span `[start, end)` in an Array of length `L`:

```text
front boundary = start
back boundary  = L - end
width          = end - start
```

The back boundary counts positions after the span. An appended `"Z"` can have back boundary `0` and width `1` while its front boundary remains unknown. Preserve that known width instead of trying to recover it by subtracting unresolved boundaries. Prepending has the symmetric property.

An entry's front boundary is the total width before it; its back boundary is the total width after it. These relationships do not require exact length before an end-relative query can succeed.

## Unresolved boundaries and order

Represent an unresolved boundary by conservative bounds. Compute them cumulatively from entry widths and shared shape constraints, maintaining monotonicity in each traversal direction. For example:

```text
minFront(next) >= minFront(current) + minWidth(current)
```

Maximum ends must also be monotone. Tightening one bound updates any dependent bounds needed to preserve these relationships. The entries stay in output order; they are never reordered by a provisional numeric key.

These columns cache cumulative widths. One middle width change can affect all following front bounds and all preceding back bounds: up to `O(B)` row work per divergent storage for `B` entries. Shared constraints or unchanged summaries may stop propagation sooner. A partial-sum index could reduce this cost, but supporting insertion and version sharing would add hierarchical machinery approaching the tree candidate.

An unresolved entry stays in the sequence. A lower bound of zero is valid only where preceding widths permit it: in `[A,B] + R + [Z]`, `Z` starts no earlier than position `2`, even if `R` is unknown. Earlier uncertainty remains confined to its captured extent through later growth.

Boundary ranges describe possible positions, not definite membership or contents. A block can certainly exist without a known numeric position, and a pending overwrite can select no positions without making its captured output disappear.

Either boundary column may have an [unknown upper bound](../array-layout-approaches.md#unknown-upper-bounds); retain its known lower bound and the relationships to entry widths.

## Shape is a shared fact

Extend the existing captured-shape machinery to cover subtraction, truncation, shifts, and failed layout, in addition to indexed growth.

The authoritative facts are the captured controls and method-defined relationships governing region widths and shape. Entry widths reference those facts; length, `inRange(index)`, and boundary columns derive from them. Cached intervals are approximations, not independent authorities.

```js
a = ["A", "B", "C", "D"]
a!.splice(p, 0, "X")
```

The resulting `a.length` is exactly `5`. The uncertain prefix and suffix still total four. Preserve that relationship rather than adding their independent bounds and losing the known total.

Retain shared control identity and the required selector relationships through composition and materialization. Use the [shared-input rules](../iterate-plan.md#shared-inputs-and-occurrences), without introducing a general symbolic solver.

Nested selections also preserve branch conditions already established over the same control; see the [shared-condition example](../array-layout-approaches.md#shared-conditions-in-nested-selections). Boundary intervals alone cannot eliminate contradictory alternatives.

## Conditional overwrites

A pending-bound overwrite preserves its captured shape. Its entry selects contents within that extent rather than overlapping predecessor entries as another write layer.

For a known four-position Array under `fill("X", s)`, the output has four fixed positions:

```text
position j -> X if j >= normalized s, otherwise capturedSource[j]
```

The predecessor fragments are inputs to this selector. A fill selecting nothing simply forwards their contents. When the input shape is itself pending, the overwrite preserves that shape uncertainty.

Keep proven unaffected prefixes and suffixes separate; one conditional entry need cover only the uncertain region. A later write replaces part of this result, while a later fill captures that write as part of its predecessor.

## Composition and command order

Use **span replacement** as the common structural edit. Insertion replaces an empty span; removal inserts no entries; overwrite preserves the span's length. Indexed property deletion instead creates a hole without shifting later positions.

Install effects and dependencies before suspension. Composition can split, clip, remove, or move entries. If a boundary is unresolved, retain the conditional selection and the predecessor fragments it still needs.

```js
a!.fill("X", p)
a[0] = "Y"
```

The later assignment masks position `0` of the conditional fill. Resolving `p` cannot overwrite `Y`. With the commands reversed, position `0` remains dependent on `p`. The composed selections preserve issuance order independently of settlement order.

Apply one operation at a time. `copyWithin` selects the captured pre-write source, including overlapping ranges. Split spans at intersection boundaries; do not expand them into individual positions merely to compose them.

## Point writes and overrides

Exact-key assignments and deletions use existing placement-version overrides over the captured layout. They do not require splicing the entry array for every write. An absent override masks older presence as well as older values.

Every consumer uses the selected version's overrides first. A historical layout must never see later live overrides. Indexed growth still uses the common shape/publication transition; dynamic keys retain their required selection dependencies.

Before an edit changes contents, coordinates, or source selection, include the relevant overrides in its captured input. The baseline folds them into spans for the affected source region, preserving pending placement versions without awaiting their payloads. Remove folded overrides from the successor's override view so an earlier point write cannot mask a later fill or copy. Earlier captures retain their own view; unaffected overrides may remain when their positions and contents remain valid.

Batch folding over relevant keys and entries, rather than inserting one split into the array for each override. Repeated writes alone must not create quadratic entry-array movement. Folding, captured-version protection, and graph maintenance remain measurable costs.

## Endpoint edits and base offsets

An effective boundary is `stored boundary + base`. Bases contain **exact numeric offsets only**. Store new boundary bounds relative to the current base.

For surviving entries, a known endpoint edit changes offsets as follows:

| Edit | Front base | Back base |
| --- | --- | --- |
| Prepend `k` positions | `+k` | unchanged |
| Remove first `k` positions | `-k` | unchanged |
| Append `k` positions | unchanged | `+k` |
| Remove last `k` positions | unchanged | `-k` |

Affected entries still require insertion, clipping, or removal. Base changes save coordinate rewrites, not all edit or graph work.

An unresolved shift stays in the width/selection rules. For example, `pop` on a possibly empty Array removes zero or one position; in `[A,B] + R`, it may trim `R` or remove `B`. Retain conditional endpoint trimming and recompute affected cumulative bounds. Do not put a Promise in the base or wait for exact length when an endpoint selector already answers the question.

Earlier uncertainty stays confined to its captured input:

```js
a = ["A", "B", "C"]
a!.fill("X", pendingStart, pendingEnd)
a!.push("Z")
```

The fill still covers only the original three positions. `Z` is independent at back offset `0`; an earlier empty extent likewise stays empty after growth.

## Middle edits

A middle insertion shifts front coordinates of following pieces and back coordinates of preceding pieces. Removal does the reverse. Split crossing entries, splice the entry array, and update affected cumulative bounds and selectors.

Two global bases cannot represent a shift affecting only part of the layout. An unresolved edit retains its relationships so settlement updates every dependent piece, not only the original entry. Entry order remains the logical output order.

Array movement and bound updates can require linear work. This is an explicit cost of the flat representation, including uncertain endpoint trimming when it affects many entries.

## Reversal

Whole-layout reversal changes the version's orientation, exchanging the roles of the front and back columns and bases. Traverse the entry array in the opposite direction and reverse traversal inside each multi-position entry.

Interpret deferred selectors through that orientation without modifying shared source descriptors. Pending facts still describe the same captured source. Point overrides must participate in the reversal through the same capture/folding rules.

## Queries and publication

Queries evaluate shape, membership, selection, or values through the common logical-property boundary, including overrides.

Apply the common [sparse traversal rules](../array-layout-approaches.md#sparse-presence-and-traversal); boundary columns do not establish own-property presence.

With maintained monotone bounds, find the candidate run for front position `i` using two searches:

1. Find the first entry whose maximum end is greater than `i`.
2. Find the first entry whose minimum start is greater than `i`; this ends the run.

An entry ends at the next entry's front boundary, or at total length for the last entry. Back lookup is symmetric. Candidate discovery and scanning cost `O(log B + C)` for `B` entries and `C` candidates, excluding bound refresh and selector evaluation.

Conservative bounds can admit false candidates, especially where controls are correlated. Check the retained selection rules; overlapping bounds do not mean competing writes. Exact disjoint spans normally yield one candidate.

Keep position, membership, and value availability separate. For example:

```js
a = ["A", "B"]
a!.splice(0, p1)
a!.push("M", "C")
a!.splice(-1, p2)
```

With normalized counts `p1` in `[0, 2]` and `p2` in `[0, 1]`, `M` is always present. Its front index lies in `[0, 2]`, and its back index in `[0, 1]`. `includes("M")` can succeed without inventing a numeric index for streaming.

Ordered iteration issues the structurally published prefix: membership, intended position, and final payload source must be established. The payload itself can remain pending or ordinary poison. A pending-bound fill does not authorize four steps merely because length is four; unresolved source selection remains a structural prerequisite. Preserve cursor progress without rescanning issued positions. See the [common publication rules](../array-layout-approaches.md#42-position-certainty-and-value-readiness).

A future iterator delivers guaranteed surviving occurrences before their numeric indexes are known, carrying index futures as specified in the [iteration plan](../iterate-plan.md#future-out-of-order-element-delivery). Numeric queries remain useful, but occurrence discovery and delivery require their own final-phase integration over the same layout.

## Captured versions

A capture retains the entry storage, bases, orientation, shape facts, and its point-override view. Later commands produce a successor logical version; exclusively owned storage can be reused.

Share unchanged entry storage and source descriptors. Before a later logical edit changes shared storage, copy that storage and the changed records. Keep version-specific overrides and coordinate interpretation isolated from earlier captures.

Capture itself need not copy the array. A conflicting edit can copy `O(B)` storage for `B` entries. That copy also registers its pending entry uses with their shared producers. Producers retain their existing control subscriptions; an unchanged shared storage needs no duplicate registrations for each capture. Release a storage's registrations when its last use ends.

A workload retaining a capture before each structural edit can repeat that copy and registration cost on every iteration. Capturing once for an ordinary iterator does not by itself imply a new full copy on every body command; the cost follows actual retained sharing and edits to entry storage.

Pending reads can retain old facts too: reading `a.length` before each push must preserve each earlier length. If those questions retain entry storage, they cause sharing; a shape-only capture retaining independent facts need not. Include this workload without requiring retention of payloads or storage unnecessary to the question.

Shared storage must represent the same captured mapping in canonical coordinates; equal current numeric bounds alone do not establish this. Different bases and orientations may share it only when they consistently interpret that mapping.

## Settlement and shared refinement

Settlement refines the same captured fact for every use. Update shared entry storage once in place when all sharers use that mapping. A Promise settling does not itself require copy-on-write.

Divergent storage copies receive their own derived updates through the registrations established at copying. Those updates may split, trim, remove, or refine entries and change subsequent boundary bounds. They never apply a later logical edit to an earlier capture.

Splitting or removing rows can invalidate cursor offsets and registration locations in shared storage. Keep logical positions or stable selection handles, or update affected handles within the transition; raw array offsets are not durable identities. This is distinct from B's stable topology and forwarding-chain problem.

Within a captured version, refinement only narrows possibilities and cannot revoke a published slot or value. Complete required publication, graph bookkeeping, and release before exposing the resulting callbacks.

Refresh affected uses rather than replaying commands or rescanning complete history. Optional derivations may remain lazy while bounds stay conservative and monotone; required work cannot depend on a later read happening. Use existing guarded continuations and synchronous worklists.

## Waiting queries and shared summaries

Use the shared [waiting-shape-query protocol](../array-layout-approaches.md#63-waiting-shape-queries): one existence registration per cursor on its captured semantic shape, separate from slot-value dependencies. In A, per-storage producer registrations propagate relevant count and failure changes to that summary. Boundary-column refinement and row changes must preserve the captured question and its progress.

## Failure

Apply the common [mode and fallback contract](../poison-policy-plan.md), including its [sort exception](../poison-policy-plan.md#sorting-requires-order). Complete mode waits for the required structural outcome and normally produces whole-Array Error on failure; mutating-sort preparation/comparison failure retains repairable own status in every mode. Streaming modes retain independent facts and use the specified fallback layout; the representation cannot choose extra poison or an empty extent merely to simplify storage.

Sequential mode flags surviving occurrences whose intended positions are lost. Unordered mode keeps those occurrences usable without positional flags or an extra marker. Potentially deleted or overwritten occurrences become permanent structural poison; possibly missing output gets one real Error marker per failed contribution. Ordinary payload rejection remains value poison only.

Fallback must preserve every established bound, occurrence, and publication and compose with later commands in issuance order. Represent markers as ordinary entries and positional status at its retained occurrence; preserve their structural role through captures and materialization. Genuine path flags block access in every mode. Repair clears only own status, exposing retained payload at the fallback position; it never repairs Error data or reconstructs deleted candidates.

Counts alone do not summarize Error membership. Pending selections retain only output-relevant candidate dependencies; discarded alternatives are not output members. Use the [deferred-child and graph-summary rules](../iterate-plan.md#deferred-children-and-graph-summaries). Keep no separate zero-width failure channel or error-history ledger.

## Ownership, parent keys, and release

Use existing captures, leases, parent placements, and retirement. Retain required source captures until publication or discard; never register a guessed numeric parent key. Complete real parent relationships and active counters before consumer callbacks.

Changing a base does not automatically move published managed children. Direct `(parent, numericKey)` relationships may need re-keying across the affected range. Generalized backing projection can derive keys for shifted, reversed, or repeated source occurrences, but requires maintained source-to-owner relationships. Follow the [ownership integration](../array-layout-approaches.md#71-ownership-and-parent-relationships) and measure it separately from layout edits.

Removing one version releases its uses, not those of other captures. Release obsolete selectors, registrations, and sources at last use, even while unrelated controls remain pending. Internal references must not keep abandoned layouts or cycles alive.

Discarding contents can still leave a [shape dependency](../array-layout-approaches.md#contents-and-shape-have-separate-dependencies); retain that fact separately from discarded payloads.

Use the common [deferred-child and graph-summary rules](../iterate-plan.md#deferred-children-and-graph-summaries); boundary columns alone do not summarize conditional Error or Promise membership.

## Local simplification

After edits or settlement, remove empty entries and merge adjacent compatible source spans, inserted runs, repetitions, or holes. Preserve source identity, direction, control relationships, and sparse presence.

Simplify composed output and spent selection history instead of retaining an entry per completed command. Preserve required structural proofs through materialization. Layout simplification cannot cancel issued writes, command identity changes, results, or completion obligations.

## Comparison and validation

The flat sequence provides compact storage, explicit output order, and symmetric front/back access. Exact base changes are cheap coordinate bookkeeping; complete operations retain copying, folding, propagation, and graph costs.

The [shared cost comparison](../array-layout-approaches.md#93-candidate-cost-comparison) uses the same rows and exclusions for both candidates, including uncertain trimming, root release, and managed-parent work.

Compare with the persistent sequence using the same [acceptance workloads](../array-layout-approaches.md#102-acceptance-workloads). Include equal lower-bound ties, conditional fills, uncertain pop/shift, repeated point writes followed by structural edits, interleaved captures and settlement, and partial splice followed by append/reverse. Exercise managed children, repeated sources, failure, and release while another control never settles.

Measure entry visits, bound updates, copying, registrations, notifications, parent maintenance, and retained sources separately from output. Correct captures and conservative bounds are specified here; the [runtime work bounds](../AGENTS.md#work-bounds) still require an integrated prototype.

## Pending decisions and unsolved mechanisms

The semantic requirements above are fixed for this comparison. These implementation choices and unproven mechanisms remain; the document is not yet a complete production implementation specification.

### Choices to measure

1. **Bound update policy.** Choose which cumulative bounds update eagerly and which refresh on demand. Preserve monotonicity and required notifications without rescanning every entry after each settlement.
2. **Override folding and materialization.** Choose batching and materialization thresholds. Repeated point writes followed by structural edits must preserve captured versions without per-key array splicing or payload waits.
3. **Storage sharing and selection.** Measure whole-storage copying, pending-use registration, and retained fragments under interleaved captures and edits. Compare with the persistent sequence; compact flat storage alone does not establish the cheaper complete implementation.

### Mechanisms still to demonstrate

1. **Stable shape and constraint representation.** Preserve required shared facts through clipping, conditional trimming, composition, and materialization. Integrate indexed growth with layout shape; independent boundary intervals cannot replace known relationships.
2. **Shared refinement and cursor validity.** Maintain registrations for divergent storage copies while updating identical shared mappings once. Entry splitting and removal must preserve active cursors, captured slots, bases, and orientation.
3. **Partial-use retention and cycles.** Track live selections and required command dependencies so discarded sources and registrations release while other controls remain pending. Overlapping deferred slices and managed-data cycles still need an integrated lifetime mechanism.
4. **Bounded queries and propagation.** Implement shared shape summaries and incremental subscriptions without quadratic registration, notification, or history work. Candidate-search bounds exclude the cost of refreshing columns and evaluating deferred selectors.
5. **Parent-key and summary integration.** Choose direct placement updates or generalized backing projection where appropriate. Preserve complete parent relationships and conditional Error/Promise membership before publication without rescanning unrelated data.
