# Phase 5 B22: unresolved Array append history

**Disposition: B22 is closed. The user-approved shared backing producer representation passes the strict work regression, independent review and all 54 final acceptance jobs on the unchanged candidate-5 source/test pin.**

The initial review was executed on 2026-10-22 with Node 24.14.1 against production sources at `d47332b39531a7ddab3ffb40f417e025bb9234a3`. Its pre-fix measurements and design criteria remain below. The user approved “Implement and validate shared backing producers (recommended).” No semantic contract change was requested or made. The [final acceptance artifact](phase5-acceptance.json) retains the complete source/test manifest, commands, results and runtime receipts; the [sensitivity artifact](phase5-sensitivity.json) retains the reviewed fault diagnostics and their scoped qualifications. The [Phase 5 closure review](phase5-review.md) records the broader outcome.

## Retained witness and execution

[`test/fixtures/pending-push-work.js`](../test/fixtures/pending-push-work.js) issues N independent unresolved scalar payloads into `[0]`, keeping the Chain and scalar issuance results, with no historical Array output. It tests N = 16, 32, 64 before any delivery, after half the deliveries, after full delivery, and after explicit repair/replacement. Forward, reverse, and forward/reverse rejection schedules use fresh executions. Direct indexed assignment and ready push are separate controls: 27 fresh histories in total.

The fixture counts production work with read-only source instrumentation. Twenty unique substitution anchors must load; its file URL matching normalizes Windows drive-letter case. The Mocha wrapper forwards the parent's Node flags to the child, uses strict unhandled rejections, a 384 MiB heap cap, and a 60-second process deadline. A disabled-loader control must fail at the mandatory receipt assertion. This is child-process evidence, not an inference from parent loading.

Commands:

```sh
node --unhandled-rejections=strict test/fixtures/pending-push-work.js --report-only
node --unhandled-rejections=strict test/fixtures/pending-push-work.js
node --unhandled-rejections=strict test/fixtures/pending-push-work.js --legacy-copies
node --unhandled-rejections=strict ./node_modules/mocha/bin/mocha.js test/pending-push-work.test.js
```

The report-only command completes every semantic assertion and prints counters; it deliberately does not certify the work bound. Strict budgets check cumulative copied entries, constructed versions, subscriptions and parent/index work, plus maintained entries, live captures and owner allocation, at issuance, partial/final settlement and after repair/replacement. Deferring quadratic work until settlement cannot satisfy the test. The candidate's strict command passes. The deliberate `--legacy-copies` fault disables the new backing destination choice and restores the old copy path; after every semantic control completes it fails with `B22 copied placement entries are not linear: 16 forward issued: 120`. The wrapper requires that exact failure and completed semantic report. The no-op loader fails at its mandatory receipt. Startup failures and timeouts do not count as sensitivity evidence.

Semantic checks execute before the work assertion:

- Every push returns its exact new scalar length synchronously while every payload is still pending. Issuance is not serialized.
- Final Arrays equal `[0, 1, ..., N]`; reverse delivery is checked independently.
- Rejected inputs preserve exact cause, source, kind, and complete collection membership. Explicit repair preserves a rejection without a recovery baseline; final assignment then replaces the failed slot.
- A retained slice is changed independently from the later source Array while copied payloads are pending. Its historical length and untouched values survive reverse settlement.
- Independent exported prefix outputs are retained through later appends and checked against their own issued positions. Their requested data is accounted separately from the no-history bound.
- The retained-view/output controls import a host Array and verify that it remains `[0]`.
- Captured-Promise uses and capture-set memberships both return to zero after full settlement. This is a deterministic release check, not a GC claim.

## Pre-fix measured costs

The following are issuance measurements. Forward, reverse, and rejection schedules have the same pre-delivery costs.

