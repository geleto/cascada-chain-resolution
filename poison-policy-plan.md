# Chain modes, structural failure, and repair

Selected contract for complete, sequential-stream, and unordered-stream Chains. This replaces the earlier blockOnPoison Boolean and the proposals to path-poison every failed Array or retain non-element failure markers. The policy foundation precedes open-entry streaming; unordered occurrence delivery lands last. Production contracts and runtime behavior change at their corresponding implementation cutovers.

## 1. Policy belongs to the Chain

Use one construction mode, with complete as the conservative default. The names below describe the contract; finalize the exported option/constants with the API. Do not retain a second blocking Boolean.

| Mode | Structural failure and iteration |
| --- | --- |
| Complete | Settle the captured Array's required structural work and validity before exposing it for iteration. A relevant structural failure normally produces an ordinary whole-Array PoisonError, with no repairable hidden Array. Required preparation/comparison failure in mutating sort uses the explicit repairable-flag exception below. |
| Sequential stream | Stream the structurally published prefix in numeric order. Retain guaranteed survivors at deterministic fallback positions after failure; path-poison occurrences whose intended positions cannot be established. Do not stream structurally poisoned occurrences. |
| Unordered stream | Stream guaranteed surviving occurrences without waiting for their indexes. Accept deterministic fallback ordering after a positional failure; position uncertainty alone creates no element poison, extra marker, or Array-path poison. |

All modes use one captured-layout engine and the same ownership, command ordering, and boundary rules. Entered references inherit their owning Chain's mode. A receiving Chain uses its own mode for subsequent operations; it cannot restore an ordinary Error or silently clear existing path status. Earlier producers retain their issued semantics across deferred delivery. Modes must not depend on which consumer happens to observe settlement first or mutate shared backing storage.

### Copy-producing calls

All nine mutating Array method names called without ! return a transformed copy and preserve the source. With !, their direct result remains the JavaScript method result. The copying call uses its source Chain's mode: complete waits for structure; sequential/unordered can hand off a valid partial copy under their regional failure rules.

