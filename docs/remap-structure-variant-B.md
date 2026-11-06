# Remap structure, variant B: persistent sequence

## Purpose

This is the selected persistent-sequence design for the [queryable block layout](../array-layout-approaches.md). The [flat-sequence variant](remap-structure-variant-A.md) remains a comparison baseline. Both follow [iterate-plan.md](../iterate-plan.md).

Methods generate mappings from captured source versions to a destination. The structure composes those mappings and answers which destination positions and contents are determined. Reads, searches, copies, Error queries, and iteration use the same facts.

Both variants follow the shared [query and publication rules](../array-layout-approaches.md#4-queries-and-publication), [settlement rules](../array-layout-approaches.md#6-settlement-and-dependent-layouts), and [materialization rules](../array-layout-approaches.md#91-retain-or-materialize).

## One sequence, two directions

Store remap entries in output order in a balanced tree. Small leaves hold short arrays of entries; internal nodes join consecutive pieces and summarize their lengths. This is a **rope**: a sequence represented by a tree of spans.

Each node groups consecutive entries. A node may have an uncertain total simply because some child widths are uncertain; that alone does not require a deferred entry. A deferred entry represents a region needing a method-specific selection or transformation. Sibling regions never compete for the same output positions.

Front queries walk using counts to the left; back queries use counts to the right. There are no separate front/back indexes or stored absolute destination positions to keep synchronized.

The sequence is **persistent**: later edits share unchanged subtrees while earlier roots remain usable. Shared tree topology stays immutable; exclusively owned nodes can be edited in place. Balance depends on stored structure, not unresolved element counts; count refinement does not change that topology. Deferred forwarding has its own rule below.

## Entry contents

A **remap entry** describes one piece of output:

- A span selected from a captured source version.
- Inserted values, a repeated value, or holes.
- A deferred region whose extent or selection depends on captured controls.
- A slice selecting part of a captured region, including a deferred result.

Source spans retain their captured version, offset, `fromEnd` flag, and traversal direction, following the [block selector convention](../array-layout-approaches.md#31-counted-source-blocks). Multiple inserted values can share an Array backing. Repetitions and holes need no per-position allocation.

A tree node is an implementation container for entries or subtrees. Its position in the sequence determines destination placement; the source selector determines contents. Method constraints belong to stable logical regions and captured facts referenced by entries, not to whichever balancing node currently groups them.

## Count measures and shape

Each node exposes a **count measure**: its number of output positions, either exact or bounded by `[min, max]`. Count includes holes and excludes non-index properties.

| Region | Count measure |
| --- | --- |
| Three captured source positions | `[3, 3]`, even with pending values |
| A repeated value written over four positions | `[4, 4]` |
| An unresolved deletion from two positions | `[0, 2]` |
| A length-preserving deferred fill | The captured input length |

Extend the existing captured-shape boundary for subtraction, truncation, shifts, and the shape of failure fallbacks. A failed structural control does not itself leave length poisoned; its fallback can establish an exact length. For a layout-backed version, obtain length and `inRange(index)` from the logical root's semantic shape, including region constraints and indexed-growth transitions. Node count intervals are cached projections of those facts, not a second authority or a complete failure state.

Shape-only captures reference independent count facts, not payload-owning tree nodes. Exclusive content storage can therefore coexist with an earlier captured shape; editing that storage must preserve the captured count version. Fuse ready additions and trims into the [compact shift/clamp form](array-layout-implementation-findings.md#compact-ready-count-transforms) rather than retaining a linked shape history.

Ordinary branch measures combine child counts and can be recomputed after balancing. Constraints that make a total more precise than independent interval addition must remain attached to the logical region.

```js
a = ["A", "B", "C", "D"]
a!.splice(p, 0, "X")
```

The resulting `a.length` is exactly `5`. Represent the unresolved insertion as a region with that exact count. Its unknown prefix and suffix lengths still total four; do not replace this fact with the wider sum of independent bounds.

Splitting or composing a region must retain its constraint references or transfer an equivalent proof to the resulting representation. A rotation changes only grouping; it cannot delete a semantic fact. Representing a known total as the sum of unrelated uncertain fragments is invalid.

Required shared-control and selector relationships also survive across operations, following the [shared-input rules](../iterate-plan.md#shared-inputs-and-occurrences). Two ranges sharing one captured boundary cannot acquire independent hypothetical boundaries merely because separate operations produced them. This preserves the specified reductions without requiring a general symbolic solver.

Nested selections must also preserve already-established branch conditions over that same control. The [shared-condition example](../array-layout-approaches.md#shared-conditions-in-nested-selections) shows how two fills eliminate an impossible surviving value without enumerating control outcomes.

An [unknown upper bound](../array-layout-approaches.md#unknown-upper-bounds) still permits lower-bound and end-relative queries.

## Boundary coordinates

An entry's front boundary is the total count before it. Its back boundary is the total count after it. If those totals are unknown, retain their bounds and relationships rather than inventing a numeric position.

An appended entry can therefore have back offset `0` without knowing the length of the sequence before it. A prepended entry has the symmetric property. A deferred region can expose an exact total while its internal piece lengths remain unresolved; that fact belongs to the region, not an incidental balancing node.

For exact counts, numeric lookup descends through the containing subtree and subtracts preceding counts. For uncertain counts, lookup may need a deferred selection across several possible sources. Being guaranteed in range does not require already knowing which source supplies the position.

## Deferred regions

A deferred entry retains:

- The required region of its captured predecessor sequence.
- Captured control facts, including bounds and causal failures.
- The method's selection and shape rules for that region.

It answers partial queries as soon as those rules permit. It is not a Promise that blocks access to its entire output until everything settles.

For example:

```js
a = ["A", "B", "C", "D"]
a!.splice(2, p, "X")
a!.push("Z")
```

The composed sequence can be represented as:

```text
[ A B ] + [ X ] + [ deferred remainder of C D ] + [ Z ]
   2        1                 [0, 2]                1
```

The prefix `A, B, X` is fixed. `Z` is last, even while its front index is unknown. The remainder selects `C,D`, `D`, or nothing according to the normalized deletion count.

Keep proven prefixes and suffixes outside the uncertain region where possible. Re-evaluating a deferred selection uses captured facts; it does not replay commands, conversions, comparators, or host callbacks.

## Slices of captured regions

A slice selects an output range of one captured region using the same source-selection machinery as other spans. It retains:

- The captured region and its shared settlement facts.
- Start and end selectors, or a start and extent rule, with front/back coordinates and traversal direction.
- Its derived count and any constraints needed to determine membership and contents.

Bounds approximate these selectors; an offset range alone does not define a slice. Normalization and clamping use the captured source shape.

For a region `R` of width `[0, 2]`, selecting from front offset `1` to its end has width `[0, 1]`. If `R` resolves to `[C,D]`, the slice yields `[D]`; if it resolves to `[D]` or `[]`, the slice is empty. It shares R's settlement without rerunning the producer.

A live slice owns restricted source captures, sharing persistent subtrees with overlapping uses. Removing or refining that use releases its obsolete captures without scanning other consumers. Shared shape/control state must not retain a whole payload root. Uncertain selections retain candidate source regions and narrow them through the method's mapping. Selection dependencies can extend beyond the returned range: even one sorted output may depend on many input values. Use this [sliced-ownership baseline](array-layout-implementation-findings.md#2-use-sliced-ownership-not-a-producer-wide-range-registry); a general interval-coverage index is not required by the demonstrated cases.

## Composition and command order

Use **span replacement** as the common edit:

1. Split the current sequence at the target boundaries.
2. Replace the selected span with the new entries.
3. Join the retained pieces and rebalance the changed paths, reusing exclusive nodes and copying shared ones.

Insertion replaces an empty span; removal inserts nothing; overwrite preserves length. Indexed property deletion creates a hole without shifting later positions.

Exact-key writes retain existing placement-version overrides. Structural and range edits capture relevant overrides with their predecessor and fold them into spans where contents, coordinates, or source selection change, without awaiting payloads. Remove folded overrides from the successor's override view so they cannot mask a later write. Point replacements within the tree use the same span-replacement rule. Every capture keeps its own override view.

When a boundary is unresolved, preserve the selection as a deferred region or slice. Do not choose a speculative split. Later known writes can still replace independent positions:

```js
a!.fill("X", p)
a[0] = "Y"
```

After folding the later override, a four-position Array can contain `Y` followed by positions `1..3` of the captured fill result. Settlement of that earlier fill cannot replace `Y`. With the commands reversed, position `0` remains dependent on `p`.

Install these relationships before suspension. `copyWithin` selects its captured pre-write source, including overlapping ranges. Split source spans at intersection boundaries instead of expanding them into individual positions.

### Example: splice splitting a source span

Let one entry select all of captured source `S = [A,B,C,D,E,F,G,H]`. After `a!.splice(3, 2, "X")`, the successor contains:

```text
[source S, start 0, count 3] + [X] + [source S, start 5, count 3]
             A B C                                  F G H
```

These are new span descriptors sharing captured values, without copying or awaiting them. The removed-elements result may retain `S` at start 3, count 2. If an edit crosses multiple entries, split the boundary entries and exclude the intervening entries or subtrees from the successor. Earlier roots remain valid through path copying.

With a pending normalized deletion count P, the suffix instead selects `S[3+P .. 8)`. It retains the necessary source and control facts until its selection resolves, then forwards to the resolved sequence and releases obsolete dependencies.

## Endpoint and middle edits

Append and prepend join new entries at the corresponding end. A middle edit changes the paths to its boundaries and shares the unaffected subtrees. Destination positions shift because preceding counts change; following entries need no absolute-index rewrite.

Edits use the same front/back coordinates as reads. Preserve an end-relative target rather than awaiting length to convert it into an absolute index:

| Operation | Captured edit |
| --- | --- |
| `pop()` | Remove the last position if present; select its value as the result. |
| `shift()` | Remove the first position if present; select its value as the result. |
| `splice(-1, 1, Y)` | Replace the last position when nonempty; insert `Y` when empty. |
| `fill(Y, -1)` | Overwrite the last position when nonempty; do nothing when empty. |

Normalization preserves each method's clamping and empty cases. A possibly empty Array needs conditional trimming, with output length `max(0, L-1)` for pop/shift. In `[A,B] + R`, pop may trim R or remove B. Keep that selection as a deferred trim/slice over the candidate region; do not guess which entry owns the endpoint.

Earlier uncertainty stays confined to its captured input:

```js
a = ["A", "B", "C"]
a!.fill("X", pendingStart, pendingEnd)
a!.push("Z")
```

The sequence is the three-position deferred fill followed by `Z`. Resolving the fill cannot include the later append. An earlier empty region likewise stays empty after growth.

For resolved boundaries, balanced-tree navigation and path copying are logarithmic in the number of stored entries. Constructing replacement pieces, releasing removed data, evaluating deferred selections, and updating graph relationships are additional work.

## Reversal

Whole-layout reversal changes the orientation of a root reference. Traversal then visits children in reverse order and reverses traversal within each entry.

Orientation belongs to that reference, not to shared source data or a shared deferred result. Later edits interpret their targets through it; earlier captures retain their original direction. Local orientation can be propagated through copied paths when an edit needs to split a reversed subtree.

This makes the layout reversal itself constant-size work. It does not remove the command's prescribed writes, identity change, publication, or graph-maintenance obligations.

## Captured versions

A layout version retains a root reference, orientation, point-override view, and its semantic shape facts. Capturing an already constructed layout shares that root.

An edit reuses exclusive nodes or copies shared changed paths, leaving earlier versions intact. With an earlier capture retained:

```text
earlier capture:  [ A B ] + [ C D ]
later version:    [ A B ] + [ X ] + [ C D ]
```

The unchanged spans are shared; only the joining structure and inserted span need new storage. An unresolved source fact may also be shared, because it describes the same earlier logical input in both versions.

Root retention is constant-size layout work, not a claim that the complete runtime capture is free. Ownership protection, graph indexing, and eventual release retain their own costs. Retained versions consume memory for their distinct paths and still-needed sources.

### Editing exclusive nodes

Apply copy-on-write to tree nodes using their existing use counts. Transfer the current root's owning use to the successor when no retained old view needs it; a logical successor does not require fresh physical nodes.

1. Descend from the root, reusing nodes with one owning use along an exclusive path.
2. At the first shared node, copy it before changing it. The copy retains its child edges, making the old children shared too. Copy the changed path below it as needed; keep untouched siblings shared. A child's count of one before copying its shared parent is not evidence of exclusive access.
3. Apply the same rule to balancing and orientation pushed into nodes; root-reference orientation stays local to that reference. Keep entry descriptors leaf-owned and copy them with a copied leaf, sharing their captured sources and producer facts. This avoids separate use counts for each descriptor; reusing a leaf never authorizes changing a shared producer's meaning.
4. When changing an edge, maintain owning uses, replace the old dependency link, and refresh or invalidate affected summaries within the transition, before consumer callbacks. Leaf edits likewise update affected producer-use records; delayed settlement must not address an entry by a stale row offset. Newly attached dependencies consume current semantic facts; optional caches also inherit or resolve existing dirtiness as specified below.

Every retained old view must protect the nodes it can still read: copied Array containers, cursors, slices, deferred sources, and unfinished shape or selection captures. A non-owning notification link is not a snapshot. A shape-only capture may instead retain independent semantic facts; it need not retain payloads or the whole tree.

An exclusive ready append therefore need not allocate a replacement leaf or path on every call. New entries, leaf growth/splitting, and shared paths still require storage; navigation and summary updates remain logarithmic beyond one leaf. Reusing internal nodes does not suppress prescribed writes or logical identity changes.

## Settlement and forwarding

A deferred region owns shared settlement state. As controls settle, it refines its rules and can forward to a resolved sequence when its layout is determined; payloads may remain pending. Every reference observes the same refinement of that captured region.

The entry remains a stable indirection to the resolved root. Forwarding does not splice new children into an existing shared tree node or change its balancing height. An edit traversing that indirection may incorporate the resolved sequence through ordinary joining and path copying.

Stable topology avoids shifting array offsets under active cursors. It does not make cursor correctness automatic: cursors must follow forwarding, preserve their captured logical position, and re-evaluate the required facts when dependencies change.

Later commands create successor logical versions without changing that earlier region's meaning. They may reuse exclusive storage. In the fill-then-assignment example, the current version retains only a slice of the deferred result, so forwarding cannot overwrite the later assignment.

Within a captured version, refinement narrows possibilities and never revokes a published fact. Keep original shape constraints when forwarding; replacing an exact region count with weaker child bounds would lose information.

Indirection depth is separate from balanced-tree height. Queries, settlement, and release must handle and simplify spent forwarding chains without depending on another edit occurring. Incorporation and compaction must preserve earlier captures and their live selections.

Required publication, poison handling, parent/counter maintenance, completion, and release run at their prescribed transitions. Optional derived work may follow queries, as specified in the [update-policy plan](../array-layout-approaches.md#62-derived-updates-versus-queries). Use guarded continuations and synchronous worklists.

## Count and query summaries

Maintain compact facts needed for active progress during settlement. Compute detailed derived mappings on demand where that saves work. Both use the same captured semantic facts; there is no alternate ready/pending evaluator.

### Change-sensitive propagation

1. **Register required dependencies.** A summary follows the child or region facts that can change its projection. Exact count needs no further count link, but selection, presence, and failure questions retain their own required dependencies.
2. **Recompute the affected projection.** Stop that propagation when the fact is unchanged. A dirty flag alone does not justify waking all captured queries. A newly registered dependent consumes current state before waiting.
3. **Notify relevant questions.** Finish the synchronous update wave before callbacks. Count bounds, failure certainty, and selection are different projections: unchanged bounds cannot suppress a relevant failure or value notification. A summary must not claim to cover facts it does not encode.
4. **Remove links at last use.** Reverse dependency links do not increment node ownership counts. Detach them when the fact becomes independent or the node loses its final owning use, clearing their ordinary JavaScript references before releasing child edges.

The [fixed-size history probe](array-layout-implementation-findings.md#counterexample-to-dirty-root-wakeups) rejects dirty-root wakeups as the default: 512 possible writes to one Array slot caused 131,328 wakeups, versus 512 with changed-summary propagation. This chooses the active-progress baseline; it does not establish all-method complexity bounds.

### Optional derived caches

Optional mapping caches may use targeted invalidation and lazy refresh. Mark only dependent caches dirty, stop at already-dirty caches, and let newly attached dependents inherit or resolve existing dirtiness. Refresh clears the dirty mark even when the resulting fact remains uncertain, so later changes can invalidate it again.

A query may use an older conservative bound when it already proves the answer; otherwise refresh required contributions, including dirty siblings where necessary. Optional cache dirtiness does not itself notify semantic consumers. Required completion, publication, Error processing, and release still advance without a later read.

### Structural work bound

For bounded fan-out `f`, refreshing an ordinary structural count summary reads at most `f` child summaries and clears one dirty mark. Recursive child refreshes are charged to those children's marks. Across a trace with `I` clean-to-dirty transitions and `N` initially dirty summaries, total structural refresh work is `O(f × (I + N))`. In-place edits that make a summary stale count in `I`. Refreshing dirty siblings may exceed one lookup path, but is charged to the events that dirtied them, not unexplained extra work.

One occurrence has `O(log B)` structural ancestors for `B` entries. Across `V` retained versions with one occurrence each, a change can reach up to `O(V log B)` ancestors, stopping earlier where the relevant projection is unchanged. This per-change bound is not a total-history proof: the fixed-size probe shows why refreshing and waking every affected version on every settlement can still be quadratic.

Charge active summary work to initialization and actual child-projection changes; charge optional refresh to its dirty transitions. Delivery to `W` relevant waiting consumers still costs `O(W)`, plus query work. Repeated occurrences, semantic-region chains, Error collection, publication, and managed-graph maintenance need separate bounds. Do not justify an avoidable notification fan-out merely by counting allocated dependencies.

## Waiting queries

Use the shared [waiting-shape-query protocol](../array-layout-approaches.md#63-waiting-shape-queries): one existence registration per cursor on its captured semantic shape, separate from slot-value dependencies. In B, changed projections reach that summary through the tree and semantic-region dependencies. A cached root interval alone is insufficient.

## Queries and publication

Use one query interface for shape, membership, selection, and values, including the selected version's point overrides. Exact count measures accelerate navigation; uncertain measures retain the underlying dependencies.

Apply the common [sparse traversal rules](../array-layout-approaches.md#sparse-presence-and-traversal); tree counts do not establish own-property presence.

For uncertain navigation, carry an offset range through child count measures. Conservative candidates occupy a contiguous run in output order. With available measures, balanced traversal and bounded-size leaves can find and visit that run in `O(log B + C)` for `B` indexed entries and `C` candidates. Bound refresh, correlated-selector checks, and descent into deferred regions are additional work; conservative candidates can include false positives.

Keep these facts distinct:

- A numeric position may be guaranteed in range while its final value remains pending.
- An entry may be guaranteed present without a known numeric position.
- A known value cannot be emitted at a guessed position or through an unresolved overwrite.

For example:

```js
a = ["A", "B"]
a!.splice(0, p1)
a!.push("M", "C")
a!.splice(-1, p2)
```

With normalized counts `p1` in `[0, 2]` and `p2` in `[0, 1]`, `M` is always present between an uncertain prefix and an optional `C`. `includes("M")` can succeed even though neither its front nor back numeric index is fixed.

Ordered iteration issues the structurally published prefix: membership, intended position, and final payload source must be established. The payload itself can remain pending or ordinary poison. A pending-bound fill does not authorize four steps merely because length is four; unresolved source selection remains a structural prerequisite. Preserve cursor progress without rescanning issued positions. See the [common publication rules](../array-layout-approaches.md#42-position-certainty-and-value-readiness).

A future iterator delivers guaranteed surviving occurrences before their numeric indexes are known, carrying index futures as specified in the [iteration plan](../iterate-plan.md#future-out-of-order-element-delivery). Numeric queries remain useful, but occurrence discovery and delivery require their own unordered-stage integration over the same layout.

The subsequent [bounded-window phase](../iterate-plan.md#bounded-window-iteration) adds demand restricted to consumer-supplied [f,r). B bounds unfinished positions: every newly completed admitted occurrence extends r once, while trimming its completed prefix advances f without a second credit. The numeric window can exceed B. Relative-count bounds and correlated totals prove whether a not-yet-delivered occurrence's entire final/fallback index range is contained in that window. Reuse this tree and its maintained uses for disjoint-region pruning, unresolved boundary dependencies, compact completed runs, and exactly-once delivery; no second index or whole-suffix/completion-history rescan is introduced. Cascada owns completion accounting and branch execution. A completed occurrence may still retain necessary index facts, but not its finished body or payload solely for window bookkeeping.

## Failure

Apply the common [mode and fallback contract](../poison-policy-plan.md), including its [sort exception](../poison-policy-plan.md#sorting-requires-order). Complete mode waits for the required structural outcome and normally produces whole-Array Error on failure; mutating-sort preparation/comparison failure retains repairable own status in every mode. Streaming modes retain independent facts and use the specified fallback layout; the representation cannot choose extra poison or an empty extent merely to simplify storage.

Sequential mode flags surviving occurrences whose intended positions are lost. Unordered mode keeps those occurrences usable without positional flags or an extra marker. Potentially deleted or overwritten occurrences become permanent structural poison; possibly missing output gets one real Error marker per failed contribution. Ordinary payload rejection remains value poison only.

Fallback must preserve every established bound, occurrence, and publication and compose with later commands in issuance order. Represent markers as ordinary entries and positional status at its retained occurrence; preserve their structural role through captures and materialization. Genuine path flags block access in every mode. Repair clears only own status, exposing retained payload at the fallback position; it never repairs Error data or reconstructs deleted candidates.

Counts alone do not summarize Error membership. Pending selections retain only output-relevant candidate dependencies; discarded alternatives are not output members. Use the [deferred-child and graph-summary rules](../iterate-plan.md#deferred-children-and-graph-summaries). Keep no separate zero-width failure channel or error-history ledger.

## Internal-node lifetime

Persistent tree nodes need explicit use accounting in addition to managed-value lifetime. Use counts over the acyclic internal sharing graph are the baseline:

1. A root holder or owning internal edge retains its target node.
2. Releasing an edge decrements that use. A node with other uses remains intact.
3. When the last use disappears, release its child edges, entry uses, and owned producer resources through a synchronous worklist.

A live forwarding cell retains its resolved root; source and slice dependencies retain their required captures. Register those uses once at creation and remove them at last use. An obsolete notification link must not act as a permanent root.

Root release therefore follows nodes losing their final use, plus their released entries and dependency uses. Managed-data retirement is additional work. These counts do not collect cycles passing through managed values and deferred captures; that integration remains a production requirement.

### Consuming a captured sequence

Whole-root retention is appropriate for a full snapshot. A forward cursor also needs [progressive consumed-region release](../array-layout-approaches.md#advancing-consumers-release-consumed-regions): retaining its original root indefinitely would keep every prefix subtree alive. Reuse partial-range uses and separate shape captures; do not introduce a cursor-specific lifetime registry. The concrete mechanism must preserve traversal through forwarding and earlier versions without copying a root per emitted item. This is part of the partial-use retention prototype below.

#### Frontier for determined boundaries

Prototype a traversal frontier holding unread sibling subtrees along the path, plus the exact number of positions passed. For a balanced tree with determined boundaries this needs O(log B) structural references. Release a fully consumed subtree when no remaining cursor selection needs it; already-issued values and other captures retain their own uses. Advance at subtree boundaries without constructing a new root for each item.

Uncertain numeric lookups can retain a conditional slice/use, as in the [remaining-range example](../array-layout-approaches.md#advancing-consumers-release-consumed-regions). Sequential iteration waits for final source selection; it cannot issue that unresolved occurrence. Unordered discovery can retain a guaranteed survivor separately. Keep shape-only existence registration distinct from the payload frontier, and release each use at its own last access.

## Ownership, parent keys, and release

Tree persistence protects the layout description. Existing captures, leases, and copy-on-write protect the managed values selected by it.

Never register a guessed destination key. Publish complete logical parent relationships and required active counters before consumer callbacks. Repeated or reversed source spans create their actual destination occurrences; shared tree nodes do not merge those placements.

Prepend, middle edits, reversal, and settlement can change published numeric parent keys. Start with existing placement publication and its simple backing projection; update affected established keys through the ordinary property boundary. Generalized multi-span projection is a later measured optimization. Graph work can be linear in affected managed placements despite a logarithmic layout edit. Follow the [publication baseline](array-layout-implementation-findings.md#publication-baseline).

Use parent-derived preservation for layout-owned inputs whose keys are not established. Reuse the existing retention/COW mechanism without reporting those inputs as logical placements or unconditional Error members. Unconditional lease roots owned by the layout itself would prevent cycles from retiring. The [runtime preservation probe](array-layout-implementation-findings.md#3-reuse-parent-derived-preservation-for-deferred-inputs) validates ready-child protection and cycle retirement; pending delivery and summary integration remain required.

Retain required source regions instead of whole predecessor layouts merely for convenience, within the existing backing-retention contract. Live slice uses and required command work determine which producer inputs remain needed. Release obsolete sources and registrations while unrelated controls remain pending; test shared sources and cycles rather than relying on JavaScript garbage collection for the release protocol.

## Local simplification and history

After edits or settlement, remove empty entries and merge compatible adjacent source spans, inserted runs, repetitions, or holes. Preserve direction, sparse presence, shared selectors, and required structural proofs.

### Replacing covered entries

A replacement can omit whole older entries from the current root. Earlier captures, removed-element results, or required command work may still retain them; release their layout nodes and producer uses when none remain. Surviving spans can still share physical backing that contains discarded positions, under the backing-retention contract. That is distinct from retaining old layout history.

Discarding contents can still leave a [shape dependency](../array-layout-approaches.md#contents-and-shape-have-separate-dependencies); retain that fact separately from discarded payloads.

### Merging appends

Successive pushes can change `prefix + [X]` into `prefix + [X,Y]` through one compatible inserted run. Reuse an exclusive span or create a combined successor span when it is shared; an earlier capture keeps its shorter span. Copy affected shared leaves and paths rather than widening the captured entry.

Reuse append backing where its storage contract permits, with fixed bounds for each capture. Do not repeatedly copy accumulated values just to force a merge; neighboring entries in the same leaf are valid when merging is not economical. Each push retains its own returned length and required effects.

### Long push tails

Follow the shared [compact append rule](../array-layout-approaches.md#compact-append-path): an append-only compact Array does not enter this tree representation merely because payloads are pending.

After one uncertain region, compatible appends can stay `[R] + [X1 ... Xn]` in one leaf. With a growable tail backing and exclusive leaf, each single-item append has amortized constant layout work; payload preparation, command results, graph publication, and retained-version work keep their own costs. Capacity must already be proved. A fragmented prefix can require tree navigation even though its tail merges.

Do not add a cached tail-leaf pointer in the baseline. One-leaf layouts need none; in a larger tree it would not remove ancestor-measure updates or copy-on-write. Reconsider only if measured navigation costs justify maintaining it through edits and captures.

### Necessary history

Simplify spent forwarding and selection chains without changing earlier captures. A balanced output tree does not bound a deep chain of deferred transformations behind one leaf. Queries must not repeatedly walk completed command history, and abandoned branches must release while other work remains pending.

Retain captured predecessors only where live versions, unresolved selections, or required operation work still need them. The structure is a composed layout with those dependencies, not a permanent log of every edit. Bounded tracking and release across overlapping pending slices remain prototype work.

Process history-sized propagation and release with loops or synchronous worklists. Layout simplification cannot cancel prescribed writes, identity changes, call results, or completion obligations.

## Small layouts

Keep ordinary Arrays and simple ArrayViews in their existing compact representations. When a block layout is needed, a short sequence can fit in one leaf containing a small entry array. Branch nodes appear as the sequence fragments.

Use the shared [compact-storage recovery rule](../array-layout-approaches.md#returning-to-compact-storage) in the other direction too: collapse redundant branches and adopt a compatible Array/View when possible. Clearing the last deferred region does not by itself justify flattening multiple exact spans. Older roots retain their own representation.

Choose leaf size and materialization thresholds from measurements. Small and large representations must share the same query and failure rules.

Use a small flat entry array as the leaf representation, borrowing the flat candidate's entry and selection machinery. Test optional front/back boundary columns within leaves. A one-leaf layout needs no balancing or orientation propagation through branches, though its shared storage and producer uses still need lifetime handling.

Beyond leaf capacity, relative counts and path copying avoid A's whole-storage copies and global boundary-column updates. Exclusive-node reuse removes mandatory path allocation from unshared edits. Use-count checks, logarithmic descent, summary updates, and occasional splits remain; measure their constants against A. Forwarding, lifetime, and actual retained-version workloads still determine the complete cost.

## Comparison and validation

This candidate's main advantage is sharing captured versions while editing only local tree paths. It also avoids rewriting destination coordinates after middle edits. Its costs include tree allocation, navigation, balancing, and the dependencies retained inside deferred regions.

The [shared cost comparison](../array-layout-approaches.md#93-candidate-cost-comparison) uses the same rows and exclusions for both candidates, including cache refresh, root release, deferred history, and managed-parent work.

Compare with the flat-sequence candidate using the same [acceptance workloads](../array-layout-approaches.md#102-acceptance-workloads): interleaved captures and edits, pending splice followed by append/reverse, sparse and repeated sources, and many unresolved operations on a small Array. Include forward/back queries and both control fulfillment and rejection.

Measure path copying, entry visits, deferred-history work, notifications, graph maintenance, and retained sources separately. Include rotations around constrained regions, overlapping slices, forwarded results with no later edit, uncertain end edits, and retirement while another control never settles. Cheap root capture and local editing do not establish the [runtime work bounds](../AGENTS.md#work-bounds) on their own.

Verify exclusive edits without unnecessary path allocation and shared edits without altering earlier roots, including sharing below an exclusive root. Count active propagation against changed projections and optional refresh against dirtiness and initialization; test many waiters and retained roots. The common workloads cover sparse traversal and materialization.

## Implementation choices and acceptance

Variant B and the [method specification](array-method-specification.md) define the architecture and semantics. Remaining choices are implementation measurements, not alternate failure policies.

### Choices to measure

1. Balancing, leaf capacity, optional leaf indexes, and materialization thresholds. Compare compact append-only Arrays, long tails after a pending edit, partial concat accumulation, and fragmented retained versions.
2. Optional derived caches. Active questions use their specific projections; exact-length waits must not subscribe to every numeric-bound refinement. Do not reinstate history-wide invalidation.
3. When to incorporate resolved forwarding subtrees and batch overrides. Required publication/release is synchronous; optional cache folding must not rebuild the same region repeatedly.

### Production acceptance

1. Implement captured normalizers, shared controls, method fallbacks, and region queries under the common rules; preserve them through splitting, composition, and indexed growth.
2. Restrict source uses backwards through the same mapping recipes. Separate content from shape and release excluded regions without producer-wide consumer scans.
3. Integrate parent-derived preservation, pending publication, authoritative forward uses, retirement/re-entry, and internal-node release in the actual layout.
4. Preserve projected-readiness and mixed-history counter bounds. A balanced output tree alone does not bound semantic history.
5. Publish established keys and active counters before callbacks; preserve repeated occurrences, canonical export, and conditional Error membership without treating retained inputs as output children.

The [implementation evidence](array-layout-implementation-findings.md#6-specification-and-integration-acceptance) now includes pending delivery, indexed publication, retirement/re-entry, mixed transforms, and the remaining production test gates. Rerun those witnesses against the actual layout at cutover.