| Route | N | Copied overlay entries | Constructed placement versions | Unfinished captured-Promise uses | Normalized `then` registrations | Rejection-handler registrations | Parent-version record writes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pending push | 16 | 120 | 154 | 120 | 424 | 272 | 136 |
| Pending push | 32 | 496 | 562 | 496 | 1,616 | 1,056 | 528 |
| Pending push | 64 | 2,016 | 2,146 | 2,016 | 6,304 | 4,160 | 2,080 |
| Pending indexed assignment | 16 | 0 | 18 | 16 | 80 | 48 | 16 |
| Pending indexed assignment | 32 | 0 | 34 | 32 | 160 | 96 | 32 |
| Pending indexed assignment | 64 | 0 | 66 | 64 | 320 | 192 | 64 |
| Ready push | 16 | 0 | 34 | 0 | 0 | 0 | 0 |
| Ready push | 32 | 0 | 66 | 0 | 0 | 0 | 0 |
| Ready push | 64 | 0 | 130 | 0 | 0 | 0 | 0 |

“Constructed placement versions” counts `createVersionFromPlacement`, not every possible version allocation site. “Parent-version record writes” counts `recordVersion` Map writes, not a second allocation per write. The copied-entry and unfinished-capture counts alone establish the violation; these additional counters identify its surrounding costs. Direct outward-result subscriptions and common aggregate members are separately instrumented and both zero during issuance for these histories. Rejection-handler registrations are counted separately rather than omitted from subscription work.

For pending push, copied entries and live captures are exactly `N * (N - 1) / 2`. Physical backing has only N + 1 slots, there is one active backing owner, the current view has N installed versions and N outgoing version records, and N former owners have retired. Therefore the dominant unfinished cost is not physical Array size, multiple requested Array snapshots, or a failure to retire former owners.

After half the payloads settle:

| Delivery order | N = 16 | N = 32 | N = 64 |
| --- | ---: | ---: | ---: |
| Forward: live captures | 28 | 120 | 496 |
| Reverse: live captures | 92 | 376 | 1,520 |

All live captures and capture memberships reach zero after final settlement. Successful eventual release does not satisfy the peak-storage or aggregate-copy bound. The exact count already demonstrates quadratic work at bounded sizes; larger memory probes are unnecessary to establish this defect. The specification's older heap samples remain separate historical evidence.

## Pre-fix authoritative route trace

1. `array-invocation.js:invokeArrayMethod` selects the push view producer. Payloads remain availability values; length and publication can finish immediately.
2. `array-methods.js:tryAppendArrayView` calls `ArrayView.tryExtendEnd`. That helper creates a new bounded owner over the same backing and calls `copyArrayOverlays` before adding the new suffix.
3. `property-versions.js:copyArrayOverlays` enumerates every source overlay, including every earlier pending append. `copyPlacement` sends each pending entry through `transferPlacement` with `writeBack = false`.
4. `transferPlacement` creates another version and calls `resolvePlacement`, which enters `continueCapturedPromiseVersion`. That continuation retains the previous producer, registers a capture, observes availability/publication, and installs another publication obligation.
5. `PlacementConstruction` publishes the new owner's topology. The former owner retires through `retireRelationships`, clearing its destination authority and reverse references. Its exact captured versions still have to settle for the new version's callbacks. Retirement correctly cannot cancel them.
6. Repeating the transition copies 0 + 1 + ... + (N - 1) overlays. Although only the latest logical owner survives, all unfinished producer-to-copy dependencies remain until their inputs settle.

This is more precise than attributing the whole problem to the historical F8 point-mutation materialization loop. This witness takes eligible shared-backing append; its quadratic term is overlay/version capture and publication copying. The backing itself remains linear.

Sibling producers share this boundary. `concat` uses `tryAppendArrayView`; indexed extension in `mutations.js` calls `tryExtendEnd`; `pop`, `shift`, and eligible `slice` use `tryDeriveArrayView`, which calls the same overlay copier. Full remap/materialization instead uses `placeRemap`/`transferPlacement` and must preserve its explicit copied-placement ordering. A remedy must distinguish bounds projection from actual independently mutable placement copying, without losing presence, recovery, producer context or publication authority.

## Approved representation experiment and retained implementation

