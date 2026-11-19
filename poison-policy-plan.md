# Chain modes, structural failure, and repair

Selected contract for complete, sequential-stream, and out-of-order-stream Chains. Out-of-order stream is also called unordered stream in the implementation plan. This replaces the earlier blockOnPoison Boolean. The policy foundation precedes open-entry streaming; unordered occurrence delivery lands last. Production contracts and runtime behavior change at their corresponding implementation cutovers.

## 1. Policy belongs to the Chain

Select one mode per channel through a constructor argument/option, carried by its backing Chain. Out-of-order stream is the default when the argument is omitted; complete and sequential stream are explicit choices. The names below describe the contract; finalize the exported option/constants with the API. Do not retain a second blocking Boolean.

| Mode | Access and delivery | Structural failure |
| --- | --- | --- |
| [Complete](#complete-mode) | Establish that earlier work cannot still poison the captured Array before consuming it. Once permitted, ordinary element dependencies apply. | A failed mutation flags retained current data at its selected scope; ordinary access is blocked until recovery. No usable-prefix exception. |
| [Sequential stream](#sequential-stream-mode) | Deliver established occurrences in numeric order, without waiting for their payloads. | Regional fallback preserves survivors but flags lost intended positions. A certified poisoned prefix remains usable under the streaming rules. |
| [Out-of-order stream](#out-of-order-stream-mode), default | Deliver guaranteed surviving occurrences before their numeric indexes are known. | Accept deterministic fallback positions without positional poison; uncertain contents/survival still fail. A certified poisoned prefix remains usable under the streaming rules. |

All modes use one captured-layout engine and the same ownership, command ordering, and boundary rules. Entered references inherit their owning Chain's mode. A receiving Chain uses its own mode for subsequent operations; it cannot restore an ordinary Error, silently clear existing path status, or reinterpret an earlier producer's issued semantics. Modes must not depend on which consumer happens to observe settlement first or mutate shared backing storage.

All successful executions obey the same [sequential-equivalence rule](iterate-plan.md#sequential-equivalence-is-the-publication-criterion). Pending structure never selects fallback or poison. Construction mode is a fixed language/integration choice, not a compiler optimization inferred from later consumers. An unordered search implementation does not switch its source Chain to unordered mode.

### Cascada mode selection

Mode selection is resolved: the channel constructor accepts the mode, defaulting to out-of-order stream. Preserve that fixed choice through channel/Chain integration and entered references. Compiler-created expression temporaries inherit as specified below; actual receiving channels and loop-variable bindings retain their language-defined construction policy. A receiving channel's own choice never rewrites already-issued producer semantics or clears existing status. Keep the option distinct from operation context and ContextChain's mutation-access-tree configuration. Exact parameter/constant spelling is an API implementation choice, not another language-policy decision.

Do not infer failure policy from a later loop's pacing, an unordered search, or guard. Guard restores a selected region on failure; complete-mode repair exposes current retained data and preserves earlier successful commands, so those contracts are not interchangeable. The new default takes effect at the mode-API cutover. Earlier implementation stages may use explicit complete-mode fixtures/current behavior, but cannot silently substitute complete or sequential failure semantics for the advertised unordered default.

### Expression temporaries

A compiler-created holder inherits the mode of the expression/evaluation channel it carries; it is not a new language receiving channel. A controlled method result therefore carries its receiver's mode through intermediate holders. Inserting, eliding or fusing such a holder must not change failure behavior. Carry the producing mode with the expression's capture or compiler integration facts, not as one mutable policy attached to a shared Array identity. Expressions with no inherited channel use their language-defined construction policy, independently of temporary allocation.

An explicit receiving channel remains the language-level policy boundary, including its documented default. A loop binding uses that binding's language-defined mode; an incidental wrapper introduced while evaluating its source must not substitute the default. Verify a complete-mode a.slice().splice(badStart,0,x) with and without an intermediate compiler holder: both retain complete-mode failure. Repeat for the streaming modes, a selected expression branch and an explicit receiving channel with a different mode.

### Complete mode

Complete preserves atomic mutation failure and strict access to the resulting Array version. Its guarantee concerns whole-Array poison, not the absence of Errors in every element. A structurally established [pendingA,B] remains consumable without waiting for pendingA when rejection can poison only that payload.

Receiving streaming-produced oversized state preserves its data and structural Errors without creating an own-path flag merely for its size. Complete mode alone therefore does not prove an inherited length fits the ordinary Array limit. Follow the [cross-mode capacity rule](iterate-plan.md#complete-mode-receiving-an-oversized-value): existing access and true mutating no-ops differ from new copies or effective receiver successors, each of which keeps its own capacity obligation.

#### Complete access gate

Before ordinary consumption, establish that work logically preceding the access can no longer poison the captured Array version or an applicable ancestor scope. Wait while that decision remains relevant and unresolved. Propagate established poison without exposing retained data. Once the required work succeeds, or a proof removes its relevance, allow access subject to the requested shape, selection and payload dependencies. A currently clear flag alone is not a proof of safety.

Today's pending mutation already enforces this through its transition version. Preserve and extend that common mechanism; the route table below is an acceptance inventory, not a request for independent per-route health gates. New partial-layout/producer state must retain the same ordering and failure ownership, with the complete-only tracking refinement below.

| Access route | Required boundary |
| --- | --- |
| Lookup and other observations | Before handing out the Array or reading through it, including elements, length, presence and expression lookup. |
| Method calls | Before consuming the receiver, for observational, copying and mutating methods. A short-circuit includes result cannot bypass the gate. |
| Assignment or deletion inside the Array | Before the logical write through that receiver. Replacing an element need not consume its old payload, but still requires a usable Array. |
| Iteration | Before delivering the first item or reporting successful empty exhaustion. Cursor creation may precede readiness. Later steps reuse the established validity of their captured version. |
| Export and native preparation | Before exposing data, including nested Arrays consumed inside a larger exported graph and native arguments/receivers. |
| Direct method-result publication | Before handing out an apparently healthy Array, or a result whose promised effects still depend on the pending mutation. A result cannot evade the gate merely because no public lookup follows. |

Use one shared captured-Array consumption rule across path selection, mutation receiver selection, iteration and graph export. Reuse captured transition/placement state; do not add separate per-method health scans or a second scheduler. Certifying one version does not certify its successors, and ordinary payload settlement does not revoke established structural validity.

The following operations do not require the selected Array to be healthy:

- Error queries inspect captured status and relevant contents. They wait for facts needed by their answer, not for proof of success; a certain relevant failure can establish hasError=true.
- Exact-path repair and permitted whole-Array replacement/deletion keep their existing authority, ancestor, ordering and publication rules. Their selected old value may be poison.
- Internal capture, reference creation and forwarding can carry an unfinished version and its gate without consuming it. Preserve those dependencies and status through handoff; an unresolved handle is not a certified healthy Array.

Apply the gate to the operation's captured predecessor. Commands inside an entry use their private earlier-command prefix, never the enclosing future they are themselves producing. Independent preparation and command issuance may proceed; dependent observations and effects wait. Later commands create successor versions and cannot invalidate an earlier capture. Selecting a parent object does not deep-validate every nested Array; consumption of a nested Array applies its own gate.

For [A,B,C,D]; a!.splice(2,pendingCount,X), a later lookup of index 0, includes(A), assignment to index 0, and iteration all wait while count failure could poison the Array, even though the splice cannot change A. Success permits their ordinary behavior; relevant failure blocks them. This differs from [pendingA,B] with no such structural operation.

#### Tracking complete-mode validity

This tracking supplies the complete access gate only. It does not impose that gate on either streaming mode. Validity means that the captured Array and applicable ancestor scopes are clear and no remaining earlier work can poison them. It is separate from exact length, occurrence selection, payload readiness and operation-result completion; those keep their own dependencies.

Determine relevance from an operation's specified failure ownership, not from whether its arguments currently contain poison or whether its method name sounds structural:

| Unfinished work | Relevance to complete-mode Array validity |
| --- | --- |
| Ordinary stored payload delivery | Rejection poisons that value only. It adds no Array-wide dependency by itself, including a pushed payload after required selection, capacity and publication checks. A later operation that consumes it as a structural input has its own dependencies. |
| Mutation control, target selection, validation or required fallible publication | Keep the dependency while failure could poison this Array or an applicable ancestor. Successful argument delivery can still reveal invalid data, such as an invalid length. Respect an explicitly broader selected scope. |
| Required sort preparation/comparison | Keep the dependency until the specified whole-Array failure is excluded; healthy supplied arguments alone do not exclude a later comparison failure. |
| Observation/copy result or independent callback result | Failure belongs to that result, not automatically to its source Array. A new Array result must establish its own required validity before healthy handoff. |
| Open producer or nested issuer | Account for possible future commands and producer/control-flow failure that belong to this captured output. Zero currently pending commands does not prove the output safe. |

Use the existing captured placement/transition state and producer closure facts:

1. At issuance, establish the relevant failure dependencies and their owning scopes before suspension. A still-unselected target retains the necessary ancestor protection until selection proves the narrower footprint. Later commands cannot become prerequisites of this capture.
2. Discharge a dependency when required validation/fallible work completes or a supported proof makes its failure irrelevant to this captured version. Preserve ordinary effects and result dependencies that remain. An ordered repair or replacement is evaluated through its successor state; do not retain a sticky record that some predecessor once failed.
3. Keep the possible-issuance dependency while a relevant producer can still introduce Array/ancestor failure. Closing outer issuance does not close nested issuers or settle already-issued work. Earlier release requires a trusted proof covering all remaining commands and control-flow failure, including capacity and failure fallbacks. Push-only capability alone is insufficient: future pushes can overflow. Without that proof, wait for the relevant issuers to close and their remaining failure decisions to settle.
4. Publish the resulting validity decision for the captured version and reuse it at every complete-mode consumption boundary where the captured version and scope proof apply. It is not a live Array-identity-wide flag; a different ancestor path has its own prerequisites. Established failure blocks access; established validity is not revoked by later payload delivery. Successor mutations and repair have their own captured state. Release spent dependencies at their last use.

This is a projection of existing dependency and status facts, not another scheduler, a global risk counter, completed-command history or a deep hasError scan. Unrelated work does not delay validity unless its declared failure scope actually covers the Array or an applicable ancestor. Full producer completion is sufficient when it resolves all those facts, but is not required when the remaining work is already proved incapable of such failure.

Once validity is established, complete-mode iteration may consume established occurrences while unrelated payloads or layout facts remain pending. Required mutation publication and selection proofs still apply. Thus complete does not mean fully materialized or deeply poison-free. It does mean that the captured source cannot first acquire whole-Array poison after a successful item or empty completion has been exposed. Existing fatal execution handling remains separate from recoverable Array poison.

#### Failure, recovery and producers

A failed mutation commits no candidate data changes. It flags retained current data at the ordinary selected scope; earlier successful commands remain committed. Required fallible preparation may have run. An independent Error result from a successful mutation and ordinary stored-payload rejection do not trigger this rule. A failed copying call returns ordinary result-root poison and preserves its source.

Repair clears the selected status and exposes retained current data; it does not rerun the failed command, restore a predecessor, or roll back earlier committed work. A streaming prefix-poison state received by a complete Chain retains its captured status and allowance, but the allowance does not bypass complete-mode consumption.

An earlier open producer that can still introduce whole-Array poison keeps outside consumption behind this gate, even if it only appends and its existing prefix cannot move. Apply the [validity tracking rule](#tracking-complete-mode-validity), including remaining-issuance proofs and nested closure. Validate individual appends incrementally; complete does not turn the whole producer into one atomic mutation or undo earlier successful appends after failure. Its failed output is inaccessible until recovery. No complete-mode prefix streaming is promised through that unresolved risk.

Completion must not depend on an outside consumer that is waiting for this same gate. Use a streaming mode for a pipeline requiring producer/consumer overlap; do not introduce a circular wait or silently change mode.

### Sequential-stream mode

Deliver the structurally established prefix in numeric order. Membership, intended position and final payload source must be known before delivery; a payload may remain pending or ordinary Error data. Ordinary access can use independently established regions beyond an iterator's obstruction when no applicable path blocker prevents it.

After actual structural failure, retain guaranteed survivors in the deterministic fallback layout and attach own-path status where their intended position is lost. Uncertain contents or survival become permanent structural Error data; missing output uses its declared marker. Iteration stops at its first structural obstruction and reports failure, rather than claiming successful exhaustion. Repair can expose retained positional survivors at their fallback positions, but cannot reconstruct discarded candidates.

The [certified poisoned-prefix state](#poisoned-array-with-a-usable-prefix) is available to this mode. Its prefix can be iterated repeatedly and edited within its allowed footprint while the Array remains poisoned. Ordinary ancestor blockers remain blockers.

#### Published prefix

A published sequential occurrence has established membership, intended numeric position, and final captured payload source, or is a known hole yielding undefined. The payload itself may be pending or ordinary poison. A length lower bound establishes possible progress but does not by itself establish this selection.

A prior mutation that can still delete or overwrite an occurrence prevents its publication. A later command uses a successor version and cannot change an already captured occurrence. Beyond the required bounded rules, conservative delay is permitted; premature publication is not.

The clean-prefix size is structural, not a count of fulfilled or non-poison payloads. Keep it as a captured layout fact and expose it in relevant failure diagnostics. It is not the number of bodies that happened to start. Do not mutate a shared causal Error to attach different Arrays' prefix sizes or manufacture an Array Error merely to carry the number.

### Out-of-order-stream mode

Deliver each guaranteed surviving occurrence once its final payload source is established, without waiting for its numeric index or payload value. An index future follows the captured layout. Occurrence discovery changes availability only; Array order, conflicting effects and command-buffer branch order remain logical issuance order.

After a position-only failure, preserve survivors at deterministic fallback positions without positional flags, an extra marker, or Array-path poison. Uncertain contents or survival still become structural Error data, and missing output still needs its declared marker. Deliver independent survivors and report remaining structural failure at terminal completion; unavailable or skipped occurrences cannot prove healthy exhaustion.

This mode also supports the [certified poisoned-prefix state](#poisoned-array-with-a-usable-prefix). When that particular Array state applies, every iterator is restricted to its certified prefix; it does not authorize delivering later islands. Ordinary regional failures retain their independent-survivor behavior. Changing delivery order never bypasses an ordinary path blocker or a required capacity/authority proof.

### Whole-Array failure in streaming modes

Neither streaming mode applies complete-mode whole-Array poisoning to an ordinary regional control failure. Such a failure uses the specified local Error/status/fallback or missing-output marker. Pending selection or layout is not poison: the affected region waits while ordinary successful outcomes still differ, even if that region is the whole Array. Actual failure has its declared causal footprint and cannot retract already-published facts. A blanket category of "genuine scope failures" is not sufficient to specify that footprint.

The remaining boundaries must be distinguished explicitly:

| Boundary | Current rule and review status |
| --- | --- |
| Required sorting failure | Selected whole-Array exception; retain the sort publication barrier. Absence of a comparator alone does not prove default-key preparation infallible. |
| Capacity | The [poisoned-tail revision](iterate-plan.md#streaming-capacity-revision) replaces streaming owning-path overflow with local structural Error positions and a capped fallback length. Finite copying operations use the same rule; capacity alone is no longer a streaming result-root prerequisite. |
| Invalid/failed length assignment or failed general mutation-key selection | The current plan retains own-path failure. Its streaming fallback still needs explicit review; do not infer permission to gate an unrelated prefix merely from this label. A pending resize that can truncate to zero does genuinely leave every old occurrence's survival unresolved. |
| Invalid with index | The current method contract returns result-root Error. This leaves the source unchanged, but a result that may fail at its root cannot expose a partial Array first. Removing this barrier requires choosing an Array-valued failure fallback. |
| concat part-root classification; flat discovery or unlimited-depth cycle failure | The current method specification treats these as whole-result prerequisites. They can block otherwise independent output and must be evaluated for contribution-local failure/markers. These are explicit error-contract choices, not an inherent requirement of partial layouts. |
| Failure to select an Array, an already poisoned ancestor, or missing mutation authority | No usable selected Array or authorized mutation exists at that boundary. This is different from a late failure of one region of an already selected controlled Array. Establish only the required selection/authority facts. |
| Opaque native mutation | Its declared scope may be wholly affected; without a narrower effect contract, successor data genuinely remains unresolved until the call establishes it. Preserve the native failure/authority contract. Do not transfer this limitation to controlled operations with known regional footprints. |

The non-capacity controlled-method failure revisions above are not yet fully selected. Keep complete mode separate and do not claim that the existing plan already eliminates all global streaming barriers. A failed observation or copy result does not poison its source. Supported input preparation failure before an Array exists likewise does not invalidate an independently captured source Array; placement-local failure remains local where structure is known.

The publication guarantee is stronger than checking the current flag: settlement of earlier work must not invalidate an occurrence or observable fact already published from that captured version. An operation that can still publish a blocking Array-own failure must settle that prerequisite before exposing affected successor data, unless its specified streaming failure outcome certifies continued access to those data. Apply the same rule to unchanged regions when that blocker would cover them. Required sort success is one such barrier; streaming overflow instead preserves unaffected data under the regional poisoned-tail rule. Canonical managed storage must not introduce a later backing-write veto over published facts.

These are operation-specific failure dependencies and prefix guarantees, not complete mode's blanket access policy. Ordinary stored-payload rejection remains local. Later source mutations create successor captures and cannot poison an earlier iterator's capture. Root poison from a failed copying operation belongs to its unexposed result, not its source Array. Failure of a consuming loop separately follows its declared effect targets; preserving source-prefix access does not certify that every loop output is healthy.

### Payloads are independent of structural publication

For [pendingA,B], both occurrences can be issued without awaiting pendingA in every mode. Its rejection poisons only that payload, not the Array, other elements, or the structural prefix. Ready payload poison behaves identically; ordinary Error items remain deliverable.

“Stream only healthy elements” means structurally valid occurrences, not poison-free payloads or fully resolved descendant graphs. Do not run hasError on each element as a delivery gate. Complete mode applies its access gate and required structural dependencies, not a wait for every stored Promise. An earlier sort or another structural operation may still genuinely need a value to determine its layout.

Track payload failure separately from structural uncertainty at a placement. A final-slot Promise whose source selection can still fail structurally is not an ordinary pending payload. Structural markers/failed selections must remain distinguishable through remapping and materialization without guessing from arrival time, Error identity, or message.

### Copy-producing calls

All nine mutating Array method names called without ! return a transformed copy and preserve the source. With !, their direct result remains the JavaScript method result. The copying call uses its source Chain's mode: complete applies its access gate and result-validity prerequisites; sequential/unordered can hand off a valid partial copy under their regional failure rules.

An exposed copy's root cannot later become a call Error or retroactive path flag. Required whole-result validity, including with index validity, is established before handoff in every mode. Complete-mode capacity belongs to that gate; streaming capacity uses regional tail Error data. Sorting additionally requires established ordering before result access, as specified below. Other position-only failures retain the mode's ordinary fallback. See the [full result boundary](docs/array-method-specification.md#1-one-operation-separate-outcomes).

### Sorting requires order

Sorting uses the [normative sort failure contract](iterate-plan.md#13-selected-decisions). It follows ordinary complete-mode mutation failure and overrides streaming regional/position-only recovery. That section owns the mutation/copy distinction, publication prerequisites, retained data, repair, identity, and later publication-failure boundary. The [method specification](docs/array-method-specification.md#7-sort-and-tosorted) defines preparation and comparison work.

## 2. Failure categories and fallback layouts

The regional representations and fallbacks in this section belong to the two streaming modes. [Complete mode](#complete-mode) instead retains current data under blocking status after failed mutation and returns root Error for a failed copy.

| Failure | Streaming-mode representation |
| --- | --- |
| Ordinary payload rejection | Ordinary poison at the established value placement; no structural marker or Array-path poison. |
| Guaranteed survivor with lost intended position | Preserve its payload in the fallback layout. Sequential mode adds own-path status to that occurrence; unordered mode accepts the ordering and leaves it unpoisoned. |
| Contents or survival cannot be established | Permanent structural poison at the affected fallback output positions. Repair cannot recover the discarded candidate values. Do not stream these positions. |
| Output may be missing and no existing placement represents that failure | An ordinary one-element structural Error marker at the failed contribution's ordered position. |
| A genuine path/scope failure outside regional handling | Ordinary own-path poison blocks traversal unless the selected Array state explicitly certifies a usable prefix. That allowance permits only prefix-compatible work; other blockers still apply. |
| Independent observation/callback result failure | Fail that result only; it does not automatically poison entered Arrays. |

Irrelevant arguments and proved no-effect work introduce no failure in any mode.

These outcomes are selected by failure ownership, not interchangeable representations chosen by an implementation. Missing output in a capacity-safe append contribution uses its structural marker; it does not additionally poison the source Array or create a poisoned-prefix state. Genuine Array-own failure uses own status and can retain the certified streaming prefix. Streaming overflow instead uses structural Error positions and does not add an Array-own flag. Loop-failure propagation targets the consumer's declared effect chains at the loop position; it is a separate consequence, not another representation stored on the source. Preserve the causal Error without automatically applying both marker and own flag to the same target contribution.

### Pure insertion with a failed position

For a=[A,B] followed by a!.splice(P,0,X), all three occurrences survive. If P fails, append X at the end of that operation's captured predecessor:

    fallback: [A,B,X]
    sequential: [pathPoison(A),pathPoison(B),pathPoison(X)]
    unordered: [A,B,X]

Here pathPoison(value) describes existing own-path status with retained payload, not a new wrapper type. The sequential prefix is zero because any of these intended positions could differ. Unordered mode streams the survivors and has no positional Error to report on this Array. Do not add a fourth element: no output is missing, and the one inserted argument already fixes length at three. The call's separate result retains its own declared dependencies.

### Failed deletion count

For a=[A,B,C] followed by a!.splice(1,P), the streaming fallback retains candidate slots as [A,Error,Error]. A is unchanged; B/C may have been deleted, so they become permanent structural poison. Both streams can deliver A. Repair does not resurrect B/C.

Likewise, [A,B,C,D] followed by a!.splice(2,P,"X") retains [A,B,X,Error,Error] under this fallback: the inserted X is known at index 2, while C/D have uncertain survival. No extra missing-output marker is needed for deletion uncertainty.

This paragraph applies after P has actually failed and its relevance is established. While P is pending, retain the candidate dependencies: includes(D) waits unless membership or a sufficient alternative match is already proved. It must not compare a speculative Error placeholder, return false from the currently published prefix, or report Error merely because D's survival is unknown. Successful settlement produces exactly the sequential result. The [search contract](iterate-plan.md#search-demand-and-completion) separates membership, comparison and completion. Only an actually failed prerequisite still required by the result can contribute its cause; ordinary payload comparison remains distinct.

These are explicit failure fallbacks, not claims about which successful argument value was intended. Complete the corresponding rules for every method family before shipping it. Do not create one Error slot per candidate source if that contradicts a required output count.

### Ordered and irreversible fallback

Apply fallback at the failed operation's logical position, never by appending to the live Array when rejection arrives. After splice(P,0,X) followed by push(Y), the insertion fallback is [A,B,X,Y], not [A,B,Y,X].

A later successful append uses the predecessor's actual settled/fallback layout. Unknown earlier width makes its index pending, not position-poisoned merely because some counterfactual successful predecessor had a different length. Retain flags already carried by earlier occurrences; do not spread them to freshly appended Y. This follows the all-ready failed-operation-then-append reference, and keeps subsequent end-relative selection of Y usable where the ordinary mode/path prerequisites permit it.

Choose fallback only after a relevant structural failure is established. Pending controls remain pending. Ready failure and delayed rejection produce the same facts. Preserve all earlier published values, positions, length/bound facts, aliases, and effects. Publication proofs must include the failure fallback; if it could invalidate a fact, that fact is not publishable yet.

With no tighter position facts, an unknown-position insertion uses the captured end as its fallback. Tighter captured bounds constrain that choice: use the latest allowed boundary, preserving any established prefix/suffix positions. A known insertion point or reserved producer region keeps its own location. The [bounded splice rule](docs/array-iteration-technical-analysis.md#5-a-bounded-splice-fallback) specifies this extension and its limits. Authority and mode-specific capacity still apply. Complete fallback cannot exceed Array capacity; streaming fallback applies the poisoned-tail transition and maximum logical count.

### Poisoned Array with a usable prefix

This is a supported state for the two streaming modes only: the Array is poisoned and has a certified usable prefix [0,p). Its captured allowance permits access to those established occurrences. Complete mode never uses this allowance to bypass its access gate. p counts logical positions, including healthy holes, not fulfilled payloads or already-delivered items. Payload availability and ordinary payload poison keep their existing rules. isError/hasError remains true because the Array is poisoned, without inspecting or consuming its prefix.

The common selected-Array boundary carries the captured prefix allowance to reads, controlled operations, and iteration. It is not a general bypass of ordinary poisoned paths: an earlier ancestor blocker or an Error value with no retained Array/prefix still blocks access. Mode, physical representation, or arrival order cannot manufacture the allowance. An append-only producer can certify its committed prefix; an unrestricted producer that can still overwrite it cannot.

Derive the boundary from the failed operation/contribution's logical position and specified footprint, never from how many items happened to arrive before rejection. Earlier reserved contributions can still determine the prefix's extent. Keep those dependencies, stream their established positions, and do not report the terminal failure before the captured prefix boundary is established. A known failure can make isError true while a particular prefix selection still legitimately waits. Required prefix proof and operation completion must not depend on draining the same paced iterator or on later body work.

For an unordered consumer, a future prefix boundary must include every occurrence whose accessibility was already guaranteed in that captured version. If a possible earlier Array-own failure could put a later item outside the usable prefix, that item is not yet publishable; retain that specific survival/capacity dependency. Ordinary failure of contribution 3 instead inserts its marker and preserves independent contributions 4 and 5. Do not convert it to prefix poison that hides them. This is a per-occurrence publication proof, not the complete-mode pre-access gate. Reserving a diagnostic slot must not lower the legal maximum Array length or silently absorb later issued contributions; overflow uses its separate regional tail contract.

Every iterator of this captured state enumerates only its prefix. Subsequent iterators can enumerate that prefix again; enumeration neither consumes nor repairs the Array's poison. After delivering the prefix, report its failure through the terminal iterator boundary so the loop cannot appear wholly successful. Cascada uses its existing loop-poison mechanism to poison all variables mutated by the loop, including when that poison becomes known late. Publish that failure at its logical position relative to the prefix bodies, not immediately ahead of them merely because the cause was ready. Do not implement a second loop-poison mechanism in the kernel.

Reuse captured structural/own-status facts and Cascada's declared failure targets and break/return channels, not a deep payload scan. [Ordinary control-channel lowering](iterate-plan.md#compiler-ordering-and-loop-failure) guards later code at every affected scope, including inside a loop and after it when return is nested in that loop. Body suppression does not itself close the cursor; continuing enumeration retains normal terminal failure handling. A return-channel write or cursor closure cannot settle separately required loop work. No new return policy or post-close subscription is implied. A terminal step reports the same causal failure for ordinary iterator consumers, without manufacturing another Error or cancelling an issued step. Complete-mode validity tracking adds no pre-access gate or mandatory whole-producer wait to these streaming rules.

Successful operations confined to the prefix remain available and preserve the Array's poison:

| Operation | Prefix behavior |
| --- | --- |
| Read or assign an established index below p | Ordinary captured value/presence rules; assignment does not read the overwritten payload. |
| fill or copyWithin confined to the prefix | Ordinary writes, holes, and pre-write source capture. All consumed source and destination positions must be proved within the usable region. |
| Remove k positions within the prefix, such as shift or bounded splice | Move the boundary to p-k; inserted positions add their known count. Preserve the inaccessible remainder and its failure. |
| unshift k positions | Prepend them and move the boundary to p+k, subject to ordinary capacity/authority checks. |
| delete an indexed property below p | Preserve a healthy hole and the positional boundary, under existing Array semantics. Removal of positions is distinct from JavaScript delete. |
| push | Block: appending requires the unavailable end; it is not insertion at an explicitly selected prefix boundary. |
| A bounded extraction wholly within the prefix | May produce a separate healthy Array, except for ordinary contained payload poison. The source remains poisoned. |

Unknown targets or ranges wait until their required prefix membership is proved. Do not reinterpret a whole-Array operation as a prefix-only operation: reverse, sort, end-relative access, or a search's negative result still require every fact their actual operation consumes. A definite matching prefix item can prove includes=true; unresolved surviving candidates require waiting, and an actually poisoned required remainder produces its causal failure. Prefix length is not a replacement for unknown total Array length. Known independent shape facts remain usable, but operations needing the unavailable end cannot guess it. Mode-specific capacity remains independent of prefix compatibility; a streaming operation can create a poisoned tail but cannot publish healthy values beyond the successful Array limit.

Ordinary prefix edits and repeated iteration do not clear the Array flag. Explicit repair keeps the status-only contract: it exposes retained current data, never invents missing values, reconstructs discarded candidates, cancels other producers, or restarts old iterators. Remaining ordinary payload/structural Errors keep their own status. A copy of the whole state preserves the poison and prefix allowance; full export must not silently return only the prefix. Earlier captures keep their own p, data and failure through later prefix edits or repair.

The allowance comes from certified, stable output under the streaming failure contract. The [review](docs/iterate-sequential-equivalence-review.md#streaming-producer-failure-and-usable-prefix) records boundary and fail-fast details; this state does not turn every regional streaming Error into poison of all later independent occurrences.

## 3. Access and extraction

Path-poisoned elements and ordinary poisoned ancestors behave as poison in every mode. A Chain's streaming mode alone cannot bypass a flag. In streaming modes, the explicit [usable-prefix state](#poisoned-array-with-a-usable-prefix) certifies the region that remains accessible despite Array poison; neither iteration nor mutation can use it to reach the unavailable remainder. Permitted final replacement/deletion and exact-path repair retain their normal rules.

In streaming modes, healthy siblings remain accessible because regional Array failure does not automatically poison the Array path. Sequential iteration can stop at an uncertain region while an ordinary query accesses another independently established region. Unordered mode does not create positional flags that would then require a bypass.

Do not propagate an unrelated or merely possible ancestor failure into extracted healthy data. Actual earlier writes that might select, overwrite, or delete the target remain dependencies. A genuine own/ancestor blocker is not an irrelevant dependency. Complete-mode extraction first passes the shared access gate, even when the selected data would be unchanged by the pending operation.

### Containers and contained status

Capture and assignment preserve nested status, markers, and structural facts already in the selected graph. The [handoff proof](iterate-plan.md#captured-state-across-handoff) must demonstrate transfer of pending root status and prefix allowance as well as payload lifetime; a raw value lease alone is insufficient. They do not recursively repair it. An extracted ordinary Error stays Error data. Receiving a value under another mode does not clear existing flags, replay old commands, or rebuild discarded values.

Full export and native preparation apply the complete gate to every complete-mode Array they consume, including nested Arrays, then consume the required graph and report actual payload poison, structural poison, markers, and path blockers. They do not silently omit marker elements or export through a blocked path. Preserve native authority, isolation, effect completion, canonical assembly, and the ready-only mutable-external snapshot contract.

## 4. Error queries

| Operation | Meaning |
| --- | --- |
| isPoisoned(chain, path) | Shallow query: the selected value/path itself is poison, including applicable path status. No descendant scan. |
| hasError(chain, path) | Deep query over relevant contents, structural poison, markers, and path status. Cascada's x is error uses this operation. |
| getErrors(chain, path) | Complete captured relevant failure collection, including marker/path causes. |
| isPoisonError(value) | Existing predicate for an available language PoisonError; no path query. |
| isPoisonedValue(value) | Existing predicate for the expression-boundary failure wrapper; no path query. |

A streaming Array containing element flags or markers has hasError=true without being root poison. In unordered mode, a position-only fallback with otherwise healthy data has no Error merely because the requested order was unavailable. Keep no duplicate Array-level Error log to remember that discarded ordering requirement.

Healthy native JavaScript Errors remain ordinary data. A clean absent final placement reads as undefined and is not poisoned. An absent slot carrying own status is still observable as poisoned; status does not create a present data property. A poisoned child does not make its healthy parent shallowly poisoned. Registered external metadata retains captured own/ancestor status and native-content opacity. Fatal failures retain their ordinary behavior.

### Earlier open entries

Queries capture logical versions, not physical flags sampled at a convenient time. An earlier open entry may still add data, markers, or status, or repair/replace a current failure. Neither a currently empty Array nor a provisional failure determines its final captured query answer.

hasError can return true from a certain relevant failure; false needs the complete relevant error-producing frontier. getErrors completes required collection. isPoisoned waits for required selected root/status outcomes, without awaiting payloads that can poison only descendants.

Use entry publication, not iterator draining, to establish these dependencies. Queries inside an entry consume its private command prefix rather than its own enclosing future. Later repairs and commands do not change earlier query snapshots. An explicit deep no-error guard before a loop still waits for payload health when needed; that is the caller's choice, not the iterator's default.

## 5. Repair clears status

[Repair](repair-simplification-plan.md) clears exact selected own-path status and returns undefined after successful publication. It preserves current data, fallback placement, pending versions, local poison, and committed writes.

This includes a sequential occurrence whose payload survives at a fallback index. Repair exposes that retained payload there; it neither discovers the intended position nor reorders the Array. It does not resume an old captured iterator. Later captures see the repaired successor.

Ordinary payload poison, permanent structural poison, and missing-output markers are Error data rather than repairable flags. Replacement, overwrite, deletion, or ordinary structural edits can remove their placements; status clearing does not. A complete-mode failed mutation has retained current data and a repairable flag; a failed copying-result Error has no hidden Array. Sort follows its [normative contract](iterate-plan.md#13-selected-decisions).

For genuine own-path status, eligibility does not depend on an explicit-! origin. Failed computed-key writes, selected scope failures, and canonical external own-state failure retain their established selection/authority rules. Clearing a parent does not clear descendant status.

Once selection and authority permit it, clearing pending own status installs a clean successor without waiting for its eventual cause. Earlier captures retain the old outcome. Failed repair preflight/publication leaves state unchanged. Opaque managed calls still adopt private work only after successful validation; repair cannot adopt an invalid graph or roll back committed effects.

## 6. Missing-output markers

In streaming modes, use a real Error element when output may be missing and no established placement already carries that failure. The decisive case is an unordered producer whose failed control flow may have prevented zero, one, or many additions. A marker reports that incomplete contribution; it does not claim exactly one real value was omitted.

One failed logical contribution/operation adds at most one marker per affected Array, not one per hypothetical element or propagation step. Do not duplicate a failure already represented by the affected placements. An independent callback Error, an unused poisoned argument, a rejected stored payload, and position-only uncertainty are not reasons to add a marker.

### Marker position and ordinary Array behavior

Use the contribution's reserved logical position. For push-only entry, retain actual issued appends and put the marker for missing subsequent output within that contribution, before later parent appends. With no tighter location facts, use the captured end; tighter bounds constrain that fallback to a compatible boundary. Do not insert at a later live end or move an already established suffix.

The marker occupies one ordinary Array slot and participates in length, indexing, remapping, slicing, deletion, and replacement. Its cause/source and structural placement role survive remap copies/moves. Use a named numeric role on the logical placement/version, with ordinary payload as the default. Explicitly receiving a looked-up Error into a new payload placement keeps the Error value but creates a structurally known occurrence. The [role-transfer rule](docs/array-method-specification.md#10-sparse-data-occurrence-roles-and-queries) distinguishes that from structural copying without a registry or second marker container.

A later pop or slice can remove a marker where the ordinary regional rules permit that operation. The earlier captured Array and any returned Error retain their own outcomes; no sticky Array flag keeps a removed marker alive as history. Repair cannot remove it, while ordinary replacement/deletion can. A required structural selection failure is not ordinary comparable payload data and cannot supply healthy negative search evidence. No pending selection is a marker. The separately flagged prefix-poison state retains its own restrictions and repair rule.

### Streaming and shape

Structural markers are not streamed as ordinary payload Errors. Sequential mode stops at the first structural obstruction; unordered mode delivers independent guaranteed survivors and then rejects its terminal step with remaining structural poison. It cannot silently report successful exhaustion. Genuine path blockers stop delivery, and ordinary pending/poisoned payloads remain item data. Complete mode applies its structural failure boundary. Error queries report the actual stored marker.

A marker fallback must fit its selected contribution. Do not append a diagnostic slot to an already fixed-length output merely to report a positional failure. That is why the pure insertion example has three occurrences, not four. Open push-only production validates issued appends incrementally rather than awaiting an upper bound on every future command. Actual overflow uses the [mode-specific capacity boundary](iterate-plan.md#capacity-by-mode). Streams represent excess logical positions with compressed structural Error; no huge traversal is required merely to record or query poison. Explicit prefix iteration retains its normal cost. Earlier completed results and handed-off values are not retracted.

No zero-sized marker, non-element marker, hidden per-Array failure ledger, or new language construct for marker removal is required.

### Open append contributions

Preserve every issued command and its required effects. Unissued commands do not become invented application values; their missing contribution is represented only by the one marker when required.

Close a contribution only when all relevant issuers, including nested entries, can issue no more commands. Failure of one callback does not close another live issuer. Bound progress using actual contributions and all permitted failure outcomes; a successful-output minimum is not guaranteed when failure can prevent those appends.

The compiler supplies affected targets and required failure information at the reserved command position. Entry itself is not mutation authority or an automatic poison scope. An unrestricted open reference that can still delete/overwrite a region prevents its publication; a push-only declaration can prove earlier occurrences final.

## 7. Compact propagation diagnostics

Preserve existing immutable source contexts, causal Error attribution, poison-by-reference propagation, and collection deduplication. An absent ordering guarantee in unordered mode creates no extra diagnostic failure. A different consumer or physical representation is not a new cause. Do not add Chain identities to operation contexts, per-hop propagation records, or a reporting history as prerequisites of iteration.

Collection follows captured output membership and structural failure state, not every retained candidate or earlier failed command. Release spent traversal and aggregation state. Any future diagnostic redesign belongs to a separate contract revision; it must not change values, failure presence, context reuse, or settlement-order determinism here.

## 8. Required integration evidence

- Strict complete gate on lookup, length/presence, observational and mutating calls, indexed writes/deletion, iteration including empty completion, direct result delivery, export and nested native preparation. Include an unchanged prefix behind a pending whole-Array failure, early success/irrelevance proofs, and complete consumption of a received streaming prefix-poison state.
- Complete validity tracking distinguishes ordinary payload rejection and independent result failure from required controls, invalid healthy inputs, comparison/publication failure and applicable ancestor scope. Cover zero pending commands with an open issuer, closed outer issuance with an open child, proved safe remaining work with pending payload/layout, and an ordered repair/replacement. Compare ready/deferred outcomes; no later source-own failure may invalidate a successfully exposed complete-mode step. The two streaming modes retain their own prefix and loop-failure rules.
- Complete recovery/query exceptions and internal reference capture preserve authority and dependencies without requiring a healthy selected payload. Private producer commands never wait on their own enclosing output, and later successors do not invalidate earlier captures.
- Equal ready, synchronous, pending, failed, and never-settling behavior within each mode. Different delivery modes intentionally have different structural failure contracts.
- [pendingA,B] issues both occurrences without a payload wait in every mode; ready poison and rejection affect only the value. Deep guards remain explicit.
- Pending source selection is not mistaken for an ordinary pending payload. No structurally uncertain occurrence reaches the body and later becomes structurally poisoned.
- Pure insertion failure: fallback [A,B,X], length three; sequential flags preserve recoverable payloads; unordered survivors have no positional Error or extra marker.
- Failed deletion count: only guaranteed survivors stream, candidate deleted/overwritten values become permanent poison, and fallback shape stays within all published guarantees.
- Failed open streaming production: zero/one/many possible missing additions produce the declared single marker; reserved order, later appends, capacity, and nested closure remain deterministic.
- Markers survive capture/remapping and are removed through ordinary edits; no special removal API or retained history remains after supersession.
- Queries inspect captured marker/status/data outcomes without draining an iterator. Earlier snapshots remain unchanged after repair/replacement.
- Genuine path blockers remain blockers; only the two streaming modes can consume a certified poisoned prefix. Complete mode reports that Array's poison before any ordinary access. Unaffected siblings remain usable under regional failure.
- Exact-path repair returns undefined without waiting for the payload, preserves fallback positions, clears complete-mode failed mutation status over unchanged data, and cannot recover ordinary Error data or a failed copying result.
- Sort preparation/comparison failure in every mode: mutating sort retains unchanged pre-sort data under repairable own status, copying sorts return root Error without changing source, and no partial permutation/fixed suffix escapes. Verify effective flag identity, payload producers, holes, earlier captures, and repair without sorting again. Later publication failure follows ordinary rules without rollback.
- Self-modifying iteration, COW, aliases/cycles, retirement/re-entry, native isolation, and canonical metadata preserve ordering and last-use release.
- Diagnostic work and retained history remain bounded under propagation, repeated failures, and fan-out.
