# Partial Array methods: implementation specification

This document specifies controlled Array method evaluation, fallback construction and publication in the Chain kernel. The iteration plan records the selected decisions about retained state, result forms and the whole-Array sort exception. [Iteration decisions](../iterate-plan.md#13-selected-decisions) · [Chain modes](../poison-policy-plan.md) · [Layout design](remap-structure-variant-B.md)

## 1. One operation, separate outcomes

An operation captures its predecessor and inputs at issuance. It can have a receiver successor, a direct result, required effects, and retained result-data production. Evaluate their dependencies separately. A completed direct result must include every effect its contract promises complete; receiving a partial value does not complete unrelated producers or native effects.

Every ordinary complete-mode consumption passes the shared [captured-Array access gate](../poison-policy-plan.md#complete-access-gate), including unchanged regions, observational and mutating receiver selection, writes, direct results, and nested export/native preparation. The gate certifies that earlier work cannot still poison the selected Array; it does not scan every payload. Queries, repair, whole-value replacement/deletion and unconsumed reference capture keep the exceptions stated there. Producer commands use their private predecessor, not their enclosing output future.

Use the [complete-mode validity rules](../poison-policy-plan.md#tracking-complete-mode-validity) to distinguish failure ownership and relevant open issuers. Healthy argument delivery does not exclude validation, comparison or publication failure. Ordinary stored-payload rejection and independent result failure add no receiver-wide dependency by themselves. Validity can precede unrelated payload/layout completion; it does not waive the method's selection, mutation publication or result-completion requirements. Streaming modes use the same ordered transition whenever failure can cover the whole Array. A regional failure leaves independent positions eligible.

Do not replay an operation after settlement. Its deferred producer refines the same captured facts. Later operations compose with that successor, including its declared failure outcome, rather than with whichever physical data happens to be available.

Without !, all nine mutation-capable Array methods return the transformed copy and preserve their source. With !, they publish receiver changes and return the JavaScript method result. This retains the existing uniform observation-copy contract; splice returns removed elements only in mutation mode.

Copy-producing calls, including slice/concat/flat/toSorted/toSpliced/with, use the source Chain's mode for their result:

Compiler-created expression holders preserve that mode under the [temporary-inheritance rule](../poison-policy-plan.md#expression-temporaries). An explicit receiving channel can choose its own policy; inserting an implementation temporary cannot.

| Mode | Result handoff and later failure |
| --- | --- |
| Complete | Pass the source and result validity/access gates before healthy handoff; relevant structural failure returns ordinary root poison. Stored payloads can remain pending. |
| Sequential stream | After root validity, return a partial copy. Later production publishes the specified regional Errors or positional flags in that captured copy. The root is not replaced retroactively. |
| Unordered stream | After root validity, return a partial copy and preserve guaranteed survivors. A later ordering-only failure creates no positional Error or missing-output marker. |

Sort and toSorted are exceptions to position-only recovery: explicitly requesting sort requires ordering, including in unordered mode. Required sorting success precedes result access; no healthy unsorted fallback escapes after comparator failure. A pending sort cannot hand off guaranteed survivors or its fixed undefined/hole suffix before a possible whole-result failure is excluded. Other methods retain their selected positional fallback. Required work still completes; no mode cancels already-required callbacks.

Mutating calls have a separate receiver and direct result. When success returns the receiver, protect its published value as soon as it can escape. A later write can proceed while the direct result still waits to learn whether it succeeds. Streaming receivers can publish permitted regions while the direct result retains its required control/effect dependencies. Complete mode keeps candidate changes private until success and gates all receiver consumption while earlier work could still poison the Array, even an unchanged prefix. Failed mutation marks retained current data and repair clears that flag. An independent Error result or ordinary payload rejection is not failure of a successful mutation. No payload-only wait is added. Required target/category/authority, with index validity, sorting, and complete-mode structural validity precede the handoff they protect. Nested concat/flat contributions instead use the streaming regional rules below. The [streaming capacity rule](../iterate-plan.md#streaming-capacity-revision) applies to finite copying operations and open producers alike; capacity alone does not gate a streaming copy root.

The [failure inventory](../poison-policy-plan.md#whole-array-failure-in-streaming-modes) fixes these boundaries independently of timing. Root Error is not an alternative to a required streaming marker just because every input is already ready or no item has yet been consumed. Separate result failure cannot retroactively invalidate either a handed-off partial result or independently published receiver data.

For a mutating call, first account for the controls and publications needed for its prescribed effects. Deliver their required failure through the direct result even when the nominal return value is determined. With `a=[A]`, `a!.splice(failedStart,0,X)` owes a positional insertion. Its direct result reports the start failure, including on an unordered channel whose receiver fallback is healthy `[A,X]`. With no inserted X the same call commits its prescribed length write and returns `[]` without the start. On a successful removal, a pending removed payload delays only the direct value that consumes it. In a copying call, transferring an inherited structural Error as a placement preserves its role even in complete mode. A fresh structural validation that consumes the failing fact follows the copying call's own failure policy.

For complete-mode reception of a streaming-produced oversized Array, distinguish existing-data access, genuine mutating no-ops and newly produced Arrays. Check an effective edit's candidate count. Splice's successor and its removed Array have separate counts, so a valid receiver change commits even when the oversized removed result returns capacity Error. A streaming mutator applies its loss and count limits at that command and reports required growth beyond the count cap through its direct result. [Cross-mode capacity](../iterate-plan.md#complete-mode-receiving-an-oversized-value) · [Removed-result capacity](../iterate-plan.md#oversized-removed-result-in-complete-mode) · [Tail causes and result failure](../iterate-plan.md#tail-causes-and-result-failure)

### Publication by method family

All families honor an earlier whole-Array or ancestor failure before exposing any affected item. Complete mode also gates an operation while its own structural failure could block the root.

| Family | Earliest result the kernel can publish |
| --- | --- |
| `push`, `unshift`, `pop`, `shift`, `reverse`, `toReversed` | Established ends and retained occurrences. A mutator's returned count or removed value can still depend on its own selection. |
| `concat`, `flat` | Independent contributions and guaranteed occurrences, subject to the depth, cycle, ordering and capacity rules. |
| `slice`, `with`, `fill`, `copyWithin`, `splice`, `toSpliced` | Established survivors, replacements and selected regions. A required `with` index must be valid before handoff. A splice mutation has a separate removed result. |
| `at`, `includes`, `indexOf`, `lastIndexOf` | The selected value, or a scalar answer as soon as proved. An eligible match settles `includes` even with its exact index pending. A numeric answer requires the winning index and exclusion of earlier candidates in search order. |
| `join`, `toString` | One string or the required conversion Errors, after every contributing part has finished. |
| `sort`, `toSorted` | The successful permutation after required comparisons and failure collection. A comparison-free input can discharge the comparator immediately. |

## 2. Closed fact and query vocabulary

Use captured placement selectors, spans, joins, reversal, restriction, repetition/holes, conditional selection, and method-specific deferred regions. Keep the following facts separate:

- captured Array access validity and any still-required whole-Array failure decision;
- shape: exact count, conservative bounds, and the semantic count producer;
- presence and source selection at a front/end-relative coordinate;
- guaranteed occurrence membership, independent of numeric position;
- payload availability;
- status/structural Error membership;
- prescribed writes and direct-result completion.

The required reductions are exact arithmetic on ready controls, interval exclusion, identical captured selectors, identical normalized coordinates, shared internal guards, endpoint composition, clamped-affine count fusion, empty ranges, and each method's ordinary comparisons/short circuits. Reuse the [common rules](array-iteration-technical-analysis.md#3-small-common-reduction-rules). No combinations of hypothetical comparator outcomes, old-payload equality pass, cross-lookup provenance registry, or general constraint solver are required.

Identical-selector and span-coalescing reductions are fact-specific. Equal payloads or the same Error object cannot merge different presence, own status or structural roles. A flagged hole and a healthy hole are not interchangeable, and a structural Error retains different iteration/search prerequisites from ordinary payload poison. Preserve the full facts needed by each consumer and keep prescribed writes separate.

Every remaining question retains its actual pending prerequisites. On failure, apply the declared footprint after the required reductions; do not make poison unconditional while another fact can prove it irrelevant. More conservative progress is permitted outside those required reductions. Storage layout, settlement timing, and accidental discovery order never select a different rule.

A fact may publish when every still-possible outcome of the captured operation gives that fact, including failed controls and failure at its Array or an ancestor. Apply this test to the fact being consumed. An item holder can carry an ordinary pending payload, but cannot escape while selection failure could suppress its body. For example, every successful insertion of X into `[A]` retains X below capacity. In sequential stream a failed insertion position can flag X, so X’s mere survival cannot authorize a body. Pending controls are not Errors, holes, omitted output, or chosen fallback coordinates. Exact method results, sparse presence, occurrence multiplicity, aliases, and prescribed writes must match the all-ready sequential execution. Internal over-approximation can postpone a proof but cannot establish a false answer or a new failure. Repeated source provenance cannot remove callbacks or conversions that ordinary equal-valued inputs still require.

### Failures in repeated occurrences

Evaluate every demanded input under the all-ready rules. Within one source operation, repeated failures of the same intrinsic check use one immutable Error at that operation, across ordinary Arrays, repeated spans, aliases and deferred delivery. The check and its reason identify the failure, such as converting a Symbol to text. An independent host throw or input Error keeps its ordinary causal identity. Unused arguments and skipped branches perform no validation. [Error identity and collection](data-limitations.md#errors)

For `a = new Array(2)`, issue `a!.fill(s, 0, end)` and `a.join()`, with s a Symbol and end delivering 2. Both conversions yield the same `ScalarConversionFailed` leaf. If both positions already carry poison E, joining returns E itself. A default sort of three Symbols and E owes two leaves, the shared conversion failure and E. An implicit join for a separator, index or sort key follows the same rule. A later invocation creates its own diagnostic.

For `c[0] = c`, unlimited flattening of `[c,c]` encounters the same intrinsic cycle check twice. Complete returns one `InvalidArrayOperation`. Each stream preserves two marker positions with that same cause. Copying an existing marker twice also preserves its cause. Access, skip counts and subsequent collection must agree with the original result. [Flat discovery](#discovery-and-payload-retention)

If two nested Arrays each exceed the engine's string-size limit on conversion, their enclosing join receives one intrinsic text-size failure. A separately supplied Error with a native RangeError cause remains a distinct leaf, even with the same message.

#### Native diagnostic list capacity

In a stream, fill `new Array(0xffffffff)` with one Symbol, push two more values and call `join("")`. Both lost slots carry the push’s single capacity Error. Once the separator succeeds and the captured extent exceeds the native limit, joining returns one recoverable `InvalidArrayLength` at the join. A prefix of Symbols, a healthy prefix and a prefix held pending all take this same bounded-cost path.

A failed required separator wins before element conversion. An ancestor blocker wins before reaching its retained Array. A point read in the tail still gives the push’s own Error. A two-slot slice of an ordinary poison E repeated across the prefix reports E itself. In `getErrors({a: wide, b: F})`, the reached oversized Array supplies its capacity failure and the independent field supplies F. A held b can delay the outer report. Copying placements, search, cursor pulls and selected comparator arguments keep their own consumption rules. If a collection of otherwise representable inputs has too many distinct leaves for its native diagnostic Array, the combining boundary returns one capacity Error. [Error reporting](data-limitations.md#errors) · [Compound collection](error-handling.md#compound-errors) · [Logical count cap](../iterate-plan.md#maximum-logical-count)

While the captured length can still fall on either side of MAX, keep the full consumer's two outcomes conditional. At model MAX=2, let an open append-only command add zero or one item after `[E, 0]`. A full query returns E on zero and a query-local capacity Error on one. A point read of zero already gives E, and `hasError` is already true. Only the full report needs this width decision. Keep bulk diagnostic work compact and perform any observable action exclusive to one branch only after selecting it. Once a lower bound exceeds MAX, release the prefix's diagnostic work immediately.

## 3. Unknown lengths and shared controls

### Preserve normalizers, not independent intervals

Represent a relative boundary as a view of its captured length and argument:

```text
normalize(L,n) = n < 0 ? max(L+n,0) : min(n,L)
```

The numeric result may be pending; the relationship is already known. Preserve omission, explicit undefined, integer conversion, infinities, and validation under the existing method rules. Bounds are cached projections of this relationship, not a replacement for it.

Two uses of the same internal captured normalized fact have one outcome. A split at S has counts S and L-S whose total is L. Splice's removed and retained suffix counts share one normalized deletion fact. Tree splitting, materialization, or balancing must not break those identities. Distinct argument positions are independent controls under the [API boundary](../iterate-plan.md#captured-control-identity-at-the-api-boundary), including when they receive the exact same Promise or Error. Successful normalized values can still be compared; self-copy follows proved numeric equality, not shared argument identity.

If the source length is unresolved, keep named count operations and end-relative coordinates. Do not substitute a guessed L. Positive fixed bounds can often be discharged by membership questions; negative bounds retain their source-end relationship. For example, in-range output i of copyWithin(t,s,e) selects a copied source only when i >= t and i-t < e-s. Its exact source is then s+(i-t). Prescribed writes additionally require normalized t!=s and the sparse/status rules below. Exact L is unnecessary when the required predicates are established.

### Correlation and fallback

The rectangular bounds formulas apply only to independent normalized controls at a fixed source length. Preserve relationships derived within the method: source-length normalization, deletion clamping, and repeated uses of one internal fact. If a fallback selects a normalized boundary/count, reuse that selected fact throughout its mapping. It is a failure-layout choice, not a replacement application argument or a retry.

For length six, `splice(P,P,X)` has separate start and deletion-count controls even when P is one poison or rejected Promise. Raw failure gives start range [0,6] and a deletion count clamped to [0,6-start]. The streaming fallback chooses start 6 and deletion count 0, producing six structural Error slots followed by X; sequential mode flags X's uncertain intended position, while unordered mode leaves X usable. The direct removed-elements result still fails, and complete mode uses its whole-Array failure boundary. No [1,2] range can be inferred from P's identity or source expression.

Fallback preference is deterministic: splice chooses the latest admissible normalized start, then the smallest permitted deletion count under that start; slice chooses the earliest start and latest end; flat chooses depth zero for a raw failed depth. Derive all dependent extents from those internal choices. Retain symbolic source-length relationships when necessary, without enumerating argument values or selecting a fabricated raw input. A control whose normalized possibilities collapse to one irrelevant outcome adds no poison.

Failed run arguments retain only the domain supplied by method semantics and captured layout facts. On known length L, a raw failed relative boundary normalizes to [0,L], and a failed deletion count at start s clamps to [0,L-s]. Raw failed flat depth permits every nonnegative integer and Infinity. Application expressions that fail do not attach narrower domains to their Error. Any narrower internal range needs a named derivation; the arbitrary intervals in arithmetic probes are not supported run inputs.

When other necessary inputs, including L, are still pending, retain the fallback recipe as a deferred region. Publish its independent prefix/suffix/shape facts now; calculate numeric offsets only when needed. A failed control does not force unrelated controls to settle, but it also cannot supply their missing facts.

## 4. Fallback preserves the semantic bounds

A failed required control in Complete mode supplies no successful candidate length. For a full native Array, `splice(failedStart, 0, X)` reports the start Error. A valid start instead reports capacity failure. While start is pending, failure is certain and its cause is still undecided. A Boolean status query can finish. An exact Error result waits for the cause. Repair can supersede the flag once the retained data and every intervening effect are fixed. In a stream the failed start has an actual fallback mapping. For an ordinary X, the end insertion loses X at MAX. Its mutating result collects both the start and capacity causes. The tail slot has the capacity cause. Sequential positional flags and unordered survivors in the prefix follow the start rule. A structural Error already present in an input remains a captured placement. Complete `concat` can copy that placement and a healthy suffix into the same result. [Capacity proofs](../iterate-plan.md#required-capacity-proofs)

Construct a permitted output arrangement, then classify its occurrences:

1. Keep a guaranteed survivor's captured payload.
2. Sequential mode flags that survivor if its intended position is not established. Unordered mode accepts its deterministic fallback position without positional poison.
3. Replace uncertain survival/content selections with permanent structural Error; discard candidate payloads no live capture needs.
4. Use a missing-output marker only for a contribution with no established output placement representing its failure. An existing structural Error span is not supplemented with a diagnostic marker.

The arrangement must preserve all established facts, even facts not yet observed. Include fallback in capacity and publication proofs. A skeleton never authorizes a guessed healthy value or restoration of a potentially deleted candidate. Streaming positions beyond the successful Array limit contain structural Error under the common tail rule, never a healthy retained payload.

Ordinary edits move/copy/remove Error slots and positional flags with their logical occurrences. Overwriting a destination replaces its prior local status. A genuine ancestor/path blocker remains a prerequisite until explicit repair or replacement. Complete mode applies its whole-Array structural failure boundary before consumption.

## 5. Endpoint and copying families

Mutating `push`, `unshift`, `pop`, `shift`, and `splice` prescribe a length write even when the successor length equals the predecessor length. On success they advance receiver identity once, including `push()` on an empty Array. Apply the candidate-length and direct-result rules to that same write decision. A proved self-copy prescribes no write. [Capacity by mode](../iterate-plan.md#capacity-by-mode) · [Managed identity](data-limitations.md#managed-identity)

| Methods | Mapping and failure behavior |
| --- | --- |
| push/unshift | Join k captured payloads after/before the source. Count L+k. Preserve payloads independently wherever their final/fallback position is proved below the successful Array limit; apply mode-specific capacity failure elsewhere. Unknown L leaves append indexes and any affected capacity eligibility pending. |
| pop/shift | Retain all but the last/first occurrence; count max(L-1,0). The mutation's removed-value result is independent of the surviving receiver; an empty source returns undefined. Observation returns the shortened copy. |
| reverse/toReversed | Reverse orientation and preserve L. toReversed densifies holes. No payload reads are required to move occurrences. |
| slice | Restrict to normalized [s,e), preserving holes. The known-length range/fallback rules are in the [bounded analysis](array-iteration-technical-analysis.md#determined-shape-slice-and-fill). Unknown L retains the same restriction over captured normalizers. |
| splice/toSpliced | Join prefix, k inserted payloads, and suffix after normalized deletion. Preserve correlated count L-d+k. Mutating splice separately selects its removed [s,s+d) result; observational splice returns the sparse successor; toSpliced returns the dense successor. Use the [bounded splice rule](array-iteration-technical-analysis.md#5-a-bounded-splice-fallback) with the internal normalizer relationships above; argument positions remain independent. |
| with | Prove replacement-index validity before root handoff; invalidity returns result-root Error without changing the source. Bounds may prove validity before exact length is ready. Replace exactly that position and densify the copy. Its old payload is unused. An irrelevant replacement payload is not consumed when validity already fails. |
| concat | Each valid Array part contributes its captured sequence; another healthy root contributes one value. In streaming modes, an unresolved part is a deferred contribution and a failed required part root contributes one structural missing-output marker. Neither blocks the root or independent parts. Complete mode retains required part-root validation before healthy handoff. Concatenate semantic counts, including marker fallbacks, and apply mode-specific capacity publication. |

Indexed writes, length writes, and deletion use the same shape/override boundary. Known-index assignment establishes its slot and growth; a rejected payload poisons only that value. A general unresolved property key is not yet an index and may select length. A failed required length/key selection follows its existing whole-path boundary, not an invented regional resize. Deletion removes the selected data and status without consuming an unused payload or shrinking length. For a member of the virtual tail, apply the capacity projection before publishing the point override and its identity. [Virtual positions](../iterate-plan.md#virtual-positions-and-full-consumers)

The single-element results of `at`, mutating `pop` and mutating `shift` extract the selected slot's visible value. If the Array at index 0 has its own blocker, extracting that slot returns its Error. A successful removal still contracts the receiver. Mutating `splice(0,1)` constructs a removed Array and transfers the slot's own status. Repairing that slot can expose its retained data. A new holder built from the extracted Error has only the Error. Repeat with a registered external identity stored outside its canonical location. Direct extraction reports `ExternalCapabilityEscape`. The removed Array can retain the inert identity, and exporting it reports the escape. Iterator delivery uses the captured-placement boundary. [Direct extraction authority](data-limitations.md#mutation-location) · [Item boundaries](../iterate-plan.md#item-boundaries)

The [selected resize/append rule](../iterate-plan.md#assigned-length-validity) retains that barrier to subsequent push/unshift in streaming modes. A later appended value's successful survival does not exclude earlier whole-path failure or establish its capacity eligibility. Reuse existing gates and bound proofs; add no special append-through-poison path.

For a valid streaming receiver, `[A].concat(part,[B])` can expose A while part is pending. A failed required part root gives the schematic layout `[A,marker,B]`; this is structural failure, not a healthy singleton Error payload. B retains its position/capacity dependencies and sequential-mode positional status where required. An unbounded earlier part can prevent proving B below MAX even in unordered mode. Existing Error elements inside a known Array part retain their captured roles. Ready poison and delayed rejection use the same rule.

If a second sequential `concat` appends C to that Array, C stays healthy whether the first call's part was already failed or rejected after the second call. The second call consumes the marker and B's existing status. Only a failed argument root of the second call can newly flag its following operands. This applies with the first Array as receiver, as an argument, or after handoff through a complete channel. [Concat regressions](../test/array-structural-work.test.js)

A moved slot carries the outcome of the write that selected it, even when the cursor consumes it after publication. For example, if a write through the scalar 20 in `[10,20]` fails and a copy prepends 5, unordered iteration yields 5 and 10, then rejects with that failure. Repairing index 2 exposes 20. A new positional flag combines with the selected slot's own failure. A reader can observe that status while a healthy payload hidden by the flag is still pending. [Cursor and repair regressions](../test/array-iteration.test.js)

When a slot moves past the native limit, its selected role determines the cause. Prepending one value to a full Array whose last slot holds a permanent marker preserves that marker and returns the new logical length. If an earlier entry replaces the marker with an ordinary value, the prepend loses that value and returns its own capacity Error. Independent new loss can establish the direct Error while the first slot's cause is still pending. [Capacity regressions](../test/array-capacity-layout.test.js)

A Complete capacity check asks whether the candidate has a slot at MAX. Separate preparation that decides whether a candidate exists from facts needed only to measure that candidate. For a full receiver, `a.concat([X],p)` returns p’s Error if p fails part classification and a capacity Error if p is an empty Array. The exact result still needs p. If p has already supplied a healthy Array with open append-only width and no possible root failure, the prefix alone proves capacity failure. Its width can stay open forever. Likewise, on an inherited oversized Array with two known sortable values, an invalid required comparator fails before a permutation exists. A valid comparator whose argument export encounters a structural tail Error reports that Error without invoking the comparator. Apply capacity to the candidate that reaches publication. Once the upper bound fits, release healthy results and independently selected slots that meet their other validity requirements. For example, a known last value below MAX supplies index zero of a reversed copy even if the exact count is still pending. An oversized Array has a present structural Error at its last index, so mutating reverse prescribes a write there. A copyWithin between two known hole ranges can still forward an oversized receiver. [Capacity regressions](../test/array-capacity-layout.test.js)

## 6. fill and copyWithin

A proof of zero writes forwards the captured shape, including an open count. For `[A]` with one earlier optional, capacity-safe append, `fill(X,p,0)` and `copyWithin(0,0,p)` preserve index zero while both the issuer and p stay pending. A length query still distinguishes one position from two. Mutation forwards receiver identity. Each observation constructs its own copy under the usual result-capacity rule.

### fill

For known L, start bounds [a,b], and end bounds [c,d], [b,c) is definitely overwritten, positions before a or at/after d are unaffected, and the remaining selected region is conditional. A failed relevant bound makes the conditional destinations structural Error. The definitely overwritten region retains the supplied payload without reading old values. Empty bounds and identical-selector reductions apply first.

Retain this predicate over symbolic normalizers when L is pending. The output shape remains exactly the source shape. A later append is outside this captured extent. No Array-wide flag or extra marker is needed for destination-local selection failure.

### copyWithin's coupled coordinates

For an in-range destination i, normalized target t, start s, and end e:

```text
selectCopied = i >= t and (i-t) < (e-s)
selected source = selectCopied ? captured predecessor[s+(i-t)] : captured predecessor[i]
writeRange = t != s and selectCopied
```

Evaluate the guards left to right. The offset is nonnegative and the selected sum is below e, which is at most L. Every evaluated coordinate is therefore an exact Number, including near Number.MAX_SAFE_INTEGER. Forming s+i before subtracting t can round to an adjacent slot. The in-range check i<L already clips the destination. Read from the captured predecessor for overlapping copies. At t=s either branch selects i, end is irrelevant and the method prescribes no writes. A write-range candidate still has the sparse/status rules below.

For known L and independent bounds t=[t0,t1], s=[s0,s1], e=[e0,e1]:

```text
tMax = min(t1,i)
possible copied sources are empty if t0 > tMax, e1 == 0, or i-tMax >= e1-s0
otherwise:
    lo = s0 + (i-tMax)
    cap = e1-1
    base = min(s1,cap)
    hi = base + min(i-t0,cap-base)
    possible copied sources = [lo,hi]
always selects copied branch = t1 <= i and (i-t0) < (e0-s1)
```

Include original source i when copied-branch selection is not definite. These bounds describe possible payload sources, not a write proof. A definite write-range proof also excludes t=s across all remaining permitted controls; with independent intervals, disjoint t and s intervals suffice. Preserve shared normalizer relationships rather than applying independent-interval tests to correlated controls. Each candidate names a predecessor position. A single possible position, or a choice entirely among clean holes, is independent of the control. Distinct positions with a present or flagged candidate retain the dependency, including after copying or filling them from the same input. A definite copied branch with one source forwards that position immediately. A relevant failed selector produces structural Error at that destination; unaffected sources are not poisoned. Do not enumerate every candidate index to represent a range.

Use the same candidate range to answer whether a body can run. If the old slot when selectable, every possible copied slot and the selector-failure outcome all obstruct iteration, the destination is already known to obstruct. Its visible cause, underlying role and retained data can still depend on the selector. For example, start with a flagged A, permanent marker F and healthy B. After streaming `copyWithin(0,p,2)`, position zero is always blocked. At p=0, exact repair of that slot exposes A. At p=1, repair leaves F. A relevant rejection of p creates permanent structural Error there. An unordered skip can earn credit in all three cases. A structural copy or repair must preserve the selected placement. Replacing the flagged A with an ordinary Error payload makes a body possible again. Use captured range summaries and the existing placement transfer for these projections.

For a repeated `[E,F]` marker prefix of length N followed by B, `copyWithin(0,p,N)` can skip the prefix in bulk while p is pending. B keeps index N. A bounded consumer earns N credits and a streaming output retains N positional causes. For p=1 the first output marker is F. On selector failure the first marker carries that failure, while the last still carries F. Exact repair of either output marker completes as soon as its permanent role is known. A copy of a source slot that may instead carry a removable flag still needs its selection for repair. A cropped or reversed capture preserves the relevant causes in its own order. A later bound that excludes an already captured prefix releases its reads and failure queries even when another control remains pending. A whole-Array `hasError` can also finish from a proved obstruction inside its captured range or an unchanged slot containing a nested Error. On `[A,E,F].copyWithin(0,p,3)`, every copy reaching the last slot selects F itself. On `[A,E,F,Z].copyWithin(1,0,p)`, index two can select only E or F. Both queries return true before any point lookup or delivery of p. When E and F are ordinary Error payloads, the possible bodies still run and the Boolean failure query can use their known poison. On `[A,E,Z].copyWithin(1,0,p)`, end one can remove the sole failure, so the query still needs p.

If normalized target and source are provably identical, prescribe no writes and ignore end. Otherwise preserve ordinary same-value writes and sparse semantics: copying a hole deletes a present destination; copying a clean hole onto a clean absent destination publishes no placement change. Status transfer or clearing remains an effect. Write identity follows the method's prescribed effect, separately from content selection.

Test for a **possible non-self write** on the potentially nonempty range, as in the determined-range evaluator. At fixed L with independent normalized bounds, restrict possible starts to `[s0,min(s1,e1-1)]` and targets to `[t0,min(t1,L-1)]`. An empty interval, or two singleton intervals at the same coordinate, excludes every write. At one destination, an empty copied-source range or one containing only i likewise excludes a non-self write there. Preserve captured correlations for variable L. On `[A,B].copyWithin(0,p,1)`, the only nonempty copy has start zero. The mutation returns its receiver with the original identity for ready, failed or never-settling p. This proof needs neither p nor a payload comparison. [Current range contract](data-limitations.md#logical-arrays)

Witness: after [A,B,C].splice(2,p), successful p=1 gives length two and copyWithin(0,-2) is self-copy; p=0 gives length three and the call writes from index one. The same pair with repeated X payloads has equal selected values but different write/identity outcomes. Neither the source-selection formula nor payload equality certifies effectiveness. Sparse own-status transfer also counts as an effect even if both old and new placements are absent.

## 7. sort and toSorted

### Successful production

Capture source data presence and occurrence order before consuming sortable roots. A pending value keeps its original payload producer. Both sorts place present non-`undefined` values first, then present `undefined` values, then the captured holes in their original relative order. Carry each hole's own status through that partition. A count suffices for a run of clean holes. Sparse sort preserves absence. `toSorted` makes each hole a present `undefined` with its captured status.

For an accessible `a=[, "A"]` with own flag F at index 0, `a!.sort(42)`, `a.sort(42)` and `a.toSorted(42)` all put `"A"` first. The single present value requires zero comparisons. Index 1 carries F. A cursor can deliver `"A"` while F's cause is pending. An issued step that must report F still needs its cause. Exact repair at index 1 exposes a hole for either sparse sort and a present `undefined` for the dense copy. Earlier captures retain F at index 0. Two present sortable values would require comparator validation and its ordinary whole-sort failure boundary.

Apply semantic comparison-free proofs first: fewer than two sortable occurrences needs no comparator/default keys. Preserve the ordinary permutation, hole rules, and prescribed writes. Two or more occurrences do not lose comparison obligations because their payloads share a selector or happen to be equal. Otherwise prepare every required default key or one canonical comparator snapshot of all comparator-visible values. Keep aliases within that snapshot. Literal construction, fill, copying, and materialization must preserve the same logical callback/poison requirements.

Once a needed supplied comparator fails selection/validation, callback-only argument export is irrelevant; do not await its nested data or switch to default-key conversion. Such preparation failures remain conditional until comparator selection establishes that they are needed. Keep the original payloads and source-classification/presence work still required by the failure boundary; do not materialize a fallback permutation. Later deep consumers still observe retained payload errors; fatal failures retain their normal boundary.

Apply relevance to the top-level roots as well. In `[2,1,p].sort(42)` the first two already establish comparator demand. The failure boundary needs no value from p merely to count another sortable item or to build a permutation. Its ready poison, deferred rejection or indefinite wait cannot add a cause to comparator validation. A mutating failure retains p in the receiver for repair. In `[2,p].sort(42)`, p resolving to undefined can instead remove comparator demand. Keep that decision conditional. Independently required source inspection retains its own boundary.

Run the existing stable sorting algorithm only after required preparation is complete. Comparator execution remains synchronous with the existing Number-result validation. Stage the permutation privately under ordinary captures; publish sort data writes only after preparation and comparison succeed. Do not call the comparator speculatively, sort arrivals in settlement order, invoke it again to recover from failure, or expose a partial native permutation.

Omitting the comparator removes callback failure, not all sort failure. Required source delivery, presence discovery and default-key conversion can still fail. Cascada's intrinsic conversion invokes no user coercion hooks, but a consumed Error, a rejected required value or an unsupported scalar-conversion category remains a failure. Once required source facts and all default string keys are established, intrinsic string comparison adds no recoverable failure dependency. Apply comparison-free proofs where possible; do not add a second health scan. Infallibility alone does not establish the permutation, and does not remove the selected sort publication barrier while ordering is unresolved.

### Whole-Array failure

Apply the [normative sort failure contract](../iterate-plan.md#13-selected-decisions) for mutation versus copying, every Chain mode, repair, identity, and post-ordering publication failure. This is the whole-result exception to the ordinary regional fallback evaluator; add no independent sort fallback policy here.

A known required key failure settles the mutating owner's status once the failed outcome and retained data are fixed. Carry unfinished collection in that flag’s cause. Reuse the same owner transition as a certain capacity failure. Boolean queries and exact repair can finish before the consumers that require the complete Error. A still-conditional key failure retains its demand test. [Ordered repair and captured causes](../poison-policy-plan.md#publishing-a-nested-mutation-at-its-owner)

The same proof applies while a comparator is pending. For `[E,1].sort(cmp)`, any successful comparator selection consumes E during preparation. Invalid selection gives its own Error. Both outcomes preserve the data and fix the failed owner, so exact repair can finish while the cause still waits for cmp. An established default-key failure in the stable prefix of an open append has the same publication boundary.

If inspecting slot zero of a captured `[0,2,1]` prefix fails, 2 and 1 still establish comparator demand. Sorting with 42 reports both the descriptor failure and `NotAFunction`. An open, append-only suffix can remain pending throughout that report. Closing it before the sort observes the same causes.

An unconsumed Error inside a retained payload remains payload Error. If preparing that payload is required to sort and fails, it contributes to the whole-sort failure; do not invent an unrelated failure or discard its causal identity. Existing source blockers propagate through their normal boundary, and unused comparators still introduce no failure. Any retained data preserves its payload producers, holes, aliases, and existing structural roles.

Fixed undefined/hole partition facts may be calculated privately under the contract's publication barrier. Observations captured before the sort retain their own earlier values. Successful sorting keeps its ordinary prescribed-write and identity rules.

## 8. flat

### Discovery and payload retention

Walk captured present occurrences in source order. At each traversed level, exclude definite holes using data presence before reading status or classifying a value. For `[, "A"].flat(Infinity)` with a flag over the hole, every mode yields `["A"]` even while the flag's cause stays pending. The source still carries the flag. A status hiding a present value can affect required expansion. At depth zero, transfer that placement with its status. At positive depth, consume only the root needed to distinguish a logical Array from a retained leaf. Repeated references produce repeated output occurrences.

Complete mode retains required discovery/depth/cycle and capacity validity before healthy result handoff. The two streaming modes keep unresolved nested expansions as deferred contributions. Required discovery/selection failure affects that contribution: preserve its already established output and insert one structural missing-output marker at the failed sub-contribution if no established placement represents the failure. Do not scan all branches or prove global acyclicity before handing off a streaming root. Initial receiver selection/category/authority still precede use; failure to obtain any source Array is not a nested contribution. Streaming capacity transforms the affected output tail independently.

Pending work remains pending, even indefinitely; a marker requires actual relevant failure. Known payload Error at a retained leaf remains value poison when no expansion classification consumes it. A failed root needed to decide whether to expand is instead a structural discovery failure. After failure, preserve sibling contributions and use their ordinary position/capacity dependencies and positional-status rules. Include marker outcomes in bounds before publication; do not retroactively move an established suffix.

At depth Infinity, detecting an active Array-ancestry cycle creates InvalidArrayOperation at that recursive edge. Complete mode fails the result. Streaming modes cut that edge with one structural marker and continue independent siblings. Share captured inputs by identity. Determine a back-edge from the active ancestry of the current occurrence. Reuse a completed expansion only when its result is independent of a change in ancestry or the relevant ancestry agrees. Given `const c=[X]; c.push(c)`, `[A,c,B].flat(Infinity)` has streaming fallback `[A,X,marker,B]`, subject to the common positional-status/capacity rules. Earlier X is retained; no second marker replaces the whole c contribution. Repeated aliases outside active ancestry are not cycles, and distinct recursive occurrences are not deduplicated by identity. Reuse captured ancestry and contribution state; no global cycle preflight or historical failure registry is needed.

For `A=['a',B]` and `B=['b',A]`, streaming `[A,B].flat(Infinity)` yields `['a','b',marker,'b','a',marker]`. Reusing B's output from inside A at the second root loses a surviving leaf. Verify both root orders, repeated siblings and a deferred back-edge. The input edges still need only one capture per identity.

Depths that reach the same captured leaves can share their established bounds and placements. Each unfinished occurrence retains its own remaining depth and active ancestry for subsequent discovery. At finite depth an unsettled logical identity comparison alone cannot delay a physically determined result. At unlimited depth it can determine whether a recursive edge takes precedence over a descendant's inspection failure. One delivered root can expose an item while another root in the same shared Array is still pending. An already-issued point read must then deliver the item as soon as its position is proved. [Streaming regressions](../test/array-flat-stream.test.js)

For the singleton cycle `const a=[]; a[0]=a` and unrestricted pending depth, finite depth retains a cyclic value whereas Infinity produces the mode-specific cycle failure. The affected contribution therefore waits; a partial root does not certify an element. Complete mode retains whole-result safety until required validity settles. Streaming modes do not make this branch a root prerequisite for independent leaves: a failed depth uses the regional skeleton below without exploring a hypothetical Infinity expansion. No mode treats a legal pending depth as failed.

Finite depth is semantically consumed on descent, but repeated Number subtraction is not a sufficient implementation: `2**54 - 1 === 2**54`. Complete and streaming modes share the [captured layout expansion](../src/array-flat.js) and [input capture](../src/array-flat-stream.js). A singleton cycle produces one retained cyclic value at every finite depth. Branching cycles can exceed capacity. The saturated layout length determines Complete validity and streaming capacity projection before publication. Streaming retains the representable prefix and a compressed tail with its causal Errors. Preserve the accepted finite-depth domain without BigInt, an implicit cap, or conversion to Infinity. Memoized subtree/depth work must preserve repeated occurrences and release with its live uses; never traverse unrelated data merely to build a cache.

### Failed depth

First prove that depth can change an output fact, including its structural role or a required discovery failure. A healthy classified non-Array leaf survives at every depth. A recoverable payload Error E gives a different result. In `[E].flat(d)`, depth zero transfers E as payload and its body runs. A positive depth consumes the root for discovery. Complete mode returns root Error E, while a stream gets a structural marker carrying E and no body for that slot. While d can still select either case, the streaming root may escape but its occurrence cannot. If d itself fails, the depth-zero skeleton marks the affected slot with that depth failure. Collect independently required causes only. Discovery on a hypothetical positive-depth branch adds no cause. A never-settling unclassified root can leave relevance pending.

For a raw failed depth in a streaming mode, use depth zero to construct the fallback skeleton. An occurrence selected there is healthy only if it survives at every depth in the raw domain under the required structural rules; otherwise replace that skeleton occurrence with structural Error. Preserve guaranteed non-Array leaves and their source order. Sequential mode flags surviving leaves whose positions vary; unordered mode keeps them usable. A retained nested Array is uncertain even when cyclic; its structural Error already represents the failed contribution, so neither a cycle scan nor an additional marker is required. Sparse traversal omits holes at every traversed level. Complete mode returns root Error for a relevant failed depth.

Example: for known non-Array leaves A/B/C, `[[A,B],C].flat(failedDepth)` uses `[Error,C]`, with C position-flagged only in sequential mode. Depth zero retains the nested Array; every positive depth produces A/B, so the raw domain has these two structural outcomes without an invented [0,1] argument restriction. The first Error represents the uncertain nested contribution; add no extra missing-output marker. Complete mode returns root Error. The fallback remains inside the captured count bounds.

An existing marker or structural Error produced by an earlier operation retains its role through flattening. Multiple uncertain existing contributions can have multiple structural Error slots; that is different from adding multiple missing-output markers for one failed producer.

## 9. Searches and scalar producers

Use the [search demand and completion rules](../iterate-plan.md#search-demand-and-completion) over captured occurrence discovery. After splice(2,pendingCount,X) on [A,B,C,D], includes(D) waits for survival; includes(X) can succeed in a streaming mode after root/capacity prerequisites. For Z distinct from every payload, includes(Z) must also wait because count failure introduces relevant structural Error slots, even though all successful counts give false. Put positive and negative witnesses side by side. A negative proof includes the declared failure outcomes; ordinary candidate mismatches can remove controls that affect only eligibility, not an unexamined structural-failure outcome. Complete consumption still passes its source gate first.

The discovery layer may be shared with unordered iteration, but the search retains source mode, range filtering, holes/presence semantics, managed-identity comparisons, and its complete possible-candidate frontier. Do not convert iterator availability exhaustion into false, suppress a pending candidate because it has not yet been delivered, or invoke a public iterator that loses needed eligibility/status facts. A match short-circuits includes; a negative result needs every possible relevant candidate excluded and no relevant open contribution. Negative fromIndex and directional numeric results retain their endpoint/order dependencies.

For example, let an open contribution produce zero or one item before B and C. After dropping or overwriting index zero, C survives both possible outcomes. Once the captured Array is safe to observe, `includes("C")` returns true and an unordered cursor whose window covers both possible indexes can deliver C. A write at index two can replace C, so its match may depend on the open contribution. An issuer that can still append another item keeps an otherwise unsuccessful search open.

Searches can compare a shared captured range once all its positions are eligible. For `includes` with an uncertain start, testing the latest occurrence of a repeated subtree within one moving range covers every earlier copy in that range. Directional searches keep their first eligible match or obstruction. A pending positional status shared by a whole contribution needs one wait. Independent contributions can still produce a match. [Search regressions](../test/array-search.test.js)

- at consumes the selected captured occurrence, using end-relative coordinates when appropriate. Out-of-range proofs return undefined without consuming its payload.
- includes returns true when a definitely eligible comparison matches. indexOf/lastIndexOf additionally establish the directional first match and numeric result. Holes participate only as the method specifies.
- For a determined range, the first eligible structural obstruction in directional search ends that search with its cause once all preceding candidates are excluded. A preceding match ends it before the obstruction. From `[structuralError,never]`, `indexOf(X)` therefore reports the first cause without waiting for the suffix. `lastIndexOf(X)` and `includes(X)` still allow the pending payload to match. On a miss they report the required obstruction. Any-match failure completes its required cause collection after excluding every possible hit. Ordinary payload Errors retain the documented value comparisons.
- Known mismatches remove candidates before an unresolved range control is consumed. An empty possible candidate set gives false/-1 despite poison arguments. No general search through combinations of unknown comparisons is required.
- `join` consumes its separator only when there are at least two positions. If required separator preparation fails, return that failure at the argument boundary. For `[F,p].join(E)` with E and F as distinct poisons, return E even if p stays pending. `[F].join(E)` ignores E and returns F. After successful argument preparation, `join` and intrinsic `toString` convert the required occurrences and complete their Error collection. A healthy hole contributes empty text. Logical joining reads each slot through its own status, including during nested conversion to a bound or a default sort key. [Failures in repeated occurrences](#failures-in-repeated-occurrences)
- A definite scalar result does not erase an independently required write or call failure. Conversely, private work with no promised effect is not a reason to retain an irrelevant input.

## 10. Sparse data, occurrence roles, and queries

A proved own flag with a pending cause retains the underlying placement for exact repair. Reading its cause captures an ordinary Error-payload property version. A pending selection known to be obstructed can still choose between a flagged placement and permanent Error data. Repair follows that selection because the two outcomes expose different retained data.

Presence is distinct from value. Holes have length but no placement; value iteration yields undefined for a healthy hole. Preserve sparse ranges in slice/splice/concat/reverse/copyWithin, and densify only methods whose contract requires it. Do not walk every hole to update parent relationships or counters.

A hole can carry positional own status on its captured absent-slot fact or symbolic span. Status blocks access without creating present undefined data or a managed-child parent edge. Repair clears status while preserving absence; structural transfers preserve it, including when a dense copy creates the prescribed undefined placement. Explicit deletion clears selected status even on a hole and is then an effective publication. Unordered discovery treats repeated holes as distinct occurrences rather than deduplicating their undefined payloads.

Project data presence, observable status and prescribed effects separately from that same capture. Sparse remapping and parent edges use underlying presence; status discovery also visits flagged absent slots; write detection includes moving, clearing or replacing status. Today's placementPresent helper treats own failure as observable presence, so it cannot supply every projection unchanged. Audit its Array consumers at cutover rather than globally changing it and losing status discovery. Reversing [flagged hole, clean hole] preserves two holes but moves the failure to the other index and is effective for identity. A clean hole copied over a flagged absent destination clears status and is likewise effective.

Take an accessible one-slot capture containing a flagged hole. Sparse `slice` preserves its absence and flag. Densifying `toReversed` creates a present `undefined` with that flag. Depth-zero `flat` drops the hole and returns `[]`. Directional search skips the definitely absent candidate, so `indexOf(undefined)` returns −1. `includes(undefined)`, `at(0)`, `join()` and intrinsic `toString()` consume the slot's value and encounter its blocker. When the same Array is a required scalar input, intrinsic joining encounters that same cause. An independent eligible match can still complete `includes`. Undecided presence supplies no definite-hole exclusion. Each method first requires an accessible Array root.

Store one named numeric structural-obstruction role on the captured placement in addition to the default ordinary payload role. A producer decides whether its output needs a new missing-output slot, its location, and its cause. A published marker and an existing slot whose source selection failed have the same iteration, search, copy, query, and repair behavior. Remap moves and structural copies preserve the obstruction and its cause. Repairable positional status remains an independent own flag. Error identity and delivery timing cannot determine any of these facts.

In Sequential mode a failed start F can displace a slot whose data already carries structural Error S. Lookup, iteration and deep collection see F at that position. Repairing the other displaced positions preserves F here. Exact repair here exposes S, which remains a structural obstruction. [Displaced-slot regression](../test/array-iteration.test.js)

Explicitly receiving a looked-up Error as a new payload creates a new structurally known occurrence: `b.push(a[i])` may therefore hold ordinary payload poison even when a[i] was structurally invalid in a. The failure value remains; b's occurrence is now defined. In contrast, slice/concat/flat and other placement-preserving copies retain the original structural role. Copying an Array as a value also preserves roles inside it. This distinction follows fresh placement construction versus captured placement transfer and requires no Error-provenance registry.

Shallow root/status queries do not scan descendants. Deep queries inspect actual retained output membership, including structural Error slots and flags; input retention is not membership. Conditional membership waits for its deciding facts. A true hasError may short-circuit on a certain retained failure; false and complete getErrors cover the required frontier. Use shared captured query state, never iteration draining or a historical Error log. [Actual structural failure](../iterate-plan.md#search-demand-and-completion) is separate from pending membership; neither can be replaced by comparing a placeholder as negative evidence.

Ordinary point reads, searches, bounded copies and writes through an Array all require access to that captured receiver. An earlier operation that may fail the whole Array gates them even when their index bounds lie inside an unchanged prefix. Once that possibility is excluded, a streaming method uses exactly its required positions. A bounded slice may omit failed slots, and a search may finish from an independent match. A captured predecessor remains usable after a later whole-Array failure. [Whole-Array failure and ordered repair](../poison-policy-plan.md#whole-array-failure-and-ordered-repair)

## 11. Lifetime and publication integration

Use property-version capture for pending inputs and a parent-derived source-occurrence relationship for layout-owned values whose keys are not established. The old repair-only preservation-parent mechanism was removed by D01; it is not available for reuse. Generalize the maintained Array backing/source projection, separating retention/COW relationships from proved output membership and numeric placement keys. Do not create unconditional lease roots around layout cycles. A selection use retains its needed source slice and semantic shape facts separately. Validate pending delivery, aliases, cycle retirement, and re-entry before publishing partial layouts.

### Restrict source retention through the mapping

Propagate a consumer's requested output region backwards through the same captured recipe. This is source retention, not enumeration or another mutation interpreter:

| Recipe | Required source use |
| --- | --- |
| Join | Intersect the request with each possible contribution and translate locally. Retain boundary/count facts separately. |
| Reverse | Reflect the requested interval against the captured source end; an end-relative interval need not await exact length. |
| Restrict or splice | Intersect with retained prefix/suffix and translate by the shared normalized cut. Inserted payloads have their own uses. |
| Fill or point replacement | Drop predecessor content definitely overwritten; retain only possible old selections and selected new payloads. |
| copyWithin | Union the possible old/copied source ranges from section 6. Read the predecessor, never the destination under construction. |
| Sort | Ordering may require the complete sortable group even for one requested position. Retain the captured placements and shape facts that sorting still uses. Once an observational sort has captured those inputs, release the former receiver at its last read. A pending comparator alone needs no reference to that container. Mutating failure still needs its retained data for repair. |
| Flat | Retain candidate nested contributions and the shape/discovery frontier that can select them. Discard excluded branches without consuming their payloads. |

Pending boundaries retain conservative candidate slices and their deciding facts. Narrow them when those facts settle. Retain a value for a length question only when the count calculation consumes it. In `[p].flat(1)`, a scalar contributes one and an empty Array contributes zero. Classify p when delivered and release that source at last access. In `[D].slice(0,p)` the length needs the cut and the count alone. A live output that can still publish D owns its separate content use. Release and refine through the use index, without scanning all consumers of the producer.

### Publish and retire

Transfer a state-preserving compiler reference, expression result or item directly from its captured placement into an ordinary receiving holder through the guarded integration boundary. Carry pending status, ordered transitions, validity and contained roles before raw value projection. A fresh payload constructed from an extracted Error keeps its Error value. An item binding for a healthy hole installs a present `undefined` root, while a sparse structural copy preserves absence. Preserve each destination's policy and owner-isolated repair. [Captured handoff](../iterate-plan.md#captured-state-across-handoff)

When a destination key becomes established, attach its ordinary placement and active counter contribution before releasing provisional preservation or exposing callbacks. Duplicate occurrences have separate keys. A later overwrite/truncation detaches current publication authority immediately; late settlement updates retained historical captures, not the replacement.

Use the final mapped placement after the operation's tail projection and count clip. Reversing a stream of length MAX+1 with child C at zero, holes in between and overflow Error E at MAX puts E at zero and a new capacity Error R at MAX. C's incoming key belongs only to owners that still retain C there. A pending delivery of C can finish the earlier capture without creating an edge on the reversed Array. Point reads of the two selected placements give E and R independently of that delivery. A full deep query on the oversized Array reports capacity at the query.

Retirement removes reverse preservation links, destinations, and optional counter projections. Authoritative forward captures remain sufficient for re-entry without source reinspection or resubscription. Re-entry restores inactive relationships only as needed, stopping at active descendants. Canonical export uses captured generation identities, including aliases and cycles, and releases source access before unrelated collection/assembly work completes.

The runtime bridge probe exercises pending fulfillment and rejection, active-index publication before receiving callbacks, historical snapshots, overwrite before delivery, cycle and alias export, retirement, and re-entry without Promise resubscription. The production regressions also query the actual incoming parent keys of a remapped child before its sibling settles and after retirement and re-entry. [Array structural work](../test/array-structural-work.test.js)

## 12. Work and release bounds

### Notify questions, not every intermediate number

An exact-length query over a sum needs readiness and its final value. It does not need notifications for every narrower intermediate bound. Maintain a separate projected readiness outcome; an unknown exact answer stays unknown until a required reduction or dependency completes it. Recompute optional numeric bounds when demanded by a consumer that can use them.

This is stronger than stopping propagation when numeric intervals are unchanged. In the retained-prefix sum probe, those intervals change on every settlement, causing N(N+1)/2 root updates. Projected readiness produces N final notifications with O(N log N) shared structure work. Membership/prefix queries use their own threshold/selection projections; do not assume exact-length readiness is sufficient for them.

Optional caches must not invalidate or wake every historical root eagerly. Register live question projections against their actual facts and stop propagation when that projection is unchanged. Share identical questions on the same captured fact. Error collection keeps a traversal frontier rather than copying growing Error sets through every ancestor.

### Composition and release

Exercise the production kernel at 5,000 commands with a pending middle cut, pending payloads, overlapping copies, reversals, endpoint edits, repeated slices and independently settling concat parts. Issue point reads before settling the inputs and compare the resulting Array with the all-ready program. Count copies, leases and width updates independently of output size. A sparse search and bounded cursor must also be able to wait on a single unresolved cut through MAX−1 holes. Compare independent cursors over the same rejected capture. [Production depth and work fixture](../test/fixtures/array-history-depth.mjs) · [Independent cursor and window cases](../test/array-iteration.test.js)

- In a retained layout, join, reverse and restriction operate on spans and balanced paths. A determined dense mapping can place its selected source slots directly in private output storage. Densification, identity and complete logical parent relationships specify what that output exposes. They require no intermediate tree or replay. Endpoint count transforms can fuse when they preserve every operation's [lossy tail transition](../iterate-plan.md#preserve-loss-at-each-operation), Error causes, roles and prescribed effects.
- Conditional overwrites use last-effective-write summaries and shared-guard folding. A newer definite replacement drops older content dependencies while preserving owed results/effects.
- Deferred regions retain the candidate slices needed by live uses. Count producers keep any required classification inputs through discovery. Completed count facts carry no payload roots.
- Consume determined subtrees through an unread frontier. Sequential iteration never issues a structurally unresolved source; numeric lookup and unordered discovery can retain their own conditional uses.
- Compact spent forwarding and release chains with synchronous worklists. Do not recursively traverse history-sized chains, rescan a completed prefix, or queue one microtask per internal node.

A wholly structural region can share a count/skip proof across different causes. Collection visits shared captured subtrees once per relevant restriction, respecting overrides, orientation and pending membership. A positional read or restricted copy retains the cause of exactly its selected slots.

Start with two permanent markers, E and one whose cause p is still pending. Each `s = s.concat(s)` doubles the occurrences of those same two captured placements. Joining two uses of one immutable subtree needs one shared dependency on its unfinished cause. The width is exact and every occurrence is already obstructed. Even at bound one, an unordered cursor can credit a whole proved run. Terminal reporting and reads at odd indexes still need p. Resolving p to F yields the two distinct leaves E and F across the entire capture. A later point overwrite has its own destination authority and leaves the earlier capture intact. Measure the work of constructing each join before any reader, as well as restricted reads, collection and skip work. A new Promise reaction or installed version for every position in a repeated span would expand the logical output just to record the join. [Published and newly generated failures](#failures-in-repeated-occurrences)

Count the output the consumer requests. Filling an Array with one managed child and reading its last slot can project that child's logical parents from the shared range. A write through one slot must leave the other occurrences intact. Enumerating all M parent keys or exporting M native slots can take O(M) work. Neither full enumeration is a prerequisite for a point read. Distinct placements that actually move can require individual relationship updates. [Array parents](array-view.md#incoming-placements)

Stress retained versions with all-no-effect controls, exact sums whose bounds narrow before readiness, forward/reverse/shuffled last-write selection, overlapping slices, long ready append/trim histories, a pending middle edit with a long append tail, and repeated aliases/cycles with sources released while unrelated work stays pending.

Measure reading while the controls are held. On `[A]`, issue N zero-delete splices at separate pending starts. Every inserted occurrence survives. An unrestricted search for the last insertion and an unordered pull of every occurrence must avoid N-by-N walks or Promise reactions. The final insertion's index needs its own cut alone. Older indexes and endpoint flags settle as soon as their respective facts decide them, including after cursor return. A bounded pull admits only occurrences proved inside its current window. Repeat with an open predecessor length. When X was inserted at index 1 and a later cut can move it to 2, `includes(X,1)` is already true and `includes(X,2)` still needs that cut. Resolve eligibility independently of the exact index. Apply the same bounds inside a join and after a later parent command. Interleave fixed pushes with the insertions. A joined prefix that grows can prove a match before either its final width or a later insertion rank is known.

Behind `splice(1, pendingCount)`, repeat `push(i,i); shift()` or `push(i); fill(i,pendingStart,1)`. Exercise point reads, the three cursor modes, `includes` hits and misses, positional searches and Error queries. The numeric suffix beyond the last possible replacement stays independent of the earlier controls. Count selection work while pending, then compare values, indexes and failures after forward, reverse and shuffled delivery. Repeated completed searches, suffix slices and closed cursors release their private uses while a source stays live. Share an immutable partition of a capture across readers. For `open.concat([A,B,C]).slice(3)` with an open zero-to-three-item prefix, an earlier search for C and an earlier unordered pull both release C on the first append. B becomes available on the second append. Neither needs the final length. Apply the same rule at the other edge. A subscription for an individual reader ends at its last use. Measure both reader work and retained references. [Pending-history regressions](../test/array-structural-work.test.js)

## 13. Verification and implementation boundary

The design probes compare normalized selectors with native successful operations and exercise sparse writes, sort partitions, flatten occurrences, fallback arithmetic and layout mechanisms. Their artificial control ranges make the arithmetic directly testable. [Method specification probe](../test/experiments/array-method-specification-probes.mjs) · [Bounded fallback and handoff](../test/experiments/array-iteration-contract-probes.mjs) · [Layout mechanisms](../test/experiments/array-layout-technical-probes.mjs)

Exercise each method through the public kernel API with its ordinary input conversion, effects, Error collection and identity reporting. The integrated cases cover flagged holes through handoff and repair, concat and flat contribution failures, finite-depth cycles, and whole-sort failure before a body or sibling write. [Partial splice](../test/array-partial-splice.test.js) · [Capacity and concat](../test/array-capacity-layout.test.js) · [Streaming flat](../test/array-flat-stream.test.js) · [Iteration and repair](../test/array-iteration.test.js)

Use the public-operation, generated sequence, conflict, consistency and lifetime suites when changing shared mechanisms. Representation choices must preserve the selected semantics and work bounds. [Verification requirements](../test/README.md) · [Selected decisions](../iterate-plan.md#13-selected-decisions)