**Question:** can unchanged backing positions share one canonical pending producer across bounded Array projections, while each explicit write owns its local placement version and ordinary independent materialization still creates the required fresh version at its program position?

The retained implementation makes pending backing contents a maintained backing fact, like current ready physical contents. Bounds-only derivation registers a new logical owner without cloning those producers. Owner-local overlays still copy through the existing copier, and actual independent materialization still creates fresh FIFO placement versions. Each explicit override has ordinary local authority when required by sharing, an existing version, an optional counter index or a structural gate.

The obligations recorded before implementation were:

- A backing's physical slot and canonical logical producer are different facts when optional cache writeback fails, a slot is masked, or a captured producer is replaced. `ArrayBacking.outgoingPlacements` currently records physical edges. Reusing that same `(record, index)` entry for the producer would overwrite physical retention and incorrectly expose or hide parent occurrences. A shared-producer projection needs coherent logical-edge and physical-edge accounting.
- `getPlacementVersion`, capture, candidate enumeration, presence, local writes, gates, structural transitions, recovery, and counter updates must agree on whether an owner uses its override or the shared producer. A version reached through another owner must not grant its storage authority to the writer.
- Settlement must preserve exact producer diagnostics and shared bookkeeping before consumer work. It must update current projected occurrences without resurrecting a retired owner or walking completed history.
- Active views, overwritten captures, imported backing, retained outputs, failed construction, and optional writeback failure require distinct last-use evidence. An ArrayBacking record cannot retain otherwise dead owners merely to make settlement easy.
- Bounds, offsets, holes and masked stale storage must remain correct across push/concat/index extension and slice/pop/shift; fallback materialization and actual retained views keep their ordinary independent-copy obligations.
- Ready length/results, write identity, source isolation, and publication failure/repair must match the explicit all-ready sequential execution. No payload timeout or new serialization is permitted.

**Whole-cost success criterion, fixed before implementation:** the no-history scalar witness at N, 2N, 4N must meet the existing O(N) live-storage and aggregate copied-entry target at issuance and partial/final settlement in both orders, including rejection and repair. Count shared-store entries, overrides, canonical producer records, parent facts, retained captures, subscription/notification membership, and any forwarding records together; moving the quadratic structure into a different store is failure. The retained-view and independent-output controls must still pass, with their requested storage shown separately. The criterion also required broad Array/ownership/publication tests, traced checks, normal acceptance and independent review of the implemented candidate.

**Revert condition, fixed before implementation:** discard an experiment if it changes any sequential observable, needs retained history traversal to locate a current producer, loses rollback or exact prior capture, merely reduces the quadratic constant, or adds disproportionate parallel state paths. The retained implementation meets the work criteria below and completed the full acceptance and independent review gates.

`ArrayBackingProducers` is one optional bookkeeping record on a runtime backing. Its property-version table is distinct from `ArrayBacking.outgoingPlacements`, which continues to own raw physical edges. A shared producer masks the physical occurrence at its index; a local view version masks both. Parent enumeration expands the appropriate record through the existing owner bounds. Lookup, presence, placement capture and candidate enumeration use the same local-first, backing-second rule, including pending presence without a physical placeholder.

`transferPlacement` selects a backing destination only for an established index in a distinct Array view, with no local version, counter index, destination version or structural gate, and no other view currently projecting that physical position. It preserves the ordinary common receiving transition. A readiness probe occurs only after identifying an eligible Array-view shape; an early experiment probed raw root input before admission and added a then getter read. The existing declaration/admission regression caught this, and the candidate restores its original count. Ready payloads that need no producer keep ordinary physical storage.

Counter construction already walks each indexed logical placement. It now records reciprocal memberships between the exact backing version and its indexed owner. Shared settlement updates only those maintained consumers, and local override or owner retirement removes the membership. An early implementation enumerated all backing owners on every producer update; the existing ownership-work regression exposed quadratic suffix work. The retained version uses the maintained optional memberships instead.

