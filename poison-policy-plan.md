# Chain modes, structural failure, and repair

Selected contract for complete, sequential-stream, and out-of-order-stream Chains. Out-of-order stream is also called unordered stream in the implementation plan. This replaces the earlier blockOnPoison Boolean. The policy foundation precedes open-entry streaming; unordered occurrence delivery lands last. Production contracts and runtime behavior change at their corresponding implementation cutovers.

## 1. Policy belongs to the Chain

Select one mode per channel through a constructor argument/option, carried by its backing Chain. Out-of-order stream is the default when the argument is omitted; complete and sequential stream are explicit choices. The [public constructors and constants](docs/integration.md) implement this selection in the kernel. Do not retain a second blocking Boolean.

| Mode | Access and delivery | Structural failure |
| --- | --- | --- |
| [Complete](#complete-mode) | Establish that earlier work cannot still poison the captured Array before consuming it. Once permitted, ordinary element dependencies apply. | A failed mutation flags retained data at its selected scope. Ordinary access to that version reports its blocker. |
| [Sequential stream](#sequential-stream-mode) | Deliver established occurrences in numeric order, without waiting for their payloads. | Regional fallback preserves survivors but flags lost intended positions. Whole-Array failure blocks every position of that capture. |
| [Out-of-order stream](#out-of-order-stream-mode), default | Deliver guaranteed surviving occurrences before their numeric indexes are known. | Accept deterministic fallback positions without positional poison; uncertain contents/survival still fail. Whole-Array failure blocks every position of that capture. |

All modes use one captured-layout engine and the same ownership, command ordering, and boundary rules. Entered references inherit their owning Chain's mode. A receiving Chain uses its own mode for subsequent operations; it cannot restore an ordinary Error, silently clear existing path status, or reinterpret an earlier producer's issued semantics. Modes must not depend on which consumer happens to observe settlement first or mutate shared backing storage.

Each mode must match its all-ready sequential execution for the same program, inputs and host outcomes, including failures, intermediate observations, external effects and state exposed by repair. Settlement order cannot change a result. The [maximum logical count](iterate-plan.md#maximum-logical-count) has a deterministic fallback at actual overflow. The permitted [diagnostic variations](docs/data-limitations.md#deterministic-error-reporting) cannot change the presence of failure, accessible data, or which commands run.

Pending structure never selects fallback or poison. Construction mode is a fixed language/integration choice, not a compiler optimization inferred from later consumers. An unordered search implementation does not switch its source Chain to unordered mode.

### Cascada mode selection

Mode selection is resolved: the channel constructor accepts the mode, defaulting to out-of-order stream. Preserve that fixed choice through channel/Chain integration and entered references. Compiler-created expression temporaries inherit as specified below; actual receiving channels and loop-variable bindings retain their language-defined construction policy. A receiving channel's own choice never rewrites already-issued producer semantics or clears existing status. Keep the option distinct from operation context and ContextChain's mutation-access-tree configuration. Use the existing kernel mode constants at the embedding boundary.

Do not infer failure policy from a later loop's pacing, an unordered search, or guard. Guard restores a selected region on failure; complete-mode repair exposes current retained data and preserves earlier successful commands, so those contracts are not interchangeable. The kernel default is already in effect. The embedding enables it at the compiled-loop cutover. Earlier implementation stages may use explicit complete-mode fixtures/current behavior, but cannot silently substitute complete or sequential failure semantics for the advertised unordered default.

### Expression temporaries

A compiler-created holder inherits the mode of the expression/evaluation channel it carries; it is not a new language receiving channel. A controlled method result therefore carries its receiver's mode through intermediate holders. Transfer the expression's captured placement into the holder before raw extraction. Eliding the holder passes that same capture, so both paths preserve pending own status, validity and failure behavior. Carry the producing mode with the expression's capture or compiler integration facts, not as one mutable policy attached to a shared Array identity. Expressions with no inherited channel use their language-defined construction policy, independently of temporary allocation.

An explicit receiving channel remains the language-level policy boundary, including its documented default. A loop binding uses that binding's language-defined mode; an incidental wrapper introduced while evaluating its source must not substitute the default. Verify a complete-mode a.slice().splice(badStart,0,x) with and without an intermediate compiler holder: both retain complete-mode failure. Repeat for the streaming modes, a selected expression branch and an explicit receiving channel with a different mode.

### Complete mode

Complete preserves atomic mutation failure and strict access to the resulting Array version. Its guarantee concerns whole-Array poison, not the absence of Errors in every element. A structurally established [pendingA,B] remains consumable without waiting for pendingA when rejection can poison only that payload.

Receiving streaming-produced oversized state preserves its data and structural Errors without creating an own-path flag merely for its size. Complete mode alone therefore does not prove an inherited length fits the ordinary Array limit. Follow the [cross-mode capacity rule](iterate-plan.md#complete-mode-receiving-an-oversized-value): existing access and true mutating no-ops differ from new copies or effective receiver successors, each of which keeps its own capacity obligation.

#### Complete access gate

Before ordinary consumption, establish that work logically preceding the access can no longer poison the captured Array version or an applicable ancestor scope. Wait while that decision remains relevant and unresolved. Propagate established poison without exposing retained data. Once the required work succeeds, or a proof removes its relevance, allow access subject to the requested shape, selection and payload dependencies. A currently clear flag alone is not a proof of safety.

Today's pending mutation already enforces this through its transition version. Preserve and extend that common mechanism; the route table below is an acceptance inventory, not a request for independent per-route health gates. New partial-layout/producer state must retain the same ordering and failure ownership, with the complete-mode failure classification below.

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

All modes order a possible whole-Array or ancestor failure through the same captured transition. Complete mode classifies additional structural failures as whole-Array failures, so more dependencies can gate access here. In a streaming mode, an operation with exclusively regional failure leaves unrelated positions eligible. Evaluate that classification once at the operation's declared scope. Exact length, payload readiness and direct-result completion retain their own dependencies.

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

Repair clears the selected status and exposes retained current data; it does not rerun the failed command, restore a predecessor, or roll back earlier committed work. Receiving a captured Array in another mode preserves its own status and the order of pending effects.

An earlier open producer that can still introduce whole-Array poison keeps outside consumption behind this gate, even if it only appends and its existing prefix cannot move. Apply the [validity tracking rule](#tracking-complete-mode-validity), including remaining-issuance proofs and nested closure. Validate individual appends incrementally; complete does not turn the whole producer into one atomic mutation or undo earlier successful appends after failure. Its failed output is inaccessible until recovery. No complete-mode prefix streaming is promised through that unresolved risk.

Completion must not depend on an outside consumer that is waiting for this same gate. Use a streaming mode for a pipeline requiring producer/consumer overlap; do not introduce a circular wait or silently change mode.

### Sequential-stream mode

Deliver the structurally established prefix in numeric order. Delivery needs membership, the numeric index in this capture, a final payload source and clear slot status. An accepted fallback supplies the current index. A payload may remain pending or ordinary Error data. Ordinary access can use independently established regions beyond an iterator's obstruction when no applicable path blocker prevents it.

After actual structural failure, retain guaranteed survivors in the deterministic fallback layout and attach own-path status where their intended position is lost. Uncertain contents or survival become permanent structural Error data; missing output uses its declared marker. Iteration stops at its first structural obstruction and reports failure, rather than claiming successful exhaustion. Repair can expose retained positional survivors at their fallback positions, but cannot reconstruct discarded candidates.

A pending whole-Array failure blocks the first step, including empty exhaustion. Once a step is exposed, an earlier operation cannot subsequently fail that captured Array as a whole. [Whole-Array failure and ordered repair](#whole-array-failure-and-ordered-repair)

#### Published prefix

A published sequential occurrence has established membership, its current numeric index and final captured payload source. A healthy hole at that index yields undefined. A blocked hole stops ordered iteration. The payload itself may be pending or ordinary poison. A length lower bound establishes possible progress but does not by itself establish this selection. [Fallback and repair](#ordered-and-irreversible-fallback)

A prior mutation that can still delete or overwrite an occurrence prevents its publication. A later command uses a successor version and cannot change an already captured occurrence. Beyond the required bounded rules, conservative delay is permitted; premature publication is not.

The first structural obstruction in the captured layout determines the clean-prefix size. Diagnostics that display the size can use the number of successful sequential pulls before that obstruction. Pending payloads and body scheduling do not change it. The cursor reports the existing causal Error at that boundary, including when several Arrays share the cause.

### Out-of-order-stream mode

Deliver each guaranteed surviving occurrence once its final payload source is established, without waiting for its numeric index or payload value. An index future follows the captured layout. Occurrence discovery changes availability only; Array order, conflicting effects and command-buffer branch order remain logical issuance order.

After a position-only failure, preserve survivors at deterministic fallback positions without positional flags, an extra marker, or Array-path poison. Uncertain contents or survival still become structural Error data, and missing output still needs its declared marker. Deliver independent survivors and report remaining structural failure at terminal completion; unavailable or skipped occurrences cannot prove healthy exhaustion.

A skipped structural slot can cause terminal rejection after other items have been delivered. Its cause belongs to that slot. A possible failure of the Array itself gates every item before handoff, as in sequential streaming. [Whole-Array failure and ordered repair](#whole-array-failure-and-ordered-repair)

### Whole-Array failure in streaming modes

Neither streaming mode applies complete-mode whole-Array poisoning to an ordinary regional control failure. Such a failure uses the specified local Error/status/fallback or missing-output marker. Pending selection or layout is not poison: the affected region waits while ordinary successful outcomes still differ, even if that region is the whole Array. Actual failure has its declared causal footprint and cannot retract already-published facts. A blanket category of "genuine scope failures" is not sufficient to specify that footprint.

Choose the failure form by operation and mode, not by readiness or how much a consumer has read. A ready failure and the same delayed rejection produce the same logical result. In particular, a streaming contribution cannot return root Error merely because its failure was discovered before anything escaped, while using a local marker when it fails later. Whole-result Error is appropriate for a specified indivisible result boundary or a separate result whose failure does not invalidate published receiver data. It cannot be used as a fast path that changes the regional contract.

The reviewed boundaries are:

| Boundary | Selected rule |
| --- | --- |
| Required sorting failure | Every mode waits for required sort validation, preparation and comparison before publishing any slot from the sorted Array. A failed mutating sort flags its retained data. A failed copying sort returns root Error for its result. |
| Capacity | The [poisoned-tail revision](iterate-plan.md#streaming-capacity-revision) replaces streaming owning-path overflow with local structural Error positions and a capped fallback length. Finite copying operations use the same rule; capacity alone is no longer a streaming result-root prerequisite. |
| Explicit length assignment or a failed general mutation key | Intrinsic length failure belongs to the Array or the explicitly selected broader assignment scope in every mode. A failed key before child selection belongs to the reached prefix or already selected broader owner. Gate affected siblings and the data exposed by repair at that owner. Narrow protection when the selected target permits it. [Resize, sibling writes and repair](iterate-plan.md#assigned-length-validity) |
| Invalid with index | Retain result-root Error, with the source unchanged. Prove index validity before result handoff, using available bounds rather than demanding exact length or payload readiness. This is a selected result-validation exception. |
| concat part-root classification | In the streaming modes, keep each part as its own contribution. A required failed part becomes one structural missing-output marker; known independent parts remain available under their ordinary position/capacity dependencies. No all-parts root-validity gate. |
| flat nested discovery or unlimited-depth cycle failure | In the streaming modes, fail the affected contribution at its captured location, preserving independent discovered output. A failed required expansion with no representing placement gets one structural marker; an Infinity cycle stops at the recursive edge. No whole-result discovery or acyclicity preflight. See the [method rules](docs/array-method-specification.md#8-flat). |
| Failure to select an Array, an already poisoned ancestor, or missing mutation authority | No usable selected Array or authorized mutation exists at that boundary. This is different from a late failure of one region of an already selected controlled Array. Establish only the required selection/authority facts. |
| Opaque native mutation | Its declared scope may be wholly affected; without a narrower effect contract, successor data genuinely remains unresolved until the call establishes it. Preserve the native failure/authority contract. Do not transfer this limitation to controlled operations with known regional footprints. |
| Scalar results, full export, and independent mutation results | Their own required failure can return Error without poisoning their source or gating independent receiver publication. A result already handed off as a partial Array retains its regional contract. Direct mutation completion still includes promised effects; export still completes required Error collection. |

The contribution-local concat/flat revision applies only to the two streaming modes. Complete mode retains required whole-result validation and failure. A failed observation or copy result does not poison its source. Supported input preparation failure before an Array exists likewise does not invalidate an independently captured source Array; placement-local failure remains local where structure is known. The [complete-mode removed-result capacity rule](iterate-plan.md#oversized-removed-result-in-complete-mode) likewise separates an oversized splice result's Error from its valid committed receiver change.

Before suspending work that could poison the selected Array or an applicable ancestor, order the affected successor behind that transition. Every mode waits until the whole-Array outcome is established or can no longer occur. This covers unchanged positions, empty exhaustion, and writes whose effects might only become visible after repair. Once any item from a capture is published, a later whole-Array failure in that capture is impossible. Sorting, explicit length assignment, opaque mutation and still-open issuers are applications of this rule. An open issuer that can still issue such a mutation keeps the dependency live. Canonical storage introduces no later physical-write veto.

A stored-payload rejection stays with its value. A regional failure follows its declared positions. A copying operation that fails at its result root leaves its source alone. An earlier capture keeps its own status and data through later source mutations. The consuming loop publishes any required failure at its compiler-declared targets in command order.

### Payloads are independent of structural publication

For [pendingA,B], both occurrences can be issued without awaiting pendingA in every mode. Its rejection poisons only that payload, not the Array, other elements, or the structural prefix. Ready payload poison behaves identically; ordinary Error items remain deliverable.

“Stream only healthy elements” means structurally valid occurrences, not poison-free payloads or fully resolved descendant graphs. Do not run hasError on each element as a delivery gate. Complete mode applies its access gate and required structural dependencies, not a wait for every stored Promise. An earlier sort or another structural operation may still genuinely need a value to determine its layout.

Track payload failure separately from structural obstruction at a placement. A pending selection can still decide which payload belongs there. A marker and a slot whose source selection failed carry the same structural role through remapping and materialization. Preserve their positional causes and distinguish both from an ordinary Error payload without inspecting its identity or message.

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
| A genuine whole-Array or ancestor failure | Ordinary access through the affected path is blocked in every mode. Exact repair and permitted replacement act at their own ordered turns. |
| Independent observation/callback result failure | Fail that result only; it does not automatically poison entered Arrays. |

Irrelevant arguments and proved no-effect work introduce no failure in any mode.

Failure ownership fixes the outcome before delivery. Missing output in a streaming append contribution occupies its reserved marker position. Overflow produces structural Error in its virtual tail. Whole-Array failure marks the owning placement and blocks ordinary access throughout that capture. Loop failure affects the consumer's declared effect targets in command order. Each publication retains its causal Error.

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

For later operations, including iteration in another channel, an accepted fallback supplies the current numeric coordinates. Transfer an unordered failed-position insertion of X into `[A,B]` to a sequential or complete channel. Once the producer settles, ordered iteration delivers A, B, X at 0, 1, 2. While the producer's start is pending, a positional consumer still needs its selections. Transfer the corresponding **sequential** fallback to an unordered channel and all three existing positional flags still obstruct delivery. Repairing index 2 on the receiving owner permits its next unordered capture to deliver X and report the other two obstructions. An earlier cursor keeps its original flags. A consumer never asks a settled or repaired occurrence to recover a producer's lost historical intention.

Apply the producer's failure footprint during the wait as well. Start with `a=[A,B]`, issue `a!.splice(1,p)` at Array scope, and transfer the successor into a channel of the other mode. A complete consumer of the streaming producer can read A while p is open. A stream consuming the complete producer waits even at index zero. Rejection leaves A followed by a structural obstruction in the former capture and a whole-Array blocker in the latter. A replacement of the source holder after transfer changes neither outcome.

Choose fallback only after a relevant structural failure is established. Pending controls remain pending. Ready failure and delayed rejection produce the same facts. Preserve all earlier published values, positions, length/bound facts, aliases, and effects. Publication proofs must include the failure fallback; if it could invalidate a fact, that fact is not publishable yet.

With no tighter position facts, an unknown-position insertion uses the captured end as its fallback. Tighter captured bounds constrain that choice: use the latest allowed boundary, preserving any established prefix/suffix positions. A known insertion point or reserved producer region keeps its own location. The [bounded splice rule](docs/array-iteration-technical-analysis.md#5-a-bounded-splice-fallback) specifies this extension and its limits. Authority and mode-specific capacity still apply. Complete fallback cannot exceed Array capacity; streaming fallback applies the poisoned-tail transition and maximum logical count.

### Whole-Array failure and ordered repair

In every mode, an operation that can fail the whole Array reserves that scope before it can suspend. Until its outcome is settled or whole-Array failure is ruled out, successor items and all dependent effects, including body effects, writes to retained data and repair, stay ordered behind it. This applies to every producer, including a nested issuer that still has authority to issue such work. Commands may be issued and independent operands prepared. Older snapshots and unrelated scopes retain their ordinary progress.

Finality applies to a reported blocker too. An outside capture following an entry observes the state at the end of its reserved issuance. Suppose the private prefix has failed a sort of `[2,1]` and an open child may still repair the Array and push 3. An inside read at the failed prefix sees the sort Error. An outside first step, including its failure handlers, waits. Closing without recovery gives zero items and the blocker. Repair followed by push gives the outside loop `[2,1,3]`. If that choice never settles, the outside step remains pending while the private prefix and disjoint scopes remain usable according to their own state. A known blocked prefix supplies a final outside failure only when remaining work cannot change the required outcome or its cause.

Consider these commands in issuance order, starting with `a = [2,1]`. A loop between the sort and the indexed assignment captures the sort's successor and observes each item without mutating `a`.

| Issued work | Comparator succeeds with ascending order | Comparator fails validation |
| --- | --- | --- |
| `a!.sort(comparator)`, then iterate `a` | The loop observes `1,2`. | The first step reports the sort failure. Zero bodies run. |
| `a[0] = 9`, before repair | The write commits `[9,2]`. | The Array is blocked. The write commits no change to its retained `[2,1]`. |
| Repair `a` at its root | The data remain `[9,2]`. | Repair clears the flag and exposes `[2,1]`. |
| `a!.push(3)`, then read `a` | `[9,2,3]` | `[2,1,3]` |

These outcomes apply when the comparator is ready, delivered synchronously by a thenable, or deferred while all subsequent commands are issued. A snapshot taken before the sort still observes `[2,1]`. A write blocked before repair never runs again. An earlier committed write remains in the retained data, and a write issued after repair sees the repaired successor. Exact-path repair clears status without consuming unrelated pending payloads. A permitted whole-location replacement can discard a poisoned value at its ordered turn. Neither operation permits a conflicting effect to overtake its predecessor.

Vary the owner using `r={a:[2,1],tag:0}` and an explicit root scope for the same failing sort on a. Issue a cursor on a, `r.tag=9`, then repair r. Complete mode flags r, the cursor issues zero items, the tag write is blocked, and repair reveals tag 0 and the original Array. In either stream the selected sort failure belongs to a. The cursor still issues zero items, the sibling write commits, and repairing r leaves tag 9 and a's own blocker. Repair a to expose its original data. A native action inside the cursor body is never issued in any of these failure traces. A healthy comparator permits the sorted items and the sibling write in every mode. [Sort failure ownership](iterate-plan.md#13-selected-decisions)

The streaming Array `[A, structuralError, B]` has a failed slot at index 1. Unordered iteration can deliver A and B and report the skipped cause at completion. A loop pushing into a streaming output places its marker between A and B. Reaching terminal failure leaves the source Array's own status clear. [Marker position](#marker-position-and-ordinary-array-behavior)

#### Publishing a nested mutation at its owner

Keep the required mutation effect and the call's direct result separate through the private path walk. The kernel carries the effect's failure separately from the retained placement. Inferring it from `outcome.placement.value` confused a freshly failed splice with a healthy Array and treated existing Error data as a new failure in the earlier implementation. Reading the child's final status would also misclassify a blocker left by an earlier command. [Placement transition](src/mutations.js) · [Scope coordinator](src/path-operation.js) · [Core scope contract](AGENTS.md#scope-poison-and-repair)

Carry the cause of a **newly failed mutation effect** in the existing operation outcome until the coordinator for its selected owner consumes it. Classify the effect where selection, preparation or publication succeeds, fails or encounters an existing blocker. Apply the same distinction when a pending path walk resumes. The owner is the one specified for that operation and mode. A failure before reaching the owner still belongs to its first failed placement. [Scope transitions](docs/error-handling.md#scope-transitions)

| Outcome at the private receiver | Publication at the selected owner |
| --- | --- |
| The mutation newly fails and the enclosing scope owns that failure | Discard the private candidate. Publish own status once over the owner's captured predecessor. When failure and retained data are already certain, publish that fact and its write-based identity with the captured cause, even if the exact Error is still pending. Release each consumer when its required projection is established. Repair then exposes the original child and siblings. |
| The streaming operation owns a narrower failure | Publish the Array's own flag or its specified regional successor, including earlier and independent writes. A wider bang supplies authority. Release sibling dependencies once wider failure and conflicts are excluded. The direct result retains any required failure separately. |
| A pre-existing receiver or path blocker prevents the call | Forward its exact Error as the result and preserve the existing placements. The attempt adds no failure or identity change. An explicit repair already committed at its ordered turn keeps its effect. |
| The mutation succeeds with an independent Error or pending result | Adopt the successful private capture and finish the owner's effect. Deliver the result on its own dependency. Storing Error data, or removing an Error-valued element, can be a successful write. |

Use the existing private holder where scope isolation requires it and the placement transition at the owning location. Release private publication and source protection at their ordinary last use. The operation outcome carries the cause only until its owner consumes it. Queries, readers and repair then use the committed placement. A write through a certainly blocked ancestor commits no data at its turn. Its own result keeps any promised failure, and a later repair of that ancestor can expose the retained data while the earlier result still waits. A state-preserving capture of the owner carries this same status and can be repaired independently. A selection stopped at a strict ancestor carries the visible Error only. Both historical captures keep their original cause dependency after source repair or replacement. [Exact clearing](repair-simplification-plan.md#5-ordered-and-atomic-clearing)

## 3. Access and extraction

A poisoned selected Array or strict ancestor blocks ordinary reads, calls, iteration and writes through it in every mode. Permitted final replacement/deletion and exact-path repair retain their selection, authority and ordering rules. [Whole-Array failure and ordered repair](#whole-array-failure-and-ordered-repair)

In streaming modes, healthy siblings remain accessible because regional Array failure does not automatically poison the Array path. Sequential iteration can stop at an uncertain region while an ordinary query accesses another independently established region. Unordered mode does not create positional flags that would then require a bypass.

An unresolved earlier transition that could poison a strict ancestor is a selection dependency in **every** mode. Reserve it before suspension. Selection waits until that footprint is excluded or the blocker is established, even when every successful mapping would preserve the selected slot. Narrow the reservation when target selection permits it. An unrelated sibling outside the remaining footprint and a version captured before the transition keep their ordinary progress.

### Containers and contained status

State-preserving references and structural copies transfer a **reached** placement with its own status, ordered transitions and contained roles. A reference formed before path selection completes carries the captured route dependency. If a strict ancestor blocks selection, actual use reports that blocker. There was no selected child whose hidden data or repair authority could be transferred. If selection instead reaches a flagged final placement, a state-preserving holder receives that placement and can repair its own copy. Value extraction gives the visible value or Error. Receiving the extracted Error as fresh payload gives the destination Error data. The recipient applies its own mode to future operations. [Captured-state handoff](iterate-plan.md#captured-state-across-handoff)

Full export and native preparation apply the complete gate to every complete-mode Array they consume, including nested Arrays. A reached oversized Array contributes the [full-consumption capacity Error](docs/array-method-specification.md#native-diagnostic-list-capacity). For representable selections, consume the required graph and report its payload poison, structural poison, markers and path blockers. Preserve native authority, isolation, effect completion, canonical assembly and the ready-only mutable-external snapshot contract.

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

`isPoisoned` uses the Boolean query boundary of `hasError` for the selected path. A recoverable failure in the required selection or reflection gives true and leaves the inspected graph intact. A clean missing final key gives false. Traversing that key to a child produces a path failure and gives true. Internal traversal and bookkeeping defects still fail the execution. Use the existing guarded query traversal and stop at the selected root.

### Earlier open entries

Queries capture logical versions, not physical flags sampled at a convenient time. An earlier open entry may still add data, markers, or status, or repair/replace a current failure. Neither a currently empty Array nor a provisional failure determines its final captured query answer.

hasError can return true from a certain relevant failure; false needs the complete relevant error-producing frontier. getErrors completes required collection. isPoisoned waits for required selected root/status outcomes, without awaiting payloads that can poison only descendants. An irrevocable failure proves both Boolean queries true even while its visible cause is pending. An exact Error read or rejected step still owes the cause. If every remaining alternative retains the same data and blocks the same intervening writes, exact repair can clear that status and release the successor without waiting for the diagnostic. A still-possible data change or conflicting effect keeps its dependency. [Full Array witness](iterate-plan.md#required-capacity-proofs)

Compute that frontier from the visible capture. A selected managed own blocker ends descent into its retained data. A strict ancestor blocker ends selection before the child. At a reached canonical placement, include separately required resource metadata under the existing contextual query contract. For `a=[pending,E]`, capture queries and export after `a.length=n`. With invalid n they report the resize blocker without waiting for pending or collecting hidden E. With n=0 the Array is healthy and empty. Repair after failure exposes the old payload producers to **later** queries. Neither outcome justifies sampling the physical prefix while n is undecided. [Contextual Error collection](docs/data-limitations.md#contextual-error-collection)

Use entry publication, not iterator draining, to establish these dependencies. Queries inside an entry consume its private command prefix rather than its own enclosing future. Later repairs and commands do not change earlier query snapshots. An explicit deep no-error guard before a loop still waits for payload health when needed; that is the caller's choice, not the iterator's default.

## 5. Repair clears status

[Repair](repair-simplification-plan.md) clears exact selected own-path status and returns undefined after successful publication. It preserves current data, fallback placement, pending versions, local poison, and committed writes.

This includes a sequential occurrence whose payload survives at a fallback index. Repair exposes that retained payload there; it neither discovers the intended position nor reorders the Array. It does not resume an old captured iterator. Later captures see the repaired successor.

Ordinary payload poison, permanent structural poison, and missing-output markers are Error data rather than repairable flags. Replacement, overwrite, deletion, or ordinary structural edits can remove their placements; status clearing does not. A complete-mode failed mutation has retained current data and a repairable flag; a failed copying-result Error has no hidden Array. Sort follows its [normative contract](iterate-plan.md#13-selected-decisions).

For genuine own-path status, eligibility does not depend on an explicit-! origin. Failed computed-key writes, selected scope failures, and canonical external own-state failure retain their established selection/authority rules. Clearing a parent does not clear descendant status.

Once selection, authority and earlier conflicting transitions permit it, repair can supersede a pending status-only decision without awaiting its diagnostic. If an earlier transition still selects the retained data or whether an intervening write can commit, carry that dependency through repair and every dependent successor. Earlier captures retain their own decisions. Failed repair preflight/publication preserves state. Opaque managed calls adopt private work only after successful validation.

## 6. Missing-output markers

In streaming modes, use a real Error element when output may be missing and no established placement already carries that failure. The decisive case is an unordered producer whose failed control flow may have prevented zero, one, or many additions. A marker reports that incomplete contribution; it does not claim exactly one real value was omitted.

One failed logical contribution/operation adds at most one marker per affected Array, not one per hypothetical element or propagation step. Distinct failed source positions can each owe a downstream contribution even when they share one causal Error. Preserve their ordered positions and multiplicity. Terminal Error collection deduplicates the cause independently. A failure already represented on that output adds no second marker. An independent callback Error, an unused poisoned argument, a rejected stored payload, and position-only uncertainty are not reasons to add a marker.

Suppose consecutive owed contributions to one target have visible causes A then B. A streaming target receives permanent markers A then B. A can itself be a source status hiding an older Error. Repairing that source slot reveals its older Error, while the output marker still contains A. On a healthy Complete target the first contribution flags its retained data with A, so the next encounters that blocker. Issuing a write through the blocked target and then repairing it restores the same baseline. One skip callback or several must give these same outcomes. Iterator exhaustion collects A and B in either case.

For concat, a consumed part root is a contribution. For flat, a required nested expansion is a contribution; an active-ancestry cycle at Infinity fails that recursive edge. One invocation can contain several independently failed contributions, including repeated source occurrences. Preserve their distinct logical locations without adding another marker for the outer invocation or deduplicating occurrences by source/Error identity. Reuse the captured contribution and ordinary structural-role machinery, not a new failure ledger.

### Marker position and ordinary Array behavior

Use the affected contribution's reserved position in Cascada's ordered output. A failed source occurrence with known position has its own reservation even when no body runs. For unordered `[A, structuralError, B]` copied by a loop that pushes into a streaming Array, the output is `[A, marker, B]` and B's push returns 3. The terminal step still rejects. It adds no second marker. A failure inside an enabled body uses that body's reservation after its already-issued appends. Later parent appends follow both. An ordered source stops at its first obstruction. For a captured `[A,E,F,B]` with structural E and F and an enabled streaming append target, it runs only A, reports E and leaves `[A,marker(E)]`. F and B receive no branches or additional markers. Unordered enumeration of the same capture runs A and B, leaves `[A,marker(E),marker(F),B]` and reports E and F. In each case a subsequent parent append follows the recorded contributions. When a producer fails with no next position established, use the boundary of the remaining affected contribution after its committed prefix. Retain earlier reservations and tighter location bounds.

Select the failure footprint from the **output channel** at that same reservation. Feed its ordered break/return guard before publishing a missing contribution. In the example, with an initially empty **complete** output, A's push returns 1, the missing contribution flags the retained `[A]`, and B's body runs but its push encounters the blocker. An outside cursor on that completed loop output delivers zero items. Parent repair followed by a push of C gives `[A,C]`. A streaming output instead admits B's push and ends at `[A,marker,B,C]`. These outcomes hold even if B or the structural failure was discovered first. A break after pushing A disables the later contributions in both destinations. Enumeration still reports its source failure. Terminal handling uses the ordinary body/else target sets for the remaining obligations. It neither republishes an already handled contribution nor turns a disabled one into a target mutation. This also preserves an intervening repair or replacement. Use the existing branch's issuance closure to account for its publication.

Keep the compiler's declared failure point with each target. An enabled body's own control failure publishes in that branch. A skipped append publishes in its missing contribution. The existing loop-terminal poison for other body targets follows all preceding body commands on the affected path, including commands still issuable by nested entries. For unordered `[structuralError,B]`, suppose B sets `r.v=1` and the compiler targets r for loop-terminal poison. B writes before that flag. A parent write through r then encounters the blocker, and parent repair reveals v=1. Terminal rejection can become known before B issues its write. Reserve the terminal publication in that order without delaying a disjoint target.

Apply one terminal failure to each distinct affected target. On source selection failure with both body and else declared to append to the same streaming Array, append one marker. Count targets by their logical location in the reserved ordering view. If two independently owned output Chains share the same initial empty Array and both are targets, each receives one marker. An untouched owner of that Array stays empty. A cause shared by two distinct skipped occurrences still contributes twice. Once an item has been issued, an else-only target has no remaining use on either natural exhaustion or terminal failure. For a first item followed by a structural decision that stays pending, a later parent edit confined to that else-only path can proceed once overlapping body or outer coverage is excluded. Use the existing branch reservations and target declarations. [Loop failure and closure](iterate-plan.md#compiler-ordering-and-loop-failure)

A skip belongs to the body’s potential append targets. An else-only target has a single terminal obligation if enumeration fails with `didIterate=false`. On unordered `[E,F]` with two structural failures and distinct streaming body and else targets, the body target gets two markers in position order. The else target gets one marker carrying the terminal collection of E and F. Neither arm runs. Add a healthy B after F and the else target gets no marker, even if both skips were discovered before B. A subsequent parent push on that target can proceed once B has been issued and its coverage released. While an undecided suffix can still supply that first body, reserve the else target without publishing into it.

When several remaining terminal publications overlap, keep the compiler’s ordered target list in the coordinated entry. Cascada issues body targets first and then eligible else targets, in declaration-list order within each arm. A repeated logical location keeps its first eligible turn in that terminal event. Combine its remaining declared effects there. For declarations `[r.out, r, r.out]`, the child append precedes the ancestor flag, so parent repair exposes one marker. Moving the merged child publication to its last appearance would lose that marker. An exclusively append contribution uses the target’s missing-append policy. If an eligible arm could replace the same target, its missing effect covers the selected scope. Flag its retained data once. Thus body append and else replacement of the same initially empty streaming Array on failed source selection leave `[]` after repair. A marker already published by an earlier positional contribution stays in that retained data. Discharged arms supply no coverage. Sharing an entry for selection leaves distinct ancestor and descendant operations in their issued order. For example, on failed source selection, if the body target flags r and the else target would append to `r.out`, repair of r reveals its original `out`. With the child append in the body target list and the parent flag in the else list, repair reveals the child marker. Earlier positional contributions already have their own turns. A disjoint target has no wait on these overlaps. [Compiler failure ordering](iterate-plan.md#compiler-ordering-and-loop-failure)

The marker occupies one ordinary Array slot and participates in length, indexing, remapping, slicing, deletion, and replacement. Its cause/source and structural placement role survive remap copies/moves. Use the same named numeric structural-obstruction role as an existing slot whose selection failed. The producer determines marker insertion, count and location. Once published, its consumers need only the obstruction and its cause, with ordinary payload as the default and repairable positional status independent. Explicitly receiving a looked-up Error into a new payload placement keeps the Error value but creates a structurally known occurrence. The [role-transfer rule](docs/array-method-specification.md#10-sparse-data-occurrence-roles-and-queries) distinguishes that from structural copying without a registry or second marker container.

A later pop or slice can remove a marker where the ordinary regional rules permit that operation. The earlier captured Array and any returned Error retain their own outcomes; no sticky Array flag keeps a removed marker alive as history. Repair cannot remove it, while ordinary replacement/deletion can. A required structural selection failure is not ordinary comparable payload data and cannot supply healthy negative search evidence. No pending selection is a marker.

An enabled missing append selects and validates its target at that reserved position, through the same authority and ancestor gates as an ordinary append. If the target resolves to a record, the append reports `InvalidArrayOperation` in every mode. Repair reveals the retained record. If an earlier target blocker already prevents access, that blocker propagates. The source cursor still reports its own structural cause. A disabled contribution does no target access. [Public append boundary](docs/integration.md)

### Streaming and shape

Structural markers are not streamed as ordinary payload Errors. Sequential mode stops at the first structural obstruction; unordered mode delivers independent guaranteed survivors and then rejects its terminal step with remaining structural poison. It cannot silently report successful exhaustion. Genuine path blockers stop delivery, and ordinary pending/poisoned payloads remain item data. Complete mode applies its structural failure boundary. Error queries report the actual stored marker.

A marker fallback must fit its selected contribution. Do not append a diagnostic slot to an already fixed-length output merely to report a positional failure. That is why the pure insertion example has three occurrences, not four. Open push-only production validates issued appends incrementally rather than awaiting an upper bound on every future command. Actual overflow uses the [mode-specific capacity boundary](iterate-plan.md#capacity-by-mode). Streams represent excess logical positions with compressed structural Error; no huge traversal is required merely to record or query poison. Explicit prefix iteration retains its normal cost. Earlier completed results and handed-off values are not retracted.

No zero-sized marker, non-element marker, hidden per-Array failure ledger, or new language construct for marker removal is required.

### Open append contributions

Preserve every issued command and its required effects. Unissued commands do not become invented application values; their missing contribution is represented only by the one marker when required.

At the logical count cap, an owed marker follows ordinary [append clipping](iterate-plan.md#maximum-logical-count). With room for one marker and skipped causes E then F, only E enters the streaming target. Its length reaches K. Growth for F fails directly, the source terminal still reports both causes, and a later pop selects E. A bulk skip preserves these ordered publications, visible causes and per-command identity effects. Clipped positions require no hidden target status.

Close a contribution only when all relevant issuers, including nested entries, can issue no more commands. Failure of one callback does not close another live issuer. Bound progress using actual contributions and all permitted failure outcomes; a successful-output minimum is not guaranteed when failure can prevent those appends.

The compiler supplies affected targets and required failure information at the reserved command position. Entry itself is not mutation authority or an automatic poison scope. An unrestricted open reference that can still delete/overwrite a region prevents its publication; a push-only declaration can prove earlier occurrences final.

## 7. Compact propagation diagnostics

Preserve existing immutable source contexts, causal Error attribution, poison-by-reference propagation, and collection deduplication. An absent ordering guarantee in unordered mode creates no extra diagnostic failure. A different consumer or physical representation is not a new cause. Do not add Chain identities to operation contexts, per-hop propagation records, or a reporting history as prerequisites of iteration.

Collection follows captured output membership and structural failure state, not every retained candidate or earlier failed command. Release spent traversal and aggregation state. Any future diagnostic redesign belongs to a separate contract revision; it must not change values, failure presence, context reuse, or settlement-order determinism here.

## 8. Required integration evidence

- Strict complete gate on lookup, length/presence, observational and mutating calls, indexed writes/deletion, iteration including empty completion, direct result delivery, export and nested native preparation. Include an unchanged prefix behind a pending whole-Array failure, early success/irrelevance proofs, and cross-mode consumption of a captured whole-Array failure.
- Complete validity tracking distinguishes ordinary payload rejection and independent result failure from required controls, invalid healthy inputs, comparison/publication failure and applicable ancestor scope. Cover zero pending commands with an open issuer, closed outer issuance with an open child, proved safe remaining work with pending payload/layout, and an ordered repair/replacement. Compare ready/deferred outcomes; no later source-own failure may invalidate a successfully exposed complete-mode step. The two streaming modes retain their own prefix and loop-failure rules.
- Complete recovery/query exceptions and internal reference capture preserve authority and dependencies without requiring a healthy selected payload. Private producer commands never wait on their own enclosing output, and later successors do not invalidate earlier captures.
- Equal ready, synchronous, pending, failed, and never-settling behavior within each mode. Different delivery modes intentionally have different structural failure contracts.
- [pendingA,B] issues both occurrences without a payload wait in every mode; ready poison and rejection affect only the value. Deep guards remain explicit.
- Pending source selection is not mistaken for an ordinary pending payload. No structurally uncertain occurrence reaches the body and later becomes structurally poisoned.
- Pure insertion failure: fallback [A,B,X], length three; sequential flags preserve recoverable payloads; unordered survivors have no positional Error or extra marker.
- Failed deletion count: only guaranteed survivors stream, candidate deleted/overwritten values become permanent poison, and fallback shape stays within all published guarantees.
- Failed open streaming production: zero/one/many possible missing additions produce the declared single marker; reserved order, later appends, capacity, and nested closure remain deterministic. Known skipped positions retain their own contributions under reverse discovery or bound-one admission. Test the exact returned push lengths and later parent order.
- Markers survive capture/remapping and are removed through ordinary edits; no special removal API or retained history remains after supersession.
- Queries inspect captured marker/status/data outcomes without draining an iterator. Earlier snapshots remain unchanged after repair/replacement.
- In every mode, an unresolved whole-Array failure orders publication and state retained through repair. Compare a pre-mutation snapshot, the first step from the successor, writes on either side of exact repair and final export in both success and failure schedules. Verify unaffected siblings and regional terminal failure separately.
- Exact-path repair returns undefined without waiting for the payload, preserves fallback positions, clears complete-mode failed mutation status over unchanged data, and cannot recover ordinary Error data or a failed copying result.
- Sort preparation/comparison failure in every mode: mutating sort retains unchanged pre-sort data under repairable own status, copying sorts return root Error without changing source, and no partial permutation/fixed suffix escapes. Verify effective flag identity, payload producers, holes, earlier captures, and repair without sorting again. Later publication failure follows ordinary rules without rollback.
- Self-modifying iteration, COW, aliases/cycles, retirement/re-entry, native isolation, and canonical metadata preserve ordering and last-use release.
- Diagnostic work and retained history remain bounded under propagation, repeated failures, and fan-out.
