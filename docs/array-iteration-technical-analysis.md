# Array iteration: dependency rules and item handoff

Technical analysis for the two deferred tasks in [iterate-plan.md](../iterate-plan.md). The follow-up [method specification](array-method-specification.md) supplies the correlated/unknown-shape, copyWithin, sort/flat, placement-role, work, and lifetime rules, including the plan's [selected decisions](../iterate-plan.md#13-selected-decisions). This document retains the initial derivations and handoff decision; neither document implements the production iterator.

## 1. Conclusions

- All modes preserve the order of operations that can fail the entire captured Array. Whole-Array failure blocks the first item and ordinary writes through the failed version. The [complete-mode gate](../poison-policy-plan.md#complete-access-gate) covers additional failures that streaming operations can confine to particular slots. Stored payload rejection stays local.
- Use one demand-driven selector evaluator over captured mappings. Method rules define shape, selection, effects, and failure; the tree indexes those facts. No general solver or second failure-only evaluator is needed.
- A deterministic fallback must respect captured bounds and every established publication. Always appending an insertion with a failed position is wrong when tighter position bounds exist.
- Receive each delivered item into its ordinary elem Chain inside `next()`. Return that Chain directly to Cascada's trusted consumer. This uses the existing ownership mechanism and avoids protecting a raw managed value through a protocol-record Promise.
- `return()` stops future pulls; it does not cancel an already-issued `next()`. That request finishes with its own capture. This preserves ready/deferred equivalence without a cancellation framework.

The [probe](../test/experiments/array-iteration-contract-probes.mjs) checks 4,788 bounded splice domains, 29,358 splice occurrence questions, and 3,486 slice/fill range questions against native successful layouts. Twelve public-runtime handoff cases cover ready/pending/poisoned payloads, `for await`, unread-item mutation, nested pending data, holes, aliases, and a step that outlives cursor closure. These are design witnesses, not integrated layout or lifetime proofs.

## 2. Keep the evaluator separate from storage

Each issued operation has one captured predecessor, its captured arguments, and method-specific semantic facts. A deferred region retains these facts only while some live output or effect needs them. Variant B supplies sequence indexing, sharing, and lifetime management; it does not decide which arguments are relevant.

Evaluate the question the consumer actually asks:

| Question | Required answer |
| --- | --- |
| Array access validity | Wait when earlier work can poison the whole captured Array or an ancestor. Its failure blocks access at every index and orders later repair. Each mode supplies its declared failure scope. |
| Length or membership | Exact count, sound bounds, or the remaining structural dependency. |
| Presence | Present, absent, or the selection that can still change it. A hole is not an unknown placement. |
| Payload source | Captured source version, inserted payload, prescribed literal, or hole. A pending payload differs from pending source selection. |
| Occurrence | Guaranteed survival and final payload source; intended index is an additional sequential requirement. |
| Failure membership | Actual retained Errors/statuses and unresolved output-relevant selections, not every retained input. |
| Effect/completion | Prescribed writes, identity, validation, and direct-result work independent of payload readiness. |

Do not deliver an elem Chain merely because membership is true. For `[R(width 0..1), Z]`, index zero exists but its source is unknown. Sequential iteration waits; a numeric lookup may retain that unresolved selection, and unordered discovery may identify Z separately.

## 3. Small common reduction rules

The common operations are captured spans, inserted spans, holes/repetition, ordered joins, reversal, interval restriction, and conditional selection. A method can also retain a deferred region when these do not yet express its result. These are semantic operations over existing layout records, not a second materialized graph or public value type.

Apply the same rules to ready and deferred inputs:

| Rule | Example or consequence |
| --- | --- |
| Exact facts select a branch; bounds exclude impossible branches. | A known insertion boundary releases its preceding prefix. |
| Identical source selectors eliminate a conditional dependency. | `choose(P, sourceSlot, sourceSlot)` forwards the slot. This is not a scan for equal old payloads. |
| A repeated internal guard keeps its established branch condition. | `C ? Y : (C ? X : A)` reduces to `C ? Y : A`. No cross-lookup provenance registry is required. |
| Joins and reversal preserve endpoint relationships. | The first item of `reverse(S + [Z])` is Z, independently of S's count, after publication prerequisites. |
| Range restriction removes excluded content dependencies. | An overwritten or excluded source contributes neither payload poison nor a retained content use; required shape/effect facts remain. |
| Shape-preserving operations reuse shape facts. | `fill`, `copyWithin`, and `reverse` do not need a second length authority. |
| Ready endpoint count transforms compose in the existing clamped-affine form. | Append and trim history need not become a linked chain of count expressions. |
| Ordinary comparisons remove irrelevant candidates; Boolean absorbing results short-circuit. | `[1].indexOf(2,P)` returns -1. No combinations of hypothetical comparisons are searched. |

Normalize locally when creating or refining a mapping; query unresolved detail on demand. Subscribe to changed semantic facts, not every Promise in the entire history. A settled control revises affected derived facts; it does not replay commands.

These rules do not prove a total work bound for arbitrary nested selections. Use iterative history-sized worklists, release superseded inputs, and measure mixed histories. A balanced storage tree alone cannot prevent quadratic semantic work.

## 4. Failure is part of each operation's meaning

For each method family, define successful mapping, irrelevance reductions, failure fallback, and root-invalidity outcomes together. A publication proof covers every permitted outcome, including failure. Proving a fact across successful argument values alone is insufficient.

Apply fallback only after actual relevant failure, at that operation's logical position, then compose later commands. Pending controls retain their dependencies and cannot produce fallback, false exhaustion, or poison merely for being undecided. Do not recompute failure from the later live Array, resurrect discarded payloads, or let settlement order choose the layout. Genuine path blockers remain prerequisites; a later content simplification cannot silently repair them. Ordinary overwrites/removals can discard regional errors as specified.

The three modes share successful mappings under [sequential equivalence](../iterate-plan.md#sequential-equivalence-is-the-publication-criterion). Complete-mode failed mutations retain unchanged data under repairable status; failed copies return root Error. Streaming modes retain sequential positional status or unordered survivor fallback. The [sort boundary](array-method-specification.md#7-sort-and-tosorted) follows complete-mode mutation failure and overrides streaming regional failure. Payload rejection remains value poison in every mode.

Per-command effects and direct results remain separate. For example, a failed required splice deletion count can poison the removed-elements result while its streaming receiver has an unaffected prefix and a regional failure. Folding a mapping does not cancel prescribed writes or erase a call-result failure.

## 5. A bounded splice fallback

### Bounds come from the method

For captured source `[A,B,C,D]`, insertion count one, deletion count zero, and a raw failed insertion position, normalization gives [0,4]:

```text
Possible insertion boundaries: 0, 1, 2, 3, 4
Guaranteed survivors:          A, B, C, D, X
Streaming fallback:            [A,B,C,D,X]
Sequential status:             all five positions flagged
Unordered status:              all five occurrences usable
```

No narrower range follows from a failed application's intended calculation. Internal range restrictions must have a retained method/layout derivation; the raw run API supplies none. Always choose the latest boundary allowed by those actual facts, preserving established publications. Here that boundary is the captured end, independently of later appends or settlement order.

### Known source length and rectangular control bounds

Let source length be L, inserted count k, normalized start bounds `[sLo,sHi]`, and nonnegative deletion-count bounds `[cLo,cHi]` before clamping to `L-s`. These formulas accept projections of captured method facts, not arbitrary annotations on failed arguments. A raw failed start has bounds [0,L]; a raw failed deletion count can use [0,L] before the final clamp. Ready normalized arguments are singleton ranges. The runtime does not infer bounds from the later live Array.

The following rule is closed for this case:

1. Use `sHi` and `d = min(cLo,L-sHi)` to construct a fallback arrangement of slots. This is an internal layout rule, not execution with fabricated application arguments.
2. Keep every guaranteed surviving source occurrence and every inserted occurrence.
3. Replace a selected source occurrence that might have been deleted with permanent structural poison. Do not retain its payload for repair.
4. In sequential mode, flag a surviving occurrence if its intended position varies. In unordered mode, retain it without positional poison.
5. If the reductions prove all relevant effects/results independent of a failed argument, that argument creates no failure. The fallback machinery is not a reason to consume it.

For `cHi > 0`, possibly deleted source indexes form `[sLo, min(L,sHi+cHi))`. With `cHi = 0`, no source occurrence can be deleted. The count bounds are:

```text
minimum output length = L - min(cHi, L-sLo) + k
maximum output length = L - min(cLo, L-sHi) + k
```

The selected fallback has the maximum permitted length. It preserves fixed prefix/suffix positions and every guaranteed survivor. Uncertain candidates occupy structural Error slots only where the chosen layout has an output slot; it does not allocate one slot for every hypothetical candidate plus all survivors.

Examples:

| Inputs after relevance is established | Streaming fallback |
| --- | --- |
| `[A,B,C,D].splice(2, failedCount, X)`, count domain `[0,2]` | `[A,B,X,Error,Error]` |
| Same source, start 1, raw failed count clamped to `[0,3]`, insert X | `[A,X,Error,Error,Error]`; A/X have fixed positions, while B/C/D may have been deleted. |
| Same source, raw failed start normalized to `[0,4]`, count 0, insert X | `[A,B,C,D,X]`; sequential mode flags all five occurrences. |
| `[A,B,C]`, raw failed start normalized to `[0,3]`, count 1, insert X | `[Error,Error,Error,X]`; sequential mode also flags X. Start 3 deletes nothing, so fallback length is four. |

An issued splice has a known inserted argument count. These cases need no missing-output marker: their output uncertainty is already represented by inserted values, positional flags, or structural Error slots.

### Limits of this result

The probe covers dense unique occurrences, known L, arbitrary rectangular start/count domains, and known k. Its artificial tighter-domain witnesses test arithmetic only; they do not establish a run contract for attaching ranges to failed arguments. Production acceptance uses raw domains or an explicit retained derivation. Omitted arguments and negative/raw numeric inputs first use the method's specified normalization.

Do not apply the rectangular rule after discarding an internal relationship that matters. The [normalizer rules](array-method-specification.md#3-unknown-lengths-and-shared-controls) preserve source-length and deletion-clamp relationships while keeping distinct argument positions independent, even for the same Promise or Error. The [copying and range rules](array-method-specification.md#5-endpoint-and-copying-families) cover the corresponding source and result boundaries. Sparse/runtime witnesses are included in the expanded probe.

## 6. Coverage of the remaining method rules

### Determined shape: slice and fill

For known L, normalized start in `[a,b]` and end in `[c,d]`, ordinary interval selection gives the following rules. As for splice, these intervals must come from normalization or a named internal derivation; raw failed start/end arguments each have domain [0,L], independently.

| Fact | Rule |
| --- | --- |
| Slice count bounds | `[max(c-b,0), max(d-a,0)]`. |
| Slice fallback extent | Capture `[a,d)`; it has the maximum allowed count. |
| Guaranteed surviving slice sources | Source indexes in `[b,c)`; empty when b is at least c. Other fallback slots become structural poison. |
| Slice survivor position | `sourceIndex-start`; sequential mode flags it when start still varies. Unordered mode keeps it usable. |
| Definitely filled destinations | `[b,c)`; select the fill payload without the failed bounds. |
| Definitely unaffected fill destinations | Before a or at/after d; retain the old placement. |
| Remaining fill destinations | Old-versus-new selection is uncertain; a relevant failed bound produces structural poison there. |

The probe checks these projections using distinct source selectors and a distinct fill payload. Identical-selector and empty-range reductions still apply first. Known holes retain ordinary sparse behavior; the dense probe does not prove its integrated handling. `fill` keeps length L, and neither method needs an extra missing-output marker when the failed selected output already has structural Error slots.

These rules use one interval selector for copying and overwriting. `copyWithin` adds coupled source/destination coordinates and must preserve their relationship; it cannot substitute independent intervals that invent impossible combinations.

### Family integration

| Family | Rule to integrate and remaining work |
| --- | --- |
| `push`, `unshift`, `pop`, `shift`, `reverse`, `toReversed` | Join/trim/orientation over captured spans; preserve endpoint selectors, prescribed writes, holes, and direct results. Unknown length uses semantic count facts, not eager materialization. |
| `fill`, `copyWithin` | Conditional destination selection, using the fill projections above. Overwritten values are unused; copy sources are pre-write captures. Self-copy is a structural no-op. Use the [coupled-coordinate specification](array-method-specification.md#6-fill-and-copywithin) and its sparse-placement witnesses. |
| `splice`, `toSpliced`, `slice`, `with` | Normalized restriction and insertion; apply the bounded rules above where applicable. `with` validates replacement index before root handoff. Removed splice results and receiver successors have distinct failure boundaries. |
| `concat`, `flat` | Ordered contributions and mode-specific capacity. Streaming required part/discovery/cycle failures use local structural markers, not whole-result preflight; complete mode keeps required root validity. Use the [flattening/discovery rules](array-method-specification.md#8-flat). Include marker fallback counts in bounds; one marker cannot satisfy a success-only minimum. |
| Searches, `join`, `toString` | Demand ordinary comparisons/conversions and captured eligible positions. Result order, no-match proofs, separator irrelevance, and Error collection remain method-specific. |
| `sort`, `toSorted` | Comparison-free reductions first; otherwise retain an algorithm region. Use the [sorting specification](array-method-specification.md#7-sort-and-tosorted) for permutation failure, fixed partitions, comparator work, and retained payloads. |
| Indexed/length writes, deletion, entry | Use the same captured shape/override boundary, preserving authority and whole-path invalidity. Open entry additionally needs reserved contribution order and closure. |

These initial rules are extended by the [completed method specification](array-method-specification.md). Its work model separates question readiness from optional numeric caches; integrated runtime probes exercise the existing publication and lifetime mechanisms. Production cutovers must rerun the same witnesses through the actual new layout.

## 7. Select Chain-valued iterator steps

The standard async-iterator interface requires a Promise from every valid `next()` and `return()`. A ready item is captured in its non-thenable elem Chain synchronously. The outward step can then be returned as a settled Promise.

```js
return Promise.resolve({ done: false, value: elemChain });
```

The source occurrence must first pass structural publication checks. Receive the captured placement in an ordinary holder before raw extraction. A healthy hole binds a present `undefined` root and leaves the source hole intact. A sparse structural copy preserves the source absence. A structural selection failure rejects the step; a rejection of the established payload becomes poison inside the elem Chain. Raw lookup's registration/authority checks are not the item-transfer boundary; apply the [inert item contract](../iterate-plan.md#item-boundaries).

The trusted Cascada consumer binds that exact Chain. It does not import it as language data or wrap it in another Chain. `for await` awaits the step, not the holder's root. Cascada must recognize this managed-item transport; a generic value-stream adapter cannot assume the item is the underlying JavaScript value.

For unordered delivery, this is a [trusted scheduling interface](../iterate-plan.md#unordered-pulls-are-a-scheduling-interface). The first available step need not be the logical first item. Application-visible selection, effects and early exit retain indexed branch order. Tuple validation and fixed-arity binding execute only inside an enabled body, under the [destructuring rule](../iterate-plan.md#destructuring-in-an-enabled-body).

Use the ordinary loop binding's operation context and construction mode, supplied as compiler facts. Source mode selects enumeration behavior; it does not silently override the destination binding's mode or clear contained poison. Keep runtime/diagnostic context construction at its existing boundary.

After handoff, the loop binding owns its lifetime and is cleared through ordinary scope cleanup. Cursor closure never clears a delivered binding. The cursor protects unread inputs through its captured source; eager creation of all bindings is unnecessary. The fixed-layout probe uses a captured Array holder; Variant B can later release consumed source ranges independently.

## 8. Close the cursor, not an issued step

There is at most one outstanding `next()` under the trusted consumer contract. Give that request its own operation work and required capture before returning a pending result. It must not depend on an owner that `return()` simply closes.

| Event | Required outcome |
| --- | --- |
| `next()` establishes an item | Receive its elem Chain, release step-only captures, deliver the step. |
| `next()` reaches end | Close enumeration synchronously and fulfill the step Promise with `{ done: true }`. |
| Ordered structural failure | Reject that step with the existing poison and close future enumeration. Payload poison remains item data. |
| `return()` with no pending step | Close future enumeration, release unread cursor state immediately and fulfill the close Promise with `{ done: true }`. |
| `return()` with a pending step | Close future enumeration and release cursor-only state immediately. The issued step retains exactly what it still needs and finishes with its original result/failure. |
| Repeated close or `next()` after local termination | Return a fulfilled done Promise. Earlier stop/failure retains its loop-control meaning. |
| Execution fatality | Reject outstanding public results through the common fatal boundary; subsequent entry observes the fatal. |

`return()` does not mean that the previously issued request, body work, or shared production has finished. A required never-settling input can keep that one request pending. The caller remains responsible for receiving or discarding its result, including normal binding cleanup. This is consistent with the runtime's existing no-timeout/no-cancellation contract. Under [mode-specific validity and completion](../iterate-plan.md#mode-specific-validity-and-completion), complete establishes source validity before its first successful step. Cascada's logical break and function return use ordinary control channels and conditionals at every affected scope; neither is equivalent to this low-level cursor return. Preserve existing scope/loop dependencies when optimizing that lowering. Cursor closure itself adds no whole-producer wait to either stream.

For a bounded request this lifetime includes the demand updates it still needs from previously admitted bodies and proved skips. A closed cursor can release the rest of its traversal immediately. Source selection that already started live native work keeps its existing native completion reservation. [Issued-step and close witnesses](../iterate-plan.md#completion-and-early-stop)

Cancelling the step to `done: true` would introduce an avoidable timing distinction: the all-ready execution had already returned an item, while delayed delivery would erase that same issued request. Preserving the request also avoids adding an abort event, request queue, or new cancellation owner.

Keep one public fatal registration for an unfinished step and use existing guarded continuations. A ready item, empty end or close needs only its settled Promise. Fatality observed on a valid step or close rejects that Promise. The fixed-layout probe returns raw records on ready paths to exercise ownership. Public integration must also exercise `.then` directly on ready item, exhaustion, failure, early close and repeated close. [ECMAScript async iterator interface](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-asynciterator-interface)

## 9. Specification completed; implementation acceptance

The [method specification](array-method-specification.md) supplies the earlier family rules; the plan records selected decisions and additional acceptance cases. It also records the clarified result contract: all nine observational mutators return transformed copies, and copy producers follow the source Chain's mode after root validity.

The [expanded probe](../test/experiments/array-method-specification-probes.mjs) adds coupled copyWithin/sparse checks, unknown-length normalizer witnesses, sorting partitions, flattening depth/alias cases, actual indexed publication and retirement/re-entry, and the numeric-bound notification counterexample. Its sort partitions are private successful-permutation facts; whole-sort failure and publication-barrier witnesses remain required at that cutover. Existing public ownership/counter/lifetime tests validate the reused runtime surfaces; indexed out-of-order command branches remain higher-runtime integration work.

Production implementation and its acceptance remain under the plan's [selected decisions](../iterate-plan.md#13-selected-decisions). Integrate the selected rules into the actual tree, then rerun these witnesses and the repository's required sequence, conflict, consistency, and lifetime checks, updating historical sort cases at that cutover. Prototype evidence cannot certify unwritten code or boundary combinations not covered by its witnesses. Representation constants and measured cache/leaf choices must preserve the specified outcomes and work limits.