Canonical forward producer contents follow backing lifetime, just as raw physical slots do. There is at most one current canonical version per backing index, independent of how often a view overrides or masks it. A non-projecting or out-of-range retained view can therefore keep the backing and its forward contents alive. Last backing-owner retirement clears active reverse relationships and publication destinations; counter membership retirement is reciprocal. Forward contents remain available for supported reception, while exact captured versions settle independently. There is no per-slot retirement sweep or extra range index. An experimental eager override cleanup scanned owners and discarded canonical forward state; it was removed rather than adding a second reclamation mechanism.

The dedicated [`array-backing-producers.test.js`](../test/array-backing-producers.test.js) covers indexed shared settlement into managed children, independently mutated retained views, ready/pending local overrides with earlier captures, repeated overrides/deletions with 32 retained out-of-range views, final backing retirement, sparse concat presence, and actual physical write refusal followed by late settlement and repair. The independent parent verifier derives the canonical projection from raw metadata and checks optional counter reciprocity; it does not call the production logical-version getter to establish its expected answer.

### Corrections from candidate review and full acceptance

The first pinned candidate (`461f0b60627082a4a1875e078bb91f377bb0cc2e443d8bcd1a7b424643a73cc7`) was rejected after independent review found three supported intersections. Its interrupted acceptance work is not evidence for the corrected candidate.

1. A public `getErrors` query indexed a pending canonical slot; a nested assignment then installed a queued local version directly, without detaching the shared counter membership. Resolving an object with a pending child, rejecting that child, and then replacing it left `hasError === true` while `getErrors === null` and export was healthy. `installMutationVersion` now uses the same `prepareEdgeUpdate` transition as gate installation. The regression checks reciprocal detachment immediately and Error-query/export agreement after rejection and replacement. All other direct installers were audited: copies and input construction are fresh and unindexed; replacement and gates already use that transition.
2. An entered deletion removed physical storage and then detached its completed absent gate, revealing the still-present canonical producer. `detachAbsentVersion` now retains an absence while a canonical producer remains underneath it. Ready/pending and indexed/unindexed cases verify the hole, unchanged length, immediate reception, derived-view copying and later independent writes.
3. Length assignment inspected only local versions, so truncating a canonical pending structural transition published an empty export before an earlier contained effect completed. Truncation now also consumes projected canonical versions. `ArrayView.backingVersions` translates the selected range, excludes local overrides, and chooses between the selected index span and the canonical table using its already maintained outgoing-record size. This adds no index, counter or host reflection, and bounds enumeration by the smaller input. Controls cover offsets, a masked canonical transition, out-of-range and retained native owners, retained-prefix transitions and ordinary pending payloads, which still do not delay truncation.

The complete direct `placementVersions` reader audit distinguishes intentional own-storage access in construction, parent maintenance, local-copy transfer and counter membership from logical consumption. Generic lookup/presence and Array candidates already merge canonical producers; truncated-transition consumption was the remaining logical reader. A retained native owner with shorter original bounds uses bounded numeric candidates and does not newly enumerate the canonical tail outside its range.

All three corrections have deliberate fault witnesses in the safeguard registry. The queued-writer preparation-pin fault was migrated to its unchanged semantic boundary after the shared transition replaced the direct install. These changes preserve the representation and its whole-cost criteria.

The next full normal candidate run reported 5,280 passing tests and six supported reflection failures, so it was also rejected. The new `instanceof ArrayBackingProducers` dispatch in counter publication invoked a user Proxy's `getPrototypeOf` trap outside its reflection boundary. A sibling audit found the same unnecessary probe in cached Array length and logical publication, and in parent expansion's existing/new backing-class checks. All four now derive the internal-record distinction from existing execution metadata (`backingOwners`), which only the two runtime backing records own. The length path additionally already has the producer's range. This adds no tag, brand registry, host inspection or reclassification. The independent parent verifier uses safe metadata dispatch too while retaining its separately derived logical projection oracle.