An exposed copy's root cannot later become a call Error or retroactive path flag. Required whole-result validity, including with index validity and capacity, is established before handoff in every mode. Sorting additionally requires established ordering before result access, as specified below. Other position-only failures retain the mode's ordinary fallback. See the [full result boundary](docs/array-method-specification.md#1-one-operation-separate-outcomes).

### Sorting requires order

Sorting uses the [normative sort failure contract](iterate-plan.md#13-selected-decisions). It explicitly overrides unordered position-only recovery and complete mode's usual mutating structural-failure representation. That section owns the mutation/copy distinction, publication prerequisites, retained data, repair, identity, and later publication-failure boundary. Do not infer sort outcomes from the general mode table alone. The [method specification](docs/array-method-specification.md#7-sort-and-tosorted) defines preparation and comparison work.

### Payloads are independent of structural publication

For [pendingA,B], both occurrences can be issued without awaiting pendingA in every mode. Its rejection poisons only that payload, not the Array, other elements, or the structural prefix. Ready payload poison behaves identically; ordinary Error items remain deliverable.

“Stream only healthy elements” means structurally valid occurrences, not poison-free payloads or fully resolved descendant graphs. Do not run hasError on each element as a delivery gate. Complete mode waits for structural work, not every stored Promise. An earlier sort or another structural operation may still genuinely need a value to determine its layout.

Track payload failure separately from structural uncertainty at a placement. A final-slot Promise whose source selection can still fail structurally is not an ordinary pending payload. Structural markers/failed selections must remain distinguishable through remapping and materialization without guessing from arrival time, Error identity, or message.

### Published prefix

A published sequential occurrence has established membership, intended numeric position, and final captured payload source, or is a known hole yielding undefined. The payload itself may be pending or ordinary poison. A length lower bound establishes possible progress but does not by itself establish this selection.

A prior mutation that can still delete or overwrite an occurrence prevents its publication. A later command uses a successor version and cannot change an already captured occurrence. Beyond the required bounded rules, conservative delay is permitted; premature publication is not.

The clean-prefix size is structural, not a count of fulfilled or non-poison payloads. Keep it as a captured layout fact and expose it in relevant failure diagnostics. It is not the number of bodies that happened to start. Do not mutate a shared causal Error to attach different Arrays' prefix sizes or manufacture an Array Error merely to carry the number.

## 2. Failure categories and fallback layouts

| Failure | Streaming-mode representation |
| --- | --- |
| Ordinary payload rejection | Ordinary poison at the established value placement; no structural marker or Array-path poison. |
| Guaranteed survivor with lost intended position | Preserve its payload in the fallback layout. Sequential mode adds own-path status to that occurrence; unordered mode accepts the ordering and leaves it unpoisoned. |
| Contents or survival cannot be established | Permanent structural poison at the affected fallback output positions. Repair cannot recover the discarded candidate values. Do not stream these positions. |
| Output may be missing and no existing placement represents that failure | An ordinary one-element structural Error marker at the failed contribution's ordered position. |
| A genuine path/scope failure outside regional handling | Ordinary own-path poison with current data retained, where that operation's contract provides it. It blocks traversal until repair/replacement. |
| Independent observation/callback result failure | Fail that result only; it does not automatically poison entered Arrays. |

Complete mode applies its whole-Array structural failure rule, with the [mutating-sort exception](#sorting-requires-order). It does not promote ordinary payload poison to Array poison. Irrelevant arguments and proved no-effect work introduce no failure in any mode.

### Pure insertion with a failed position

For a=[A,B] followed by a!.splice(P,0,X), all three occurrences survive. If P fails, append X at the end of that operation's captured predecessor:

    fallback: [A,B,X]
    sequential: [pathPoison(A),pathPoison(B),pathPoison(X)]
    unordered: [A,B,X]

Here pathPoison(value) describes existing own-path status with retained payload, not a new wrapper type. The sequential prefix is zero because any of these intended positions could differ. Unordered mode streams the survivors and has no positional Error to report on this Array. Do not add a fourth element: no output is missing, and the one inserted argument already fixes length at three. The call's separate result retains its own declared dependencies.

### Failed deletion count

For a=[A,B,C] followed by a!.splice(1,P), the streaming fallback retains candidate slots as [A,Error,Error]. A is unchanged; B/C may have been deleted, so they become permanent structural poison. Both streams can deliver A. Repair does not resurrect B/C.

Likewise, [A,B,C,D] followed by a!.splice(2,P,"X") retains [A,B,X,Error,Error] under this fallback: the inserted X is known at index 2, while C/D have uncertain survival. No extra missing-output marker is needed for deletion uncertainty.

These are explicit failure fallbacks, not claims about which successful argument value was intended. Complete the corresponding rules for every method family before shipping it. Do not create one Error slot per candidate source if that contradicts a required output count.

### Ordered and irreversible fallback

Apply fallback at the failed operation's logical position, never by appending to the live Array when rejection arrives. After splice(P,0,X) followed by push(Y), the insertion fallback is [A,B,X,Y], not [A,B,Y,X].

Choose fallback only after a relevant structural failure is established. Pending controls remain pending. Ready failure and delayed rejection produce the same facts. Preserve all earlier published values, positions, length/bound facts, aliases, and effects. Publication proofs must include the failure fallback; if it could invalidate a fact, that fact is not publishable yet.

With no tighter position facts, an unknown-position insertion uses the captured end as its fallback. Tighter captured bounds constrain that choice: use the latest allowed boundary, preserving any established prefix/suffix positions. A known insertion point or reserved producer region keeps its own location. The [bounded splice rule](docs/array-iteration-technical-analysis.md#5-a-bounded-splice-fallback) specifies this extension and its limits. Legal length/capacity and authority still apply; fallback cannot insert beyond Array capacity.

## 3. Access and extraction

Path-poisoned elements and other genuinely poisoned paths behave as poison in every mode. Ordinary reads, iteration of that occurrence, mutation through it, and export cannot bypass the flag merely because the Chain streams. Permitted final replacement/deletion and exact-path repair retain their normal rules.

Healthy siblings remain accessible because regional Array failure no longer automatically poisons the Array path. Sequential iteration can stop at an uncertain region while an ordinary query accesses another independently established region. Unordered mode does not create positional flags that would then require a bypass.

Do not propagate an unrelated or merely possible ancestor failure into extracted healthy data. Actual earlier writes that might select, overwrite, or delete the target remain dependencies. A genuine own/ancestor blocker is not an irrelevant dependency.

### Containers and contained status

Capture and assignment preserve nested status, markers, and structural facts already in the selected graph. They do not recursively repair it. An extracted ordinary Error stays Error data. Receiving a value under another mode does not clear existing flags, replay old commands, or rebuild discarded values.

Full export and native preparation consume the required graph and report actual payload poison, structural poison, markers, and path blockers. They do not silently omit marker elements or export through a blocked path. Preserve native authority, isolation, effect completion, canonical assembly, and the ready-only mutable-external snapshot contract.

## 4. Error queries

| Operation | Meaning |
| --- | --- |
| isPoisoned(chain, path) | Shallow query: the selected value/path itself is poison, including applicable path status. No descendant scan. |
| hasError(chain, path) | Deep query over relevant contents, structural poison, markers, and path status. Cascada's x is error uses this operation. |
| getErrors(chain, path) | Complete captured relevant failure collection, including marker/path causes. |
| isPoisonError(value) | Existing predicate for an available language PoisonError; no path query. |
| isPoisonedValue(value) | Existing predicate for the expression-boundary failure wrapper; no path query. |

A streaming Array containing element flags or markers has hasError=true without being root poison. In unordered mode, a position-only fallback with otherwise healthy data has no Error merely because the requested order was unavailable. Keep no duplicate Array-level Error log to remember that discarded ordering requirement.

Healthy native JavaScript Errors remain ordinary data. An absent final placement reads as undefined and is not poisoned. A poisoned child does not make its healthy parent shallowly poisoned. Registered external metadata retains captured own/ancestor status and native-content opacity. Fatal failures retain their ordinary behavior.

### Earlier open entries

Queries capture logical versions, not physical flags sampled at a convenient time. An earlier open entry may still add data, markers, or status, or repair/replace a current failure. Neither a currently empty Array nor a provisional failure determines its final captured query answer.

hasError can return true from a certain relevant failure; false needs the complete relevant error-producing frontier. getErrors completes required collection. isPoisoned waits for required selected root/status outcomes, without awaiting payloads that can poison only descendants.

Use entry publication, not iterator draining, to establish these dependencies. Queries inside an entry consume its private command prefix rather than its own enclosing future. Later repairs and commands do not change earlier query snapshots. An explicit deep no-error guard before a loop still waits for payload health when needed; that is the caller's choice, not the iterator's default.

## 5. Repair clears status

[Repair](repair-simplification-plan.md) clears exact selected own-path status and returns undefined after successful publication. It preserves current data, fallback placement, pending versions, local poison, and committed writes.

This includes a sequential occurrence whose payload survives at a fallback index. Repair exposes that retained payload there; it neither discovers the intended position nor reorders the Array. It does not resume an old captured iterator. Later captures see the repaired successor.

Ordinary payload poison, permanent structural poison, and missing-output markers are Error data rather than repairable flags. Replacement, overwrite, deletion, or ordinary structural edits can remove their placements; status clearing does not. Whole-Array Error in complete mode has no hidden Array for repair. Sort's explicit status-versus-data distinction follows its [normative contract](iterate-plan.md#13-selected-decisions).

For genuine own-path status, eligibility does not depend on an explicit-! origin. Failed computed-key writes, selected scope failures, and canonical external own-state failure retain their established selection/authority rules. Clearing a parent does not clear descendant status.

Once selection and authority permit it, clearing pending own status installs a clean successor without waiting for its eventual cause. Earlier captures retain the old outcome. Failed repair preflight/publication leaves state unchanged. Opaque managed calls still adopt private work only after successful validation; repair cannot adopt an invalid graph or roll back committed effects.

## 6. Missing-output markers

Use a real Error element when output may be missing and no established placement already carries that failure. The decisive case is an unordered producer whose failed control flow may have prevented zero, one, or many additions. A marker reports that incomplete contribution; it does not claim exactly one real value was omitted.

One failed logical contribution/operation adds at most one marker per affected Array, not one per hypothetical element or propagation step. Do not duplicate a failure already represented by the affected placements. An independent callback Error, an unused poisoned argument, a rejected stored payload, and position-only uncertainty are not reasons to add a marker.

### Marker position and ordinary Array behavior

Use the contribution's reserved logical position. For push-only entry, retain actual issued appends and put the marker for missing subsequent output within that contribution, before later parent appends. With no tighter location facts, use the captured end; tighter bounds constrain that fallback to a compatible boundary. Do not insert at a later live end or move an already established suffix.

The marker occupies one ordinary Array slot and participates in length, indexing, remapping, slicing, deletion, and replacement. Its cause/source and structural placement role survive remap copies/moves. Use a named numeric role on the logical placement/version, with ordinary payload as the default. Explicitly receiving a looked-up Error into a new payload placement keeps the Error value but creates a structurally known occurrence. The [role-transfer rule](docs/array-method-specification.md#10-sparse-data-occurrence-roles-and-queries) distinguishes that from structural copying without a registry or second marker container.

A later pop or slice can remove a marker. The earlier captured Array and any returned Error retain their own outcomes; no sticky Array flag keeps a removed marker alive as history. Repair cannot remove it, while ordinary replacement/deletion can. Array methods still follow their ordinary Error-consumption rules.

### Streaming and shape

Structural markers are not streamed as ordinary payload Errors. Sequential mode stops at the first structural obstruction; unordered mode continues with guaranteed surviving occurrences. Complete mode applies its structural failure boundary. Error queries report the actual stored marker.

A marker fallback must be included in shape/capacity proofs before exposure. Do not append a diagnostic slot to an already fixed-length output merely to report a positional failure. That is why the pure insertion example has three occurrences, not four.

No zero-sized marker, non-element marker, hidden per-Array failure ledger, or new language construct for marker removal is required.

### Open append contributions

Preserve every issued command and its required effects. Unissued commands do not become invented application values; their missing contribution is represented only by the one marker when required.

Close a contribution only when all relevant issuers, including nested entries, can issue no more commands. Failure of one callback does not close another live issuer. Bound progress using actual contributions and all permitted failure outcomes; a successful-output minimum is not guaranteed when failure can prevent those appends.

The compiler supplies affected targets and required failure information at the reserved command position. Entry itself is not mutation authority or an automatic poison scope. An unrestricted open reference that can still delete/overwrite a region prevents its publication; a push-only declaration can prove earlier occurrences final.

## 7. Compact propagation diagnostics

This section concerns actual propagated poison. An ordering guarantee deliberately absent from unordered-stream mode does not create a diagnostic failure or an Error-history entry. Ordinary propagation currently preserves the original Error. A different use site is not itself a new independent failure. Preserve causal origin while adding useful receiving-site context without a full Error and captured stack at every internal step.

Use a compact propagation record containing only the current source-error context and a direct reference to the original poison. The context carries a payload-free logical Chain identity for diagnostic grouping; do not duplicate it on the record. This is an addition to the current context contract, not a claim that today's context already contains that identity.

Bind that identity when constructing the immutable operation-specific diagnostic context. Do not write it into a shared compiler source-location table: repeated execution of one source location can involve different logical Chains. Entered views reuse the owning Chain's identity. Graph code continues to pass the resulting context opaquely.

The record must not reference the preceding propagation record, a full operation context, or a Chain/data graph. For x=someOperation(y), diagnostics can show the operation's source location alongside the original cause. Add records at meaningful source operations, not every internal field traversal. Layout, ownership, and path code keep source contexts opaque; the Error/reporting layer owns their diagnostic interpretation.

Keeping the current use site and root cause is a bounded alternative to retaining every intermediate hop. If complete propagation traces are desired, their separate retention cost must be explicit. Multiple genuinely independent causes remain distinct and require ordinary bounded collection.

When returning an aggregate:

- Group propagated failures by logical Chain and original propagated poison cause.
- Keep independently originated failures distinct under their existing cause/context/kind rules, even if a raw host Error object was reused.
- Preserve useful receiving-site context without changing causal attribution.
- Keep groups from different logical Chains separate; entered references do not manufacture new logical reporting Chains. Names and source locations alone are not sufficient identity across repeated invocations.

Retain distinct failures that contribute to the current own-path status until repair/replacement clears it; successful continued work does not erase them. Apply the same grouping to propagated occurrences without losing independent initial failures. Membership must not depend on which Promise settles first.

Aggregate grouping alone does not bound intermediate allocation or retained history. Share causal state, materialize report groups when consumed, and release spent operation records. Do not repeatedly copy a growing aggregate or retain every intermediate propagation hop. Measure long chains and fan-out against current forwarding; required storage is for current failures, live captures, and diagnostic output, not a separate command-history log.

## 8. Required integration evidence

- Equal ready, synchronous, pending, failed, and never-settling behavior within each mode. Different delivery modes intentionally have different structural failure contracts.
- [pendingA,B] issues both occurrences without a payload wait in every mode; ready poison and rejection affect only the value. Deep guards remain explicit.
- Pending source selection is not mistaken for an ordinary pending payload. No structurally uncertain occurrence reaches the body and later becomes structurally poisoned.
- Pure insertion failure: fallback [A,B,X], length three; sequential flags preserve recoverable payloads; unordered survivors have no positional Error or extra marker.
- Failed deletion count: only guaranteed survivors stream, candidate deleted/overwritten values become permanent poison, and fallback shape stays within all published guarantees.
- Failed open production: zero/one/many possible missing additions produce the declared single marker; reserved order, later appends, capacity, and nested closure remain deterministic.
- Markers survive capture/remapping and are removed through ordinary edits; no special removal API or retained history remains after supersession.
- Queries inspect captured marker/status/data outcomes without draining an iterator. Earlier snapshots remain unchanged after repair/replacement.
- Genuine path blockers remain blockers in every mode; unaffected siblings stay usable without adding whole-Array status for regional failures.
- Exact-path repair returns undefined without waiting for the payload, preserves fallback positions, and cannot recover ordinary Error data or a complete-mode root Error.
- Sort preparation/comparison failure in every mode: mutating sort retains unchanged pre-sort data under repairable own status, copying sorts return root Error without changing source, and no partial permutation/fixed suffix escapes. Verify effective flag identity, payload producers, holes, earlier captures, and repair without sorting again. Later publication failure follows ordinary rules without rollback.
- Self-modifying iteration, COW, aliases/cycles, retirement/re-entry, native isolation, and canonical metadata preserve ordering and last-use release.
- Diagnostic work and retained history remain bounded under propagation, repeated failures, and fan-out.
