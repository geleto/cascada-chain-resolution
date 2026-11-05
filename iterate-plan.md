# Ordered Array iteration and partial publication

Implementation design for [Phase 9](docs/runtime-evolution-plan.md#phase-9-implement-incremental-managed-access-and-iteration), using [queryable block layouts](array-layout-approaches.md) and [Variant B](docs/remap-structure-variant-B.md). The [Chain-mode contract](poison-policy-plan.md) is authoritative for the selected complete, sequential-stream, and unordered-stream policies, payload versus structural poison, fallback positions, markers, and [status-only repair](repair-simplification-plan.md). This plan specifies their Array integration and rollout. The initial cursor uses determined layouts; prefix streaming and final unordered occurrence delivery extend the same boundary. The [method implementation specification](docs/array-method-specification.md) completes normalizer/correlation rules, coupled copying, sorting/flattening failure, placement roles, and work/lifetime obligations. Production code is unchanged; update authoritative runtime contracts at each implementation cutover.

## 1. Scope and semantic changes

Implement shallow iteration over captured managed Arrays, including ArrayViews and sparse Arrays. Sequential streaming issues the structurally published prefix in numeric order: membership, intended position, and final payload source are established, while payload values may remain pending or ordinary poison. Complete mode first settles required structural work; unordered mode later delivers guaranteed surviving occurrences without their indexes. Cascada preserves logical command order under every mode.

The selected layout supplies shared partial Array state. Each controlled operation describes a source-to-destination mapping; common machinery composes it with captured predecessors and answers shape, presence, and value queries. Settlement advances affected facts without replaying operations. The iterator only tracks its next numeric position and consumes these queries; it owns no separate layout or prefix-analysis engine.

Partial publication still benefits ordinary reads, searches, copies, writes, and Error queries across every independently available region. Restricting iterator delivery to the prefix does not restrict the shared layout to prefix-only storage. [Section 8](#8-representation-and-lifetime-requirements) defines its integration; the layout document owns blocks, composition, optimization, and the selected storage design.

The immediate workload is a compiled loop over an Array whose positions become usable before all its data does: [pendingA,B], a remap of pending payloads, or a splice with a known insertion point and pending deletion count. The first two already benefit from captured placement versions; the third needs partial layout publication. Measure these separately. This revision does not assume that every pending structural operation exposes a useful prefix.

Production already has captured length bounds and in-range questions in array-length.js/array-view.js, primarily for uncertain indexed growth, plus property versions for pending values. It has no public managed iterate operation and no general partial-layout engine for pending structural method controls. Intrinsic-backed methods still prepare required arguments and exact length before invocation. Extending the existing boundary is the starting point, not an already completed capability.

This revision changes the following contracts:

| Current rule | Replacement in this revision |
| --- | --- |
| A controlled structural mutation gates and, on failure, poisons its whole Array or selected broader scope. | The selected Chain mode defines its structural boundary. Streaming modes publish independent facts and use regional poison/fallback; complete mode retains whole-Array structural failure. Broader authority does not enlarge regional coverage. |
| A failed managed mutation retains the complete scope baseline for repair. | Controlled regional failures have no repair baseline. The policy phase stores current data plus own-path status; repair clears status without rollback. Native isolation remains necessary. |
| Result layout construction finishes before handoff; payloads may remain pending. | A valid prepared Array may also contain pending or failed layout facts. Required call validation still precedes result-root handoff. |
| Controlled argument preparation can fail before determining whether an argument affects the operation. | Determine actual dependencies first. A poisoned, invalid, or pending argument cannot fail or delay effects/results proved independent of it. |
| Captured Array structure has numeric placements and pending value deliveries. | A partial layout can also retain children before their destination keys are known. Captures protect those dependencies; parent edges cover established placements, while aggregate queries also account for output-relevant deferred regions. |

Controlled commands are consequently not rollback transactions. A committed independent write survives another region's failure, and later commands can use healthy facts without repairing the whole Array first. In streaming modes, later work consumes the declared fallback and any actual remaining failure dependencies; one failed region does not abort every fact of that later command. Required source relationships survive composition; adding stronger independence rules is a semantic decision, not a storage optimization. Regional repair is deliberately unavailable. Restoring an explicitly saved predecessor as a new assignment remains possible; automatic restoration could discard intervening effects.

Mutation scope still selects authority, ordering, and path-failure ownership. The revised regional footprint applies after successful selection of a controlled Array operation. Opaque native managed calls retain selected-scope isolation and failure ownership; access through their retained path status follows the Chain policy after its cutover. Narrowing native failure to the receiver would be a separate architecture revision, not a consequence silently inferred here.

Successful valid-input mappings retain the existing controlled-method semantics, including holes, fixed external locations, ownership, and write-based identity. Use existing argument conversion only where that argument is needed. Skipping irrelevant conversion/validation and publishing independent effects after failure are deliberate semantic revisions; JavaScript's eager validation and abrupt completion are not their reference behavior. Ready failure and deferred failure use the same revised reference execution.

Native host iterators and their finalization remain Phase 8 work. Object enumeration, new Array method names, and a separate append-only stream API are outside this revision. Here, streaming means incremental delivery of the Array at the iterator's logical command position. Later commands are excluded; all logically earlier commands are included, even if some have not settled.

### Future: out-of-order element delivery

The final phase implements the selected unordered-stream mode. Deliver a guaranteed surviving occurrence with its final captured payload dependency before its numeric index is known. Neither payload readiness nor an optional index query gates unrelated body work. Do not emit an occurrence that may still be deleted or overwritten.

Keep three facts distinct:

- **Published sequential occurrence:** final membership, intended numeric position, and payload source are established; the payload can remain pending or ordinary poison.
- **Published unordered occurrence:** survival and final payload source are established; its index can remain pending.
- **Fallback position:** after a relevant positional failure, the selected recovery layout supplies a deterministic position. This is not proof of the position originally requested.

After a=[A,B]; a!.splice(P,0,X), failed P uses fallback [A,B,X]. Sequential mode flags the potentially misplaced occurrences; unordered mode leaves all three usable and adds no positional marker or Array-path poison. A marker is for possibly missing output, not lost order. The [mode contract](poison-policy-plan.md#2-failure-categories-and-fallback-layouts) owns these outcomes.

The two streaming modes intentionally make different ordering/failure guarantees. Each must match its own all-ready reference execution for the same inputs and failures; changing settlement order cannot change its result. Array access, fallback, and later effects remain in logical issuance order, never arrival order.

An index future resolves from the captured successful or fallback layout when its required facts are available; it may remain pending behind a required dependency. Position-only failure in unordered mode does not automatically poison that future. Actual root/publication failure keeps its normal failure channel. Define the final public index transport and Cascada integration before this stage.

Occurrence discovery must distinguish duplicate copies of one payload, deliver each occurrence once, and release its uses without rescanning unresolved slots. The layout supplies these facts; Cascada owns command-buffer ordering, pacing, and any loop metadata. Add no hierarchical indexes or second layout engine. Initial phases require no new loop-metadata API.

### Pending mutations versus unknown future commands

An entry reserves a producer's place in command order while its callback may still issue commands. Distinguish these cases:

| Producer state | Required consumer behavior |
| --- | --- |
| Relevant commands have been issued, but their arguments, payloads, or regional effects are pending | Compose their captured mappings and publish independently determined facts. The ordered cursor consumes the guaranteed prefix without waiting for whole-command or whole-Array completion. |
| An entry has stopped issuing commands through its own reference, while already-issued child commands remain unfinished | Publish its captured partial successor through normal entry handoff. Child dependencies keep their own lifetimes; unrelated body/native completion is not a whole-Array barrier. |
| An entry may still issue an unrestricted mutation of this Array before the consumer's logical position | A current prefix is provisional. The remaining commands could clear, replace, or reorder it. Existing path-only access declarations cannot prove it final. Preserve protection until issuance closes or a sufficient remaining-effect guarantee exists. |

The desired optimization is proof of a final observable region, not an append-only requirement. Append-only production is one sufficient restriction; a sealed range or a guaranteed unaffected final suffix can also suffice. The current entry API declares paths and mutation authority. The planned push-only capability supplies a narrower mutation contract; shape bounds and failure effects remain separate prerequisites. Do not infer a remaining-effect guarantee from commands observed so far or impose this open-issuance limitation on the first two rows.

For a loop that issues every push with a pending payload, the consumer need not await those payloads. Once command issuance closes, it can traverse the resulting captured positions. When future iterations themselves are unknown and can issue more mutations, the missing fact is what those earlier commands may do, not whether existing values are ready.

**Follow-up: push-only entered references.** The [entry extension](array-layout-approaches.md#46-follow-up-open-append-regions-in-enter) declares and enforces the capability per reference, including nested calls and overlap. It reuses the layout queries and cursor and represents later pushes behind an earlier open contribution before their absolute indexes are known. Private reads use the command prefix; outside consumers capture the eventual post-entry version.

Land the mode/failure foundation first. Failed conditional or enumeration control uses compiler-selected targets and the declared structural footprint: preserve issued contributions, represent possibly missing output with the one marker when required, and retain genuine path failures where applicable. Independent result failure and pushed payload rejection keep their narrower effects. Both streaming modes still require final occurrence facts, capacity, and authority; neither bypasses a genuine path blocker. Today's path-only entry reservation does not implement this extension.

## 2. The logical model

### Independent facts

At a captured program position, distinguish:

| Fact | Possible answer |
| --- | --- |
| Array root/category | A managed Array, pending root, or root Error |
| Exact length | A Number, pending dependency, or structural Error |
| In-range at numeric index i | True, false, pending dependency, or structural Error |
| Own presence at i | Present, absent, pending dependency, or presence Error |
| Value at i | A language value, pending dependency, or Error |

Length bounds remain useful when exact length is pending or failed. A hole inside length is an iteration occurrence yielding undefined; absence is still distinct from present undefined for copying, searches, and writes. Unknown layout is not a hole. An Error in presence or mapping is not proof that the position is out of range.

Ask only for facts required by the consumer. A definitely absent property reads as undefined whether it is an in-range hole or outside length, so ordinary lookup need not consume an unresolved in-range fact in that case. Iteration still needs existence to decide whether to issue that position. All consumers retain root/path prerequisites.

Availability is monotonic within one captured version: a delivered fact cannot be retracted. A later command creates a successor version; it does not revise an earlier capture. Value readiness means the element root is available, not that its descendants have settled.

### Guaranteed prefix, independently of ready values

Sequential publication needs more than inRange(i)=true. Establish which surviving occurrence supplies slot i, including all earlier writes that could delete, replace, or move it. Capture its final payload producer before exposing the step. A known hole yields undefined. Later commands use successor versions.

[pendingA,B] issues both positions immediately: the placements are final and only their values remain pending. An already-poisoned payload is also an ordinary item. In contrast, a Promise that must first choose between A and X after an unresolved splice is a structural selection dependency. Do not issue it as if it were a pending payload; it could later become structurally poisoned.

Length bounds guide membership and absence. A lower bound m proves [0,m) exist but does not prove their source selections. Apply the required shape/selector reductions at the next position and wait only for unresolved structural prerequisites. Numeric lookup may return a Promise for a still-unknown selection; iterator delivery has the stronger published-occurrence requirement.

Perfect publication is not required. Conservative delay beyond the specified bounded rules is acceptable; premature publication, extra timing-dependent poison, and fallback that retracts an issued fact are not. Include the selected failure outcomes in bounds and publication proofs.

Use one common fact interface for operation-local shape, presence, source selection, survival, and payload capture. fill/copyWithin/reverse preserve length; capacity-safe push/unshift adds known argument count; pop/shift use max(0,L-1); splice uses its normalized ranges. A marker contributes its declared one-slot fallback only where applicable. Preserve necessary captured relationships without a general solver.

Complete mode waits for required structural completion before public consumption of that version, not for unrelated payloads. Unordered mode requires survival and final payload source but can omit the numeric-position prerequisite. All modes retain root, authority, and capacity requirements.

### Fact evaluation and failure dependencies

Each controlled operation defines its successor from captured operands. Facts independent of an unfinished operand can be published immediately. If that operand fails, dependent facts expose its contextual Error while independent facts retain their own values and producers.

Do not classify failure by what happened to be ready when it arrived, by whether someone already observed a region, or by which physical representation was selected. Ready poison, a synchronously delivered rejection, and a later rejection must produce equivalent facts and effects.

Apply the [common availability and failure contract](AGENTS.md#errors). The reference model must state the supported reductions and resulting failure footprints before production; an uncovered failed-input case is a specification gap, not an implementation-selected Error. Issuing an iterator payload Promise establishes its occurrence and position, not a healthy eventual payload. Structural source selection must already be final.

Use one evaluation rule for ready, pending, invalid, and poisoned controls:

1. Describe a needed control by its normalized semantic range and constraints. For splice, 0 <= d <= L-s. Pending controls retain alternatives. A failed control retains the information needed to prove relevance and select the declared mode-specific failure/fallback; do not choose an arbitrary successful input value. Other captured facts may still prove the control irrelevant.
2. Evaluate each output fact from the method's mapping, using range arithmetic, conditional selection, and exact captured source selectors. A selector names a source placement/version, an argument payload slot, a hole, or a prescribed literal. When a supported rule establishes that every remaining alternative selects the same fact, forward it without the control dependency. Failure to establish that proof remains uncertainty, not permission to guess. Distinct payloads that happen to compare equal are not the same selector.
3. Preserve constraints and captured source relationships required by the semantic rules, such as d <= L-s. An internal conservative approximation may admit extra possibilities, but must not turn those invented alternatives into extra failure or withhold a required answer. Do not replace source placement/version selectors with predecessor-index identity merely because a representation loses their relationship. No general symbolic constraint solver or production enumeration is required; extending the supported dependency rules is a contract change.
4. Retain required pending dependencies until selection or relevance is established. Apply the declared failure footprint: complete-mode root Error, permanent structural poison, sequential positional status, unordered survivor fallback, or missing-output marker. Do not finalize a failure while another required fact can eliminate or change it. The mode's actual retained frontier determines Error collection; unordered position-only fallback creates no duplicate Array Error.
5. Evaluate prescribed writes and operation completion separately from resulting values, using the method's semantic no-op rules. In particular, controlled copyWithin with provably identical normalized source/destination starts prescribes no writes, even when end is pending or poison. Other required writes retain their specified effects and failure footprints; equal payloads alone do not erase an explicit assignment or earlier command's effects.

The successful semantic range describes uncertainty, not validation success. An impossible request remains an independent validation failure; an empty set of valid indexes does not make with on an empty Array vacuously valid. Authority and physical storage failure are also not hypothetical successful argument values.

Return a determined result immediately, even when some arguments are pending, invalid, or poisoned. An eager preparation order or an incomplete list of examples is not evidence that an input is required. The evaluator uses structural range/shape simplification, identical selectors, ordinary available comparisons, and absorbing Boolean results such as false AND unknown. Apply proofs equally to ready and deferred failures and keep the reference model aligned. Do not speculate about sorted prefixes or search combinations of hypothetical comparison outcomes. These limits on proof work do not justify withholding an answer already established by ordinary comparisons or mapping composition.

An input is required only while a prescribed effect or returned fact depends on it. A method's argument table identifies potential inputs, not unconditional conversion or Error-collection obligations. Preserve complete collection for the actual dependency set; exclude inputs proved irrelevant. A conversion failure cannot make its own otherwise-unused argument required.

### Shared inputs and occurrences

Preserve sharing already explicit in captured layout/control facts. One actual fact has one outcome; repeated use must not turn it into independent hypothetical values. Separate reads do not acquire a relationship from a variable name or shared causal Error.

Reusing a source, as in concat(a,a), creates separate destination occurrences and parent keys. Shared payload identity does not merge them.

### Captured control identity at the API boundary

No new wrapper/provenance API is required solely to prove that separately returned pending arguments are equal. Current lookups can return different Promise wrappers even for the same stored Promise. Do not reconstruct their relationship or compare Error objects to infer coordinates.

For copyWithin, compare normalized numeric starts when available. Equal starts prescribe no writes regardless of where the numbers came from; otherwise wait for required controls. Existing cheap captured facts can establish equality earlier, but a proof must be valid for both ready and deferred failure. Incidental Promise wrapping or delivery timing cannot select a different poison outcome.

Keep local same-control folding where one mapping already shares the control explicitly. Cross-call recovery of lost argument provenance is not a baseline requirement. Test the shared internal form separately from independent argument reads; do not make the reference oracle assume sharing unavailable at the API boundary.

### Structural proofs and payload inspection

Use captured shape, bounds, equivalent coordinates, shared selectors, and repeated-source blocks to establish independence. These facts must survive composition and materialization wherever the specified result relies on them. Do not add an old-value equality pass, or await old payloads solely to avoid a write or preserve identity. The rule is the same for ready and pending payloads.

Reads, searches, conversions, and sorting still inspect the values their actual algorithm needs. This restriction on extra equality work does not suppress ordinary comparisons or their short-circuit results. A structural proof can remove an algorithm step entirely: sorting occurrences of one captured payload cannot change their value arrangement, so its comparator is unused. The method's prescribed writes and identity outcome remain separate.

### Universal rule: irrelevant arguments never introduce poison

The [universal dependency rule](AGENTS.md#errors) governs every argument and independent outcome. The Array-specific rules below apply it; they do not limit its scope.

If an input Error is ready while the proof of its relevance is pending, keep that Error conditional. For example, fill with failed bounds cannot fail immediately while an earlier shape dependency may still establish an empty receiver. Complete available proofs before deciding the failure frontier. Provisional input reception already required for ownership is not a reason to retain an irrelevant Error in the outcome.

When a proof removes a dependency, release that operation's unused captures, waits, and Error-collection state. Preserve already-owned rejection handling and shared settlement needed by other consumers; do not cancel the input or attach observers to otherwise unconsumed host inputs. If the receiver's length bound already proves at most one sortable occurrence, do not resolve that occurrence merely to prove that its comparator is unused.

In the examples below, P is an ordinary poison or a pending input that later rejects. The necessary shape/presence facts are known; omitted inputs retain ordinary defaults.

| Operation or proof | Determined behavior despite P |
| --- | --- |
| Empty a: a!.fill(P,P,P), a!.copyWithin(P,P,P) | No writes; return a unchanged. Observation mode returns the ordinary distinct empty Array. No new poison. |
| Empty a: a.at(P) | Return undefined; the index cannot select any occurrence. |
| Empty a: a.includes(P,P), a.indexOf(P,P), a.lastIndexOf(P,P) | Return false, -1, -1 respectively. There is no candidate comparison. |
| Empty a: a.slice(P,P), a.flat(P), a.toSorted(P) | Return a fresh empty Array; bounds, depth, or comparator cannot affect it. Empty a!.sort(P) returns a without a write. |
| a.join(P), length 0 or 1 | Return "" at length 0; at length 1 convert only that occurrence. No separator is used. An Error in the occurrence still propagates. |
| a!.fill(P,P,0), or a!.copyWithin(P,0,0) | The selected write interval is empty regardless of the unknown bound/target. Return a; preserve existing data poison without introducing argument poison. |
| a!.copyWithin(0,0,P) | Source and destination positions are identical for every end. Return a unchanged, preserve identity, and ignore end; no mutation copy or identity poison is needed. |
| a.slice(P,0) | Return a fresh empty Array; every normalized start is at least the normalized end 0. |
| a!.splice(P,0), with no inserted arguments | Removed result is []; contents are unchanged. Preserve the captured shape and perform the prescribed same-length write without consuming start. Existing root/shape failures remain; start adds none. toSpliced(P,0) returns the ordinary dense copy subject to its result boundary. |
| Empty a: a!.splice(P,P,"X") | Start and deletion count normalize to 0. Publish ["X"] and return []; neither control argument is needed. This is a determined effect, not a no-op. |
| sort/toSorted with fewer than two non-undefined sortable occurrences | Comparator selection, validation, export, and invocation are unnecessary. Preserve the normal known permutation, holes/dense semantics, and prescribed writes. Example: [7,undefined] has no comparator dependency. |
| sort/toSorted over structurally known repetitions of one captured payload | The value arrangement is independent of the comparator. Preserve the specified hole/dense behavior and writes without consuming P as comparator. Use the shared-source proof; do not scan distinct payloads to discover equality. |
| flat over known present non-Array leaf roots only | Depth cannot change the output. [1,,2].flat(P) produces [1,2]. Do not infer this proof while a root could still become a nested Array. |
| A search range proved empty | includes returns false; indexOf/lastIndexOf return -1 without consuming the search argument. An all-hole Array also gives indexOf/lastIndexOf -1; includes still compares holes as undefined unless its range is empty. |
| [1].indexOf(2,P), [1].lastIndexOf(2,P), [1].includes(2,P) | Return -1, -1, false immediately. The only possible candidate is a known mismatch, whether the range includes it or not. |

These proofs use shape, bounds, argument count, and the algorithm's actual comparisons/mapping. They do not compare alternative payloads to guess equivalence. Equal before/after values do not prove a no-op: same-value writes still affect identity. Existing zero-argument endpoint-mutator length writes remain prescribed effects. A deterministic result does not erase an independent required effect or its failure.

Some arguments remain necessary. A nonempty [A,B].with(P,"X") cannot select or validate its replacement index; a.includes(P) with candidate occurrences cannot decide whether they match; a.concat(P) cannot classify the appended part. Stored poison is data: a valid with(0,P) produces an Array containing P, and an inserted splice/push payload poisons its actual placement rather than disappearing as an unused control.

Receiver selection, supported dispatch, authority, and fatal failure are prerequisites, not optional arguments. Do not inspect a poisoned path's hidden value to prove emptiness. Opaque native calls do not inherit these controlled-operation proofs. Intrinsic invalidity also remains failure: an empty Array has no valid with index, and capacity overflow prevents a requested write. Neither is a proved successful no-op. Report that independent validation failure without consuming irrelevant argument poison.

This removes eager-validation ordering where it manufactured dependencies. In particular, comparator readiness no longer precedes the proof that no comparisons are needed. Do not add a separate poison-only fast path: valid, pending, invalid, and poisoned inputs use the same demand-driven preparation.

### Example: partial splice

For a streaming Chain:

    a = [A,B,C,D]
    removed = a!.splice(2,pendingCount,"X")

Normalized deletion count is in [0,2]. Once capacity and publication prerequisites are safe, A/B/X have final positions 0/1/2. Their payloads need not be ready. The remaining receiver layout and the separate removed-elements result depend on the count.

While the count is pending, length bounds are [3,5]; positions 3/4 have uncertain membership/selection. If the count fails, the selected streaming fallback is [A,B,X,Error,Error], length five: C/D may have been deleted and are permanently poisoned. Both streams retain the clean prefix of three; unordered delivery may also use any other guaranteed survivors in more general cases. The removed result is poison because its required count failed.

Complete mode exposes no prefix before structural completion and produces whole-Array Error on this failure. Ready poison and delayed rejection follow the same mode-specific outcome. Repair cannot restore C/D or undo X; explicit replacement of the Array remains available.

Capacity is separate. A fallback cannot exceed maximum length or invalidate an earlier published fact. Near capacity, unresolved controls may block otherwise useful prefix publication. Required invalid-request handling in section 12 remains; no permanently frozen poisoned-size state is introduced.

### Required endpoint relationships

A captured selector or range-edit target uses a nonnegative offset and a `fromEnd` flag: offset 0 means first when false and last when true. Preserve that coordinate against its captured layout until an absolute numeric index is needed. Apply the same selection, normalization, and composition rules to reads and writes, for ready, pending, and failed controls.

Known lengths or bounds can locate a selected block from either end. Resolve only the spans needed to reach it; an unknown prefix need not obstruct a known suffix. Correlated shape facts can establish a needed total without resolving every individual block count. The following reductions are required; the [method specification](docs/array-method-specification.md) defines their normalization, composition, and failure rules:

| Operation | Required local selector rule |
| --- | --- |
| reverse | Swap front and back. |
| push of k values | Back offsets below k select inserted values in reverse insertion order; larger offsets select the predecessor at back offset r-k. |
| unshift of k values | Front offsets below k select inserted values in insertion order; larger offsets select the predecessor at front offset r-k. |
| pop | Select the predecessor's last occurrence as the result, or undefined when empty. Remove that occurrence; surviving back offsets select predecessor offsets r+1. |
| shift | Select the predecessor's first occurrence as the result, or undefined when empty. Remove that occurrence; surviving front offsets select predecessor offsets r+1. |
| at, slice, with, fill, splice, copyWithin | Keep relative coordinates during method-specific clamping, validation, and range construction. Select or edit captured blocks without forcing unrelated absolute offsets. copyWithin retains pre-write sources for overlaps. |

For inserted [X,Y], back offset zero selects Y. In streaming modes, after a partial splice and a capacity-safe push of Z, at(-1) returns Z even when the splice control fails; after reverse, index 0 likewise yields Z. Pending controls retain their dependencies; failure applies the specified fallback without invalidating Z. These are semantic dependencies, not optional representation proofs. Target/authority/root validity and any owning-path blocker still apply.

The [worked example](array-layout-approaches.md#example-pending-splice-push-reverse) gives the bounds and selector reduction. Implementations may choose block traversal, captured selectors, or another bounded mechanism; they must not discard the endpoint relationship and introduce extra poison. Known-length [pendingA,"B"] followed by reverse also yields B at index 0 immediately. Always use captured predecessors rather than old physical storage or the last method name alone.

For [A,B] + deferredRemainder + [Z], independently applied pop, slice(-1), fill("Y",-1), with(-1,"Y"), and splice(-1,1,"Y") can select or replace the final block without determining the remainder's length. This does not make them no-ops: retain their ordinary writes, results, and root-validity obligations. Deferred edits protect their values until numeric placements can be published, as specified under [deferred children](#deferred-children-and-graph-summaries).

includes("Z") can use that definitely present final occurrence without its numeric key. indexOf/lastIndexOf still need a determined numeric result and the required directional first-match proof. Do not turn relative access into permission for sequential delivery at an unknown numeric index; unordered occurrence discovery is a separate final-stage capability.

## 3. Controlled operation rules

### Method catalogue and mappings

All 22 current names in ARRAY_METHODS participate. The nine mutation-capable names are copyWithin, fill, pop, push, reverse, shift, sort, splice, and unshift. Without !, each returns a transformed copy and preserves its source. With !, it publishes receiver changes and returns the JavaScript result: push/unshift length, pop/shift removed value, splice removed elements, and the receiver for the other four. Retain the current uniform observation-copy contract; this supersedes the earlier proposal to change five observation return types.

Let L be captured source length, A(i) its captured placement, k the number of inserted arguments, and j an output index. Normalize bounds with the existing argument converters when their values are needed; preserve omission versus explicit undefined, clamping, negative indexes, NaN, infinities, and ignored arguments. The zero-argument, omitted-delete-count, and explicit-undefined splice/toSpliced forms retain their distinct normalization rules.

| Operation | Output facts and dependencies |
| --- | --- |
| at | Read one captured position; a negative index uses captured end-relative selectors and required membership facts. Do not demand exact length when those rules establish the selected value. A known out-of-range position yields undefined without consuming a payload. |
| includes | Preserve existing any-match completion. A sufficient match in a definitely selected position can win without waiting for other comparisons or exact length. Holes compare as undefined. Do not add a universal Error precheck. |
| indexOf, lastIndexOf | Preserve directional first-match completion and hole skipping. A known mismatch excludes a candidate without awaiting uncertain range membership; a match cannot bypass an unresolved earlier possible match in that direction. |
| join, toString | Produce one String using existing logical conversion and complete required Error collection. join consumes the separator only between positions. Explicit and implicit Array conversion consume the same required facts. |
| push | Length L+k; retain A(j) below L and place argument j-L afterward. Numeric appended positions need the append offset; relative tail selectors do not. Capacity must be proved. Mutation returns the new length independently of payload readiness. |
| unshift | Length L+k; place k arguments first and map later j to A(j-k). The prefix need not wait for old payloads; changed facts require capacity proof. Mutation returns the new length. |
| pop | Length max(L-1,0); retain A(j) at surviving indexes. Mutation returns the old last value or undefined. Its payload does not gate surviving receiver facts. |
| shift | Length max(L-1,0); map j to A(j+1). A proven in-range output position needs no exact length. Mutation returns the old first value or undefined for an empty source. |
| reverse, toReversed | Preserve length bounds; map j to A(L-1-j). Known L determines the source index without waiting for its payload. Apply required captured-selector relationships before retaining a length dependency; additional independence rules require a contract decision. An existing position can carry a pending final-slot value. toReversed makes holes present undefined. Mutating reverse returns the receiver. |
| fill | Length L; in [s,e) install the payload; elsewhere retain A(j). Overwritten values are not inputs. Uncertain bounds affect undecidable destination and write predicates only. Mutation returns the receiver. |
| copyWithin | Length L; if normalized t=s is proved, prescribe no writes and ignore end. Otherwise c=max(0,min(e-s,L-t)); in [t,t+c), map j to pre-write A(s+j-t), elsewhere retain A(j). A copied hole deletes the destination. Capture overlapping sources before writes. Mutation returns the receiver. |
| splice | The receiver successor has length L-d+k: below s retain A(j), in [s,s+k) insert arguments, afterward map j to A(j-k+d). Mutation mode returns a sparse removed Array mapping j to A(s+j), length d. Observation mode returns the transformed copy; its source is unchanged. |
| toSpliced | Return the dense transformed copy with length L-d+k and the successor mapping above. Leave the source unchanged; there is no removed-elements result. |
| slice | Length max(e-s,0); map j to A(s+j), preserving holes. A bounded positive range can be selected without exact source length when in-range facts prove its bounds. |
| with | Validate the index; preserve length L, replace the selected position, and copy other values densely. A negative index's mapping can depend on L even when its validity is proved. The overwritten source value is unused. |
| concat | Place classified parts in order, with offsets from captured part lengths; a non-Array part contributes one position. Preserve holes in Array parts. |
| flat | Traverse present occurrences to the required depth; flatten only logical Arrays and omit holes at traversed levels. Retain deeper values without inspecting them. Offsets depend on preceding expansion lengths. |
| sort, toSorted | Preserve length and stable sorting/comparator contracts. Apply structural comparison-free proofs first; otherwise required values/comparisons determine the sortable region. Retain established membership independently of order. Use the [permutation fallback and fixed suffix rules](docs/array-method-specification.md#7-sort-and-tosorted); toSorted densifies holes. sort returns its live or privately transformed receiver according to mutation mode. Constructed Array roots follow section 5. |

Bounds come from captured facts, never the later live Array. Source and destination dependencies are separate: a failed copyWithin source contributes failure to dependent destinations, not to its original source positions. A failed deletion-count calculation affects splice layout, not independent prefix payload delivery.

Successful mutation identity follows logical writes, not value equality. Same-value assignment is a write; an empty fill range is not. Preserve presence-sensitive no-op rules for reverse, copyWithin, and sort, add the proved self-copy rule above, and retain specified length writes of endpoint mutators.

The current PASS_AS_PAYLOAD behavior already handles pending/rejected inserted values for push, unshift, fill, splice, with, and copying methods. Preserve it. Do not add another transport for payload Errors. Preparation must stop discarding all success payloads merely because an independent structural argument failed: retain exactly the payloads used by surviving output facts.

Apply the determined-outcome rules through the same method dependency descriptions, including at, searches, join, slice, flat, sort, and copying forms. The current eager argument conversion in array-invocation.js and comparator-before-elements ordering are implementation work to replace, not contracts to preserve. Empty/presence/range proofs can eliminate inputs before conversion; available structural arguments can prove another argument unused. Do not add a second no-op dispatcher alongside the normal algorithm.

Invalid dispatch, unsupported names/modes, selection failure, and authority rejection keep their existing classification and owning-path failure rules. They are not fictitious regional Array operations. A supported selected operation's argument, mapping, comparison, and publication failures follow this specification. No custom Array property, accessor, prototype method, Symbol protocol, or host iterator participates.

### Search demand and completion

For each possible candidate i, separate eligibility E(i) from comparison M(i). Eligibility includes range membership and, for indexOf/lastIndexOf, own presence. A hit requires E(i) AND M(i). Either known false operand makes that candidate a non-hit without awaiting or propagating poison from the other. Thus a known mismatch removes dependence on a pending/failed start, just as a known excluded position removes dependence on its value. Comparison uses ordinary captured language values and identity rules; do not inspect a hidden predecessor to invent a positional value.

A candidate can be a captured block occurrence whose absolute index remains unresolved. includes needs eligible presence and a match; returning a numeric index additionally needs that occurrence's absolute coordinate. Use the same range eligibility rules in either coordinate system.

- includes returns true when a definitely eligible candidate matches. It returns false when every possible candidate is a known non-hit, even if the exact selected range remains unknown.
- indexOf/lastIndexOf return a matching index when it is definitely eligible and all possible candidates before it in their search direction are non-hits. They return -1 when all possible candidates are non-hits. A known mismatch may be inspected past a pending range control; it does not authorize returning a later match past an unresolved possible earlier hit.
- Keep uncertain eligibility and its Errors conditional. A later established mismatch removes them; a later exclusion removes a comparison Error. Propagate only failures still required for the result after these reductions, following the existing any-match/directional completion rules. Arrival order must not choose between an early Error and a subsequently proved deterministic answer.

Scan the union of possible candidate positions at most once under maintained captured bounds, narrowing it as facts settle. Empty and hole ranges remain symbolic; indexOf/lastIndexOf skip definite holes, while includes can reuse the comparison with undefined across a definite hole range. Do not require exact length merely to certify that this union is complete. If possible additional positions or required comparisons remain unresolved, retain those dependencies. Cache candidate decisions and aggregate progress rather than rescan all candidates on each settlement. Required work is bounded by relevant source structure, comparisons, and pending dependencies; it does not enumerate combinations of possible starts or comparison outcomes.

### Indexed writes and dynamic selection

Known-index assignment/deletion, length writes, and replacement consume the same facts; their supersession rules are in section 6. A pending key is not necessarily an index. In a[pendingKey] = 0, the key can resolve to "length" and clear the Array. Neither bracket syntax nor a pending language value proves an index-only domain.

Keep general dynamic-path selection behind its existing selection dependency until its effect can be classified. Narrow protection after selection, and then publish through the shared point/length transition. This revision introduces no trusted numeric-only key hint or speculative per-index dispatch. Cover index, length, invalid-key, and poisoned-key outcomes; do not promise that every old position stays in range while an unrestricted key is unresolved.

## 4. Ordering and irreversible publication

Cascada reserves each control-flow operation's logical position before asynchronous work starts. Individual loop bodies may be issued later through that reservation; section 7 defines the compiler integration. Independent observations can finish out of order, but conflicting effects retain their command order. Kernel Promise settlement does not establish that order.

A controlled mutation reserves its successor facts before suspension. Later operations capture that successor, including unfinished dependencies; they cannot fall through to stale physical slots. Earlier operations continue using their exact predecessor captures.

For each selected mutation:

1. Capture the receiver, needed operands, and authority at its ordered turn. Protect still-unread data before callbacks or subscriptions can advance other work.
2. Finish required ancestor/destination setup and every preflight capable of blocking the whole selected path before exposing changed receiver facts. Dynamic selection may temporarily gate a broader prefix; narrow that protection when the selected target becomes known.
3. Install successor shape/range dependencies and independent facts through one logical publication path. Known unaffected regions remain readable. A broader ! scope grants authority but does not justify keeping healthy siblings behind the selected Array's unfinished layout.
4. Complete independent regions under captured publication authority. Perform any required fallible storage action before committing its corresponding logical fact. Once committed, later failure cannot roll it back or widen poison over it.
5. Detach superseded destinations. Shared producers still serve earlier captures and required direct results, but cannot overwrite later commands, regrow a truncated Array, or reconstruct a replaced ancestor.

Required storage failures must have a deterministic logical footprint. Physical writeback that merely caches an already published logical value remains optional synchronization under the existing contract; its refusal creates no new poison. Native managed methods remain opaque, isolated transactions; do not run their arbitrary JavaScript against a partially published receiver.

Authority is checked before regional execution, including for an otherwise no-effect request. Today's explicit managed scope containing a registered mutable external location is invalid before Array argument preparation. Thus arr!.splice(5,pendingCount) with a registered resource at index 7 cannot publish a prefix and later discover that its scope was invalid. Preserve this preflight; this revision does not add mixed-scope mutation authority. Any other supported route whose whole-path validity depends on a control must establish that validity before changed facts escape. A genuinely local publication failure keeps its local footprint instead.

Independent destination writes continue after a recoverable local failure. For example, if fill("X") can write indexes 0, 2, and 3 but a supported backing-store write fails at 1, its successor is ["X", poison, "X", "X"], and the call reports the required failure. This is failure of a primitive storage action that leaves its target unchanged, as required by the managed-storage contract. Do not restore the old whole range or stop independent later writes. If later destinations depend on the failed action, they receive its poison instead. A failed opaque native call retains its separate isolation contract.

The Array can be usable while its mutation's direct result is pending. That result still includes every required validation and publication effect promised complete on delivery. Installing a pending region is not by itself completion of a mutating command's required effect. A removed payload can extend the returned value's lifetime without gating an already completed receiver transition.

Distinguish unfinished work introduced or consumed by this mutation from unchanged predecessor data. A bounded fill whose destinations are proved in range can finish its writes and return a partial receiver while an untouched predecessor remainder stays pending. A splice whose count still selects the remainder cannot finish merely because its insertion is visible; an empty-source splice has no such count dependency. A remap that still needs predecessor shape to determine its affected writes retains that dependency. Ordinary payload versions and untouched forwarded regions do not become completion barriers simply because the method returns its receiver.

### Identity policy and implementation cost

Keep write-based identity: a semantic write creates a new identity even for an equal value; a command publishing nothing preserves identity. Derive no-write decisions from structural facts and existing effect reporting, without resolving or comparing old payloads merely to avoid a write. copyWithin(0,1,1) has an empty write range; copyWithin(0,1,2) writes even when both values are X.

Pending controls can leave the write decision pending. The existing identity mechanism can consume that outcome without waiting for element values. Conditional argument relevance already requires its own wait under the poisoning contract; changing every ! call's identity would not remove that wait.

Do not add substantial identity-only state or retained history to preserve no-op identity. If implementation evidence exposes that cost, revisit the policy uniformly as an explicit contract revision. There is no per-call fallback based on timing, physical storage, or successful optimization, and no blanket fresh-identity rule is selected here.

### Command identity

Reserve one source-free successor decision per semantic command and affected logical node, using the existing captured identity mechanism. The first irreversible write or new poison fact proves effectiveness; identity need not wait for unrelated regions. A genuine no-op forwards to its predecessor. Installing an ordering dependency or changing representation is not a semantic write.

The write/effect decision is itself captured state. First apply semantic no-op rules: controlled self-copy prescribes no writes and forwards identity, even with a failed irrelevant end. Other prescribed writes cannot be erased by equal final contents. Argument failure alone does not prove a write; effectiveness follows the specified failure publication. Section 12 uses ordinary path poison for capacity failure and introduces no failed-identity state.

For failed controls, complete independent writes and publish the specified dependent poison, then classify the actual semantic publications. Do not guess which writes would have occurred had the control succeeded. If no write or new poison fact is published, identity forwards even though the call can return its required failure. In the known repeated-X copyWithin(0,1,P) example, P=1 preserves identity, P=2 writes and changes identity, and rejection preserves the unchanged data/identity while failing the call when no independent write or dependent data poison is required.

Identity finality, publication completion, and operation closure are different. Refactor the current IdentityPublication completion coupling where needed; do not close its operation owner to settle identity. Later regional completion must neither allocate another successor nor reset a generation installed by a later command. Containing nodes still reflect descendant logical writes through ordinary path publication.

#### Deleting inherited uncertain presence

A successful deletion establishes absence without consuming the old payload. Its identity decision depends on the captured predecessor's own-presence fact:

| Previous presence | Identity outcome |
| --- | --- |
| Absent | No-op; forward identity. |
| Present | Effective deletion; create the command's successor identity. |
| Pending | Publish absence independently; leave the identity decision pending until presence settles. |
| Failed | Replacing failed presence with definite absence is an effective publication; create the successor identity. Do not propagate the overwritten failure into the deletion. |

Use the existing mutation decision cell, retaining only the required presence dependency. Pending presence settling to absent, present, or Error follows the same rows as ready input. An unrelated failed length does not make deletion effective when absence is already known. Receiver/path prerequisites and a failure of the deletion itself still apply.

## 5. Result boundaries and partial producers

### Validate a result before handing out its root

```text
[A, B].with(99, "X")            -> PoisonError; source unchanged
[A, B].with(pendingIndex, "X")  -> Promise<Array | PoisonError>
```

Validation poison fulfills the ordinary kernel Promise; it is not a rejecting expression value or a partially successful Array. A valid result root is never later retracted. Fatal failure retains the normal fatal rejection contract.

Required root validity precedes publication; unfinished result contents need not. "Required" means still relevant after section 2's dependency reductions, not every input inspected while finding those dependencies. An empty slice or a comparison-free toSorted can return immediately despite unused poisoned or never-settling arguments. An actually dependent with index retains the Promise/poison contract above.

| Dependency | Result-root behavior |
| --- | --- |
| Index validity, capacity, or another check that invalidates the complete result | Finish before Array handoff. On failure return ordinary result poison. |
| Captured source placements, inherited partial layout, or retained payload data transported without consuming it as validation | A valid Array root may contain their pending/failed facts. |
| A control conversion or algorithm step needed only to construct some output facts | Use the selected structural mode and per-method failure/fallback rule. Being introduced by this call is not proof of whole-result invalidity. |

### Observation copies and mutation results

All nine mutation-capable Array names without ! return the transformed copy. Their ! form publishes the receiver and returns its JavaScript result. Starting separately from a=[A,B,C,D]:

| Call | Successful result | Source afterward |
| --- | --- | --- |
| a.splice(2,1,"X") | [A,B,X,D] | [A,B,C,D] |
| a!.splice(2,1,"X") | [C] | [A,B,X,D] |
| a.toSpliced(2,1,"X") | [A,B,X,D] | [A,B,C,D] |
| a.push("X") | [A,B,C,D,X] | [A,B,C,D] |
| a!.push("X") | 5 | [A,B,C,D,X] |

Splice's copy preserves holes; toSpliced densifies them. Pop/shift observations return shortened copies, while their mutations return removed values. Preserve ordinary no-op copy identity and backing-sharing rules.

For a!.splice(2,P,"X"), a failed required deletion count poisons the separate removed-elements result; independently determined receiver facts follow the mode's partial-publication rules. In the observation form, the returned transformed copy instead follows the copying-result contract below. These are distinct language operations, not inconsistent result timings.

### Constructed Array results

Copy-producing calls use the source Chain's selected mode. This applies uniformly to observational mutators and ordinary producers such as slice, concat, flat, toSpliced, toSorted, and with.

| Mode | Copy result |
| --- | --- |
| Complete | Wait for required structural production. Relevant structural failure returns ordinary root Error; stored payloads may remain pending. |
| Sequential stream | After root validity, expose the partial copy and its fixed prefix. Later structural failure is represented by the specified regional Errors, markers, or positional flags. |
| Unordered stream | After root validity, expose guaranteed survivors and permit positional fallback without positional poison. Retain actual content/survival failure and missing-output markers. |

An exposed copy's root is not later replaced by a call Error or retroactive path flag. Its producer refines the captured layout under that mode. Consequently, an unordered sort copy may remain healthy after a comparator failure that only prevents ordering. Keep no hidden Array-level diagnostic for ordering that this mode deliberately does not require. This is an explicit failure contract, not Promise-timing-dependent suppression.

Actual whole-result validity still precedes handoff: valid with index, safe capacity, required target/category/authority, and unlimited-flat cycle validation. Invalid with returns result poison and preserves its source. Required consumed concat-part roots are classified before handoff; their established Array layouts and retained payloads can remain partial. Flat's required discovery/validity is separate from retained leaf payloads.

Mutating ! calls expose receiver progress through the selected Chain independently of their direct result. The direct result waits for its required call effects/controls and reports their failure; ordinary payload-only waits remain excluded. The [method specification](docs/array-method-specification.md#1-one-operation-separate-outcomes) defines these boundaries and the per-family rules.

### Transfer production before closing an invocation

A non-mutating call may finish with a prepared partial Array only after its remaining data producers have transferred to shared captured state. Before handoff, install known parent relationships, pending-publication obligations, and retained inputs. Its future layout must not depend on an operation-only continuation that stops when the invocation closes.

Shared settlement preserves values for all live captures and destinations. It does not extend the completed invocation or create a second public result. Full export and script return still consume the complete required graph; handing out a partial Array is not permission to finish a script that owes its complete contents.

## 6. Failure, queries, and supersession

### Local failure rules

The [mode/failure table](poison-policy-plan.md#2-failure-categories-and-fallback-layouts) owns the contract. Complete mode turns relevant Array structural failure into an ordinary root Error. Streaming modes preserve independent facts, positional survivors, and the declared fallback; neither automatically flags the whole Array.

- Stored payload rejection stays at its placement with its original cause. It does not fail the retaining call or Array structure.
- Structural selection, presence, or membership failure follows the method's declared permanent-poison or positional-status rule. Do not confuse it with ordinary payload rejection.
- A target storage failure affects its destination; a source capture failure affects consumers of that capture. Required direct-call failures retain their own completion boundary.
- An irrelevant failed argument adds no poison, marker, or status.
- Root/ancestor publication, authority, and capacity failures can prevent safe exposure. Do not claim a region that was never publishable or allocate an illegal index to carry a diagnostic.
- Compute fallback and failure coverage from the command's captured successor. A late callback cannot poison a replacement, regrow a truncated suffix, or append a marker to the later live Array.

### Failed ranges and surviving occurrences

A pending bound remains a structural dependency until it settles or is proved irrelevant. A failed range belongs to the command's captured extent, not all future indexes.

fill uses normalized start/end bounds, not a signed count. Negative bounds are end-relative; internal signed remap counts describe traversal direction only.

For streaming mode, [A,B,C,D], healthy X, and failed P:

| Operation | Fallback slot outcomes |
| --- | --- |
| fill(X,2,P) | [A,B,Error,Error] |
| fill(X,P,2) | [Error,Error,C,D] |
| fill(X,P), omitted end | [Error,Error,Error,Error] |

These Errors are structural: the affected contents may have been overwritten. Their positions are not streamed, and repair does not recover the candidates. Length remains four. A later push(Z) can add a healthy fifth occurrence. Ordinary reads can use established siblings; sequential iteration still cannot cross its first structural obstruction. Complete mode exposes whole-Array Error instead.

Use only bounds derived from captured method facts. A raw failed start on length four has normalized domain [0,4], not an invented [1,2] annotation. Proven tighter bounds may establish additional unchanged or certainly overwritten regions.

Pure insertion is different: all original and inserted occurrences survive. Apply the [positional fallback](poison-policy-plan.md#pure-insertion-with-a-failed-position), preserving payloads. Sequential mode flags lost intended positions; unordered mode accepts fallback order without a positional Error. An issued splice inserts exactly its argument count; failed deletion count uses the separate fallback already illustrated.

A failed supplied length is an invalid required resize input, not an arbitrary legal size to choose. Section 12 retains its invalid-request boundary. Do not add a frozen failed-size state.

### Common consumer behavior

| Consumer | Required dependency set |
| --- | --- |
| Numeric/nested lookup, expression extraction, positive at | Selected shape/presence/value facts and genuine path prerequisites. No deep whole-Array Error precheck for a usable streaming Array. |
| Bounded slice, fill, copyWithin, narrow mutation/entry | Selected range, normalization, authority, and mode-specific publication requirements. |
| Searches | Eligibility/comparison reductions and ordinary result-selection rules; independent mismatches remove irrelevant range dependencies. |
| Sequential iterator | Final membership, intended index, and captured payload source at its next position. Ordinary payload poison is deliverable; structural poison is not. |
| Unordered iterator | Guaranteed surviving occurrence and final payload source, with independent index future. |
| isPoisoned | Selected value/path classification; no descendant scan. |
| hasError / getErrors | The captured retained failure frontier, including real marker elements and positional flags; see the common query contract. |
| Full export, native preparation | Complete required graph, with normal Error collection and path blocking; do not omit markers or silently strip flags. |
| Mutable-external snapshot | Existing synchronous ready-only boundary; no waiting into validity or treating unfinished data as holes. |

Do not traverse obsolete predecessor alternatives or repair baselines as current data. After failed-count splice fallback, A/B/X and the actual structural Error slots form the current frontier; discarded C/D payloads are not hidden recoverable values. hasError can use a certain retained failure, while getErrors still completes all relevant collection, including pending payloads.

Failure membership can remain conditional while another required fact may prove the affected range empty. No marker or permanent poison is published merely because a producer failed; its effect must still be relevant under the declared rules.

After an unordered position-only fallback, do not retain a second Array Error solely to remember the order that mode does not promise. Existing explicit flags and actual payload/structural Errors remain meaningful. Different modes have explicit reference semantics; timing and storage representation cannot choose between them.

### Shallow isPoisoned query

The [query contract](poison-policy-plan.md#4-error-queries) owns naming, selected-state outcomes, captured status, and external metadata behavior. Cascada's x is error uses deep hasError. isPoisoned is distinct from both isPoisonError (language Error predicate) and isPoisonedValue (expression-wrapper predicate).

For partial Arrays, local layout/presence/value failures enter deep queries without making the usable root itself poisoned. Feed the common query machinery captured shape and conditional failure membership; do not classify an Array by scanning only established placements. The [open-entry status rule](poison-policy-plan.md#earlier-open-entries) applies even to an empty current Array and must not be implemented by draining the iterator.

### Explicit replacement

| Later command | Effect |
| --- | --- |
| Assign index i | Replace that placement's value/presence dependency without reading its old payload; apply ordinary length growth. |
| Delete index i | Establish absence without shrinking length; remove only that placement's status/data dependence. |
| Assign valid length n | Set length, discard indexes at or above n, preserve contents/status below n, and expose only genuine holes. |
| Replace/delete the Array location | Detach its current destination and failure data; preserve old captures and still-required operation results. |

After streaming splice fallback [A,B,X,Error,Error], truncating to length three leaves [A,B,X]. Repair cannot reconstruct C/D; extending again creates ordinary holes where truncation removed them. Deleting a structural Error or marker makes that placement absent under ordinary deletion rules.

Before fallback settles, a successful delete can establish an absent property even if the source's length is still pending. Numeric property lookup can return undefined while iteration still needs membership and a captured structural selection. Do not force an irrelevant shape query on that read.

An Error or flag ceases to affect current data when ordinary replacement/removal discards its last relevant placement; no second Array-wide failure ledger preserves it. Other retained occurrences and earlier captures keep their own outcomes.

Representation copies preserve current data, marker roles, positional flags, and required facts. A semantic projection may construct a healthy result from independent selected data without repairing its source. Ordinary access cannot traverse a genuinely poisoned path; see [access and extraction](poison-policy-plan.md#3-access-and-extraction).

## 7. Ordered iterator API

Expose a standard async iterator over one captured cursor: `[Symbol.asyncIterator]()` returns it, `next()` delivers the ordinary elem Chain, and `return()` closes future enumeration. Keep the factory's source Chain/path/context and dynamic-path facts; supply the ordinary loop binding's context and construction mode as compiler facts. Finalize the signature with the first integration. The [technical analysis](docs/array-iteration-technical-analysis.md#7-select-chain-valued-iterator-steps) selects holder delivery; a second raw-value or callback-based public iterator is not required.

Capture the source's logical version at factory issuance, not lazily at the first pull. Earlier effects are included and later mutations are excluded. Protect unread facts with existing captures, leases, and COW; reuse entry protection when it already covers the correct view and lifetime. This need not copy or resolve the whole Array.

For an expression-produced Array, first receive its result into an ordinary temporary holder, then capture through the same boundary. Release the holder when captures own the needed state. Higher-runtime dispatch retains its object/native-iterator/template behavior; this factory selects managed Arrays.

### Protecting unread inputs

Each iteration receives its selected item into a new elem Chain through ordinary lookup/capture and receiving protection, including pending delivery. Once that binding owns the item, the cursor needs no duplicate hold solely for that item. Remaining shape/index dependencies keep their own captures.

Before lookup has captured an unread item, a later body write could replace it. For [A,B], a body handling A may write live index 1 to X; the captured iterator must still deliver B. Allow writes to current, earlier, and unread indexes, and structural changes to the live Array. Writing the elem binding instead follows ordinary owner isolation.

Looking up published items quickly is useful but is not an ordering guarantee. The general mechanism preserves the unread logical view; eagerly creating every elem Chain would impose traversal/allocation even for bounded consumption or early stop. Capture through the entry's private command prefix, not its enclosing future.

Out-of-order delivery can transfer and release occurrences earlier. A whole-Array hold becomes unnecessary once required items and remaining shape/index facts are independently captured, or existing protection already suffices. Unpublished dependencies still need protection. Body readiness never changes logical write precedence.

### Cursor algorithm

1. Select and capture the source at issuance under ordinary ordering, authority, and the Chain mode. Unsupported categories produce NotIterable without coercion. Complete mode first completes the captured structural boundary.
2. Keep the next numeric index i and the captured layout/placement view.
3. Establish inRange(i). If false, finish; if pending, retain the question; if failed, report structural enumeration failure.
4. Establish final membership/presence and the payload source at i. Wait for structural selection still able to delete, overwrite, or move this occurrence. A positional flag, permanent structural poison, or marker is a structural obstruction; do not deliver it.
5. Receive the established payload into its ordinary elem Chain and return { done: false, value: elemChain }, then advance i. Do not await the payload or reject an ordinary payload Error item. A known hole gives the binding an undefined root.
6. Continue from the capture, never the later live Array or a rescanned prefix.

Complete and sequential modes use this ordered cursor with different structural readiness gates. The final unordered stage adds occurrence discovery over the same layout; it skips structurally invalid occurrences while preserving genuine path blockers. The terminal step-failure behavior below specifies the ordered cursor. Unordered delivery must finish independent survivors before any terminal aggregate reporting; finalize that reporting transport with its API, without using a local marker to abort unrelated delivery.

The Chain in the step owns its pending payload. Cascada binds that exact Chain without importing it as language data or wrapping it again. An async generator yielding raw payloads would await them; a standard async iterator returning holders avoids that wait. Keep ready transitions sync-first and use existing guarded continuations for pending structural facts.

Cascada's trusted consumer pulls one step at a time but may start many bodies without waiting for earlier payloads or independent bodies. No per-element deep health check or new worker scheduler is required.

### Completion and early stop

A done step means successful enumeration exhaustion, not completion of independent payloads, bodies, or native effects. Cascada owns those lifetimes and its existing sequential/bounded/unbounded pacing. It controls when to request the next step; the iterator introduces no worker scheduler.

For a root or structural enumeration failure, the adapter returns a rejected step Promise containing the existing PoisonError, including when failure is ready. Never return a bare Error as a step record. This is a narrow iterator transport rule; graph operations still fulfill with language poison. Ordinary element poison stays inside the elem Chain; a pending payload publishes poison there on recoverable failure. Fatal execution failure retains rejection. The trusted consumer uses isFatalError and isPoisonError under its guarded composition boundary, covering synchronous entry throws and step rejection. Managed capture failure retains LookupReflectionFailed without a second IteratorFailed wrapper.

After structural failure, issue no more items and perform the loop handling below. A failed boundary is not successful empty exhaustion. Keep didIterate on the loop, not on Error objects.

`return()` closes future enumeration and releases cursor-only unread uses without scanning the suffix or cancelling shared production. An already-issued pending next() retains its own required capture and finishes with its original result or failure. Return reports done after local cleanup; it does not wait for that request, body work, or payloads. The consumer must receive or discard an outstanding result through ordinary binding cleanup. A required never-settling dependency can keep that one issued request pending.

Give the pending step its own work owner before releasing cursor state. Do not strand its Promise by closing an owner used by its continuation. Repeated return and next after local termination return done without reopening the source; execution fatality retains the common pending-result rejection and entry rules. One-pull-at-a-time trusted consumption requires no request queue. The [lifecycle table](docs/array-iteration-technical-analysis.md#8-close-the-cursor-not-an-issued-step) and ready/deferred witnesses define the selected behavior.

#### Receive the item before returning the step

Construct the ordinary elem Chain inside next() from the final captured payload version. It is a non-thenable holder, so awaiting the step does not consume its root or expire raw-value protection. The consumer binds it directly and owns its ordinary scope cleanup; cursor closure never clears delivered bindings. Source mode controls enumeration, while the binding retains its compiler-selected mode.

The existing [ready handoff](docs/integration.md#ready-delivery) ends at the next receiving transition or queued fallback. A protocol record alone would not extend that protection. Receiving the item before returning the record avoids a new raw-value handoff mechanism, deep export/re-import, and eager creation of every binding. The [public-runtime probes](docs/array-iteration-technical-analysis.md#7-select-chain-valued-iterator-steps) validate the basic ownership route; production structural/fatal and lifetime integration remains required.

### Compiler ordering and loop failure

Before source selection or any body can suspend, reserve the loop's ordered entry for the compiler-declared observation and mutation paths using the Phase 8 entry protocol. Capture the source/read dependencies through the correct pre-entry or contained view; an iterator must not wait on its own entry's completion. Bodies issued after later parent commands still issue through the loop's reserved views. A Promise settling first never grants a body a new parent position.

The [Phase 8 batch-entry and compiler cutover](docs/runtime-evolution-plan.md#2a-integrate-the-operation-chain-boundary-in-cascada) is still planned. Its overlapping multi-reference reservation, captured readonly views, and closure guarantees are prerequisites for shipping general compiled-loop integration in stage 1. An isolated cursor can be implemented earlier; it does not establish that integration or justify a silent single-path restriction.

The iterator's completion means no further bodies will be issued, not that all commands inside those bodies have been issued or completed. The higher runtime owns body/effect completion and preserves every reference through which more commands can still be issued. Reuse ordinary entry closure and nested reservations for those lifetimes.

Do not conflate loop-result completion with managed publication. Once an entry's own issuance closes, transfer its current partial placement/layout; already-issued child dependencies remain in that state and external effects retain their own reservations. A pending payload or unrelated body/native effect cannot hold a determined managed region behind an enclosing completion gate. Conversely, a still-open reference able to issue an arbitrary conflicting mutation cannot be released merely because the cursor finished. This preserves the existing separation in docs/enter.md rather than adding an early-close API.

On structural enumeration failure, preserve completed body effects and use Cascada's existing compiler-declared loop poison targets at the reserved position: poison the body effect chains; if no position was issued, also poison the else effect chains. After one or more positions, do not poison the unselected else chains. These are loop-control dependencies, distinct from kernel Array regions. Do not roll back bodies or infer targets by scanning the source. Ordinary item poison runs the body with poisoned data rather than failing enumeration. Run loop-else only on successful empty exhaustion; an explicit stop is not empty exhaustion.

The [push-only entry follow-up](array-layout-approaches.md#control-flow-failure-and-path-status) preserves issued appends and represents an unrepresented missing contribution with the declared marker. A known inserted occurrence with uncertain position needs no missing-output marker. An independent callback result or ordinary payload poison does not by itself poison entered targets.

### Control-flow poison publication

Provide an ordered public poisonPath operation for genuine compiler-selected path/scope failures. Preserve normal authority, source attribution, selection, first-failed-placement handling, COW, exact own-status repair, and external metadata. It is not permission to poison an entire Array merely because an element failed.

Missing Array contributions use the [marker contract](poison-policy-plan.md#6-missing-output-markers) through ordinary Array publication. Finalize how entry/compiler failure settlement supplies the affected contribution and footprint; the kernel must not infer missing output from any callback rejection. Known-slot failures use those slots, rejected payloads stay payloads, and independent result failures stay result-only.

Before a callback can suspend, reserve the affected work at its logical position. Delayed failure, marker insertion, and later commands use that view. Marker or flag publication completes through ordinary transitions, not a new queue or failure ledger. Do not write runtime poison into host properties to simulate canonical metadata.

The initial loop integration needs ordered poisonPath under the existing scope rules. The Array mode cutover adds the precise structural/marker behavior and current-data repair. Define the signatures, failure outcomes, compiler lowering, public exports, and authoritative integration documentation at those cutovers. The current API has no poisonPath operation.

### Metadata and value-ready batching

Initial phases use ordinary stream consumption without a new loop-metadata contract. The cursor keeps its numeric position internally; it does not require needsLength/needsLast flags or construct a loop object. Existing captured shape queries remain available to other operations.

Cascada may expose whatever metadata its existing stream mode supports without forcing full enumeration or payload settlement. Known total length, last-item status, and reverse indexes are not requirements for these initial stages. The final out-of-order phase specifies optional index/length/endpoint facts and their Promise or poison outcomes. Queries then must not depend on draining the same paced iterator; that would create a body/iterator self-wait.

Value-ready batching, if useful, is a consumer over this same stream. It does not create a second traversal or representation.

### Item boundaries

Use normal managed handoff/receiving protection, including pending delivery. A JavaScript local or a Promise field in a protocol object is not a holder. Aliases and cycles remain shallow payloads; no deep export, re-import, or graph walk is needed for enumeration.

A registered mutable external identity cannot escape its canonical path as an item; deliver the existing per-item ExternalCapabilityEscape outcome without poisoning the source. Permitted exact Functions and observation-only external leaves remain read-only. Merely encountering them grants no authority and requires no host inspection or reservation. Loop destructuring uses ordinary managed reads rather than native access to an internal ArrayView.

## 8. Representation and lifetime requirements

Extend the existing placement/version and Array shape model. Keep TYPE.Array, ArrayViews, ordinary Errors, receiving boundaries, and captured identities. A region is a compact description of shared placement dependencies, not a new language value or iterator-owned shadow Array.

The common representation must provide:

- Captured exact-length and in-range questions, with independent lower/upper bounds and failed shape.
- Captured point presence/value access and bounded sparse placement enumeration.
- Captured range forwarding/remapping, point overrides, deletion, truncation, and whole-location detachment.
- Enumeration of current structural failures for queries and full consumers.
- Shared settlement into live versions, including versions retained by earlier captures after current storage is superseded.

### One layout boundary

Use the [queryable block layout](array-layout-approaches.md) through existing language-property access and ArrayView capture/resolveLength/resolveInRange facilities. Retained layouts use Variant B's flat leaves, relative-count tree, exclusive-node reuse, and shared-path copying. The layout document owns composition, settlement, endpoint rules, and prototype workloads; the cursor does not traverse tree nodes directly.

Ordinary Arrays and simple views remain compact under the same query contract. [Compact pushes](array-layout-approaches.md#compact-append-path) with pending payloads do not require tree storage. Verify long append tails after uncertainty and [return to compact storage](array-layout-approaches.md#returning-to-compact-storage) without changing captured slots or forcing repeated full copies.

Lookup precedence is the selected version's point override, its layout mapping, its captured backing view, then unmasked physical storage. An absent override masks older presence too. Never combine a historical layout with a later live override. Sparse enumeration and graph summaries use this same boundary rather than independently inspecting backing properties.

Extend the existing LengthState/captured-shape boundary with the required structural facts. Growth contributions alone cannot represent truncation, shifts, subtraction, or failed layout. Preserve known total length when individual block counts remain pending. Do not add an iterator-only prefix model or a second shape authority.

For each adapted method, replace native-intrinsic execution on ArrayRemap as the semantic decision procedure with the common mapping/write evaluator. Ready, pending, and failed controls use that evaluator. Native assembly may materialize a determined result; JavaScript remains a successful-input oracle.

Install dependencies once and resume only affected work through existing guarded continuations and history-safe worklists. Never replay a command, comparator, conversion hook, or host action. The cursor retains its next undecided boundary and resumes from there; already-issued slot Promises settle independently. Required publication, topology, completion, and release advance even without another read. Derived calculation and caching remain implementation choices, subject to the same semantics and work bounds.

Use the [technical baseline and probes](docs/array-layout-implementation-findings.md): shape facts do not own payload roots, narrowed selections retain restricted source uses, and layout-owned inputs reuse parent-derived preservation. Active notifications follow changed semantic projections; dirty-cache wakeups alone fail the fixed-size history bound. Start graph integration with existing placement publication and simple backing projection. The probes do not implement or validate the push-only entry extension; its [integration order](array-layout-approaches.md#integration-order) includes the policy/status foundation.

### Ownership and topology

Known published placements have complete logical parent relationships. Unknown destination positions have no guessed graph edges; source captures/leases preserve their inputs until positions can be published or discarded. Shared settlement updates parent relationships and active counters before consumer callbacks. Error/pending summaries include local structural facts as well as ordinary child placements.

Capture source and destination independently. A later write or COW fork preserves earlier facts without giving a shared producer authority over the new placement. copyWithin captures all overlapping source versions before installing destination effects; forward mappings do not reread their destination.

COW, materialization, backing sharing, canonical assembly, retirement, and cached re-entry preserve authoritative forward state. Materializing physical storage is not proof of complete shape. Retirement removes obsolete reverse references and destinations, not captured producer authority still needed elsewhere. Restoration uses maintained state, without host reinspection or resubscription.

### Deferred children and graph summaries

A child retained by a deferred region is an input dependency until its destination placement is established. Retention alone does not assert that it belongs to the output. Preserve it through ordinary captures/protection, without inventing a numeric parent key. Before publishing an established placement, install its real parent relationships and required counters.

Array Error/Promise queries must include output-relevant deferred dependencies as well as indexed placements. Keep uncertain membership conditional: if a pending splice may remove a poisoned child, retaining that child alone cannot make hasError return true. Excluded sources and alternatives hidden by a failed mapping remain outside the current frontier, as specified in section 6. Counters over established placements alone are not a complete partial-Array summary.

Deferred captures belong to their live layout uses. Replacement or retirement releases the obsolete use; earlier captures retain their own protection. A cycle through deferred captures must not make an otherwise abandoned layout permanently live. Test this lifecycle with managed children, aliases, and cycles before relying on existing parent-index machinery for partial layouts.

### Work ownership and release

Shared data producers own captured inputs, context, and their live uses. Operation owners retain required result/validation/effect work. Neither substitutes for the other. Transfer a partial result's producer before invocation closure; keep mutating command work open until its specified completion.

Release each source at last access, independently of body/result completion. Once a source is fully captured, pending callbacks retain its versions and clearable output destinations, not the old container or unread siblings. Remove producer-only references when no destination, capture, or required command result can use them. A never-settling source may retain a callback, but that callback must not unnecessarily retain an abandoned graph. Preserve ordinary Promise ownership; this is not cancellation.

Use one cursor lifetime and guarded result boundaries for public pending step requests. Per-item graph capture is not a separate public command; closing the cursor and completing a step have distinct lifetimes. Fatal resumption and local closure retain existing shared-settlement/operation-work checks. No iterator registry, producer scheduler, execution-wide sweep, or new thenable transport is needed.

### Work bounds

Work is proportional to consumed data, produced output, captured versions, and necessary unfinished transitions. Preserve sparse gaps symbolically; do not allocate per possible hole or failed index. A value iterator may visit every index it actually issues, but an early exit must not allocate the remainder. Reuse maintained range indexes; do not repeatedly scan delivered prefixes or settled command history. Test N unfinished operations on a fixed small graph, including repeated captures/reads and operations later proved to have no effect; distinguish unavoidable retained versions/output from avoidable history traversal. Settling one branch must release its spent predecessors while unrelated branches remain pending.

Drain history-sized forwarding, completion, and release with loops or synchronous worklists. Keep ready transitions synchronous and use existing ordered thenable continuations. Required dependencies may remain pending indefinitely; neither timeout invention nor a later command becoming an earlier prerequisite is acceptable.

## 9. Repair integration

Use [exact-path status clearing](repair-simplification-plan.md). Sequential positional flags retain the known payload at its fallback position and are repairable. Permanent structural poison, markers, ordinary payload poison, and complete-mode root Errors are not hidden values waiting for repair.

Repair returns undefined after successful status publication and does not await the selected payload merely to decide that return. It preserves current writes and positions, does not discover intended order, and does not restart an old iterator. Ordinary replacement/removal can discard Error data.

Keep only captures needed for ownership, snapshots, native isolation, unfinished results, or retained current data. No rollback baseline is kept solely for repair. Basic positional status and its protection are prerequisites of structural prefix integration; the general policy/repair cutover also covers native and canonical external boundaries.

## 10. Implementation sequence

### Implementation and validation work

The method specification and technical probes are complete for the selected bounded rules. Observation calls retain transformed-copy results; ! calls retain JavaScript results. Production implementation has not started. The following integration and acceptance work remains:

| Work | Required result | Needed before |
| --- | --- | --- |
| Cascada prerequisite | Phase 8 batch-entry/compiler ordering and execution/Error integration; an isolated cursor is not general loop integration. | Compiled loops in stage 1. |
| Iterator transport | Integrate selected elem-Chain delivery and independent issued-step lifetime; verify structural/fatal boundaries, repeated close, and release. | Initial iterator API. |
| Mode/failure evaluator | Implement the [completed method rules](docs/array-method-specification.md): correlated normalizers, bounded fallbacks, coupled copying, sort/flat, root validity, roles, and completion. No new cross-read provenance API. | Shipping each partial method family. |
| Marker publication | One marker per relevant missing contribution, ordered placement, role preservation, capacity/bounds, query collection, and ordinary removal. | Failed open-output streaming. |
| Captured mode handoff | Preserve issued producer semantics, destination policy, existing flags, and ready/pending equivalence across Chains. | Mode API cutover. |
| Layout lifetime | Nested source restriction, pending-child publication, parent relationships, counters, canonical export, retirement/re-entry, and cycles. | Production layout integration. |
| Work bounds | Bound mixed deferred transforms, conditional collection, forwarding, and release on small graphs with long history. | Production layout integration. |
| Repair/queries | Current-data status, fallback-index repair, root/data Error distinction, captured isPoisoned/hasError/getErrors, native boundaries. | Their public cutover. |
| Entry protocol | Capability overlap, reserved contribution location, private reads, nested issuance closure, and failure classification. | Open-entry extension. |
| Diagnostics | Bounded context-plus-cause records and grouping by logical Chain. | Scheduled before unordered delivery; no artificial iterator dependency. |
| Unordered integration | Occurrence discovery, duplicate identity, index/fallback transport, failure reporting after independent survivors, Cascada ordering/metadata, exactly-once handoff and release. | Final stage. |

The [technical findings](docs/array-layout-implementation-findings.md#6-specification-and-integration-acceptance) distinguish demonstrated cases from unproven integration. The [two-task analysis](docs/array-iteration-technical-analysis.md) selects holder delivery and the pending-step lifecycle; the [method specification](docs/array-method-specification.md) completes its remaining family and integration rules, with expanded executable evidence. Balancing, leaf/cache policy, folding, and materialization thresholds remain measured choices. Bring back a concrete behavioral tradeoff if those investigations expose one.

### Implement the specified dependency rules

The [method specification](docs/array-method-specification.md) owns the closed bounded rule set: normalized/shared controls, symbolic lengths, range and endpoint selection, fallbacks, root validity, placement roles, sparse writes, sorting/flattening, and direct outcomes. Use the common rules rather than a separate implementation for every pair of methods.

The [bounded analysis](docs/array-iteration-technical-analysis.md) and [expanded probes](test/experiments/array-method-specification-probes.mjs) provide executable witnesses. Include successful, pending, failed, and fallback outcomes in the reference domain. Native Arrays are successful-layout oracles; the explicitly specified modes define failure.

Implementation may conservatively wait outside the required reductions, but it must neither miss a required proof nor choose failure from representation or settlement timing. Stronger precision changes belong in this common contract. Production integration must rerun the witnesses through actual layouts; specification experiments do not certify an implementation that does not yet exist.

### Delivery order

1. **Determined-layout ordered iterator.** Use existing captured properties, pending payloads, standard stream pacing, early stop, ordered compiler failure publication, and self-modification tests. General compiled loops require the Phase 8 prerequisite. No new loop metadata.
2. **Partial-layout tree and prefix streaming.** Land simple argument-irrelevance reductions before/with this stage. Test Variant B in isolation, then integrate published-occurrence queries, ownership, topology, and the mode/status primitives needed for correct structural-prefix behavior. Already-issued operations with pending controls are included.
3. **Complete mode, query, and repair cutover.** Finish the three-mode construction API and common failure publication, marker support, exact status-only repair, captured Error queries, and native/external integration. Do not ship stage 2 structural streaming under superseded failure semantics; required primitives belong to that integration.
4. **Open enter contributions.** Integrate reserved regions, later pushes behind earlier open production, capabilities/overlap, private reads, nested closure, safe bounds, and one marker for missing output. Preserve issued effects and ordinary payload behavior.
5. **Complete coverage and optimization.** Finish remaining partial-layout methods, compact diagnostics, balancing/leaf/cache choices, folding, materialization, and mixed-history proofs. Correctness/lifetime tests accompany every earlier stage.
6. **Unordered occurrence streaming.** Deliver guaranteed survivors with independent payload/index futures, accepting the declared fallback ordering. Integrate Cascada ordering and optional metadata; repeat self-modification, failure, handoff, and lifetime checks.

### Method coverage

All existing methods remain callable throughout rollout. Stage 2 supplies the structural core: fixed slots, point/length edits, endpoint operations, splice, fill, copyWithin, reverse, and the slice/concat mappings needed to compose and consume these layouts. Integrate coherent families with their readers, queries, identity, and lifetime obligations rather than exposing half-supported partial data.

Determined-shape irrelevance needs no layout tree. Before or with stage 2, make preparation demand-driven for the existing table's empty/range/self-copy proofs, zero/one-element join, comparison-free sort, and search candidate mismatches, including [1].indexOf(2,P). Use the existing captured length/in-range facts and ordinary comparisons. Land ready, pending, invalid, and poisoned forms together through common preparation; do not add a poison-only dispatcher. Early equality is used only where existing captured facts provide it; otherwise compare resolved normalized numeric arguments.

Methods whose partial-layout evaluator is not yet adapted use a documented whole-input wait/materialization path after applying available dependency reductions. They cannot inspect incomplete backing storage as though it were the complete Array. Stage 5 finishes remaining partial-layout work such as sort/search/join/flat and the broader boundary audit; it must not postpone their simple determined-shape reductions. Record the supported precision for each landed family, and remove its superseded implementation at cutover.

Use the [bounded dependency rules](array-layout-approaches.md#bounded-dependency-rules), independent reference model, and [acceptance workloads](array-layout-approaches.md#102-acceptance-workloads) throughout. Isolated tree tests do not replace runtime topology/ownership tests. Keep exact failure semantics, ready-input costs, and retained-history work visible during measurement.

Update authoritative contracts, integration docs, and Phase 9 status with each runtime change. Stage labels do not authorize temporarily publishing under incompatible failure rules. Keep one method evaluator and one mode-aware publication boundary.

### Migration inventory

Update contracts and their pinned tests with the corresponding implementation, not during specification-only edits. Extend this inventory when the per-family specification identifies another changed observable outcome.

| Existing contract or witness | Required migration | Cutover |
| --- | --- | --- |
| [Observation mutator results](docs/run.md) and [run.test.js](test/run.test.js) | Retain transformed-copy results for all nine observational mutators. Keep ! results native-style; splice mutations return removed elements. Add mode-dependent partial copying-result publication without changing the observation return types. | Stage 2 mode-dependent copying results; existing return types remain. |
| [Array preparation](test/array-preparation.test.js): with(0,7) waits for pending exact length | Permit a partial result once index validity, capacity, and prior root/publication prerequisites are proved. Preserve genuinely required entry dependencies. | Stage 2 partial producers, under the constructed-result validity rules. |
| [Range recovery](test/array-range-recovery.test.js): fill/copyWithin restore the full baseline | Separate destination-local storage failure from ancestor publication failure. Preserve independent writes/local poison where publishable; do not reinterpret every publication failure as an element Error. | Stage 2 regional writes; stage 3 status-only repair. |
| [Array identity tests](test/array-range-identity.test.js), [safeguard registry](test/safeguards/registry.mjs), [mutation identity](docs/run.md#mutation-identity), and [Phase 3](docs/runtime-evolution-plan.md#phase-3-establish-write-based-identity-and-searches) | Replace the present self-copy effective-write expectation; retain genuine same-value-write safeguards. | Determined-shape reductions, before or with stage 2. |
| [Sort comparison and failure contracts](docs/run.md#sort-comparison) | Remove comparator-before-irrelevance validation; classify copying-result barriers and regional comparator/conversion failures explicitly. | Simple proofs before/with stage 2; partial sorting in stage 5. |
| [Managed storage contract](docs/data-limitations.md) and [scope baselines](AGENTS.md#scope-poison-and-repair) | Remove controlled rollback assumptions; separate current-data status from native isolation and local poison. Preserve the native supported-failure boundary. | Regional stage 2 changes and stage 3 policy/repair. |
| [Error handling](docs/error-handling.md), [entry](docs/enter.md), and [integration](docs/integration.md) | Publish poisonPath, iterator rejection transport, new query names, captured status, and status-only repair at their actual API cutovers. | Stages 1, 3, and 4 respectively. |

## 11. Required verification

| Area | Acceptance cases |
| --- | --- |
| Modes and recovery | Complete structural gate versus both streams; [A,B] plus failed-position X has three fallback slots, sequential flags and unordered healthy survivors. Repair reveals fallback data without changing old captures. Missing output gets a marker, never a positional diagnostic fourth slot. |
| Schedule equivalence | Ready values/poison, synchronous supported thenables, native Promises, reverse fulfillment/rejection, and required complete Error collection. Compare facts/effects, not merely final export. |
| Independent publication | Streaming pending-count splice exposes A/B/X. Unrelated reads/writes use shared facts. Complete mode holds that structural version until success/failure is established. |
| Required prefix | Apply declared shape and source-selection rules at every partial settlement. Sequential issuance requires a final occurrence at that index; lower bounds alone are insufficient. Payload Promises remain independent. |
| Endpoint composition | In streaming mode, pending splice then push Z permits at(-1)=Z and reverse starts with Z when prerequisites are safe. Repeat never-settling, ready-failed, and rejected controls; the fallback must preserve already proved facts. |
| Position versus value | [never,B] issues both occurrences in every mode when structure is ready. Pending/failed source selection blocks sequential delivery even when length is exact. Payload Error items remain deliverable; structural Errors and markers do not. |
| Operations | Every controlled name and mode, indexed assignment/deletion, length writes, replacement, narrow entry, and repair. All nine observational mutators return transformed copies; ! results retain JavaScript meaning, including splice removed elements. Distinguish sparse observational splice from dense toSpliced. Pending keys resolve to indexes, length, invalid values, or poison. Compose push/shift/unshift/pop while removed payloads never settle; reverse pending payloads; sort before/after captures, with independent undefined/hole tails. |
| Validation | with waits only for still-required index validity and returns root poison when invalid. Cover classification/capacity, constructed-result mode rules, flat cycle validation, and distinct direct results versus receiver fallback. |
| Failure locality | Test payload, selection, membership, storage, ancestor, and comparator failures under all modes. Complete root failure and streaming local/fallback outcomes are explicit; broader authority alone does not widen a regional footprint. |
| Failed ranges | Known start/failed end and failed start/known end fill preserve unaffected regions. Test tighter bounds only with a specified derivation, not an unsupported range annotation on a failed argument. Later push remains healthy outside the failed captured extent. Pending controls remain pending. Pure insertion retains surviving occurrence facts even when numeric reads fail. |
| Irrelevant argument failure | Apply the universal rule across every controlled method and argument position, including ignored extra arguments. Cover observations, no-ops, and real effects: empty fill/copyWithin, empty/out-of-range searches, empty at/slice/flat, zero/one-element join, comparison-free sort including repeated-source proofs, and deterministic splice. Repeat before/after composition and materialization, with invalid values and never-settling inputs; irrelevant inputs cause neither poison nor delay. |
| Search range independence | [1].indexOf(2,P) and lastIndexOf return -1; includes returns false. Repeat with never-settling controls, holes, partial shape, conditional comparison Errors, and directional matches. Candidate exclusions and mismatches mask only their own irrelevant dependencies; no arrival-order Error wins over a deterministic answer. |
| Required effect/result failure | Complete mode returns root Error on relevant structural failure; streaming capacity failure preserves its declared genuine path boundary. Repair clears flags, not marker/data Errors. Controlled self-copy ignores irrelevant end; independent direct-result failure does not fabricate Array history. |
| Conditional relevance | Failed argument first, shape/range proof later: compare empty/unused and nonempty/dependent outcomes under all delivery orders. No premature poison or discarded independent result; do not force irrelevant conversion/inspection/subscription. |
| Bounds and capacity | Omitted/undefined/extra arguments, relative/fractional indexes, NaN/infinities, empty ranges, sparse Arrays, maximum length, failed exact length with usable bounds. Check soundness and the required precision of the [capacity rules](#required-capacity-proofs): safe publication, required wait, definite overflow, and failed-prerequisite blocker. Preserve correlated totals through composition and materialization. No combinatorial inference required. |
| End-relative coordinates | fromEnd offsets in source selection and edit targets; forward and backward signed counts; empty/clamped ranges; known suffixes behind pending or failed prefixes. Check pop, negative slice/with/fill/splice/copyWithin, and includes without requiring unrelated absolute coordinates. Numeric search results and iterator indexes still require their numeric facts. |
| Supersession | Write or truncate a prefix before its old remainder settles; replace the Array while an old removed-result remains pending. No stale replay or regrowth; earlier captures stay unchanged. |
| Consumer-specific facts | Delete a slot whose in-range fact is pending or failed, then read it through lookup and positive at: return undefined while iteration still needs membership. No consumer bypasses an owning-path blocker. |
| Queries and extraction | isPoisoned distinguishes root/path poison from element/marker failure; hasError/getErrors see the captured frontier. Genuine flags block in every mode. Unordered position-only fallback creates no Array Error. Queries never drain the iterator. |
| Identity | One effective successor per command/node despite multiple publications; genuine no-op and controlled self-copy forward. Required same-value assignments still write. Delete inherited absent/present/pending/failed presence, including absence published before the identity decision and unrelated failed length. No-op copies made before the decision preserve the original identity. Identity can finish while producer work remains; later generations are never rewritten. Update the [self-copy migration witnesses](#self-copy-migration). |
| Topology | Views, holes, absent overlays, overlapping copies, shared children, aliases/cycles, indexed and unindexed graphs, COW, retirement/re-entry, and canonical export. Deferred children remain protected without guessed keys; conditional summaries exclude discarded sources, and retirement releases abandoned deferred captures. |
| Loop integration | Unbounded/sequential/bounded pacing, break/return, empty success versus failure, Error items, destructuring, body aggregation, and ordinary stream consumption without required new loop metadata. Late bodies precede later parent work through reservations. Closed outer issuance publishes partial state while child dependencies remain; an unrestricted open mutation reference cannot expose a provisional prefix. Structural failure poisons declared body/else targets according to issued-position count. No metadata/body self-wait. |
| Self-modifying iteration | Verify the captured iteration and the live mutated Array separately against the ordered reference model. Exercise the source-mutation matrix below after runtime integration and again with out-of-order delivery; isolated capture probes are insufficient. |
| Control-flow poison | Compiler-selected failures retain reserved order. Missing output has one real marker where required; issued payloads and independent result failures retain their scopes. Positional failure is not missing output. Verify marker placement, ordinary removal, capacity, and source attribution. |
| Boundaries | External-capability item errors, healthy native Error data, protected handoffs, opaque native method preparation, ready-only mutable-external snapshots, and fatal resumption. Whole-path authority rejection precedes regional publication; registered-resource scopes fail before argument settlement. |
| Lifetime/work | Early stop, consumed prefixes, and abandoned results release source uses while unrelated dependencies never settle. Include independently backed regions, pending metadata, and retained snapshots; distinguish permitted backing retention. Retain unformatted diagnostics in lifetime probes. Long pending/no-op histories on a small graph do not grow quadratically; sparse ranges are not expanded unnecessarily. |

### Self-modifying iteration

Keep arbitrary source mutation supported. The iterator preserves its captured view; each elem Chain protects its received item. Do not rely on lookup speed, body pacing, or a ban on writes to unread indexes. Reuse entry protection where sufficient and retain unread version facts where it is not; a capture need not copy or resolve the whole Array.

At implementation completion, review the ordering and lifetime argument alongside these integrated cases:

- A body writes the current, earlier, or next unread index, including nested managed children and aliases. Run immediate mutations inside the same entered reference without an intervening await. Distinguish mutation of the elem binding from mutation through the live Array.
- A body appends, removes, inserts, reorders, fills, copies, truncates, or replaces the source. Iteration still enumerates its captured occurrences: appends do not extend that iteration, and later removal does not erase an unread captured occurrence.
- Combine ready and pending payloads, pending layout controls, earlier pending entries, rejection, and delayed body commands. Vary settlement order under sequential, bounded, and unbounded pacing; repeat with index futures when out-of-order delivery lands. Both the captured items and final live Array must match logical command order.
- Stop early or replace the source while items remain pending. Transferred items retain their own protection; unread captures release at their last use without stale publication, lost items, or retained abandoned regions.
- Capture through the entry's private prefix, including when the body mutates that same source. Check that iterator acquisition, queries, nested entries, and closure introduce no dependency on the loop's own future completion.

Use existing public-operation, model, conflict, consistency, and lifetime verifiers. Add an independent bounded enumeration oracle for the specified dependency rules: on small Arrays, enumerate legal normalized controls and source selectors, preserve [shared inputs, coordinate normalization, and repeated occurrences](#shared-inputs-and-occurrences), and check facts at every partial-settlement state. Include failure membership, root validity, write decisions, capacity outcomes, and all-ready results. Exercise capacity near the real maximum with symbolic lengths and sparse spans, without allocating those elements. Ready poison and delayed rejection use the same relevance rules and fallback; pending controls retain their legal domains until settlement. Ordinary JavaScript is only a successful-layout oracle because its eager validation differs from these failure semantics. Test accessibility with never-settling unrelated dependencies and controlled delivery, not timing-sensitive sleeps. Do not implement enumeration in production or make the oracle demand proofs outside the agreed rules.

## 12. Required-effect failures

Do not add a frozen poisoned-size state, a capacity-only marker, or a retained command-error log. Ordinary failed layout already has practical uses in partial splice and bounded consumers. It does not freeze future size writes and must preserve the specified independent facts of subsequent operations, including endpoint relationships.

### Capacity: owning-path failure

Capacity overflow is an invalid request, not an unknown legal length; [oldLength,MAX] cannot encode it. Prove required capacity, including any marker/fallback contribution, before exposing facts a capacity failure could invalidate. No mode publishes an insertion whose existence still depends on capacity. Apply the [required capacity proofs](#required-capacity-proofs), then wait only for still-required controls. A definitely invalid request returns the operation's capacity Error. A failed required control that prevents deciding validity returns its causal poison after the ordinary dependency reductions.

Complete mode produces ordinary Array Error for this structural failure. Streaming modes may retain the established affected-Array own-path boundary when no legal local insertion can represent the failed request; it blocks ordinary access until repair/replacement. Broader authority does not poison unrelated parent fields. No poisoned-size value or out-of-capacity marker is introduced. Repair of a genuine flag exposes current data and preserves local poison; it cannot restore a complete-mode Error. Non-mutating producers return result-root poison and leave sources unchanged.

This uses ordinary owning-path invalid-request handling, with the affected Array as its scope. It does not change the regional footprint of ordinary splice-count failure when capacity is already proved safe.

#### Required capacity proofs

Capacity uses the same bounded dependency rules as layout queries. Its precision is part of the contract: a wider cached interval must not introduce a wait or blocker that a required rule removes. Let L be the captured source length, k a known insertion count, and MAX the maximum Array length.

| Operation | Required length relationship or upper bound |
| --- | --- |
| fill, copyWithin, reverse, sort, and length-preserving copies including with | L; capacity needs no new proof of the source's exact length. Other validation remains separate. |
| Valid length assignment; canonical index assignment at i; deletion | n; max(L,i+1); L respectively. An unresolved general property key is not yet an index. |
| push / unshift | L+k. Zero arguments introduce no capacity dependency, although the returned length can remain pending. |
| pop / shift | max(0,L-1); cannot overflow. |
| splice / toSpliced | L-d+k, with normalized deletion count 0 <= d <= L-s. Preserve correlated totals: d=0 gives L+k; d=L gives k. Omission and defaults follow the method rules. |
| concat | Sum of classified Array-part lengths and singleton contributions. Classification alone does not establish those lengths. |
| slice | Normalized selected count, at most L. |
| flat | Sum of discovered output contributions, with required classification/depth/cycle checks. Use established expansion bounds; do not infer a bound from outer length alone when flattening can expand it. |

Apply these relationships through captured versions, shared controls, and composed mappings. Use the supported normalized ranges to prove the output never exceeds MAX, or that it always exceeds MAX. Preserve exact correlated totals rather than summing independently widened pieces. Otherwise capacity remains dependent on the unresolved controls; a required failed control produces the blocker described above. These successful-layout relationships do not waive argument validity, root classification, or other prerequisites.

Examples:

- With L <= MAX-1, splice(P,0,"X") is capacity-safe even while P is pending; on failure the three-mode positional fallback applies without an extra marker. With L=MAX the same insertion definitely overflows, independent of P.
- After an unrestricted pending length assignment, the only available upper bound may be MAX. A positive-count push must then wait for a tighter proof; its payloads do not affect that proof. push() needs no growth check but still returns the captured length.
- On an accessible Array with regional shape failure, a later valid length reset supplies its own exact shape. It can remove the earlier length dependency; it cannot bypass an owning-path blocker.

Verify these capacity decisions as well as bound soundness. In particular, safe-capacity regional failure and a failed-capacity-prerequisite path blocker must not vary with settlement order, caching, or representation.

### Assigned length validity

An explicit length assignment validates a legal Array length before committing. A poisoned/invalid input fails that prerequisite; complete mode exposes Array Error, while the streaming invalid-request boundary can retain current data under genuine own-path status. Do not choose a random legal size or create a frozen failed-size value. Pending resize may truncate to zero, so no mode can assume every old occurrence survives. Ordinary path blocking and exact repair apply to a retained flag.

### Controlled self-copy: semantic no-op

When copyWithin's normalized source and destination starts are provably identical, every possible copied position maps onto itself. Values, presence, length, and identity remain unchanged. The mutating call returns its receiver and prescribes no data writes. End is therefore irrelevant under the [universal argument rule](#universal-rule-irrelevant-arguments-never-introduce-poison), rather than a special exception for this method or parameter. Selection and authority still precede the call.

Avoid mutation isolation/copying once the no-op is known. If necessary preparation created a private representation before the decision, finish it as no-effect and preserve the original captured identity using the existing forwarding/assembly mechanisms. Observation mode retains its ordinary distinct-result contract and may share backing storage rather than copying elements.

This revises controlled self-copy's write rule, not equal-value writes: an explicit same-value assignment and two cancelling mutations retain their prescribed effects. This no-data-write proof needs no old-value comparison or failed-identity state. It does not justify preserving identity for a different-position copy that performs a write, even when its resulting values are equal.

No general rule erases a write whenever a source maps to the same position. reverse does not write its middle position; controlled self-copy has this explicit no-op rule; sort still prescribes writing a present singleton and therefore advances identity. Those per-method write rules remain independent of comparator relevance.

#### Self-copy migration

Use the common [migration inventory](#migration-inventory). Land ready and deferred behavior together and replace the obsolete self-copy witness while retaining safeguards for genuine writes. Update production contracts and tests with the runtime change.