The complete supported reflection suite passes all 30 cases normally and with tracing. New retained controls arm a throwing prototype trap only after admission, then read a cached Array length or perform record ready writes, nested writes and pending publication; none re-probes the prototype. Four separate safeguard faults restore the unsafe dispatch sites and trigger two counter-sweep failures, one cached-length failure, one parent-projection failure and one publication failure. The initial publication-fault witness lacked a ready record write and started a full fallback; that superseded run was stopped, the direct supported control was completed, and the targeted fault then produced its required failure.

The resulting third source/test candidate was pinned as `f35d6b51ddb3cd7c5c1d931e6cf8d951c47fbe21bfcda0240a3734398aec121e` (244 files; `candidate-3-normal.manifest.json` in the Phase 5 evidence directory). Its full normal suite passed 5,288 tests, but the larger generated Array run rejected this candidate too: program 1,948, seed 440236073, failed with `Cannot write outside an ArrayView range`.

The 14-step generated history reduces to an initially empty Array, a delayed entered assignment at index 4, a queued no-op entry at that placement, `pop!`, and an entered assignment at index 1. The earlier transition establishes the later view's logical bounds while physical storage can still have length zero. A diagnostic at the actual throw identified `ArrayBackingProducers`, not a logical view, as the write owner. `placementDestination` had already authorized its physical index; `mutationTarget` incorrectly checked that internal coordinate against the physical cache length as though it were a bounded view.

The correction gives a producer's authorized index writes the existing native backing coordinate rule, using `meta.backingOwners`. Real views retain their bounds check. No new state, reflection, traversal or ordering mechanism is added. The retained public regression covers ready values, native Promises, ordered thenables and rejection followed by replacement, with exact sparse length, returned pop value, Error-query agreement, retained output isolation and parent/counter verification. The original generated program passes observed, verified and bare modes. Restoring the old range condition through `backing-producer-writes-authorized-slot` produces the two intended native/rejection failures with actual runtime receipts. Independent review additionally passed 12 ready/native/ordered, queued-entry and earlier-retained-owner controls; the restored old condition fails its native/no-op case.

At this pre-lifetime-correction stage, `src/array-view.js` had SHA-256 `4882b09596759b34076782e9df62bfab1a4f8623a34ba180471b24f899d6e0dd`. This is a historical component hash, not the final source hash. None of the three rejected candidates certifies the final implementation.

The fourth candidate passed its full normal and traced suites (5,292 tests each), but independent lifetime review then found a supported retained-source failure. A mutable `push` over a stable Array Proxy could fail at a post-admission `length` read, return recoverable poison and retain its discarded Proxy and raw backing through the unformatted diagnostic stack after root replacement and payload settlement. A formatting-only diagnostic control released those sources, confirming the lazy-stack path; formatting is not the remedy.

The producer constructor's stored `lengthState` had no semantic consumer: its storage descriptor path reads current physical length, while logical projections use actual owners' bounds. The unused host read and numeric field are removed. Generic relationship activation/retirement permits that coordinate-only producer range to have no length sequence. Required physical-length reads still occur at their proper boundaries and now clear their captured Array in `finally`. Synchronous extension also clears its source, backing and population callback after construction succeeds or fails.

The same concrete inspection sweep found one sibling construction leak: a fresh Error from an actual appended index definition retained a ready `{ n: 1 }` payload through `tryAppendArrayView`'s population callback. Clearing that callback's `suffix` binding after the synchronous extension fixes both `push` and `concat`; no additional protection, scheduling or error policy was introduced. The new lifetime fixture sweeps every actually reached length/extensibility/descriptor/write/definition boundary with prebuilt and fresh causes, preserves exact poison cause/context, and retains discarded, live and later-released controls. It determines reached read counts from the healthy path rather than pinning incidental reflection counts. Its stack-limit and fault results are retained in the independent review and final portable acceptance and sensitivity artifacts.

Evidence reconciliation also identified a distinct release obligation for the newly maintained reciprocal counter memberships. Generic counter-child retirement and queued-override faults did not target this new retirement loop. A new public regression uses ready poison so `hasError` indexes two canonical projections and closes immediately, retires one owner while the other remains, checks both membership directions, then resolves the shared input and verifies healthy Error queries/export after replacement. The exact loop-removal fault `retirement-detaches-backing-counter-memberships` fails that regression. The complementary GC control keeps an out-of-range backing owner and unresolved producer live while the departed indexed view must collect; it is separate from the immediate metadata assertion.

