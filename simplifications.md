# Simplification review

**Last reviewed 2026-11-24.** This file records
implemented changes, rejected or reverted alternatives, and possible future
investigations. Separate future plans are not unfinished audit decisions.

Retained design comparisons from 2026-11-05/06. The
[audit report](docs/audit-report.md) owns current decision status, coverage and
verification; [data limitations](docs/data-limitations.md) owns runtime contracts.
These evaluated alternatives do not establish architectural minimality. The
[search tree](docs/coverage-tree.md#simplification-search-tree) tracks further work.

## Claude review follow-up, 2026-11-24

The identifiers below refer to the two November 24 reviews of the staged Chain tree.

| Review | Finding and disposition |
| --- | --- |
| 1a, 3c | After `[0,1,2,3,4,5].splice!(4,p)`, `copyWithin!(1,-3,3)` must give `[0,2,2,3,5]` when p is 1. Interval selection now includes crossings between absolute and end-relative coordinates and the point at which copy length clips the destination. Exhaustive small-length comparisons covered emptiness, extent, and the unaffected suffix. [Interval cases](test/array-interval.test.js) |
| 1b | A pending virtual index could read as absent, accept a healthy write, or poison the Array prematurely. Reads now capture its possible placement. A mutation with undecided addressing reserves the receiver until membership is proved. Inside an entered reference, a point edit uses its selected Array's capacity policy. Tests cover present and absent outcomes, source attribution, historical reads, explicit scope, repair, and cross-mode reception. [Capacity cases](test/array-capacity-layout.test.js) |
| 3a, C11–C14 | An inserted X survives even when the start, removal count, and receiver length are pending, provided its capacity and window allow delivery. Source survivors and insertions now use the same occurrence traversal. Mapping the cut replaces the separate insertion-run scheduler and its retry list. A zero count releases the old occurrences independently of the start. Reversal exchanges the two cut widths. An alternating two-million-slot capacity case searches permanent causes in bulk. Error queries share the cut calculation and retain their own identity-deduplicating walk. [Splice cases](test/array-partial-splice.test.js) · [Work bounds](test/array-structural-work.test.js) |
| A1–A3 | A stalled Sequential pull now releases its spent borrowed prefix. A snapshot still protects it, and a pending pull can still deliver the suffix. A pending `fill!` returns the entire Array, so its result can still need the untouched prefix after clearing the receiver. Optional backing-cache trap attempts may vary by readiness. [Lifetime fixture](test/fixtures/array-cursor-release.mjs) · [Boundary contract](docs/data-limitations.md) |
| B1–B4 | A public slot model checks failed insertion, deletion count, fill, and copyWithin across modes, captures, and repair. A second matrix covers nested push-only entry, missing output, and explicit poison. GC fixtures now cover streaming regional losses and shared call failures. The Phase 6 differential already asserts joint route, shape, delivery, and outcome combinations. A named recovery test checks an enclosing guard over an independently failed child. [Failure histories](test/array-generated-failures.test.js) · [Differential](test/receiving-invocation-differential.test.js) · [Recovery](test/repair-call-recovery.test.js) |
| 2a–2d, C1–C5, C8, C19 | The selected default is Unordered. A failed pure insertion on `[A,B]` leaves usable `[A,B,X]` and a failed direct result. In Sequential the position flags travel with the occurrences. Complete preserves the pre-command data for repair. Changing the default, clearing positional status at the root, retaining overwritten alternatives, or changing virtual overflow would change observable recovery or progress. The modes also differ in what a cursor can deliver before settlement. The general independence rule and the method-specific conversion and write requirements apply together. [Selected decisions](iterate-plan.md#13-selected-decisions) · [Failure policies](poison-policy-plan.md) |
| C6, C7, C9, C10, C20 | Record enumeration is outside this revision. Compiled-loop adoption belongs to Cascada. The public `isPoisoned` query distinguishes a placement's own status from errors below it. Complete's route inventory checks the shared gate. The obsolete clean-prefix diagnostic sentence has been corrected. Registration before first use remains a possible contract revision. [Runtime contract](docs/data-limitations.md) · [Search tree](docs/coverage-tree.md#simplification-search-tree) |
| 3b–3e, C15–C18 | Keep the borrowed prefix, captured exact length, and representation-specific cost thresholds. They cover different work: retaining readable storage, reusing a known shape, choosing sparse enumeration, and deciding when to remap. Claude's single-route trial lost 13 progress and 9 work/lifetime checks. A probe filling one million slots with one managed child preserved aliases and a snapshot across a point write with V8 old space limited to 128 MiB. The original C18 witness was unavailable. A whole deferred-leaf rewrite still needs comparative evidence for progress, cost, and lifetime. [Representation](docs/array-view.md) · [Work fixtures](test/array-structural-work.test.js) |
| §4 | The method specification defines observable failure and repair. The new public model checks four structural failures against it. The mixed-sign interval regression compares native results at each possible length in the reported example. Consolidating the planning documents remains an editorial proposal. [Method specification](docs/array-method-specification.md) · [Failure histories](test/array-generated-failures.test.js) |
| D | The staged implementation already contained the fixes for the shifted hole, the direct result of `sort!`, distinct predecessor positions holding equal values, and fatal propagation when discovery resumes. It also contained the bounded `shift!` and `pop!` paths for pending literal Arrays. |

The normal and traced suites each passed 6,848 tests. Claude's public `copyWithin!` probe matched native Arrays in all 8,202 programs. An exhaustive check of 326,400 interval cases found no mismatches in range emptiness, extent or the unaffected suffix. The v2 differential found no divergent seed and mode pairs across 500 seeds and three modes.

## Array simplification follow-up, 2026-11-23

Complete and streaming `flat` now share discovery and output assembly. Finite cycles reuse the captured physical placements. In the failed unlimited-depth benchmark, an early Error precedes a shared acyclic graph with a pending leaf. An eager replay prototype exceeded 5,000 selections on 24 Arrays before that leaf settled. The shared evaluator captures each Array once and keeps each occurrence's ancestry for late discoveries. [Implementation](src/array-flat-stream.js) and [work fixture](test/fixtures/array-flat-work.mjs)

Finite flattening uses the same shortcut for silent cycles and nested empty exits. Once only one child can contribute, a captured step can skip multiple descents. On a cycle with a 64-level empty exit, the old cycle-specific rule took 2,212 expansion calls for a 323-slot result. The general rule took 196. [Finite evaluator](src/array-flat.js)

Ordinary and region-backed sorts share one guarded capture and permutation. A sealed region previously kept a spent nested Array and an unrelated object alive after sorting had failed. Both now collect while a second required input remains pending, with either default ordering or a supplied comparator. A known undefined tail stays compressed. Remaps capture each selected source descriptor once. Private construction then consumes those versions, including the pre-write versions of an overlapping `copyWithin`. [Lifetime fixtures](test/fixtures/completed-work-retention.js) and [work bounds](test/fixtures/array-range-work.js)

A splice insertion keeps its occurrence identity inside a concat. An unordered consumer of `["P"].concat(["A","B"].toSpliced(pendingStart,0,"X"), ["Z"])` can receive X before its numeric index is known. The cursor enforces the requested window and each enclosing command's capacity projection. Searching a shared layout with 2,097,152 old slots and one insertion previously exceeded 2,048 cursor steps. Searching the compressed runs finds the insertion in two steps, or four when an earlier open prefix must settle. Only eligible occurrences contribute Errors. [Occurrence implementation](src/array-occurrences.js) and [cross-command cases](test/array-partial-splice.test.js)

A delayed-publication concat prototype held a captured prefix range under a lease. It preserved the prefix across a later write and passed 104 structural-work, argument-demand and collection tests. When the first argument failed and a later one remained pending, that lease retained the receiver and a successful argument. Complete concat keeps its required-input collection and releases success-only argument leases on failure. Existing prefix sharing, sparse index counts, captured length and end-relative selection each protect an independently tested work or progress guarantee. [Concat and sorting](src/array-methods.js) and [structural work](test/array-structural-work.test.js)

A single Complete-mode gate over streaming results would change two observable outcomes. Complete `concat` can copy an existing structural Error alongside a healthy suffix. On a full Array, Complete `splice(failedStart, 0, X)` reports only the start failure. Streaming recovery can also produce an overflow there. [Fallback contract](docs/array-method-specification.md#4-fallback-preserves-the-semantic-bounds)

An open Array capture hands its committed prefix to point reads and final assembly. When pending growth settles, `concat`, `slice` and `toReversed` capture only the new suffix. The same source descriptor previously ran once during issuance and again during assembly. [Captured shape tests](test/captured-shape.test.js)

The dense 100,000-element probe previously built a layout node for each distinct value and transferred each placement back into native storage. The three operations now copy selected descriptors directly into final order. On 100,000 distinct numbers, median process CPU fell from 1,720 to 78 ms for `splice!(1,1)`, from 1,813 to 78 ms for `with(0,9)`, and from 1,970 to 94 ms for `toReversed()`. Two paired runs tested the revisions in opposite order. Each median covers 24 measured calls, eight in each mode, after one warm-up per mode per run. With a one-element prefix and 99,999 distinct elements supplied by a settled concat, `with(0,9)` fell from 828 to 187 ms. The copy visits those suffix slots in one ordered traversal. Dense materialization still takes linear work. The work fixture bounds layout construction and placement transfers independently of timing, including on a borrowed prefix after concat settles. Failure and snapshot tests cover the removed result, surviving receiver, holes and deferred children. [Implementation](src/array-remap.js) and [regression tests](test/array-structural-work.test.js)

The cursor shares insertion membership and position calculations through nested joins. The remaining walks have different stopping rules. A directional search needs the first eligible index. An Error query can prove a whole range contains an Error. Ordered iteration reads one slot at a time, while unordered iteration must keep multiple discoveries open and respect the caller's window. A settled region prefix also answers point reads while its suffix is still pending. These differences support keeping the individual consumers and the existing backward point reads. [Search](src/array-search.js), [iteration](src/iterate.js) and [regions](src/array-region.js)

The ordinary and traced suites each passed 6,761 tests. All nine generated families passed at 1,600 seeds. The full conflict and publication matrices completed 571,380 runs. Independent comparisons against native Arrays matched 8,505 dense and sparse copy programs across the three modes. Another 144 cases checked flagged placements before and after repair. The 464 placement-capture lifetime cases included 336 injected descriptor failures. All 74 remap lifetime cases passed, including release of removed children after a late splice failure. The preceding search and flattening review also matched 5,760 insertion searches and 499 finite flattening cases.

### Contract review of dense Array work

Three old work rules prescribed scanning a sparse subrange, remapping every concat part, and replaying a bulk mutation into live storage. The contract now describes the captured range, required source failures and ordered publication. A point read on a shared result and a full native export have different output costs. A fresh private Array also has a known standard prototype. Sparse copying can leave its holes untouched, and only densifying methods need to create present `undefined` slots. [Work bounds](docs/work-bounds.md#array-ranges) · [Array representation](docs/array-view.md#materialization-and-length)

The work fixture previously required a positive tree-node count for ordinary `reverse`. A determined reversal or prepend can write selected slots directly into final positions. For `reverse!`, two holes prescribe no swap, and an odd-length Array's center has no partner. A dense backing whose only visible value is the center keeps its identity. The regression checks that case and the corresponding effective write with one more visible slot. [Runtime](src/array-remap.js) · [Identity and work tests](test/array-structural-work.test.js)

On 100,000 distinct numbers, median process CPU per call fell from 1,500 to 125 ms for `reverse`, from 1,570 to 149 ms for `reverse!`, from 1,524 to 133 ms for `unshift(-1)`, and from 1,477 to 141 ms for `unshift!(-1)`. Each revision ran twice in opposite order. Each median covers twelve calls across the three modes after warm-up, with result checks outside the timed section. An independent native-Array oracle matched 3,264 reversal and prepend programs, including 816 mutation-identity checks. Another 36 cases checked required descriptor failure and repair across ready, synchronous and deferred receiver delivery.

The original dense cases on this revision took 94 ms for `splice!(1,1)`, 94 ms for `with(0,9)` and 78 ms for `toReversed()`. Each figure is the median of nine post-warm-up calls across the three modes. The timing covers the method call on an imported Array. Source setup and output checks run outside the measurement.

A host-backed copy has a separate cost. After importing a Proxy for `[10,20,30]`, let its descriptor hook throw on a selected slot during `with(0,9)`. Failure at slot 2 fails the copy. A hook armed only for the discarded slot 0 permits `[9,20,30]`. All three modes gave those outcomes with a ready, synchronously delivered or deferred replacement index. The ordinary guarded read preserves this behavior without Proxy detection or an extra import copy. [Required managed inspection](docs/data-limitations.md#proxies-in-managed-storage)

The new representation exposed two differences between individually discovered and batched skips. For failures A then B, a Complete output now retains its baseline under A in both cases, and exhaustion reports both causes. For a streaming output, if A temporarily hides an older structural Error, the new output marker permanently records A. Repairing the source can reveal its older Error. These rules also hold when the skipped items are discovered beyond a still-open prefix. The work test allows independent slots to issue separate credits and bounds callbacks for a shared 1,024-position range. [Missing-output contract](poison-policy-plan.md#6-missing-output-markers) and [regression cases](test/array-iteration.test.js)

The earlier review also proposed waiting for exact length on end-relative reads. In either streaming mode, deleting an unknown number of slots from `[A,B]` and then appending Z already proves `at(-1) === Z`. A deletion count that stays pending must still let that read finish. Repeated managed children have a similar point-read case. Filling a large range with one child and mutating one occurrence preserves every other occurrence without allocating a parent record for each slot. These guarantees apply to different inputs from the measured dense operations. [End-relative reads](test/array-partial-splice.test.js) · [Repeated children and capacity](test/array-capacity-layout.test.js)

The ordinary and traced suites each passed 6,767 tests. All nine generated families passed at 1,600 seeds. The publication and conflict matrices passed 290,472 and 280,908 executions respectively. An independent check of 48 programs compared 144 output states across the three modes, including repairs of previously blocked targets. The regression tests detected each of ten injected faults covering dense work, identity, skipped causes and release.

## Array iteration implementation — 2026-11-23

Each controlled method now selects one evaluator. Ready `concat` shares an eligible receiver's backing in all three modes. Determined splices and dense copies map the retained ranges for both ordinary and compact Arrays. A held result of `copyWithin(pendingTarget, 0, 1)` on `[1, 2]` must still export `[1, 1]` after the target resolves to 1, even if a later assignment has already written 9 to index 0 of the receiver. [Array method contracts](docs/array-method-specification.md)

The previous streaming `concat` always built a layout for the receiver. Appending one ready item consequently scaled with the entire prefix. An open suffix can now borrow an eligible fixed prefix through its existing backing record. Successive concats carry the same range forward, even across a mode handoff before settlement. On a 30,000-slot receiver, issuing that concat or an empty splice takes zero indexed descriptor reads. A copy whose destination has room for one item takes six. The work tests count reads, key enumerations and layout branches independently of elapsed time. [Structural work tests](test/array-structural-work.test.js) and [layout construction probe](test/fixtures/array-enumeration-work.js)

The range experiment made point writes do work proportional to the receiver and lost recovery of the selected range. At this stage, a separate Complete `flat` collector handled whole-result failure and release. The shared evaluator described above now handles that boundary.

For streaming `flat`, take `A[0] = [pending]`, `A[1] = []`, and build each following Array from the previous two. At depth 4096 the former evaluator selected 2,015 placements before the pending value delivered `[]` to `A[63].flat(4096)`. Sharing the work already done on an open Array brings that count to 125, or 246 including settlement. The same counts hold at unlimited depth. With `A[1] = [42]`, a lookup can already deliver the first 42. Enough occurrences are guaranteed to exceed native capacity, so `hasError` can return true immediately. Collecting the actual causes still waits for the pending input. [Flattening work fixtures](test/fixtures/array-flat-work.mjs) and [streaming observations](test/array-flat-stream.test.js)

Repeated managed placements remain compressed. A full-width fill with one pending value can deliver a managed child at every occurrence. Its aliases, parent relationships and later point overwrites must remain correct without allocating one record per index. [Array storage](docs/array-view.md)

The same 64-Array graph exposes a second cost when searching for an absent value. Sequential `includes` used to allocate a pending comparison per logical position. The three search methods now compare shared ranges and keep the actual eligible error or match. With an empty Array, scalar, object or Error delivered into the shared leaf, the regression checks 6.56 to 10.61 trillion logical positions using at most 995 candidate comparisons across the three searches and zero physical slot writes. [Controlled search and publication measurements](test/fixtures/array-flat-work.mjs)

A deep Error query can inspect a guaranteed shared value once. An unordered cursor distinguishes individual occurrences, including holes, and accounts for each delivery within a bounded window. These consumers share placement resolution and keep their own traversal state. The compiler's append-entry record already selects push-only entry, so the redundant `pushOnly` field was removed. [Iteration](iterate-plan.md) and [entry](docs/enter.md)

## Range preparation — 2026-11-10

`fill` and `copyWithin` now share conditional preparation of their captured
numeric range controls. Empty intervals and normalized self-copy can finish
without unused controls, including poison or never-settling inputs. Failure
remains conditional while another control can prove there are no writes.
Successful fill retains its payload; failed or empty ranges release it.

Argument reception now supports individual positions through the same input
holder used by complete frontiers. Pending selection protects unread borrowed
inputs. Range outputs consume normalized coordinates directly; the redundant
normalization and unused native intrinsic entries are removed. No new layout,
publication or identity protocol is introduced. Self-copy's selected no-write
revision is documented in the current data and call contracts.

Normal and traced suites each pass 6,437 tests, including 143 new range tests
with an independent small-domain completion oracle. All ten affected safeguard
removals have failing witnesses; GC controls check release while unused controls
remain pending. The audit report records the verification scope.
All nine generated families pass at 1,600 seeds, along with the full traced
conflict and publication-pair matrices. The publication model and its self-test
now use the selected self-copy no-write rule while retaining real-write checks.

The remaining determined-shape reductions for searches, sorting, joining,
`at`, `slice`, `flat` and splice families remain in the iteration plan. Persistent
layouts, streaming modes and iteration are separate future implementation work.

## Finite-depth Array flattening — 2026-11-10

**Kept.** [Captured expansion](src/array-flat.js) shrank from 210 to 174 lines.
Full strongly connected component analysis is unnecessary: a silent cycle has
one nonempty continuation per node, with empty side branches. Following those
successors identifies its period and the depth at which its side branches vanish.
One recursive graph analysis supplies heights and nonempty-output facts, and
also replaces the separate sink-pruning algorithm used by unlimited-cycle
validation. Component records, low-link bookkeeping and component flags disappear.

Nonnegative count arithmetic needs only its final cap: integer results below
that cap remain exact, and rounding larger products cannot affect the answer.
The separate multiplication guard is removed. Capped recurrence powering stays:
ordinary recursion or memoization by depth still takes depth-sized work on a
tiny emitting cycle whose output exceeds capacity. Rejecting or skipping every
ancestor cycle changes valid finite-depth JavaScript results. The asynchronous
capture retains its distinct depth-demand, pending-presence and release rules.

The expanded permanent fixture checks 496 finite cases, including native
comparisons with alias/cycle checks and uneven empty exits around silent cycles.
All eleven work-counter rows match the previous implementation. Additional
independent checks passed 18,432 finite-depth cases at capacity 31 and 2,048 cycle
reachability cases; 256 enormous-depth comparisons matched the prior algorithm.
Verification passed all 6,294 suite tests and 68 traced flat-focused tests;
all ten flat safeguard removals produced their required failing witnesses.

## Structural review — 2026-11-05

This follow-up preserved the existing local simplifications. C01–C15 are current
responsibilities. F01–F03 and F05 remain future work; F04's core status-only
repair is implemented, with streaming integration still planned.
The findings here concern implementations, not changes to those contracts.

### Capture construction (S1.1; C02, C03, C06, C11, C14)

**Kept.** Managed export/receiver capture and mutable-external snapshots
both recursively construct source-free node/edge records, track aliases and
cycles, collect failures, and discard output. They formerly implemented those
steps in separate walkers before using the same assembler.

The replacement gives both boundaries one graph-construction walk. Concrete
readers retain the differences in classification, keys, shape, placement reads,
and availability consumption. Snapshot validation remains synchronous and never
subscribes to unavailable data; leaf admission remains transactional. The
snapshot's recursive construction, visited/output table, and source-disposal
path disappear. That consolidation left `CapturedGraph` with one user, so its
output state, assembly and disposal were folded into `ManagedCapture` and the
obsolete base class/module removed. Output discard still leaves required Error
traversal active. Input preparation and native receiver adoption remain separate:
they publish admission and topology rather than construct captured output.

Counterexamples checked during design include equivalent physical
representations with different reflection failures, a failed source appearing
through several aliases, pending presence or shape in a snapshot, and discarded
output whose required Error collection remains pending. Deep unformatted Error
stacks exposed new reader-frame references during the prototype; those bindings
were cleared at the reader boundary rather than weakening lifetime assertions.

### Managed publication outcomes (S2.1; C04–C07, C10–C12)

**Kept.** Producers formerly returned both `mutatedValue` and an optional
`placement`, while commit reconstructed missing placement facts and callers
separately captured nested mutation scopes. The replacement carries one
authoritative placement alongside the independent result and publication fact.
`PathOperation.mutate` captures nested scope outcomes once; the separate
`captureMutationResult` helper and caller-specific adapters disappear.

A failed operation and successful assignment of poison are different outcomes.
The previous optional-placement convention encoded that difference implicitly.
A transient failure fact now identifies producer failure; normalization consumes
it while publishing own failure status (now using D01 placement metadata). Blocked native operations remain result-only and
do not invent a receiver publication. Publication releases its protection before
an independent pending result, and the final coordinator drops the completed
placement outcome before waiting for that result.

Disproving cases include stored rejected assignment data, repair selecting the
original placement unchanged, absent deletion and record order, publication
failure combined with an independent result failure, and an Array result that
outlives receiver publication. Existing semantic and lifetime witnesses cover
these boundaries; the first focused run caught the poison-data distinction.

### Observational/native cursor experiment (S3.1; C04, C08, C13)

**Reverted.** A working-tree prototype removed `ExternalAccess.walkPrefix`'s
recursive body and moved native progression into `walkObservationValue`.
It shared key continuations and property descent, but required native-mode
state through every read stage, different terminal-callback authority, extra
source clearing, and an additional continuation for native pending keys. It
removed almost as much code as it added and made the managed path depend on
native reception policy. It was reverted before tests; no passing-test claim is
made for it.

Broadening that cursor to mutation and entry would add reconstruction and
non-consuming discovery policies as well. A failed key must poison the reached
mutation prefix, while an unused entry suffix must neither consume nor validate
that key. A pending independent call result must not extend prefix protection.
The existing shared `consumeSegment` already owns normalization, consumed
position and route advancement. These counterexamples reject this prototype,
not every possible future captured-location representation.

### Instrumentation protocol (S8; C15)

**Kept.** Twelve work fixtures independently implemented loader routing,
line-ending normalization, source rewriting and load receipts. One narrow
`instrumentRuntime` helper replaces those loader implementations. Each fixture
still declares its exact counter edits and independent work assertions. Exact
anchor multiplicity, actual module-load receipts and disabled-loader controls
remain mandatory; a zero-work uninstrumented run cannot pass as evidence.

### Neighboring mechanisms evaluated

The completed replacements were followed through their neighboring mechanisms.
These findings reject particular alternatives, not entire search branches.

| Search | Smaller model examined | Evidence and remaining boundary |
| --- | --- | --- |
| S1.2: logical producers | Use the source version directly for every copied/backing destination. | Backing producers already use ordinary placement-version publication; their extra object projects physical indexes through live owner ranges. Copied delivery captures one completion independently of later source-version writes. Direct sharing would expose later value, presence or own failure status to earlier copies. An immutable-version redesign must replace gate and mutation-version authority together; no complete protocol deletion was established here. |
| S1.3 / S4.3: consumer capture | Use one captured graph/demand traversal for remaps, searches, join, sort and flat. | All already reach the same guarded placement-subscription core. Eager complete capture inspects unused failing search positions and object interiors that conversion does not consume. Serial capture delays `includes` behind an earlier unknown comparison. Lazy presence, depth-limited flattening and complete Error collection would remain policies in a larger dispatcher. |
| S2.2: placement commit | Replace storage/structure/edge/counter callbacks with one transition record. | `preparePropertyCommit` already derives these updates from one before capture, reusing the required storage descriptor. Detached versions retain structural authority but no live topology authority. Optional cache writes and required writes already use the same commit with different failure contracts. Packaging the callbacks added retained source state without deleting a transition. |
| S3.2: route facts | Derive scope, provenance and metadata selection only from the final selected node. | The fixed issuance scope establishes ordering before keys settle; normalized keys cannot recover original dynamic provenance. Consumed depth and canonical nodes already live on one route. Earlier metadata views cannot be recaptured from current state after a wait. |
| S4.1: Array mapping | Replace eager remaps and selected-range carriers with one carrier. | A dense remap turns point fill/copyWithin into whole-Array work. A sparse range-plus-fallback carrier still needs baseline construction and adds representation dispatch. Replacing native intrinsic mapping needs a coordinated algorithm/layout rewrite, not an adapter. Persistent layouts remain future work with an unproven net reduction. |
| S4.2: captured shape | Replace length contribution/question lists with persistent maximum expressions. | Historical questions exclude later growth and forks share prior outcomes without unrelated invalidations. The expression alternative needs signal transfer, dominated-history compaction and release, recreating the existing machinery. Backward-settlement and retained-history witnesses disprove simple expression chains. |
| S5: forwarding | Share a union/find completion primitive for identity and metadata. | Identity comparisons can finish when pending classes merge; metadata consumers must stay asleep while their resolver chain transfers. A common completion framework retained both protocols behind callbacks. Sharing only the small compression loop adds an abstraction without removing the substantial mechanisms. |
| S6.1: graph projections | Derive counter propagation and retirement cleanup from incoming/forward placements. | One indexed child may be shared by many unindexed ArrayViews. Ordinary parent expansion scans unrelated owners; forward retirement scans repeated occurrences instead of distinct counter children. Retaining an Array-only cache creates another representation branch. A shared edge record remains possible, but no simpler representation preserving these work bounds emerged. |
| S6.2: resource holders | Use one generic holder for input, publication and outward delivery. | Arguments may outlive initial delivery; unused root preparation can close early; outward results preserve direct receiving reactions; placement captures transfer before independent results settle. The generic holder needs modes/extra hold states and eliminates no lifetime. S1 consolidates output disposal; S2 drops the completed publication outcome before waiting on its independent result. |

No costly unsupported-misuse defense was found to remove in these paths.
Application/reflection validation, source-static authority and execution-binding
checks protect supported behavior. Source rewriting tests remain strict about
their own instrumentation inputs; these are verification controls, not added
runtime interface defenses.

### Structural verification

Historical final normal/traced suites each passed **6,187 tests**. All nine
generated families at 1,600 seeds and the full traced conflict matrix passed;
the full publication-pair product was not run in this pass. Fourteen affected
safeguards had semantic witnesses; five GC cases cover the corrected snapshot
prototype retention. These are outcomes for that batch, not fresh current-source
acceptance. Later verification is consolidated in the audit report.

## Implementation-wide review — 2026-11-06

This pass followed issuance, admission, selection,
construction, publication, observation and release across all 43 runtime modules.
The earlier capture/outcome changes remain; this pass additionally removes the
following state and protocols without changing supported behavior.

### One authoritative forward placement table (S1.2, S2.2, S6.1)

**Kept.** Logical versions previously appeared in both `placementVersions` and
`outgoingPlacements`. Installation changed the first table; parent publication
mirrored each version into the second. Reactivation and retirement read one,
while logical reads, Array producers and counters read the other.

`outgoingPlacements` now owns each forward entry once. An overlay has an explicit
Boolean `present` fact; a physical traversable edge contains only `value`.
Logical access selects overlays from that table and still performs the required
host descriptor reads when no overlay exists. Array physical edges remain on
the backing record, so an Array owner's table contains only its overlays;
selected-range eligibility checks its size in constant time. Numeric overlay
enumeration remains ordered. Ordinary records already consume their key set
when combining physical candidates and overlays.

This removes the duplicated version store, its mirroring initialization walk,
and the consistency obligation between stores. Live publication and reactivation
share `activatePlacement`, including copied delivery. Optional counters and
incoming occurrences answer different bounded queries; neither duplicates the
forward version table. D01 subsequently removed hidden recovery parents and uses
ordinary relationships for data retained under failure status. The pending-append
fixture counts the one maintained store once and independently counts parent links, owner visits,
subscriptions and captured memberships.

The prototype exposed an implicit-presence gate update; existing structural and
Array histories detected it. Version creation and updates now canonicalize
presence to a Boolean. Copied-delivery activation can synchronously publish a
completed delivery; independent parent/storage checks cover that transition. Parent/storage verification still reconstructs expected data from
independent descriptors and bounds. No production test adapter was introduced.

### One staged identity record per import segment (S1, S6, S8)

**Kept.** Input preparation used separate admissions and containers maps for the
same identities, cross-checking membership during discovery, failure, commit and
disposal. One staged record now owns category facts and its optional construction.
Failure keeps facts available for authority discovery without committing a failed
container. Atomic segment publication, alias reuse and failed-inspection caching
remain unchanged.

Method-result preparation no longer has an always-on collection flag and
`{ errors }` carrier. Only receiver-failure combination and exact-receiver
rejection create the diagnostic Set they consume. Ordinary result preparation
without either consumer does not allocate it. Declaration and snapshot prototype checks share one retained-chain inspection;
the declaration stops on its first failure, while snapshots collect required later
failures. Two supported public tests cover that difference.

### One Array output publication path (S2, S4, S8)

**Kept.** Views, full remaps and range writes previously had separate output
completion paths, including an `ArrayRangeRemap` carrier and `instanceof` dispatch.
Range operations now construct their selected output at their own boundary;
all output forms use one finalizer for publication identity, receiver retention,
independent results and output failure. The carrier, its allocation and its
dispatch disappear. Eligible exclusive storage captures only the selected range;
shared or constrained storage still materializes the produced output. Full
structural methods continue to use remaps. Native removed-element and
length results retain their real result-specific adapters.

Backing extension also captures its ready logical length once instead of
repeating eligibility and shape reads through `tryShareStorage`. Pure guarded
reflection cannot change that captured shape or reenter runtime work.

### External ordering and metadata completion (S5, S6, S8)

**Kept.** External reservations no longer retain an auxiliary list of every
frontier Set containing them. Their immutable node/view route determines both
insertion and removal, with the same bounded ancestor work. Removing membership
releases that route independently of eventual effect completion. The exact
external-action guard uses structured `try/finally` instead of retained
success/failure slots.

Metadata consumption now transfers the captured final state and downstream
callback once, clearing both on local closure. Forwarded signals already wake
only on final publication, so recursively consuming/resubscribing after wake was
redundant. This lets ancestor collection drop its separate cleanup registration
and completion continuation. A pending-collector lifetime witness and live-owner
control cover the callback edge. A further prototype removed explicit metadata
capture cleanup; existing cases passed, but new compound-preflight failures
retained native resources through unformatted Error stacks. That prototype was
reverted, and both observation/mutation witnesses were retained. Context-tree
construction uses its maintained
child count rather than enumerating children to rediscover emptiness.

Error queries and mutation descent now retain the source version returned by
their placement read instead of looking it up again; the last redundant
`requirePromiseVersion` helper disappears. Its now test-only Promise projection
lives in the storage oracle, rather than remaining a runtime export.

### Concrete coverage and alternatives

| End-to-end responsibility | Code examined and outcome |
| --- | --- |
| Public issuance, execution, fatal completion | `index`, `chain`, `execution`, `internal-step`, `operation-result`, `operation-lifecycle`, `error`, `poisoned-value`, thenable recognition/subscription: retained the one outward pending fatal boundary; simplified external-action state. A combined operation/resource owner would conflate distinct last-use points. |
| Admission through native adoption | `import`, `input-preparations`, `language-values`, `meta`, `data-declarations`, `managed-invocation`: consolidated staged identities and diagnostic collection. A universal admission/receiver visitor would still require stop-at-prepared versus inspect-prepared and subscribe versus reject-unavailable policies. |
| Managed capture, snapshots and export | `managed-capture`, `external-snapshot`, `export`, `invocation`: retained the shared walker and assembler from the first pass; removed duplicate prototype inspection. Reader policies correspond to actual boundary differences, rather than independent construction engines. |
| Path selection through reconstruction | `path-context`, `path-operation`, `mutate-property`, `mutations`, `run`, `enter`, `external-access`: retained earlier complete-placement outcomes; reused exact captured versions. The prior native/managed cursor prototype was reverted because terminal authority and reconstruction remained separate behind added modes. |
| Placement publication and graph lifetime | `property-versions`, `language-properties`, `placement-structure`, `parent-placements`, `ownership`, `refcounts`: eliminated mirrored forward tables and initialization; shared activation. Replacing the acyclic counter projection with ordinary incoming expansion scans unrelated Array owners; replacing liveness proofs with SCC state adds a second graph algorithm without deleting an obligation. |
| Publication-derived identity | `captured-identity` plus its capture/publication callers: comparison can complete when two pending classes merge; fixed output partitions need not wait for all producer decisions. Direct source-version sharing still exposes later writes to older captures. An immutable producer rewrite must replace mutable gate authority too. |
| Native authority and historical metadata | `external-operation`, `external-metadata`, `external-mutation-tree`, native path/entry callers: removed reservation memberships and redundant metadata completion ownership. A single unpartitioned frontier would scan unrelated sibling effects on ancestor checks. |
| Array mapping and consumers | Every function in `array-methods`, `array-invocation`, `array-remap`, `array-view`, `array-length`, `language-conversion`: unified output publication and removed range carrier. Sort's second preparation wave consumes nested conversions discovered by element delivery; eager graph capture changes short-circuit searches. Persistent layouts remain a separate unproven replacement, not implemented behavior. |
| Queries and verification | `observations`, independent parent/storage/count oracles, generated histories, safeguard registry and source counters: source captures reused; one-table observers and anchors migrated. A `Promise.all` query coordinator cannot preserve `hasError` truth while unrelated branches remain pending. The [D04 follow-up](docs/audit-report.md#d04---query-completion-simplified-producer-redesign-remains-unproven) retains early query outcomes and replaces recursive completion waits with one operation-local counter, releasing spent stages. Existing loader consolidation remains in use. |

These findings justify the retained changes and reject the specific alternatives
listed. They do not prove architectural minimality. Further work should propose
and test a smaller invariant against these concrete flows. The resolved follow-up
decisions below are separate from these implementation improvements.

### Verification for the broader batch

Historical normal/traced suites each passed **6,189 tests**, along with all nine
1,600-seed generated families and the full traced conflict matrix. The publication
matrix ran only its bounded suite sample. The first traced run hit a two-second
VM-loading timeout; the complete rerun used the safeguard runner's 30-second
allowance without changing assertions or child deadlines. Changed safeguards
produced their intended witnesses. These results precede the whole-project audit;
its report and manifests contain the later complete verification.

## Resolved follow-up decisions

The [audit report](docs/audit-report.md) is the single decision record:

- [D01](docs/audit-report.md#d01---exact-path-status-repair-implemented): exact-own
  status repair is implemented. The [repair plan](repair-simplification-plan.md)
  retains the future streaming and positional policies.
- [D02](docs/audit-report.md#d02---context-import-already-registers-the-compilers-external-resource-tree):
  context import already registers external resources. Retain checks for access
  that began before context initialization.
- [D03](docs/audit-report.md#d03---imported-managed-originals-are-protected-owned-storage-remains-writable):
  imported originals are protected; retain physical writes to runtime-owned storage.
- [D04](docs/audit-report.md#d04---query-completion-simplified-producer-redesign-remains-unproven):
  query completion remains simplified. Two producer experiments were reverted:
  one kept the same bookkeeping with extra callbacks; the other violated pending
  history bounds. There is no pending implementation task for these candidates.

The selected [persistent Array layout](array-layout-approaches.md) remains future
work with its own streaming and failure-policy obligations. Its net simplification
must be demonstrated by replacing the existing paths and meeting their work bounds.

Source-clearing, separate last-use points, counter projections, effect reservations,
historical metadata, and distinct search-completion rules retain their documented
duties. New proposals must simplify the mechanisms that meet those duties;
shared syntax alone does not establish a simpler design.
