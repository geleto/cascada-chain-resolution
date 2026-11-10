# Ordered Array iteration and partial publication

Implementation design for [Phase 9](docs/runtime-evolution-plan.md#phase-9-implement-incremental-managed-access-and-iteration), using [queryable block layouts](array-layout-approaches.md) and [Variant B](docs/remap-structure-variant-B.md). The [Chain-mode contract](poison-policy-plan.md) is authoritative for the selected complete, sequential-stream, and unordered-stream policies, payload versus structural poison, fallback positions, markers, and [status-only repair](repair-simplification-plan.md). This plan specifies their Array integration and rollout. The initial cursor uses determined layouts; prefix streaming and final unordered occurrence delivery extend the same boundary. The [method implementation specification](docs/array-method-specification.md) supplies normalizer/correlation rules, coupled copying, sorting/flattening failure, placement roles, and work/lifetime obligations, including the [selected sort exception](#13-selected-decisions). Production code is unchanged; update authoritative runtime contracts at each implementation cutover.

## 1. Scope and semantic changes

Implement shallow iteration over captured managed Arrays, including ArrayViews and sparse Arrays. Sequential streaming issues the structurally published prefix in numeric order: membership, intended position, and final payload source are established, while payload values may remain pending or ordinary poison. Complete mode first settles required structural work; unordered mode later delivers guaranteed surviving occurrences without their indexes. Cascada preserves logical command order under every mode.

The selected layout supplies shared partial Array state. Each controlled operation describes a source-to-destination mapping; common machinery composes it with captured predecessors and answers shape, presence, and value queries. Settlement advances affected facts without replaying operations. The iterator only tracks its next numeric position and consumes these queries; it owns no separate layout or prefix-analysis engine.

Partial publication still benefits ordinary reads, searches, copies, writes, and Error queries across every independently available region. Restricting iterator delivery to the prefix does not restrict the shared layout to prefix-only storage. [Section 8](#8-representation-and-lifetime-requirements) defines its integration; the layout document owns blocks, composition, optimization, and the selected storage design.

The immediate workload is a compiled loop over an Array whose positions become usable before all its data does: [pendingA,B], a remap of pending payloads, or a splice with a known insertion point and pending deletion count. The first two already benefit from captured placement versions; the third needs partial layout publication. Measure these separately. This revision does not assume that every pending structural operation exposes a useful prefix.

Production already has captured length bounds and in-range questions in array-length.js/array-view.js, primarily for uncertain indexed growth, plus property versions for pending values. It has no public managed iterate operation and no general partial-layout engine for pending structural method controls. Intrinsic-backed methods still prepare required arguments and exact length before invocation. Extending the existing boundary is the starting point, not an already completed capability.

This revision changes the following contracts:

| Current rule | Replacement in this revision |
| --- | --- |
| A controlled structural mutation gates and, on failure, poisons its whole Array or selected broader scope. | The selected Chain mode and method define its structural boundary. Streaming modes publish independent facts and use regional poison/fallback; complete mode normally produces whole-Array Error. Required preparation/comparison failure in mutating sort retains a repairable Array-path flag in every mode. Broader authority does not enlarge regional coverage. |
| A failed managed mutation retains the complete scope baseline for repair. | Controlled regional failures have no repair baseline. The policy phase stores current data plus own-path status; repair clears status without rollback. Native isolation remains necessary. |
| Result layout construction finishes before handoff; payloads may remain pending. | A valid prepared Array may also contain pending or failed layout facts. Required call validation still precedes result-root handoff. |
| Controlled argument preparation can fail before determining whether an argument affects the operation. | Determine actual dependencies first. A poisoned, invalid, or pending argument cannot fail or delay effects/results proved independent of it. |
| Captured Array structure has numeric placements and pending value deliveries. | A partial layout can also retain children before their destination keys are known. Captures protect those dependencies; parent edges cover established placements, while aggregate queries also account for output-relevant deferred regions. |

Controlled commands are consequently not rollback transactions. A committed independent write survives another region's failure, and later commands can use healthy facts without repairing the whole Array first. In streaming modes, later work consumes the declared fallback and any actual remaining failure dependencies; one failed region does not abort every fact of that later command. Required source relationships survive composition; adding stronger independence rules is a semantic decision, not a storage optimization. Regional repair is deliberately unavailable. Restoring an explicitly saved predecessor as a new assignment remains possible; automatic restoration could discard intervening effects.

Mutation scope still selects authority, ordering, and path-failure ownership. The revised regional footprint applies after successful selection of a controlled Array operation. Opaque native managed calls retain selected-scope isolation and failure ownership; access through their retained path status follows the Chain policy after its cutover. Narrowing native failure to the receiver would be a separate architecture revision, not a consequence silently inferred here.

Successful valid-input mappings retain the existing controlled-method semantics, including holes, fixed external locations, ownership, and write-based identity. Use existing argument conversion only where that argument is needed. Skipping irrelevant conversion/validation and publishing independent effects after failure are deliberate semantic revisions; JavaScript's eager validation and abrupt completion are not their reference behavior. Ready failure and deferred failure use the same revised reference execution.

Native host iterators and their finalization remain Phase 8 work. Object enumeration, new Array method names, and a separate append-only stream API are outside this revision. Here, streaming means incremental delivery of the Array at the iterator's logical command position. Later commands are excluded; all logically earlier commands are included, even if some have not settled.

### Future: out-of-order element delivery

The unordered stages implement the selected unordered-stream mode, followed by bounded-window integration. Deliver a guaranteed surviving occurrence with its final captured payload dependency before its numeric index is known. Neither payload readiness nor an optional index query gates unrelated body work. Do not emit an occurrence that may still be deleted or overwritten.

Keep three facts distinct:

- **Published sequential occurrence:** final membership, intended numeric position, and payload source are established; the payload can remain pending or ordinary poison.
- **Published unordered occurrence:** survival and final payload source are established; its index can remain pending.
- **Fallback position:** after a relevant positional failure, the selected recovery layout supplies a deterministic position. This is not proof of the position originally requested.

After a=[A,B]; a!.splice(P,0,X), failed P uses fallback [A,B,X]. Sequential mode flags the potentially misplaced occurrences; unordered mode leaves all three usable and adds no positional marker or Array-path poison. A marker is for possibly missing output, not lost order. The [mode contract](poison-policy-plan.md#2-failure-categories-and-fallback-layouts) owns these outcomes.

The two streaming modes intentionally make different ordering/failure guarantees. Each must match its own all-ready reference execution for the same inputs and failures; changing settlement order cannot change its result. Array access, fallback, and later effects remain in logical issuance order, never arrival order.

An index future resolves from the captured successful or fallback layout when its required facts are available; it may remain pending behind a required dependency. Position-only failure in unordered mode does not automatically poison that future. Actual root/publication failure keeps its normal failure channel. Define the final public index transport and Cascada integration before this stage.

Occurrence discovery must distinguish duplicate copies of one payload, deliver each occurrence once, and release its uses without rescanning unresolved slots. The layout supplies these facts; Cascada owns command-buffer ordering, pacing, and any loop metadata. Extend the existing command-buffer tree without adding another Array layout hierarchy or layout engine. Initial phases require no new loop-metadata API.

The selected ordering design is [indexed command-buffer branches](#indexed-branches-for-unordered-bodies): receive an occurrence before its position is ready, and give its body branch that captured position as a Number or future. Corresponding branches in every used Chain's buffer share that ordering fact. Mutations and order-sensitive control follow final captured/fallback order; observations may run early when their required mutation interval is already established. Delivery or Promise settlement never becomes logical precedence.

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

Push-only authority alone does not guarantee early delivery from an open post-entry capture. Unbounded future appends can still overflow and introduce the whole-Array blocker specified in section 12. Early publication needs a safe bound on the remaining contribution, including any marker, and proof that future permitted failure cannot block the published region. Derive that bound from available facts or explicitly supply it in the entry/compiler contract before enabling this optimization. Without such a proof, waiting for issuance closure is correct. Arbitrary unbounded open streaming would require a separate change to overflow/path-failure ownership.

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

Sparse occurrences also carry captured status. A positional flag on an in-range hole blocks that occurrence without creating a present undefined element or a managed-child parent edge. Store such status with the absent-slot fact or a symbolic span; ordinary access checks it before using absence to return undefined. Repair clears the status and preserves the hole. Structural moves/copies preserve hole status, densifying methods preserve the status while creating their specified undefined placement, and explicit overwrite/deletion removes the selected status. For `new Array(2)` followed by failed-position pure insertion of X, sequential fallback retains two flagged holes and flagged X; unordered fallback retains two distinct healthy hole occurrences and X. Permanent structural Error and marker slots remain actual present Error data.

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

Apply the [common availability and failure contract](AGENTS.md#errors), with this plan's explicit mode/fallback revision: fallback indexes are selected recovery positions, not claims that the intended positions were established. Update that production contract at the [migration cutover](#migration-inventory). The reference model must state the supported reductions and resulting failure footprints before production; an uncovered failed-input case is a specification gap, not an implementation-selected Error. Delivering an elem Chain establishes its occurrence and final payload source, not a healthy eventual payload. Sequential delivery also establishes its intended position; unordered delivery carries the captured final/fallback index separately.

Use one evaluation rule for ready, pending, invalid, and poisoned controls:

1. Describe a needed control by its normalized semantic range and constraints. For splice, 0 <= d <= L-s. Pending controls retain alternatives. A failed control retains the information needed to prove relevance and select the declared mode-specific failure/fallback; do not choose an arbitrary successful input value. Other captured facts may still prove the control irrelevant.
2. Evaluate each output fact from the method's mapping, using range arithmetic, conditional selection, and exact captured source selectors. A selector names a source placement/version, an argument payload slot, a hole, or a prescribed literal. When a supported rule establishes that every remaining alternative selects the same fact, forward it without the control dependency. Failure to establish that proof remains uncertainty, not permission to guess. Distinct payloads that happen to compare equal are not the same selector.
3. Preserve constraints and captured source relationships required by the semantic rules, such as d <= L-s. An internal conservative approximation may admit extra possibilities, but must not turn those invented alternatives into extra failure or withhold a required answer. Do not replace source placement/version selectors with predecessor-index identity merely because a representation loses their relationship. No general symbolic constraint solver or production enumeration is required; extending the supported dependency rules is a contract change.
4. Retain required pending dependencies until selection or relevance is established. Apply the declared failure footprint: complete-mode root Error, permanent structural poison, sequential positional status, unordered survivor fallback, missing-output marker, or the explicit whole-Array sort exception. Do not finalize a failure while another required fact can eliminate or change it. The mode's actual retained frontier determines Error collection; unordered position-only fallback creates no duplicate Array Error.
5. Evaluate prescribed writes and operation completion separately from resulting values, using the method's semantic no-op rules. In particular, controlled copyWithin with provably identical normalized source/destination starts prescribes no writes, even when end is pending or poison. Other required writes retain their specified effects and failure footprints; equal payloads alone do not erase an explicit assignment or earlier command's effects.

The successful semantic range describes uncertainty, not validation success. An impossible request remains an independent validation failure; an empty set of valid indexes does not make with on an empty Array vacuously valid. Authority and physical storage failure are also not hypothetical successful argument values.

Return a determined result immediately, even when some arguments are pending, invalid, or poisoned. An eager preparation order or an incomplete list of examples is not evidence that an input is required. The evaluator uses structural range/shape simplification, identical selectors, ordinary available comparisons, and absorbing Boolean results such as false AND unknown. Apply proofs equally to ready and deferred failures and keep the reference model aligned. Do not speculate about sorted prefixes or search combinations of hypothetical comparison outcomes. These limits on proof work do not justify withholding an answer already established by ordinary comparisons or mapping composition.

An input is required only while a prescribed effect or returned fact depends on it. A method's argument table identifies potential inputs, not unconditional conversion or Error-collection obligations. Preserve complete collection for the actual dependency set; exclude inputs proved irrelevant. A conversion failure cannot make its own otherwise-unused argument required.

### Shared inputs and occurrences

Preserve sharing already explicit in internal captured layout/control facts. One internal fact has one outcome; repeated use must not turn it into independent hypothetical values. Each method argument position is an independent control, even when two positions receive the same variable, Promise, or Error. This does not prevent comparing successful normalized numeric values when they become available.

Reusing a source, as in concat(a,a), creates separate destination occurrences and parent keys. Shared payload identity does not merge them.

### Captured control identity at the API boundary

Each argument position starts an independent control. Neither exact Promise identity nor a common Error establishes a shared coordinate; separate lookup wrappers obey the same rule. Add no wrapper/provenance API, cross-argument identity inference, or Error comparison for this purpose.

For copyWithin, compare normalized numeric starts when available. Equal starts prescribe no writes regardless of where the numbers came from; otherwise wait for required controls unless normalization/shape facts already prove equality for every independent possibility, as on an empty Array. Incidental Promise wrapping or delivery timing cannot select a different poison outcome.

Keep local same-control folding only for internal facts reused by a mapping, such as one normalized deletion count used in both removed and retained extents, or the two sides of one split. It does not merge distinct argument positions. For nonempty `a.slice(x,x)`, equal successful numeric bounds give an empty result; failed bounds are independent controls even if x is one rejected Promise or one ready poison. In streaming modes, raw failed bounds produce the full-length structural-Error fallback; complete mode returns root Error. Test these forms and separately wrapped reads against the same reference, while testing internal shared-fact reductions separately.

### Structural proofs and payload inspection

Use captured shape, bounds, equivalent coordinates, shared selectors, and repeated-source blocks to establish independence. These facts must survive composition and materialization wherever the specified result relies on them. Do not add an old-value equality pass, or await old payloads solely to avoid a write or preserve identity. The rule is the same for ready and pending payloads.

Reads, searches, conversions, and sorting still inspect the values their actual algorithm needs. This restriction on extra equality work does not suppress ordinary comparisons or their short-circuit results. A structural proof can remove an algorithm step entirely: sorting occurrences of one captured payload cannot change their value arrangement, so its comparator is unused. The method's prescribed writes and identity outcome remain separate.

### Universal rule: irrelevant arguments never introduce poison

The [universal dependency rule](AGENTS.md#errors) governs every argument and independent outcome. The Array-specific rules below apply it under the explicit mode/fallback revision described above; they do not limit its scope.

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
| reverse, toReversed | Preserve length bounds; map j to A(L-1-j). Known L determines the source index without waiting for its payload. Apply required captured-selector relationships before retaining a length dependency; additional independence rules require a contract decision. A final selected source can retain a pending payload, including inside a delivered elem Chain. toReversed makes holes present undefined. Mutating reverse returns the receiver. |
| fill | Length L; in [s,e) install the payload; elsewhere retain A(j). Overwritten values are not inputs. Uncertain bounds affect undecidable destination and write predicates only. Mutation returns the receiver. |
| copyWithin | Length L; if normalized t=s is proved, prescribe no writes and ignore end. Otherwise c=max(0,min(e-s,L-t)); in [t,t+c), map j to pre-write A(s+j-t), elsewhere retain A(j). A copied hole deletes the destination. Capture overlapping sources before writes. Mutation returns the receiver. |
| splice | The receiver successor has length L-d+k: below s retain A(j), in [s,s+k) insert arguments, afterward map j to A(j-k+d). Mutation mode returns a sparse removed Array mapping j to A(s+j), length d. Observation mode returns the transformed copy; its source is unchanged. |
| toSpliced | Return the dense transformed copy with length L-d+k and the successor mapping above. Leave the source unchanged; there is no removed-elements result. |
| slice | Length max(e-s,0); map j to A(s+j), preserving holes. A bounded positive range can be selected without exact source length when in-range facts prove its bounds. |
| with | Validate the index; preserve length L, replace the selected position, and copy other values densely. A negative index's mapping can depend on L even when its validity is proved. The overwritten source value is unused. |
| concat | Place classified parts in order, with offsets from captured part lengths; a non-Array part contributes one position. Preserve holes in Array parts. |
| flat | Traverse present occurrences to the required depth; flatten only logical Arrays and omit holes at traversed levels. Retain deeper values without inspecting them. Offsets depend on preceding expansion lengths. |
| sort, toSorted | Preserve length and stable sorting/comparator contracts. Apply structural comparison-free proofs first; otherwise required values/comparisons establish ordering before result access. Required sorting failure blocks the whole affected Array/result even in unordered mode; do not substitute a healthy unsorted fallback. Use the [whole-Array sort boundary](docs/array-method-specification.md#7-sort-and-tosorted); toSorted densifies holes. Constructed Array roots follow section 5. |

Bounds come from captured facts, never the later live Array. Source and destination dependencies are separate: a failed copyWithin source contributes failure to dependent destinations, not to its original source positions. A failed deletion-count calculation affects splice layout, not independent prefix payload delivery.

Successful mutation identity follows logical writes, not value equality. Same-value assignment is a write; an empty fill range is not. Preserve presence-sensitive no-op rules for reverse, copyWithin, and sort, add the proved self-copy rule above, and retain specified length writes of endpoint mutators.

The current PASS_AS_PAYLOAD behavior already handles pending/rejected inserted values for push, unshift, fill, splice, with, and copying methods. Preserve it. Do not add another transport for payload Errors. Preparation must stop discarding all success payloads merely because an independent structural argument failed: retain exactly the payloads used by surviving output facts.

Apply the determined-outcome rules through the same method dependency descriptions, including at, searches, join, slice, flat, sort, and copying forms. The current eager argument conversion in array-invocation.js and comparator-before-elements ordering are implementation work to replace, not contracts to preserve. Empty/presence/range proofs can eliminate inputs before conversion; available structural arguments can prove another argument unused. Do not add a second no-op dispatcher alongside the normal algorithm.

For sort, establish comparator relevance and selection separately from callback-only preparation. Once a required supplied comparator is invalid or poisoned, do not switch to default sorting or await/export descendants used only by that callback. Any retained data keeps its original payload producers. Callback-only preparation failures remain conditional on that preparation being needed, regardless of which settles first. Source classification, presence, failure publication, and independent effects retain their own required work; fatal failures are never masked.

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

Distinguish unfinished work introduced or consumed by this mutation from unchanged predecessor data. A bounded fill whose destinations are proved in range can finish its writes while an untouched predecessor remainder stays pending; a streaming call can return that partial receiver. Complete-mode public handoff still obeys its captured structural gate, independently of completed effect work and released source protection. A splice whose count still selects the remainder cannot finish merely because its insertion is visible; an empty-source splice has no such count dependency. A remap that still needs predecessor shape to determine its affected writes retains that dependency. Ordinary payload versions do not become completion barriers simply because the method returns its receiver.

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

A successful deletion establishes absence and clears selected own status without consuming the old payload. Its identity decision depends on the captured predecessor's own-presence and own-status facts:

| Previous captured state | Identity outcome |
| --- | --- |
| Absent, with known clean own status | No-op; forward identity. |
| Present, or carrying own status even when absent | Effective deletion/status clearing; create the command's successor identity. |
| Presence or relevant own status pending | Publish clean absence independently; leave identity pending only while these facts can still distinguish no-op from an effective publication. A known effective deletion needs no further wait. |
| Failed | Replacing failed presence with definite absence is an effective publication; create the successor identity. Do not propagate the overwritten failure into the deletion. |

Use the existing mutation decision cell, retaining only the required presence/status dependencies. Pending facts follow the same rows as ready input. An unrelated failed length does not make deletion effective when clean absence is already known. Receiver/path prerequisites and a failure of the deletion itself still apply.

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

An exposed copy's root is not later replaced by a call Error or retroactive path flag. Its producer refines the captured layout under that mode. Sorting is an explicit whole-result exception to unordered position-only recovery: the request requires a sorted result, so required sorting success is a root-validity prerequisite in every mode. Do not expose that result's items or fixed suffix while a required comparator/key/preparation failure can still block the whole result. Other methods retain their declared positional fallback without a hidden Array-level diagnostic.

Actual whole-result validity still precedes handoff: valid with index, safe capacity, required target/category/authority, and unlimited-flat cycle validation. Invalid with returns result poison and preserves its source. Required consumed concat-part roots are classified before handoff; their established Array layouts and retained payloads can remain partial. Flat's required discovery/validity is separate from retained leaf payloads.

Root validity includes alternatives still permitted by an unresolved control. For the singleton cycle `const a=[]; a[0]=a`, finite-depth `a.flat(depth)` is legal, but Infinity fails cycle validation. With an unrestricted pending depth, a shallow regional skeleton cannot establish root validity. Wait for the still-required depth or a valid safety proof; if that depth fails while required validity remains unprovable, return its causal result-root poison. Apply the same rule when possible deeper expansion can overflow, including branching cycles at finite depth. A failed-depth regional fallback is available only after required root safety is proved; it must not bypass a validity dependency or force discovery of unrelated branches.

Mutating ! calls expose receiver progress through the selected Chain independently of their direct result. The direct result waits for its required call effects/controls and reports their failure; ordinary payload-only waits remain excluded. The [method specification](docs/array-method-specification.md#1-one-operation-separate-outcomes) defines these boundaries and the per-family rules.

### Transfer production before closing an invocation

A non-mutating call may finish with a prepared partial Array only after its remaining data producers have transferred to shared captured state. Before handoff, install known parent relationships, pending-publication obligations, and retained inputs. Its future layout must not depend on an operation-only continuation that stops when the invocation closes.

Shared settlement preserves values for all live captures and destinations. It does not extend the completed invocation or create a second public result. Full export and script return still consume the complete required graph; handing out a partial Array is not permission to finish a script that owes its complete contents.

## 6. Failure, queries, and supersession

### Local failure rules

The [mode/failure table](poison-policy-plan.md#2-failure-categories-and-fallback-layouts) owns the contract. Complete mode normally turns relevant Array structural failure into an ordinary root Error. Streaming modes preserve independent facts, positional survivors, and the declared fallback; neither automatically flags the whole Array. Required preparation/comparison failure in mutating sort explicitly retains repairable Array-path status in every mode; copying sorts return ordinary result-root poison. See [selected decisions](#13-selected-decisions).

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

Use only bounds derived from captured method facts. A raw failed start on length four has normalized domain [0,4], not an invented [1,2] annotation. A failed deletion count at known start 2 is clamped to [0,2]. A previously attempted application calculation does not leave a range annotation on its Error. Tighter internal bounds require an explicit derivation from retained method/layout facts; arbitrary range annotations are not part of the run API.

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

The cursor owns source-selection work started at factory issuance even before the first pull. Handle its exact pending outcome through ordinary guarded continuation ownership, transfer completed selection into the captured view, and release obsolete source bindings. A recoverable selection failure is retained for the first requested step, which rejects with that poison; it is not successful empty exhaustion. `return()` before any pull releases cursor-only work without waiting for selection, and resumed work cannot repopulate the closed cursor. Shared settlement and execution fatality keep their existing contracts; an idle cursor needs no execution registry or pending-result registration when no public result is pending.

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

After structural failure, close enumeration and release cursor-only unread uses synchronously before exposing the rejected step, then perform the loop handling below. Do not rely on the consumer calling `return()` after a rejected `next()`. Preserve only the causal failure and genuinely required independent work. A failed boundary is not successful empty exhaustion. Keep didIterate on the loop, not on Error objects.

`return()` closes future enumeration and releases cursor-only unread uses without scanning the suffix or cancelling shared production. An already-issued pending next() retains its own required capture and finishes with its original result or failure. Return reports done after local cleanup; it does not wait for that request, body work, or payloads. The consumer must receive or discard an outstanding result through ordinary binding cleanup. A required never-settling dependency can keep that one issued request pending.

Give the pending step its own work owner before releasing cursor state. Do not strand its Promise by closing an owner used by its continuation. Repeated return and next after local termination return done without reopening the source; execution fatality retains the common pending-result rejection and entry rules. One-pull-at-a-time trusted consumption requires no request queue. The [lifecycle table](docs/array-iteration-technical-analysis.md#8-close-the-cursor-not-an-issued-step) and ready/deferred witnesses define the selected behavior.

#### Receive the item before returning the step

Construct the ordinary elem Chain inside next() from the final captured payload version. It is a non-thenable holder, so awaiting the step does not consume its root or expire raw-value protection. The consumer binds it directly and owns its ordinary scope cleanup; cursor closure never clears delivered bindings. Source mode controls enumeration, while the binding retains its compiler-selected mode.

The existing [ready handoff](docs/integration.md#ready-delivery) ends at the next receiving transition or queued fallback. A protocol record alone would not extend that protection. Receiving the item before returning the record avoids a new raw-value handoff mechanism, deep export/re-import, and eager creation of every binding. The [public-runtime probes](docs/array-iteration-technical-analysis.md#7-select-chain-valued-iterator-steps) validate the basic ownership route; production structural/fatal and lifetime integration remains required.

### Compiler ordering and loop failure

Before source selection or any body can suspend, reserve the loop's ordered entry for the compiler-declared observation and mutation paths using the Phase 8 entry protocol. Capture the source/read dependencies through the correct pre-entry or contained view; an iterator must not wait on its own entry's completion. Bodies issued after later parent commands still issue through the loop's reserved views. A Promise settling first never grants a body a new parent position.

The enclosing reservation orders the loop against outside commands; it does not by itself order the bodies. For ordered iteration, reserve each body's declared reads and mutations in numeric occurrence order before starting work that can suspend. Reuse the contained batch-entry/buffer protocol so a delayed body 0 cannot issue conflicting work after body 1 merely because body 1 is ready. Cascada already supplies control-flow lowering, including break through a mutable control Chain; this plan preserves that behavior rather than redesigning it. Attach the existing control and application Chains to the same branch event. Unordered delivery uses the indexed-branch extension below.

The [Phase 8 batch-entry and compiler cutover](docs/runtime-evolution-plan.md#2a-integrate-the-operation-chain-boundary-in-cascada) is still planned. Its overlapping multi-reference reservation, captured readonly views, and closure guarantees are prerequisites for shipping general compiled-loop integration in stage 1. An isolated cursor can be implemented earlier; it does not establish that integration or justify a silent single-path restriction.

The iterator's completion means no further bodies will be issued, not that all commands inside those bodies have been issued or completed. The higher runtime owns body/effect completion and preserves every reference through which more commands can still be issued. Reuse ordinary entry closure and nested reservations for those lifetimes.

Do not conflate loop-result completion with managed publication. Once an entry's own issuance closes, transfer its current partial placement/layout; already-issued child dependencies remain in that state and external effects retain their own reservations. A pending payload or unrelated body/native effect cannot hold a determined managed region behind an enclosing completion gate. Conversely, a still-open reference able to issue an arbitrary conflicting mutation cannot be released merely because the cursor finished. This preserves the existing separation in docs/enter.md rather than adding an early-close API.

On structural enumeration failure, preserve completed body effects and use Cascada's existing compiler-declared loop poison targets at the reserved position: poison the body effect chains; if no position was issued, also poison the else effect chains. After one or more positions, do not poison the unselected else chains. These are loop-control dependencies, distinct from kernel Array regions. Do not roll back bodies or infer targets by scanning the source. Ordinary item poison runs the body with poisoned data rather than failing enumeration. Run loop-else only on successful empty exhaustion; an explicit stop is not empty exhaustion.

The [push-only entry follow-up](array-layout-approaches.md#control-flow-failure-and-path-status) preserves issued appends and represents an unrepresented missing contribution with the declared marker. A known inserted occurrence with uncertain position needs no missing-output marker. An independent callback result or ordinary payload poison does not by itself poison entered targets.

### Indexed branches for unordered bodies

Extend Cascada's existing command-buffer branch insertion with a captured branch position that can be ready or pending. Create one logical body branch per delivered occurrence and reuse its position fact in every Chain/reference buffer used by that body. A body can receive its elem Chain and enqueue commands without awaiting the position; commands execute only when their ordering and control prerequisites are established. Index futures come from the captured input layout, never the live source after body mutations.

The final unordered iterator integration supplies that index fact alongside the established elem Chain to trusted branch insertion; its exact API shape remains implementation work. It must not await the element payload, reconstruct occurrence identity from equal values, or wrap/import the delivered Chain again.

Maintain these invariants in the existing buffer/entry machinery:

- **Possible access is known before execution.** All nodes in the loop's branch family share compiler-declared may-observe/may-mutate coverage, including nested branches/calls and branches not yet discovered. Use potential effects, not commands emitted so far. Assignment, deletion, repair, and compiler-directed poison publication count as mutations. A branch containing no commands yet is not proved read-only or finished.
- **A known index is not a closed prefix.** Before releasing a mutation at index j, establish that no undiscovered or still-open earlier branch can add a conflicting predecessor, and finish required earlier conflicts. The loop's producer reservation covers missing branches until layout/issuance facts close that part of the order. A later parent command remains behind the loop's relevant unfinished contribution. Maintain a compact frontier rather than scanning all branches on every settlement or allocating every missing index.
- **Only established adjacent observations overlap.** Commands wait for earlier iterations that may mutate their Chain. Observations may overlap only when they form a proved observation-only interval with no possible intervening mutation. A Chain proved unmodified by the whole loop permits concurrent observations after the loop's outside predecessors; a potentially mutating Chain may require more order information. Shared access summaries do not merge branch-local captured values or let a later mutation enter an earlier read. Native observations retain their full asynchronous reservation lifetime.
- **Branching is coordinated across all affected references.** Create corresponding control-flow branches together, with the same position/coverage, before any contained command can wait on another used reference. Reuse batch entry for overlapping paths and canonical external scopes, including conflicts through different Chain aliases. Do not independently append a branch at different relative positions in different buffers or acquire references one at a time after suspension. Shared scheduling facts do not widen readonly capability or mutation authority.
- **Issuance closure and effect completion stay distinct.** A branch stops admitting commands only when its callback and every relevant nested issuer are closed. Already-issued effects keep their required completion dependencies; independent payloads/results do not keep an otherwise spent ordering reservation alive. Release completed nodes and captures incrementally through existing history-safe worklists.
- **Reuse existing control-flow behavior.** Include compiler-generated control Chains in ordinary branch/access ordering. Their existing mutable/observable dependencies determine which code may proceed; no new break semantics or whole-body control barrier is introduced here. An index failure follows the captured layout's declared fallback/failure channel; it is not assigned an arbitrary free position. Required order/index dependencies must not depend on later body effects or the enclosing loop's own completion.
- **Pacing cannot withhold a required predecessor.** If a later delivered body waits for an earlier body that has not been pulled/activated, counting the later body against the last available concurrency slot can create a cycle. An index future alone does not issue the predecessor's commands. The [bounded-window phase](#bounded-window-iteration) supplies source admission independently of effect ordering; do not fix the cycle by silently draining the whole iterator or exceeding the advertised resource bound.

For example, a delivered branch with index 1 cannot execute `x!.push(item)` while branch 0 is still undiscovered or may issue another write to x. It can observe a separately captured y before its own index is ready if the complete loop coverage proves y read-only and its outside predecessors are complete. If the body can mutate y conditionally, currently seeing only reads is insufficient proof.

These are higher-runtime ordering requirements, not a second kernel scheduler or a new mutation interpreter. Runtime API names and buffer representation remain integration choices. Read-only progress, absence of self-waits, cross-buffer order, and bounded unfinished-branch work need compiler/runtime witnesses before shipping unordered loops.

### Bounded-window iteration

Add a separate phase for bounded unordered loops whose bodies can depend on earlier iterations. Reuse captured layout ranges to restrict admission to a logical window; command-buffer ordering still decides when admitted commands execute. This phase preserves Cascada's existing control-flow semantics.

The selected window counts unfinished positions, not numeric width. It covers the earliest B unfinished logical positions together with any completed positions between them. Keep a lower frontier f and an exclusive upper boundary r, so the current demand is [f,r). Completed positions inside that interval consume no capacity. Undiscovered and not-yet-admitted positions still reserve capacity; a known index is not evidence that a body has finished.

For a window not clipped by Array capacity or the source end, the invariant is:

```text
(r - f) - completedPositionsWithin(f, r) = B
```

After clipping, the left side is at most B. The rules implementing this invariant are:

1. **Initialize.** The consumer supplies a positive finite unfinished-position bound B. Start with f=0 and r=B, capped by Array capacity and consumed subject to captured source membership. B=1 reduces to ordered admission; an omitted bound retains the unbounded unordered contract.
2. **Admit.** For each distinct guaranteed surviving occurrence, query its possible final captured/fallback indexes through the existing layout. Admit it only when its payload source is final and its entire possible-index set is inside [f,r). A sound inclusive range [lo,hi] suffices when lo >= f and hi < r. Exact index readiness is unnecessary; overlap alone is insufficient. Already-delivered occurrences are excluded, including those that have completed but whose exact indexes are still pending.
3. **Credit completion once.** When Cascada reports an admitted iteration newly finished under its existing completion rules, extend r by one, subject to the source/capacity bound. Batch k new completions extend it by k. This applies whether the finished position is at the start or inside the window. Never credit the same completion again when its index resolves or it later joins the retired prefix. If its index is pending, the earlier admission proof already guarantees that this distinct finished occurrence lies below the current upper boundary, so extension need not await that index.
4. **Trim the completed prefix.** Advance f across the maximal prefix proved completed. Do not extend r merely because f advances. A newly finished first position normally moves both boundaries by one through rules 3 and 4. Crossing additional positions already credited earlier moves only f, shrinking numeric width by the number removed. A pending index can postpone trimming without postponing the already-earned completion credit, but do not await individual indexes when captured range/count facts already prove the prefix complete. Clear spent completion/occurrence facts as the prefix retires.
5. **Continue within the updated demand.** Deliver eligible, not-yet-delivered occurrences in any availability order, each once, with its existing index future and elem Chain. A pending payload consumes unfinished capacity without delaying delivery. A pending pull must consider eligible occurrences throughout the current window, rather than select an outside item and wait on it while an eligible predecessor is available. Start available work without waiting for the window to fill. Required layout/index waits remain legitimate; eligibility and index facts must not require draining this iterator or completing future bodies.

An equivalent accounting identity is r=B+C before clipping, where C is the number of distinct completed positions since this capture began. This explains the rule; it does not require a new completion-history log or a second stored counter. Extend r through the existing one-time completion transition and retain only the completion facts still needed for trimming and duplicate suppression.

For B=3:

| Event | Window | Completed positions still inside | Unfinished positions reserved |
| --- | --- | --- | --- |
| Start | [0,3) | None | 0,1,2 |
| Positions 1 and 2 finish | [0,5) | 1,2 | 0,3,4 |
| Position 0 finishes | [3,6) | None | 3,4,5 |
| Position 4 finishes | [3,7) | 4 | 3,5,6 |
| Position 3 finishes | [5,8) | None | 5,6,7 |

Thus finishing position 0 after positions 1 and 2 earns only one new position: the upper boundary goes from 5 to 6, not 8. The lower boundary advances over all three completed positions, reducing width from five to three. The upper boundary never moves backward, and no still-unfinished admitted occurrence is evicted. Initially an occurrence with index range [1,2] is eligible while [2,5] is not; after extension, eligibility uses the new r and the same full-containment rule.

The bound applies to unfinished positions, both admitted and still reserved for undiscovered predecessors. Distinct surviving occurrences occupy distinct final indexes, and each counted completion removes one of those positions from unfinished work. Consequently later bodies cannot occupy all B unfinished slots while also excluding an earlier unfinished position inside the window. Completed bodies can refill capacity even while an early body remains pending; required structural/ordering dependencies can still limit actual progress.

Positions excluded from body delivery or structurally obstructed use the selected mode's existing exhaustion/failure behavior. Release their scheduling reservation only when that behavior has finalized the position, preserving its failure/reporting obligations; do not invent successful body completions, count them as issued iterations, or suppress poison to obtain capacity. Ordinary holes remain real iteration occurrences yielding undefined.

An iterator bound alone is insufficient: the consumer must communicate completions and update demand. Keep iteration completion and branch scheduling in Cascada; the kernel accepts [f,r) and uses layout queries. Finalize the configuration/completion-update API with this phase rather than treating next(), payload settlement, or holder cleanup as implicit body acknowledgement. A compiler proof of independence may retain ordinary readiness-based bounded pacing, but observing a potentially mutated Chain prevents that proof. Reading the captured index is not itself a mutation; it may add an availability wait or affect dynamic access/control coverage, and its producer must remain independent of later pulls.

Use the existing joins, restrictions, relative-count bounds, and occurrence-use index to prune disjoint regions, retain unresolved boundary questions, and resume only affected candidates. Apply required correlated-count reductions before retaining a wait. Coalesce completed numeric runs and preserve unresolved occurrence facts without retaining finished body closures or payloads solely for scheduling. Do not scan the entire unread suffix or all completed positions on each update, duplicate the layout engine, or allocate one record per possible hole. Eligibility proofs include permitted failure fallback and whole-path validity, and supersession cannot invalidate an earlier admission.

B does not bound numeric window width, the retained source graph, produced output, unresolved index facts, or nested work within one body. These retain their own work/lifetime bounds. A long run of finished iterations behind a pending early one must release spent command/body state and compact its completion records rather than retain a per-iteration history unnecessarily.

Acceptance requires an independent small-layout oracle for containment, unfinished-capacity accounting and exactly-once delivery; bound-one and reverse-delivery deadlock witnesses; overlapping index ranges and boundary-crossing waits; interior completion followed by prefix trimming without a second credit; pending-index completion that extends r immediately; short/sparse Arrays and source-end clipping; fallback, local closure and early stop; index access without iterator draining; and long expanded-window/mixed-layout work measurements. An unresolved required layout fact may wait indefinitely; a predecessor ready within the window must never be withheld merely because later admitted bodies are waiting for it.

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

- Captured exact-length and in-range questions, with independent lower/upper bounds, unresolved source shape, and established failure fallbacks.
- Captured point presence/value access and bounded sparse placement enumeration.
- Captured range forwarding/remapping, point overrides, deletion, truncation, and whole-location detachment.
- Enumeration of current structural failures for queries and full consumers.
- Shared settlement into live versions, including versions retained by earlier captures after current storage is superseded.

### One layout boundary

Use the [queryable block layout](array-layout-approaches.md) through existing language-property access and ArrayView capture/resolveLength/resolveInRange facilities. Retained layouts use Variant B's flat leaves, relative-count tree, exclusive-node reuse, and shared-path copying. The layout document owns composition, settlement, endpoint rules, and prototype workloads; the cursor does not traverse tree nodes directly.

Ordinary Arrays and simple views remain compact under the same query contract. [Compact pushes](array-layout-approaches.md#compact-append-path) with pending payloads do not require tree storage. Verify long append tails after uncertainty and [return to compact storage](array-layout-approaches.md#returning-to-compact-storage) without changing captured slots or forcing repeated full copies.

Lookup precedence is the selected version's point override, its layout mapping, its captured backing view, then unmasked physical storage. An absent override masks older presence too. Never combine a historical layout with a later live override. Sparse enumeration and graph summaries use this same boundary rather than independently inspecting backing properties.

Extend the existing LengthState/captured-shape boundary with the required structural facts. Growth contributions alone cannot represent truncation, shifts, subtraction, or the shape of failure fallbacks. Preserve known total length when individual block counts remain pending. Do not add an iterator-only prefix model or a second shape authority.

For each adapted method, replace native-intrinsic execution on ArrayRemap as the semantic decision procedure with the common mapping/write evaluator. Ready, pending, and failed controls use that evaluator. Native assembly may materialize a determined result; JavaScript remains a successful-input oracle.

Install dependencies once and resume only affected work through existing guarded continuations and history-safe worklists. Never replay a command, comparator, conversion hook, or host action. The cursor retains its next undecided boundary and resumes from there; pending payloads in delivered elem Chains settle independently. Required publication, topology, completion, and release advance even without another read. Derived calculation and caching remain implementation choices, subject to the same semantics and work bounds.

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

Finite flat depth is a Number control, not a work allowance. Existing conversion accepts large finite integers, while `2**54 - 1 === 2**54`; even smaller large depths can overflow the call stack on a tiny cyclic graph. Preserve finite-depth semantics with Number-safe depth handling and compact processing of repeated captured cycles, bounded by relevant graph structure and output/capacity work. Do not unfold one recursive frame or retained remap per conceptual depth, silently cap the depth, or treat a large finite depth as Infinity. The singleton cycle has one retained output at every finite depth; branching expansion still needs capacity validation before allocation. Ordinary shallow graph walks remain recursive; this requirement addresses repeated cycle traversal, not a new general graph scheduler.

## 9. Repair integration

Use [exact-path status clearing](repair-simplification-plan.md). Sequential positional flags retain the known payload at its fallback position and are repairable. Permanent structural poison, markers, ordinary payload poison, and complete-mode root Errors are not hidden values waiting for repair.

Required preparation/comparison failure in mutating sort is an explicit all-mode own-status exception. Repair reveals the unchanged pre-sort data without retrying sorting; no sort data writes were published and no repair baseline is needed. Copying sorts expose no repairable failed copy. Later storage/publication failure retains its ordinary rules and committed effects.

Repair returns undefined after successful status publication and does not await the selected payload merely to decide that return. It preserves current writes and positions, does not discover intended order, and does not restart an old iterator. Ordinary replacement/removal can discard Error data.

Keep only captures needed for ownership, snapshots, native isolation, unfinished results, or retained current data. No rollback baseline is kept solely for repair. Basic positional status and its protection are prerequisites of structural prefix integration; the general policy/repair cutover also covers native and canonical external boundaries.

## 10. Implementation sequence

### Implementation and validation work

The method specification defines the selected bounded rules. Technical probes cover selected cases, but do not certify every boundary combination or the newly selected whole-sort failure/repair behavior. Observation calls retain transformed-copy results; ! calls retain JavaScript results. Production implementation has not started. The following integration and acceptance work remains:

| Work | Required result | Needed before |
| --- | --- | --- |
| Cascada prerequisite | Phase 8 batch-entry/compiler ordering, per-body reservations/control dependencies, and execution/Error integration; an isolated cursor is not general loop integration. | Compiled loops in stage 1. |
| Iterator transport | Integrate selected elem-Chain delivery, factory selection ownership, and independent issued-step lifetime; verify terminal-step cleanup, structural/fatal boundaries, repeated close, and release. | Initial iterator API. |
| Mode/failure evaluator | Implement the [selected method rules](docs/array-method-specification.md): correlated normalizers, bounded fallbacks, coupled copying, sort/flat, root validity, roles, and completion, including section 13's all-mode mutating-sort flag and copying-sort root Error. No new cross-read provenance API. | Shipping each partial method family. |
| Marker publication | One marker per relevant missing contribution, ordered placement, role preservation, capacity/bounds, query collection, and ordinary removal. | Failed open-output streaming. |
| Captured mode handoff | Preserve issued producer semantics, destination policy, existing flags, and ready/pending equivalence across Chains. | Mode API cutover. |
| Layout lifetime | Nested source restriction, pending-child publication, parent relationships, counters, canonical export, retirement/re-entry, and cycles. | Production layout integration. |
| Work bounds | Bound mixed deferred transforms, conditional collection, forwarding, and release on small graphs with long history. | Production layout integration. |
| Repair/queries | Current-data status, fallback-index repair, root/data Error distinction, captured isPoisoned/hasError/getErrors, native boundaries. | Their public cutover. |
| Entry protocol | Capability overlap, reserved contribution location, private reads, nested issuance closure, failure classification, and the future-output/capacity proof required for early exposure. | Open-entry extension. |
| Diagnostics | Bounded context-plus-cause records and grouping by logical Chain. | Scheduled before unordered delivery; no artificial iterator dependency. |
| Unordered integration | Implement indexed branches with shared declared access coverage, missing/unfinished predecessor frontiers, coordinated cross-buffer branching, existing control-flow integration, duplicate/hole multiplicity, index/fallback transport, exactly-once handoff and release. | Stage 6. |
| Bounded-window integration | Implement guaranteed range containment, one-time completion credits, independent prefix trimming, expanded-window discovery, duplicate suppression, release and work bounds; connect existing Cascada completion/pacing to the iterator demand API. | Stage 7; general bounded unordered loops with inter-iteration dependencies. |

The [technical findings](docs/array-layout-implementation-findings.md#6-specification-and-integration-acceptance) distinguish demonstrated cases from unproven integration. The [two-task analysis](docs/array-iteration-technical-analysis.md) selects holder delivery and the pending-step lifecycle; the [method specification](docs/array-method-specification.md) supplies family and integration rules with expanded executable evidence and the added acceptance cases here. Sorting witnesses must be updated for the selected exception. Balancing, leaf/cache policy, folding, and materialization thresholds remain measured choices. Bring back a concrete behavioral tradeoff if those investigations expose one.

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
6. **Unordered occurrence streaming and indexed branches.** Deliver guaranteed survivors with independent payload/index futures, accepting the declared fallback ordering. Integrate coordinated branch insertion, command ordering and optional metadata; repeat self-modification, failure, handoff, and lifetime checks. Support unbounded pacing and bounded cases proved independent; retain the existing ordered route for other bounded loops until stage 7.
7. **Bounded-window unordered iteration.** Implement the selected expandable window, then integrate its completion-credit/prefix-trimming protocol with Cascada's existing loop completion and pacing. Verify predecessor progress, uncertain-index containment, unfinished-work bounds and sparse/history release before enabling bounded unordered loops with inter-iteration dependencies. Existing break lowering is not part of this phase.

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
| [Dependency poison and recovery](AGENTS.md#errors) | Revise the prohibition on guessed positions to distinguish intended positions from specified deterministic fallback positions. Permit healthy unordered survivors and status-only repair of sequential survivors at fallback indexes; retain the ban on inventing missing values/effects. Make the mode-specific all-ready reference explicit. | Stage 2 positional fallback/flags; stage 3 repair; stage 6 unordered delivery. |
| [Argument readiness](docs/run.md#argument-readiness) | Replace unconditional search-value consumption with actual candidate demand: `[].includes(P)` is false and empty indexOf/lastIndexOf return -1 without consuming P. Preserve required comparison/short-circuit semantics for nonempty candidate sets. | Determined-shape reductions, before or with stage 2. |
| [Method specification probe](test/experiments/array-method-specification-probes.mjs): independent argument positions, shared internal facts, and artificial range domains | Exercise the probe's separate argument/internal-fact witnesses through the production evaluator. Arbitrary-range probes prove formulas only; supported failed-control acceptance must derive its ranges from normalization/layout facts. | Determined-shape reductions and stage 2 evaluator integration. |
| [Call failure scope](docs/run.md#errors) and [scope transitions](docs/error-handling.md#scope-transitions) | Replace blanket selected-scope poison for controlled Array failures with the declared mode/method footprint, independent result failure, and committed regional effects. Preserve opaque native scope failures and existing blockers. | Stage 2 regional effects; stage 3 policy/repair; stage 5 sort exception. |
| [Managed rollback and scope poison](docs/error-handling.md#managed-rollback-and-scope-poison), [structural effects](docs/error-handling.md#managed-structural-effects), and [Array representation](docs/run.md#array-mutation-and-representation) | Remove mandatory full-baseline retention and whole-Array gating/rollback for controlled regional work. Keep structural ownership for capacity/invalid-length failures, current-data own status, independent publication, and native isolation. Repair clears status without restoring a predecessor. | Stage 2 regional publication; stage 3 status-only repair. |
| [Observation mutator results](docs/run.md) and [run.test.js](test/run.test.js) | Retain transformed-copy results for all nine observational mutators. Keep ! results native-style; splice mutations return removed elements. Add mode-dependent partial copying-result publication without changing the observation return types. | Stage 2 mode-dependent copying results; existing return types remain. |
| [Array preparation](test/array-preparation.test.js): with(0,7) waits for pending exact length | Permit a partial result once index validity, capacity, and prior root/publication prerequisites are proved. Preserve genuinely required entry dependencies. | Stage 2 partial producers, under the constructed-result validity rules. |
| [Range recovery](test/array-range-recovery.test.js): fill/copyWithin restore the full baseline | Separate destination-local storage failure from ancestor publication failure. Preserve independent writes/local poison where publishable; do not reinterpret every publication failure as an element Error. | Stage 2 regional writes; stage 3 status-only repair. |
| [Array identity tests](test/array-range-identity.test.js), [safeguard registry](test/safeguards/registry.mjs), [mutation identity](docs/run.md#mutation-identity), and [Phase 3](docs/runtime-evolution-plan.md#phase-3-establish-write-based-identity-and-searches) | Implemented for determined ranges: normalized self-copy preserves identity; genuine same-value-write safeguards remain. | Partial-layout integration remains future work. |
| [Sort comparison and failure contracts](docs/run.md#sort-comparison) | Remove comparator-before-irrelevance validation; make required sorting success a whole-Array/result boundary in every mode. On preparation/comparison failure, mutating sort flags unchanged pre-sort data and copying sorts return root Error. Preserve ordinary later publication failures. Replace obsolete healthy unordered permutation-failure and early fixed-suffix witnesses. | Simple proofs before/with stage 2; sorting boundary in stage 5. |
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
| Operations | Every controlled name and mode, indexed assignment/deletion, length writes, replacement, narrow entry, and repair. All nine observational mutators return transformed copies; ! results retain JavaScript meaning, including splice removed elements. Distinguish sparse observational splice from dense toSpliced. Pending keys resolve to indexes, length, invalid values, or poison. Compose push/shift/unshift/pop while removed payloads never settle; reverse pending payloads; sort before/after captures, preserving undefined/hole partitions without exposing them ahead of required sorting validity. |
| Validation | with waits only for still-required index validity and returns root poison when invalid. Cover classification/capacity, constructed-result mode rules, flat cycle validation, and distinct direct results versus receiver fallback. |
| Failure locality | Test payload, selection, membership, storage, ancestor, and comparator failures under all modes. Complete root failure and streaming local/fallback outcomes are explicit; broader authority alone does not widen a regional footprint. |
| Failed ranges | Known start/failed end and failed start/known end fill preserve unaffected regions. Test tighter bounds only with a specified derivation, not an unsupported range annotation on a failed argument. Later push remains healthy outside the failed captured extent. Pending controls remain pending. Pure insertion retains surviving occurrence facts even when numeric reads fail. |
| Irrelevant argument failure | Apply the universal rule across every controlled method and argument position, including ignored extra arguments. Cover observations, no-ops, and real effects: empty fill/copyWithin, empty/out-of-range searches, empty at/slice/flat, zero/one-element join, comparison-free sort including repeated-source proofs, and deterministic splice. Repeat before/after composition and materialization, with invalid values and never-settling inputs; irrelevant inputs cause neither poison nor delay. |
| Search range independence | [1].indexOf(2,P) and lastIndexOf return -1; includes returns false. Repeat with never-settling controls, holes, partial shape, conditional comparison Errors, and directional matches. Candidate exclusions and mismatches mask only their own irrelevant dependencies; no arrival-order Error wins over a deterministic answer. |
| Required effect/result failure | Complete mode normally returns root Error on relevant structural failure; required preparation/comparison failure in mutating sort instead retains repairable Array-path status in every mode. Streaming capacity failure preserves its declared genuine path boundary. Repair clears flags, not marker/data Errors. Controlled self-copy ignores irrelevant end; independent direct-result failure does not fabricate Array history. |
| Conditional relevance | Failed argument first, shape/range proof later: compare empty/unused and nonempty/dependent outcomes under all delivery orders. No premature poison or discarded independent result; do not force irrelevant conversion/inspection/subscription. |
| Bounds and capacity | Omitted/undefined/extra arguments, relative/fractional indexes, NaN/infinities, empty ranges, sparse Arrays, maximum length, unresolved source length with usable bounds, and concrete fallback length after control failure. Check soundness and the required precision of the [capacity rules](#required-capacity-proofs): safe publication, required wait, definite overflow, and failed-prerequisite blocker. A failed capacity prerequisite must use its owning-path boundary even if some smaller local insertion would fit; capacity-proved regional failure keeps its fallback. Preserve correlated totals through composition and materialization. No combinatorial inference required. |
| End-relative coordinates | fromEnd offsets in source selection and edit targets; forward and backward signed counts; empty/clamped ranges; known suffixes behind pending prefixes or established failure fallbacks. Check pop, negative slice/with/fill/splice/copyWithin, and includes without requiring unrelated absolute coordinates. Numeric search results and iterator indexes still require their numeric facts. |
| Argument controls | Two argument positions remain independent for identical raw Promises, separate lookup wrappers, and identical ready Errors. Equal successful normalized numbers still reduce normally. Compare nonempty slice(x,x), splice(x,x,X), and copyWithin(x,x,end) across delivery forms; preserve shared internal split/deletion facts without inferring argument provenance. Every failed-control bound has a named normalization/layout derivation. |
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
| Sparse status | Failed-position insertion into holes preserves absence and length, with no guessed child edges. Repair exposes holes; deletion clears a flagged hole and is effective for identity. Copy/move/densification preserves the applicable status. Repeat ready/deferred failures, snapshots, and queries. |
| Iterator terminal ownership | Factory selection settles/fails before first pull; close without pulling; ready/deferred rejected steps with a never-settling unrelated suffix; no consumer `return()` after failure. No unhandled rejection, stale cursor publication, or retained unread region. |
| Body precedence | Delayed body 0 and ready body 1 perform conflicting reads/writes, followed by outside work. Only proved adjacent observation intervals overlap. Branch creation is coordinated across affected Chains; reuse existing Cascada control-flow tests without defining new break behavior. |
| Unordered occurrences | Repeated identical payloads, concat(a,a), reversed sparse spans, and holes from delete/truncate/extend retain distinct exactly-once occurrences. Test order-sensitive control/effects against final captured/fallback branch order, not discovery order. |
| Indexed command branches | Index 1 known while index 0 is undiscovered/open; pending indexes settle in reverse order; a body resumes after another body closes; shared read-only versus conditional-mutation coverage; mirrored branches across two Chains and overlapping external scopes; nested issuers and later parent work. Include break/return and index failure. Fill all bounded/sequential body slots with later occurrences while an earlier required body is not yet pulled: preserve progress and the selected resource bound without full iterator draining. Read-only work progresses when safe, mutation intervals remain correct, and prefix/closure work does not grow quadratically. |
| Bounded window | B=1 and B>1; eligible range fully contained versus merely intersecting; finished interior positions expand r; later prefix trimming shrinks width without crediting them again; missing earliest occurrence becomes ready; index remains pending after body completion; source-end clipping and captured fallback preserve accounting. At most B unfinished positions are admitted/reserved, no outside item blocks an eligible pull, and updates do not rescan the suffix or completed history. Expanded width, source capture, retained index facts and per-body nested work are accounted separately from the bound. |
| Flat root safety | Self-containing Arrays with finite, Infinity, pending, and failed depth; possible deeper capacity overflow; ready poison versus delayed rejection. Regional fallback never bypasses required root validity. |
| Finite flat progress | Singleton and branching cycles at ordinary finite depths, around 2**53, at 2**54, and at very large finite depths; sparse acyclic controls. Assert depth-safe results/validation and bounded work without performing a depth-sized traversal. Distinguish finite retained cycles from Infinity failure. |
| Sort preparation and failure | Failed required comparator with already-classified sortable roots and pending/poisoned descendants. Callback-only export/default-key work adds no wait or failure once unused. No sort item/fixed suffix escapes ahead of whole-result validity; unordered mode cannot suppress a required sort failure. In every mode, mutating failure flags unchanged pre-sort data and repair exposes it without rerunning sort; copying failure preserves source and returns root Error. Verify sparse/payload-producer preservation, effective flag identity, earlier captures, and ordinary post-ordering publication failure without rollback. Vary selection/export settlement order, comparison throws, source/key failure, and result forms. |

### Self-modifying iteration

Keep arbitrary source mutation supported. The iterator preserves its captured view; each elem Chain protects its received item. Do not rely on lookup speed, body pacing, or a ban on writes to unread indexes. Reuse entry protection where sufficient and retain unread version facts where it is not; a capture need not copy or resolve the whole Array.

At implementation completion, review the ordering and lifetime argument alongside these integrated cases:

- A body writes the current, earlier, or next unread index, including nested managed children and aliases. Run immediate mutations inside the same entered reference without an intervening await. Distinguish mutation of the elem binding from mutation through the live Array.
- A body appends, removes, inserts, reorders, fills, copies, truncates, or replaces the source. Iteration still enumerates its captured occurrences: appends do not extend that iteration, and later removal does not erase an unread captured occurrence.
- Combine ready and pending payloads, pending layout controls, earlier pending entries, rejection, and delayed body commands. Vary settlement order under sequential, bounded, and unbounded pacing; repeat with index futures when out-of-order delivery lands. Both the captured items and final live Array must match logical command order.
- Stop early or replace the source while items remain pending. Transferred items retain their own protection; unread captures release at their last use without stale publication, lost items, or retained abandoned regions.
- Capture through the entry's private prefix, including when the body mutates that same source. Check that iterator acquisition, queries, nested entries, and closure introduce no dependency on the loop's own future completion.

Use existing public-operation, model, conflict, consistency, and lifetime verifiers. Add an independent bounded enumeration oracle for the specified dependency rules: on small Arrays, enumerate legal normalized controls and source selectors, preserve [shared internal facts and repeated occurrences](#shared-inputs-and-occurrences) and [coordinate normalization](docs/array-method-specification.md#preserve-normalizers-not-independent-intervals), and check facts at every partial-settlement state. Keep method argument positions independent. Include failure membership, root validity, write decisions, capacity outcomes, and all-ready results. Exercise capacity near the real maximum with symbolic lengths and sparse spans, without allocating those elements. Ready poison and delayed rejection use the same relevance rules and fallback; pending controls retain their legal domains until settlement. Ordinary JavaScript is only a successful-layout oracle because its eager validation differs from these failure semantics. Test accessibility with never-settling unrelated dependencies and controlled delivery, not timing-sensitive sleeps. Do not implement enumeration in production or make the oracle demand proofs outside the agreed rules.

## 12. Required-effect failures

Do not add a frozen poisoned-size state, a capacity-only marker, or a retained command-error log. Structural failure publishes the specified fallback and status/Error placements. With a known source length and otherwise settled controls, failed-count splice has a concrete fallback length; unrelated unresolved source facts can still delay that length. Subsequent operations consume the fallback's shape and endpoint relationships. Failure does not itself freeze later size writes.

### Capacity: owning-path failure

Capacity overflow is an invalid request, not an unknown legal length; [oldLength,MAX] cannot encode it. Prove required capacity, including any marker/fallback contribution, before exposing facts a capacity failure could invalidate. No mode publishes an insertion whose existence still depends on capacity. Apply the [required capacity proofs](#required-capacity-proofs), then wait only for still-required controls. A definitely invalid request returns the operation's capacity Error. A failed required control that prevents deciding validity returns its causal poison after the ordinary dependency reductions.

For a mutating request with definite overflow or a failed still-required capacity prerequisite, complete mode must produce ordinary Array Error and streaming modes must retain current data under affected-Array own-path status. This boundary applies even if some smaller fallback or diagnostic insertion would fit; neither establishes the failed request's required validity. If capacity is proved safe for the operation and its fallback, a failed positional/deletion control must instead use its declared regional fallback. Broader authority does not poison unrelated parent fields. No poisoned-size value or capacity-only marker is introduced. Repair of a genuine flag exposes current data and preserves local poison; it cannot restore a complete-mode Error. Non-mutating producers must return result-root poison and leave sources unchanged when required capacity fails.

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
- On an accessible Array with a regional failure fallback, a later valid length reset supplies its own exact shape. An established fallback length is already concrete; genuinely unresolved predecessor shape keeps its ordinary dependencies. A reset cannot bypass an owning-path blocker.

Verify these capacity decisions as well as bound soundness. In particular, safe-capacity regional failure and a failed-capacity-prerequisite path blocker must not vary with settlement order, caching, or representation.

### Assigned length validity

An explicit length assignment validates a legal Array length before committing. A poisoned/invalid input fails that prerequisite; complete mode must expose Array Error, while streaming modes must retain current data under genuine own-path status. Do not choose a random legal size or create a frozen failed-size value. Pending resize may truncate to zero, so no mode can assume every old occurrence survives. Ordinary path blocking and exact repair apply to a retained flag.

### Controlled self-copy: semantic no-op

When copyWithin's normalized source and destination starts are provably identical, every possible copied position maps onto itself. Values, presence, length, and identity remain unchanged. The mutating call returns its receiver and prescribes no data writes. End is therefore irrelevant under the [universal argument rule](#universal-rule-irrelevant-arguments-never-introduce-poison), rather than a special exception for this method or parameter. Selection and authority still precede the call.

Avoid mutation isolation/copying once the no-op is known. If necessary preparation created a private representation before the decision, finish it as no-effect and preserve the original captured identity using the existing forwarding/assembly mechanisms. Observation mode retains its ordinary distinct-result contract and may share backing storage rather than copying elements.

This revises controlled self-copy's write rule, not equal-value writes: an explicit same-value assignment and two cancelling mutations retain their prescribed effects. This no-data-write proof needs no old-value comparison or failed-identity state. It does not justify preserving identity for a different-position copy that performs a write, even when its resulting values are equal.

No general rule erases a write whenever a source maps to the same position. reverse does not write its middle position; controlled self-copy has this explicit no-op rule; sort still prescribes writing a present singleton and therefore advances identity. Those per-method write rules remain independent of comparator relevance.

#### Self-copy migration

The determined-range `fill`/`copyWithin` cutover is implemented, including normalized self-copy, conditional control failures and ready/deferred equivalence. Production contracts and identity witnesses use the no-write rule; genuine-write safeguards remain. Other determined-shape reductions and partial-layout integration in the [migration inventory](#migration-inventory) remain future work.

## 13. Selected decisions

The user selected [indexed command-buffer branches](#indexed-branches-for-unordered-bodies) to preserve final captured/fallback order despite out-of-order delivery. The user also selected a whole-Array/path failure for required sorting failure, including unordered mode: explicitly requesting sort requires ordering. This supersedes healthy unordered sort fallback. Publishing a new own-path flag is itself effective for identity, so unchanged payloads no longer imply a no-effect failed mutating sort.

Bounded unordered admission has a selected [stage 7 design](#bounded-window-iteration): captured range containment, one extension per new completion, and independent trimming of the completed prefix. B bounds unfinished positions rather than numeric width. The API and implementation measurements belong to that phase; Cascada's existing break implementation is outside this work.

The following is the normative sort failure contract. Other planning documents link here for these outcomes:

1. **Preparation/comparison failure in mutating sort.** Finish required sorting before publishing its data writes. If required preparation or comparison fails, `a!.sort()` reports the failure and publishes a repairable own-path flag on the affected Array in every mode, including complete mode. Retain the captured pre-sort data, payload producers, holes, aliases, and existing structural roles; publish no fallback permutation. Repair exposes that unchanged data without retrying sorting. For `[undefined,B,A]`, repair exposes `[undefined,B,A]`. This is an explicit exception to complete mode's ordinary structural-root-Error rule. No sort data writes committed, so no rollback or repair-only predecessor is needed.

2. **Copy-producing sorting.** On the same required failure, `a.sort()` and `a.toSorted()` return ordinary result-root poison in every mode and preserve a. No repairable failed copy is exposed or retained. Required sorting success precedes result/item exposure, including a fixed undefined/hole suffix.

3. **Failure after ordering succeeds.** A subsequent storage/publication failure follows the ordinary publication-failure rules and their causal scope. Do not add sort-specific rollback or erase already committed writes. The pre-sort-data guarantee above applies to preparation/comparison failure before sort data publication, not to this later boundary.

Existing source blockers retain their ordinary propagation boundary. An unused comparator introduces no failure; required failures retain their original causes. No missing-output marker duplicates this whole-Array failure. Publishing a new own-path flag is an effective semantic publication even though no payload moved. Successful sort retains its ordinary prescribed writes and identity rules.

No user-level policy decisions remain open from this review. The plan is ready for staged implementation; API naming, window/completion plumbing, representation tuning, production integration, and the listed acceptance checks remain implementation work. Existing prototype evidence does not certify the new sort failure/repair behavior.
