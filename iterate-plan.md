# Ordered Array iteration and partial publication

Implementation design for the coordinated revision in [Phase 9](docs/runtime-evolution-plan.md#phase-9-implement-incremental-managed-access-and-iteration). The shared capture interface and conservative prefix rule are selected; representation and bounded-update work still need validation in section 8, and section 12 retains the failed-effect decisions. This is not yet a complete production implementation specification. Production code is unchanged; [data limitations](docs/data-limitations.md) remains authoritative until implementation and contract updates land together. Repair changes are specified separately in [repair-simplification-plan.md](repair-simplification-plan.md).

## 1. Scope and semantic changes

Implement ordered, shallow iteration over a captured managed Array, including ArrayViews and sparse Arrays. Issue a position as soon as it is known to exist in the captured sequence; its value can remain pending. Consumers may process independent values concurrently while Cascada preserves logical command order.

The enabling change is shared partial Array state. Controlled operations must make independently determined regions available to ordinary reads, searches, copies, writes, queries, and iteration. An iterator-specific bypass around a whole-Array gate is insufficient.

The immediate workload is a compiled loop over an Array whose positions become usable before all its data does: [pendingA,B], a remap of pending payloads, or a splice with a known insertion point and pending deletion count. The first two already benefit from captured placement versions; the third needs partial layout publication. Measure these separately. This revision does not assume that every pending structural operation exposes a useful prefix.

Production already has captured length bounds and in-range questions in array-length.js/array-view.js, primarily for uncertain indexed growth, plus property versions for pending values. It has no public managed iterate operation and no general partial-layout engine for pending structural method controls. Intrinsic-backed methods still prepare required arguments and exact length before invocation. Extending the existing boundary is the starting point, not an already completed capability.

This revision changes the following contracts:

| Current rule | Replacement in this revision |
| --- | --- |
| A controlled structural mutation gates and, on failure, poisons its whole Array or selected broader scope. | A selected controlled mutation publishes facts independently and confines failure to its semantic dependencies. Broader authority does not enlarge failure coverage. |
| A failed managed mutation retains the complete scope baseline for repair. | Controlled regional failures have no repair baseline. Opaque native managed mutations still isolate private work and can retain an eligible own-path blocker. |
| Result layout construction finishes before handoff; payloads may remain pending. | A valid prepared Array may also contain pending or failed layout facts. Required call validation still precedes result-root handoff. |
| Controlled argument preparation can fail before determining whether an argument affects the operation. | Determine actual dependencies first. A poisoned, invalid, or pending argument cannot fail or delay effects/results proved independent of it. |

Controlled commands are consequently not rollback transactions. A committed independent write survives another region's failure, and later commands can use healthy facts without repairing the whole Array first. A later fact that still needs failed shape fails; this does not abort every fact of the later command. Stronger proofs across several remaps are subject to the representation decision below, rather than requiring arbitrary symbolic reasoning. Regional repair is deliberately unavailable. Restoring an explicitly saved predecessor as a new assignment remains possible; automatic restoration could discard intervening effects.

Mutation scope still selects authority, ordering, and path-failure ownership. The revised regional footprint applies after successful selection of a controlled Array operation. Opaque native managed calls retain their existing selected-scope isolation and blocking-failure contract. Narrowing native failure to the receiver would be a separate architecture revision, not a consequence silently inferred here.

Successful valid-input mappings retain the existing controlled-method semantics, including holes, fixed external locations, ownership, and write-based identity. Use existing argument conversion only where that argument is needed. Skipping irrelevant conversion/validation and publishing independent effects after failure are deliberate semantic revisions; JavaScript's eager validation and abrupt completion are not their reference behavior. Ready failure and deferred failure use the same revised reference execution.

Native host iterators and their finalization remain Phase 8 work. Object enumeration, new Array method names, and a separate append-only stream API are outside this revision. Here, streaming means incremental delivery of the Array at the iterator's logical command position. Later commands are excluded; all logically earlier commands are included, even if some have not settled.

### Pending mutations versus unknown future commands

An entry reserves a producer's place in command order while its callback may still issue commands. Distinguish these cases:

| Producer state | Required consumer behavior |
| --- | --- |
| Relevant commands have been issued, but their arguments, payloads, or regional effects are pending | Compose their captured mappings and deliver every determined position/value. Do not wait for whole-command or whole-Array completion. reverse is included. |
| An entry has stopped issuing commands through its own reference, while already-issued child commands remain unfinished | Publish its captured partial successor through normal entry handoff. Child dependencies keep their own lifetimes; unrelated body/native completion is not a whole-Array barrier. |
| An entry may still issue an unrestricted mutation of this Array before the consumer's logical position | A current prefix is provisional. The remaining commands could clear, replace, or reorder it. Existing path-only access declarations cannot prove it final. Preserve protection until issuance closes or a sufficient remaining-effect guarantee exists. |

The desired optimization is proof of a final observable region, not an append-only requirement. Append-only production is one sufficient restriction; a sealed range or a guaranteed unaffected final suffix can also suffice. The current entry API declares paths and mutation authority, not the methods, ranges, shape bounds, or failure effects of commands still to be issued. Optimizing that last row needs an explicit producer/compiler guarantee covering those facts; do not infer it from commands observed so far. This limitation must not be imposed on the first two rows.

For a loop that issues every push with a pending payload, the consumer need not await those payloads. Once command issuance closes, it can traverse the resulting captured positions. When future iterations themselves are unknown and can issue more mutations, the missing fact is what those earlier commands may do, not whether existing values are ready.

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

Availability is monotonic within one captured version: a delivered fact cannot be retracted. A later command creates a successor version; it does not revise an earlier capture. Value readiness means the element root is available, not that its descendants have settled.

### Guaranteed prefix, independently of ready values

The iterator needs a sound prefix, not the largest prefix that an unlimited proof procedure could discover. For its captured Array version, it may issue position i only after establishing that the position exists and capturing its final-slot dependency, including every logically earlier write that might select, overwrite, or delete its contents. Later commands use successor versions and cannot change that capture.

A promise for the final contents of slot i is safe even when selecting those contents still needs work. A promise for an old element tentatively left at i is unsafe if an earlier unfinished remap might move it. Never substitute the latter for the former. Holes follow ordinary Array iteration semantics and yield undefined.

Let m be a sound lower bound on the captured final length. Subject to root/authority/publication prerequisites and installed final-slot dependencies, positions [0,m) can be issued immediately, even with pending payloads or mappings. A sound upper bound proves absence beyond it. Between the bounds, ask the ordinary in-range question and wait when the supported analysis cannot decide it. Conservative uncertainty is allowed; falsely certifying a position or publishing a provisional value is not. Bounds tighten within one version; a later mutation has a separate version with possibly smaller bounds.

Use operation-local shape rules: fill/copyWithin/reverse preserve length; a capacity-safe push/unshift adds its known argument count; pop/shift apply max(0,L-1); splice uses its normalized ranges and insertion count. When a supported rule cannot prove a stronger bound, retain a safe wider bound rather than adding a solver. Keep the existing per-method semantics behind one shared fact interface, not iterator-specific cases or a rule for every pair of methods.

Prefix issuance and payload resolution are separate progress measures. Missing a sophisticated payload proof may leave an already-issued slot promise pending; it need not block issuance of that slot or other guaranteed positions. Conservative timing is not permission to invent poison: a pending/unknown analysis result is not an Error. Failure footprints remain specified separately and must not depend on settlement order or an optional optimization.

### Fact evaluation and failure dependencies

Each controlled operation defines its successor from captured operands. Facts independent of an unfinished operand can be published immediately. If that operand fails, dependent facts expose its contextual Error while independent facts retain their own values and producers.

Do not classify failure by what happened to be ready when it arrived, by whether someone already observed a region, or by which physical representation was selected. Ready poison, a synchronously delivered rejection, and a later rejection must produce equivalent facts and effects.

Use one evaluation rule for ready, pending, invalid, and poisoned controls:

1. Describe a needed control by its normalized semantic range and constraints. For splice, 0 <= d <= L-s. A pending control leaves alternatives unresolved. Failure retains those alternatives with its causal Error; it does not choose a value. Constraints can still narrow when other captured inputs settle, regardless of whether failure arrived first.
2. Evaluate each output fact from the method's mapping, using range arithmetic, conditional selection, and exact captured source selectors. A selector names a source placement/version, an argument payload slot, a hole, or a prescribed literal. When a supported rule establishes that every remaining alternative selects the same fact, forward it without the control dependency. Failure to establish that proof remains uncertainty, not permission to guess. Distinct payloads that happen to compare equal are not the same selector.
3. Preserve constraints used by the selected operation's rules, such as d <= L-s. A conservative approximation may admit extra possibilities and therefore prove less; it must never exclude a real possibility or certify an unsafe outcome. Do not require a general symbolic constraint solver or enumerate possible controls. Richer cross-operation relations are a representation option in section 8.
4. If alternatives still differ, retain their required pending dependencies. Once their failure membership is determined, expose the union of Errors on which that fact still depends. Do not publish a final Error while another unresolved structural proof could eliminate it or change the required collection. A complete Error outcome may precede unrelated successful data; hasError needs only a certain relevant failure.
5. Evaluate prescribed writes and operation completion separately from resulting values. A source mapping can be fixed while the write decision is not. For example, copyWithin(0,0,P) retains the same source selectors, but P can determine whether any writes occur. It is not a proved no-op. A failed required write decision cannot be reported as successful merely because values are unchanged; its receiver footprint is part of the open failed-effect decision in section 12.

The successful semantic range describes uncertainty, not validation success. An impossible request remains an independent validation failure; an empty set of valid indexes does not make with on an empty Array vacuously valid. Authority and physical storage failure are also not hypothetical successful argument values.

Return a determined result immediately, even when some arguments are pending, invalid, or poisoned. An eager preparation order or an incomplete list of examples is not evidence that an input is required. The evaluator uses structural range/shape simplification, identical selectors, ordinary available comparisons, and absorbing Boolean results such as false AND unknown. Apply proofs equally to ready and deferred failures and keep the reference model aligned. Do not speculate about sorted prefixes or search combinations of hypothetical comparison outcomes. These limits on proof work do not justify withholding an answer already established by ordinary comparisons or mapping composition.

An input is required only while a prescribed effect or returned fact depends on it. A method's argument table identifies potential inputs, not unconditional conversion or Error-collection obligations. Preserve complete collection for the actual dependency set; exclude inputs proved irrelevant. A conversion failure cannot make its own otherwise-unused argument required.

### Determined outcomes despite poisoned arguments

Prove the effects and result separately. If neither depends on an argument, do not await, convert, validate, collect, or publish its poison. This applies to ordinary observations as well as mutations. Pending and invalid successful inputs receive the same dependency treatment as ready poison. A proof that is already complete must not wait for an irrelevant input that may never settle.

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
| a.slice(P,0) | Return a fresh empty Array; every normalized start is at least the normalized end 0. |
| a!.splice(P,0), with no inserted arguments and known length | Removed result is []; contents are unchanged. Perform the method's prescribed same-length write without consuming start. toSpliced(P,0) returns the ordinary dense copy. |
| Empty a: a!.splice(P,P,"X") | Start and deletion count normalize to 0. Publish ["X"] and return []; neither control argument is needed. This is a determined effect, not a no-op. |
| sort/toSorted with fewer than two non-undefined sortable occurrences | Comparator selection, validation, export, and invocation are unnecessary. Preserve the normal known permutation, holes/dense semantics, and prescribed writes. Example: [7,undefined] has no comparator dependency. |
| flat over known present non-Array leaf roots only | Depth cannot change the output. [1,,2].flat(P) produces [1,2]. Do not infer this proof while a root could still become a nested Array. |
| A search range proved empty | includes returns false; indexOf/lastIndexOf return -1 without consuming the search argument. An all-hole Array also gives indexOf/lastIndexOf -1; includes still compares holes as undefined unless its range is empty. |
| [1].indexOf(2,P), [1].lastIndexOf(2,P), [1].includes(2,P) | Return -1, -1, false immediately. The only possible candidate is a known mismatch, whether the range includes it or not. |

These proofs use shape, bounds, argument count, and the algorithm's actual comparisons/mapping. They do not compare alternative payloads to guess equivalence. Equal before/after values do not prove a no-op: same-value writes still affect identity. Existing zero-argument endpoint-mutator length writes remain prescribed effects. A deterministic result does not erase an independent required effect or its failure.

Some arguments remain necessary. A nonempty [A,B].with(P,"X") cannot select or validate its replacement index; a.includes(P) with candidate occurrences cannot decide whether they match; a.concat(P) cannot classify the appended part. Stored poison is data: a valid with(0,P) produces an Array containing P, and an inserted splice/push payload poisons its actual placement rather than disappearing as an unused control.

Receiver selection, supported dispatch, authority, and fatal failure are prerequisites, not optional arguments. Do not inspect a poisoned path's hidden value to prove emptiness. Opaque native calls do not inherit these controlled-operation proofs. Intrinsic invalidity also remains failure: an empty Array has no valid with index, and capacity overflow prevents a requested write. Neither is a proved successful no-op. Report that independent validation failure without consuming irrelevant argument poison.

This removes eager-validation ordering where it manufactured dependencies. In particular, comparator readiness no longer precedes the proof that no comparisons are needed. Do not add a separate poison-only fast path: valid, pending, invalid, and poisoned inputs use the same demand-driven preparation.

### Example: partial splice

For a captured length-four Array:

```text
[A, B, C, D].splice(2, pendingCount, "X")
```

Normalized deletion count is in [0, 2]. Once insertion publication is safe, indexes 0 and 1 retain A and B and index 2 contains X. Their payloads need not be ready. The remainder, exact length, and removed-elements result depend on the count.

If count processing fails, those three positions survive. Length is bounded by 3 and 5; indexes 0..2 are in range, indexes 5 and above are out of range, and in-range questions at 3/4 fail. Lookup at 5 returns undefined; exact length and lookup at 3 return the count Error. No shortened complete Array or arbitrary poison-filled suffix is invented.

This same partial state is produced when the count is already poison at issuance. Inserting X is an independent committed effect in the revised semantics. It cannot be undone by repair.

Capacity is a separate prerequisite. Near maximum Array length, an unresolved count can prevent proving insertion safe. Failure cannot leave an illegal logical length. A definitely invalid capacity request fails the call; do not introduce a frozen poisoned-size state just for this extreme case. Section 12 records the remaining failure-publication choice. If that choice permits an owning-path blocker, its capacity preflight must precede exposure of any successor fact the blocker would hide. Ordinary bounded-size operations discharge this preflight without waiting for exact length.

### Stronger composition: possible benefit, not a baseline requirement

With a selected Array and established mutation authority:

```text
a = ["A", "B"]
a!.splice(0, pendingCount)
a!.push("Z")
a!.reverse()
iterate a
```

Let d be the normalized count, 0 <= d <= 2. Ordinary bounds give length [0,2] after splice, [1,3] after push, and [1,3] after reverse. Thus the baseline can issue index 0 with a promise for its final value without knowing d. It does not need to prove that value is Z merely to stream the position.

A stronger representation could also deliver Z ready: the append position is 2-d and reverse selects (3-d)-1. This can be a natural consequence of representing concatenated segments and reversing their traversal, rather than an algebraic simplifier or a special push-then-reverse rule. Whether that representation stays simple for splice, range overwrites, overlapping copyWithin, snapshots, and sparse topology still needs a prototype. Do not make this ready-value optimization mandatory before that assessment.

If retained segment structure proves Z independent even when count fails, its failure behavior must preserve that fact consistently. A conservative pending answer and an extra poisoned value are not interchangeable. Settle the supported cross-operation failure rules with the representation; do not let an optional optimization silently choose Error presence. This example is a comparison workload for that decision, not a new guarantee of failed-layout recovery.

A simpler required case is a known-length [pendingA,"B"] followed by reverse: its ordinary mapping proves index 0 is B immediately. An unresolved earlier operation that may remove or replace B prevents that proof. Always use the captured command prefix, not the old physical Array or the last method name alone.

## 3. Controlled operation rules

### Method catalogue and mappings

All 22 current names in ARRAY_METHODS participate. The nine mutation-capable names are copyWithin, fill, pop, push, reverse, shift, sort, splice, and unshift. Their observation forms construct a distinct transformed Array, including on a no-op, without mutating or poisoning the source. Their mutation forms return the native-style result specified below. Result-root prerequisites for copying/observation forms are in section 5.

Let L be captured source length, A(i) its captured placement, k the number of inserted arguments, and j an output index. Normalize bounds with the existing argument converters when their values are needed; preserve omission versus explicit undefined, clamping, negative indexes, NaN, infinities, and ignored arguments. The zero-argument, omitted-delete-count, and explicit-undefined splice/toSpliced forms retain their distinct normalization rules.

| Operation | Output facts and dependencies |
| --- | --- |
| at | Read one captured position; a negative index uses the shape needed to establish or exclude it. A known out-of-range position yields undefined without consuming a payload. |
| includes | Preserve existing any-match completion. A sufficient match in a definitely selected position can win without waiting for other comparisons or exact length. Holes compare as undefined. Do not add a universal Error precheck. |
| indexOf, lastIndexOf | Preserve directional first-match completion and hole skipping. A known mismatch excludes a candidate without awaiting uncertain range membership; a match cannot bypass an unresolved earlier possible match in that direction. |
| join, toString | Produce one String using existing logical conversion and complete required Error collection. join consumes the separator only between positions. Explicit and implicit Array conversion consume the same required facts. |
| push | Length L+k; retain A(j) below L and place argument j-L afterward. Numeric appended positions need the append offset; relative tail selectors do not. Capacity must be proved. Mutation returns the new length independently of payload readiness. |
| unshift | Length L+k; place k arguments first and map later j to A(j-k). The prefix need not wait for old payloads; changed facts require capacity proof. Mutation returns the new length. |
| pop | Length max(L-1,0); retain A(j) at surviving indexes. Mutation returns the old last value or undefined. Its payload does not gate surviving receiver facts. |
| shift | Length max(L-1,0); map j to A(j+1). A proven in-range output position needs no exact length. Mutation returns the old first value or undefined for an empty source. |
| reverse, toReversed | Preserve length bounds; map j to A(L-1-j). Known L determines the source index without waiting for its payload. Unknown L may leave the final-slot value pending even when the destination position is guaranteed. Optional structured mappings may prove more without exact L. toReversed makes holes present undefined. Mutating reverse returns the receiver. |
| fill | Length L; in [s,e) install the payload; elsewhere retain A(j). Overwritten values are not inputs. Uncertain bounds affect undecidable destination and write predicates only. Mutation returns the receiver. |
| copyWithin | Length L; c=max(0,min(e-s,L-t)). In [t,t+c), map j to pre-write A(s+j-t); elsewhere retain A(j). A copied hole deletes the destination. Capture overlapping sources before writes. Mutation returns the receiver. |
| splice, toSpliced | Length L-d+k; below s retain A(j), in [s,s+k) insert arguments, afterward map j to A(j-k+d). Mutating splice returns a sparse removed Array mapping j to A(s+j), length d. toSpliced has dense output and no removed result. |
| slice | Length max(e-s,0); map j to A(s+j), preserving holes. A bounded positive range can be selected without exact source length when in-range facts prove its bounds. |
| with | Validate the index; preserve length L, replace the selected position, and copy other values densely. A negative index's mapping can depend on L even when its validity is proved. The overwritten source value is unused. |
| concat | Place classified parts in order, with offsets from captured part lengths; a non-Array part contributes one position. Preserve holes in Array parts. |
| flat | Traverse present occurrences to the required depth; flatten only logical Arrays and omit holes at traversed levels. Retain deeper values without inspecting them. Offsets depend on preceding expansion lengths. |
| sort, toSorted | Preserve length and existing stable sorting/comparator contracts. Required values/comparisons determine the sortable region. Once classification and counts establish their positions, trailing explicit undefined values and holes survive comparison failure; toSorted densifies holes. Mutating sort returns the receiver. Copying forms require sorting success before root handoff. |

Bounds come from captured facts, never the later live Array. Source and destination dependencies are separate: a failed copyWithin source contributes failure to dependent destinations, not to its original source positions. A failed deletion-count calculation affects splice layout, not independent prefix payload delivery.

Successful mutation identity follows logical writes, not value equality. Same-value assignment is a write; an empty fill range is not. Preserve current presence-sensitive no-op rules for reverse, copyWithin, and sort, and specified length writes of endpoint mutators.

The current PASS_AS_PAYLOAD behavior already handles pending/rejected inserted values for push, unshift, fill, splice, with, and copying methods. Preserve it. Do not add another transport for payload Errors. Preparation must stop discarding all success payloads merely because an independent structural argument failed: retain exactly the payloads used by surviving output facts.

Apply the determined-outcome rules through the same method dependency descriptions, including at, searches, join, slice, flat, sort, and copying forms. The current eager argument conversion in array-invocation.js and comparator-before-elements ordering are implementation work to replace, not contracts to preserve. Empty/presence/range proofs can eliminate inputs before conversion; available structural arguments can prove another argument unused. Do not add a second no-op dispatcher alongside the normal algorithm.

Invalid dispatch, unsupported names/modes, selection failure, and authority rejection keep their existing classification and owning-path failure rules. They are not fictitious regional Array operations. A supported selected operation's argument, mapping, comparison, and publication failures follow this specification. No custom Array property, accessor, prototype method, Symbol protocol, or host iterator participates.

### Search demand and completion

For each possible candidate i, separate eligibility E(i) from comparison M(i). Eligibility includes range membership and, for indexOf/lastIndexOf, own presence. A hit requires E(i) AND M(i). Either known false operand makes that candidate a non-hit without awaiting or propagating poison from the other. Thus a known mismatch removes dependence on a pending/failed start, just as a known excluded position removes dependence on its value. Comparison uses ordinary captured language values and identity rules; do not inspect a hidden predecessor to invent a positional value.

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

### Command identity

Reserve one source-free successor decision per semantic command and affected logical node, using the existing captured identity mechanism. The first irreversible write or new poison fact proves effectiveness; identity need not wait for unrelated regions. A genuine no-op forwards to its predecessor. Installing an ordering dependency or changing representation is not a semantic write.

The write/effect decision is itself captured state. Do not forward identity merely because every output selector matches its predecessor while a prescribed write remains unresolved. Nor does argument failure alone prove a write: effective failure identity comes from the specified failure publication. The unresolved zero-slot/failed-write footprint in section 12 must be settled before implementing these identity cases.

Identity finality, publication completion, and operation closure are different. Refactor the current IdentityPublication completion coupling where needed; do not close its operation owner to settle identity. Later regional completion must neither allocate another successor nor reset a generation installed by a later command. Containing nodes still reflect descendant logical writes through ordinary path publication.

## 5. Result boundaries and partial producers

### Validate a result before handing out its root

```text
[A, B].with(99, "X")            -> PoisonError; source unchanged
[A, B].with(pendingIndex, "X")  -> Promise<Array | PoisonError>
```

Validation poison fulfills the ordinary kernel Promise; it is not a rejecting expression value or a partially successful Array. A valid result root is never later retracted. Fatal failure retains the normal fatal rejection contract.

Separate two boundaries: an existing mutation receiver can publish regional successor facts; a newly constructed result root waits for its own required validation and algorithm steps. "Required" means still relevant after section 2's dependency reductions, not every input inspected while finding those dependencies. An empty slice or a comparison-free toSorted can return immediately despite unused poisoned or never-settling arguments. An actually dependent with index retains the Promise/poison contract above.

| Dependency | Result-root behavior |
| --- | --- |
| New call's required argument conversion, index validity, capacity, sorting/comparator success, or other root-invalidating validation | Finish before Array handoff. On failure return ordinary result poison. |
| Captured source placements, inherited partial layout, or retained payload data transported without consuming it as validation | A valid Array root may contain their pending/failed facts. |
| Source data consumed for scalar conversion, comparison, classification, or another required algorithm step | The consuming step is a call-owned prerequisite even though the data came from the receiver. This includes default sort conversion. Do not relabel its failure as transported data to return earlier. |

Thus toSpliced waits for a pending count when the count selects its result, but not when an empty source or another established range proof makes deletion count irrelevant. Mutating splice can expose an independent receiver prefix while its direct result still waits for a dependent count. These use one mapping implementation with different root/publication obligations.

Capacity can be proved from upper bounds without exact lengths. For concat, every consumed part root must first be classified successfully; an arbitrary pending part can reject or add too many elements, so a preceding ready part alone does not justify returning an Array. After classification and a safe sum-of-upper-bounds proof, unresolved offsets can be captured layout dependencies. If that proof is unavailable, the call waits.

For flat, unknown nested roots can change category, expansion, or capacity; unlimited depth additionally requires cycle validation. These are genuine barriers. Do not promise streaming flattening across them. Even finite depth can require all structural discovery before a finite capacity bound is established. Leaf data outside the consumed depth can remain pending. toSorted likewise waits for every comparison or required preparation that can still fail its root result.

### Transfer production before closing an invocation

A non-mutating call may finish with a prepared partial Array only after its remaining data producers have transferred to shared captured state. Before handoff, install known parent relationships, pending-publication obligations, and retained inputs. Its future layout must not depend on an operation-only continuation that stops when the invocation closes.

Shared settlement preserves values for all live captures and destinations. It does not extend the completed invocation or create a second public result. Full export and script return still consume the complete required graph; handing out a partial Array is not permission to finish a script that owes its complete contents.

## 6. Failure, queries, and supersession

### Local failure rules

- Stored payload rejection stays at its destination placement with its original source. It does not retroactively fail a successful retaining call.
- A failed mapping, presence predicate, or length calculation poisons only facts depending on it. Known length can survive failed element mapping, and known bounds can survive failed exact length.
- A target storage failure belongs to the affected destination fact; a source capture failure belongs to all outputs consuming that capture. Required call Errors still return from the command.
- Root/ancestor publication failure before safe exposure can prevent reaching the Array altogether. Preserve that causal boundary; do not claim a usable region that was never publishable.
- An irrelevant failed argument adds no poison to either data or the call result. Return the result and complete the effects that are independently determined.
- A failed required effect still fails the call. Do not allocate an illegal out-of-range index to hold its Error. Capacity failure's receiver footprint remains the explicit section 12 decision, rather than an implicit special marker.
- Compute failure coverage from the command's captured successor, not the currently live destination at failure time. If a later command discarded all affected facts, late settlement must not invent a new Array failure merely because no destination remains.

Do not maintain an Array-wide log of discarded call failures or duplicate regional Errors in a permanent marker. A proved no-write operation with a determined result succeeds even when unused arguments are poison. Queries, iteration, and export inspect the current prescribed facts. The receiver visibility of an actually failed required effect with no natural poisoned element is a separate unresolved contract in section 12; it must not be dismissed as a no-op or silently implemented as an Error log.

Failed shape is useful when an ordinary structural dependency remains unknown, not as a permanent lock on Array size:

| Failure | Consequence |
| --- | --- |
| push receives a rejected payload | Argument count still determines growth. The new slot is poison; length and the next push offset remain known. This is not failed growth. |
| splice receives a failed deletion count | Exact length and dependent positions fail; the specified fixed prefix survives. Failure behavior for stronger cross-operation selector proofs must be settled with the representation, not inferred from an optional timing optimization. |
| Assignment receives a poisoned new length | Possible intended lengths include 0, so no old element belongs to a guaranteed retained prefix. Do not publish the old contents as if resizing had succeeded. |

A later explicit length write or replacement establishes a new version using the supersession rules below. The old captured length remains failed for its old consumers; the current Array is not assigned an immutable poisoned size. Partial splice followed by truncation to its known healthy prefix can therefore produce a completely healthy Array without repair or reconstruction.

### Common consumer behavior

| Consumer | Required dependency set |
| --- | --- |
| Numeric/nested lookup, expression extraction, positive at | Selected in-range/presence/value facts only. No whole-Array Error precheck. |
| Bounded slice, fill, copyWithin, narrow mutation/entry | Selected range and required normalization/authority. Unrelated partial regions remain represented without full materialization. |
| Searches | Section 3's eligibility/comparison reductions and existing any-match/directional result selection. Unknown range membership is not itself a mismatch; an independently known mismatch makes that membership irrelevant. |
| hasError | May return true on any known relevant Error without waiting for unrelated data. |
| getErrors | Collect the complete captured current frontier: known placements and structural failures. Await required pending facts and deduplicate by existing rules. |
| Full export, native arguments, native receiver preparation | Capture the complete required graph, including structural failure. Never export a healthy prefix as the complete Array. |
| Mutable-external snapshot | Preserve its synchronous ready-only contract. An unfinished nested structure cannot be skipped, treated as holes, or awaited into validity. |

Error collection does not traverse private predecessor alternatives hidden by a failed mapping, old repair baselines, or obsolete command history. For the failed-count splice, C/D are not speculative members of the failed remainder; surviving A/B/X and the structural Error are the current frontier. If A is pending, complete getErrors still follows A, while hasError can finish from the known count Error.

This query boundary does not prescribe erasing or retaining speculative alternatives as an optimization. Retention follows the selected layout representation and its specified consumers, with stronger selector preservation still under evaluation in section 8. Later operations must not treat a plain stored PoisonError as recoverable hidden data. Keep only captures needed by the live mapping or other ordinary uses.

A cause attached to a potentially empty region is not automatically a known current Error. Its membership follows the same captured range/presence dependencies as its data. If another pending fact can prove the region empty, hasError cannot report that regional cause as certainly present yet. Complete queries resolve the required membership; a region proved empty contributes no Error. Keep summaries conditional rather than turning producer failures into an Error log.

An Error at a known in-range position is an item outcome, not an enumeration boundary. Failed fill bounds on an Array of known length four can leave four enumerable positions, some with Error-valued reads. Only failure to determine whether the next numeric position exists prevents further ordered issuance.

Knowing a source payload does not make it usable at an unknown destination. Preserve the Error or pending dependency on the positional read; never emit the source value with a guessed index or silently compact failed positions. Conversely, root capture and identity comparison do not consume a managed Array's entire data graph.

### Explicit replacement

| Later command | Effect on captured partial state |
| --- | --- |
| Assign index i | Replace its value/presence dependency without consuming the old value; length becomes max(old length,i+1). Bounds can prove it exactly even when old exact length failed. |
| Delete index i | Establish absence without shrinking length; discard only that placement's dependence. |
| Assign valid length n | Set exact length n and discard indexes at or above n. Preserve existing/uncertain contents below n; newly exposed definitely absent positions are holes. |
| Replace/delete the Array location | Detach its current publication destination and local failure state. Preserve prior captures and the earlier command's still-required result work. |

Truncating the failed splice to length 3 leaves [A,B,X]. Extending it to length 5 establishes length, but cannot reconstruct indexes 3/4. If old length is at most 5, assigning index 4 establishes length 5 without resolving other failed cells.

A regional Error disappears from current data when no surviving fact depends on it. Do not retain a second Array-wide copy of every regional Error; that would prevent valid replacement/truncation from clearing its actual dependencies. Dropping one destination cannot clear the same Error still required elsewhere.

Representation copies preserve all facts. A semantic projection constructs a new value from its declared inputs; it does not repair its source. A bounded slice of known healthy positions can produce a healthy Array despite failed source data outside that range. Assigning the same poisoned Array to a new location is a handoff, not reconstruction of a healthy Array.

## 7. Ordered iterator API

```js
iterate(chain, path, operationContext, onIteration, facts)
```

The trusted compiler record facts contains firstDynamicSegment (default path.length), needsLength (default false), and needsLast (default false). Follow existing public operation/context and dynamic-path conventions. No host callback protocol, scheduling mode, or separate async-generator implementation is introduced.

The source is captured at the iterate command's logical position. Earlier effects are included; later mutation, replacement, and appends are excluded. A lease protects unread source data against later writes; it never settles values or blocks mutation. Captured versions and receiving bindings take over protection as consumption progresses.

For an expression-produced Array, receive the expression result into the ordinary temporary holder before other work can run, then select that holder through this API. Release the temporary holder once the iterator's captures own the needed state. Do not create a separate value-only iterator path. Higher-runtime category dispatch keeps existing object/native-iterator/template behavior; an Array-only kernel operation does not redefine those other source forms.

### Cursor algorithm

1. Resolve the source path/category under ordinary ordering. Propagate root poison; unsupported categories produce NotIterable without coercion.
2. Capture shape and a protected placement view. Set cursor i=0.
3. Ask captured inRange(i). If false, finish normally. If pending, wait for that fact. If Error, finish with that structural Error. A ready failed boundary cannot suppress an earlier guaranteed prefix.
4. If true, capture the selected value dependency and invoke onIteration(valueOrPromise, i, info). Presence or mapping may still be pending/failed; the emitted value dependency carries that outcome. A hole yields undefined.
5. Process callback control, increment i when continuing, and repeat. Do not reread a later live Array, rescan a delivered prefix, or allocate all positions before the first callback.

This can issue both positions in [pendingA,B] immediately. It can also issue all positions of a known-length Array with pending mappings. Unknown exact length alone does not block a proven prefix. Array value iteration visits holes; sparse storage traversal for copying/querying remains sparse.

In-range facts are downward closed: proving a later numeric position exists also proves every preceding position exists, including holes. An ordered cursor therefore loses no opportunity to issue a position beyond an unresolved existence boundary. This says nothing about payload readiness; a later issued payload may be usable before an earlier one.

### Callback and completion

Call onIteration(valueOrPromise, index, info) in increasing numeric index order. index is a ready Number; no internal placement, holder, or ownership record escapes.

| Callback outcome | Meaning |
| --- | --- |
| undefined | Continue issuance. |
| false | Stop successfully and release unread iterator state. |
| Ordinary PoisonError | Stop with that consumer failure. |
| Supported Promise of one of these | Pause further issuance until that control settles. |

The callback is trusted runtime integration, invoked using the existing outside-graph-transition facility. It must receive the item into an ordinary binding before callback-capable body work. An item Error is payload, not control, unless explicitly returned as control. Expected language failures use that value channel; escaping internal defects or unexpected callback rejection remain fatal. Do not translate arbitrary callback throws into IteratorFailed.

Managed item capture uses the ordinary captured-lookup failure boundary: supported slot-reflection failure is LookupReflectionFailed at the iteration context, delivered as that item's outcome without poisoning the source. Existing structural poison retains its causal kind/context and ends enumeration only when the next in-range fact fails. Internal shape/index maintenance failure remains fatal. IteratorFailed is reserved for the separate host iterator protocol; do not wrap managed lookup in a second generic iterator catch.

The direct return is undefined | PoisonError | Promise<undefined | PoisonError>. It reports enumeration and callback-control completion, not independent bodies or handed-off payload settlement. Unbounded consumers return immediately after establishing each body; sequential consumers return required body completion; bounded consumers return their existing pacing dependency. Cascada owns aggregation of issued bodies and effects needed by the enclosing loop/script result.

After a structural failure, stop issuing new bodies and finish the loop's required handling below. A failed boundary is not emptiness. Keep didIterate/progress on the loop, never on an Error. Do not convert healthy native Error data into poison during loop binding.

An explicit early stop does not inspect or collect unread elements. Requested metadata and values already handed off retain independent captures. Stopping releases only the iterator's unused source uses; it cancels neither shared settlement nor issued effects. This managed iterator has no native return() finalizer.

### Compiler ordering and loop failure

Before source selection or any body can suspend, reserve the loop's ordered entry for the compiler-declared observation and mutation paths using the Phase 8 entry protocol. Capture the source/read dependencies through the correct pre-entry or contained view; an iterator must not wait on its own entry's completion. Bodies issued after later parent commands still issue through the loop's reserved views. A Promise settling first never grants a body a new parent position.

The iterator's completion means no further bodies will be issued, not that all commands inside those bodies have been issued or completed. The higher runtime owns body/effect completion and preserves every reference through which more commands can still be issued. Reuse ordinary entry closure and nested reservations for those lifetimes.

Do not conflate loop-result completion with managed publication. Once an entry's own issuance closes, transfer its current partial placement/layout; already-issued child dependencies remain in that state and external effects retain their own reservations. A pending payload or unrelated body/native effect cannot hold a determined managed region behind an enclosing completion gate. Conversely, a still-open reference able to issue an arbitrary conflicting mutation cannot be released merely because the cursor finished. This preserves the existing separation in docs/enter.md rather than adding an early-close API.

On structural enumeration failure, preserve completed body effects and use Cascada's existing compiler-declared loop poison targets at the reserved position: poison the body effect chains; if no position was issued, also poison the else effect chains. After one or more positions, do not poison the unselected else chains. These are loop-control dependencies, distinct from kernel Array regions. Do not roll back bodies or infer targets by scanning the source. Ordinary item poison runs the body with poisoned data rather than failing enumeration. Run loop-else only on successful empty exhaustion; an explicit stop is not empty exhaustion.

### Metadata and value-ready batching

Only requested info fields are supplied:

- length: Number | PoisonError | Promise<Number | PoisonError>, shared from one captured length question.
- last: Boolean | PoisonError | Promise<Boolean | PoisonError>, derived from !inRange(i+1), with ordinary poison propagation.

last can be false while exact length is pending or failed. Reverse indexes consume exact length. Metadata resolves from captured source facts independently of exhausting this cursor; otherwise a sequential body awaiting length would deadlock its iterator. Allocate no unrequested metadata waits. Diagnostic contexts retain only immutable descriptive facts, never these Promises, captures, or execution authority.

The compiler requests every metadata field that compiled code can consume. If the complete loop metadata object escapes or its keys are selected dynamically, request the potentially accessed fields rather than treating unknown usage as absence. Metadata failure propagates through ordinary language operations, not JavaScript arithmetic on an Error.

Value-ready batching is a consumer over this same cursor. Flush an accumulated ready prefix before waiting for the next element root; return a pacing dependency at that position. It adds no kernel traversal mode or second Array representation. A ready object with pending descendants is ready for this purpose.

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

A logical layout maps destination ranges to captured source selectors, payloads, holes, or deferred/failed mappings. Most ordinary remaps use offsets and bounded ranges. Shape and write predicates use captured operands. The selected interface must preserve the specified independent facts without requiring every algebraic relation between several methods. This logical model does not prescribe an expression solver, a persistent segment tree, or a descriptor for every position.

Expose it through existing language-property access and ArrayView capture/resolveLength/resolveInRange facilities. Lookup precedence is the selected version's point override, its layout mapping, its captured backing view, then physical storage where no logical layer masks it. An absent point override masks older presence too. Each layer belongs to the same captured version; never combine a historical layout with a later live override. Sparse enumeration and graph summaries must use this same boundary rather than discover backing properties independently.

Extend the existing LengthState/captured-shape boundary with failed facts and conservative transfer rules. Do not maintain a separate iterator length/prefix model or a second independently authoritative region-shape store. Existing length growth contributions are not sufficient for truncation, shifts, subtraction, and failed layout. A richer relation is retained only where the chosen representation and specified semantics require it; otherwise bounds may conservatively prove less.

Known Arrays and simple offset views keep compact storage under this interface. Compose mappings without copying the entire predecessor description on every command. A pending node may retain a predecessor, but bounding chain depth by the number of pending operations does not establish a work bound: repeated lookup, capture, or settlement through that chain can still cost quadratic work. Index or normalize shared mappings at the narrowest scope required by measured access patterns, and retire spent history during ordinary transitions.

For each adapted method, replace native-intrinsic execution on ArrayRemap as the semantic decision procedure with the common declarative mapping/write evaluator. Ready controls reduce the same expressions immediately; pending and failed controls retain dependencies. Native assembly may materialize a determined result, and ordinary JavaScript remains a valid-input oracle. Do not maintain native execution for ready inputs and a different semantic algorithm for pending/failed inputs.

### Incremental updates, not command replay

An operation installs its successor dependencies once. When an input settles, its guarded continuation advances the affected pure shape/mapping facts and required one-time publication actions. Notify dependent work only when a fact it needs changes. Do not reinvoke a mutation, comparator, conversion hook, or host action merely to discover a longer prefix.

The cursor issues its currently guaranteed positions, then retains a question for the next undecided boundary. A relevant change resumes that question; the cursor continues from its saved position. Issued slot promises retain their own value dependencies and do not have to complete before the cursor advances. Reuse synchronous transitions, guarded continuations, and history-safe worklists; no global operation rescan or new execution scheduler is required.

This is an update discipline, not a proved complexity bound. One input may legitimately affect several later mappings, and a poorly represented dependency chain can still cause quadratic work. The current LengthState itself refreshes affected contribution sequences; it is not evidence that every future query/update will be constant time. Prototype retained history, active questions, propagation, and release before fixing the new representation. Recompute small local transfer rules as needed; avoid repeatedly traversing the complete command history or already-consumed data.

### Evaluation and recommendation

For a standalone explanation of both approaches, existing runtime concepts, worked examples, and integration costs, see [array-layout-approaches.md](array-layout-approaches.md).

The two approaches share the conservative shape analysis, final-slot capture contract, per-method semantics, and publication boundaries. A segment tree does not itself prove a longer prefix, and a conservative mapping implementation need not forget all end-relative facts. Compare storage and dependency management separately from the strength of supported proofs.

**A: shared range mappings.** Keep existing Array/ArrayView storage and captured placement versions. Add compact descriptions for forwarded ranges, replacements, and deferred regions behind the common property boundary. Known coordinates use normal placements; undecided coordinates remain protected captured dependencies. This is the recommended baseline because it extends the current indexing/publication mechanisms rather than replacing ordinary Array storage.

**B: persistent segments.** Represent a logical sequence as shared source slices, inserted runs, holes, concatenations, and deferred segments; reverse changes traversal direction. Bounds summarize segment lengths. This is elegant for sequence construction and endpoint consumption, but unknown-length segments still need deferred coordinate selection, and arbitrary indexed operations still need split/overwrite logic. If used as permanent storage, it also needs occurrence-aware projection into the runtime's logical `(parent,index)` relationships.

| Requirement | Shared range mappings | Persistent segments |
| --- | --- | --- |
| Guaranteed prefix with pending payloads | Directly supported by captured bounds and final-slot dependencies. | Same guarantee; segment structure is not required for position issuance. |
| Known-start splice with pending count | Forward fixed prefix/insertion and retain a deferred remainder. | Concatenate known prefix/insertion with a deferred remainder. No inherent correctness advantage. |
| Push/unshift, endpoint reads, reverse | Numeric mappings are straightforward when coordinates are known. End-relative queries can avoid some length waits without a tree. | Known outer segments naturally remain readable from either end; unknown interior lengths need not block them. |
| Point writes, delete, fill | Existing point overrides and bounded replacement machinery are a close fit. | Split/replace segments or add overrides. Unknown split coordinates must defer; avoid adding a second authoritative overlay model. |
| Overlapping copyWithin | Reuse pre-write placement captures and destination ranges. | Reuse immutable pre-write slices. Never reference the live destination; sharing segments does not remove snapshot obligations. |
| Unknown start, sorting, classification-dependent flat | Wait on required controls/classification or publish the specified independent facts. | Still requires deferred transformations or algorithm barriers; concatenation alone does not solve these cases. |
| Sparse topology and parent relationships | Extend current placement publication for partial regions; this is real integration work. | Multiple slices, reversed occurrences, and unknown preceding lengths require more general occurrence-to-index projection or materialization. Current backing-owner projection is a single offset view. |
| Long histories | Chains of deferred mappings can retain spent sources or make every lookup walk history; normalize and release them. | Unbalanced concatenation, repeated splits, or deferred transform wrappers can do the same. Balancing concatenations does not balance arbitrary pending transformations. |
| Full export/native use | Complete the required facts and use canonical assembly. | Same completion boundary; eventual flattening/assembly is still required. |

Neither approach replaces the write/effect decision. Reusing an old layout after two reverses does not cancel their prescribed writes or identity changes. Neither automatically supplies correct regional poison, source release, COW, or counter summaries. Those common obligations must remain visible when comparing the implementations.

#### End-relative queries as a bounded extension

Before choosing a persistent tree for the push/reverse example, evaluate a private query consisting of direction plus offset into a captured layout. Its local rules are simple: reverse swaps direction; push of k items answers the last k offsets from those payloads and forwards larger end offsets to its predecessor; unshift is symmetric. Uncertain membership still uses captured bounds. Other methods may conservatively wait when their selected range cannot be established. This is one rule per operation, not one rule per operation combination or a general algebraic solver.

Then reverse(push(partialArray,"Z")) reads the final layout from its front, which requests the append layout's back, which selects Z. No absolute append offset is needed. An end-relative selector is internal evidence, not permission to emit an element at an unknown numeric index or register a guessed parent edge.

Verify these local rules against all completions of bounded unknown regions before integrating them. Selector soundness alone does not establish correct production poison, ownership, topology, history costs, or lifetime behavior. Keep the richer guarantee conditional on those integration checks. Any rule that changes Error presence must become part of the common semantic contract, independent of physical storage eligibility; it cannot be an optional fast path with different failures.

**Choose A for the implementation baseline.** Prototype its compact deferred regions and optional end-relative queries using existing captured versions. Small shared range/segment descriptors may implement those mappings; that does not require a new permanent sequence store. Do not maintain both representations as competing authorities. Do not replay operation history, add a general symbolic solver, or commit to a balanced persistent tree solely for earlier Z delivery.

Reconsider permanent segments only if the prototype shows that ordinary concatenation/slicing/remapping workloads otherwise require material copying or awkward extra state, and a segment implementation improves those cases while preserving indexed access and graph/lifetime bounds. The acceptance gate includes mixed unknown-length regions and fixed-index writes, sparse holes, overlapping copies, retained snapshots, partial failures, and repeated pending/no-op operations on small Arrays. Measure allocations, descriptor visits, notifications, and retained captures separately from produced output. This is an architectural recommendation; production update complexity is not yet validated.

### Ownership and topology

Known published placements have complete logical parent relationships. Unknown destination positions have no guessed graph edges; source captures/leases preserve their inputs until positions can be published or discarded. Shared settlement updates parent relationships and active counters before consumer callbacks. Error/pending summaries include local structural facts as well as ordinary child placements.

Capture source and destination independently. A later write or COW fork preserves earlier facts without giving a shared producer authority over the new placement. copyWithin captures all overlapping source versions before installing destination effects; forward mappings do not reread their destination.

COW, materialization, backing sharing, canonical assembly, retirement, and cached re-entry preserve authoritative forward state. Materializing physical storage is not proof of complete shape. Retirement removes obsolete reverse references and destinations, not captured producer authority still needed elsewhere. Restoration uses maintained state, without host reinspection or resubscription.

### Work ownership and release

Shared data producers own captured inputs, context, and their live uses. Operation owners retain required result/validation/effect work. Neither substitutes for the other. Transfer a partial result's producer before invocation closure; keep mutating command work open until its specified completion.

Release each source at last access, independently of body/result completion. Once a source is fully captured, pending callbacks retain its versions and clearable output destinations, not the old container or unread siblings. Remove producer-only references when no destination, capture, or required command result can use them. A never-settling source may retain a callback, but that callback must not unnecessarily retain an abandoned graph. Preserve ordinary Promise ownership; this is not cancellation.

Use one owner per operation and one fatal-result registration per actually pending public result. Per-item capture is not another public operation boundary. Fatal resumption and local closure retain existing shared-settlement/operation-work checks. No iterator registry, producer scheduler, execution-wide sweep, or new thenable transport is needed.

### Work bounds

Work is proportional to consumed data, produced output, captured versions, and necessary unfinished transitions. Preserve sparse gaps symbolically; do not allocate per possible hole or failed index. A value iterator may visit every index it actually issues, but an early exit must not allocate the remainder. Reuse maintained range indexes; do not repeatedly scan delivered prefixes or settled command history. Test N unfinished operations on a fixed small graph, including repeated captures/reads and operations later proved to have no effect; distinguish unavoidable retained versions/output from avoidable history traversal. Settling one branch must release its spent predecessors while unrelated branches remain pending.

Drain history-sized forwarding, completion, and release with loops or synchronous worklists. Keep ready transitions synchronous and use existing ordered thenable continuations. Required dependencies may remain pending indefinitely; neither timeout invention nor a later command becoming an earlier prerequisite is acceptable.

## 9. Repair integration

Regional failures create no own-path blocker and cannot be repaired by restoring an implicit baseline. That is the Array revision's repair dependency. The separately selected [repair simplification](repair-simplification-plan.md) also limits repair to exact own-path blockers originating from explicit !, exposing retained placement state unchanged, including absence and local Errors. Its provenance and external own-only clearing changes can land independently; the iterator itself does not require their entire implementation.

Do not retain predecessor Arrays solely for regional repair. Preserve captures needed by ordinary snapshots, immutable outputs, native isolation, simple own-path unpoisoning, or unfinished results. Removing repair baselines must not remove those other protections.

## 10. Implementation sequence

1. **Validate the recommended representation and settle the remaining contract.** Prototype section 8's shared mappings and end-relative query extension before promising stronger composition. Reconsider permanent segment storage only against demonstrated integration/work costs. Resolve section 12 and the stronger-query failed-control cases before implementing affected semantics. Model mappings, prescribed writes, supported dependency reductions, root obligations, and failure footprints independently of production storage. Compare ready, synchronous-thenable, and deferred schedules. Measure shared mapping access/update/release on long pending histories.
2. **Deliver the cursor on existing captured facts.** Implement the public iterator and compiler reservation/binding integration using the common capture boundary. Verify pending payloads, sparse data, snapshots, pacing, metadata, and body completion. This provides useful ordered streaming without claiming unfinished structural operations already support regional publication. It is the same cursor later stages extend, not a temporary second traversal.
3. **Add shared layout/shape facts in a coherent first family.** Start with shape-preserving fill/copyWithin/reverse and their corresponding copying operations, including point overrides. Integrate Error queries, topology, COW, source release, and ordinary consumers in that same change. Remove the family's superseded intrinsic/gate/rollback path; do not expose partial data before its consumers can preserve it.
4. **Add length-changing mappings and partial producers.** Extend the shared transfer rules for splice, endpoint methods, slice, concat, and flat. Preserve per-call result-root validation, transfer producer ownership, and prove capacity/supersession behavior. Cover positive bounded consumers and conservative position issuance through composed methods. Add stronger ready-value composition only if selected in stage 1. No unrestricted pending-key optimization is implied.
5. **Complete algorithm-specific demand and the method inventory.** Adapt searches, join/conversion, and sort, including comparison-free cases and the independent tail. Apply unused-argument reductions within each method evaluator. Audit every controlled name/mode and non-method consumer; preserve opaque native transitions.
6. **Land repair simplification as its own coordinated change.** Carry explicit-! origin, retain eligible owning-placement state, and clear only external own state. This may proceed independently of stages 2–5, with its own contract updates and fixtures.

For every landed family, update authoritative data/Array/Error contracts and validation together. Update public integration docs with the cursor and repair API changes, and Phase 9 status as each capability lands. Do not leave a permanent compatibility switch or update current contracts ahead of the corresponding runtime behavior.

The common implementation boundary is language-properties plus array-view/array-length and captured property versions. Method evaluation/publication changes belong in array-methods/array-invocation/array-remap and mutation transitions. Parent placements, structural Error summaries, captured identity, and producer ownership need explicit integration. Audit export, conversion, managed capture, COW, retirement, and canonical assembly for bypasses and complete-Array assumptions; do not presume that each needs a rewrite, or that routing ordinary reads through one boundary proves all of them correct.

## 11. Required verification

| Area | Acceptance cases |
| --- | --- |
| Schedule equivalence | Ready values/poison, synchronous supported thenables, native Promises, reverse fulfillment/rejection, and required complete Error collection. Compare facts/effects, not merely final export. |
| Independent publication | Pending-count splice exposes A/B/X; lookup, at, bounded slice, searches, fill, and copyWithin use that state. Known unaffected suffixes are usable too. |
| Conservative prefix | Pending-count splice, push Z, reverse has lower length bound 1; index 0 can be issued with its final-slot promise. A larger theoretically provable prefix may be withheld, but no emitted position or captured value may be retracted. Unknown earlier overwrite/deletion remains represented before issuance. |
| Stronger composition candidate | Compare immediate Z delivery in the push/reverse workload across representation prototypes; it is not a mandatory baseline optimization. Failure behavior must match the selected contract, independent of timing. No unproved capacity or authority is bypassed. |
| Position versus value | [never,B] issues both positions; known length with failed/pending mapping still issues its positions; failed in-range boundary stops after its guaranteed prefix. |
| Operations | Every controlled name and mode, indexed assignment/deletion, length writes, replacement, narrow entry, and repair. Pending keys resolve to indexes, length, invalid values, or poison. Compose push/shift/unshift/pop while removed payloads never settle; reverse pending payloads; sort before/after captures, with independent undefined/hole tails. |
| Validation | with(pendingIndex) waits when index selection/validity is still needed; no early Array root. An independently proved invalid request keeps its own validation Error. Cover concat part/capacity and flat classification/cycle barriers; invalid dispatch remains distinct from local operation failure. |
| Failure locality | Payload, bound conversion, capacity, source reflection, destination storage, ancestor publication, comparator failure, and inherited shape failure have declared footprints. Broader ! scopes preserve healthy siblings. |
| Irrelevant argument failure | Empty fill/copyWithin, empty/out-of-range searches, empty at/slice/flat, zero/one-element join, comparison-free sort, and deterministic splice cases succeed despite unused poison. Repeat with invalid values and never-settling inputs. |
| Search range independence | [1].indexOf(2,P) and lastIndexOf return -1; includes returns false. Repeat with never-settling controls, holes, partial shape, conditional comparison Errors, and directional matches. Candidate exclusions and mismatches mask only their own irrelevant dependencies; no arrival-order Error wins over a deterministic answer. |
| Required effect/result failure | Capacity rejection and self-copy with an unresolved/failed write decision follow the settled section 12 contract, including discarded call results and identity. A result still dependent on poison fails even when no data write is required. Late completion after replacement/truncation invents no new current poison. |
| Conditional relevance | Failed argument first, shape/range proof later: compare empty/unused and nonempty/dependent outcomes under all delivery orders. No premature poison or discarded independent result; do not force irrelevant conversion/inspection/subscription. |
| Bounds | Omitted/undefined/extra arguments, relative/fractional indexes, NaN/infinities, empty ranges, sparse Arrays, maximum length, failed exact length with usable bounds. Prove that conservative bounds never exclude a valid completion; preserve constraints required by the selected local rules. No combinatorial inference required. |
| Supersession | Write or truncate a prefix before its old remainder settles; replace the Array while an old removed-result remains pending. No stale replay or regrowth; earlier captures stay unchanged. |
| Queries | hasError short-circuits; getErrors/full export collect the current required frontier without hidden alternatives. Point/range queries exclude unrelated failure. Poison source and deduplication stay unchanged. |
| Identity | One effective successor per command/node despite multiple publications; genuine no-op forwards; same values with an unresolved write decision do not. Identity can finish while producer work remains; later generations are never rewritten. |
| Topology | Views, holes, absent overlays, overlapping copies, shared children, aliases/cycles, indexed and unindexed graphs, COW, retirement/re-entry, and canonical export. |
| Loop integration | Unbounded/sequential/bounded pacing, break/return, empty success versus failure, Error items, destructuring, body aggregation, and independent length/last/reverse-index metadata. Late bodies precede later parent work through reservations. Closed outer issuance publishes partial state while child dependencies remain; an unrestricted open mutation reference cannot expose a provisional prefix. Structural failure poisons declared body/else targets according to issued-position count. No metadata/body self-wait. |
| Boundaries | External-capability item errors, healthy native Error data, protected handoffs, opaque native method preparation, ready-only mutable-external snapshots, and fatal resumption. Whole-path authority rejection precedes regional publication; registered-resource scopes fail before argument settlement. |
| Lifetime/work | Early stop and abandoned results release sources while unrelated dependencies never settle. Retain unformatted diagnostics in lifetime probes. Long pending/no-op histories on a small graph do not grow quadratically; sparse ranges are not expanded unnecessarily. |

Use existing public-operation, model, conflict, consistency, and lifetime verifiers. Add an independent all-ready oracle for revised failure behavior; ordinary JavaScript alone is not that oracle because it eagerly validates some inputs the revised semantics do not consume. Test early accessibility with never-settling unrelated dependencies and controlled delivery, not timing-sensitive sleeps. A passing iterator prototype or the old rollback tests cannot establish this revision.

## 12. Remaining failed-effect contract

Do not add a frozen poisoned-size state, a capacity-only marker, or a retained command-error log. Ordinary failed layout already has practical uses in partial splice and bounded consumers. It does not freeze future size writes and must not abort the specified independent facts of subsequent operations. Section 8 separately requires a representation decision before guaranteeing stronger composed-selector behavior.

Capacity overflow is different: the requested size is invalid, not an unknown legal size. The suggested interval [oldLength,MAX] cannot encode it; at maximum capacity that interval is a singleton. For this rare invalid structural request, the simpler candidate is the existing owning-path failure mechanism, with preflight before any affected successor facts escape. Its precise owning scope and repair behavior must be settled consistently with the chosen explicit-! rules. It is not yet an approved exception to regional publication. Do not implement additional shape state solely to preserve access in this extreme case.

There is a separate ordinary write-effect case: copyWithin(0,0,failedEnd) has identical source selectors, but whether a semantic write is prescribed depends on failedEnd. Write-based identity makes that unresolved decision observable. The final policy must specify its receiver/result/identity failure without pretending a known no-op or adding hidden history. Keep this distinct from capacity overflow and from a poisoned payload. It remains unresolved; deterministic scalar searches and ordinary partial layout do not depend on selecting it.