## Final measurements and acceptance

The final `candidate-5-b22-direct` record in [phase5-acceptance.json](phase5-acceptance.json) passed in strict mode with 27 histories, two retained-output controls, all 20 work-instrumentation anchors, and one actual loaded/executed runtime session. Its counters match every value in the following table and the rejection/repair totals below. Forward and reverse success schedules have the same counts at each stage:

| N | Copied entries, all stages | Constructed versions, all stages | Live captures, all stages | Normalized / handler registrations | Maintained entries, all stages | Parent/index work: issued / half / final |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | 0 | 34 | 0 | 64 / 32 | 35 | 66 / 82 / 98 |
| 32 | 0 | 66 | 0 | 128 / 64 | 67 | 130 / 162 / 194 |
| 64 | 0 | 130 | 0 | 256 / 128 | 131 | 258 / 322 / 386 |

Maintained entries count every version/outgoing record, incoming-parent entry, owner membership, optional parent/cycle/child counter store and both directions of backing-counter membership on this scalar history's root holder, current view, raw backing and two backing records. Raw physical data has N + 1 slots and is reported separately. The current view has no copied overlay records; the backing has N canonical versions and N producer outgoing records, plus three root/owner entries. There is one active backing owner. Allocation is N views plus one physical backing record and one producer record. No forwarding history, retained producer-to-copy chain, or new per-view producer list replaces the removed copies.

Forward and reverse rejection/repair also agree. After collection, repair and replacement, maintained entries are 67, 131 and 259; constructed versions are 37, 71 and 140; total parent/index work is 129, 251 and 500. Both reciprocal index memberships are counted. All copied-entry and live-capture counts remain zero. Retained requested views and exported prefixes are checked separately, since their requested captures are explicit output cost.

The final candidate is pinned at `bb57d772e6ca9eb76dac5ff96ddeba3b79502b4a041a546e10f9bc838f538ca8` across 246 source/test/AGENTS/package files. All 54 acceptance jobs passed with no changed inputs. Normal and traced suites each passed 5,299 tests; the full Array differential passed 9,600 programs and 28,800 harness replays. All 217 safeguard entries have reviewed detections in [phase5-sensitivity.json](phase5-sensitivity.json), with actual subprocess receipts, counter-versus-GC distinctions, non-detecting selectors and the one post-detection Mocha crash explicitly qualified. The complete matrix, publication pairs, other required scale runs and stack-limit supplements are recorded in the final acceptance artifact.

### Historical focused validation

The following focused results describe successive implementation stages, including subsequently rejected candidates. They explain local verification and do not replace the final unchanged-pin results above.

Focused commands (Node 24.14.1, strict unhandled rejection handling):

```sh
node --unhandled-rejections=strict ./node_modules/mocha/bin/mocha.js --reporter dot --timeout 60000 "test/array-*.test.js" "test/ownership-*.test.js" test/placement-version-boundaries.test.js test/publication-failure-boundaries.test.js test/storage-settlement.test.js test/verify-storage.test.js test/receiving-contracts.test.js test/pending-push-work.test.js
node --unhandled-rejections=strict --import ./test/trace-runtime.js ./node_modules/mocha/bin/mocha.js --reporter dot --timeout 60000 "test/array-*.test.js" "test/ownership-*.test.js" test/placement-version-boundaries.test.js test/publication-failure-boundaries.test.js
node --unhandled-rejections=strict --import ./test/trace-runtime.js ./node_modules/mocha/bin/mocha.js --reporter dot --timeout 60000 test/storage-settlement.test.js test/verify-storage.test.js test/receiving-contracts.test.js test/pending-push-work.test.js
node test/safeguards/run.mjs --skip-baseline publication-keeps-discovery-availability
```

