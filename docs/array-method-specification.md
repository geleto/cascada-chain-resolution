# Partial Array methods: implementation specification

This document specifies the method-level rules for [iterate-plan.md](../iterate-plan.md): the selected bounded evaluator, fallback construction, publication, and verification. [Chain modes](../poison-policy-plan.md) own the failure policy; [Variant B](remap-structure-variant-B.md) owns storage. The plan records the [selected decisions](../iterate-plan.md#13-selected-decisions), including retained state and result forms under the whole-Array sort-failure exception. Production implementation remains a separate task.

## 1. One operation, separate outcomes

An operation captures its predecessor and inputs at issuance. It can have a receiver successor, a direct result, required effects, and retained result-data production. Evaluate their dependencies separately. A completed direct result must include every effect its contract promises complete; receiving a partial value does not complete unrelated producers or native effects.

Do not replay an operation after settlement. Its deferred producer refines the same captured facts. Later operations compose with that successor, including its declared failure outcome, rather than with whichever physical data happens to be available.

Without !, all nine mutation-capable Array methods return the transformed copy and preserve their source. With !, they publish receiver changes and return the JavaScript method result. This retains the existing uniform observation-copy contract; splice returns removed elements only in mutation mode.

Copy-producing calls, including slice/concat/flat/toSorted/toSpliced/with, use the source Chain's mode for their result:

| Mode | Result handoff and later failure |
| --- | --- |
| Complete | Wait for required structural production; relevant structural failure returns ordinary root poison. Stored payloads can remain pending. |
| Sequential stream | After root validity, return a partial copy. Later production publishes the specified regional Errors or positional flags in that captured copy. The root is not replaced retroactively. |
| Unordered stream | After root validity, return a partial copy and preserve guaranteed survivors. A later ordering-only failure creates no positional Error or missing-output marker. |

Sort and toSorted are exceptions to position-only recovery: explicitly requesting sort requires ordering, including in unordered mode. Required sorting success precedes result access; no healthy unsorted fallback escapes after comparator failure. A pending sort cannot hand off guaranteed survivors or its fixed undefined/hole suffix before a possible whole-result failure is excluded. Other methods retain their selected positional fallback. Required work still completes; no mode cancels already-required callbacks.

Mutating calls have a separate receiver and direct result. Their receiver can publish permitted regions while the direct result retains its required control/effect dependencies and reports a failed required call. No payload-only wait is added. Root invalidity—failed target/category/authority, with index invalidity, capacity, or required unlimited-flat cycle validation—precedes any root handoff in every mode. These outcomes cannot be converted into a late flag on an already exposed copy.

## 2. Closed fact and query vocabulary

Use captured placement selectors, spans, joins, reversal, restriction, repetition/holes, conditional selection, and method-specific deferred regions. Keep the following facts separate:

- shape: exact count, conservative bounds, and the semantic count producer;
- presence and source selection at a front/end-relative coordinate;
- guaranteed occurrence membership, independent of numeric position;
- payload availability;
- status/structural Error membership;
- prescribed writes and direct-result completion.

The required reductions are exact arithmetic on ready controls, interval exclusion, identical captured selectors, identical normalized coordinates, shared internal guards, endpoint composition, clamped-affine count fusion, empty ranges, and each method's ordinary comparisons/short circuits. Reuse the [common rules](array-iteration-technical-analysis.md#3-small-common-reduction-rules). No combinations of hypothetical comparator outcomes, old-payload equality pass, cross-lookup provenance registry, or general constraint solver are required.

Every remaining question retains its actual pending prerequisites. On failure, apply the declared footprint after the required reductions; do not make poison unconditional while another fact can prove it irrelevant. More conservative progress is permitted outside those required reductions. Storage layout, settlement timing, and accidental discovery order never select a different rule.

## 3. Unknown lengths and shared controls

### Preserve normalizers, not independent intervals

Represent a relative boundary as a view of its captured length and argument:

```text
normalize(L,n) = n < 0 ? max(L+n,0) : min(n,L)
```

The numeric result may be pending; the relationship is already known. Preserve omission, explicit undefined, integer conversion, infinities, and validation under the existing method rules. Bounds are cached projections of this relationship, not a replacement for it.

Two uses of the same captured normalized fact have one outcome. A split at S has counts S and L-S whose total is L. Splice's removed and retained suffix counts share one deletion fact. Self-copy uses the same source and destination coordinate. Tree splitting, materialization, or balancing must not break those identities.

If the source length is unresolved, keep named count operations and end-relative coordinates. Do not substitute a guessed L. Positive fixed bounds can often be discharged by membership questions; negative bounds retain their source-end relationship. For example, in-range output i of `copyWithin(t,s,e)` with nonnegative ready arguments uses q=s+i-t and writes exactly when t<=i, q<L, and q<e. It does not need exact L when those predicates are established.

### Correlation and fallback

The rectangular bounds formulas apply only to independent normalized controls. For shared controls, first apply the required shared-fact reductions. If a fallback needs a concrete layout, bind each failed control once in that operation's fallback recipe, then derive all its normalization views from that binding. Never choose unrelated extrema for two uses of the same control.

Example: for length six and `splice(P,P,X)` with P in [1,2], `(start=2,count=1)` is not a consistent binding. Binding P to 2 gives start 2 and count 2. The original Error remains; the binding defines a failure arrangement, not a successful application argument or a retry.

Fallback preference is deterministic: splice prefers the latest admissible start, then the smallest remaining independent deletion count; slice prefers the earliest start then latest independent end; flat prefers the shallowest permitted depth. A shared control takes its first preference in this order and all later roles reuse it. For numeric normalizers, endpoint selection examines domain endpoints and the normalizer's clamp/sign breakpoints, retaining symbolic length offsets when necessary; it does not enumerate argument values. Among tied candidates choose the smallest converted numeric argument, with -Infinity first. Do not independently widen a shared control into separate choices or solve arbitrary cross-operation constraints. A control whose remaining normalized possibilities collapse to one irrelevant outcome adds no poison.

When other necessary inputs, including L, are still pending, retain the fallback recipe as a deferred region. Publish its independent prefix/suffix/shape facts now; calculate numeric offsets only when needed. A failed control does not force unrelated controls to settle, but it also cannot supply their missing facts.

## 4. Fallback preserves the semantic bounds

Construct a permitted output arrangement, then classify its occurrences:

1. Keep a guaranteed survivor's captured payload.
2. Sequential mode flags that survivor if its intended position is not established. Unordered mode accepts its deterministic fallback position without positional poison.
3. Replace uncertain survival/content selections with permanent structural Error; discard candidate payloads no live capture needs.
4. Use a missing-output marker only for a contribution with no established output placement representing its failure. An existing structural Error span is not supplemented with a diagnostic marker.

The arrangement must preserve all established facts, even facts not yet observed. Include fallback in capacity and publication proofs. A skeleton never authorizes a guessed healthy value, an out-of-capacity slot, or restoration of a potentially deleted candidate.

Ordinary edits move/copy/remove Error slots and positional flags with their logical occurrences. Overwriting a destination replaces its prior local status. A genuine ancestor/path blocker remains a prerequisite until explicit repair or replacement. Complete mode applies its whole-Array structural failure boundary before consumption.

## 5. Endpoint and copying families

| Methods | Mapping and failure behavior |
| --- | --- |
| push/unshift | Join k captured payloads after/before the source. Count L+k. Preserve all payloads independently; validate capacity before publication. Unknown L leaves append indexes pending, not payloads. |
| pop/shift | Retain all but the last/first occurrence; count max(L-1,0). The mutation's removed-value result is independent of the surviving receiver; an empty source returns undefined. Observation returns the shortened copy. |
| reverse/toReversed | Reverse orientation and preserve L. toReversed densifies holes. No payload reads are required to move occurrences. |
| slice | Restrict to normalized [s,e), preserving holes. The known-length range/fallback rules are in the [bounded analysis](array-iteration-technical-analysis.md#determined-shape-slice-and-fill). Unknown L retains the same restriction over captured normalizers. |
| splice/toSpliced | Join prefix, k inserted payloads, and suffix after normalized deletion. Preserve correlated count L-d+k. Mutating splice separately selects its removed [s,s+d) result; observational splice returns the sparse successor; toSpliced returns the dense successor. Use the [bounded splice rule](array-iteration-technical-analysis.md#5-a-bounded-splice-fallback) and shared-control extension above. |
| with | Prove replacement-index validity before root handoff. Replace exactly that position and densify the copy. Its old payload is unused. An irrelevant replacement payload is not consumed when validity already fails. |
| concat | Classify consumed part roots before root handoff: each valid Array contributes its captured sequence; another healthy root contributes one value. Failed required part-root preparation fails the call. Known Array parts may retain partial shape or pending payloads; concatenate their semantic counts and validate total capacity. |

Indexed writes, length writes, and deletion use the same shape/override boundary. Known-index assignment establishes its slot and growth; a rejected payload poisons only that value. A general unresolved property key is not yet an index and may select length. A failed required length/key selection follows its existing whole-path boundary, not an invented regional resize. Deletion establishes absence without consuming an unused old payload; length does not shrink.

## 6. fill and copyWithin

### fill

For known L, start bounds [a,b], and end bounds [c,d], [b,c) is definitely overwritten, positions before a or at/after d are unaffected, and the remaining selected region is conditional. A failed relevant bound makes the conditional destinations structural Error. The definitely overwritten region retains the supplied payload without reading old values. Empty bounds and identical-selector reductions apply first.

Retain this predicate over symbolic normalizers when L is pending. The output shape remains exactly the source shape. A later append is outside this captured extent. No Array-wide flag or extra marker is needed for destination-local selection failure.

### copyWithin's coupled coordinates

For an in-range destination i, normalized target t, start s, and end e:

```text
q = s+i-t
write at i iff t <= i and q < e
written source = captured predecessor[q]
otherwise source = captured predecessor[i]
```

The ordinary min with L-t is already enforced by i<L. Keeping q tied to t and s prevents overlapping copies from reading their own writes or inventing independent source offsets.

For known L and independent bounds t=[t0,t1], s=[s0,s1], e=[e0,e1]:

```text
tMax = min(t1,i)
possible copied sources = [s0+i-tMax, min(s1+i-t0,e1-1,L-1)]
                         when t0 <= tMax and the interval is nonempty
definitely written = t1 <= i and s1+i-t0 < e0
```

Include original source i when the destination is not definitely written. Reduce identical captured selectors and uniform hole/repetition spans before retaining a control dependency. A relevant failed selector produces structural Error at that destination; unaffected sources are not poisoned. Do not enumerate every candidate index to represent a range.

If normalized target and source are provably identical, prescribe no writes and ignore end. Otherwise preserve ordinary same-value writes and sparse semantics: copying a hole deletes a present destination; copying a hole onto an absent destination publishes no placement change. Write identity follows the method's prescribed effect, separately from content selection.

## 7. sort and toSorted

### Successful production

Capture source presence and occurrence order before consuming sortable roots. A pending value is retained as its original payload producer. Keep three groups: present non-undefined values, present undefined values, and holes. Sort places those groups in that order; toSorted materializes holes as present undefined values.

Apply comparison-free proofs first: fewer than two sortable occurrences, or a structurally known repetition of one payload selector, needs no comparator/default keys. Preserve the ordinary permutation, hole rules, and prescribed writes. Otherwise prepare every required default key or one canonical comparator snapshot of all comparator-visible values. Keep aliases within that snapshot.

Once a needed supplied comparator fails selection/validation, callback-only argument export is irrelevant; do not await its nested data or switch to default-key conversion. Such preparation failures remain conditional until comparator selection establishes that they are needed. Keep the original payloads and source-classification/presence work still required by the failure boundary; do not materialize a fallback permutation. Later deep consumers still observe retained payload errors; fatal failures retain their normal boundary.

Run the existing stable sorting algorithm only after required preparation is complete. Comparator execution remains synchronous with the existing Number-result validation. Stage the permutation privately under ordinary captures; publish sort data writes only after preparation and comparison succeed. Do not call the comparator speculatively, sort arrivals in settlement order, invoke it again to recover from failure, or expose a partial native permutation.

### Whole-Array failure

Failed required comparison, key conversion, or comparator preparation fails the whole affected Array/result in every mode. The [selected contract](../iterate-plan.md#13-selected-decisions) distinguishes mutation from copying:

| Call | Required preparation/comparison failure, in every mode |
| --- | --- |
| `a!.sort()` | Report failure and publish repairable own-path status on the affected Array. Retain its captured pre-sort data and publish no sort data writes or fallback permutation. This is an explicit exception to complete mode's ordinary structural-root-Error rule. |
| `a.sort()` or `a.toSorted()` | Return ordinary result-root poison and preserve a. Do not expose or retain a repairable failed copy. |

A new path-poison publication is itself effective for identity, even if retained payloads have not moved. No missing-output marker duplicates this whole-Array failure. Repair of failed mutating sort clears only that status and exposes the unchanged pre-sort data; it neither retries sorting nor restores a separate baseline. Sorting `[undefined,B,A]` with a required failing comparator therefore leaves `[undefined,B,A]` behind the flag.

An unconsumed Error inside a retained payload remains payload Error. If preparing that payload is required to sort and fails, it contributes to the whole-sort failure; do not invent an unrelated failure or discard its causal identity. Existing source blockers propagate through their normal boundary, and unused comparators still introduce no failure. Any retained data preserves its payload producers, holes, aliases, and existing structural roles.

Fixed undefined/hole partition facts may be calculated privately, but they are not permission to expose sort-result items before required sorting success. Observations captured before the sort retain their own earlier values. Preparation/comparison failure retains the captured input without publishing that private partition.

After ordering succeeds, any storage/publication failure follows the ordinary publication-failure rules at its causal scope. Preserve already committed effects; add no sort-specific rollback or guarantee that later repair reveals pre-sort data at this boundary. Successful sorting keeps its ordinary prescribed-write and identity rules.

## 8. flat

### Discovery and payload retention

Walk captured present occurrences in source order. At depth zero, retain the value without consuming its root and omit source holes. At positive depth, consume only the root needed to distinguish a logical Array from a retained leaf; do not inspect unrelated descendants of a non-Array. Repeated references produce repeated output occurrences, not deduplicated values.

Required source discovery, capacity, and unlimited-depth cycle validity are root prerequisites. Establish them before exposing a root they could invalidate. Valid discovered Array regions can retain partial captured shapes. A pending required prerequisite may wait indefinitely; do not fabricate a marker to escape it. Known payload Error at a retained leaf remains value poison. Required discovery/selection failures keep their declared root or structural boundary.

For the singleton cycle `const a=[]; a[0]=a` and unrestricted pending depth, finite depth is legal but Infinity is not. Root safety therefore cannot be inferred from the shallow fallback alone. Wait for the required control or a safety proof; a failed depth that leaves required root validity unprovable returns its causal root poison. Apply the same precedence to possible capacity-expanding depths, including branching cycles at finite depth. Regional failed-depth fallback requires proved root safety and does not authorize unrelated discovery.

Depth Infinity rejects an active Array-ancestry cycle through the existing InvalidArrayOperation boundary. Use captured identities; a repeated alias outside the active ancestry is not a cycle. Finite depth is semantically consumed on descent, but repeated Number subtraction is not a sufficient implementation: `2**54 - 1 === 2**54`. Use depth-safe compact handling of repeated captured cycles, rather than one recursive frame or retained transform per conceptual depth. A singleton cycle produces one retained cyclic value at every finite depth; branching cycles can exceed capacity and require a bounded count proof before expansion. Preserve the accepted finite-depth domain without BigInt, an implicit cap, or conversion to Infinity. Memoized subtree/depth work must preserve repeated occurrences and release with its live uses; never traverse unrelated data merely to build a cache.

### Failed depth

First prove relevance. If no reached occurrence can be flattened for any permitted depth, forward the ordinary hole-filtered result and ignore the failed depth. If some payload root could still be an Array, its classification is a structural prerequisite; do not poison it before that relevance is known.

Use the shallowest permitted depth to construct the fallback skeleton. An occurrence selected at that depth is healthy only if it survives at every still-permitted depth under the required structural rules; otherwise replace that skeleton occurrence with structural Error. Preserve guaranteed non-Array leaves and their source order. Sequential mode flags surviving leaves whose positions vary; unordered mode keeps them usable. Sparse traversal omits holes at every traversed level.

Example: `[[A,B],C].flat(failedDepth)` with domain [0,1] uses `[Error,C]`, with C position-flagged only in sequential mode. The first Error represents the existing uncertain nested contribution; add no extra missing-output marker. A depth domain [1,2] starts from depth one, not zero. The fallback is one permitted extent and must remain inside the captured count bounds.

An existing marker or structural Error produced by an earlier operation retains its role through flattening. Multiple uncertain existing contributions can have multiple structural Error slots; that is different from adding multiple missing-output markers for one failed producer.

## 9. Searches and scalar producers

- at consumes the selected captured occurrence, using end-relative coordinates when appropriate. Out-of-range proofs return undefined without consuming its payload.
- includes returns true when a definitely eligible comparison matches. indexOf/lastIndexOf additionally establish the directional first match and numeric result. Holes participate only as the method specifies.
- Known mismatches remove candidates before an unresolved range control is consumed. An empty possible candidate set gives false/-1 despite poison arguments. No general search through combinations of unknown comparisons is required.
- join/toString capture the required sequence and perform ordinary scalar conversion with complete relevant Error collection. Separator is unused with at most one occurrence. Holes contribute empty text. They produce one String, not a partial String stream.
- A definite scalar result does not erase an independently required write or call failure. Conversely, private work with no promised effect is not a reason to retain an irrelevant input.

## 10. Sparse data, occurrence roles, and queries

Presence is distinct from value. Holes have length but no placement; value iteration yields undefined for a healthy hole. Preserve sparse ranges in slice/splice/concat/reverse/copyWithin, and densify only methods whose contract requires it. Do not walk every hole to update parent relationships or counters.

A hole can carry positional own status on its captured absent-slot fact or symbolic span. Status blocks access without creating present undefined data or a managed-child parent edge. Repair clears status while preserving absence; structural transfers preserve it, including when a dense copy creates the prescribed undefined placement. Explicit deletion clears selected status even on a hole and is then an effective publication. Unordered discovery treats repeated holes as distinct occurrences rather than deduplicating their undefined payloads.

Keep structural selection failure and missing-output markers as named numeric roles on logical placement/version captures, separate from their Error values. Ordinary payload is the default role. Remap moves and structural copies preserve the role; positional status remains the selected placement's own flag. Neither role nor status is inferred from Error identity, text, or delivery timing. A marker is one real Error slot, with no second positional container or new language value class.

Explicitly receiving a looked-up Error as a new payload creates a new structurally known occurrence: `b.push(a[i])` may therefore hold ordinary payload poison even when a[i] was structurally invalid in a. The failure value remains; b's occurrence is now defined. In contrast, slice/concat/flat and other placement-preserving copies retain the original structural role. Copying an Array as a value also preserves roles inside it. This distinction follows fresh placement construction versus captured placement transfer and requires no Error-provenance registry.

Shallow root/status queries do not scan descendants. Deep queries inspect actual retained output membership, including structural Error slots and flags; input retention is not membership. Conditional membership waits for its deciding facts. A true hasError may short-circuit on a certain retained failure; false and complete getErrors cover the required frontier. Use shared captured query state, never iteration draining or a historical Error log.

## 11. Lifetime and publication integration

Use property-version capture for pending inputs and parent-derived preservation for layout-owned values whose keys are not established. Do not create unconditional lease roots around layout cycles. A selection use retains its needed source slice and semantic shape facts separately.

### Restrict source retention through the mapping

Propagate a consumer's requested output region backwards through the same captured recipe. This is source retention, not enumeration or another mutation interpreter:

| Recipe | Required source use |
| --- | --- |
| Join | Intersect the request with each possible contribution and translate locally. Retain boundary/count facts separately. |
| Reverse | Reflect the requested interval against the captured source end; an end-relative interval need not await exact length. |
| Restrict or splice | Intersect with retained prefix/suffix and translate by the shared normalized cut. Inserted payloads have their own uses. |
| Fill or point replacement | Drop predecessor content definitely overwritten; retain only possible old selections and selected new payloads. |
| copyWithin | Union the possible old/copied source ranges from section 6. Read the predecessor, never the destination under construction. |
| Sort | Ordering may require the complete sortable group even for one requested position. Retain required algorithm inputs through the whole-sort validity gate; do not hand off sort-result payloads ahead of that gate. |
| Flat | Retain candidate nested contributions and the shape/discovery frontier that can select them. Discard excluded branches without consuming their payloads. |

Pending boundaries retain conservative candidate slices and their deciding facts. Narrow them when those facts settle; a numeric-length use alone never retains payloads. An independently retained capture keeps its own use when another consumer releases overlapping data. Release and refine through the use index, without scanning all consumers of the producer.

### Publish and retire

When a destination key becomes established, attach its ordinary placement and active counter contribution before releasing provisional preservation or exposing callbacks. Duplicate occurrences have separate keys. A later overwrite/truncation detaches current publication authority immediately; late settlement updates retained historical captures, not the replacement.

Retirement removes reverse preservation links, destinations, and optional counter projections. Authoritative forward captures remain sufficient for re-entry without source reinspection or resubscription. Re-entry restores inactive relationships only as needed, stopping at active descendants. Canonical export uses captured generation identities, including aliases and cycles, and releases source access before unrelated collection/assembly work completes.

The runtime bridge probe exercises pending fulfillment/rejection, active-index publication before receiving callbacks, historical snapshots, overwrite before delivery, cycle/alias export, retirement, and re-entry without Promise resubscription. These are concrete reuse points for the future layout; they do not claim that an unimplemented tree path has already passed end-to-end tests.

## 12. Work and release bounds

### Notify questions, not every intermediate number

An exact-length query over a sum needs readiness and its final value. It does not need notifications for every narrower intermediate bound. Maintain a separate projected readiness outcome; an unknown exact answer stays unknown until a required reduction or dependency completes it. Recompute optional numeric bounds when demanded by a consumer that can use them.

This is stronger than stopping propagation when numeric intervals are unchanged. In the retained-prefix sum probe, those intervals change on every settlement, causing N(N+1)/2 root updates. Projected readiness produces N final notifications with O(N log N) shared structure work. Membership/prefix queries use their own threshold/selection projections; do not assume exact-length readiness is sufficient for them.

Optional caches must not invalidate or wake every historical root eagerly. Register live question projections against their actual facts and stop propagation when that projection is unchanged. Share identical questions on the same captured fact. Error collection keeps a traversal frontier rather than copying growing Error sets through every ancestor.

### Composition and release

- Join/reverse/restrict operate on spans and balanced paths; endpoint count transforms fuse into the clamped-affine form.
- Conditional overwrites use last-effective-write summaries and shared-guard folding. A newer definite replacement drops older content dependencies while preserving owed results/effects.
- Deferred regions retain only live candidate source slices. Narrow and release those uses at settlement; a shape-only capture cannot retain their payloads.
- Consume determined subtrees through an unread frontier. Sequential iteration never issues a structurally unresolved source; numeric lookup and unordered discovery can retain their own conditional uses.
- Compact spent forwarding and release chains with synchronous worklists. Do not recursively traverse history-sized chains, rescan a completed prefix, or queue one microtask per internal node.

Count payload/parent work separately from structural indexing. Moving M established managed placements can require O(M) relationship updates even when the layout edit is O(log B). Repeated output occurrences and independently retained snapshots carry their actual data cost; they do not justify scanning every other consumer on each release.

The required stress set is fixed: retained versions with all-no-effect controls; exact sums whose bounds narrow before readiness; last-write selection in forward/reverse/shuffled settlement; overlapping source slices; long ready append/trim history; a pending middle edit followed by a long append tail; and repeated aliases/cycles with sources released while unrelated work remains pending. Each implementation cutover must preserve these assertions, not merely pass a wall-clock benchmark.

## 13. Verification and implementation boundary

Run the [method specification probe](../test/experiments/array-method-specification-probes.mjs), [bounded fallback/handoff probe](../test/experiments/array-iteration-contract-probes.mjs), and [layout mechanism probe](../test/experiments/array-layout-technical-probes.mjs). The method probe compares normalizer/copy selectors against native successful operations, checks sparse writes, sort partitions, flatten occurrences, and actual runtime publication/retirement. Its former healthy sort-fallback and early-suffix assertions are historical evidence, not acceptance of the newly selected whole-sort failure boundary; replace those witnesses at the sorting cutover.

Production implementation must integrate these rules with each method's existing input conversion, effects, Error collection, and identity reporting. Re-run the same witnesses through the production layout when it exists, plus the repository's required public-operation, sequence, conflict, consistency, and lifetime suites. A specification/prototype cannot certify code that has not been written.

Implement the plan's [selected decisions](../iterate-plan.md#13-selected-decisions) with their acceptance checks. Representation constants, cache thresholds, and measured optimizations remain implementation choices; they cannot alter selected semantics or introduce eager history-wide work. The existing probes do not yet cover flagged-hole status, failed-depth root-safety combinations, very large finite cyclic depth, or whole-sort failure/repair identity; those require the integrated acceptance cases in the plan.