Initial focused results were normal 693 passing and traced 655 plus 38 passing. After the three independent corrections, the combined focused command passed 700 tests normally and 700 with tracing. One final masked-transition regression was then added without a source change; the resulting producer/strict-wrapper group passed all 17 traced cases. These were component checks before the subsequent full acceptance and re-review. The strict B22 counters were unchanged by the three corrections.

The affected discovery-availability safeguard was migrated to the equivalent authoritative condition, preserving its `discoveryBlocked` fault; it is witnessed by six failing tests. The three new faults produce one queued-index failure, four absence-mask failures and one truncation-order failure. The migrated preparation-pin fault still produces its two ownership failures. All registry source anchors match. Early focused invocations using Mocha's default two-second timeout produced subprocess timing failures under concurrent load; the listed 60-second test-timeout runs passed. No semantic assertion was weakened. The fixture's final accounting expansion was rerun directly in strict mode and through its normal/traced wrapper.

After the reflection correction, the reflection/producer/strict-B22 group passed 47 cases normally and with tracing before the ready-record-write extension; the complete reflection file then passed 30 cases in each mode. The broader focused command added `test/reflection-boundaries.test.js` to the combined Array/ownership/storage/receiving command above: it passed 731 cases normally and 731 with tracing on that stage's source/test snapshot. These results preceded the later range and lifetime corrections.

After the generated Array range correction, the dedicated producer file passed 18 tests. The producer, strict B22 and complete reflection group passed 51 tests with tracing. An exploratory run from program zero with `CASCADA_SEQUENCE_SEEDS=1600`, strict unhandled rejections and a 384 MiB heap cap was deliberately stopped before completion so it would not duplicate the official acceptance run. `candidate-4-array-sequences-precheck.log` carries no acceptance claim: it has no complete start manifest or runtime tracer receipt. The complete 9,600-program / 28,800-replay qualification comes from the final pinned acceptance run.

After the initial length/source cleanup, the Array-view/length/ownership/producer/strict-work/reflection selection passed 385 tests normally and 385 with tracing. After the confirmed suffix cleanup and the new indexed-retirement regression, the producer/strict-work/reflection group passed 52 traced tests; the dedicated producer file passed 19 normal tests. The imported-storage safeguard's source anchor moved only because extension gained a `finally` scope, and its original witness still failed under the migrated fault. Final pin validation, lifetime fault receipt reconciliation and full acceptance subsequently completed as recorded above.

Independent lifetime validation completed 40 fresh/prebuilt reflection-failure cases and seven controls at stack limits 10, 50 and 1,000, normally and traced. The scope includes required length reads for `slice`, `pop` and `shift`; those paths needed no additional production change. Four separate restored cleanup/unused-read faults produce the intended child-process retention diagnostics. The reciprocal-membership fault produces both the direct metadata assertion and the independent retired-indexed-view GC failure. The activation-candidate safeguard also retains its original intended failure after its source anchor was migrated around the optional producer length state.

## Alternatives assessed

Skipping `copyArrayOverlays` alone is invalid: the new view would read stale physical Promise storage without its producer/version, and absence/recovery overlays would disappear. Cancelling copies on source retirement loses publication still required by surviving versions. Serializing pushes or settling payloads before the next command violates the witness's required issuance/progress behavior. Heap thresholds or smaller test sizes would conceal rather than fix the count.

Sole-owner transfer at successful destination publication is a possible narrower alternative. It must preserve the source baseline until publication succeeds, move a clearable destination authority without an O(N) retargeting pass, transfer parent relationships, and handle already settled managed overlays. The current `transformProperty` retains a baseline lease for rollback, and normal copied versions retain their source through separate continuations. Releasing/ignoring another use's lease or moving the baseline before a fallible commit is invalid. A transfer protocol would need a general publication-commit handoff and a precise retained-source eligibility rule; adding a push-only bypass would not satisfy those obligations.

No contract weakening was made. The canonical producer implementation is retained after completed pinned acceptance and independent review. This B22 artifact supplies its cost argument and correction history; the linked Phase 5 closure artifacts retain the complete acceptance evidence.
